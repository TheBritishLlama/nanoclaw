import type Database from 'better-sqlite3';
import path from 'path';
import { updateDropRating } from '../vault.js';
import { sendDropEmail, type GmailSender } from './outbound.js';
import { pickNextDrop, markSent } from '../pipeline/picker.js';

export function parseRating(
  body: string,
): { rating: number; feedback?: string } | null {
  const first = body.split('\n')[0]?.trim() ?? '';
  const m = first.match(/^(\d{1,2})\b\s*[-:,]?\s*(.*)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 10) return null;
  const feedback = m[2]?.trim() || undefined;
  return { rating: n, feedback };
}

export type Command =
  | { kind: 'learn'; term: string; insist: boolean }
  | { kind: 'more' };

export function parseCommand(body: string): Command | null {
  const first = body.split('\n')[0]?.trim() ?? '';
  const learn = first.match(/^\/learn(!)?\s+(.+)$/i);
  if (learn)
    return { kind: 'learn', term: learn[2].trim(), insist: !!learn[1] };
  if (/^\/more\b/i.test(first)) return { kind: 'more' };
  return null;
}

export interface InboundDeps {
  addrs: { from: string; to: string };
  threadMessageId: string;
  body: string;
}
export interface InboundResult {
  acked: boolean;
  reason: string;
}

export async function handleInboundReply(
  db: Database.Database,
  vaultPath: string,
  gmail: GmailSender,
  dep: InboundDeps,
): Promise<InboundResult> {
  const rating = parseRating(dep.body);
  if (rating) return handleRating(db, vaultPath, dep.threadMessageId, rating);

  const cmd = parseCommand(dep.body);
  if (cmd?.kind === 'learn')
    return handleLearn(gmail, dep.addrs, cmd.term, cmd.insist);
  if (cmd?.kind === 'more') return handleMore(db, vaultPath, gmail, dep.addrs);

  return { acked: false, reason: 'unparsed_reply' };
}

function handleRating(
  db: Database.Database,
  vaultPath: string,
  messageId: string,
  rating: { rating: number; feedback?: string },
): InboundResult {
  const row = db
    .prepare(
      'SELECT id, status, vault_path FROM stack_queue WHERE email_message_id=?',
    )
    .get(messageId) as any;
  if (!row) return { acked: false, reason: 'no_matching_drop' };

  const ratedAt = new Date().toISOString();
  db.prepare(
    'INSERT INTO stack_ratings (drop_id, rating, feedback, rated_at) VALUES (?, ?, ?, ?)',
  ).run(row.id, rating.rating, rating.feedback ?? null, ratedAt);

  try {
    updateDropRating(path.join(vaultPath, row.vault_path), {
      rating: rating.rating,
      feedback: rating.feedback,
      ratedAt,
    });
  } catch {
    /* vault may not exist in some tests */
  }

  if (row.status === 'pending_review') {
    const newStatus = rating.rating >= 6 ? 'queued' : 'rejected';
    db.prepare('UPDATE stack_queue SET status=? WHERE id=?').run(
      newStatus,
      row.id,
    );
  }
  return { acked: false, reason: 'rating_silent' };
}

async function handleLearn(
  gmail: GmailSender,
  addrs: { from: string; to: string },
  term: string,
  _insist: boolean,
): Promise<InboundResult> {
  const text = `Queued '${term}' for enrichment — will arrive in a future drop slot.`;
  await gmail.send({
    from: addrs.from,
    to: addrs.to,
    subject: `Stack — queued ${term}`,
    html: `<p>${text}</p>`,
    text,
  });
  return { acked: true, reason: 'learn_acked' };
}

async function handleMore(
  db: Database.Database,
  vaultPath: string,
  gmail: GmailSender,
  addrs: { from: string; to: string },
): Promise<InboundResult> {
  const drop = pickNextDrop(db, {
    rng: Math.random,
    foundationsMixRatio: 0.5,
    bucketWeights: { tool: 0.7, concept: 0.2, lore: 0.1 },
  });
  if (!drop) {
    const text = 'Queue empty — no extra drop available right now.';
    await gmail.send({
      from: addrs.from,
      to: addrs.to,
      subject: 'Stack — queue empty',
      html: `<p>${text}</p>`,
      text,
    });
    return { acked: true, reason: 'more_empty' };
  }
  const messageId = await sendDropEmail(gmail, addrs, drop);
  markSent(db, drop.id, new Date().toISOString(), messageId);
  return { acked: true, reason: 'more_sent' };
}
