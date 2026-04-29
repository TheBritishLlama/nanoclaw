import fs from 'fs';
import path from 'path';
import type { Drop } from './types.js';

const SUBDIRS = [
  'Drops/Tools',
  'Drops/Concepts',
  'Drops/Lore',
  'Drops/Foundations',
  'Scraped/Pending',
  'Scraped/Dropped',
  'Reviews',
  'Index',
];

export function initVault(vaultPath: string): void {
  for (const sub of SUBDIRS) {
    fs.mkdirSync(path.join(vaultPath, sub), { recursive: true });
  }
  const readme = path.join(vaultPath, 'Stack.md');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      '# Stack\n\nDaily-drop tutor knowledge base. Drops live under `Drops/`. Scrape decisions under `Scraped/`. Pending review items under `Reviews/`.\n',
    );
  }
}

const BUCKET_DIR: Record<Drop['bucket'], string> = {
  tool: 'Drops/Tools',
  concept: 'Drops/Concepts',
  lore: 'Drops/Lore',
  foundation: 'Drops/Foundations',
};

function safeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '-');
}

export function writeDrop(vaultPath: string, drop: Drop): string {
  const filename = `${safeFilename(drop.name)}.md`;
  const relPath = path.join(BUCKET_DIR[drop.bucket], filename);
  const fullPath = path.join(vaultPath, relPath);
  const fm = [
    '---',
    `id: ${drop.id}`,
    `name: ${JSON.stringify(drop.name)}`,
    `bucket: ${drop.bucket}`,
    `source: ${drop.sourceUrl}`,
    `fetched: ${drop.sourceFetchedAt}`,
    `status: ${drop.status}`,
    `confidence: ${drop.confidence}`,
    `tags: ${JSON.stringify(drop.tags)}`,
    drop.sentAt ? `sent: ${drop.sentAt}` : null,
    drop.rating != null ? `rating: ${drop.rating}` : null,
    drop.ratedAt ? `ratedAt: ${drop.ratedAt}` : null,
    '---',
    '',
    drop.bodyHtml,
    '',
  ]
    .filter((l) => l !== null)
    .join('\n');
  fs.writeFileSync(fullPath, fm);
  return fullPath;
}

export function readDropFrontmatter(filePath: string): Record<string, any> {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error(`No frontmatter in ${filePath}`);
  const out: Record<string, any> = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    try {
      out[key] = JSON.parse(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

export function updateDropRating(
  filePath: string,
  rating: { rating: number; feedback?: string; ratedAt: string },
): void {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const m = raw.match(/^(---\n)([\s\S]*?)(\n---\n[\s\S]*)$/);
  if (!m) throw new Error(`No frontmatter in ${filePath}`);
  const lines = m[2]
    .split('\n')
    .filter(
      (l) =>
        !l.startsWith('rating:') &&
        !l.startsWith('ratedAt:') &&
        !l.startsWith('feedback:'),
    );
  lines.push(`rating: ${rating.rating}`);
  lines.push(`ratedAt: ${rating.ratedAt}`);
  if (rating.feedback)
    lines.push(`feedback: ${JSON.stringify(rating.feedback)}`);
  fs.writeFileSync(filePath, m[1] + lines.join('\n') + m[3]);
}
