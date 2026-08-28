import { styleColorFromParts } from '../vs-images/VsImageIdentity.js';

const isUrl = value => /^https?:\/\//i.test(String(value ?? '').trim());
const clean = value => value == null ? '' : String(value).trim();

export class VsRuntimeImageRepository {
  constructor(repository, imageResolutionCache = null) {
    this.repository = repository;
    this.imageResolutionCache = imageResolutionCache;
  }

  runtimeImageFor(style, color) {
    if (!this.imageResolutionCache) return null;
    const styleColor = styleColorFromParts(style, color);
    if (!styleColor) return null;
    const entry = this.imageResolutionCache.get(styleColor);
    if (!entry || entry.status !== 'MATCHED_SAFE' || !isUrl(entry.imageUrl) || !clean(entry.source)) return null;
    return { image: entry.imageUrl, imageSource: entry.source };
  }

  enrich(item) {
    if (!item || item.image) return item;
    const resolved = this.runtimeImageFor(item.STYLE ?? item.style, item.COLOR ?? item.color);
    return resolved ? { ...item, ...resolved } : item;
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
