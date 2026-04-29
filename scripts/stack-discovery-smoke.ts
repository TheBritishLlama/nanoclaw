// Live smoke for the discovery layer: real Ollama (qwen3:4b classifier) +
// real network fetch + real SearXNG. Does NOT touch Gmail.
//
// Usage:
//   SEARXNG_INSTANCE=https://your.searx.instance npx tsx scripts/stack-discovery-smoke.ts
//
// Side effects: writes to /tmp/stack-discovery-smoke.sqlite (recreated each run).

import fs from 'fs';
import Database from 'better-sqlite3';
import { applyStackSchema, listCandidatesByStatus } from '../src/stack/db.js';
import { genericAlgorithm } from '../src/stack/discovery/algorithms/generic.js';
import { scoutESearxngTopic } from '../src/stack/discovery/algorithms/scout-e-searxng-topic.js';
import { SearxngClient } from '../src/stack/discovery/search.js';
import { OllamaClient } from '../src/stack/ollama.js';
import { observeMentions } from '../src/stack/discovery/mentions.js';

async function main() {
  const dbPath = '/tmp/stack-discovery-smoke.sqlite';
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = new Database(dbPath);
  applyStackSchema(db);

  const ollama = new OllamaClient(process.env.OLLAMA_HOST ?? 'http://localhost:11434');
  const searxngInstance = process.env.SEARXNG_INSTANCE ?? 'https://searx.be';
  const search = new SearxngClient(searxngInstance);

  const now = new Date().toISOString();
  const items: any[] = [
    { source: 'hn', title: 's1', url: 'https://fabiensanglard.net/post', fetchedAt: now },
    { source: 'hn', title: 's2', url: 'https://danluu.com/post', fetchedAt: now },
    { source: 'lobsters', title: 's3', url: 'https://drewdevault.com/post', fetchedAt: now },
  ];
  observeMentions(db, items, ['github.com', 'youtube.com'], now);
  console.log(`Seeded ${items.length} synthetic mentions.`);

  const ctx = {
    db,
    webFetch: async (url: string) => {
      const r = await fetch(url);
      return { ok: r.ok, text: () => r.text() };
    },
    classify: async (p: string) => {
      try {
        const out = await ollama.generate('qwen3:4b', p);
        return /^\s*yes\b/i.test(out);
      } catch (e) {
        console.error('classify failed:', e);
        return false;
      }
    },
    search,
    bloomlist: ['github.com', 'youtube.com'],
    occurrenceThreshold: 3,
  };

  console.log('Running generic_algorithm…');
  await genericAlgorithm.run(ctx as any);
  console.log('Running scout_E_searxng_topic…');
  await scoutESearxngTopic.run(ctx as any);

  console.log('Candidates after smoke:');
  for (const status of ['observed','probe_failed','candidate','promoted','archived'] as const) {
    const list = listCandidatesByStatus(db, status);
    console.log(` ${status}: ${list.length} → ${list.map(c => c.domain).join(', ')}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
