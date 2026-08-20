const clean = value => value == null ? '' : String(value).trim();
const priceOrNull = value => {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const familyFromReference = reference => {
  const parts = clean(reference).split('-');
  return parts.length === 3 && parts.every(Boolean) ? parts[0] : null;
};
const imageFromReference = reference => {
  const key = clean(reference).replaceAll('-', '_');
  return key ? `https://s7d2.scene7.com/is/image/aeo/${key}_f` : null;
};
const stockTotalByReference = rows => rows.reduce((totals, row) => {
  if (row.ref) totals.set(row.ref, (totals.get(row.ref) ?? 0) + Number(row.stock ?? 0));
  return totals;
}, new Map());

export class ProductService {
  constructor(repository) { this.repository = repository; }

  async getProductByBarcode(barcode) {
    return this.getProduct(await this.repository.findByBarcode(clean(barcode)));
  }

  async getProductByQuery(query) {
    const resolution = await this.resolveProductQuery(query);
    return resolution?.product ?? null;
  }

  async findExactVariant(query) {
    const value = clean(query);
    const barcode = this.repository.findByBarcode
      ? await this.repository.findByBarcode(value)
      : null;
    if (barcode) return barcode;

    const references = this.repository.findByReference
      ? await this.repository.findByReference(value)
      : [];
    if (references.length) return references[0];

    const suppliers = this.repository.findBySupplierRef
      ? await this.repository.findBySupplierRef(value)
      : this.repository.findByQuery ? [await this.repository.findByQuery(value)].filter(Boolean) : [];
    if (suppliers.length) return suppliers[0];

    return null;
  }

  async searchProductsByStyle(style, limit = 20) {
    const rows = this.repository.searchProductsByStyle
      ? await this.repository.searchProductsByStyle(style, limit)
      : await this.repository.searchProducts(style, limit);
    return rows.map(row => this.toSearchSummary(row));
  }

  async resolveProductQuery(query) {
    const value = clean(query);
    if (!value) return null;

    const exact = await this.findExactVariant(value);
    if (exact) return { product: await this.getProduct(exact) };

    if (!this.repository.findByStyle) return null;
    const styleRows = await this.repository.findByStyle(value);
    if (styleRows.length) return { results: await this.searchProductsByStyle(value, 20) };

    if (/^\d+$/.test(value) && this.repository.findByArticleCode) {
      const articles = await this.repository.findByArticleCode(Number(value));
      if (articles.length) return { product: await this.getProduct(articles[0]) };
    }

    return null;
  }

  async getProductByReference(reference) {
    const rows = await this.repository.findByReference(clean(reference));
    return this.getProduct(rows[0] ?? null);
  }

  async searchProducts(text, limit = 20) {
    const value = clean(text);
    if (value.length < 2) return [];
    const rows = await this.repository.searchProducts(value, Math.min(limit, 20));
    return rows.map(row => this.toSearchSummary(row));
  }

  toSearchSummary(row) {
    return {
      image: imageFromReference(row.ref),
      REFERENCIA_STYLO: row.ref,
      STYLE: row.style,
      description: row.description,
      additionalDescription: row.additionalDescription || '',
      color: row.color,
      colorDescription: row.colorDescription || '',
      colorSpanish: row.colorSpanish || '',
      price: priceOrNull(row.price),
      season: row.season || '',
      stockTotal: row.stockTotal,
      sizesWithStock: row.sizesWithStock
    };
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

  async getPromotionSummary() {
    const result = await this.repository.getPromotionSummary();
    return {
      promotions: (result?.promotions || []).map(promotion => ({
        id: promotion.id,
        description: promotion.description,
        type: promotion.type,
        percentage: promotion.percentage,
        promotionalPrice: promotion.promotionalPrice,
        requiresValidation: promotion.requiresValidation === true,
        conditionLabel: promotion.conditionLabel || null,
        startDate: promotion.startDate,
        endDate: promotion.endDate,
        referenceCount: Number(promotion.referenceCount || 0),
        stockUnits: Number(promotion.stockUnits || 0)
      })),
      totals: {
        referenceCount: Number(result?.totals?.referenceCount || 0),
        stockUnits: Number(result?.totals?.stockUnits || 0)
      }
    };
  }

  async getPromotionProducts(promotionId, options = {}) {
    const result = await this.repository.getPromotionProducts(promotionId, {
      page: options.page,
      limit: options.limit,
      search: clean(options.search),
      department: clean(options.department),
      section: clean(options.section),
      family: clean(options.family)
    });
    return {
      products: (result?.products || []).map(product => ({
        image: product.image,
        REFERENCIA_STYLO: product.REFERENCIA_STYLO,
        description: product.description,
        additionalDescription: product.additionalDescription || '',
        color: product.color,
        colorDescription: product.colorDescription || '',
        colorSpanish: product.colorSpanish || '',
        price: priceOrNull(product.price),
        promotionalPrice: product.promotion?.requiresValidation ? null : priceOrNull(product.promotion?.calculatedPrice),
        promotionDescription: product.promotionDescription,
        requiresValidation: product.promotion?.requiresValidation === true,
        conditionLabel: product.promotion?.conditionLabel || null,
        stockTotal: Number(product.stockTotal || 0),
        sizesWithStock: Number(product.sizesWithStock || 0),
        department: product.department,
        section: product.section,
        family: product.family
      })),
      page: result?.page || 1,
      limit: result?.limit || 40,
      hasMore: result?.hasMore === true,
      totalReferences: Number(result?.totalReferences || 0),
      totalUnits: Number(result?.totalUnits || 0)
    };
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
      price: priceOrNull(row.price),
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
    const stockTotals = stockTotalByReference(styleRows);
    const safeColors = family
      ? [...new Map(styleRows
        .filter(item => familyFromReference(item.ref) === family && item.ref !== row.ref && item.color !== row.color
          && (stockTotals.get(item.ref) ?? 0) > 0)
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
    for (const item of variants) {
      const current = sizeStock.get(item.size);
      const barcode = item.CODBARRAS || item.CODBARRAS2 || '';
      if (current) {
        current.stock += item.stock;
        if (!current.barcode && barcode) current.barcode = barcode;
        if (!current.barcode2 && item.CODBARRAS2) current.barcode2 = item.CODBARRAS2;
      } else {
        sizeStock.set(item.size, {
          size: item.size,
          stock: item.stock,
          barcode,
          barcode2: item.CODBARRAS2 || ''
        });
      }
    }

    const promotionResult = this.repository.findApplicablePromotions
      ? await this.repository.findApplicablePromotions(row)
      : [];
    const promotions = Array.isArray(promotionResult)
      ? promotionResult
      : Array.isArray(promotionResult?.promotions) ? promotionResult.promotions : [];
    const conditionalPromotions = Array.isArray(promotionResult)
      ? []
      : Array.isArray(promotionResult?.conditionalPromotions) ? promotionResult.conditionalPromotions : [];
    const bestPromotionalPrice = Array.isArray(promotionResult)
      ? null
      : priceOrNull(promotionResult?.bestPromotionalPrice);

    return {
      image: imageFromReference(row.ref),
      description: row.description,
      additionalDescription: row.additionalDescription || '',
      material: row.materialSpanish || row.composition || '',
      price: priceOrNull(row.price),
      REFERENCIA_STYLO: row.ref,
      STYLE: row.style,
      barcode: row.CODBARRAS || row.CODBARRAS2 || '',
      department: row.department || '',
      section: row.section || '',
      family: row.family || '',
      season: row.season || '',
      color: row.color,
      colorDescription: row.colorDescription || '',
      colorSpanish: row.colorSpanish || '',
      scannedSize: row.size,
      stock: row.stock,
      sizes: [...sizeStock.values()],
      relatedColors: safeColors,
      promotions,
      conditionalPromotions,
      bestPromotionalPrice
    };
  }
}
