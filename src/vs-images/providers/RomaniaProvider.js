import { normalizeStyleColor } from '../VsImageIdentity.js';

const clean = value => value == null ? '' : String(value).trim();
const isUrl = value => /^https?:\/\//i.test(clean(value));

const GRAPHQL_QUERY = `query RuntimeVsImage($sku: String!) {
  products(filter: { sku: { eq: $sku } }, pageSize: 5) {
    items {
      sku
      url_key
      image { url }
      media_gallery { url label position disabled }
    }
  }
}`;

const normalizedRemoteSku = styleColor => normalizeStyleColor(styleColor)?.replace('-', '') ?? null;

export class RomaniaProvider {
  constructor({ fetchImpl = globalThis.fetch, endpoint = 'https://victoriassecret.ro/graphql' } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('RomaniaProvider requiere fetch');
    this.fetch = fetchImpl;
    this.endpoint = endpoint;
    this.name = 'vs-romania';
    this.source = 'vs-romania-runtime';
  }

  async resolve(candidate) {
    const styleColor = normalizeStyleColor(candidate?.styleColor);
    const expectedSku = normalizedRemoteSku(styleColor);
    if (!styleColor || !expectedSku) return { status: 'IDENTITY_CONFLICT' };

    let response;
    try {
      response = await this.fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'ae-store-assistant/0.1' },
        body: JSON.stringify({ query: GRAPHQL_QUERY, variables: { sku: expectedSku } })
      });
    } catch {
      return { status: 'REQUEST_ERROR' };
    }

    if (!response?.ok) return { status: 'REQUEST_ERROR' };

    let payload;
    try { payload = await response.json(); } catch { return { status: 'REQUEST_ERROR' }; }
    if (Array.isArray(payload?.errors) && payload.errors.length) return { status: 'REQUEST_ERROR' };

    const items = Array.isArray(payload?.data?.products?.items) ? payload.data.products.items : [];
    if (!items.length) return { status: 'NO_MATCH' };

    const exact = items.filter(item => clean(item?.sku).toUpperCase() === expectedSku);
    if (exact.length !== 1) return { status: 'IDENTITY_CONFLICT' };

    const item = exact[0];
    const candidates = [item?.image?.url, ...(Array.isArray(item?.media_gallery) ? item.media_gallery.filter(media => media?.disabled !== true).sort((a, b) => Number(a?.position ?? 999) - Number(b?.position ?? 999)).map(media => media?.url) : [])]
      .map(clean)
      .filter((url, index, all) => isUrl(url) && all.indexOf(url) === index)
      .filter(url => decodeURIComponent(url).toUpperCase().includes(expectedSku));

    for (const imageUrl of candidates) {
      const validation = await this.validateImage(imageUrl);
      if (validation) return { status: 'MATCHED_SAFE', imageUrl, source: this.source, remoteSku: expectedSku };
    }

    return { status: 'NO_MATCH' };
  }

  async validateImage(imageUrl) {
    try {
      const response = await this.fetch(imageUrl, { method: 'GET', headers: { Range: 'bytes=0-0', 'user-agent': 'ae-store-assistant/0.1' } });
      const contentType = clean(response?.headers?.get?.('content-type'));
      return Boolean(response && (response.status === 200 || response.status === 206) && /^image\//i.test(contentType));
    } catch {
      return false;
    }
  }
}
