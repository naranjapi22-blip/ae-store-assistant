export function vsProductApi(service) {
  return async (request, response) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    const pathname = requestUrl.pathname;
    if (pathname === '/api/vs/image-coverage') {
      const coverage = service.imageCoverage?.();
      response.writeHead(coverage ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
      return response.end(JSON.stringify(coverage ?? { error: 'Cobertura de imÃ¡genes VS no disponible' }));
    }
    if (pathname === '/api/vs/image-coverage/pending') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return response.end(JSON.stringify({ items: service.imageCoveragePending?.() ?? [] }));
    }
    if (pathname === '/api/vs/image-coverage/resolve-pending') {
      if (request.method !== 'POST') {
        response.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: 'POST' });
        return response.end(JSON.stringify({ error: 'Method not allowed' }));
      }
      if (typeof service.resolvePendingImages !== 'function') {
        response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return response.end(JSON.stringify({ error: 'VS pending resolver not available' }));
      }
      try {
        const result = await service.resolvePendingImages();
        response.writeHead(result ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
        return response.end(JSON.stringify(result ?? { error: 'VS pending resolver not available' }));
      } catch (error) {
        const running = error?.code === 'VS_PENDING_RESOLVER_RUNNING';
        response.writeHead(running ? 409 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
        return response.end(JSON.stringify({ error: running ? 'VS pending resolver already running' : 'No se pudo resolver pendientes VS' }));
      }
    }
    if (pathname === '/api/vs/catalog') {
      try {
        const catalog = service.searchCatalog({
          query: requestUrl.searchParams.get('q') || '',
          department: requestUrl.searchParams.get('department') || '',
          section: requestUrl.searchParams.get('section') || '',
          family: requestUrl.searchParams.get('family') || '',
          subfamily: requestUrl.searchParams.get('subfamily') || '',
          offset: requestUrl.searchParams.get('offset') || 0,
          limit: requestUrl.searchParams.get('limit') || 50
        });
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return response.end(JSON.stringify(catalog));
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return response.end(JSON.stringify({ error: 'No se pudo consultar el catálogo VS' }));
      }
    }
    const match = pathname.match(/^\/api\/vs\/products\/([^/]+)$/);
    if (!match) { response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); return response.end(JSON.stringify({ error: 'Not found' })); }
    try {
      const barcode = decodeURIComponent(match[1]);
      const scannedBarcode = requestUrl.searchParams.get('scannedBarcode') || barcode;
      const resolved = typeof service.getProductByQuery === 'function'
        ? await service.getProductByQuery(barcode, { scannedBarcode })
        : { product: await service.getProductByBarcode(barcode, { scannedBarcode }) };
      if (resolved.ambiguous) {
        response.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        return response.end(JSON.stringify({ error: 'La referencia corresponde a varios STYLE; selecciona una opción.', options: resolved.options }));
      }
      const product = resolved.product;
      response.writeHead(product ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
      return response.end(JSON.stringify(product ?? { error: 'Producto VS no encontrado' }));
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return response.end(JSON.stringify({ error: 'No se pudo consultar el producto VS' }));
    }
  };
}
