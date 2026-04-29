import { describe, it, expect, vi } from 'vitest';
import { renderDropEmail, renderReviewEmail, sendDropEmail } from '../../../src/stack/delivery/outbound.js';
import type { Drop } from '../../../src/stack/types.js';

const drop: Drop = {
  id:'d1', bucket:'tool', name:'Tailscale', tagline:'Zero-config WireGuard',
  bodyHtml:'<p>body</p>', bodyPlain:'body',
  sourceUrl:'https://tailscale.com', sourceFetchedAt:'t', tags:[],
  confidence:0.9, status:'queued', vaultPath:'', createdAt:'t',
};

describe('renderDropEmail', () => {
  it('produces HTML with name, tagline, body, source link, footer', () => {
    const e = renderDropEmail(drop);
    expect(e.subject).toBe('Stack — Tailscale');
    expect(e.html).toContain('Tailscale');
    expect(e.html).toContain('Zero-config WireGuard');
    expect(e.html).toContain('<p>body</p>');
    expect(e.html).toContain('https://tailscale.com');
    expect(e.html).toContain('Reply with a number 1–10');
    expect(e.text).toContain('Tailscale');
  });

  it('uses bucket-specific subject prefix', () => {
    expect(renderDropEmail({...drop, bucket:'concept'}).subject).toBe('Stack — Concept: Tailscale');
    expect(renderDropEmail({...drop, bucket:'lore'}).subject).toBe('Stack — Lore: Tailscale');
    expect(renderDropEmail({...drop, bucket:'foundation'}).subject).toBe('Stack — Basics: Tailscale');
  });
});

describe('renderReviewEmail', () => {
  it('produces a subject prefixed with [Stack Review]', () => {
    const e = renderReviewEmail(drop);
    expect(e.subject).toBe('[Stack Review] Tailscale');
    expect(e.html).toContain('Reply with a number ≥6 to approve');
  });
});

describe('sendDropEmail', () => {
  it('calls gmail.send with the rendered email and returns messageId', async () => {
    const gmail = { send: vi.fn().mockResolvedValue({ messageId: 'msg-123' }) };
    const id = await sendDropEmail(gmail as any, {
      from: 'a@b.com', to: 'c@d.com',
    }, drop);
    expect(id).toBe('msg-123');
    expect(gmail.send).toHaveBeenCalledWith(expect.objectContaining({
      from: 'a@b.com', to: 'c@d.com', subject: 'Stack — Tailscale',
    }));
  });
});
