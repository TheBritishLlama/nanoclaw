import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { applyStackSchema, insertQueueDrop, getQueuedDropsOldestFirst } from '../../src/stack/db.js';

describe('stack db', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    applyStackSchema(db);
  });

  it('creates all 8 stack tables', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'stack_%'"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name).sort();
    expect(names).toEqual([
      'stack_candidate_sources',
      'stack_domain_mentions',
      'stack_foundations',
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
