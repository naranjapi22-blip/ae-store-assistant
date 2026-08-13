import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configFromEnv, envFromConfig, isConnectionConfig, isUsableConfig, publicConfig } from '../src/config/environment.js';
import { LocalConfigStore } from '../src/config/LocalConfigStore.js';
import { WAREHOUSE_QUERY, SqlServerWarehouseRepository } from '../src/repository/SqlServerWarehouseRepository.js';
import { SqlServerProductRepository } from '../src/repository/SqlServerProductRepository.js';
import { WarehouseService } from '../src/service/WarehouseService.js';
import { createApplicationServer, startServer } from '../src/server.js';

const secureValue = value => Buffer.from(`encrypted:${value}`);
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: secureValue,
  decryptString: value => Buffer.from(value).toString().replace(/^encrypted:/, '')
};

test('carga configuración SQL y conserva almacén configurable', () => {
  const config = configFromEnv({
    DB_SERVER: 'db-host', DB_PORT: '1433', DB_DATABASE: 'AEStore', DB_USER: 'reader', DB_PASSWORD: 'runtime-only',
    DB_ENCRYPT: 'false', DB_TRUST_SERVER_CERTIFICATE: 'true', STORE_WAREHOUSE: 'V11', SALES_TARIFF_ID: '5', SALES_PRICE_FORMAT: '0'
  });
  assert.equal(config.server, 'db-host');
  assert.equal(config.warehouseCode, 'V11');
  assert.deepEqual(envFromConfig(config).STORE_WAREHOUSE, 'V11');
  assert.equal(isUsableConfig(config), true);
  assert.equal(publicConfig(config).password, undefined);
});

test('configuración incompleta se considera no válida', () => {
  assert.equal(isUsableConfig({ server: 'localhost', database: 'db', warehouseCode: 'V08' }), false);
});

test('testConnection acepta conexión completa sin almacén', async t => {
  let testedConfig;
  const application = await startServer({
    env: { DATA_SOURCE: 'sqlserver' },
    requireWarehouse: true,
    port: 0,
    testConnection: async config => {
      testedConfig = config;
      return { databaseName: 'AEStore', warehouses: [{ warehouseCode: 'V11', warehouseName: 'VENTAS CITY MALL CRI' }] };
    }
  });
  t.after(() => application.close());
  const address = application.server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/config/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      server: 'db-host', port: 1433, database: 'AEStore', user: 'reader', password: 'synthetic-test-password',
      warehouseCode: '', tariff: 5, priceFormat: 0, encrypt: false, trustServerCertificate: true
    })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(isConnectionConfig(testedConfig), true);
  assert.equal(testedConfig.warehouseCode, '');
  assert.equal(body.config.warehouseCode, '');
  assert.deepEqual(body.warehouses.map(item => item.warehouseCode), ['V11']);
});

test('guardar configuración requiere conexión validada y almacén', async t => {
  const application = await startServer({
    env: { DATA_SOURCE: 'sqlserver' },
    requireWarehouse: true,
    port: 0,
    configStore: { save: async () => { throw new Error('no debe guardar'); } },
    testConnection: async () => ({
      databaseName: 'AEStore',
      warehouses: [{ warehouseCode: 'V11', warehouseName: 'VENTAS CITY MALL CRI' }]
    })
  });
  t.after(() => application.close());
  const address = application.server.address();
  const connection = {
    server: 'db-host', port: 1433, database: 'AEStore', user: 'reader', password: 'synthetic-test-password',
    tariff: 5, priceFormat: 0, encrypt: false, trustServerCertificate: true
  };
  const withoutTest = await fetch(`http://127.0.0.1:${address.port}/api/config/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...connection, warehouseCode: 'V11' })
  });
  assert.equal(withoutTest.status, 400);
  assert.match((await withoutTest.json()).error, /Prueba la conexión/);

  const tested = await fetch(`http://127.0.0.1:${address.port}/api/config/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...connection, warehouseCode: '' })
  });
  assert.equal(tested.status, 200);
  const withoutWarehouse = await fetch(`http://127.0.0.1:${address.port}/api/config/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...connection, warehouseCode: '' })
  });
  assert.equal(withoutWarehouse.status, 400);
  assert.equal((await withoutWarehouse.json()).error, 'Selecciona una tienda.');
});

test('LocalConfigStore cifra credenciales y no guarda contraseña en texto plano', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ae-store-config-'));
  try {
    const store = new LocalConfigStore({ directory, safeStorage });
    const password = ['runtime', 'credential'].join('-');
    await store.save({
      config: { server: 'localhost', database: 'db', warehouseCode: 'V08', warehouseName: 'Store', user: 'reader', password },
      user: 'reader',
      password
    });
    const configFile = await readFile(path.join(directory, 'config.json'), 'utf8');
    const credentialsFile = await readFile(path.join(directory, 'credentials.json'), 'utf8');
    assert.doesNotMatch(configFile, new RegExp(password));
    assert.doesNotMatch(credentialsFile, new RegExp(password));
    assert.deepEqual((await store.load()).credentials, { user: 'reader', password });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('almacenes se consultan con SELECT y devuelven código y nombre', async () => {
  const calls = [];
  const pool = { request() {
    return { timeout: null, async query(text) { calls.push(text); return { recordset: [
      { warehouseCode: 'V11', warehouseName: 'VENTAS CITY MALL CRI' },
      { warehouseCode: 'M08', warehouseName: 'MERMAS ESCAZU CRI' }
    ] }; } };
  } };
  const warehouses = await new SqlServerWarehouseRepository({ pool }).listWarehouses();
  assert.deepEqual(warehouses.map(item => item.warehouseCode), ['V11', 'M08']);
  assert.equal(warehouses[1].isLikelySales, false);
  assert.match(calls[0], /^\s*SELECT/i);
  assert.match(calls[0], /A\.NOMBREALMACEN/);
  assert.doesNotMatch(calls[0], /A\.DESCRIPCION/);
  assert.doesNotMatch(calls[0], /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
});

test('WarehouseService expone el catálogo de almacenes sin conocer SQL', async () => {
  const repository = { listWarehouses: async () => [{ warehouseCode: 'V08', warehouseName: 'VENTAS ESCAZU CRI' }] };
  assert.deepEqual(await new WarehouseService(repository).getWarehouses(), [{ warehouseCode: 'V08', warehouseName: 'VENTAS ESCAZU CRI' }]);
});

test('V08 y V11 se envían como parámetros distintos al repository', async () => {
  const calls = [];
  const pool = { request() {
    const params = {};
    const request = { input(name, _type, value) { params[name] = value; return request; }, async query(text) { calls.push({ text, params }); return { recordset: [] }; } };
    return request;
  } };
  await new SqlServerProductRepository({ pool, env: { STORE_WAREHOUSE: 'V08', SALES_TARIFF_ID: '5' } }).findByBarcode('400281669321');
  await new SqlServerProductRepository({ pool, env: { STORE_WAREHOUSE: 'V11', SALES_TARIFF_ID: '5' } }).findByBarcode('400281669321');
  assert.equal(calls[0].params.warehouse, 'V08');
  assert.equal(calls[1].params.warehouse, 'V11');
});

test('Electron sin configuración no crea repositorio ni asume V08', () => {
  const application = createApplicationServer({ env: { DATA_SOURCE: 'sqlserver' }, requireWarehouse: true });
  assert.equal(application.getService(), null);
  assert.equal(application.getConfig().warehouseCode, '');
  assert.equal(application.getConfig().configured, false);
});

test('la configuración rechaza un almacén que no fue descubierto', async t => {
  const application = await startServer({
    env: { DATA_SOURCE: 'sqlserver' },
    requireWarehouse: true,
    port: 0,
    configStore: { save: async () => {} },
    testConnection: async () => ({
      databaseName: 'AEStore',
      warehouses: [{ warehouseCode: 'V08', warehouseName: 'VENTAS ESCAZU CRI' }, { warehouseCode: 'V11', warehouseName: 'VENTAS CITY MALL CRI' }]
    })
  });
  t.after(() => application.close());
  const address = application.server.address();
  const connection = {
    server: 'db-host', port: 1433, database: 'AEStore', user: 'reader', password: 'synthetic-test-password',
    warehouseCode: '', tariff: 5, priceFormat: 0, encrypt: false, trustServerCertificate: true
  };
  const tested = await fetch(`http://127.0.0.1:${address.port}/api/config/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(connection)
  });
  assert.equal(tested.status, 200);
  const response = await fetch(`http://127.0.0.1:${address.port}/api/config/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...connection, warehouseCode: 'V99' })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /no existe/);
});

test('guardar configuración selecciona almacén y no devuelve credenciales', async t => {
  const saved = [];
  const application = await startServer({
    env: { DATA_SOURCE: 'sqlserver' },
    requireWarehouse: true,
    port: 0,
    configStore: { save: async value => saved.push(value) },
    testConnection: async () => ({
      databaseName: 'AEStore',
      warehouses: [{ warehouseCode: 'V11', warehouseName: 'VENTAS CITY MALL CRI' }]
    })
  });
  t.after(() => application.close());
  const address = application.server.address();
  const connection = {
    server: 'db-host', port: 1433, database: 'AEStore', user: 'reader', password: 'synthetic-test-password',
    warehouseCode: '', tariff: 5, priceFormat: 0, encrypt: false, trustServerCertificate: true
  };
  const tested = await fetch(`http://127.0.0.1:${address.port}/api/config/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(connection)
  });
  assert.equal(tested.status, 200);
  const response = await fetch(`http://127.0.0.1:${address.port}/api/config/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...connection, warehouseCode: 'V11' })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.config.warehouseCode, 'V11');
  assert.equal(body.config.password, undefined);
  assert.equal(body.config.user, undefined);
  assert.equal(application.getConfig().warehouseCode, 'V11');
  assert.ok(application.getService());
  assert.equal(saved[0].config.warehouseCode, 'V11');
});
