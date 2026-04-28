import type Database from 'better-sqlite3';
import type { Bucket, Drop } from '../types.js';

export interface PickerOptions {
  rng: () => number;
  foundationsMixRatio: number;
  bucketWeights: { tool: number; concept: number; lore: number };
}

function rowToDrop(r: any): Drop {
  return {
    id: r.id, bucket: r.bucket, name: r.name, tagline: r.tagline,
    bodyHtml: r.body_html, bodyPlain: r.body_plain,
    sourceUrl: r.source_url, sourceFetchedAt: r.source_fetched_at,
    tags: JSON.parse(r.tags_json), confidence: r.confidence,
    status: r.status, vaultPath: r.vault_path,
    emailMessageId: r.email_message_id ?? undefined,
    createdAt: r.created_at, sentAt: r.sent_at ?? undefined,
  };
}

function pickBucket(rng: number, w: PickerOptions['bucketWeights']): Bucket {
  if (rng < w.tool) return 'tool';
  if (rng < w.tool + w.concept) return 'concept';
  return 'lore';
}

export function pickNextDrop(db: Database.Database, opts: PickerOptions): Drop | null {
  const foundations = db.prepare(
    "SELECT * FROM stack_queue WHERE status='queued' AND bucket='foundation' ORDER BY created_at ASC LIMIT 1"
  ).get() as any;
  const useFoundation = foundations && opts.rng() < opts.foundationsMixRatio;
  if (useFoundation) return rowToDrop(foundations);

  const wantedBucket = pickBucket(opts.rng(), opts.bucketWeights);
  const inBucket = db.prepare(
    "SELECT * FROM stack_queue WHERE status='queued' AND bucket=? ORDER BY created_at ASC LIMIT 1"
  ).get(wantedBucket) as any;
  if (inBucket) return rowToDrop(inBucket);

  // Fall back to oldest queued of any non-foundation bucket
  const anyBucket = db.prepare(
    "SELECT * FROM stack_queue WHERE status='queued' AND bucket != 'foundation' ORDER BY created_at ASC LIMIT 1"
  ).get() as any;
  if (anyBucket) return rowToDrop(anyBucket);

  // Last resort: foundation if it exists
  return foundations ? rowToDrop(foundations) : null;
}

export function markSent(db: Database.Database, dropId: string, sentAt: string, messageId: string): void {
  db.prepare(
    "UPDATE stack_queue SET status='sent', sent_at=?, email_message_id=? WHERE id=?"
  ).run(sentAt, messageId, dropId);
}
