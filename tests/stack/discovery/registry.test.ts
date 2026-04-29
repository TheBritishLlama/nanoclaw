import { describe, it, expect, vi } from 'vitest';
import {
  buildRegistry,
  registerEnabledOn,
  type DiscoveryAlgorithm,
  type DiscoveryContext,
} from '../../../src/stack/discovery/registry.js';

const fakeCtx = {} as DiscoveryContext;

const algoA: DiscoveryAlgorithm = {
  name: 'a', role: 'core',
  run: vi.fn(async () => []),
};
const algoB: DiscoveryAlgorithm = {
  name: 'b', role: 'supplement',
  run: vi.fn(async () => []),
};

describe('discovery registry', () => {
  it('looks up algorithms by name', () => {
    const reg = buildRegistry([algoA, algoB]);
    expect(reg.get('a')).toBe(algoA);
    expect(reg.get('missing')).toBeUndefined();
  });

  it('registers only enabled, known algorithms with the scheduler', () => {
    const reg = buildRegistry([algoA, algoB]);
    const addCron = vi.fn();
    const scheduler = { addCron } as any;
    registerEnabledOn(scheduler, reg, [
      { name: 'a', enabled: true,  schedule: '0 4 * * *' },
      { name: 'b', enabled: false, schedule: '0 5 * * *' },
      { name: 'unknown', enabled: true, schedule: '0 6 * * *' },
    ], fakeCtx);
    expect(addCron).toHaveBeenCalledTimes(1);
    expect(addCron).toHaveBeenCalledWith('discovery-a', '0 4 * * *', expect.any(Function));
  });

  it('passes the context to algorithm.run when the cron fires', async () => {
    const reg = buildRegistry([algoA]);
    let captured: any = null;
    const scheduler = {
      addCron: (_id: string, _cron: string, fn: () => Promise<void>) => { captured = fn; },
    } as any;
    registerEnabledOn(scheduler, reg, [{ name: 'a', enabled: true, schedule: '0 4 * * *' }], fakeCtx);
    await captured();
    expect(algoA.run).toHaveBeenCalledWith(fakeCtx);
  });
});
