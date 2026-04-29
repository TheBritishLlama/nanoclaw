import { describe, it, expect } from 'vitest';
import path from 'path';
import { loadStackConfig } from '../../src/stack/config.js';

const baseValid = {
  timezone: 'America/Los_Angeles',
  deliveryTimes: ['08:00', '10:00', '15:00'],
  recipientEmail: 'r@example.com',
  senderEmail: 's@example.com',
  vaultPath: '/tmp/vault',
  bucketWeights: { tool: 0.7, concept: 0.2, lore: 0.1 },
  foundationsMixRatio: 0.5,
  confidenceThreshold: 0.7,
  reviewApproveThreshold: 6,
  queueMinDepth: 10,
  graderModel: 'qwen3:14b',
  scoutClassifierModel: 'qwen3:4b',
  enricherModel: 'claude-haiku-4-5-20251001',
  rssFeeds: [],
  enabledScrapers: [],
  ollama: { host: 'http://localhost:11434', watchdogIntervalMinutes: 15, restartCommand: 'auto' },
  samplingFormula: {
    minSampleProbability: 0.10,
    randomJitterMin: 0.7,
    randomJitterMax: 1.3,
    freshnessFactorActive: 1.0,
    freshnessFactorStale: 0.6,
    freshnessWindowDays: 7,
    tier2Multiplier: 0.3,
    tier2SamplePercent: 0.3,
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
    expect(cfg.scoutClassifierModel).toBe('qwen3:4b');
    expect(cfg.enricherModel).toBe('claude-haiku-4-5-20251001');
    expect(cfg.discovery.domainBloomlist).toContain('github.com');
    expect(cfg.search.provider).toBe('searxng');
  });

  it('throws on bucket weights that do not sum to 1.0', () => {
    const bad = { ...baseValid, bucketWeights: { tool: 0.5, concept: 0.2, lore: 0.1 } };
    expect(() => loadStackConfig.fromObject(bad as any)).toThrow(/bucketWeights/i);
  });
});

describe('loadStackConfig — discovery fields', () => {
  it('accepts the full valid config', () => {
    expect(() => loadStackConfig.fromObject(baseValid as any)).not.toThrow();
  });

  it('rejects samplingFormula.minSampleProbability outside 0..1', () => {
    const bad = { ...baseValid, samplingFormula: { ...baseValid.samplingFormula, minSampleProbability: 1.5 } };
    expect(() => loadStackConfig.fromObject(bad as any)).toThrow(/minSampleProbability/);
  });

  it('rejects randomJitterMin > randomJitterMax', () => {
    const bad = { ...baseValid, samplingFormula: { ...baseValid.samplingFormula, randomJitterMin: 1.5, randomJitterMax: 0.7 } };
    expect(() => loadStackConfig.fromObject(bad as any)).toThrow(/randomJitter/);
  });

  it('rejects unknown discovery algorithm name', () => {
    const bad = { ...baseValid, discoveryAlgorithms: [{ name: 'totally_made_up', enabled: true, schedule: '0 4 * * *' }] };
    expect(() => loadStackConfig.fromObject(bad as any)).toThrow(/unknown discovery algorithm/);
  });

  it('rejects unsupported search.provider', () => {
    const bad = { ...baseValid, search: { ...baseValid.search, provider: 'kagi' } };
    expect(() => loadStackConfig.fromObject(bad as any)).toThrow(/search\.provider/);
  });
});
