// One-shot end-to-end Stack run, equivalent to firing every Stack cron at once:
//   stack-scrape (8 scrapers → grade → enrich → persist → observeMentions → foundations top-up)
//   discovery-generic_algorithm
//   discovery-scout_A_hn_comments
//   discovery-scout_B_lobsters_comments
//   discovery-scout_E_searxng_topic
//   stack-promote
//   one delivery (pickNextDrop → sendDropEmail)
//
// Uses the production DB and vault. STOP the NanoClaw service before running:
//   systemctl --user stop nanoclaw && npx tsx scripts/stack-full-run.ts
//
// Prints counts and timings at each stage. Sends one real drop email at the end.

import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

import {
  applyStackSchema,
  listCandidatesByStatus,
  insertGradedPending,
  listGradedPending,
  deleteGradedPending,
  countGradedPending,
  getKnownUrls,
  recordScrapeOutcomes,
} from '../src/stack/db.js';
import { readEnvFile } from '../src/env.js';
import { loadStackConfig } from '../src/stack/config.js';
import { initVault } from '../src/stack/vault.js';
import { OllamaClient } from '../src/stack/ollama.js';
import {
  buildDefaultRegistry,
  runEnabledScrapers,
} from '../src/stack/scrapers/index.js';
import { gradeBatch } from '../src/stack/pipeline/grader.js';
import { enrich } from '../src/stack/pipeline/enricher.js';
import { persistDrop } from '../src/stack/pipeline/confidence-gate.js';
import { pickNextDrops, markManySent } from '../src/stack/pipeline/picker.js';
import { sendMultiDropEmail } from '../src/stack/delivery/outbound.js';
import {
  ensureMinFoundationsInQueue,
  seedFoundations,
} from '../src/stack/foundations/runner.js';
import {
  buildExemplarBlock,
  buildRecentFeedbackBlock,
  buildSourceWeightingHint,
} from '../src/stack/curator/adaptive.js';
import { observeMentions } from '../src/stack/discovery/mentions.js';
import { runPromotionPass } from '../src/stack/discovery/promote.js';
import { genericAlgorithm } from '../src/stack/discovery/algorithms/generic.js';
import { scoutAHnComments } from '../src/stack/discovery/algorithms/scout-a-hn-comments.js';
import { scoutBLobstersComments } from '../src/stack/discovery/algorithms/scout-b-lobsters-comments.js';
import { scoutESearxngTopic } from '../src/stack/discovery/algorithms/scout-e-searxng-topic.js';
import { SearxngClient } from '../src/stack/discovery/search.js';
import type { DiscoveryContext } from '../src/stack/discovery/registry.js';
import { createStackGmail } from '../src/stack/gmail.js';
import { createHaiku } from '../src/stack/haiku.js';

const STORE_DIR = path.resolve('store');
const DB_PATH = path.join(STORE_DIR, 'messages.db');
const CONFIG_PATH = path.resolve('groups/stack/config.json');
const FOUNDATIONS_PATH = path.resolve('groups/stack/foundations.json');

function ts(): string {
  return new Date().toISOString().split('T')[1].slice(0, 8);
}
function log(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
}

async function main() {
  // Load .env so the Claude Agent SDK finds CLAUDE_CODE_OAUTH_TOKEN.
  // NanoClaw's main process does this; standalone scripts don't.
  const env = readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN']);
  if (env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN;
    log('Loaded CLAUDE_CODE_OAUTH_TOKEN from .env');
  }

  log('Loading config and DB');
  const cfg = loadStackConfig(CONFIG_PATH);
  initVault(cfg.vaultPath);
  const db = new Database(DB_PATH);
  applyStackSchema(db);

  const pendingFromPrior = countGradedPending(db);
  if (pendingFromPrior > 0) {
    log(`  found ${pendingFromPrior} previously-graded items pending enrichment (resume)`);
  }

  if (fs.existsSync(FOUNDATIONS_PATH)) {
    const seed = JSON.parse(fs.readFileSync(FOUNDATIONS_PATH, 'utf-8'));
    seedFoundations(db, seed);
  }

  const ollama = new OllamaClient(cfg.ollama.host);
  const haiku = createHaiku(cfg.enricherModel);
  const gmail = await createStackGmail();
  const addrs = { from: cfg.senderEmail, to: cfg.recipientEmail };

  // ============== Stage 1: SCRAPE ==============
  log('Stage 1 — running 8 scrapers in parallel');
  const t0 = Date.now();
  const scraperRegistry = buildDefaultRegistry({ rssFeeds: cfg.rssFeeds });
  const allItems = await runEnabledScrapers(
    cfg.enabledScrapers,
    scraperRegistry,
  );
  log(
    `  scraped ${allItems.length} raw items in ${Math.round((Date.now() - t0) / 1000)}s`,
  );

  // Dedup against URLs we've already seen.
  const seen = getKnownUrls(
    db,
    allItems.map((i) => i.url),
  );
  let items = allItems.filter((i) => !seen.has(i.url));
  const nowIso = new Date().toISOString();
  if (seen.size > 0) {
    log(`  ${seen.size} duplicates skipped → ${items.length} new items`);
    recordScrapeOutcomes(
      db,
      allItems
        .filter((i) => seen.has(i.url))
        .map((i) => ({ source: i.source, url: i.url, outcome: 'duplicate' })),
      nowIso,
    );
  }

  // Optional STACK_RUN_LIMIT env var caps the input to stage 2.
  const limit = process.env.STACK_RUN_LIMIT
    ? parseInt(process.env.STACK_RUN_LIMIT, 10)
    : undefined;
  if (limit && items.length > limit) {
    items = items.slice(0, limit);
    log(`  STACK_RUN_LIMIT=${limit} → trimmed to first ${items.length} items`);
  }

  // ============== Stage 2: GRADE (Qwen 3 14B) ==============
  log('Stage 2 — grading via Qwen 3 14B');
  const t1 = Date.now();
  const exemplarBlock = buildExemplarBlock(db, 14);
  const recentFeedbackBlock = buildRecentFeedbackBlock(db, 14);
  const sourceWeightingHint = buildSourceWeightingHint(db);
  const graded = await gradeBatch(ollama, cfg.graderModel, items, {
    exemplarBlock,
    recentFeedbackBlock,
    sourceWeightingHint,
  });
  const kept = graded.filter((g) => g.keep && g.bucket);
  log(`  graded ${graded.length} items, kept ${kept.length} in ${Math.round((Date.now() - t1) / 1000)}s`);
  const byBucket: Record<string, number> = {};
  for (const g of kept) byBucket[g.bucket!] = (byBucket[g.bucket!] ?? 0) + 1;
  log(`  by bucket: ${JSON.stringify(byBucket)}`);

  // Persist kept items so a stage-3 crash doesn't waste the grading work.
  // Resume on the next run pulls these back in via listGradedPending().
  const insertedPending = insertGradedPending(db, kept, nowIso);
  log(`  checkpointed ${insertedPending} graded items to stack_graded_pending`);

  // Log every grader verdict so the URL becomes "seen" next time.
  recordScrapeOutcomes(
    db,
    graded.map((g) => ({
      source: g.raw.source,
      url: g.raw.url,
      outcome: g.keep ? 'graded_keep' : 'graded_drop',
      reasoning: g.reasoning,
    })),
    nowIso,
  );

  // ============== Stage 3: ENRICH (Claude Haiku 4.5) ==============
  log('Stage 3 — enriching via Claude Haiku 4.5');
  const t2 = Date.now();
  let enriched = 0;
  let rejected = 0;
  let errored = 0;
  // Pull from the checkpoint table — covers both newly graded items AND any
  // items left over from a prior crashed run.
  const toEnrich = listGradedPending(db);
  log(`  enrichment queue depth: ${toEnrich.length}`);
  for (const g of toEnrich) {
    try {
      const drop = await enrich(
        haiku,
        async (url) => {
          const r = await fetch(url);
          return r.text();
        },
        g,
      );
      if (drop) {
        persistDrop(db, cfg.vaultPath, drop);
        recordScrapeOutcomes(
          db,
          [{ source: g.raw.source, url: g.raw.url, outcome: 'enriched' }],
          nowIso,
        );
        deleteGradedPending(db, g.raw.url);
        enriched++;
      } else {
        // Legit ungroundable — record so dedup knows we're done with this URL.
        recordScrapeOutcomes(
          db,
          [
            {
              source: g.raw.source,
              url: g.raw.url,
              outcome: 'enrich_rejected',
            },
          ],
          nowIso,
        );
        deleteGradedPending(db, g.raw.url);
        rejected++;
      }
    } catch (e) {
      // Transient — leave row in pending so the next run retries this URL.
      errored++;
      console.error(`[stack] enrich failed for ${g.raw.url}:`, e);
    }
  }
  log(`  enriched ${enriched}, rejected ${rejected}, errored ${errored} in ${Math.round((Date.now() - t2) / 1000)}s`);

  // ============== Stage 4: MENTION OBSERVATION ==============
  log('Stage 4 — observing domain mentions for discovery');
  observeMentions(db, items, cfg.discovery.domainBloomlist, new Date().toISOString());
  const mentionsCount = db
    .prepare('SELECT COUNT(*) AS c FROM stack_domain_mentions')
    .get() as { c: number };
  log(`  mentions table now has ${mentionsCount.c} rows`);

  // ============== Stage 5: FOUNDATIONS TOP-UP ==============
  log('Stage 5 — topping up Foundations queue');
  const t3 = Date.now();
  await ensureMinFoundationsInQueue(
    db,
    cfg.vaultPath,
    async (foundationItem) => {
      const fakeGraded = {
        raw: {
          source: 'foundations',
          title: foundationItem.name,
          url: foundationItem.sourceUrl,
          fetchedAt: new Date().toISOString(),
        },
        keep: true,
        bucket: 'foundation' as const,
        confidence: 0.95,
        reasoning: 'Foundation item',
      };
      const drop = await enrich(
        haiku,
        async (url) => {
          const r = await fetch(url);
          return r.text();
        },
        fakeGraded,
      );
      if (!drop) throw new Error(`Foundation enrich returned null for ${foundationItem.id}`);
      return drop;
    },
    cfg.queueMinDepth,
  );
  log(`  foundations top-up done in ${Math.round((Date.now() - t3) / 1000)}s`);

  // ============== Stage 6: DISCOVERY ALGORITHMS ==============
  log('Stage 6 — discovery algorithms (generic + scouts A/B/E)');
  const searxng =
    cfg.search.provider === 'searxng'
      ? new SearxngClient(cfg.search.searxngInstance)
      : undefined;
  const classify = async (prompt: string): Promise<boolean> => {
    try {
      const out = await ollama.generate(cfg.scoutClassifierModel, prompt);
      return /^\s*yes\b/i.test(out);
    } catch {
      return false;
    }
  };
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
  for (const algo of [
    genericAlgorithm,
    scoutAHnComments,
    scoutBLobstersComments,
    scoutESearxngTopic,
  ]) {
    const ts0 = Date.now();
    const out = await algo.run(discoveryCtx);
    log(`  ${algo.name}: ${out.length} candidate(s) observed in ${Math.round((Date.now() - ts0) / 1000)}s`);
  }
  for (const status of ['observed', 'probe_failed', 'candidate', 'promoted', 'archived'] as const) {
    const list = listCandidatesByStatus(db, status);
    if (list.length > 0) {
      log(`  candidates ${status}: ${list.length} → ${list.map((c) => c.domain).join(', ')}`);
    }
  }

  // ============== Stage 7: PROMOTION ==============
  log('Stage 7 — promotion / demotion pass');
  runPromotionPass(db, {
    trialDropsCount: cfg.discovery.trialDropsCount,
    promotionMinAvgRating: cfg.discovery.promotionMinAvgRating,
    archiveMaxAvgRating: cfg.discovery.archiveMaxAvgRating,
    trialWindowDays: 60,
    demotionMinRatedCount: 20,
    demotionAvgRatingThreshold: 3,
  });
  log('  promotion pass complete');

  // ============== Stage 8: DELIVER ONE MULTI-DROP EMAIL ==============
  log('Stage 8 — picking and sending one multi-drop email');
  const dropsPerEmail = cfg.dropsPerEmail ?? 3;
  const drops = pickNextDrops(db, dropsPerEmail, {
    rng: Math.random,
    foundationsMixRatio: cfg.foundationsMixRatio,
    bucketWeights: cfg.bucketWeights,
  });
  if (drops.length === 0) {
    log('  no drops available to send (queue empty)');
  } else {
    log(
      `  sending ${drops.length} drops: ${drops.map((d) => `${d.bucket}/${d.name}`).join(', ')}`,
    );
    const messageId = await sendMultiDropEmail(gmail, addrs, drops);
    markManySent(
      db,
      drops.map((d) => d.id),
      new Date().toISOString(),
      messageId,
    );
    log(`  sent — message id ${messageId}`);
  }

  // ============== SUMMARY ==============
  const queueDepth = db
    .prepare("SELECT COUNT(*) AS c FROM stack_queue WHERE status = 'queued'")
    .get() as { c: number };
  const sentCount = db
    .prepare("SELECT COUNT(*) AS c FROM stack_queue WHERE status = 'sent'")
    .get() as { c: number };
  log('---- DONE ----');
  log(`Queue depth (queued): ${queueDepth.c}`);
  log(`Total sent: ${sentCount.c}`);
  log(`Total candidates: ${db.prepare('SELECT COUNT(*) AS c FROM stack_candidate_sources').get()}`);
  db.close();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
