import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { vsProductApi } from './api/vsProductApi.js';
import { VsExcelProductRepository } from './repository/VsExcelProductRepository.js';
import { VsRuntimeImageRepository } from './repository/VsRuntimeImageRepository.js';
import { VsProductService } from './service/VsProductService.js';
import { loadEnvironment } from './config/environment.js';
import { VsImageResolutionCache } from './vs-images/VsImageResolutionCache.js';
import { VsImageRegistry } from './vs-images/VsImageRegistry.js';
import { VsImageResolver } from './vs-images/VsImageResolver.js';
import { VsPendingImageResolver } from './vs-images/VsPendingImageResolver.js';
import { RomaniaProvider } from './vs-images/providers/RomaniaProvider.js';
import { createRetryPolicy } from './vs-images/VsImageRetryPolicy.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, '..');
const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };
const resolveLocalFile = (value, fallback) => [value, fallback].filter(Boolean)
  .map(file => path.isAbsolute(file) ? file : path.resolve(projectRoot, file)).find(existsSync);
const resolveConfiguredPath = value => value ? (path.isAbsolute(value) ? value : path.resolve(projectRoot, value)) : null;
const enabled = value => ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
const contentTypeFor = file => file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';

export const createVsApplicationServer = ({ env = process.env, stockFilePath = null, imageCatalogFilePath = null, historicalImageFilePath = null, styleColorImageFilePath = null, vsCrImageFilePath = null, vsIndiaImageFilePath = null, vsMaltaImageFilePath = null, vsRomaniaImageFilePath = null, vsSupplementalImageFilePath = null, runtimeImageCacheFilePath = null, imageRegistryFilePath = null, imageCoverageFilePath = null, configuredProjectRoot = projectRoot, fetchImpl = globalThis.fetch } = {}) => {
  const defaultVsDataFile = file => path.resolve(configuredProjectRoot, '..', '..', 'VSImageTest', file);
  const stockPath = stockFilePath || resolveLocalFile(env.VS_STOCK_FILE, defaultVsDataFile('vs_inventory_master.json'));
  if (!stockPath) throw new Error('VS_STOCK_FILE no está configurado o no existe');
  const catalogPath = imageCatalogFilePath || imageCoverageFilePath || resolveLocalFile(env.VS_IMAGE_CATALOG_FILE || env.VS_IMAGE_COVERAGE_FILE, defaultVsDataFile('catalogo_actual_vs_nuevo.json'));
  const historicalPath = historicalImageFilePath || resolveLocalFile(env.VS_HISTORICAL_IMAGE_FILE, defaultVsDataFile('historico_vs_nuevo.json'));
  const styleColorPath = styleColorImageFilePath || resolveLocalFile(env.VS_STYLE_COLOR_IMAGE_FILE, defaultVsDataFile('style_color_recovery_vs.json'));
  const vsCrPath = vsCrImageFilePath || resolveLocalFile(env.VS_CR_IMAGE_FILE, defaultVsDataFile('vs_cr_refid_images.json'));
  const vsIndiaPath = vsIndiaImageFilePath || resolveLocalFile(env.VS_INDIA_IMAGE_FILE, defaultVsDataFile('vs_india_images.json'));
  const vsMaltaPath = vsMaltaImageFilePath || resolveLocalFile(env.VS_MALTA_IMAGE_FILE, defaultVsDataFile('vs_malta_images.json'));
  const vsRomaniaPath = vsRomaniaImageFilePath || resolveLocalFile(env.VS_ROMANIA_IMAGE_FILE, defaultVsDataFile('vs_romania_images.json'));
  const bundledSupplementalPath = path.resolve(projectRoot, 'data', 'vs-research', 'vs_supplemental_safe.json');
  const vsSupplementalPath = vsSupplementalImageFilePath || resolveLocalFile(env.VS_SUPPLEMENTAL_IMAGE_FILE, defaultVsDataFile('vs_supplemental_safe.json')) || (existsSync(bundledSupplementalPath) ? bundledSupplementalPath : null);
  const bootstrapRepository = new VsExcelProductRepository(stockPath, { imageCatalogFilePath: catalogPath, historicalImageFilePath: historicalPath, styleColorImageFilePath: styleColorPath, vsCrImageFilePath: vsCrPath, vsIndiaImageFilePath: vsIndiaPath, vsMaltaImageFilePath: vsMaltaPath, vsRomaniaImageFilePath: vsRomaniaPath, vsSupplementalImageFilePath: vsSupplementalPath });
  const runtimeCachePath = runtimeImageCacheFilePath || resolveLocalFile(env.VS_RUNTIME_IMAGE_CACHE_FILE, defaultVsDataFile('vs_image_resolution_cache.json'));
  const imageResolutionCache = runtimeCachePath ? new VsImageResolutionCache(runtimeCachePath).load() : null;
  const registryPath = imageRegistryFilePath || resolveConfiguredPath(env.VS_IMAGE_REGISTRY_FILE) || path.resolve(projectRoot, 'data', 'runtime', 'vs-image-registry.json');
  const imageRegistry = new VsImageRegistry(registryPath, { retryPolicy: createRetryPolicy(env) }).load();
  const repository = new VsRuntimeImageRepository(bootstrapRepository, imageResolutionCache, imageRegistry);
  const runtimeResolverEnabled = enabled(env.VS_RUNTIME_IMAGE_RESOLVER_ENABLED) && Boolean(imageResolutionCache);
  const pendingResolverEnabled = enabled(env.VS_PENDING_IMAGE_RESOLVER_ENABLED) && Boolean(imageResolutionCache);
  const pendingResolverAvailable = Boolean(imageResolutionCache);
  const imageResolver = (runtimeResolverEnabled || pendingResolverAvailable) ? new VsImageResolver({
    repository: bootstrapRepository,
    cache: imageResolutionCache,
    providers: [new RomaniaProvider({ fetchImpl })],
    concurrency: env.VS_RUNTIME_IMAGE_RESOLVER_CONCURRENCY || 1,
    maxCandidates: env.VS_RUNTIME_IMAGE_RESOLVER_MAX_CANDIDATES || Infinity,
    checkpointEvery: env.VS_RUNTIME_IMAGE_RESOLVER_CHECKPOINT_EVERY || 10,
    onProgress: ({ completed, total, candidate, summary }) => console.log(`VS runtime images ${completed}/${total} ${candidate.styleColor} ${JSON.stringify(summary)}`)
  }) : null;
  const pendingImageResolver = pendingResolverAvailable ? new VsPendingImageResolver({
    registry: imageRegistry, imageResolver, runtimeRepository: repository, cache: imageResolutionCache,
    batchSize: env.VS_PENDING_RESOLVER_BATCH_SIZE, dryRun: enabled(env.VS_PENDING_RESOLVER_DRY_RUN)
  }) : null;
  const service = new VsProductService(repository, { pendingImageResolver });
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
  return { server, service, repository, bootstrapRepository, imageResolutionCache, imageRegistry, imageResolver, pendingImageResolver, runtimeResolverEnabled, pendingResolverEnabled, close: async () => new Promise(resolve => server.close(resolve)) };
};

export const startVsServer = async options => {
  const application = createVsApplicationServer(options);
  const port = options?.port ?? options?.env?.VS_PORT ?? process.env.VS_PORT ?? 3001;
  await new Promise((resolve, reject) => { application.server.once('error', reject); application.server.listen(port, '127.0.0.1', resolve); });
  if (application.runtimeResolverEnabled && application.imageResolver) application.imageResolver.resolveAll()
    .then(summary => console.log(`VS runtime images: ${JSON.stringify(summary)}`))
    .catch(error => console.warn(`VS runtime image resolver falló: ${error.message}`));
  if (application.pendingResolverEnabled && application.pendingImageResolver) application.pendingImageResolver.runBatch()
    .then(summary => console.log(`VS pending images: ${JSON.stringify(summary)}`))
    .catch(error => console.warn(`VS pending image resolver failed: ${error.message}`));
  return application;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnvironment();
  startVsServer().then(() => console.log(`Victoria's Secret usando Excel en http://localhost:${process.env.VS_PORT || 3001}`))
    .catch(error => { console.error('No se pudo iniciar Victoria\'s Secret:', error.message); process.exitCode = 1; });
}
