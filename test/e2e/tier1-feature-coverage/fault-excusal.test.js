import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  assertPhase,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 1: Feature Coverage — Seat Fault, Retry & Excusal', () => {
  function createActiveState() {
    let state = createInitialCouncilState({
      minQuorum: 2,
      maxRetriesPerSeat: 1,
      seats: [
        { id: 's1', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Architect' },
        { id: 's2', harness: 'antigravity', model: 'gemini-4-argon', soul: 'Engineer' },
        { id: 's3', harness: 'cursor', model: 'grok-4.7', soul: 'Stress Tester' }
      ]
    });
    return transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
  }

  it('7.1 should handle SEAT_FAULT, pause state machine in seat_fault, and save returnPhase', () => {
    let state = createActiveState();
    assertPhase(state, 'reviewing');

    state = transitionCouncil(state, {
      type: EVENTS.SEAT_FAULT,
      seatId: 's3',
      reason: 'Rate limit HTTP 429'
    });

    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'seat_fault');
    assert.ok(state.returnPhase);
    assert.equal(state.faultSeatId, 's3');
    const s3 = state.seats.find((s) => s.id === 's3');
    assert.equal(s3.status, 'fault_quota');
  });

  it('7.2 should retry faulted seat via RETRY_SEAT and resume saved returnPhase', () => {
    let state = createActiveState();
    state = transitionCouncil(state, {
      type: EVENTS.SEAT_FAULT,
      seatId: 's3',
      reason: 'Network disconnect'
    });
    assertPhase(state, 'seat_fault');

    state = transitionCouncil(state, {
      type: EVENTS.RETRY_SEAT,
      seatId: 's3'
    });

    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'reviewing');
    assert.equal(state.faultSeatId, null);
    const s3 = state.seats.find((s) => s.id === 's3');
    assert.equal(s3.retries, 1);
    assert.equal(s3.status, 'thinking');
  });

  it('7.3 should reject RETRY_SEAT once maxRetriesPerSeat is reached (Retry Cap Guard)', () => {
    let state = createActiveState(); // maxRetriesPerSeat: 1
    // 1st fault & retry
    state = transitionCouncil(state, { type: EVENTS.SEAT_FAULT, seatId: 's3' });
    state = transitionCouncil(state, { type: EVENTS.RETRY_SEAT, seatId: 's3' });
    assertPhase(state, 'reviewing');

    // 2nd fault
    state = transitionCouncil(state, { type: EVENTS.SEAT_FAULT, seatId: 's3' });
    assertPhase(state, 'seat_fault');

    // 2nd retry attempt should be rejected by guard
    const retry2 = transitionCouncil(state, { type: EVENTS.RETRY_SEAT, seatId: 's3' });
    assert.equal(retry2.lastTransition.ok, false);
    assert.match(retry2.lastTransition.message, /reached 1\/1 retries/);
  });

  it('7.4 should excuse faulted seat via EXCUSE_SEAT and resume returnPhase when quorum maintained', () => {
    let state = createActiveState(); // 3 seats, minQuorum 2
    state = transitionCouncil(state, { type: EVENTS.SEAT_FAULT, seatId: 's3' });
    assertPhase(state, 'seat_fault');

    state = transitionCouncil(state, {
      type: EVENTS.EXCUSE_SEAT,
      seatId: 's3',
      reason: 'Quota exhausted after retry'
    });

    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'reviewing');
    const s3 = state.seats.find((s) => s.id === 's3');
    assert.equal(s3.status, 'excused');
    assert.equal(s3.excusedReason, 'Quota exhausted after retry');
  });

  it('7.5 should preserve completed turns of remaining seats when a seat is excused', () => {
    let state = createActiveState();
    // s1 submits a proof
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 's1',
      scope: 'Architecture',
      kind: 'check',
      source: 'Spec',
      statement: 'Spec valid.'
    });
    assert.equal(state.proofs.length, 1);
    assert.equal(state.seats[0].status, 'proof_submitted');

    // s3 is excused
    state = transitionCouncil(state, {
      type: EVENTS.EXCUSE_SEAT,
      seatId: 's3',
      reason: 'Offline'
    });

    // Verify s1's turn is completely intact
    assert.equal(state.proofs.length, 1);
    assert.equal(state.proofs[0].id, 'P1');
    assert.equal(state.seats[0].status, 'proof_submitted');
  });

  it('7.6 should lock open objections to preserved_excused when raising seat is excused', () => {
    let state = createActiveState();
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 's1',
      scope: 'General',
      kind: 'check',
      source: 'Source',
      statement: 'Statement'
    });
    state = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Summary',
      clauses: [{ context: 'General', conclusion: 'General', citedProofIds: ['P1'] }]
    });

    // s3 objects
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's3',
      vote: 'object',
      proofId: 'P1',
      reason: 'Concern regarding general scope'
    });
    assert.equal(state.objections[0].status, 'open');

    // s3 is excused
    state = transitionCouncil(state, {
      type: EVENTS.EXCUSE_SEAT,
      seatId: 's3',
      reason: 'Timeout'
    });

    // Objection must now be preserved_excused
    assert.equal(state.objections[0].status, 'preserved_excused');
  });

  it('7.7 should terminate immediately to Dissent Report (Below Quorum) if excusal drops active seats below minQuorum', () => {
    // 2 seats, minQuorum 2
    let state = createInitialCouncilState({
      minQuorum: 2,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'antigravity', model: 'm2', soul: 'soul2' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });

    // Excuse s2 -> remaining active seats = 1 (< minQuorum: 2)
    state = transitionCouncil(state, {
      type: EVENTS.EXCUSE_SEAT,
      seatId: 's2',
      reason: 'Quota reached'
    });

    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'completed');
    assert.ok(state.verdict);
    assert.equal(state.verdict.kind, 'Dissent Report (Below Quorum)');
    assert.equal(state.verdict.activeSeatCount, 1);
    assert.equal(state.verdict.excusedSeatCount, 1);
    assert.match(state.verdict.note, /dropped below minimum quorum/);
  });
});
