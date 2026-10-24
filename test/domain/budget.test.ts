import { describe, expect, it } from 'vitest';
import { accountBudget } from '../../src/domain/budget.js';
import { clock, makeBudget } from '../fixtures/builders.js';

describe('pure active-work budget', () => {
  it('charges same-epoch monotonic elapsed despite wall clock jitter', () => {
    const d = accountBudget(makeBudget(), clock(9000, 350), { kind: 'active-checkpoint' });
    expect(d.kind).toBe('ok');
    if (d.kind !== 'ok') throw Error('blocked');
    expect(d.budget.remainingMs).toBe(750); expect(d.budget.accruedMs).toBe(250);
    expect(d.deadline?.monotonicMs).toBe(1100);
  });
  it('pauses only after positive resource settlement and never recharges the closed interval', () => {
    expect(accountBudget(makeBudget(), clock(10100, 200), { kind: 'settled-human-pause', allResourcesSettled: false }).kind).toBe('clock-blocker');
    const p = accountBudget(makeBudget(), clock(10100, 200), { kind: 'settled-human-pause', allResourcesSettled: true });
    if (p.kind !== 'ok') throw Error('blocked');
    const later = accountBudget(p.budget, clock(999999, 1, 'epoch2'), { kind: 'active-checkpoint' });
    if (later.kind !== 'ok') throw Error('blocked');
    expect(later.budget.remainingMs).toBe(900); expect(later.deadline).toBeNull();
    const r = accountBudget(later.budget, clock(1000000, 10, 'epoch2'), { kind: 'resume-active' });
    if (r.kind !== 'ok') throw Error('blocked');
    expect(r.budget.remainingMs).toBe(900); expect(r.deadline?.wallMs).toBe(1000900);
  });
  it('charges active crash downtime across epochs and blocks clock regression', () => {
    const d = accountBudget(makeBudget(), clock(10400, 5, 'epoch2'), { kind: 'crash-reconcile' });
    if (d.kind !== 'ok') throw Error('blocked');
    expect(d.budget.remainingMs).toBe(600);
    expect(accountBudget(makeBudget(), clock(9999, 5, 'epoch2'), { kind: 'crash-reconcile' }).kind).toBe('clock-blocker');
    expect(accountBudget(makeBudget(), clock(10500, 99), { kind: 'active-checkpoint' }).kind).toBe('clock-blocker');
  });
  it('continues charging fractional monotonic receipts across checkpoints', () => {
    const first = accountBudget(makeBudget(), clock(10000, 100.25), { kind: 'active-checkpoint' });
    if (first.kind !== 'ok') throw Error('blocked');
    const second = accountBudget(first.budget, clock(10000, 100.5), { kind: 'active-checkpoint' });
    expect(second.kind).toBe('ok');
    if (second.kind !== 'ok') throw Error('blocked');
    expect(second.budget.remainingMs).toBe(999.5);
  });
  it('does not move an expired monotonic deadline later', () => {
    const d = accountBudget(makeBudget(), clock(12000, 2100), { kind: 'active-checkpoint' });
    if (d.kind !== 'ok') throw Error('blocked');
    expect(d.deadline?.monotonicMs).toBe(1100);
  });
  it('does not increase allowance through a clock regression on paused resume', () => {
    const paused = makeBudget({ status: 'paused' });
    expect(accountBudget(paused, clock(9999, 1, 'epoch2'), { kind: 'resume-active' }).kind).toBe('clock-blocker');
  });
  it('expires at zero while charging all active elapsed, and settles terminal intervals', () => {
    const d = accountBudget(makeBudget(), clock(12000, 2100), { kind: 'terminal-settlement', allResourcesSettled: true });
    if (d.kind !== 'ok') throw Error('blocked');
    expect(d.expired).toBe(true); expect(d.budget.remainingMs).toBe(0); expect(d.budget.accruedMs).toBe(2000); expect(d.deadline).toBeNull();
  });
  it('adds only authorized extension delta once without resetting consumed time', () => {
    const event = { kind: 'authorized-extension' as const, extensionId: 'ext1', additionalMs: 200, authorizationReceipt: 'user-receipt' };
    const d = accountBudget(makeBudget(), clock(10100, 200), event);
    if (d.kind !== 'ok') throw Error('blocked');
    expect(d.budget.totalMs).toBe(1200); expect(d.budget.remainingMs).toBe(1100); expect(d.budget.accruedMs).toBe(100);
    const again = accountBudget(d.budget, clock(10100, 200), event);
    if (again.kind !== 'ok') throw Error('blocked');
    expect(again.budget.remainingMs).toBe(1100);
    expect(accountBudget(makeBudget(), clock(10100, 200), { ...event, authorizationReceipt: '' }).kind).toBe('clock-blocker');
  });
});
