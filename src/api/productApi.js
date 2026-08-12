export function productApi(service) {
  return async (request, response) => {
    const match = new URL(request.url, 'http://localhost').pathname.match(/^\/api\/products\/([^/]+)$/);
    if (!match) { response.writeHead(404); return response.end(JSON.stringify({ error: 'Not found' })); }
    let product;
    try { product = await service.getProductByBarcode(decodeURIComponent(match[1])); }
    catch { response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); return response.end(JSON.stringify({ error: 'No se pudo consultar el producto' })); }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!product) { response.writeHead(404); return response.end(JSON.stringify({ error: 'Producto no encontrado' })); }
    response.writeHead(200); response.end(JSON.stringify(product));
  };
}
