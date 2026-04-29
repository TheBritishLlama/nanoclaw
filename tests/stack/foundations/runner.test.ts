import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyStackSchema } from '../../../src/stack/db.js';
import { initVault } from '../../../src/stack/vault.js';
import { seedFoundations, ensureMinFoundationsInQueue } from '../../../src/stack/foundations/runner.js';

describe('foundations runner', () => {
  let db: Database.Database;
  let vault: string;

  beforeEach(() => {
    db = new Database(':memory:');
    applyStackSchema(db);
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-'));
    initVault(vault);
  });

  it('seeds foundation rows from JSON', () => {
    seedFoundations(db, [
      { id:'f1', name:'DNS', category:'networking', sourceUrl:'https://x' },
      { id:'f2', name:'TLS', category:'security', sourceUrl:'https://y' },
    ]);
    const rows = db.prepare('SELECT * FROM stack_foundations ORDER BY id').all();
    expect(rows).toHaveLength(2);
  });

  it('ensures at least N enriched foundation drops sit in queue', async () => {
    seedFoundations(db, [
      { id:'f1', name:'DNS', category:'networking', sourceUrl:'https://x' },
      { id:'f2', name:'TLS', category:'security', sourceUrl:'https://y' },
      { id:'f3', name:'Cache', category:'systems', sourceUrl:'https://z' },
    ]);
    const enrich = vi.fn(async (item: any) => ({
      id: 'd_'+item.id, bucket: 'foundation' as const, name: item.name, tagline: '',
      bodyHtml: '<p/>', bodyPlain: '', sourceUrl: item.sourceUrl, sourceFetchedAt: 't',
      tags: [], confidence: 0.9, status: 'queued' as const, vaultPath: '', createdAt: 't',
    }));
    await ensureMinFoundationsInQueue(db, vault, enrich, 2);
    const queued = db.prepare("SELECT * FROM stack_queue WHERE bucket='foundation'").all();
    expect(queued.length).toBeGreaterThanOrEqual(2);
  });
});
