import { describe, it, expect } from 'vitest';
import { isBucket, isDropStatus, isFoundationStatus } from '../../src/stack/types.js';

describe('type guards', () => {
  it('recognizes valid buckets', () => {
    expect(isBucket('tool')).toBe(true);
    expect(isBucket('concept')).toBe(true);
    expect(isBucket('lore')).toBe(true);
    expect(isBucket('foundation')).toBe(true);
    expect(isBucket('something-else')).toBe(false);
  });

  it('recognizes valid drop statuses', () => {
    expect(isDropStatus('queued')).toBe(true);
    expect(isDropStatus('pending_review')).toBe(true);
    expect(isDropStatus('sent')).toBe(true);
    expect(isDropStatus('rejected')).toBe(true);
    expect(isDropStatus('archived')).toBe(true);
    expect(isDropStatus('weird')).toBe(false);
  });

  it('recognizes valid foundation statuses', () => {
    for (const s of ['pending','enriched','sent','done','retry','archived']) {
      expect(isFoundationStatus(s)).toBe(true);
    }
    expect(isFoundationStatus('queued')).toBe(false);
  });
});
