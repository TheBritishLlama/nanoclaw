import * as cheerio from 'cheerio';
import type {
  DiscoveryAlgorithm,
  DiscoveryContext,
  CandidateSourceObservation,
} from '../registry.js';
import { upsertCandidateSource } from '../../db.js';
import { isBloomedDomain } from '../rss-discovery.js';

const LOBSTERS_RE = /\blobste\.rs\/s\//i;

const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_MIN_RATING = 7;

function domainOf(u: string): string | null {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function highRatedLobstersStories(
  db: any,
  sinceIso: string,
  minRating: number,
): string[] {
  const rows = db
    .prepare(
      `
    SELECT DISTINCT q.source_url AS url
    FROM stack_queue q JOIN stack_ratings r ON r.drop_id = q.id
    WHERE r.rating >= ? AND r.rated_at >= ?`,
    )
    .all(minRating, sinceIso) as { url: string }[];
  return rows.map((r) => r.url).filter((u) => LOBSTERS_RE.test(u));
}

export const scoutBLobstersComments: DiscoveryAlgorithm = {
  name: 'scout_B_lobsters_comments',
  role: 'supplement',
  async run(ctx: DiscoveryContext): Promise<CandidateSourceObservation[]> {
    const now = (ctx.now ?? (() => new Date()))();
    const sinceIso = new Date(
      now.getTime() - DEFAULT_LOOKBACK_DAYS * 86400000,
    ).toISOString();
    const nowIso = now.toISOString();
    const stories = highRatedLobstersStories(
      ctx.db,
      sinceIso,
      DEFAULT_MIN_RATING,
    );
    const observed: CandidateSourceObservation[] = [];
    for (const url of stories) {
      let res;
      try {
        res = await ctx.webFetch(url);
      } catch {
        continue;
      }
      if (!res.ok) continue;
      const $ = cheerio.load(await res.text());
      const candidates = new Map<string, string>();
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (!/^https?:\/\//i.test(href)) return;
        const d = domainOf(href);
        if (!d || isBloomedDomain(d, ctx.bloomlist)) return;
        if (!candidates.has(d)) candidates.set(d, href);
      });
      for (const [d, sample] of candidates) {
        const ok = await ctx.classify(
          `Domain: ${d}\nSample link: ${sample}\n\nIs this a high-signal indie/tech blog or tool docs page? Answer yes or no.`,
        );
        if (!ok) continue;
        upsertCandidateSource(ctx.db, {
          domain: d,
          origin_algorithm: 'scout_B_lobsters_comments',
          firstObservedAt: nowIso,
        });
        observed.push({
          domain: d,
          origin_algorithm: 'scout_B_lobsters_comments',
        });
      }
    }
    return observed;
  },
};
