import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { vsProductApi } from './api/vsProductApi.js';
import { VsExcelProductRepository } from './repository/VsExcelProductRepository.js';
import { VsProductService } from './service/VsProductService.js';
import { loadEnvironment } from './config/environment.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, '..');
const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };
const resolveLocalFile = (value, fallback) => [value, fallback].filter(Boolean)
  .map(file => path.isAbsolute(file) ? file : path.resolve(projectRoot, file)).find(existsSync);
const contentTypeFor = file => file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';

export const createVsApplicationServer = ({ env = process.env, stockFilePath = null, imageCatalogFilePath = null, historicalImageFilePath = null, styleColorImageFilePath = null, vsCrImageFilePath = null, vsIndiaImageFilePath = null, imageCoverageFilePath = null, configuredProjectRoot = projectRoot } = {}) => {
  const stockPath = stockFilePath || resolveLocalFile(env.VS_STOCK_FILE, path.resolve(configuredProjectRoot, '..', 'VSImageTest', 'vs_inventory_master.json'));
  if (!stockPath) throw new Error('VS_STOCK_FILE no está configurado o no existe');
  const catalogPath = imageCatalogFilePath || imageCoverageFilePath || resolveLocalFile(env.VS_IMAGE_CATALOG_FILE || env.VS_IMAGE_COVERAGE_FILE, path.resolve(configuredProjectRoot, '..', 'VSImageTest', 'catalogo_actual_vs_nuevo.json'));
  const historicalPath = historicalImageFilePath || resolveLocalFile(env.VS_HISTORICAL_IMAGE_FILE, path.resolve(configuredProjectRoot, '..', 'VSImageTest', 'historico_vs_nuevo.json'));
  const styleColorPath = styleColorImageFilePath || resolveLocalFile(env.VS_STYLE_COLOR_IMAGE_FILE, path.resolve(configuredProjectRoot, '..', 'VSImageTest', 'style_color_recovery_vs.json'));
  const vsCrPath = vsCrImageFilePath || resolveLocalFile(env.VS_CR_IMAGE_FILE, path.resolve(configuredProjectRoot, '..', 'VSImageTest', 'vs_cr_refid_images.json'));
  const vsIndiaPath = vsIndiaImageFilePath || resolveLocalFile(env.VS_INDIA_IMAGE_FILE, path.resolve(configuredProjectRoot, '..', 'VSImageTest', 'vs_india_images.json'));
  const repository = new VsExcelProductRepository(stockPath, { imageCatalogFilePath: catalogPath, historicalImageFilePath: historicalPath, styleColorImageFilePath: styleColorPath, vsCrImageFilePath: vsCrPath, vsIndiaImageFilePath: vsIndiaPath });
  const service = new VsProductService(repository);
  const api = vsProductApi(service);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.startsWith('/api/vs/')) return api(request, response);
    const file = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    if (!['index.html', 'app.js', 'styles.css'].includes(file)) { response.writeHead(404, jsonHeaders); return response.end(JSON.stringify({ error: 'Not found' })); }
    try {
      const content = await readFile(path.resolve(configuredProjectRoot, 'public', 'vs', file));
      response.writeHead(200, { 'Content-Type': contentTypeFor(file) });
      return response.end(content);
    } catch { response.writeHead(404, jsonHeaders); return response.end(JSON.stringify({ error: 'Not found' })); }
  });
  return { server, service, repository, close: async () => new Promise(resolve => server.close(resolve)) };
};

export const startVsServer = async options => {
  const application = createVsApplicationServer(options);
  const port = options?.port ?? options?.env?.VS_PORT ?? process.env.VS_PORT ?? 3001;
  await new Promise((resolve, reject) => { application.server.once('error', reject); application.server.listen(port, '127.0.0.1', resolve); });
  return application;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnvironment();
  startVsServer().then(() => console.log(`Victoria's Secret usando Excel en http://localhost:${process.env.VS_PORT || 3001}`))
    .catch(error => { console.error('No se pudo iniciar Victoria\'s Secret:', error.message); process.exitCode = 1; });
}
