import type {
  DiscoveryAlgorithm,
  DiscoveryContext,
  CandidateSourceObservation,
} from '../registry.js';
import {
  recentDomainMentions,
  listActiveSourceDomains,
  setRecentMentionScore,
  markSourceStaleness,
  getCandidateSource,
  upsertCandidateSource,
  setCandidateRssAndStatus,
} from '../../db.js';
import { discoverRssFeed, isBloomedDomain } from '../rss-discovery.js';

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_MIN_MENTIONS = 5;
const DEFAULT_MIN_DISTINCT = 2;

export const genericAlgorithm: DiscoveryAlgorithm = {
  name: 'generic_algorithm',
  role: 'core',
  async run(ctx: DiscoveryContext): Promise<CandidateSourceObservation[]> {
    const now = (ctx.now ?? (() => new Date()))();
    const windowDays = DEFAULT_WINDOW_DAYS;
    const sinceIso = new Date(
      now.getTime() - windowDays * 86400000,
    ).toISOString();
    const nowIso = now.toISOString();

    const aggregates = recentDomainMentions(ctx.db, sinceIso);
    const aggByDomain = new Map(aggregates.map((a) => [a.domain, a]));
    const active = new Set(listActiveSourceDomains(ctx.db));

    const observed: CandidateSourceObservation[] = [];

    // Active sources: refresh recent_mention_score and staleness flag.
    for (const source of active) {
      const a = aggByDomain.get(source);
      if (a && a.recent_mentions > 0) {
        const score = Math.min(1, a.recent_mentions / 10);
        setRecentMentionScore(ctx.db, source, score, nowIso);
        markSourceStaleness(ctx.db, source, 'fresh', nowIso);
      } else {
        markSourceStaleness(ctx.db, source, 'going_stale', nowIso);
      }
    }

    // Non-active candidates: promote to `candidate` if thresholds met and RSS found.
    for (const a of aggregates) {
      if (active.has(a.domain)) continue;
      if (isBloomedDomain(a.domain, ctx.bloomlist)) continue;
      const existing = getCandidateSource(ctx.db, a.domain);
      if (existing && existing.status !== 'observed') continue;
      if (a.recent_mentions < DEFAULT_MIN_MENTIONS) continue;
      if (a.distinct_source_count < DEFAULT_MIN_DISTINCT) continue;
      upsertCandidateSource(ctx.db, {
        domain: a.domain,
        origin_algorithm: 'generic_algorithm',
        firstObservedAt: nowIso,
      });
      const rss = await discoverRssFeed(a.domain, ctx.webFetch);
      setCandidateRssAndStatus(
        ctx.db,
        a.domain,
        rss,
        rss ? 'candidate' : 'probe_failed',
        nowIso,
      );
      observed.push({
        domain: a.domain,
        origin_algorithm: 'generic_algorithm',
      });
    }

    return observed;
  },
};
