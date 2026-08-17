export function vsProductApi(service) {
  return async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const match = pathname.match(/^\/api\/vs\/products\/([^/]+)$/);
    if (!match) { response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); return response.end(JSON.stringify({ error: 'Not found' })); }
    try {
      const product = await service.getProductByBarcode(decodeURIComponent(match[1]));
      response.writeHead(product ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
      return response.end(JSON.stringify(product ?? { error: 'Producto VS no encontrado' }));
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return response.end(JSON.stringify({ error: 'No se pudo consultar el producto VS' }));
    }
  };
}
