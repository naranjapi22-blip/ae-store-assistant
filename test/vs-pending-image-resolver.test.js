import test from 'node:test';
import assert from 'node:assert/strict';
import { VsImageRegistry } from '../src/vs-images/VsImageRegistry.js';
import { VsImageResolutionCache } from '../src/vs-images/VsImageResolutionCache.js';
import { VsPendingImageResolver, pendingBatchSize } from '../src/vs-images/VsPendingImageResolver.js';
import { VsRuntimeImageRepository } from '../src/repository/VsRuntimeImageRepository.js';
import { VsProductService } from '../src/service/VsProductService.js';
import { vsProductApi } from '../src/api/vsProductApi.js';

const row = (barcode, style, color, stock, overrides = {}) => ({ CODBARRAS: barcode, STYLE: style, COLOR: color, STOCK: stock, departamento: 'APPAREL', seccion: 'TOPS', familia: 'PINK', ...overrides });
const response = () => { const result = {}; return { result, writeHead(status) { result.status = status; }, end(body) { result.body = body; } }; };

const fakeRepository = rows => ({
  rows,
  toPublicRow(item) { return { ...item, image: item.image ?? null, imageSource: item.imageSource ?? null }; },
  async findByBarcode(barcode) { return this.toPublicRow(rows.find(item => item.CODBARRAS === barcode)); },
  async findByReference() { return []; }, async findByIdentity() { return []; },
  async findByStyle(style) { return rows.filter(item => item.STYLE === style).map(item => this.toPublicRow(item)); },
  async findByStyleColor(style, color) { return rows.filter(item => item.STYLE === style && item.COLOR === color).map(item => this.toPublicRow(item)); },
  searchCatalog() { return { items: rows.map(item => ({ ...item, barcode: item.CODBARRAS })), total: rows.length, offset: 0, limit: 50, hasMore: false, facets: {} }; }, catalogFacets() { return {}; }, metrics() { return {}; }
});

const setup = (rows, resolverResult = { status: 'MATCHED_SAFE', imageUrl: 'https://example.test/image.jpg', source: 'vs-romania-runtime' }) => {
  const registry = new VsImageRegistry(null, { now: () => '2026-01-01T00:00:00.000Z' });
  registry.reconcile(rows, item => item.image ? { image: item.image, imageSource: item.imageSource } : null);
  const cache = new VsImageResolutionCache();
  const runtime = new VsRuntimeImageRepository(fakeRepository(rows), cache, registry);
  const calls = [];
  const imageResolver = { async resolveCandidate(candidate) { calls.push(candidate); return typeof resolverResult === 'function' ? resolverResult(candidate) : resolverResult; } };
  return { registry, cache, runtime, calls, pending: new VsPendingImageResolver({ registry, cache, runtimeRepository: runtime, imageResolver }) };
};

test('pending resolver processes only pending identities once, ordered by stock and representative barcode', async () => {
  const rows = [row('B', '11250001', '1ABC', 4), row('A', '11250001', '1ABC', 4), row('C', '11250002', '2ABC', 9), row('D', '11250003', '3ABC', 1)];
  const { pending, calls, registry } = setup(rows, candidate => candidate.styleColor === '11250002-2ABC'
    ? { status: 'NO_MATCH' } : { status: 'MATCHED_SAFE', imageUrl: `https://example.test/${candidate.styleColor}.jpg`, source: 'vs-romania-runtime' });
  registry.entries.set('11250003-3ABC', { ...registry.entries.get('11250003-3ABC'), status: 'REQUEST_ERROR' });
  const dry = await pending.runBatch({ dryRun: true, limit: 50 });
  assert.deepEqual(dry.items.map(item => item.STYLE), ['11250002', '11250001']);
  assert.equal(dry.items[1].representativeBarcode, 'A');
  assert.equal(calls.length, 0);
  const result = await pending.runBatch({ limit: 50 });
  assert.equal(result.processed, 2);
  assert.deepEqual(calls.map(item => item.styleColor), ['11250002-2ABC', '11250001-1ABC']);
  assert.equal(registry.entries.get('11250002-2ABC').status, 'NO_MATCH');
  assert.equal(registry.entries.get('11250001-1ABC').attemptCount, 1);
  assert.equal(registry.entries.get('11250003-3ABC').status, 'REQUEST_ERROR');
});

test('batch limits, conservative results, and an existing MATCHED_SAFE never degrade', async () => {
  assert.equal(pendingBatchSize(), 10); assert.equal(pendingBatchSize(99), 50);
  const rows = [row('1', '11251001', '1ABC', 1), row('2', '11251002', '2ABC', 1), row('3', '11251003', '3ABC', 1), row('4', '11251004', '4ABC', 1)];
  const statuses = ['REQUEST_ERROR', 'IDENTITY_CONFLICT', 'MATCHED_SAFE', 'NO_MATCH']; let index = 0;
  const { pending, registry } = setup(rows, () => ({ status: statuses[index++] }));
  registry.entries.get('11251003-3ABC').status = 'MATCHED_SAFE'; registry.entries.get('11251003-3ABC').imageUrl = 'https://example.test/known.jpg'; registry.entries.get('11251003-3ABC').source = 'current';
  const result = await pending.runBatch({ limit: 50 });
  assert.equal(result.processed, 2); // identity conflict ends the controlled batch
  for (const key of ['11251001-1ABC', '11251002-2ABC']) assert.equal('imageUrl' in registry.entries.get(key), false);
  assert.equal(registry.entries.get('11251003-3ABC').status, 'MATCHED_SAFE');
});

test('a safe pending resolution updates cache and is visible immediately without replacing visual fallbacks', async () => {
  const rows = [row('1', '11252001', '1ABC', 7), row('2', '11252001', '2ABC', 2, { image: 'https://example.test/exact.jpg', imageSource: 'current' })];
  const { pending, registry, runtime, cache } = setup(rows);
  const before = await runtime.findByBarcode('1');
  assert.equal(before.image, 'https://example.test/exact.jpg');
  assert.equal(before.imageIsReference, true);
  await pending.runBatch();
  const after = await runtime.findByBarcode('1');
  assert.equal(cache.get('11252001-1ABC').status, 'MATCHED_SAFE');
  assert.equal(registry.entries.get('11252001-1ABC').status, 'MATCHED_SAFE');
  assert.equal(after.image, 'https://example.test/image.jpg');
  assert.equal(after.imageIsReference, undefined);
  const existing = await runtime.findByBarcode('2');
  assert.equal(existing.image, 'https://example.test/exact.jpg');
});

test('resolve-pending endpoint returns 409 while a batch is running', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const rows = [row('1', '11253001', '1ABC', 1)];
  const { pending, runtime } = setup(rows, async () => { await gate; return { status: 'NO_MATCH' }; });
  const service = new VsProductService(runtime, { pendingImageResolver: pending }); const api = vsProductApi(service);
  const first = pending.runBatch();
  const res = response(); await api({ method: 'POST', url: '/api/vs/image-coverage/resolve-pending' }, res);
  assert.equal(res.result.status, 409); assert.equal(JSON.parse(res.result.body).error, 'VS pending resolver already running');
  release(); await first;
});
