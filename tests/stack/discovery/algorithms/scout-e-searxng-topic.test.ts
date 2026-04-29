import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyStackSchema, getCandidateSource } from '../../../../src/stack/db.js';
import { scoutESearxngTopic } from '../../../../src/stack/discovery/algorithms/scout-e-searxng-topic.js';
import { SearxngClient } from '../../../../src/stack/discovery/search.js';
import type { DiscoveryContext } from '../../../../src/stack/discovery/registry.js';

function seedHighRatedWithTags(db: Database.Database, dropId: string, tags: string[], rating: number) {
  db.prepare(`INSERT INTO stack_queue
    (id,bucket,name,tagline,body_html,body_plain,source_url,source_fetched_at,tags_json,confidence,status,vault_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    dropId, 'tool', 'X', 't', '<p>x</p>', 'x', 'https://x.com', '2026-04-20T00:00:00Z',
    JSON.stringify(tags), 0.9, 'sent', 'p', '2026-04-20T00:00:00Z'
  );
  db.prepare(`INSERT INTO stack_ratings (drop_id, rating, rated_at) VALUES (?,?,?)`)
    .run(dropId, rating, '2026-04-21T00:00:00Z');
}

describe('scout_E_searxng_topic', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyStackSchema(db); });

  it('queries SearXNG for top tags and upserts classified candidates', async () => {
    seedHighRatedWithTags(db, 'd1', ['homelab', 'rust'], 9);
    seedHighRatedWithTags(db, 'd2', ['homelab', 'caching'], 8);
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [{ url: 'https://homelabber.dev/post1', title: 't', content: 's' }],
      }),
    }));
    const search = new SearxngClient('https://searx.example', fetcher as any);
    const ctx = {
      db,
      webFetch: async () => ({ ok: true, text: async () => '' }),
      classify: vi.fn(async () => true),
      search,
      bloomlist: [],
      occurrenceThreshold: 3,
      now: () => new Date('2026-04-28T00:00:00Z'),
    } as unknown as DiscoveryContext;
    await scoutESearxngTopic.run(ctx);
    expect(getCandidateSource(db, 'homelabber.dev')!.occurrence_count).toBeGreaterThanOrEqual(1);
  });
});
