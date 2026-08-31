import test from 'node:test';
import assert from 'node:assert/strict';
import { VsRuntimeImageRepository } from '../src/repository/VsRuntimeImageRepository.js';
import { VsProductService } from '../src/service/VsProductService.js';

const row = (barcode, style, color, image = null, imageSource = null, overrides = {}) => ({
  CODBARRAS: barcode,
  REFPROVEEDOR: `REF-${barcode}`,
  STYLE: style,
  COLOR: color,
  DESCRIPCION: `Product ${style}`,
  TALLA: 'M',
  STOCK: 1,
  departamento: 'APPAREL',
  seccion: 'TOPS',
  familia: 'PINK',
  subfamilia: 'TEE',
  image,
  imageSource,
  ...overrides
});

class CatalogRepository {
  constructor(rows, catalogItems) {
    this.rows = rows;
    this.catalogItems = catalogItems;
    this.byBarcode = new Map(rows.map(item => [item.CODBARRAS, item]));
  }

  toPublicRow(item) { return { ...item }; }
  async findByBarcode(barcode) { return this.toPublicRow(this.byBarcode.get(barcode)); }
  async findByStyle(style) { return this.rows.filter(item => item.STYLE === style).map(item => this.toPublicRow(item)); }
  async findByStyleColor(style, color) { return this.rows.filter(item => item.STYLE === style && item.COLOR === color).map(item => this.toPublicRow(item)); }
  async findByReference() { return []; }
  async findByIdentity() { return []; }
  searchCatalog() { return { items: this.catalogItems.map(item => ({ ...item })), total: this.catalogItems.length, offset: 0, limit: 50, hasMore: false, facets: {} }; }
  catalogFacets() { return {}; }
  metrics() { return {}; }
}

const primaryFields = ['image', 'imageSource', 'exactImage', 'imageIsReference', 'requestedColor', 'referenceImageColor'];

test('cada tarjeta conserva la misma imagen principal y metadata al abrir su barcode', async () => {
  const exactA = 'https://example.test/exact-a.jpg';
  const exactB = 'https://example.test/exact-b.jpg';
  const modelImage = 'https://example.test/model.jpg';
  const colorImage = 'https://example.test/color.jpg';
  const rows = [
    row('EXACT-S', '11200001', '1BLU', null, null, { TALLA: 'S' }),
    row('EXACT-M', '11200001', '1BLU', exactA, 'current', { TALLA: 'M' }),
    row('EXACT-OTHER', '11200002', '1BLU', exactB, 'vs-malta'),
    row('MODEL-TARGET', '11200003', '2PNK'),
    row('MODEL-SOURCE', '11200003', '3BLK', modelImage, 'vs-romania'),
    row('COLOR-TARGET', '11200004', '4RED'),
    row('COLOR-SOURCE', '11200005', '4RED', colorImage, 'current'),
    row('EXACT-COLOR-TARGET', '11200006', '5GRN', exactB, 'historical'),
    row('EXACT-COLOR-SOURCE', '11200007', '5GRN', colorImage, 'current')
  ];
  const catalogItems = [
    // Exacta en una sola talla: la tarjeta ya resuelta debe conservar esa misma fila navegable.
    { barcode: 'EXACT-M', style: '11200001', color: '1BLU', department: 'APPAREL', section: 'TOPS', family: 'PINK', image: exactA, imageSource: 'current' },
    // Dos exactas por barcode: la tarjeta y el detalle deben mantenerse unidos al representante elegido.
    { barcode: 'EXACT-OTHER', style: '11200002', color: '1BLU', department: 'APPAREL', section: 'TOPS', family: 'PINK', image: exactB, imageSource: 'vs-malta' },
    { barcode: 'MODEL-TARGET', style: '11200003', color: '2PNK', department: 'APPAREL', section: 'TOPS', family: 'PINK', image: null, imageSource: null },
    // Sin imagen principal, con colorReference: la principal debe permanecer null.
    { barcode: 'COLOR-TARGET', style: '11200004', color: '4RED', department: 'APPAREL', section: 'TOPS', family: 'PINK', image: null, imageSource: null },
    // Exacta y colorReference: la exacta siempre gana como principal.
    { barcode: 'EXACT-COLOR-TARGET', style: '11200006', color: '5GRN', department: 'APPAREL', section: 'TOPS', family: 'PINK', image: exactB, imageSource: 'historical' }
  ];
  const repository = new VsRuntimeImageRepository(new CatalogRepository(rows, catalogItems));
  const service = new VsProductService(repository);
  const cards = service.searchCatalog().items;

  for (const card of cards) {
    const detail = await service.getProductByBarcode(card.barcode);
    for (const field of primaryFields) assert.equal(card[field] ?? null, detail[field] ?? null, `${card.barcode} ${field}`);
  }

  const colorOnly = cards.find(item => item.barcode === 'COLOR-TARGET');
  assert.equal(colorOnly.image, null);
  assert.equal(colorOnly.colorReference.image, colorImage);
  const exactWithColor = cards.find(item => item.barcode === 'EXACT-COLOR-TARGET');
  assert.equal(exactWithColor.image, exactB);
  assert.equal(exactWithColor.colorReference, null);
});
