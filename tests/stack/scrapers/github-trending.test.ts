import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrapeGitHubTrending } from '../../../src/stack/scrapers/github-trending.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname,'../fixtures/github-trending.html'),'utf-8');

describe('scrapeGitHubTrending', () => {
  it('parses repo entries', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, text: async () => HTML } as unknown as Response);
    const items = await scrapeGitHubTrending('daily', fetcher);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].source).toBe('github_trending');
    expect(items[0].url).toMatch(/^https:\/\/github\.com\//);
  });
});
