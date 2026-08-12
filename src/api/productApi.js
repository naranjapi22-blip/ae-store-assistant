export function productApi(service) {
  return async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const url = new URL(request.url, 'http://localhost');
    const referenceMatch = pathname.match(/^\/api\/products\/reference\/([^/]+)$/);
    if (pathname === '/api/products/search') {
      const query = url.searchParams.get('q')?.trim() ?? '';
      if (query.length < 2) { response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return response.end(JSON.stringify({ error: 'La búsqueda debe tener al menos 2 caracteres' })); }
      try {
        const products = await service.searchProducts(query, 20);
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return response.end(JSON.stringify({ results: products }));
      } catch { response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); return response.end(JSON.stringify({ error: 'No se pudo buscar productos' })); }
    }
    const match = pathname.match(/^\/api\/products\/([^/]+)$/);
    if (!referenceMatch && !match) { response.writeHead(404); return response.end(JSON.stringify({ error: 'Not found' })); }
    let product;
    try {
      product = referenceMatch
        ? await service.getProductByReference(decodeURIComponent(referenceMatch[1]))
        : await (service.getProductByQuery
          ? service.getProductByQuery(decodeURIComponent(match[1]))
          : service.getProductByBarcode(decodeURIComponent(match[1])));
    }
    catch { response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); return response.end(JSON.stringify({ error: 'No se pudo consultar el producto' })); }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!product) { response.writeHead(404); return response.end(JSON.stringify({ error: 'Producto no encontrado' })); }
    response.writeHead(200); response.end(JSON.stringify(product));
  };
}
