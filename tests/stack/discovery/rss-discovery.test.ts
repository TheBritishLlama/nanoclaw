import { describe, it, expect, vi } from 'vitest';
import {
  isBloomedDomain,
  discoverRssFeed,
  type WebFetcher,
} from '../../../src/stack/discovery/rss-discovery.js';

const BLOOM = ['github.com', 'youtube.com', 'wikipedia.org'];

describe('isBloomedDomain', () => {
  it('matches exact domain', () => {
    expect(isBloomedDomain('github.com', BLOOM)).toBe(true);
  });
  it('matches subdomains', () => {
    expect(isBloomedDomain('en.wikipedia.org', BLOOM)).toBe(true);
  });
  it('does not match unrelated domains', () => {
    expect(isBloomedDomain('fabiensanglard.net', BLOOM)).toBe(false);
  });
});

describe('discoverRssFeed', () => {
  it('finds <link rel=alternate type=application/rss+xml>', async () => {
    const fetcher: WebFetcher = vi.fn(async (url: string) => {
      if (url === 'https://example.com/') {
        return { ok: true, text: async () => `
          <html><head>
            <link rel="alternate" type="application/rss+xml" href="/feed.xml">
          </head></html>` };
      }
      return { ok: true, text: async () => '<rss><channel><title>x</title></channel></rss>' };
    });
    const out = await discoverRssFeed('example.com', fetcher);
    expect(out).toBe('https://example.com/feed.xml');
  });

  it('falls back to probing common paths', async () => {
    const fetcher: WebFetcher = vi.fn(async (url: string) => {
      if (url === 'https://example.com/') return { ok: true, text: async () => '<html></html>' };
      if (url === 'https://example.com/feed') return { ok: false, text: async () => '' };
      if (url === 'https://example.com/rss') return { ok: false, text: async () => '' };
      if (url === 'https://example.com/rss.xml') return { ok: true, text: async () => '<rss><channel><title>ok</title></channel></rss>' };
      return { ok: false, text: async () => '' };
    });
    const out = await discoverRssFeed('example.com', fetcher);
    expect(out).toBe('https://example.com/rss.xml');
  });

  it('returns null when nothing parses as RSS/Atom', async () => {
    const fetcher: WebFetcher = vi.fn(async () => ({ ok: true, text: async () => '<html></html>' }));
    const out = await discoverRssFeed('example.com', fetcher);
    expect(out).toBeNull();
  });
});
