import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { VsImageResolutionCache } from '../src/vs-images/VsImageResolutionCache.js';

const matched = overrides => ({
  status: 'MATCHED_SAFE',
  checkedProviders: ['vs-romania'],
  imageUrl: 'https://example.test/image.jpg',
  source: 'vs-romania-runtime',
  remoteSku: '112496503XZR',
  ...overrides
});

test('VS image cache tolerates missing, empty and corrupt files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vs-image-cache-'));
  try {
    const missing = path.join(dir, 'missing.json');
    assert.equal(new VsImageResolutionCache(missing).load().size, 0);

    const empty = path.join(dir, 'empty.json');
    await writeFile(empty, '', 'utf8');
    assert.equal(new VsImageResolutionCache(empty).load().size, 0);

    const corrupt = path.join(dir, 'corrupt.json');
    await writeFile(corrupt, '{broken', 'utf8');
    assert.equal(new VsImageResolutionCache(corrupt).load().size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('VS image cache stores safe matches and strips unsafe-only fields', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vs-image-cache-'));
  try {
    const file = path.join(dir, 'cache.json');
    const cache = new VsImageResolutionCache(file);
    assert.equal(cache.set('11249650-3xzr', matched()), true);
    assert.equal(cache.set('11249651-AB12', {
      status: 'NO_MATCH',
      checkedProviders: ['vs-romania'],
      imageUrl: 'https://example.test/should-not-save.jpg',
      source: 'should-not-save',
      remoteSku: 'should-not-save'
    }), true);
    assert.equal(cache.set('11249652-CD34', { status: 'REQUEST_ERROR', checkedProviders: ['vs-romania'] }), true);
    assert.equal(cache.set('11249653-EF56', { status: 'IDENTITY_CONFLICT', checkedProviders: ['vs-romania'] }), true);
    assert.equal(cache.get('11249650-3XZR').imageUrl, 'https://example.test/image.jpg');
    assert.equal(cache.get('11249651-AB12').imageUrl, undefined);
    assert.equal(cache.get('11249651-AB12').source, undefined);
    assert.equal(cache.get('11249651-AB12').remoteSku, undefined);
    assert.equal(cache.save(), true);

    const reopened = new VsImageResolutionCache(file).load();
    assert.equal(reopened.size, 4);
    assert.equal(reopened.get('11249650-3xzr').status, 'MATCHED_SAFE');
    assert.equal(reopened.get('11249652-CD34').status, 'REQUEST_ERROR');
    assert.equal(reopened.get('11249653-EF56').status, 'IDENTITY_CONFLICT');

    const persisted = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(persisted.version, 1);
    assert.equal(persisted.entries['11249651-AB12'].imageUrl, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('VS image cache rejects invalid safe entries and can retain an explicit universe', () => {
  const cache = new VsImageResolutionCache();
  assert.equal(cache.set('11249650-3XZR', matched()), true);
  assert.equal(cache.set('11249651-AB12', matched({ imageUrl: 'not-a-url' })), false);
  assert.equal(cache.set('11249652-CD34', matched({ source: '' })), false);
  assert.equal(cache.set('bad-key', matched()), false);
  cache.set('11249653-EF56', { status: 'NO_MATCH', checkedProviders: ['vs-romania'] });
  cache.retain(['11249650-3XZR']);
  assert.equal(cache.size, 1);
  assert.ok(cache.get('11249650-3XZR'));
  assert.equal(cache.get('11249653-EF56'), null);
});
