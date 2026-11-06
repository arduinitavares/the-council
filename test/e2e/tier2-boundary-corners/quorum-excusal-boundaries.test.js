import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 2: Boundary & Corner Cases — Quorum & Excusal Dynamics', () => {
  it('B4.1 should immediately terminate when excusal drops active seats from 2 to 1 (minQuorum: 2)', () => {
    let state = createInitialCouncilState({
      minQuorum: 2,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(state.phase, 'reviewing');

    state = transitionCouncil(state, {
      type: EVENTS.EXCUSE_SEAT,
      seatId: 's1',
      reason: 'Quota reached'
    });

    assert.equal(state.phase, 'completed');
    assert.ok(state.verdict);
    assert.equal(state.verdict.kind, 'Dissent Report (Below Quorum)');
    assert.equal(state.verdict.activeSeatCount, 1);
    assert.equal(state.verdict.excusedSeatCount, 1);
  });

  it('B4.2 should continue deliberation when minQuorum is 1 and one seat is excused leaving 1', () => {
    let state = createInitialCouncilState({
      minQuorum: 1,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(state.phase, 'reviewing');

    state = transitionCouncil(state, {
      type: EVENTS.EXCUSE_SEAT,
      seatId: 's1',
      reason: 'Quota reached'
    });

    assert.equal(state.phase, 'reviewing'); // Still active!
    assert.equal(state.verdict, null);
  });

  it('B4.3 should terminate when minQuorum is 3 and excusal drops active seats from 3 to 2', () => {
    let state = createInitialCouncilState({
      minQuorum: 3,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' },
        { id: 's3', harness: 'codex', model: 'm3', soul: 'soul3' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(state.phase, 'reviewing');

    state = transitionCouncil(state, {
      type: EVENTS.EXCUSE_SEAT,
      seatId: 's3',
      reason: 'Quota reached'
    });

    assert.equal(state.phase, 'completed');
    assert.equal(state.verdict.kind, 'Dissent Report (Below Quorum)');
    assert.equal(state.verdict.activeSeatCount, 2);
  });

  it('B4.4 should track quorum across sequential excusals in a 5-seat council with minQuorum: 3', () => {
    let state = createInitialCouncilState({
      minQuorum: 3,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' },
        { id: 's3', harness: 'codex', model: 'm3', soul: 'soul3' },
        { id: 's4', harness: 'codex', model: 'm4', soul: 'soul4' },
        { id: 's5', harness: 'codex', model: 'm5', soul: 'soul5' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });

    // Excuse 1st seat -> 4 active >= 3
    state = transitionCouncil(state, { type: EVENTS.EXCUSE_SEAT, seatId: 's1' });
    assert.equal(state.phase, 'reviewing');

    // Excuse 2nd seat -> 3 active >= 3
    state = transitionCouncil(state, { type: EVENTS.EXCUSE_SEAT, seatId: 's2' });
    assert.equal(state.phase, 'reviewing');

    // Excuse 3rd seat -> 2 active < 3 -> instant termination
    state = transitionCouncil(state, { type: EVENTS.EXCUSE_SEAT, seatId: 's3' });
    assert.equal(state.phase, 'completed');
    assert.equal(state.verdict.kind, 'Dissent Report (Below Quorum)');
    assert.equal(state.verdict.activeSeatCount, 2);
    assert.equal(state.verdict.excusedSeatCount, 3);
  });

  it('B4.5 should reject BEGIN_ROUND when preflight has fewer active seats than minQuorum', () => {
    const state = createInitialCouncilState({
      minQuorum: 4,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' },
        { id: 's3', harness: 'codex', model: 'm3', soul: 'soul3' }
      ]
    });
    // 3 active seats, minQuorum 4
    const next = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /Active Seats \(3\) below minimum quorum \(4\)/);
  });

  it('B4.6 should ensure EVALUATE_ROUND blocks consensus if active seats drop below quorum', () => {
    let state = createInitialCouncilState({
      minQuorum: 2,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 's1',
      scope: 'S',
      kind: 'check',
      source: 'Src',
      statement: 'Stmt'
    });
    state = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Candidate',
      clauses: [{ context: 'S', conclusion: 'C', citedProofIds: ['P1'] }]
    });

    // Artificially simulate s2 excused without triggering immediate EXCUSE_SEAT transition
    state.seats[1].status = 'excused';
    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 's1', vote: 'accept' });

    state = transitionCouncil(state, { type: EVENTS.EVALUATE_ROUND });
    assert.equal(state.phase, 'completed');
    assert.equal(state.verdict.kind, 'Dissent Report (Below Quorum)');
  });
});
