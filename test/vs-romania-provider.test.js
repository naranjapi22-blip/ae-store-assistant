import test from 'node:test';
import assert from 'node:assert/strict';
import { RomaniaProvider } from '../src/vs-images/providers/RomaniaProvider.js';

const headers = contentType => ({ get: name => name.toLowerCase() === 'content-type' ? contentType : null });

const makeFetch = ({ items = [], graphqlStatus = 200, imageStatus = 206, imageType = 'image/jpeg' } = {}) => async (url, options = {}) => {
  if (String(url).endsWith('/graphql')) return {
    ok: graphqlStatus >= 200 && graphqlStatus < 300,
    status: graphqlStatus,
    json: async () => ({ data: { products: { items } } })
  };
  return { ok: imageStatus >= 200 && imageStatus < 300, status: imageStatus, headers: headers(imageType) };
};

test('RomaniaProvider returns MATCHED_SAFE only for exact SKU image', async () => {
  const imageUrl = 'https://media.victoriassecret.ro/catalog/112496503XZR_OF_F.jpg';
  const provider = new RomaniaProvider({ fetchImpl: makeFetch({ items: [{ sku: '112496503XZR', image: { url: imageUrl }, media_gallery: [] }] }) });
  const result = await provider.resolve({ styleColor: '11249650-3XZR' });
  assert.deepEqual(result, { status: 'MATCHED_SAFE', imageUrl, source: 'vs-romania-runtime', remoteSku: '112496503XZR' });
});

test('RomaniaProvider rejects wrong SKU, missing image and invalid identity', async () => {
  const wrong = new RomaniaProvider({ fetchImpl: makeFetch({ items: [{ sku: '11249650ZZZZ', image: { url: 'https://media.victoriassecret.ro/11249650ZZZZ.jpg' } }] }) });
  assert.equal((await wrong.resolve({ styleColor: '11249650-3XZR' })).status, 'IDENTITY_CONFLICT');

  const missing = new RomaniaProvider({ fetchImpl: makeFetch({ items: [] }) });
  assert.equal((await missing.resolve({ styleColor: '11249650-3XZR' })).status, 'NO_MATCH');
  assert.equal((await missing.resolve({ styleColor: 'bad' })).status, 'IDENTITY_CONFLICT');
});

test('RomaniaProvider treats network and MIME failures conservatively', async () => {
  const network = new RomaniaProvider({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await network.resolve({ styleColor: '11249650-3XZR' })).status, 'REQUEST_ERROR');

  const imageUrl = 'https://media.victoriassecret.ro/catalog/112496503XZR_OF_F.jpg';
  const invalidMime = new RomaniaProvider({ fetchImpl: makeFetch({ items: [{ sku: '112496503XZR', image: { url: imageUrl } }], imageType: 'text/html' }) });
  assert.equal((await invalidMime.resolve({ styleColor: '11249650-3XZR' })).status, 'NO_MATCH');
});
