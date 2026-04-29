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
  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(`bucketWeights must sum to 1.0, got ${sum}`);
  }
  if (cfg.confidenceThreshold < 0 || cfg.confidenceThreshold > 1) {
    throw new Error(`confidenceThreshold must be 0..1, got ${cfg.confidenceThreshold}`);
  }
  if (cfg.reviewApproveThreshold < 1 || cfg.reviewApproveThreshold > 10) {
    throw new Error(`reviewApproveThreshold must be 1..10, got ${cfg.reviewApproveThreshold}`);
  }

  const s = cfg.samplingFormula;
  if (s.minSampleProbability < 0 || s.minSampleProbability > 1) {
    throw new Error(`samplingFormula.minSampleProbability must be 0..1, got ${s.minSampleProbability}`);
  }
  if (s.randomJitterMin > s.randomJitterMax) {
    throw new Error(`samplingFormula.randomJitterMin (${s.randomJitterMin}) must be <= randomJitterMax (${s.randomJitterMax})`);
  }
  if (s.tier2SamplePercent < 0 || s.tier2SamplePercent > 1) {
    throw new Error(`samplingFormula.tier2SamplePercent must be 0..1, got ${s.tier2SamplePercent}`);
  }

  for (const a of cfg.discoveryAlgorithms) {
    if (!KNOWN_ALGORITHMS.has(a.name)) {
      throw new Error(`unknown discovery algorithm: ${a.name}`);
    }
  }

  if (cfg.search.provider !== 'searxng') {
    throw new Error(`search.provider must be 'searxng' (got '${cfg.search.provider}')`);
  }
}

export function loadStackConfig(filePath: string): StackConfig {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StackConfig;
  validate(raw);
  return raw;
}
loadStackConfig.fromObject = (obj: StackConfig): StackConfig => {
  validate(obj);
  return obj;
};
