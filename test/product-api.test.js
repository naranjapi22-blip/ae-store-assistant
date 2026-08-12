import test from 'node:test';
import assert from 'node:assert/strict';
import { productApi } from '../src/api/productApi.js';

const service = {
  getProductByBarcode: async query => query === '400281669321' ? { REFERENCIA_STYLO: '0433-1608-437', season: 'SPRING 2026' } : null,
  getProductByQuery: async query => query === '28166932' ? { REFERENCIA_STYLO: '0433-1608-437', season: 'SPRING 2026' } : null,
  getProductByReference: async reference => reference === '1177-1541-100' ? { REFERENCIA_STYLO: reference, relatedColors: [] } : null
  ,searchProducts: async (query, limit) => query === 'skinny black' ? [{ REFERENCIA_STYLO: '0433-1608-437', stockTotal: 51, sizesWithStock: 13 }].slice(0, limit) : []
};

const request = path => ({ url: path });
const response = () => {
  const state = { status: null, headers: {}, body: '' };
  return { state, setHeader: (key, value) => { state.headers[key] = value; }, writeHead: (status, headers) => { state.status = status; Object.assign(state.headers, headers); }, end: body => { state.body = body ?? ''; } };
};

test('endpoint por reference devuelve la variante correcta', async () => {
  const res = response(); await productApi(service)(request('/api/products/reference/1177-1541-100'), res);
  assert.equal(res.state.status, 200); assert.equal(JSON.parse(res.state.body).REFERENCIA_STYLO, '1177-1541-100');
});

test('endpoint principal acepta REFPROVEEDOR y devuelve temporada', async () => {
  const res = response(); await productApi(service)(request('/api/products/28166932'), res);
  assert.equal(res.state.status, 200); assert.equal(JSON.parse(res.state.body).season, 'SPRING 2026');
});

test('endpoint principal devuelve 404 para REFPROVEEDOR inexistente', async () => {
  const res = response(); await productApi(service)(request('/api/products/unknown-ref'), res);
  assert.equal(res.state.status, 404);
});

test('endpoint por reference inexistente devuelve 404', async () => {
  const res = response(); await productApi(service)(request('/api/products/reference/1177-1541-404'), res);
  assert.equal(res.state.status, 404);
});

test('endpoint de búsqueda devuelve resultados de catálogo', async () => {
  const res = response(); await productApi(service)(request('/api/products/search?q=skinny%20black'), res);
  assert.equal(res.state.status, 200); assert.equal(JSON.parse(res.state.body).results[0].REFERENCIA_STYLO, '0433-1608-437');
});

test('endpoint de búsqueda valida texto vacío o demasiado corto', async () => {
  const res = response(); await productApi(service)(request('/api/products/search?q=a'), res);
  assert.equal(res.state.status, 400);
});
