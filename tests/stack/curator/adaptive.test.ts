import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyStackSchema, insertQueueDrop } from '../../../src/stack/db.js';
import { recomputeSourceStats } from '../../../src/stack/curator/source-stats.js';
import { buildExemplarBlock, buildRecentFeedbackBlock, buildSourceWeightingHint } from '../../../src/stack/curator/adaptive.js';
import type { Drop } from '../../../src/stack/types.js';

function mkDrop(id: string, sourceUrl: string): Drop {
  return {
    id, bucket: 'tool', name: id, tagline: '', bodyHtml: '<p/>', bodyPlain: '',
    sourceUrl, sourceFetchedAt: 't', tags: [], confidence: 0.9, status: 'sent',
    vaultPath: '', createdAt: '2026-04-01T00:00:00Z',
  };
}

describe('source-stats', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyStackSchema(db); });

  it('computes mean rating per source over rolling window', () => {
    insertQueueDrop(db, mkDrop('d1', 'https://hn.example.com/a'));
    insertQueueDrop(db, mkDrop('d2', 'https://hn.example.com/b'));
    db.prepare("UPDATE stack_queue SET email_message_id='m1' WHERE id='d1'").run();
    db.prepare("UPDATE stack_queue SET email_message_id='m2' WHERE id='d2'").run();
    db.prepare("INSERT INTO stack_ratings (drop_id, rating, rated_at) VALUES ('d1', 8, '2026-04-15T00:00:00Z')").run();
    db.prepare("INSERT INTO stack_ratings (drop_id, rating, rated_at) VALUES ('d2', 4, '2026-04-15T00:00:00Z')").run();
    recomputeSourceStats(db, 60);
    const rows = db.prepare("SELECT * FROM stack_source_stats").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('hn.example.com');
    expect(rows[0].avg_rating).toBeCloseTo(6, 1);
  });
});

describe('adaptive curator blocks', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyStackSchema(db); });

  it('builds exemplar block with high + low rated drops', () => {
    insertQueueDrop(db, { ...mkDrop('hi', 'https://x'), name: 'Loved' });
    insertQueueDrop(db, { ...mkDrop('lo', 'https://y'), name: 'Disliked' });
    db.prepare("INSERT INTO stack_ratings (drop_id, rating, rated_at) VALUES ('hi', 9, '2026-04-15T00:00:00Z')").run();
    db.prepare("INSERT INTO stack_ratings (drop_id, rating, rated_at) VALUES ('lo', 2, '2026-04-15T00:00:00Z')").run();
    const block = buildExemplarBlock(db, 60);
    expect(block).toContain('Loved');
    expect(block).toContain('Disliked');
    expect(block).toContain('Kai loved');
  });

  it('builds recent feedback block with last 5 non-empty feedback strings', () => {
    insertQueueDrop(db, { ...mkDrop('a','https://x'), name:'A' });
    db.prepare("INSERT INTO stack_ratings (drop_id, rating, feedback, rated_at) VALUES ('a', 3, 'too crypto-heavy', '2026-04-15T00:00:00Z')").run();
    const block = buildRecentFeedbackBlock(db, 60);
    expect(block).toContain('too crypto-heavy');
    expect(block).toContain('Rated 3');
  });

  it('builds source weighting hint for low-avg sources', () => {
    db.prepare("INSERT INTO stack_source_stats (source, drop_count, rated_count, avg_rating, updated_at) VALUES ('weakblog.com', 10, 8, 3.2, 't')").run();
    const hint = buildSourceWeightingHint(db);
    expect(hint).toContain('weakblog.com');
    expect(hint).toMatch(/low-signal|stricter judgment/i);
  });
});
