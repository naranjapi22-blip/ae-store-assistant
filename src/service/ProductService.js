const clean = value => value == null ? '' : String(value).trim();

export class ProductService {
  constructor(repository) { this.repository = repository; }

  async getProductByBarcode(barcode) {
    const row = await this.repository.findByBarcode(clean(barcode));
    if (!row) return null;
    const variants = row.ref ? await this.repository.findByReference(row.ref) : [];
    const styleRows = row.style ? await this.repository.findByStyle(row.style) : [];
    const sameProductRows = styleRows.filter(item => item.description === row.description);
    const safeColors = [...new Set(sameProductRows.map(item => item.color).filter(Boolean))]
      .filter(color => color !== row.color);
    const imageKey = row.ref.replaceAll('-', '_');
    const sizeStock = new Map();
    for (const item of variants) sizeStock.set(item.size, (sizeStock.get(item.size) ?? 0) + item.stock);
    return {
      image: imageKey ? `https://s7d2.scene7.com/is/image/aeo/${imageKey}_f` : null,
      description: row.description, REFERENCIA_STYLO: row.ref, STYLE: row.style,
      color: row.color, scannedSize: row.size, stock: row.stock,
      sizes: [...sizeStock].map(([size, stock]) => ({ size, stock })),
      relatedColors: safeColors
    };
  }
}
