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

import {
  isPhaseMatch,
  normalizePhase,
  toCanonicalPhase,
  toPrototypePhase
} from '../../src/machine/constants.js';

describe('Unit: State Helpers & Phase Matching (src/machine/state.js & constants.js)', () => {
  describe('isPhaseMatch helper', () => {
    it('matches preflight with ROSTER_CONFIGURATION bidirectionally', () => {
      assert.equal(isPhaseMatch('preflight', 'ROSTER_CONFIGURATION'), true);
      assert.equal(isPhaseMatch('ROSTER_CONFIGURATION', 'preflight'), true);
    });

    it('matches clarifying with DISCOVERY bidirectionally', () => {
      assert.equal(isPhaseMatch('clarifying', 'DISCOVERY'), true);
      assert.equal(isPhaseMatch('DISCOVERY', 'clarifying'), true);
    });

    it('matches reviewing with DELIBERATION bidirectionally', () => {
      assert.equal(isPhaseMatch('reviewing', 'DELIBERATION'), true);
      assert.equal(isPhaseMatch('DELIBERATION', 'reviewing'), true);
    });

    it('matches judging with JUDGE_AUDIT_SYNTHESIS bidirectionally', () => {
      assert.equal(isPhaseMatch('judging', 'JUDGE_AUDIT_SYNTHESIS'), true);
      assert.equal(isPhaseMatch('JUDGE_AUDIT_SYNTHESIS', 'judging'), true);
    });

    it('matches confirming with VOTING bidirectionally', () => {
      assert.equal(isPhaseMatch('confirming', 'VOTING'), true);
      assert.equal(isPhaseMatch('VOTING', 'confirming'), true);
    });

    it('matches completed alias with all canonical terminal phases', () => {
      assert.equal(isPhaseMatch('completed', 'CONSENSUS_REACHED'), true);
      assert.equal(isPhaseMatch('completed', 'DISSENT_REPORT'), true);
      assert.equal(isPhaseMatch('completed', 'ROUND_TIMEOUT'), true);
    });

    it('strictly rejects matches between distinct canonical terminal phases', () => {
      assert.equal(isPhaseMatch('CONSENSUS_REACHED', 'DISSENT_REPORT'), false);
      assert.equal(isPhaseMatch('CONSENSUS_REACHED', 'ROUND_TIMEOUT'), false);
      assert.equal(isPhaseMatch('DISSENT_REPORT', 'ROUND_TIMEOUT'), false);
    });

    it('matches RECOVERY with both seat_fault and judge_fault', () => {
      assert.equal(isPhaseMatch('seat_fault', 'RECOVERY'), true);
      assert.equal(isPhaseMatch('RECOVERY', 'seat_fault'), true);
      assert.equal(isPhaseMatch('judge_fault', 'RECOVERY'), true);
      assert.equal(isPhaseMatch('RECOVERY', 'judge_fault'), true);
    });

    it('rejects match between seat_fault and judge_fault sub-types', () => {
      assert.equal(isPhaseMatch('seat_fault', 'judge_fault'), false);
      assert.equal(isPhaseMatch('judge_fault', 'seat_fault'), false);
    });

    it('handles null, undefined, and empty inputs gracefully', () => {
      assert.equal(isPhaseMatch(null, 'preflight'), false);
      assert.equal(isPhaseMatch('preflight', undefined), false);
      assert.equal(isPhaseMatch('', ''), false);
      assert.equal(isPhaseMatch('preflight', '   '), false);
      assert.equal(isPhaseMatch('   ', 'preflight'), false);
      assert.equal(isPhaseMatch('   ', '   '), false);
    });
  });

  describe('isPhase helper against state objects', () => {
    it('correctly identifies preflight / ROSTER_CONFIGURATION on initial state', () => {
      const state = createInitialCouncilState();
      assert.equal(isPhase(state, 'preflight'), true);
      assert.equal(isPhase(state, 'ROSTER_CONFIGURATION'), true);
      assert.equal(isPhase(state, 'Preflight'), true);
      assert.equal(isPhase(state, 'roster_configuration'), true);
      assert.equal(isPhase(state, 'DELIBERATION'), false);
      assert.equal(isPhase(state, 'completed'), false);
    });

    it('disambiguates CONSENSUS_REACHED terminal state', () => {
      const state = {
        phase: 'completed',
        canonicalPhase: 'CONSENSUS_REACHED',
        phaseAlias: 'completed'
      };
      assert.equal(isPhase(state, 'CONSENSUS_REACHED'), true);
      assert.equal(isPhase(state, 'completed'), true);
      assert.equal(isPhase(state, 'DISSENT_REPORT'), false);
      assert.equal(isPhase(state, 'ROUND_TIMEOUT'), false);
    });

    it('disambiguates DISSENT_REPORT terminal state', () => {
      const state = {
        phase: 'completed',
        canonicalPhase: 'DISSENT_REPORT',
        phaseAlias: 'completed'
      };
      assert.equal(isPhase(state, 'DISSENT_REPORT'), true);
      assert.equal(isPhase(state, 'completed'), true);
      assert.equal(isPhase(state, 'CONSENSUS_REACHED'), false);
      assert.equal(isPhase(state, 'ROUND_TIMEOUT'), false);
    });

    it('disambiguates ROUND_TIMEOUT terminal state', () => {
      const state = {
        phase: 'completed',
        canonicalPhase: 'ROUND_TIMEOUT',
        phaseAlias: 'completed'
      };
      assert.equal(isPhase(state, 'ROUND_TIMEOUT'), true);
      assert.equal(isPhase(state, 'completed'), true);
      assert.equal(isPhase(state, 'CONSENSUS_REACHED'), false);
      assert.equal(isPhase(state, 'DISSENT_REPORT'), false);
    });

    it('disambiguates judge_fault and seat_fault under RECOVERY', () => {
      const judgeFaultState = {
        phase: 'judge_fault',
        canonicalPhase: 'RECOVERY',
        phaseAlias: 'judge_fault'
      };
      assert.equal(isPhase(judgeFaultState, 'RECOVERY'), true);
      assert.equal(isPhase(judgeFaultState, 'judge_fault'), true);
      assert.equal(isPhase(judgeFaultState, 'seat_fault'), false);

      const seatFaultState = {
        phase: 'seat_fault',
        canonicalPhase: 'RECOVERY',
        phaseAlias: 'seat_fault'
      };
      assert.equal(isPhase(seatFaultState, 'RECOVERY'), true);
      assert.equal(isPhase(seatFaultState, 'seat_fault'), true);
      assert.equal(isPhase(seatFaultState, 'judge_fault'), false);
    });

    it('returns false for null/undefined state or phaseName', () => {
      assert.equal(isPhase(null, 'preflight'), false);
      assert.equal(isPhase(createInitialCouncilState(), null), false);
      assert.equal(isPhase(createInitialCouncilState(), ''), false);
      assert.equal(isPhase(createInitialCouncilState(), '   '), false);
      assert.equal(isPhase(createInitialCouncilState(), ' \t\r\n '), false);
    });
  });

  describe('State query helpers', () => {
    it('activeSeats, excusedSeats, and isQuorumSatisfied', () => {
      const state = createInitialCouncilState({
        minQuorum: 2,
        seats: [
          { id: 's1', harness: 'codex', model: 'm1', soul: 'arch' },
          { id: 's2', harness: 'antigravity', model: 'm2', soul: 'critic' }
        ]
      });
      assert.equal(activeSeats(state).length, 2);
      assert.equal(excusedSeats(state).length, 0);
      assert.equal(isQuorumSatisfied(state), true);

      // Excuse one seat
      state.seats[0].status = 'excused';
      assert.equal(activeSeats(state).length, 1);
      assert.equal(excusedSeats(state).length, 1);
      assert.equal(isQuorumSatisfied(state), false);
    });

    it('getOpenObjections and getPreservedObjections', () => {
      const state = {
        objections: [
          { id: 'o1', status: 'open' },
          { id: 'o2', status: 'preserved_excused' },
          { id: 'o3', status: 'withdrawn' }
        ]
      };
      assert.deepEqual(getOpenObjections(state).map((o) => o.id), ['o1']);
      assert.deepEqual(getPreservedObjections(state).map((o) => o.id), ['o2']);
    });

    it('getAdmittedProofs filters by admitted status and round', () => {
      const state = {
        proofs: [
          { id: 'p1', round: 1, status: 'admitted' },
          { id: 'p2', round: 1, status: 'rejected' },
          { id: 'p3', round: 2, status: 'admitted' }
        ]
      };
      assert.equal(getAdmittedProofs(state).length, 2);
      assert.equal(getAdmittedProofs(state, 1).length, 1);
      assert.equal(getAdmittedProofs(state, 2).length, 1);
      assert.equal(getAdmittedProofs(state, 3).length, 0);
    });

    it('findSeat, findProof, and findObjection return matched items', () => {
      const state = {
        seats: [{ id: 's1', status: 'idle' }],
        proofs: [{ id: 'p1', status: 'admitted' }],
        objections: [{ id: 'o1', status: 'open' }]
      };
      assert.equal(findSeat(state, 's1').id, 's1');
      assert.equal(findSeat(state, 's99'), undefined);
      assert.equal(findProof(state, 'p1').id, 'p1');
      assert.equal(findProof(state, 'p99'), undefined);
      assert.equal(findObjection(state, 'o1').id, 'o1');
      assert.equal(findObjection(state, 'o99'), undefined);
    });

    it('handles null and undefined state safely across all query helpers', () => {
      assert.deepEqual(activeSeats(null), []);
      assert.deepEqual(activeSeats(undefined), []);
      assert.deepEqual(excusedSeats(null), []);
      assert.deepEqual(excusedSeats(undefined), []);
      assert.equal(isQuorumSatisfied(null), false);
      assert.equal(isQuorumSatisfied(undefined), false);
      assert.deepEqual(getOpenObjections(null), []);
      assert.deepEqual(getOpenObjections(undefined), []);
      assert.deepEqual(getPreservedObjections(null), []);
      assert.deepEqual(getPreservedObjections(undefined), []);
      assert.deepEqual(getAdmittedProofs(null), []);
      assert.deepEqual(getAdmittedProofs(undefined), []);
      assert.equal(findSeat(null, 's1'), undefined);
      assert.equal(findSeat(undefined, 's1'), undefined);
      assert.equal(findProof(null, 'p1'), undefined);
      assert.equal(findProof(undefined, 'p1'), undefined);
      assert.equal(findObjection(null, 'o1'), undefined);
      assert.equal(findObjection(undefined, 'o1'), undefined);
    });

    it('cloneState deep-clones without retaining object references', () => {
      const state = createInitialCouncilState();
      const cloned = cloneState(state);
      assert.notEqual(state, cloned);
      assert.notEqual(state.judge, cloned.judge);
      assert.deepEqual(state, cloned);
    });
  });
});
