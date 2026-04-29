import { XMLParser } from 'fast-xml-parser';
import type { RawItem } from '../types.js';

type Fetcher = typeof fetch;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

const PER_FEED_TIMEOUT_MS = 15_000;

// Some RSS feeds return <description> as a string, some as { '#text': '…' },
// some as { _cdata: '…' } depending on the parser's CDATA handling. Normalize
// to a plain string (or undefined) so downstream consumers can rely on the
// type — the alternative is matchAll-on-an-object crashes deep in the
// pipeline (see the earlier observeMentions bug).
function normalizeBlurb(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const candidate = obj['#text'] ?? obj['_cdata'] ?? obj['#cdata-section'];
    if (typeof candidate === 'string') return candidate;
  }
  return undefined;
}

export async function scrapeRss(
  feedUrl: string,
  sourceName: string,
  fetcher: Fetcher = fetch,
): Promise<RawItem[]> {
  const r = await fetcher(feedUrl, {
    signal: AbortSignal.timeout(PER_FEED_TIMEOUT_MS),
  });
  if (!r.ok) return [];
  const xml = await r.text();
  const parsed = parser.parse(xml);

  const items: any[] = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
  const arr = Array.isArray(items) ? items : [items];

  const now = new Date().toISOString();
  const mapped: Array<RawItem | null> = arr.map((it) => {
    const title = it.title?.['#text'] ?? it.title ?? '';
    const link = it.link?.['@_href'] ?? it.link ?? it.url ?? '';
    const blurb = normalizeBlurb(it.description ?? it.summary);
    if (!title || !link) return null;
    return {
      source: sourceName,
      title: String(title),
      url: String(link),
      blurb,
      fetchedAt: now,
    };
  });
  return mapped.filter((x): x is RawItem => x !== null);
}

export async function scrapeRssFeeds(
  feeds: string[],
  fetcher: Fetcher = fetch,
): Promise<RawItem[]> {
  const settled = await Promise.allSettled(
    feeds.map(async (url) => {
      const host = new URL(url).hostname
        .replace(/^www\./, '')
        .replace(/\./g, '-');
      return scrapeRss(url, `rss:${host}`, fetcher);
    }),
  );
  const out: RawItem[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled') {
      out.push(...r.value);
    } else {
      console.error(`[stack] RSS feed failed: ${feeds[i]}`, r.reason);
    }
  }
  return out;
}
