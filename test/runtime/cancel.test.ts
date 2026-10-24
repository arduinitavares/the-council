import { expect, it } from 'vitest';
import { outcomeExitCode } from '../../src/cli/index.js';

it('returns 130 only after positive cancellation settlement', () => {
  const cancelled = { decision: 'cancelled' as const, state: 'cancelled' as const, reports: [], blockers: [] };
  expect(outcomeExitCode({ ...cancelled, settlement: 'unverifiable' })).toBe(3);
  expect(outcomeExitCode({ ...cancelled, settlement: 'settled' })).toBe(130);
  expect(outcomeExitCode({ decision: 'unanimous', state: 'completed', settlement: 'settled', reports: [], blockers: [] })).toBe(0);
  expect(outcomeExitCode({ decision: 'unresolved', state: 'needs_user', settlement: 'settled', reports: [], blockers: [] })).toBe(2);
});
