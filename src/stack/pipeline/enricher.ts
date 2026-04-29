import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import type { Drop, Graded } from '../types.js';
import { extractReadable } from './reader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_DIR = path.join(__dirname, '../../../groups/stack/prompts');

export interface HaikuClient {
  complete(prompt: string): Promise<string>;
}
export type WebFetcher = (url: string) => Promise<string>;

function loadTemplate(bucket: Drop['bucket']): string {
  return fs.readFileSync(path.join(PROMPT_DIR, `${bucket}.md`), 'utf-8');
}

function mdToHtml(md: string): string {
  return (
    md
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^/, '<p>') + '</p>'
  );
}

// Haiku frequently wraps JSON output in ```json ... ``` markdown fences,
// even when the prompt asks for "ONLY a JSON object". Strip the fences so
// JSON.parse can succeed.
function unwrapJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Throws on transient failures (network, JSON parse) so callers can distinguish
 * "retry this URL on the next run" from "this URL is genuinely ungroundable
 * and should be marked done." Returns null only when Haiku says
 * groundable: false on a well-formed JSON response.
 */
export async function enrich(
  haiku: HaikuClient,
  webFetch: WebFetcher,
  graded: Graded,
): Promise<Drop | null> {
  if (!graded.keep || !graded.bucket) return null;
  // Network / fetch errors propagate as exceptions — caller decides retry.
  const html = await webFetch(graded.raw.url);
  const extracted = extractReadable(html, graded.raw.url);
  const source = (extracted?.textContent ?? html).slice(0, 6000);
  const tmpl = loadTemplate(graded.bucket)
    .replace('{{URL}}', graded.raw.url)
    .replace('{{SOURCE}}', source);
  const raw = await haiku.complete(tmpl);
  let parsed: {
    name: string;
    tagline: string;
    body: string;
    tags: string[];
    groundable: boolean;
  };
  try {
    parsed = JSON.parse(unwrapJsonFences(raw));
  } catch (e) {
    // Malformed Haiku output is transient (model variance) — let the caller
    // decide whether to retry rather than silently dropping the item.
    throw new Error(
      `Haiku returned non-JSON for ${graded.raw.url}: ${(e as Error).message}`,
    );
  }
  if (!parsed.groundable) return null;
  return {
    id: `drop_${Date.now()}_${randomUUID().slice(0, 8)}`,
    bucket: graded.bucket,
    name: parsed.name,
    tagline: parsed.tagline,
    bodyHtml: mdToHtml(parsed.body),
    bodyPlain: parsed.body,
    sourceUrl: graded.raw.url,
    sourceFetchedAt: graded.raw.fetchedAt,
    tags: parsed.tags ?? [],
    confidence: graded.confidence,
    status: graded.confidence >= 0.7 ? 'queued' : 'pending_review',
    vaultPath: '',
    createdAt: new Date().toISOString(),
  };
}
