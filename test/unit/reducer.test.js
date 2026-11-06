import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  getDependencyAndStateGraph,
  activeSeats,
  excusedSeats,
  isQuorumSatisfied,
  getOpenObjections,
  getPreservedObjections,
  getAdmittedProofs,
  COUNCIL_PHASES,
  COUNCIL_EVENTS
} from '../../src/index.js';

describe('Unit: Production State Machine Reducer (src/machine/reducer.js)', () => {
  it('creates clean initial CouncilState with default configuration', () => {
    const state = createInitialCouncilState();
    assert.equal(state.phase, 'preflight');
    assert.equal(state.canonicalPhase, 'ROSTER_CONFIGURATION');
    assert.equal(state.round, 0);
    assert.equal(state.minQuorum, 2);
    assert.equal(state.maxRounds, 3);
    assert.equal(state.maxClarificationBatches, 2);
    assert.equal(state.maxRetriesPerSeat, 1);
    assert.equal(state.seats.length, 0);
    assert.equal(state.proofs.length, 0);
    assert.equal(state.objections.length, 0);
    assert.equal(state.candidate, null);
    assert.equal(state.verdict, null);
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.history.length, 1);
  });

  it('preserves purity: transitionCouncil never mutates input state in-place', () => {
    const initial = createInitialCouncilState();
    const event = {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's1', harness: 'codex', model: 'gpt-6', soul: 'Architect' }
    };

    const next = transitionCouncil(initial, event);
    assert.notEqual(initial, next);
    assert.equal(initial.seats.length, 0);
    assert.equal(next.seats.length, 1);
  });

  it('rejects events with unknown or missing type property', () => {
    const state = createInitialCouncilState();
    const bad1 = transitionCouncil(state, null);
    assert.equal(bad1.lastTransition.ok, false);

    const bad2 = transitionCouncil(state, { type: 'NON_EXISTENT_EVENT' });
    assert.equal(bad2.lastTransition.ok, false);
    assert.match(bad2.lastTransition.message, /Unknown event type/);
  });

  it('transitions through full consensus lifecycle across all 9 canonical phases', () => {
    // 1. ROSTER_CONFIGURATION (preflight)
    let state = createInitialCouncilState({ minQuorum: 2 });
    assert.equal(state.phase, 'preflight');
    assert.equal(state.canonicalPhase, 'ROSTER_CONFIGURATION');

    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 'seat-a', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Engineer' }
    });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 'seat-b', harness: 'antigravity', model: 'gemini-4-argon', soul: 'QA' }
    });
    assert.equal(state.seats.length, 2);
    assert.equal(activeSeats(state).length, 2);
    assert.equal(isQuorumSatisfied(state), true);

    // 2. SEAT_TELEMETRY (no phase disruption)
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.SEAT_TELEMETRY,
      seatId: 'seat-a',
      status: 'thinking'
    });
    assert.equal(state.phase, 'preflight');
    assert.equal(state.seats[0].status, 'thinking');

    // 3. DISCOVERY (clarifying)
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.START_CLARIFYING });
    assert.equal(state.phase, 'clarifying');
    assert.equal(state.canonicalPhase, 'DISCOVERY');
    assert.equal(state.clarificationBatch, 1);

    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.PUBLISH_CLARIFICATION,
      answer: 'Clarification answer for batch 1.'
    });
    assert.equal(state.clarifications.length, 1);

    // 4. DELIBERATION (reviewing)
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.BEGIN_ROUND });
    assert.equal(state.phase, 'reviewing');
    assert.equal(state.canonicalPhase, 'DELIBERATION');
    assert.equal(state.round, 1);

    // 5. SUBMIT_PROOF
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 'seat-a',
      scope: 'Performance',
      kind: 'benchmark',
      source: 'perf.log',
      statement: 'Latency p99 is 3ms.'
    });
    assert.equal(state.proofs.length, 1);

    // 6. JUDGE_AUDIT_SYNTHESIS (judging)
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.START_JUDGING });
    assert.equal(state.phase, 'judging');
    assert.equal(state.canonicalPhase, 'JUDGE_AUDIT_SYNTHESIS');

    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Round 1 Candidate',
      proofDecisions: { P1: { status: 'admitted', note: 'Valid benchmark' } },
      clauses: [{ context: 'Performance', conclusion: 'Fast', citedProofIds: ['P1'] }]
    });
    assert.equal(state.phase, 'confirming');
    assert.equal(state.canonicalPhase, 'VOTING');
    assert.ok(state.candidate);

    // 7. VOTING (confirming) with Objection & Withdrawal
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.CAST_VOTE,
      seatId: 'seat-b',
      vote: 'object',
      proofId: 'P1',
      reason: 'Need safety check.'
    });
    assert.equal(getOpenObjections(state).length, 1);

    // Withdraw objection
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.WITHDRAW_OBJECTION,
      objectionId: 'O1',
      seatId: 'seat-b'
    });
    assert.equal(getOpenObjections(state).length, 0);

    // Cast accept votes
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.CAST_VOTE,
      seatId: 'seat-a',
      vote: 'accept'
    });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.CAST_VOTE,
      seatId: 'seat-b',
      vote: 'accept'
    });

    // 8. EVALUATE_ROUND -> CONSENSUS_REACHED (completed)
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.EVALUATE_ROUND });
    assert.equal(state.phase, 'completed');
    assert.equal(state.canonicalPhase, 'CONSENSUS_REACHED');
    assert.equal(state.verdict?.kind, 'Unanimous Consensus');
  });

  it('handles RECOVERY phase: SEAT_FAULT, RETRY_SEAT, and EXCUSE_SEAT', () => {
    let state = createInitialCouncilState({ minQuorum: 2 });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' }
    });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
    });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's3', harness: 'cursor', model: 'm3', soul: 'soul3' }
    });
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.BEGIN_ROUND });
    assert.equal(state.phase, 'reviewing');

    // Seat 3 faults on quota
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.SEAT_FAULT,
      seatId: 's3',
      reason: 'Rate limit hit'
    });
    assert.equal(state.phase, 'seat_fault');
    assert.equal(state.canonicalPhase, 'RECOVERY');
    assert.equal(state.faultSeatId, 's3');

    // Retry seat 3
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.RETRY_SEAT, seatId: 's3' });
    assert.equal(state.phase, 'reviewing');
    assert.equal(state.seats[2].retries, 1);

    // Seat 3 faults again -> Retry cap exceeded -> Excused
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.SEAT_FAULT, seatId: 's3' });
    const retryFail = transitionCouncil(state, { type: COUNCIL_EVENTS.RETRY_SEAT, seatId: 's3' });
    assert.equal(retryFail.lastTransition.ok, false);
    assert.match(retryFail.lastTransition.message, /Retry Cap Guard/);

    // Excuse seat 3
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.EXCUSE_SEAT, seatId: 's3' });
    assert.equal(state.phase, 'reviewing');
    assert.equal(state.seats[2].status, 'excused');
    assert.equal(activeSeats(state).length, 2);
    assert.equal(excusedSeats(state).length, 1);
  });

  it('handles JUDGE_FAULT and RETRY_JUDGE', () => {
    let state = createInitialCouncilState({ minQuorum: 2 });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' }
    });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
    });
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.BEGIN_ROUND });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 's1',
      scope: 'sc',
      kind: 'check',
      source: 'src',
      statement: 'stmt'
    });
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.START_JUDGING });
    assert.equal(state.phase, 'judging');

    // Judge faults
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.JUDGE_FAULT });
    assert.equal(state.phase, 'judge_fault');
    assert.equal(state.canonicalPhase, 'RECOVERY');
    assert.equal(state.judge.status, 'fault_quota');

    // Retry judge
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.RETRY_JUDGE });
    assert.equal(state.phase, 'judging');
    assert.equal(state.judge.retries, 1);
  });

  it('terminates with ROUND_TIMEOUT when round limit reached with open objections', () => {
    let state = createInitialCouncilState({ minQuorum: 2, maxRounds: 1 });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' }
    });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
    });
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.BEGIN_ROUND });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 's1',
      scope: 'sc',
      kind: 'check',
      source: 'src',
      statement: 'stmt'
    });
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.START_JUDGING });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Candidate',
      clauses: [{ context: 'sc', conclusion: 'conc', citedProofIds: ['P1'] }]
    });

    state = transitionCouncil(state, { type: COUNCIL_EVENTS.CAST_VOTE, seatId: 's1', vote: 'accept' });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'object',
      proofId: 'P1',
      reason: 'Disagreement'
    });

    state = transitionCouncil(state, { type: COUNCIL_EVENTS.EVALUATE_ROUND });
    assert.equal(state.phase, 'completed');
    assert.equal(state.canonicalPhase, 'ROUND_TIMEOUT');
    assert.equal(state.verdict?.kind, 'Dissent Report (Round Limit Reached)');
  });

  it('resets state cleanly via RESET event', () => {
    let state = createInitialCouncilState();
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' }
    });
    assert.equal(state.seats.length, 1);

    const fresh = transitionCouncil(state, { type: COUNCIL_EVENTS.RESET });
    assert.equal(fresh.seats.length, 0);
    assert.equal(fresh.phase, 'preflight');
    assert.equal(fresh.canonicalPhase, 'ROSTER_CONFIGURATION');
  });

  it('computes graph topology via getDependencyAndStateGraph', () => {
    const state = createInitialCouncilState();
    const graph = getDependencyAndStateGraph(state);
    assert.ok(graph.nodes.length >= 8);
    assert.ok(graph.edges.length >= 10);
    assert.equal(graph.activeNodeId, 'preflight');
    assert.ok(Array.isArray(graph.causalLinks));
  });
});
