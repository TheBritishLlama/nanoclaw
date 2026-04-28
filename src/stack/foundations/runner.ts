import type Database from 'better-sqlite3';
import { persistDrop } from '../pipeline/confidence-gate.js';
import type { Drop, FoundationItem } from '../types.js';

export interface FoundationSeed {
  id: string; name: string; category: string; sourceUrl: string;
}

export function seedFoundations(db: Database.Database, items: FoundationSeed[]): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO stack_foundations (id, name, category, source_url, status, retries)
    VALUES (?, ?, ?, ?, 'pending', 0)
  `);
  for (const it of items) stmt.run(it.id, it.name, it.category, it.sourceUrl);
}

export async function ensureMinFoundationsInQueue(
  db: Database.Database, vaultPath: string,
  enrichFoundation: (f: FoundationItem) => Promise<Drop>,
  minCount: number,
): Promise<void> {
  const queued = db.prepare(
    "SELECT COUNT(*) as n FROM stack_queue WHERE bucket='foundation' AND status='queued'"
  ).get() as { n: number };
  const need = Math.max(0, minCount - queued.n);
  if (need === 0) return;

  const pending = db.prepare(
    "SELECT * FROM stack_foundations WHERE status='pending' ORDER BY id LIMIT ?"
  ).all(need) as any[];
  const update = db.prepare("UPDATE stack_foundations SET status='enriched' WHERE id=?");

  for (const row of pending) {
    const item: FoundationItem = {
      id: row.id, name: row.name, category: row.category,
      sourceUrl: row.source_url, status: row.status, retries: row.retries,
    };
    try {
      const drop = await enrichFoundation(item);
      persistDrop(db, vaultPath, drop);
      update.run(item.id);
    } catch (e) {
      console.error('[stack] foundation enrich failed:', item.id, e);
    }
  }
}
