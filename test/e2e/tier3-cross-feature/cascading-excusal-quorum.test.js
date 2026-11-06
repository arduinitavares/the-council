import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 3: Cross-Feature — Cascading Excusals & Quorum Preservation to Failure', () => {
  it('C4.1 should sustain sequential excusals while quorum holds, then terminate to Dissent Report when quorum breaks', () => {
    let state = createInitialCouncilState({
      minQuorum: 2,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' },
        { id: 's3', harness: 'antigravity', model: 'm3', soul: 'soul3' },
        { id: 's4', harness: 'cursor', model: 'm4', soul: 'soul4' }
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

    // Excusal 1: s1 faults and is excused
    state = transitionCouncil(state, { type: EVENTS.EXCUSE_SEAT, seatId: 's1', reason: 'Quota #1' });
    assert.equal(state.phase, 'confirming');
    let active = state.seats.filter((s) => s.status !== 'excused');
    assert.equal(active.length, 3); // 3 >= 2

    // Seat 2 objects
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'object',
      proofId: 'P1',
      reason: 'Dissenting argument from s2'
    });
    assert.equal(state.objections[0].status, 'open');

    // Excusal 2: s2 faults and is excused -> objection locked as preserved_excused
    state = transitionCouncil(state, { type: EVENTS.EXCUSE_SEAT, seatId: 's2', reason: 'Quota #2' });
    assert.equal(state.phase, 'confirming');
    assert.equal(state.objections[0].status, 'preserved_excused');
    active = state.seats.filter((s) => s.status !== 'excused');
    assert.equal(active.length, 2); // 2 >= 2

    // Excusal 3: s3 faults and is excused -> active seats drops to 1 (< minQuorum 2) -> TERMINATION!
    state = transitionCouncil(state, { type: EVENTS.EXCUSE_SEAT, seatId: 's3', reason: 'Quota #3' });
    assert.equal(state.phase, 'completed');
    assert.ok(state.verdict);
    assert.equal(state.verdict.kind, 'Dissent Report (Below Quorum)');
    assert.equal(state.verdict.activeSeatCount, 1);
    assert.equal(state.verdict.excusedSeatCount, 3);
    // Preserved objection from s2 is included in unresolved objections
    assert.equal(state.verdict.unresolvedObjections.length, 1);
    assert.equal(state.verdict.unresolvedObjections[0].id, 'O1');
    assert.equal(state.verdict.unresolvedObjections[0].status, 'preserved_excused');
  });
});
