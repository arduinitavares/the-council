import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 3: Cross-Feature — Telemetry Stream Decoupling & Transition Concurrency', () => {
  it('C5.1 should handle high-frequency telemetry stream across multiple seats without disrupting phase transitions', () => {
    let state = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Engineer' },
        { id: 's2', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Architect' },
        { id: 's3', harness: 'antigravity', model: 'gemini-4-argon', soul: 'Reviewer' }
      ]
    });

    // Fire telemetry during preflight
    state = transitionCouncil(state, { type: EVENTS.SEAT_TELEMETRY, seatId: 's1', status: 'thinking' });
    state = transitionCouncil(state, { type: EVENTS.SEAT_TELEMETRY, seatId: 's2', status: 'idle' });
    state = transitionCouncil(state, { type: EVENTS.SEAT_TELEMETRY, seatId: 's3', status: 'thinking' });
    assert.equal(state.phase, 'preflight');

    // Begin round
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(state.phase, 'reviewing');

    // Interleave telemetry updates between proof submissions
    state = transitionCouncil(state, { type: EVENTS.SEAT_TELEMETRY, seatId: 's1', status: 'drafting_proof' });
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 's1',
      scope: 'S1',
      kind: 'check',
      source: 'Src1',
      statement: 'Stmt1'
    });
    assert.equal(state.phase, 'reviewing');
    assert.equal(state.seats[0].status, 'proof_submitted');

    state = transitionCouncil(state, { type: EVENTS.SEAT_TELEMETRY, seatId: 's2', status: 'reviewing_p1' });
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P2',
      seatId: 's2',
      scope: 'S2',
      kind: 'citation',
      source: 'Src2',
      statement: 'Stmt2'
    });
    assert.equal(state.phase, 'reviewing');

    // Transition to judging
    state = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    assert.equal(state.phase, 'judging');

    // Telemetry during judging
    state = transitionCouncil(state, { type: EVENTS.SEAT_TELEMETRY, seatId: 's3', status: 'waiting_for_judge' });
    assert.equal(state.phase, 'judging');

    // Synthesize candidate
    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Candidate',
      clauses: [{ context: 'S1', conclusion: 'C1', citedProofIds: ['P1', 'P2'] }]
    });
    assert.equal(state.phase, 'confirming');

    // Excuse s3
    state = transitionCouncil(state, { type: EVENTS.EXCUSE_SEAT, seatId: 's3', reason: 'Timeout' });
    assert.equal(state.seats[2].status, 'excused');

    // Telemetry to excused seat is rejected
    const badTelemetry = transitionCouncil(state, {
      type: EVENTS.SEAT_TELEMETRY,
      seatId: 's3',
      status: 'thinking'
    });
    assert.equal(badTelemetry.lastTransition.ok, false);

    // Telemetry to active seats continues to succeed
    state = transitionCouncil(state, { type: EVENTS.SEAT_TELEMETRY, seatId: 's1', status: 'voting_ready' });
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.seats[0].status, 'voting_ready');
  });
});
