import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createProductRepository } from './repository/createProductRepository.js';
import { ProductService } from './service/ProductService.js';
import { productApi } from './api/productApi.js';
import { loadEnvironment, configFromEnv, envFromConfig, isConnectionConfig, isUsableConfig, publicConfig } from './config/environment.js';
import { SqlServerWarehouseRepository, testSqlConnection, testSqlConnectionHealth } from './repository/SqlServerWarehouseRepository.js';
import { WarehouseService } from './service/WarehouseService.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, '..');

loadEnvironment();

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };
const safeError = () => ({ error: 'No se pudo completar la operación. Verifica la configuración e inténtalo nuevamente.' });

const inventoryPathFor = env => [
  env.INVENTORY_FILE,
  'ae stock.xls',
  'stock de tienda 30-06-2026.xls'
].filter(Boolean)
  .map(file => path.isAbsolute(file) ? file : path.resolve(projectRoot, file))
  .find(existsSync);

const readJsonBody = request => new Promise((resolve, reject) => {
  let body = '';
  request.on('data', chunk => {
    body += chunk;
    if (body.length > 32_768) reject(new Error('Request too large'));
  });
  request.on('end', () => {
    try { resolve(body ? JSON.parse(body) : {}); }
    catch { reject(new Error('Invalid JSON')); }
  });
  request.on('error', reject);
});

const configFromRequest = body => ({
  server: String(body.server || '').trim(),
  port: Number(body.port || 1433),
  database: String(body.database || '').trim(),
  user: String(body.user || '').trim(),
  password: String(body.password || ''),
  warehouseCode: String(body.warehouseCode || '').trim(),
  warehouseName: String(body.warehouseName || '').trim(),
  tariff: Number(body.tariff || 5),
  priceFormat: body.priceFormat === '' || body.priceFormat == null ? null : Number(body.priceFormat),
  encrypt: Boolean(body.encrypt),
  trustServerCertificate: Boolean(body.trustServerCertificate),
  requestTimeoutMs: 3000,
  connectionTimeoutMs: 3000
});

const connectionKey = config => JSON.stringify({
  server: config.server,
  port: config.port,
  database: config.database,
  user: config.user,
  password: config.password,
  encrypt: config.encrypt,
  trustServerCertificate: config.trustServerCertificate
});

const connectionErrorMessage = error => {
  const code = String(error?.code || '').toUpperCase();
  if (code.includes('LOGIN') || /login|password|credential/i.test(String(error?.message || ''))) return 'Credenciales incorrectas';
  if (/database|catalog/i.test(String(error?.message || ''))) return 'Base de datos no disponible';
  return 'No se pudo conectar al servidor';
};

export const createApplicationServer = ({
  env = process.env,
  initialConfig = null,
  configStore = null,
  requireWarehouse = false,
  testConnection = testSqlConnection,
  checkConnection = testSqlConnectionHealth,
  projectRoot: configuredProjectRoot = projectRoot
} = {}) => {
  let runtimeEnv = initialConfig ? { ...env, ...envFromConfig(initialConfig) } : { ...env };
  let repository = null;
  let service = null;
  let warehouseRepository = null;
  let warehouseService = null;
  let validatedConnectionKey = null;

  const closeRepository = async () => {
    if (repository?.close) await repository.close();
    if (warehouseRepository?.close) await warehouseRepository.close();
    repository = null;
    warehouseRepository = null;
    warehouseService = null;
    service = null;
  };

  const buildRuntime = () => {
    const source = String(runtimeEnv.DATA_SOURCE || 'excel').trim().toLowerCase();
    if (source === 'sqlserver') {
      const databaseConfig = configFromEnv(runtimeEnv);
      if (!isUsableConfig(databaseConfig)) return;
      repository = createProductRepository({ env: runtimeEnv, projectRoot: configuredProjectRoot, requireWarehouse });
      service = new ProductService(repository);
      warehouseRepository = new SqlServerWarehouseRepository({ env: runtimeEnv });
      warehouseService = new WarehouseService(warehouseRepository);
      return;
    }
    const inventoryPath = inventoryPathFor(runtimeEnv);
    if (!inventoryPath) return;
    repository = createProductRepository({ env: runtimeEnv, projectRoot: configuredProjectRoot, inventoryPath });
    service = new ProductService(repository);
  };

  buildRuntime();

  const currentConfig = () => publicConfig(configFromEnv(runtimeEnv));
  const applyConfig = async config => {
    await closeRepository();
    runtimeEnv = { ...runtimeEnv, ...envFromConfig(config) };
    buildRuntime();
  };

  const configurationApi = async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/api/config/status' && request.method === 'GET') {
      response.writeHead(200, jsonHeaders);
      return response.end(JSON.stringify({ ...currentConfig(), connection: service ? 'ready' : 'not_configured' }));
    }
    if (pathname === '/api/config/health' && request.method === 'GET') {
      const config = configFromEnv(runtimeEnv);
      if (!isUsableConfig(config)) {
        response.writeHead(200, jsonHeaders);
        return response.end(JSON.stringify({ connection: 'not_configured' }));
      }
      try {
        const result = await checkConnection(config);
        response.writeHead(200, jsonHeaders);
        return response.end(JSON.stringify({ connection: 'ready', databaseName: result.databaseName }));
      } catch (error) {
        response.writeHead(502, jsonHeaders);
        return response.end(JSON.stringify({ connection: 'error', error: connectionErrorMessage(error) }));
      }
    }
    if (pathname === '/api/warehouses' && request.method === 'GET') {
      try {
        const config = configFromEnv(runtimeEnv);
        const result = { databaseName: config.database, warehouses: await warehouseService.getWarehouses() };
        response.writeHead(200, jsonHeaders);
        return response.end(JSON.stringify({ warehouses: result.warehouses }));
      } catch (error) {
        response.writeHead(502, jsonHeaders);
        return response.end(JSON.stringify({ error: connectionErrorMessage(error) }));
      }
    }
    if (pathname !== '/api/config/test' && pathname !== '/api/config/save') return false;
    if (request.method !== 'POST') { response.writeHead(405, jsonHeaders); response.end(JSON.stringify({ error: 'Método no permitido' })); return true; }
    let candidate;
    try { candidate = configFromRequest(await readJsonBody(request)); }
    catch { response.writeHead(400, jsonHeaders); response.end(JSON.stringify({ error: 'Configuración inválida' })); return true; }
    const testing = pathname === '/api/config/test';
    if (!isConnectionConfig(candidate)) {
      response.writeHead(400, jsonHeaders);
      return response.end(JSON.stringify({ error: 'Completa servidor, base de datos, usuario y contraseña.' }));
    }
    if (!testing && validatedConnectionKey !== connectionKey(candidate)) {
      response.writeHead(400, jsonHeaders);
      return response.end(JSON.stringify({ error: 'Prueba la conexión antes de guardar.' }));
    }
    if (!testing && !isUsableConfig(candidate)) {
      response.writeHead(400, jsonHeaders);
      return response.end(JSON.stringify({ error: 'Selecciona una tienda.' }));
    }
    validatedConnectionKey = null;
    try {
      const result = await testConnection(candidate);
      validatedConnectionKey = connectionKey(candidate);
      if (!testing) {
        const selected = result.warehouses.find(item => item.warehouseCode === candidate.warehouseCode);
        if (!selected) { response.writeHead(400, jsonHeaders); return response.end(JSON.stringify({ error: 'El almacén seleccionado no existe', warehouses: result.warehouses })); }
        candidate.warehouseName = selected.warehouseName;
      }
      if (pathname === '/api/config/save') {
        if (!configStore) { response.writeHead(503, jsonHeaders); return response.end(JSON.stringify({ error: 'El almacenamiento seguro no está disponible' })); }
        await configStore.save({ config: candidate, user: candidate.user, password: candidate.password });
        await applyConfig(candidate);
      }
      response.writeHead(200, jsonHeaders);
      return response.end(JSON.stringify({
        ok: true,
        databaseName: result.databaseName,
        warehouses: result.warehouses,
        config: publicConfig(candidate)
      }));
    } catch (error) {
      response.writeHead(502, jsonHeaders);
      return response.end(JSON.stringify({ error: connectionErrorMessage(error) }));
    }
  };

  const server = http.createServer(async (request, response) => {
    if (request.url.startsWith('/api/config') || request.url === '/api/warehouses') {
      if (await configurationApi(request, response)) return;
    }
    if (request.url.startsWith('/api/')) {
      if (!service) { response.writeHead(503, jsonHeaders); return response.end(JSON.stringify({ error: 'La aplicación no está configurada' })); }
      return productApi(service)(request, response);
    }
    const file = request.url === '/' ? 'index.html' : request.url.slice(1);
    if (!/^[\w.-]+$/.test(file)) { response.writeHead(404); return response.end(); }
    try {
      const content = await readFile(path.resolve(configuredProjectRoot, 'public', file));
      const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      response.writeHead(200, { 'Content-Type': contentType });
      response.end(content);
    } catch { response.writeHead(404); response.end(); }
  });

  return {
    server,
    applyConfig,
    close: async () => { await closeRepository(); await new Promise(resolve => server.close(resolve)); },
    getService: () => service,
    getConfig: currentConfig
  };
};

export const startServer = async options => {
  const application = createApplicationServer(options);
  const port = options?.port ?? process.env.PORT ?? 3000;
  await new Promise((resolve, reject) => {
    application.server.once('error', reject);
    application.server.listen(port, '127.0.0.1', resolve);
  });
  return application;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().then(() => console.log(`AE Store Assistant usando ${process.env.DATA_SOURCE || 'excel'} en http://localhost:${process.env.PORT || 3000}`))
    .catch(error => { console.error('No se pudo iniciar AE Store Assistant:', error.message); process.exitCode = 1; });
}
