import test from 'node:test';
import assert from 'node:assert/strict';
import { productApi } from '../src/api/productApi.js';

const service = {
  getProductByBarcode: async () => null,
  getProductByReference: async reference => reference === '1177-1541-100' ? { REFERENCIA_STYLO: reference, relatedColors: [] } : null
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

test('endpoint por reference inexistente devuelve 404', async () => {
  const res = response(); await productApi(service)(request('/api/products/reference/1177-1541-404'), res);
  assert.equal(res.state.status, 404);
});
