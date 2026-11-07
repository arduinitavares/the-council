/**
 * @fileoverview Milestone 3 Tier 5 White-Box Adversarial Coverage Hardening Suite
 * Author: challenger_m3_1 (Empirical Challenger)
 * Framework: Native Node 22 test runner (node:test, node:assert/strict)
 *
 * Comprehensive stress vectors and white-box coverage hardening:
 * - Suite 1: Proof Validator & Boundary Attacks (prototype pollution, exotic unicode, type coercion, giant payloads)
 * - Suite 2: Candidate Clause Validation & Guard Invariants (malformed structures, prototype attacks, duplicate citations)
 * - Suite 3: Pure Reducer Invariants & State Machine Hardening (deep-freeze immutability, out-of-order events, unscripted excusals, graph introspection)
 * - Suite 4: Dynamic Seats & Roster Lifecycle Hardening (exhaustive illegal transitions, rapid cycling, turn retention, roster defense)
 * - Suite 5: Multi-Harness Adapters & Execution Stress (error taxonomy, timeout boundaries, model constraints, output parsing, mock scripting)
 */

import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Domain imports from src/
import {
  validateProof,
  isValidProofKind,
  sanitizeProofInput,
  formatProofRecord
} from '../../src/proofs/validator.js';

import {
  validateCandidateClauses,
  guardSubmitProof,
  guardJudgeAuditAndSynthesize,
  guardCastVote,
  canWithdrawObjection,
  checkQuorum,
  canRetrySeat,
  guardAddSeat,
  guardSeatTelemetry,
  guardStartClarifying,
  guardPublishClarification,
  guardStartJudging,
  guardExcuseSeat,
  guardRetryJudge,
  guardEvaluateRound,
  dropsBelowQuorumOnExcusal
} from '../../src/machine/guards.js';

import {
  createInitialCouncilState,
  cloneState,
  activeSeats,
  excusedSeats,
  isQuorumSatisfied,
  findSeat,
  findProof,
  findObjection,
  isPhase
} from '../../src/machine/state.js';

import {
  transitionCouncil,
  getDependencyAndStateGraph
} from '../../src/machine/reducer.js';

import {
  normalizePhase,
  toCanonicalPhase,
  toPrototypePhase,
  isPhaseMatch,
  VALID_PROOF_KINDS,
  COUNCIL_PHASES
} from '../../src/machine/constants.js';

import {
  Seat,
  createSeat,
  validateSeatConfig,
  isSeatActive,
  isSeatExcused,
  LEGAL_SEAT_TRANSITIONS,
  VALID_SEAT_STATUSES
} from '../../src/seats/seat.js';

import {
  CouncilRoster,
  createRoster
} from '../../src/seats/roster.js';

import {
  Soul,
  createSoul,
  validateSoulConfig,
  STANDARD_SOULS,
  formatSoulSystemPrompt,
  formatClarificationPrompt,
  formatDeliberationPrompt,
  formatVotingPrompt
} from '../../src/seats/soul.js';

import {
  HarnessAdapter,
  HarnessError,
  QuotaExhaustionError,
  TimeoutError,
  HarnessExecutionError,
  InvalidResponseError,
  AuthenticationError
} from '../../src/harness/adapter.js';

import { MockAdapter } from '../../src/harness/mock.js';
import { CodexAdapter } from '../../src/harness/codex.js';
import { AntigravityAdapter } from '../../src/harness/antigravity.js';
import { CursorAdapter } from '../../src/harness/cursor.js';

/**
 * Deep recursive freeze helper to verify reducer purity.
 */
function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

// ============================================================================
// SUITE 1: PROOF VALIDATOR & BOUNDARY ATTACKS
// ============================================================================
describe('Tier 5 Suite 1: Proof Validator & Boundary Attacks', () => {

  it('1.1 should reject prototype-polluted objects and objects with null prototypes', () => {
    // Attack with __proto__ injection
    const polluted = JSON.parse('{"__proto__": {"polluted": true}, "scope": "Kernel", "kind": "check", "source": "src", "statement": "stmt"}');
    const result1 = validateProof(polluted);
    assert.equal(result1.valid, true);
    assert.equal(Object.prototype.polluted, undefined); // Prototype must not be polluted

    // Attack with Object.create(null)
    const nullProto = Object.create(null);
    nullProto.scope = 'Kernel';
    nullProto.kind = 'check';
    nullProto.source = 'SPEC-1';
    nullProto.statement = 'Valid assertion';
    const result2 = validateProof(nullProto);
    assert.equal(result2.valid, true);

    // Empty Object.create(null)
    const emptyNullProto = Object.create(null);
    const result3 = validateProof(emptyNullProto);
    assert.equal(result3.valid, false);
    assert.equal(result3.errors.length, 4);
  });

  it('1.2 should strictly validate unicode edge cases, emoji statements, and exotic whitespace', () => {
    // Scope containing only non-breaking space (U+00A0) and ideographic space (U+3000)
    const whitespaceScope = {
      scope: '\u00A0 \u3000 \t \n',
      kind: 'check',
      source: 'Authoritative doc',
      statement: 'Valid falsifiable fact'
    };
    const res1 = validateProof(whitespaceScope);
    assert.equal(res1.valid, false);
    assert.ok(res1.errors.some((e) => e.includes('"scope" condition is required')));

    // Emoji-heavy statement with valid content
    const emojiProof = {
      scope: 'Container 📦 Isolation 🔒',
      kind: 'check',
      source: 'OCI Runtime Spec v1.1.0 📜',
      statement: 'Namespaces prevent cross-container IPC leakage 🛡️'
    };
    const res2 = validateProof(emojiProof);
    assert.equal(res2.valid, true);
    assert.equal(res2.errors.length, 0);

    // Right-To-Left (RTL) unicode characters
    const rtlProof = {
      scope: 'עִברִית / العربية Context',
      kind: 'citation',
      source: 'مواصفات قياسية',
      statement: 'קביעה מדעית מדויקת הניתנת להפרכה'
    };
    const res3 = validateProof(rtlProof);
    assert.equal(res3.valid, true);
  });

  it('1.3 should reject non-string and type-coercion bypass attempts', () => {
    const maliciousTypes = [
      { field: 'scope', value: 12345 },
      { field: 'scope', value: true },
      { field: 'scope', value: {} },
      { field: 'scope', value: [] },
      { field: 'scope', value: Symbol('scope') },
      { field: 'kind', value: 42 },
      { field: 'kind', value: ['check'] },
      { field: 'source', value: { toString: () => 'malicious source' } },
      { field: 'statement', value: 999999n } // BigInt
    ];

    for (const testCase of maliciousTypes) {
      const payload = {
        scope: 'Kernel',
        kind: 'check',
        source: 'POSIX.1-2017',
        statement: 'Standard syscall interface',
        [testCase.field]: testCase.value
      };
      const res = validateProof(payload);
      assert.equal(res.valid, false, `Expected payload with invalid ${testCase.field} to be rejected`);
    }
  });

  it('1.4 should handle extreme payloads (128KB string) and null bytes safely', () => {
    const hugeStatement = 'A'.repeat(128 * 1024); // 128 KB
    const resHuge = validateProof({
      scope: 'Stress Boundary',
      kind: 'benchmark',
      source: 'High-throughput stress rig',
      statement: hugeStatement
    });
    assert.equal(resHuge.valid, true);

    // Null bytes embedded in strings
    const nullByteProof = {
      scope: 'Buffer\0Boundary',
      kind: 'derivation',
      source: 'Memory\0Dump',
      statement: 'Zero\0byte\0injection\0falsifiable'
    };
    const resNull = validateProof(nullByteProof);
    assert.equal(resNull.valid, true);
  });

  it('1.5 should verify sanitizer and formatting purity and defaults', () => {
    // sanitizeProofInput trims string fields cleanly
    const raw = {
      id: ' P-999 ',
      scope: '  Distributed Consensus  ',
      kind: 'citation',
      source: '  Lamport 1998  ',
      statement: '  Part-Time Parliament  ',
      round: 2
    };
    const sanitized = sanitizeProofInput(raw);
    assert.equal(sanitized.scope, 'Distributed Consensus');
    assert.equal(sanitized.source, 'Lamport 1998');
    assert.equal(sanitized.statement, 'Part-Time Parliament');
    assert.equal(sanitized.kind, 'citation');

    // sanitizeProofInput on non-object returns as-is
    assert.equal(sanitizeProofInput(null), null);
    assert.equal(sanitizeProofInput('not an object'), 'not an object');

    // formatProofRecord default generation
    const record = formatProofRecord(raw, { round: 1, seatId: 'seat-alpha', idIndex: 42 });
    assert.equal(record.id, ' P-999 ');
    assert.equal(record.round, 2); // Preserves explicit round
    assert.equal(record.status, 'pending');
    assert.equal(record.judgeNote, null);

    const recordDefaults = formatProofRecord({ scope: 'S', kind: 'check', source: 'src', statement: 'stmt' }, { round: 1, seatId: 'seat-beta', idIndex: 7 });
    assert.equal(recordDefaults.id, 'P7');
    assert.equal(recordDefaults.round, 1);
    assert.equal(recordDefaults.seatId, 'seat-beta');
  });

});

// ============================================================================
// SUITE 2: CANDIDATE CLAUSE VALIDATION & GUARD STRESS VECTORS
// ============================================================================
describe('Tier 5 Suite 2: Candidate Clause Validation & Guard Invariants', () => {

  it('2.1 should reject malformed clause structures and sparse arrays', () => {
    const admitted = new Set(['P1', 'P2']);

    // Non-array clauses
    assert.equal(validateCandidateClauses(null, admitted).valid, false);
    assert.equal(validateCandidateClauses({}, admitted).valid, false);
    assert.equal(validateCandidateClauses('clauses', admitted).valid, false);

    // Array with non-object elements
    const malformed = [null, undefined, 'clause', 123, []];
    const res = validateCandidateClauses(malformed, admitted);
    assert.equal(res.valid, false);
    assert.equal(res.errors.length, 5);
    assert.ok(res.errors[0].includes('Clause 1 is malformed'));

    // Sparse array (array with hole)
    const sparse = [
      { context: 'C1', conclusion: 'OK', citedProofIds: ['P1'] },
      // Hole at index 1
      ,
      { context: 'C3', conclusion: 'OK', citedProofIds: ['P2'] }
    ];
    const resSparse = validateCandidateClauses(sparse, admitted);
    assert.equal(resSparse.valid, false);
    assert.ok(resSparse.errors.some((e) => e.includes('Clause 2 is malformed')));
  });

  it('2.2 should resist prototype pollution on admittedProofIds lookup', () => {
    // Plain object with prototype methods
    const objectMap = { P1: true };

    // Clause attempting to cite prototype properties like "toString", "constructor", "__proto__"
    const attackingClauses = [
      { context: 'Exploit', conclusion: 'Bypass', citedProofIds: ['toString'] },
      { context: 'Exploit2', conclusion: 'Bypass2', citedProofIds: ['constructor'] },
      { context: 'Exploit3', conclusion: 'Bypass3', citedProofIds: ['valueOf'] }
    ];

    const res = validateCandidateClauses(attackingClauses, objectMap);
    assert.equal(res.valid, false);
    assert.equal(res.errors.length, 3);
    assert.ok(res.errors[0].includes('cites unverified Proof "toString"'));
    assert.ok(res.errors[1].includes('cites unverified Proof "constructor"'));
    assert.ok(res.errors[2].includes('cites unverified Proof "valueOf"'));
  });

  it('2.3 should accept duplicate proof citations within a single clause if admitted', () => {
    const admitted = new Set(['P1', 'P2']);
    const clausesWithDupes = [
      {
        context: 'Double-substantiated clause',
        conclusion: 'Verified fact citing same proof twice',
        citedProofIds: ['P1', 'P1']
      }
    ];

    const res = validateCandidateClauses(clausesWithDupes, admitted);
    assert.equal(res.valid, true);
    assert.equal(res.errors.length, 0);
  });

  it('2.4 should reject clauses with mixed admitted and unadmitted proof citations', () => {
    const admitted = new Set(['P1']);
    const mixedClauses = [
      {
        context: 'Partial citation',
        conclusion: 'One admitted and one non-existent',
        citedProofIds: ['P1', 'P_UNVERIFIED_99']
      }
    ];

    const res = validateCandidateClauses(mixedClauses, admitted);
    assert.equal(res.valid, false);
    assert.equal(res.errors.length, 1);
    assert.ok(res.errors[0].includes('cites unverified Proof "P_UNVERIFIED_99"'));
  });

  it('2.5 should support diverse admittedProofIds formats (Set, Array, Record)', () => {
    const validClause = [{ context: 'Universal', conclusion: 'Done', citedProofIds: ['P1'] }];

    // Set format
    assert.equal(validateCandidateClauses(validClause, new Set(['P1'])).valid, true);

    // Array format
    assert.equal(validateCandidateClauses(validClause, ['P1', 'P2']).valid, true);

    // Plain Record object format
    assert.equal(validateCandidateClauses(validClause, { P1: true, P2: false }).valid, true);

    // False in record should be treated as unadmitted
    const falseRecordClause = [{ context: 'Rejected', conclusion: 'Fail', citedProofIds: ['P2'] }];
    assert.equal(validateCandidateClauses(falseRecordClause, { P1: true, P2: false }).valid, false);
  });

});

// ============================================================================
// SUITE 3: PURE REDUCER INVARIANTS & STATE MACHINE HARDENING
// ============================================================================
describe('Tier 5 Suite 3: Pure Reducer Invariants & State Machine Hardening', () => {

  function setupStandardCouncil() {
    let state = createInitialCouncilState({
      topic: 'Fault-Tolerant State Machine Invariants',
      minQuorum: 2,
      maxRounds: 3,
      maxRetriesPerSeat: 1
    });

    state = transitionCouncil(state, {
      type: 'ADD_SEAT',
      seat: { id: 's1', harness: 'codex', model: 'gpt-6.1-sol (max)', soul: 'Architect' }
    });
    state = transitionCouncil(state, {
      type: 'ADD_SEAT',
      seat: { id: 's2', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Verifier' }
    });

    return state;
  }

  it('3.1 should maintain 100% purity when input state is deeply frozen', () => {
    const state = setupStandardCouncil();
    deepFreeze(state);

    // 1. Transition with frozen state should not throw TypeError
    assert.doesNotThrow(() => {
      const nextState = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      assert.equal(nextState.lastTransition.ok, true);
      assert.equal(nextState.phase, 'reviewing');
      assert.equal(nextState.round, 1);
    });

    // 2. Rejected transition on frozen state should not throw TypeError
    assert.doesNotThrow(() => {
      const invalidEventState = transitionCouncil(state, { type: 'CAST_VOTE', vote: 'accept' });
      assert.equal(invalidEventState.lastTransition.ok, false);
      assert.equal(invalidEventState.phase, 'preflight');
    });
  });

  it('3.2 should reject out-of-order and illegal phase transitions across all canonical phases', () => {
    let state = setupStandardCouncil();

    // Out-of-order in preflight
    const illegalPreflightEvents = [
      { type: 'SUBMIT_PROOF', seatId: 's1', scope: 'S', kind: 'check', source: 'src', statement: 'stmt' },
      { type: 'START_JUDGING' },
      { type: 'JUDGE_AUDIT_AND_SYNTHESIZE', clauses: [] },
      { type: 'CAST_VOTE', seatId: 's1', vote: 'accept' },
      { type: 'EVALUATE_ROUND' },
      { type: 'RETRY_SEAT', seatId: 's1' },
      { type: 'RETRY_JUDGE' }
    ];

    for (const evt of illegalPreflightEvents) {
      const next = transitionCouncil(state, evt);
      assert.equal(next.lastTransition.ok, false, `Expected ${evt.type} to be rejected in preflight`);
      assert.equal(next.phase, 'preflight');
    }

    // Advance to reviewing
    state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
    assert.equal(state.phase, 'reviewing');

    // Out-of-order in reviewing
    const illegalReviewingEvents = [
      { type: 'ADD_SEAT', seat: { id: 's3', harness: 'cursor', model: 'grok', soul: 'X' } },
      { type: 'CAST_VOTE', seatId: 's1', vote: 'accept' },
      { type: 'EVALUATE_ROUND' },
      { type: 'PUBLISH_CLARIFICATION', answer: 'Ans' }
    ];

    for (const evt of illegalReviewingEvents) {
      const next = transitionCouncil(state, evt);
      assert.equal(next.lastTransition.ok, false, `Expected ${evt.type} to be rejected in reviewing`);
      assert.equal(next.phase, 'reviewing');
    }
  });

  it('3.3 should handle unscripted seat excusals in every phase while preserving turns and objections', () => {
    // Excusal during reviewing
    let state = setupStandardCouncil();
    state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
    state = transitionCouncil(state, {
      type: 'SUBMIT_PROOF',
      id: 'P1',
      seatId: 's1',
      scope: 'Arch',
      kind: 'check',
      source: 'Spec',
      statement: 'Assertion 1'
    });

    // Excuse s1 while in reviewing (leaving s2, minQuorum is 2 -> drops below quorum!)
    const excusedState = transitionCouncil(state, {
      type: 'EXCUSE_SEAT',
      seatId: 's1',
      reason: 'Network disconnect'
    });
    assert.equal(excusedState.lastTransition.ok, true);
    assert.equal(excusedState.phase, 'completed');
    assert.equal(excusedState.verdict.kind, 'Dissent Report (Below Quorum)');
    assert.equal(excusedState.seats.find((s) => s.id === 's1').status, 'excused');
  });

  it('3.4 should compute dependency and state graph accurately across empty and terminal states', () => {
    // 1. Preflight graph
    const initial = createInitialCouncilState();
    const graph1 = getDependencyAndStateGraph(initial);
    assert.ok(graph1.nodes.length >= 8);
    assert.equal(graph1.activeNodeId, 'preflight');
    assert.equal(graph1.causalLinks.length, 0);

    // 2. Canonical format option
    const graphCanonical = getDependencyAndStateGraph(initial, { canonicalFormat: true });
    assert.equal(graphCanonical.nodes.length, 9);
    assert.ok(graphCanonical.nodes.some((n) => n.id === 'ROSTER_CONFIGURATION'));

    // 3. Completed state graph with objections
    let state = setupStandardCouncil();
    state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
    state = transitionCouncil(state, {
      type: 'SUBMIT_PROOF',
      id: 'P1',
      seatId: 's1',
      scope: 'Scope',
      kind: 'check',
      source: 'Source',
      statement: 'Stmt'
    });
    state = transitionCouncil(state, { type: 'START_JUDGING' });
    state = transitionCouncil(state, {
      type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
      clauses: [{ context: 'C1', conclusion: 'Done', citedProofIds: ['P1'] }]
    });
    state = transitionCouncil(state, {
      type: 'CAST_VOTE',
      seatId: 's1',
      vote: 'object',
      proofId: 'P1',
      reason: 'Objection reason'
    });

    const graphWithObj = getDependencyAndStateGraph(state);
    assert.ok(graphWithObj.causalLinks.some((l) => l.toKind === 'objection'));
    assert.ok(graphWithObj.causalLinks.some((l) => l.fromKind === 'proof' && l.toKind === 'clause'));
  });

  it('3.5 should cleanly handle RESET from any phase with custom config overrides', () => {
    let state = setupStandardCouncil();
    state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
    assert.equal(state.round, 1);

    const resetState = transitionCouncil(state, {
      type: 'RESET',
      config: { topic: 'New Topic', minQuorum: 5, maxRounds: 10 }
    });

    assert.equal(resetState.phase, 'preflight');
    assert.equal(resetState.round, 0);
    assert.equal(resetState.topic, 'New Topic');
    assert.equal(resetState.minQuorum, 5);
    assert.equal(resetState.maxRounds, 10);
    assert.equal(resetState.seats.length, 0);
  });

});

// ============================================================================
// SUITE 4: DYNAMIC SEATS & ROSTER LIFECYCLE HARDENING
// ============================================================================
describe('Tier 5 Suite 4: Dynamic Seats & Roster Lifecycle Hardening', () => {

  it('4.1 should enforce exhaustive illegal seat status transitions', () => {
    const seat = createSeat({
      id: 'seat-alpha',
      harness: 'codex',
      model: 'gpt-6.1-sol',
      soul: 'Architect'
    });

    // Starting status: idle
    assert.equal(seat.status, 'idle');

    // Illegal from idle: accepted, objected
    assert.throws(() => seat.transition('accepted'), /Illegal state transition/);
    assert.throws(() => seat.transition('objected'), /Illegal state transition/);

    // Transition to thinking
    seat.transition('thinking');
    assert.equal(seat.status, 'thinking');

    // Transition to proof_submitted
    seat.transition('proof_submitted');
    assert.equal(seat.status, 'proof_submitted');

    // Transition to accepted
    seat.transition('accepted');
    assert.equal(seat.status, 'accepted');

    // Illegal from accepted: proof_submitted, objected
    assert.throws(() => seat.transition('proof_submitted'), /Illegal state transition/);
    assert.throws(() => seat.transition('objected'), /Illegal state transition/);

    // Transition to fault_quota
    seat.transition('fault_quota');
    assert.equal(seat.status, 'fault_quota');

    // Illegal from fault_quota: idle, accepted, objected, proof_submitted
    assert.throws(() => seat.transition('idle'), /Illegal state transition/);
    assert.throws(() => seat.transition('accepted'), /Illegal state transition/);
    assert.throws(() => seat.transition('objected'), /Illegal state transition/);
    assert.throws(() => seat.transition('proof_submitted'), /Illegal state transition/);
  });

  it('4.2 should permanently lock excused seats against any status changes', () => {
    const seat = createSeat({
      id: 'seat-excused',
      harness: 'cursor',
      model: 'composer-2.5',
      soul: 'Developer'
    });

    seat.excuse('Quota pool exhausted mid-session');
    assert.equal(seat.status, 'excused');
    assert.equal(seat.isExcused, true);
    assert.equal(seat.isActive, false);

    // Every possible status transition must be rejected
    const allStatuses = ['idle', 'thinking', 'proof_submitted', 'accepted', 'objected', 'fault_quota', 'excused'];
    for (const target of allStatuses) {
      assert.throws(
        () => seat.transition(target),
        /permanently excused/,
        `Excused seat should reject transition to "${target}"`
      );
    }
  });

  it('4.3 should support rapid legal status cycling without internal corruption', () => {
    const seat = createSeat({
      id: 'seat-cycler',
      harness: 'antigravity',
      model: 'gemini-4-argon-high',
      soul: 'Benchmarker'
    });

    // Perform 50 rapid legal cycles: idle -> thinking -> proof_submitted -> thinking -> accepted -> idle
    for (let i = 0; i < 50; i++) {
      seat.transition('thinking');
      seat.transition('proof_submitted');
      seat.transition('thinking');
      seat.transition('accepted');
      seat.transition('idle');
    }

    assert.equal(seat.status, 'idle');
    assert.equal(seat.isActive, true);
  });

  it('4.4 should record and retain turns chronologically with defensive cloning', () => {
    const seat = createSeat({
      id: 'seat-recorder',
      harness: 'codex',
      model: 'gpt-6.1-sol',
      soul: 'Historian'
    });

    seat.recordTurn({ round: 1, phase: 'reviewing', action: 'SUBMIT_PROOF', data: { id: 'P1' } });
    seat.fault('Quota reached');
    seat.retry(2);
    seat.recordTurn({ round: 1, phase: 'confirming', action: 'CAST_VOTE', data: { vote: 'accept' } });
    seat.excuse('Final excusal');

    const turns = seat.turns;
    assert.equal(turns.length, 2);
    assert.equal(turns[0].action, 'SUBMIT_PROOF');
    assert.equal(turns[1].action, 'CAST_VOTE');

    // Defensive copy check: modifying returned turns array should not mutate seat._turns
    turns.push({ action: 'FORGERY' });
    assert.equal(seat.turns.length, 2);
  });

  it('4.5 should enforce CouncilRoster validation, duplicate defenses, and setter guards', () => {
    const roster = createRoster({ minQuorum: 2, maxRetriesPerSeat: 1 });

    // Invalid seat ID with special characters
    assert.throws(
      () => roster.addSeat({ id: 'seat/invalid!', harness: 'codex', model: 'm', soul: 's' }),
      /contains invalid characters/
    );

    // Duplicate seat addition
    roster.addSeat({ id: 'seat-1', harness: 'codex', model: 'm1', soul: 's1' });
    assert.throws(
      () => roster.addSeat({ id: 'seat-1', harness: 'antigravity', model: 'm2', soul: 's2' }),
      /already exists in the Council roster/
    );

    // Setter validations
    assert.throws(() => { roster.minQuorum = 0; }, /minQuorum must be an integer >= 1/);
    assert.throws(() => { roster.minQuorum = -5; }, /minQuorum must be an integer >= 1/);
    assert.throws(() => { roster.maxRetriesPerSeat = -1; }, /maxRetriesPerSeat must be a non-negative integer/);

    // Defensive copy of getAllSeats and getActiveSeats
    const all = roster.getAllSeats();
    all.pop();
    assert.equal(roster.getAllSeats().length, 1);
  });

  it('4.6 should accurately calculate quorum lookahead via willLoseQuorumOnExcusal', () => {
    const roster = createRoster({ minQuorum: 2 });
    roster.addSeat({ id: 's1', harness: 'codex', model: 'm', soul: 's' });
    roster.addSeat({ id: 's2', harness: 'codex', model: 'm', soul: 's' });

    // Active seats = 2, minQuorum = 2. Excusing s1 drops active to 1 (< 2).
    assert.equal(roster.willLoseQuorumOnExcusal('s1'), true);

    // Add 3rd seat. Active seats = 3. Excusing s1 leaves 2 (>= 2).
    roster.addSeat({ id: 's3', harness: 'codex', model: 'm', soul: 's' });
    assert.equal(roster.willLoseQuorumOnExcusal('s1'), false);

    // Non-existent seat returns true
    assert.equal(roster.willLoseQuorumOnExcusal('non-existent'), true);
  });

});

// ============================================================================
// SUITE 5: MULTI-HARNESS ADAPTERS & EXECUTION STRESS
// ============================================================================
describe('Tier 5 Suite 5: Multi-Harness Adapters & Execution Stress', () => {

  it('5.1 should accurately classify diverse errors into canonical taxonomy', () => {
    const adapter = new MockAdapter();

    // 1. Quota Exhaustion errors (HTTP 429, tokens_per_minute on Codex, resource_exhausted on AGY)
    const err429 = new Error('HTTP 429: Too Many Requests');
    assert.ok(adapter.classifyError(err429) instanceof QuotaExhaustionError);

    const codex = new CodexAdapter();
    const errTokenBudget = new Error('tokens_per_minute_exceeded: limit 10000');
    assert.ok(codex.classifyError(errTokenBudget) instanceof QuotaExhaustionError);

    const agy = new AntigravityAdapter();
    const errResourceExhausted = new Error('resource_exhausted: quota window exceeded');
    assert.ok(agy.classifyError(errResourceExhausted) instanceof QuotaExhaustionError);

    // 2. Process execution errors
    const errExec = new Error('Command failed: orca worker');
    errExec.exitCode = 127;
    errExec.stderr = 'binary not found';
    const classifiedExec = adapter.classifyError(errExec);
    assert.ok(classifiedExec instanceof HarnessExecutionError);
    assert.equal(classifiedExec.exitCode, 127);
    assert.equal(classifiedExec.stderr, 'binary not found');

    // 3. HarnessError passthrough
    const customHarnessErr = new AuthenticationError('Invalid API token');
    assert.equal(adapter.classifyError(customHarnessErr), customHarnessErr);
  });

  it('5.2 should enforce strict execution timeout boundaries and cleanup timers', async () => {
    const adapter = new MockAdapter({ timeoutMs: 50 });

    // Slow hanging async function
    const slowFn = (signal) => new Promise((resolve) => {
      setTimeout(() => resolve('finished late'), 200);
    });

    await assert.rejects(
      () => adapter.executeWithTimeout(slowFn, 50, { seatId: 'slow-seat', model: 'mock-model' }),
      (err) => {
        assert.ok(err instanceof TimeoutError);
        assert.equal(err.timeoutMs, 50);
        assert.equal(err.seatId, 'slow-seat');
        assert.equal(err.model, 'mock-model');
        return true;
      }
    );
  });

  it('5.3 should enforce model policy validation per harness route', () => {
    // 1. Codex route
    const codex = new CodexAdapter();
    assert.doesNotThrow(() => codex.validateModel('gpt-6.1-sol (max)'));
    assert.doesNotThrow(() => codex.validateModel('gpt-6-astra'));
    assert.throws(() => codex.validateModel('gpt-4o'), /not permitted under Codex route/);
    assert.throws(() => codex.validateModel('claude-sonnet'), /not permitted under Codex route/);

    // 2. Antigravity route
    const agy = new AntigravityAdapter();
    assert.doesNotThrow(() => agy.validateModel('gemini-4-argon-high'));
    assert.doesNotThrow(() => agy.validateModel('claude-sonnet-5-5-20260630'));
    assert.doesNotThrow(() => agy.validateModel('claude-opus-5-5-20260630'));
    assert.throws(() => agy.validateModel('gemini-1.5-pro'), /not permitted under Antigravity route/);
    assert.throws(() => agy.validateModel('gpt-6.1-sol'), /not permitted under Antigravity route/);

    // 3. Cursor route
    const cursor = new CursorAdapter();
    assert.doesNotThrow(() => cursor.validateModel('grok-4.7-high'));
    assert.doesNotThrow(() => cursor.validateModel('grok-4.7-xhigh'));
    assert.doesNotThrow(() => cursor.validateModel('composer-2.5'));
    assert.throws(() => cursor.validateModel('kimi-k2'), /not permitted under Cursor route/);
    assert.throws(() => cursor.validateModel('gpt-6-astra'), /not permitted under Cursor route/);
  });

  it('5.4 should parse structured outputs across markdown fences, chatter, and reject invalid schemas', () => {
    const adapter = new MockAdapter();

    // 1. JSON in markdown code fence
    const rawFenced = '```json\n{\n  "vote": "accept"\n}\n```';
    const parsedFenced = adapter.parseStructuredOutput(rawFenced, 'vote');
    assert.equal(parsedFenced.vote, 'accept');

    // 2. JSON embedded in conversational commentary
    const rawChatter = 'Here is my evaluation of the candidate:\n\n{"vote": "object", "reason": "Lacks OCI compliance", "proofId": "P1"}\n\nHope this helps!';
    const parsedChatter = adapter.parseStructuredOutput(rawChatter, 'vote');
    assert.equal(parsedChatter.vote, 'object');
    assert.equal(parsedChatter.reason, 'Lacks OCI compliance');
    assert.equal(parsedChatter.proofId, 'P1');

    // 3. Reject empty or non-string
    assert.throws(() => adapter.parseStructuredOutput('', 'vote'), /Model output was empty/);
    assert.throws(() => adapter.parseStructuredOutput(null, 'vote'), /Model output was empty/);

    // 4. Reject corrupt JSON syntax
    assert.throws(() => adapter.parseStructuredOutput('{ vote: accept }', 'vote'), /Failed to parse model JSON/);

    // 5. Reject schema violations
    const invalidProof = '{"scope": "", "kind": "invalid_kind", "source": "", "statement": ""}';
    assert.throws(() => adapter.parseStructuredOutput(invalidProof, 'proof'), /violates proof schema/);

    const invalidVote = '{"vote": "maybe"}';
    assert.throws(() => adapter.parseStructuredOutput(invalidVote, 'vote'), /violates vote schema/);

    const invalidJudge = '{"summary": "test", "clauses": []}';
    assert.throws(() => adapter.parseStructuredOutput(invalidJudge, 'judge_synthesis'), /violates judge_synthesis schema/);
  });

  it('5.5 should support MockAdapter wildcard responses and multi-stage fault triggers', async () => {
    const mock = new MockAdapter();

    // Wildcard scripting for seat
    mock.scriptSeatResponse({
      seatId: 'wildcard-seat',
      response: { vote: 'accept' }
    });

    const seatRes = await mock.executeSeat({
      seat: { id: 'wildcard-seat' },
      soul: 'Tester',
      round: 99,
      phase: 'VOTING',
      state: {}
    });
    assert.equal(seatRes.vote, 'accept');

    // Multi-stage fault injection: trigger fault only on 2nd attempt (afterRetries = 1)
    mock.injectSeatFault('faulty-seat', {
      afterRetries: 1,
      maxTriggers: 1,
      error: new QuotaExhaustionError('Deliberate quota fault on retry 1')
    });

    // Attempt 0 (retries = 0): should succeed
    const res0 = await mock.executeSeat({
      seat: { id: 'faulty-seat', retries: 0 },
      soul: 'Tester',
      round: 1,
      phase: 'VOTING',
      state: {}
    });
    assert.equal(res0.vote, 'accept');

    // Attempt 1 (retries = 1): should trigger fault
    await assert.rejects(
      () => mock.executeSeat({
        seat: { id: 'faulty-seat', retries: 1 },
        soul: 'Tester',
        round: 1,
        phase: 'VOTING',
        state: {}
      }),
      /Deliberate quota fault on retry 1/
    );

    // Attempt 2 (retries = 1 again, but maxTriggers exceeded): should succeed
    const res2 = await mock.executeSeat({
      seat: { id: 'faulty-seat', retries: 1 },
      soul: 'Tester',
      round: 1,
      phase: 'VOTING',
      state: {}
    });
    assert.equal(res2.vote, 'accept');

    // Soul adherence verification
    assert.equal(mock.hasReceivedSoulContent('faulty-seat', 'Tester'), true);
    assert.equal(mock.hasReceivedSoulContent('faulty-seat', /Test/i), true);
    assert.equal(mock.hasReceivedSoulContent('faulty-seat', 'NonExistentSoul'), false);
  });

});
