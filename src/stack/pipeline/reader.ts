import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export interface ExtractedArticle {
  title: string | null;
  textContent: string;
  length: number;
}

const MIN_TEXT_LENGTH = 200;

export function extractReadable(html: string, url: string): ExtractedArticle | null {
  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url });
  } catch {
    return null;
  }
  let parsed: ReturnType<Readability['parse']>;
  try {
    parsed = new Readability(dom.window.document).parse();
  } catch {
    return null;
  }
  if (!parsed) return null;
  const text = (parsed.textContent ?? '').trim();
  if (text.length < MIN_TEXT_LENGTH) return null;
  return { title: parsed.title ?? null, textContent: text, length: text.length };
}
