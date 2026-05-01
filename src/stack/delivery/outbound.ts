import type { Drop } from '../types.js';

// The enricher templates end each drop body with a "[source: {url}]" line.
// In multi-drop emails we strip that from each section and consolidate all
// sources into a single footer block at the bottom.
const INLINE_SOURCE_RE = /\n*\[source:\s*[^\]]+\]\s*$/i;

function stripInlineSource(plain: string): string {
  return plain.replace(INLINE_SOURCE_RE, '').trimEnd();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bodyHtmlWithoutInlineSource(html: string): string {
  // The bodyHtml is mdToHtml-rendered Markdown. Strip a trailing `[source:` ...
  // section regardless of whether it landed inside a <p> or as plain text.
  return html
    .replace(/<p>\s*\[source:[\s\S]*?<\/p>\s*$/i, '')
    .replace(/\[source:\s*[^\]]+\]\s*<\/p>\s*$/i, '</p>')
    .replace(/\[source:\s*[^\]]+\]\s*$/i, '')
    .trimEnd();
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}
export interface GmailSender {
  send(args: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ messageId: string }>;
}

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

const MULTI_SUBJECT_PREFIX: Record<Drop['bucket'], string> = {
  tool: '',
  concept: 'Concept · ',
  lore: 'Lore · ',
  foundation: 'Basics · ',
};

export function renderMultiDropEmail(drops: Drop[]): RenderedEmail {
  if (drops.length === 1) return renderDropEmail(drops[0]);

  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const subject = `Stack — ${date}: ${drops
    .map((d) => `${MULTI_SUBJECT_PREFIX[d.bucket]}${d.name}`)
    .join(' · ')}`;

  const sections = drops
    .map(
      (d) => `
<section style="margin-bottom:32px">
  <h2 style="margin-bottom:0">${escapeHtml(d.name)}</h2>
  <p style="margin-top:4px;color:#555">${escapeHtml(d.tagline)}</p>
  ${bodyHtmlWithoutInlineSource(d.bodyHtml)}
</section>`,
    )
    .join('\n');

  const sourcesList = drops
    .map(
      (d, i) =>
        `<li style="margin-bottom:4px"><strong>${escapeHtml(d.name)}</strong> &mdash; <a href="${escapeHtml(d.sourceUrl)}">${escapeHtml(d.sourceUrl)}</a></li>`,
    )
    .join('\n');

  const html = `
<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;max-width:640px;margin:auto;line-height:1.5">
${sections}
<hr style="margin-top:24px;border:none;border-top:1px solid #ddd">
<p style="font-size:13px;color:#444;margin-bottom:8px"><strong>Sources</strong></p>
<ul style="font-size:12px;color:#666;padding-left:18px;margin-top:0">
${sourcesList}
</ul>
<p style="font-size:12px;color:#777;margin-top:16px">
  Reply with a number 1–10 to rate this email (the rating applies to all topics above; optional text after the number teaches the curator). Reply <code>/learn X</code> to queue a topic. Reply <code>/more</code> for another email.
</p>
</body></html>`.trim();

  const textSections = drops
    .map((d) => `${d.name} — ${d.tagline}\n\n${stripInlineSource(d.bodyPlain)}`)
    .join('\n\n---\n\n');
  const textSources = drops
    .map((d) => `  ${d.name} — ${d.sourceUrl}`)
    .join('\n');
  const text = `${textSections}\n\nSources:\n${textSources}\n\nReply 1-10 to rate.`;

  return { subject, html, text };
}

export async function sendMultiDropEmail(
  gmail: GmailSender,
  addrs: { from: string; to: string },
  drops: Drop[],
): Promise<string> {
  const e = renderMultiDropEmail(drops);
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
