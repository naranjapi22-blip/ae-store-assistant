import test from 'node:test';
import assert from 'node:assert/strict';
import { ExcelProductRepository } from '../src/repository/ExcelProductRepository.js';
import { createSyntheticExcel } from './fixtures/synthetic-excel.js';

const fixture = await createSyntheticExcel([
  { CODBARRAS: '400281669321', REFPROVEEDOR: '28166932', 'REFERENCIA STYLO': '0433-1608-437', Temporada: 'SPRING 2026', Stock: 1, Talla: 'S' }
], 'excel-repository-');
const repository = () => new ExcelProductRepository(fixture.file);
test.after(() => fixture.cleanup());

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
