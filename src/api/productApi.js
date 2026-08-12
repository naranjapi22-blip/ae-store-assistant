export function productApi(service) {
  return async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const url = new URL(request.url, 'http://localhost');
    const referenceMatch = pathname.match(/^\/api\/products\/reference\/([^/]+)$/);
    const similarMatch = pathname.match(/^\/api\/products\/reference\/([^/]+)\/similar$/);
    if (similarMatch) {
      let products;
      try { products = await service.getSimilarProducts(decodeURIComponent(similarMatch[1])); }
      catch { response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); return response.end(JSON.stringify({ error: 'No se pudieron consultar productos similares' })); }
      if (products === null) { response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); return response.end(JSON.stringify({ error: 'Producto no encontrado' })); }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return response.end(JSON.stringify({ results: products }));
    }
    if (pathname === '/api/catalog/departments') {
      try { response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return response.end(JSON.stringify({ departments: await service.getDepartments() })); }
      catch { response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); return response.end(JSON.stringify({ error: 'No se pudo cargar el catálogo' })); }
    }
    if (pathname === '/api/catalog/sections' || pathname === '/api/catalog/families' || pathname === '/api/catalog/products') {
      const department = url.searchParams.get('department')?.trim() ?? '';
      const section = url.searchParams.get('section')?.trim() ?? '';
      const family = url.searchParams.get('family')?.trim() ?? '';
      const required = pathname.endsWith('/sections') ? [department] : pathname.endsWith('/families') ? [department, section] : [department, section, family];
      if (required.some(value => !value)) { response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return response.end(JSON.stringify({ error: 'Faltan filtros de catálogo' })); }
      try {
        const body = pathname.endsWith('/sections')
          ? { sections: await service.getSections(department) }
          : pathname.endsWith('/families')
            ? { families: await service.getFamilies(department, section) }
            : { results: await service.getProductsByCategory(department, section, family, 20) };
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return response.end(JSON.stringify(body));
      } catch { response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); return response.end(JSON.stringify({ error: 'No se pudo consultar el catálogo' })); }
    }
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
    let resolution;
    try {
      if (referenceMatch) {
        product = await service.getProductByReference(decodeURIComponent(referenceMatch[1]));
      } else if (service.resolveProductQuery) {
        resolution = await service.resolveProductQuery(decodeURIComponent(match[1]));
        product = resolution?.product ?? null;
      } else {
        product = await (service.getProductByQuery
          ? service.getProductByQuery(decodeURIComponent(match[1]))
          : service.getProductByBarcode(decodeURIComponent(match[1])));
      }
    }
    catch { response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); return response.end(JSON.stringify({ error: 'No se pudo consultar el producto' })); }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!product && !resolution?.results) { response.writeHead(404); return response.end(JSON.stringify({ error: 'Producto no encontrado' })); }
    response.writeHead(200); response.end(JSON.stringify(resolution?.results ? { results: resolution.results } : product));
  };
}
