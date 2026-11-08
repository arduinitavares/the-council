/**
 * @fileoverview Milestone 3 Tier 5 White-Box Adversarial Coverage Hardening Suite 2
 * Author: challenger_m3_2 (Empirical Challenger)
 * Framework: Native Node 22 test runner (node:test, node:assert/strict)
 *
 * Targets & Verification Scope:
 * - CouncilEngine Coordinator (src/engine/council-engine.js, src/engine/config.js)
 * - Telemetry Emitter & Snapshot Store (src/telemetry/)
 * - CLI Runner & Binary (src/cli/index.js, bin/council)
 *
 * Empirical Investigation & Stress Vectors:
 * 1. Focus Area 1: Judge producing invalid candidate output (Candidate Guard rejection & loop recovery).
 * 2. Focus Area 2: Seat casting objection citing invalid proof ID (Objection Guard rejection, state/telemetry desync, loop recovery).
 * 3. Focus Area 3: Multi-round debate telemetry cleanliness (spurious rejected BEGIN_ROUND snapshots).
 * 4. Focus Area 4: AbortSignal handling (pre-aborted signal gap on instantiation & mid-stream cancellations).
 * 5. Focus Area 5: CLI inspect nested snapshot structure from "council run --json" vs flat trajectory array.
 * 6. Telemetry observer safety, exception isolation, and buffer clamping under high-volume stress.
 * 7. Configuration boundaries, sparse data, duplicate seats, and input validation.
 */

import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Subsystem imports under test
import {
  CouncilEngine,
  createCouncilEngine,
  validateConfig,
  resolveConfig,
  loadConfigFile
} from '../../src/engine/index.js';

import {
  CouncilTelemetryEmitter,
  createTelemetryEmitter,
  createSnapshot,
  serializeSnapshot,
  deserializeSnapshot,
  SnapshotRecorder,
  createSnapshotRecorder
} from '../../src/telemetry/index.js';

import { runCli, HELP_TEXT } from '../../src/cli/index.js';
import { createInitialCouncilState } from '../../src/machine/state.js';
import { MockAdapter } from '../../src/harness/mock.js';

describe('Milestone 3 Tier 5 Suite — Adversarial Coordinator, Telemetry & CLI Hardening (challenger_m3_2)', () => {

  /**
   * Helper to capture CLI stdout, stderr, and exit codes.
   */
  function createMockIO() {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let exitCode = null;

    return {
      io: {
        stdout: {
          write: (text) => { stdoutBuffer += text; }
        },
        stderr: {
          write: (text) => { stderrBuffer += text; }
        },
        exit: (code) => {
          exitCode = code;
          return code;
        }
      },
      getStdout: () => stdoutBuffer,
      getStderr: () => stderrBuffer,
      getExitCode: () => exitCode
    };
  }

  // ==========================================================================
  // SUITE 1: COUNCILENGINE COORDINATOR ADVERSARIAL RECOVERY & LOOP SAFETY
  // ==========================================================================
  describe('Suite 1: CouncilEngine Coordinator Failure Modes & Loop Safety', () => {

    it('1.1 should recover from Candidate Guard rejection, retry Judge, and terminate cleanly with Dissent Report', async () => {
      // Vector: Judge returns an invalid candidate (empty clauses array), violating Candidate Guard.
      const mockAdapter = new MockAdapter();
      mockAdapter.executeJudgeAuditAndSynthesis = async () => {
        return {
          summary: 'Judge invalid candidate synthesis',
          proofDecisions: { P1: 'admitted' },
          clauses: [] // VIOLATION: clauses array must have length >= 1
        };
      };

      const engine = new CouncilEngine({
        topic: 'Candidate Guard Attack',
        maxRounds: 3,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        seats: [
          { id: 'seat-alpha', harness: 'mock', model: 'm', soul: 's' },
          { id: 'seat-beta', harness: 'mock', model: 'm', soul: 's' }
        ]
      }, {
        harnessResolver: () => mockAdapter
      });

      const guardRejectedEvents = [];
      engine.getTelemetry().on('guard_rejected', (data) => {
        guardRejectedEvents.push(data);
      });

      engine.initRoster();

      // Step A: Single round execution
      const roundRes = await engine.runRound();

      // Observation 1: Candidate Guard rejected the transition
      const judgeRejection = guardRejectedEvents.find(
        (e) => e.event.type === 'JUDGE_AUDIT_AND_SYNTHESIZE'
      );
      assert.ok(judgeRejection, 'A guard_rejected event must be emitted for JUDGE_AUDIT_AND_SYNTHESIZE');
      assert.match(
        judgeRejection.message,
        /Candidate requires at least one clause|Candidate Guard/i,
        'Message must indicate candidate clause guard failure'
      );

      // Observation 2: Judge was retried up to retry cap (1)
      assert.equal(engine.state.judge.retries, 1, 'Judge was retried up to cap');

      // Observation 3: Engine completed round with Dissent Report on exhausted retries
      assert.equal(engine.state.phase, 'completed', 'Phase should be completed');
      assert.ok(roundRes.verdict, 'Verdict emitted on exhausted judge retries');
      assert.equal(roundRes.verdict.kind, 'Dissent Report (Judge Fault)');
      assert.equal(engine.isCompleted(), true, 'Deliberation is completed');

      // Step B: Loop Safety on engine.run()
      // Verify engine.run() completes naturally without infinite loop or external abort
      const engine2 = new CouncilEngine({
        topic: 'Judge Loop Safety',
        maxRounds: 3,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 's' },
          { id: 's2', harness: 'mock', model: 'm', soul: 's' }
        ]
      }, { harnessResolver: () => mockAdapter });

      const runResult = await engine2.run();
      assert.equal(runResult.ok, false);
      assert.equal(runResult.verdict.kind, 'Dissent Report (Judge Fault)');
      assert.equal(engine2.isCompleted(), true);
      assert.equal(engine2.aborted, false, 'Completed naturally without abort');
    });

    it('1.2 should route invalid objection citation to handleSeatFault, avoid false telemetry, and terminate cleanly', async () => {
      // Vector: Seat casts an objection with a non-existent proof ID
      const mockAdapter = new MockAdapter();
      mockAdapter.executeSeatVote = async ({ seat }) => {
        if (seat.id === 'seat-objector') {
          return {
            vote: 'object',
            reason: 'Dissenting opinion',
            proofId: 'NON_EXISTENT_P_404' // Invalid proof citation
          };
        }
        return { vote: 'accept' };
      };

      const engine = new CouncilEngine({
        topic: 'Invalid Objection Citation',
        maxRounds: 3,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        seats: [
          { id: 'seat-voter', harness: 'mock', model: 'm', soul: 's' },
          { id: 'seat-objector', harness: 'mock', model: 'm', soul: 's' }
        ]
      }, {
        harnessResolver: () => mockAdapter
      });

      const guardRejectedEvents = [];
      const telemetryEvents = [];
      const objectionsRaised = [];

      engine.getTelemetry().on('guard_rejected', (d) => guardRejectedEvents.push(d));
      engine.getTelemetry().on('seat_telemetry', (d) => telemetryEvents.push(d));
      engine.getTelemetry().on('objection_raised', (d) => objectionsRaised.push(d));

      engine.initRoster();

      // Step A: Execute single round
      await engine.runRound();

      // Observation 1: Guard rejected CAST_VOTE for invalid cited proof
      const voteRejection = guardRejectedEvents.find((e) => e.event.type === 'CAST_VOTE');
      assert.ok(voteRejection, 'A guard_rejected event must be emitted for CAST_VOTE');
      assert.match(voteRejection.message, /Objection Guard: Objection must cite a valid Proof ID|cited proof/);

      // Observation 2: False telemetry avoided — no 'objected' status emitted
      const objectorTelemetry = telemetryEvents.filter(
        (t) => t.seatId === 'seat-objector' && t.status === 'objected'
      );
      assert.equal(objectorTelemetry.length, 0, 'No false objected telemetry emitted on guard failure');

      // Observation 3: No false objection_raised event with undefined payload
      assert.equal(objectionsRaised.length, 0, 'No false objection_raised event emitted');

      // Observation 4: Fault recovery — seat retried and excused on retry exhaustion
      const objectorSeat = engine.state.seats.find((s) => s.id === 'seat-objector');
      assert.equal(objectorSeat.status, 'excused', 'Seat transitioned to excused after retry exhaustion');

      // Observation 5: Quorum drop termination — active seats (1) < minQuorum (2)
      assert.equal(engine.isCompleted(), true, 'Council completed due to quorum drop');
      assert.equal(engine.state.verdict.kind, 'Dissent Report (Below Quorum)');

      // Step B: Loop Safety on engine.run()
      const engine2 = new CouncilEngine({
        topic: 'Seat Loop Safety',
        maxRounds: 3,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        seats: [
          { id: 'seat-voter', harness: 'mock', model: 'm', soul: 's' },
          { id: 'seat-objector', harness: 'mock', model: 'm', soul: 's' }
        ]
      }, { harnessResolver: () => mockAdapter });

      const runResult = await engine2.run();
      assert.equal(runResult.ok, false);
      assert.equal(runResult.verdict.kind, 'Dissent Report (Below Quorum)');
      assert.equal(engine2.isCompleted(), true);
      assert.equal(engine2.aborted, false, 'Completed naturally without abort');
    });

    it('1.3 should prevent spurious rejected BEGIN_ROUND snapshot in multi-round deliberation telemetry', async () => {
      // Vector: Deliberation spans 2 rounds. In round 1, seat objects. In round 2, seat accepts.
      const mockAdapter = new MockAdapter();
      mockAdapter.executeSeatVote = async ({ seat, round }) => {
        if (seat.id === 'seat-challenger' && round === 1) {
          return { vote: 'object', reason: 'Round 1 Objection', proofId: 'P1' };
        }
        return { vote: 'accept' };
      };

      const engine = new CouncilEngine({
        topic: 'Multi-Round BEGIN_ROUND Telemetry Cleanliness',
        maxRounds: 3,
        minQuorum: 2,
        seats: [
          { id: 'seat-accepter', harness: 'mock', model: 'm', soul: 's' },
          { id: 'seat-challenger', harness: 'mock', model: 'm', soul: 's' }
        ]
      }, { harnessResolver: () => mockAdapter });

      const guardRejectedEvents = [];
      engine.getTelemetry().on('guard_rejected', (data) => {
        guardRejectedEvents.push(data);
      });

      const result = await engine.run();

      // Consensus is reached in round 2
      assert.equal(result.ok, true);
      assert.equal(result.verdict.kind, 'Unanimous Consensus');
      assert.equal(engine.state.round, 2);

      // Observation: 0 guard_rejected events emitted for BEGIN_ROUND (no spurious rejection)
      const beginRoundRejections = guardRejectedEvents.filter((e) => e.event.type === 'BEGIN_ROUND');
      assert.equal(beginRoundRejections.length, 0, 'No spurious BEGIN_ROUND rejection in multi-round deliberation');

      // Trajectory snapshot check: exactly 1 BEGIN_ROUND snapshot from round 1, with ok: true
      const snapshots = engine.getTelemetry().getSnapshots();
      const beginRoundSnapshots = snapshots.filter((s) => s.event.type === 'BEGIN_ROUND');
      assert.equal(beginRoundSnapshots.length, 1, 'Only Round 1 recorded a BEGIN_ROUND transition');
      assert.equal(beginRoundSnapshots[0].stateSnapshot.lastTransition.ok, true, 'Round 1 BEGIN_ROUND succeeded');
    });

    it('1.4 should recognize pre-aborted signal on instantiation and post-instantiation abort', async () => {
      // Vector: Pre-aborted signal passed to CouncilEngine constructor
      const preAbortedSignal = AbortSignal.abort();
      assert.equal(preAbortedSignal.aborted, true, 'Signal is already aborted before passing to constructor');

      const engineWithPreAborted = new CouncilEngine({}, { signal: preAbortedSignal });

      assert.equal(
        engineWithPreAborted.aborted,
        true,
        'Engine correctly initializes aborted = true when signal is pre-aborted'
      );
      assert.equal(engineWithPreAborted.signal.aborted, true, 'The passed signal itself is indeed aborted');

      // Verify run() immediately returns without executing
      const runRes = await engineWithPreAborted.run();
      assert.equal(engineWithPreAborted.aborted, true);
      assert.equal(runRes.ok, false);

      // Contrast: Post-instantiation signal abort operates correctly
      const controller = new AbortController();
      const engineNormal = new CouncilEngine({}, { signal: controller.signal });
      assert.equal(engineNormal.aborted, false);

      controller.abort();
      assert.equal(engineNormal.aborted, true, 'Engine aborted flag updates when signal aborts post-construction');
    });

    it('1.5 should handle mid-stream cancellation during seat proof collection', async () => {
      const controller = new AbortController();
      const mockAdapter = new MockAdapter();
      let proofCallCount = 0;

      mockAdapter.executeSeatProof = async () => {
        proofCallCount++;
        if (proofCallCount === 1) {
          // Abort after first seat proof
          controller.abort();
        }
        return {
          id: `P${proofCallCount}`,
          scope: 'Proof Scope',
          kind: 'check',
          source: 'https://council.test',
          statement: 'Statement verification'
        };
      };

      const engine = new CouncilEngine({
        seats: [
          { id: 'seat-1', harness: 'mock', model: 'm', soul: 's' },
          { id: 'seat-2', harness: 'mock', model: 'm', soul: 's' },
          { id: 'seat-3', harness: 'mock', model: 'm', soul: 's' }
        ]
      }, {
        harnessResolver: () => mockAdapter,
        signal: controller.signal
      });

      const result = await engine.run();

      assert.equal(engine.aborted, true, 'Engine registered abort');
      assert.equal(result.ok, false, 'Debate did not reach consensus');
      assert.equal(engine.isCompleted(), false, 'Debate stopped mid-stream');
    });

    it('1.6 should handle mid-stream cancellation during seat voting', async () => {
      const controller = new AbortController();
      const mockAdapter = new MockAdapter();
      let voteCallCount = 0;

      mockAdapter.executeSeatVote = async () => {
        voteCallCount++;
        if (voteCallCount === 1) {
          controller.abort();
        }
        return { vote: 'accept' };
      };

      const engine = new CouncilEngine({
        seats: [
          { id: 'seat-1', harness: 'mock', model: 'm', soul: 's' },
          { id: 'seat-2', harness: 'mock', model: 'm', soul: 's' }
        ]
      }, {
        harnessResolver: () => mockAdapter,
        signal: controller.signal
      });

      const result = await engine.run();

      assert.equal(engine.aborted, true);
      assert.equal(result.ok, false);
      assert.equal(engine.isCompleted(), false);
    });

    it('1.7 should strictly validate configuration bounds and reject corrupt options', () => {
      // Null / primitive config
      assert.equal(validateConfig(null).valid, false);
      assert.equal(validateConfig('invalid-config').valid, false);

      // Missing or empty topic
      assert.equal(validateConfig({}).valid, false);
      assert.equal(validateConfig({ topic: '   ' }).valid, false);

      // Non-integer or non-positive maxRounds
      assert.equal(validateConfig({ topic: 'Valid', maxRounds: 0 }).valid, false);
      assert.equal(validateConfig({ topic: 'Valid', maxRounds: -5 }).valid, false);
      assert.equal(validateConfig({ topic: 'Valid', maxRounds: 2.7 }).valid, false);

      // Non-integer or non-positive minQuorum
      assert.equal(validateConfig({ topic: 'Valid', minQuorum: 0 }).valid, false);
      assert.equal(validateConfig({ topic: 'Valid', minQuorum: 1.5 }).valid, false);

      // Negative retries or clarification batches
      assert.equal(validateConfig({ topic: 'Valid', maxRetriesPerSeat: -1 }).valid, false);
      assert.equal(validateConfig({ topic: 'Valid', maxClarificationBatches: -2 }).valid, false);

      // Seat count below minQuorum
      const belowQuorum = validateConfig({
        topic: 'Valid',
        maxRounds: 3,
        minQuorum: 3,
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 's' },
          { id: 's2', harness: 'mock', model: 'm', soul: 's' }
        ]
      });
      assert.equal(belowQuorum.valid, false);
      assert.ok(belowQuorum.errors.some((e) => /below minQuorum/.test(e)));

      // Duplicate seat IDs
      const duplicateSeats = validateConfig({
        topic: 'Valid',
        maxRounds: 3,
        minQuorum: 2,
        seats: [
          { id: 'dup-id', harness: 'mock', model: 'm', soul: 's' },
          { id: 'dup-id', harness: 'mock', model: 'm', soul: 's' }
        ]
      });
      assert.equal(duplicateSeats.valid, false);
      assert.ok(duplicateSeats.errors.some((e) => /Duplicate seat ID/.test(e)));

      // Invalid seat structure missing fields
      const missingFields = validateConfig({
        topic: 'Valid',
        maxRounds: 3,
        minQuorum: 2,
        seats: [
          { id: '', harness: 'mock', model: 'm', soul: 's' },
          { id: 's2', harness: '', model: '', soul: '' }
        ]
      });
      assert.equal(missingFields.valid, false);
      assert.ok(missingFields.errors.length >= 3);

      // resolveConfig merges and freezes valid configuration
      const resolved = resolveConfig({ topic: 'Resolved Topic', minQuorum: 2 });
      assert.equal(resolved.topic, 'Resolved Topic');
      assert.ok(Object.isFrozen(resolved), 'Resolved config must be Object.freeze-d');
      assert.ok(Array.isArray(resolved.seats));

      // loadConfigFile throws on missing file
      assert.throws(
        () => loadConfigFile('/tmp/nonexistent-file-404.json'),
        /Configuration file not found/
      );
    });

    it('1.8 should execute discovery clarification batches and respect abort signal during discovery', async () => {
      const controller = new AbortController();
      const engine = new CouncilEngine({
        topic: 'Clarification Discovery Test',
        minQuorum: 2,
        clarifications: [
          { answer: 'First clarification item' },
          'Second string clarification item'
        ]
      }, { signal: controller.signal });

      engine.initRoster();
      await engine.runDiscovery(engine.config.clarifications);

      assert.equal(engine.state.clarifications.length, 2);
      assert.equal(engine.state.clarifications[0].answer, 'First clarification item');
      assert.equal(engine.state.clarifications[1].answer, 'Second string clarification item');

      // Abort during discovery stops further clarification processing
      controller.abort();
      await engine.runDiscovery(['Third item should not be processed']);
      assert.equal(engine.state.clarifications.length, 2, 'No further clarifications added after abort');
    });

    it('1.9 should enforce bounded seat retries and terminal excusal during proof collection', async () => {
      const mockAdapter = new MockAdapter();
      let proofAttempts = 0;

      mockAdapter.executeSeatProof = async ({ seat }) => {
        if (seat.id === 'seat-faulty') {
          proofAttempts++;
          throw new Error(`Quota exhaustion fault attempt ${proofAttempts}`);
        }
        return {
          id: 'P1',
          scope: 'Valid Scope',
          kind: 'check',
          source: 'https://council.test',
          statement: 'Valid statement'
        };
      };

      const engine = new CouncilEngine({
        topic: 'Seat Fault Bounded Retry',
        maxRetriesPerSeat: 1,
        minQuorum: 2,
        seats: [
          { id: 'seat-healthy-1', harness: 'mock', model: 'm', soul: 's' },
          { id: 'seat-healthy-2', harness: 'mock', model: 'm', soul: 's' },
          { id: 'seat-faulty', harness: 'mock', model: 'm', soul: 's' }
        ]
      }, { harnessResolver: () => mockAdapter });

      const faultEvents = [];
      const excusedEvents = [];

      engine.getTelemetry().on('seat_fault', (d) => faultEvents.push(d));
      engine.getTelemetry().on('seat_excused', (d) => excusedEvents.push(d));

      const result = await engine.run();

      // Bounded retry behavior: 1st failure retried, 2nd failure excusal
      assert.equal(faultEvents.length, 2, 'Exactly 2 seat_fault events emitted');
      assert.equal(excusedEvents.length, 1, 'Exactly 1 seat_excused event emitted');
      assert.equal(excusedEvents[0].seatId, 'seat-faulty');

      // Seat status in state is permanently excused
      const faultySeat = engine.state.seats.find((s) => s.id === 'seat-faulty');
      assert.equal(faultySeat.status, 'excused');

      // Deliberation continues with remaining 2 healthy seats meeting minQuorum 2
      assert.equal(result.ok, true);
      assert.equal(result.verdict.kind, 'Unanimous Consensus');
      assert.equal(result.verdict.activeSeatCount, 2);
      assert.equal(result.verdict.excusedSeatCount, 1);
    });
  });

  // ==========================================================================
  // SUITE 2: TELEMETRY EMITTER & SNAPSHOT STORE HARDENING
  // ==========================================================================
  describe('Suite 2: Telemetry Emitter & Snapshot Store Hardening', () => {

    it('2.1 should isolate synchronous exceptions thrown in seat_telemetry observers', () => {
      const emitter = createTelemetryEmitter();
      const errorEvents = [];
      let subsequentListenerExecuted = false;

      // Listener 1 throws Error
      emitter.on('seat_telemetry', () => {
        throw new Error('Hostile UI observer crash!');
      });

      // Listener 2 should still be invoked or emitter should not crash
      emitter.on('seat_telemetry', () => {
        subsequentListenerExecuted = true;
      });

      emitter.on('error', (errData) => {
        errorEvents.push(errData);
      });

      // Emission should not throw out to publisher
      assert.doesNotThrow(() => {
        emitter.emitSeatTelemetry('seat-tester', 'thinking');
      });

      assert.equal(errorEvents.length, 1, 'Error event should capture throwing observer');
      assert.equal(errorEvents[0].eventName, 'seat_telemetry');
      assert.match(errorEvents[0].error, /Hostile UI observer crash!/);
    });

    it('2.2 should handle observers throwing non-Error primitives (string, number, null)', () => {
      const emitter = createTelemetryEmitter();
      const capturedErrors = [];

      emitter.on('seat_telemetry', () => {
        throw 'A bare string exception';
      });

      emitter.on('error', (err) => {
        capturedErrors.push(err);
      });

      assert.doesNotThrow(() => {
        emitter.emitSeatTelemetry('seat-primitive', 'accepted');
      });

      assert.equal(capturedErrors.length, 1);
      assert.equal(capturedErrors[0].error, 'A bare string exception');
    });

    it('2.3 should preserve snapshot deep immutability against outside post-creation mutation', () => {
      const state = createInitialCouncilState({
        topic: 'Immutability Topic',
        seats: [
          { id: 'seat-immutable', harness: 'mock', model: 'm', soul: 's' }
        ]
      });

      const event = { type: 'SUBMIT_PROOF', id: 'P1', seatId: 'seat-immutable' };
      const snapshot = createSnapshot(event, state, { sequence: 42 });

      assert.ok(Object.isFrozen(snapshot), 'Snapshot must be top-level frozen');
      assert.ok(Object.isFrozen(snapshot.event), 'Snapshot event must be frozen');
      assert.ok(Object.isFrozen(snapshot.metrics), 'Snapshot metrics must be frozen');

      // Attempt mutating state after snapshot creation
      state.seats[0].status = 'excused';
      state.round = 99;

      // Verify snapshot retained original values
      assert.equal(snapshot.stateSnapshot.seats[0].status, 'idle');
      assert.equal(snapshot.stateSnapshot.round, 0);
      assert.equal(snapshot.sequence, 42);
      assert.equal(snapshot.id, 'snap-42-SUBMIT_PROOF');
    });

    it('2.4 should enforce serialization round-trip and validation in deserializeSnapshot', () => {
      const state = createInitialCouncilState();
      const snapshot = createSnapshot({ type: 'BEGIN_ROUND' }, state, { sequence: 1 });

      const jsonStr = serializeSnapshot(snapshot, true);
      const deserialized = deserializeSnapshot(jsonStr);

      assert.equal(deserialized.id, snapshot.id);
      assert.equal(deserialized.sequence, snapshot.sequence);
      assert.equal(deserialized.event.type, 'BEGIN_ROUND');

      // Rejection of invalid snapshot structures
      assert.throws(
        () => deserializeSnapshot('invalid-json-string{'),
        /JSON/
      );

      assert.throws(
        () => deserializeSnapshot(JSON.stringify({ id: 'snap-1' })),
        /Invalid snapshot structure: missing required snapshot fields\./
      );

      assert.throws(
        () => deserializeSnapshot(JSON.stringify({ id: 'snap-1', event: { type: 'EV' } })),
        /Invalid snapshot structure: missing required snapshot fields\./
      );
    });

    it('2.5 should enforce monotonic sequences and FIFO buffer trimming in SnapshotRecorder under burst', () => {
      const maxSnapshots = 25;
      const recorder = createSnapshotRecorder({ maxSnapshots });
      const state = createInitialCouncilState();

      // Record 100 transitions
      for (let i = 0; i < 100; i++) {
        recorder.record({ type: 'EVENT_' + i }, state);
      }

      const snapshots = recorder.getSnapshots();
      assert.equal(snapshots.length, maxSnapshots, 'Snapshots buffer must clamp to maxSnapshots');

      // Verify sequence monotonicity: sequence continues incrementing even after eviction
      for (let j = 1; j < snapshots.length; j++) {
        assert.equal(
          snapshots[j].sequence,
          snapshots[j - 1].sequence + 1,
          'Sequence numbers must be strictly contiguous'
        );
      }

      // Oldest retained snapshot should be seq 75, latest seq 99
      assert.equal(snapshots[0].sequence, 75);
      assert.equal(snapshots[snapshots.length - 1].sequence, 99);

      // Recorder clear resets state and internal sequence
      recorder.clear();
      assert.equal(recorder.getSnapshots().length, 0);
      assert.equal(recorder._sequence, 0);
    });

    it('2.6 should strictly validate inputs on emitSeatTelemetry and emitStateTransition', () => {
      const emitter = createTelemetryEmitter();

      // Invalid seatId
      assert.throws(() => emitter.emitSeatTelemetry('', 'thinking'), /seatId/);
      assert.throws(() => emitter.emitSeatTelemetry(null, 'thinking'), /seatId/);

      // Invalid status
      assert.throws(() => emitter.emitSeatTelemetry('seat-1', ''), /status/);
      assert.throws(() => emitter.emitSeatTelemetry('seat-1', null), /status/);

      // Invalid event on emitStateTransition
      assert.throws(() => emitter.emitStateTransition(null, {}), /event with a valid "type"/);
      assert.throws(() => emitter.emitStateTransition({}, {}), /event with a valid "type"/);

      // Invalid state on emitStateTransition
      assert.throws(
        () => emitter.emitStateTransition({ type: 'TEST' }, null),
        /valid CouncilState object/
      );
    });

    it('2.7 should support getTelemetryHistory with seat filtering and clear() reset', () => {
      const emitter = createTelemetryEmitter();
      emitter.emitSeatTelemetry('seat-A', 'thinking');
      emitter.emitSeatTelemetry('seat-B', 'thinking');
      emitter.emitSeatTelemetry('seat-A', 'accepted');

      const all = emitter.getTelemetryHistory();
      assert.equal(all.length, 3);

      const filteredA = emitter.getTelemetryHistory('seat-A');
      assert.equal(filteredA.length, 2);
      assert.equal(filteredA[0].status, 'thinking');
      assert.equal(filteredA[1].status, 'accepted');

      const filteredB = emitter.getTelemetryHistory('seat-B');
      assert.equal(filteredB.length, 1);

      const filteredC = emitter.getTelemetryHistory('seat-nonexistent');
      assert.equal(filteredC.length, 0);

      // Clear resets history
      emitter.clear();
      assert.equal(emitter.getTelemetryHistory().length, 0);
    });

    it('2.8 should function without recording snapshots when recordSnapshots is false', () => {
      const emitter = createTelemetryEmitter({ recordSnapshots: false });
      assert.equal(emitter.recorder, null);

      const state = createInitialCouncilState();
      const snap = emitter.emitStateTransition({ type: 'BEGIN_ROUND' }, state);

      assert.equal(snap.event.type, 'BEGIN_ROUND');
      assert.equal(emitter.getSnapshots().length, 0, 'No snapshots retained when recordSnapshots is false');
    });
  });

  // ==========================================================================
  // SUITE 3: CLI RUNNER, ARGUMENTS, BINARY & INSPECT COMMAND HARDENING
  // ==========================================================================
  describe('Suite 3: CLI Runner, Arguments & Inspect Command Hardening', () => {

    it('3.1 should inspect direct snapshot array and single snapshot file cleanly', async () => {
      const state = createInitialCouncilState();
      const snap1 = createSnapshot({ type: 'TEST_INIT' }, state, { sequence: 10 });
      const snap2 = createSnapshot({ type: 'TEST_ROUND' }, state, { sequence: 11 });

      const tmpTrajFile = path.join(os.tmpdir(), `traj-test-${Date.now()}.json`);
      const tmpSnapFile = path.join(os.tmpdir(), `snap-test-${Date.now()}.json`);

      fs.writeFileSync(tmpTrajFile, JSON.stringify([snap1, snap2]));
      fs.writeFileSync(tmpSnapFile, JSON.stringify(snap1));

      try {
        // Inspect trajectory array
        const mockIO1 = createMockIO();
        const code1 = await runCli(['inspect', tmpTrajFile], mockIO1.io);
        assert.equal(code1, 0);
        assert.match(mockIO1.getStdout(), /Trajectory contains 2 snapshots/);
        assert.match(mockIO1.getStdout(), /\[10\] TEST_INIT/);
        assert.match(mockIO1.getStdout(), /\[11\] TEST_ROUND/);

        // Inspect single snapshot
        const mockIO2 = createMockIO();
        const code2 = await runCli(['inspect', tmpSnapFile], mockIO2.io);
        assert.equal(code2, 0);
        assert.match(mockIO2.getStdout(), /Snapshot ID: snap-10-TEST_INIT/);
        assert.match(mockIO2.getStdout(), /Event: TEST_INIT/);
      } finally {
        if (fs.existsSync(tmpTrajFile)) fs.unlinkSync(tmpTrajFile);
        if (fs.existsSync(tmpSnapFile)) fs.unlinkSync(tmpSnapFile);
      }
    });

    it('3.2 should inspect nested { snapshots: [...] } from "council run --json" cleanly', async () => {
      // Vector: User pipes `council run --json > output.json` and then executes `council inspect output.json`.
      // council run --json outputs { ok: true, verdict: {...}, state: {...}, snapshots: [...] }
      const mockRunIO = createMockIO();
      await runCli(['run', '--mock', '--json'], mockRunIO.io);

      const runOutput = mockRunIO.getStdout();
      const parsedRun = JSON.parse(runOutput);
      assert.ok(Array.isArray(parsedRun.snapshots), 'Output contains nested snapshots array');

      const tmpRunJson = path.join(os.tmpdir(), `council-run-out-${Date.now()}.json`);
      fs.writeFileSync(tmpRunJson, runOutput);

      try {
        const mockInspectIO = createMockIO();
        const code = await runCli(['inspect', tmpRunJson], mockInspectIO.io);

        assert.equal(code, 0, 'Inspect exits with code 0 on nested snapshots');
        assert.match(
          mockInspectIO.getStdout(),
          new RegExp(`Trajectory contains ${parsedRun.snapshots.length} snapshots:`)
        );
      } finally {
        if (fs.existsSync(tmpRunJson)) fs.unlinkSync(tmpRunJson);
      }
    });

    it('3.3 should exit with code 1 and descriptive error when inspect file is missing or invalid', async () => {
      // Missing file argument
      const mockIO1 = createMockIO();
      const code1 = await runCli(['inspect'], mockIO1.io);
      assert.equal(code1, 1);
      assert.match(mockIO1.getStderr(), /requires a path/);

      // Non-existent file path
      const mockIO2 = createMockIO();
      const code2 = await runCli(['inspect', '/path/does/not/exist/snap.json'], mockIO2.io);
      assert.equal(code2, 1);
      assert.match(mockIO2.getStderr(), /Snapshot file not found/);
    });

    it('3.4 should exit with code 1 on unknown flags, unknown commands, and unknown demo IDs', async () => {
      // Unknown flag
      const mockIO1 = createMockIO();
      const code1 = await runCli(['run', '--unrecognized-flag'], mockIO1.io);
      assert.equal(code1, 1);
      assert.match(mockIO1.getStderr(), /CLI argument error/);

      // Unknown command
      const mockIO2 = createMockIO();
      const code2 = await runCli(['bogus-command'], mockIO2.io);
      assert.equal(code2, 1);
      assert.match(mockIO2.getStderr(), /Unknown command "bogus-command"/);

      // Unknown demo ID
      const mockIO3 = createMockIO();
      const code3 = await runCli(['demo', 'non-existent-demo'], mockIO3.io);
      assert.equal(code3, 1);
      assert.match(mockIO3.getStderr(), /Unknown demo walkthrough "non-existent-demo"/);
    });

    it('3.5 should verify CLI exit code behavior: code 0 for consensus and code 0 for demo walkthroughs', async () => {
      // Demo walkthroughs exit 0
      const mockDemoIO = createMockIO();
      const demoCode = await runCli(['demo', 'wt-opus-guardrails', '--json'], mockDemoIO.io);
      assert.equal(demoCode, 0, 'Demo command returns exit code 0');
      const parsedDemo = JSON.parse(mockDemoIO.getStdout());
      assert.equal(parsedDemo.id, 'wt-opus-guardrails');
      assert.match(parsedDemo.verdict.kind, /Dissent Report/);

      // council run consensus returns 0
      const mockRunIO = createMockIO();
      const runCode = await runCli(['run', '--mock', '--json'], mockRunIO.io);
      assert.equal(runCode, 0, 'Consensus run returns exit code 0');
    });

    it('3.6 should parse custom CLI flags (--topic, --rounds, --quorum, --mock)', async () => {
      const mockIO = createMockIO();
      const code = await runCli([
        'run',
        '--topic', 'Custom CLI Topic Flags',
        '--rounds', '2',
        '--quorum', '2',
        '--mock',
        '--json'
      ], mockIO.io);

      assert.equal(code, 0);
      const parsed = JSON.parse(mockIO.getStdout());
      assert.equal(parsed.state.topic, 'Custom CLI Topic Flags');
      assert.equal(parsed.state.maxRounds, 2);
      assert.equal(parsed.state.minQuorum, 2);
    });

    it('3.7 should handle inspect on malformed JSON file with descriptive error', async () => {
      const tmpFile = path.join(os.tmpdir(), `malformed-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, 'NOT_VALID_JSON_CONTENT{{{');

      try {
        const mockIO = createMockIO();
        let threw = false;
        try {
          await runCli(['inspect', tmpFile], mockIO.io);
        } catch (err) {
          threw = true;
          assert.match(err.message, /JSON/);
        }
        assert.ok(threw, 'Should throw or fail on malformed JSON');
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });
  });
});
