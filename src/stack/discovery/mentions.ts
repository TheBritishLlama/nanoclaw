import type Database from 'better-sqlite3';
import type { RawItem } from '../types.js';
import { insertDomainMention } from '../db.js';
import { isBloomedDomain } from './rss-discovery.js';

const URL_RE = /https?:\/\/[^\s"'<>]+/gi;

function domainOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}

export function observeMentions(
  db: Database.Database,
  items: RawItem[],
  bloomlist: string[],
  observedAt: string,
): void {
  for (const item of items) {
    const seen = new Set<string>();
    const direct = domainOf(item.url);
    if (direct && !isBloomedDomain(direct, bloomlist)) {
      insertDomainMention(db, { domain: direct, source: item.source, observedAt });
      seen.add(direct);
    }
    if (item.blurb) {
      for (const m of item.blurb.matchAll(URL_RE)) {
        const d = domainOf(m[0]);
        if (!d || seen.has(d) || isBloomedDomain(d, bloomlist)) continue;
        insertDomainMention(db, { domain: d, source: item.source, observedAt });
        seen.add(d);
      }
    }
  }
}
