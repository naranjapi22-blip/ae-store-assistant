import { styleColorFromParts } from './VsImageIdentity.js';

const clean = value => value == null ? '' : String(value).trim();
const MAX_BATCH_SIZE = 50;
const DEFAULT_BATCH_SIZE = 10;

export const pendingBatchSize = value => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(parsed, MAX_BATCH_SIZE);
};

const representativeFor = rows => [...rows].sort((left, right) =>
  Number(right.STOCK ?? right.stock ?? 0) - Number(left.STOCK ?? left.stock ?? 0)
  || clean(left.CODBARRAS ?? left.barcode).localeCompare(clean(right.CODBARRAS ?? right.barcode)))[0] ?? null;

const technicalFailure = error => ({
  status: 'REQUEST_ERROR',
  lastError: clean(error?.message).replace(/[\r\n]+/g, ' ').slice(0, 160) || 'Resolver error'
});

export class VsPendingImageResolver {
  constructor({ registry, imageResolver, runtimeRepository, cache, batchSize = DEFAULT_BATCH_SIZE, dryRun = false } = {}) {
    if (!registry) throw new Error('VsPendingImageResolver requiere registry');
    if (!imageResolver) throw new Error('VsPendingImageResolver requiere imageResolver');
    if (!runtimeRepository) throw new Error('VsPendingImageResolver requiere runtimeRepository');
    this.registry = registry;
    this.imageResolver = imageResolver;
    this.runtimeRepository = runtimeRepository;
    this.cache = cache;
    this.batchSize = pendingBatchSize(batchSize);
    this.dryRun = dryRun === true;
    this.running = false;
  }

  select(limit = this.batchSize) {
    return this.registry.pendingEntries().slice(0, pendingBatchSize(limit)).map(item => ({
      ...item,
      representative: representativeFor(item.rows)
    })).filter(item => item.key && item.representative);
  }

  async runBatch({ limit = this.batchSize, dryRun = this.dryRun } = {}) {
    if (this.running) {
      const error = new Error('VS pending resolver already running');
      error.code = 'VS_PENDING_RESOLVER_RUNNING';
      throw error;
    }
    this.running = true;
    try {
      const selected = this.select(limit);
      const summary = {
        requested: pendingBatchSize(limit), processed: 0, matchedSafe: 0, noMatch: 0,
        requestError: 0, identityConflict: 0, remainingPending: this.registry.pending().length,
        dryRun: Boolean(dryRun), items: selected.map(item => ({
          STYLE: item.STYLE, COLOR: item.COLOR, stockActualTotal: item.stockActualTotal,
          departamento: item.departamento, barcodes: item.barcodes, firstSeenAt: item.firstSeenAt,
          representativeBarcode: clean(item.representative.CODBARRAS ?? item.representative.barcode)
        }))
      };
      if (dryRun) return summary;

      for (const item of selected) {
        const styleColor = styleColorFromParts(item.STYLE, item.COLOR);
        let result;
        try {
          result = await this.imageResolver.resolveCandidate({ style: item.STYLE, color: item.COLOR, styleColor }, this.cache?.get(styleColor));
        } catch (error) { result = technicalFailure(error); }
        const status = clean(result?.status).toUpperCase();
        if (this.cache && ['MATCHED_SAFE', 'NO_MATCH', 'REQUEST_ERROR', 'IDENTITY_CONFLICT'].includes(status)) {
          this.cache.set(styleColor, result);
        }
        const entry = this.registry.recordResolution(styleColor, result);
        if (!entry) continue;
        summary.processed += 1;
        if (status === 'MATCHED_SAFE') {
          summary.matchedSafe += 1;
          this.runtimeRepository.registerRuntimeMatch?.(styleColor, entry);
        } else if (status === 'NO_MATCH') summary.noMatch += 1;
        else if (status === 'IDENTITY_CONFLICT') summary.identityConflict += 1;
        else summary.requestError += 1;
        if (status === 'IDENTITY_CONFLICT') break;
      }
      if (this.cache?.filePath) this.cache.save();
      summary.remainingPending = this.registry.pending().length;
      return summary;
    } finally { this.running = false; }
  }
}
