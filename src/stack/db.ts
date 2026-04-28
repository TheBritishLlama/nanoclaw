import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Drop } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function applyStackSchema(db: Database.Database): void {
  const sql = fs.readFileSync(
    path.join(__dirname, 'migrations/001-stack-schema.sql'),
    'utf-8'
  );
  db.exec(sql);
}

type DropInsert = Omit<Drop, 'sentAt' | 'rating' | 'ratedAt' | 'emailMessageId'>;

export function insertQueueDrop(db: Database.Database, drop: DropInsert): void {
  db.prepare(`
    INSERT INTO stack_queue (
      id, bucket, name, tagline, body_html, body_plain,
      source_url, source_fetched_at, tags_json, confidence,
      status, vault_path, created_at
    ) VALUES (
      @id, @bucket, @name, @tagline, @bodyHtml, @bodyPlain,
      @sourceUrl, @sourceFetchedAt, @tagsJson, @confidence,
      @status, @vaultPath, @createdAt
    )
  `).run({ ...drop, tagsJson: JSON.stringify(drop.tags) });
}

export function getQueuedDropsOldestFirst(db: Database.Database): Drop[] {
  const rows = db.prepare(`
    SELECT * FROM stack_queue WHERE status = 'queued' ORDER BY created_at ASC
  `).all() as any[];
  return rows.map(r => ({
    id: r.id,
    bucket: r.bucket,
    name: r.name,
    tagline: r.tagline,
    bodyHtml: r.body_html,
    bodyPlain: r.body_plain,
    sourceUrl: r.source_url,
    sourceFetchedAt: r.source_fetched_at,
    tags: JSON.parse(r.tags_json),
    confidence: r.confidence,
    status: r.status,
    vaultPath: r.vault_path,
    emailMessageId: r.email_message_id ?? undefined,
    createdAt: r.created_at,
    sentAt: r.sent_at ?? undefined,
  }));
}
