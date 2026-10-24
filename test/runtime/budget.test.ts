import { describe, expect, it } from 'vitest';

describe('trusted controller clock', () => {
  it('captures injected clocks and a distinct receipt identity', async () => {
    const api = await import('../../src/runtime/clocks.js').catch(() => null);
    expect(api, 'Task7 captureClock is missing').not.toBeNull();
    const clock = { wallNow: () => 123, monotonicNow: () => 42 };
    const a = api!.captureClock(clock, 'epoch');
    expect(a).toMatchObject({ wallMs: 123, monotonicMs: 42, processEpoch: 'epoch' });
    expect(api!.captureClock(clock, 'epoch').id).not.toBe(a.id);
  });
  it('uses monotonic deadlines in an epoch and blocks backward cross-epoch time', async () => {
    const api = await import('../../src/runtime/deadlines.js').catch(() => null);
    expect(api, 'Task7 deadlines are missing').not.toBeNull();
    const deadline = { wallMs: 100, monotonicMs: 20, processEpoch: 'a' };
    expect(api!.observeDeadline(deadline, { id: 'c', wallMs: 10000, monotonicMs: 19, processEpoch: 'a' }, 50)).toBe('pending');
    expect(api!.observeDeadline(deadline, { id: 'c', wallMs: 49, monotonicMs: 19, processEpoch: 'b' }, 50)).toBe('clock_regression');
  });
});
