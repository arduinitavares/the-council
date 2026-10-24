import type { ActiveDeadline, ClockReceipt, RunSnapshot } from '../domain/contracts.js';

export function observeDeadline(deadline: ActiveDeadline, now: ClockReceipt, lastWallMs: number): 'pending' | 'expired' | 'clock_regression' {
  if (deadline.processEpoch === now.processEpoch) return now.monotonicMs >= deadline.monotonicMs ? 'expired' : 'pending';
  if (now.wallMs < lastWallMs) return 'clock_regression';
  return now.wallMs >= deadline.wallMs ? 'expired' : 'pending';
}
export function overdue(snapshot: RunSnapshot, now: ClockReceipt): 'pending' | 'expired' | 'clock_regression' {
  if (snapshot.context.activeBudget.status !== 'active') return 'pending';
  const states = snapshot.context.deadlines.map(deadline => observeDeadline(deadline, now, snapshot.context.activeBudget.lastReceipt.wallMs));
  return states.includes('clock_regression') ? 'clock_regression' : snapshot.context.activeBudget.remainingMs === 0 || states.includes('expired') ? 'expired' : 'pending';
}
