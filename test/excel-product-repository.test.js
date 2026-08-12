import test from 'node:test';
import assert from 'node:assert/strict';
import { ExcelProductRepository } from '../src/repository/ExcelProductRepository.js';

const repository = () => new ExcelProductRepository(new URL('../stock de tienda 30-06-2026.xls', import.meta.url));

test('lee el Excel real y conserva identificadores y temporada como strings', async () => {
  const row = await repository().findByBarcode('400281669321');
  assert.equal(typeof row.CODBARRAS, 'string');
  assert.equal(row.ref, '0433-1608-437');
  assert.equal(typeof row.supplierRef, 'string');
  assert.equal(row.supplierRef, '28166932');
  assert.equal(row.season, 'SPRING 2026');
});

test('busca el Excel real por REFPROVEEDOR', async () => {
  const row = await repository().findByQuery('28166932');
  assert.equal(row.CODBARRAS, '400281669321');
  assert.equal(row.ref, '0433-1608-437');
});
