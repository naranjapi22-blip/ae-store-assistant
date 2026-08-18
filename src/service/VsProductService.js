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

  buildSizes(variants, selectedBarcode) {
    const bySize = new Map();
    for (const item of variants) {
      const stock = Number(item.STOCK ?? 0);
      if (stock <= 0) continue;
      const size = clean(item.TALLA) || 'Sin talla';
      const current = bySize.get(size);
      if (current) {
        current.stock += stock;
        current.scanned ||= item.CODBARRAS === selectedBarcode;
        if (!current.barcode && item.CODBARRAS) current.barcode = item.CODBARRAS;
      } else bySize.set(size, {
        size,
        stock,
        barcode: item.CODBARRAS,
        image: item.image ?? null,
        scanned: item.CODBARRAS === selectedBarcode
      });
    }
    return [...bySize.values()].sort((left, right) => compareSizes(left.size, right.size));
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
          sizes: this.buildSizes(items, '')
        };
      })
      .sort((left, right) => left.color.localeCompare(right.color));
  }

  async getProductByBarcode(barcode) {
    const row = await this.repository.findByBarcode(clean(barcode));
    if (!row) return null;
    const variants = await this.findVariants(row);
    const sizes = this.buildSizes(variants, row.CODBARRAS);
    return {
      brand: 'VS', image: row.image ?? null, description: row.DESCRIPCION, style: row.STYLE, stylo: row.STYLO,
      supplierReference: row.REFPROVEEDOR, color: row.COLOR, scannedSize: row.TALLA, scannedBarcode: row.CODBARRAS,
      stock: row.STOCK, barcode: row.CODBARRAS, season: row.TEMPORADA, department: row.departamento,
      section: row.seccion, family: row.familia, sizes, relatedColors: await this.buildRelatedColors(row),
      performance: this.repository.metrics()
    };
  }
}
