import { describe, it, expect } from 'vitest';
import path from 'path';
import { loadStackConfig } from '../../src/stack/config.js';

describe('loadStackConfig', () => {
  it('loads and validates the default groups/stack/config.json', () => {
    const cfg = loadStackConfig(path.join(process.cwd(), 'groups/stack/config.json'));
    expect(cfg.timezone).toBe('America/Los_Angeles');
    expect(cfg.deliveryTimes).toEqual(['08:00', '10:00', '15:00']);
    expect(cfg.recipientEmail).toBe('kaitseng@seattleacademy.org');
    expect(cfg.senderEmail).toBe('amazingkangaroofilms@gmail.com');
    expect(cfg.bucketWeights.tool).toBeCloseTo(0.7);
    expect(cfg.foundationsMixRatio).toBe(0.5);
    expect(cfg.confidenceThreshold).toBe(0.7);
    expect(cfg.reviewApproveThreshold).toBe(6);
    expect(cfg.graderModel).toBe('qwen3:14b');
    expect(cfg.enricherModel).toBe('claude-haiku-4-5-20251001');
  });

  it('throws on bucket weights that do not sum to 1.0', () => {
    expect(() => loadStackConfig.fromObject({
      timezone: 'UTC',
      deliveryTimes: ['08:00'],
      recipientEmail: 'a@b',
      senderEmail: 'c@d',
      vaultPath: '/tmp/v',
      bucketWeights: { tool: 0.5, concept: 0.2, lore: 0.1 },
      foundationsMixRatio: 0.5,
      confidenceThreshold: 0.7,
      reviewApproveThreshold: 6,
      queueMinDepth: 10,
      graderModel: 'qwen3:14b',
      enricherModel: 'claude-haiku-4-5-20251001',
      rssFeeds: [],
      enabledScrapers: [],
      ollama: { host: 'http://localhost:11434', watchdogIntervalMinutes: 15, restartCommand: 'auto' },
    })).toThrow(/bucketWeights/i);
  });
});
