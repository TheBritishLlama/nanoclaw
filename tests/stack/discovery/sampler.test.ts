import { describe, it, expect } from 'vitest';
import { sampleSources, type SampleableSource, type SampleConfig } from '../../../src/stack/discovery/sampler.js';

const cfg: SampleConfig = {
  minSampleProbability: 0.10,
  randomJitterMin: 0.7,
  randomJitterMax: 1.3,
  freshnessFactorActive: 1.0,
  freshnessFactorStale: 0.6,
  freshnessWindowDays: 7,
  tier2Multiplier: 0.3,
  tier2SamplePercent: 0.3,
  rng: () => 0.5,
  now: () => new Date('2026-04-28T00:00:00Z'),
};

const t1 = (name: string, opts: Partial<SampleableSource> = {}): SampleableSource => ({
  name, tier: 1, baseWeight: 1.0, avgRating: 0.7, lastSeenIso: '2026-04-25T00:00:00Z', ...opts,
});

describe('sampleSources', () => {
  it('returns all Tier 1 sources (deterministic include)', () => {
    const out = sampleSources([t1('hn'), t1('lobsters'), t1('rss:simon')], cfg);
    expect(out.map(s => s.name).sort()).toEqual(['hn', 'lobsters', 'rss:simon']);
  });

  it('selects roughly tier2SamplePercent of Tier 2 sources', () => {
    const t2: SampleableSource[] = Array.from({ length: 20 }, (_, i) => ({
      name: `cand-${i}`, tier: 2, baseWeight: 1.0, avgRating: 0.5, lastSeenIso: '2026-04-25T00:00:00Z',
    }));
    const out = sampleSources([...t2], { ...cfg, rng: () => 0.2 });
    expect(out.length).toBe(20);
    const out2 = sampleSources([...t2], { ...cfg, rng: () => 0.9 });
    expect(out2.length).toBe(0);
  });

  it('boosts a fresh source above a stale one of equal base weight', () => {
    const fresh = t1('fresh', { lastSeenIso: '2026-04-27T00:00:00Z' });
    const stale = t1('stale', { lastSeenIso: '2026-03-01T00:00:00Z' });
    const out = sampleSources([fresh, stale], cfg);
    expect(out.find(s => s.name === 'fresh')!.weight).toBeGreaterThan(out.find(s => s.name === 'stale')!.weight);
  });
});
