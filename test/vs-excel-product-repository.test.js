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
  { CODARTICULO: 1, REFPROVEEDOR: 'VS-001', DESCRIPCION: 'LOUNGE', TEMPORADA: 'FA25', TALLA: 'XS', COLOR: '7LBQ', CODBARRAS: '199294268699', CODBARRAS2: '', STOCK: 1, departamento: 'INTIMATE APPAREL', seccion: 'BRAS-INTIMATE APPAREL', familia: 'T SHIRT' },
  { CODARTICULO: 2, REFPROVEEDOR: 'VS-001', DESCRIPCION: 'LOUNGE', TEMPORADA: 'FA25', TALLA: 'MED', COLOR: '7LBQ', CODBARRAS: '199294304984', CODBARRAS2: '', STOCK: 2, departamento: 'INTIMATE APPAREL', seccion: 'BRAS-INTIMATE APPAREL', familia: 'T SHIRT' },
  { CODARTICULO: 4, REFPROVEEDOR: 'VS-003', DESCRIPCION: 'LOUNGE', TEMPORADA: 'FA25', TALLA: 'XS', COLOR: 'OTHER', CODBARRAS: '199294399999', CODBARRAS2: '', STOCK: 5, departamento: 'INTIMATE APPAREL', seccion: 'BRAS-INTIMATE APPAREL', familia: 'T SHIRT' },
  { CODARTICULO: 3, REFPROVEEDOR: 'VS-002', DESCRIPCION: 'THONG', TEMPORADA: '', TALLA: 'NA', COLOR: '34Y5', CODBARRAS: '667560045416', CODBARRAS2: '', STOCK: 4, departamento: 'INTIMATE APPAREL', seccion: 'PANTIES-INTIMATE APPAREL', familia: 'LACIE' },
  { CODARTICULO: 5, REFPROVEEDOR: 'VS-005', DESCRIPCION: 'ZERO', TEMPORADA: '', TALLA: 'S', COLOR: 'Z', CODBARRAS: '199294000005', CODBARRAS2: '', STOCK: -1, departamento: 'APPAREL', seccion: 'TOPS', familia: 'BASIC' }
];
const writeBook = (file, data) => { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data), 'Hoja1'); XLSX.writeFile(book, file); };
const writeCatalog = (file, data) => writeFile(file, JSON.stringify({ rows: data }), 'utf8');
const writeCsv = (file, data) => writeFile(file, `meta;synthetic\nDescripción;Talla;Color;Cód. Barras;Código Artículo;Referencia;Departamento;Seccion;Família;Temporada;STYLE;STYLO;Stock\n${data.map(row => [row.DESCRIPCION, row.TALLA, row.COLOR, row.CODBARRAS, row.CODARTICULO, row.REFPROVEEDOR, row.departamento, row.seccion, row.familia, row.TEMPORADA, row.STYLE ?? '', row.STYLO ?? '', row.STOCK].join(';')).join('\n')}\n`, 'utf8');

test('VS repository indexes CSV/XLSX, keeps strings, hides costs, and applies image priority', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vs-poc-'));
  try {
    const stock = path.join(dir, 'stock.xlsx'); const csv = path.join(dir, 'stock.csv'); const catalog = path.join(dir, 'catalog.json'); const historical = path.join(dir, 'historical.json'); const styleColor = path.join(dir, 'style.json');
    writeBook(stock, rows); await writeCsv(csv, rows.filter(row => row.STOCK > 0).map(row => ({ ...row, STYLE: 'STYLE-1', STYLO: '0007' })));
    await writeCatalog(catalog, [{ barcode: '199294304984', clasificacion: 'MATCH_COLOR_ACTUAL', image_url: 'https://example.test/current.jpg', http_status: 200 }, { barcode: '199294268699', clasificacion: 'MATCH_COLOR_ACTUAL', image_url: 'https://example.test/invalid.jpg', http_status: 404 }]);
    await writeCatalog(historical, [{ barcode: '199294304984', clasificacion: 'HISTORICA_RECUPERADA', image_url_historica: 'https://example.test/old.jpg', http_status: 200 }, { barcode: '199294399999', clasificacion: 'HISTORICA_RECUPERADA', image_url_historica: 'https://example.test/historical.jpg', http_status: 200 }]);
    await writeCatalog(styleColor, [{ barcode: '667560045416', clasificacion: 'STYLE_COLOR_RECUPERADO', image: 'https://example.test/style-color.jpg' }]);
    const repository = new VsExcelProductRepository(csv, { imageCatalogFilePath: catalog, historicalImageFilePath: historical, styleColorImageFilePath: styleColor }); const service = new VsProductService(repository);
    assert.equal(repository.metrics().barcodesIndexed, 4); assert.equal(repository.metrics().currentImagesLoaded, 1); assert.equal(repository.metrics().historicalImagesLoaded, 1); assert.equal(repository.metrics().styleColorImagesLoaded, 1); assert.equal(repository.metrics().imagesLoaded, 3);
    assert.equal((await service.getProductByBarcode('199294304984')).image, 'https://example.test/current.jpg'); assert.equal((await repository.findByBarcode('199294304984')).imageSource, 'current');
    assert.equal((await service.getProductByBarcode('199294399999')).image, 'https://example.test/historical.jpg'); assert.equal((await repository.findByBarcode('199294399999')).imageSource, 'historical');
    assert.equal((await service.getProductByBarcode('667560045416')).image, 'https://example.test/style-color.jpg'); assert.equal((await repository.findByBarcode('667560045416')).imageSource, 'style-color');
    assert.equal((await service.getProductByBarcode('199294268699')).image, null); assert.equal((await service.getProductByBarcode('199294268699')).stock, 1);
    assert.equal(typeof (await repository.findByBarcode('199294304984')).STYLE, 'string'); assert.equal(typeof (await repository.findByBarcode('199294304984')).STYLO, 'string');
    assert.equal(Object.hasOwn((await repository.findByBarcode('199294304984')), 'COSTESTOCK'), false);
    const xlsxRepository = new VsExcelProductRepository(stock, { imageCatalogFilePath: catalog, historicalImageFilePath: historical, styleColorImageFilePath: styleColor }); assert.equal(xlsxRepository.metrics().barcodesIndexed, 4);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const realStock = path.resolve('..', 'VSImageTest', 'beauty brands.csv');
const realCatalog = path.resolve('..', 'VSImageTest', 'catalogo_actual_vs_nuevo.json');
const realHistorical = path.resolve('..', 'VSImageTest', 'historico_vs_nuevo.json');
const realStyleColor = path.resolve('..', 'VSImageTest', 'style_color_recovery_vs.json');
const realReady = existsSync(realStock) && existsSync(realCatalog) && existsSync(realHistorical) && existsSync(realStyleColor);

test('el catálogo nuevo indexa 25159 barcodes y 15174 imágenes', { skip: !realReady }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCatalogFilePath: realCatalog, historicalImageFilePath: realHistorical, styleColorImageFilePath: realStyleColor });
  assert.deepEqual(repository.metrics(), { ...repository.metrics(), barcodesIndexed: 25159, currentImagesLoaded: 13583, historicalImagesLoaded: 1501, styleColorImagesLoaded: 90, imagesLoaded: 15174, reliableImagesLoaded: 15174 });
});

test('current, historical y style-color respetan prioridad y los faltantes quedan null', { skip: !realReady }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCatalogFilePath: realCatalog, historicalImageFilePath: realHistorical, styleColorImageFilePath: realStyleColor }); const service = new VsProductService(repository);
  const current = await service.getProductByBarcode('197575012887'); assert.match(current.image, /112589722ZUO_OM_F\.jpg$/); assert.equal((await repository.findByBarcode('197575012887')).imageSource, 'current');
  const historical = await service.getProductByBarcode('197575012719'); assert.match(historical.image, /1125897210T1_OF_F\.jpg$/); assert.equal((await repository.findByBarcode('197575012719')).imageSource, 'historical');
  const styleColor = await service.getProductByBarcode('197575042723'); assert.match(styleColor.image, /112584672I61_OM_F\.jpg$/); assert.equal((await repository.findByBarcode('197575042723')).imageSource, 'style-color');
  const catalog = JSON.parse(await readFile(realCatalog, 'utf8')).results; const historicalRows = new Set(JSON.parse(await readFile(realHistorical, 'utf8')).results.filter(row => row.clasificacion === 'HISTORICA_RECUPERADA').map(row => row.barcode)); const styleRows = new Set(JSON.parse(await readFile(realStyleColor, 'utf8')).results.filter(row => row.clasificacion === 'STYLE_COLOR_RECUPERADO').map(row => row.barcode)); const noImage = catalog.find(row => row.clasificacion !== 'MATCH_COLOR_ACTUAL' && !historicalRows.has(row.barcode) && !styleRows.has(row.barcode));
  assert.ok(noImage); assert.equal((await service.getProductByBarcode(noImage.barcode)).image, null); assert.equal(current.performance.imagesLoaded, 15174);
  const relatedSizes = await service.getProductByBarcode('667559465928'); assert.equal(relatedSizes.sizes.length, 6); assert.ok(relatedSizes.sizes.every(size => size.image));
});

test('controles por BRAS, PANTIES, FRAGRANCE y ACCESSORIES tienen imagen', { skip: !realReady }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCatalogFilePath: realCatalog, historicalImageFilePath: realHistorical, styleColorImageFilePath: realStyleColor }); const service = new VsProductService(repository); const catalog = JSON.parse(await readFile(realCatalog, 'utf8')).results;
  const categories = { BRAS: row => /BRAS/i.test(row.seccion || ''), PANTIES: row => /PANTIES/i.test(row.seccion || ''), FRAGRANCE: row => /FRAGRANCE/i.test(`${row.departamento} ${row.seccion} ${row.familia}`), ACCESSORIES: row => /ACCESSORIES/i.test(row.departamento || '') };
  for (const [name, predicate] of Object.entries(categories)) { const row = catalog.find(item => item.clasificacion === 'MATCH_COLOR_ACTUAL' && predicate(item)); assert.ok(row, `no se encontró control ${name}`); assert.ok((await service.getProductByBarcode(row.barcode))?.image, `${name} no obtuvo imagen`); }
});

test('VS agrupa tallas por STYLE+COLOR, identifica la escaneada y filtra stock no disponible', { skip: !realReady }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCatalogFilePath: realCatalog, historicalImageFilePath: realHistorical, styleColorImageFilePath: realStyleColor }); const service = new VsProductService(repository);
  const product = await service.getProductByBarcode('667559465928');
  assert.equal(product.sizes.length, 6); assert.equal(product.sizes.filter(size => size.scanned).length, 1); assert.equal(product.sizes.find(size => size.scanned).barcode, '667559465928'); assert.ok(product.sizes.every(size => size.stock > 0));
});

test('VS expone colores distintos del mismo STYLE y nunca mezcla STYLE', { skip: !realReady }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCatalogFilePath: realCatalog, historicalImageFilePath: realHistorical, styleColorImageFilePath: realStyleColor }); const service = new VsProductService(repository);
  const candidate = [...repository.byStyle.entries()].map(([style, rows]) => ({ style, rows, colors: new Set(rows.map(row => row.COLOR).filter(Boolean)) })).find(item => item.colors.size > 1);
  assert.ok(candidate); const product = await service.getProductByBarcode(candidate.rows[0].CODBARRAS); assert.ok(product.relatedColors.length > 0); assert.ok(product.relatedColors.every(item => item.color !== product.color));
  const sameStyle = await repository.findByStyle(product.style); assert.ok(sameStyle.every(row => row.STYLE === product.style));
});

test('VS producto existente sin imagen devuelve datos y STYLE vacío no agrupa', { skip: !realReady }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCatalogFilePath: realCatalog, historicalImageFilePath: realHistorical, styleColorImageFilePath: realStyleColor }); const service = new VsProductService(repository);
  const catalog = JSON.parse(await readFile(realCatalog, 'utf8')).results; const historical = new Set(JSON.parse(await readFile(realHistorical, 'utf8')).results.filter(row => row.clasificacion === 'HISTORICA_RECUPERADA').map(row => row.barcode)); const styleColor = new Set(JSON.parse(await readFile(realStyleColor, 'utf8')).results.filter(row => row.clasificacion === 'STYLE_COLOR_RECUPERADO').map(row => row.barcode)); const noImage = catalog.find(row => row.clasificacion !== 'MATCH_COLOR_ACTUAL' && !historical.has(row.barcode) && !styleColor.has(row.barcode));
  const product = await service.getProductByBarcode(noImage.barcode); assert.ok(product); assert.equal(product.image, null); assert.equal(typeof product.description, 'string'); assert.ok(product.stock > 0);
  const emptyStyle = repository.rows.find(row => !row.STYLE); assert.ok(emptyStyle); const emptyProduct = await service.getProductByBarcode(emptyStyle.CODBARRAS); assert.deepEqual(emptyProduct.relatedColors, []);
});

test('VS API returns product and 404 for unknown barcode', async () => {
  const api = vsProductApi({ getProductByBarcode: async barcode => barcode === '123' ? { barcode } : null });
  const call = async url => { const result = { status: null, body: '' }; const response = { writeHead(status) { result.status = status; }, setHeader() {}, end(body = '') { result.body = body; } }; await api({ url }, response); return { ...result, json: JSON.parse(result.body) }; };
  assert.equal((await call('/api/vs/products/123')).status, 200); assert.equal((await call('/api/vs/products/999')).status, 404);
});
