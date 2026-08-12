import XLSX from 'xlsx';
import { ProductRepository } from './ProductRepository.js';

const clean = value => value == null ? '' : String(value).trim();
const headers = {
  barcode: ['Cód. Barras', 'CODBARRAS'],
  barcode2: ['CODBARRAS2'],
  season: ['Temporada'],
  supplierRef: ['REFPROVEEDOR'],
  description: ['Descripción'],
  size: ['Talla'],
  color: ['Color'],
  ref: ['REFERENCIA STYLO', 'REFERENCIA_STYLO'],
  style: ['STYLE'],
  stock: ['Stock'],
  price: ['Precio'],
  spanishDescription: ['DESCRIPCION ESPAÑOL'],
  materialSpanish: ['MATERIAL ESPAÑOL'],
  composition: ['COMPOSICION'],
  colorDescription: ['COLOR DESCRIPTION'],
  colorSpanish: ['COLOR ESPAÑOL'],
  department: ['Departamento'],
  section: ['Seccion', 'Sección'],
  family: ['Família', 'Familia'],
  additionalDescription: ['Descripción Adicional'],
  articleCode: ['Código Artículo'],
  reference: ['Referencia']
};

export class ExcelProductRepository extends ProductRepository {
  constructor(filePath) {
    super();
    const workbook = XLSX.readFile(filePath, { raw: true, cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    const headerRow = matrix.findIndex(row => row.some(cell => clean(cell) === 'Cód. Barras' || clean(cell) === 'CODBARRAS'));
    if (headerRow < 0) throw new Error('No se encontró el encabezado de código de barras');

    const actualHeaders = matrix[headerRow].map(clean);
    const index = key => headers[key].map(name => actualHeaders.indexOf(name)).find(i => i >= 0);
    const value = (row, key) => {
      const i = index(key);
      return i === undefined ? null : row[i];
    };

    this.rows = matrix.slice(headerRow + 1).map(row => ({
      CODBARRAS: clean(value(row, 'barcode')),
      CODBARRAS2: clean(value(row, 'barcode2')),
      supplierRef: clean(value(row, 'supplierRef')),
      season: clean(value(row, 'season')),
      description: clean(value(row, 'description')),
      size: clean(value(row, 'size')),
      color: clean(value(row, 'color')),
      ref: clean(value(row, 'ref')),
      style: clean(value(row, 'style')),
      stock: Number(value(row, 'stock') ?? 0),
      price: Number(value(row, 'price') ?? 0),
      spanishDescription: clean(value(row, 'spanishDescription')),
      materialSpanish: clean(value(row, 'materialSpanish')),
      composition: clean(value(row, 'composition')),
      colorDescription: clean(value(row, 'colorDescription')),
      colorSpanish: clean(value(row, 'colorSpanish')),
      department: clean(value(row, 'department')),
      section: clean(value(row, 'section')),
      family: clean(value(row, 'family')),
      additionalDescription: clean(value(row, 'additionalDescription')),
      articleCode: clean(value(row, 'articleCode')),
      reference: clean(value(row, 'reference'))
    })).filter(row => row.CODBARRAS || row.CODBARRAS2 || row.supplierRef || row.ref || row.reference || row.articleCode);
  }

  async findByBarcode(barcode) {
    return this.findByQuery(barcode);
  }

  async findByQuery(query) {
    const value = clean(query);
    return this.rows.find(row =>
      row.CODBARRAS === value ||
      row.CODBARRAS2 === value ||
      row.supplierRef === value ||
      row.ref === value ||
      row.reference === value ||
      row.articleCode === value
    ) ?? null;
  }

  async findByReference(ref) { return this.rows.filter(row => row.ref === clean(ref)); }
  async findByStyle(style) { return this.rows.filter(row => row.style === clean(style)); }

  async searchProducts(text, limit = 20) {
    const words = clean(text).toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const maxResults = Math.min(Math.max(Number(limit) || 20, 1), 20);
    const matches = this.rows.filter(row => {
      const searchable = [row.description, row.additionalDescription, row.colorDescription, row.colorSpanish, row.style, row.ref, row.reference, row.articleCode]
        .join(' ').toLocaleLowerCase();
      return words.every(word => searchable.includes(word));
    });
    const groups = new Map();
    for (const row of matches) {
      if (!row.ref) continue;
      if (groups.has(row.ref)) {
        const group = groups.get(row.ref);
        group.stockTotal += row.stock;
        if (row.stock > 0) group.sizesWithStock.add(row.size);
        continue;
      }
      if (groups.size >= maxResults) continue;
      groups.set(row.ref, {
        ref: row.ref, style: row.style, description: row.description,
        additionalDescription: row.additionalDescription, color: row.color,
        colorDescription: row.colorDescription, colorSpanish: row.colorSpanish,
        price: row.price, season: row.season, stockTotal: row.stock,
        sizesWithStock: new Set(row.stock > 0 ? [row.size] : [])
      });
    }
    return [...groups.values()].map(group => ({ ...group, sizesWithStock: group.sizesWithStock.size }));
  }
}
