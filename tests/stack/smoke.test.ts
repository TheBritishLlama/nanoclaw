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
    const graded = await gradeBatch(ollama as any, 'qwen2.5:14b', items,
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
