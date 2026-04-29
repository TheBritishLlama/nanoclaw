import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyStackSchema, getCandidateSource } from '../../../src/stack/db.js';
import { runPromotionPass, type PromotionConfig } from '../../../src/stack/discovery/promote.js';

const CONFIG: PromotionConfig = {
  trialDropsCount: 5,
  promotionMinAvgRating: 6,
  archiveMaxAvgRating: 4,
  trialWindowDays: 60,
  demotionMinRatedCount: 20,
  demotionAvgRatingThreshold: 3,
  now: () => new Date('2026-04-28T00:00:00Z'),
};

function seedCandidate(db: Database.Database, domain: string, status: 'candidate'|'promoted', trialDropsSent = 0) {
  db.prepare(`INSERT INTO stack_candidate_sources
    (domain, origin_algorithm, first_observed_at, occurrence_count, status, trial_drops_sent)
    VALUES (?, 'scout_A_hn_comments', '2026-03-01T00:00:00Z', 5, ?, ?)`).run(domain, status, trialDropsSent);
}

function seedTrialRating(db: Database.Database, dropId: string, sourceUrl: string, rating: number, ratedAt: string) {
  db.prepare(`INSERT INTO stack_queue
    (id,bucket,name,tagline,body_html,body_plain,source_url,source_fetched_at,tags_json,confidence,status,vault_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    dropId, 'tool', 'X', 't', '<p>x</p>', 'x', sourceUrl, '2026-04-01T00:00:00Z',
    '[]', 0.9, 'sent', 'p', '2026-04-01T00:00:00Z'
  );
  db.prepare(`INSERT INTO stack_ratings (drop_id, rating, rated_at) VALUES (?,?,?)`).run(dropId, rating, ratedAt);
}

describe('runPromotionPass', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyStackSchema(db); });

  it('promotes a candidate with enough trial drops and high avg rating', () => {
    seedCandidate(db, 'rising.dev', 'candidate', 5);
    for (let i = 0; i < 5; i++) seedTrialRating(db, `d${i}`, 'https://rising.dev/x', 8, '2026-04-20T00:00:00Z');
    runPromotionPass(db, CONFIG);
    expect(getCandidateSource(db, 'rising.dev')!.status).toBe('promoted');
  });

  it('archives a candidate with enough trial drops and low avg rating', () => {
    seedCandidate(db, 'meh.dev', 'candidate', 5);
    for (let i = 0; i < 5; i++) seedTrialRating(db, `e${i}`, 'https://meh.dev/x', 3, '2026-04-20T00:00:00Z');
    runPromotionPass(db, CONFIG);
    expect(getCandidateSource(db, 'meh.dev')!.status).toBe('archived');
  });

  it('leaves a candidate alone before the trial period completes', () => {
    seedCandidate(db, 'newish.dev', 'candidate', 2);
    for (let i = 0; i < 2; i++) seedTrialRating(db, `f${i}`, 'https://newish.dev/x', 8, '2026-04-20T00:00:00Z');
    runPromotionPass(db, CONFIG);
    expect(getCandidateSource(db, 'newish.dev')!.status).toBe('candidate');
  });
});
