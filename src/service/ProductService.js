const clean = value => value == null ? '' : String(value).trim();
const familyFromReference = reference => {
  const parts = clean(reference).split('-');
  return parts.length === 3 && parts.every(Boolean) ? parts[0] : null;
};

export class ProductService {
  constructor(repository) { this.repository = repository; }

  async getProductByBarcode(barcode) {
    return this.getProduct(await this.repository.findByBarcode(clean(barcode)));
  }

  async getProductByQuery(query) {
    const row = this.repository.findByQuery
      ? await this.repository.findByQuery(clean(query))
      : await this.repository.findByBarcode(clean(query));
    return this.getProduct(row);
  }

  async getProductByReference(reference) {
    const rows = await this.repository.findByReference(clean(reference));
    return this.getProduct(rows[0] ?? null);
  }

  async getProduct(row) {
    if (!row) return null;
    const variants = row.ref ? await this.repository.findByReference(row.ref) : [];
    const family = familyFromReference(row.ref);
    const styleRows = family && row.style ? await this.repository.findByStyle(row.style) : [];
    const safeColors = family
      ? [...new Map(styleRows
        .filter(item => familyFromReference(item.ref) === family && item.ref !== row.ref && item.color !== row.color)
        .filter(item => item.ref && item.color)
        .map(item => [item.ref, {
          color: item.color,
          colorDescription: item.colorDescription || '',
          colorSpanish: item.colorSpanish || '',
          reference: item.ref
        }])).values()]
      : [];
    const imageKey = row.ref.replaceAll('-', '_');
    const sizeStock = new Map();
    for (const item of variants) sizeStock.set(item.size, (sizeStock.get(item.size) ?? 0) + item.stock);

    return {
      image: imageKey ? `https://s7d2.scene7.com/is/image/aeo/${imageKey}_f` : null,
      description: row.description,
      spanishDescription: row.spanishDescription || '',
      material: row.materialSpanish || row.composition || '',
      price: Number(row.price || 0),
      REFERENCIA_STYLO: row.ref,
      STYLE: row.style,
      color: row.color,
      colorDescription: row.colorDescription || '',
      colorSpanish: row.colorSpanish || '',
      scannedSize: row.size,
      stock: row.stock,
      sizes: [...sizeStock].map(([size, stock]) => ({ size, stock })),
      relatedColors: safeColors
    };
  }
}
