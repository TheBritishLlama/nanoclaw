import type { Drop } from '../types.js';

export interface RenderedEmail { subject: string; html: string; text: string; }
export interface GmailSender { send(args: { from: string; to: string; subject: string; html: string; text: string }): Promise<{ messageId: string }>; }

const SUBJECT_PREFIX: Record<Drop['bucket'], string> = {
  tool: 'Stack — ',
  concept: 'Stack — Concept: ',
  lore: 'Stack — Lore: ',
  foundation: 'Stack — Basics: ',
};

export function renderDropEmail(drop: Drop): RenderedEmail {
  const subject = `${SUBJECT_PREFIX[drop.bucket]}${drop.name}`;
  const html = `
<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;max-width:640px;margin:auto;line-height:1.5">
<h2 style="margin-bottom:0">${drop.name}</h2>
<p style="margin-top:4px;color:#555">${drop.tagline}</p>
${drop.bodyHtml}
<hr style="margin-top:24px;border:none;border-top:1px solid #ddd">
<p style="font-size:12px;color:#777">
  Source: <a href="${drop.sourceUrl}">${drop.sourceUrl}</a><br>
  Reply with a number 1–10 to rate (optional text after the number teaches the curator). Reply <code>/learn X</code> to queue a tool. Reply <code>/more</code> for another drop.
</p>
</body></html>`.trim();
  const text = `${drop.name} — ${drop.tagline}\n\n${drop.bodyPlain}\n\nSource: ${drop.sourceUrl}\n\nReply 1-10 to rate.`;
  return { subject, html, text };
}

export function renderReviewEmail(drop: Drop): RenderedEmail {
  const r = renderDropEmail(drop);
  const subject = `[Stack Review] ${drop.name}`;
  const html = r.html.replace(
    'Reply with a number 1–10 to rate',
    'Reply with a number ≥6 to approve and add to queue, &lt;6 to reject',
  );
  return { subject, html, text: r.text };
}

export async function sendDropEmail(
  gmail: GmailSender,
  addrs: { from: string; to: string },
  drop: Drop,
): Promise<string> {
  const e = renderDropEmail(drop);
  const r = await gmail.send({ from: addrs.from, to: addrs.to, ...e });
  return r.messageId;
}

export async function sendReviewEmail(
  gmail: GmailSender,
  addrs: { from: string; to: string },
  drop: Drop,
): Promise<string> {
  const e = renderReviewEmail(drop);
  const r = await gmail.send({ from: addrs.from, to: addrs.to, ...e });
  return r.messageId;
}
