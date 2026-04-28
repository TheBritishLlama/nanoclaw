import { describe, it, expect, vi } from 'vitest';
import { OllamaClient, OllamaHealthMonitor } from '../../src/stack/ollama.js';

describe('OllamaClient', () => {
  it('returns true when /api/tags responds 200', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true } as Response);
    const c = new OllamaClient('http://localhost:11434', fetcher);
    expect(await c.ping()).toBe(true);
    expect(fetcher).toHaveBeenCalledWith('http://localhost:11434/api/tags');
  });

  it('returns false when fetch throws', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const c = new OllamaClient('http://localhost:11434', fetcher);
    expect(await c.ping()).toBe(false);
  });

  it('generate() POSTs to /api/generate and returns content', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'hello' }),
    } as unknown as Response);
    const c = new OllamaClient('http://x', fetcher);
    const out = await c.generate('qwen2.5:14b', 'prompt');
    expect(out).toBe('hello');
  });
});

describe('OllamaHealthMonitor', () => {
  it('reports degraded when ping fails twice and restart fails', async () => {
    const ping = vi.fn().mockResolvedValue(false);
    const restart = vi.fn().mockRejectedValue(new Error('no command'));
    const m = new OllamaHealthMonitor({ ping, restart, sleepMs: async () => {} });
    const r = await m.checkAndRecover();
    expect(r.state).toBe('degraded');
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('reports recovered when restart succeeds', async () => {
    const ping = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const restart = vi.fn().mockResolvedValue(undefined);
    const m = new OllamaHealthMonitor({ ping, restart, sleepMs: async () => {} });
    const r = await m.checkAndRecover();
    expect(r.state).toBe('recovered');
  });

  it('reports healthy when first ping succeeds', async () => {
    const ping = vi.fn().mockResolvedValue(true);
    const restart = vi.fn();
    const m = new OllamaHealthMonitor({ ping, restart, sleepMs: async () => {} });
    const r = await m.checkAndRecover();
    expect(r.state).toBe('healthy');
    expect(restart).not.toHaveBeenCalled();
  });
});
