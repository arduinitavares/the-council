import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 2: Boundary & Corner Cases — Round Limits & Phase Transitions', () => {
  it('B6.1 should terminate with Dissent Report immediately on round 1 objection when maxRounds is 1', () => {
    let state = createInitialCouncilState({
      maxRounds: 1,
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
      summary: 'Summary',
      clauses: [{ context: 'S', conclusion: 'C', citedProofIds: ['P1'] }]
    });

    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 's1', vote: 'accept' });
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'object',
      proofId: 'P1',
      reason: 'Disagreement'
    });

    state = transitionCouncil(state, { type: EVENTS.EVALUATE_ROUND });
    assert.equal(state.phase, 'completed');
    assert.equal(state.verdict.kind, 'Dissent Report (Round Limit Reached)');
    assert.equal(state.round, 1);
  });

  it('B6.2 should advance from round 1 to 2, then terminate on round 2 objection when maxRounds is 2', () => {
    let state = createInitialCouncilState({
      maxRounds: 2,
      minQuorum: 2,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    // Round 1
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
      summary: 'R1 Summary',
      clauses: [{ context: 'S', conclusion: 'C', citedProofIds: ['P1'] }]
    });
    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 's1', vote: 'accept' });
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'object',
      proofId: 'P1',
      reason: 'R1 Objection'
    });

    // Advance to Round 2
    state = transitionCouncil(state, { type: EVENTS.EVALUATE_ROUND });
    assert.equal(state.phase, 'reviewing');
    assert.equal(state.round, 2);

    // Round 2
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P2',
      seatId: 's1',
      scope: 'S2',
      kind: 'check',
      source: 'Src2',
      statement: 'Stmt2'
    });
    state = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'R2 Summary',
      clauses: [{ context: 'S', conclusion: 'C', citedProofIds: ['P1', 'P2'] }]
    });
    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 's1', vote: 'accept' });
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'object',
      proofId: 'P1',
      reason: 'R2 Objection remains'
    });

    // Evaluate Round 2 (round 2 >= maxRounds 2) -> terminates
    state = transitionCouncil(state, { type: EVENTS.EVALUATE_ROUND });
    assert.equal(state.phase, 'completed');
    assert.equal(state.verdict.kind, 'Dissent Report (Round Limit Reached)');
    assert.equal(state.round, 2);
  });

  it('B6.3 should reject BEGIN_ROUND when round is already at maxRounds', () => {
    let state = createInitialCouncilState({
      maxRounds: 1,
      minQuorum: 2,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    state.round = 1;
    state.phase = 'confirming';

    const next = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /Maximum deliberation rounds/);
  });

  it('B6.4 should reject out-of-order START_JUDGING from preflight phase', () => {
    const state = createInitialCouncilState({
      seats: [{ id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' }]
    });
    assert.equal(state.phase, 'preflight');

    const next = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /Can only transition to judging from reviewing/);
  });

  it('B6.5 should reject out-of-order CAST_VOTE from reviewing phase', () => {
    let state = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(state.phase, 'reviewing');

    const next = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's1',
      vote: 'accept'
    });
    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /Seats can only vote during the confirming phase/);
  });

  it('B6.6 should reject out-of-order JUDGE_AUDIT_AND_SYNTHESIZE from confirming phase', () => {
    let state = createInitialCouncilState({
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
      summary: 'Summary',
      clauses: [{ context: 'S', conclusion: 'C', citedProofIds: ['P1'] }]
    });
    assert.equal(state.phase, 'confirming');

    // Attempting audit & synthesize again while already in confirming
    const next = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Second attempt',
      clauses: [{ context: 'S', conclusion: 'C', citedProofIds: ['P1'] }]
    });
    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /Judge can only synthesize a Candidate during the judging phase/);
  });
});
