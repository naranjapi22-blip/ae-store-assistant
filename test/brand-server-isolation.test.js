import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { startServer } from '../src/server.js';
import { startVsServer } from '../src/vsServer.js';

const realStock = path.resolve('..', 'VSImageTest', 'Stock de Histria Julio.xlsx');
const realCoverage = path.resolve('..', 'VSImageTest', 'resultado_imagenes_confiables.xlsx');
const baseUrl = application => `http://127.0.0.1:${application.server.address().port}`;

test('servidor VS inicia sin configuración AEO y atiende su propia UI/API', { skip: !existsSync(realStock) }, async () => {
  const application = await startVsServer({ port: 0, env: { VS_STOCK_FILE: realStock, VS_IMAGE_COVERAGE_FILE: realCoverage } });
  try {
    const url = baseUrl(application);
    const page = await fetch(url);
    const product = await fetch(`${url}/api/vs/products/667559793106`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /VICTORIA'S SECRET/);
    assert.equal(product.status, 200);
    assert.equal((await product.json()).barcode, '667559793106');
  } finally { await application.close(); }
});

test('servidor AEO inicia sin archivos VS y no depende del código VS', async () => {
  const application = await startServer({ port: 0, env: { DATA_SOURCE: 'sqlserver', VS_STOCK_FILE: '' } });
  try {
    const url = baseUrl(application);
    const page = await fetch(url);
    const vs = await fetch(`${url}/api/vs/products/667559793106`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /AE Store Assistant/);
    assert.equal(vs.status, 503);
  } finally { await application.close(); }
});

test('las entradas mantienen dependencias separadas y la UI AEO no contiene VS', () => {
  const aeoServer = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const vsServer = readFileSync(new URL('../src/vsServer.js', import.meta.url), 'utf8');
  const aeoUi = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8') + readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(aeoServer, /VsExcel|vsProductApi|VsProductService/);
  assert.doesNotMatch(vsServer, /SqlServer|createProductRepository|configStore/);
  assert.doesNotMatch(aeoUi, /Victoria|Victoria's|renderVsProduct|api\/vs/);
});
