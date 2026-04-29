import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyStackSchema, insertQueueDrop } from '../../../src/stack/db.js';
import { initVault, writeDrop } from '../../../src/stack/vault.js';
import { handleInboundReply, parseRating, parseCommand } from '../../../src/stack/delivery/inbound.js';
import type { Drop } from '../../../src/stack/types.js';

describe('parseRating', () => {
  it('parses bare integer', () => {
    expect(parseRating('7')).toEqual({ rating: 7, feedback: undefined });
  });
  it('parses integer with feedback', () => {
    expect(parseRating('7 cool but already knew it')).toEqual({
      rating: 7, feedback: 'cool but already knew it'
    });
  });
  it('parses integer with separator', () => {
    expect(parseRating('3 - too crypto-heavy')).toEqual({
      rating: 3, feedback: 'too crypto-heavy'
    });
  });
  it('returns null for non-numeric', () => {
    expect(parseRating('hello')).toBeNull();
  });
  it('returns null for out-of-range', () => {
    expect(parseRating('11')).toBeNull();
    expect(parseRating('0')).toBeNull();
  });
});

describe('parseCommand', () => {
  it('parses /learn X', () => {
    expect(parseCommand('/learn Tailscale')).toEqual({ kind: 'learn', term: 'Tailscale', insist: false });
  });
  it('parses /learn! X', () => {
    expect(parseCommand('/learn! Tailscale')).toEqual({ kind: 'learn', term: 'Tailscale', insist: true });
  });
  it('parses /more', () => {
    expect(parseCommand('/more')).toEqual({ kind: 'more' });
  });
  it('returns null for unrecognized', () => {
    expect(parseCommand('hello there')).toBeNull();
  });
});

describe('handleInboundReply (rating)', () => {
  let db: Database.Database;
  let vault: string;
  let drop: Drop;

  beforeEach(() => {
    db = new Database(':memory:');
    applyStackSchema(db);
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'in-'));
    initVault(vault);
    drop = {
      id:'d1', bucket:'tool', name:'Tailscale', tagline:'',
      bodyHtml:'<p/>', bodyPlain:'', sourceUrl:'https://x', sourceFetchedAt:'t',
      tags:[], confidence:0.9, status:'sent', vaultPath:'',
      emailMessageId:'msg-abc', createdAt:'t',
    };
    drop.vaultPath = path.relative(vault, writeDrop(vault, drop));
    insertQueueDrop(db, drop);
    db.prepare("UPDATE stack_queue SET status='sent', email_message_id='msg-abc' WHERE id='d1'").run();
  });

  it('stores rating + feedback, sends NO ack', async () => {
    const gmail = { send: vi.fn() };
    const result = await handleInboundReply(db, vault, gmail as any,
      { addrs: { from: 'a', to: 'b' }, threadMessageId: 'msg-abc', body: '8 great' });
    expect(result.acked).toBe(false);
    const row = db.prepare('SELECT * FROM stack_ratings').get() as any;
    expect(row.rating).toBe(8);
    expect(row.feedback).toBe('great');
    expect(gmail.send).not.toHaveBeenCalled();
  });

  it('approves pending_review drop on rating ≥6', async () => {
    db.prepare("UPDATE stack_queue SET status='pending_review' WHERE id='d1'").run();
    const gmail = { send: vi.fn() };
    await handleInboundReply(db, vault, gmail as any,
      { addrs:{from:'a',to:'b'}, threadMessageId:'msg-abc', body:'7' });
    const r = db.prepare("SELECT status FROM stack_queue WHERE id='d1'").get() as any;
    expect(r.status).toBe('queued');
  });

  it('rejects pending_review drop on rating <6', async () => {
    db.prepare("UPDATE stack_queue SET status='pending_review' WHERE id='d1'").run();
    const gmail = { send: vi.fn() };
    await handleInboundReply(db, vault, gmail as any,
      { addrs:{from:'a',to:'b'}, threadMessageId:'msg-abc', body:'4' });
    const r = db.prepare("SELECT status FROM stack_queue WHERE id='d1'").get() as any;
    expect(r.status).toBe('rejected');
  });
});

describe('handleInboundReply (commands)', () => {
  let db: Database.Database;
  let vault: string;

  beforeEach(() => {
    db = new Database(':memory:');
    applyStackSchema(db);
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'in2-'));
    initVault(vault);
  });

  it('/learn sends one-line ack', async () => {
    const gmail = { send: vi.fn().mockResolvedValue({ messageId: 'm' }) };
    const result = await handleInboundReply(db, vault, gmail as any,
      { addrs:{from:'a',to:'b'}, threadMessageId:'whatever', body:'/learn Tailscale' });
    expect(result.acked).toBe(true);
    expect(gmail.send).toHaveBeenCalledOnce();
    expect(gmail.send.mock.calls[0][0].text).toContain("Queued 'Tailscale'");
  });

  it('/more on empty queue acks "Queue empty"', async () => {
    const gmail = { send: vi.fn().mockResolvedValue({ messageId: 'm' }) };
    const result = await handleInboundReply(db, vault, gmail as any,
      { addrs:{from:'a',to:'b'}, threadMessageId:'whatever', body:'/more' });
    expect(result.acked).toBe(true);
    expect(gmail.send.mock.calls[0][0].text).toContain('Queue empty');
  });
});
