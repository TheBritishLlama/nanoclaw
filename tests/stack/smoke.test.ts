import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyStackSchema } from '../../src/stack/db.js';
import { initVault } from '../../src/stack/vault.js';
import { gradeBatch } from '../../src/stack/pipeline/grader.js';
import { enrich } from '../../src/stack/pipeline/enricher.js';
import { persistDrop } from '../../src/stack/pipeline/confidence-gate.js';
import { pickNextDrop } from '../../src/stack/pipeline/picker.js';
import { sendDropEmail } from '../../src/stack/delivery/outbound.js';
import type { RawItem } from '../../src/stack/types.js';

describe('Stack end-to-end smoke', () => {
  it('runs RawItem → Drop → email with all components mocked', async () => {
    const db = new Database(':memory:');
    applyStackSchema(db);
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
    initVault(vault);

    const ollama = {
      generate: vi.fn().mockResolvedValue(
        '{"url":"https://tailscale.com","keep":true,"bucket":"tool","confidence":0.9,"reasoning":"ok"}'
      ),
    };
    const haiku = {
      complete: vi.fn().mockResolvedValue(JSON.stringify({
        name: 'Tailscale', tagline: 'Zero-config WireGuard',
        body: '**Tailscale** is a mesh VPN.', tags: ['vpn'], groundable: true,
      })),
    };
    const webFetch = vi.fn().mockResolvedValue('<html>tailscale</html>');
    const gmail = { send: vi.fn().mockResolvedValue({ messageId: 'm1' }) };

    const items: RawItem[] = [{
      source: 'hn', title: 'Tailscale Funnel launches',
      url: 'https://tailscale.com', fetchedAt: 't',
    }];
    const graded = await gradeBatch(ollama as any, 'qwen3:14b', items,
      { exemplarBlock: '', recentFeedbackBlock: '', sourceWeightingHint: '' });
    expect(graded[0].keep).toBe(true);

    const drop = await enrich(haiku as any, webFetch, graded[0]);
    expect(drop).not.toBeNull();
    persistDrop(db, vault, drop!);

    const next = pickNextDrop(db, {
      rng: () => 0.99, foundationsMixRatio: 0.5,
      bucketWeights: { tool: 0.7, concept: 0.2, lore: 0.1 },
    });
    expect(next!.name).toBe('Tailscale');

    const messageId = await sendDropEmail(gmail as any,
      { from: 'a@b', to: 'c@d' }, next!);
    expect(messageId).toBe('m1');
    expect(gmail.send).toHaveBeenCalledOnce();
  });
});

import { observeMentions } from '../../src/stack/discovery/mentions.js';
import { genericAlgorithm } from '../../src/stack/discovery/algorithms/generic.js';
import { runPromotionPass } from '../../src/stack/discovery/promote.js';
import { getCandidateSource } from '../../src/stack/db.js';

describe('Stack discovery integration smoke', () => {
  it('observes mentions, surfaces candidate, then promotes after trial passes', async () => {
    const db = new Database(':memory:');
    applyStackSchema(db);
    const NOW = '2026-04-28T00:00:00Z';

    const items: RawItem[] = [
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
