import { styleColorFromParts } from './VsImageIdentity.js';

const clean = value => value == null ? '' : String(value).trim();

export class VsImageResolver {
  constructor({ repository, cache, providers = [], concurrency = 1, maxCandidates = Infinity, checkpointEvery = 10, onProgress = null } = {}) {
    if (!repository) throw new Error('VsImageResolver requiere repository');
    if (!cache) throw new Error('VsImageResolver requiere cache');
    this.repository = repository;
    this.cache = cache;
    this.providers = providers;
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    const parsedMax = Number(maxCandidates);
    this.maxCandidates = Number.isFinite(parsedMax) && parsedMax > 0 ? Math.floor(parsedMax) : Infinity;
    this.checkpointEvery = Math.max(1, Number(checkpointEvery) || 10);
    this.onProgress = typeof onProgress === 'function' ? onProgress : null;
  }

  candidates() {
    const seen = new Set();
    const candidates = [];
    for (const row of this.repository.rows ?? []) {
      const existing = this.repository.imageFor?.(row);
      if (existing?.image) continue;
      const styleColor = styleColorFromParts(row.STYLE, row.COLOR);
      if (!styleColor || seen.has(styleColor)) continue;
      seen.add(styleColor);
      candidates.push({ style: clean(row.STYLE), color: clean(row.COLOR), styleColor });
      if (candidates.length >= this.maxCandidates) break;
    }
    return candidates;
  }

  async resolveAll() {
    const candidates = this.candidates();
    let index = 0;
    let completed = 0;
    const summary = { total: candidates.length, matched: 0, noMatch: 0, requestError: 0, identityConflict: 0, skipped: 0 };

    const checkpoint = candidate => {
      completed += 1;
      if (this.cache.filePath && (completed % this.checkpointEvery === 0 || completed === candidates.length)) this.cache.save();
      this.onProgress?.({ completed, total: candidates.length, candidate, summary: { ...summary } });
    };

    const worker = async () => {
      while (true) {
        const current = index;
        index += 1;
        if (current >= candidates.length) return;
        const candidate = candidates[current];
        const existing = this.cache.get(candidate.styleColor);
        if (existing?.status === 'MATCHED_SAFE') {
          summary.skipped += 1;
          checkpoint(candidate);
          continue;
        }
        const result = await this.resolveCandidate(candidate, existing);
        if (result.status === 'MATCHED_SAFE') summary.matched += 1;
        else if (result.status === 'NO_MATCH') summary.noMatch += 1;
        else if (result.status === 'REQUEST_ERROR') summary.requestError += 1;
        else if (result.status === 'IDENTITY_CONFLICT') summary.identityConflict += 1;
        checkpoint(candidate);
      }
    };

    await Promise.all(Array.from({ length: Math.min(this.concurrency, Math.max(1, candidates.length)) }, () => worker()));
    if (this.cache.filePath && candidates.length === 0) this.cache.save();
    return summary;
  }

  async resolveCandidate(candidate, existing = null) {
    const checked = new Set(existing?.checkedProviders ?? []);
    for (const provider of this.providers) {
      if (checked.has(provider.name)) continue;
      const result = await provider.resolve(candidate);
      checked.add(provider.name);
      const entry = { ...result, checkedProviders: [...checked] };
      this.cache.set(candidate.styleColor, entry);
      if (result.status === 'MATCHED_SAFE' || result.status === 'IDENTITY_CONFLICT') return result;
    }
    const final = this.cache.get(candidate.styleColor);
    if (final) return final;
    const fallback = { status: 'NO_MATCH', checkedProviders: [...checked] };
    this.cache.set(candidate.styleColor, fallback);
    return fallback;
  }
}
