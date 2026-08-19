export function vsProductApi(service) {
  return async (request, response) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    const pathname = requestUrl.pathname;
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
