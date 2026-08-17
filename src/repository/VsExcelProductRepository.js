import XLSX from 'xlsx';
import { performance } from 'node:perf_hooks';
import { ProductRepository } from './ProductRepository.js';

const clean = value => value == null ? '' : String(value).trim();
const keyPart = value => clean(value).toLocaleLowerCase();
const isUrl = value => /^https?:\/\//i.test(clean(value));
const visualFields = ['DESCRIPCION', 'COLOR', 'departamento', 'seccion', 'familia'];

const groupKeyFor = row => {
  if (visualFields.some(field => !clean(row[field]))) return null;
  return visualFields.map(field => keyPart(row[field])).join('|');
};

const identityKeyFor = row => row.genericId && row.choiceValue && row.COLOR
  ? `${keyPart(row.genericId)}|${keyPart(row.choiceValue)}|${keyPart(row.COLOR)}`
  : null;

const findHeaderRow = matrix => matrix.findIndex(row => row.some(cell => clean(cell) === 'CODBARRAS'));

export class VsExcelProductRepository extends ProductRepository {
  constructor(stockFilePath, { imageCoverageFilePath = null } = {}) {
    super();
    const started = performance.now();
    this.stockFilePath = stockFilePath;
    this.rows = this.readStock(stockFilePath);
    this.imagesByBarcode = new Map();
    this.metadataByBarcode = new Map();
    this.readCoverage(imageCoverageFilePath);
    this.byBarcode = new Map();
    this.byVisualGroup = new Map();
    this.byIdentity = new Map();
    for (const row of this.rows) {
      Object.assign(row, this.metadataByBarcode.get(row.CODBARRAS) ?? {});
      if (row.CODBARRAS) this.byBarcode.set(row.CODBARRAS, row);
      if (row.CODBARRAS2) this.byBarcode.set(row.CODBARRAS2, row);
      row.visualGroupKey = groupKeyFor(row);
      row.identityKey = identityKeyFor(row);
      if (row.visualGroupKey) this.byVisualGroup.set(row.visualGroupKey, [...(this.byVisualGroup.get(row.visualGroupKey) ?? []), row]);
      if (row.identityKey) this.byIdentity.set(row.identityKey, [...(this.byIdentity.get(row.identityKey) ?? []), row]);
    }
    this.loadTimeMs = Math.round((performance.now() - started) * 100) / 100;
    this.barcodesIndexed = this.byBarcode.size;
    console.log(`VS Excel cargado en ${this.loadTimeMs} ms; ${this.barcodesIndexed} barcodes indexados`);
  }

  readStock(filePath) {
    const workbook = XLSX.readFile(filePath, { raw: true, cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    const headerRow = findHeaderRow(matrix);
    if (headerRow < 0) throw new Error('No se encontró el encabezado CODBARRAS en el Excel VS');
    const headers = matrix[headerRow].map(clean);
    const index = header => headers.indexOf(header);
    const value = (row, header) => {
      const position = index(header);
      return position < 0 ? null : row[position];
    };
    return matrix.slice(headerRow + 1).map(row => ({
      CODARTICULO: clean(value(row, 'CODARTICULO')),
      REFPROVEEDOR: clean(value(row, 'REFPROVEEDOR')),
      DESCRIPCION: clean(value(row, 'DESCRIPCION')),
      TEMPORADA: clean(value(row, 'TEMPORADA')),
      TALLA: clean(value(row, 'TALLA')),
      COLOR: clean(value(row, 'COLOR')),
      CODBARRAS: clean(value(row, 'CODBARRAS')),
      CODBARRAS2: clean(value(row, 'CODBARRAS2')),
      CODALMACEN: clean(value(row, 'CODALMACEN')),
      STOCK: Number(value(row, 'STOCK') ?? 0) || 0,
      departamento: clean(value(row, 'departamento')),
      seccion: clean(value(row, 'seccion')),
      familia: clean(value(row, 'familia'))
    })).filter(row => row.STOCK > 0 && (row.CODBARRAS || row.CODBARRAS2));
  }

  readCoverage(filePath) {
    if (!filePath) return;
    const workbook = XLSX.readFile(filePath, { raw: true, cellDates: false });
    const sheet = workbook.Sheets.Barcode ?? workbook.Sheets.Barcodes ?? workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
    for (const row of rows) {
      const barcode = clean(row.CODBARRAS);
      const url = clean(row.imagen_visual_final_url);
      if (barcode && isUrl(url)) this.imagesByBarcode.set(barcode, url);
      if (barcode) this.metadataByBarcode.set(barcode, {
        genericId: clean(row.genericId), choiceValue: clean(row.choiceValue), name: clean(row.name),
        productId: clean(row.productId), eventId: clean(row.eventId)
      });
    }
  }

  imageFor(row, groupRows = []) {
    if (this.imagesByBarcode.has(row.CODBARRAS)) return this.imagesByBarcode.get(row.CODBARRAS);
    const urls = [...new Set(groupRows.map(item => this.imagesByBarcode.get(item.CODBARRAS)).filter(Boolean))];
    return urls.length === 1 ? urls[0] : null;
  }

  toPublicRow(row, groupRows = []) {
    return { ...row, image: this.imageFor(row, groupRows) };
  }

  async findByBarcode(barcode) {
    const started = performance.now();
    const row = this.byBarcode.get(clean(barcode)) ?? null;
    this.lastLookupMs = Math.round((performance.now() - started) * 1000) / 1000;
    return row ? this.toPublicRow(row, this.byVisualGroup.get(row.visualGroupKey) ?? []) : null;
  }

  async findByIdentity(identityKey) {
    return (this.byIdentity.get(identityKey) ?? []).map(row => this.toPublicRow(row, this.byVisualGroup.get(row.visualGroupKey) ?? []));
  }

  metrics() {
    return { loadTimeMs: this.loadTimeMs, barcodesIndexed: this.barcodesIndexed, lastLookupMs: this.lastLookupMs ?? null };
  }
}
