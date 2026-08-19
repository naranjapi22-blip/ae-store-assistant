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
    const selected = await service.getProductByBarcode('199294304984'); assert.equal(selected.stock, 2); assert.equal(selected.totalStock, 3); assert.equal(selected.sizes.reduce((total, size) => total + size.stock, 0), 3);
    const oneSize = await service.getProductByBarcode('199294399999'); assert.equal(oneSize.stock, 5); assert.equal(oneSize.totalStock, 5);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('VS busca Referencia con índice, conserva strings y rechaza STYLE ambiguo', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vs-reference-'));
  try {
    const stock = path.join(dir, 'stock.csv'); const catalog = path.join(dir, 'catalog.json'); const historical = path.join(dir, 'historical.json'); const styleColor = path.join(dir, 'style-color.json');
    const make = (barcode, reference, style, color, size, stockValue = 1) => ({ CODARTICULO: `A-${barcode}`, REFPROVEEDOR: reference, DESCRIPCION: 'Reference product', TEMPORADA: 'TEST', TALLA: size, COLOR: color, CODBARRAS: barcode, STOCK: stockValue, departamento: 'A', seccion: 'A1', familia: 'F1', STYLE: style, STYLO: 'STYLO' });
    await writeCsv(stock, [make('4001', '00042', 'STYLE-REF', 'RED', 'S', 2), make('4002', '00042', 'STYLE-REF', 'RED', 'M', 3), make('4003', '00043', 'STYLE-COLOR', 'RED', 'S'), make('4004', '00043', 'STYLE-COLOR', 'BLUE', 'S'), make('4005', '00044', 'STYLE-A', 'RED', 'S'), make('4006', '00044', 'STYLE-B', 'RED', 'S')]);
    await writeCatalog(catalog, []); await writeCatalog(historical, []); await writeCatalog(styleColor, []);
    const repository = new VsExcelProductRepository(stock, { imageCatalogFilePath: catalog, historicalImageFilePath: historical, styleColorImageFilePath: styleColor }); const service = new VsProductService(repository);
    assert.ok(repository.byReference instanceof Map); assert.equal(typeof repository.rows[0].REFPROVEEDOR, 'string');
    const reference = await service.getProductByQuery(' 00042 '); assert.ok(reference.product); assert.equal(reference.product.totalStock, 5); assert.equal(reference.product.sizes.length, 2); assert.equal(reference.product.image, null);
    assert.equal(reference.product.relatedColors.length, 0);
    const multiColor = await service.getProductByQuery('00043'); assert.ok(multiColor.product); assert.equal(multiColor.product.style, 'STYLE-COLOR'); assert.ok(multiColor.product.relatedColors.some(item => item.color === 'BLUE'));
    const ambiguous = await service.getProductByQuery('00044'); assert.equal(ambiguous.product, null); assert.equal(ambiguous.ambiguous, true); assert.deepEqual(ambiguous.options.map(item => item.style), ['STYLE-A', 'STYLE-B']);
    assert.equal(service.searchCatalog({ query: '00042' }).total, 1); assert.equal((await service.getProductByQuery('NOT-FOUND')).product, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('VS catálogo aplica filtros AND antes de paginar y calcula facets dependientes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vs-catalog-filters-'));
  try {
    const stock = path.join(dir, 'stock.csv'); const catalog = path.join(dir, 'catalog.json'); const historical = path.join(dir, 'historical.json'); const styleColor = path.join(dir, 'style-color.json');
    const make = (barcode, style, color, department, section, family, size, description = 'Synthetic product') => ({ CODARTICULO: style, REFPROVEEDOR: `REF-${style}`, DESCRIPCION: description, TEMPORADA: 'TEST', TALLA: size, COLOR: color, CODBARRAS: barcode, STOCK: 1, departamento: department, seccion: section, familia: family, STYLE: style, STYLO: `STYLO-${style}` });
    const synthetic = [
      make('1001', 'STYLE-A', 'RED', 'A', 'A1', 'A1-1', 'S', 'Alpha product'),
      make('1002', 'STYLE-A', 'RED', 'A', 'A1', 'A1-1', 'M', 'Alpha product'),
      make('1003', 'STYLE-A', 'BLUE', 'A', 'A1', 'A1-2', 'S', 'Blue product'),
      make('1004', 'STYLE-A2', 'RED', 'A', 'A2', 'A2-1', 'S', 'A2 product'),
      make('1005', 'STYLE-B', 'RED', 'B', 'B1', 'B1-1', 'S', 'B product')
    ];
    for (let index = 0; index < 55; index += 1) synthetic.push(make(`2${String(index).padStart(3, '0')}`, `STYLE-X${index}`, 'RED', 'A', 'A1', 'A1-1', 'S'));
    synthetic.push(make('2999', 'STYLE-LAST', 'RED', 'A', 'A2', 'A2-1', 'S', 'Last A2 product'));
    await writeCsv(stock, synthetic); await writeCatalog(catalog, []); await writeCatalog(historical, []); await writeCatalog(styleColor, []);
    const repository = new VsExcelProductRepository(stock, { imageCatalogFilePath: catalog, historicalImageFilePath: historical, styleColorImageFilePath: styleColor }); const service = new VsProductService(repository);
    assert.ok(service.searchCatalog({ department: 'A', limit: 100 }).items.every(item => item.department === 'A'));
    assert.ok(service.searchCatalog({ section: 'A1', limit: 100 }).items.every(item => item.section === 'A1'));
    assert.ok(service.searchCatalog({ family: 'A1-1', limit: 100 }).items.every(item => item.family === 'A1-1'));
    assert.ok(service.searchCatalog({ department: 'A', section: 'A1', limit: 100 }).items.every(item => item.department === 'A' && item.section === 'A1'));
    assert.ok(service.searchCatalog({ department: 'B', limit: 100 }).items.every(item => item.department === 'B'));
    assert.deepEqual(service.searchCatalog({ department: 'B' }).facets.sections, ['B1']);
    assert.deepEqual(service.searchCatalog({ department: 'A' }).facets.sections, ['A1', 'A2']);
    assert.deepEqual(service.searchCatalog({ department: 'A', section: 'A1' }).facets.families, ['A1-1', 'A1-2']);
    const page = service.searchCatalog({ department: 'A', section: 'A1', limit: 1 }); const next = service.searchCatalog({ department: 'A', section: 'A1', offset: 1, limit: 1 });
    assert.equal(page.items.length, 1); assert.ok(page.total > 1); assert.equal(page.hasMore, true); assert.notEqual(page.items[0].barcode, next.items[0].barcode);
    assert.ok(service.searchCatalog({ query: 'Alpha', department: 'A', section: 'A1' }).items.every(item => item.description === 'Alpha product'));
    const redCard = repository.catalogGroups.find(item => item.style === 'STYLE-A' && item.color === 'RED'); assert.ok(redCard); assert.equal(redCard.availableSizes, 2); assert.equal(redCard.stock, 2); assert.equal(repository.catalogGroups.filter(item => item.style === 'STYLE-A' && item.color === 'RED').length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('VS catálogo expone y filtra subfamily con facets dependientes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vs-subfamily-filters-'));
  try {
    const stock = path.join(dir, 'stock.json'); const catalog = path.join(dir, 'catalog.json'); const historical = path.join(dir, 'historical.json'); const styleColor = path.join(dir, 'style-color.json');
    const make = (barcode, department, section, family, subfamily, style, color, size, description = 'Synthetic product') => ({ codigoArticulo: `ART-${barcode}`, referencia: `REF-${barcode}`, descripcion: description, temporada: 'TEST', talla: size, color, barcode, barcode2: '', stock: 1, departamento: department, seccion: section, familia: family, subfamilia: subfamily, style, stylo: `ST-${barcode}` });
    await writeFile(stock, JSON.stringify([
      make('5001', 'A', 'A1', 'F1', 'SUB-1', 'STYLE-A', 'RED', 'S', 'Alpha product'),
      make('5002', 'A', 'A1', 'F1', 'SUB-2', 'STYLE-B', 'BLUE', 'M', 'Beta product'),
      make('5003', 'A', 'A2', 'F2', 'SUB-3', 'STYLE-C', 'GREEN', 'S', 'Gamma product'),
      make('5004', 'B', 'B1', 'G1', 'SUB-4', 'STYLE-D', 'RED', 'S', 'Delta product')
    ]), 'utf8');
    await writeCatalog(catalog, []); await writeCatalog(historical, []); await writeCatalog(styleColor, []);
    const repository = new VsExcelProductRepository(stock, { imageCatalogFilePath: catalog, historicalImageFilePath: historical, styleColorImageFilePath: styleColor }); const service = new VsProductService(repository);
    const all = service.searchCatalog({ limit: 100 });
    assert.deepEqual(all.facets.subfamilies, ['SUB-1', 'SUB-2', 'SUB-3', 'SUB-4']);
    const subOnly = service.searchCatalog({ subfamily: 'SUB-2' });
    assert.equal(subOnly.total, 1); assert.equal(subOnly.items[0].barcode, '5002'); assert.equal(subOnly.items[0].subfamily, 'SUB-2');
    assert.deepEqual(subOnly.facets.departments, ['A']); assert.deepEqual(subOnly.facets.sections, ['A1']); assert.deepEqual(subOnly.facets.families, ['F1']); assert.deepEqual(subOnly.facets.subfamilies, ['SUB-1', 'SUB-2', 'SUB-3', 'SUB-4']);
    const combined = service.searchCatalog({ department: 'A', section: 'A1', family: 'F1', subfamily: 'SUB-1' });
    assert.equal(combined.total, 1); assert.equal(combined.items[0].barcode, '5001'); assert.deepEqual(combined.facets.subfamilies, ['SUB-1', 'SUB-2']);
    assert.deepEqual(service.searchCatalog({ department: 'A' }).facets.subfamilies, ['SUB-1', 'SUB-2', 'SUB-3']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('VS totalStock respeta STYLE+COLOR, stock positivo y tallas duplicadas', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vs-total-stock-'));
  try {
    const stock = path.join(dir, 'stock.csv'); const catalog = path.join(dir, 'catalog.json'); const historical = path.join(dir, 'historical.json'); const styleColor = path.join(dir, 'style-color.json');
    const make = (barcode, style, color, size, stockValue) => ({ CODARTICULO: `${style}-${color}`, REFPROVEEDOR: `REF-${style}-${color}`, DESCRIPCION: 'Stock test', TEMPORADA: 'TEST', TALLA: size, COLOR: color, CODBARRAS: barcode, STOCK: stockValue, departamento: 'A', seccion: 'A1', familia: 'F1', STYLE: style, STYLO: 'STYLO' });
    await writeCsv(stock, [make('3001', 'STYLE-ONE', 'RED', 'S', 2), make('3002', 'STYLE-ONE', 'RED', 'S', 3), make('3003', 'STYLE-ONE', 'RED', 'M', 4), make('3004', 'STYLE-ONE', 'RED', 'L', 0), make('3005', 'STYLE-ONE', 'RED', 'XL', -2), make('3006', 'STYLE-ONE', 'BLUE', 'S', 10), make('3007', 'STYLE-TWO', 'RED', 'S', 20)]);
    await writeCatalog(catalog, []); await writeCatalog(historical, []); await writeCatalog(styleColor, []);
    const service = new VsProductService(new VsExcelProductRepository(stock, { imageCatalogFilePath: catalog, historicalImageFilePath: historical, styleColorImageFilePath: styleColor }));
    const initial = await service.getProductByBarcode('3001');
    assert.equal(initial.stock, 5); assert.equal(initial.totalStock, 9); assert.deepEqual(initial.sizes.map(size => [size.size, size.stock]), [['S', 5], ['M', 4]]); assert.equal(initial.image, null);
    const changed = await service.getProductByBarcode('3003', { scannedBarcode: initial.scannedBarcode }); assert.equal(changed.stock, 4); assert.equal(changed.totalStock, 9); assert.equal(changed.style, 'STYLE-ONE'); assert.equal(changed.color, 'RED');
    const oneSize = await service.getProductByBarcode('3006'); assert.equal(oneSize.stock, 10); assert.equal(oneSize.totalStock, 10);
    const otherStyle = await service.getProductByBarcode('3007'); assert.equal(otherStyle.totalStock, 20);
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

test('cada talla VS tiene barcode, selected cambia stock/producto y conserva STYLE+COLOR', { skip: !realReady }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCatalogFilePath: realCatalog, historicalImageFilePath: realHistorical, styleColorImageFilePath: realStyleColor }); const service = new VsProductService(repository);
  const original = await service.getProductByBarcode('667559465928'); const other = original.sizes.find(size => !size.selected);
  assert.equal(original.sizes.length, 6); assert.ok(original.sizes.every(size => size.barcode && size.stock > 0)); assert.equal(original.sizes.filter(size => size.scanned).length, 1); assert.equal(original.sizes.filter(size => size.selected).length, 1);
  const changed = await service.getProductByBarcode(other.barcode, { scannedBarcode: original.scannedBarcode });
  assert.equal(changed.style, original.style); assert.equal(changed.color, original.color); assert.equal(changed.barcode, other.barcode); assert.equal(changed.selectedSize, other.size); assert.equal(changed.stock, other.stock); assert.equal(changed.sizes.filter(size => size.selected).length, 1); assert.equal(changed.sizes.find(size => size.selected).barcode, other.barcode); assert.equal(changed.sizes.filter(size => size.scanned).length, 1);
});

test('cambiar COLOR reconstruye tallas y no arrastra scanned fuera del grupo', { skip: !realReady }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCatalogFilePath: realCatalog, historicalImageFilePath: realHistorical, styleColorImageFilePath: realStyleColor }); const service = new VsProductService(repository);
  const candidate = [...repository.byStyle.entries()].map(([style, rows]) => ({ style, rows, colors: new Set(rows.map(row => row.COLOR).filter(Boolean)) })).find(item => item.colors.size > 1); assert.ok(candidate);
  const originalBarcode = candidate.rows[0].CODBARRAS; const original = await service.getProductByBarcode(originalBarcode); const related = original.relatedColors[0]; assert.ok(related?.barcode);
  const changedColor = await service.getProductByBarcode(related.barcode, { scannedBarcode: originalBarcode });
  assert.equal(changedColor.style, original.style); assert.notEqual(changedColor.color, original.color); assert.equal(changedColor.sizes.filter(size => size.selected).length, 1); assert.equal(changedColor.sizes.filter(size => size.scanned).length, 0); assert.ok(changedColor.sizes.every(size => size.stock > 0));
  const nextSize = changedColor.sizes.find(size => !size.selected); if (nextSize) { const changedColorSize = await service.getProductByBarcode(nextSize.barcode, { scannedBarcode: originalBarcode }); assert.equal(changedColorSize.color, changedColor.color); assert.equal(changedColorSize.selectedSize, nextSize.size); assert.equal(changedColorSize.stock, nextSize.stock); }
});

test('talla de producto sin imagen continúa siendo seleccionable', { skip: !realReady }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCatalogFilePath: realCatalog, historicalImageFilePath: realHistorical, styleColorImageFilePath: realStyleColor }); const service = new VsProductService(repository);
  const catalog = JSON.parse(await readFile(realCatalog, 'utf8')).results; const historical = new Set(JSON.parse(await readFile(realHistorical, 'utf8')).results.filter(row => row.clasificacion === 'HISTORICA_RECUPERADA').map(row => row.barcode)); const styleColor = new Set(JSON.parse(await readFile(realStyleColor, 'utf8')).results.filter(row => row.clasificacion === 'STYLE_COLOR_RECUPERADO').map(row => row.barcode)); const noImage = catalog.find(row => row.clasificacion !== 'MATCH_COLOR_ACTUAL' && !historical.has(row.barcode) && !styleColor.has(row.barcode));
  const product = await service.getProductByBarcode(noImage.barcode); const selectable = product.sizes.find(size => size.barcode); const selected = await service.getProductByBarcode(selectable.barcode, { scannedBarcode: product.scannedBarcode });
  assert.equal(selected.image, null); assert.equal(selected.barcode, selectable.barcode); assert.ok(selected.stock > 0); assert.equal(selected.sizes.filter(size => size.selected).length, 1);
});

test('Explorar catálogo agrupa STYLE+COLOR, filtra, pagina y abre el detalle normal', { skip: !realReady }, async () => {
  const repository = new VsExcelProductRepository(realStock, { imageCatalogFilePath: realCatalog, historicalImageFilePath: realHistorical, styleColorImageFilePath: realStyleColor }); const service = new VsProductService(repository);
  const firstPage = service.searchCatalog({ limit: 50 }); assert.equal(firstPage.items.length, 50); assert.ok(firstPage.total > 50); assert.equal(firstPage.facets.departments.length > 0, true);
  const pageTwo = service.searchCatalog({ offset: 50, limit: 50 }); assert.equal(pageTwo.items.length, 50); assert.notEqual(pageTwo.items[0].barcode, firstPage.items[0].barcode);
  const grouped = [...repository.byStyle.entries()].map(([style, rows]) => ({ style, rows, colors: new Set(rows.map(row => row.COLOR).filter(Boolean)) })).find(item => item.rows.length > 1 && item.colors.size > 0); assert.ok(grouped);
  const color = grouped.rows[0].COLOR; const card = repository.catalogGroups.find(item => item.style === grouped.style && item.color === color); assert.ok(card); assert.equal(card.availableSizes, new Set(grouped.rows.filter(row => row.COLOR === color).map(row => row.TALLA)).size); assert.equal(card.stock, grouped.rows.filter(row => row.COLOR === color).reduce((total, row) => total + row.STOCK, 0));
  const imageGroup = repository.catalogGroups.find(item => item.style && item.image); assert.ok(imageGroup); const imageRows = repository.rows.filter(row => row.STYLE === imageGroup.style && row.COLOR === imageGroup.color); assert.ok(imageRows.some(row => repository.imageFor(row).image === imageGroup.image));
  const noImageGroup = repository.catalogGroups.find(item => !item.image); assert.ok(noImageGroup); assert.ok(service.searchCatalog({ query: noImageGroup.description }).items.some(item => item.barcode === noImageGroup.barcode));
  assert.ok(service.searchCatalog({ query: imageGroup.style }).items.some(item => item.style === imageGroup.style)); assert.ok(service.searchCatalog({ department: imageGroup.department }).items.every(item => item.department === imageGroup.department));
  const detail = await service.getProductByBarcode(card.barcode); assert.ok(detail); assert.equal(detail.style, card.style); assert.equal(detail.color, card.color);
});

test('VS API returns product and 404 for unknown barcode', async () => {
  const catalogCalls = [];
  const api = vsProductApi({ getProductByBarcode: async barcode => barcode === '123' ? { barcode } : null, searchCatalog: options => { catalogCalls.push(options); return { items: [{ barcode: '123' }], total: 1, offset: 0, limit: 50, hasMore: false, facets: { departments: [], sections: [], families: [], subfamilies: [] } }; } });
  const call = async url => { const result = { status: null, body: '' }; const response = { writeHead(status) { result.status = status; }, setHeader() {}, end(body = '') { result.body = body; } }; await api({ url }, response); return { ...result, json: JSON.parse(result.body) }; };
  assert.equal((await call('/api/vs/products/123')).status, 200); assert.equal((await call('/api/vs/products/999')).status, 404);
  assert.deepEqual(await call('/api/vs/catalog?q=bras&subfamily=mist'), { status: 200, body: '{"items":[{"barcode":"123"}],"total":1,"offset":0,"limit":50,"hasMore":false,"facets":{"departments":[],"sections":[],"families":[],"subfamilies":[]}}', json: { items: [{ barcode: '123' }], total: 1, offset: 0, limit: 50, hasMore: false, facets: { departments: [], sections: [], families: [], subfamilies: [] } } });
  assert.equal(catalogCalls[0].query, 'bras'); assert.equal(catalogCalls[0].subfamily, 'mist');
});
