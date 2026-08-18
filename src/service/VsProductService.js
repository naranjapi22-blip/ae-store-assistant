const clean = value => value == null ? '' : String(value).trim();
const validValue = value => clean(value) !== '' && !['.', '-', 'N/A', 'NA'].includes(clean(value).toUpperCase());
const sizeOrder = ['XXXS', 'XXS', 'XS', 'S', 'SMALL', 'M', 'MED', 'L', 'LARGE', 'XL', 'XXL', 'XXXL', 'O/S', 'OS', 'ONE SIZE'];

const sizeSortKey = value => {
  const text = clean(value).toUpperCase();
  const numeric = text.match(/^(\d+(?:\.\d+)?)(?:\s*)(.*)$/);
  if (numeric) return [0, Number(numeric[1]), numeric[2], text];
  const known = sizeOrder.indexOf(text);
  return [known >= 0 ? 1 : 2, known >= 0 ? known : 0, text];
};

const compareSizes = (left, right) => {
  const a = sizeSortKey(left); const b = sizeSortKey(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === b[index]) continue;
    return String(a[index]).localeCompare(String(b[index]), undefined, { numeric: true });
  }
  return 0;
};

export class VsProductService {
  constructor(repository) { this.repository = repository; }

  async findVariants(row) {
    if (!validValue(row.STYLE) || !validValue(row.COLOR) || !row.styleColorKey) return [row];
    return this.repository.findByStyleColor(row.STYLE, row.COLOR);
  }

  buildSizes(variants, { selectedBarcode = '', scannedBarcode = '' } = {}) {
    const bySize = new Map();
    for (const item of variants) {
      const stock = Number(item.STOCK ?? 0);
      if (stock <= 0) continue;
      const size = clean(item.TALLA) || 'Sin talla';
      bySize.set(size, [...(bySize.get(size) ?? []), item]);
    }
    return [...bySize.entries()].map(([size, items]) => {
      const representative = [...items].sort((left, right) => {
        const imageOrder = Number(Boolean(right.image)) - Number(Boolean(left.image));
        return imageOrder || clean(left.CODBARRAS).localeCompare(clean(right.CODBARRAS));
      })[0];
      return {
        size,
        stock: items.reduce((total, item) => total + Number(item.STOCK ?? 0), 0),
        barcode: representative.CODBARRAS,
        image: representative.image ?? null,
        scanned: Boolean(scannedBarcode) && items.some(item => item.CODBARRAS === scannedBarcode),
        selected: Boolean(selectedBarcode) && items.some(item => item.CODBARRAS === selectedBarcode),
        description: representative.DESCRIPCION,
        supplierReference: representative.REFPROVEEDOR,
        style: representative.STYLE,
        stylo: representative.STYLO,
        color: representative.COLOR,
        talla: representative.TALLA,
        season: representative.TEMPORADA,
        department: representative.departamento,
        section: representative.seccion,
        family: representative.familia
      };
    }).sort((left, right) => compareSizes(left.size, right.size));
  }

  async buildRelatedColors(row) {
    if (!validValue(row.STYLE) || typeof this.repository.findByStyle !== 'function') return [];
    const rows = await this.repository.findByStyle(row.STYLE);
    const byColor = new Map();
    for (const item of rows) {
      const color = clean(item.COLOR);
      if (!validValue(color) || Number(item.STOCK ?? 0) <= 0) continue;
      const key = color.toLocaleLowerCase();
      byColor.set(key, [...(byColor.get(key) ?? []), item]);
    }
    return [...byColor.values()]
      .filter(items => items[0].COLOR.toLocaleLowerCase() !== clean(row.COLOR).toLocaleLowerCase())
      .map(items => {
        const representative = items.find(item => item.image) ?? items[0];
        return {
          color: representative.COLOR,
          barcode: representative.CODBARRAS,
          image: representative.image ?? null,
          stock: items.reduce((total, item) => total + Number(item.STOCK ?? 0), 0),
          sizes: this.buildSizes(items)
        };
      })
      .sort((left, right) => left.color.localeCompare(right.color));
  }

  async getProductByBarcode(barcode, { scannedBarcode = barcode } = {}) {
    const row = await this.repository.findByBarcode(clean(barcode));
    if (!row) return null;
    const variants = await this.findVariants(row);
    const originalBarcode = clean(scannedBarcode);
    const scannedVariant = variants.find(item => item.CODBARRAS === originalBarcode) ?? null;
    const sizes = this.buildSizes(variants, { selectedBarcode: row.CODBARRAS, scannedBarcode: scannedVariant?.CODBARRAS ?? '' });
    const selectedSize = sizes.find(item => item.selected);
    const totalStock = sizes.reduce((total, item) => total + Number(item.stock ?? 0), 0);
    return {
      brand: 'VS', image: row.image ?? null, description: row.DESCRIPCION, style: row.STYLE, stylo: row.STYLO,
      supplierReference: row.REFPROVEEDOR, color: row.COLOR, scannedSize: scannedVariant?.TALLA ?? null,
      selectedSize: row.TALLA, scannedBarcode: scannedVariant?.CODBARRAS ?? null, selectedBarcode: row.CODBARRAS,
      stock: selectedSize?.stock ?? Number(row.STOCK ?? 0), totalStock, barcode: row.CODBARRAS, season: row.TEMPORADA, department: row.departamento,
      section: row.seccion, family: row.familia, sizes, relatedColors: await this.buildRelatedColors(row),
      performance: this.repository.metrics()
    };
  }

  async getProductByQuery(query, options = {}) {
    const value = clean(query);
    const barcodeRow = await this.repository.findByBarcode(value);
    if (barcodeRow) return { product: await this.getProductByBarcode(value, options) };
    const rows = typeof this.repository.findByReference === 'function' ? await this.repository.findByReference(value) : [];
    if (!rows.length) return { product: null };
    const styles = new Set(rows.map(row => clean(row.STYLE)).filter(validValue));
    if (styles.size > 1) {
      const optionsByStyle = [...new Map(rows.map(row => [clean(row.STYLE), row])).values()]
        .sort((left, right) => clean(left.STYLE).localeCompare(clean(right.STYLE)))
        .map(row => ({ barcode: row.CODBARRAS, reference: row.REFPROVEEDOR, style: row.STYLE, color: row.COLOR, description: row.DESCRIPCION, image: row.image }));
      return { product: null, ambiguous: true, options: optionsByStyle };
    }
    const representative = [...rows].sort((left, right) => {
      const imageOrder = Number(Boolean(right.image)) - Number(Boolean(left.image));
      return imageOrder || clean(left.CODBARRAS).localeCompare(clean(right.CODBARRAS));
    })[0];
    return { product: await this.getProductByBarcode(representative.CODBARRAS, options) };
  }

  searchCatalog(options = {}) {
    return this.repository.searchCatalog(options);
  }
}
