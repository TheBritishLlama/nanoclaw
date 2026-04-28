import type { RawItem } from '../types.js';

type Fetcher = typeof fetch;

export async function scrapeReddit(
  sub: string,
  window: 'day' | 'week' | 'month' = 'week',
  fetcher: Fetcher = fetch,
): Promise<RawItem[]> {
  const url = `https://www.reddit.com/r/${sub}/top.json?t=${window}&limit=25`;
  const r = await fetcher(url, { headers: { 'User-Agent': 'stack/0.1' } } as RequestInit);
  if (!r.ok) return [];
  const j = await r.json() as {
    data: { children: { data: { title: string; url: string; selftext?: string } }[] };
  };
  const now = new Date().toISOString();
  return j.data.children.map(c => ({
    source: `reddit:${sub}`,
    title: c.data.title,
    url: c.data.url,
    blurb: c.data.selftext,
    fetchedAt: now,
  }));
}
