import test from 'node:test';
import assert from 'node:assert/strict';
import { productApi } from '../src/api/productApi.js';

const service = {
  getDepartments: async () => ['MEN', 'WOMEN'],
  getSections: async department => department === 'MEN' ? ['MENS JEANS'] : [],
  getFamilies: async (department, section) => department === 'MEN' && section === 'MENS JEANS' ? ['SKINNY'] : [],
  getProductsByCategory: async () => [{ REFERENCIA_STYLO: '0433-1608-437' }]
};
const request = url => ({ url });
const response = () => {
  const state = { status: null, headers: {}, body: '' };
  return { state, setHeader: (key, value) => { state.headers[key] = value; }, writeHead: (status, headers) => { state.status = status; Object.assign(state.headers, headers); }, end: body => { state.body = body ?? ''; } };
};

test('expone departamentos, secciones, familias y productos de catálogo', async () => {
  let res = response(); await productApi(service)(request('/api/catalog/departments'), res);
  assert.deepEqual(JSON.parse(res.state.body).departments, ['MEN', 'WOMEN']);
  res = response(); await productApi(service)(request('/api/catalog/sections?department=MEN'), res);
  assert.deepEqual(JSON.parse(res.state.body).sections, ['MENS JEANS']);
  res = response(); await productApi(service)(request('/api/catalog/families?department=MEN&section=MENS%20JEANS'), res);
  assert.deepEqual(JSON.parse(res.state.body).families, ['SKINNY']);
  res = response(); await productApi(service)(request('/api/catalog/products?department=MEN&section=MENS%20JEANS&family=SKINNY'), res);
  assert.equal(JSON.parse(res.state.body).results[0].REFERENCIA_STYLO, '0433-1608-437');
});

test('rechaza filtros obligatorios faltantes', async () => {
  const res = response(); await productApi(service)(request('/api/catalog/sections'), res);
  assert.equal(res.state.status, 400);
});
