import test from 'node:test';
import assert from 'node:assert/strict';
import { ExcelProductRepository } from '../src/repository/ExcelProductRepository.js';
import { createSyntheticExcel } from './fixtures/synthetic-excel.js';

const fixture = await createSyntheticExcel([
  { CODBARRAS: '400281669321', 'REFERENCIA STYLO': '0433-1608-437', STYLE: '1608', Stock: 2, Talla: 'S', Departamento: 'WOMEN', Seccion: 'JEANS', Familia: 'SKINNY' },
  { CODBARRAS: '400281669322', 'REFERENCIA STYLO': '0433-1608-437', STYLE: '1608', Stock: 1, Talla: 'M', Departamento: 'WOMEN', Seccion: 'JEANS', Familia: 'SKINNY' },
  { CODBARRAS: '400281669323', 'REFERENCIA STYLO': '0703-2143-073', STYLE: '2143', Stock: 2, Talla: 'S', Departamento: 'AERIE', Seccion: 'SKIRTS', Familia: '703' },
  { CODBARRAS: '400281669324', 'REFERENCIA STYLO': '0703-2143-119', STYLE: '2143', Stock: 3, Talla: 'M', Departamento: 'AERIE', Seccion: 'SKIRTS', Familia: '703' },
  { CODBARRAS: '400281669325', 'REFERENCIA STYLO': '9999-2143-200', STYLE: '2143', Stock: 1, Talla: 'L', Departamento: 'AERIE', Seccion: 'SKIRTS', Familia: '703' }
], 'catalog-search-');
const repository = () => new ExcelProductRepository(fixture.file);
test.after(() => fixture.cleanup());

test('b?squeda real por referencia exacta agrupa tallas', async () => {
  const results = await repository().searchProducts('0433-1608-437', 20);
  assert.equal(results[0].ref, '0433-1608-437');
  assert.ok(results[0].sizesWithStock > 1);
});

test('b?squeda real por barcode exacto encuentra el producto', async () => {
  const results = await repository().searchProducts('400281669321', 20);
  assert.ok(results.some(result => result.ref === '0433-1608-437'));
});

test('STYLE devuelve referencias agrupadas y respeta el l?mite m?ximo', async () => {
  const results = await repository().searchProducts('2143', 20);
  assert.ok(results.length > 1);
  assert.ok(results.length <= 20);
});

test('descripci?n, color y referencia parcial no producen resultados', async () => {
  assert.deepEqual(await repository().searchProducts('skinny', 20), []);
  assert.deepEqual(await repository().searchProducts('black', 20), []);
  assert.deepEqual(await repository().searchProducts('0433-1608', 20), []);
});
