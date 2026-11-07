/**
 * Adversarial Challenger Suite: Milestone 1 Iteration 2
 * Verification of Phase & State Invariants, Objection Lock/Excusal, and Reducer Immutability
 *
 * Challenges:
 * 1. Phase Disambiguation Invariant (All pairwise combinations of canonical phases and aliases)
 * 2. Objection Lock & Excusal Invariants (preserved_excused immutability, voting accept isolation, below-quorum excusals)
 * 3. Reducer Purity & Immutability Invariant (zero-mutation under deep freeze, normal and adversarial/malformed inputs)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialCouncilState,
  cloneState,
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

import { transitionCouncil } from '../../src/machine/reducer.js';

import {
  CANONICAL_PHASES,
  VALID_PROOF_KINDS,
  COUNCIL_PHASES,
  PROTOTYPE_PHASE_ALIASES,
  CANONICAL_TO_PROTOTYPE_PHASES,
  isPhaseMatch,
  normalizePhase,
  toCanonicalPhase,
  toPrototypePhase
} from '../../src/machine/constants.js';

import { canWithdrawObjection } from '../../src/machine/guards.js';

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
 * Helper to construct a standard council with N seats.
 */
function setupCouncil(seatCount = 3, minQuorum = 2) {
  let state = createInitialCouncilState({
    topic: 'Adversarial Consensus Verification',
    minQuorum,
    maxRounds: 3,
    maxRetriesPerSeat: 1
  });

  for (let i = 1; i <= seatCount; i++) {
    state = transitionCouncil(state, {
      type: 'ADD_SEAT',
      seat: {
        id: `seat-${i}`,
        harness: i % 2 === 0 ? 'antigravity' : 'codex',
        model: i % 2 === 0 ? 'gemini-2.5-pro' : 'gpt-5-codex',
        soul: `Soul #${i}`
      }
    });
    assert.equal(state.lastTransition.ok, true);
  }

  return state;
}

/**
 * Helper to advance council from preflight up to confirming (voting).
 */
function progressToVoting(state) {
  // 1. Begin round
  state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
  assert.equal(state.lastTransition.ok, true);

  // 2. Submit proof from seat-1
  state = transitionCouncil(state, {
    type: 'SUBMIT_PROOF',
    seatId: 'seat-1',
    scope: 'Core Invariant',
    kind: 'check',
    source: 'RFC-1001 Section 4',
    statement: 'Formal state transition safety is verified.'
  });
  assert.equal(state.lastTransition.ok, true);

  // 3. Start judging
  state = transitionCouncil(state, { type: 'START_JUDGING' });
  assert.equal(state.lastTransition.ok, true);

  // 4. Judge audits & synthesizes candidate
  state = transitionCouncil(state, {
    type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
    proofDecisions: {
      P1: { status: 'admitted', note: 'Admitted verifiable proof.' }
    },
    summary: 'Candidate Clause 1',
    clauses: [
      {
        context: 'Safety Invariant',
        conclusion: 'Invariant strictly holds.',
        citedProofIds: ['P1']
      }
    ]
  });
  assert.equal(state.lastTransition.ok, true);
  assert.equal(state.phase, 'confirming');
  return state;
}

describe('Adversarial Challenger Suite: Milestone 1 Iteration 2', () => {

  // =========================================================================
  // CHALLENGE 1: Phase Disambiguation Invariant
  // =========================================================================
  describe('Challenge 1: Phase Disambiguation Invariant', () => {
    const canonicalPhasesList = Object.values(CANONICAL_PHASES);
    const prototypeAliasesList = [
      'preflight',
      'clarifying',
      'reviewing',
      'judging',
      'confirming',
      'completed',
      'seat_fault',
      'judge_fault'
    ];
    const allPhases = [...new Set([...canonicalPhasesList, ...prototypeAliasesList])];

    describe('1.1 Terminal Phase Disambiguation Invariant', () => {
      const terminalPhases = ['CONSENSUS_REACHED', 'DISSENT_REPORT', 'ROUND_TIMEOUT'];

      it('verifies that no two distinct terminal phases cross-match via isPhaseMatch', () => {
        for (let i = 0; i < terminalPhases.length; i++) {
          for (let j = 0; j < terminalPhases.length; j++) {
            const p1 = terminalPhases[i];
            const p2 = terminalPhases[j];
            const expected = (i === j);
            assert.equal(
              isPhaseMatch(p1, p2),
              expected,
              `isPhaseMatch("${p1}", "${p2}") expected ${expected} but got ${!expected}`
            );
          }
        }
      });

      it('verifies terminal phases match generic prototype alias "completed" bidirectionally', () => {
        for (const term of terminalPhases) {
          assert.equal(isPhaseMatch(term, 'completed'), true, `${term} should match completed`);
          assert.equal(isPhaseMatch('completed', term), true, `completed should match ${term}`);
        }
      });

      it('verifies non-terminal phases never match terminal phases or "completed"', () => {
        const nonTerminalPhases = [
          'ROSTER_CONFIGURATION',
          'DISCOVERY',
          'DELIBERATION',
          'JUDGE_AUDIT_SYNTHESIS',
          'VOTING',
          'RECOVERY',
          'preflight',
          'clarifying',
          'reviewing',
          'judging',
          'confirming',
          'seat_fault',
          'judge_fault'
        ];

        for (const nonTerm of nonTerminalPhases) {
          for (const term of terminalPhases) {
            assert.equal(
              isPhaseMatch(nonTerm, term),
              false,
              `Non-terminal "${nonTerm}" must not match terminal "${term}"`
            );
            assert.equal(
              isPhaseMatch(term, nonTerm),
              false,
              `Terminal "${term}" must not match non-terminal "${nonTerm}"`
            );
          }
          assert.equal(
            isPhaseMatch(nonTerm, 'completed'),
            false,
            `Non-terminal "${nonTerm}" must not match "completed"`
          );
        }
      });
    });

    describe('1.2 Recovery Aliases Disambiguation Invariant', () => {
      it('verifies recovery aliases both match RECOVERY bidirectionally', () => {
        assert.equal(isPhaseMatch('RECOVERY', 'seat_fault'), true);
        assert.equal(isPhaseMatch('seat_fault', 'RECOVERY'), true);
        assert.equal(isPhaseMatch('RECOVERY', 'judge_fault'), true);
        assert.equal(isPhaseMatch('judge_fault', 'RECOVERY'), true);
      });

      it('verifies seat_fault and judge_fault strictly do NOT match each other', () => {
        assert.equal(isPhaseMatch('seat_fault', 'judge_fault'), false);
        assert.equal(isPhaseMatch('judge_fault', 'seat_fault'), false);
      });

      it('verifies recovery aliases do not match any other canonical phases', () => {
        const otherPhases = [
          'ROSTER_CONFIGURATION',
          'DISCOVERY',
          'DELIBERATION',
          'JUDGE_AUDIT_SYNTHESIS',
          'VOTING',
          'CONSENSUS_REACHED',
          'DISSENT_REPORT',
          'ROUND_TIMEOUT'
        ];
        for (const other of otherPhases) {
          assert.equal(isPhaseMatch('seat_fault', other), false);
          assert.equal(isPhaseMatch(other, 'seat_fault'), false);
          assert.equal(isPhaseMatch('judge_fault', other), false);
          assert.equal(isPhaseMatch(other, 'judge_fault'), false);
          assert.equal(isPhaseMatch('RECOVERY', other), false);
          assert.equal(isPhaseMatch(other, 'RECOVERY'), false);
        }
      });
    });

    describe('1.3 Exhaustive Pairwise Cartesian Matrix for isPhaseMatch', () => {
      const canonicalAliasesMap = {
        ROSTER_CONFIGURATION: ['ROSTER_CONFIGURATION', 'preflight'],
        DISCOVERY: ['DISCOVERY', 'clarifying'],
        DELIBERATION: ['DELIBERATION', 'reviewing'],
        JUDGE_AUDIT_SYNTHESIS: ['JUDGE_AUDIT_SYNTHESIS', 'judging'],
        VOTING: ['VOTING', 'confirming'],
        CONSENSUS_REACHED: ['CONSENSUS_REACHED', 'completed'],
        DISSENT_REPORT: ['DISSENT_REPORT', 'completed'],
        ROUND_TIMEOUT: ['ROUND_TIMEOUT', 'completed'],
        RECOVERY: ['RECOVERY', 'seat_fault', 'judge_fault']
      };

      it('tests all pairwise combinations of canonical phases and aliases', () => {
        for (const pA of allPhases) {
          for (const pB of allPhases) {
            const result = isPhaseMatch(pA, pB);

            // Determine if they should match:
            let shouldMatch = false;

            if (pA.toLowerCase() === pB.toLowerCase()) {
              shouldMatch = true;
            } else if (
              (pA === 'CONSENSUS_REACHED' && pB === 'DISSENT_REPORT') ||
              (pA === 'DISSENT_REPORT' && pB === 'CONSENSUS_REACHED') ||
              (pA === 'CONSENSUS_REACHED' && pB === 'ROUND_TIMEOUT') ||
              (pA === 'ROUND_TIMEOUT' && pB === 'CONSENSUS_REACHED') ||
              (pA === 'DISSENT_REPORT' && pB === 'ROUND_TIMEOUT') ||
              (pA === 'ROUND_TIMEOUT' && pB === 'DISSENT_REPORT')
            ) {
              shouldMatch = false;
            } else if (
              (pA === 'seat_fault' && pB === 'judge_fault') ||
              (pA === 'judge_fault' && pB === 'seat_fault')
            ) {
              shouldMatch = false;
            } else if (
              (pA.toUpperCase() === 'RECOVERY' && (pB.toLowerCase() === 'seat_fault' || pB.toLowerCase() === 'judge_fault')) ||
              (pB.toUpperCase() === 'RECOVERY' && (pA.toLowerCase() === 'seat_fault' || pA.toLowerCase() === 'judge_fault'))
            ) {
              shouldMatch = true;
            } else if (
              (pA.toLowerCase() === 'completed' && ['CONSENSUS_REACHED', 'DISSENT_REPORT', 'ROUND_TIMEOUT'].includes(pB.toUpperCase())) ||
              (pB.toLowerCase() === 'completed' && ['CONSENSUS_REACHED', 'DISSENT_REPORT', 'ROUND_TIMEOUT'].includes(pA.toUpperCase()))
            ) {
              shouldMatch = true;
            } else {
              shouldMatch = normalizePhase(pA) === normalizePhase(pB);
            }

            assert.equal(
              result,
              shouldMatch,
              `Pairwise mismatch for ("${pA}", "${pB}"): got ${result}, expected ${shouldMatch}`
            );
          }
        }
      });
    });

    describe('1.4 isPhase State Helper Disambiguation Matrix', () => {
      it('disambiguates all terminal and recovery states across state objects', () => {
        const testStates = [
          {
            name: 'Consensus State',
            state: { phase: 'completed', canonicalPhase: 'CONSENSUS_REACHED', phaseAlias: 'completed' },
            expectedMatches: ['CONSENSUS_REACHED', 'completed', 'consensus_reached'],
            forbiddenMatches: ['DISSENT_REPORT', 'ROUND_TIMEOUT', 'preflight', 'reviewing', 'seat_fault', 'judge_fault', 'RECOVERY']
          },
          {
            name: 'Dissent Report State',
            state: { phase: 'completed', canonicalPhase: 'DISSENT_REPORT', phaseAlias: 'completed' },
            expectedMatches: ['DISSENT_REPORT', 'completed', 'dissent_report'],
            forbiddenMatches: ['CONSENSUS_REACHED', 'ROUND_TIMEOUT', 'preflight', 'reviewing', 'seat_fault', 'judge_fault', 'RECOVERY']
          },
          {
            name: 'Round Timeout State',
            state: { phase: 'completed', canonicalPhase: 'ROUND_TIMEOUT', phaseAlias: 'completed' },
            expectedMatches: ['ROUND_TIMEOUT', 'completed', 'round_timeout'],
            forbiddenMatches: ['CONSENSUS_REACHED', 'DISSENT_REPORT', 'preflight', 'reviewing', 'seat_fault', 'judge_fault', 'RECOVERY']
          },
          {
            name: 'Seat Fault State',
            state: { phase: 'seat_fault', canonicalPhase: 'RECOVERY', phaseAlias: 'seat_fault' },
            expectedMatches: ['RECOVERY', 'seat_fault', 'recovery'],
            forbiddenMatches: ['judge_fault', 'completed', 'CONSENSUS_REACHED', 'DISSENT_REPORT', 'VOTING', 'DELIBERATION']
          },
          {
            name: 'Judge Fault State',
            state: { phase: 'judge_fault', canonicalPhase: 'RECOVERY', phaseAlias: 'judge_fault' },
            expectedMatches: ['RECOVERY', 'judge_fault', 'recovery'],
            forbiddenMatches: ['seat_fault', 'completed', 'CONSENSUS_REACHED', 'DISSENT_REPORT', 'VOTING', 'DELIBERATION']
          },
          {
            name: 'Deliberation State',
            state: { phase: 'reviewing', canonicalPhase: 'DELIBERATION', phaseAlias: 'reviewing' },
            expectedMatches: ['DELIBERATION', 'reviewing', 'deliberation'],
            forbiddenMatches: ['preflight', 'judging', 'confirming', 'completed', 'RECOVERY', 'seat_fault']
          }
        ];

        for (const tc of testStates) {
          for (const match of tc.expectedMatches) {
            assert.equal(
              isPhase(tc.state, match),
              true,
              `State ${tc.name} should match "${match}"`
            );
          }
          for (const forbidden of tc.forbiddenMatches) {
            assert.equal(
              isPhase(tc.state, forbidden),
              false,
              `State ${tc.name} must NOT match "${forbidden}"`
            );
          }
        }
      });

      it('handles null, undefined, primitive, and empty query arguments safely', () => {
        const dummyState = { phase: 'preflight', canonicalPhase: 'ROSTER_CONFIGURATION' };
        assert.equal(isPhase(null, 'preflight'), false);
        assert.equal(isPhase(undefined, 'preflight'), false);
        assert.equal(isPhase(dummyState, null), false);
        assert.equal(isPhase(dummyState, undefined), false);
        assert.equal(isPhase(dummyState, ''), false);
        assert.equal(isPhase(dummyState, '   '), false);
      });

      it('verifies whitespace-only query strings safely reject and do not match preflight', () => {
        assert.equal(isPhaseMatch('preflight', '   '), false);
        assert.equal(isPhaseMatch('   ', 'preflight'), false);
        assert.equal(isPhaseMatch('   ', '   '), false);
        const dummyState = { phase: 'preflight', canonicalPhase: 'ROSTER_CONFIGURATION' };
        assert.equal(isPhase(dummyState, '   '), false);
        assert.equal(isPhase(dummyState, ' \t\n '), false);
        const reviewingState = { phase: 'reviewing', canonicalPhase: 'DELIBERATION' };
        assert.equal(isPhase(reviewingState, '   '), false);
      });
    });
  });

  // =========================================================================
  // CHALLENGE 2: Objection Lock & Excusal Invariants
  // =========================================================================
  describe('Challenge 2: Objection Lock & Excusal Invariants', () => {
    it('verifies that preserved_excused objections can NEVER be retracted by any seat', () => {
      let state = setupCouncil(3, 2);
      state = progressToVoting(state);

      // Seat 1 raises an Objection
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seat-1',
        vote: 'object',
        reason: 'Proof methodology P1 does not evaluate boundary stress.',
        proofId: 'P1'
      });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.objections.length, 1);
      const objectionId = state.objections[0].id;
      assert.equal(state.objections[0].status, 'open');

      // Seat 1 faults and is excused
      state = transitionCouncil(state, {
        type: 'SEAT_FAULT',
        seatId: 'seat-1',
        reason: 'Rate limit quota exhausted.'
      });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.phase, 'seat_fault');

      state = transitionCouncil(state, {
        type: 'EXCUSE_SEAT',
        seatId: 'seat-1',
        reason: 'Hard quota exhaustion.'
      });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.phase, 'confirming'); // resumed saved phase

      // Verify objection is now locked as preserved_excused
      const obj = state.objections.find((o) => o.id === objectionId);
      assert.equal(obj.status, 'preserved_excused');

      // ATTACK 1: Excused seat-1 attempts to withdraw
      const withdrawByOwner = transitionCouncil(state, {
        type: 'WITHDRAW_OBJECTION',
        seatId: 'seat-1',
        objectionId
      });
      assert.equal(withdrawByOwner.lastTransition.ok, false);
      assert.match(withdrawByOwner.lastTransition.message, /Objection Immutability Guard/i);

      // Verify guard helper canWithdrawObjection
      const guardCheck1 = canWithdrawObjection(state, objectionId, 'seat-1');
      assert.equal(guardCheck1.allowed, false);

      // ATTACK 2: Active seat-2 attempts to withdraw seat-1's preserved objection
      const withdrawBySeat2 = transitionCouncil(state, {
        type: 'WITHDRAW_OBJECTION',
        seatId: 'seat-2',
        objectionId
      });
      assert.equal(withdrawBySeat2.lastTransition.ok, false);
      assert.match(withdrawBySeat2.lastTransition.message, /Objection Immutability Guard/i);

      const guardCheck2 = canWithdrawObjection(state, objectionId, 'seat-2');
      assert.equal(guardCheck2.allowed, false);

      // ATTACK 3: Active seat-3 attempts to withdraw
      const withdrawBySeat3 = transitionCouncil(state, {
        type: 'WITHDRAW_OBJECTION',
        seatId: 'seat-3',
        objectionId
      });
      assert.equal(withdrawBySeat3.lastTransition.ok, false);
      assert.match(withdrawBySeat3.lastTransition.message, /Objection Immutability Guard/i);

      // ATTACK 4: Malicious non-existent seat attempts to withdraw
      const withdrawByAttacker = transitionCouncil(state, {
        type: 'WITHDRAW_OBJECTION',
        seatId: 'seat-attacker',
        objectionId
      });
      assert.equal(withdrawByAttacker.lastTransition.ok, false);

      // Verify state was NOT modified
      assert.equal(state.objections[0].status, 'preserved_excused');
    });

    it('verifies voting accept by remaining active seats never auto-withdraws preserved_excused objections', () => {
      let state = setupCouncil(3, 2);
      state = progressToVoting(state);

      // Seat 1 raises objection
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seat-1',
        vote: 'object',
        reason: 'Dissenting opinion backed by P1.',
        proofId: 'P1'
      });
      assert.equal(state.lastTransition.ok, true);

      // Seat 1 excused -> objection becomes preserved_excused
      state = transitionCouncil(state, {
        type: 'SEAT_FAULT',
        seatId: 'seat-1',
        reason: 'Quota reached'
      });
      state = transitionCouncil(state, {
        type: 'EXCUSE_SEAT',
        seatId: 'seat-1'
      });
      assert.equal(state.objections[0].status, 'preserved_excused');

      // Remaining active seats: seat-2, seat-3 (both >= minQuorum 2)
      // Seat 2 votes accept
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seat-2',
        vote: 'accept'
      });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.objections[0].status, 'preserved_excused'); // UNTOUCHED!

      // Seat 3 votes accept
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 'seat-3',
        vote: 'accept'
      });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.objections[0].status, 'preserved_excused'); // UNTOUCHED!

      // Evaluate round: MUST NOT achieve consensus! MUST emit Dissent Report
      state = transitionCouncil(state, { type: 'EVALUATE_ROUND' });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.phase, 'completed');
      assert.equal(state.canonicalPhase, 'DISSENT_REPORT');
      assert.equal(state.verdict.kind, 'Dissent Report (Preserved Excused-Seat Objection)');
      assert.equal(state.verdict.unresolvedObjections.length, 1);
      assert.equal(state.verdict.unresolvedObjections[0].id, state.objections[0].id);
    });

    it('verifies that below-quorum excusals immediately terminate in Dissent Report', () => {
      // Setup council with exactly 2 seats and minQuorum = 2
      let state = setupCouncil(2, 2);
      state = progressToVoting(state);

      assert.equal(activeSeats(state).length, 2);
      assert.equal(isQuorumSatisfied(state), true);

      // Seat 1 faults and is excused
      state = transitionCouncil(state, {
        type: 'SEAT_FAULT',
        seatId: 'seat-1',
        reason: 'OOM death'
      });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.phase, 'seat_fault');

      // Excusing seat-1 drops active seats from 2 to 1 (below minQuorum 2)
      state = transitionCouncil(state, {
        type: 'EXCUSE_SEAT',
        seatId: 'seat-1',
        reason: 'Seat unrecoverable'
      });
      assert.equal(state.lastTransition.ok, true);

      // State MUST immediately terminate in completed / DISSENT_REPORT
      assert.equal(state.phase, 'completed');
      assert.equal(state.canonicalPhase, 'DISSENT_REPORT');
      assert.equal(state.verdict.kind, 'Dissent Report (Below Quorum)');
      assert.equal(state.verdict.activeSeatCount, 1);
      assert.equal(state.verdict.excusedSeatCount, 1);
      assert.match(state.verdict.note, /dropped below minimum quorum/i);
    });

    it('verifies cascading excusal down to below quorum terminates cleanly', () => {
      // 3 seats, minQuorum = 2
      let state = setupCouncil(3, 2);
      state = progressToVoting(state);

      // Excuse seat 1: 3 -> 2 (quorum satisfied)
      state = transitionCouncil(state, { type: 'SEAT_FAULT', seatId: 'seat-1' });
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 'seat-1' });
      assert.equal(state.phase, 'confirming');
      assert.equal(activeSeats(state).length, 2);

      // Excuse seat 2: 2 -> 1 (below quorum!)
      state = transitionCouncil(state, { type: 'SEAT_FAULT', seatId: 'seat-2' });
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 'seat-2' });
      assert.equal(state.phase, 'completed');
      assert.equal(state.canonicalPhase, 'DISSENT_REPORT');
      assert.equal(state.verdict.kind, 'Dissent Report (Below Quorum)');
      assert.equal(state.verdict.activeSeatCount, 1);
      assert.equal(state.verdict.excusedSeatCount, 2);
    });
  });

  // =========================================================================
  // CHALLENGE 3: Reducer Purity & Immutability Invariant
  // =========================================================================
  describe('Challenge 3: Reducer Purity & Immutability Invariant', () => {
    it('verifies transitionCouncil never mutates deeply frozen input state across all event types', () => {
      const baseState = setupCouncil(3, 2);
      const votingState = progressToVoting(setupCouncil(3, 2));

      // Comprehensive matrix of valid and invalid events to test against deeply frozen states
      const eventScenarios = [
        // ADD_SEAT
        { state: baseState, event: { type: 'ADD_SEAT', seat: { id: 's4', harness: 'cursor', model: 'composer', soul: 'Editor' } } },
        { state: baseState, event: { type: 'ADD_SEAT', seat: { id: 'seat-1' } } }, // invalid duplicate
        { state: votingState, event: { type: 'ADD_SEAT', seat: { id: 's4' } } }, // invalid phase

        // SEAT_TELEMETRY
        { state: baseState, event: { type: 'SEAT_TELEMETRY', seatId: 'seat-1', status: 'thinking' } },
        { state: baseState, event: { type: 'SEAT_TELEMETRY', seatId: 'nonexistent', status: 'thinking' } },

        // START_CLARIFYING & PUBLISH_CLARIFICATION
        { state: baseState, event: { type: 'START_CLARIFYING' } },
        { state: votingState, event: { type: 'START_CLARIFYING' } }, // invalid phase
        { state: baseState, event: { type: 'PUBLISH_CLARIFICATION', answer: 'Valid answer' } }, // invalid phase

        // BEGIN_ROUND
        { state: baseState, event: { type: 'BEGIN_ROUND' } },
        { state: votingState, event: { type: 'BEGIN_ROUND' } }, // from confirming

        // SUBMIT_PROOF
        {
          state: votingState,
          event: {
            type: 'SUBMIT_PROOF',
            seatId: 'seat-2',
            scope: 'Test',
            kind: 'benchmark',
            source: 'Bench-1',
            statement: 'Latency is 5ms.'
          }
        },
        { state: votingState, event: { type: 'SUBMIT_PROOF', seatId: 'seat-2', kind: 'invalid_kind' } },

        // START_JUDGING
        { state: votingState, event: { type: 'START_JUDGING' } }, // invalid phase (must be reviewing)

        // JUDGE_AUDIT_AND_SYNTHESIZE
        {
          state: votingState,
          event: {
            type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
            clauses: [{ context: 'C', citedProofIds: ['P1'] }]
          }
        }, // invalid phase (must be judging)

        // CAST_VOTE
        { state: votingState, event: { type: 'CAST_VOTE', seatId: 'seat-1', vote: 'accept' } },
        { state: votingState, event: { type: 'CAST_VOTE', seatId: 'seat-1', vote: 'object', reason: 'R', proofId: 'P1' } },
        { state: votingState, event: { type: 'CAST_VOTE', seatId: 'seat-1', vote: 'invalid_vote' } },

        // WITHDRAW_OBJECTION
        { state: votingState, event: { type: 'WITHDRAW_OBJECTION', seatId: 'seat-1', objectionId: 'O1' } },

        // SEAT_FAULT & RETRY_SEAT & EXCUSE_SEAT
        { state: votingState, event: { type: 'SEAT_FAULT', seatId: 'seat-1', reason: 'Fault' } },
        { state: votingState, event: { type: 'RETRY_SEAT', seatId: 'seat-1' } },
        { state: votingState, event: { type: 'EXCUSE_SEAT', seatId: 'seat-1' } },

        // JUDGE_FAULT & RETRY_JUDGE
        { state: votingState, event: { type: 'JUDGE_FAULT' } },
        { state: votingState, event: { type: 'RETRY_JUDGE' } },

        // EVALUATE_ROUND
        { state: votingState, event: { type: 'EVALUATE_ROUND' } },

        // RESET
        { state: votingState, event: { type: 'RESET' } },

        // UNKNOWN
        { state: votingState, event: { type: 'COMPLETELY_UNKNOWN_EVENT_TYPE' } }
      ];

      for (const scenario of eventScenarios) {
        // Create fresh deep clone and deep freeze it
        const inputState = deepFreeze(cloneState(scenario.state));
        const snapshot = JSON.stringify(inputState);

        // Execute transition: must not throw Mutation/TypeError
        let resultState;
        assert.doesNotThrow(() => {
          resultState = transitionCouncil(inputState, scenario.event);
        }, `transitionCouncil threw on event ${scenario.event.type}`);

        // Assert input state was completely untouched
        assert.equal(
          JSON.stringify(inputState),
          snapshot,
          `Input state was mutated by event ${scenario.event.type}`
        );

        // Assert result state is a distinct object instance
        assert.notEqual(resultState, inputState);
        if (resultState.seats) {
          assert.notEqual(resultState.seats, inputState.seats);
        }
        if (resultState.history) {
          assert.notEqual(resultState.history, inputState.history);
        }
      }
    });

    it('verifies transitionCouncil handles hostile, malformed, and prototype pollution inputs without throwing or mutating', () => {
      const state = deepFreeze(createInitialCouncilState());
      const snapshot = JSON.stringify(state);

      const hostileEvents = [
        null,
        undefined,
        {},
        { type: '' },
        { type: null },
        { type: undefined },
        { type: 123 },
        { type: true },
        { type: [] },
        { type: '__proto__' },
        { type: 'constructor' },
        { type: 'toString' },
        { type: 'valueOf' },
        // Malformed ADD_SEAT
        { type: 'ADD_SEAT', seat: null },
        { type: 'ADD_SEAT', seat: undefined },
        { type: 'ADD_SEAT', seat: 'invalid' },
        { type: 'ADD_SEAT', seat: {} },
        // Malformed SEAT_TELEMETRY
        { type: 'SEAT_TELEMETRY', seatId: null, status: null },
        { type: 'SEAT_TELEMETRY', seatId: '__proto__', status: 'hacked' },
        // Malformed PUBLISH_CLARIFICATION
        { type: 'PUBLISH_CLARIFICATION', answer: null },
        { type: 'PUBLISH_CLARIFICATION', answer: '   ' },
        // Malformed SUBMIT_PROOF
        { type: 'SUBMIT_PROOF', seatId: null, scope: null, kind: null },
        { type: 'SUBMIT_PROOF', seatId: 'seat-1', scope: 's', kind: '__proto__', source: 'src', statement: 'stmt' },
        // Malformed CAST_VOTE
        { type: 'CAST_VOTE', seatId: null, vote: null },
        { type: 'CAST_VOTE', seatId: 'seat-1', vote: 'object', reason: null, proofId: null },
        // Malformed WITHDRAW_OBJECTION
        { type: 'WITHDRAW_OBJECTION', seatId: null, objectionId: null },
        { type: 'WITHDRAW_OBJECTION', seatId: '__proto__', objectionId: '__proto__' },
        // Malformed EXCUSE_SEAT
        { type: 'EXCUSE_SEAT', seatId: null },
        // Malformed RESET
        { type: 'RESET', config: null }
      ];

      for (const badEvent of hostileEvents) {
        let resultState;
        assert.doesNotThrow(() => {
          resultState = transitionCouncil(state, badEvent);
        }, `Hostile event threw unhandled exception: ${JSON.stringify(badEvent)}`);

        assert.equal(
          JSON.stringify(state),
          snapshot,
          `Input state mutated by hostile event: ${JSON.stringify(badEvent)}`
        );
        assert.equal(resultState.lastTransition.ok, badEvent?.type === 'RESET');
      }
    });

    it('verifies JUDGE_AUDIT_AND_SYNTHESIZE handles hostile clause arrays without throwing or mutating', () => {
      // Progress council to judging
      let state = setupCouncil(2, 2);
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 'seat-1',
        scope: 'scope',
        kind: 'check',
        source: 'source',
        statement: 'statement'
      });
      state = transitionCouncil(state, { type: 'START_JUDGING' });
      assert.equal(state.phase, 'judging');

      const judgingState = deepFreeze(cloneState(state));
      const snapshot = JSON.stringify(judgingState);

      const hostileClauses = [
        null,
        undefined,
        [],
        [null],
        [undefined],
        [42],
        ['string'],
        [true],
        [[]],
        [{}], // missing citedProofIds
        [{ context: 'A', citedProofIds: null }],
        [{ context: 'B', citedProofIds: [] }],
        [{ context: 'C', citedProofIds: ['toString'] }], // prototype method
        [{ context: 'D', citedProofIds: ['constructor'] }],
        [{ context: 'E', citedProofIds: ['__proto__'] }],
        [{ context: 'F', citedProofIds: ['nonexistent_proof'] }],
        [null, { context: 'Valid', citedProofIds: ['P1'] }]
      ];

      for (const clauses of hostileClauses) {
        let result;
        assert.doesNotThrow(() => {
          result = transitionCouncil(judgingState, {
            type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
            clauses
          });
        }, `JUDGE_AUDIT_AND_SYNTHESIZE threw on clauses: ${JSON.stringify(clauses)}`);

        assert.equal(
          result.lastTransition.ok,
          false,
          `Expected guard rejection for clauses: ${JSON.stringify(clauses)}`
        );
        assert.equal(
          JSON.stringify(judgingState),
          snapshot,
          'Judging state was mutated by hostile clauses'
        );
      }
    });
  });
});
