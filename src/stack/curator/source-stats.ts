import type Database from 'better-sqlite3';

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export function recomputeSourceStats(
  db: Database.Database,
  windowDays: number,
): void {
  const cutoff = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const rows = db
    .prepare(
      `
    SELECT q.source_url, r.rating
    FROM stack_queue q JOIN stack_ratings r ON r.drop_id = q.id
    WHERE r.rated_at >= ?
  `,
    )
    .all(cutoff) as { source_url: string; rating: number }[];

  const byHost = new Map<string, number[]>();
  for (const r of rows) {
    const h = hostFromUrl(r.source_url);
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h)!.push(r.rating);
  }

  const now = new Date().toISOString();
  db.prepare('DELETE FROM stack_source_stats').run();
  const ins = db.prepare(`
    INSERT INTO stack_source_stats (source, drop_count, rated_count, avg_rating, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const [host, ratings] of byHost) {
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    ins.run(host, ratings.length, ratings.length, avg, now);
  }
}
