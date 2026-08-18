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
    const stock = path.join(dir, 'stock.xlsx'); const catalog = path.join(dir, 'catalog.json'); const historical = path.join(dir, 'historical.json');
    writeBook(stock, rows);
    await writeCatalog(catalog, [
      { CODBARRAS: '199294268699', clasificacion: 'MATCH_COLOR_ACTUAL', image_url_final: '', image_http_status: '', genericId: 'g1', choice_final: 'c1' },
      { CODBARRAS: '199294304984', clasificacion: 'MATCH_COLOR_ACTUAL', image_url_final: 'https://example.test/vs.jpg', image_http_status: 200, genericId: 'g1', choice_final: 'c1' },
      { CODBARRAS: '199294399999', clasificacion: 'SIN_COLOR_ACTUAL', image_url_final: '', image_http_status: '', genericId: 'g1', choice_final: '' },
      { CODBARRAS: '667560045416', clasificacion: 'SIN_COLOR_ACTUAL', image_url_final: '', image_http_status: '', genericId: 'g1', choice_final: '' }
    ]);
    await writeCatalog(historical, [
      { CODBARRAS: '199294268699', clasificacion: 'SIN_ASSET', image_url_historica: 'https://example.test/rejected.jpg', http_status: 200 },
      { CODBARRAS: '199294304984', clasificacion: 'HISTORICA_RECUPERADA', image_url_historica: 'https://example.test/old.jpg', http_status: 200 },
      { CODBARRAS: '199294399999', clasificacion: 'HISTORICA_RECUPERADA', image_url_historica: 'https://example.test/historical.jpg', http_status: 200 },
      { CODBARRAS: '667560045416', clasificacion: 'SIN_IMAGEN_PRINCIPAL', image_url_historica: 'https://example.test/excluded.jpg', http_status: 200 }
    ]);
    const repository = new VsExcelProductRepository(stock, { imageCatalogFilePath: catalog, historicalImageFilePath: historical }); const service = new VsProductService(repository);
    const product = await service.getProductByBarcode('199294268699');
    assert.equal(product.image, null); assert.equal((await repository.findByBarcode('199294268699')).imageSource, null); assert.equal(product.stock, 1); assert.deepEqual(product.sizes.map(item => item.size), ['XS', 'MED']);
    assert.equal(Object.hasOwn(product, 'COSTESTOCK'), false); assert.equal(Object.hasOwn(product, 'COSTO_TOTAL'), false);
    const current = await service.getProductByBarcode('199294304984');
    assert.equal(current.image, 'https://example.test/vs.jpg'); assert.equal((await repository.findByBarcode('199294304984')).imageSource, 'current');
    const historicalProduct = await service.getProductByBarcode('199294399999');
    assert.equal(historicalProduct.image, 'https://example.test/historical.jpg'); assert.equal((await repository.findByBarcode('199294399999')).imageSource, 'historical');
    assert.equal((await service.getProductByBarcode('667560045416')).image, null);
    assert.equal(repository.metrics().barcodesIndexed, 4); assert.equal(repository.metrics().currentImagesLoaded, 1);
    assert.equal(repository.metrics().historicalImagesLoaded, 1); assert.equal(repository.metrics().imagesLoaded, 2); assert.equal(repository.metrics().reliableImagesLoaded, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const realStock = path.resolve('..', 'VSImageTest', 'Stock de Histria Julio.xlsx');
const realCatalog = path.resolve('..', 'VSImageTest', 'catalogo_actual_vs_resultados.json');
const realHistorical = path.resolve('..', 'VSImageTest', 'historico_vs_resultados.json');
test('el Excel real solo indexa los 2638 barcodes vendibles', { skip: !existsSync(realStock) || !existsSync(realCatalog) || !existsSync(realHistorical) }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCatalogFilePath: realCatalog, historicalImageFilePath: realHistorical });
  assert.equal(repository.metrics().barcodesIndexed, 2638); assert.equal(repository.metrics().currentImagesLoaded, 972); assert.equal(repository.metrics().historicalImagesLoaded, 213); assert.equal(repository.metrics().imagesLoaded, 1185); assert.equal(await repository.findByBarcode('198765087685'), null);
});
test('el catálogo actual controla imágenes y no propaga choices históricas', { skip: !existsSync(realStock) || !existsSync(realCatalog) }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCatalogFilePath: realCatalog, historicalImageFilePath: realHistorical }); const service = new VsProductService(repository);
  const sugar = await service.getProductByBarcode('667555917612'); assert.equal(sugar.image, null); assert.equal(sugar.stock, 16);
  const safe = await service.getProductByBarcode('667559793106'); assert.match(safe.image, /1124980554A2_OM_F\.jpg$/); assert.equal((await repository.findByBarcode('667559793106')).imageSource, 'current'); assert.equal(safe.performance.imagesLoaded, 1185);
  const historical = await service.getProductByBarcode('667558437643'); assert.match(historical.image, /112285048527_OM_F\.jpg$/); assert.equal((await repository.findByBarcode('667558437643')).imageSource, 'historical');
  const historical2 = await service.getProductByBarcode('197575132165'); assert.match(historical2.image, /112591086579_OM_F\.jpg$/); assert.equal((await repository.findByBarcode('197575132165')).imageSource, 'historical');
  const historical3 = await service.getProductByBarcode('667560488268'); assert.match(historical3.image, /112514226AZM_OM_F2\.jpg$/); assert.equal((await repository.findByBarcode('667560488268')).imageSource, 'historical');
  const historical4 = await service.getProductByBarcode('667558466582'); assert.match(historical4.image, /1122751333F6_OF_F\.jpg$/); assert.equal((await repository.findByBarcode('667558466582')).imageSource, 'historical');
  const noPrincipal = await service.getProductByBarcode('197575053408'); assert.equal(noPrincipal.image, null);
});
test('controles por BRAS, PANTIES, FRAGRANCE y ACCESSORIES tienen imagen actual', { skip: !existsSync(realStock) || !existsSync(realCatalog) }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCatalogFilePath: realCatalog, historicalImageFilePath: realHistorical }); const service = new VsProductService(repository);
  const catalog = JSON.parse(await readFile(realCatalog, 'utf8')).rows;
  const categories = { BRAS: row => /BRAS/i.test(row.seccion || ''), PANTIES: row => /PANTIES/i.test(row.seccion || ''), FRAGRANCE: row => /FRAGRANCE/i.test(`${row.departamento} ${row.seccion} ${row.familia}`), ACCESSORIES: row => /ACCESSORIES/i.test(row.departamento || '') };
  for (const [name, predicate] of Object.entries(categories)) { const row = catalog.find(item => item.clasificacion === 'MATCH_COLOR_ACTUAL' && predicate(item)); assert.ok(row, `no se encontró control ${name}`); assert.ok((await service.getProductByBarcode(row.CODBARRAS))?.image, `${name} no obtuvo imagen`); }
});
test('VS API returns product and 404 for unknown barcode', async () => {
  const api = vsProductApi({ getProductByBarcode: async barcode => barcode === '123' ? { barcode } : null });
  const call = async url => { const result = { status: null, body: '' }; const response = { writeHead(status) { result.status = status; }, setHeader() {}, end(body = '') { result.body = body; } }; await api({ url }, response); return { ...result, json: JSON.parse(result.body) }; };
  assert.equal((await call('/api/vs/products/123')).status, 200); assert.equal((await call('/api/vs/products/999')).status, 404);
});
