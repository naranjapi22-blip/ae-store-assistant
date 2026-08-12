import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductService } from '../src/service/ProductService.js';
import { productApi } from '../src/api/productApi.js';

const rows = [
  { ref: 'CURRENT', department: 'WOMEN', section: 'JEANS', family: 'SKINNY', description: 'Current', style: '1', color: '001', size: 'S', stock: 2 },
  { ref: 'SIMILAR', department: 'WOMEN', section: 'JEANS', family: 'SKINNY', description: 'Similar', style: '2', color: '002', price: 10, stockTotal: 8, sizesWithStock: 3 },
  { ref: 'OTHER', department: 'MEN', section: 'JEANS', family: 'SKINNY', description: 'Other', stockTotal: 99, sizesWithStock: 5 }
];
const repo = {
  findByReference: async reference => rows.filter(row => row.ref === reference),
  findSimilarProducts: async options => options.excludeReference === 'CURRENT' ? [rows[1]] : []
};

test('ProductService resuelve clasificación y devuelve tarjetas resumidas', async () => {
  const result = await new ProductService(repo).getSimilarProducts('CURRENT');
  assert.equal(result.length, 1);
  assert.equal(result[0].REFERENCIA_STYLO, 'SIMILAR');
  assert.equal(result[0].stockTotal, 8);
});

test('referencia inexistente devuelve null y permite que la API responda 404', async () => {
  const service = new ProductService(repo);
  assert.equal(await service.getSimilarProducts('MISSING'), null);
  const state = { status: null, body: '' };
  const response = { writeHead: status => { state.status = status; }, end: body => { state.body = body ?? ''; }, setHeader: () => {} };
  await productApi(service)({ url: '/api/products/reference/MISSING/similar' }, response);
  assert.equal(state.status, 404);
});

test('API de similares devuelve array vacío cuando no hay alternativas', async () => {
  const service = new ProductService({ findByReference: async () => [rows[0]], findSimilarProducts: async () => [] });
  const state = { status: null, body: '' };
  const response = { writeHead: status => { state.status = status; }, end: body => { state.body = body ?? ''; }, setHeader: () => {} };
  await productApi(service)({ url: '/api/products/reference/CURRENT/similar' }, response);
  assert.equal(state.status, 200);
  assert.deepEqual(JSON.parse(state.body), { results: [] });
});

test('una variante excluida de similares sigue siendo una relatedColor', async () => {
  const product = {
    ref: '0703-2143-073', style: '2143', color: '073', department: 'AERIE', section: 'SKIRTS', family: '703',
    description: 'Current', size: 'M', stock: 2
  };
  const variant = { ...product, ref: '0703-2143-119', color: '119', description: 'Variant' };
  const service = new ProductService({
    findByReference: async reference => reference === product.ref ? [product] : [variant],
    findByStyle: async () => [product, variant],
    findSimilarProducts: async () => []
  });
  const result = await service.getProduct(product);
  assert.equal(result.relatedColors[0].reference, '0703-2143-119');
});
