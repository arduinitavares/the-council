import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  validateCandidateClauses,
  assertPhase,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 1: Feature Coverage — Judge Audit, Candidate Synthesis & Faults', () => {
  function createJudgingState() {
    let state = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Architect' },
        { id: 's2', harness: 'antigravity', model: 'gemini-4-argon', soul: 'Auditor' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 's1',
      scope: 'Cloud Native',
      kind: 'check',
      source: 'k8s cgroups v2 check',
      statement: 'Kubernetes nodes require cgroups v2.'
    });
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P2',
      seatId: 's2',
      scope: 'Bare Metal',
      kind: 'benchmark',
      source: 'iperf3 network throughput',
      statement: 'Direct 100GbE link achieves 94 Gbps line rate.'
    });
    return transitionCouncil(state, { type: EVENTS.START_JUDGING });
  }

  it('5.1 should audit proofs with explicit status and notes, and synthesize candidate', () => {
    let state = createJudgingState();
    assertPhase(state, 'judging');
    assert.equal(state.judge.status, 'thinking');

    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Workload-partitioned infrastructure recommendation:',
      proofDecisions: {
        P1: { status: 'admitted', note: 'Verified k8s cgroups requirement.' },
        P2: { status: 'admitted', note: 'Verified network throughput benchmark.' }
      },
      clauses: [
        { context: 'Cloud Native Workloads', conclusion: 'Deploy on cgroups v2 container hosts.', citedProofIds: ['P1'] },
        { context: 'High Throughput Workloads', conclusion: 'Use direct bare metal interfaces.', citedProofIds: ['P2'] }
      ]
    });

    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'confirming');
    assert.equal(state.judge.status, 'idle');
    assert.ok(state.candidate);
    assert.equal(state.candidate.clauses.length, 2);
    assert.deepEqual(state.candidate.clauses[0].citedProofIds, ['P1']);
    assert.deepEqual(state.candidate.clauses[1].citedProofIds, ['P2']);
    assert.equal(state.proofs[0].status, 'admitted');
    assert.equal(state.proofs[1].status, 'admitted');
  });

  it('5.2 should mark proofs rejected according to proofDecisions', () => {
    let state = createJudgingState();
    state = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Candidate after rejecting P2:',
      proofDecisions: {
        P1: { status: 'admitted', note: 'Admitted.' },
        P2: { status: 'rejected', note: 'Methodology flaws in benchmark.' }
      },
      clauses: [
        { context: 'Cloud Native Workloads', conclusion: 'Only Cloud Native supported.', citedProofIds: ['P1'] }
      ]
    });

    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.proofs[0].status, 'admitted');
    assert.equal(state.proofs[1].status, 'rejected');
  });

  it('5.3 should reject candidate synthesis when clauses array is empty (Candidate Guard)', () => {
    const state = createJudgingState();
    const next = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Empty candidate',
      clauses: []
    });

    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /requires at least one clause/);
  });

  it('5.4 should reject candidate clause that cites 0 proof IDs', () => {
    const state = createJudgingState();
    const next = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Missing citation candidate',
      clauses: [
        { context: 'Scope 1', conclusion: 'Uncited conclusion.', citedProofIds: [] }
      ]
    });

    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /cites no Proof IDs/);
  });

  it('5.5 should reject candidate clause that cites an unadmitted proof ID', () => {
    const state = createJudgingState();
    const next = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Fake proof candidate',
      clauses: [
        { context: 'Scope 1', conclusion: 'Unverified claim.', citedProofIds: ['P_FAKE'] }
      ]
    });

    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /cites unverified Proof "P_FAKE"/);
  });

  it('5.6 should reject candidate clause that cites a rejected proof ID', () => {
    const state = createJudgingState();
    const next = transitionCouncil(state, {
      type: EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Rejected proof citation',
      proofDecisions: {
        P1: { status: 'admitted' },
        P2: { status: 'rejected', note: 'Rejected.' }
      },
      clauses: [
        { context: 'Scope 1', conclusion: 'Claim based on rejected proof.', citedProofIds: ['P2'] }
      ]
    });

    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /cites unverified Proof "P2"/);
  });

  it('5.7 should handle JUDGE_FAULT and transition to judge_fault with status fault_quota', () => {
    let state = createJudgingState();
    state = transitionCouncil(state, { type: EVENTS.JUDGE_FAULT });

    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'judge_fault');
    assert.equal(state.judge.status, 'fault_quota');
  });

  it('5.8 should retry Judge via RETRY_JUDGE and resume judging phase', () => {
    let state = createJudgingState();
    state = transitionCouncil(state, { type: EVENTS.JUDGE_FAULT });
    assertPhase(state, 'judge_fault');

    state = transitionCouncil(state, { type: EVENTS.RETRY_JUDGE });
    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'judging');
    assert.equal(state.judge.status, 'thinking');
    assert.equal(state.judge.retries, 1);
  });

  it('5.9 should validate clauses against validateCandidateClauses helper', () => {
    const admitted = new Set(['P1', 'P2']);
    const validRes = validateCandidateClauses([
      { context: 'C1', conclusion: 'OK', citedProofIds: ['P1', 'P2'] }
    ], admitted);
    assert.equal(validRes.valid, true);

    const invalidRes = validateCandidateClauses([
      { context: 'C2', conclusion: 'Bad', citedProofIds: ['P3'] }
    ], admitted);
    assert.equal(invalidRes.valid, false);
    assert.match(invalidRes.errors[0], /cites unverified Proof "P3"/);
  });
});
