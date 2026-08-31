import XLSX from 'xlsx';
import { performance } from 'node:perf_hooks';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ProductRepository } from './ProductRepository.js';

const clean = value => value == null ? '' : String(value).replace(/^\uFEFF/, '').trim();
const keyPart = value => clean(value).toLocaleLowerCase();
const isUrl = value => /^https?:\/\//i.test(clean(value));
const structuralFields = ['DESCRIPCION', 'departamento', 'seccion', 'familia'];
const isValidStyle = value => clean(value) !== '' && !['.', '-', 'N/A', 'NA'].includes(clean(value).toUpperCase());
const isValidColor = value => clean(value) !== '' && !['.', '-', 'N/A', 'NA'].includes(clean(value).toUpperCase());

const normalHeader = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
const groupKeyFor = row => row.STYLE && row.COLOR && row.styleColorConsistent
  ? `${keyPart(row.STYLE)}|${keyPart(row.COLOR)}` : null;
const identityKeyFor = row => row.genericId && row.choiceFinal && row.COLOR
  ? `${keyPart(row.genericId)}|${keyPart(row.choiceFinal)}|${keyPart(row.COLOR)}` : null;

const parseDelimited = (text, delimiter = ';') => {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
};

const findHeaderRow = matrix => matrix.findIndex(row => row.some(cell => normalHeader(cell) === 'codbarras' || normalHeader(cell) === 'codbarras'));
const firstDefined = (row, aliases) => {
  for (const alias of aliases) if (Object.hasOwn(row, alias)) return row[alias];
  return '';
};

export class VsExcelProductRepository extends ProductRepository {
  constructor(stockFilePath, { imageCatalogFilePath = null, historicalImageFilePath = null, styleColorImageFilePath = null, vsCrImageFilePath = null, vsIndiaImageFilePath = null, vsMaltaImageFilePath = null, vsRomaniaImageFilePath = null, vsSupplementalImageFilePath = null } = {}) {
    super();
    const started = performance.now();
    this.stockFilePath = stockFilePath;
    this.rows = this.readStock(stockFilePath);
    this.imagesByBarcode = new Map();
    this.historicalImagesByBarcode = new Map();
    this.styleColorImagesByBarcode = new Map();
    this.vsCrImagesByBarcode = new Map();
    this.vsIndiaImagesByBarcode = new Map();
    this.vsMaltaImagesByBarcode = new Map();
    this.vsRomaniaImagesByBarcode = new Map();
    this.vsSupplementalImagesByBarcode = new Map();
    this.metadataByBarcode = new Map();
    this.readImageCatalog(imageCatalogFilePath);
    this.readHistoricalImageCatalog(historicalImageFilePath);
    this.readStyleColorImageCatalog(styleColorImageFilePath);
    this.readVsCrImageCatalog(vsCrImageFilePath);
    this.readVsIndiaImageCatalog(vsIndiaImageFilePath);
    this.readVsMaltaImageCatalog(vsMaltaImageFilePath);
    this.readVsRomaniaImageCatalog(vsRomaniaImageFilePath);
    this.readVsSupplementalImageCatalog(vsSupplementalImageFilePath);
    this.byBarcode = new Map();
    this.byReference = new Map();
    this.byStyle = new Map();
    this.byStyleColor = new Map();
    this.byIdentity = new Map();
    const styleColorRows = new Map();
    for (const row of this.rows) {
      const key = row.STYLE && row.COLOR ? `${keyPart(row.STYLE)}|${keyPart(row.COLOR)}` : null;
      if (key) styleColorRows.set(key, [...(styleColorRows.get(key) ?? []), row]);
    }
    for (const rows of styleColorRows.values()) {
      const signatures = new Set(rows.map(row => structuralFields.map(field => keyPart(row[field])).join('|')));
      const consistent = signatures.size === 1 && structuralFields.every(field => clean(rows[0][field]));
      for (const row of rows) row.styleColorConsistent = consistent;
    }
    for (const row of this.rows) {
      Object.assign(row, this.metadataByBarcode.get(row.CODBARRAS) ?? {});
      if (row.CODBARRAS) this.byBarcode.set(row.CODBARRAS, row);
      if (row.REFPROVEEDOR) this.byReference.set(keyPart(row.REFPROVEEDOR), [...(this.byReference.get(keyPart(row.REFPROVEEDOR)) ?? []), row]);
      if (isValidStyle(row.STYLE)) this.byStyle.set(keyPart(row.STYLE), [...(this.byStyle.get(keyPart(row.STYLE)) ?? []), row]);
      row.styleColorKey = groupKeyFor(row);
      row.identityKey = identityKeyFor(row);
      if (row.styleColorKey) this.byStyleColor.set(row.styleColorKey, [...(this.byStyleColor.get(row.styleColorKey) ?? []), row]);
      if (row.identityKey) this.byIdentity.set(row.identityKey, [...(this.byIdentity.get(row.identityKey) ?? []), row]);
    }
    this.catalogGroups = this.buildCatalogGroups();
    this.loadTimeMs = Math.round((performance.now() - started) * 100) / 100;
    this.barcodesIndexed = this.byBarcode.size;
    this.currentImagesLoaded = this.imagesByBarcode.size;
    this.historicalImagesLoaded = this.historicalImagesByBarcode.size;
    this.styleColorImagesLoaded = this.styleColorImagesByBarcode.size;
    this.vsCrImagesLoaded = this.vsCrImagesByBarcode.size;
    this.vsIndiaImagesLoaded = this.vsIndiaImagesByBarcode.size;
    this.vsMaltaImagesLoaded = this.vsMaltaImagesByBarcode.size;
    this.vsRomaniaImagesLoaded = this.vsRomaniaImagesByBarcode.size;
    this.vsSupplementalImagesLoaded = this.vsSupplementalImagesByBarcode.size;
    this.imagesLoaded = this.currentImagesLoaded + this.historicalImagesLoaded + this.styleColorImagesLoaded + this.vsCrImagesLoaded + this.vsIndiaImagesLoaded + this.vsMaltaImagesLoaded + this.vsRomaniaImagesLoaded + this.vsSupplementalImagesLoaded;
    this.reliableImagesLoaded = this.imagesLoaded;
    this.totalImagesLoaded = this.imagesLoaded;
    console.log(`VS cargado en ${this.loadTimeMs} ms; ${this.barcodesIndexed} barcodes; ${this.currentImagesLoaded} current; ${this.historicalImagesLoaded} historical; ${this.styleColorImagesLoaded} style-color; ${this.vsCrImagesLoaded} vs-cr-refid; ${this.vsIndiaImagesLoaded} vs-india; ${this.vsMaltaImagesLoaded} vs-malta; ${this.vsRomaniaImagesLoaded} vs-romania; ${this.vsSupplementalImagesLoaded} supplemental-safe; ${this.imagesLoaded} imagenes`);
  }

  readStock(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const rows = ext === '.json' ? this.readJsonStock(filePath)
      : ext === '.csv' ? this.readCsv(filePath)
      : this.readWorkbook(filePath);
    return rows.filter(row => row.STOCK > 0 && (row.CODBARRAS || row.CODBARRAS2));
  }

  readJsonStock(filePath) {
    return this.readJsonRows(filePath, 'inventario VS maestro').map(row => this.normalizeStockRow({
      codarticulo: row.codigoArticulo ?? row.CODARTICULO ?? row.codarticulo ?? '',
      referencia: row.referencia ?? row.REFPROVEEDOR ?? '',
      descripcion: row.descripcion ?? row.DESCRIPCION ?? '',
      temporada: row.temporada ?? row.TEMPORADA ?? '',
      talla: row.talla ?? row.TALLA ?? '',
      color: row.color ?? row.COLOR ?? '',
      codbarras: row.barcode ?? row.CODBARRAS ?? '',
      codbarras2: row.barcode2 ?? row.CODBARRAS2 ?? '',
      stock: row.stock ?? row.STOCK ?? 0,
      departamento: row.departamento ?? row.DEPARTAMENTO ?? '',
      seccion: row.seccion ?? row.SECCION ?? '',
      familia: row.familia ?? row.FAMILIA ?? '',
      subfamilia: row.subfamilia ?? row.SUBFAMILIA ?? '',
      style: row.style ?? row.STYLE ?? '',
      stylo: row.stylo ?? row.STYLO ?? ''
    }));
  }

  readCsv(filePath) {
    const text = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const matrix = parseDelimited(text, ';');
    const headerRow = findHeaderRow(matrix);
    if (headerRow < 0) throw new Error('No se encontró el encabezado Cód. Barras en el CSV VS');
    const headers = matrix[headerRow].map(normalHeader);
    const makeObject = row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
    return matrix.slice(headerRow + 1).map(row => this.normalizeStockRow(makeObject(row), true));
  }

  readWorkbook(filePath) {
    const workbook = XLSX.readFile(filePath, { raw: true, cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    const headerRow = findHeaderRow(matrix);
    if (headerRow < 0) throw new Error('No se encontró el encabezado CODBARRAS en el Excel VS');
    const headers = matrix[headerRow].map(normalHeader);
    const makeObject = row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
    return matrix.slice(headerRow + 1).map(row => this.normalizeStockRow(makeObject(row), false));
  }

  normalizeStockRow(row) {
    const value = (...aliases) => clean(firstDefined(row, aliases.map(normalHeader)));
    return {
      CODARTICULO: value('CODARTICULO', 'Código Artículo'),
      REFPROVEEDOR: value('REFPROVEEDOR', 'Referencia'),
      DESCRIPCION: value('DESCRIPCION', 'Descripción'),
      TEMPORADA: value('TEMPORADA', 'Temporada'),
      TALLA: value('TALLA', 'Talla'),
      COLOR: value('COLOR', 'Color'),
      CODBARRAS: value('CODBARRAS', 'Cód. Barras'),
      CODBARRAS2: value('CODBARRAS2', 'Cód. Barras 2'),
      STOCK: Number(String(value('STOCK', 'Stock')).replace(',', '.')) || 0,
      departamento: value('departamento', 'Departamento'),
      seccion: value('seccion', 'Seccion'),
      familia: value('familia', 'Família', 'Familia'),
      subfamilia: value('subfamilia', 'SubFamilia'),
      STYLE: value('STYLE'),
      STYLO: value('STYLO')
    };
  }

  readJsonRows(filePath, labels) {
    if (!filePath) throw new Error(`No se configuró ${labels}`);
    const json = JSON.parse(readFileSync(filePath, 'utf8'));
    const rows = Array.isArray(json) ? json : (json.results ?? json.rows ?? json.resultados);
    if (!Array.isArray(rows)) throw new Error(`El JSON de ${labels} no contiene resultados`);
    return rows;
  }

  readImageCatalog(filePath) {
    for (const row of this.readJsonRows(filePath, 'imágenes VS actuales')) {
      const barcode = clean(row.CODBARRAS ?? row.barcode);
      const url = clean(row.image_url_final ?? row.image_url);
      const valid = row.clasificacion === 'MATCH_COLOR_ACTUAL' && isUrl(url)
        && Number(row.image_http_status ?? row.http_status) >= 200 && Number(row.image_http_status ?? row.http_status) < 300;
      if (barcode) this.metadataByBarcode.set(barcode, { genericId: clean(row.genericId), choiceFinal: clean(row.choice_final), productId: clean(row.productId), classification: clean(row.clasificacion) });
      if (barcode && valid) this.imagesByBarcode.set(barcode, url);
    }
  }

  readHistoricalImageCatalog(filePath) {
    for (const row of this.readJsonRows(filePath, 'imágenes históricas VS')) {
      const barcode = clean(row.CODBARRAS ?? row.barcode);
      const url = clean(row.image_url_historica);
      const valid = row.clasificacion === 'HISTORICA_RECUPERADA' && isUrl(url)
        && Number(row.http_status) >= 200 && Number(row.http_status) < 300;
      if (barcode && valid && !this.imagesByBarcode.has(barcode)) this.historicalImagesByBarcode.set(barcode, url);
    }
  }

  readStyleColorImageCatalog(filePath) {
    if (!filePath) return;
    for (const row of this.readJsonRows(filePath, 'recuperación STYLE+COLOR VS')) {
      const barcode = clean(row.CODBARRAS ?? row.barcode);
      const url = clean(row.image ?? row.image_url);
      const valid = row.clasificacion === 'STYLE_COLOR_RECUPERADO' && isUrl(url);
      if (barcode && valid && !this.imagesByBarcode.has(barcode) && !this.historicalImagesByBarcode.has(barcode)) this.styleColorImagesByBarcode.set(barcode, url);
    }
  }

  readVsCrImageCatalog(filePath) {
    if (!filePath || !existsSync(filePath)) return;
    for (const row of this.readJsonRows(filePath, 'recuperaciÃ³n VS Costa Rica')) {
      const barcode = clean(row.CODBARRAS ?? row.barcode);
      const url = clean(row.imageUrl ?? row.image_url);
      const result = clean(row.resultado).toUpperCase();
      const valid = ['MATCHED', 'SAFE_DESPITE_PRODUCTREFERENCE'].includes(result) && isUrl(url);
      if (barcode && valid && !this.imagesByBarcode.has(barcode) && !this.historicalImagesByBarcode.has(barcode) && !this.styleColorImagesByBarcode.has(barcode)) {
        this.vsCrImagesByBarcode.set(barcode, url);
      }
    }
  }

  readVsIndiaImageCatalog(filePath) {
    if (!filePath || !existsSync(filePath)) return;
    for (const row of this.readJsonRows(filePath, 'recuperacion VS India')) {
      const barcode = clean(row.CODBARRAS ?? row.barcode);
      const url = clean(row.imageUrl ?? row.image_url ?? row.image);
      const evidence = row.evidence ?? {};
      const valid = isUrl(url)
        && evidence.itemSizeIdMatchesBarcode === true
        && evidence.itemIdMatchesStyleColor === true
        && evidence.masterStyleMatchesStyle === true;
      if (barcode && valid && !this.imagesByBarcode.has(barcode) && !this.historicalImagesByBarcode.has(barcode) && !this.styleColorImagesByBarcode.has(barcode) && !this.vsCrImagesByBarcode.has(barcode)) {
        this.vsIndiaImagesByBarcode.set(barcode, url);
      }
    }
  }

  readVsMaltaImageCatalog(filePath) {
    if (!filePath || !existsSync(filePath)) return;
    for (const row of this.readJsonRows(filePath, 'recuperacion VS Malta')) {
      const barcode = clean(row.barcode ?? row.CODBARRAS);
      const url = clean(row.imageUrl ?? row.image_url ?? row.image);
      const valid = clean(row.classification).toUpperCase() === 'MATCHED_SAFE' && isUrl(url);
      if (barcode && valid && !this.imagesByBarcode.has(barcode) && !this.historicalImagesByBarcode.has(barcode) && !this.styleColorImagesByBarcode.has(barcode) && !this.vsCrImagesByBarcode.has(barcode) && !this.vsIndiaImagesByBarcode.has(barcode)) {
        this.vsMaltaImagesByBarcode.set(barcode, url);
      }
    }
  }

  readVsRomaniaImageCatalog(filePath) {
    if (!filePath || !existsSync(filePath)) return;
    const conflictingBarcodes = new Set();
    try {
      for (const row of this.readJsonRows(filePath, 'recuperacion VS Romania')) {
        const barcode = clean(row.barcode ?? row.CODBARRAS);
        const url = clean(row.imageUrl ?? row.image_url ?? row.image);
        const expectedSku = clean(row.styleColorNormalized);
        const remoteSku = clean(row.remoteSku ?? row.skuRomania);
        const imageValidation = row.imageValidation ?? {};
        const valid = clean(row.classification).toUpperCase() === 'MATCHED_SAFE'
          && expectedSku !== '' && remoteSku === expectedSku && isUrl(url)
          && Number(imageValidation.httpStatus) >= 200 && Number(imageValidation.httpStatus) < 300
          && /^image\//i.test(clean(imageValidation.contentType))
          && imageValidation.placeholder === false && imageValidation.urlContainsExactSku === true;
        if (!barcode || !valid || conflictingBarcodes.has(barcode)
          || this.imagesByBarcode.has(barcode) || this.historicalImagesByBarcode.has(barcode)
          || this.styleColorImagesByBarcode.has(barcode) || this.vsCrImagesByBarcode.has(barcode)
          || this.vsIndiaImagesByBarcode.has(barcode) || this.vsMaltaImagesByBarcode.has(barcode)) continue;
        const existing = this.vsRomaniaImagesByBarcode.get(barcode);
        if (existing && (existing.url !== url || existing.remoteSku !== remoteSku)) {
          this.vsRomaniaImagesByBarcode.delete(barcode);
          conflictingBarcodes.add(barcode);
        } else if (!existing) this.vsRomaniaImagesByBarcode.set(barcode, { url, remoteSku });
      }
    } catch (error) {
      this.vsRomaniaImagesByBarcode.clear();
      console.warn(`No se pudo cargar recuperacion VS Romania: ${error.message}`);
    }
  }

  readVsSupplementalImageCatalog(filePath) {
    if (!filePath || !existsSync(filePath)) return;
    const acceptedSources = new Set(['vs-australia', 'vs-mena', 'vs-singapore', 'vs-mexico']);
    const conflictingBarcodes = new Set();
    try {
      for (const row of this.readJsonRows(filePath, 'recuperacion VS supplemental safe')) {
        const barcode = clean(row.barcode ?? row.CODBARRAS);
        const style = clean(row.style ?? row.STYLE);
        const color = clean(row.color ?? row.COLOR);
        const styleColor = clean(row.styleColor);
        const url = clean(row.imageUrl ?? row.image_url ?? row.image);
        const source = clean(row.source).toLowerCase();
        const evidence = row.evidence ?? {};
        const imageValidation = evidence.imageValidation ?? {};
        const expectedStyleColor = style && color ? `${style}-${color}` : '';
        const valid = clean(row.classification).toUpperCase() === 'MATCHED_SAFE'
          && acceptedSources.has(source) && barcode && expectedStyleColor === styleColor
          && clean(evidence.localBarcode) === barcode && clean(evidence.localStyleColor) === styleColor
          && isUrl(url) && imageValidation.ok === true
          && Number(imageValidation.status) >= 200 && Number(imageValidation.status) < 300
          && /^image\//i.test(clean(imageValidation.contentType)) && clean(imageValidation.url) === url;
        if (!valid || conflictingBarcodes.has(barcode)
          || this.imagesByBarcode.has(barcode) || this.historicalImagesByBarcode.has(barcode)
          || this.styleColorImagesByBarcode.has(barcode) || this.vsCrImagesByBarcode.has(barcode)
          || this.vsIndiaImagesByBarcode.has(barcode) || this.vsMaltaImagesByBarcode.has(barcode)
          || this.vsRomaniaImagesByBarcode.has(barcode)) continue;
        const existing = this.vsSupplementalImagesByBarcode.get(barcode);
        if (existing && (existing.url !== url || existing.source !== source || existing.styleColor !== styleColor)) {
          this.vsSupplementalImagesByBarcode.delete(barcode);
          conflictingBarcodes.add(barcode);
        } else if (!existing) this.vsSupplementalImagesByBarcode.set(barcode, { url, source, styleColor });
      }
    } catch (error) {
      this.vsSupplementalImagesByBarcode.clear();
      console.warn(`No se pudo cargar recuperacion VS supplemental safe: ${error.message}`);
    }
  }

  imageFor(row) {
    if (this.imagesByBarcode.has(row.CODBARRAS)) return { image: this.imagesByBarcode.get(row.CODBARRAS), source: 'current' };
    if (this.historicalImagesByBarcode.has(row.CODBARRAS)) return { image: this.historicalImagesByBarcode.get(row.CODBARRAS), source: 'historical' };
    if (this.styleColorImagesByBarcode.has(row.CODBARRAS)) return { image: this.styleColorImagesByBarcode.get(row.CODBARRAS), source: 'style-color' };
    if (this.vsCrImagesByBarcode.has(row.CODBARRAS)) return { image: this.vsCrImagesByBarcode.get(row.CODBARRAS), source: 'vs-cr-refid' };
    if (this.vsIndiaImagesByBarcode.has(row.CODBARRAS)) return { image: this.vsIndiaImagesByBarcode.get(row.CODBARRAS), source: 'vs-india' };
    if (this.vsMaltaImagesByBarcode.has(row.CODBARRAS)) return { image: this.vsMaltaImagesByBarcode.get(row.CODBARRAS), source: 'vs-malta' };
    if (this.vsRomaniaImagesByBarcode.has(row.CODBARRAS)) return { image: this.vsRomaniaImagesByBarcode.get(row.CODBARRAS).url, source: 'vs-romania' };
    if (this.vsSupplementalImagesByBarcode.has(row.CODBARRAS)) {
      const supplemental = this.vsSupplementalImagesByBarcode.get(row.CODBARRAS);
      return { image: supplemental.url, source: `vs-supplemental-safe:${supplemental.source}` };
    }
    return { image: null, source: null };
  }

  toPublicRow(row) {
    const resolved = this.imageFor(row);
    return { ...row, image: resolved.image, imageSource: resolved.source };
  }

  async findByBarcode(barcode) {
    const started = performance.now();
    const row = this.byBarcode.get(clean(barcode)) ?? null;
    this.lastLookupMs = Math.round((performance.now() - started) * 1000) / 1000;
    return row ? this.toPublicRow(row) : null;
  }

  async findByReference(reference) { return (this.byReference.get(keyPart(reference)) ?? []).map(row => this.toPublicRow(row)); }

  async findByIdentity(identityKey) { return (this.byIdentity.get(identityKey) ?? []).map(row => this.toPublicRow(row)); }
  async findByStyle(style) { return (this.byStyle.get(keyPart(style)) ?? []).map(row => this.toPublicRow(row)); }
  async findByStyleColor(style, color) { return (this.byStyleColor.get(`${keyPart(style)}|${keyPart(color)}`) ?? []).map(row => this.toPublicRow(row)); }

  buildCatalogGroups() {
    const grouped = new Map();
    for (const row of this.rows) {
      const key = isValidStyle(row.STYLE) && isValidColor(row.COLOR)
        ? `style-color:${keyPart(row.STYLE)}|${keyPart(row.COLOR)}`
        : `barcode:${row.CODBARRAS}`;
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    return [...grouped.values()].map(rows => {
      const resolved = rows.map(row => ({ row, ...this.toPublicRow(row) }));
      const representative = [...resolved].sort((left, right) => {
        const imageOrder = Number(Boolean(right.image)) - Number(Boolean(left.image));
        return imageOrder || clean(left.CODBARRAS).localeCompare(clean(right.CODBARRAS));
      })[0];
      const sizes = new Set(rows.map(row => clean(row.TALLA)).filter(Boolean));
      return {
        barcode: representative.CODBARRAS,
        image: representative.image ?? null,
        imageSource: representative.imageSource ?? null,
        description: representative.DESCRIPCION,
        style: representative.STYLE,
        stylo: representative.STYLO,
        color: representative.COLOR,
        subfamily: representative.subfamilia,
        stock: rows.reduce((total, row) => total + Number(row.STOCK ?? 0), 0),
        availableSizes: sizes.size,
        supplierReference: representative.REFPROVEEDOR,
        department: representative.departamento,
        section: representative.seccion,
        family: representative.familia
      };
    }).sort((left, right) => `${left.style}|${left.color}|${left.barcode}`.localeCompare(`${right.style}|${right.color}|${right.barcode}`));
  }

  searchCatalog({ query = '', department = '', section = '', family = '', subfamily = '', offset = 0, limit = 50 } = {}) {
    const q = keyPart(query);
    const base = this.catalogGroups.filter(item => !q || [item.description, item.style, item.color, item.subfamily, item.barcode, item.supplierReference].map(keyPart).join('|').includes(q));
    const withFilters = (items, filters) => items.filter(item => (!filters.department || keyPart(item.department) === keyPart(filters.department))
      && (!filters.section || keyPart(item.section) === keyPart(filters.section))
      && (!filters.family || keyPart(item.family) === keyPart(filters.family))
      && (!filters.subfamily || keyPart(item.subfamily) === keyPart(filters.subfamily)));
    const matches = withFilters(base, { department, section, family, subfamily });
    const facetValues = (items, field) => [...new Set(items.map(item => clean(item[field])).filter(Boolean))].sort((left, right) => left.localeCompare(right));
    const facets = {
      departments: facetValues(withFilters(base, { section, family, subfamily }), 'department'),
      sections: facetValues(withFilters(base, { department, family, subfamily }), 'section'),
      families: facetValues(withFilters(base, { department, section, subfamily }), 'family'),
      subfamilies: facetValues(withFilters(base, { department, section, family }), 'subfamily')
    };
    const start = Math.max(0, Number(offset) || 0);
    const pageSize = Math.min(100, Math.max(1, Number(limit) || 50));
    return { items: matches.slice(start, start + pageSize), total: matches.length, offset: start, limit: pageSize, hasMore: start + pageSize < matches.length, facets };
  }

  catalogFacets() {
    const values = field => [...new Set(this.catalogGroups.map(item => clean(item[field])).filter(Boolean))].sort((left, right) => left.localeCompare(right));
    return { departments: values('department'), sections: values('section'), families: values('family'), subfamilies: values('subfamily') };
  }

  metrics() {
    return { loadTimeMs: this.loadTimeMs, barcodesIndexed: this.barcodesIndexed,
      currentImagesLoaded: this.currentImagesLoaded, historicalImagesLoaded: this.historicalImagesLoaded,
      styleColorImagesLoaded: this.styleColorImagesLoaded, vsCrImagesLoaded: this.vsCrImagesLoaded,
      vsIndiaImagesLoaded: this.vsIndiaImagesLoaded,
      vsMaltaImagesLoaded: this.vsMaltaImagesLoaded,
      vsRomaniaImagesLoaded: this.vsRomaniaImagesLoaded,
      vsSupplementalImagesLoaded: this.vsSupplementalImagesLoaded,
      imagesLoaded: this.imagesLoaded, totalImagesLoaded: this.imagesLoaded,
      reliableImagesLoaded: this.reliableImagesLoaded, lastLookupMs: this.lastLookupMs ?? null };
  }
}
