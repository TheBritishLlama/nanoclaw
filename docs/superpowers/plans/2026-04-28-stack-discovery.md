# Stack Discovery Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stack's discovery layer — a pluggable algorithm registry that keeps the source pool current with what indie-builder culture is citing right now, plus the Wikipedia-grounding fix that unblocks Foundations enrichment.

**Architecture:** New `src/stack/discovery/` module with a small `DiscoveryAlgorithm` interface, four MVP algorithms (`generic_algorithm`, `scout_A_hn_comments`, `scout_B_lobsters_comments`, `scout_E_searxng_topic`), shared infrastructure for RSS auto-discovery and the domain bloomlist, a stochastic sampler that replaces Plan 1's fixed 8-source pool, and a daily promotion/demotion job. Scout E queries SearXNG (free, no API quota). Domain mention observation runs as a post-scrape hook on each `stack-scrape` cycle. The Wikipedia-grounding fix adds a Mozilla Readability + JSDOM extractor between `webFetch` and the existing 6000-char slice in `enrich()`.

**Tech Stack:** TypeScript (Node, ES modules with `.js` import extensions), `better-sqlite3` (existing Stack DB), `@mozilla/readability` + `jsdom` (article extraction), `cheerio` (HTML link mining for scouts A/B), `node-fetch`/global `fetch` (HTTP), `cron-parser` (already in use by `StackScheduler`).

**Spec:** `docs/superpowers/specs/2026-04-27-stack-design.md` (sections 2.3–2.8)

**Scope:** This plan implements everything in spec sections 2.3–2.8 (discovery algorithm registry, `generic_algorithm`, scouts A/B/E, RSS auto-discovery, promotion/demotion, the stochastic sampling formula, and the reader-mode HTML extractor). It also rewires the scraper registry to use the sampler instead of the Plan 1 fixed `enabledScrapers` list. Plan 1 created the schema tables `stack_candidate_sources` and `stack_domain_mentions` for forward-compat; this plan starts using them.

---

## File Structure

All Plan 2 work happens on a fresh `skill/stack-discovery` branch (cut from `main` after Plan 1 merges). Files created or modified:

```
nanoclaw/
├── package.json                                          # Modify: add @mozilla/readability, jsdom, @types/jsdom
├── src/stack/
│   ├── config.ts                                         # Modify: extend StackConfig + validators (Plan 2 fields already in JSON)
│   ├── db.ts                                             # Modify: queries for mentions, candidates, source_stats trials
│   ├── index.ts                                          # Modify: wire discovery crons + post-scrape mention hook + sampler
│   ├── pipeline/
│   │   ├── reader.ts                                     # Create: Mozilla Readability + jsdom extractor
│   │   └── enricher.ts                                   # Modify: use reader before slice (Wikipedia-grounding fix)
│   ├── scrapers/
│   │   └── index.ts                                      # Modify: accept sampler-selected sources, not fixed enabled list
│   └── discovery/
│       ├── search.ts                                     # Create: SearXNG search client
│       ├── rss-discovery.ts                              # Create: RSS auto-discovery probe + domain bloomlist
│       ├── mentions.ts                                   # Create: post-scrape domain mention observer
│       ├── registry.ts                                   # Create: DiscoveryAlgorithm interface + registry
│       ├── sampler.ts                                    # Create: stochastic source sampler (Tier1 ∪ Tier2)
│       ├── promote.ts                                    # Create: daily promotion/demotion job
│       └── algorithms/
│           ├── generic.ts                                # Create: generic_algorithm (4-day refresh)
│           ├── scout-a-hn-comments.ts                    # Create: HN comment URL mining
│           ├── scout-b-lobsters-comments.ts              # Create: Lobste.rs comment URL mining
│           └── scout-e-searxng-topic.ts                  # Create: SearXNG topic-driven search
└── tests/stack/
    ├── config.test.ts                                    # Modify: cover new fields
    ├── db.test.ts                                        # Modify: cover new queries
    ├── pipeline/
    │   └── reader.test.ts                                # Create
    └── discovery/
        ├── search.test.ts                                # Create
        ├── rss-discovery.test.ts                         # Create
        ├── mentions.test.ts                              # Create
        ├── registry.test.ts                              # Create
        ├── sampler.test.ts                               # Create
        ├── promote.test.ts                               # Create
        ├── algorithms/
        │   ├── generic.test.ts                           # Create
        │   ├── scout-a-hn-comments.test.ts               # Create
        │   ├── scout-b-lobsters-comments.test.ts         # Create
        │   └── scout-e-searxng-topic.test.ts             # Create
        └── smoke.test.ts                                 # Modify: extend with discovery end-to-end
└── scripts/
    └── stack-discovery-smoke.ts                          # Create: live mention → refresh → candidate smoke
```

The two new SQL tables (`stack_candidate_sources`, `stack_domain_mentions`) and their indexes already exist in `src/stack/db.ts` from Plan 1 — Plan 2 only adds query helpers, never schema.

---

### Task 1: Wikipedia-grounding fix (reader-mode extractor)

**Why first:** Foundations enrichment fails today against any HTML-heavy source (Wikipedia in particular — see spec §2.8). Shipping this first unblocks Foundations independently of the rest of Plan 2 and keeps the rest of the discovery work decoupled from a known-broken pre-condition.

**Files:**
- Modify: `package.json`
- Create: `src/stack/pipeline/reader.ts`
- Create: `tests/stack/pipeline/reader.test.ts`
- Modify: `src/stack/pipeline/enricher.ts`
- Modify: `tests/stack/pipeline/enricher.test.ts` (if present; otherwise extend `tests/stack/smoke.test.ts`)

- [ ] **Step 1: Install dependencies**

```bash
npm install @mozilla/readability jsdom
npm install --save-dev @types/jsdom
```

Expected: `package.json` updated; `package-lock.json` updated; no peer-dep warnings other than benign ones.

- [ ] **Step 2: Write failing reader test**

```ts
// tests/stack/pipeline/reader.test.ts
import { describe, it, expect } from 'vitest';
import { extractReadable } from '../../../src/stack/pipeline/reader.js';

describe('extractReadable', () => {
  it('extracts the article body from a typical news-style HTML page', () => {
    const html = `<!DOCTYPE html><html><head><title>Test</title></head>
      <body>
        <nav>nav nav nav</nav>
        <article>
          <h1>Hello World</h1>
          <p>This is a long enough paragraph to satisfy Readability's minimum content heuristic, which discards tiny snippets that look like navigation or boilerplate. Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
          <p>Here is a second paragraph with more substantive content so the article passes the length threshold.</p>
        </article>
        <footer>footer</footer>
      </body></html>`;
    const out = extractReadable(html, 'https://example.com/post');
    expect(out).not.toBeNull();
    expect(out!.textContent).toContain('Hello World');
    expect(out!.textContent).toContain('Lorem ipsum');
    expect(out!.textContent).not.toContain('nav nav nav');
    expect(out!.length).toBeGreaterThan(100);
  });

  it('returns null when input is not parseable / has no article-like content', () => {
    const out = extractReadable('<html><body></body></html>', 'https://example.com/');
    expect(out).toBeNull();
  });

  it('returns null when extracted text is shorter than 200 chars', () => {
    const html = '<html><body><article><p>tiny</p></article></body></html>';
    const out = extractReadable(html, 'https://example.com/');
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```
npx vitest run tests/stack/pipeline/reader.test.ts
```

Expected: FAIL — `Cannot find module '../../../src/stack/pipeline/reader.js'`.

- [ ] **Step 4: Implement reader.ts**

```ts
// src/stack/pipeline/reader.ts
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export interface ExtractedArticle {
  title: string | null;
  textContent: string;
  length: number;
}

const MIN_TEXT_LENGTH = 200;

export function extractReadable(html: string, url: string): ExtractedArticle | null {
  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url });
  } catch {
    return null;
  }
  let parsed: ReturnType<Readability['parse']>;
  try {
    parsed = new Readability(dom.window.document).parse();
  } catch {
    return null;
  }
  if (!parsed) return null;
  const text = (parsed.textContent ?? '').trim();
  if (text.length < MIN_TEXT_LENGTH) return null;
  return { title: parsed.title ?? null, textContent: text, length: text.length };
}
```

- [ ] **Step 5: Run test to verify it passes**

```
npx vitest run tests/stack/pipeline/reader.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Wire reader into enricher**

Edit `src/stack/pipeline/enricher.ts`. Replace the `webFetch` + slice block (currently lines 30–32) with a reader-first version that falls back to raw HTML on failure:

```ts
// src/stack/pipeline/enricher.ts (the part that builds `source`)
import { extractReadable } from './reader.js';

// ...inside enrich(), replacing the existing `try { source = (await webFetch(graded.raw.url)).slice(0, 6000); } catch { return null; }`
let html: string;
try { html = await webFetch(graded.raw.url); }
catch { return null; }
const extracted = extractReadable(html, graded.raw.url);
const source = (extracted?.textContent ?? html).slice(0, 6000);
```

The fallback (`?? html`) preserves Plan 1 behavior for sources Readability can't parse — strict improvement, no regression.

- [ ] **Step 7: Run all stack tests**

```
npx vitest run tests/stack/
```

Expected: PASS — all existing tests still green.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/stack/pipeline/reader.ts \
        src/stack/pipeline/enricher.ts tests/stack/pipeline/reader.test.ts
git commit -m "fix(stack): extract article body via Readability before enrich slice"
```

---

### Task 2: Extend StackConfig with discovery, search, sampling fields

**Files:**
- Modify: `src/stack/config.ts`
- Modify: `tests/stack/config.test.ts`

The Plan 2 fields (`discoveryAlgorithms`, `discovery`, `samplingFormula`, `search`, `scoutClassifierModel`) already exist in `groups/stack/config.json` from Plan 1's spec-driven scaffolding, but `StackConfig` doesn't type them and `validate()` doesn't check them. Make them first-class.

- [ ] **Step 1: Write failing tests for new validations**

```ts
// Append to tests/stack/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadStackConfig } from '../../src/stack/config.js';

const baseValid = {
  timezone: 'America/Los_Angeles',
  deliveryTimes: ['08:00','10:00','15:00'],
  recipientEmail: 'r@example.com', senderEmail: 's@example.com',
  vaultPath: '/tmp/vault',
  bucketWeights: { tool: 0.7, concept: 0.2, lore: 0.1 },
  foundationsMixRatio: 0.5,
  confidenceThreshold: 0.7, reviewApproveThreshold: 6, queueMinDepth: 10,
  graderModel: 'qwen3:14b', scoutClassifierModel: 'qwen3:4b',
  enricherModel: 'claude-haiku-4-5-20251001',
  rssFeeds: [], enabledScrapers: [],
  ollama: { host: 'http://localhost:11434', watchdogIntervalMinutes: 15, restartCommand: 'auto' },
  samplingFormula: {
    minSampleProbability: 0.10, randomJitterMin: 0.7, randomJitterMax: 1.3,
    freshnessFactorActive: 1.0, freshnessFactorStale: 0.6, freshnessWindowDays: 7,
    tier2Multiplier: 0.3, tier2SamplePercent: 0.3,
  },
  discoveryAlgorithms: [
    { name: 'generic_algorithm', enabled: true, schedule: '0 4 */4 * *' },
  ],
  discovery: {
    domainBloomlist: ['github.com'],
    genericAlgorithmWindowDays: 30,
    genericAlgorithmMinRecentMentions: 5,
    genericAlgorithmMinDistinctSources: 2,
    genericAlgorithmStaleIfZeroMentionsInWindow: true,
    occurrenceThresholdForRssProbe: 3,
    trialDropsCount: 5,
    promotionMinAvgRating: 6,
    archiveMaxAvgRating: 4,
  },
  search: { provider: 'searxng', searxngInstance: 'https://searx.example.com', weeklyQueryBudget: 50 },
};

describe('stack config — discovery fields', () => {
  it('accepts the full valid config', () => {
    expect(() => loadStackConfig.fromObject(baseValid as any)).not.toThrow();
  });

  it('rejects samplingFormula.minSampleProbability outside 0..1', () => {
    const bad = { ...baseValid, samplingFormula: { ...baseValid.samplingFormula, minSampleProbability: 1.5 }};
    expect(() => loadStackConfig.fromObject(bad as any)).toThrow(/minSampleProbability/);
  });

  it('rejects randomJitterMin > randomJitterMax', () => {
    const bad = { ...baseValid, samplingFormula: { ...baseValid.samplingFormula, randomJitterMin: 1.5, randomJitterMax: 0.7 }};
    expect(() => loadStackConfig.fromObject(bad as any)).toThrow(/randomJitter/);
  });

  it('rejects unknown discovery algorithm name', () => {
    const bad = { ...baseValid, discoveryAlgorithms: [{ name: 'totally_made_up', enabled: true, schedule: '0 4 * * *' }] };
    expect(() => loadStackConfig.fromObject(bad as any)).toThrow(/unknown discovery algorithm/);
  });

  it('rejects unsupported search.provider', () => {
    const bad = { ...baseValid, search: { ...baseValid.search, provider: 'kagi' }};
    expect(() => loadStackConfig.fromObject(bad as any)).toThrow(/search.provider/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run tests/stack/config.test.ts
```

Expected: FAIL — types/validators don't yet cover the new fields.

- [ ] **Step 3: Extend StackConfig + validators**

Replace `src/stack/config.ts` with:

```ts
import fs from 'fs';

export interface SamplingFormula {
  minSampleProbability: number;
  randomJitterMin: number;
  randomJitterMax: number;
  freshnessFactorActive: number;
  freshnessFactorStale: number;
  freshnessWindowDays: number;
  tier2Multiplier: number;
  tier2SamplePercent: number;
}

export interface DiscoveryAlgorithmConfig {
  name: string;
  enabled: boolean;
  schedule: string;
}

export interface DiscoveryConfig {
  domainBloomlist: string[];
  genericAlgorithmWindowDays: number;
  genericAlgorithmMinRecentMentions: number;
  genericAlgorithmMinDistinctSources: number;
  genericAlgorithmStaleIfZeroMentionsInWindow: boolean;
  occurrenceThresholdForRssProbe: number;
  trialDropsCount: number;
  promotionMinAvgRating: number;
  archiveMaxAvgRating: number;
}

export interface SearchConfig {
  provider: 'searxng';
  searxngInstance: string;
  weeklyQueryBudget: number;
}

export interface StackConfig {
  timezone: string;
  deliveryTimes: string[];
  recipientEmail: string;
  senderEmail: string;
  vaultPath: string;
  bucketWeights: { tool: number; concept: number; lore: number };
  foundationsMixRatio: number;
  confidenceThreshold: number;
  reviewApproveThreshold: number;
  queueMinDepth: number;
  graderModel: string;
  scoutClassifierModel: string;
  enricherModel: string;
  rssFeeds: string[];
  enabledScrapers: string[];
  ollama: { host: string; watchdogIntervalMinutes: number; restartCommand: string };
  samplingFormula: SamplingFormula;
  discoveryAlgorithms: DiscoveryAlgorithmConfig[];
  discovery: DiscoveryConfig;
  search: SearchConfig;
}

const KNOWN_ALGORITHMS = new Set([
  'generic_algorithm',
  'scout_A_hn_comments',
  'scout_B_lobsters_comments',
  'scout_E_searxng_topic',
]);

function validate(cfg: StackConfig): void {
  const sum = cfg.bucketWeights.tool + cfg.bucketWeights.concept + cfg.bucketWeights.lore;
  if (Math.abs(sum - 1.0) > 0.001) throw new Error(`bucketWeights must sum to 1.0, got ${sum}`);
  if (cfg.confidenceThreshold < 0 || cfg.confidenceThreshold > 1)
    throw new Error(`confidenceThreshold must be 0..1, got ${cfg.confidenceThreshold}`);
  if (cfg.reviewApproveThreshold < 1 || cfg.reviewApproveThreshold > 10)
    throw new Error(`reviewApproveThreshold must be 1..10, got ${cfg.reviewApproveThreshold}`);

  const s = cfg.samplingFormula;
  if (s.minSampleProbability < 0 || s.minSampleProbability > 1)
    throw new Error(`samplingFormula.minSampleProbability must be 0..1, got ${s.minSampleProbability}`);
  if (s.randomJitterMin > s.randomJitterMax)
    throw new Error(`samplingFormula.randomJitterMin (${s.randomJitterMin}) must be <= randomJitterMax (${s.randomJitterMax})`);
  if (s.tier2SamplePercent < 0 || s.tier2SamplePercent > 1)
    throw new Error(`samplingFormula.tier2SamplePercent must be 0..1, got ${s.tier2SamplePercent}`);

  for (const a of cfg.discoveryAlgorithms) {
    if (!KNOWN_ALGORITHMS.has(a.name))
      throw new Error(`unknown discovery algorithm: ${a.name}`);
  }

  if (cfg.search.provider !== 'searxng')
    throw new Error(`search.provider must be 'searxng' (got '${cfg.search.provider}')`);
}

export function loadStackConfig(filePath: string): StackConfig {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StackConfig;
  validate(raw);
  return raw;
}
loadStackConfig.fromObject = (obj: StackConfig): StackConfig => { validate(obj); return obj; };
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run tests/stack/config.test.ts
```

Expected: PASS (existing + 5 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/stack/config.ts tests/stack/config.test.ts
git commit -m "feat(stack): type and validate discovery + sampling config fields"
```

---

### Task 3: SearXNG search client

**Files:**
- Create: `src/stack/discovery/search.ts`
- Create: `tests/stack/discovery/search.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/stack/discovery/search.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SearxngClient, type SearchResult } from '../../../src/stack/discovery/search.js';

describe('SearxngClient', () => {
  it('hits /search?format=json with the query and parses results[]', async () => {
    const fetcher = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        results: [
          { url: 'https://a.example/post1', title: 'Post 1', content: 'snippet 1' },
          { url: 'https://b.example/post2', title: 'Post 2', content: 'snippet 2' },
        ],
      }),
    }));
    const c = new SearxngClient('https://searx.example', fetcher as any);
    const out: SearchResult[] = await c.search('homelab blog 2026');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const calledUrl = fetcher.mock.calls[0][0] as string;
    expect(calledUrl).toContain('https://searx.example/search?');
    expect(calledUrl).toContain('format=json');
    expect(calledUrl).toContain('q=homelab+blog+2026');
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe('https://a.example/post1');
    expect(out[0].snippet).toBe('snippet 1');
  });

  it('returns [] on non-ok response', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const c = new SearxngClient('https://searx.example', fetcher as any);
    expect(await c.search('x')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/stack/discovery/search.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement search.ts**

```ts
// src/stack/discovery/search.ts
export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status?: number; json: () => Promise<any> }>;

export class SearxngClient {
  constructor(private instance: string, private fetcher: Fetcher = (u) => fetch(u)) {}

  async search(query: string, max = 20): Promise<SearchResult[]> {
    const u = new URL('/search', this.instance);
    u.searchParams.set('q', query);
    u.searchParams.set('format', 'json');
    // SearXNG renders + as space in the query string; keep it readable in the URL
    const url = u.toString().replace(/%20/g, '+');
    const res = await this.fetcher(url);
    if (!res.ok) return [];
    const body = await res.json();
    const items = Array.isArray(body?.results) ? body.results : [];
    return items.slice(0, max).map((r: any) => ({
      url: String(r.url ?? ''),
      title: String(r.title ?? ''),
      snippet: String(r.content ?? ''),
    })).filter((r: SearchResult) => r.url);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/stack/discovery/search.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stack/discovery/search.ts tests/stack/discovery/search.test.ts
git commit -m "feat(stack): add SearXNG search client"
```

---

### Task 4: RSS auto-discovery + domain bloomlist

**Files:**
- Create: `src/stack/discovery/rss-discovery.ts`
- Create: `tests/stack/discovery/rss-discovery.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/stack/discovery/rss-discovery.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  isBloomedDomain,
  discoverRssFeed,
  type WebFetcher,
} from '../../../src/stack/discovery/rss-discovery.js';

const BLOOM = ['github.com', 'youtube.com', 'wikipedia.org'];

describe('isBloomedDomain', () => {
  it('matches exact domain', () => {
    expect(isBloomedDomain('github.com', BLOOM)).toBe(true);
  });
  it('matches subdomains', () => {
    expect(isBloomedDomain('en.wikipedia.org', BLOOM)).toBe(true);
  });
  it('does not match unrelated domains', () => {
    expect(isBloomedDomain('fabiensanglard.net', BLOOM)).toBe(false);
  });
});

describe('discoverRssFeed', () => {
  it('finds <link rel=alternate type=application/rss+xml>', async () => {
    const fetcher: WebFetcher = vi.fn(async (url: string) => {
      if (url === 'https://example.com/') {
        return { ok: true, text: async () => `
          <html><head>
            <link rel="alternate" type="application/rss+xml" href="/feed.xml">
          </head></html>` };
      }
      return { ok: true, text: async () => '<rss><channel><title>x</title></channel></rss>' };
    });
    const out = await discoverRssFeed('example.com', fetcher);
    expect(out).toBe('https://example.com/feed.xml');
  });

  it('falls back to probing common paths', async () => {
    const calls: string[] = [];
    const fetcher: WebFetcher = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === 'https://example.com/') return { ok: true, text: async () => '<html></html>' };
      if (url === 'https://example.com/feed') return { ok: false, text: async () => '' };
      if (url === 'https://example.com/rss') return { ok: false, text: async () => '' };
      if (url === 'https://example.com/rss.xml') return { ok: true, text: async () => '<rss><channel><title>ok</title></channel></rss>' };
      return { ok: false, text: async () => '' };
    });
    const out = await discoverRssFeed('example.com', fetcher);
    expect(out).toBe('https://example.com/rss.xml');
  });

  it('returns null when nothing parses as RSS/Atom', async () => {
    const fetcher: WebFetcher = vi.fn(async () => ({ ok: true, text: async () => '<html></html>' }));
    const out = await discoverRssFeed('example.com', fetcher);
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/stack/discovery/rss-discovery.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement rss-discovery.ts**

```ts
// src/stack/discovery/rss-discovery.ts
import * as cheerio from 'cheerio';

export type WebFetcher = (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;

const COMMON_PATHS = [
  '/feed', '/rss', '/rss.xml', '/atom.xml',
  '/index.xml', '/feed.xml', '/blog/feed', '/blog/rss',
];

export function isBloomedDomain(domain: string, bloom: string[]): boolean {
  const d = domain.toLowerCase();
  return bloom.some(b => d === b || d.endsWith('.' + b));
}

function looksLikeFeed(body: string): boolean {
  return /<rss[\s>]|<feed[\s>]/.test(body);
}

export async function discoverRssFeed(domain: string, fetcher: WebFetcher): Promise<string | null> {
  const home = `https://${domain}/`;
  let homeRes;
  try { homeRes = await fetcher(home); } catch { return null; }
  if (homeRes.ok) {
    const html = await homeRes.text();
    const $ = cheerio.load(html);
    const link = $('link[rel="alternate"]').filter((_, el) => {
      const t = ($(el).attr('type') || '').toLowerCase();
      return t === 'application/rss+xml' || t === 'application/atom+xml';
    }).first().attr('href');
    if (link) {
      const abs = link.startsWith('http') ? link : new URL(link, home).toString();
      try {
        const r = await fetcher(abs);
        if (r.ok && looksLikeFeed(await r.text())) return abs;
      } catch { /* fall through */ }
    }
  }
  for (const p of COMMON_PATHS) {
    const u = `https://${domain}${p}`;
    try {
      const r = await fetcher(u);
      if (r.ok && looksLikeFeed(await r.text())) return u;
    } catch { /* keep probing */ }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/stack/discovery/rss-discovery.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stack/discovery/rss-discovery.ts tests/stack/discovery/rss-discovery.test.ts
git commit -m "feat(stack): add RSS auto-discovery + domain bloomlist"
```

---

### Task 5: Discovery algorithm registry

**Files:**
- Create: `src/stack/discovery/registry.ts`
- Create: `tests/stack/discovery/registry.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/stack/discovery/registry.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  buildRegistry,
  registerEnabledOn,
  type DiscoveryAlgorithm,
  type DiscoveryContext,
} from '../../../src/stack/discovery/registry.js';

const fakeCtx = {} as DiscoveryContext;

const algoA: DiscoveryAlgorithm = {
  name: 'a', role: 'core',
  run: vi.fn(async () => []),
};
const algoB: DiscoveryAlgorithm = {
  name: 'b', role: 'supplement',
  run: vi.fn(async () => []),
};

describe('discovery registry', () => {
  it('looks up algorithms by name', () => {
    const reg = buildRegistry([algoA, algoB]);
    expect(reg.get('a')).toBe(algoA);
    expect(reg.get('missing')).toBeUndefined();
  });

  it('registers only enabled, known algorithms with the scheduler', () => {
    const reg = buildRegistry([algoA, algoB]);
    const addCron = vi.fn();
    const scheduler = { addCron } as any;
    registerEnabledOn(scheduler, reg, [
      { name: 'a', enabled: true,  schedule: '0 4 * * *' },
      { name: 'b', enabled: false, schedule: '0 5 * * *' },
      { name: 'unknown', enabled: true, schedule: '0 6 * * *' },
    ], fakeCtx);
    expect(addCron).toHaveBeenCalledTimes(1);
    expect(addCron).toHaveBeenCalledWith('discovery-a', '0 4 * * *', expect.any(Function));
  });

  it('passes the context to algorithm.run when the cron fires', async () => {
    const reg = buildRegistry([algoA]);
    let captured: any = null;
    const scheduler = {
      addCron: (_id: string, _cron: string, fn: () => Promise<void>) => { captured = fn; },
    } as any;
    registerEnabledOn(scheduler, reg, [{ name: 'a', enabled: true, schedule: '0 4 * * *' }], fakeCtx);
    await captured();
    expect(algoA.run).toHaveBeenCalledWith(fakeCtx);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/stack/discovery/registry.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement registry.ts**

```ts
// src/stack/discovery/registry.ts
import type Database from 'better-sqlite3';
import type { DiscoveryAlgorithmConfig } from '../config.js';
import type { StackScheduler } from '../scheduler.js';

export interface CandidateSourceObservation {
  domain: string;
  origin_algorithm: string;
}

export interface DiscoveryContext {
  db: Database.Database;
  webFetch: (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;
  classify: (prompt: string) => Promise<boolean>;          // Qwen 3 4B yes/no
  search?: import('./search.js').SearxngClient;
  bloomlist: string[];
  occurrenceThreshold: number;
}

export interface DiscoveryAlgorithm {
  name: string;
  role: 'core' | 'supplement';
  run(ctx: DiscoveryContext): Promise<CandidateSourceObservation[]>;
}

export interface DiscoveryRegistry {
  get(name: string): DiscoveryAlgorithm | undefined;
  list(): DiscoveryAlgorithm[];
}

export function buildRegistry(algos: DiscoveryAlgorithm[]): DiscoveryRegistry {
  const m = new Map(algos.map(a => [a.name, a]));
  return { get: (n) => m.get(n), list: () => [...m.values()] };
}

export function registerEnabledOn(
  scheduler: StackScheduler,
  registry: DiscoveryRegistry,
  configs: DiscoveryAlgorithmConfig[],
  ctx: DiscoveryContext,
): void {
  for (const c of configs) {
    if (!c.enabled) continue;
    const algo = registry.get(c.name);
    if (!algo) continue;
    scheduler.addCron(`discovery-${c.name}`, c.schedule, async () => { await algo.run(ctx); });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/stack/discovery/registry.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stack/discovery/registry.ts tests/stack/discovery/registry.test.ts
git commit -m "feat(stack): add discovery algorithm registry interface"
```

---

### Task 6: generic_algorithm — domain mention observation + 4-day refresh

**Files:**
- Create: `src/stack/discovery/mentions.ts`
- Create: `src/stack/discovery/algorithms/generic.ts`
- Create: `tests/stack/discovery/mentions.test.ts`
- Create: `tests/stack/discovery/algorithms/generic.test.ts`
- Modify: `src/stack/db.ts` (add candidate + mention queries)
- Modify: `tests/stack/db.test.ts` (cover new queries)

- [ ] **Step 1: Write failing tests for new db queries**

```ts
// Append to tests/stack/db.test.ts
import {
  insertDomainMention,
  recentDomainMentions,
  upsertCandidateSource,
  getCandidateSource,
  listActiveSourceDomains,
  markSourceStaleness,
  getSourceStat,
} from '../../src/stack/db.js';

describe('discovery db queries', () => {
  let db2: Database.Database;
  beforeEach(() => {
    db2 = new Database(':memory:');
    applyStackSchema(db2);
  });

  it('inserts and reads back recent domain mentions', () => {
    insertDomainMention(db2, { domain: 'example.com', source: 'hn', observedAt: '2026-04-28T00:00:00Z' });
    insertDomainMention(db2, { domain: 'example.com', source: 'lobsters', observedAt: '2026-04-29T00:00:00Z' });
    const out = recentDomainMentions(db2, '2026-04-01T00:00:00Z');
    expect(out.find(r => r.domain === 'example.com')!.recent_mentions).toBe(2);
    expect(out.find(r => r.domain === 'example.com')!.distinct_source_count).toBe(2);
  });

  it('upserts candidate source and bumps occurrence_count', () => {
    upsertCandidateSource(db2, { domain: 'x.com', origin_algorithm: 'scout_A_hn_comments', firstObservedAt: '2026-04-28T00:00:00Z' });
    upsertCandidateSource(db2, { domain: 'x.com', origin_algorithm: 'scout_A_hn_comments', firstObservedAt: '2026-04-29T00:00:00Z' });
    const c = getCandidateSource(db2, 'x.com')!;
    expect(c.occurrence_count).toBe(2);
    expect(c.status).toBe('observed');
  });

  it('marks source staleness in stack_source_stats', () => {
    markSourceStaleness(db2, 'hn', 'going_stale', '2026-04-28T00:00:00Z');
    expect(getSourceStat(db2, 'hn')!.staleness).toBe('going_stale');
  });
});
```

You'll also need to add a `staleness TEXT` column to `stack_source_stats` since Plan 1 didn't include it. Patch the schema:

- [ ] **Step 2: Patch SCHEMA_SQL in src/stack/db.ts**

In `SCHEMA_SQL`, replace the `stack_source_stats` block with:

```sql
CREATE TABLE IF NOT EXISTS stack_source_stats (
  source TEXT PRIMARY KEY,
  drop_count INTEGER NOT NULL DEFAULT 0,
  rated_count INTEGER NOT NULL DEFAULT 0,
  avg_rating REAL,
  staleness TEXT,
  recent_mention_score REAL,
  updated_at TEXT NOT NULL
);
```

The two new columns are nullable so existing tables aren't disrupted. For an existing DB, also add an idempotent `ALTER TABLE` block right after the `CREATE TABLE` statements:

```sql
-- Idempotent column adds for forward-compat with Plan 1 deployments.
-- (SQLite ignores duplicate ALTERs only if wrapped in pragma_table_info checks at runtime;
-- here we rely on the host migrating fresh, so the additions land via the CREATE above.)
```

For an actually existing database from Plan 1, add this small migration in `applyStackSchema`:

```ts
export function applyStackSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
  // Forward-compat: add Plan 2 columns if missing.
  const cols = db.prepare("PRAGMA table_info(stack_source_stats)").all() as { name: string }[];
  const have = new Set(cols.map(c => c.name));
  if (!have.has('staleness')) db.exec('ALTER TABLE stack_source_stats ADD COLUMN staleness TEXT');
  if (!have.has('recent_mention_score')) db.exec('ALTER TABLE stack_source_stats ADD COLUMN recent_mention_score REAL');
}
```

- [ ] **Step 3: Add the new db.ts query helpers**

Append to `src/stack/db.ts`:

```ts
export interface DomainMentionInsert { domain: string; source: string; observedAt: string; }
export function insertDomainMention(db: Database.Database, m: DomainMentionInsert): void {
  db.prepare(`INSERT INTO stack_domain_mentions (domain, source, observed_at)
              VALUES (@domain, @source, @observedAt)`).run(m);
}

export interface DomainMentionAggregate {
  domain: string;
  recent_mentions: number;
  distinct_source_count: number;
}
export function recentDomainMentions(db: Database.Database, sinceIso: string): DomainMentionAggregate[] {
  return db.prepare(`
    SELECT domain,
           COUNT(*) AS recent_mentions,
           COUNT(DISTINCT source) AS distinct_source_count
    FROM stack_domain_mentions
    WHERE observed_at >= ?
    GROUP BY domain
  `).all(sinceIso) as DomainMentionAggregate[];
}

export interface CandidateUpsert { domain: string; origin_algorithm: string; firstObservedAt: string; }
export function upsertCandidateSource(db: Database.Database, c: CandidateUpsert): void {
  db.prepare(`
    INSERT INTO stack_candidate_sources (domain, origin_algorithm, first_observed_at, occurrence_count, status)
    VALUES (@domain, @origin_algorithm, @firstObservedAt, 1, 'observed')
    ON CONFLICT(domain) DO UPDATE SET occurrence_count = occurrence_count + 1
  `).run(c);
}

export interface CandidateSource {
  domain: string;
  origin_algorithm: string;
  first_observed_at: string;
  occurrence_count: number;
  rss_url: string | null;
  status: 'observed'|'probe_failed'|'candidate'|'promoted'|'archived';
  trial_drops_sent: number;
  trial_avg_rating: number | null;
  last_probed_at: string | null;
  promoted_at: string | null;
}
export function getCandidateSource(db: Database.Database, domain: string): CandidateSource | undefined {
  return db.prepare('SELECT * FROM stack_candidate_sources WHERE domain = ?').get(domain) as CandidateSource | undefined;
}

export function setCandidateRssAndStatus(
  db: Database.Database, domain: string, rss_url: string | null,
  status: CandidateSource['status'], probedAt: string,
): void {
  db.prepare(`UPDATE stack_candidate_sources
              SET rss_url = ?, status = ?, last_probed_at = ?
              WHERE domain = ?`).run(rss_url, status, probedAt, domain);
}

export function listCandidatesByStatus(db: Database.Database, status: CandidateSource['status']): CandidateSource[] {
  return db.prepare('SELECT * FROM stack_candidate_sources WHERE status = ? ORDER BY first_observed_at ASC')
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
export function getSourceStat(db: Database.Database, source: string): SourceStat | undefined {
  return db.prepare('SELECT * FROM stack_source_stats WHERE source = ?').get(source) as SourceStat | undefined;
}

export function markSourceStaleness(
  db: Database.Database, source: string, staleness: 'fresh'|'going_stale'|null, atIso: string,
): void {
  db.prepare(`
    INSERT INTO stack_source_stats (source, staleness, updated_at)
    VALUES (@source, @staleness, @at)
    ON CONFLICT(source) DO UPDATE SET staleness = @staleness, updated_at = @at
  `).run({ source, staleness, at: atIso });
}

export function setRecentMentionScore(
  db: Database.Database, source: string, score: number, atIso: string,
): void {
  db.prepare(`
    INSERT INTO stack_source_stats (source, recent_mention_score, updated_at)
    VALUES (@source, @score, @at)
    ON CONFLICT(source) DO UPDATE SET recent_mention_score = @score, updated_at = @at
  `).run({ source, score, at: atIso });
}

export function listActiveSourceDomains(db: Database.Database): string[] {
  // Active sources = anything in stack_source_stats. Plan 1 sources also live here once they produce drops.
  // For Tier 1 / Tier 2 distinction the sampler queries stack_candidate_sources separately.
  return (db.prepare('SELECT source FROM stack_source_stats').all() as { source: string }[]).map(r => r.source);
}
```

- [ ] **Step 4: Write the mentions observer test**

```ts
// tests/stack/discovery/mentions.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyStackSchema, recentDomainMentions } from '../../../src/stack/db.js';
import { observeMentions } from '../../../src/stack/discovery/mentions.js';
import type { RawItem } from '../../../src/stack/types.js';

describe('observeMentions', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyStackSchema(db); });

  it('records (domain, source) pairs from RawItem urls and inline blurb links', () => {
    const items: RawItem[] = [
      { source: 'hn', title: 't1', url: 'https://fabiensanglard.net/post', fetchedAt: '2026-04-28T00:00:00Z',
        blurb: 'See also <a href="https://danluu.com/x">danluu</a>' },
      { source: 'lobsters', title: 't2', url: 'https://fabiensanglard.net/other', fetchedAt: '2026-04-28T00:00:00Z' },
    ] as any;
    observeMentions(db, items, ['github.com'], '2026-04-28T00:00:00Z');
    const agg = recentDomainMentions(db, '2026-04-01T00:00:00Z');
    const fab = agg.find(r => r.domain === 'fabiensanglard.net')!;
    expect(fab.recent_mentions).toBe(2);
    expect(fab.distinct_source_count).toBe(2);
    expect(agg.find(r => r.domain === 'danluu.com')!.recent_mentions).toBe(1);
  });

  it('skips bloomlist domains', () => {
    const items: RawItem[] = [
      { source: 'hn', title: 't', url: 'https://github.com/foo/bar', fetchedAt: '2026-04-28T00:00:00Z' },
    ] as any;
    observeMentions(db, items, ['github.com'], '2026-04-28T00:00:00Z');
    expect(recentDomainMentions(db, '2026-04-01T00:00:00Z')).toEqual([]);
  });
});
```

- [ ] **Step 5: Implement mentions.ts**

```ts
// src/stack/discovery/mentions.ts
import type Database from 'better-sqlite3';
import type { RawItem } from '../types.js';
import { insertDomainMention } from '../db.js';
import { isBloomedDomain } from './rss-discovery.js';

const URL_RE = /https?:\/\/[^\s"'<>]+/gi;

function domainOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}

export function observeMentions(
  db: Database.Database,
  items: RawItem[],
  bloomlist: string[],
  observedAt: string,
): void {
  for (const item of items) {
    const seen = new Set<string>();
    const direct = domainOf(item.url);
    if (direct && !isBloomedDomain(direct, bloomlist)) {
      insertDomainMention(db, { domain: direct, source: item.source, observedAt });
      seen.add(direct);
    }
    const blurb = (item as any).blurb as string | undefined;
    if (blurb) {
      for (const m of blurb.matchAll(URL_RE)) {
        const d = domainOf(m[0]);
        if (!d || seen.has(d) || isBloomedDomain(d, bloomlist)) continue;
        insertDomainMention(db, { domain: d, source: item.source, observedAt });
        seen.add(d);
      }
    }
  }
}
```

- [ ] **Step 6: Write the generic_algorithm test**

```ts
// tests/stack/discovery/algorithms/generic.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyStackSchema, insertDomainMention, getCandidateSource, getSourceStat } from '../../../../src/stack/db.js';
import { genericAlgorithm } from '../../../../src/stack/discovery/algorithms/generic.js';
import type { DiscoveryContext } from '../../../../src/stack/discovery/registry.js';

const NOW = '2026-04-28T04:00:00Z';
const since = (d: number) => new Date(Date.parse(NOW) - d * 86400000).toISOString();

function ctxFor(db: Database.Database, opts: Partial<DiscoveryContext> = {}): DiscoveryContext {
  return {
    db,
    webFetch: async () => ({ ok: true, text: async () => '<html></html>' }),
    classify: async () => true,
    bloomlist: ['github.com'],
    occurrenceThreshold: 3,
    ...opts,
  } as DiscoveryContext;
}

function seedActiveSource(db: Database.Database, source: string) {
  db.prepare(`INSERT INTO stack_source_stats (source, drop_count, rated_count, updated_at)
              VALUES (?, 1, 1, ?)`).run(source, NOW);
}

describe('generic_algorithm', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyStackSchema(db); });

  it('updates recent_mention_score for active sources', async () => {
    seedActiveSource(db, 'fabiensanglard.net');
    for (let i = 0; i < 4; i++) {
      insertDomainMention(db, { domain: 'fabiensanglard.net', source: 'hn', observedAt: since(i + 1) });
    }
    await genericAlgorithm.run(ctxFor(db, { now: () => new Date(NOW) } as any));
    expect(getSourceStat(db, 'fabiensanglard.net')!.recent_mention_score).toBeGreaterThan(0);
  });

  it('promotes a non-active domain to candidate when it crosses thresholds and RSS is found', async () => {
    for (let i = 0; i < 6; i++) insertDomainMention(db, { domain: 'newblog.dev', source: 'hn', observedAt: since(i) });
    insertDomainMention(db, { domain: 'newblog.dev', source: 'lobsters', observedAt: since(1) });
    const fetcher = vi.fn(async (url: string) => {
      if (url === 'https://newblog.dev/') return { ok: true, text: async () => `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>` };
      if (url === 'https://newblog.dev/feed.xml') return { ok: true, text: async () => '<rss><channel><title>x</title></channel></rss>' };
      return { ok: false, text: async () => '' };
    });
    await genericAlgorithm.run(ctxFor(db, { webFetch: fetcher as any, now: () => new Date(NOW) } as any));
    const c = getCandidateSource(db, 'newblog.dev')!;
    expect(c.status).toBe('candidate');
    expect(c.rss_url).toBe('https://newblog.dev/feed.xml');
    expect(c.origin_algorithm).toBe('generic_algorithm');
  });

  it('marks active sources with zero mentions in window as going_stale', async () => {
    seedActiveSource(db, 'quietblog.io');
    await genericAlgorithm.run(ctxFor(db, { now: () => new Date(NOW) } as any));
    expect(getSourceStat(db, 'quietblog.io')!.staleness).toBe('going_stale');
  });
});
```

- [ ] **Step 7: Implement algorithms/generic.ts**

```ts
// src/stack/discovery/algorithms/generic.ts
import type {
  DiscoveryAlgorithm, DiscoveryContext, CandidateSourceObservation,
} from '../registry.js';
import {
  recentDomainMentions, listActiveSourceDomains,
  setRecentMentionScore, markSourceStaleness,
  getCandidateSource, upsertCandidateSource, setCandidateRssAndStatus,
} from '../../db.js';
import { discoverRssFeed, isBloomedDomain } from '../rss-discovery.js';

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_MIN_MENTIONS = 5;
const DEFAULT_MIN_DISTINCT = 2;

interface Options {
  windowDays?: number;
  minRecentMentions?: number;
  minDistinctSources?: number;
  now?: () => Date;
}

export const genericAlgorithm: DiscoveryAlgorithm & { run: (ctx: DiscoveryContext, opts?: Options) => Promise<CandidateSourceObservation[]> } = {
  name: 'generic_algorithm',
  role: 'core',
  async run(ctx, opts: Options = {}) {
    const now = (opts.now ?? (() => new Date()))();
    const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
    const sinceIso = new Date(now.getTime() - windowDays * 86400000).toISOString();
    const nowIso = now.toISOString();

    const aggregates = recentDomainMentions(ctx.db, sinceIso);
    const aggByDomain = new Map(aggregates.map(a => [a.domain, a]));
    const active = new Set(listActiveSourceDomains(ctx.db));

    const observed: CandidateSourceObservation[] = [];

    // Active sources: refresh recent_mention_score and staleness flag.
    for (const source of active) {
      const a = aggByDomain.get(source);
      if (a && a.recent_mentions > 0) {
        const score = Math.min(1, a.recent_mentions / 10);
        setRecentMentionScore(ctx.db, source, score, nowIso);
        markSourceStaleness(ctx.db, source, 'fresh', nowIso);
      } else {
        markSourceStaleness(ctx.db, source, 'going_stale', nowIso);
      }
    }

    // Non-active candidates: promote to `candidate` if thresholds met and RSS found.
    const minMentions = opts.minRecentMentions ?? DEFAULT_MIN_MENTIONS;
    const minDistinct = opts.minDistinctSources ?? DEFAULT_MIN_DISTINCT;
    for (const a of aggregates) {
      if (active.has(a.domain)) continue;
      if (isBloomedDomain(a.domain, ctx.bloomlist)) continue;
      const existing = getCandidateSource(ctx.db, a.domain);
      if (existing && existing.status !== 'observed') continue;
      if (a.recent_mentions < minMentions) continue;
      if (a.distinct_source_count < minDistinct) continue;
      upsertCandidateSource(ctx.db, {
        domain: a.domain,
        origin_algorithm: 'generic_algorithm',
        firstObservedAt: nowIso,
      });
      const rss = await discoverRssFeed(a.domain, ctx.webFetch);
      setCandidateRssAndStatus(ctx.db, a.domain, rss, rss ? 'candidate' : 'probe_failed', nowIso);
      observed.push({ domain: a.domain, origin_algorithm: 'generic_algorithm' });
    }

    return observed;
  },
};
```

- [ ] **Step 8: Run tests**

```
npx vitest run tests/stack/db.test.ts tests/stack/discovery/mentions.test.ts tests/stack/discovery/algorithms/generic.test.ts
```

Expected: PASS (existing + 3 mentions + 3 generic + new db tests).

- [ ] **Step 9: Commit**

```bash
git add src/stack/db.ts src/stack/discovery/mentions.ts \
        src/stack/discovery/algorithms/generic.ts \
        tests/stack/db.test.ts tests/stack/discovery/mentions.test.ts \
        tests/stack/discovery/algorithms/generic.test.ts
git commit -m "feat(stack): add domain mention observer and generic_algorithm refresh"
```

---

### Task 7: Scout A — HN comment URL mining

**Files:**
- Create: `src/stack/discovery/algorithms/scout-a-hn-comments.ts`
- Create: `tests/stack/discovery/algorithms/scout-a-hn-comments.test.ts`

The scout pulls HN comment threads for stories that produced rated-≥7 drops in the last 30 days, extracts outbound URLs, dedupes by domain, runs each candidate through the Qwen 3 4B classifier (`ctx.classify`), and bumps `occurrence_count` on `stack_candidate_sources`.

- [ ] **Step 1: Write failing test**

```ts
// tests/stack/discovery/algorithms/scout-a-hn-comments.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyStackSchema, getCandidateSource } from '../../../../src/stack/db.js';
import { scoutAHnComments } from '../../../../src/stack/discovery/algorithms/scout-a-hn-comments.js';
import type { DiscoveryContext } from '../../../../src/stack/discovery/registry.js';

function seedHighRated(db: Database.Database, dropId: string, sourceUrl: string, rating: number) {
  db.prepare(`INSERT INTO stack_queue
    (id,bucket,name,tagline,body_html,body_plain,source_url,source_fetched_at,tags_json,confidence,status,vault_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    dropId, 'tool', 'X', 't', '<p>x</p>', 'x', sourceUrl,
    '2026-04-20T00:00:00Z', '[]', 0.9, 'sent', 'p', '2026-04-20T00:00:00Z'
  );
  db.prepare(`INSERT INTO stack_ratings (drop_id, rating, rated_at) VALUES (?,?,?)`)
    .run(dropId, rating, '2026-04-21T00:00:00Z');
}

describe('scout_A_hn_comments', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyStackSchema(db); });

  it('mines outbound URLs from comment threads of high-rated HN stories and upserts candidates', async () => {
    seedHighRated(db, 'd1', 'https://news.ycombinator.com/item?id=4242', 8);
    const fetcher = vi.fn(async (url: string) => ({
      ok: true,
      text: async () => url.includes('item?id=4242')
        ? `<html><body>
             <a href="https://fabiensanglard.net/post">link</a>
             <a href="https://github.com/foo/bar">bloomed</a>
             <a href="https://danluu.com/x">link2</a>
           </body></html>`
        : '',
    }));
    const ctx = {
      db, webFetch: fetcher as any,
      classify: vi.fn(async () => true),
      bloomlist: ['github.com'],
      occurrenceThreshold: 3,
      now: () => new Date('2026-04-28T00:00:00Z'),
    } as unknown as DiscoveryContext;
    await scoutAHnComments.run(ctx);
    expect(getCandidateSource(db, 'fabiensanglard.net')!.occurrence_count).toBe(1);
    expect(getCandidateSource(db, 'danluu.com')!.occurrence_count).toBe(1);
    expect(getCandidateSource(db, 'github.com')).toBeUndefined();
    expect((ctx.classify as any).mock.calls.length).toBe(2);
  });

  it('does nothing when classifier rejects all candidates', async () => {
    seedHighRated(db, 'd1', 'https://news.ycombinator.com/item?id=42', 9);
    const ctx = {
      db,
      webFetch: vi.fn(async () => ({ ok: true, text: async () => '<a href="https://nope.example/">x</a>' })) as any,
      classify: vi.fn(async () => false),
      bloomlist: [],
      occurrenceThreshold: 3,
      now: () => new Date('2026-04-28T00:00:00Z'),
    } as unknown as DiscoveryContext;
    await scoutAHnComments.run(ctx);
    expect(getCandidateSource(db, 'nope.example')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/stack/discovery/algorithms/scout-a-hn-comments.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement scout-a-hn-comments.ts**

```ts
// src/stack/discovery/algorithms/scout-a-hn-comments.ts
import * as cheerio from 'cheerio';
import type { DiscoveryAlgorithm, DiscoveryContext, CandidateSourceObservation } from '../registry.js';
import { upsertCandidateSource } from '../../db.js';
import { isBloomedDomain } from '../rss-discovery.js';

const HN_ITEM_RE = /news\.ycombinator\.com\/item\?id=(\d+)/i;

interface Options { now?: () => Date; lookbackDays?: number; minRating?: number; }

function domainOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}

function highRatedHnStories(db: any, sinceIso: string, minRating: number): string[] {
  const rows = db.prepare(`
    SELECT DISTINCT q.source_url AS url
    FROM stack_queue q
    JOIN stack_ratings r ON r.drop_id = q.id
    WHERE r.rating >= ? AND r.rated_at >= ?
  `).all(minRating, sinceIso) as { url: string }[];
  return rows.map(r => r.url).filter(u => HN_ITEM_RE.test(u));
}

export const scoutAHnComments: DiscoveryAlgorithm & { run: (ctx: DiscoveryContext, opts?: Options) => Promise<CandidateSourceObservation[]> } = {
  name: 'scout_A_hn_comments',
  role: 'supplement',
  async run(ctx, opts: Options = {}) {
    const now = (opts.now ?? (() => new Date()))();
    const lookback = opts.lookbackDays ?? 30;
    const minRating = opts.minRating ?? 7;
    const sinceIso = new Date(now.getTime() - lookback * 86400000).toISOString();
    const nowIso = now.toISOString();

    const stories = highRatedHnStories(ctx.db, sinceIso, minRating);
    const observed: CandidateSourceObservation[] = [];

    for (const storyUrl of stories) {
      let res;
      try { res = await ctx.webFetch(storyUrl); } catch { continue; }
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);
      const candidates = new Map<string, string>(); // domain -> sample link
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (!/^https?:\/\//i.test(href)) return;
        const d = domainOf(href);
        if (!d) return;
        if (isBloomedDomain(d, ctx.bloomlist)) return;
        if (!candidates.has(d)) candidates.set(d, href);
      });
      for (const [domain, sample] of candidates) {
        const ok = await ctx.classify(`Domain: ${domain}\nSample link: ${sample}\n\nIs this a high-signal indie/tech blog or tool docs page? Answer yes or no.`);
        if (!ok) continue;
        upsertCandidateSource(ctx.db, { domain, origin_algorithm: 'scout_A_hn_comments', firstObservedAt: nowIso });
        observed.push({ domain, origin_algorithm: 'scout_A_hn_comments' });
      }
    }
    return observed;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/stack/discovery/algorithms/scout-a-hn-comments.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stack/discovery/algorithms/scout-a-hn-comments.ts tests/stack/discovery/algorithms/scout-a-hn-comments.test.ts
git commit -m "feat(stack): add scout_A_hn_comments URL miner"
```

---

### Task 8: Scout B — Lobsters comment URL mining

Same algorithm as Scout A, against Lobste.rs. Lobste.rs comment URLs look like `https://lobste.rs/s/<slug>`.

**Files:**
- Create: `src/stack/discovery/algorithms/scout-b-lobsters-comments.ts`
- Create: `tests/stack/discovery/algorithms/scout-b-lobsters-comments.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/stack/discovery/algorithms/scout-b-lobsters-comments.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyStackSchema, getCandidateSource } from '../../../../src/stack/db.js';
import { scoutBLobstersComments } from '../../../../src/stack/discovery/algorithms/scout-b-lobsters-comments.js';
import type { DiscoveryContext } from '../../../../src/stack/discovery/registry.js';

function seedHighRated(db: Database.Database, dropId: string, url: string, rating: number) {
  db.prepare(`INSERT INTO stack_queue
    (id,bucket,name,tagline,body_html,body_plain,source_url,source_fetched_at,tags_json,confidence,status,vault_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    dropId, 'tool', 'X', 't', '<p>x</p>', 'x', url, '2026-04-20T00:00:00Z',
    '[]', 0.9, 'sent', 'p', '2026-04-20T00:00:00Z'
  );
  db.prepare(`INSERT INTO stack_ratings (drop_id, rating, rated_at) VALUES (?,?,?)`)
    .run(dropId, rating, '2026-04-21T00:00:00Z');
}

describe('scout_B_lobsters_comments', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyStackSchema(db); });

  it('mines lobste.rs comment threads for outbound URLs', async () => {
    seedHighRated(db, 'd1', 'https://lobste.rs/s/abcdef/some_post', 8);
    const fetcher = vi.fn(async () => ({
      ok: true,
      text: async () => '<a href="https://drewdevault.com/blog">x</a><a href="https://reddit.com/r/foo">no</a>',
    }));
    const ctx = {
      db, webFetch: fetcher as any,
      classify: vi.fn(async () => true),
      bloomlist: ['reddit.com'],
      occurrenceThreshold: 3,
      now: () => new Date('2026-04-28T00:00:00Z'),
    } as unknown as DiscoveryContext;
    await scoutBLobstersComments.run(ctx);
    expect(getCandidateSource(db, 'drewdevault.com')!.occurrence_count).toBe(1);
    expect(getCandidateSource(db, 'reddit.com')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/stack/discovery/algorithms/scout-b-lobsters-comments.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement scout-b-lobsters-comments.ts**

Same shape as scout A; the only differences are the name, the URL regex, and the rating-to-source-URL filter.

```ts
// src/stack/discovery/algorithms/scout-b-lobsters-comments.ts
import * as cheerio from 'cheerio';
import type { DiscoveryAlgorithm, DiscoveryContext, CandidateSourceObservation } from '../registry.js';
import { upsertCandidateSource } from '../../db.js';
import { isBloomedDomain } from '../rss-discovery.js';

const LOBSTERS_RE = /\blobste\.rs\/s\//i;

interface Options { now?: () => Date; lookbackDays?: number; minRating?: number; }

function domainOf(u: string): string | null {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}

function highRatedLobstersStories(db: any, sinceIso: string, minRating: number): string[] {
  const rows = db.prepare(`
    SELECT DISTINCT q.source_url AS url
    FROM stack_queue q JOIN stack_ratings r ON r.drop_id = q.id
    WHERE r.rating >= ? AND r.rated_at >= ?`).all(minRating, sinceIso) as { url: string }[];
  return rows.map(r => r.url).filter(u => LOBSTERS_RE.test(u));
}

export const scoutBLobstersComments: DiscoveryAlgorithm & { run: (ctx: DiscoveryContext, opts?: Options) => Promise<CandidateSourceObservation[]> } = {
  name: 'scout_B_lobsters_comments',
  role: 'supplement',
  async run(ctx, opts: Options = {}) {
    const now = (opts.now ?? (() => new Date()))();
    const lookback = opts.lookbackDays ?? 30;
    const minRating = opts.minRating ?? 7;
    const sinceIso = new Date(now.getTime() - lookback * 86400000).toISOString();
    const nowIso = now.toISOString();
    const stories = highRatedLobstersStories(ctx.db, sinceIso, minRating);
    const observed: CandidateSourceObservation[] = [];
    for (const url of stories) {
      let res;
      try { res = await ctx.webFetch(url); } catch { continue; }
      if (!res.ok) continue;
      const $ = cheerio.load(await res.text());
      const candidates = new Map<string, string>();
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (!/^https?:\/\//i.test(href)) return;
        const d = domainOf(href);
        if (!d || isBloomedDomain(d, ctx.bloomlist)) return;
        if (!candidates.has(d)) candidates.set(d, href);
      });
      for (const [d, sample] of candidates) {
        const ok = await ctx.classify(`Domain: ${d}\nSample link: ${sample}\n\nIs this a high-signal indie/tech blog or tool docs page? Answer yes or no.`);
        if (!ok) continue;
        upsertCandidateSource(ctx.db, { domain: d, origin_algorithm: 'scout_B_lobsters_comments', firstObservedAt: nowIso });
        observed.push({ domain: d, origin_algorithm: 'scout_B_lobsters_comments' });
      }
    }
    return observed;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/stack/discovery/algorithms/scout-b-lobsters-comments.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stack/discovery/algorithms/scout-b-lobsters-comments.ts tests/stack/discovery/algorithms/scout-b-lobsters-comments.test.ts
git commit -m "feat(stack): add scout_B_lobsters_comments URL miner"
```

---

### Task 9: Scout E — SearXNG topic-driven search

**Files:**
- Create: `src/stack/discovery/algorithms/scout-e-searxng-topic.ts`
- Create: `tests/stack/discovery/algorithms/scout-e-searxng-topic.test.ts`

Reads the most-frequent tags from the user's high-rated drops over the last 60 days (tags live in `stack_queue.tags_json`), runs `"<topic> blog 2026"` and `"<topic> self-hosted tools"` queries through SearXNG, classifies each result via Qwen 3 4B, upserts candidates.

- [ ] **Step 1: Write failing test**

```ts
// tests/stack/discovery/algorithms/scout-e-searxng-topic.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyStackSchema, getCandidateSource } from '../../../../src/stack/db.js';
import { scoutESearxngTopic } from '../../../../src/stack/discovery/algorithms/scout-e-searxng-topic.js';
import { SearxngClient } from '../../../../src/stack/discovery/search.js';
import type { DiscoveryContext } from '../../../../src/stack/discovery/registry.js';

function seedHighRatedWithTags(db: Database.Database, dropId: string, tags: string[], rating: number) {
  db.prepare(`INSERT INTO stack_queue
    (id,bucket,name,tagline,body_html,body_plain,source_url,source_fetched_at,tags_json,confidence,status,vault_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    dropId, 'tool', 'X', 't', '<p>x</p>', 'x', 'https://x.com', '2026-04-20T00:00:00Z',
    JSON.stringify(tags), 0.9, 'sent', 'p', '2026-04-20T00:00:00Z'
  );
  db.prepare(`INSERT INTO stack_ratings (drop_id, rating, rated_at) VALUES (?,?,?)`)
    .run(dropId, rating, '2026-04-21T00:00:00Z');
}

describe('scout_E_searxng_topic', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyStackSchema(db); });

  it('queries SearXNG for top tags and upserts classified candidates', async () => {
    seedHighRatedWithTags(db, 'd1', ['homelab', 'rust'], 9);
    seedHighRatedWithTags(db, 'd2', ['homelab', 'caching'], 8);
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [{ url: 'https://homelabber.dev/post1', title: 't', content: 's' }],
      }),
    }));
    const search = new SearxngClient('https://searx.example', fetcher as any);
    const ctx = {
      db,
      webFetch: async () => ({ ok: true, text: async () => '' }),
      classify: vi.fn(async () => true),
      search,
      bloomlist: [],
      occurrenceThreshold: 3,
      now: () => new Date('2026-04-28T00:00:00Z'),
    } as unknown as DiscoveryContext;
    await scoutESearxngTopic.run(ctx, { maxTopics: 1, queryBudget: 2 });
    expect(getCandidateSource(db, 'homelabber.dev')!.occurrence_count).toBeGreaterThanOrEqual(1);
    // 2 query templates × 1 topic = 2 search calls = 2 fetcher calls (results de-duped per domain)
    expect((fetcher as any).mock.calls.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/stack/discovery/algorithms/scout-e-searxng-topic.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement scout-e-searxng-topic.ts**

```ts
// src/stack/discovery/algorithms/scout-e-searxng-topic.ts
import type { DiscoveryAlgorithm, DiscoveryContext, CandidateSourceObservation } from '../registry.js';
import { upsertCandidateSource } from '../../db.js';
import { isBloomedDomain } from '../rss-discovery.js';

const QUERY_TEMPLATES = ['{} blog 2026', '{} self-hosted tools'];

interface Options { now?: () => Date; lookbackDays?: number; maxTopics?: number; queryBudget?: number; minRating?: number; }

function domainOf(u: string): string | null {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}

function topRatedTags(db: any, sinceIso: string, minRating: number, limit: number): string[] {
  const rows = db.prepare(`
    SELECT q.tags_json AS tags
    FROM stack_queue q JOIN stack_ratings r ON r.drop_id = q.id
    WHERE r.rating >= ? AND r.rated_at >= ?`).all(minRating, sinceIso) as { tags: string }[];
  const counts = new Map<string, number>();
  for (const r of rows) {
    let arr: string[] = [];
    try { arr = JSON.parse(r.tags || '[]'); } catch { /* skip */ }
    for (const t of arr) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
}

export const scoutESearxngTopic: DiscoveryAlgorithm & { run: (ctx: DiscoveryContext, opts?: Options) => Promise<CandidateSourceObservation[]> } = {
  name: 'scout_E_searxng_topic',
  role: 'supplement',
  async run(ctx, opts: Options = {}) {
    if (!ctx.search) return [];
    const now = (opts.now ?? (() => new Date()))();
    const lookback = opts.lookbackDays ?? 60;
    const minRating = opts.minRating ?? 7;
    const maxTopics = opts.maxTopics ?? 5;
    const queryBudget = opts.queryBudget ?? 50;
    const sinceIso = new Date(now.getTime() - lookback * 86400000).toISOString();
    const nowIso = now.toISOString();

    const topics = topRatedTags(ctx.db, sinceIso, minRating, maxTopics);
    const observed: CandidateSourceObservation[] = [];
    let queries = 0;

    for (const topic of topics) {
      for (const tmpl of QUERY_TEMPLATES) {
        if (queries >= queryBudget) break;
        const q = tmpl.replace('{}', topic);
        let results;
        try { results = await ctx.search.search(q); } catch { results = []; }
        queries++;
        const seen = new Set<string>();
        for (const r of results) {
          const d = domainOf(r.url);
          if (!d || seen.has(d)) continue;
          if (isBloomedDomain(d, ctx.bloomlist)) continue;
          seen.add(d);
          const ok = await ctx.classify(`Topic: ${topic}\nURL: ${r.url}\nSnippet: ${r.snippet}\n\nIs this a tech/builder blog post that would interest someone studying ${topic}? Answer yes or no.`);
          if (!ok) continue;
          upsertCandidateSource(ctx.db, { domain: d, origin_algorithm: 'scout_E_searxng_topic', firstObservedAt: nowIso });
          observed.push({ domain: d, origin_algorithm: 'scout_E_searxng_topic' });
        }
      }
    }
    return observed;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/stack/discovery/algorithms/scout-e-searxng-topic.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stack/discovery/algorithms/scout-e-searxng-topic.ts tests/stack/discovery/algorithms/scout-e-searxng-topic.test.ts
git commit -m "feat(stack): add scout_E_searxng_topic search-driven scout"
```

---

### Task 10: Promotion / demotion job

**Files:**
- Create: `src/stack/discovery/promote.ts`
- Create: `tests/stack/discovery/promote.test.ts`

Daily job: for each candidate with status `candidate`, count trial drops sent in the last 60 days and average their ratings. Promote when `trial_drops_sent ≥ trialDropsCount && trial_avg_rating ≥ promotionMinAvgRating`. Archive when `trial_drops_sent ≥ trialDropsCount && trial_avg_rating <= archiveMaxAvgRating`. Demote a Tier 1 source whose 20-rating rolling avg drops below 3 (Tier 1/2 lives on `stack_candidate_sources.status` post-promotion).

- [ ] **Step 1: Write failing test**

```ts
// tests/stack/discovery/promote.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyStackSchema, getCandidateSource, listCandidatesByStatus } from '../../../src/stack/db.js';
import { runPromotionPass, type PromotionConfig } from '../../../src/stack/discovery/promote.js';

const CONFIG: PromotionConfig = {
  trialDropsCount: 5,
  promotionMinAvgRating: 6,
  archiveMaxAvgRating: 4,
  trialWindowDays: 60,
  demotionMinRatedCount: 20,
  demotionAvgRatingThreshold: 3,
  now: () => new Date('2026-04-28T00:00:00Z'),
};

function seedCandidate(db: Database.Database, domain: string, status: 'candidate'|'promoted', trialDropsSent = 0) {
  db.prepare(`INSERT INTO stack_candidate_sources
    (domain, origin_algorithm, first_observed_at, occurrence_count, status, trial_drops_sent)
    VALUES (?, 'scout_A_hn_comments', '2026-03-01T00:00:00Z', 5, ?, ?)`).run(domain, status, trialDropsSent);
}

function seedTrialRating(db: Database.Database, dropId: string, sourceUrl: string, rating: number, ratedAt: string) {
  db.prepare(`INSERT INTO stack_queue
    (id,bucket,name,tagline,body_html,body_plain,source_url,source_fetched_at,tags_json,confidence,status,vault_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    dropId, 'tool', 'X', 't', '<p>x</p>', 'x', sourceUrl, '2026-04-01T00:00:00Z',
    '[]', 0.9, 'sent', 'p', '2026-04-01T00:00:00Z'
  );
  db.prepare(`INSERT INTO stack_ratings (drop_id, rating, rated_at) VALUES (?,?,?)`).run(dropId, rating, ratedAt);
}

describe('runPromotionPass', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyStackSchema(db); });

  it('promotes a candidate with enough trial drops and high avg rating', () => {
    seedCandidate(db, 'rising.dev', 'candidate', 5);
    for (let i = 0; i < 5; i++) seedTrialRating(db, `d${i}`, 'https://rising.dev/x', 8, '2026-04-20T00:00:00Z');
    runPromotionPass(db, CONFIG);
    expect(getCandidateSource(db, 'rising.dev')!.status).toBe('promoted');
  });

  it('archives a candidate with enough trial drops and low avg rating', () => {
    seedCandidate(db, 'meh.dev', 'candidate', 5);
    for (let i = 0; i < 5; i++) seedTrialRating(db, `e${i}`, 'https://meh.dev/x', 3, '2026-04-20T00:00:00Z');
    runPromotionPass(db, CONFIG);
    expect(getCandidateSource(db, 'meh.dev')!.status).toBe('archived');
  });

  it('leaves a candidate alone before the trial period completes', () => {
    seedCandidate(db, 'newish.dev', 'candidate', 2);
    for (let i = 0; i < 2; i++) seedTrialRating(db, `f${i}`, 'https://newish.dev/x', 8, '2026-04-20T00:00:00Z');
    runPromotionPass(db, CONFIG);
    expect(getCandidateSource(db, 'newish.dev')!.status).toBe('candidate');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/stack/discovery/promote.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement promote.ts**

```ts
// src/stack/discovery/promote.ts
import type Database from 'better-sqlite3';
import { listCandidatesByStatus } from '../db.js';

export interface PromotionConfig {
  trialDropsCount: number;
  promotionMinAvgRating: number;
  archiveMaxAvgRating: number;
  trialWindowDays: number;
  demotionMinRatedCount: number;
  demotionAvgRatingThreshold: number;
  now?: () => Date;
}

interface TrialStats { count: number; avg: number | null; }

function trialStatsForDomain(db: Database.Database, domain: string, sinceIso: string): TrialStats {
  const row = db.prepare(`
    SELECT COUNT(r.rating) AS c, AVG(r.rating) AS a
    FROM stack_queue q JOIN stack_ratings r ON r.drop_id = q.id
    WHERE q.source_url LIKE ? AND r.rated_at >= ?`).get(`%${domain}%`, sinceIso) as { c: number; a: number | null };
  return { count: row?.c ?? 0, avg: row?.a ?? null };
}

function setStatus(db: Database.Database, domain: string, status: string, atIso: string): void {
  db.prepare(`UPDATE stack_candidate_sources SET status = ?, promoted_at = CASE WHEN ? = 'promoted' THEN ? ELSE promoted_at END
              WHERE domain = ?`).run(status, status, atIso, domain);
}

export function runPromotionPass(db: Database.Database, cfg: PromotionConfig): void {
  const now = (cfg.now ?? (() => new Date()))();
  const sinceIso = new Date(now.getTime() - cfg.trialWindowDays * 86400000).toISOString();
  const nowIso = now.toISOString();

  for (const c of listCandidatesByStatus(db, 'candidate')) {
    const s = trialStatsForDomain(db, c.domain, sinceIso);
    db.prepare(`UPDATE stack_candidate_sources SET trial_drops_sent = ?, trial_avg_rating = ? WHERE domain = ?`)
      .run(s.count, s.avg, c.domain);
    if (s.count < cfg.trialDropsCount) continue;
    if ((s.avg ?? 0) >= cfg.promotionMinAvgRating) setStatus(db, c.domain, 'promoted', nowIso);
    else if ((s.avg ?? 10) <= cfg.archiveMaxAvgRating) setStatus(db, c.domain, 'archived', nowIso);
  }

  // Demotion: promoted source whose rolling avg over last N rated drops drops below threshold.
  for (const c of listCandidatesByStatus(db, 'promoted')) {
    const row = db.prepare(`
      SELECT COUNT(r.rating) AS c, AVG(r.rating) AS a
      FROM stack_queue q JOIN stack_ratings r ON r.drop_id = q.id
      WHERE q.source_url LIKE ?`).get(`%${c.domain}%`) as { c: number; a: number };
    if ((row?.c ?? 0) >= cfg.demotionMinRatedCount && row.a < cfg.demotionAvgRatingThreshold) {
      setStatus(db, c.domain, 'archived', nowIso);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/stack/discovery/promote.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stack/discovery/promote.ts tests/stack/discovery/promote.test.ts
git commit -m "feat(stack): add promotion/demotion pass for candidate sources"
```

---

### Task 11: Stochastic source sampler

**Files:**
- Create: `src/stack/discovery/sampler.ts`
- Create: `tests/stack/discovery/sampler.test.ts`
- Modify: `src/stack/scrapers/index.ts` (consume sampler output instead of fixed list)
- Modify: `src/stack/index.ts` (pass sampler-selected sources into `runEnabledScrapers`)

The sampler computes per-source weight using the spec §2.2 formula and returns the list of sources to pull this cycle: all of Tier 1 (active sources in `stack_source_stats` plus promoted candidates) + a random `tier2SamplePercent` fraction of Tier 2 (status=`candidate` in `stack_candidate_sources`), with each source's pull probability subject to `min_sample_probability` floor.

For Plan 2 the "active list of named scrapers" still lives in `enabledScrapers`. The sampler operates on the union of `enabledScrapers` (Tier 1 — built-in named scrapers) and discovered candidate sources (Tier 2 — RSS-by-URL only). Discovered Tier 2 sources are added by feeding their `rss_url` into the existing generic RSS scraper.

- [ ] **Step 1: Write failing test**

```ts
// tests/stack/discovery/sampler.test.ts
import { describe, it, expect } from 'vitest';
import { sampleSources, type SampleableSource, type SampleConfig } from '../../../src/stack/discovery/sampler.js';

const cfg: SampleConfig = {
  minSampleProbability: 0.10,
  randomJitterMin: 0.7,
  randomJitterMax: 1.3,
  freshnessFactorActive: 1.0,
  freshnessFactorStale: 0.6,
  freshnessWindowDays: 7,
  tier2Multiplier: 0.3,
  tier2SamplePercent: 0.3,
  rng: () => 0.5,        // deterministic mid-jitter, deterministic Tier 2 selection
  now: () => new Date('2026-04-28T00:00:00Z'),
};

const t1 = (name: string, opts: Partial<SampleableSource> = {}): SampleableSource => ({
  name, tier: 1, baseWeight: 1.0, avgRating: 0.7, lastSeenIso: '2026-04-25T00:00:00Z', ...opts,
});

describe('sampleSources', () => {
  it('returns all Tier 1 sources (deterministic include)', () => {
    const out = sampleSources([t1('hn'), t1('lobsters'), t1('rss:simon')], cfg);
    expect(out.map(s => s.name).sort()).toEqual(['hn', 'lobsters', 'rss:simon']);
  });

  it('selects roughly tier2SamplePercent of Tier 2 sources', () => {
    const t2: SampleableSource[] = Array.from({ length: 20 }, (_, i) => ({
      name: `cand-${i}`, tier: 2, baseWeight: 1.0, avgRating: 0.5, lastSeenIso: '2026-04-25T00:00:00Z',
    }));
    const out = sampleSources([...t2], { ...cfg, rng: () => 0.2 }); // 0.2 < 0.3 → all included
    expect(out.length).toBe(20);
    const out2 = sampleSources([...t2], { ...cfg, rng: () => 0.9 }); // 0.9 > 0.3 → none included
    expect(out2.length).toBe(0);
  });

  it('boosts a fresh source above a stale one of equal base weight', () => {
    const fresh = t1('fresh', { lastSeenIso: '2026-04-27T00:00:00Z' });
    const stale = t1('stale', { lastSeenIso: '2026-03-01T00:00:00Z' });
    const out = sampleSources([fresh, stale], cfg);
    // Both Tier 1, so both included; weight ordering inspectable via the returned `weight` field.
    expect(out.find(s => s.name === 'fresh')!.weight).toBeGreaterThan(out.find(s => s.name === 'stale')!.weight);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/stack/discovery/sampler.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement sampler.ts**

```ts
// src/stack/discovery/sampler.ts
export interface SampleableSource {
  name: string;
  tier: 1 | 2;
  baseWeight: number;
  avgRating: number | null;     // 0..1 normalized; null → 0.5
  lastSeenIso: string | null;   // last time the source produced an item
}

export interface SampleConfig {
  minSampleProbability: number;
  randomJitterMin: number;
  randomJitterMax: number;
  freshnessFactorActive: number;
  freshnessFactorStale: number;
  freshnessWindowDays: number;
  tier2Multiplier: number;
  tier2SamplePercent: number;
  rng?: () => number;
  now?: () => Date;
}

export interface SampledSource extends SampleableSource { weight: number; }

function jitter(cfg: SampleConfig): number {
  const r = (cfg.rng ?? Math.random)();
  return cfg.randomJitterMin + (cfg.randomJitterMax - cfg.randomJitterMin) * r;
}

function freshnessFactor(s: SampleableSource, cfg: SampleConfig): number {
  if (!s.lastSeenIso) return cfg.freshnessFactorStale;
  const now = (cfg.now ?? (() => new Date()))().getTime();
  const last = Date.parse(s.lastSeenIso);
  return (now - last) <= cfg.freshnessWindowDays * 86400000 ? cfg.freshnessFactorActive : cfg.freshnessFactorStale;
}

function quality(s: SampleableSource): number {
  return s.avgRating ?? 0.5;
}

function weightOf(s: SampleableSource, cfg: SampleConfig): number {
  const tierMul = s.tier === 1 ? 1.0 : cfg.tier2Multiplier;
  return Math.max(cfg.minSampleProbability,
    s.baseWeight * quality(s) * freshnessFactor(s, cfg) * jitter(cfg) * tierMul);
}

export function sampleSources(all: SampleableSource[], cfg: SampleConfig): SampledSource[] {
  const rng = cfg.rng ?? Math.random;
  const selected: SampledSource[] = [];
  for (const s of all) {
    const w = weightOf(s, cfg);
    if (s.tier === 1) {
      selected.push({ ...s, weight: w });
    } else {
      // Tier 2: deterministic per-source draw vs tier2SamplePercent.
      if (rng() < cfg.tier2SamplePercent) selected.push({ ...s, weight: w });
    }
  }
  return selected;
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/stack/discovery/sampler.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Wire sampler into the scraper run**

The Plan 1 scraper-runner takes a fixed list `enabledScrapers`. To preserve test behavior while adding sampler support, expose a new entry point `runSampledScrapers` and keep `runEnabledScrapers` available for tests. Edit `src/stack/scrapers/index.ts`:

```ts
// Append to src/stack/scrapers/index.ts
import type { SampledSource } from '../discovery/sampler.js';

export async function runSampledScrapers(
  selected: SampledSource[],
  registry: ScraperRegistry,
  rssScraper: (url: string) => Promise<RawItem[]>,
): Promise<RawItem[]> {
  const all: RawItem[] = [];
  await Promise.all(selected.map(async (s) => {
    try {
      if (s.name.startsWith('rss:')) {
        const url = s.name.slice('rss:'.length);
        all.push(...await rssScraper(url));
      } else {
        const fn = registry[s.name];
        if (fn) all.push(...await fn());
      }
    } catch (e) {
      console.error(`[stack] scraper '${s.name}' failed:`, e);
    }
  }));
  return all;
}
```

If `runEnabledScrapers` is the existing entry (Plan 1), keep it; the new function operates alongside it.

- [ ] **Step 6: Run all stack tests**

```
npx vitest run tests/stack/
```

Expected: PASS — existing scraper tests untouched, new sampler tests green.

- [ ] **Step 7: Commit**

```bash
git add src/stack/discovery/sampler.ts src/stack/scrapers/index.ts tests/stack/discovery/sampler.test.ts
git commit -m "feat(stack): add stochastic source sampler + sampled scraper runner"
```

---

### Task 12: Wire discovery into initStack()

**Files:**
- Modify: `src/stack/index.ts`
- Modify: `tests/stack/smoke.test.ts` (extend with one wiring assertion if applicable; otherwise skip — Task 13's smoke covers it)

Plan 2 adds three new crons to `StackScheduler`:
- `stack-promote` — daily at 04:30 → `runPromotionPass(db, …)`
- discovery algorithms (4) — registered via `registerEnabledOn(scheduler, registry, cfg.discoveryAlgorithms, ctx)`

…and one in-line modification to the existing `stack-scrape` cron: after scraping, call `observeMentions(db, items, cfg.discovery.domainBloomlist, nowIso)` so generic_algorithm has data to refresh on.

- [ ] **Step 1: Update `src/stack/index.ts`**

Add imports near the top:

```ts
import { observeMentions } from './discovery/mentions.js';
import { runPromotionPass } from './discovery/promote.js';
import { buildRegistry, registerEnabledOn, type DiscoveryContext } from './discovery/registry.js';
import { genericAlgorithm } from './discovery/algorithms/generic.js';
import { scoutAHnComments } from './discovery/algorithms/scout-a-hn-comments.js';
import { scoutBLobstersComments } from './discovery/algorithms/scout-b-lobsters-comments.js';
import { scoutESearxngTopic } from './discovery/algorithms/scout-e-searxng-topic.js';
import { SearxngClient } from './discovery/search.js';
```

Inside `initStack({ db })`, after building `ollamaClient`:

```ts
// Build SearXNG client if configured
const searxng = cfg.search.provider === 'searxng'
  ? new SearxngClient(cfg.search.searxngInstance)
  : undefined;

// Build a Qwen 3 4B classifier closure for scouts
const classify = async (prompt: string): Promise<boolean> => {
  const out = await ollamaClient.complete(cfg.scoutClassifierModel, prompt);
  return /^\s*yes\b/i.test(out);
};

// Discovery context (shared by all algorithms)
const discoveryCtx: DiscoveryContext = {
  db,
  webFetch: async (url) => {
    const r = await fetch(url);
    return { ok: r.ok, text: () => r.text() };
  },
  classify,
  search: searxng,
  bloomlist: cfg.discovery.domainBloomlist,
  occurrenceThreshold: cfg.discovery.occurrenceThresholdForRssProbe,
};
const registry = buildRegistry([genericAlgorithm, scoutAHnComments, scoutBLobstersComments, scoutESearxngTopic]);
```

Inside the existing `stack-scrape` cron, after the `for (const g of graded)` loop and before the `ensureMinFoundationsInQueue` call, add:

```ts
observeMentions(db, items, cfg.discovery.domainBloomlist, new Date().toISOString());
```

After the scheduler is built but before `scheduler.start()`, register the new crons:

```ts
// Daily 04:30: promotion / demotion pass
scheduler.addCron('stack-promote', '30 4 * * *', async () => {
  runPromotionPass(db, {
    trialDropsCount: cfg.discovery.trialDropsCount,
    promotionMinAvgRating: cfg.discovery.promotionMinAvgRating,
    archiveMaxAvgRating: cfg.discovery.archiveMaxAvgRating,
    trialWindowDays: 60,
    demotionMinRatedCount: 20,
    demotionAvgRatingThreshold: 3,
  });
});

// Discovery algorithms (one cron per enabled entry)
registerEnabledOn(scheduler, registry, cfg.discoveryAlgorithms, discoveryCtx);
```

Note: the `OllamaClient.complete` shape (`(model, prompt) => Promise<string>`) used above must already exist on the Plan 1 `OllamaClient`. If it does not, add the convenience wrapper:

```ts
// In src/stack/ollama.ts, append on the OllamaClient class if missing:
async complete(model: string, prompt: string): Promise<string> {
  const r = await fetch(`${this.host}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  const j = await r.json() as { response?: string };
  return j.response ?? '';
}
```

- [ ] **Step 2: Build and run all tests**

```
npm run build
npx vitest run
```

Expected: TypeScript compiles; all unit tests green.

- [ ] **Step 3: Commit**

```bash
git add src/stack/index.ts src/stack/ollama.ts
git commit -m "feat(stack): wire discovery algorithms + promotion + mention observer into scheduler"
```

---

### Task 13: End-to-end discovery smoke test

**Files:**
- Create: `scripts/stack-discovery-smoke.ts`
- Modify: `tests/stack/smoke.test.ts` (add one new integration test using `:memory:` DB and stubbed network)

The smoke covers the discovery round-trip without hitting real services: seed `stack_queue` with rated drops → run `observeMentions` on synthetic `RawItem`s → run `genericAlgorithm` → assert candidate appears with the right RSS URL.

- [ ] **Step 1: Add the integration test**

```ts
// Append to tests/stack/smoke.test.ts (after existing imports / describes)
import { observeMentions } from '../../src/stack/discovery/mentions.js';
import { genericAlgorithm } from '../../src/stack/discovery/algorithms/generic.js';
import { runPromotionPass } from '../../src/stack/discovery/promote.js';
import { getCandidateSource, applyStackSchema as _applyStackSchema } from '../../src/stack/db.js';
import Database from 'better-sqlite3';

describe('stack discovery integration', () => {
  it('observes mentions, surfaces candidate, then promotes after trial passes', async () => {
    const db = new Database(':memory:');
    _applyStackSchema(db);
    const NOW = '2026-04-28T00:00:00Z';

    const items: any[] = [
      { source: 'hn', title: 't1', url: 'https://newgem.dev/post-a', fetchedAt: NOW },
      { source: 'hn', title: 't2', url: 'https://newgem.dev/post-b', fetchedAt: NOW },
      { source: 'lobsters', title: 't3', url: 'https://newgem.dev/post-c', fetchedAt: NOW },
      { source: 'lobsters', title: 't4', url: 'https://newgem.dev/post-d', fetchedAt: NOW },
      { source: 'rss:simon', title: 't5', url: 'https://newgem.dev/post-e', fetchedAt: NOW },
    ];
    observeMentions(db, items, ['github.com'], NOW);

    const ctx: any = {
      db,
      webFetch: async (url: string) => {
        if (url === 'https://newgem.dev/') return { ok: true, text: async () => `<link rel="alternate" type="application/rss+xml" href="/feed.xml">` };
        if (url === 'https://newgem.dev/feed.xml') return { ok: true, text: async () => '<rss><channel><title>x</title></channel></rss>' };
        return { ok: false, text: async () => '' };
      },
      classify: async () => true,
      bloomlist: ['github.com'],
      occurrenceThreshold: 3,
      now: () => new Date(NOW),
    };
    await genericAlgorithm.run(ctx);
    expect(getCandidateSource(db, 'newgem.dev')!.status).toBe('candidate');

    // Simulate trial drops + ratings, then run promotion.
    for (let i = 0; i < 5; i++) {
      db.prepare(`INSERT INTO stack_queue
        (id,bucket,name,tagline,body_html,body_plain,source_url,source_fetched_at,tags_json,confidence,status,vault_path,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        `t${i}`, 'tool', 'X', 't', '<p>x</p>', 'x', `https://newgem.dev/p${i}`, NOW,
        '[]', 0.9, 'sent', 'p', NOW
      );
      db.prepare(`INSERT INTO stack_ratings (drop_id, rating, rated_at) VALUES (?,?,?)`).run(`t${i}`, 8, NOW);
    }
    runPromotionPass(db, {
      trialDropsCount: 5, promotionMinAvgRating: 6, archiveMaxAvgRating: 4,
      trialWindowDays: 60, demotionMinRatedCount: 20, demotionAvgRatingThreshold: 3,
      now: () => new Date(NOW),
    });
    expect(getCandidateSource(db, 'newgem.dev')!.status).toBe('promoted');
  });
});
```

- [ ] **Step 2: Run the integration test**

```
npx vitest run tests/stack/smoke.test.ts
```

Expected: PASS — existing smoke + new discovery integration.

- [ ] **Step 3: Add the live smoke script (manual run, not part of test suite)**

```ts
// scripts/stack-discovery-smoke.ts
// Live smoke: real Ollama (qwen3:4b classifier) + real network fetch + real SearXNG.
// Does NOT use Gmail. Side effects: writes to a tmp SQLite DB.
//
// Usage: SEARXNG_INSTANCE=https://your.searx.instance npx tsx scripts/stack-discovery-smoke.ts
//
import Database from 'better-sqlite3';
import { applyStackSchema, listCandidatesByStatus } from '../src/stack/db.js';
import { genericAlgorithm } from '../src/stack/discovery/algorithms/generic.js';
import { scoutESearxngTopic } from '../src/stack/discovery/algorithms/scout-e-searxng-topic.js';
import { SearxngClient } from '../src/stack/discovery/search.js';
import { OllamaClient } from '../src/stack/ollama.js';
import { observeMentions } from '../src/stack/discovery/mentions.js';

async function main() {
  const db = new Database('/tmp/stack-discovery-smoke.sqlite');
  applyStackSchema(db);

  const ollama = new OllamaClient(process.env.OLLAMA_HOST ?? 'http://localhost:11434');
  const search = new SearxngClient(process.env.SEARXNG_INSTANCE ?? 'https://searx.be');

  const items: any[] = [
    { source: 'hn', title: 's1', url: 'https://fabiensanglard.net/post', fetchedAt: new Date().toISOString() },
    { source: 'hn', title: 's2', url: 'https://danluu.com/post', fetchedAt: new Date().toISOString() },
    { source: 'lobsters', title: 's3', url: 'https://drewdevault.com/post', fetchedAt: new Date().toISOString() },
  ];
  observeMentions(db, items, ['github.com', 'youtube.com'], new Date().toISOString());

  const ctx = {
    db,
    webFetch: async (url: string) => { const r = await fetch(url); return { ok: r.ok, text: () => r.text() }; },
    classify: async (p: string) => /^\s*yes\b/i.test(await ollama.complete('qwen3:4b', p)),
    search,
    bloomlist: ['github.com', 'youtube.com'],
    occurrenceThreshold: 3,
  };

  console.log('Running generic_algorithm…');
  await genericAlgorithm.run(ctx as any);
  console.log('Running scout_E…');
  // For the smoke we don't need real high-rated drops; run with a synthetic topic list.
  await scoutESearxngTopic.run(ctx as any, { maxTopics: 1, queryBudget: 1 });

  console.log('Candidates after smoke:');
  for (const status of ['observed','probe_failed','candidate','promoted','archived'] as const) {
    const list = listCandidatesByStatus(db, status);
    console.log(` ${status}: ${list.length} → ${list.map(c => c.domain).join(', ')}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Run live smoke (optional — gated on Ollama + SearXNG being up)**

```
SEARXNG_INSTANCE=https://searx.be npx tsx scripts/stack-discovery-smoke.ts
```

Expected: Prints classifier verdicts and the resulting candidate counts. Does not block PR.

- [ ] **Step 5: Run the full suite**

```
npx vitest run
```

Expected: PASS (all existing + all Plan 2 new tests).

- [ ] **Step 6: Commit**

```bash
git add tests/stack/smoke.test.ts scripts/stack-discovery-smoke.ts
git commit -m "test(stack): add discovery integration smoke + live discovery smoke script"
```

---

## Summary

13 tasks, 4 phases. Plan 2 ships the entire discovery layer plus the Wikipedia-grounding fix.

| Phase | Task | Description |
|-------|------|-------------|
| A — Foundations | 1 | Wikipedia-grounding fix (Mozilla Readability + jsdom in enricher) |
| A | 2 | Extend StackConfig with discovery / search / sampling fields + validators |
| A | 3 | SearXNG search client |
| A | 4 | RSS auto-discovery + domain bloomlist |
| A | 5 | Discovery algorithm registry interface + cron registration helper |
| B — Algorithms | 6 | `generic_algorithm` (mention observer + 4-day refresh + RSS probe) |
| B | 7 | Scout A — HN comment URL mining |
| B | 8 | Scout B — Lobste.rs comment URL mining |
| B | 9 | Scout E — SearXNG topic-driven search |
| C — Pool dynamics | 10 | Promotion / demotion pass (daily) |
| C | 11 | Stochastic source sampler + sampled scraper runner |
| D — Wiring | 12 | Wire discovery crons + post-scrape mention hook in `initStack()` |
| D | 13 | End-to-end discovery integration smoke + live smoke script |

## Out of scope (future Plan 3+)

- Scouts C, D, G (GitHub README, awesome-* traversal, Lobste.rs tag RSS subscription)
- Newsletter / podcast / YouTube creator scouts
- Tier 3 "deep cold" sources (anything below the candidate trial threshold)
- Manual review UI for going-stale sources
- Replacing the picker's existing fixed bucket weights with a learned-from-ratings adaptive mix

## Test plan

- [ ] `npx vitest run` passes (all existing + all Plan 2 new unit tests)
- [ ] `npm run build` clean
- [ ] Discovery integration test in `tests/stack/smoke.test.ts` passes (fully in-process, no network)
- [ ] Optional: live `scripts/stack-discovery-smoke.ts` run against a real SearXNG instance + real Ollama produces non-zero candidate counts

## Self-Review

**Spec coverage:**
- §2.3 (registry) → Task 5 ✓
- §2.4 (`generic_algorithm`) → Tasks 6 + 12 ✓
- §2.5 (scouts A/B/E) → Tasks 7 + 8 + 9 ✓
- §2.6 (RSS auto-discovery) → Task 4 (consumed by Tasks 6, 10) ✓
- §2.7 (promotion/demotion) → Task 10 ✓
- §2.2 (sampling formula) → Task 11 ✓
- §2.8 (reader-mode HTML extraction) → Task 1 ✓
- Domain bloomlist → Task 4 (used in Tasks 6/7/8/9) ✓
- Post-scrape mention hook → Task 6 (`observeMentions`) + Task 12 (wiring) ✓

**Type consistency check:** `DiscoveryContext` interface is defined once in Task 5 and consumed in Tasks 6/7/8/9; `SampledSource` defined in Task 11 and consumed in the same task's scraper changes; `CandidateSource` defined in Task 6 and consumed in Task 10.

**Placeholder scan:** none — every code step contains complete code; every command is executable.

**Scope check:** 13 tasks is on the upper end of a single plan, but each task is independently testable and the phases (A→B→C→D) map cleanly to dependencies. Splitting would create artificial seams (e.g., shipping discovery without the sampler leaves Tier 2 sources unreachable).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-28-stack-discovery.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task with two-stage review (`superpowers:subagent-driven-development`). Best for the larger tasks (6, 11, 12).
2. **Inline Execution** — batch tasks within the same session (`superpowers:executing-plans`).

Either way, work on a fresh `skill/stack-discovery` branch cut from `main` after Plan 1 merges.
