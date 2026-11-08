import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CouncilRoster, createRoster } from '../../src/seats/roster.js';
import { Seat } from '../../src/seats/seat.js';

describe('Unit: Council Roster Management & Quorum Double-Gating (src/seats/roster.js)', () => {
  describe('Dynamic Registration', () => {
    it('registers seats individually and in batches', () => {
      const roster = createRoster({ minQuorum: 2, maxRetriesPerSeat: 1 });

      const s1 = roster.addSeat({
        id: 'astra-kernel',
        harness: 'codex',
        model: 'gpt-6-astra (max)',
        soul: 'Kernel Purist'
      });
      assert.ok(s1 instanceof Seat);
      assert.equal(roster.hasSeat('astra-kernel'), true);
      assert.equal(roster.getTotalCount(), 1);

      const added = roster.addSeats([
        { id: 'astra-gamer', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Gamer' },
        { id: 'argon-unix', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Unix Dev' }
      ]);
      assert.equal(added.length, 2);
      assert.equal(roster.getTotalCount(), 3);
      assert.equal(roster.getActiveCount(), 3);
    });

    it('rejects duplicate seat IDs', () => {
      const roster = createRoster();
      roster.addSeat({ id: 's1', harness: 'codex', model: 'm', soul: 's' });
      assert.throws(() => roster.addSeat({ id: 's1', harness: 'cursor', model: 'm', soul: 's' }), /already exists/);
    });

    it('rejects invalid seat configurations', () => {
      const roster = createRoster();
      assert.throws(() => roster.addSeat({ id: '' }), /Invalid Seat configuration/);
      assert.throws(() => roster.addSeats('not an array'), /expects an array/);
    });

    it('validates minQuorum and maxRetriesPerSeat property setters', () => {
      const roster = createRoster();
      roster.minQuorum = 3;
      assert.equal(roster.minQuorum, 3);
      assert.throws(() => { roster.minQuorum = 0; }, /minQuorum must be an integer >= 1/);
      assert.throws(() => { roster.minQuorum = 1.5; }, /minQuorum must be an integer >= 1/);

      roster.maxRetriesPerSeat = 2;
      assert.equal(roster.maxRetriesPerSeat, 2);
      assert.throws(() => { roster.maxRetriesPerSeat = -1; }, /maxRetriesPerSeat must be a non-negative integer/);
    });
  });

  describe('Active vs Excused Queries & Filters', () => {
    it('filters seats by status, harness, and model', () => {
      const roster = createRoster({
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra', soul: 'Soul 1' },
          { id: 's2', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Soul 2' },
          { id: 's3', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Soul 3' },
          { id: 's4', harness: 'cursor', model: 'grok-4.7-high', soul: 'Soul 4' }
        ]
      });

      assert.equal(roster.getTotalCount(), 4);
      assert.equal(roster.getActiveCount(), 4);
      assert.equal(roster.getExcusedCount(), 0);

      // Excuse seat s4
      roster.excuseSeat('s4', 'Quota reached');
      assert.equal(roster.getActiveCount(), 3);
      assert.equal(roster.getExcusedCount(), 1);
      assert.deepEqual(roster.getExcusedSeats().map((s) => s.id), ['s4']);

      // Filter by harness
      assert.equal(roster.getSeatsByHarness('codex').length, 2);
      assert.equal(roster.getSeatsByHarness('antigravity').length, 1);
      assert.equal(roster.getSeatsByHarness('cursor').length, 1);

      // Filter by model
      assert.equal(roster.getSeatsByModel('gpt-6-astra').length, 1);
      assert.equal(roster.getSeatsByModel('nonexistent').length, 0);
    });
  });

  describe('Quorum Double-Gating & Lookahead', () => {
    it('evaluates quorum correctly with checkQuorum and hasQuorum', () => {
      const roster = createRoster({ minQuorum: 2 });
      assert.equal(roster.hasQuorum(), false);
      assert.deepEqual(roster.checkQuorum(), { hasQuorum: false, activeCount: 0, minQuorum: 2 });

      roster.addSeat({ id: 's1', harness: 'h', model: 'm', soul: 's' });
      assert.equal(roster.hasQuorum(), false);

      roster.addSeat({ id: 's2', harness: 'h', model: 'm', soul: 's' });
      assert.equal(roster.hasQuorum(), true);
      assert.deepEqual(roster.checkQuorum(), { hasQuorum: true, activeCount: 2, minQuorum: 2 });
    });

    it('willLoseQuorumOnExcusal accurately predicts quorum drops', () => {
      // 2 seats, minQuorum 2 -> excusing 1 drops to 1, breaking quorum
      const roster2 = createRoster({
        minQuorum: 2,
        seats: [
          { id: 's1', harness: 'h', model: 'm', soul: 's' },
          { id: 's2', harness: 'h', model: 'm', soul: 's' }
        ]
      });
      assert.equal(roster2.willLoseQuorumOnExcusal('s1'), true);

      // 3 seats, minQuorum 2 -> excusing 1 leaves 2 active, keeping quorum
      const roster3 = createRoster({
        minQuorum: 2,
        seats: [
          { id: 's1', harness: 'h', model: 'm', soul: 's' },
          { id: 's2', harness: 'h', model: 'm', soul: 's' },
          { id: 's3', harness: 'h', model: 'm', soul: 's' }
        ]
      });
      assert.equal(roster3.willLoseQuorumOnExcusal('s1'), false);

      // Excusing an unknown seat returns true
      assert.equal(roster3.willLoseQuorumOnExcusal('unknown'), true);

      // Excusing an already excused seat
      roster3.excuseSeat('s1');
      assert.equal(roster3.willLoseQuorumOnExcusal('s1'), false); // active count remains 2 >= 2
    });

    it('excuseSeat updates status and returns quorum drop flag', () => {
      const roster = createRoster({
        minQuorum: 2,
        seats: [
          { id: 's1', harness: 'h', model: 'm', soul: 's' },
          { id: 's2', harness: 'h', model: 'm', soul: 's' }
        ]
      });

      const res = roster.excuseSeat('s1', 'Out of quota');
      assert.equal(res.ok, true);
      assert.equal(res.seat.isExcused, true);
      assert.equal(res.activeCount, 1);
      assert.equal(res.dropsBelowQuorum, true);
    });

    it('throws error when excusing unknown seat', () => {
      const roster = createRoster();
      assert.throws(() => roster.excuseSeat('nonexistent'), /Cannot excuse unknown Seat/);
    });
  });

  describe('Seat Status Updates & Retries', () => {
    it('updateSeatStatus updates live status of active seat', () => {
      const roster = createRoster({
        seats: [{ id: 's1', harness: 'h', model: 'm', soul: 's' }]
      });

      roster.updateSeatStatus('s1', 'thinking');
      assert.equal(roster.getSeat('s1').status, 'thinking');

      assert.throws(() => roster.updateSeatStatus('unknown', 'thinking'), /does not exist/);
    });

    it('retrySeat retries a faulted seat within maxRetriesPerSeat', () => {
      const roster = createRoster({
        maxRetriesPerSeat: 1,
        seats: [{ id: 's1', harness: 'h', model: 'm', soul: 's' }]
      });

      roster.getSeat('s1').fault('HTTP 429');

      const res1 = roster.retrySeat('s1');
      assert.equal(res1.ok, true);
      assert.equal(res1.seat.status, 'thinking');
      assert.equal(res1.seat.retries, 1);

      // Fault again and retry -> rejected by cap
      roster.getSeat('s1').fault('HTTP 429 again');
      const res2 = roster.retrySeat('s1');
      assert.equal(res2.ok, false);
      assert.match(res2.error, /Retry cap reached/);

      // Retry unknown seat
      assert.equal(roster.retrySeat('unknown').ok, false);
    });
  });

  describe('Batch Operations', () => {
    it('evaluates allActiveSeatsVoted and allActiveSeatsSubmittedProof', () => {
      const roster = createRoster({
        seats: [
          { id: 's1', harness: 'h', model: 'm', soul: 's' },
          { id: 's2', harness: 'h', model: 'm', soul: 's' },
          { id: 's3', harness: 'h', model: 'm', soul: 's' }
        ]
      });

      // Proof check
      assert.equal(roster.allActiveSeatsSubmittedProof(), false);
      roster.updateSeatStatus('s1', 'proof_submitted');
      roster.updateSeatStatus('s2', 'proof_submitted');
      assert.equal(roster.allActiveSeatsSubmittedProof(), false);
      roster.updateSeatStatus('s3', 'proof_submitted');
      assert.equal(roster.allActiveSeatsSubmittedProof(), true);

      // Voting check
      assert.equal(roster.allActiveSeatsVoted(), false);
      roster.updateSeatStatus('s1', 'accepted');
      roster.updateSeatStatus('s2', 'objected');
      roster.excuseSeat('s3'); // s3 is excused, so active seats are s1 and s2
      assert.equal(roster.allActiveSeatsVoted(), true);
    });

    it('resetActiveSeats resets active seats to targetStatus without altering excused seats', () => {
      const roster = createRoster({
        seats: [
          { id: 's1', harness: 'h', model: 'm', soul: 's', status: 'accepted' },
          { id: 's2', harness: 'h', model: 'm', soul: 's', status: 'objected' },
          { id: 's3', harness: 'h', model: 'm', soul: 's' }
        ]
      });
      roster.excuseSeat('s3');

      roster.resetActiveSeats('thinking');
      assert.equal(roster.getSeat('s1').status, 'thinking');
      assert.equal(roster.getSeat('s2').status, 'thinking');
      assert.equal(roster.getSeat('s3').status, 'excused');
    });
  });

  describe('Serialization & Hydration with CouncilState', () => {
    it('toStateArray produces plain objects matching CouncilState.seats', () => {
      const roster = createRoster({
        seats: [
          { id: 'astra-1', harness: 'codex', model: 'gpt-6-astra', soul: 'Purist', status: 'thinking' }
        ]
      });

      const arr = roster.toStateArray();
      assert.equal(arr.length, 1);
      assert.deepEqual(arr[0], {
        id: 'astra-1',
        harness: 'codex',
        model: 'gpt-6-astra',
        soul: 'Purist',
        status: 'thinking',
        retries: 0,
        excusedReason: null,
        tools: 'read-only'
      });
    });

    it('fromState reconstructs CouncilRoster from state snapshot', () => {
      const mockState = {
        minQuorum: 3,
        maxRetriesPerSeat: 2,
        seats: [
          { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1', status: 'thinking', retries: 1, excusedReason: null },
          { id: 's2', harness: 'antigravity', model: 'm2', soul: 'soul2', status: 'excused', retries: 2, excusedReason: 'Quota' }
        ]
      };

      const roster = CouncilRoster.fromState(mockState);
      assert.equal(roster.minQuorum, 3);
      assert.equal(roster.maxRetriesPerSeat, 2);
      assert.equal(roster.getTotalCount(), 2);
      assert.equal(roster.getActiveCount(), 1);
      assert.equal(roster.getExcusedCount(), 1);
      assert.equal(roster.getSeat('s2').excusedReason, 'Quota');
    });

    it('syncFromState synchronizes status updates from snapshot', () => {
      const roster = createRoster({
        seats: [
          { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1', status: 'thinking' }
        ]
      });

      const updatedState = {
        seats: [
          { id: 's1', status: 'proof_submitted' },
          { id: 's2', harness: 'cursor', model: 'm2', soul: 'soul2', status: 'idle' }
        ]
      };

      roster.syncFromState(updatedState);
      assert.equal(roster.getSeat('s1').status, 'proof_submitted');
      assert.equal(roster.hasSeat('s2'), true);
    });
  });
});
