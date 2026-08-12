import test from 'node:test';
import assert from 'node:assert/strict';
import { ExcelProductRepository } from '../src/repository/ExcelProductRepository.js';

const repo = new ExcelProductRepository('ae stock.xls');
const uniqueKeys = values => new Set(values.map(value => String(value).trim().toLocaleLowerCase()));

test('devuelve departamentos únicos y normalizados', async () => {
  const values = await repo.getDepartments();
  assert.ok(values.includes('WOMEN'));
  assert.equal(values.length, uniqueKeys(values).size);
  assert.ok(values.every(value => value.trim() === value));
});

test('filtra secciones y familias por sus antecesores', async () => {
  const department = 'WOMEN';
  const sections = await repo.getSections(department);
  assert.ok(sections.length > 0);
  const families = await repo.getFamilies(department, sections[0]);
  assert.ok(families.length > 0);
  assert.equal(families.length, uniqueKeys(families).size);
  assert.deepEqual(await repo.getFamilies('__missing__', sections[0]), []);
});

test('agrupa productos por referencia, suma stock y limita resultados', async () => {
  const departments = await repo.getDepartments();
  const sections = await repo.getSections(departments[0]);
  const families = await repo.getFamilies(departments[0], sections[0]);
  const products = await repo.getProductsByCategory(departments[0], sections[0], families[0], 20);
  assert.ok(products.length > 0);
  assert.equal(products.length, new Set(products.map(product => product.ref)).size);
  assert.ok(products.every(product => Number.isFinite(product.stockTotal)));
  assert.ok(products.length <= 20);
  assert.deepEqual(await repo.getProductsByCategory('__missing__', sections[0], families[0]), []);
});
