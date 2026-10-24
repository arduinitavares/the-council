import { expect, it } from 'vitest';
import { fixture } from '../orca/fixtures.js';
import { controllerIdentity, observePriorOwner, recordOwner, resourcesSettled } from '../../src/runtime/reconcile.js';

it('requires positive prior-controller exit instead of silence or a released writer lease', () => {
  const f = fixture(), root = f.store.artifacts.root.replace(/\/artifacts$/, '');
  const snapshot = f.store.load('run1');
  expect(observePriorOwner(root, snapshot, f.store).exited).toBe(false);
  recordOwner(root, controllerIdentity(snapshot.context.activeBudget.lastReceipt.processEpoch));
  expect(observePriorOwner(root, snapshot, f.store).exited).toBe(false); f.store.close();
});
it('does not mistake a reservation for a live resource', () => {
  const f = fixture();
  expect(resourcesSettled(f.store.load('run1'))).toBe(true); f.store.close();
});

import { makeBinding } from '../fixtures/builders.js';
it('treats a pending task with an actual binding or dispatch deadline as uncertain', () => {
  const f = fixture(), snapshot = f.store.load('run1'), first = Object.values(snapshot.context.issuedLogicalTasks)[0]!;
  first.binding = makeBinding('openai');
  expect(resourcesSettled(snapshot)).toBe(false);
  first.binding = null;
  snapshot.context.control.workerDeadlines = { [first.reservation.logicalTaskKey]: { wallMs: 1000, monotonicMs: 100, processEpoch: 'epoch' } };
  expect(resourcesSettled(snapshot)).toBe(false); f.store.close();
});
