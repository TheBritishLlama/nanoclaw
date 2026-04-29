export interface SampleableSource {
  name: string;
  tier: 1 | 2;
  baseWeight: number;
  avgRating: number | null;     // 0..1 normalized; null → 0.5
  lastSeenIso: string | null;   // last time the source produced an item
}

export interface SampleConfig {
  minSampleProbability: number;
  randomJitterMin: number;
  randomJitterMax: number;
  freshnessFactorActive: number;
  freshnessFactorStale: number;
  freshnessWindowDays: number;
  tier2Multiplier: number;
  tier2SamplePercent: number;
  rng?: () => number;
  now?: () => Date;
}

export interface SampledSource extends SampleableSource { weight: number; }

function jitter(cfg: SampleConfig): number {
  const r = (cfg.rng ?? Math.random)();
  return cfg.randomJitterMin + (cfg.randomJitterMax - cfg.randomJitterMin) * r;
}

function freshnessFactor(s: SampleableSource, cfg: SampleConfig): number {
  if (!s.lastSeenIso) return cfg.freshnessFactorStale;
  const now = (cfg.now ?? (() => new Date()))().getTime();
  const last = Date.parse(s.lastSeenIso);
  return (now - last) <= cfg.freshnessWindowDays * 86400000 ? cfg.freshnessFactorActive : cfg.freshnessFactorStale;
}

function quality(s: SampleableSource): number {
  return s.avgRating ?? 0.5;
}

function weightOf(s: SampleableSource, cfg: SampleConfig): number {
  const tierMul = s.tier === 1 ? 1.0 : cfg.tier2Multiplier;
  return Math.max(cfg.minSampleProbability,
    s.baseWeight * quality(s) * freshnessFactor(s, cfg) * jitter(cfg) * tierMul);
}

export function sampleSources(all: SampleableSource[], cfg: SampleConfig): SampledSource[] {
  const rng = cfg.rng ?? Math.random;
  const selected: SampledSource[] = [];
  for (const s of all) {
    const w = weightOf(s, cfg);
    if (s.tier === 1) {
      selected.push({ ...s, weight: w });
    } else {
      if (rng() < cfg.tier2SamplePercent) selected.push({ ...s, weight: w });
    }
  }
  return selected;
}
