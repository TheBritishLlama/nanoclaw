# Stack — A Daily-Drop Tutor for Indie-Builder Culture & Tools

## Overview

Stack is a NanoClaw skill that delivers three daily emails of high-signal, short-form lessons on the indie-builder / sovereignty / power-user toolkit — the tools, concepts, and lore that make someone sound like they actually know what they're doing in a technical conversation. Drops are written to an Obsidian vault as Stack accumulates a personal knowledge base; Kai rates each drop 1–10 by reply, and the curator adapts over time toward what he enjoys.

**Goal:** cultural fluency over months. After ~3 months of daily drops, the user (Kai) should recognize 200+ tools/concepts and be able to hold his own with technically literate friends.

**Audience:** single user (Kai). Not designed for multi-tenant or public release; private personal infrastructure on top of NanoClaw.

**Why this exists:** Kai's friends regularly mention tools, alternatives, and practices ("use Alpaca instead of Lime", "self-host Bitwarden", "Cake wallet for crypto") that signal in-group fluency. A college CS curriculum doesn't teach this — it's tribal knowledge picked up by being around the right communities. Stack is a structured daily intake of that signal, layered on top of a foundations curriculum that fills in the basics (router, modem, cache, encryption, etc.) first.

**Codename:** `stack`

## Scope

In:
- Tools (CLI utilities, frameworks, services, SaaS alternatives) — 70% of drops once Foundations are exhausted
- Concepts (reverse proxies, ZFS snapshots, e2e encryption, etc.) — 20%
- Lore (cultural patterns: "the SQLite cult", "the boring stack gospel") — 10%
- Foundations: a finite curriculum of basics queued until exhausted (~80 items, listed below). Mixed ~50/50 with discovered drops while active.

Out (for now):
- Coursework / academic CS material (separate future startup)
- Multi-user features
- Anything not delivered via email

Reply policy:
- Numeric rating replies (`1`–`10`, optionally with free-form text feedback) — agent **never replies**
- Command replies (`/learn X`, `/more`) — agent sends a single one-line acknowledgement

## Stack (the actual stack)

| Layer | Technology | Why |
|-------|-----------|-----|
| Host platform | NanoClaw (existing) | Already has scheduler, container runner, channel system, group memory, SQLite |
| Delivery channel | NanoClaw Gmail channel (`src/channels/gmail.ts`); **drops sent FROM `amazingkangaroofilms@gmail.com` (NanoClaw agent), TO `kaitseng@seattleacademy.org` (Kai's school email)** | Already implemented; supports inbound (rating + command replies) and outbound (drops). **Gmail OAuth tokens require re-auth before launch.** |
| Knowledge store | Obsidian vault at `/mnt/c/Users/Explo/Documents/Stack/` (new, isolated) | Browsable, searchable, future-proof markdown — survives any tooling change |
| Operational store | SQLite (`src/db.ts`) — new tables for queue, scrape_log, ratings, source_stats, health_log, candidate_sources | Fast indexed access for picker, feedback loop, and source discovery |
| Grader (LLM, high volume) | Qwen 2.5 14B-Instruct via Ollama, locally | Free, fast, no rate limits; not fallback to a paid model |
| Scout classifier (LLM, mining tasks) | Qwen 2.5 3B-Instruct via Ollama, locally | Smaller/cheaper than the grader; constrained classifier task (URL extraction, "is this domain interesting") doesn't need 14B |
| Enricher (LLM, lower volume, quality-critical) | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) via Claude Agent SDK | Cost-disciplined; handles cultural nuance fine for ~250-word output |
| Search backend (for scout E) | Brave Search API (free tier, 2,000 queries/month) | Free, no Google-scraping fragility; flag in config to swap for Kagi or self-hosted Searx |
| Scraping libraries | `node-fetch` + `cheerio` for HTML; XML parsing for RSS/Atom | Standard Node stack matches NanoClaw codebase |
| Borrowed prompts | Fabric patterns (`summarize`, `extract_wisdom`, `analyze_claims`) — read-only borrow, adapted | Battle-tested by ~40k Fabric users |
| Group identity | New dedicated NanoClaw group: `groups/stack/` with its own `CLAUDE.md`, prompts, config | Isolation from main group keeps tutor traffic from polluting other agent context |

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│        FOUNDATIONS LIST                       3-TIER SOURCE POOL       │
│        (router, modem, cache,                  T1: 8 starting active   │
│         DNS, TLS, processes…)                  T2: probationary cands  │
│              │                                 T3: scouts A,B,E        │
│              │                                 (HN/Lobsters comments + │
│              │  while not exhausted            Brave topic search)     │
│              │  contributes ~50% of            sampled via stochastic  │
│              │  enrichment input               weighted lottery        │
│              │                                              │          │
│              │                                              ▼          │
│              │                                   ┌──────────────────┐  │
│              │                                   │     DISCOVER     │  │
│              │                                   │   raw items      │  │
│              │                                   └────────┬─────────┘  │
│              │                                            │            │
│              │                                            ▼            │
│              │                              ┌─────────────────────┐    │
│              │                              │  GRADE (Qwen via    │    │
│              │                              │  Ollama)            │    │
│              │     ┌───────────────────────►│  - drop-worthy?     │    │
│              │     │  source weighting      │  - bucket           │    │
│              │     │  + exemplar drops      │  - dedup            │    │
│              │     │  from feedback loop    │  - confidence       │    │
│              │     │                        └────────┬────────────┘    │
│              │     │                                 │                 │
│              │     │                                 ▼                 │
│              │     │              ┌──────────────────────────────────┐ │
│              ├─────┴─►            │     ENRICH (Claude Haiku 4.5)    │ │
│              │                    │  - web-fetch source for grounding│ │
│              │                    │  - fill type-template            │ │
│              │                    │  - reject if can't ground        │ │
│              │                    └──────────────┬───────────────────┘ │
│              ▼                                   │                     │
│   ┌──────────────────┐                           ▼                     │
│   │  FOUNDATIONS     │             ┌──────────────────────────────┐    │
│   │  ENRICH (same    │             │   CONFIDENCE GATE            │    │
│   │  template, URL = │             │   ≥0.7 → queue (auto-send)   │    │
│   │  curated ref)    │             │   <0.7 → review (rate ≥6=ok) │    │
│   └────────┬─────────┘             └──────────────┬───────────────┘    │
│            │                                      │                    │
│            └──────────────────┬───────────────────┘                    │
│                               ▼                                        │
│                     ┌──────────────────┐                               │
│                     │      QUEUE       │                               │
│                     │  (sqlite + vault)│                               │
│                     └────────┬─────────┘                               │
│                              │ 8am / 10am / 3pm PT                     │
│                              ▼                                         │
│                     ┌──────────────────┐                               │
│                     │  DAILY PICKER    │                               │
│                     │  - 50% found     │                               │
│                     │  - 50% basics    │                               │
│                     │  - bucket weight │                               │
│                     └────────┬─────────┘                               │
│                              │                                         │
│                              ▼                                         │
│                     ┌──────────────────┐                               │
│                     │  GMAIL OUTBOUND  │ ──► email arrives             │
│                     └────────┬─────────┘                               │
│                              │                                         │
│                              ▼                                         │
│                     ┌──────────────────┐                               │
│                     │  Kai replies     │                               │
│                     │  with "1"–"10"   │                               │
│                     └────────┬─────────┘                               │
│                              │ (no agent response)                     │
│                              ▼                                         │
│              ┌────────────────────────────────────┐                    │
│              │  RATING HANDLER → feedback loop:   │                    │
│              │  - update source weights           │                    │
│              │  - mark high-rated drops as        │                    │
│              │    exemplars for future grading    │                    │
│              │  - write rating into vault         │                    │
│              └────────────────────────────────────┘                    │
└────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Foundations Track

A curated, finite list of ~80 foundational topics. Every drop slot has a 50% chance of pulling from Foundations until the list is exhausted, then 100% of slots come from Discovery. Foundations are enriched by the same Haiku-driven pipeline, but the source URL is a curated reference (Wikipedia, MDN, RFC excerpt, a specific Julia Evans post, etc.) rather than a scraped item.

Foundations seed list (initial; editable in `groups/stack/foundations.json`):

**Networking basics:** modem, router, switch, hub, LAN, WAN, VLAN, NAT, DHCP, DNS, IP (v4 vs v6), TCP vs UDP, ports, sockets, packet, MAC address, latency vs bandwidth, traceroute, ping, ARP

**Web fundamentals:** HTTP request/response cycle, HTTPS / TLS, certificates, REST, JSON, cookies vs sessions vs tokens, CORS, CDN, reverse proxy, load balancer, websockets

**Security & crypto:** symmetric vs asymmetric encryption, hashing, salting, public/private keypairs, SSH keys, TLS handshake, password managers, e2e encryption, zero-knowledge

**Systems concepts:** processes vs threads, virtual memory, cache (CPU L1/L2/L3, HTTP cache, browser cache), file system, kernel vs user space, system calls, environment variables, stdin/stdout/stderr, pipes

**Storage & data:** relational vs NoSQL, ACID, transactions, indexes, normalization, blob storage, key-value stores

**Dev workflow:** version control (git basics), package managers, build tools vs runtimes, compiled vs interpreted, static vs dynamic typing, linters / formatters

**Infrastructure:** containers vs VMs, Docker basics, what a "service" is, ports/listening processes, daemons / background services, cron

A foundation item is marked `done` once Kai has rated it ≥6. Foundations rated <6 stay in the pool for re-attempt with a different source/angle (max 2 retries, then archived).

### 2. Source Pool & Discovery Engine

The discovery system is a 3-tier source pool sampled by a stochastic weighting formula, with background scouts that grow the pool by mining for new candidate sources.

```
   ┌──────────────────────────────────────────────────────────┐
   │              ACTIVE SOURCES (Tier 1)                     │
   │   8 starting + auto-promoted candidates                  │
   │   Sampled every nightly cycle via weighted lottery       │
   └──────────────────────────────────────────────────────────┘
                              ▲ promoted after avg ≥6 over 5 trial drops
                              │
   ┌──────────────────────────────────────────────────────────┐
   │           PROBATIONARY CANDIDATES (Tier 2)               │
   │   Domains discovered by scouts; low sampling weight      │
   │   Get trial drops occasionally; promoted, demoted, or    │
   │   archived after trial period                            │
   └──────────────────────────────────────────────────────────┘
                              ▲ added by scouts
                              │
   ┌──────────────────────────────────────────────────────────┐
   │           DISCOVERY SCOUTS (Tier 3, background)          │
   │   Mining tasks running weekly to find candidate domains  │
   │   MVP scouts: A (HN comments), B (Lobsters comments),    │
   │   E (topic-driven web search via Brave)                  │
   └──────────────────────────────────────────────────────────┘
```

#### 2.1 Tier 1 — starting active sources

| Source | Method | Notes |
|--------|--------|-------|
| HN front page | HN Firebase API → top 30 | Clean API |
| HN Show HN | HN Algolia API tag filter | Newer launches |
| Lobste.rs | RSS (`https://lobste.rs/rss`) | Simplest possible |
| r/selfhosted weekly top | Reddit JSON (`/r/selfhosted/top.json?t=week`) | Fragile; auto-disabled if anti-bot trips, until Phase 2's custom Reddit scraper |
| GitHub Trending | Scrape `github.com/trending` via cheerio | Daily/weekly trending repos |
| Product Hunt (dev) | Product Hunt GraphQL API (free tier) | Dev category filter |
| Curated blog RSS | RSS/Atom feeds (list below) | Most reliable signal |
| Hacker Newsletter | RSS (`https://hackernewsletter.com/rss.xml`) | Weekly curated HN |

Curated blog RSS feeds (configurable, MVP defaults; Lobste.rs and Hacker Newsletter handled by their dedicated scrapers above):
- Simon Willison — `https://simonwillison.net/atom/everything/`
- Dan Luu — `https://danluu.com/atom.xml`
- Julia Evans — `https://jvns.ca/atom.xml`
- Drew DeVault — `https://drewdevault.com/blog/index.xml`
- Fabien Sanglard — `https://fabiensanglard.net/rss.xml`
- Patrick McKenzie (Bits about Money) — `https://www.bitsaboutmoney.com/archive/rss/`
- Hackaday — `https://hackaday.com/blog/feed/`

Each scraper is a stateless function that returns `RawItem[]`:

```ts
type RawItem = {
  source: string;          // 'hn' | 'showhn' | 'lobsters' | 'rss:simonwillison' | 'cand:foo.dev' | …
  title: string;
  url: string;
  blurb?: string;
  fetchedAt: string;       // ISO timestamp
};
```

#### 2.2 Sampling formula (per source, per cycle)

```
weight = base_weight
       × quality_factor      // avg rating, normalized 0–1; new sources default 0.5
       × freshness_factor    // 1.0 if source posted in last 7 days, else 0.6
       × random_jitter       // uniform 0.7–1.3 — the randomness factor
       × tier_multiplier     // Tier 1 = 1.0, Tier 2 = 0.3

min_sample_probability = 0.10   // every active source gets ≥10% chance per cycle
                                // — the "lucky pull" floor for small/niche sources
```

Each cycle, the picker iterates over (Tier 1 ∪ Tier 2) sources, computes the weight, normalizes to a probability distribution, and samples N sources to pull from (default N = all of Tier 1 + a random 30% of Tier 2). The `min_sample_probability` floor prevents large/loud sources from completely dominating the pull, and the random jitter is what gives small high-quality blogs the chance to surface.

#### 2.3 Discovery algorithm registry (pluggable)

Source discovery is built around a **pluggable algorithm interface** so new strategies can be added over time without restructuring the system. Every discovery algorithm implements the same contract:

```ts
interface DiscoveryAlgorithm {
  name: string;                           // unique identifier, e.g. 'generic_algorithm'
  schedule: string;                       // cron expression
  enabled: boolean;                       // toggled in config.json
  role: 'core' | 'supplement';            // core = consensus discovery; supplement = freshness/personalization
  run(ctx: DiscoveryContext): Promise<CandidateSource[]>;
}

interface DiscoveryContext {
  db: Database;
  vault: VaultWriter;
  classifier: QwenClassifier;             // Qwen 2.5 3B
  webFetch: WebFetcher;
  search?: SearchClient;                  // present if a search backend is configured
  ratings: RatingHistory;                 // for personalization-aware algorithms
  mentions: DomainMentionStore;           // for consensus-aware algorithms
}
```

A central `discoveryRegistry.ts` loads enabled algorithms from config at startup and runs each on its declared schedule. Algorithms register their cron entries automatically — adding a new algorithm is a file in `src/discovery/algorithms/` plus a one-line entry in `config.json`'s `discoveryAlgorithms` array.

**Algorithms shipped in MVP:**

| Name | Role | Schedule | Purpose |
|------|------|----------|---------|
| `generic_algorithm` | core | nightly observation + every-4-days refresh | Passive observation of domain mentions across all active sources; every 4 days refreshes the source pool — re-weights existing sources by recent mention activity, surfaces new candidates when they appear, flags going-stale sources |
| `scout_A_hn_comments` | supplement | weekly | HN comment URL mining for freshness/personalization |
| `scout_B_lobsters_comments` | supplement | weekly | Lobste.rs comment URL mining |
| `scout_E_brave_topic` | supplement | weekly | Topic-driven Brave Search using Kai's high-rated tags |

**Future algorithms** (Phase 2+, easy to drop in via the interface):
- `scout_C_github_readme` — README link extraction
- `scout_D_awesome_traversal` — awesome-* repo individual link extraction
- `scout_G_lobsters_tags` — subscribe to Lobste.rs tag-specific RSS feeds
- `scout_youtube_creator_links` — Fabric-extracted links from creator videos
- `scout_podcast_show_notes` — podcast episode notes mining
- `scout_newsletter_archives` — newsletter back-issue mining
- Anything custom — Kai writes a file, adds a config line, done

#### 2.4 Algorithm: `generic_algorithm` (core)

The core discovery algorithm. Its job is to **keep Stack's source pool current** with what the indie-builder culture is actively citing right now. It does NOT have to find entirely new sources every run — most refresh cycles will mostly re-weight existing sources based on recent mention activity, with new candidates surfaced only when they appear organically. Scouts (2.5) layer freshness and personalization on top of this baseline.

**Nightly observation step** (runs at end of every `stack-scrape` cycle):
1. For each `RawItem` collected this cycle, extract the URL's domain.
2. If the item has a `blurb` or fetched-content body, parse outbound links and extract their domains too.
3. For each (domain, source) pair, append a row to `stack_domain_mentions(domain, source, observed_at)`. No LLM involved — pure regex + domain parsing.
4. Skip mega-domains via the same `domainBloomlist` used by scouts.

**Refresh step** (runs every 4 days at ~04:00):

For every domain referenced in `stack_domain_mentions` over the rolling 30-day window, compute `recent_mentions` (count) and `distinct_source_count` (how many distinct active sources cited it). Then for each domain, take one of three paths:

| Domain status | Path | Effect |
|---------------|------|--------|
| **Already an active source** (Tier 1 or Tier 2) | Update its `recent_mention_score` in `stack_source_stats` (recent activity feeds into the sampling formula's freshness/quality factor) | Hot sources get pulled more often; quiet ones get pulled less |
| **Not active, but `recent_mentions ≥ 5` AND `distinct_source_count ≥ 2` AND not already in `stack_candidate_sources`** | Run RSS auto-discovery (2.6); on success insert as `stack_candidate_sources` with `origin_algorithm='generic_algorithm'`, `status='candidate'`, tier 2 | Surfaces new candidates organically when they appear, but doesn't force discovery if nothing new is bubbling up |
| **Active source but zero mentions in window** | Mark as `going_stale` in `stack_source_stats` (informational only — does not auto-demote) | Surfaced in nightly health summary; user can decide to disable manually |

This keeps the source pool aligned with what's currently active — the pool isn't a static list, it's a living reflection of the culture's current attention. Most 4-day cycles will be re-weighting only; new-candidate surfacing happens when warranted, not on a schedule.

The thresholds are deliberately lower than a "monthly big sweep" would use (`recent_mentions ≥ 5` instead of ≥10) because we're sampling a shorter 30-day window and running 7-8× more often — each run sees less data, so the bar to surface a candidate is also lower.

#### 2.5 Algorithm family: supplemental scouts (A, B, E)

Scouts add **freshness** (catching newer voices before they cross the consensus popularity threshold) and **personalization** (steering toward the topics Kai rates highly). They run weekly as a separate cron task (`stack-scout`). Each scout produces `CandidateSource` rows:

```ts
type CandidateSource = {
  domain: string;            // e.g. 'fabiensanglard.net'
  origin_algorithm: string;  // e.g. 'generic_algorithm' | 'scout_A_hn_comments' | …
  first_observed_at: string;
  occurrence_count: number;  // how many times scouts have flagged it
  rss_url: string | null;    // discovered via auto-discovery; null if none found
  status: 'observed' | 'probe_failed' | 'candidate' | 'promoted' | 'archived';
  trial_drops_sent: number;
  trial_avg_rating: number | null;
};
```

**Scout A — HN comment URL mining**
- For each story that produced a high-rated drop (rating ≥7) in the last 30 days, fetch its HN comment thread.
- Extract all outbound URLs (regex + cheerio).
- Group by domain; ignore mega-domains (github.com, youtube.com, twitter.com, wikipedia.org, etc. — configurable bloomlist).
- Pass surviving (domain, sample comment context) tuples to **Qwen 2.5 3B** classifier: "Is this domain a likely high-signal indie/tech blog or tool docs page? yes/no."
- Approved domains: `occurrence_count++`. Domains with ≥3 occurrences over rolling 30 days advance to RSS auto-discovery (see 2.4).

**Scout B — Lobste.rs comment URL mining**
- Same algorithm as A, on Lobste.rs threads. Higher signal (smaller, more curated community), lower volume.

**Scout E — Topic-driven web search**
- Read the top-tagged topics from your high-rated drops (rating ≥7) over the last 60 days. Tags are extracted by Haiku during enrichment (e.g., `homelab`, `rust`, `caching`, `privacy`).
- For each top topic, query Brave Search API: `"{topic} blog 2026"` and `"{topic} self-hosted tools"`.
- Take top 20 results. For each, pass (URL, snippet, topic) to **Qwen 2.5 3B**: "Is this a tech/builder blog post that would interest someone studying {topic}? yes/no."
- Approved URLs: domain extracted, `occurrence_count++`, same flow as A/B.

Scout cost is bounded: A and B do at most ~50 LLM classification calls per week (free, local Qwen 3B). E does at most 10 search queries per week (well under Brave's 2,000/month free quota) plus ~200 Qwen classification calls.

#### 2.6 RSS auto-discovery (shared infrastructure)

When a candidate domain reaches `occurrence_count ≥ 3`, attempt to find its RSS feed:

1. Fetch the homepage HTML.
2. Parse `<link rel="alternate" type="application/rss+xml" href="...">` and `application/atom+xml`.
3. If none found, probe common paths: `/feed`, `/rss`, `/rss.xml`, `/atom.xml`, `/index.xml`, `/feed.xml`, `/blog/feed`, `/blog/rss`.
4. Validate the response is parseable XML/Atom.
5. On success, set `rss_url`, status → `candidate`. The candidate enters Tier 2 with `tier_multiplier = 0.3` and starts receiving trial pulls.
6. On failure, status → `probe_failed`. The domain may be re-observed and re-probed quarterly.

#### 2.7 Promotion / demotion rules (shared)

- **Trial period** (Tier 2 → Tier 1): a candidate gets up to 5 trial drops over rolling 60 days. If avg rating ≥6, promoted to Tier 1 with full base_weight. If avg <4 after 5 drops, archived.
- **Demotion** (Tier 1 → Tier 2): a Tier 1 source whose rolling avg drops below 3 over 20+ rated drops moves to Tier 2 (low weight, half-chance). Doesn't go to zero — could recover.
- **Hard kill:** only happens via repeated technical failure (scraper errors), never by ratings alone.

Source scrapers run as a single nightly job (`stack-scrape`); scouts run as a weekly job (`stack-scout`). Scrapers run in parallel with 30s per-source timeout. Failures are logged and don't block other sources.

### 3. Grader (Qwen via Ollama)

Input: `RawItem[]` (deduped against corpus by URL).
Output: `Graded[]`:

```ts
type Graded = {
  raw: RawItem;
  keep: boolean;
  bucket?: 'tool' | 'concept' | 'lore';
  confidence: number;       // 0.0–1.0
  reasoning: string;        // for debugging tuning
};
```

Prompt construction (per batch, structured output):
- Static intro: indie-builder/sovereignty/power-user audience criteria, scope buckets.
- **Dynamic exemplars** drawn from `ratings` table (rolling 60-day window):
  - 3 highest-rated drops (rating ≥8) labeled "Kai loved these"
  - 1 lowest-rated drop (rating ≤4) labeled "Kai didn't enjoy this"
- **Source weighting hint:** average rating per source from `source_stats`. Items from sources with avg rating <4 get an extra "this source has been low-signal for Kai recently — apply stricter judgment" line.
- The candidate items themselves.

Runs on Ollama at `http://localhost:11434`. Batch size up to 50. **No fallback to paid models** — if Ollama is down, see Health Monitor.

Items where `keep === false` are logged to `stack_scrape_log`, then dropped (also written to `Vault/Scraped/Dropped/{date}.md` for transparency).

Items where `keep === true` AND name (extracted from title) already exists in vault `Drops/` are dedup-rejected.

### 4. Enricher (Claude Haiku 4.5)

Input: `Graded` (filtered for `keep && !duplicate`), or `FoundationItem` from the Foundations track.
Output: `Drop`:

```ts
type Drop = {
  id: string;
  bucket: 'tool' | 'concept' | 'lore' | 'foundation';
  name: string;
  tagline: string;
  body: string;             // ~250 words, HTML
  bodyPlain: string;        // plain-text fallback
  source: { url: string; fetchedAt: string };
  tags: string[];           // extracted by Haiku for the feedback loop (e.g. ['networking','cache','privacy'])
  confidence: number;
  status: 'queued' | 'pending_review' | 'sent' | 'rejected';
  rating?: number;          // 1–10, set when Kai replies
  ratedAt?: string;
  vaultPath: string;        // path inside Obsidian vault
  createdAt: string;
};
```

Pipeline:
1. Fetch the source URL content (no Context7).
2. Optionally fetch one secondary URL for grounding (official site, README).
3. Run the type-appropriate template prompt (see Templates).
4. If the LLM cannot ground the claim (`{ "groundable": false }`), reject the item.
5. Compute confidence by re-asking the LLM "rate your factual confidence 0.0–1.0".
6. Write to Obsidian vault as a markdown file (see Vault Layout).
7. Persist row to `stack_queue`; status `queued` if confidence ≥ 0.7, else `pending_review`.

### 5. Confidence & Rating System

Two-stage:

- **Pre-send confidence:** auto-set by enricher.
  - `confidence ≥ 0.7` → enters main queue, eligible for next available delivery slot
  - `confidence < 0.7` → emailed to Kai with subject `[Stack Review] {name}`, threaded under Gmail label `stack/review`. Awaits a numeric reply.
- **Post-send (or in-review) rating:** Kai replies to any drop with `<integer 1–10>` optionally followed by free-form feedback text. Parsed by `^(\d{1,2})\b\s*[-:,]?\s*(.*)$`.
  - For sent drops: `{rating, feedback}` is stored and used by the feedback loop. Agent does not respond.
  - For review drops: rating ≥6 → drop is approved and joins main queue. Rating <6 → drop is rejected and archived. Agent does not respond.
  - Replies that don't begin with a number 1–10 are logged to `stack_scrape_log` with outcome `unparsed_reply` and silently ignored.

### 6. Adaptive Curator (feedback loop)

A small module that consumes the `ratings` table and emits three artifacts continuously consumed by the Grader and the sampling formula:

1. **`source_stats`** (table): rolling 60-day mean rating per source. Recomputed nightly. Drives both the Grader's source-weighting hint and the sampling formula's `quality_factor`.
2. **`exemplar_set`** (cached file): top-3 highest-rated drops + 1 lowest-rated, refreshed nightly. Bucket-balanced. Embedded into Grader prompt verbatim.
3. **`recent_feedback_block`** (cached file): the 5 most recent non-empty `feedback` strings paired with their drop name and rating. Embedded into Grader prompt as a "Kai's recent notes" section. Example block:
   ```
   Recent feedback from Kai:
   - Rated 3, "AlphaCryptoTool": "too crypto-heavy, I don't care about that wing"
   - Rated 9, "Tailscale Funnel": "love anything about networking"
   - Rated 2, "Vaultwarden": "third time you've sent me a Bitwarden alternative"
   ```
   Qwen 14B is asked to weigh these notes when scoring new candidates.

MVP behavior:
- Source weighting affects both the Grader prompt and the `quality_factor` in the sampling formula — high-rated sources get pulled more often AND their candidates are graded more leniently.
- Exemplars are bucket-balanced (e.g., not all from the "tool" bucket).
- A new source has zero rated drops initially → `quality_factor` defaults to 0.5 (neutral) until 5+ rated drops accumulate.
- Feedback text is processed only as in-prompt notes for MVP. No structured tag extraction or per-topic weighting yet.

Phase 2 additions (deferred):
- Tag-level personalization: Qwen 3B extracts structured tags from feedback text (e.g., "no crypto" → `disliked_tags: [crypto]`); drops with disliked tags get penalized in queue order, drops with liked tags get bumped.
- Per-bucket weight auto-tuning based on rating averages.
- Hard source-disabling after rolling avg <3 over 20+ drops.

### 7. Daily Picker

Triggered by NanoClaw scheduler at 08:00, 10:00, 15:00 PT (configurable in `config.json`).

Algorithm (single slot):
1. Decide source mix: if Foundations has unsent items, 50% chance to pull from Foundations queue, else 100% Discovered.
2. Within Discovered, obey rolling 7-day bucket-weight target (tool 70 / concept 20 / lore 10).
3. Among eligible drops (status=`queued`), pick oldest by `createdAt`.
4. Mark `sent`, persist `sentAt`, send email.
5. Update vault frontmatter (`status: sent`, `sentAt`).

If queue is empty AND Foundations exhausted, log warning and emit a single "queue empty" notification email per empty slot.

### 8. Gmail Outbound (drop emails)

Format: HTML primary, plain-text fallback.

Subject by bucket:
- Foundation: `Stack — Basics: {name}`
- Tool: `Stack — {name}`
- Concept: `Stack — Concept: {name}`
- Lore: `Stack — Lore: {name}`

HTML email skeleton (minimal inline CSS, mobile-friendly):
- `<h2>` name + tagline
- Type-templated body
- Footer: source link; one-line reminder: "Reply `1`–`10` to rate (optional text after the number teaches the curator). `/learn X` to queue a tool. `/more` for another drop."
- Outbound is via the existing NanoClaw Gmail channel — sent FROM `amazingkangaroofilms@gmail.com` (NanoClaw agent), TO `kaitseng@seattleacademy.org` (Kai's school email).

### 9. Inbound Gmail Handler

Watches the agent's inbox for replies to drop emails. Three recognized message shapes:

**(a) Numeric rating reply** — first non-quoted line matches `^(\d{1,2})\b\s*[-:,]?\s*(.*)$` with the integer in 1–10:
- Look up the drop by Gmail thread ID (matched against `stack_queue.email_message_id`).
- Persist `{ rating, feedback }` to `stack_ratings` and update vault frontmatter.
- If the drop was in `pending_review`, apply the ≥6 approve / <6 reject rule.
- **Send no response.** This is the strict no-reply contract.

**(b) `/learn X` command** — adds `X` as a high-priority candidate; pushed through Grade → Enrich → Queue (skipping the dedup check if user explicitly insists with `/learn! X`):
- Send a single one-line acknowledgement: `"Queued '{X}' for enrichment — will arrive in a future drop slot."`

**(c) `/more` command** — pop one drop from the queue immediately and send it as the next email:
- If queue has items: send the next drop within 1 minute, then a single one-line ack: `"Sent next drop."`
- If queue is empty: ack with `"Queue empty — no extra drop available right now."` (no fallback, doesn't auto-trigger scrape)

Anything else (no recognized format) → log as `unparsed_reply` and ignore silently.

### 10. Obsidian Vault Writer

Path: `/mnt/c/Users/Explo/Documents/Stack/` (new vault, isolated from Jarvis).

Structure:

```
Stack/
├─ Drops/
│   ├─ Foundations/
│   │   ├─ DNS.md
│   │   ├─ TLS.md
│   │   └─ …
│   ├─ Tools/
│   │   ├─ Tailscale.md
│   │   └─ …
│   ├─ Concepts/
│   │   └─ Reverse-proxy.md
│   └─ Lore/
│       └─ The-SQLite-cult.md
├─ Scraped/
│   ├─ Pending/    (graded but not yet enriched)
│   └─ Dropped/    (graded out — kept for transparency/tuning)
├─ Reviews/       (pending_review drops live here too, mirrored to email)
├─ Index/
│   ├─ By-bucket.md
│   ├─ By-source.md
│   ├─ By-rating.md
│   └─ Foundations-progress.md
└─ Stack.md       (vault README — what this is, how it's organized)
```

Each drop note has frontmatter:

```yaml
---
id: drop_2026-04-28_tailscale
name: Tailscale
bucket: tool
source: https://tailscale.com
fetched: 2026-04-27T02:14:00Z
sent: 2026-04-28T08:00:00Z
status: sent
confidence: 0.84
rating: 8
ratedAt: 2026-04-28T08:42:00Z
tags: [networking, vpn, sovereignty, wireguard]
---
```

Body is the same HTML→markdown content as the email body. Cross-links via `[[wiki-style]]` references when possible (the enricher emits these for known related terms).

The vault writer runs synchronously after enrichment (no async drift between SQLite and vault); a vault write failure rolls back the SQLite insert and re-tries with backoff.

### 11. Ollama Health Monitor

Detection: ping `http://localhost:11434/api/tags` before every grading batch and every 15 minutes via watchdog cron.

Down-handling sequence:
1. Attempt automatic restart:
   - macOS: `brew services restart ollama` (if installed via brew), else `launchctl kickstart -k gui/$(id -u)/com.ollama` (if launchd)
   - Linux: `systemctl --user restart ollama`
2. Wait 10s; re-ping.
3. If still down:
   - Send urgent email to Kai with subject `[Stack] Ollama down — drops postponed`. Body includes restart attempt logs and the command to run manually.
   - Mark `health_log` with state `degraded`.
   - **Postpone all pending grading and all subsequent delivery slots until Ollama is back.** No fallback to Haiku for grading.
4. Continue pinging every 5 minutes; once Ollama responds, resume immediately and send a "back online" email.

The Daily Picker checks `health_log.state`; if `degraded`, the slot is skipped silently (no empty-queue notification — Kai already got the down-alert email).

## Templates

Stored as markdown prompt files in `groups/stack/prompts/`. Borrowed structure from Fabric's `extract_wisdom` and `summarize`; adapted to Stack's voice and 250-word constraint.

### Tool template

```
**{name}** — {one-line tagline}

**What it is:** {1–2 sentences, plain English, no jargon}

**Replaces / category:** {what category, what people use instead}

**Why people pick it:**
- {reason 1 — usually quality, ergonomics, or ownership}
- {reason 2}
- {reason 3}

**Used by:** {audience tribe}

**Friend-says decoder:** "If you hear someone mention {name}, they're usually {doing X / making Y choice}."

[source: {url}]
```

### Concept template

```
**{concept}** — {one-line plain-English definition}

**Why it matters:** {what problem it solves}

**Where you'll see it:** {real contexts}

**Concrete example:** {one specific, scannable example}

**Adjacent terms:** {2–4 related terms}

[source: {url}]
```

### Lore template

```
**The pattern:** {what it is}

**The story:** {2–3 sentences of backstory}

**Who's involved:** {communities, well-known people}

**The meme version:** {how it shows up in conversations}

**Why anyone cares:** {what's load-bearing — or what's just culture}

[source: {url}]
```

### Foundation template

```
**{name}** — {one-line definition for a beginner}

**The mental model:** {2–3 sentences building intuition from analogy}

**How it works (just enough):** {simple, accurate explanation; no hand-waving}

**Where you encounter it:** {everyday contexts where this shows up}

**One step deeper (optional):** {a single sentence pointing to the next layer of detail}

[source: {url}]
```

## Data Flow (a typical day)

**T-12h (overnight, ~2am):**
1. Cron fires `stack-scrape` task in NanoClaw.
2. Health monitor pings Ollama. If down, recovery sequence (see Health Monitor).
3. Sampling formula computed for all (Tier 1 ∪ Tier 2) sources; sample set chosen with random jitter and `min_sample_probability` floor.
4. Sampled scrapers run in parallel; ~150–400 raw items.
5. URL-dedup against vault → ~80–250 unique candidates.
6. Adaptive curator refreshes `source_stats`, `exemplar_set`, and `recent_feedback_block` from last 60 days of ratings + feedback text.
7. Grader (Qwen 14B) scores all in batched calls; ~10–30 survive.
8. Enricher (Haiku) processes survivors sequentially with 1s delay; drops written to vault and queue.
9. Pending-review drops emailed to `stack/review` label.
10. Foundations track: ensure ≥3 enriched Foundation items always sit in queue (top up if below).
11. **`generic_algorithm` observation step:** every URL and embedded outbound link from this cycle's raw items has its domain logged to `stack_domain_mentions`. No LLM, just regex + domain parsing.

**Weekly (Sunday ~3am):** registry runs each enabled supplemental algorithm on its own schedule. Default cron entries:
1. `scout_A_hn_comments` (Sun 03:00) — over the last 30 days of high-rated drops, mines URLs from HN comment threads; Qwen 3B classifies; updates `stack_candidate_sources` with `origin_algorithm='scout_A_hn_comments'`.
2. `scout_B_lobsters_comments` (Sun 03:30) — same pattern on Lobste.rs.
3. `scout_E_brave_topic` (Sun 04:00) — queries top-tagged topics on Brave Search; classifies results.
4. Domains crossing `occurrence_count ≥ 3` get RSS auto-discovery; successful probes become Tier 2 candidates.
5. Trial-period evaluation: Tier 2 sources with 5+ trial drops are promoted (avg ≥6) or archived (avg <4).

**Every 4 days (~04:00):** `generic_algorithm` refresh step.
1. Query `stack_domain_mentions` over rolling 30 days.
2. For every observed domain, route to one of three paths (re-weight active source / surface new candidate / flag going-stale).
3. New candidates (≥5 mentions, ≥2 distinct sources, not already known) get RSS auto-discovery; survivors enter Tier 2 with `origin_algorithm='generic_algorithm'`.
4. The source pool stays aligned with what the indie-builder culture is currently citing — most cycles are re-weighting only, with new candidates surfaced when they appear naturally.

**T-0 (morning, 8am):**
1. Scheduler fires daily-picker.
2. Picker selects (50/50 Foundations vs Discovered) → bucket-weighted within Discovered.
3. HTML email assembled, sent via Gmail outbound (FROM agent, TO Kai).
4. Vault frontmatter updated.

**T+2h (10am), T+7h (3pm):** repeat picker.

**Anytime Kai replies:**
- Numeric rating (with optional feedback text): rating handler parses both, stores in `stack_ratings`, updates vault frontmatter. If review drop: ≥6 → queue, <6 → archive. **No response sent.**
- `/learn X`: candidate enqueued; one-line ack sent.
- `/more`: next drop popped from queue and sent; one-line ack sent.

## Storage Schema

New tables in NanoClaw's existing SQLite (`src/db.ts`). Migrations applied on skill install.

```sql
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
  origin_algorithm TEXT NOT NULL,  -- name of the DiscoveryAlgorithm that surfaced it
                                   -- e.g. 'generic_algorithm', 'scout_A_hn_comments'
  first_observed_at TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  rss_url TEXT,                    -- NULL until RSS auto-discovery succeeds
  status TEXT NOT NULL CHECK(status IN ('observed','probe_failed','candidate','promoted','archived')),
  trial_drops_sent INTEGER NOT NULL DEFAULT 0,
  trial_avg_rating REAL,
  last_probed_at TEXT,
  promoted_at TEXT
);

CREATE TABLE stack_domain_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  source TEXT NOT NULL,            -- the active source where the mention was observed
  observed_at TEXT NOT NULL
);
CREATE INDEX idx_mentions_domain_observed ON stack_domain_mentions(domain, observed_at);
CREATE INDEX idx_mentions_observed ON stack_domain_mentions(observed_at);

CREATE TABLE stack_source_stats (
  source TEXT PRIMARY KEY,
  drop_count INTEGER NOT NULL DEFAULT 0,
  rated_count INTEGER NOT NULL DEFAULT 0,
  avg_rating REAL,                 -- NULL until rated_count >= 5
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
  component TEXT NOT NULL,         -- 'ollama' | 'gmail' | 'vault' | 'scraper:hn' | …
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
```

The vault is the canonical knowledge store; SQLite is the operational index. If the SQLite db is wiped and the vault survives, the system can be rebuilt from the vault by re-importing each markdown frontmatter block.

## Configuration

`groups/stack/config.json`:

```json
{
  "timezone": "America/Los_Angeles",
  "deliveryTimes": ["08:00", "10:00", "15:00"],
  "senderEmail": "amazingkangaroofilms@gmail.com",
  "recipientEmail": "kaitseng@seattleacademy.org",
  "vaultPath": "/mnt/c/Users/Explo/Documents/Stack",
  "bucketWeights": { "tool": 0.7, "concept": 0.2, "lore": 0.1 },
  "foundationsMixRatio": 0.5,
  "confidenceThreshold": 0.7,
  "reviewApproveThreshold": 6,
  "queueMinDepth": 10,
  "graderModel": "qwen2.5:14b",
  "scoutClassifierModel": "qwen2.5:3b",
  "enricherModel": "claude-haiku-4-5-20251001",
  "rssFeeds": [
    "https://simonwillison.net/atom/everything/",
    "https://danluu.com/atom.xml",
    "https://jvns.ca/atom.xml",
    "https://drewdevault.com/blog/index.xml",
    "https://fabiensanglard.net/rss.xml",
    "https://www.bitsaboutmoney.com/archive/rss/",
    "https://hackaday.com/blog/feed/"
  ],
  "enabledScrapers": ["hn","showhn","lobsters","reddit_selfhosted","github_trending","producthunt","rss","hackernewsletter"],
  "samplingFormula": {
    "minSampleProbability": 0.10,
    "randomJitterMin": 0.7,
    "randomJitterMax": 1.3,
    "freshnessFactorActive": 1.0,
    "freshnessFactorStale": 0.6,
    "freshnessWindowDays": 7,
    "tier2Multiplier": 0.3,
    "tier2SamplePercent": 0.3
  },
  "discoveryAlgorithms": [
    { "name": "generic_algorithm",        "enabled": true, "schedule": "0 4 */4 * *" },
    { "name": "scout_A_hn_comments",      "enabled": true, "schedule": "0 3 * * 0" },
    { "name": "scout_B_lobsters_comments","enabled": true, "schedule": "30 3 * * 0" },
    { "name": "scout_E_brave_topic",      "enabled": true, "schedule": "0 4 * * 0" }
  ],
  "discovery": {
    "domainBloomlist": ["github.com","youtube.com","twitter.com","x.com","wikipedia.org","reddit.com","medium.com","substack.com"],
    "genericAlgorithmWindowDays": 30,
    "genericAlgorithmMinRecentMentions": 5,
    "genericAlgorithmMinDistinctSources": 2,
    "genericAlgorithmStaleIfZeroMentionsInWindow": true,
    "occurrenceThresholdForRssProbe": 3,
    "trialDropsCount": 5,
    "promotionMinAvgRating": 6,
    "archiveMaxAvgRating": 4
  },
  "search": {
    "provider": "brave",
    "braveApiKey": "{env:BRAVE_API_KEY}",
    "weeklyQueryBudget": 10
  },
  "ollama": {
    "host": "http://localhost:11434",
    "watchdogIntervalMinutes": 15,
    "restartCommand": "auto"
  }
}
```

## Phasing

| Phase | Scope | Rough effort |
|-------|-------|--------------|
| **MVP (Phase 1)** | Everything in this spec: 8 starting Tier 1 scrapers, Foundations track (~80 items), 3-tier source pool with stochastic sampling formula, **pluggable discovery algorithm registry** with `generic_algorithm` (core, runs every 4 days — keeps source pool current via re-weighting + organic new-candidate surfacing) plus supplemental scouts A/B/E (HN comments, Lobsters comments, Brave topic search) using Qwen 3B classifier, RSS auto-discovery, candidate promotion/demotion, Qwen 14B grading with adaptive exemplars + source weighting + free-form feedback notes, Haiku enrichment, Obsidian vault writer, 3/day email delivery, numeric rating handler with optional feedback text (silent), `/learn` and `/more` commands with one-line acks, confidence + review flow, Ollama health monitor with auto-restart and email-postpone. | ~2 weeks |
| **Phase 2** | (a) Custom Reddit scraper for more subs (`r/devops`, `r/programming`, etc.) with proper anti-bot handling; (b) Fabric Level 3 — `/learn-from <YouTube/article URL>` ingests via Fabric's `extract_wisdom` to generate drops; (c) Semantic dedup via embeddings; (d) Tag-level personalization in Adaptive Curator (boost queue order based on liked tags, not just source weight); (e) Additional discovery algorithms via the registry interface — `scout_C_github_readme`, `scout_D_awesome_traversal`, `scout_G_lobsters_tags`, `scout_youtube_creator_links`. Each new algorithm = one new file in `src/discovery/algorithms/` + one config line. | ~1 week |
| **Phase 3 (Full Build, Shape C)** | (a) Decoder mode — paste any text, get a per-term breakdown of every tool/concept/lore reference; (b) Quiz / spaced repetition — Anki-style intervals over the corpus, sent as separate quiz emails (e.g. weekly "What was Tailscale used for?"); (c) Corpus search and history view inside the vault. | ~2 weeks |

## Error Handling

- **Scraper failure:** logged to `stack_health_log`, doesn't fail job. If 6+/8 sources fail in one night, NanoClaw alert.
- **Ollama unreachable:** see Health Monitor — auto-restart, then email + postpone. No paid-model fallback.
- **Enrichment fails to ground:** drop discarded; logged with reasoning; written to `Vault/Scraped/Dropped/`.
- **Vault write failure:** roll back SQLite insert; retry with exponential backoff (3 attempts), then alert.
- **Queue empty at delivery time (and Foundations exhausted):** delivery skipped; Kai notified once per empty slot. 3+ empty slots in a row triggers an alert to relax confidence threshold or expand sources.
- **Gmail send failure:** retry with exponential backoff (3 attempts), then surface error to NanoClaw error channel.
- **Unparsed numeric reply:** logged, ignored (no response).

## Testing

Following NanoClaw conventions (`*.test.ts`):

- Unit tests for each scraper against a recorded fixture (HTML/JSON snapshot)
- Unit tests for Grader prompt assembly (with/without exemplars, with/without source weighting)
- Unit tests for Enricher template-fill given mock Haiku responses
- Unit tests for Rating handler (valid 1–10, edge cases, non-numeric)
- Unit tests for Vault writer (frontmatter round-trip, path collisions)
- Unit tests for Ollama health monitor (mocked-down scenario, auto-restart success/failure)
- Integration test for full pipeline end-to-end against mocked source set
- Manual smoke test: install skill in fresh NanoClaw, confirm first email arrives within 24h and a rating reply round-trips into vault frontmatter

## Installation

Implemented as a NanoClaw feature skill at `.claude/skills/add-stack/`. Skill apply (`scripts/apply-skill.ts`) does:
1. Add Ollama via existing `add-ollama-tool` skill if not present; pull `qwen2.5:14b` and `qwen2.5:3b`.
2. Install Node dependencies (RSS parser, etc.) into `package.json`.
3. Run DB migrations for the eight new tables (`stack_queue`, `stack_ratings`, `stack_source_stats`, `stack_scrape_log`, `stack_health_log`, `stack_foundations`, `stack_candidate_sources`, `stack_domain_mentions`).
4. Create `groups/stack/` with default `CLAUDE.md`, `config.json`, prompt templates, foundations seed.
5. Create the Obsidian vault at `vaultPath` with directory skeleton and `Stack.md` README.
6. Register cron entries: `stack-scrape` (nightly), one entry per enabled discovery algorithm (registered automatically from `discoveryAlgorithms[].schedule`), `stack-deliver-08`, `stack-deliver-10`, `stack-deliver-15`, `stack-ollama-watchdog` (every 15min).
7. Wire inbound Gmail handler to recognize numeric ratings + `/learn` + `/more` on Stack threads.
8. Walk the user through Gmail OAuth re-auth (existing `add-gmail` flow) — required before launch.
9. Prompt the user to add `BRAVE_API_KEY` to NanoClaw's `.env` (free signup at brave.com/search/api).
10. Print final Gmail-label setup steps for Kai to complete manually.

## Open Questions / Known Unknowns

- **Vault path.** Defaulting to `/mnt/c/Users/Explo/Documents/Stack/` (new, isolated). Confirm or override.
- **Search backend.** Defaulting to Brave Search API (free 2k/month). Swap to Kagi or self-hosted Searx by changing `search.provider` in config.
- **Gmail FROM identity.** Drops are sent from the NanoClaw agent's existing Gmail account. OAuth tokens require re-auth before launch — handled in install flow.
- **Reddit scraping fragility.** May break early; auto-disable + retry quarterly until Phase 2's custom scraper.
- **Confidence threshold tuning.** `0.7` is a guess; review after 1 week of `stack_scrape_log` data.
- **Bucket weight enforcement vs queue ordering.** If queue is mostly tools, picker may starve concept/lore. Defined behavior: prefer weight, fall back to oldest. Refine after first week.
- **Ollama auto-restart command portability.** Restart command differs across OSes/install methods. The `restartCommand: "auto"` config detects platform; explicit override available.
- **Exemplar + feedback embedding cost in Grader prompt.** Adding 4 exemplars + 5 feedback notes to every grading batch increases token use. Acceptable for local Qwen (free), but watch for slow batches as corpus grows.
- **Foundations completeness.** ~80 seed items is a guess. Likely to grow as we identify gaps. Foundations list is editable as a JSON file.
- **Rating reply matching.** Relies on Gmail `In-Reply-To` / thread ID being preserved. If rating arrives outside a reply (forwarded, etc.), it can't be matched and is logged as `unparsed_reply`.
- **Sampling formula tuning.** `min_sample_probability=0.10` and jitter range `0.7–1.3` are starting guesses. Once 30+ days of ratings exist, validate that small sources are surfacing at the desired rate; tune if dominant sources are over- or under-represented.
- **Scout cost ceiling.** Scout E uses ~10 Brave queries/week — well under free tier. Scouts A and B do ~50 Qwen 3B classifications/week — local and free. As corpus grows and high-rated drops accumulate, A/B mining grows linearly; cap at 200 classifications/week if it balloons.
- **`generic_algorithm` thresholds.** Starting values (≥5 recent mentions across ≥2 distinct sources over 30 days, refresh every 4 days) are guesses tuned for "keep current" rather than "big monthly sweep." After 2-3 refresh cycles, audit which domains get re-weighted up vs. surfaced as new candidates — adjust thresholds if too few candidates appear or if the source pool becomes too volatile.
- **Algorithm registry growth.** The `DiscoveryAlgorithm` interface is intentionally minimal so anything can implement it. As Stack matures, expect to add algorithms that pull from podcasts, YouTube descriptions, newsletters, and user-curated lists. Each is a new file + config line.
