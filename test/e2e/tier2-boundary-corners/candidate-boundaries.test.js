import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  validateCandidateClauses,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 2: Boundary & Corner Cases — Candidate Proof-Binding', () => {
  function getJudgingState() {
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
      scope: 'Database Layer',
      kind: 'check',
      source: 'WAL spec',
      statement: 'SQLite WAL mode avoids writer starvation.'
    });
    return transitionCouncil(state, { type: EVENTS.START_JUDGING });
  }

  it('B2.1 should reject candidate when clauses array is empty or missing', () => {
    const state = getJudgingState();
    const emptyCandidates = [
      { summary: 'Sum', clauses: [] },
      { summary: 'Sum' } // missing clauses
    ];

    for (const cand of emptyCandidates) {
      const next = transitionCouncil(state, {
        type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
        ...cand
      });
      assert.equal(next.lastTransition.ok, false);
      assert.match(next.lastTransition.message, /requires at least one clause/);
    }
  });

  it('B2.2 should reject clause when citedProofIds is empty or missing', () => {
    const state = getJudgingState();
    const badClauses = [
      { context: 'Storage', conclusion: 'Conclusion', citedProofIds: [] },
      { context: 'Storage', conclusion: 'Conclusion' }
    ];

    for (const cl of badClauses) {
      const next = transitionCouncil(state, {
        type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
        summary: 'Candidate',
        clauses: [cl]
      });
      assert.equal(next.lastTransition.ok, false);
      assert.match(next.lastTransition.message, /cites no Proof IDs/);
    }
  });

  it('B2.3 should reject clause citing non-existent proof ID', () => {
    const state = getJudgingState();
    const next = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Candidate',
      clauses: [
        { context: 'Storage', conclusion: 'Use SQLite', citedProofIds: ['P_NONEXISTENT'] }
      ]
    });
    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /cites unverified Proof "P_NONEXISTENT"/);
  });

  it('B2.4 should reject clause citing explicitly rejected proof ID', () => {
    const state = getJudgingState();
    const next = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Candidate',
      proofDecisions: {
        P1: { status: 'rejected', note: 'Flawed premise' }
      },
      clauses: [
        { context: 'Storage', conclusion: 'Use SQLite', citedProofIds: ['P1'] }
      ]
    });
    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /cites unverified Proof "P1"/);
  });

  it('B2.5 should preserve judging state atomically when one clause in candidate fails validation', () => {
    const state = getJudgingState();
    assert.equal(state.phase, 'judging');
    assert.equal(state.candidate, null);

    // Multi-clause candidate where clause 1 is valid, but clause 2 cites P_BAD
    const next = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Partial candidate',
      proofDecisions: { P1: { status: 'admitted' } },
      clauses: [
        { context: 'Valid context', conclusion: 'Valid conclusion', citedProofIds: ['P1'] },
        { context: 'Invalid context', conclusion: 'Invalid conclusion', citedProofIds: ['P_BAD'] }
      ]
    });

    assert.equal(next.lastTransition.ok, false);
    // State remains in judging, candidate remains null
    assert.equal(next.phase, 'judging');
    assert.equal(next.candidate, null);
    assert.match(next.lastTransition.message, /cites unverified Proof "P_BAD"/);
  });

  it('B2.6 should permit citing proof admitted in an earlier round', () => {
    let state = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'antigravity', model: 'm2', soul: 'soul2' }
      ]
    });
    // Round 1
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 's1',
      scope: 'R1 Scope',
      kind: 'check',
      source: 'Src1',
      statement: 'Stmt1'
    });
    state = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Round 1 Candidate',
      proofDecisions: { P1: { status: 'admitted' } },
      clauses: [{ context: 'R1 Context', conclusion: 'R1', citedProofIds: ['P1'] }]
    });

    // Object in Round 1 to advance to Round 2
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'object',
      proofId: 'P1',
      reason: 'Need Round 2 discussion'
    });
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's1',
      vote: 'accept'
    });
    state = transitionCouncil(state, { type: EVENTS.EVALUATE_ROUND });
    assert.equal(state.phase, 'reviewing');
    assert.equal(state.round, 2);

    // Round 2 submits P2 and transitions to judging
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P2',
      seatId: 's2',
      scope: 'R2 Scope',
      kind: 'benchmark',
      source: 'Src2',
      statement: 'Stmt2'
    });
    state = transitionCouncil(state, { type: EVENTS.START_JUDGING });

    // Judge in Round 2 cites both P1 (from Round 1) and P2 (from Round 2)
    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Round 2 Candidate citing P1 and P2',
      proofDecisions: { P2: { status: 'admitted' } },
      clauses: [
        { context: 'Combined', conclusion: 'Synthesized', citedProofIds: ['P1', 'P2'] }
      ]
    });

    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.phase, 'confirming');
    assert.deepEqual(state.candidate.clauses[0].citedProofIds, ['P1', 'P2']);
  });

  it('B2.7 should reject candidate with null or non-object clause element without throwing uncaught TypeError', () => {
    const state = getJudgingState();
    const badClausesList = [
      [null],
      [undefined],
      ['string clause'],
      [null, { context: 'Storage', conclusion: 'Use SQLite', citedProofIds: ['P1'] }]
    ];

    for (const clauses of badClausesList) {
      const next = transitionCouncil(state, {
        type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
        summary: 'Candidate',
        clauses
      });
      assert.equal(next.lastTransition.ok, false);
      assert.match(next.lastTransition.message, /Clause 1 is malformed/);
    }
  });

  it('B2.8 should reject candidate clause citing Object.prototype property as unverified proof ID', () => {
    const state = getJudgingState();
    const next = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Candidate',
      clauses: [
        { context: 'Exploit', conclusion: 'Bypass', citedProofIds: ['toString'] }
      ]
    });
    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /cites unverified Proof "toString"/);
  });
});
