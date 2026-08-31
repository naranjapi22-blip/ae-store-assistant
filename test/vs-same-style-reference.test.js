import test from 'node:test';
import assert from 'node:assert/strict';
import { VsRuntimeImageRepository } from '../src/repository/VsRuntimeImageRepository.js';
import { VsProductService } from '../src/service/VsProductService.js';

const makeRow = ({ barcode, color, image = null, imageSource = null, department = 'APPAREL', size = 'M' }) => ({
  CODBARRAS: barcode,
  REFPROVEEDOR: `REF-${barcode}`,
  STYLE: '11249650',
  COLOR: color,
  DESCRIPCION: 'Synthetic VS product',
  TALLA: size,
  STOCK: 1,
  TEMPORADA: 'FA2026',
  departamento: department,
  seccion: 'TOPS',
  familia: 'PINK',
  subfamilia: 'TEE',
  styleColorKey: `11249650|${color}`,
  image,
  imageSource
});

class FakeRepository {
  constructor(rows) { this.rows = rows; }
  toPublicRow(row) { return { ...row }; }
  async findByBarcode(barcode) { return this.rows.find(row => row.CODBARRAS === barcode) ? { ...this.rows.find(row => row.CODBARRAS === barcode) } : null; }
  async findByReference(reference) { return this.rows.filter(row => row.REFPROVEEDOR === reference).map(row => ({ ...row })); }
  async findByIdentity() { return []; }
  async findByStyle(style) { return this.rows.filter(row => row.STYLE === style).map(row => ({ ...row })); }
  async findByStyleColor(style, color) { return this.rows.filter(row => row.STYLE === style && row.COLOR === color).map(row => ({ ...row })); }
  searchCatalog() {
    const row = this.rows[0];
    return { items: [{ barcode: row.CODBARRAS, style: row.STYLE, color: row.COLOR, department: row.departamento, description: row.DESCRIPCION, stock: row.STOCK, availableSizes: 1, image: row.image, imageSource: row.imageSource }], total: 1, offset: 0, limit: 50, hasMore: false, facets: {} };
  }
  catalogFacets() { return {}; }
  metrics() { return {}; }
}

class FakeCache {
  constructor(entries = {}) { this.entries = entries; }
  get(styleColor) { return this.entries[styleColor] ?? null; }
}

const safeRuntimeEntry = (imageUrl, source = 'vs-romania-runtime') => ({ status: 'MATCHED_SAFE', imageUrl, source });

test('same STYLE uses another exact color only as an explicit visual reference', async () => {
  const target = makeRow({ barcode: '900000000001', color: '3XZR' });
  const alternate = makeRow({ barcode: '900000000002', color: '1ABC', image: 'https://example.test/alternate.jpg', imageSource: 'vs-malta' });
  const repository = new VsRuntimeImageRepository(new FakeRepository([target, alternate]));
  const row = await repository.findByBarcode(target.CODBARRAS);

  assert.equal(row.image, 'https://example.test/alternate.jpg');
  assert.equal(row.imageSource, 'same-style-reference');
  assert.equal(row.imageIsReference, true);
  assert.equal(row.exactImage, false);
  assert.equal(row.requestedColor, '3XZR');
  assert.equal(row.referenceImageColor, '1ABC');
  assert.equal(row.referenceImageSource, 'vs-malta');
});

test('runtime exact image always beats same-style reference', async () => {
  const target = makeRow({ barcode: '900000000001', color: '3XZR' });
  const alternate = makeRow({ barcode: '900000000002', color: '1ABC', image: 'https://example.test/alternate.jpg', imageSource: 'vs-malta' });
  const cache = new FakeCache({ '11249650-3XZR': safeRuntimeEntry('https://example.test/exact.jpg') });
  const repository = new VsRuntimeImageRepository(new FakeRepository([target, alternate]), cache);
  const row = await repository.findByBarcode(target.CODBARRAS);

  assert.equal(row.image, 'https://example.test/exact.jpg');
  assert.equal(row.imageSource, 'vs-romania-runtime');
  assert.equal(row.imageIsReference, undefined);
});

test('runtime exact image from another color can power a reference without chaining references', async () => {
  const target = makeRow({ barcode: '900000000001', color: '3XZR' });
  const alternate = makeRow({ barcode: '900000000002', color: '1ABC' });
  const cache = new FakeCache({ '11249650-1ABC': safeRuntimeEntry('https://example.test/runtime-alternate.jpg') });
  const repository = new VsRuntimeImageRepository(new FakeRepository([target, alternate]), cache);
  const row = await repository.findByBarcode(target.CODBARRAS);

  assert.equal(row.image, 'https://example.test/runtime-alternate.jpg');
  assert.equal(row.imageIsReference, true);
  assert.equal(row.referenceImageSource, 'vs-romania-runtime');
});

test('reference selection is deterministic by alternate color then barcode', async () => {
  const target = makeRow({ barcode: '900000000001', color: '3XZR' });
  const later = makeRow({ barcode: '900000000003', color: '9ZZZ', image: 'https://example.test/later.jpg', imageSource: 'current' });
  const first = makeRow({ barcode: '900000000002', color: '1AAA', image: 'https://example.test/first.jpg', imageSource: 'historical' });
  const repository = new VsRuntimeImageRepository(new FakeRepository([target, later, first]));
  const row = await repository.findByBarcode(target.CODBARRAS);

  assert.equal(row.referenceImageColor, '1AAA');
  assert.equal(row.image, 'https://example.test/first.jpg');
});

test('PERSONALCARE+BEAUTY never receives a same-style reference image', async () => {
  const target = makeRow({ barcode: '900000000001', color: '3XZR', department: 'PERSONALCARE+BEAUTY' });
  const alternate = makeRow({ barcode: '900000000002', color: '1ABC', department: 'PERSONALCARE+BEAUTY', image: 'https://example.test/alternate.jpg', imageSource: 'current' });
  const repository = new VsRuntimeImageRepository(new FakeRepository([target, alternate]));
  const row = await repository.findByBarcode(target.CODBARRAS);

  assert.equal(row.image, null);
  assert.equal(row.imageIsReference, undefined);
});

test('service exposes reference metadata and related-color swatches never borrow reference images', async () => {
  const target = makeRow({ barcode: '900000000001', color: '3XZR' });
  const alternate = makeRow({ barcode: '900000000002', color: '1ABC', image: 'https://example.test/alternate.jpg', imageSource: 'vs-malta' });
  const repository = new VsRuntimeImageRepository(new FakeRepository([target, alternate]));
  const product = await new VsProductService(repository).getProductByBarcode(target.CODBARRAS);

  assert.equal(product.imageIsReference, true);
  assert.equal(product.exactImage, false);
  assert.equal(product.referenceImageColor, '1ABC');
  assert.equal(product.sizes[0].imageIsReference, true);
  assert.equal(product.relatedColors[0].image, 'https://example.test/alternate.jpg');
  assert.equal(product.relatedColors[0].imageSource, 'vs-malta');
});
