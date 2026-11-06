import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 3: Cross-Feature — Clarifications + Multi-Round Deliberation + Consensus', () => {
  it('C2.1 should execute clarification batches, progress through multi-round debate, and reach unanimous consensus', () => {
    let state = createInitialCouncilState({
      topic: 'Optimal API serialization format for high-throughput microservices',
      maxRounds: 3,
      minQuorum: 2,
      maxClarificationBatches: 2,
      seats: [
        { id: 'proto-fan', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Protobuf advocate' },
        { id: 'json-fan', harness: 'antigravity', model: 'gemini-4-argon', soul: 'JSON/REST advocate' }
      ]
    });

    // 1. Clarification Batch 1: Scope question
    state = transitionCouncil(state, { type: EVENTS.START_CLARIFYING });
    assert.equal(state.phase, 'clarifying');
    assert.equal(state.clarificationBatch, 1);
    state = transitionCouncil(state, {
      type: EVENTS.PUBLISH_CLARIFICATION,
      answer: 'Clarification: Internal RPC microservices only; external public API is out of scope.'
    });

    // 2. Clarification Batch 2: Bandwidth constraint
    state = transitionCouncil(state, { type: EVENTS.START_CLARIFYING });
    assert.equal(state.clarificationBatch, 2);
    state = transitionCouncil(state, {
      type: EVENTS.PUBLISH_CLARIFICATION,
      answer: 'Clarification: Target network is low-latency inter-datacenter links with 100k req/sec.'
    });

    // 3. Begin Round 1
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(state.phase, 'reviewing');
    assert.equal(state.round, 1);

    // 4. Submit Proofs for Round 1
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P_PROTO',
      seatId: 'proto-fan',
      scope: 'Internal RPC',
      kind: 'benchmark',
      source: 'gRPC benchmark suite',
      statement: 'Protobuf binary serialization achieves 6x lower CPU overhead than JSON.'
    });
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P_JSON',
      seatId: 'json-fan',
      scope: 'Debuggability & Tooling',
      kind: 'check',
      source: 'Wireshark & curl inspection check',
      statement: 'JSON payloads are human-readable over standard HTTP tools without proto definitions.'
    });

    // 5. Judge synthesizes Round 1 Candidate favoring Protobuf
    state = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Adopt Protobuf for internal RPC microservices.',
      proofDecisions: {
        P_PROTO: { status: 'admitted' },
        P_JSON: { status: 'admitted' }
      },
      clauses: [
        { context: 'Internal High-Throughput RPC', conclusion: 'Use Protobuf (P_PROTO).', citedProofIds: ['P_PROTO'] }
      ]
    });
    assert.equal(state.phase, 'confirming');

    // 6. Voting: proto-fan accepts; json-fan objects citing P_JSON
    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 'proto-fan', vote: 'accept' });
    state = transitionCouncil(state, {
      type: EVENTS.CAST_VOTE,
      seatId: 'json-fan',
      vote: 'object',
      proofId: 'P_JSON',
      reason: 'Candidate completely ignores debugging and dev tooling observability.'
    });
    assert.equal(state.objections.length, 1);
    assert.equal(state.objections[0].status, 'open');

    // 7. Evaluate Round 1 -> Advances to Round 2
    state = transitionCouncil(state, { type: EVENTS.EVALUATE_ROUND });
    assert.equal(state.phase, 'reviewing');
    assert.equal(state.round, 2);

    // 8. Round 2: json-fan submits compromise proof (reflection / JSON-mapping support)
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P_REFLECTION',
      seatId: 'json-fan',
      scope: 'Protobuf Dev Observability',
      kind: 'check',
      source: 'gRPC Server Reflection Protocol v1',
      statement: 'gRPC Server Reflection enables dynamic CLI inspection (grpcurl) with human-readable JSON output.'
    });

    // 9. Judge synthesizes Round 2 Candidate uniting P_PROTO and P_REFLECTION
    state = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Adopt Protobuf with mandatory gRPC Server Reflection.',
      proofDecisions: {
        P_REFLECTION: { status: 'admitted' }
      },
      clauses: [
        {
          context: 'Internal RPC & Observability',
          conclusion: 'Use Protobuf for high performance (P_PROTO) with gRPC Server Reflection for debugging (P_REFLECTION).',
          citedProofIds: ['P_PROTO', 'P_REFLECTION']
        }
      ]
    });

    // 10. Voting Round 2: Both seats accept!
    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 'proto-fan', vote: 'accept' });
    state = transitionCouncil(state, { type: EVENTS.CAST_VOTE, seatId: 'json-fan', vote: 'accept' });
    // Open objection from Round 1 auto-withdrawn
    assert.equal(state.objections[0].status, 'withdrawn');

    // 11. Evaluate Round 2 -> Unanimous Consensus!
    state = transitionCouncil(state, { type: EVENTS.EVALUATE_ROUND });
    assert.equal(state.phase, 'completed');
    assert.ok(state.verdict);
    assert.equal(state.verdict.kind, 'Unanimous Consensus');
    assert.equal(state.verdict.activeSeatCount, 2);
    assert.equal(state.verdict.excusedSeatCount, 0);
  });
});
