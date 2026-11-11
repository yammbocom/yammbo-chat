// page.ts
// Page context sent by the widget: which Yammbo page the visitor is on, and
// which product that page belongs to. Used to ground ambiguous questions.

export type Product = 'pos' | 'store' | 'web' | 'yammbot' | 'music' | 'tv' | 'food';

export interface PageContext {
  url: string;
  title: string;
  product: Product | null;
}

export const PRODUCT_NAMES: Record<Product, string> = {
  pos: 'Yammbo POS',
  store: 'Yammbo Store',
  web: 'Yammbo Web',
  yammbot: 'Yammbot',
  music: 'Yammbo Music',
  tv: 'Yammbo TV',
  food: 'Yammbo Food',
};

const HOST_PRODUCT: Record<string, Product> = {
  'pos.yammbo.com': 'pos',
  'store.yammbo.com': 'store',
  'web.yammbo.com': 'web',
  'bot.yammbo.com': 'yammbot',
  'music.yammbo.com': 'music',
  'tv.yammbo.com': 'tv',
  'food.yammbo.com': 'food',
};

// First path segment on yammbo.com (and the product segment on help.yammbo.com).
const PATH_PRODUCT: Record<string, Product> = {
  web: 'web',
  store: 'store',
  pos: 'pos',
  music: 'music',
  tv: 'tv',
  food: 'food',
  bot: 'yammbot',
  yammbot: 'yammbot',
};

function parseYammboUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 300) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.hostname !== 'yammbo.com' && !u.hostname.endsWith('.yammbo.com')) return null;
  return u;
}

export function productFromUrl(raw: string): Product | null {
  const u = parseYammboUrl(raw);
  if (!u) return null;
  const host = u.hostname;
  const segs = u.pathname.split('/').filter(Boolean).map((s) => s.toLowerCase());

  if (HOST_PRODUCT[host]) return HOST_PRODUCT[host];
  if (host === 'yammbo.com' || host === 'www.yammbo.com') {
    return Object.prototype.hasOwnProperty.call(PATH_PRODUCT, segs[0] || '') ? PATH_PRODUCT[segs[0]] : null;
  }
  // help.yammbo.com/docs/<lang>/<product>/...
  if (host === 'help.yammbo.com' && segs[0] === 'docs') {
    const p = segs[2] || '';
    return Object.prototype.hasOwnProperty.call(PATH_PRODUCT, p) ? PATH_PRODUCT[p] : null;
  }
  return null;
}

// Validates the untrusted `page` field of the chat request. Anything that is
// not an https yammbo.com URL (<= 300 chars) is ignored.
export function sanitizePage(input: unknown): PageContext | null {
  if (!input || typeof input !== 'object') return null;
  const p = input as { url?: unknown; title?: unknown };
  const u = parseYammboUrl(p.url);
  if (!u) return null;
  const url = u.origin + u.pathname;
  // The URL (origin + pathname only) goes into the prompt; the title is only stored.
  const title = typeof p.title === 'string' ? p.title.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120) : '';
  return { url, title, product: productFromUrl(url) };
}
