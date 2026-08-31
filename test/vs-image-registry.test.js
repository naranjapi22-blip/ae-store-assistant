import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { VsImageRegistry } from '../src/vs-images/VsImageRegistry.js';
import { VsRuntimeImageRepository } from '../src/repository/VsRuntimeImageRepository.js';
import { VsImageResolutionCache } from '../src/vs-images/VsImageResolutionCache.js';
import { vsProductApi } from '../src/api/vsProductApi.js';

const row = (barcode, style, color, stock = 1, overrides = {}) => ({
  CODBARRAS: barcode, STYLE: style, COLOR: color, STOCK: stock,
  departamento: 'APPAREL', seccion: 'TOPS', familia: 'PINK', ...overrides
});
const exact = (image, imageSource = 'current') => ({ image, imageSource });
const response = () => {
  const result = { status: null, body: '' };
  return { result, writeHead(status) { result.status = status; }, end(body = '') { result.body = body; } };
};

test('registry bootstrapa exactas, conserva estados históricos y persiste solo identidad visual', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vs-image-registry-'));
  try {
    const file = path.join(dir, 'registry.json');
    let tick = 0;
    const registry = new VsImageRegistry(file, { now: () => `2026-01-01T00:00:0${++tick}.000Z` }).load();
    const known = row('1001', '11254917', '6G3I', 3);
    const missing = row('1002', '11254917', '54A2', 2);
    const invalid = row('1003', 'STYLE', 'BAD', 5);
    registry.reconcile([known, missing, invalid], item => item.CODBARRAS === '1001' ? exact('https://example.test/known.jpg', 'vs-malta') : null);
    assert.equal(registry.entries.size, 2);
    assert.deepEqual(registry.entries.get('11254917-6G3I').barcodes, ['1001']);
    assert.equal(registry.entries.get('11254917-6G3I').status, 'MATCHED_SAFE');
    assert.equal(registry.entries.get('11254917-54A2').status, 'PENDING');
    assert.equal(registry.summary().matchedSafe, 1);
    assert.equal(registry.summary().pending, 1);
    const persisted = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(persisted.version, 1);
    assert.equal(JSON.stringify(persisted).includes('stockActualTotal'), false);
    assert.equal(JSON.stringify(persisted).includes('"STOCK"'), false);

    // Una talla nueva comparte identidad segura y no abre trabajo nuevo.
    registry.reconcile([known, { ...known, CODBARRAS: '1004', TALLA: '36C' }, missing], item => item.STYLE === '11254917' && item.COLOR === '6G3I' ? exact('https://example.test/known.jpg', 'vs-malta') : null);
    assert.equal(registry.entries.size, 2);
    assert.deepEqual(registry.entries.get('11254917-6G3I').barcodes, ['1001', '1004']);

    // Un color o STYLE nuevos generan una identidad PENDING distinta aunque el color ya exista.
    registry.reconcile([known, missing, row('1005', '11254917', '58KG'), row('1006', '11299999', '54A2')], item => item.STYLE === '11254917' && item.COLOR === '6G3I' ? exact('https://example.test/known.jpg') : null);
    assert.equal(registry.entries.get('11254917-58KG').status, 'PENDING');
    assert.equal(registry.entries.get('11299999-54A2').status, 'PENDING');

    // Estados no seguros y una identidad que desaparece permanecen sin degradar MATCHED_SAFE.
    registry.entries.get('11254917-54A2').status = 'NO_MATCH';
    registry.entries.set('11250000-1ABC', { style: '11250000', color: '1ABC', status: 'REQUEST_ERROR', firstSeenAt: 'old', lastSeenAt: 'old', lastCheckedAt: 'old', barcodes: [] });
    registry.entries.set('11250001-2ABC', { style: '11250001', color: '2ABC', status: 'IDENTITY_CONFLICT', firstSeenAt: 'old', lastSeenAt: 'old', lastCheckedAt: 'old', barcodes: [] });
    registry.reconcile([known], item => exact('https://example.test/known.jpg'));
    assert.equal(registry.entries.get('11254917-6G3I').status, 'MATCHED_SAFE');
    assert.equal(registry.entries.get('11254917-54A2').status, 'NO_MATCH');
    assert.equal(registry.entries.get('11250000-1ABC').status, 'REQUEST_ERROR');
    assert.equal(registry.entries.get('11250001-2ABC').status, 'IDENTITY_CONFLICT');
    assert.ok(registry.entries.has('11299999-54A2'));

    const reloaded = new VsImageRegistry(file).load();
    assert.equal(reloaded.entries.get('11254917-6G3I').status, 'MATCHED_SAFE');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('registry acepta bootstrap y runtime MATCHED_SAFE, pero nunca referencias visuales', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vs-image-registry-runtime-'));
  try {
    const rows = [row('2001', '11240001', '0LOW'), row('2002', '11240002', '58KG'), row('2003', '11240003', '5TRG'), row('2004', '11240004', '6G3I')];
    const base = {
      rows,
      toPublicRow(item) {
        if (item.CODBARRAS === '2001') return { ...item, ...exact('https://example.test/bootstrap.jpg', 'current') };
        if (item.CODBARRAS === '2003') return { ...item, image: 'https://example.test/reference.jpg', imageSource: 'same-style-reference', imageIsReference: true };
        return { ...item, image: null, imageSource: null };
      },
      async findByBarcode(barcode) { return this.toPublicRow(rows.find(item => item.CODBARRAS === barcode)); },
      async findByReference() { return []; }, async findByIdentity() { return []; },
      async findByStyle(style) { return rows.filter(item => item.STYLE === style).map(item => this.toPublicRow(item)); },
      async findByStyleColor(style, color) { return rows.filter(item => item.STYLE === style && item.COLOR === color).map(item => this.toPublicRow(item)); },
      searchCatalog() { return { items: [], total: 0, offset: 0, limit: 50, hasMore: false, facets: {} }; }, catalogFacets() { return {}; }, metrics() { return {}; }
    };
    const cache = new VsImageResolutionCache();
    cache.set('11240002-58KG', { status: 'MATCHED_SAFE', checkedProviders: ['vs-romania'], imageUrl: 'https://example.test/runtime.jpg', source: 'vs-romania-runtime' });
    const registry = new VsImageRegistry(path.join(dir, 'registry.json'));
    new VsRuntimeImageRepository(base, cache, registry);
    assert.equal(registry.entries.get('11240001-0LOW').status, 'MATCHED_SAFE');
    assert.equal(registry.entries.get('11240002-58KG').source, 'vs-romania-runtime');
    assert.equal(registry.entries.get('11240003-5TRG').status, 'PENDING');
    assert.equal(registry.entries.get('11240004-6G3I').status, 'PENDING');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('API separa cobertura por barcode y registry, y ordena pendientes por stock actual', async () => {
  const registry = new VsImageRegistry(null, { now: () => '2026-01-01T00:00:00.000Z' });
  registry.reconcile([row('3001', '11250001', '1ABC', 2), row('3002', '11250002', '2ABC', 9), row('3003', '11250003', '3ABC', 9)], () => null);
  const service = { imageCoverage: () => registry.coverage(), imageCoveragePending: () => registry.pending() };
  const api = vsProductApi(service);
  let res = response(); await api({ url: '/api/vs/image-coverage' }, res);
  assert.equal(res.result.status, 200);
  const coverage = JSON.parse(res.result.body);
  assert.equal(coverage.inventory.barcodesInStock, 3);
  assert.equal(coverage.inventory.barcodesWithExactImage, 0);
  assert.equal(coverage.registry.validStyleColorsInStock, 3);
  assert.deepEqual(coverage.unregistrable, { barcodes: 0, withExactImage: 0, withoutExactImage: 0 });
  res = response(); await api({ url: '/api/vs/image-coverage/pending' }, res);
  const items = JSON.parse(res.result.body).items;
  assert.deepEqual(items.map(item => item.STYLE), ['11250002', '11250003', '11250001']);
  assert.equal(items[0].stockActualTotal, 9);
});
