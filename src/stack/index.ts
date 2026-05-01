import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { applyStackSchema, getKnownUrls, recordScrapeOutcomes } from './db.js';
import { loadStackConfig } from './config.js';
import { initVault } from './vault.js';
import {
  OllamaClient,
  OllamaHealthMonitor,
  platformRestart,
  realSleep,
} from './ollama.js';
import { buildDefaultRegistry, runEnabledScrapers } from './scrapers/index.js';
import { gradeBatch } from './pipeline/grader.js';
import { enrich } from './pipeline/enricher.js';
import { persistDrop } from './pipeline/confidence-gate.js';
import { pickNextDrops, markManySent } from './pipeline/picker.js';
import { sendMultiDropEmail } from './delivery/outbound.js';
import {
  seedFoundations,
  ensureMinFoundationsInQueue,
} from './foundations/runner.js';
import {
  buildExemplarBlock,
  buildRecentFeedbackBlock,
  buildSourceWeightingHint,
} from './curator/adaptive.js';
import { StackScheduler } from './scheduler.js';
import { createStackGmail } from './gmail.js';
import { createHaiku } from './haiku.js';
import { observeMentions } from './discovery/mentions.js';
import { runPromotionPass } from './discovery/promote.js';
import {
  buildRegistry,
  registerEnabledOn,
  type DiscoveryContext,
} from './discovery/registry.js';
import { genericAlgorithm } from './discovery/algorithms/generic.js';
import { scoutAHnComments } from './discovery/algorithms/scout-a-hn-comments.js';
import { scoutBLobstersComments } from './discovery/algorithms/scout-b-lobsters-comments.js';
import { scoutESearxngTopic } from './discovery/algorithms/scout-e-searxng-topic.js';
import { SearxngClient } from './discovery/search.js';

// Re-export for Task 20 wiring
export { handleInboundReply } from './delivery/inbound.js';

export interface InitStackDeps {
  db: Database.Database;
}

const FOUNDATIONS_CONFIG_PATH = path.resolve('groups/stack/foundations.json');
const CONFIG_PATH = path.resolve('groups/stack/config.json');

export async function initStack({ db }: InitStackDeps): Promise<void> {
  // Apply schema (idempotent via IF NOT EXISTS)
  applyStackSchema(db);

  // Load config
  const cfg = loadStackConfig(CONFIG_PATH);

  // Init vault directory structure
  initVault(cfg.vaultPath);

  // Seed foundations from foundations.json if present
  if (fs.existsSync(FOUNDATIONS_CONFIG_PATH)) {
    const rawFoundations = JSON.parse(
      fs.readFileSync(FOUNDATIONS_CONFIG_PATH, 'utf-8'),
    );
    seedFoundations(db, rawFoundations);
  }

  // Build Ollama client + health monitor
  const ollamaClient = new OllamaClient(cfg.ollama.host);
  const ollamaMonitor = new OllamaHealthMonitor({
    ping: () => ollamaClient.ping(),
    restart: platformRestart(),
    sleepMs: realSleep,
  });

  // Build scraper registry
  const scraperRegistry = buildDefaultRegistry({
    rssFeeds: cfg.rssFeeds,
  });

  // Build Gmail sender + Haiku client
  const gmail = await createStackGmail();
  const haiku = createHaiku(cfg.enricherModel);

  // SearXNG client (Plan 2 — present when search.provider === 'searxng')
  const searxng =
    cfg.search.provider === 'searxng'
      ? new SearxngClient(cfg.search.searxngInstance)
      : undefined;

  // Qwen 3 4B classifier closure for scouts (yes/no via /api/generate).
  // Thinking mode is disabled — yes/no classification doesn't need it and
  // it adds minutes of latency that trips Node's 5-min headers timeout.
  const classify = async (prompt: string): Promise<boolean> => {
    try {
      const out = await ollamaClient.generate(
        cfg.scoutClassifierModel,
        prompt,
        { think: false },
      );
      return /^\s*yes\b/i.test(out);
    } catch {
      return false;
    }
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
  const discoveryRegistry = buildRegistry([
    genericAlgorithm,
    scoutAHnComments,
    scoutBLobstersComments,
    scoutESearxngTopic,
  ]);

  const addrs = { from: cfg.senderEmail, to: cfg.recipientEmail };

  // Build scheduler
  const scheduler = new StackScheduler();

  // Cron 1: daily scrape at 02:00
  scheduler.addCron('stack-scrape', '0 2 * * *', async () => {
    const allItems = await runEnabledScrapers(
      cfg.enabledScrapers,
      scraperRegistry,
    );

    // Dedup: skip URLs we've already graded, enriched, or have pending.
    // RSS backfill returns 800+ items every run; without this filter, daily
    // grading takes hours instead of minutes.
    const seen = getKnownUrls(
      db,
      allItems.map((i) => i.url),
    );
    const items = allItems.filter((i) => !seen.has(i.url));
    const nowIso = new Date().toISOString();
    if (seen.size > 0) {
      recordScrapeOutcomes(
        db,
        allItems
          .filter((i) => seen.has(i.url))
          .map((i) => ({ source: i.source, url: i.url, outcome: 'duplicate' })),
        nowIso,
      );
    }

    const exemplarBlock = buildExemplarBlock(db, 14);
    const recentFeedbackBlock = buildRecentFeedbackBlock(db, 14);
    const sourceWeightingHint = buildSourceWeightingHint(db);

    const graded = await gradeBatch(ollamaClient, cfg.graderModel, items, {
      exemplarBlock,
      recentFeedbackBlock,
      sourceWeightingHint,
    });

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

    for (const g of graded) {
      if (!g.keep || !g.bucket) continue;
      try {
        const drop = await enrich(
          haiku,
          async (url) => {
            const r = await fetch(url);
            return r.text();
          },
          g,
        );
        if (!drop) {
          // Legit ungroundable per Haiku — mark done so we don't retry.
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
          continue;
        }
        persistDrop(db, cfg.vaultPath, drop);
        recordScrapeOutcomes(
          db,
          [{ source: g.raw.source, url: g.raw.url, outcome: 'enriched' }],
          nowIso,
        );
      } catch (e) {
        // Transient — don't record an outcome; the URL is NOT in scrape_log
        // as terminal, so a future scrape run will surface it again.
        console.error(`[stack] enrich failed for ${g.raw.url}:`, e);
      }
    }

    // Plan 2: feed scraped items into the domain mention observer for generic_algorithm.
    observeMentions(db, items, cfg.discovery.domainBloomlist, nowIso);

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
        if (!drop)
          throw new Error(
            `Foundation enrich returned null for ${foundationItem.id}`,
          );
        return drop;
      },
      cfg.queueMinDepth,
    );
  });

  // Helper: pick and deliver a multi-drop email (cfg.dropsPerEmail topics in
  // one email, with sources consolidated at the bottom).
  // Throttle: skip if any Stack drop was sent in the last DELIVERY_COOLDOWN_MS
  // — defends against duplicate cron fires, runaway re-spawn loops, or any
  // future trigger source we haven't anticipated. Daily crons are >=2h apart
  // so a 90-min window never suppresses a legit fire.
  const dropsPerEmail = cfg.dropsPerEmail ?? 3;
  const DELIVERY_COOLDOWN_MS = 90 * 60 * 1000;
  const deliverOneEmail = async (cronId: string) => {
    const lastSentRow = db
      .prepare(
        "SELECT MAX(sent_at) AS last_sent FROM stack_queue WHERE status='sent'",
      )
      .get() as { last_sent: string | null };
    if (lastSentRow?.last_sent) {
      const sinceMs = Date.now() - Date.parse(lastSentRow.last_sent);
      if (sinceMs < DELIVERY_COOLDOWN_MS) {
        console.log(
          `[stack] ${cronId}: skipping delivery — last email sent ${Math.round(sinceMs / 60000)} min ago (cooldown ${DELIVERY_COOLDOWN_MS / 60000} min)`,
        );
        return;
      }
    }
    const drops = pickNextDrops(db, dropsPerEmail, {
      rng: Math.random,
      foundationsMixRatio: cfg.foundationsMixRatio,
      bucketWeights: cfg.bucketWeights,
    });
    if (drops.length === 0) {
      console.log(`[stack] ${cronId}: no drops queued, skipping`);
      return;
    }
    console.log(
      `[stack] ${cronId}: sending ${drops.length} drops: ${drops.map((d) => `${d.bucket}/${d.name}`).join(', ')}`,
    );
    const messageId = await sendMultiDropEmail(gmail, addrs, drops);
    markManySent(
      db,
      drops.map((d) => d.id),
      new Date().toISOString(),
      messageId,
    );
    console.log(`[stack] ${cronId}: sent ${messageId}`);
  };

  // Crons 2–4: three delivery windows derived from config
  const [t1, t2, t3] = cfg.deliveryTimes;
  scheduler.addCron('stack-deliver-' + t1, timeToCron(t1), () =>
    deliverOneEmail('stack-deliver-' + t1),
  );
  scheduler.addCron('stack-deliver-' + t2, timeToCron(t2), () =>
    deliverOneEmail('stack-deliver-' + t2),
  );
  scheduler.addCron('stack-deliver-' + t3, timeToCron(t3), () =>
    deliverOneEmail('stack-deliver-' + t3),
  );

  // Cron 5: Ollama watchdog every 15 minutes
  scheduler.addCron('stack-ollama-watchdog', '*/15 * * * *', async () => {
    await ollamaMonitor.checkAndRecover();
  });

  // Plan 2 — Cron 6: daily 04:30 promotion / demotion pass
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

  // Plan 2 — Crons 7+: discovery algorithm crons (one per enabled entry)
  registerEnabledOn(
    scheduler,
    discoveryRegistry,
    cfg.discoveryAlgorithms,
    discoveryCtx,
  );

  scheduler.start();
}

/** Convert "HH:MM" to a cron expression "MM HH * * *" */
function timeToCron(hhmm: string): string {
  const [h, m] = hhmm.split(':');
  return `${parseInt(m, 10)} ${parseInt(h, 10)} * * *`;
}
