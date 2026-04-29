import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  applyStackSchema, insertQueueDrop, getQueuedDropsOldestFirst,
  insertDomainMention, recentDomainMentions,
  upsertCandidateSource, getCandidateSource,
  markSourceStaleness, getSourceStat,
} from '../../src/stack/db.js';

describe('stack db', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    applyStackSchema(db);
  });

  it('creates all 9 stack tables', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'stack_%'"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name).sort();
    expect(names).toEqual([
      'stack_candidate_sources',
      'stack_domain_mentions',
      'stack_foundations',
      'stack_graded_pending',
      'stack_health_log',
      'stack_queue',
      'stack_ratings',
      'stack_scrape_log',
      'stack_source_stats',
    ]);
  });

  it('inserts a queued drop and retrieves it', () => {
    insertQueueDrop(db, {
      id: 'd1',
      bucket: 'tool',
      name: 'Tailscale',
      tagline: 'Zero-config WireGuard mesh VPN',
      bodyHtml: '<p>...</p>',
      bodyPlain: '...',
      sourceUrl: 'https://tailscale.com',
      sourceFetchedAt: '2026-04-27T02:00:00Z',
      tags: ['networking', 'vpn'],
      confidence: 0.9,
      status: 'queued',
      vaultPath: 'Drops/Tools/Tailscale.md',
      createdAt: '2026-04-27T02:30:00Z',
    });
    const drops = getQueuedDropsOldestFirst(db);
    expect(drops).toHaveLength(1);
    expect(drops[0].name).toBe('Tailscale');
    expect(drops[0].tags).toEqual(['networking', 'vpn']);
  });
});

describe('discovery db queries', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    applyStackSchema(db);
  });

  it('inserts and reads back recent domain mentions', () => {
    insertDomainMention(db, { domain: 'example.com', source: 'hn', observedAt: '2026-04-28T00:00:00Z' });
    insertDomainMention(db, { domain: 'example.com', source: 'lobsters', observedAt: '2026-04-29T00:00:00Z' });
    const out = recentDomainMentions(db, '2026-04-01T00:00:00Z');
    expect(out.find(r => r.domain === 'example.com')!.recent_mentions).toBe(2);
    expect(out.find(r => r.domain === 'example.com')!.distinct_source_count).toBe(2);
  });

  it('upserts candidate source and bumps occurrence_count', () => {
    upsertCandidateSource(db, { domain: 'x.com', origin_algorithm: 'scout_A_hn_comments', firstObservedAt: '2026-04-28T00:00:00Z' });
    upsertCandidateSource(db, { domain: 'x.com', origin_algorithm: 'scout_A_hn_comments', firstObservedAt: '2026-04-29T00:00:00Z' });
    const c = getCandidateSource(db, 'x.com')!;
    expect(c.occurrence_count).toBe(2);
    expect(c.status).toBe('observed');
  });

  it('marks source staleness in stack_source_stats', () => {
    markSourceStaleness(db, 'hn', 'going_stale', '2026-04-28T00:00:00Z');
    expect(getSourceStat(db, 'hn')!.staleness).toBe('going_stale');
  });
});
