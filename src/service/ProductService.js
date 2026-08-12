const clean = value => value == null ? '' : String(value).trim();
const familyFromReference = reference => {
  const parts = clean(reference).split('-');
  return parts.length === 3 && parts.every(Boolean) ? parts[0] : null;
};
const imageFromReference = reference => {
  const key = clean(reference).replaceAll('-', '_');
  return key ? `https://s7d2.scene7.com/is/image/aeo/${key}_f` : null;
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

  async searchProducts(text, limit = 20) {
    const value = clean(text);
    if (value.length < 2) return [];
    const rows = await this.repository.searchProducts(value, Math.min(limit, 20));
    return rows.map(row => ({
      image: imageFromReference(row.ref),
      REFERENCIA_STYLO: row.ref,
      STYLE: row.style,
      description: row.description,
      additionalDescription: row.additionalDescription || '',
      color: row.color,
      colorDescription: row.colorDescription || '',
      colorSpanish: row.colorSpanish || '',
      price: Number(row.price || 0),
      season: row.season || '',
      stockTotal: row.stockTotal,
      sizesWithStock: row.sizesWithStock
    }));
  }

  async getDepartments() { return this.repository.getDepartments(); }
  async getSections(department) { return this.repository.getSections(clean(department)); }
  async getFamilies(department, section) { return this.repository.getFamilies(clean(department), clean(section)); }

  async getProductsByCategory(department, section, family, limit = 20) {
    const rows = await this.repository.getProductsByCategory(clean(department), clean(section), clean(family), Math.min(limit, 20));
    return rows.map(row => this.toCatalogSummary(row));
  }

  async getSimilarProducts(reference) {
    const rows = await this.repository.findByReference(clean(reference));
    if (!rows.length) return null;
    const current = rows[0];
    const similar = await this.repository.findSimilarProducts({
      department: current.department,
      section: current.section,
      family: current.family,
      excludeReference: current.ref,
      limit: 6
    });
    return similar.map(row => this.toCatalogSummary(row));
  }

  toCatalogSummary(row) {
    return {
      image: imageFromReference(row.ref),
      REFERENCIA_STYLO: row.ref,
      STYLE: row.style,
      description: row.description,
      additionalDescription: row.additionalDescription || '',
      color: row.color,
      colorDescription: row.colorDescription || '',
      colorSpanish: row.colorSpanish || '',
      price: Number(row.price || 0),
      season: row.season || '',
      stockTotal: row.stockTotal,
      sizesWithStock: row.sizesWithStock
    };
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
        .map(item => [item.color, {
          color: item.color,
          colorDescription: item.colorDescription || '',
          colorSpanish: item.colorSpanish || '',
          reference: item.ref,
          image: imageFromReference(item.ref)
        }])).values()]
      : [];
    const sizeStock = new Map();
    for (const item of variants) sizeStock.set(item.size, (sizeStock.get(item.size) ?? 0) + item.stock);

    return {
      image: imageFromReference(row.ref),
      description: row.description,
      additionalDescription: row.additionalDescription || '',
      material: row.materialSpanish || row.composition || '',
      price: Number(row.price || 0),
      REFERENCIA_STYLO: row.ref,
      STYLE: row.style,
      department: row.department || '',
      section: row.section || '',
      family: row.family || '',
      season: row.season || '',
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
