import { styleColorFromParts } from '../vs-images/VsImageIdentity.js';

const isUrl = value => /^https?:\/\//i.test(String(value ?? '').trim());
const clean = value => value == null ? '' : String(value).trim();
const keyPart = value => clean(value).toUpperCase();
const excludedSameStyleDepartments = new Set(['PERSONALCARE+BEAUTY']);
const excludedSameColorDepartments = new Set(['PERSONALCARE+BEAUTY', 'SUPPLIES']);
const sourcePrecedence = source => {
  const value = clean(source).toLowerCase();
  if (value === 'current') return 0;
  if (value === 'historical') return 1;
  if (value === 'style-color') return 2;
  if (value === 'vs-cr-refid') return 3;
  if (value === 'vs-india') return 4;
  if (value === 'vs-malta') return 5;
  if (value === 'vs-romania') return 6;
  if (value.startsWith('vs-supplemental-safe:')) return 7;
  return 8;
};

export class VsRuntimeImageRepository {
  constructor(repository, imageResolutionCache = null, imageRegistry = null) {
    this.repository = repository;
    this.imageResolutionCache = imageResolutionCache;
    this.imageRegistry = imageRegistry;
    this.rowsByStyle = new Map();
    this.exactRowsByColor = new Map();
    for (const row of Array.isArray(repository?.rows) ? repository.rows : []) {
      if (!styleColorFromParts(row.STYLE, row.COLOR)) continue;
      const style = keyPart(row.STYLE);
      this.rowsByStyle.set(style, [...(this.rowsByStyle.get(style) ?? []), row]);
      const resolved = this.exactImageFor(row);
      if (resolved && !excludedSameColorDepartments.has(keyPart(row.departamento))) {
        const color = keyPart(row.COLOR);
        this.exactRowsByColor.set(color, [...(this.exactRowsByColor.get(color) ?? []), { row, resolved }]);
      }
    }
    this.imageRegistry?.reconcile(repository?.rows, row => this.exactImageFor(row));
  }

  runtimeImageFor(style, color) {
    if (!this.imageResolutionCache) return null;
    const styleColor = styleColorFromParts(style, color);
    if (!styleColor) return null;
    const entry = this.imageResolutionCache.get(styleColor);
    if (!entry || entry.status !== 'MATCHED_SAFE' || !isUrl(entry.imageUrl) || !clean(entry.source)) return null;
    return { image: entry.imageUrl, imageSource: entry.source };
  }

  bootstrapImageFor(row) {
    if (row?.image && isUrl(row.image) && clean(row.imageSource) && row.imageIsReference !== true) {
      return { image: row.image, imageSource: row.imageSource };
    }
    const resolved = typeof this.repository?.toPublicRow === 'function' ? this.repository.toPublicRow(row) : row;
    if (!resolved?.image || !isUrl(resolved.image) || !clean(resolved.imageSource)
      || resolved.imageIsReference === true || /^same-(style|color)-reference$/i.test(clean(resolved.imageSource))) return null;
    return { image: resolved.image, imageSource: resolved.imageSource };
  }

  exactImageFor(row) {
    return this.bootstrapImageFor(row) ?? this.runtimeImageFor(row.STYLE ?? row.style, row.COLOR ?? row.color);
  }

  sameStyleReferenceFor(item) {
    const style = clean(item?.STYLE ?? item?.style);
    const requestedColor = keyPart(item?.COLOR ?? item?.color);
    const department = keyPart(item?.departamento ?? item?.department);
    if (!styleColorFromParts(style, requestedColor) || excludedSameStyleDepartments.has(department)) return null;

    const candidates = (this.rowsByStyle.get(keyPart(style)) ?? [])
      .filter(row => keyPart(row.COLOR) !== requestedColor)
      .filter(row => !excludedSameStyleDepartments.has(keyPart(row.departamento)))
      .map(row => ({ row, resolved: this.exactImageFor(row) }))
      .filter(candidate => candidate.resolved)
      .sort((left, right) => keyPart(left.row.COLOR).localeCompare(keyPart(right.row.COLOR))
        || clean(left.row.CODBARRAS).localeCompare(clean(right.row.CODBARRAS)));

    const selected = candidates[0];
    if (!selected) return null;
    return {
      image: selected.resolved.image,
      imageSource: 'same-style-reference',
      exactImage: false,
      imageIsReference: true,
      requestedColor,
      referenceImageColor: clean(selected.row.COLOR),
      referenceImageSource: selected.resolved.imageSource,
      referenceImageBarcode: clean(selected.row.CODBARRAS)
    };
  }

  sameColorReferenceFor(item) {
    const style = keyPart(item?.STYLE ?? item?.style);
    const color = keyPart(item?.COLOR ?? item?.color);
    const department = keyPart(item?.departamento ?? item?.department);
    if (!style || !color || excludedSameColorDepartments.has(department)) return null;

    const levelFor = candidate => {
      if (keyPart(candidate.departamento) !== department) return Infinity;
      if (keyPart(candidate.seccion) === keyPart(item?.seccion ?? item?.section)
        && keyPart(candidate.familia) === keyPart(item?.familia ?? item?.family)) return 1;
      if (keyPart(candidate.seccion) === keyPart(item?.seccion ?? item?.section)) return 2;
      return 3;
    };
    const selected = (this.exactRowsByColor.get(color) ?? [])
      .filter(candidate => keyPart(candidate.row.STYLE) !== style)
      .map(candidate => ({ ...candidate, level: levelFor(candidate.row) }))
      .filter(candidate => candidate.level !== Infinity)
      .sort((left, right) => left.level - right.level
        || sourcePrecedence(left.resolved.imageSource) - sourcePrecedence(right.resolved.imageSource)
        || keyPart(left.row.STYLE).localeCompare(keyPart(right.row.STYLE))
        || clean(left.row.CODBARRAS).localeCompare(clean(right.row.CODBARRAS)))[0];
    if (!selected) return null;
    return {
      referenceType: 'same-color', image: selected.resolved.image, imageSource: selected.resolved.imageSource,
      style: clean(selected.row.STYLE), color: clean(selected.row.COLOR), barcode: clean(selected.row.CODBARRAS),
      department: clean(selected.row.departamento), section: clean(selected.row.seccion), family: clean(selected.row.familia)
    };
  }

  enrich(item) {
    if (!item) return item;
    const exact = this.exactImageFor(item);
    if (exact) return { ...item, ...exact, colorReference: null };
    const colorReference = this.sameColorReferenceFor(item);
    const reference = this.sameStyleReferenceFor(item);
    return reference ? { ...item, ...reference, colorReference } : { ...item, colorReference };
  }

  async findByBarcode(barcode) {
    return this.enrich(await this.repository.findByBarcode(barcode));
  }

  async findByReference(reference) {
    return (await this.repository.findByReference(reference)).map(item => this.enrich(item));
  }

  async findByIdentity(identityKey) {
    return (await this.repository.findByIdentity(identityKey)).map(item => this.enrich(item));
  }

  async findByStyle(style) {
    return (await this.repository.findByStyle(style)).map(item => this.enrich(item));
  }

  async findByStyleColor(style, color) {
    return (await this.repository.findByStyleColor(style, color)).map(item => this.enrich(item));
  }

  catalogItemFor(item) {
    const enriched = this.enrich(item);
    const reference = enriched.imageIsReference === true;
    return {
      ...enriched,
      exactImage: Boolean(enriched.image) && !reference,
      imageIsReference: reference,
      requestedColor: reference ? (clean(enriched.requestedColor) || null) : null,
      referenceImageColor: reference ? (clean(enriched.referenceImageColor) || null) : null,
      referenceImageSource: reference ? (clean(enriched.referenceImageSource) || null) : null,
      referenceImageBarcode: reference ? (clean(enriched.referenceImageBarcode) || null) : null
    };
  }

  searchCatalog(options = {}) {
    const result = this.repository.searchCatalog(options);
    return { ...result, items: result.items.map(item => this.catalogItemFor(item)) };
  }

  catalogFacets() { return this.repository.catalogFacets(); }
  metrics() { return this.repository.metrics(); }
  imageCoverage() { return this.imageRegistry?.coverage() ?? null; }
  imageCoveragePending() { return this.imageRegistry?.pending() ?? []; }
}
