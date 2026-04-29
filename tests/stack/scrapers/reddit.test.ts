import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrapeReddit } from '../../../src/stack/scrapers/reddit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname,'../fixtures/reddit-selfhosted.json'),'utf-8'));

describe('scrapeReddit', () => {
  it('parses top posts into RawItem[]', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => DATA } as unknown as Response);
    const items = await scrapeReddit('selfhosted', 'week', fetcher);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].source).toBe('reddit:selfhosted');
  });

  it('returns [] on 403/anti-bot', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403 } as unknown as Response);
    const items = await scrapeReddit('selfhosted', 'week', fetcher);
    expect(items).toEqual([]);
  });
});
