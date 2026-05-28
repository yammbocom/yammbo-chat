// content.ts
// Help Center docs (from the bundled KB) and recent blog posts (fetched from
// blog.yammbo.com RSS, cached in KV).

import kbBundle from './kb-bundle.json';

type Lang = 'en' | 'es';
type KbDoc = { slug: string; title: string; description: string; product: string; body: string };
type KbBundle = Record<Lang, KbDoc[]>;
const KB = kbBundle as KbBundle;

// ─── Docs ─────────────────────────────────────────────────────────────────

// Returns lightweight doc index (no body) for the Help Center list/search.
export function listDocs(lang: Lang): Array<{ slug: string; title: string; description: string; product: string }> {
  return (KB[lang] || []).map((d) => ({
    slug: d.slug,
    title: d.title,
    description: d.description,
    product: d.product,
  }));
}

// Returns a single doc with body for inline rendering.
export function getDoc(lang: Lang, slug: string): KbDoc | null {
  return (KB[lang] || []).find((d) => d.slug === slug) || null;
}

// ─── Blog ─────────────────────────────────────────────────────────────────

export interface BlogPost {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  image: string | null;
}

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function extractEnclosureUrl(block: string): string | null {
  const m = block.match(/<enclosure[^>]*url="([^"]+)"[^>]*>/i);
  return m ? m[1] : null;
}

function parseRss(xml: string, limit: number): BlogPost[] {
  const items = xml.split(/<item>/).slice(1);
  const posts: BlogPost[] = [];
  for (const raw of items.slice(0, limit)) {
    const block = raw.split('</item>')[0];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    if (!title || !link) continue;
    posts.push({
      title,
      link,
      description: extractTag(block, 'description').slice(0, 200),
      pubDate: extractTag(block, 'pubDate'),
      image: extractEnclosureUrl(block),
    });
  }
  return posts;
}

// Fetches recent blog posts, cached in KV for an hour to avoid hammering the
// blog and to keep the widget snappy.
export async function getBlogPosts(
  kv: KVNamespace | undefined,
  limit = 12,
): Promise<BlogPost[]> {
  const CACHE_KEY = 'blog-posts-v2';
  if (kv) {
    const cached = await kv.get(CACHE_KEY, 'json');
    if (cached) return cached as BlogPost[];
  }

  const res = await fetch('https://blog.yammbo.com/rss.xml', {
    headers: { 'user-agent': 'yammbo-chat-worker' },
  });
  if (!res.ok) return [];
  const xml = await res.text();
  const posts = parseRss(xml, limit);

  if (kv && posts.length) {
    await kv.put(CACHE_KEY, JSON.stringify(posts), { expirationTtl: 3600 });
  }
  return posts;
}
