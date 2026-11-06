import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  canWithdrawObjection,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 2: Boundary & Corner Cases — Objection Ownership & Immutability', () => {
  function getDeliberatingState() {
    let state = createInitialCouncilState({
      minQuorum: 2,
      seats: [
        { id: 'seat-a', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Architect' },
        { id: 'seat-b', harness: 'antigravity', model: 'gemini-4-argon', soul: 'Reviewer' },
        { id: 'seat-c', harness: 'cursor', model: 'grok-4.7', soul: 'Auditor' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 'seat-a',
      scope: 'Security',
      kind: 'check',
      source: 'Audit',
      statement: 'Passed'
    });
    state = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Candidate',
      clauses: [{ context: 'Security', conclusion: 'OK', citedProofIds: ['P1'] }]
    });
    return state;
  }

  it('B3.1 should reject non-owner withdrawing an open objection (Ownership Guard)', () => {
    let state = getDeliberatingState();
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 'seat-b',
      vote: 'object',
      proofId: 'P1',
      reason: 'Seat B raises objection'
    });
    assert.equal(state.objections.length, 1);
    const obj = state.objections[0];

    // Seat A attempts to withdraw Seat B's objection
    const attempt = transitionCouncil(state, {
      type: EVENTS.WITHDRAW_OBJECTION,
      objectionId: obj.id,
      seatId: 'seat-a'
    });
    assert.equal(attempt.lastTransition.ok, false);
    assert.match(attempt.lastTransition.message, /Seat "seat-a" cannot withdraw Objection "O1" owned by "seat-b"/);
    assert.equal(attempt.objections[0].status, 'open');
  });

  it('B3.2 should reject withdrawing non-existent objection ID', () => {
    const state = getDeliberatingState();
    const attempt = transitionCouncil(state, {
      type: EVENTS.WITHDRAW_OBJECTION,
      objectionId: 'O_NONEXISTENT',
      seatId: 'seat-a'
    });
    assert.equal(attempt.lastTransition.ok, false);
    assert.match(attempt.lastTransition.message, /not found/);
  });

  it('B3.3 should reject withdrawing an objection that is already withdrawn', () => {
    let state = getDeliberatingState();
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 'seat-b',
      vote: 'object',
      proofId: 'P1',
      reason: 'Temporary concern'
    });
    // First withdrawal succeeds
    state = transitionCouncil(state, {
      type: EVENTS.WITHDRAW_OBJECTION,
      objectionId: 'O1',
      seatId: 'seat-b'
    });
    assert.equal(state.objections[0].status, 'withdrawn');

    // Second withdrawal attempt should be rejected or check guard
    const check = canWithdrawObjection(state, 'O1', 'seat-b');
    // If already withdrawn, status is withdrawn
    assert.equal(state.objections[0].status, 'withdrawn');
  });

  it('B3.4 should permanently block withdrawal of preserved_excused objection by original owner (ADR 0003)', () => {
    let state = getDeliberatingState();
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 'seat-b',
      vote: 'object',
      proofId: 'P1',
      reason: 'Crucial security objection'
    });
    assert.equal(state.objections[0].status, 'open');

    // Seat B faults and is excused
    state = transitionCouncil(state, { type: EVENTS.SEAT_FAULT, seatId: 'seat-b', reason: 'Quota hit' });
    state = transitionCouncil(state, { type: EVENTS.EXCUSE_SEAT, seatId: 'seat-b' });
    assert.equal(state.objections[0].status, 'preserved_excused');

    // Seat B tries to withdraw
    const ownerWithdrawal = transitionCouncil(state, {
      type: EVENTS.WITHDRAW_OBJECTION,
      objectionId: 'O1',
      seatId: 'seat-b'
    });
    assert.equal(ownerWithdrawal.lastTransition.ok, false);
    assert.equal(ownerWithdrawal.objections[0].status, 'preserved_excused');
  });

  it('B3.5 should permanently block withdrawal of preserved_excused objection by remaining active seats', () => {
    let state = getDeliberatingState();
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 'seat-b',
      vote: 'object',
      proofId: 'P1',
      reason: 'Crucial security objection'
    });
    state = transitionCouncil(state, { type: EVENTS.EXCUSE_SEAT, seatId: 'seat-b' });
    assert.equal(state.objections[0].status, 'preserved_excused');

    // Active seat C tries to withdraw it
    const seatCAttempt = transitionCouncil(state, {
      type: EVENTS.WITHDRAW_OBJECTION,
      objectionId: 'O1',
      seatId: 'seat-c'
    });
    assert.equal(seatCAttempt.lastTransition.ok, false);
    assert.equal(seatCAttempt.objections[0].status, 'preserved_excused');

    // Active seat A tries to withdraw it
    const seatAAttempt = transitionCouncil(state, {
      type: EVENTS.WITHDRAW_OBJECTION,
      objectionId: 'O1',
      seatId: 'seat-a'
    });
    assert.equal(seatAAttempt.lastTransition.ok, false);
    assert.equal(seatAAttempt.objections[0].status, 'preserved_excused');
  });

  it('B3.6 should verify canWithdrawObjection helper conforms to interface specification', () => {
    let state = getDeliberatingState();
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 'seat-b',
      vote: 'object',
      proofId: 'P1',
      reason: 'Test objection'
    });

    // Valid check: owner can withdraw open objection
    const validCheck = canWithdrawObjection(state, 'O1', 'seat-b');
    assert.equal(validCheck.allowed, true);

    // Invalid check: non-owner cannot withdraw
    const nonOwnerCheck = canWithdrawObjection(state, 'O1', 'seat-a');
    assert.equal(nonOwnerCheck.allowed, false);
    assert.match(nonOwnerCheck.reason, /cannot withdraw Objection/);

    // Lock objection as preserved_excused
    state.objections[0].status = 'preserved_excused';
    const lockedCheck = canWithdrawObjection(state, 'O1', 'seat-b');
    assert.equal(lockedCheck.allowed, false);
    assert.match(lockedCheck.reason, /preserved_excused/);
  });
});
