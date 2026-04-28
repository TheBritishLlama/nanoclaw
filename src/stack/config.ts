import fs from 'fs';

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
  enricherModel: string;
  rssFeeds: string[];
  enabledScrapers: string[];
  ollama: { host: string; watchdogIntervalMinutes: number; restartCommand: string };
}

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
