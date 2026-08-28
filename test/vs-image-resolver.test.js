import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { VsImageResolutionCache } from '../src/vs-images/VsImageResolutionCache.js';
import { VsImageResolver } from '../src/vs-images/VsImageResolver.js';

const row = (barcode, style, color, image = null) => ({ CODBARRAS: barcode, STYLE: style, COLOR: color, image });

const repository = rows => ({
  rows,
  imageFor(item) { return { image: item.image ?? null, source: item.image ? 'current' : null }; }
});

test('VsImageResolver deduplicates missing variants and persists safe result', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vs-resolver-'));
  try {
    const cache = new VsImageResolutionCache(path.join(dir, 'cache.json')).load();
    const seen = [];
    const provider = {
      name: 'vs-romania',
      async resolve(candidate) {
        seen.push(candidate.styleColor);
        return { status: 'MATCHED_SAFE', imageUrl: `https://example.test/${candidate.styleColor}.jpg`, source: 'vs-romania-runtime', remoteSku: candidate.styleColor.replace('-', '') };
      }
    };
    const base = repository([
      row('1', '11249650', '3XZR'),
      row('2', '11249650', '3XZR'),
      row('3', '11249651', '3XZS', 'https://example.test/current.jpg')
    ]);
    const resolver = new VsImageResolver({ repository: base, cache, providers: [provider], concurrency: 1 });
    const summary = await resolver.resolveAll();
    assert.deepEqual(seen, ['11249650-3XZR']);
    assert.equal(summary.total, 1);
    assert.equal(summary.matched, 1);
    assert.equal(cache.get('11249650-3XZR').status, 'MATCHED_SAFE');
    assert.equal(new VsImageResolutionCache(cache.filePath).load().get('11249650-3XZR').source, 'vs-romania-runtime');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('VsImageResolver skips already matched cache and records checked provider', async () => {
  const cache = new VsImageResolutionCache();
  cache.set('11249650-3XZR', { status: 'MATCHED_SAFE', imageUrl: 'https://example.test/already.jpg', source: 'vs-romania-runtime', checkedProviders: ['vs-romania'] });
  let calls = 0;
  const provider = { name: 'vs-romania', async resolve() { calls += 1; return { status: 'NO_MATCH' }; } };
  const resolver = new VsImageResolver({ repository: repository([row('1', '11249650', '3XZR')]), cache, providers: [provider] });
  const summary = await resolver.resolveAll();
  assert.equal(calls, 0);
  assert.equal(summary.skipped, 1);
});

test('VsImageResolver keeps NO_MATCH and REQUEST_ERROR conservative', async () => {
  const cache = new VsImageResolutionCache();
  const provider = { name: 'vs-romania', async resolve(candidate) { return { status: candidate.color === 'AAAA' ? 'NO_MATCH' : 'REQUEST_ERROR' }; } };
  const resolver = new VsImageResolver({ repository: repository([row('1', '11249650', 'AAAA'), row('2', '11249651', 'BBBB')]), cache, providers: [provider], concurrency: 2 });
  const summary = await resolver.resolveAll();
  assert.equal(summary.noMatch, 1);
  assert.equal(summary.requestError, 1);
  assert.deepEqual(cache.get('11249650-AAAA').checkedProviders, ['vs-romania']);
  assert.deepEqual(cache.get('11249651-BBBB').checkedProviders, ['vs-romania']);
});
