import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrapeRss } from '../../../src/stack/scrapers/rss.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FEED = fs.readFileSync(path.join(__dirname, '../fixtures/lobsters-rss.xml'), 'utf-8');

describe('scrapeRss', () => {
  it('parses RSS items into RawItem[]', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true, text: async () => FEED,
    } as unknown as Response);
    const items = await scrapeRss('https://lobste.rs/rss', 'rss:lobsters', fetcher);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].source).toBe('rss:lobsters');
    expect(items[0].url).toMatch(/^https?:\/\//);
    expect(items[0].title.length).toBeGreaterThan(0);
  });

  it('returns [] when feed is unreachable', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false } as unknown as Response);
    const items = await scrapeRss('https://x', 'rss:x', fetcher);
    expect(items).toEqual([]);
  });
});
