import { describe, it, expect, vi } from 'vitest';
import { gradeBatch } from '../../../src/stack/pipeline/grader.js';
import type { RawItem } from '../../../src/stack/types.js';

describe('gradeBatch', () => {
  it('parses NDJSON output into Graded[]', async () => {
    const ollama = {
      generate: vi.fn().mockResolvedValue([
        '{"url":"https://a","keep":true,"bucket":"tool","confidence":0.9,"reasoning":"ok"}',
        '{"url":"https://b","keep":false,"bucket":null,"confidence":0.7,"reasoning":"noise"}',
      ].join('\n')),
    };
    const items: RawItem[] = [
      { source:'hn', title:'A', url:'https://a', fetchedAt:'t' },
      { source:'hn', title:'B', url:'https://b', fetchedAt:'t' },
    ];
    const out = await gradeBatch(ollama as any, 'qwen3:14b', items, {
      exemplarBlock: '', recentFeedbackBlock: '', sourceWeightingHint: '',
    });
    expect(out).toHaveLength(2);
    expect(out[0].keep).toBe(true);
    expect(out[0].bucket).toBe('tool');
    expect(out[1].keep).toBe(false);
  });

  it('drops malformed lines', async () => {
    const ollama = {
      generate: vi.fn().mockResolvedValue([
        '{"url":"https://a","keep":true,"bucket":"tool","confidence":0.9,"reasoning":"ok"}',
        'this is not json',
      ].join('\n')),
    };
    const items: RawItem[] = [{ source:'hn', title:'A', url:'https://a', fetchedAt:'t' }];
    const out = await gradeBatch(ollama as any, 'qwen3:14b', items, {
      exemplarBlock: '', recentFeedbackBlock: '', sourceWeightingHint: '',
    });
    expect(out).toHaveLength(1);
  });
});
