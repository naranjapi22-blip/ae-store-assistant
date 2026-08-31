import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { styleColorFromParts } from './VsImageIdentity.js';

const VERSION = 1;
const STATUSES = new Set(['MATCHED_SAFE', 'PENDING', 'NO_MATCH', 'REQUEST_ERROR', 'IDENTITY_CONFLICT']);
const clean = value => value == null ? '' : String(value).trim();
const isUrl = value => /^https?:\/\//i.test(clean(value));
const providerNames = value => [...new Set((Array.isArray(value) ? value : []).filter(item => typeof item === 'string').map(clean).filter(Boolean))];
const sourceRank = source => {
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

const sanitizeEntry = (key, value = {}) => {
  const [style, color] = clean(key).split('-');
  const styleColor = styleColorFromParts(style, color);
  const status = clean(value.status).toUpperCase();
  if (!styleColor || !STATUSES.has(status)) return null;
  const entry = {
    style,
    color,
    status,
    firstSeenAt: clean(value.firstSeenAt) || null,
    lastSeenAt: clean(value.lastSeenAt) || null,
    lastCheckedAt: clean(value.lastCheckedAt) || null,
    attemptCount: Math.max(0, Math.floor(Number(value.attemptCount) || 0)),
    checkedProviders: providerNames(value.checkedProviders),
    barcodes: [...new Set((Array.isArray(value.barcodes) ? value.barcodes : []).map(clean).filter(Boolean))].sort()
  };
  if (status === 'MATCHED_SAFE' && isUrl(value.imageUrl) && clean(value.source)) {
    entry.imageUrl = clean(value.imageUrl);
    entry.source = clean(value.source);
  } else if (status === 'MATCHED_SAFE') return null;
  return entry;
};

export class VsImageRegistry {
  constructor(filePath, { now = () => new Date().toISOString() } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.entries = new Map();
    this.inStock = new Map();
    this.classifications = new Map();
    this.inventory = { barcodesInStock: 0, barcodesWithExactImage: 0, unregistrableBarcodes: 0, unregistrableWithExactImage: 0 };
    this.updatedAt = null;
  }

  load() {
    this.entries.clear();
    this.updatedAt = null;
    if (!this.filePath || !existsSync(this.filePath)) return this;
    try {
      const json = JSON.parse(readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, '').trim());
      if (json?.version !== VERSION || !json.entries || typeof json.entries !== 'object') return this;
      for (const [key, value] of Object.entries(json.entries)) {
        const entry = sanitizeEntry(key, value);
        if (entry) this.entries.set(`${entry.style}-${entry.color}`, entry);
      }
      this.updatedAt = clean(json.updatedAt) || null;
    } catch { this.entries.clear(); }
    return this;
  }

  save() {
    if (!this.filePath) return false;
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.updatedAt = this.now();
    const entries = Object.fromEntries([...this.entries.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, entry]));
    const temp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: VERSION, updatedAt: this.updatedAt, entries }, null, 2), 'utf8');
    renameSync(temp, this.filePath);
    return true;
  }

  reconcile(rows, exactImageFor) {
    this.inStock.clear();
    this.classifications.clear();
    const activeRows = [];
    for (const row of rows ?? []) {
      if (Number(row?.STOCK ?? row?.stock ?? 0) <= 0) continue;
      activeRows.push(row);
      const style = clean(row?.STYLE ?? row?.style);
      const color = clean(row?.COLOR ?? row?.color).toUpperCase();
      const key = styleColorFromParts(style, color);
      if (!key) continue;
      this.inStock.set(key, [...(this.inStock.get(key) ?? []), row]);
    }

    this.inventory = activeRows.reduce((total, row) => {
      const valid = Boolean(styleColorFromParts(row?.STYLE ?? row?.style, row?.COLOR ?? row?.color));
      const exact = Boolean(exactImageFor?.(row));
      total.barcodesInStock += 1;
      if (exact) total.barcodesWithExactImage += 1;
      if (!valid) {
        total.unregistrableBarcodes += 1;
        if (exact) total.unregistrableWithExactImage += 1;
      }
      return total;
    }, { barcodesInStock: 0, barcodesWithExactImage: 0, unregistrableBarcodes: 0, unregistrableWithExactImage: 0 });

    const timestamp = this.now();
    for (const [key, stockRows] of this.inStock) {
      const [style, color] = key.split('-');
      const existing = this.entries.get(key);
      const candidates = stockRows.map(row => ({ row, resolved: exactImageFor?.(row) ?? null }))
        .filter(candidate => candidate.resolved && isUrl(candidate.resolved.image) && clean(candidate.resolved.imageSource))
        .sort((left, right) => sourceRank(left.resolved.imageSource) - sourceRank(right.resolved.imageSource)
          || clean(left.row.CODBARRAS ?? left.row.barcode).localeCompare(clean(right.row.CODBARRAS ?? right.row.barcode)));
      const selected = candidates[0];
      const base = existing ?? { style, color, status: 'PENDING', firstSeenAt: timestamp, lastCheckedAt: null, attemptCount: 0, checkedProviders: [] };
      const entry = {
        ...base,
        style,
        color,
        lastSeenAt: timestamp,
        barcodes: [...new Set(stockRows.map(row => clean(row.CODBARRAS ?? row.barcode)).filter(Boolean))].sort()
      };
      if (selected) {
        entry.status = 'MATCHED_SAFE';
        entry.imageUrl = selected.resolved.image;
        entry.source = selected.resolved.imageSource;
        entry.lastCheckedAt = timestamp;
      }
      this.classifications.set(key, selected ? 'KNOWN_MATCHED' : existing
        ? ({ PENDING: 'KNOWN_PENDING', NO_MATCH: 'KNOWN_NO_MATCH', REQUEST_ERROR: 'KNOWN_ERROR', IDENTITY_CONFLICT: 'KNOWN_CONFLICT', MATCHED_SAFE: 'KNOWN_MATCHED' }[existing.status] ?? 'KNOWN_PENDING')
        : 'NEW_PENDING');
      this.entries.set(key, entry);
    }
    this.save();
    return this;
  }

  summary({ availableProviders = [] } = {}) {
    const counts = { MATCHED_SAFE: 0, PENDING: 0, NO_MATCH: 0, REQUEST_ERROR: 0, IDENTITY_CONFLICT: 0 };
    for (const key of this.inStock.keys()) {
      const status = this.entries.get(key)?.status ?? 'PENDING';
      counts[status] += 1;
    }
    const styleColorsInStock = this.inStock.size;
    const pending = [...this.inStock.keys()].filter(key => this.entries.get(key)?.status === 'PENDING');
    const available = providerNames(availableProviders);
    const actionable = pending.filter(key => available.some(provider => !this.entries.get(key)?.checkedProviders?.includes(provider)));
    return {
      styleColorsInStock,
      matchedSafe: counts.MATCHED_SAFE,
      pending: counts.PENDING,
      noMatch: counts.NO_MATCH,
      requestError: counts.REQUEST_ERROR,
      identityConflict: counts.IDENTITY_CONFLICT,
      pendingActionable: actionable.length,
      pendingExhaustedCurrentProviders: pending.length - actionable.length,
      exactCoveragePercent: styleColorsInStock ? (counts.MATCHED_SAFE / styleColorsInStock) * 100 : 0
    };
  }

  coverage(options = {}) {
    const registry = this.summary(options);
    const inventory = {
      barcodesInStock: this.inventory.barcodesInStock,
      barcodesWithExactImage: this.inventory.barcodesWithExactImage,
      barcodeExactCoveragePercent: this.inventory.barcodesInStock ? (this.inventory.barcodesWithExactImage / this.inventory.barcodesInStock) * 100 : 0
    };
    return {
      inventory,
      registry: {
        validStyleColorsInStock: registry.styleColorsInStock,
        matchedSafe: registry.matchedSafe,
        pending: registry.pending,
        pendingActionable: registry.pendingActionable,
        pendingExhaustedCurrentProviders: registry.pendingExhaustedCurrentProviders,
        noMatch: registry.noMatch,
        requestError: registry.requestError,
        identityConflict: registry.identityConflict,
        styleColorExactCoveragePercent: registry.exactCoveragePercent
      },
      unregistrable: {
        barcodes: this.inventory.unregistrableBarcodes,
        withExactImage: this.inventory.unregistrableWithExactImage,
        withoutExactImage: this.inventory.unregistrableBarcodes - this.inventory.unregistrableWithExactImage
      }
    };
  }

  pending({ availableProviders = [] } = {}) {
    const available = providerNames(availableProviders);
    return [...this.inStock.entries()]
      .map(([key, rows]) => ({ key, entry: this.entries.get(key), rows }))
      .filter(item => item.entry?.status === 'PENDING')
      .map(({ entry, rows }) => ({
        STYLE: entry.style,
        COLOR: entry.color,
        departamento: clean(rows[0]?.departamento ?? rows[0]?.department),
        seccion: clean(rows[0]?.seccion ?? rows[0]?.section),
        familia: clean(rows[0]?.familia ?? rows[0]?.family),
        barcodes: entry.barcodes,
        stockActualTotal: rows.reduce((total, row) => total + Number(row.STOCK ?? row.stock ?? 0), 0),
        status: entry.status,
        classification: this.classifications.get(`${entry.style}-${entry.color}`) ?? 'KNOWN_PENDING',
        firstSeenAt: entry.firstSeenAt,
        lastCheckedAt: entry.lastCheckedAt,
        attemptCount: entry.attemptCount ?? 0,
        checkedProviders: providerNames(entry.checkedProviders),
        actionable: available.some(provider => !entry.checkedProviders?.includes(provider))
      }))
      .sort((left, right) => right.stockActualTotal - left.stockActualTotal
        || clean(left.firstSeenAt).localeCompare(clean(right.firstSeenAt))
        || left.STYLE.localeCompare(right.STYLE) || left.COLOR.localeCompare(right.COLOR));
  }

  pendingEntries(options = {}) {
    return this.pending(options).filter(item => item.actionable).map(item => ({
      ...item,
      key: styleColorFromParts(item.STYLE, item.COLOR),
      rows: this.inStock.get(styleColorFromParts(item.STYLE, item.COLOR)) ?? []
    }));
  }

  recordResolution(styleColor, result = {}, { requiredProviderNames = [] } = {}) {
    const key = styleColorFromParts(...clean(styleColor).split('-'));
    const existing = key ? this.entries.get(key) : null;
    if (!key || !existing || existing.status === 'MATCHED_SAFE') return null;
    const status = clean(result.status).toUpperCase();
    if (!['MATCHED_SAFE', 'NO_MATCH', 'REQUEST_ERROR', 'IDENTITY_CONFLICT'].includes(status)) return null;
    const completedProviders = status === 'REQUEST_ERROR' ? existing.checkedProviders : providerNames(result.checkedProviders);
    const checkedProviders = providerNames([...(existing.checkedProviders ?? []), ...completedProviders]);
    const required = providerNames(requiredProviderNames);
    const globalNoMatch = status === 'NO_MATCH' && required.length > 0 && required.every(provider => checkedProviders.includes(provider));
    const updated = {
      ...existing,
      status: globalNoMatch ? 'NO_MATCH' : (status === 'NO_MATCH' ? 'PENDING' : status),
      attemptCount: (existing.attemptCount ?? 0) + 1,
      lastCheckedAt: this.now(),
      checkedProviders
    };
    delete updated.imageUrl;
    delete updated.source;
    if (status === 'MATCHED_SAFE') {
      if (!isUrl(result.imageUrl) || !clean(result.source)) return null;
      updated.imageUrl = clean(result.imageUrl);
      updated.source = clean(result.source);
    }
    this.entries.set(key, updated);
    this.save();
    return updated;
  }
}
