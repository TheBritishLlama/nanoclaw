import type Database from 'better-sqlite3';
import { listCandidatesByStatus } from '../db.js';

export interface PromotionConfig {
  trialDropsCount: number;
  promotionMinAvgRating: number;
  archiveMaxAvgRating: number;
  trialWindowDays: number;
  demotionMinRatedCount: number;
  demotionAvgRatingThreshold: number;
  now?: () => Date;
}

interface TrialStats { count: number; avg: number | null; }

function trialStatsForDomain(db: Database.Database, domain: string, sinceIso: string): TrialStats {
  const row = db.prepare(`
    SELECT COUNT(r.rating) AS c, AVG(r.rating) AS a
    FROM stack_queue q JOIN stack_ratings r ON r.drop_id = q.id
    WHERE q.source_url LIKE ? AND r.rated_at >= ?`).get(`%${domain}%`, sinceIso) as { c: number; a: number | null };
  return { count: row?.c ?? 0, avg: row?.a ?? null };
}

function setStatus(db: Database.Database, domain: string, status: string, atIso: string): void {
  db.prepare(`UPDATE stack_candidate_sources
              SET status = ?,
                  promoted_at = CASE WHEN ? = 'promoted' THEN ? ELSE promoted_at END
              WHERE domain = ?`).run(status, status, atIso, domain);
}

export function runPromotionPass(db: Database.Database, cfg: PromotionConfig): void {
  const now = (cfg.now ?? (() => new Date()))();
  const sinceIso = new Date(now.getTime() - cfg.trialWindowDays * 86400000).toISOString();
  const nowIso = now.toISOString();

  for (const c of listCandidatesByStatus(db, 'candidate')) {
    const s = trialStatsForDomain(db, c.domain, sinceIso);
    db.prepare(`UPDATE stack_candidate_sources SET trial_drops_sent = ?, trial_avg_rating = ? WHERE domain = ?`)
      .run(s.count, s.avg, c.domain);
    if (s.count < cfg.trialDropsCount) continue;
    if ((s.avg ?? 0) >= cfg.promotionMinAvgRating) setStatus(db, c.domain, 'promoted', nowIso);
    else if ((s.avg ?? 10) <= cfg.archiveMaxAvgRating) setStatus(db, c.domain, 'archived', nowIso);
  }

  for (const c of listCandidatesByStatus(db, 'promoted')) {
    const row = db.prepare(`
      SELECT COUNT(r.rating) AS c, AVG(r.rating) AS a
      FROM stack_queue q JOIN stack_ratings r ON r.drop_id = q.id
      WHERE q.source_url LIKE ?`).get(`%${c.domain}%`) as { c: number; a: number };
    if ((row?.c ?? 0) >= cfg.demotionMinRatedCount && row.a < cfg.demotionAvgRatingThreshold) {
      setStatus(db, c.domain, 'archived', nowIso);
    }
  }
}
