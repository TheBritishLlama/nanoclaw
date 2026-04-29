import type Database from 'better-sqlite3';

export function buildExemplarBlock(
  db: Database.Database,
  windowDays: number,
): string {
  const cutoff = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const high = db
    .prepare(
      `
    SELECT q.name, q.bucket, q.tagline, r.rating
    FROM stack_queue q JOIN stack_ratings r ON r.drop_id = q.id
    WHERE r.rated_at >= ? AND r.rating >= 8
    ORDER BY r.rating DESC LIMIT 3
  `,
    )
    .all(cutoff) as any[];
  const low = db
    .prepare(
      `
    SELECT q.name, q.bucket, q.tagline, r.rating
    FROM stack_queue q JOIN stack_ratings r ON r.drop_id = q.id
    WHERE r.rated_at >= ? AND r.rating <= 4
    ORDER BY r.rating ASC LIMIT 1
  `,
    )
    .all(cutoff) as any[];

  const lines: string[] = [];
  if (high.length) {
    lines.push('Kai loved (rated ≥8):');
    for (const h of high) lines.push(`- ${h.bucket}: ${h.name} — ${h.tagline}`);
  }
  if (low.length) {
    lines.push("Kai didn't enjoy (rated ≤4):");
    for (const l of low) lines.push(`- ${l.bucket}: ${l.name} — ${l.tagline}`);
  }
  return lines.join('\n');
}

export function buildRecentFeedbackBlock(
  db: Database.Database,
  windowDays: number,
): string {
  const cutoff = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const rows = db
    .prepare(
      `
    SELECT q.name, r.rating, r.feedback
    FROM stack_ratings r JOIN stack_queue q ON q.id = r.drop_id
    WHERE r.rated_at >= ? AND r.feedback IS NOT NULL AND TRIM(r.feedback) != ''
    ORDER BY r.rated_at DESC LIMIT 5
  `,
    )
    .all(cutoff) as any[];
  if (!rows.length) return '';
  const lines = ['Recent feedback from Kai:'];
  for (const r of rows) {
    lines.push(
      `- Rated ${r.rating}, "${r.name}": ${JSON.stringify(r.feedback)}`,
    );
  }
  return lines.join('\n');
}

export function buildSourceWeightingHint(db: Database.Database): string {
  const lows = db
    .prepare(
      `
    SELECT source, avg_rating FROM stack_source_stats
    WHERE avg_rating IS NOT NULL AND avg_rating < 4
  `,
    )
    .all() as any[];
  if (!lows.length) return '';
  const names = lows
    .map((l) => `${l.source} (avg ${l.avg_rating.toFixed(1)})`)
    .join(', ');
  return `These sources have been low-signal for Kai recently — apply stricter judgment to items from: ${names}.`;
}
