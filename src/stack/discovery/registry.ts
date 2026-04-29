import type Database from 'better-sqlite3';
import type { DiscoveryAlgorithmConfig } from '../config.js';
import type { StackScheduler } from '../scheduler.js';
import type { SearxngClient } from './search.js';

export interface CandidateSourceObservation {
  domain: string;
  origin_algorithm: string;
}

export interface DiscoveryContext {
  db: Database.Database;
  webFetch: (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;
  classify: (prompt: string) => Promise<boolean>;
  search?: SearxngClient;
  bloomlist: string[];
  occurrenceThreshold: number;
}

export interface DiscoveryAlgorithm {
  name: string;
  role: 'core' | 'supplement';
  run(ctx: DiscoveryContext): Promise<CandidateSourceObservation[]>;
}

export interface DiscoveryRegistry {
  get(name: string): DiscoveryAlgorithm | undefined;
  list(): DiscoveryAlgorithm[];
}

export function buildRegistry(algos: DiscoveryAlgorithm[]): DiscoveryRegistry {
  const m = new Map(algos.map(a => [a.name, a]));
  return { get: (n) => m.get(n), list: () => [...m.values()] };
}

export function registerEnabledOn(
  scheduler: StackScheduler,
  registry: DiscoveryRegistry,
  configs: DiscoveryAlgorithmConfig[],
  ctx: DiscoveryContext,
): void {
  for (const c of configs) {
    if (!c.enabled) continue;
    const algo = registry.get(c.name);
    if (!algo) continue;
    scheduler.addCron(`discovery-${c.name}`, c.schedule, async () => { await algo.run(ctx); });
  }
}
