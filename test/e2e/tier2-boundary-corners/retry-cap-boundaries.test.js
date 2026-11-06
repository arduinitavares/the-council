import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 2: Boundary & Corner Cases — Retry Cap & Fault Boundaries', () => {
  it('B5.1 should immediately reject first retry when maxRetriesPerSeat is 0', () => {
    let state = createInitialCouncilState({
      maxRetriesPerSeat: 0,
      minQuorum: 2,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    state = transitionCouncil(state, { type: EVENTS.SEAT_FAULT, seatId: 's1', reason: 'Timeout' });
    assert.equal(state.phase, 'seat_fault');

    // First retry should be rejected by cap guard (0/0)
    const retryAttempt = transitionCouncil(state, { type: EVENTS.RETRY_SEAT, seatId: 's1' });
    assert.equal(retryAttempt.lastTransition.ok, false);
    assert.match(retryAttempt.lastTransition.message, /reached 0\/0 retries. Excuse Seat instead/);
  });

  it('B5.2 should permit exactly 1 retry and reject 2nd retry when maxRetriesPerSeat is 1', () => {
    let state = createInitialCouncilState({
      maxRetriesPerSeat: 1,
      minQuorum: 2,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });

    // Fault 1
    state = transitionCouncil(state, { type: EVENTS.SEAT_FAULT, seatId: 's1' });
    state = transitionCouncil(state, { type: EVENTS.RETRY_SEAT, seatId: 's1' });
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.seats[0].retries, 1);

    // Fault 2
    state = transitionCouncil(state, { type: EVENTS.SEAT_FAULT, seatId: 's1' });
    const retry2 = transitionCouncil(state, { type: EVENTS.RETRY_SEAT, seatId: 's1' });
    assert.equal(retry2.lastTransition.ok, false);
    assert.match(retry2.lastTransition.message, /reached 1\/1 retries/);
  });

  it('B5.3 should permit exactly 2 retries and reject 3rd retry when maxRetriesPerSeat is 2', () => {
    let state = createInitialCouncilState({
      maxRetriesPerSeat: 2,
      minQuorum: 2,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });

    // Retry 1
    state = transitionCouncil(state, { type: EVENTS.SEAT_FAULT, seatId: 's1' });
    state = transitionCouncil(state, { type: EVENTS.RETRY_SEAT, seatId: 's1' });
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.seats[0].retries, 1);

    // Retry 2
    state = transitionCouncil(state, { type: EVENTS.SEAT_FAULT, seatId: 's1' });
    state = transitionCouncil(state, { type: EVENTS.RETRY_SEAT, seatId: 's1' });
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.seats[0].retries, 2);

    // Retry 3 (blocked)
    state = transitionCouncil(state, { type: EVENTS.SEAT_FAULT, seatId: 's1' });
    const retry3 = transitionCouncil(state, { type: EVENTS.RETRY_SEAT, seatId: 's1' });
    assert.equal(retry3.lastTransition.ok, false);
    assert.match(retry3.lastTransition.message, /reached 2\/2 retries/);
  });

  it('B5.4 should reject RETRY_SEAT when state is not in seat_fault phase', () => {
    let state = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(state.phase, 'reviewing');

    const badRetry = transitionCouncil(state, { type: EVENTS.RETRY_SEAT, seatId: 's1' });
    assert.equal(badRetry.lastTransition.ok, false);
    assert.match(badRetry.lastTransition.message, /Can only retry a Seat from seat_fault/);
  });

  it('B5.5 should reject RETRY_JUDGE when state is not in judge_fault phase', () => {
    let state = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(state.phase, 'reviewing');

    const badJudgeRetry = transitionCouncil(state, { type: EVENTS.RETRY_JUDGE });
    assert.equal(badJudgeRetry.lastTransition.ok, false);
    assert.match(badJudgeRetry.lastTransition.message, /Can only retry Judge from judge_fault/);
  });

  it('B5.6 should reject RETRY_SEAT for unknown seat ID', () => {
    let state = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    state = transitionCouncil(state, { type: EVENTS.SEAT_FAULT, seatId: 's1' });
    assert.equal(state.phase, 'seat_fault');

    const unknownRetry = transitionCouncil(state, { type: EVENTS.RETRY_SEAT, seatId: 'unknown-seat' });
    assert.equal(unknownRetry.lastTransition.ok, false);
    assert.match(unknownRetry.lastTransition.message, /Faulted Seat not found/);
  });
});
