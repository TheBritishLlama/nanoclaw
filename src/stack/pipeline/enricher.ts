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

export async function enrich(
  haiku: HaikuClient,
  webFetch: WebFetcher,
  graded: Graded,
): Promise<Drop | null> {
  if (!graded.keep || !graded.bucket) return null;
  let html: string;
  try {
    html = await webFetch(graded.raw.url);
  } catch {
    return null;
  }
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
    parsed = JSON.parse(raw);
  } catch {
    return null;
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
