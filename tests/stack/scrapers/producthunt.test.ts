import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrapeProductHunt } from '../../../src/stack/scrapers/producthunt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname,'../fixtures/producthunt-graphql.json'),'utf-8'));

describe('scrapeProductHunt', () => {
  it('returns posts as RawItems', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => DATA } as unknown as Response);
    const items = await scrapeProductHunt('TOKEN', fetcher);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].source).toBe('producthunt');
  });
});
