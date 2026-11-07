import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  assertPhase,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 3: Cross-Feature — Multi-Harness + Quota Excusal + Preserved Objection', () => {
  it('C1.1 should preserve objection from excused Cursor seat across multi-harness roster and prevent false consensus', () => {
    // 1. Roster across 3 harnesses: Codex (2 seats), Antigravity (1 seat), Cursor (1 seat)
    let state = createInitialCouncilState({
      topic: 'Evaluate memory persistence backend',
      minQuorum: 2,
      maxRounds: 3,
      maxRetriesPerSeat: 1,
      judge: {
        id: 'judge-astra',
        harness: 'codex',
        model: 'gpt-6-astra',
        soul: 'Impartial Systems Judge'
      },
      seats: [
        { id: 'codex-arch', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Architect' },
        { id: 'codex-sre', harness: 'codex', model: 'gpt-6-astra', soul: 'SRE' },
        { id: 'agy-sec', harness: 'antigravity', model: 'gemini-4-argon', soul: 'Security' },
        { id: 'cursor-qa', harness: 'cursor', model: 'grok-4.7', soul: 'QA Challenger' }
      ]
    });

    assertPhase(state, 'preflight');
    assert.equal(state.seats.length, 4);

    // 2. Begin Round 1
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assertPhase(state, 'reviewing');
    assert.equal(state.round, 1);

    // 3. Codex and Antigravity seats submit proofs
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P_CODEX',
      seatId: 'codex-arch',
      scope: 'Local CLI execution',
      kind: 'check',
      source: 'CLI spec',
      statement: 'SQLite WAL runs in-process.'
    });
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P_AGY',
      seatId: 'agy-sec',
      scope: 'Data Security',
      kind: 'citation',
      source: 'File permission matrix',
      statement: 'Local file permissions prevent unauthorized socket access.'
    });

    // 4. Cursor seat submits proof P_CURSOR
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P_CURSOR',
      seatId: 'cursor-qa',
      scope: 'Multi-process contention',
      kind: 'benchmark',
      source: 'Stress test script',
      statement: 'Concurrent external writers trigger SQLITE_BUSY without busy_timeout.'
    });

    // 5. Judge audits proofs and synthesizes candidate
    state = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Candidate recommending SQLite WAL mode',
      proofDecisions: {
        P_CODEX: { status: 'admitted' },
        P_AGY: { status: 'admitted' },
        P_CURSOR: { status: 'admitted' }
      },
      clauses: [
        { context: 'Local Execution', conclusion: 'Use SQLite WAL (P_CODEX, P_AGY)', citedProofIds: ['P_CODEX', 'P_AGY'] }
      ]
    });
    assertPhase(state, 'confirming');

    // 6. Voting: Codex and Antigravity seats accept
    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 'codex-arch', vote: 'accept' });
    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 'codex-sre', vote: 'accept' });
    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 'agy-sec', vote: 'accept' });

    // 7. Cursor seat objects citing P_CURSOR
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 'cursor-qa',
      vote: 'object',
      proofId: 'P_CURSOR',
      reason: 'Candidate omits mandatory busy_timeout configuration proven necessary by P_CURSOR.'
    });
    assert.equal(state.objections.length, 1);
    assert.equal(state.objections[0].status, 'open');

    // 8. Cursor seat hits weekly quota limit (HTTP 429) -> SEAT_FAULT
    state = transitionCouncil(state, {
      type: EVENTS.SEAT_FAULT,
      seatId: 'cursor-qa',
      reason: 'Cursor weekly pool exhausted (HTTP 429)'
    });
    assertPhase(state, 'seat_fault');

    // 9. Retry once
    state = transitionCouncil(state, { type: EVENTS.RETRY_SEAT, seatId: 'cursor-qa' });
    assertPhase(state, 'confirming');

    // 10. Faults again -> cap hit -> Excuse Seat
    state = transitionCouncil(state, {
      type: EVENTS.SEAT_FAULT,
      seatId: 'cursor-qa',
      reason: 'Cursor still exhausted'
    });
    state = transitionCouncil(state, {
      type: EVENTS.EXCUSE_SEAT,
      seatId: 'cursor-qa',
      reason: 'Quota exhausted after retry'
    });

    // 11. Verify Cursor seat's objection is permanently locked as preserved_excused
    assert.equal(state.objections[0].status, 'preserved_excused');
    assertPhase(state, 'confirming');

    // 12. Evaluate Round: remaining 3 active seats all accepted, but preserved_excused objection blocks false consensus!
    state = transitionCouncil(state, { type: EVENTS.EVALUATE_ROUND });
    assertPhase(state, 'completed');
    assert.ok(state.verdict);
    assert.equal(state.verdict.kind, 'Dissent Report (Preserved Excused-Seat Objection)');
    assert.equal(state.verdict.activeSeatCount, 3);
    assert.equal(state.verdict.excusedSeatCount, 1);
    assert.equal(state.verdict.unresolvedObjections.length, 1);
    assert.equal(state.verdict.unresolvedObjections[0].seatId, 'cursor-qa');
    assert.match(state.verdict.note, /Objection\(s\) from an Excused Seat remain locked/);
  });
});
