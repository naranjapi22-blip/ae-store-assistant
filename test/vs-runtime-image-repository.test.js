import test from 'node:test';
import assert from 'node:assert/strict';
import { VsRuntimeImageRepository } from '../src/repository/VsRuntimeImageRepository.js';
import { VsImageResolutionCache } from '../src/vs-images/VsImageResolutionCache.js';

const makeRow = overrides => ({
  CODBARRAS: '900000000001',
  REFPROVEEDOR: 'REF-1',
  STYLE: '11249650',
  COLOR: '3XZR',
  DESCRIPCION: 'Synthetic product',
  TALLA: 'M',
  STOCK: 1,
  departamento: 'APPAREL',
  seccion: 'TOPS',
  familia: 'PINK',
  subfamilia: 'TEE',
  image: null,
  imageSource: null,
  ...overrides
});

class FakeRepository {
  constructor(row) { this.row = row; }
  async findByBarcode() { return { ...this.row }; }
  async findByReference() { return [{ ...this.row }]; }
  async findByIdentity() { return [{ ...this.row }]; }
  async findByStyle() { return [{ ...this.row }]; }
  async findByStyleColor() { return [{ ...this.row }]; }
  searchCatalog() {
    return {
      items: [{ barcode: this.row.CODBARRAS, style: this.row.STYLE, color: this.row.COLOR, image: this.row.image, imageSource: this.row.imageSource }],
      total: 1, offset: 0, limit: 50, hasMore: false,
      facets: { departments: ['APPAREL'], sections: ['TOPS'], families: ['PINK'], subfamilies: ['TEE'] }
    };
  }
  catalogFacets() { return { departments: ['APPAREL'], sections: ['TOPS'], families: ['PINK'], subfamilies: ['TEE'] }; }
  metrics() { return { imagesLoaded: this.row.image ? 1 : 0 }; }
}

const addSafe = (cache, overrides = {}) => cache.set('11249650-3XZR', {
  status: 'MATCHED_SAFE',
  checkedProviders: ['vs-romania'],
  imageUrl: 'https://example.test/runtime.jpg',
  source: 'vs-romania-runtime',
  remoteSku: '112496503XZR',
  ...overrides
});

test('runtime cache supplies image only when bootstrap repository has none', async () => {
  const cache = new VsImageResolutionCache();
  addSafe(cache);
  const runtime = new VsRuntimeImageRepository(new FakeRepository(makeRow()), cache);
  const row = await runtime.findByBarcode('900000000001');
  assert.equal(row.image, 'https://example.test/runtime.jpg');
  assert.equal(row.imageSource, 'vs-romania-runtime');
});

test('every bootstrap image source keeps priority over runtime cache', async () => {
  const cache = new VsImageResolutionCache();
  addSafe(cache);
  for (const source of ['current', 'historical', 'style-color', 'vs-cr-refid', 'vs-india', 'vs-malta', 'vs-romania']) {
    const bootstrap = makeRow({ image: `https://example.test/${source}.jpg`, imageSource: source });
    const runtime = new VsRuntimeImageRepository(new FakeRepository(bootstrap), cache);
    const row = await runtime.findByBarcode('900000000001');
    assert.equal(row.image, `https://example.test/${source}.jpg`);
    assert.equal(row.imageSource, source);
  }
});

test('non-safe runtime statuses never produce an image', async () => {
  for (const status of ['NO_MATCH', 'REQUEST_ERROR', 'IDENTITY_CONFLICT']) {
    const cache = new VsImageResolutionCache();
    cache.set('11249650-3XZR', { status, checkedProviders: ['vs-romania'] });
    const runtime = new VsRuntimeImageRepository(new FakeRepository(makeRow()), cache);
    assert.equal((await runtime.findByBarcode('900000000001')).image, null);
  }
});

test('catalog reflects cache updates after startup without rebuilding bootstrap groups', () => {
  const cache = new VsImageResolutionCache();
  const runtime = new VsRuntimeImageRepository(new FakeRepository(makeRow()), cache);
  assert.equal(runtime.searchCatalog().items[0].image, null);
  addSafe(cache);
  const item = runtime.searchCatalog().items[0];
  assert.equal(item.image, 'https://example.test/runtime.jpg');
  assert.equal(item.imageSource, 'vs-romania-runtime');
});
