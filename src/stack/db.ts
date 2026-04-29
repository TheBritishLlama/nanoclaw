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
  staleness TEXT,
  recent_mention_score REAL,
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

CREATE TABLE IF NOT EXISTS stack_graded_pending (
  url TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  blurb TEXT,
  fetched_at TEXT NOT NULL,
  bucket TEXT NOT NULL CHECK(bucket IN ('tool','concept','lore')),
  confidence REAL NOT NULL,
  reasoning TEXT,
  graded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_queue_status_created ON stack_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_queue_email_message_id ON stack_queue(email_message_id);
CREATE INDEX IF NOT EXISTS idx_queue_source_url ON stack_queue(source_url);
CREATE INDEX IF NOT EXISTS idx_ratings_drop_id ON stack_ratings(drop_id);
CREATE INDEX IF NOT EXISTS idx_health_component_observed ON stack_health_log(component, observed_at);
CREATE INDEX IF NOT EXISTS idx_candidate_status ON stack_candidate_sources(status);
CREATE INDEX IF NOT EXISTS idx_graded_pending_graded_at ON stack_graded_pending(graded_at);
CREATE INDEX IF NOT EXISTS idx_scrape_log_url ON stack_scrape_log(url);
`;

export function applyStackSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
  // Forward-compat: add Plan 2 columns if a Plan 1 deployment is being upgraded.
  const cols = db.prepare('PRAGMA table_info(stack_source_stats)').all() as {
    name: string;
  }[];
  const have = new Set(cols.map((c) => c.name));
  if (!have.has('staleness'))
    db.exec('ALTER TABLE stack_source_stats ADD COLUMN staleness TEXT');
  if (!have.has('recent_mention_score'))
    db.exec(
      'ALTER TABLE stack_source_stats ADD COLUMN recent_mention_score REAL',
    );
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

// ---- Discovery (Plan 2) queries ---------------------------------------------

export interface DomainMentionInsert {
  domain: string;
  source: string;
  observedAt: string;
}
export function insertDomainMention(
  db: Database.Database,
  m: DomainMentionInsert,
): void {
  db.prepare(
    `INSERT INTO stack_domain_mentions (domain, source, observed_at)
              VALUES (@domain, @source, @observedAt)`,
  ).run(m);
}

export interface DomainMentionAggregate {
  domain: string;
  recent_mentions: number;
  distinct_source_count: number;
}
export function recentDomainMentions(
  db: Database.Database,
  sinceIso: string,
): DomainMentionAggregate[] {
  return db
    .prepare(
      `
    SELECT domain,
           COUNT(*) AS recent_mentions,
           COUNT(DISTINCT source) AS distinct_source_count
    FROM stack_domain_mentions
    WHERE observed_at >= ?
    GROUP BY domain
  `,
    )
    .all(sinceIso) as DomainMentionAggregate[];
}

export interface CandidateUpsert {
  domain: string;
  origin_algorithm: string;
  firstObservedAt: string;
}
export function upsertCandidateSource(
  db: Database.Database,
  c: CandidateUpsert,
): void {
  db.prepare(
    `
    INSERT INTO stack_candidate_sources (domain, origin_algorithm, first_observed_at, occurrence_count, status)
    VALUES (@domain, @origin_algorithm, @firstObservedAt, 1, 'observed')
    ON CONFLICT(domain) DO UPDATE SET occurrence_count = occurrence_count + 1
  `,
  ).run(c);
}

export interface CandidateSource {
  domain: string;
  origin_algorithm: string;
  first_observed_at: string;
  occurrence_count: number;
  rss_url: string | null;
  status: 'observed' | 'probe_failed' | 'candidate' | 'promoted' | 'archived';
  trial_drops_sent: number;
  trial_avg_rating: number | null;
  last_probed_at: string | null;
  promoted_at: string | null;
}
export function getCandidateSource(
  db: Database.Database,
  domain: string,
): CandidateSource | undefined {
  return db
    .prepare('SELECT * FROM stack_candidate_sources WHERE domain = ?')
    .get(domain) as CandidateSource | undefined;
}

export function setCandidateRssAndStatus(
  db: Database.Database,
  domain: string,
  rss_url: string | null,
  status: CandidateSource['status'],
  probedAt: string,
): void {
  db.prepare(
    `UPDATE stack_candidate_sources
              SET rss_url = ?, status = ?, last_probed_at = ?
              WHERE domain = ?`,
  ).run(rss_url, status, probedAt, domain);
}

export function listCandidatesByStatus(
  db: Database.Database,
  status: CandidateSource['status'],
): CandidateSource[] {
  return db
    .prepare(
      'SELECT * FROM stack_candidate_sources WHERE status = ? ORDER BY first_observed_at ASC',
    )
    .all(status) as CandidateSource[];
}

export interface SourceStat {
  source: string;
  drop_count: number;
  rated_count: number;
  avg_rating: number | null;
  staleness: string | null;
  recent_mention_score: number | null;
  updated_at: string;
}
export function getSourceStat(
  db: Database.Database,
  source: string,
): SourceStat | undefined {
  return db
    .prepare('SELECT * FROM stack_source_stats WHERE source = ?')
    .get(source) as SourceStat | undefined;
}

export function markSourceStaleness(
  db: Database.Database,
  source: string,
  staleness: 'fresh' | 'going_stale' | null,
  atIso: string,
): void {
  db.prepare(
    `
    INSERT INTO stack_source_stats (source, staleness, updated_at)
    VALUES (@source, @staleness, @at)
    ON CONFLICT(source) DO UPDATE SET staleness = @staleness, updated_at = @at
  `,
  ).run({ source, staleness, at: atIso });
}

export function setRecentMentionScore(
  db: Database.Database,
  source: string,
  score: number,
  atIso: string,
): void {
  db.prepare(
    `
    INSERT INTO stack_source_stats (source, recent_mention_score, updated_at)
    VALUES (@source, @score, @at)
    ON CONFLICT(source) DO UPDATE SET recent_mention_score = @score, updated_at = @at
  `,
  ).run({ source, score, at: atIso });
}

export function listActiveSourceDomains(db: Database.Database): string[] {
  return (
    db.prepare('SELECT source FROM stack_source_stats').all() as {
      source: string;
    }[]
  ).map((r) => r.source);
}

// ---- Graded-pending checkpoint -----------------------------------------------
// A graded item that hasn't been enriched yet. Persists between stages so a
// crash in stage 3+ doesn't waste the (slow) Qwen grading work.

import type { Graded } from './types.js';

export function insertGradedPending(
  db: Database.Database,
  items: Graded[],
  gradedAt: string,
): number {
  if (items.length === 0) return 0;
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO stack_graded_pending
      (url, source, title, blurb, fetched_at, bucket, confidence, reasoning, graded_at)
    VALUES (@url, @source, @title, @blurb, @fetchedAt, @bucket, @confidence, @reasoning, @gradedAt)
  `);
  let inserted = 0;
  const tx = db.transaction((rows: Graded[]) => {
    for (const g of rows) {
      if (!g.bucket) continue;
      const info = stmt.run({
        url: g.raw.url,
        source: g.raw.source,
        title: g.raw.title,
        blurb: g.raw.blurb ?? null,
        fetchedAt: g.raw.fetchedAt,
        bucket: g.bucket,
        confidence: g.confidence,
        reasoning: g.reasoning,
        gradedAt,
      });
      inserted += info.changes;
    }
  });
  tx(items);
  return inserted;
}

export function listGradedPending(db: Database.Database): Graded[] {
  const rows = db
    .prepare(`SELECT * FROM stack_graded_pending ORDER BY graded_at ASC`)
    .all() as any[];
  return rows.map((r) => ({
    raw: {
      source: r.source,
      title: r.title,
      url: r.url,
      blurb: r.blurb ?? undefined,
      fetchedAt: r.fetched_at,
    },
    keep: true,
    bucket: r.bucket,
    confidence: r.confidence,
    reasoning: r.reasoning ?? '',
  }));
}

export function deleteGradedPending(db: Database.Database, url: string): void {
  db.prepare('DELETE FROM stack_graded_pending WHERE url = ?').run(url);
}

export function countGradedPending(db: Database.Database): number {
  return (
    db.prepare('SELECT COUNT(*) AS c FROM stack_graded_pending').get() as {
      c: number;
    }
  ).c;
}

// ---- URL dedup -------------------------------------------------------------
// "Seen" = grader already processed this URL (scrape_log) OR an enriched drop
// for it lives in the queue OR it's already waiting in the graded checkpoint.
// Pre-filtering against this set is the difference between a 2-hour daily run
// and a 20-minute one — without it, every RSS backfill re-grades the same
// hundreds of items every day.
export function getKnownUrls(
  db: Database.Database,
  urls: string[],
): Set<string> {
  if (urls.length === 0) return new Set();
  const placeholders = urls.map(() => '?').join(',');
  const seen = new Set<string>();
  const rows = db
    .prepare(
      `SELECT url FROM (
         SELECT url FROM stack_scrape_log WHERE url IN (${placeholders})
         UNION
         SELECT source_url AS url FROM stack_queue WHERE source_url IN (${placeholders})
         UNION
         SELECT url FROM stack_graded_pending WHERE url IN (${placeholders})
       )`,
    )
    .all(...urls, ...urls, ...urls) as { url: string }[];
  for (const r of rows) seen.add(r.url);
  return seen;
}

export type ScrapeOutcome =
  | 'graded_keep'
  | 'graded_drop'
  | 'duplicate'
  | 'enriched'
  | 'enrich_rejected'
  | 'unparsed_reply'
  | 'vault_write_failed';

export function recordScrapeOutcomes(
  db: Database.Database,
  rows: Array<{
    source: string;
    url: string;
    outcome: ScrapeOutcome;
    reasoning?: string;
  }>,
  fetchedAt: string,
): void {
  if (rows.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO stack_scrape_log (source, url, outcome, reasoning, fetched_at)
     VALUES (@source, @url, @outcome, @reasoning, @fetchedAt)`,
  );
  const tx = db.transaction(
    (
      input: Array<{
        source: string;
        url: string;
        outcome: ScrapeOutcome;
        reasoning?: string;
      }>,
    ) => {
      for (const r of input)
        stmt.run({
          source: r.source,
          url: r.url,
          outcome: r.outcome,
          reasoning: r.reasoning ?? null,
          fetchedAt,
        });
    },
  );
  tx(rows);
}
