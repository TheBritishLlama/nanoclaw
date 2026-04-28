import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyStackSchema, insertQueueDrop } from '../../../src/stack/db.js';
import { pickNextDrop } from '../../../src/stack/pipeline/picker.js';
import type { Drop } from '../../../src/stack/types.js';

function mkDrop(id: string, bucket: Drop['bucket'], created: string): Drop {
  return {
    id, bucket, name: id, tagline: '', bodyHtml: '<p/>', bodyPlain: '',
    sourceUrl: 'https://x', sourceFetchedAt: 't', tags: [],
    confidence: 0.9, status: 'queued', vaultPath: '', createdAt: created,
  };
}

describe('pickNextDrop', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyStackSchema(db); });

  it('returns null when queue empty', () => {
    expect(pickNextDrop(db, { rng: () => 0.5, foundationsMixRatio: 0.5,
      bucketWeights: { tool:0.7, concept:0.2, lore:0.1 } })).toBeNull();
  });

  it('picks foundation when foundations available and rng < mixRatio', () => {
    insertQueueDrop(db, mkDrop('f1','foundation','2026-04-01T00:00:00Z'));
    insertQueueDrop(db, mkDrop('t1','tool','2026-04-02T00:00:00Z'));
    const d = pickNextDrop(db, { rng: () => 0.1, foundationsMixRatio: 0.5,
      bucketWeights: { tool:0.7, concept:0.2, lore:0.1 } });
    expect(d!.id).toBe('f1');
  });

  it('picks discovered when rng > mixRatio', () => {
    insertQueueDrop(db, mkDrop('f1','foundation','2026-04-01T00:00:00Z'));
    insertQueueDrop(db, mkDrop('t1','tool','2026-04-02T00:00:00Z'));
    const d = pickNextDrop(db, { rng: () => 0.9, foundationsMixRatio: 0.5,
      bucketWeights: { tool:0.7, concept:0.2, lore:0.1 } });
    expect(d!.id).toBe('t1');
  });

  it('respects bucket weight when multiple discovered drops exist', () => {
    insertQueueDrop(db, mkDrop('t1','tool','2026-04-01T00:00:00Z'));
    insertQueueDrop(db, mkDrop('c1','concept','2026-04-02T00:00:00Z'));
    insertQueueDrop(db, mkDrop('l1','lore','2026-04-03T00:00:00Z'));
    const d = pickNextDrop(db, { rng: () => 0.9, foundationsMixRatio: 0.5,
      bucketWeights: { tool:0.7, concept:0.2, lore:0.1 } });
    expect(['t1','c1','l1']).toContain(d!.id);
  });
});
