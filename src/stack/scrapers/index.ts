import type { RawItem } from '../types.js';
import type { SampledSource } from '../discovery/sampler.js';
import { scrapeHN, scrapeShowHN } from './hn.js';
import { scrapeRssFeeds } from './rss.js';
import { scrapeReddit } from './reddit.js';
import { scrapeGitHubTrending } from './github-trending.js';
import { scrapeProductHunt } from './producthunt.js';

export type ScraperFn = () => Promise<RawItem[]>;
export type ScraperRegistry = Record<string, ScraperFn>;

export function buildDefaultRegistry(opts: {
  rssFeeds: string[];
  productHuntToken?: string;
}): ScraperRegistry {
  return {
    hn: () => scrapeHN(),
    showhn: () => scrapeShowHN(),
    lobsters: () => scrapeRssFeeds(['https://lobste.rs/rss']),
    hackernewsletter: () =>
      scrapeRssFeeds(['https://hackernewsletter.com/rss.xml']),
    rss: () => scrapeRssFeeds(opts.rssFeeds),
    reddit_selfhosted: () => scrapeReddit('selfhosted'),
    github_trending: () => scrapeGitHubTrending('daily'),
    producthunt: opts.productHuntToken
      ? () => scrapeProductHunt(opts.productHuntToken!)
      : async () => [],
  };
}

export async function runEnabledScrapers(
  enabled: string[],
  registry: ScraperRegistry,
  timeoutMs = 30_000,
): Promise<RawItem[]> {
  const results = await Promise.all(
    enabled.map(async (name) => {
      const fn = registry[name];
      if (!fn) return [];
      try {
        const timeout = new Promise<RawItem[]>((_, rej) =>
          setTimeout(() => rej(new Error(`timeout ${name}`)), timeoutMs),
        );
        return await Promise.race([fn(), timeout]);
      } catch (e) {
        console.error(`[stack] scraper ${name} failed:`, e);
        return [];
      }
    }),
  );
  return results.flat();
}

export async function runSampledScrapers(
  selected: SampledSource[],
  registry: ScraperRegistry,
  rssScraper: (url: string) => Promise<RawItem[]>,
): Promise<RawItem[]> {
  const all: RawItem[] = [];
  await Promise.all(
    selected.map(async (s) => {
      try {
        if (s.name.startsWith('rss:')) {
          const url = s.name.slice('rss:'.length);
          all.push(...(await rssScraper(url)));
        } else {
          const fn = registry[s.name];
          if (fn) all.push(...(await fn()));
        }
      } catch (e) {
        console.error(`[stack] scraper '${s.name}' failed:`, e);
      }
    }),
  );
  return all;
}
