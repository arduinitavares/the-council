/**
 * Adversarial Challenger Suite: Milestone 1 Iteration 3
 * Agent: challenger_m1_6 (teamwork_challenger)
 *
 * Empirical stress tests:
 * 1. Candidate Synthesis & Prototype-Poisoning Resistance
 * 2. Objection Immutability & Permanent Lock of preserved_excused
 * 3. Quorum Drops on Excusals & Immediate Dissent Report (Below Quorum)
 * 4. Core State Reducer Invariants & Deep Freeze Immutability
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialCouncilState,
  transitionCouncil,
  validateCandidateClauses,
  canWithdrawObjection,
  checkQuorum,
  dropsBelowQuorumOnExcusal,
  getDependencyAndStateGraph
} from '../../src/index.js';

import {
  isPhaseMatch,
  normalizePhase,
  toCanonicalPhase,
  toPrototypePhase
} from '../../src/machine/constants.js';

import {
  activeSeats,
  excusedSeats,
  isQuorumSatisfied,
  getOpenObjections,
  getPreservedObjections,
  getAdmittedProofs,
  findSeat,
  findProof,
  findObjection,
  isPhase
} from '../../src/machine/state.js';

/**
 * Deep-freeze helper: recursively freezes all properties of an object or array.
 */
function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = obj[key];
    if (val !== null && (typeof val === 'object' || typeof val === 'function') && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

/**
 * Helper to bootstrap a standard 3-seat council in preflight
 */
function setupThreeSeatCouncil(options = {}) {
  let state = createInitialCouncilState({
    topic: 'Consensus Engine Deliberation',
    minQuorum: options.minQuorum ?? 2,
    maxRounds: options.maxRounds ?? 2,
    maxRetriesPerSeat: options.maxRetriesPerSeat ?? 1
  });

  state = transitionCouncil(state, {
    type: 'ADD_SEAT',
    seat: { id: 'seatA', harness: 'codex', model: 'gpt-5-codex', soul: 'Architect' }
  });
  state = transitionCouncil(state, {
    type: 'ADD_SEAT',
    seat: { id: 'seatB', harness: 'antigravity', model: 'gemini-2.5-pro', soul: 'Analyst' }
  });
  state = transitionCouncil(state, {
    type: 'ADD_SEAT',
    seat: { id: 'seatC', harness: 'cursor', model: 'composer', soul: 'Critic' }
  });

  return state;
}

/**
 * Helper to advance council from preflight up to confirming (voting) phase
 */
function advanceToConfirming(state) {
  state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
  state = transitionCouncil(state, {
    type: 'SUBMIT_PROOF',
    seatId: 'seatA',
    id: 'P1',
    scope: 'architecture',
    kind: 'check',
    source: 'adr-0001',
    statement: 'Decoupled state transitions ensure deterministic consensus'
  });
  state = transitionCouncil(state, { type: 'START_JUDGING' });
  state = transitionCouncil(state, {
    type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
    proofDecisions: { P1: { status: 'admitted', note: 'Admitted' } },
    clauses: [{ context: 'consensus', conclusion: 'Architecture verified', citedProofIds: ['P1'] }]
  });
  return state;
}

describe('Adversarial Challenger Suite 2 (Milestone 1 Iteration 3)', () => {

  // ==========================================================================
  // SUITE 1: CANDIDATE SYNTHESIS & PROTOTYPE-POISONING RESISTANCE
  // ==========================================================================
  describe('Suite 1: Candidate Synthesis & Prototype-Poisoning Resistance', () => {
    it('strictly rejects prototype method names as citedProofIds against Set admitted IDs', () => {
      const setAdmitted = new Set(['P1', 'P2']);
      const prototypeNames = ['toString', 'valueOf', 'constructor', '__proto__', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString'];

      for (const protoName of prototypeNames) {
        const clauses = [{ context: 'test', citedProofIds: [protoName] }];
        const res = validateCandidateClauses(clauses, setAdmitted);
        assert.equal(res.valid, false, `Expected rejection for prototype ID "${protoName}"`);
        assert.ok(
          res.errors[0].includes(`cites unverified Proof "${protoName}"`),
          `Expected unverified proof error for "${protoName}", got: ${res.errors[0]}`
        );
      }
    });

    it('strictly rejects prototype property lookups when admittedProofIds is a plain Record object', () => {
      const objAdmitted = { P1: true, P2: true };
      const prototypeNames = ['toString', 'valueOf', 'constructor', '__proto__', 'hasOwnProperty'];

      for (const protoName of prototypeNames) {
        const clauses = [{ context: 'test', citedProofIds: [protoName] }];
        const res = validateCandidateClauses(clauses, objAdmitted);
        assert.equal(res.valid, false, `Expected rejection for prototype ID "${protoName}" on plain object`);
        assert.ok(
          res.errors[0].includes(`cites unverified Proof "${protoName}"`),
          `Expected unverified proof error for "${protoName}"`
        );
      }
    });

    it('safely handles admittedProofIds created via Object.create(null) and array formats', () => {
      const nullProto = Object.create(null);
      nullProto.P1 = true;

      const validRes = validateCandidateClauses([{ context: 'test', citedProofIds: ['P1'] }], nullProto);
      assert.equal(validRes.valid, true);

      const invalidRes = validateCandidateClauses([{ context: 'test', citedProofIds: ['toString'] }], nullProto);
      assert.equal(invalidRes.valid, false);

      const arrAdmitted = ['P1'];
      const arrValid = validateCandidateClauses([{ context: 'test', citedProofIds: ['P1'] }], arrAdmitted);
      assert.equal(arrValid.valid, true);

      const arrInvalid = validateCandidateClauses([{ context: 'test', citedProofIds: ['toString'] }], arrAdmitted);
      assert.equal(arrInvalid.valid, false);
    });

    it('handles null, undefined, and non-object admittedProofIds without throwing', () => {
      const falsyAdmitted = [null, undefined, 42, 'admitted', true, false];
      for (const badAdmitted of falsyAdmitted) {
        const res = validateCandidateClauses([{ context: 'test', citedProofIds: ['P1'] }], badAdmitted);
        assert.equal(res.valid, false);
      }
    });

    it('enforces prototype-poisoning rejection inside transitionCouncil(JUDGE_AUDIT_AND_SYNTHESIZE)', () => {
      let state = setupThreeSeatCouncil();
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 'seatA',
        id: 'P1',
        scope: 'arch',
        kind: 'check',
        source: 'adr-0001',
        statement: 'Deterministic machine'
      });
      state = transitionCouncil(state, { type: 'START_JUDGING' });
      assert.equal(state.phase, 'judging');

      // Attempt attack: inject prototype methods into proofDecisions and clauses
      const badDecisions = {
        toString: { status: 'admitted', note: 'poison' },
        valueOf: { status: 'admitted', note: 'poison' },
        constructor: { status: 'admitted', note: 'poison' }
      };

      const attackPayloads = ['toString', 'valueOf', 'constructor', '__proto__'];
      for (const payload of attackPayloads) {
        const attackRes = transitionCouncil(state, {
          type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
          proofDecisions: badDecisions,
          clauses: [{ context: 'attack', conclusion: 'poison', citedProofIds: [payload] }]
        });

        assert.equal(attackRes.lastTransition.ok, false);
        assert.equal(attackRes.phase, 'judging', 'Phase must remain judging on rejected transition');
        assert.match(attackRes.lastTransition.message, new RegExp(`cites unverified Proof "${payload}"`));
      }
    });

    it('strictly rejects a candidate clause citing a proof ID explicitly rejected by the Judge even if named like prototype', () => {
      let state = setupThreeSeatCouncil();
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 'seatA',
        id: 'valueOf',
        scope: 'arch',
        kind: 'check',
        source: 'adr-0001',
        statement: 'Proof named valueOf'
      });
      state = transitionCouncil(state, { type: 'START_JUDGING' });

      // Judge rejects the proof
      const rejectRes = transitionCouncil(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        proofDecisions: { valueOf: { status: 'rejected', note: 'Invalid proof' } },
        clauses: [{ context: 'c1', conclusion: 'Claim', citedProofIds: ['valueOf'] }]
      });

      assert.equal(rejectRes.lastTransition.ok, false);
      assert.match(rejectRes.lastTransition.message, /cites unverified Proof "valueOf"/);
    });
  });

  // ==========================================================================
  // SUITE 2: OBJECTION IMMUTABILITY & PRESERVED_EXCUSED LOCK
  // ==========================================================================
  describe('Suite 2: Objection Immutability & Permanent Lock of preserved_excused', () => {
    it('permanently locks open objections as preserved_excused when raising seat is excused', () => {
      let state = setupThreeSeatCouncil({ minQuorum: 2 });
      state = advanceToConfirming(state);
      assert.equal(state.phase, 'confirming');

      // SeatA objects backed by admitted proof P1
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seatA',
        vote: 'object',
        proofId: 'P1',
        reason: 'Contradiction found in memory management'
      });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.objections.length, 1);
      assert.equal(state.objections[0].status, 'open');

      // SeatA faults and is excused
      state = transitionCouncil(state, { type: 'SEAT_FAULT', seatId: 'seatA', reason: 'Process timeout' });
      assert.equal(state.phase, 'seat_fault');

      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 'seatA' });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.phase, 'confirming'); // Resumes confirming because 2 seats remain (>= minQuorum)
      assert.equal(state.objections[0].status, 'preserved_excused');

      // Attack Vector 1: Excused seat tries to withdraw its own preserved objection
      const withdrawByA = transitionCouncil(state, {
        type: 'WITHDRAW_OBJECTION',
        seatId: 'seatA',
        objectionId: 'O1'
      });
      assert.equal(withdrawByA.lastTransition.ok, false);
      assert.match(withdrawByA.lastTransition.message, /locked as preserved_excused and cannot be withdrawn/);

      // Attack Vector 2: Active seat B tries to withdraw seat A's preserved objection
      const withdrawByB = transitionCouncil(state, {
        type: 'WITHDRAW_OBJECTION',
        seatId: 'seatB',
        objectionId: 'O1'
      });
      assert.equal(withdrawByB.lastTransition.ok, false);
      assert.match(withdrawByB.lastTransition.message, /locked as preserved_excused and cannot be withdrawn/);

      // Attack Vector 3: Active seat C tries to withdraw seat A's preserved objection
      const withdrawByC = transitionCouncil(state, {
        type: 'WITHDRAW_OBJECTION',
        seatId: 'seatC',
        objectionId: 'O1'
      });
      assert.equal(withdrawByC.lastTransition.ok, false);
      assert.match(withdrawByC.lastTransition.message, /locked as preserved_excused and cannot be withdrawn/);

      // Direct helper verification
      const guardCheck = canWithdrawObjection(state, 'O1', 'seatA');
      assert.equal(guardCheck.allowed, false);
      assert.match(guardCheck.reason, /locked as preserved_excused and cannot be withdrawn/);
    });

    it('prohibits false consensus: voting accept by remaining active seats concludes in Dissent Report', () => {
      let state = setupThreeSeatCouncil({ minQuorum: 2, maxRounds: 2 });
      state = advanceToConfirming(state);

      // SeatA objects
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seatA',
        vote: 'object',
        proofId: 'P1',
        reason: 'Critical race condition'
      });
      // Excuse SeatA
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 'seatA' });
      assert.equal(state.objections[0].status, 'preserved_excused');

      // SeatB and SeatC vote accept
      state = transitionCouncil(state, { type: 'CAST_VOTE', seatId: 'seatB', vote: 'accept' });
      assert.equal(state.objections[0].status, 'preserved_excused', 'SeatB accept must NOT withdraw SeatA preserved objection');

      state = transitionCouncil(state, { type: 'CAST_VOTE', seatId: 'seatC', vote: 'accept' });
      assert.equal(state.objections[0].status, 'preserved_excused', 'SeatC accept must NOT withdraw SeatA preserved objection');

      // Round evaluation
      state = transitionCouncil(state, { type: 'EVALUATE_ROUND' });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.phase, 'completed');
      assert.equal(state.canonicalPhase, 'DISSENT_REPORT');
      assert.equal(state.verdict.kind, 'Dissent Report (Preserved Excused-Seat Objection)');
      assert.equal(state.verdict.activeSeatCount, 2);
      assert.equal(state.verdict.excusedSeatCount, 1);
      assert.equal(state.verdict.unresolvedObjections.length, 1);
      assert.equal(state.verdict.unresolvedObjections[0].id, 'O1');
    });

    it('locks all multiple open objections when seat is excused, preserving each one', () => {
      let state = setupThreeSeatCouncil({ minQuorum: 2, maxRounds: 2 });
      state = advanceToConfirming(state);

      // Submit second proof
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 'seatB',
        id: 'P2',
        scope: 'perf',
        kind: 'benchmark',
        source: 'benchmarks.org',
        statement: 'Throughput >= 10k ops/sec'
      });

      // SeatA raises 2 separate objections
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seatA',
        vote: 'object',
        proofId: 'P1',
        reason: 'Issue 1'
      });
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seatA',
        vote: 'object',
        proofId: 'P1',
        reason: 'Issue 2'
      });

      assert.equal(state.objections.length, 2);
      assert.equal(state.objections[0].status, 'open');
      assert.equal(state.objections[1].status, 'open');

      // Excuse SeatA
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 'seatA' });
      assert.equal(state.objections[0].status, 'preserved_excused');
      assert.equal(state.objections[1].status, 'preserved_excused');

      // Both cannot be withdrawn
      assert.equal(canWithdrawObjection(state, 'O1', 'seatA').allowed, false);
      assert.equal(canWithdrawObjection(state, 'O2', 'seatA').allowed, false);
    });

    it('does not re-lock or corrupt already withdrawn objections when seat is excused', () => {
      let state = setupThreeSeatCouncil({ minQuorum: 2 });
      state = advanceToConfirming(state);

      // SeatA objects
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seatA',
        vote: 'object',
        proofId: 'P1',
        reason: 'Initial concern'
      });
      // SeatA changes mind and withdraws objection
      state = transitionCouncil(state, {
        type: 'WITHDRAW_OBJECTION',
        seatId: 'seatA',
        objectionId: 'O1'
      });
      assert.equal(state.objections[0].status, 'withdrawn');

      // Now SeatA faults and is excused
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 'seatA' });
      assert.equal(state.objections[0].status, 'withdrawn', 'Already withdrawn objection must remain withdrawn');
    });

    it('rejects vote casting and proof submission from an excused seat', () => {
      let state = setupThreeSeatCouncil({ minQuorum: 2 });
      state = advanceToConfirming(state);

      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 'seatA' });

      // Excused seat tries to cast vote: accept
      const voteAccept = transitionCouncil(state, { type: 'CAST_VOTE', seatId: 'seatA', vote: 'accept' });
      assert.equal(voteAccept.lastTransition.ok, false);
      assert.match(voteAccept.lastTransition.message, /not an active voting Seat/);

      // Excused seat tries to cast vote: object
      const voteObject = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seatA',
        vote: 'object',
        proofId: 'P1',
        reason: 'Late objection'
      });
      assert.equal(voteObject.lastTransition.ok, false);
      assert.match(voteObject.lastTransition.message, /not an active voting Seat/);

      // Excused seat tries to submit proof
      const submitProof = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 'seatA',
        id: 'P3',
        scope: 'scope',
        kind: 'check',
        source: 'source',
        statement: 'statement'
      });
      assert.equal(submitProof.lastTransition.ok, false);
      assert.match(submitProof.lastTransition.message, /not an active Seat/);
    });
  });

  // ==========================================================================
  // SUITE 3: QUORUM DROPS ON EXCUSALS & IMMEDIATE DISSENT REPORT
  // ==========================================================================
  describe('Suite 3: Quorum Drops on Excusals & Immediate Dissent Report', () => {
    it('terminates immediately to Dissent Report (Below Quorum) when excusing a seat drops 2-seat council below minQuorum=2', () => {
      let state = createInitialCouncilState({ minQuorum: 2 });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's1', harness: 'codex', model: 'gpt-5-codex', soul: 'Architect' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's2', harness: 'cursor', model: 'composer', soul: 'Critic' }
      });
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      assert.equal(state.phase, 'reviewing');

      // Excuse s2 during reviewing
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 's2', reason: 'Quota hit' });

      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.phase, 'completed');
      assert.equal(state.canonicalPhase, 'DISSENT_REPORT');
      assert.equal(state.verdict.kind, 'Dissent Report (Below Quorum)');
      assert.equal(state.verdict.activeSeatCount, 1);
      assert.equal(state.verdict.excusedSeatCount, 1);
      assert.match(state.verdict.note, /dropped below minimum quorum/);

      // Subsequent actions must be rejected from completed
      const nextRound = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      assert.equal(nextRound.lastTransition.ok, false);

      const nextProof = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's1',
        scope: 'scope',
        kind: 'check',
        source: 'source',
        statement: 'statement'
      });
      assert.equal(nextProof.lastTransition.ok, false);
    });

    it('terminates immediately when excusal happens from seat_fault recovery phase', () => {
      let state = createInitialCouncilState({ minQuorum: 2 });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's1', harness: 'codex', model: 'gpt-5-codex', soul: 'Architect' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's2', harness: 'cursor', model: 'composer', soul: 'Critic' }
      });
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      state = transitionCouncil(state, { type: 'SEAT_FAULT', seatId: 's2', reason: 'Rate limited' });
      assert.equal(state.phase, 'seat_fault');
      assert.equal(state.canonicalPhase, 'RECOVERY');

      // Excuse s2 while in recovery
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 's2' });

      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.phase, 'completed');
      assert.equal(state.canonicalPhase, 'DISSENT_REPORT');
      assert.equal(state.verdict.kind, 'Dissent Report (Below Quorum)');
    });

    it('terminates immediately when excusal happens during confirming phase', () => {
      let state = createInitialCouncilState({ minQuorum: 2 });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's1', harness: 'codex', model: 'gpt-5-codex', soul: 'Architect' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's2', harness: 'cursor', model: 'composer', soul: 'Critic' }
      });
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's1',
        id: 'P1',
        scope: 'scope',
        kind: 'check',
        source: 'source',
        statement: 'statement'
      });
      state = transitionCouncil(state, { type: 'START_JUDGING' });
      state = transitionCouncil(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        clauses: [{ context: 'c1', citedProofIds: ['P1'] }]
      });
      assert.equal(state.phase, 'confirming');

      // Excuse s2 during confirming
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 's2' });

      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.phase, 'completed');
      assert.equal(state.canonicalPhase, 'DISSENT_REPORT');
      assert.equal(state.verdict.kind, 'Dissent Report (Below Quorum)');
    });

    it('accurately maintains quorum when seat count remains >= minQuorum, only dropping when threshold crossed', () => {
      let state = createInitialCouncilState({ minQuorum: 2 });
      state = transitionCouncil(state, { type: 'ADD_SEAT', seat: { id: 's1', harness: 'h', model: 'm', soul: 's' } });
      state = transitionCouncil(state, { type: 'ADD_SEAT', seat: { id: 's2', harness: 'h', model: 'm', soul: 's' } });
      state = transitionCouncil(state, { type: 'ADD_SEAT', seat: { id: 's3', harness: 'h', model: 'm', soul: 's' } });
      state = transitionCouncil(state, { type: 'ADD_SEAT', seat: { id: 's4', harness: 'h', model: 'm', soul: 's' } });
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });

      // Excuse s4 -> 3 active seats (>= 2)
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 's4' });
      assert.equal(state.phase, 'reviewing');
      assert.equal(state.verdict, null);
      assert.equal(activeSeats(state).length, 3);

      // Excuse s3 -> 2 active seats (>= 2)
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 's3' });
      assert.equal(state.phase, 'reviewing');
      assert.equal(state.verdict, null);
      assert.equal(activeSeats(state).length, 2);

      // Excuse s2 -> 1 active seat (< 2) -> IMMEDIATE TERMINATION
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 's2' });
      assert.equal(state.phase, 'completed');
      assert.equal(state.canonicalPhase, 'DISSENT_REPORT');
      assert.equal(state.verdict.kind, 'Dissent Report (Below Quorum)');
      assert.equal(state.verdict.activeSeatCount, 1);
      assert.equal(state.verdict.excusedSeatCount, 3);
    });

    it('evaluates dropsBelowQuorumOnExcusal pure guard helper across all states', () => {
      assert.equal(dropsBelowQuorumOnExcusal(null, 's1'), true);

      const state2Seats = {
        minQuorum: 2,
        seats: [{ id: 's1', status: 'idle' }, { id: 's2', status: 'idle' }]
      };
      assert.equal(dropsBelowQuorumOnExcusal(state2Seats, 's1'), true);
      assert.equal(dropsBelowQuorumOnExcusal(state2Seats, 's2'), true);

      const state3Seats = {
        minQuorum: 2,
        seats: [{ id: 's1', status: 'idle' }, { id: 's2', status: 'idle' }, { id: 's3', status: 'idle' }]
      };
      assert.equal(dropsBelowQuorumOnExcusal(state3Seats, 's1'), false);
    });
  });

  // ==========================================================================
  // SUITE 4: CORE STATE REDUCER INVARIANTS & DEEP FREEZE IMMUTABILITY
  // ==========================================================================
  describe('Suite 4: Core State Reducer Invariants & Deep Freeze Immutability', () => {
    it('guarantees complete immutability (zero mutation) when state is deeply frozen at every step', () => {
      let state = createInitialCouncilState({ minQuorum: 2, maxRounds: 2, maxRetriesPerSeat: 1 });
      deepFreeze(state);

      const script = [
        { type: 'ADD_SEAT', seat: { id: 'seatA', harness: 'codex', model: 'gpt-5-codex', soul: 'Architect' } },
        { type: 'ADD_SEAT', seat: { id: 'seatB', harness: 'antigravity', model: 'gemini-2.5-pro', soul: 'Analyst' } },
        { type: 'START_CLARIFYING' },
        { type: 'PUBLISH_CLARIFICATION', answer: 'Verified computing boundary' },
        { type: 'BEGIN_ROUND' },
        {
          type: 'SUBMIT_PROOF',
          seatId: 'seatA',
          id: 'P1',
          scope: 'kernel',
          kind: 'check',
          source: 'kernel.org',
          statement: 'Memory isolation intact'
        },
        { type: 'START_JUDGING' },
        {
          type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
          clauses: [{ context: 'kernel', conclusion: 'Intact', citedProofIds: ['P1'] }]
        },
        { type: 'CAST_VOTE', seatId: 'seatA', vote: 'accept' },
        { type: 'CAST_VOTE', seatId: 'seatB', vote: 'accept' },
        { type: 'EVALUATE_ROUND' }
      ];

      for (const event of script) {
        state = transitionCouncil(state, event);
        assert.equal(state.lastTransition.ok, true, `Step failed: ${event.type}`);
        deepFreeze(state);
      }

      assert.equal(state.phase, 'completed');
      assert.equal(state.canonicalPhase, 'CONSENSUS_REACHED');
      assert.equal(state.verdict.kind, 'Unanimous Consensus');
    });

    it('rejects invalid or malformed event objects gracefully without throwing', () => {
      const state = createInitialCouncilState();
      deepFreeze(state);

      const invalidEvents = [null, undefined, {}, { type: '' }, { type: null }, { type: 123 }, { type: 'DOES_NOT_EXIST' }];

      for (const ev of invalidEvents) {
        const next = transitionCouncil(state, ev);
        assert.equal(next.lastTransition.ok, false);
        assert.equal(next.phase, state.phase, 'Phase must not change on invalid event');
        assert.ok(next.history.length > 0);
      }
    });

    it('strictly guards against illegal out-of-phase transitions across all phases', () => {
      let state = createInitialCouncilState();
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's1', harness: 'codex', model: 'gpt-5-codex', soul: 'Architect' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's2', harness: 'cursor', model: 'composer', soul: 'Critic' }
      });

      // In preflight: cannot submit proof, cannot cast vote, cannot evaluate round, cannot judge
      const illegalInPreflight = [
        { type: 'SUBMIT_PROOF', seatId: 's1', scope: 's', kind: 'check', source: 'src', statement: 'stmt' },
        { type: 'START_JUDGING' },
        { type: 'JUDGE_AUDIT_AND_SYNTHESIZE', clauses: [{ context: 'c', citedProofIds: ['P1'] }] },
        { type: 'CAST_VOTE', seatId: 's1', vote: 'accept' },
        { type: 'EVALUATE_ROUND' },
        { type: 'RETRY_SEAT', seatId: 's1' },
        { type: 'RETRY_JUDGE' }
      ];

      for (const ev of illegalInPreflight) {
        const next = transitionCouncil(state, ev);
        assert.equal(next.lastTransition.ok, false, `Expected rejection for ${ev.type} in preflight`);
        assert.equal(next.phase, 'preflight');
      }

      // Progress to reviewing
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      assert.equal(state.phase, 'reviewing');

      // In reviewing: cannot add seat, cannot vote, cannot evaluate round
      const illegalInReviewing = [
        { type: 'ADD_SEAT', seat: { id: 's3', harness: 'h', model: 'm', soul: 's' } },
        { type: 'CAST_VOTE', seatId: 's1', vote: 'accept' },
        { type: 'EVALUATE_ROUND' },
        { type: 'JUDGE_AUDIT_AND_SYNTHESIZE', clauses: [{ context: 'c', citedProofIds: ['P1'] }] }
      ];

      for (const ev of illegalInReviewing) {
        const next = transitionCouncil(state, ev);
        assert.equal(next.lastTransition.ok, false, `Expected rejection for ${ev.type} in reviewing`);
        assert.equal(next.phase, 'reviewing');
      }
    });

    it('verifies getDependencyAndStateGraph executes purely without mutating deeply frozen state', () => {
      let state = setupThreeSeatCouncil();
      state = advanceToConfirming(state);
      deepFreeze(state);

      const graph = getDependencyAndStateGraph(state);
      assert.ok(graph.nodes.length >= 8);
      assert.ok(graph.edges.length >= 10);
      assert.equal(graph.activeNodeId, 'confirming');
      assert.ok(Array.isArray(graph.outgoingEdges));
      assert.ok(Array.isArray(graph.causalLinks));

      const canonicalGraph = getDependencyAndStateGraph(state, { canonicalFormat: true });
      assert.equal(canonicalGraph.nodes.length, 9);
      assert.equal(canonicalGraph.canonicalPhase, 'VOTING');
    });
  });
});
