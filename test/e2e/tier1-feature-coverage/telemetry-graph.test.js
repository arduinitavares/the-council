import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  getDependencyAndStateGraph,
  assertPhase,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 1: Feature Coverage — Telemetry & Graph Introspection', () => {
  function createStandardCouncil() {
    return createInitialCouncilState({
      seats: [
        { id: 'seat-1', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Architect' },
        { id: 'seat-2', harness: 'antigravity', model: 'gemini-4-argon', soul: 'Engineer' }
      ]
    });
  }

  it('9.1 should emit SEAT_TELEMETRY updating seat status without altering state phase', () => {
    let state = createStandardCouncil();
    assertPhase(state, 'preflight');
    assert.equal(state.seats[0].status, 'idle');

    state = transitionCouncil(state, {
      type: EVENTS.SEAT_TELEMETRY,
      seatId: 'seat-1',
      status: 'thinking'
    });

    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'preflight'); // Phase untouched
    assert.equal(state.seats[0].status, 'thinking');
    assert.match(state.lastTransition.message, /Observer telemetry: Seat "seat-1" is now \[THINKING\]/);
  });

  it('9.2 should reject SEAT_TELEMETRY for unknown seat ID', () => {
    const state = createStandardCouncil();
    const badAttempt = transitionCouncil(state, {
      type: EVENTS.SEAT_TELEMETRY,
      seatId: 'seat-unknown',
      status: 'thinking'
    });

    assert.equal(badAttempt.lastTransition.ok, false);
    assert.match(badAttempt.lastTransition.message, /unknown or excused Seat "seat-unknown"/);
  });

  it('9.3 should reject SEAT_TELEMETRY for excused seat', () => {
    let state = createStandardCouncil();
    state = transitionCouncil(state, {
      type: EVENTS.EXCUSE_SEAT,
      seatId: 'seat-1',
      reason: 'Quota exhausted'
    });
    assert.equal(state.seats[0].status, 'excused');

    const telemetryAttempt = transitionCouncil(state, {
      type: EVENTS.SEAT_TELEMETRY,
      seatId: 'seat-1',
      status: 'proof_submitted'
    });
    assert.equal(telemetryAttempt.lastTransition.ok, false);
    assert.match(telemetryAttempt.lastTransition.message, /unknown or excused Seat "seat-1"/);
  });

  it('9.4 should generate valid state machine nodes and edges via getDependencyAndStateGraph', () => {
    const state = createStandardCouncil();
    const graph = getDependencyAndStateGraph(state);

    assert.ok(Array.isArray(graph.nodes));
    assert.ok(graph.nodes.length >= 8);
    assert.ok(graph.activeNodeId);
    assert.ok(Array.isArray(graph.edges));
    assert.ok(graph.edges.length >= 10);
  });

  it('9.5 should dynamically compute unlocked status on outgoing graph edges', () => {
    let state = createStandardCouncil(); // 2 seats, minQuorum 2
    let graph = getDependencyAndStateGraph(state);
    assert.ok(graph.outgoingEdges.length > 0);
    const preRevEdge = graph.outgoingEdges.find((e) => e.to === 'reviewing' || e.to === 'DELIBERATION');
    assert.ok(preRevEdge);
    assert.equal(preRevEdge.unlocked, true);

    // If active seats drop below quorum:
    state.seats[0].status = 'excused';
    graph = getDependencyAndStateGraph(state);
    const preRevEdgeLocked = graph.outgoingEdges.find((e) => e.to === 'reviewing' || e.to === 'DELIBERATION');
    assert.ok(preRevEdgeLocked);
    assert.equal(preRevEdgeLocked.unlocked, false);
  });

  it('9.6 should compute causal links: seat -> proof -> candidate clause -> objection', () => {
    let state = createStandardCouncil();
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 'seat-1',
      scope: 'Core',
      kind: 'check',
      source: 'Spec',
      statement: 'Pass'
    });
    state = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Candidate',
      clauses: [{ context: 'Core', conclusion: 'Pass (P1)', citedProofIds: ['P1'] }]
    });
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 'seat-2',
      vote: 'object',
      proofId: 'P1',
      reason: 'Disagreement'
    });

    const graph = getDependencyAndStateGraph(state);
    assert.ok(Array.isArray(graph.causalLinks));

    // Check Seat -> Proof link
    const seatProofLink = graph.causalLinks.find((l) => l.fromId === 'seat-1' && l.toId === 'P1');
    assert.ok(seatProofLink);
    assert.equal(seatProofLink.fromKind, 'seat');
    assert.equal(seatProofLink.toKind, 'proof');

    // Check Proof -> Clause link
    const proofClauseLink = graph.causalLinks.find((l) => l.fromId === 'P1' && l.toKind === 'clause');
    assert.ok(proofClauseLink);
    assert.equal(proofClauseLink.fromKind, 'proof');

    // Check Objection -> Seat and Proof links
    const objSeatLink = graph.causalLinks.find((l) => l.fromId === 'seat-2' && l.toKind === 'objection');
    assert.ok(objSeatLink);
    const objProofLink = graph.causalLinks.find((l) => l.fromId === 'P1' && l.toKind === 'objection');
    assert.ok(objProofLink);
  });

  it('9.7 should maintain deterministic history log across events', () => {
    let state = createStandardCouncil();
    assert.equal(state.history.length, 1);
    assert.match(state.history[0], /\[INIT\]/);

    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(state.history.length, 2);
    assert.match(state.history[0], /\[OK\] Entered Deliberation Round 1/);
  });
});
