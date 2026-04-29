import * as cheerio from 'cheerio';
import type { RawItem } from '../types.js';

type Fetcher = typeof fetch;

export async function scrapeGitHubTrending(
  window: 'daily' | 'weekly' | 'monthly' = 'daily',
  fetcher: Fetcher = fetch,
): Promise<RawItem[]> {
  const r = await fetcher(`https://github.com/trending?since=${window}`);
  if (!r.ok) return [];
  const html = await r.text();
  const $ = cheerio.load(html);
  const now = new Date().toISOString();
  const items: RawItem[] = [];
  $('article.Box-row').each((_, el) => {
    const a = $(el).find('h2 a').first();
    const slug = a.attr('href')?.trim();
    const title = a.text().replace(/\s+/g, ' ').trim();
    const blurb = $(el).find('p').first().text().trim();
    if (!slug || !title) return;
    items.push({
      source: 'github_trending',
      title,
      url: `https://github.com${slug}`,
      blurb,
      fetchedAt: now,
    });
  });
  return items;
}
