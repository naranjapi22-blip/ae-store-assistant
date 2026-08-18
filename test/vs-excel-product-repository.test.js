import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import XLSX from 'xlsx';
import { VsExcelProductRepository } from '../src/repository/VsExcelProductRepository.js';
import { VsProductService } from '../src/service/VsProductService.js';
import { vsProductApi } from '../src/api/vsProductApi.js';

const rows = [
  { CODARTICULO: 1, REFPROVEEDOR: 'VS-001', DESCRIPCION: 'LOUNGE', TEMPORADA: 'FA25', TALLA: 'XS', COLOR: '7LBQ', CODBARRAS: '199294268699', CODBARRAS2: '', CODALMACEN: 'BDV', STOCK: 1, COSTESTOCK: 999, COSTO_TOTAL: 999, departamento: 'INTIMATE APPAREL', seccion: 'BRAS-INTIMATE APPAREL', familia: 'T SHIRT' },
  { CODARTICULO: 2, REFPROVEEDOR: 'VS-001', DESCRIPCION: 'LOUNGE', TEMPORADA: 'FA25', TALLA: 'MED', COLOR: '7LBQ', CODBARRAS: '199294304984', CODBARRAS2: '', CODALMACEN: 'BDV', STOCK: 2, COSTESTOCK: 888, COSTO_TOTAL: 1776, departamento: 'INTIMATE APPAREL', seccion: 'BRAS-INTIMATE APPAREL', familia: 'T SHIRT' },
  { CODARTICULO: 4, REFPROVEEDOR: 'VS-003', DESCRIPCION: 'LOUNGE', TEMPORADA: 'FA25', TALLA: 'XS', COLOR: 'OTHER', CODBARRAS: '199294399999', CODBARRAS2: '', CODALMACEN: 'BDV', STOCK: 5, COSTESTOCK: 777, COSTO_TOTAL: 3885, departamento: 'INTIMATE APPAREL', seccion: 'BRAS-INTIMATE APPAREL', familia: 'T SHIRT' },
  { CODARTICULO: 3, REFPROVEEDOR: 'VS-002', DESCRIPCION: 'THONG', TEMPORADA: '', TALLA: 'NA', COLOR: '34Y5', CODBARRAS: '667560045416', CODBARRAS2: '', CODALMACEN: 'BDV', STOCK: 4, COSTESTOCK: 123, COSTO_TOTAL: 492, departamento: 'INTIMATE APPAREL', seccion: 'PANTIES-INTIMATE APPAREL', familia: 'LACIE' }
];
const writeBook = (file, data) => { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data), 'Hoja1'); XLSX.writeFile(book, file); };
const writeCatalog = (file, data) => writeFile(file, JSON.stringify({ rows: data }), 'utf8');

test('VS repository indexes barcodes, groups sizes, images, and hides costs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vs-poc-'));
  try {
    const stock = path.join(dir, 'stock.xlsx'); const catalog = path.join(dir, 'catalog.json');
    writeBook(stock, rows);
    await writeCatalog(catalog, [
      { CODBARRAS: '199294268699', clasificacion: 'MATCH_COLOR_ACTUAL', image_url_final: '', image_http_status: '', genericId: 'g1', choice_final: 'c1' },
      { CODBARRAS: '199294304984', clasificacion: 'MATCH_COLOR_ACTUAL', image_url_final: 'https://example.test/vs.jpg', image_http_status: 200, genericId: 'g1', choice_final: 'c1' },
      { CODBARRAS: '199294399999', clasificacion: 'SIN_COLOR_ACTUAL', image_url_final: '', image_http_status: '', genericId: 'g1', choice_final: '' }
    ]);
    const repository = new VsExcelProductRepository(stock, { imageCatalogFilePath: catalog }); const service = new VsProductService(repository);
    const product = await service.getProductByBarcode('199294268699');
    assert.equal(product.image, null); assert.equal(product.stock, 1); assert.deepEqual(product.sizes.map(item => item.size), ['XS', 'MED']);
    assert.equal(Object.hasOwn(product, 'COSTESTOCK'), false); assert.equal(Object.hasOwn(product, 'COSTO_TOTAL'), false);
    assert.equal((await service.getProductByBarcode('199294304984')).image, 'https://example.test/vs.jpg');
    assert.equal((await service.getProductByBarcode('199294399999')).image, null); assert.equal(repository.metrics().barcodesIndexed, 4);
    assert.equal(repository.metrics().imagesLoaded, 1); assert.equal(repository.metrics().reliableImagesLoaded, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const realStock = path.resolve('..', 'VSImageTest', 'Stock de Histria Julio.xlsx');
const realCatalog = path.resolve('..', 'VSImageTest', 'catalogo_actual_vs_resultados.json');
test('el Excel real solo indexa los 2638 barcodes vendibles', { skip: !existsSync(realStock) }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCatalogFilePath: realCatalog });
  assert.equal(repository.metrics().barcodesIndexed, 2638); assert.equal(repository.metrics().imagesLoaded, 972); assert.equal(await repository.findByBarcode('198765087685'), null);
});
test('el catálogo actual controla imágenes y no propaga choices históricas', { skip: !existsSync(realStock) || !existsSync(realCatalog) }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCatalogFilePath: realCatalog }); const service = new VsProductService(repository);
  const sugar = await service.getProductByBarcode('667555917612'); assert.equal(sugar.image, null); assert.equal(sugar.stock, 16);
  const safe = await service.getProductByBarcode('667559793106'); assert.match(safe.image, /1124980554A2_OM_F\.jpg$/); assert.equal(safe.performance.imagesLoaded, 972);
});
test('controles por BRAS, PANTIES, FRAGRANCE y ACCESSORIES tienen imagen actual', { skip: !existsSync(realStock) || !existsSync(realCatalog) }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCatalogFilePath: realCatalog }); const service = new VsProductService(repository);
  const catalog = JSON.parse(await readFile(realCatalog, 'utf8')).rows;
  const categories = { BRAS: row => /BRAS/i.test(row.seccion || ''), PANTIES: row => /PANTIES/i.test(row.seccion || ''), FRAGRANCE: row => /FRAGRANCE/i.test(`${row.departamento} ${row.seccion} ${row.familia}`), ACCESSORIES: row => /ACCESSORIES/i.test(row.departamento || '') };
  for (const [name, predicate] of Object.entries(categories)) { const row = catalog.find(item => item.clasificacion === 'MATCH_COLOR_ACTUAL' && predicate(item)); assert.ok(row, `no se encontró control ${name}`); assert.ok((await service.getProductByBarcode(row.CODBARRAS))?.image, `${name} no obtuvo imagen`); }
});
test('VS API returns product and 404 for unknown barcode', async () => {
  const api = vsProductApi({ getProductByBarcode: async barcode => barcode === '123' ? { barcode } : null });
  const call = async url => { const result = { status: null, body: '' }; const response = { writeHead(status) { result.status = status; }, setHeader() {}, end(body = '') { result.body = body; } }; await api({ url }, response); return { ...result, json: JSON.parse(result.body) }; };
  assert.equal((await call('/api/vs/products/123')).status, 200); assert.equal((await call('/api/vs/products/999')).status, 404);
});
