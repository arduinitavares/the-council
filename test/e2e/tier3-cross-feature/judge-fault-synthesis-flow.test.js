import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 3: Cross-Feature — Judge Fault Mid-Deliberation + Recovery + Synthesis', () => {
  it('C3.1 should pause deliberation on Judge fault, reject premature voting, retry Judge, and proceed to synthesis', () => {
    let state = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Engineer' },
        { id: 's2', harness: 'antigravity', model: 'gemini-4-argon', soul: 'Tester' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 's1',
      scope: 'Core Engine',
      kind: 'check',
      source: 'Unit suite',
      statement: 'Passes all unit checks.'
    });

    // Enter judging
    state = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    assert.equal(state.phase, 'judging');

    // Judge hits quota timeout
    state = transitionCouncil(state, { type: EVENTS.JUDGE_FAULT });
    assert.equal(state.phase, 'judge_fault');
    assert.equal(state.judge.status, 'fault_quota');

    // Verify seats cannot cast votes while in judge_fault
    const prematureVote = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's1',
      vote: 'accept'
    });
    assert.equal(prematureVote.lastTransition.ok, false);
    assert.match(prematureVote.lastTransition.message, /Seats can only vote during the confirming phase/);

    // Verify seats cannot submit proofs while in judge_fault
    const prematureProof = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      seatId: 's1',
      scope: 'S',
      kind: 'check',
      source: 'Src',
      statement: 'Stmt'
    });
    assert.equal(prematureProof.lastTransition.ok, false);

    // Retry Judge
    state = transitionCouncil(state, { type: EVENTS.RETRY_JUDGE });
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.phase, 'judging');
    assert.equal(state.judge.status, 'thinking');
    assert.equal(state.judge.retries, 1);

    // Judge now successfully audits and synthesizes candidate
    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Deliberation candidate post-judge-recovery',
      proofDecisions: { P1: { status: 'admitted' } },
      clauses: [{ context: 'Core Engine', conclusion: 'Ready (P1)', citedProofIds: ['P1'] }]
    });

    assert.equal(state.phase, 'confirming');
    assert.equal(state.candidate.clauses.length, 1);
  });
});
