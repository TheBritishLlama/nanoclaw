CREATE TABLE stack_queue (
  id TEXT PRIMARY KEY,
  bucket TEXT NOT NULL CHECK(bucket IN ('tool','concept','lore','foundation')),
  name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_plain TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_fetched_at TEXT NOT NULL,
  tags_json TEXT NOT NULL,         -- JSON array of strings
  confidence REAL NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','pending_review','sent','rejected','archived')),
  vault_path TEXT NOT NULL,
  email_message_id TEXT,           -- set when sent; used to match inbound rating replies
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE TABLE stack_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drop_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 10),
  feedback TEXT,                   -- free-form text after the number, NULL if just a number
  rated_at TEXT NOT NULL,
  FOREIGN KEY (drop_id) REFERENCES stack_queue(id)
);

CREATE TABLE stack_candidate_sources (
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

CREATE TABLE stack_domain_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE INDEX idx_mentions_domain_observed ON stack_domain_mentions(domain, observed_at);
CREATE INDEX idx_mentions_observed ON stack_domain_mentions(observed_at);

CREATE TABLE stack_source_stats (
  source TEXT PRIMARY KEY,
  drop_count INTEGER NOT NULL DEFAULT 0,
  rated_count INTEGER NOT NULL DEFAULT 0,
  avg_rating REAL,
  updated_at TEXT NOT NULL
);

CREATE TABLE stack_scrape_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  url TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN
    ('graded_keep','graded_drop','duplicate','enriched','enrich_rejected','unparsed_reply','vault_write_failed')),
  reasoning TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE stack_health_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('healthy','degraded','recovered','down')),
  detail TEXT,
  observed_at TEXT NOT NULL
);

CREATE TABLE stack_foundations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','enriched','sent','done','retry','archived')),
  retries INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_queue_status_created ON stack_queue(status, created_at);
CREATE INDEX idx_queue_email_message_id ON stack_queue(email_message_id);
CREATE INDEX idx_ratings_drop_id ON stack_ratings(drop_id);
CREATE INDEX idx_health_component_observed ON stack_health_log(component, observed_at);
CREATE INDEX idx_candidate_status ON stack_candidate_sources(status);
