const clean = value => value == null ? '' : String(value).trim();

export class VsProductService {
  constructor(repository) { this.repository = repository; }

  async getProductByBarcode(barcode) {
    const row = await this.repository.findByBarcode(clean(barcode));
    if (!row) return null;
    const variants = row.identityKey ? await this.repository.findByIdentity(row.identityKey) : [row];
    const sizes = [...variants.reduce((bySize, item) => {
      const size = item.TALLA || 'Sin talla';
      const current = bySize.get(size);
      if (current) {
        current.stock += Number(item.STOCK ?? 0);
        if (!current.barcode && item.CODBARRAS) current.barcode = item.CODBARRAS;
      } else bySize.set(size, { size, stock: Number(item.STOCK ?? 0), barcode: item.CODBARRAS, image: item.image });
      return bySize;
    }, new Map()).values()];
    return {
      brand: 'VS', image: row.image, description: row.DESCRIPCION, supplierReference: row.REFPROVEEDOR,
      color: row.COLOR, scannedSize: row.TALLA, stock: row.STOCK, barcode: row.CODBARRAS,
      season: row.TEMPORADA, department: row.departamento, section: row.seccion, family: row.familia,
      sizes,
      performance: this.repository.metrics()
    };
  }
}
