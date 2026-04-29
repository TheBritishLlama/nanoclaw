import { describe, it, expect, vi } from 'vitest';
import { runEnabledScrapers } from '../../../src/stack/scrapers/index.js';
import type { RawItem } from '../../../src/stack/types.js';

describe('runEnabledScrapers', () => {
  it('runs all enabled scrapers in parallel and merges output', async () => {
    const fakeScraper = (src: string) => async (): Promise<RawItem[]> => [{
      source: src, title: src + ' item', url: 'https://x/' + src, fetchedAt: 'now',
    }];
    const registry = {
      hn: fakeScraper('hn'),
      reddit_selfhosted: fakeScraper('reddit:selfhosted'),
      rss: fakeScraper('rss:agg'),
    };
    const items = await runEnabledScrapers(['hn','reddit_selfhosted','rss'], registry, 5000);
    const sources = items.map(i => i.source).sort();
    expect(sources).toEqual(['hn','reddit:selfhosted','rss:agg']);
  });

  it('skips scrapers that throw, logs but does not fail others', async () => {
    const registry = {
      good: async () => [{ source: 'good', title: 't', url: 'u', fetchedAt: 'n' }] as RawItem[],
      bad: async () => { throw new Error('boom'); },
    };
    const items = await runEnabledScrapers(['good','bad'], registry, 5000);
    expect(items.map(i => i.source)).toEqual(['good']);
  });

  it('aborts a scraper that exceeds timeout', async () => {
    const registry = {
      slow: () => new Promise<RawItem[]>(() => {}),
      fast: async () => [{ source: 'fast', title: 't', url: 'u', fetchedAt: 'n' }] as RawItem[],
    };
    const items = await runEnabledScrapers(['slow','fast'], registry, 50);
    expect(items.map(i => i.source)).toEqual(['fast']);
  });
});
