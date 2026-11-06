import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  canWithdrawObjection,
  assertPhase,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 1: Feature Coverage — Voting (Accept, Object, Ownership & Immutability)', () => {
  function createConfirmingState() {
    let state = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Engineer' },
        { id: 's2', harness: 'antigravity', model: 'gemini-4-argon', soul: 'Reviewer' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 's1',
      scope: 'General',
      kind: 'check',
      source: 'Test suite',
      statement: 'All tests pass.'
    });
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P2',
      seatId: 's2',
      scope: 'Security',
      kind: 'citation',
      source: 'CVE advisory',
      statement: 'Known CVE requires patch.'
    });
    state = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Candidate summary',
      proofDecisions: {
        P1: { status: 'admitted' },
        P2: { status: 'admitted' }
      },
      clauses: [
        { context: 'General', conclusion: 'General passes (P1).', citedProofIds: ['P1'] },
        { context: 'Security', conclusion: 'Security patched (P2).', citedProofIds: ['P2'] }
      ]
    });
    return state;
  }

  it('6.1 should record vote "accept" and transition seat status to "accepted"', () => {
    let state = createConfirmingState();
    assertPhase(state, 'confirming');

    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's1',
      vote: 'accept'
    });

    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.seats[0].status, 'accepted');
  });

  it('6.2 should record vote "object" backed by valid proof and transition seat status to "objected"', () => {
    let state = createConfirmingState();
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'object',
      proofId: 'P2',
      reason: 'Clause 2 does not specify exact CVE patch version.'
    });

    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.seats[1].status, 'objected');
    assert.equal(state.objections.length, 1);
    assert.equal(state.objections[0].id, 'O1');
    assert.equal(state.objections[0].seatId, 's2');
    assert.equal(state.objections[0].proofId, 'P2');
    assert.equal(state.objections[0].status, 'open');
  });

  it('6.3 should reject objection with missing or whitespace-only reason', () => {
    const state = createConfirmingState();
    const badReasons = ['', '   ', null, undefined];
    for (const reason of badReasons) {
      const next = transitionCouncil(state, {
        type: EVENTS.CAST_VOTE,
        seatId: 's2',
        vote: 'object',
        proofId: 'P2',
        reason
      });
      assert.equal(next.lastTransition.ok, false);
      assert.match(next.lastTransition.message, /requires a concrete reason/);
    }
  });

  it('6.4 should reject objection citing a non-existent or rejected proof ID', () => {
    let state = createConfirmingState();
    // Non-existent proof
    const fakeProofAttempt = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'object',
      proofId: 'P_DOES_NOT_EXIST',
      reason: 'Objection reason'
    });
    assert.equal(fakeProofAttempt.lastTransition.ok, false);
    assert.match(fakeProofAttempt.lastTransition.message, /must cite a valid Proof ID/);

    // Rejected proof
    state.proofs[1].status = 'rejected';
    const rejectedProofAttempt = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'object',
      proofId: 'P2',
      reason: 'Objection reason'
    });
    assert.equal(rejectedProofAttempt.lastTransition.ok, false);
    assert.match(rejectedProofAttempt.lastTransition.message, /must cite a valid Proof ID/);
  });

  it('6.5 should auto-withdraw seat\'s own open objections when seat votes "accept"', () => {
    let state = createConfirmingState();
    // Seat 2 objects first
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'object',
      proofId: 'P2',
      reason: 'Needs clarification.'
    });
    assert.equal(state.objections[0].status, 'open');

    // Seat 2 then accepts
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'accept'
    });
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.objections[0].status, 'withdrawn');
  });

  it('6.6 should permit seat owner to explicitly withdraw objection via WITHDRAW_OBJECTION', () => {
    let state = createConfirmingState();
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'object',
      proofId: 'P2',
      reason: 'Preliminary concern.'
    });
    assert.equal(state.objections[0].status, 'open');

    state = transitionCouncil(state, {
      type: EVENTS.WITHDRAW_OBJECTION,
      objectionId: 'O1',
      seatId: 's2'
    });
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.objections[0].status, 'withdrawn');
  });

  it('6.7 should reject non-owner attempting to withdraw another seat\'s objection (Ownership Guard)', () => {
    let state = createConfirmingState();
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'object',
      proofId: 'P2',
      reason: 'Seat 2 objection.'
    });

    // Seat 1 tries to withdraw Seat 2's objection
    const badAttempt = transitionCouncil(state, {
      type: EVENTS.WITHDRAW_OBJECTION,
      objectionId: 'O1',
      seatId: 's1'
    });
    assert.equal(badAttempt.lastTransition.ok, false);
    assert.match(badAttempt.lastTransition.message, /Seat "s1" cannot withdraw Objection "O1" owned by "s2"/);
  });

  it('6.8 should prevent withdrawal of preserved_excused objections (ADR 0003 Vulnerability Fix)', () => {
    let state = createInitialCouncilState({
      minQuorum: 2,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'antigravity', model: 'm2', soul: 'soul2' },
        { id: 's3', harness: 'cursor', model: 'm3', soul: 'soul3' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 's1',
      scope: 'Scope',
      kind: 'check',
      source: 'Source',
      statement: 'Statement'
    });
    state = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Summary',
      clauses: [{ context: 'Scope', conclusion: 'Conc', citedProofIds: ['P1'] }]
    });

    // s2 objects
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'object',
      proofId: 'P1',
      reason: 'Disagreement'
    });
    assert.equal(state.objections[0].status, 'open');

    // s2 faults and is excused
    state = transitionCouncil(state, { type: EVENTS.SEAT_FAULT, seatId: 's2', reason: 'Quota' });
    state = transitionCouncil(state, { type: EVENTS.EXCUSE_SEAT, seatId: 's2' });
    assert.equal(state.objections[0].status, 'preserved_excused');

    // s2 tries to withdraw preserved_excused objection
    const attemptByS2 = transitionCouncil(state, {
      type: EVENTS.WITHDRAW_OBJECTION,
      objectionId: 'O1',
      seatId: 's2'
    });
    assert.equal(attemptByS2.lastTransition.ok, false);
    assert.match(attemptByS2.lastTransition.message, /preserved_excused|cannot withdraw/i);

    // s1 tries to withdraw preserved_excused objection
    const attemptByS1 = transitionCouncil(state, {
      type: EVENTS.WITHDRAW_OBJECTION,
      objectionId: 'O1',
      seatId: 's1'
    });
    assert.equal(attemptByS1.lastTransition.ok, false);
  });

  it('6.9 should reject voting from an excused seat', () => {
    let state = createInitialCouncilState({
      minQuorum: 2,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' },
        { id: 's3', harness: 'codex', model: 'm3', soul: 'soul3' }
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
      summary: 'S',
      clauses: [{ context: 'S', conclusion: 'C', citedProofIds: ['P1'] }]
    });

    state = transitionCouncil(state, { type: EVENTS.EXCUSE_SEAT, seatId: 's3', reason: 'Quota' });

    const voteAttempt = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's3',
      vote: 'accept'
    });
    assert.equal(voteAttempt.lastTransition.ok, false);
    assert.match(voteAttempt.lastTransition.message, /not an active voting Seat/);
  });
});
