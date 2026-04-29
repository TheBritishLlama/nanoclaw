import Database from 'better-sqlite3';
import type { Drop } from './types.js';

// Schema inlined so tsc output works without copying SQL files alongside dist/.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS stack_queue (
  id TEXT PRIMARY KEY,
  bucket TEXT NOT NULL CHECK(bucket IN ('tool','concept','lore','foundation')),
  name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_plain TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_fetched_at TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','pending_review','sent','rejected','archived')),
  vault_path TEXT NOT NULL,
  email_message_id TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS stack_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drop_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 10),
  feedback TEXT,
  rated_at TEXT NOT NULL,
  FOREIGN KEY (drop_id) REFERENCES stack_queue(id)
);

CREATE TABLE IF NOT EXISTS stack_candidate_sources (
  domain TEXT PRIMARY KEY,
  origin_algorithm TEXT NOT NULL,
  first_observed_at TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  rss_url TEXT,
  status TEXT NOT NULL CHECK(status IN ('observed','probe_failed','candidate','promoted','archived')),
  trial_drops_sent INTEGER NOT NULL DEFAULT 0,
  trial_avg_rating REAL,
  last_probed_at TEXT,
  promoted_at TEXT
);

CREATE TABLE IF NOT EXISTS stack_domain_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mentions_domain_observed ON stack_domain_mentions(domain, observed_at);
CREATE INDEX IF NOT EXISTS idx_mentions_observed ON stack_domain_mentions(observed_at);

CREATE TABLE IF NOT EXISTS stack_source_stats (
  source TEXT PRIMARY KEY,
  drop_count INTEGER NOT NULL DEFAULT 0,
  rated_count INTEGER NOT NULL DEFAULT 0,
  avg_rating REAL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stack_scrape_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  url TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN
    ('graded_keep','graded_drop','duplicate','enriched','enrich_rejected','unparsed_reply','vault_write_failed')),
  reasoning TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stack_health_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('healthy','degraded','recovered','down')),
  detail TEXT,
  observed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stack_foundations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','enriched','sent','done','retry','archived')),
  retries INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_queue_status_created ON stack_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_queue_email_message_id ON stack_queue(email_message_id);
CREATE INDEX IF NOT EXISTS idx_ratings_drop_id ON stack_ratings(drop_id);
CREATE INDEX IF NOT EXISTS idx_health_component_observed ON stack_health_log(component, observed_at);
CREATE INDEX IF NOT EXISTS idx_candidate_status ON stack_candidate_sources(status);
`;

export function applyStackSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
}

type DropInsert = Omit<
  Drop,
  'sentAt' | 'rating' | 'ratedAt' | 'emailMessageId'
>;

export function insertQueueDrop(db: Database.Database, drop: DropInsert): void {
  db.prepare(
    `
    INSERT INTO stack_queue (
      id, bucket, name, tagline, body_html, body_plain,
      source_url, source_fetched_at, tags_json, confidence,
      status, vault_path, created_at
    ) VALUES (
      @id, @bucket, @name, @tagline, @bodyHtml, @bodyPlain,
      @sourceUrl, @sourceFetchedAt, @tagsJson, @confidence,
      @status, @vaultPath, @createdAt
    )
  `,
  ).run({ ...drop, tagsJson: JSON.stringify(drop.tags) });
}

export function getQueuedDropsOldestFirst(db: Database.Database): Drop[] {
  const rows = db
    .prepare(
      `
    SELECT * FROM stack_queue WHERE status = 'queued' ORDER BY created_at ASC
  `,
    )
    .all() as any[];
  return rows.map((r) => ({
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
