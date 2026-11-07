import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSnapshot,
  serializeSnapshot,
  deserializeSnapshot,
  SnapshotRecorder,
  createSnapshotRecorder,
  CouncilTelemetryEmitter,
  createTelemetryEmitter
} from '../../src/telemetry/index.js';
import { createInitialCouncilState } from '../../src/machine/state.js';

describe('Unit: Observer Telemetry & Deterministic Snapshots (src/telemetry/)', () => {
  const fixedClock = () => '2026-11-07T00:00:00.000Z';

  describe('createSnapshot & Metrics Extraction', () => {
    it('creates a frozen, deterministic snapshot with injected clock', () => {
      const state = createInitialCouncilState({
        topic: 'Test Topic',
        seats: [{ id: 's1', harness: 'h', model: 'm', soul: 's' }]
      });
      const event = { type: 'BEGIN_ROUND' };

      const snap1 = createSnapshot(event, state, { sequence: 1, clock: fixedClock });
      const snap2 = createSnapshot(event, state, { sequence: 1, clock: fixedClock });

      assert.equal(snap1.id, 'snap-1-BEGIN_ROUND');
      assert.equal(snap1.sequence, 1);
      assert.equal(snap1.timestamp, '2026-11-07T00:00:00.000Z');
      assert.deepEqual(snap1, snap2);

      // Immutability checks
      assert.ok(Object.isFrozen(snap1));
      assert.ok(Object.isFrozen(snap1.event));
      assert.ok(Object.isFrozen(snap1.stateSnapshot));
      assert.ok(Object.isFrozen(snap1.metrics));
    });

    it('extracts metrics accurately across different state stages', () => {
      const state = createInitialCouncilState({
        topic: 'Test Topic',
        seats: [
          { id: 's1', harness: 'h', model: 'm', soul: 's', status: 'thinking' },
          { id: 's2', harness: 'h', model: 'm', soul: 's', status: 'excused' }
        ]
      });
      state.seats[1].status = 'excused';
      state.round = 2;
      state.phase = 'confirming';
      state.proofs = [
        { id: 'P1', round: 2, status: 'admitted' },
        { id: 'P2', round: 2, status: 'rejected' }
      ];
      state.objections = [
        { id: 'O1', seatId: 's1', status: 'open' },
        { id: 'O2', seatId: 's2', status: 'preserved_excused' }
      ];
      state.verdict = null;

      const snap = createSnapshot({ type: 'CAST_VOTE' }, state);
      assert.equal(snap.metrics.round, 2);
      assert.equal(snap.metrics.phase, 'confirming');
      assert.equal(snap.metrics.canonicalPhase, 'VOTING');
      assert.equal(snap.metrics.activeSeatCount, 1);
      assert.equal(snap.metrics.excusedSeatCount, 1);
      assert.equal(snap.metrics.proofCount, 2);
      assert.equal(snap.metrics.admittedProofCount, 1);
      assert.equal(snap.metrics.openObjectionCount, 1);
      assert.equal(snap.metrics.preservedObjectionCount, 1);
      assert.equal(snap.metrics.hasVerdict, false);
      assert.equal(snap.metrics.verdictKind, null);
    });

    it('rejects invalid state object', () => {
      assert.throws(() => createSnapshot({ type: 'EVENT' }, null), /requires a valid CouncilState/);
    });
  });

  describe('Serialization & Deserialization', () => {
    it('round-trips snapshot to and from JSON', () => {
      const state = createInitialCouncilState();
      const snap = createSnapshot({ type: 'BEGIN_ROUND' }, state, { sequence: 42, clock: fixedClock });

      const json = serializeSnapshot(snap, true);
      assert.ok(typeof json === 'string');

      const restored = deserializeSnapshot(json);
      assert.equal(restored.id, 'snap-42-BEGIN_ROUND');
      assert.equal(restored.sequence, 42);
      assert.equal(restored.timestamp, '2026-11-07T00:00:00.000Z');
      assert.equal(restored.metrics.phase, state.phase);
    });

    it('deserializeSnapshot throws on malformed JSON or missing required fields', () => {
      assert.throws(() => deserializeSnapshot('invalid json'), /SyntaxError/);
      assert.throws(() => deserializeSnapshot(JSON.stringify({ id: 'bad' })), /missing required snapshot fields/);
    });
  });

  describe('SnapshotRecorder', () => {
    it('records trajectory snapshots with auto-incrementing sequence', () => {
      const recorder = createSnapshotRecorder({ clock: fixedClock, maxSnapshots: 5 });
      const state = createInitialCouncilState();

      const s0 = recorder.record({ type: 'INIT' }, state);
      const s1 = recorder.record({ type: 'BEGIN_ROUND' }, state);

      assert.equal(s0.sequence, 0);
      assert.equal(s1.sequence, 1);
      assert.equal(recorder.getSnapshots().length, 2);
      assert.equal(recorder.getLatest().id, s1.id);

      // Capped by maxSnapshots
      for (let i = 2; i < 10; i++) {
        recorder.record({ type: `EVENT_${i}` }, state);
      }
      assert.equal(recorder.getSnapshots().length, 5);

      // exportJson & clear
      const exported = recorder.exportJson();
      assert.ok(Array.isArray(JSON.parse(exported)));

      recorder.clear();
      assert.equal(recorder.getSnapshots().length, 0);
      assert.equal(recorder.getLatest(), null);
    });
  });

  describe('CouncilTelemetryEmitter', () => {
    it('emits decoupled observer seat telemetry without state machine disruption', () => {
      const emitter = createTelemetryEmitter({ clock: fixedClock });
      const events = [];

      emitter.on('seat_telemetry', (payload) => {
        events.push(payload);
      });

      emitter.emitSeatTelemetry('astra-1', 'thinking', { model: 'gpt-6-astra', step: 'analyzing' });
      emitter.emitSeatTelemetry('astra-1', 'proof_submitted');

      assert.equal(events.length, 2);
      assert.equal(events[0].seatId, 'astra-1');
      assert.equal(events[0].status, 'thinking');
      assert.equal(events[0].metadata.step, 'analyzing');
      assert.equal(events[1].status, 'proof_submitted');

      // Filtered history query
      const history = emitter.getTelemetryHistory('astra-1');
      assert.equal(history.length, 2);
    });

    it('emits scoped seat events (seat_telemetry:seatId)', () => {
      const emitter = createTelemetryEmitter();
      let scopedReceived = null;

      emitter.on('seat_telemetry:target-seat', (data) => {
        scopedReceived = data;
      });

      emitter.emitSeatTelemetry('other-seat', 'thinking');
      assert.equal(scopedReceived, null);

      emitter.emitSeatTelemetry('target-seat', 'accepted');
      assert.ok(scopedReceived);
      assert.equal(scopedReceived.seatId, 'target-seat');
      assert.equal(scopedReceived.status, 'accepted');
    });

    it('emits deterministic state transition events with snapshot', () => {
      const emitter = createTelemetryEmitter({ clock: fixedClock });
      const state = createInitialCouncilState();
      let transitionData = null;

      emitter.on('state_transition', (data) => {
        transitionData = data;
      });

      const snap = emitter.emitStateTransition({ type: 'START_CLARIFYING' }, state);
      assert.ok(snap);
      assert.ok(transitionData);
      assert.equal(transitionData.event.type, 'START_CLARIFYING');
      assert.equal(transitionData.state.phase, state.phase);
      assert.equal(transitionData.snapshot.id, snap.id);
      assert.equal(emitter.getSnapshots().length, 1);
    });

    it('emits high-level lifecycle topics cleanly', () => {
      const emitter = createTelemetryEmitter();
      const emitted = {};

      emitter.on('round_start', (d) => { emitted.round_start = d; });
      emitter.on('proof_submitted', (d) => { emitted.proof_submitted = d; });
      emitter.on('candidate_synthesized', (d) => { emitted.candidate = d; });
      emitter.on('vote_cast', (d) => { emitted.vote = d; });
      emitter.on('objection_raised', (d) => { emitted.objection = d; });
      emitter.on('seat_fault', (d) => { emitted.fault = d; });
      emitter.on('seat_excused', (d) => { emitted.excused = d; });
      emitter.on('verdict', (d) => { emitted.verdict = d; });

      emitter.emitRoundStart(1, ['s1', 's2']);
      emitter.emitProofSubmitted({ id: 'P1' });
      emitter.emitCandidateSynthesized({ summary: 'Cand' });
      emitter.emitVoteCast('s1', 'object', 'Faulty', 'P1');
      emitter.emitObjectionRaised({ id: 'O1' });
      emitter.emitSeatFault('s1', 'Timeout', 0);
      emitter.emitSeatExcused('s1', 'Quota', 1);
      emitter.emitVerdict({ kind: 'Unanimous Consensus' });

      assert.equal(emitted.round_start.round, 1);
      assert.equal(emitted.proof_submitted.proof.id, 'P1');
      assert.equal(emitted.candidate.candidate.summary, 'Cand');
      assert.equal(emitted.vote.vote, 'object');
      assert.equal(emitted.objection.objection.id, 'O1');
      assert.equal(emitted.fault.reason, 'Timeout');
      assert.equal(emitted.excused.lockedObjectionsCount, 1);
      assert.equal(emitted.verdict.verdict.kind, 'Unanimous Consensus');
    });

    it('guarantees observer safety: listener errors are caught and do not crash publisher', () => {
      const emitter = createTelemetryEmitter();
      const errors = [];

      emitter.on('error', (err) => {
        errors.push(err);
      });

      // Subscriber that throws deliberately
      emitter.on('seat_telemetry', () => {
        throw new Error('Crashing observer UI component');
      });

      // Publisher must not throw
      assert.doesNotThrow(() => {
        emitter.emitSeatTelemetry('s1', 'thinking');
      });

      assert.equal(errors.length, 1);
      assert.match(errors[0].error, /Crashing observer UI component/);
    });

    it('rejects invalid inputs on emitSeatTelemetry and emitStateTransition', () => {
      const emitter = createTelemetryEmitter();
      assert.throws(() => emitter.emitSeatTelemetry('', 'thinking'), /valid non-empty seatId/);
      assert.throws(() => emitter.emitSeatTelemetry('s1', ''), /valid status/);
      assert.throws(() => emitter.emitStateTransition(null, {}), /event with a valid "type"/);
      assert.throws(() => emitter.emitStateTransition({ type: 'X' }, null), /valid CouncilState/);
    });
  });
});
