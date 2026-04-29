import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyStackSchema, getCandidateSource } from '../../../../src/stack/db.js';
import { scoutAHnComments } from '../../../../src/stack/discovery/algorithms/scout-a-hn-comments.js';
import type { DiscoveryContext } from '../../../../src/stack/discovery/registry.js';

function seedHighRated(db: Database.Database, dropId: string, sourceUrl: string, rating: number) {
  db.prepare(`INSERT INTO stack_queue
    (id,bucket,name,tagline,body_html,body_plain,source_url,source_fetched_at,tags_json,confidence,status,vault_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    dropId, 'tool', 'X', 't', '<p>x</p>', 'x', sourceUrl,
    '2026-04-20T00:00:00Z', '[]', 0.9, 'sent', 'p', '2026-04-20T00:00:00Z'
  );
  db.prepare(`INSERT INTO stack_ratings (drop_id, rating, rated_at) VALUES (?,?,?)`)
    .run(dropId, rating, '2026-04-21T00:00:00Z');
}

describe('scout_A_hn_comments', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyStackSchema(db); });

  it('mines outbound URLs from comment threads of high-rated HN stories and upserts candidates', async () => {
    seedHighRated(db, 'd1', 'https://news.ycombinator.com/item?id=4242', 8);
    const fetcher = vi.fn(async (url: string) => ({
      ok: true,
      text: async () => url.includes('item?id=4242')
        ? `<html><body>
             <a href="https://fabiensanglard.net/post">link</a>
             <a href="https://github.com/foo/bar">bloomed</a>
             <a href="https://danluu.com/x">link2</a>
           </body></html>`
        : '',
    }));
    const ctx = {
      db, webFetch: fetcher as any,
      classify: vi.fn(async () => true),
      bloomlist: ['github.com'],
      occurrenceThreshold: 3,
      now: () => new Date('2026-04-28T00:00:00Z'),
    } as unknown as DiscoveryContext;
    await scoutAHnComments.run(ctx);
    expect(getCandidateSource(db, 'fabiensanglard.net')!.occurrence_count).toBe(1);
    expect(getCandidateSource(db, 'danluu.com')!.occurrence_count).toBe(1);
    expect(getCandidateSource(db, 'github.com')).toBeUndefined();
    expect((ctx.classify as any).mock.calls.length).toBe(2);
  });

  it('does nothing when classifier rejects all candidates', async () => {
    seedHighRated(db, 'd1', 'https://news.ycombinator.com/item?id=42', 9);
    const ctx = {
      db,
      webFetch: vi.fn(async () => ({ ok: true, text: async () => '<a href="https://nope.example/">x</a>' })) as any,
      classify: vi.fn(async () => false),
      bloomlist: [],
      occurrenceThreshold: 3,
      now: () => new Date('2026-04-28T00:00:00Z'),
    } as unknown as DiscoveryContext;
    await scoutAHnComments.run(ctx);
    expect(getCandidateSource(db, 'nope.example')).toBeUndefined();
  });
});
