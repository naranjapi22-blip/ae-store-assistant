import test from 'node:test';
import assert from 'node:assert/strict';
import { ExcelProductRepository } from '../src/repository/ExcelProductRepository.js';

const repository = () => new ExcelProductRepository(new URL('../stock de tienda 30-06-2026.xls', import.meta.url));

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
