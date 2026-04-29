import * as cheerio from 'cheerio';

export type WebFetcher = (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;

const COMMON_PATHS = [
  '/feed', '/rss', '/rss.xml', '/atom.xml',
  '/index.xml', '/feed.xml', '/blog/feed', '/blog/rss',
];

export function isBloomedDomain(domain: string, bloom: string[]): boolean {
  const d = domain.toLowerCase();
  return bloom.some(b => d === b || d.endsWith('.' + b));
}

function looksLikeFeed(body: string): boolean {
  return /<rss[\s>]|<feed[\s>]/.test(body);
}

export async function discoverRssFeed(domain: string, fetcher: WebFetcher): Promise<string | null> {
  const home = `https://${domain}/`;
  let homeRes;
  try { homeRes = await fetcher(home); } catch { return null; }
  if (homeRes.ok) {
    const html = await homeRes.text();
    const $ = cheerio.load(html);
    const link = $('link[rel="alternate"]').filter((_, el) => {
      const t = ($(el).attr('type') || '').toLowerCase();
      return t === 'application/rss+xml' || t === 'application/atom+xml';
    }).first().attr('href');
    if (link) {
      const abs = link.startsWith('http') ? link : new URL(link, home).toString();
      try {
        const r = await fetcher(abs);
        if (r.ok && looksLikeFeed(await r.text())) return abs;
      } catch { /* fall through */ }
    }
  }
  for (const p of COMMON_PATHS) {
    const u = `https://${domain}${p}`;
    try {
      const r = await fetcher(u);
      if (r.ok && looksLikeFeed(await r.text())) return u;
    } catch { /* keep probing */ }
  }
  return null;
}
