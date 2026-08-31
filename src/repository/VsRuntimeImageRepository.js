import { styleColorFromParts } from '../vs-images/VsImageIdentity.js';

const isUrl = value => /^https?:\/\//i.test(String(value ?? '').trim());
const clean = value => value == null ? '' : String(value).trim();
const keyPart = value => clean(value).toUpperCase();
const excludedReferenceDepartments = new Set(['PERSONALCARE+BEAUTY']);

export class VsRuntimeImageRepository {
  constructor(repository, imageResolutionCache = null) {
    this.repository = repository;
    this.imageResolutionCache = imageResolutionCache;
    this.rowsByStyle = new Map();
    for (const row of Array.isArray(repository?.rows) ? repository.rows : []) {
      if (!styleColorFromParts(row.STYLE, row.COLOR)) continue;
      const style = keyPart(row.STYLE);
      this.rowsByStyle.set(style, [...(this.rowsByStyle.get(style) ?? []), row]);
    }
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
    const resolved = typeof this.repository?.toPublicRow === 'function' ? this.repository.toPublicRow(row) : row;
    if (!resolved?.image || !isUrl(resolved.image) || !clean(resolved.imageSource)) return null;
    return { image: resolved.image, imageSource: resolved.imageSource };
  }

  exactImageFor(row) {
    return this.bootstrapImageFor(row) ?? this.runtimeImageFor(row.STYLE ?? row.style, row.COLOR ?? row.color);
  }

  sameStyleReferenceFor(item) {
    const style = clean(item?.STYLE ?? item?.style);
    const requestedColor = keyPart(item?.COLOR ?? item?.color);
    const department = keyPart(item?.departamento ?? item?.department);
    if (!styleColorFromParts(style, requestedColor) || excludedReferenceDepartments.has(department)) return null;

    const candidates = (this.rowsByStyle.get(keyPart(style)) ?? [])
      .filter(row => keyPart(row.COLOR) !== requestedColor)
      .filter(row => !excludedReferenceDepartments.has(keyPart(row.departamento)))
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

  enrich(item) {
    if (!item || item.image) return item;
    const runtime = this.runtimeImageFor(item.STYLE ?? item.style, item.COLOR ?? item.color);
    if (runtime) return { ...item, ...runtime };
    const reference = this.sameStyleReferenceFor(item);
    return reference ? { ...item, ...reference } : item;
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

  searchCatalog(options = {}) {
    const result = this.repository.searchCatalog(options);
    return { ...result, items: result.items.map(item => this.enrich(item)) };
  }

  catalogFacets() { return this.repository.catalogFacets(); }
  metrics() { return this.repository.metrics(); }
}
