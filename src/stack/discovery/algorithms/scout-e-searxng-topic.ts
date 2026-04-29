import type { DiscoveryAlgorithm, DiscoveryContext, CandidateSourceObservation } from '../registry.js';
import { upsertCandidateSource } from '../../db.js';
import { isBloomedDomain } from '../rss-discovery.js';

const QUERY_TEMPLATES = ['{} blog 2026', '{} self-hosted tools'];

const DEFAULT_LOOKBACK_DAYS = 60;
const DEFAULT_MIN_RATING = 7;
const DEFAULT_MAX_TOPICS = 5;
const DEFAULT_QUERY_BUDGET = 50;

function domainOf(u: string): string | null {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}

function topRatedTags(db: any, sinceIso: string, minRating: number, limit: number): string[] {
  const rows = db.prepare(`
    SELECT q.tags_json AS tags
    FROM stack_queue q JOIN stack_ratings r ON r.drop_id = q.id
    WHERE r.rating >= ? AND r.rated_at >= ?`).all(minRating, sinceIso) as { tags: string }[];
  const counts = new Map<string, number>();
  for (const r of rows) {
    let arr: string[] = [];
    try { arr = JSON.parse(r.tags || '[]'); } catch { /* skip */ }
    for (const t of arr) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
}

export const scoutESearxngTopic: DiscoveryAlgorithm = {
  name: 'scout_E_searxng_topic',
  role: 'supplement',
  async run(ctx: DiscoveryContext): Promise<CandidateSourceObservation[]> {
    if (!ctx.search) return [];
    const now = (ctx.now ?? (() => new Date()))();
    const sinceIso = new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * 86400000).toISOString();
    const nowIso = now.toISOString();

    const topics = topRatedTags(ctx.db, sinceIso, DEFAULT_MIN_RATING, DEFAULT_MAX_TOPICS);
    const observed: CandidateSourceObservation[] = [];
    let queries = 0;

    for (const topic of topics) {
      for (const tmpl of QUERY_TEMPLATES) {
        if (queries >= DEFAULT_QUERY_BUDGET) break;
        const q = tmpl.replace('{}', topic);
        let results;
        try { results = await ctx.search.search(q); } catch { results = []; }
        queries++;
        const seen = new Set<string>();
        for (const r of results) {
          const d = domainOf(r.url);
          if (!d || seen.has(d)) continue;
          if (isBloomedDomain(d, ctx.bloomlist)) continue;
          seen.add(d);
          const ok = await ctx.classify(`Topic: ${topic}\nURL: ${r.url}\nSnippet: ${r.snippet}\n\nIs this a tech/builder blog post that would interest someone studying ${topic}? Answer yes or no.`);
          if (!ok) continue;
          upsertCandidateSource(ctx.db, { domain: d, origin_algorithm: 'scout_E_searxng_topic', firstObservedAt: nowIso });
          observed.push({ domain: d, origin_algorithm: 'scout_E_searxng_topic' });
        }
      }
    }
    return observed;
  },
};
