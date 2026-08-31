import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { VsImageRegistry } from '../src/vs-images/VsImageRegistry.js';
import { createRetryPolicy, retryReason } from '../src/vs-images/VsImageRetryPolicy.js';
import { VsImageResolutionCache } from '../src/vs-images/VsImageResolutionCache.js';
import { VsPendingImageResolver } from '../src/vs-images/VsPendingImageResolver.js';

const row = { CODBARRAS: '1', STYLE: '11250001', COLOR: '1ABC', STOCK: 5, departamento: 'APPAREL', seccion: 'TOPS', familia: 'PINK' };
const t0 = Date.parse('2026-01-01T00:00:00.000Z');
const iso = ms => new Date(ms).toISOString();

test('retry policy makes new NO_MATCH actionable after 24h, then applies age tiers', () => {
  let now = t0;
  const registry = new VsImageRegistry(null, { now: () => iso(now) });
  registry.reconcile([row], () => null);
  assert.equal(registry.pendingEntries({ availableProviders: ['vs-romania'] }).length, 1);
  registry.recordResolution('11250001-1ABC', { status: 'NO_MATCH', providerName: 'vs-romania', checkedProviders: ['vs-romania'] });
  assert.equal(registry.pendingEntries({ availableProviders: ['vs-romania'] }).length, 0);
  now += 23 * 3600000;
  assert.equal(registry.pendingEntries({ availableProviders: ['vs-romania'] }).length, 0);
  now += 3600000;
  assert.equal(registry.pendingEntries({ availableProviders: ['vs-romania'] }).length, 1);
  registry.recordResolution('11250001-1ABC', { status: 'NO_MATCH', providerName: 'vs-romania', checkedProviders: ['vs-romania'] });
  now = t0 + 16 * 86400000 + 72 * 3600000;
  assert.equal(registry.pendingEntries({ availableProviders: ['vs-romania'] }).length, 1);
  const check = registry.entries.get('11250001-1ABC').providerChecks['vs-romania'];
  assert.equal(check.attemptCount, 2);
  assert.equal(check.lastStatus, 'NO_MATCH');
});

test('REQUEST_ERROR retries after one hour, while safe and conflict never retry', () => {
  const policy = createRetryPolicy();
  const base = { firstSeenAt: iso(t0), checkedProviders: ['vs-romania'] };
  assert.equal(retryReason({ entry: { ...base, providerChecks: { 'vs-romania': { lastStatus: 'REQUEST_ERROR', lastCheckedAt: iso(t0), attemptCount: 1 } } }, providerName: 'vs-romania', nowMs: t0 + 59 * 60000, policy }).actionable, false);
  assert.equal(retryReason({ entry: { ...base, providerChecks: { 'vs-romania': { lastStatus: 'REQUEST_ERROR', lastCheckedAt: iso(t0), attemptCount: 1 } } }, providerName: 'vs-romania', nowMs: t0 + 60 * 60000, policy }).reason, 'REQUEST_ERROR_RETRY_DUE');
  for (const status of ['MATCHED_SAFE', 'IDENTITY_CONFLICT']) assert.equal(retryReason({ entry: { ...base, providerChecks: { 'vs-romania': { lastStatus: status, lastCheckedAt: iso(t0), attemptCount: 1 } } }, providerName: 'vs-romania', nowMs: t0 + 365 * 86400000, policy }).actionable, false);
});

test('legacy registry migrates checkedProviders to conservative providerChecks', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vs-retry-legacy-'));
  try {
    const file = path.join(dir, 'registry.json');
    await writeFile(file, JSON.stringify({ version: 1, updatedAt: iso(t0), entries: { '11250001-1ABC': { style: '11250001', color: '1ABC', status: 'PENDING', firstSeenAt: iso(t0), lastCheckedAt: iso(t0), checkedProviders: ['vs-romania'], barcodes: ['1'] } } }));
    const registry = new VsImageRegistry(file, { now: () => iso(t0 + 23 * 3600000) }).load();
    const entry = registry.entries.get('11250001-1ABC');
    assert.equal(entry.providerChecks['vs-romania'].lastStatus, 'NO_MATCH');
    assert.equal(registry.pendingEntries({ availableProviders: ['vs-romania'] }).length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('coverage and dry-run expose retry metrics and reasons', () => {
  let now = t0; const registry = new VsImageRegistry(null, { now: () => iso(now) }); registry.reconcile([row], () => null);
  registry.recordResolution('11250001-1ABC', { status: 'REQUEST_ERROR', providerName: 'vs-romania', checkedProviders: [] });
  let coverage = registry.coverage({ availableProviders: ['vs-romania'] });
  assert.equal(coverage.registry.pending, 0); assert.equal(coverage.registry.requestError, 1); assert.equal(coverage.registry.requestErrorsRetryableNow, 0);
  now += 3600000; coverage = registry.coverage({ availableProviders: ['vs-romania'] }); assert.equal(coverage.registry.requestErrorsRetryableNow, 1); assert.equal(registry.pendingEntries({ availableProviders: ['vs-romania'] })[0].reason, 'REQUEST_ERROR_RETRY_DUE');
});

test('pending resolver reopens a due provider without requiring a scheduler', async () => {
  let now = t0; const registry = new VsImageRegistry(null, { now: () => iso(now) }); registry.reconcile([row], () => null);
  const cache = new VsImageResolutionCache(); const checked = [];
  const pending = new VsPendingImageResolver({ registry, cache, runtimeRepository: { registerRuntimeMatch() {} }, imageResolver: {
    providers: [{ name: 'vs-romania' }],
    async resolveCandidate(candidate, existing) { checked.push(existing.checkedProviders); return { status: 'NO_MATCH', checkedProviders: ['vs-romania'], providerName: 'vs-romania' }; }
  } });
  await pending.runBatch(); assert.equal(checked.length, 1); assert.deepEqual(checked[0], []);
  assert.equal((await pending.runBatch()).processed, 0);
  now += 24 * 3600000; await pending.runBatch();
  assert.equal(checked.length, 2); assert.deepEqual(checked[1], []);
});
