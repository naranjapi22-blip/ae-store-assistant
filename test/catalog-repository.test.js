import test from 'node:test';
import assert from 'node:assert/strict';
import { ExcelProductRepository } from '../src/repository/ExcelProductRepository.js';

const repo = new ExcelProductRepository('ae stock.xls');
const uniqueKeys = values => new Set(values.map(value => String(value).trim().toLocaleLowerCase()));

test('devuelve departamentos únicos y normalizados', async () => {
  const values = await repo.getDepartments();
  assert.ok(values.includes('WOMEN'));
  assert.ok(!values.some(value => value.trim().toLocaleLowerCase() === 'muebles'));
  assert.equal(values.length, uniqueKeys(values).size);
  assert.ok(values.every(value => value.trim() === value));
});

test('oculta MUEBLES con comparación case-insensitive y trim-safe sin afectar búsqueda directa', async () => {
  const isolated = new ExcelProductRepository('ae stock.xls');
  isolated.rows = [
    { department: 'MUEBLES', ref: 'MUEBLE-001', CODBARRAS: '401', CODBARRAS2: '', supplierRef: '', reference: '', articleCode: '' },
    { department: ' muebles ', ref: 'MUEBLE-002', CODBARRAS: '402', CODBARRAS2: '', supplierRef: '', reference: '', articleCode: '' },
    { department: 'Muebles', ref: 'MUEBLE-003', CODBARRAS: '403', CODBARRAS2: '', supplierRef: '', reference: '', articleCode: '' },
    { department: 'WOMEN', ref: 'WOMEN-001', CODBARRAS: '404', CODBARRAS2: '', supplierRef: '', reference: '', articleCode: '' }
  ];
  const departments = await isolated.getDepartments();
  assert.deepEqual(departments, ['WOMEN']);
  assert.equal((await isolated.findByQuery('401')).ref, 'MUEBLE-001');
  assert.equal((await isolated.findByQuery('MUEBLE-002')).department, ' muebles ');
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

test('encuentra similares por clasificación, excluye referencia y stock cero, y ordena por stock', async () => {
  const isolated = new ExcelProductRepository('ae stock.xls');
  isolated.rows = [
    { ref: 'CURRENT', department: 'WOMEN', section: 'JEANS', family: 'SKINNY', stock: 9, size: 'S', description: 'Current' },
    { ref: 'LOW', department: 'WOMEN', section: 'JEANS', family: 'SKINNY', stock: 2, size: 'S', description: 'Low' },
    { ref: 'LOW', department: 'WOMEN', section: 'JEANS', family: 'SKINNY', stock: 3, size: 'M', description: 'Low' },
    { ref: 'ZERO', department: 'WOMEN', section: 'JEANS', family: 'SKINNY', stock: 0, size: 'S', description: 'Zero' },
    { ref: 'OTHER-DEPT', department: 'MEN', section: 'JEANS', family: 'SKINNY', stock: 99, size: 'S', description: 'Other' },
    { ref: 'OTHER-SECTION', department: 'WOMEN', section: 'TOPS', family: 'SKINNY', stock: 99, size: 'S', description: 'Other' },
    { ref: 'OTHER-FAMILY', department: 'WOMEN', section: 'JEANS', family: 'BOOTCUT', stock: 99, size: 'S', description: 'Other' }
  ];
  const results = await isolated.findSimilarProducts({ department: 'WOMEN', section: 'JEANS', family: 'SKINNY', excludeReference: 'CURRENT', limit: 6 });
  assert.deepEqual(results.map(row => row.ref), ['LOW']);
  assert.equal(results[0].stockTotal, 5);
  assert.equal(results[0].sizesWithStock, 2);
});

test('excluye variantes del mismo producto base pero permite el mismo STYLE de otra familia', async () => {
  const isolated = new ExcelProductRepository('ae stock.xls');
  isolated.rows = [
    { ref: '0703-2143-073', style: '2143', department: 'AERIE', section: 'SKIRTS', family: '703', stock: 2, size: 'M' },
    { ref: '0703-2143-119', style: '2143', department: 'AERIE', section: 'SKIRTS', family: '703', stock: 10, size: 'M' },
    { ref: '9999-2143-200', style: '2143', department: 'AERIE', section: 'SKIRTS', family: '703', stock: 8, size: 'M' },
    { ref: '0703-9999-300', style: '9999', department: 'AERIE', section: 'SKIRTS', family: '703', stock: 6, size: 'M' }
  ];
  const results = await isolated.findSimilarProducts({ department: 'AERIE', section: 'SKIRTS', family: '703', excludeReference: '0703-2143-073', limit: 6 });
  assert.deepEqual(results.map(row => row.ref), ['9999-2143-200', '0703-9999-300']);
});
