import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initVault, writeDrop, readDropFrontmatter, updateDropRating } from '../../src/stack/vault.js';
import type { Drop } from '../../src/stack/types.js';

describe('vault writer', () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-vault-'));
    initVault(vaultPath);
  });

  it('initializes the vault with directory skeleton', () => {
    expect(fs.existsSync(path.join(vaultPath, 'Drops/Tools'))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, 'Drops/Concepts'))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, 'Drops/Lore'))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, 'Drops/Foundations'))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, 'Scraped/Pending'))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, 'Scraped/Dropped'))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, 'Reviews'))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, 'Stack.md'))).toBe(true);
  });

  it('writes a drop and round-trips frontmatter', () => {
    const drop: Drop = {
      id: 'd1', bucket: 'tool', name: 'Tailscale',
      tagline: 'Zero-config WireGuard', bodyHtml: '<p>x</p>', bodyPlain: 'x',
      sourceUrl: 'https://tailscale.com', sourceFetchedAt: '2026-04-27T02:00:00Z',
      tags: ['vpn','networking'], confidence: 0.9, status: 'queued',
      vaultPath: '', createdAt: '2026-04-27T02:30:00Z',
    };
    const writtenPath = writeDrop(vaultPath, drop);
    expect(writtenPath).toBe(path.join(vaultPath, 'Drops/Tools/Tailscale.md'));
    const fm = readDropFrontmatter(writtenPath);
    expect(fm.name).toBe('Tailscale');
    expect(fm.bucket).toBe('tool');
    expect(fm.tags).toEqual(['vpn','networking']);
  });

  it('updates rating in frontmatter without rewriting body', () => {
    const drop: Drop = {
      id: 'd2', bucket: 'concept', name: 'Reverse-proxy',
      tagline: '...', bodyHtml: '<p>body</p>', bodyPlain: 'body',
      sourceUrl: 'https://x', sourceFetchedAt: '2026-04-27T02:00:00Z',
      tags: [], confidence: 0.8, status: 'sent',
      vaultPath: '', createdAt: '2026-04-27T02:30:00Z',
    };
    const p = writeDrop(vaultPath, drop);
    updateDropRating(p, { rating: 8, feedback: 'great', ratedAt: '2026-04-27T09:00:00Z' });
    const fm = readDropFrontmatter(p);
    expect(fm.rating).toBe(8);
    expect(fm.feedback).toBe('great');
    expect(fm.ratedAt).toBe('2026-04-27T09:00:00Z');
    expect(fs.readFileSync(p, 'utf-8')).toContain('<p>body</p>');
  });
});
