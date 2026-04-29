import { XMLParser } from 'fast-xml-parser';
import type { RawItem } from '../types.js';

type Fetcher = typeof fetch;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

export async function scrapeRss(
  feedUrl: string,
  sourceName: string,
  fetcher: Fetcher = fetch,
): Promise<RawItem[]> {
  const r = await fetcher(feedUrl);
  if (!r.ok) return [];
  const xml = await r.text();
  const parsed = parser.parse(xml);

  const items: any[] = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
  const arr = Array.isArray(items) ? items : [items];

  const now = new Date().toISOString();
  const mapped: Array<RawItem | null> = arr.map((it) => {
    const title = it.title?.['#text'] ?? it.title ?? '';
    const link = it.link?.['@_href'] ?? it.link ?? it.url ?? '';
    const blurb: string | undefined = it.description ?? it.summary ?? undefined;
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
  const all = await Promise.all(
    feeds.map(async (url) => {
      const host = new URL(url).hostname
        .replace(/^www\./, '')
        .replace(/\./g, '-');
      return scrapeRss(url, `rss:${host}`, fetcher);
    }),
  );
  return all.flat();
}
