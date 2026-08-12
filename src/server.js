import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { ExcelProductRepository } from './repository/ExcelProductRepository.js';
import { ProductService } from './service/ProductService.js';
import { productApi } from './api/productApi.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const repository = new ExcelProductRepository(path.resolve(root, '../stock de tienda 30-06-2026.xls'));
const api = productApi(new ProductService(repository));
const server = http.createServer(async (request, response) => {
  if (request.url.startsWith('/api/')) return api(request, response);
  const file = request.url === '/' ? 'index.html' : request.url.slice(1);
  if (!/^[\w.-]+$/.test(file)) { response.writeHead(404); return response.end(); }
  try { response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html' }); response.end(await readFile(path.resolve(root, '../public', file))); }
  catch { response.writeHead(404); response.end(); }
});
server.listen(process.env.PORT || 3000, () => console.log('AE Store Assistant en http://localhost:3000'));
