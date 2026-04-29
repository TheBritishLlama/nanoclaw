import { exec } from 'child_process';
import { promisify } from 'util';
import { Agent } from 'undici';
import type { HealthState } from './types.js';

const execAsync = promisify(exec);
type Fetcher = typeof fetch;

// Long-timeout dispatcher for Ollama. Default undici headersTimeout is 5
// minutes — a slower GPU running a 25-item Qwen 14B grade can blow past
// that before the model emits its first token. Bump to 30 min headers,
// disable body timeout entirely (model can stream as long as it likes).
const longTimeoutDispatcher = new Agent({
  headersTimeout: 30 * 60 * 1000,
  bodyTimeout: 0,
  connectTimeout: 30 * 1000,
});

export class OllamaClient {
  constructor(
    private host: string,
    private fetcher: Fetcher = fetch,
  ) {}

  async ping(): Promise<boolean> {
    try {
      const r = await this.fetcher(`${this.host}/api/tags`);
      return r.ok;
    } catch {
      return false;
    }
  }

  async generate(
    model: string,
    prompt: string,
    options: Record<string, any> = {},
  ): Promise<string> {
    // Ollama wants generation parameters nested under `options`, not at the top
    // level. A few keys (think, format, system) are top-level fields in the API
    // and must be hoisted out of the options dict before nesting.
    const { think, format, system, ...nestedOptions } = options;
    const body: Record<string, any> = { model, prompt, stream: false };
    if (think !== undefined) body.think = think;
    if (format !== undefined) body.format = format;
    if (system !== undefined) body.system = system;
    if (Object.keys(nestedOptions).length > 0) body.options = nestedOptions;
    const r = await this.fetcher(`${this.host}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // @ts-expect-error: Node fetch passes dispatcher through to undici.
      dispatcher: longTimeoutDispatcher,
    });
    if (!r.ok) throw new Error(`Ollama generate failed: ${r.status}`);
    const j = (await r.json()) as { response: string };
    return j.response;
  }
}

export interface HealthCheckResult {
  state: HealthState;
  detail: string;
}

export interface HealthMonitorDeps {
  ping: () => Promise<boolean>;
  restart: () => Promise<void>;
  sleepMs: (ms: number) => Promise<void>;
}

export class OllamaHealthMonitor {
  constructor(private deps: HealthMonitorDeps) {}

  async checkAndRecover(): Promise<HealthCheckResult> {
    if (await this.deps.ping()) return { state: 'healthy', detail: 'ok' };
    try {
      await this.deps.restart();
    } catch (e: any) {
      return {
        state: 'degraded',
        detail: `restart failed: ${e?.message ?? e}`,
      };
    }
    await this.deps.sleepMs(10_000);
    if (await this.deps.ping())
      return { state: 'recovered', detail: 'restart succeeded' };
    return { state: 'degraded', detail: 'still down after restart' };
  }
}

export function platformRestart(): () => Promise<void> {
  return async () => {
    if (process.platform === 'darwin') {
      await execAsync('brew services restart ollama').catch(async () => {
        await execAsync(`launchctl kickstart -k gui/$(id -u)/com.ollama`);
      });
    } else if (process.platform === 'linux') {
      await execAsync('systemctl --user restart ollama');
    } else {
      throw new Error(`No restart command for platform ${process.platform}`);
    }
  };
}
export const realSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));
