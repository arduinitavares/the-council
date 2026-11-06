import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  validateProof,
  assertPhase,
  VALID_PROOF_KINDS,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 1: Feature Coverage — Structured Proofs & Judging Transition', () => {
  function createReviewingState() {
    let state = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Engineer' },
        { id: 's2', harness: 'antigravity', model: 'gemini-4-argon', soul: 'Tester' }
      ]
    });
    return transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
  }

  it('4.1 should submit a valid proof of kind "check"', () => {
    let state = createReviewingState();
    const proofInput = {
      id: 'P_CHECK_1',
      seatId: 's1',
      scope: 'POSIX compliance suite',
      kind: 'check',
      source: 'uname -s && posix_test_runner',
      statement: 'Target environment passes all IEEE 1003.1 POSIX assertions.'
    };

    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      ...proofInput
    });

    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.proofs.length, 1);
    const p = state.proofs[0];
    assert.equal(p.id, 'P_CHECK_1');
    assert.equal(p.kind, 'check');
    assert.equal(p.scope, proofInput.scope);
    assert.equal(p.source, proofInput.source);
    assert.equal(p.statement, proofInput.statement);
    assert.equal(p.status, 'pending');
    assert.equal(state.seats[0].status, 'proof_submitted');
  });

  it('4.2 should submit a valid proof of kind "citation"', () => {
    let state = createReviewingState();
    const proofInput = {
      id: 'P_CITE_1',
      seatId: 's1',
      scope: 'Production Container Hosts',
      kind: 'citation',
      source: 'OCI Runtime Specification v1.1.0',
      statement: 'OCI runc requires Linux kernel namespaces for isolation.'
    };

    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      ...proofInput
    });
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.proofs[0].kind, 'citation');
  });

  it('4.3 should submit a valid proof of kind "benchmark"', () => {
    let state = createReviewingState();
    const proofInput = {
      id: 'P_BENCH_1',
      seatId: 's2',
      scope: 'SQLite concurrent write transactions',
      kind: 'benchmark',
      source: 'sysbench sqlite-wal-benchmark (5000 iterations)',
      statement: 'Serialized writer sustains >4500 tx/sec at p99 < 2ms.'
    };

    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      ...proofInput
    });
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.proofs[0].kind, 'benchmark');
  });

  it('4.4 should submit a valid proof of kind "derivation"', () => {
    let state = createReviewingState();
    const proofInput = {
      id: 'P_DERIVE_1',
      seatId: 's2',
      scope: 'State machine formal determinism',
      kind: 'derivation',
      source: 'TLA+ model checking specification of transitionCouncil',
      statement: 'Zero deadlock and zero unreachable state transitions across 9 phases.'
    };

    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      ...proofInput
    });
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.proofs[0].kind, 'derivation');
  });

  it('4.5 should auto-generate proof ID if id is omitted', () => {
    let state = createReviewingState();
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      seatId: 's1',
      scope: 'Generic Scope',
      kind: 'check',
      source: 'Generic Source',
      statement: 'Generic Statement.'
    });
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.proofs[0].id, 'P1');
  });

  it('4.6 should reject proof submission from excused seat', () => {
    let state = createInitialCouncilState({
      minQuorum: 2,
      seats: [
        { id: 's1', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Engineer' },
        { id: 's2', harness: 'antigravity', model: 'gemini-4-argon', soul: 'Tester' },
        { id: 's3', harness: 'cursor', model: 'grok-4.7', soul: 'Reviewer' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    state = transitionCouncil(state, {
      type: EVENTS.EXCUSE_SEAT,
      seatId: 's1',
      reason: 'Quota exhausted'
    });
    assertPhase(state, 'reviewing');

    const badAttempt = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      seatId: 's1',
      scope: 'Scope',
      kind: 'check',
      source: 'Source',
      statement: 'Statement'
    });
    assert.equal(badAttempt.lastTransition.ok, false);
    assert.match(badAttempt.lastTransition.message, /not an active Seat/);
  });

  it('4.7 should reject proof submission outside reviewing or confirming phases', () => {
    const preflightState = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    const next = transitionCouncil(preflightState, {
      type: EVENTS.SUBMIT_PROOF,
      seatId: 's1',
      scope: 'Scope',
      kind: 'check',
      source: 'Source',
      statement: 'Statement'
    });
    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /only be submitted during/i);
  });

  it('4.8 should transition to judging via START_JUDGING when at least 1 proof is submitted', () => {
    let state = createReviewingState();
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      seatId: 's1',
      scope: 'Scope',
      kind: 'check',
      source: 'Source',
      statement: 'Statement'
    });

    state = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'judging');
    assert.equal(state.judge.status, 'thinking');
  });

  it('4.9 should reject START_JUDGING if 0 proofs have been submitted in the round', () => {
    const state = createReviewingState();
    assert.equal(state.proofs.length, 0);

    const next = transitionCouncil(state, { type: EVENTS.START_JUDGING });
    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /At least one Proof must be submitted/);
  });

  it('4.10 should validate proof schema through validateProof contract function', () => {
    for (const kind of VALID_PROOF_KINDS) {
      const res = validateProof({
        round: 1,
        seatId: 's1',
        scope: 'Production',
        kind,
        source: 'Docs',
        statement: 'Valid claim.'
      });
      assert.equal(res.valid, true);
      assert.equal(res.errors.length, 0);
    }
  });
});
