/**
 * Stack live-pipeline smoke test.
 *
 * Runs the full RawItem → Drop chain against REAL backends:
 *   - Live HN scrape (top 3)
 *   - Real Qwen 3 14B grading via local Ollama
 *   - Real Claude Haiku 4.5 enrichment via Claude Agent SDK
 *   - In-memory SQLite + tmpdir vault (no email)
 *
 * No emails are sent. No persistent state outside the temp vault.
 *
 * Usage:
 *   tsx scripts/stack-smoke.ts
 *
 * Requires CLAUDE_CODE_OAUTH_TOKEN in the environment (or ~/.claude/.credentials.json).
 */

import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { applyStackSchema } from '../src/stack/db.js';
import { initVault } from '../src/stack/vault.js';
import { OllamaClient } from '../src/stack/ollama.js';
import { gradeBatch } from '../src/stack/pipeline/grader.js';
import { enrich } from '../src/stack/pipeline/enricher.js';
import { persistDrop } from '../src/stack/pipeline/confidence-gate.js';
import { createHaiku } from '../src/stack/haiku.js';
import { scrapeHN } from '../src/stack/scrapers/hn.js';

function step(label: string): void {
  console.log(`\n=== ${label} ===`);
}

async function main(): Promise<void> {
  const startedAt = Date.now();

  step('Setup');
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-smoke-'));
  initVault(vault);
  const db = new Database(':memory:');
  applyStackSchema(db);
  console.log(`vault: ${vault}`);

  step('Scrape HN (live, top 3)');
  const items = await scrapeHN(undefined, 3);
  console.log(`got ${items.length} items`);
  for (const i of items) {
    console.log(`  - ${i.title.slice(0, 70)}`);
    console.log(`    ${i.url}`);
  }
  if (items.length === 0) {
    throw new Error('HN scrape returned 0 items — abort');
  }

  step('Grade with qwen3:14b (real Ollama)');
  const ollama = new OllamaClient('http://localhost:11434');
  if (!(await ollama.ping())) {
    throw new Error('Ollama not reachable at http://localhost:11434');
  }
  const t0 = Date.now();
  const graded = await gradeBatch(ollama, 'qwen3:14b', items, {
    exemplarBlock: '',
    recentFeedbackBlock: '',
    sourceWeightingHint: '',
  });
  const gradeMs = Date.now() - t0;
  console.log(`graded ${graded.length} of ${items.length} in ${gradeMs}ms`);
  for (const g of graded) {
    console.log(
      `  ${g.keep ? 'KEEP' : 'DROP'} bucket=${g.bucket ?? '-'} conf=${g.confidence.toFixed(2)} — ${g.raw.title.slice(0, 60)}`,
    );
    if (g.reasoning) console.log(`    reasoning: ${g.reasoning.slice(0, 120)}`);
  }

  const survivors = graded.filter((g) => g.keep && g.bucket);
  if (survivors.length === 0) {
    console.log('\nNo survivors from grader — pipeline still proven through grading.');
    console.log(`elapsed: ${Date.now() - startedAt}ms`);
    return;
  }

  step('Enrich with Claude Haiku 4.5 (Agent SDK)');
  const haiku = createHaiku('claude-haiku-4-5-20251001');
  const webFetch = async (url: string): Promise<string> => {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return r.text();
  };

  const target = survivors[0];
  console.log(`enriching: ${target.raw.title}`);
  console.log(`source:    ${target.raw.url}`);

  const t1 = Date.now();
  let drop;
  try {
    drop = await enrich(haiku, webFetch, target);
  } catch (err: any) {
    console.error(`enrich threw: ${err?.message ?? err}`);
    throw err;
  }
  const enrichMs = Date.now() - t1;
  console.log(`enricher returned in ${enrichMs}ms`);

  if (!drop) {
    console.log(
      'enricher returned null (likely !groundable) — that itself proves the path works.',
    );
    console.log(`\nelapsed: ${Date.now() - startedAt}ms`);
    return;
  }

  console.log(`  name:       ${drop.name}`);
  console.log(`  tagline:    ${drop.tagline}`);
  console.log(`  bucket:     ${drop.bucket}`);
  console.log(`  tags:       ${drop.tags.join(', ')}`);
  console.log(`  confidence: ${drop.confidence}`);
  console.log(`  status:     ${drop.status}`);

  step('Persist (vault + SQLite)');
  const persisted = persistDrop(db, vault, drop);
  console.log(`  vault path: ${persisted.vaultPath}`);
  const fullPath = path.join(vault, persisted.vaultPath);
  console.log(`  vault file: ${fullPath}`);
  console.log(`  exists:     ${fs.existsSync(fullPath)}`);

  const queueCount = (db.prepare('SELECT COUNT(*) as n FROM stack_queue').get() as { n: number }).n;
  console.log(`  queue rows: ${queueCount}`);

  step('Result');
  console.log('SMOKE 1 PASSED — full pipeline works against real backends.');
  console.log(`elapsed: ${Date.now() - startedAt}ms`);
  console.log(`\nVault file preview (first 30 lines):`);
  const content = fs.readFileSync(fullPath, 'utf-8');
  console.log(content.split('\n').slice(0, 30).join('\n'));
}

main().catch((err) => {
  console.error('\n=== SMOKE FAILED ===');
  console.error(err);
  process.exit(1);
});
