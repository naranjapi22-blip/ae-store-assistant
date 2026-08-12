import test from 'node:test';
import assert from 'node:assert/strict';
import { ExcelProductRepository } from '../src/repository/ExcelProductRepository.js';

const repository = () => new ExcelProductRepository(new URL('../stock de tienda 30-06-2026.xls', import.meta.url));

test('búsqueda real por palabra es case-insensitive y deduplica tallas', async () => {
  const results = await repository().searchProducts('skinny', 20);
  assert.ok(results.length > 0);
  assert.ok(results.every(result => result.ref));
  assert.equal(new Set(results.map(result => result.ref)).size, results.length);
});

test('búsqueda real por varias palabras encuentra campos combinados', async () => {
  const results = await repository().searchProducts('skinny 437', 20);
  assert.ok(results.some(result => result.ref === '0433-1608-437'));
});

test('búsqueda real respeta el límite máximo de 20', async () => {
  const results = await repository().searchProducts('a', 100);
  assert.ok(results.length <= 20);
});
