import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductService } from '../src/service/ProductService.js';

const rows = [
  { CODBARRAS: '111', CODBARRAS2: '222', supplierRef: 'SUP-001', season: 'SPRING 2026', description: 'Producto base', additionalDescription: 'Denim Shorts', materialSpanish: '98% algodón, 2% elastano', price: 41700, ref: '0433-1608-437', style: '1608', color: '437', colorDescription: 'LIGHT VINTAGE', colorSpanish: 'AZUL', size: '2 REGULAR', stock: 4 },
  { CODBARRAS: '333', description: 'Producto base', ref: '0433-1608-437', style: '1608', color: '437', colorDescription: 'LIGHT VINTAGE', colorSpanish: 'AZUL', size: '4 REGULAR', stock: 2 },
  { CODBARRAS: '666', description: 'Producto base', ref: '0433-1608-437', style: '1608', color: '437', colorDescription: 'LIGHT VINTAGE', colorSpanish: 'AZUL', size: '4 REGULAR', stock: 3 },
  { CODBARRAS: '555', description: 'Descripción distinta', ref: '0433-1608-100', style: '1608', color: '100', colorDescription: 'TRUE BLACK', colorSpanish: 'NEGRO', size: '2 REGULAR', stock: 2 },
  { CODBARRAS: '777', description: 'Otra familia', ref: '9999-1608-999', style: '1608', color: '999', size: 'M', stock: 1 },
  { CODBARRAS: '888', description: 'Misma familia, otro style', ref: '0433-9999-888', style: '9999', color: '888', size: 'M', stock: 1 },
  { CODBARRAS: '999', description: 'Referencia inválida', ref: 'INVALID', style: '1608', color: '321', size: 'M', stock: 1 },
  { CODBARRAS: '1000', description: 'Color duplicado', ref: '0433-1608-200', style: '1608', color: '200', colorDescription: 'OLIVE', colorSpanish: 'OLIVA', size: 'S', stock: 1 },
  { CODBARRAS: '1001', description: 'Color duplicado', ref: '0433-1608-300', style: '1608', color: '200', colorDescription: 'OLIVE', colorSpanish: 'OLIVA', size: 'M', stock: 1 }
];

const repo = {
  findByBarcode: async code => rows.find(row => row.CODBARRAS === code || row.CODBARRAS2 === code) ?? null,
  findByQuery: async query => rows.find(row => row.CODBARRAS === query || row.CODBARRAS2 === query || row.supplierRef === query) ?? null,
  findBySupplierRef: async supplierRef => rows.filter(row => row.supplierRef === supplierRef),
  findByArticleCode: async articleCode => rows.filter(row => Number(row.articleCode) === Number(articleCode)),
  findByReference: async ref => rows.filter(row => row.ref === ref),
  findByStyle: async style => rows.filter(row => row.style === style),
  searchProductsByStyle: async style => rows.filter(row => row.style === style).map(row => ({ ref: row.ref, style: row.style, description: row.description, stockTotal: row.stock, sizesWithStock: row.stock > 0 ? 1 : 0 }))
};

const product = barcode => new ProductService(repo).getProductByBarcode(barcode);

test('busca por CODBARRAS y CODBARRAS2 y agrupa tallas', async () => {
  const result = await product('222');
  assert.equal(result.scannedSize, '2 REGULAR');
  assert.equal(result.barcode, '111');
  assert.deepEqual(result.sizes.map(({ size, stock }) => ({ size, stock })), [{ size: '2 REGULAR', stock: 4 }, { size: '4 REGULAR', stock: 5 }]);
  assert.equal(result.sizes[0].barcode, '111');
});

test('busca por REFPROVEEDOR como string y mantiene la agrupación por referencia', async () => {
  const result = await new ProductService(repo).getProductByQuery('SUP-001');
  assert.equal(result.REFERENCIA_STYLO, '0433-1608-437');
  assert.deepEqual(result.sizes.map(({ size, stock }) => ({ size, stock })), [{ size: '2 REGULAR', stock: 4 }, { size: '4 REGULAR', stock: 5 }]);
});

test('resuelve un STYLE con una sola referencia como lista agrupada', async () => {
  const service = new ProductService({
    findByBarcode: async () => null,
    findByReference: async () => [],
    findBySupplierRef: async () => [],
    findByStyle: async () => [rows[0], rows[1], rows[2]],
    searchProductsByStyle: async () => [{ ref: '0433-1608-437', style: '1608', description: 'Producto base', stockTotal: 9, sizesWithStock: 2 }]
  });
  const result = await service.resolveProductQuery('1608');
  assert.equal(result.product, undefined);
  assert.deepEqual(result.results.map(item => item.REFERENCIA_STYLO), ['0433-1608-437']);
});

test('resuelve un STYLE con varias referencias como lista agrupada', async () => {
  const service = new ProductService({
    findByBarcode: async () => null,
    findByReference: async () => [],
    findBySupplierRef: async () => [],
    findByStyle: async () => rows.filter(row => row.style === '1608'),
    searchProductsByStyle: async (_query, limit) => [
      { ref: '0433-1608-437', style: '1608', description: 'Producto base', stockTotal: 9, sizesWithStock: 2 },
      { ref: '9999-1608-999', style: '1608', description: 'Otra familia', stockTotal: 1, sizesWithStock: 1 }
    ].slice(0, limit)
  });
  const result = await service.resolveProductQuery('1608');
  assert.equal(result.product, undefined);
  assert.deepEqual(result.results.map(item => item.REFERENCIA_STYLO), ['0433-1608-437', '9999-1608-999']);
});

test('STYLE exacto gana una colisión numérica con CODARTICULO y no mezcla estilos', async () => {
  const service = new ProductService({
    findByBarcode: async () => null,
    findByReference: async () => [],
    findBySupplierRef: async () => [],
    findByStyle: async style => style === '9153' ? [{ ref: '0395-9153-400', style: '9153', stock: 2 }] : [],
    findByArticleCode: async () => [{ ref: '0131-6287-329', style: '6287', stock: 0 }],
    searchProductsByStyle: async () => [
      { ref: '0395-9153-400', style: '9153', stockTotal: 14 },
      { ref: '1165-9153-006', style: '9153', stockTotal: 6 }
    ]
  });
  const result = await service.resolveProductQuery('9153');
  assert.deepEqual(result.results.map(item => item.STYLE), ['9153', '9153']);
  assert.equal(result.product, undefined);
});

test('resolución exacta conserva barcode, referencia, REFPROVEEDOR y CODARTICULO', async () => {
  const exactRows = {
    barcode: { ref: 'BARCODE', style: 'B' },
    reference: { ref: 'REFERENCE', style: 'R' },
    supplier: { ref: 'SUPPLIER', style: 'S' },
    article: { ref: 'ARTICLE', style: 'A' }
  };
  const service = new ProductService({
    findByBarcode: async value => value === '111' ? exactRows.barcode : null,
    findByReference: async value => value === 'REF-1' ? [exactRows.reference] : [],
    findBySupplierRef: async value => value === 'SUP-1' ? [exactRows.supplier] : [],
    findByStyle: async () => [],
    findByArticleCode: async value => value === 42 ? [exactRows.article] : [],
    findByQuery: async () => { throw new Error('findByQuery no debe resolver tipos exactos'); }
  });
  assert.equal((await service.resolveProductQuery('111')).product.STYLE, 'B');
  assert.equal((await service.resolveProductQuery('REF-1')).product.STYLE, 'R');
  assert.equal((await service.resolveProductQuery('SUP-1')).product.STYLE, 'S');
  assert.equal((await service.resolveProductQuery('42')).product.STYLE, 'A');
});

test('incluye los datos esenciales para atención al cliente y no expone costos', async () => {
  const result = await new ProductService(repo).getProductByQuery('111');
  assert.equal(result.price, 41700);
  assert.equal(result.additionalDescription, 'Denim Shorts');
  assert.equal(result.material, '98% algodón, 2% elastano');
  assert.equal(result.colorDescription, 'LIGHT VINTAGE');
  assert.equal(result.colorSpanish, 'AZUL');
  assert.equal(typeof result.COSTEESTOCK, 'undefined');
  assert.equal(typeof result.COSTESTOCK, 'undefined');
  assert.equal(typeof result.COSTO_TOTAL, 'undefined');
});

test('incluye mismo STYLE y misma familia, deduplica colores y agrega miniaturas', async () => {
  assert.deepEqual((await product('111')).relatedColors, [
    { color: '100', colorDescription: 'TRUE BLACK', colorSpanish: 'NEGRO', reference: '0433-1608-100', image: 'https://s7d2.scene7.com/is/image/aeo/0433_1608_100_f' },
    { color: '200', colorDescription: 'OLIVE', colorSpanish: 'OLIVA', reference: '0433-1608-300', image: 'https://s7d2.scene7.com/is/image/aeo/0433_1608_300_f' }
  ]);
});

test('excluye mismo STYLE con familia distinta', async () => {
  assert.ok(!(await product('111')).relatedColors.some(variant => variant.color === '999'));
});

test('excluye misma familia con STYLE distinto', async () => {
  assert.ok(!(await product('111')).relatedColors.some(variant => variant.color === '888'));
});

test('devuelve relatedColors vacío para referencia inválida', async () => {
  assert.deepEqual((await product('999')).relatedColors, []);
});

test('consulta una variante por REFERENCIA_STYLO', async () => {
  const result = await new ProductService(repo).getProductByReference('0433-1608-100');
  assert.equal(result.REFERENCIA_STYLO, '0433-1608-100');
  assert.equal(result.color, '100');
  assert.equal(result.barcode, '555');
});

test('conserva STYLE internamente y expone el barcode de la fila representativa', async () => {
  const result = await new ProductService(repo).getProductByReference('0433-1608-437');
  assert.equal(result.STYLE, '1608');
  assert.equal(result.barcode, '111');
});

test('cada talla conserva barcode y usa CODBARRAS2 como fallback', async () => {
  const fallbackRows = [
    { ref: 'FALLBACK', style: '1', size: 'S', stock: 0, CODBARRAS: '', CODBARRAS2: '222' },
    { ref: 'FALLBACK', style: '1', size: 'M', stock: -1, CODBARRAS: '333', CODBARRAS2: '444' }
  ];
  const service = new ProductService({ findByReference: async () => fallbackRows, findByStyle: async () => fallbackRows });
  const result = await service.getProduct(fallbackRows[0]);
  assert.deepEqual(result.sizes, [
    { size: 'S', stock: 0, barcode: '222', barcode2: '222' },
    { size: 'M', stock: -1, barcode: '333', barcode2: '444' }
  ]);
  assert.equal(result.sizes[0].stock, 0);
  assert.equal(result.sizes[1].stock, -1);
});

test('consulta exacta conserva en ProductService la talla con stock cero', async () => {
  const exact = { ref: 'EXACT-0', style: '1', size: 'S', stock: 0, CODBARRAS: '000' };
  const service = new ProductService({
    findByReference: async () => [exact],
    findByStyle: async () => [exact]
  });

  const result = await service.getProduct(exact);

  assert.equal(result.stock, 0);
  assert.deepEqual(result.sizes, [{ size: 'S', stock: 0, barcode: '000', barcode2: '' }]);
});

test('referencia inexistente devuelve null', async () => {
  assert.equal(await new ProductService(repo).getProductByReference('0433-1608-404'), null);
});

test('relatedColors solo incluye variantes con suma de stock positiva', async () => {
  const variantRows = [
    { ref: '0433-1608-437', style: '1608', color: '437', size: 'S', stock: 1 },
    { ref: '0433-1608-100', style: '1608', color: '100', size: 'S', stock: 3 },
    { ref: '0433-1608-100', style: '1608', color: '100', size: 'M', stock: -1 },
    { ref: '0433-1608-200', style: '1608', color: '200', size: 'S', stock: 0 },
    { ref: '0433-1608-300', style: '1608', color: '300', size: 'S', stock: -1 }
  ];
  const service = new ProductService({
    findByQuery: async value => variantRows.find(row => row.CODBARRAS === value) ?? null,
    findByReference: async ref => variantRows.filter(row => row.ref === ref),
    findByStyle: async style => variantRows.filter(row => row.style === style)
  });
  const result = await service.getProductByQuery('missing')
    .catch(() => null);
  assert.equal(result, null);
  const product = await service.getProduct(variantRows[0]);
  assert.deepEqual(product.relatedColors.map(color => color.color), ['100']);
});

test('searchProducts agrupa por referencia, suma stock y limita resultados', async () => {
  const searchRepo = {
    searchProducts: async (_text, limit) => [{ ref: '0433-1608-437', style: '1608', description: 'Skinny', stockTotal: 51, sizesWithStock: 13, price: 100 }].slice(0, limit)
  };
  const results = await new ProductService(searchRepo).searchProducts('0433-1608-437', 20);
  assert.equal(results.length, 1); assert.equal(results[0].REFERENCIA_STYLO, '0433-1608-437'); assert.equal(results[0].stockTotal, 51); assert.equal(results[0].sizesWithStock, 13);
});

test('searchProducts rechaza texto menor a dos caracteres', async () => {
  const service = new ProductService({ searchProducts: async () => { throw new Error('should not search'); } });
  assert.deepEqual(await service.searchProducts('a'), []);
});

test('expone operaciones de navegación de catálogo', async () => {
  const catalogRepo = {
    getDepartments: async () => ['MEN', 'WOMEN'],
    getSections: async () => ['MENS JEANS'],
    getFamilies: async () => ['SKINNY'],
    getProductsByCategory: async () => [{ ref: '0433-1608-437', style: '1608', description: 'Skinny', color: '437', price: 10, stockTotal: 5, sizesWithStock: 2 }]
  };
  const service = new ProductService(catalogRepo);
  assert.deepEqual(await service.getDepartments(), ['MEN', 'WOMEN']);
  assert.deepEqual(await service.getSections('MEN'), ['MENS JEANS']);
  assert.deepEqual(await service.getFamilies('MEN', 'MENS JEANS'), ['SKINNY']);
  assert.equal((await service.getProductsByCategory('MEN', 'MENS JEANS', 'SKINNY'))[0].REFERENCIA_STYLO, '0433-1608-437');
});
