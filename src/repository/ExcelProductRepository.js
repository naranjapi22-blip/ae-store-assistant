import XLSX from 'xlsx';
import { ProductRepository } from './ProductRepository.js';

const clean = value => value == null ? '' : String(value).trim();
const headers = {
  barcode: ['Cód. Barras', 'CODBARRAS'],
  barcode2: ['CODBARRAS2'],
  description: ['Descripción'], size: ['Talla'], color: ['Color'],
  ref: ['REFERENCIA_STYLO'], style: ['STYLE'], stock: ['Stock']
};

export class ExcelProductRepository extends ProductRepository {
  constructor(filePath) {
    super();
    const workbook = XLSX.readFile(filePath, { raw: true, cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    const headerRow = matrix.findIndex(row => row.some(cell => clean(cell) === 'Cód. Barras'));
    if (headerRow < 0) throw new Error('No se encontró el encabezado Cód. Barras');
    const actualHeaders = matrix[headerRow].map(clean);
    const index = key => headers[key].map(name => actualHeaders.indexOf(name)).find(i => i >= 0);
    this.rows = matrix.slice(headerRow + 1).map(row => ({
      CODBARRAS: clean(index('barcode') === undefined ? '' : row[index('barcode')]),
      CODBARRAS2: clean(index('barcode2') === undefined ? '' : row[index('barcode2')]),
      description: clean(row[index('description')]), size: clean(row[index('size')]),
      color: clean(row[index('color')]), ref: clean(row[index('ref')]),
      style: clean(row[index('style')]), stock: Number(row[index('stock')] ?? 0)
    })).filter(row => row.CODBARRAS || row.CODBARRAS2);
  }

  async findByBarcode(barcode) {
    const value = clean(barcode);
    return this.rows.find(row => row.CODBARRAS === value || row.CODBARRAS2 === value) ?? null;
  }

  async findByReference(ref) { return this.rows.filter(row => row.ref === clean(ref)); }
  async findByStyle(style) { return this.rows.filter(row => row.style === clean(style)); }
}
