import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyStackSchema, getCandidateSource } from '../../../../src/stack/db.js';
import { scoutBLobstersComments } from '../../../../src/stack/discovery/algorithms/scout-b-lobsters-comments.js';
import type { DiscoveryContext } from '../../../../src/stack/discovery/registry.js';

function seedHighRated(db: Database.Database, dropId: string, url: string, rating: number) {
  db.prepare(`INSERT INTO stack_queue
    (id,bucket,name,tagline,body_html,body_plain,source_url,source_fetched_at,tags_json,confidence,status,vault_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    dropId, 'tool', 'X', 't', '<p>x</p>', 'x', url, '2026-04-20T00:00:00Z',
    '[]', 0.9, 'sent', 'p', '2026-04-20T00:00:00Z'
  );
  db.prepare(`INSERT INTO stack_ratings (drop_id, rating, rated_at) VALUES (?,?,?)`)
    .run(dropId, rating, '2026-04-21T00:00:00Z');
}

describe('scout_B_lobsters_comments', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyStackSchema(db); });

  it('mines lobste.rs comment threads for outbound URLs', async () => {
    seedHighRated(db, 'd1', 'https://lobste.rs/s/abcdef/some_post', 8);
    const fetcher = vi.fn(async () => ({
      ok: true,
      text: async () => '<a href="https://drewdevault.com/blog">x</a><a href="https://reddit.com/r/foo">no</a>',
    }));
    const ctx = {
      db, webFetch: fetcher as any,
      classify: vi.fn(async () => true),
      bloomlist: ['reddit.com'],
      occurrenceThreshold: 3,
      now: () => new Date('2026-04-28T00:00:00Z'),
    } as unknown as DiscoveryContext;
    await scoutBLobstersComments.run(ctx);
    expect(getCandidateSource(db, 'drewdevault.com')!.occurrence_count).toBe(1);
    expect(getCandidateSource(db, 'reddit.com')).toBeUndefined();
  });
});
