import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  assertPhase,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 1: Feature Coverage — Round Evaluation & Verdicts', () => {
  function setupRoundAtVoting(maxRounds = 3) {
    let state = createInitialCouncilState({
      maxRounds,
      minQuorum: 2,
      seats: [
        { id: 's1', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Architect' },
        { id: 's2', harness: 'antigravity', model: 'gemini-4-argon', soul: 'Engineer' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 's1',
      scope: 'Core',
      kind: 'check',
      source: 'Test',
      statement: 'Passes test'
    });
    state = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Candidate',
      clauses: [{ context: 'Core', conclusion: 'Core pass', citedProofIds: ['P1'] }]
    });
    return state;
  }

  it('8.1 should reject EVALUATE_ROUND if not all active seats have voted', () => {
    let state = setupRoundAtVoting();
    assertPhase(state, 'confirming');

    // Only s1 votes
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's1',
      vote: 'accept'
    });

    const next = transitionCouncil(state, { type: EVENTS.EVALUATE_ROUND });
    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /active Seat\(s\) have not voted yet/);
  });

  it('8.2 should emit "Unanimous Consensus" when all active seats accept with zero objections', () => {
    let state = setupRoundAtVoting();
    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 's1', vote: 'accept' });
    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 's2', vote: 'accept' });

    state = transitionCouncil(state, { type: EVENTS.EVALUATE_ROUND });
    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'completed');
    assert.ok(state.verdict);
    assert.equal(state.verdict.kind, 'Unanimous Consensus');
    assert.equal(state.verdict.activeSeatCount, 2);
    assert.equal(state.verdict.excusedSeatCount, 0);
    assert.equal(state.verdict.unresolvedObjections.length, 0);
  });

  it('8.3 should advance to next round when open objections exist and round < maxRounds', () => {
    let state = setupRoundAtVoting(3); // round 1 of 3
    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 's1', vote: 'accept' });
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'object',
      proofId: 'P1',
      reason: 'Requires scope constraint'
    });

    state = transitionCouncil(state, { type: EVENTS.EVALUATE_ROUND });
    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'reviewing');
    assert.equal(state.round, 2);
    assert.equal(state.seats[0].status, 'thinking');
    assert.equal(state.seats[1].status, 'thinking');
  });

  it('8.4 should emit "Dissent Report (Round Limit Reached)" when open objections remain and round >= maxRounds', () => {
    let state = setupRoundAtVoting(1); // maxRounds: 1, current round: 1
    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 's1', vote: 'accept' });
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'object',
      proofId: 'P1',
      reason: 'Unresolved disagreement'
    });

    state = transitionCouncil(state, { type: EVENTS.EVALUATE_ROUND });
    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'completed');
    assert.ok(state.verdict);
    assert.equal(state.verdict.kind, 'Dissent Report (Round Limit Reached)');
    assert.equal(state.verdict.unresolvedObjections.length, 1);
    assert.equal(state.verdict.unresolvedObjections[0].status, 'open');
  });

  it('8.5 should emit "Dissent Report (Preserved Excused-Seat Objection)" when all active seats accept but preserved objection exists', () => {
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

    // s3 objects
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's3',
      vote: 'object',
      proofId: 'P1',
      reason: 'Persistent objection from s3'
    });

    // s3 is excused, locking objection
    state = transitionCouncil(state, { type: EVENTS.EXCUSE_SEAT, seatId: 's3', reason: 'Fault' });
    assert.equal(state.objections[0].status, 'preserved_excused');

    // Remaining active seats s1 and s2 vote accept
    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 's1', vote: 'accept' });
    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 's2', vote: 'accept' });

    // Round evaluation must block consensus!
    state = transitionCouncil(state, { type: EVENTS.EVALUATE_ROUND });
    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'completed');
    assert.ok(state.verdict);
    assert.equal(state.verdict.kind, 'Dissent Report (Preserved Excused-Seat Objection)');
    assert.equal(state.verdict.unresolvedObjections.length, 1);
    assert.equal(state.verdict.unresolvedObjections[0].status, 'preserved_excused');
  });

  it('8.6 should evaluate to Dissent Report if active seats drop below quorum at evaluation time', () => {
    let state = setupRoundAtVoting();
    // Simulate drop below quorum
    state.seats[1].status = 'excused';
    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 's1', vote: 'accept' });

    state = transitionCouncil(state, { type: EVENTS.EVALUATE_ROUND });
    assertPhase(state, 'completed');
    assert.equal(state.verdict.kind, 'Dissent Report (Below Quorum)');
  });
});
