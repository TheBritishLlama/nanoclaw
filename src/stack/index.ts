import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { applyStackSchema } from './db.js';
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
import { pickNextDrop, markSent } from './pipeline/picker.js';
import { sendDropEmail } from './delivery/outbound.js';
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

  const addrs = { from: cfg.senderEmail, to: cfg.recipientEmail };

  // Build scheduler
  const scheduler = new StackScheduler();

  // Cron 1: daily scrape at 02:00
  scheduler.addCron('stack-scrape', '0 2 * * *', async () => {
    const items = await runEnabledScrapers(
      cfg.enabledScrapers,
      scraperRegistry,
    );

    const exemplarBlock = buildExemplarBlock(db, 14);
    const recentFeedbackBlock = buildRecentFeedbackBlock(db, 14);
    const sourceWeightingHint = buildSourceWeightingHint(db);

    const graded = await gradeBatch(ollamaClient, cfg.graderModel, items, {
      exemplarBlock,
      recentFeedbackBlock,
      sourceWeightingHint,
    });

    for (const g of graded) {
      if (!g.keep || !g.bucket) continue;
      const drop = await enrich(
        haiku,
        async (url) => {
          const r = await fetch(url);
          return r.text();
        },
        g,
      );
      if (!drop) continue;
      persistDrop(db, cfg.vaultPath, drop);
    }

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

  // Helper: pick and deliver one drop
  const deliverOneDrop = async () => {
    const drop = pickNextDrop(db, {
      rng: Math.random,
      foundationsMixRatio: cfg.foundationsMixRatio,
      bucketWeights: cfg.bucketWeights,
    });
    if (!drop) return;
    const messageId = await sendDropEmail(gmail, addrs, drop);
    markSent(db, drop.id, new Date().toISOString(), messageId);
  };

  // Crons 2–4: three delivery windows derived from config
  const [t1, t2, t3] = cfg.deliveryTimes;
  scheduler.addCron('stack-deliver-' + t1, timeToCron(t1), deliverOneDrop);
  scheduler.addCron('stack-deliver-' + t2, timeToCron(t2), deliverOneDrop);
  scheduler.addCron('stack-deliver-' + t3, timeToCron(t3), deliverOneDrop);

  // Cron 5: Ollama watchdog every 15 minutes
  scheduler.addCron('stack-ollama-watchdog', '*/15 * * * *', async () => {
    await ollamaMonitor.checkAndRecover();
  });

  scheduler.start();
}

/** Convert "HH:MM" to a cron expression "MM HH * * *" */
function timeToCron(hhmm: string): string {
  const [h, m] = hhmm.split(':');
  return `${parseInt(m, 10)} ${parseInt(h, 10)} * * *`;
}
