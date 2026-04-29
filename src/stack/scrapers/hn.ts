import type { RawItem } from '../types.js';

type Fetcher = typeof fetch;

export async function scrapeHN(
  fetcher: Fetcher = fetch,
  topN = 30,
): Promise<RawItem[]> {
  const top = (await (
    await fetcher('https://hacker-news.firebaseio.com/v0/topstories.json')
  ).json()) as number[];
  const ids = top.slice(0, topN);
  const items = await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await fetcher(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
        );
        const j = (await r.json()) as { title?: string; url?: string };
        if (!j?.url || !j?.title) return null;
        return {
          source: 'hn',
          title: j.title,
          url: j.url,
          fetchedAt: new Date().toISOString(),
        } as RawItem;
      } catch {
        return null;
      }
    }),
  );
  return items.filter((x): x is RawItem => x !== null);
}

export async function scrapeShowHN(
  fetcher: Fetcher = fetch,
): Promise<RawItem[]> {
  const r = await fetcher(
    'https://hn.algolia.com/api/v1/search?tags=show_hn&hitsPerPage=20',
  );
  const j = (await r.json()) as {
    hits: { title: string; url: string | null; objectID: string }[];
  };
  return j.hits
    .filter((h) => h.url)
    .map((h) => ({
      source: 'showhn',
      title: h.title,
      url: h.url!,
      fetchedAt: new Date().toISOString(),
    }));
}
