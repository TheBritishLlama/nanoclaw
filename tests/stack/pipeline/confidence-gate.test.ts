import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyStackSchema, getQueuedDropsOldestFirst } from '../../../src/stack/db.js';
import { initVault } from '../../../src/stack/vault.js';
import { persistDrop } from '../../../src/stack/pipeline/confidence-gate.js';
import type { Drop } from '../../../src/stack/types.js';

describe('persistDrop', () => {
  let db: Database.Database;
  let vault: string;

  beforeEach(() => {
    db = new Database(':memory:');
    applyStackSchema(db);
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
    initVault(vault);
  });

  it('writes high-confidence drops with status=queued', async () => {
    const drop: Drop = {
      id:'d1', bucket:'tool', name:'Tool1', tagline:'',
      bodyHtml:'<p/>', bodyPlain:'', sourceUrl:'https://x',
      sourceFetchedAt:'t', tags:[], confidence: 0.85,
      status:'queued', vaultPath:'', createdAt:'t',
    };
    persistDrop(db, vault, drop);
    expect(getQueuedDropsOldestFirst(db)).toHaveLength(1);
  });

  it('writes low-confidence drops with status=pending_review', async () => {
    const drop: Drop = {
      id:'d2', bucket:'tool', name:'Tool2', tagline:'',
      bodyHtml:'<p/>', bodyPlain:'', sourceUrl:'https://y',
      sourceFetchedAt:'t', tags:[], confidence: 0.5,
      status:'pending_review', vaultPath:'', createdAt:'t',
    };
    persistDrop(db, vault, drop);
    expect(getQueuedDropsOldestFirst(db)).toHaveLength(0);
    const review = db.prepare("SELECT * FROM stack_queue WHERE status='pending_review'").all();
    expect(review).toHaveLength(1);
  });
});
