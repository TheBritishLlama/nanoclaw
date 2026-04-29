import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { OllamaClient } from '../ollama.js';
import type { Graded, RawItem } from '../types.js';
import { isBucket } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.join(
  __dirname,
  '../../../groups/stack/prompts/grader.md',
);

export interface GraderContext {
  exemplarBlock: string;
  recentFeedbackBlock: string;
  sourceWeightingHint: string;
}

export async function gradeBatch(
  ollama: OllamaClient,
  model: string,
  items: RawItem[],
  ctx: GraderContext,
): Promise<Graded[]> {
  if (items.length === 0) return [];
  const template = fs.readFileSync(PROMPT_PATH, 'utf-8');
  const prompt = template
    .replace('{{EXEMPLAR_BLOCK}}', ctx.exemplarBlock)
    .replace('{{RECENT_FEEDBACK_BLOCK}}', ctx.recentFeedbackBlock)
    .replace('{{SOURCE_WEIGHTING_HINT}}', ctx.sourceWeightingHint)
    .replace(
      '{{ITEMS}}',
      JSON.stringify(
        items.map((i) => ({
          source: i.source,
          title: i.title,
          url: i.url,
          blurb: i.blurb,
        })),
        null,
        2,
      ),
    );

  const raw = await ollama.generate(model, prompt, { temperature: 0.2 });
  const out: Graded[] = [];
  const byUrl = new Map(items.map((i) => [i.url, i]));
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const j = JSON.parse(trimmed);
      const item = byUrl.get(j.url);
      if (!item) continue;
      out.push({
        raw: item,
        keep: !!j.keep,
        bucket: j.bucket && isBucket(j.bucket) ? j.bucket : undefined,
        confidence: typeof j.confidence === 'number' ? j.confidence : 0.5,
        reasoning: j.reasoning ?? '',
      });
    } catch {
      /* skip */
    }
  }
  return out;
}
