import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
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

const writeBook = (file, data, sheetName) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data), sheetName);
  XLSX.writeFile(book, file);
};

test('VS repository indexes barcodes, groups sizes, images, and hides costs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vs-poc-'));
  try {
    const stock = path.join(dir, 'stock.xlsx');
    const coverage = path.join(dir, 'coverage.xlsx');
    writeBook(stock, rows, 'Hoja1');
    writeBook(coverage, [
      { CODBARRAS: '199294268699', confidence: 'MEDIA', image_url_confiable: 'https://example.test/media.jpg', genericId: 'g1', choiceValue: 'c1' },
      { CODBARRAS: '199294304984', confidence: 'ALTA', image_url_confiable: 'https://example.test/vs.jpg', genericId: 'g1', choiceValue: 'c1' },
      { CODBARRAS: '199294399999', confidence: 'BAJA', image_url_confiable: 'https://example.test/low.jpg', genericId: 'g1', choiceValue: 'c1' }
    ], 'Dataset');
    const repository = new VsExcelProductRepository(stock, { imageCoverageFilePath: coverage });
    const service = new VsProductService(repository);
    const product = await service.getProductByBarcode('199294268699');
    assert.equal(product.description, 'LOUNGE');
    assert.equal(product.stock, 1);
    assert.equal(product.image, null);
    assert.deepEqual(product.sizes.map(item => item.size), ['XS', 'MED']);
    assert.equal(Object.hasOwn(product, 'COSTESTOCK'), false);
    assert.equal(Object.hasOwn(product, 'COSTO_TOTAL'), false);
    assert.equal(await service.getProductByBarcode('does-not-exist'), null);
    assert.equal(repository.metrics().barcodesIndexed, 4);
    assert.equal(typeof repository.metrics().loadTimeMs, 'number');
    assert.equal(repository.metrics().reliableImagesLoaded, 1);
    assert.equal((await service.getProductByBarcode('199294304984')).image, 'https://example.test/vs.jpg');
    assert.equal((await service.getProductByBarcode('199294399999')).image, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const realStock = path.resolve('..', 'VSImageTest', 'Stock de Histria Julio.xlsx');
const realCoverage = path.resolve('..', 'VSImageTest', 'resultado_imagenes_confiables.xlsx');

test('el Excel real solo indexa los 2638 barcodes vendibles', { skip: !existsSync(realStock) }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCoverageFilePath: realCoverage });
  assert.equal(repository.metrics().barcodesIndexed, 2638);
  assert.equal(repository.metrics().reliableImagesLoaded, 346);
  assert.equal(await repository.findByBarcode('198765087685'), null);
});

test('solo imágenes ALTA se exponen en el dataset real', { skip: !existsSync(realStock) || !existsSync(realCoverage) }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCoverageFilePath: realCoverage });
  const service = new VsProductService(repository);
  const high = await service.getProductByBarcode('197575195825');
  const sugarHigh = await service.getProductByBarcode('667555917612');
  const electricPunch = await service.getProductByBarcode('667555917681');
  assert.match(high.image, /^https?:\/\//);
  assert.equal(sugarHigh.image, null);
  assert.equal(electricPunch.image, null);
  assert.equal(Object.hasOwn(sugarHigh, 'COSTESTOCK'), false);
  assert.equal(Object.hasOwn(sugarHigh, 'COSTO_TOTAL'), false);
});

test('genericId + choiceValue permite tallas cuando existe y evita inferencias cuando falta', { skip: !existsSync(realStock) || !existsSync(realCoverage) }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCoverageFilePath: realCoverage });
  const service = new VsProductService(repository);
  const safe = await service.getProductByBarcode('667559793106');
  const withoutIdentity = await service.getProductByBarcode('199294268699');
  assert.ok(safe.sizes.length > 1);
  assert.equal(withoutIdentity.sizes.length, 1);
  assert.equal(withoutIdentity.sizes[0].size, withoutIdentity.scannedSize);
});

test('VS API returns product and 404 for unknown barcode', async () => {
  const service = { getProductByBarcode: async barcode => barcode === '123' ? { barcode } : null };
  const api = vsProductApi(service);
  const call = async url => {
    const result = { status: null, headers: {}, body: '' };
    const response = { writeHead(status, headers) { result.status = status; result.headers = headers; }, setHeader() {}, end(body = '') { result.body = body; } };
    await api({ url }, response);
    return { ...result, json: JSON.parse(result.body) };
  };
  assert.equal((await call('/api/vs/products/123')).status, 200);
  assert.equal((await call('/api/vs/products/999')).status, 404);
});
