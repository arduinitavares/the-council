/**
 * Adversarial Stress Harness — Challenger 1 (Milestone 1)
 *
 * Rigorous empirical validation of:
 * 1. Quota fault false consensus resistance (Seat Excusal + Preserved Objection)
 * 2. Objection lock immutability (Bypass resistance against excused and active seats)
 * 3. Candidate clause forgery resistance (Judge Candidate Proof-Binding Guard)
 * 4. Boundary stress testing, payload tampering, and pure state immutability
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialCouncilState,
  transitionCouncil,
  canWithdrawObjection,
  validateCandidateClauses,
  getDependencyAndStateGraph
} from '../../src/index.js';
import { VALID_PROOF_KINDS } from '../../src/types.js';

describe('Adversarial Challenger Suite: Milestone 1 Consensus Engine', () => {
  // Helper to construct a standard 3-seat council in preflight
  function setupThreeSeatCouncil(minQuorum = 2) {
    let state = createInitialCouncilState({
      topic: 'High-Integrity Deliberation Protocol',
      minQuorum,
      maxRounds: 2,
      maxRetriesPerSeat: 1
    });

    state = transitionCouncil(state, {
      type: 'ADD_SEAT',
      seat: { id: 'seat1', harness: 'codex', model: 'gpt-5-codex', soul: 'Architect' }
    });
    assert.equal(state.lastTransition.ok, true);

    state = transitionCouncil(state, {
      type: 'ADD_SEAT',
      seat: { id: 'seat2', harness: 'antigravity', model: 'gemini-2.5-pro', soul: 'Analyst' }
    });
    assert.equal(state.lastTransition.ok, true);

    state = transitionCouncil(state, {
      type: 'ADD_SEAT',
      seat: { id: 'seat3', harness: 'cursor', model: 'composer', soul: 'Critic' }
    });
    assert.equal(state.lastTransition.ok, true);

    return state;
  }

  // Helper to progress council from preflight up to confirming (voting) phase
  function progressToConfirming(state) {
    // 1. Begin Round 1
    state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.round, 1);
    assert.equal(state.phase, 'reviewing');

    // 2. Submit valid proofs
    state = transitionCouncil(state, {
      type: 'SUBMIT_PROOF',
      id: 'P1',
      seatId: 'seat1',
      scope: 'Architecture',
      kind: 'check',
      source: 'RFC-9000 section 4',
      statement: 'Connection migration requires authenticated path validation'
    });
    assert.equal(state.lastTransition.ok, true);

    state = transitionCouncil(state, {
      type: 'SUBMIT_PROOF',
      id: 'P2',
      seatId: 'seat2',
      scope: 'Security',
      kind: 'citation',
      source: 'NIST SP 800-207',
      statement: 'Zero trust architecture requires explicit perimeter-less authentication'
    });
    assert.equal(state.lastTransition.ok, true);

    state = transitionCouncil(state, {
      type: 'SUBMIT_PROOF',
      id: 'P3',
      seatId: 'seat3',
      scope: 'Performance',
      kind: 'benchmark',
      source: 'Benchmark Suite run 409',
      statement: 'Latency p99 exceeds 120ms without local caching'
    });
    assert.equal(state.lastTransition.ok, true);

    // 3. Start Judging
    state = transitionCouncil(state, { type: 'START_JUDGING' });
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.phase, 'judging');

    // 4. Judge Audits & Synthesizes Candidate
    state = transitionCouncil(state, {
      type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
      proofDecisions: {
        P1: { status: 'admitted', note: 'Verified RFC citation' },
        P2: { status: 'admitted', note: 'Verified NIST citation' },
        P3: { status: 'admitted', note: 'Verified benchmark log' }
      },
      summary: 'Candidate Round 1',
      clauses: [
        { context: 'Path Validation', conclusion: 'Enforce path validation', citedProofIds: ['P1'] },
        { context: 'Zero Trust Auth', conclusion: 'Enforce zero trust tokens', citedProofIds: ['P2'] }
      ]
    });
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.phase, 'confirming');

    return state;
  }

  // ==========================================================================
  // CHALLENGE 1: False Consensus Manufacture on Quota Fault
  // ==========================================================================
  describe('Challenge 1: Attempt to Manufacture False Consensus on Quota Fault', () => {
    it('1.1 MUST NOT reach Unanimous Consensus when Seat 3 objects, faults, is excused, and remaining active seats vote accept', () => {
      let state = setupThreeSeatCouncil(2); // 3 seats, minQuorum = 2
      state = progressToConfirming(state);

      // Seat 3 raises an objection O1 backed by proof P3
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seat3',
        vote: 'object',
        reason: 'P99 latency unacceptable without local caching layer',
        proofId: 'P3'
      });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.objections.length, 1);
      const o1 = state.objections[0];
      assert.equal(o1.id, 'O1');
      assert.equal(o1.status, 'open');
      assert.equal(o1.seatId, 'seat3');

      // Seat 3 hits quota fault
      state = transitionCouncil(state, {
        type: 'SEAT_FAULT',
        seatId: 'seat3',
        reason: 'Provider rate limit 429: Token quota exhausted'
      });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.phase, 'seat_fault');
      assert.equal(state.faultSeatId, 'seat3');

      // Excuse Seat 3
      state = transitionCouncil(state, {
        type: 'EXCUSE_SEAT',
        seatId: 'seat3',
        reason: 'Quota exhausted mid-round'
      });
      assert.equal(state.lastTransition.ok, true);

      // Verify Seat 3 is excused, return phase restored to confirming
      const seat3 = state.seats.find((s) => s.id === 'seat3');
      assert.equal(seat3.status, 'excused');
      assert.equal(state.phase, 'confirming');

      // CRITICAL INVARIANT: Objection O1 MUST be locked as preserved_excused
      const o1AfterExcusal = state.objections.find((o) => o.id === 'O1');
      assert.equal(o1AfterExcusal.status, 'preserved_excused');

      // Remaining active seats (seat1 and seat2) vote accept
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seat1',
        vote: 'accept'
      });
      assert.equal(state.lastTransition.ok, true);

      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seat2',
        vote: 'accept'
      });
      assert.equal(state.lastTransition.ok, true);

      // Both active seats voted accept
      assert.equal(state.seats.find((s) => s.id === 'seat1').status, 'accepted');
      assert.equal(state.seats.find((s) => s.id === 'seat2').status, 'accepted');

      // Adversarial attempt: Evaluate round to see if engine erroneously yields Unanimous Consensus
      state = transitionCouncil(state, { type: 'EVALUATE_ROUND' });
      assert.equal(state.lastTransition.ok, true);

      // Engine MUST NOT reach Unanimous Consensus
      assert.notEqual(state.verdict?.kind, 'Unanimous Consensus');

      // Engine MUST halt with Dissent Report (Preserved Excused-Seat Objection)
      assert.equal(state.phase, 'completed');
      assert.equal(state.verdict?.kind, 'Dissent Report (Preserved Excused-Seat Objection)');
      assert.equal(state.verdict.activeSeatCount, 2);
      assert.equal(state.verdict.excusedSeatCount, 1);
      assert.equal(state.verdict.unresolvedObjections.length, 1);
      assert.equal(state.verdict.unresolvedObjections[0].id, 'O1');
      assert.equal(state.verdict.unresolvedObjections[0].status, 'preserved_excused');
    });

    it('1.2 MUST terminate immediately with Dissent Report (Below Quorum) if excusal drops active seats below minQuorum', () => {
      let state = setupThreeSeatCouncil(3); // minQuorum = 3!
      state = progressToConfirming(state);

      // Seat 3 faults and is excused
      state = transitionCouncil(state, {
        type: 'SEAT_FAULT',
        seatId: 'seat3',
        reason: 'OOM error'
      });
      assert.equal(state.lastTransition.ok, true);

      // Excusal drops active seats from 3 to 2 (< minQuorum 3)
      state = transitionCouncil(state, {
        type: 'EXCUSE_SEAT',
        seatId: 'seat3',
        reason: 'Crash'
      });
      assert.equal(state.lastTransition.ok, true);

      // Engine MUST immediately transition to completed with Below Quorum dissent report
      assert.equal(state.phase, 'completed');
      assert.equal(state.verdict?.kind, 'Dissent Report (Below Quorum)');
      assert.equal(state.verdict.activeSeatCount, 2);
      assert.equal(state.verdict.excusedSeatCount, 1);
    });

    it('1.3 Preserves ALL multiple objections raised by a faulted seat upon excusal', () => {
      let state = setupThreeSeatCouncil(2);
      state = progressToConfirming(state);

      // Seat 3 submits another proof P4 in confirming
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        id: 'P4',
        seatId: 'seat3',
        scope: 'Compliance',
        kind: 'citation',
        source: 'GDPR art 32',
        statement: 'Encryption at rest is mandatory for user records'
      });
      assert.equal(state.lastTransition.ok, true);

      // Seat 3 raises objection O1 backed by P3
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seat3',
        vote: 'object',
        reason: 'Reason 1',
        proofId: 'P3'
      });
      assert.equal(state.lastTransition.ok, true);

      // Seat 3 raises objection O2 backed by P1
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seat3',
        vote: 'object',
        reason: 'Reason 2',
        proofId: 'P1'
      });
      assert.equal(state.lastTransition.ok, true);

      assert.equal(state.objections.length, 2);
      assert.equal(state.objections[0].status, 'open');
      assert.equal(state.objections[1].status, 'open');

      // Excuse Seat 3
      state = transitionCouncil(state, {
        type: 'SEAT_FAULT',
        seatId: 'seat3',
        reason: 'Timeout'
      });
      state = transitionCouncil(state, {
        type: 'EXCUSE_SEAT',
        seatId: 'seat3'
      });

      // Both O1 and O2 must be locked
      assert.equal(state.objections[0].status, 'preserved_excused');
      assert.equal(state.objections[1].status, 'preserved_excused');

      // Remaining seats vote accept
      state = transitionCouncil(state, { type: 'CAST_VOTE', seatId: 'seat1', vote: 'accept' });
      state = transitionCouncil(state, { type: 'CAST_VOTE', seatId: 'seat2', vote: 'accept' });

      // Evaluate round
      state = transitionCouncil(state, { type: 'EVALUATE_ROUND' });
      assert.equal(state.phase, 'completed');
      assert.equal(state.verdict.kind, 'Dissent Report (Preserved Excused-Seat Objection)');
      assert.equal(state.verdict.unresolvedObjections.length, 2);
    });
  });

  // ==========================================================================
  // CHALLENGE 2: Objection Lock Bypass Attacks
  // ==========================================================================
  describe('Challenge 2: Attempt to Bypass Objection Lock on preserved_excused Objection', () => {
    function setupPreservedObjectionState() {
      let state = setupThreeSeatCouncil(2);
      state = progressToConfirming(state);

      // Seat 3 objects
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seat3',
        vote: 'object',
        reason: 'Critic dissent',
        proofId: 'P3'
      });
      assert.equal(state.lastTransition.ok, true);

      // Fault and excuse Seat 3
      state = transitionCouncil(state, { type: 'SEAT_FAULT', seatId: 'seat3' });
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 'seat3' });
      assert.equal(state.objections[0].status, 'preserved_excused');

      return state;
    }

    it('2.1 Rejects WITHDRAW_OBJECTION from the excused seat attempting to retract O1', () => {
      const state = setupPreservedObjectionState();

      // Excused seat3 attempts WITHDRAW_OBJECTION
      const nextState = transitionCouncil(state, {
        type: 'WITHDRAW_OBJECTION',
        objectionId: 'O1',
        seatId: 'seat3'
      });

      // MUST be rejected
      assert.equal(nextState.lastTransition.ok, false);
      assert.match(nextState.lastTransition.message, /Objection Immutability Guard|Objection Ownership Guard/);

      // Status MUST remain preserved_excused
      const o1 = nextState.objections.find((o) => o.id === 'O1');
      assert.equal(o1.status, 'preserved_excused');
    });

    it('2.2 Rejects WITHDRAW_OBJECTION from an active seat (seat1) attempting to retract Seat 3\'s O1', () => {
      const state = setupPreservedObjectionState();

      // Active seat1 attempts WITHDRAW_OBJECTION on O1
      const nextState = transitionCouncil(state, {
        type: 'WITHDRAW_OBJECTION',
        objectionId: 'O1',
        seatId: 'seat1'
      });

      // MUST be rejected
      assert.equal(nextState.lastTransition.ok, false);
      assert.match(nextState.lastTransition.message, /Objection Immutability Guard|Objection Ownership Guard/);

      // Status MUST remain preserved_excused
      const o1 = nextState.objections.find((o) => o.id === 'O1');
      assert.equal(o1.status, 'preserved_excused');
    });

    it('2.3 Active seat voting accept DOES NOT retract or alter preserved_excused objection', () => {
      const state = setupPreservedObjectionState();

      // Seat 1 votes accept
      const nextState = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seat1',
        vote: 'accept'
      });
      assert.equal(nextState.lastTransition.ok, true);

      // O1 status MUST remain preserved_excused
      const o1 = nextState.objections.find((o) => o.id === 'O1');
      assert.equal(o1.status, 'preserved_excused');
    });

    it('2.4 Excused seat cannot call CAST_VOTE: accept to trigger auto-withdrawal', () => {
      const state = setupPreservedObjectionState();

      // Excused seat3 attempts to vote accept
      const nextState = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seat3',
        vote: 'accept'
      });

      // MUST be rejected
      assert.equal(nextState.lastTransition.ok, false);
      assert.match(nextState.lastTransition.message, /not an active voting Seat/);

      // O1 status MUST remain preserved_excused
      const o1 = nextState.objections.find((o) => o.id === 'O1');
      assert.equal(o1.status, 'preserved_excused');
    });

    it('2.5 Direct pure guard check: canWithdrawObjection strictly denies withdrawal of preserved_excused', () => {
      const state = setupPreservedObjectionState();

      // Test excused seat
      const resExcused = canWithdrawObjection(state, 'O1', 'seat3');
      assert.equal(resExcused.allowed, false);
      assert.match(resExcused.reason, /locked as preserved_excused/);

      // Test active seat
      const resActive = canWithdrawObjection(state, 'O1', 'seat1');
      assert.equal(resActive.allowed, false);
      assert.match(resActive.reason, /locked as preserved_excused/);

      // Test unknown seat
      const resUnknown = canWithdrawObjection(state, 'O1', 'seat999');
      assert.equal(resUnknown.allowed, false);
      assert.match(resUnknown.reason, /locked as preserved_excused/);
    });

    it('2.6 Rejects withdrawal attempt on non-existent or already withdrawn objection', () => {
      let state = setupThreeSeatCouncil(2);
      state = progressToConfirming(state);

      // Seat 1 raises objection O1 backed by P1
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seat1',
        vote: 'object',
        reason: 'Temporary issue',
        proofId: 'P1'
      });
      assert.equal(state.objections[0].status, 'open');

      // Seat 1 legitimately withdraws its own objection
      state = transitionCouncil(state, {
        type: 'WITHDRAW_OBJECTION',
        objectionId: 'O1',
        seatId: 'seat1'
      });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.objections[0].status, 'withdrawn');

      // Attempting to withdraw AGAIN must be rejected
      const stateRetry = transitionCouncil(state, {
        type: 'WITHDRAW_OBJECTION',
        objectionId: 'O1',
        seatId: 'seat1'
      });
      assert.equal(stateRetry.lastTransition.ok, false);
      assert.match(stateRetry.lastTransition.message, /already withdrawn/);

      // Attempting to withdraw non-existent objection
      const stateNonExistent = transitionCouncil(state, {
        type: 'WITHDRAW_OBJECTION',
        objectionId: 'O_NONEXISTENT',
        seatId: 'seat1'
      });
      assert.equal(stateNonExistent.lastTransition.ok, false);
      assert.match(stateNonExistent.lastTransition.message, /not found/);
    });
  });

  // ==========================================================================
  // CHALLENGE 3: Candidate Clause Forgery & Proof-Binding Bypass
  // ==========================================================================
  describe('Challenge 3: Attempt to Forge Unadmitted Candidate Clauses', () => {
    function setupJudgingPhaseState() {
      let state = setupThreeSeatCouncil(2);
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });

      // Submit proofs
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        id: 'P_ADMITTED',
        seatId: 'seat1',
        scope: 'Auth',
        kind: 'check',
        source: 'Code review of src/auth.js',
        statement: 'Auth header validates token expiry'
      });

      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        id: 'P_REJECTED',
        seatId: 'seat2',
        scope: 'Security',
        kind: 'citation',
        source: 'Wikipedia random page',
        statement: 'MD5 is considered secure in legacy systems'
      });

      state = transitionCouncil(state, { type: 'START_JUDGING' });
      assert.equal(state.phase, 'judging');
      return state;
    }

    it('3.1 Rejects candidate clause citing a completely non-existent proof ID', () => {
      const state = setupJudgingPhaseState();

      const nextState = transitionCouncil(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        proofDecisions: {
          P_ADMITTED: { status: 'admitted', note: 'Valid' },
          P_REJECTED: { status: 'rejected', note: 'MD5 is broken' }
        },
        summary: 'Forged Candidate',
        clauses: [
          {
            context: 'Forged Claim',
            conclusion: 'Unsubstantiated magic claim',
            citedProofIds: ['P_FAKE_99999']
          }
        ]
      });

      assert.equal(nextState.lastTransition.ok, false);
      assert.match(nextState.lastTransition.message, /Judge Candidate Guard/);
      assert.match(nextState.lastTransition.message, /cites unverified Proof "P_FAKE_99999"/);
      assert.equal(nextState.phase, 'judging');
      assert.equal(nextState.candidate, null);
    });

    it('3.2 Rejects candidate clause citing a proof marked rejected by the Judge', () => {
      const state = setupJudgingPhaseState();

      const nextState = transitionCouncil(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        proofDecisions: {
          P_ADMITTED: { status: 'admitted', note: 'Valid' },
          P_REJECTED: { status: 'rejected', note: 'MD5 is broken' }
        },
        summary: 'Candidate citing rejected proof',
        clauses: [
          {
            context: 'Legacy Crypto',
            conclusion: 'Allow MD5 because source claimed it was ok',
            citedProofIds: ['P_REJECTED']
          }
        ]
      });

      assert.equal(nextState.lastTransition.ok, false);
      assert.match(nextState.lastTransition.message, /Judge Candidate Guard/);
      assert.match(nextState.lastTransition.message, /cites unverified Proof "P_REJECTED"/);
      assert.equal(nextState.phase, 'judging');
      assert.equal(nextState.candidate, null);
    });

    it('3.3 Rejects candidate clause citing a mix of admitted and unadmitted/rejected proofs', () => {
      const state = setupJudgingPhaseState();

      const nextState = transitionCouncil(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        proofDecisions: {
          P_ADMITTED: { status: 'admitted', note: 'Valid' },
          P_REJECTED: { status: 'rejected', note: 'MD5 is broken' }
        },
        summary: 'Mixed Candidate',
        clauses: [
          {
            context: 'Blended Clause',
            conclusion: 'Blended statement',
            citedProofIds: ['P_ADMITTED', 'P_REJECTED'] // Poisoned by P_REJECTED!
          }
        ]
      });

      assert.equal(nextState.lastTransition.ok, false);
      assert.match(nextState.lastTransition.message, /cites unverified Proof "P_REJECTED"/);
      assert.equal(nextState.phase, 'judging');
      assert.equal(nextState.candidate, null);
    });

    it('3.4 Rejects candidate synthesis with zero clauses or empty citedProofIds', () => {
      const state = setupJudgingPhaseState();

      // Case A: 0 clauses
      const resNoClauses = transitionCouncil(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        proofDecisions: { P_ADMITTED: { status: 'admitted' } },
        clauses: []
      });
      assert.equal(resNoClauses.lastTransition.ok, false);
      assert.match(resNoClauses.lastTransition.message, /requires at least one clause/);

      // Case B: Clause with empty citedProofIds
      const resEmptyCitations = transitionCouncil(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        proofDecisions: { P_ADMITTED: { status: 'admitted' } },
        clauses: [{ context: 'Uncited', conclusion: 'Bare opinion', citedProofIds: [] }]
      });
      assert.equal(resEmptyCitations.lastTransition.ok, false);
      assert.match(resEmptyCitations.lastTransition.message, /cites no Proof IDs/);
    });

    it('3.5 Pure functional guard validateCandidateClauses thoroughly enforces proof bindings', () => {
      const admitted = new Set(['P1', 'P2']);

      // Valid case
      const okResult = validateCandidateClauses(
        [{ context: 'A', conclusion: 'OK', citedProofIds: ['P1', 'P2'] }],
        admitted
      );
      assert.equal(okResult.valid, true);
      assert.equal(okResult.errors.length, 0);

      // Invalid: missing proof
      const badResult = validateCandidateClauses(
        [{ context: 'A', conclusion: 'Fail', citedProofIds: ['P1', 'P_UNKNOWN'] }],
        admitted
      );
      assert.equal(badResult.valid, false);
      assert.equal(badResult.errors.length, 1);
      assert.match(badResult.errors[0], /cites unverified Proof "P_UNKNOWN"/);

      // Invalid: non-array or empty
      assert.equal(validateCandidateClauses([], admitted).valid, false);
      assert.equal(validateCandidateClauses(null, admitted).valid, false);
      assert.equal(validateCandidateClauses(undefined, admitted).valid, false);
    });
  });

  // ==========================================================================
  // CHALLENGE 4: Stress Harness (State Immutability, Tampering & Boundaries)
  // ==========================================================================
  describe('Challenge 4: Deep Immutability, Fault Recovery & Boundary Stress', () => {
    it('4.1 Deep state immutability: transitionCouncil MUST NOT mutate input state in-place', () => {
      let state = setupThreeSeatCouncil(2);
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });

      // Serialize state snapshot before next transition
      const jsonBefore = JSON.stringify(state);

      // Execute next transition
      const nextState = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        id: 'P1',
        seatId: 'seat1',
        scope: 'Test',
        kind: 'check',
        source: 'Source',
        statement: 'Statement'
      });

      // Verify original state string is bit-for-bit identical
      const jsonAfter = JSON.stringify(state);
      assert.equal(jsonBefore, jsonAfter);

      // Verify that mutating nextState does not alter original state
      nextState.seats[0].status = 'tampered';
      assert.notEqual(state.seats[0].status, 'tampered');
    });

    it('4.2 Rejects malformed events (null, undefined, missing or unknown type)', () => {
      const state = setupThreeSeatCouncil(2);

      assert.equal(transitionCouncil(state, null).lastTransition.ok, false);
      assert.equal(transitionCouncil(state, undefined).lastTransition.ok, false);
      assert.equal(transitionCouncil(state, {}).lastTransition.ok, false);
      assert.equal(transitionCouncil(state, { type: '' }).lastTransition.ok, false);
      assert.equal(transitionCouncil(state, { type: 'NON_EXISTENT_EVENT_XYZ' }).lastTransition.ok, false);
    });

    it('4.3 Enforces seat retry cap: rejects RETRY_SEAT when cap is reached', () => {
      let state = setupThreeSeatCouncil(2);
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });

      // Fault seat 1
      state = transitionCouncil(state, { type: 'SEAT_FAULT', seatId: 'seat1', reason: 'Crash 1' });
      assert.equal(state.phase, 'seat_fault');

      // Retry 1: ok (maxRetriesPerSeat is 1)
      state = transitionCouncil(state, { type: 'RETRY_SEAT', seatId: 'seat1' });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.seats.find((s) => s.id === 'seat1').retries, 1);
      assert.equal(state.phase, 'reviewing');

      // Fault seat 1 again
      state = transitionCouncil(state, { type: 'SEAT_FAULT', seatId: 'seat1', reason: 'Crash 2' });
      assert.equal(state.phase, 'seat_fault');

      // Retry 2: MUST be rejected by Retry Cap Guard
      const retryFail = transitionCouncil(state, { type: 'RETRY_SEAT', seatId: 'seat1' });
      assert.equal(retryFail.lastTransition.ok, false);
      assert.match(retryFail.lastTransition.message, /Retry Cap Guard/);
      assert.equal(retryFail.phase, 'seat_fault');
    });

    it('4.4 Enforces round limits: advances to maxRounds and halts with Dissent Report (Round Limit Reached)', () => {
      let state = setupThreeSeatCouncil(2); // maxRounds = 2
      state = progressToConfirming(state); // Round 1

      // Seat 1 and Seat 2 vote accept; Seat 3 objects
      state = transitionCouncil(state, { type: 'CAST_VOTE', seatId: 'seat1', vote: 'accept' });
      state = transitionCouncil(state, { type: 'CAST_VOTE', seatId: 'seat2', vote: 'accept' });
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seat3',
        vote: 'object',
        reason: 'Round 1 Objection',
        proofId: 'P3'
      });

      // Evaluate Round 1: objection is open, round < maxRounds (1 < 2) -> advances to Round 2
      state = transitionCouncil(state, { type: 'EVALUATE_ROUND' });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.round, 2);
      assert.equal(state.phase, 'reviewing');

      // Progress Round 2 to confirming: active seat submits a round 2 proof
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        id: 'P_R2',
        seatId: 'seat1',
        scope: 'Round 2',
        kind: 'check',
        source: 'Round 2 review',
        statement: 'Round 2 reaffirmation statement'
      });
      assert.equal(state.lastTransition.ok, true);

      state = transitionCouncil(state, { type: 'START_JUDGING' });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.phase, 'judging');

      state = transitionCouncil(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        proofDecisions: {
          P_R2: { status: 'admitted', note: 'Admitted round 2' },
          P1: { status: 'admitted' },
          P2: { status: 'admitted' },
          P3: { status: 'admitted' }
        },
        summary: 'Candidate Round 2',
        clauses: [{ context: 'C1', conclusion: 'Re-affirm', citedProofIds: ['P_R2'] }]
      });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.phase, 'confirming');

      // Round 2 voting: Seat 3 still objects
      state = transitionCouncil(state, { type: 'CAST_VOTE', seatId: 'seat1', vote: 'accept' });
      state = transitionCouncil(state, { type: 'CAST_VOTE', seatId: 'seat2', vote: 'accept' });
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seat3',
        vote: 'object',
        reason: 'Unresolved Round 2 Objection',
        proofId: 'P3'
      });

      // Evaluate Round 2: round >= maxRounds (2 >= 2) with open objection -> halts with Dissent Report
      state = transitionCouncil(state, { type: 'EVALUATE_ROUND' });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.phase, 'completed');
      assert.equal(state.verdict?.kind, 'Dissent Report (Round Limit Reached)');
      assert.equal(state.verdict.unresolvedObjections.length >= 1, true);
    });

    it('4.5 Graph introspection returns consistent topology under normal, fault, and completed states', () => {
      let state = setupThreeSeatCouncil(2);
      let g = getDependencyAndStateGraph(state);
      assert.ok(g.nodes.length >= 8);
      assert.ok(g.edges.length >= 10);
      assert.equal(g.activeNodeId, 'preflight');

      // Check graph in seat_fault
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      state = transitionCouncil(state, { type: 'SEAT_FAULT', seatId: 'seat1' });
      g = getDependencyAndStateGraph(state);
      assert.equal(g.activeNodeId, 'seat_fault');

      // Check graph in completed
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 'seat1' }); // drops to 2 seats, minQuorum 2
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 'seat2' }); // drops to 1 seat, below quorum -> completed
      assert.equal(state.phase, 'completed');
      g = getDependencyAndStateGraph(state);
      assert.equal(g.activeNodeId, 'completed');
    });

    it('4.6 Empirically verifies ESM star export collision in src/index.js is resolved', async () => {
      const mod = await import('../../src/index.js');
      assert.ok(
        Array.isArray(mod.VALID_PROOF_KINDS),
        'VALID_PROOF_KINDS is present on namespace'
      );
      assert.deepEqual(
        mod.VALID_PROOF_KINDS,
        ['check', 'citation', 'benchmark', 'derivation']
      );
      assert.ok(
        mod.CANONICAL_PHASES && typeof mod.CANONICAL_PHASES === 'object',
        'CANONICAL_PHASES is present on namespace'
      );
      assert.equal(
        mod.CANONICAL_PHASES.ROSTER_CONFIGURATION,
        'ROSTER_CONFIGURATION'
      );
    });

    it('4.7 Verifies direct static named import of VALID_PROOF_KINDS and CANONICAL_PHASES from src/index.js', async () => {
      const { VALID_PROOF_KINDS: kinds, CANONICAL_PHASES: phases } = await import('../../src/index.js');
      assert.deepEqual(kinds, ['check', 'citation', 'benchmark', 'derivation']);
      assert.equal(phases.CONSENSUS_REACHED, 'CONSENSUS_REACHED');
      assert.equal(phases.DISSENT_REPORT, 'DISSENT_REPORT');
    });
  });
});
