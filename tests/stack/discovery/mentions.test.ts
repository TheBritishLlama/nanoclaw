import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyStackSchema, recentDomainMentions } from '../../../src/stack/db.js';
import { observeMentions } from '../../../src/stack/discovery/mentions.js';
import type { RawItem } from '../../../src/stack/types.js';

describe('observeMentions', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyStackSchema(db); });

  it('records (domain, source) pairs from RawItem urls and inline blurb links', () => {
    const items: RawItem[] = [
      { source: 'hn', title: 't1', url: 'https://fabiensanglard.net/post', fetchedAt: '2026-04-28T00:00:00Z',
        blurb: 'See also <a href="https://danluu.com/x">danluu</a>' },
      { source: 'lobsters', title: 't2', url: 'https://fabiensanglard.net/other', fetchedAt: '2026-04-28T00:00:00Z' },
    ];
    observeMentions(db, items, ['github.com'], '2026-04-28T00:00:00Z');
    const agg = recentDomainMentions(db, '2026-04-01T00:00:00Z');
    const fab = agg.find(r => r.domain === 'fabiensanglard.net')!;
    expect(fab.recent_mentions).toBe(2);
    expect(fab.distinct_source_count).toBe(2);
    expect(agg.find(r => r.domain === 'danluu.com')!.recent_mentions).toBe(1);
  });

  it('skips bloomlist domains', () => {
    const items: RawItem[] = [
      { source: 'hn', title: 't', url: 'https://github.com/foo/bar', fetchedAt: '2026-04-28T00:00:00Z' },
    ];
    observeMentions(db, items, ['github.com'], '2026-04-28T00:00:00Z');
    expect(recentDomainMentions(db, '2026-04-01T00:00:00Z')).toEqual([]);
  });
});
