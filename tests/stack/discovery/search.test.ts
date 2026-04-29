import { describe, it, expect, vi } from 'vitest';
import { SearxngClient, type SearchResult } from '../../../src/stack/discovery/search.js';

describe('SearxngClient', () => {
  it('hits /search?format=json with the query and parses results[]', async () => {
    const fetcher = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => ({
        results: [
          { url: 'https://a.example/post1', title: 'Post 1', content: 'snippet 1' },
          { url: 'https://b.example/post2', title: 'Post 2', content: 'snippet 2' },
        ],
      }),
    }));
    const c = new SearxngClient('https://searx.example', fetcher as any);
    const out: SearchResult[] = await c.search('homelab blog 2026');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const calledUrl = fetcher.mock.calls[0][0] as string;
    expect(calledUrl).toContain('https://searx.example/search?');
    expect(calledUrl).toContain('format=json');
    expect(calledUrl).toContain('q=homelab+blog+2026');
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe('https://a.example/post1');
    expect(out[0].snippet).toBe('snippet 1');
  });

  it('returns [] on non-ok response', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const c = new SearxngClient('https://searx.example', fetcher as any);
    expect(await c.search('x')).toEqual([]);
  });
});
