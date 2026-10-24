import type { ActiveBudget, BudgetDecision, BudgetEvent, ClockReceipt } from './contracts.js';
import { activeBudgetSchema, budgetEventSchema, clockReceiptSchema } from './schemas.js';

/** Reads recorded receipts only. A blocker always preserves the supplied allowance. */
export function accountBudget(budget: ActiveBudget, observation: ClockReceipt, event: BudgetEvent): BudgetDecision {
  const blocked = (code: string): BudgetDecision => ({ kind: 'clock-blocker', code, budget });
  if (!activeBudgetSchema.safeParse(budget).success || !clockReceiptSchema.safeParse(observation).success || !budgetEventSchema.safeParse(event).success) return blocked('INVALID_CLOCK_OR_BUDGET_INPUT');
  if ((event.kind === 'settled-human-pause' || event.kind === 'terminal-settlement') && !event.allResourcesSettled) return blocked('RESOURCES_NOT_SETTLED');
  if (budget.status === 'settled' && event.kind !== 'terminal-settlement') return blocked('BUDGET_TERMINALLY_SETTLED');
  let next: ActiveBudget = { ...budget };
  if (budget.status === 'active') {
    const last = budget.lastReceipt;
    let elapsed: number;
    if (last.processEpoch === observation.processEpoch) {
      elapsed = observation.monotonicMs - last.monotonicMs;
      if (elapsed < 0) return blocked('MONOTONIC_CLOCK_REGRESSION');
    } else {
      if (event.kind !== 'crash-reconcile') return blocked('CROSS_EPOCH_RECONCILIATION_REQUIRED');
      elapsed = observation.wallMs - last.wallMs;
      if (elapsed < 0) return blocked('WALL_CLOCK_REGRESSION');
    }
    next = { ...next, lastReceipt: { ...observation }, remainingMs: Math.max(0, budget.remainingMs - elapsed), accruedMs: budget.accruedMs + elapsed };
    if (event.kind === 'settled-human-pause') next.status = 'paused';
    if (event.kind === 'terminal-settlement') next.status = 'settled';
  } else if (budget.status === 'paused' && event.kind === 'resume-active') {
    if (observation.processEpoch === budget.lastReceipt.processEpoch ? observation.monotonicMs < budget.lastReceipt.monotonicMs : observation.wallMs < budget.lastReceipt.wallMs) return blocked('RESUME_CLOCK_REGRESSION');
    // Closed human wait has no active deadline. Start a new interval from saved time.
    next = { ...next, status: 'active', intervalEpoch: budget.intervalEpoch + 1, startReceipt: { ...observation }, lastReceipt: { ...observation }, deadline: { wallMs: observation.wallMs + budget.remainingMs, monotonicMs: observation.monotonicMs + budget.remainingMs, processEpoch: observation.processEpoch } };
  } else if (event.kind === 'terminal-settlement') next.status = 'settled';
  if (event.kind === 'authorized-extension' && !budget.appliedExtensionIds.includes(event.extensionId)) {
    const totalMs = next.totalMs + event.additionalMs;
    // Accrued work includes overrun even after the displayed balance reaches zero.
    next = { ...next, totalMs, remainingMs: Math.max(0, totalMs - next.accruedMs), appliedExtensionIds: [...next.appliedExtensionIds, event.extensionId] };
    if (!Number.isSafeInteger(next.totalMs) || !Number.isFinite(next.remainingMs) || next.remainingMs > Number.MAX_SAFE_INTEGER) return blocked('BUDGET_OVERFLOW');
    if (next.deadline) next.deadline = { ...next.deadline, wallMs: next.deadline.wallMs + event.additionalMs, monotonicMs: next.deadline.monotonicMs + event.additionalMs };
  }
  if (next.status !== 'active') next.deadline = null;
  else if (next.deadline?.processEpoch !== observation.processEpoch) {
    const wallMs = Math.min(next.deadline?.wallMs ?? Infinity, observation.wallMs + next.remainingMs);
    const beforeFence = next.remainingMs;
    next.remainingMs = Math.min(next.remainingMs, Math.max(0, wallMs - observation.wallMs));
    next.accruedMs += beforeFence - next.remainingMs;
    next.deadline = { wallMs, monotonicMs: observation.monotonicMs + wallMs - observation.wallMs, processEpoch: observation.processEpoch };
  }
  return { kind: 'ok', budget: next, deadline: next.deadline, expired: next.remainingMs === 0 };
}
