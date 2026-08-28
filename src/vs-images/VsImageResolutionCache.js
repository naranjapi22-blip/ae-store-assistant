import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeStyleColor } from './VsImageIdentity.js';

const STATUSES = new Set(['MATCHED_SAFE', 'NO_MATCH', 'REQUEST_ERROR', 'IDENTITY_CONFLICT']);
const isUrl = value => /^https?:\/\//i.test(String(value ?? '').trim());
const clean = value => value == null ? '' : String(value).trim();

const sanitizeEntry = (styleColor, value = {}) => {
  const key = normalizeStyleColor(styleColor ?? value.styleColor);
  const status = clean(value.status).toUpperCase();
  if (!key || !STATUSES.has(status)) return null;

  const entry = {
    styleColor: key,
    status,
    checkedProviders: [...new Set((Array.isArray(value.checkedProviders) ? value.checkedProviders : []).map(clean).filter(Boolean))],
    updatedAt: clean(value.updatedAt) || new Date().toISOString()
  };

  if (status === 'MATCHED_SAFE') {
    const imageUrl = clean(value.imageUrl);
    const source = clean(value.source);
    if (!isUrl(imageUrl) || !source) return null;
    entry.imageUrl = imageUrl;
    entry.source = source;
    const remoteSku = clean(value.remoteSku);
    if (remoteSku) entry.remoteSku = remoteSku;
  }

  return entry;
};

export class VsImageResolutionCache {
  constructor(filePath = null) {
    this.filePath = filePath;
    this.entries = new Map();
    this.updatedAt = null;
  }

  load() {
    this.entries.clear();
    this.updatedAt = null;
    if (!this.filePath || !existsSync(this.filePath)) return this;
    try {
      const text = readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (!text) return this;
      const json = JSON.parse(text);
      const sourceEntries = json?.entries && typeof json.entries === 'object' ? json.entries : {};
      for (const [styleColor, value] of Object.entries(sourceEntries)) {
        const entry = sanitizeEntry(styleColor, value);
        if (entry) this.entries.set(entry.styleColor, entry);
      }
      this.updatedAt = clean(json.updatedAt) || null;
    } catch {
      this.entries.clear();
      this.updatedAt = null;
    }
    return this;
  }

  get(styleColor) {
    const key = normalizeStyleColor(styleColor);
    return key ? this.entries.get(key) ?? null : null;
  }

  set(styleColor, value) {
    const entry = sanitizeEntry(styleColor, value);
    if (!entry) return false;
    this.entries.set(entry.styleColor, entry);
    this.updatedAt = new Date().toISOString();
    return true;
  }

  retain(styleColors) {
    const keep = new Set([...styleColors].map(normalizeStyleColor).filter(Boolean));
    for (const key of this.entries.keys()) if (!keep.has(key)) this.entries.delete(key);
    this.updatedAt = new Date().toISOString();
    return this;
  }

  save() {
    if (!this.filePath) return false;
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const updatedAt = new Date().toISOString();
    const entries = Object.fromEntries([...this.entries.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const payload = JSON.stringify({ version: 1, updatedAt, entries }, null, 2);
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tempPath, payload, 'utf8');
    renameSync(tempPath, this.filePath);
    this.updatedAt = updatedAt;
    return true;
  }

  get size() { return this.entries.size; }
}
