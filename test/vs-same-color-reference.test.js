import test from 'node:test';
import assert from 'node:assert/strict';
import { VsRuntimeImageRepository } from '../src/repository/VsRuntimeImageRepository.js';
import { VsProductService } from '../src/service/VsProductService.js';

const makeRow = ({ barcode, style = '11240000', color = '4RHY', image = null, imageSource = null, department = 'INTIMATE APPAREL', section = 'BRAS', family = 'T-SHIRT' }) => ({
  CODBARRAS: barcode, REFPROVEEDOR: `REF-${barcode}`, STYLE: style, COLOR: color, DESCRIPCION: `Product ${barcode}`,
  TALLA: 'M', STOCK: 1, TEMPORADA: 'FA2026', departamento: department, seccion: section, familia: family,
  subfamilia: 'TEST', styleColorKey: `${style}|${color}`, image, imageSource
});

class FakeRepository {
  constructor(rows) { this.rows = rows; }
  toPublicRow(row) { return { ...row }; }
  async findByBarcode(barcode) { const row = this.rows.find(item => item.CODBARRAS === barcode); return row ? { ...row } : null; }
  async findByReference(reference) { return this.rows.filter(row => row.REFPROVEEDOR === reference).map(row => ({ ...row })); }
  async findByIdentity() { return []; }
  async findByStyle(style) { return this.rows.filter(row => row.STYLE === style).map(row => ({ ...row })); }
  async findByStyleColor(style, color) { return this.rows.filter(row => row.STYLE === style && row.COLOR === color).map(row => ({ ...row })); }
  searchCatalog() { const row = this.rows[0]; return { items: [{ barcode: row.CODBARRAS, style: row.STYLE, color: row.COLOR, department: row.departamento, section: row.seccion, family: row.familia, description: row.DESCRIPCION, stock: 1, availableSizes: 1, image: row.image, imageSource: row.imageSource }], total: 1, offset: 0, limit: 50, hasMore: false, facets: {} }; }
  catalogFacets() { return {}; }
  metrics() { return {}; }
}
class FakeCache { constructor(entries = {}) { this.entries = entries; } get(key) { return this.entries[key] ?? null; } }
const runtimeSafe = (url, source = 'vs-romania-runtime') => ({ status: 'MATCHED_SAFE', imageUrl: url, source });
const runtime = (rows, cache = {}) => new VsRuntimeImageRepository(new FakeRepository(rows), new FakeCache(cache));

test('same-color preserves exact candidate identity, original source, and never replaces product.image', async () => {
  const target = makeRow({ barcode: '1', image: null });
  const candidate = makeRow({ barcode: '2', style: '11240001', image: 'https://example.test/color.jpg', imageSource: 'vs-romania' });
  const row = await runtime([target, candidate]).findByBarcode('1');
  assert.equal(row.image, null); assert.equal(row.colorReference.image, 'https://example.test/color.jpg');
  assert.equal(row.colorReference.imageSource, 'vs-romania'); assert.equal(row.colorReference.color, target.COLOR);
  assert.notEqual(row.colorReference.style, target.STYLE); assert.equal(row.colorReference.referenceType, 'same-color');
});

test('same-style can coexist with same-color, but never feeds it', async () => {
  const target = makeRow({ barcode: '1', color: '4RHY' });
  const model = makeRow({ barcode: '2', style: '11240000', color: '1ABC', image: 'https://example.test/model.jpg', imageSource: 'vs-malta' });
  const color = makeRow({ barcode: '3', style: '11240001', color: '4RHY', image: 'https://example.test/color.jpg', imageSource: 'current' });
  const row = await runtime([target, model, color]).findByBarcode('1');
  assert.equal(row.imageSource, 'same-style-reference'); assert.equal(row.image, 'https://example.test/model.jpg');
  assert.equal(row.colorReference.barcode, '3'); assert.equal(row.colorReference.image, 'https://example.test/color.jpg');
});

test('a same-color reference never becomes a candidate for another reference', async () => {
  const target = makeRow({ barcode: '1', style: '11240000' });
  const referencedOnly = makeRow({ barcode: '2', style: '11240001' });
  const modelExact = makeRow({ barcode: '3', style: '11240001', color: '1ABC', image: 'https://example.test/model.jpg', imageSource: 'current' });
  const repository = runtime([target, referencedOnly, modelExact]);
  const referenced = await repository.findByBarcode('2');
  assert.equal(referenced.imageSource, 'same-style-reference');
  assert.equal((await repository.findByBarcode('1')).colorReference, null);
});

test('exact image wins and receives no visual references', async () => {
  const exact = makeRow({ barcode: '1', image: 'https://example.test/exact.jpg', imageSource: 'current' });
  const candidate = makeRow({ barcode: '2', style: '11240001', image: 'https://example.test/color.jpg', imageSource: 'vs-malta' });
  const row = await runtime([exact, candidate]).findByBarcode('1');
  assert.equal(row.image, 'https://example.test/exact.jpg'); assert.equal(row.imageSource, 'current'); assert.equal(row.colorReference, null);
});

test('candidate priority is family, then section, then department, with deterministic source/style/barcode ordering', async () => {
  const target = makeRow({ barcode: '1' });
  const department = makeRow({ barcode: '2', style: '11240005', image: 'https://example.test/dept.jpg', imageSource: 'current', section: 'PANTIES', family: 'OTHER' });
  const section = makeRow({ barcode: '3', style: '11240004', image: 'https://example.test/section.jpg', imageSource: 'current', family: 'OTHER' });
  const familyHistorical = makeRow({ barcode: '4', style: '11240003', image: 'https://example.test/family-old.jpg', imageSource: 'historical' });
  const familyCurrentLaterStyle = makeRow({ barcode: '5', style: '11240002', image: 'https://example.test/family-current.jpg', imageSource: 'current' });
  const familyCurrentEarlierBarcode = makeRow({ barcode: '0', style: '11240002', image: 'https://example.test/family-current-first.jpg', imageSource: 'current' });
  const row = await runtime([target, department, section, familyHistorical, familyCurrentLaterStyle, familyCurrentEarlierBarcode]).findByBarcode('1');
  assert.equal(row.colorReference.barcode, '0'); assert.equal(row.colorReference.imageSource, 'current');
});

test('same-color never crosses departments and excludes PERSONALCARE+BEAUTY and SUPPLIES as targets or candidates', async () => {
  const target = makeRow({ barcode: '1', department: 'APPAREL' });
  const otherDepartment = makeRow({ barcode: '2', style: '11240001', department: 'INTIMATE APPAREL', image: 'https://example.test/other.jpg', imageSource: 'current' });
  const beautyTarget = makeRow({ barcode: '3', style: '11240002', department: 'PERSONALCARE+BEAUTY' });
  const suppliesTarget = makeRow({ barcode: '4', style: '11240003', department: 'SUPPLIES' });
  const beautyCandidate = makeRow({ barcode: '5', style: '11240004', department: 'PERSONALCARE+BEAUTY', image: 'https://example.test/beauty.jpg', imageSource: 'current' });
  const suppliesCandidate = makeRow({ barcode: '6', style: '11240005', department: 'SUPPLIES', image: 'https://example.test/supplies.jpg', imageSource: 'current' });
  const repository = runtime([target, otherDepartment, beautyTarget, suppliesTarget, beautyCandidate, suppliesCandidate]);
  assert.equal((await repository.findByBarcode('1')).colorReference, null);
  assert.equal((await repository.findByBarcode('3')).colorReference, null);
  assert.equal((await repository.findByBarcode('4')).colorReference, null);
});

test('supplemental-safe and runtime MATCHED_SAFE can be exact same-color candidates without chaining', async () => {
  const target = makeRow({ barcode: '1' });
  const supplemental = makeRow({ barcode: '2', style: '11240001', image: 'https://example.test/supplemental.jpg', imageSource: 'vs-supplemental-safe:vs-mexico' });
  const runtimeCandidate = makeRow({ barcode: '3', style: '11240002', image: null });
  const repository = runtime([target, supplemental, runtimeCandidate], { '11240002-4RHY': runtimeSafe('https://example.test/runtime.jpg') });
  const row = await repository.findByBarcode('1');
  assert.equal(row.colorReference.imageSource, 'vs-supplemental-safe:vs-mexico');
  const onlyRuntime = runtime([target, runtimeCandidate], { '11240002-4RHY': runtimeSafe('https://example.test/runtime.jpg') });
  assert.equal((await onlyRuntime.findByBarcode('1')).colorReference.imageSource, 'vs-romania-runtime');
});

test('service exposes colorReference independently for product and selected size', async () => {
  const target = makeRow({ barcode: '1' }); const color = makeRow({ barcode: '2', style: '11240001', image: 'https://example.test/color.jpg', imageSource: 'vs-india' });
  const product = await new VsProductService(runtime([target, color])).getProductByBarcode('1');
  assert.equal(product.image, null); assert.equal(product.colorReference.imageSource, 'vs-india');
  assert.equal(product.sizes[0].colorReference.barcode, '2');
});
