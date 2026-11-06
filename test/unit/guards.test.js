import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCandidateClauses,
  canWithdrawObjection,
  checkQuorum,
  guardBeginRound,
  dropsBelowQuorumOnExcusal,
  guardEvaluateRound,
  canRetrySeat,
  guardRetrySeat,
  guardSubmitProof,
  guardCastVote,
  validateSeatActive,
  getActiveSeats,
  matchesPhase
} from '../../src/machine/guards.js';

describe('Unit: Pure Functional State Machine Guards (src/machine/guards.js)', () => {
  describe('Candidate Synthesis Proof-Binding Guard (validateCandidateClauses)', () => {
    it('rejects candidate when clauses array is missing, null, or empty', () => {
      assert.deepEqual(validateCandidateClauses(null, new Set(['P1'])), {
        valid: false,
        errors: ['Judge Candidate Guard: Candidate requires at least one clause.']
      });
      assert.deepEqual(validateCandidateClauses([], new Set(['P1'])), {
        valid: false,
        errors: ['Judge Candidate Guard: Candidate requires at least one clause.']
      });
    });

    it('rejects candidate clause that cites 0 proof IDs', () => {
      const clauses = [
        { context: 'Server Performance', conclusion: 'Linux is best', citedProofIds: [] }
      ];
      const res = validateCandidateClauses(clauses, new Set(['P1']));
      assert.equal(res.valid, false);
      assert.equal(
        res.errors[0],
        'Judge Candidate Guard: Clause "Server Performance" cites no Proof IDs.'
      );
    });

    it('rejects candidate clause citing unadmitted or unverified proof ID', () => {
      const clauses = [
        { context: 'Gaming', conclusion: 'Windows is best', citedProofIds: ['P_UNADMITTED'] }
      ];
      const res = validateCandidateClauses(clauses, new Set(['P1']));
      assert.equal(res.valid, false);
      assert.equal(
        res.errors[0],
        'Judge Candidate Guard: Clause "Gaming" cites unverified Proof "P_UNADMITTED".'
      );
    });

    it('accepts valid clauses citing admitted proof IDs across Set, Array, and Record forms', () => {
      const clauses = [
        { context: 'Cloud Workloads', conclusion: 'Linux dominates', citedProofIds: ['P1', 'P2'] }
      ];

      // Form 1: Set
      const resSet = validateCandidateClauses(clauses, new Set(['P1', 'P2', 'P3']));
      assert.equal(resSet.valid, true);
      assert.equal(resSet.errors.length, 0);

      // Form 2: Array
      const resArr = validateCandidateClauses(clauses, ['P1', 'P2']);
      assert.equal(resArr.valid, true);

      // Form 3: Record
      const resRec = validateCandidateClauses(clauses, { P1: true, P2: true });
      assert.equal(resRec.valid, true);
    });
  });

  describe('Objection Immutability and Ownership Guard (canWithdrawObjection)', () => {
    function createTestState() {
      return {
        seats: [
          { id: 's1', status: 'idle' },
          { id: 's2', status: 'idle' },
          { id: 's3', status: 'excused' }
        ],
        objections: [
          { id: 'O1', seatId: 's1', status: 'open' },
          { id: 'O2', seatId: 's2', status: 'preserved_excused' },
          { id: 'O3', seatId: 's1', status: 'withdrawn' }
        ]
      };
    }

    it('allows owner to withdraw their own open objection', () => {
      const state = createTestState();
      const res = canWithdrawObjection(state, 'O1', 's1');
      assert.equal(res.allowed, true);
    });

    it('rejects withdrawal if objection is not found', () => {
      const state = createTestState();
      const res = canWithdrawObjection(state, 'O_MISSING', 's1');
      assert.equal(res.allowed, false);
      assert.match(res.reason, /Objection "O_MISSING" not found/);
    });

    it('permanently blocks withdrawal of preserved_excused objection (ADR 0003 Fix)', () => {
      const state = createTestState();
      // Even original owner s2 cannot withdraw
      const resOwner = canWithdrawObjection(state, 'O2', 's2');
      assert.equal(resOwner.allowed, false);
      assert.match(resOwner.reason, /preserved_excused/);

      // Other active seats cannot withdraw
      const resOther = canWithdrawObjection(state, 'O2', 's1');
      assert.equal(resOther.allowed, false);
      assert.match(resOther.reason, /preserved_excused/);
    });

    it('rejects withdrawal of already withdrawn objection', () => {
      const state = createTestState();
      const res = canWithdrawObjection(state, 'O3', 's1');
      assert.equal(res.allowed, false);
      assert.match(res.reason, /already withdrawn/);
    });

    it('rejects withdrawal attempt from an excused seat', () => {
      const state = createTestState();
      // s3 is excused
      state.objections.push({ id: 'O4', seatId: 's3', status: 'open' });
      const res = canWithdrawObjection(state, 'O4', 's3');
      assert.equal(res.allowed, false);
      assert.match(res.reason, /Excused seat "s3" cannot withdraw objections/);
    });

    it('rejects withdrawal attempt from non-owner (Ownership Guard)', () => {
      const state = createTestState();
      // s2 tries to withdraw s1's objection
      const res = canWithdrawObjection(state, 'O1', 's2');
      assert.equal(res.allowed, false);
      assert.equal(
        res.reason,
        'Objection Ownership Guard: Seat "s2" cannot withdraw Objection "O1" owned by "s1".'
      );
    });
  });

  describe('Quorum Gates & Excusal Dynamics', () => {
    it('checkQuorum accurately computes active seat count against minQuorum', () => {
      const state = {
        minQuorum: 2,
        seats: [
          { id: 's1', status: 'idle' },
          { id: 's2', status: 'excused' },
          { id: 's3', status: 'idle' }
        ]
      };
      const q = checkQuorum(state);
      assert.equal(q.hasQuorum, true);
      assert.equal(q.activeCount, 2);
      assert.equal(q.minQuorum, 2);

      const qHigh = checkQuorum(state, 3);
      assert.equal(qHigh.hasQuorum, false);
      assert.equal(qHigh.activeCount, 2);
    });

    it('guardBeginRound rejects when active seats are below minQuorum', () => {
      const state = {
        phase: 'preflight',
        round: 0,
        maxRounds: 3,
        minQuorum: 2,
        seats: [{ id: 's1', status: 'idle' }]
      };
      const res = guardBeginRound(state);
      assert.equal(res.ok, false);
      assert.equal(res.message, 'Active Seats (1) below minimum quorum (2).');
    });

    it('guardBeginRound rejects when maxRounds limit already reached', () => {
      const state = {
        phase: 'preflight',
        round: 3,
        maxRounds: 3,
        minQuorum: 2,
        seats: [{ id: 's1', status: 'idle' }, { id: 's2', status: 'idle' }]
      };
      const res = guardBeginRound(state);
      assert.equal(res.ok, false);
      assert.match(res.message, /Maximum deliberation rounds/);
    });

    it('dropsBelowQuorumOnExcusal predicts quorum loss before mutation', () => {
      const state = {
        minQuorum: 2,
        seats: [
          { id: 's1', status: 'idle' },
          { id: 's2', status: 'idle' }
        ]
      };
      assert.equal(dropsBelowQuorumOnExcusal(state, 's1'), true);

      state.seats.push({ id: 's3', status: 'idle' });
      assert.equal(dropsBelowQuorumOnExcusal(state, 's1'), false);
    });

    it('guardEvaluateRound requires all active seats to have voted', () => {
      const state = {
        phase: 'confirming',
        seats: [
          { id: 's1', status: 'accepted' },
          { id: 's2', status: 'thinking' },
          { id: 's3', status: 'excused' }
        ]
      };
      const res = guardEvaluateRound(state);
      assert.equal(res.ok, false);
      assert.equal(res.unvotedCount, 1);
      assert.match(res.message, /1 active Seat\(s\) have not voted yet/);

      state.seats[1].status = 'objected';
      const resAll = guardEvaluateRound(state);
      assert.equal(resAll.ok, true);
    });
  });

  describe('Retry Cap Guards (canRetrySeat, guardRetrySeat)', () => {
    it('canRetrySeat enforces maxRetriesPerSeat cap', () => {
      const seat = { id: 's1', retries: 0 };
      assert.equal(canRetrySeat(seat, 1).allowed, true);

      seat.retries = 1;
      const resCapped = canRetrySeat(seat, 1);
      assert.equal(resCapped.allowed, false);
      assert.equal(
        resCapped.reason,
        'Retry Cap Guard: Seat "s1" reached 1/1 retries. Excuse Seat instead.'
      );
    });

    it('guardRetrySeat validates seat_fault phase and target seat existence', () => {
      const state = {
        phase: 'reviewing',
        faultSeatId: 's1',
        maxRetriesPerSeat: 1,
        seats: [{ id: 's1', retries: 0 }]
      };
      const badPhase = guardRetrySeat(state, {});
      assert.equal(badPhase.ok, false);
      assert.match(badPhase.message, /Can only retry a Seat from seat_fault/);

      state.phase = 'seat_fault';
      state.seats = [];
      const notFound = guardRetrySeat(state, {});
      assert.equal(notFound.ok, false);
      assert.match(notFound.message, /Faulted Seat not found/);
    });
  });

  describe('Proof Submission & Voting Guards (guardSubmitProof, guardCastVote)', () => {
    it('guardSubmitProof validates active phase, seat existence, and proof fields', () => {
      const state = {
        phase: 'preflight',
        seats: [{ id: 's1', status: 'idle' }]
      };
      const badPhase = guardSubmitProof(state, { seatId: 's1' });
      assert.equal(badPhase.ok, false);

      state.phase = 'reviewing';
      const excusedSeat = guardSubmitProof(state, { seatId: 'missing-seat' });
      assert.equal(excusedSeat.ok, false);

      const invalidProof = guardSubmitProof(state, { seatId: 's1', scope: '' });
      assert.equal(invalidProof.ok, false);
      assert.equal(
        invalidProof.message,
        'Structural Proof Guard: "scope" condition is required.'
      );
    });

    it('guardCastVote validates confirming phase, active seat, and object requirements', () => {
      const state = {
        phase: 'confirming',
        seats: [{ id: 's1', status: 'idle' }],
        proofs: [{ id: 'P1', status: 'admitted' }, { id: 'P_REJ', status: 'rejected' }]
      };

      // Accept vote
      assert.equal(guardCastVote(state, { seatId: 's1', vote: 'accept' }).ok, true);

      // Object without reason
      const noReason = guardCastVote(state, { seatId: 's1', vote: 'object', reason: '' });
      assert.equal(noReason.ok, false);
      assert.equal(
        noReason.message,
        'Objection Guard: An Objection requires a concrete reason.'
      );

      // Object with rejected proof
      const rejectedProof = guardCastVote(state, {
        seatId: 's1',
        vote: 'object',
        reason: 'Flaw',
        proofId: 'P_REJ'
      });
      assert.equal(rejectedProof.ok, false);
      assert.equal(
        rejectedProof.message,
        'Objection Guard: Objection must cite a valid Proof ID.'
      );

      // Object with admitted proof
      const validObj = guardCastVote(state, {
        seatId: 's1',
        vote: 'object',
        reason: 'Flaw',
        proofId: 'P1'
      });
      assert.equal(validObj.ok, true);
    });
  });

  describe('Helper Utilities (validateSeatActive, getActiveSeats, matchesPhase)', () => {
    it('getActiveSeats filters out excused seats', () => {
      const state = {
        seats: [
          { id: 's1', status: 'idle' },
          { id: 's2', status: 'excused' },
          { id: 's3', status: 'thinking' }
        ]
      };
      const active = getActiveSeats(state);
      assert.equal(active.length, 2);
      assert.deepEqual(active.map((s) => s.id), ['s1', 's3']);
    });

    it('matchesPhase supports both canonical uppercase and prototype lowercase aliases', () => {
      assert.equal(matchesPhase('preflight', ['ROSTER_CONFIGURATION']), true);
      assert.equal(matchesPhase('ROSTER_CONFIGURATION', ['preflight']), true);
      assert.equal(matchesPhase('reviewing', ['DELIBERATION']), true);
      assert.equal(matchesPhase('DELIBERATION', ['reviewing']), true);
      assert.equal(matchesPhase('confirming', ['judging']), false);
    });
  });
});
