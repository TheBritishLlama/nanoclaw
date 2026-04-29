import { CronExpressionParser } from 'cron-parser';

interface CronEntry {
  id: string;
  cron: string;
  fn: () => Promise<void>;
  nextRun: number;
  timer?: NodeJS.Timeout;
}

export class StackScheduler {
  private entries: Map<string, CronEntry> = new Map();
  private running = false;

  addCron(id: string, cron: string, fn: () => Promise<void>): void {
    const next = CronExpressionParser.parse(cron).next().getTime();
    this.entries.set(id, { id, cron, fn, nextRun: next });
    if (this.running) this.scheduleNext(this.entries.get(id)!);
  }

  start(): void {
    this.running = true;
    for (const e of this.entries.values()) this.scheduleNext(e);
  }

  stop(): void {
    this.running = false;
    for (const e of this.entries.values()) {
      if (e.timer) clearTimeout(e.timer);
    }
  }

  private scheduleNext(entry: CronEntry): void {
    const ms = Math.max(0, entry.nextRun - Date.now());
    entry.timer = setTimeout(async () => {
      try {
        await entry.fn();
      } catch (e) {
        console.error(`[stack] cron ${entry.id} failed:`, e);
      }
      entry.nextRun = CronExpressionParser.parse(entry.cron).next().getTime();
      if (this.running) this.scheduleNext(entry);
    }, ms);
  }
}
