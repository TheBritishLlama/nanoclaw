import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyStackSchema, insertDomainMention, getCandidateSource, getSourceStat } from '../../../../src/stack/db.js';
import { genericAlgorithm } from '../../../../src/stack/discovery/algorithms/generic.js';
import type { DiscoveryContext } from '../../../../src/stack/discovery/registry.js';

const NOW = '2026-04-28T04:00:00Z';
const since = (d: number) => new Date(Date.parse(NOW) - d * 86400000).toISOString();

function ctxFor(db: Database.Database, opts: Partial<DiscoveryContext> & { now?: () => Date } = {}): DiscoveryContext & { now?: () => Date } {
  return {
    db,
    webFetch: async () => ({ ok: true, text: async () => '<html></html>' }),
    classify: async () => true,
    bloomlist: ['github.com'],
    occurrenceThreshold: 3,
    now: () => new Date(NOW),
    ...opts,
  } as DiscoveryContext & { now?: () => Date };
}

function seedActiveSource(db: Database.Database, source: string) {
  db.prepare(`INSERT INTO stack_source_stats (source, drop_count, rated_count, updated_at)
              VALUES (?, 1, 1, ?)`).run(source, NOW);
}

describe('generic_algorithm', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyStackSchema(db); });

  it('updates recent_mention_score for active sources', async () => {
    seedActiveSource(db, 'fabiensanglard.net');
    for (let i = 0; i < 4; i++) {
      insertDomainMention(db, { domain: 'fabiensanglard.net', source: 'hn', observedAt: since(i + 1) });
    }
    await genericAlgorithm.run(ctxFor(db));
    expect(getSourceStat(db, 'fabiensanglard.net')!.recent_mention_score).toBeGreaterThan(0);
  });

  it('promotes a non-active domain to candidate when it crosses thresholds and RSS is found', async () => {
    for (let i = 0; i < 6; i++) insertDomainMention(db, { domain: 'newblog.dev', source: 'hn', observedAt: since(i) });
    insertDomainMention(db, { domain: 'newblog.dev', source: 'lobsters', observedAt: since(1) });
    const fetcher = vi.fn(async (url: string) => {
      if (url === 'https://newblog.dev/') return { ok: true, text: async () => `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>` };
      if (url === 'https://newblog.dev/feed.xml') return { ok: true, text: async () => '<rss><channel><title>x</title></channel></rss>' };
      return { ok: false, text: async () => '' };
    });
    await genericAlgorithm.run(ctxFor(db, { webFetch: fetcher as any }));
    const c = getCandidateSource(db, 'newblog.dev')!;
    expect(c.status).toBe('candidate');
    expect(c.rss_url).toBe('https://newblog.dev/feed.xml');
    expect(c.origin_algorithm).toBe('generic_algorithm');
  });

  it('marks active sources with zero mentions in window as going_stale', async () => {
    seedActiveSource(db, 'quietblog.io');
    await genericAlgorithm.run(ctxFor(db));
    expect(getSourceStat(db, 'quietblog.io')!.staleness).toBe('going_stale');
  });
});
