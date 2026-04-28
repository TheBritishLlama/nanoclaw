import type Database from 'better-sqlite3';
import path from 'path';
import { writeDrop } from '../vault.js';
import { insertQueueDrop } from '../db.js';
import type { Drop } from '../types.js';

export function persistDrop(db: Database.Database, vaultPath: string, drop: Drop): Drop {
  const fullVaultPath = writeDrop(vaultPath, drop);
  const relVaultPath = path.relative(vaultPath, fullVaultPath);
  const finalDrop = { ...drop, vaultPath: relVaultPath };
  insertQueueDrop(db, finalDrop);
  return finalDrop;
}
