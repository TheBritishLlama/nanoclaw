import { describe, it, expect, vi } from 'vitest';
import { enrich } from '../../../src/stack/pipeline/enricher.js';
import type { Graded } from '../../../src/stack/types.js';

describe('enrich', () => {
  it('returns Drop on successful grounded enrichment', async () => {
    const haiku = {
      complete: vi.fn().mockResolvedValue(JSON.stringify({
        name: 'Tailscale', tagline: 'Zero-config WireGuard',
        body: '**Tailscale** — body markdown', tags: ['vpn'], groundable: true,
      })),
    };
    const webFetch = vi.fn().mockResolvedValue('<html>tailscale source page</html>');
    const graded: Graded = {
      raw: { source:'hn', title:'Tailscale', url:'https://tailscale.com', fetchedAt:'t' },
      keep: true, bucket: 'tool', confidence: 0.9, reasoning: '',
    };
    const drop = await enrich(haiku as any, webFetch, graded);
    expect(drop).not.toBeNull();
    expect(drop!.name).toBe('Tailscale');
    expect(drop!.tags).toEqual(['vpn']);
    expect(drop!.bodyHtml).toContain('Tailscale');
  });

  it('returns null when enricher reports !groundable', async () => {
    const haiku = {
      complete: vi.fn().mockResolvedValue(JSON.stringify({
        name: '?', tagline: '', body: '', tags: [], groundable: false,
      })),
    };
    const webFetch = vi.fn().mockResolvedValue('insufficient content');
    const graded: Graded = {
      raw: { source:'hn', title:'X', url:'https://x', fetchedAt:'t' },
      keep: true, bucket: 'tool', confidence: 0.9, reasoning: '',
    };
    const drop = await enrich(haiku as any, webFetch, graded);
    expect(drop).toBeNull();
  });
});
