import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrapeHN, scrapeShowHN } from '../../../src/stack/scrapers/hn.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOP = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/hn-topstories.json'), 'utf-8'));
const SHOW = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/hn-showhn.json'), 'utf-8'));

describe('scrapeHN', () => {
  it('returns top-N items', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => TOP } as unknown as Response)
      .mockResolvedValue({ ok: true, json: async () => ({
        id: 1, title: 'Test', url: 'https://example.com',
      })} as unknown as Response);
    const items = await scrapeHN(fetcher, 5);
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(5);
    expect(items[0].source).toBe('hn');
    expect(items[0].url).toMatch(/^https?:\/\//);
  });
});

describe('scrapeShowHN', () => {
  it('returns Show HN items from Algolia', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true, json: async () => SHOW,
    } as unknown as Response);
    const items = await scrapeShowHN(fetcher);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].source).toBe('showhn');
  });
});
