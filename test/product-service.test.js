import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductService } from '../src/service/ProductService.js';

const rows = [
  { CODBARRAS: '111', CODBARRAS2: '222', description: 'Producto base', ref: '0433-1608-437', style: '1608', color: '437', size: '2 REGULAR', stock: 4 },
  { CODBARRAS: '333', description: 'Producto base', ref: '0433-1608-437', style: '1608', color: '437', size: '4 REGULAR', stock: 2 },
  { CODBARRAS: '666', description: 'Producto base', ref: '0433-1608-437', style: '1608', color: '437', size: '4 REGULAR', stock: 3 },
  { CODBARRAS: '555', description: 'Descripción distinta', ref: '0433-1608-100', style: '1608', color: '100', size: '2 REGULAR', stock: 2 },
  { CODBARRAS: '777', description: 'Otra familia', ref: '9999-1608-999', style: '1608', color: '999', size: 'M', stock: 1 },
  { CODBARRAS: '888', description: 'Misma familia, otro style', ref: '0433-9999-888', style: '9999', color: '888', size: 'M', stock: 1 },
  { CODBARRAS: '999', description: 'Referencia inválida', ref: 'INVALID', style: '1608', color: '321', size: 'M', stock: 1 },
  { CODBARRAS: '1000', description: 'Color duplicado', ref: '0433-1608-200', style: '1608', color: '200', size: 'S', stock: 1 },
  { CODBARRAS: '1001', description: 'Color duplicado', ref: '0433-1608-300', style: '1608', color: '200', size: 'M', stock: 1 }
];

const repo = {
  findByBarcode: async code => rows.find(row => row.CODBARRAS === code || row.CODBARRAS2 === code) ?? null,
  findByReference: async ref => rows.filter(row => row.ref === ref),
  findByStyle: async style => rows.filter(row => row.style === style)
};

const product = barcode => new ProductService(repo).getProductByBarcode(barcode);

test('busca por CODBARRAS y CODBARRAS2 y agrupa tallas', async () => {
  const result = await product('222');
  assert.equal(result.scannedSize, '2 REGULAR');
  assert.deepEqual(result.sizes, [{ size: '2 REGULAR', stock: 4 }, { size: '4 REGULAR', stock: 5 }]);
});

test('incluye mismo STYLE y misma familia aunque la descripción sea distinta', async () => {
  assert.deepEqual((await product('111')).relatedColors, [{ color: '100', reference: '0433-1608-100' }, { color: '200', reference: '0433-1608-300' }]);
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

test('devuelve colores duplicados una sola vez', async () => {
  assert.equal((await product('111')).relatedColors.filter(variant => variant.color === '200').length, 1);
});

test('consulta una variante por REFERENCIA_STYLO', async () => {
  const result = await new ProductService(repo).getProductByReference('0433-1608-100');
  assert.equal(result.REFERENCIA_STYLO, '0433-1608-100');
  assert.equal(result.color, '100');
});

test('referencia inexistente devuelve null', async () => {
  assert.equal(await new ProductService(repo).getProductByReference('0433-1608-404'), null);
});
