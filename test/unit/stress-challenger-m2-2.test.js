import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  CouncilTelemetryEmitter,
  createTelemetryEmitter,
  createSnapshot,
  serializeSnapshot,
  deserializeSnapshot,
  SnapshotRecorder,
  createSnapshotRecorder
} from '../../src/telemetry/index.js';

import {
  CouncilEngine,
  createCouncilEngine,
  validateConfig,
  resolveConfig,
  loadConfigFile
} from '../../src/engine/index.js';

import { runCli } from '../../src/cli/index.js';
import { createInitialCouncilState } from '../../src/machine/state.js';
import { MockAdapter } from '../../src/harness/mock.js';
import { QuotaExhaustionError, TimeoutError } from '../../src/harness/adapter.js';

describe('Adversarial Stress Test Suite — Challenger M2-2 (Telemetry, State Snapshots, Coordinator & CLI)', () => {

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
  // MISSION 1: TELEMETRY PUB/SUB & SNAPSHOT STRESS
  // ==========================================================================
  describe('Mission 1: Telemetry Pub/Sub & Deterministic Snapshots Stress', () => {

    it('handles high-frequency telemetry event bursts (10,000 events) and respects maxHistory FIFO limit', () => {
      const maxHistory = 150;
      const emitter = createTelemetryEmitter({ maxHistory });
      let receivedCount = 0;

      emitter.on('seat_telemetry', () => {
        receivedCount++;
      });

      const burstSize = 10000;
      for (let i = 0; i < burstSize; i++) {
        emitter.emitSeatTelemetry('seat-burst', 'thinking', { seq: i });
      }

      assert.equal(receivedCount, burstSize, 'All 10,000 emitted events should be received by listeners');
      const history = emitter.getTelemetryHistory();
      assert.equal(history.length, maxHistory, `History length should be capped at maxHistory (${maxHistory})`);

      // Verify FIFO ordering: oldest was evicted, newest retained
      assert.equal(history[history.length - 1].metadata.seq, burstSize - 1, 'Latest event should be seq 9999');
      assert.equal(history[0].metadata.seq, burstSize - maxHistory, `Oldest retained event should be seq ${burstSize - maxHistory}`);

      // Filtered history query
      const filtered = emitter.getTelemetryHistory('seat-burst');
      assert.equal(filtered.length, maxHistory);
      const emptyFiltered = emitter.getTelemetryHistory('unknown-seat');
      assert.equal(emptyFiltered.length, 0);
    });

    it('handles high-frequency state transition snapshot bursts (2,500 snapshots) with sequence monotonicity', () => {
      const maxSnapshots = 500;
      const emitter = createTelemetryEmitter({ recordSnapshots: true });
      emitter.recorder.maxSnapshots = maxSnapshots;
      const state = createInitialCouncilState();

      let transitionEventsReceived = 0;
      emitter.on('state_transition', () => {
        transitionEventsReceived++;
      });

      const burstSize = 2500;
      for (let i = 0; i < burstSize; i++) {
        emitter.emitStateTransition({ type: 'TRANSITION_STEP', index: i }, state);
      }

      assert.equal(transitionEventsReceived, burstSize);
      const snapshots = emitter.getSnapshots();
      assert.equal(snapshots.length, maxSnapshots, `Snapshots buffer should be clamped to maxSnapshots (${maxSnapshots})`);

      // Verify monotonic sequence numbering
      for (let i = 1; i < snapshots.length; i++) {
        assert.equal(snapshots[i].sequence, snapshots[i - 1].sequence + 1, 'Snapshot sequence numbers must be strictly monotonic');
      }
      assert.equal(snapshots[snapshots.length - 1].sequence, burstSize - 1);
      assert.equal(snapshots[0].sequence, burstSize - maxSnapshots);
    });

    it('safely handles observer listeners throwing Error objects without interrupting emitter', () => {
      const emitter = createTelemetryEmitter();
      const caughtErrors = [];

      emitter.on('error', (err) => {
        caughtErrors.push(err);
      });

      emitter.on('seat_telemetry', () => {
        throw new Error('Exploding observer UI widget');
      });

      assert.doesNotThrow(() => {
        emitter.emitSeatTelemetry('seat-err', 'thinking');
      });

      assert.equal(caughtErrors.length, 1);
      assert.equal(caughtErrors[0].eventName, 'seat_telemetry');
      assert.match(caughtErrors[0].error, /Exploding observer UI widget/);
    });

    it('safely handles observer listeners throwing non-Error primitives (string, number, null, object)', () => {
      const emitter = createTelemetryEmitter();
      const caughtErrors = [];

      emitter.on('error', (err) => {
        caughtErrors.push(err);
      });

      // Listener throwing primitive string
      emitter.on('seat_telemetry', () => {
        throw 'String error thrown';
      });

      assert.doesNotThrow(() => {
        emitter.emitSeatTelemetry('seat-prim', 'thinking');
      });
      assert.equal(caughtErrors.length, 1);
      assert.equal(caughtErrors[0].error, 'String error thrown');

      // Listener throwing primitive number
      emitter.removeAllListeners('seat_telemetry');
      emitter.on('seat_telemetry', () => {
        throw 404;
      });
      assert.doesNotThrow(() => {
        emitter.emitSeatTelemetry('seat-prim', 'accepted');
      });
      assert.equal(caughtErrors.length, 2);
      assert.equal(caughtErrors[1].error, '404');
    });

    it('safely handles observer listeners throwing on state_transition events', () => {
      const emitter = createTelemetryEmitter();
      const caughtErrors = [];
      emitter.on('error', (err) => caughtErrors.push(err));

      emitter.on('state_transition', () => {
        throw new Error('State transition observer crashed');
      });

      const state = createInitialCouncilState();
      assert.doesNotThrow(() => {
        emitter.emitStateTransition({ type: 'TEST_EVENT' }, state);
      });

      assert.equal(caughtErrors.length, 1);
      assert.equal(caughtErrors[0].eventName, 'state_transition');
      assert.match(caughtErrors[0].error, /State transition observer crashed/);
    });

    it('clears telemetry history and snapshot accumulator cleanly via clear()', () => {
      const emitter = createTelemetryEmitter();
      const state = createInitialCouncilState();

      emitter.emitSeatTelemetry('seat-1', 'thinking');
      emitter.emitSeatTelemetry('seat-2', 'accepted');
      emitter.emitStateTransition({ type: 'BEGIN_ROUND' }, state);

      assert.equal(emitter.getTelemetryHistory().length, 2);
      assert.equal(emitter.getSnapshots().length, 1);

      emitter.clear();

      assert.equal(emitter.getTelemetryHistory().length, 0);
      assert.equal(emitter.getSnapshots().length, 0);

      // Verify recording resets sequence
      emitter.emitStateTransition({ type: 'INIT' }, state);
      assert.equal(emitter.getSnapshots()[0].sequence, 0);
    });

    it('guarantees snapshot immutability against outside state mutations', () => {
      const state = createInitialCouncilState({
        topic: 'Original Topic',
        seats: [{ id: 's1', harness: 'mock', model: 'm', soul: 's' }]
      });
      const event = { type: 'BEGIN_ROUND', meta: { attempt: 1 } };

      const snapshot = createSnapshot(event, state, { sequence: 10 });

      // Mutate external state and event
      state.topic = 'CORRUPTED TOPIC';
      state.phase = 'completed';
      state.seats[0].status = 'excused';
      event.type = 'CORRUPTED_EVENT';
      event.meta.attempt = 999;

      // Verify snapshot remains pristine
      assert.equal(snapshot.id, 'snap-10-BEGIN_ROUND');
      assert.equal(snapshot.stateSnapshot.topic, 'Original Topic');
      assert.equal(snapshot.stateSnapshot.phase, 'preflight');
      assert.equal(snapshot.stateSnapshot.seats[0].status, 'idle');
      assert.equal(snapshot.event.type, 'BEGIN_ROUND');
      assert.equal(snapshot.event.meta.attempt, 1);

      // Verify frozen status
      assert.ok(Object.isFrozen(snapshot));
      assert.ok(Object.isFrozen(snapshot.event));
      assert.ok(Object.isFrozen(snapshot.stateSnapshot));
      assert.ok(Object.isFrozen(snapshot.metrics));
    });

    it('enforces strict input validation on emitSeatTelemetry and emitStateTransition', () => {
      const emitter = createTelemetryEmitter();

      // Empty / invalid seatId
      assert.throws(() => emitter.emitSeatTelemetry('', 'thinking'), /valid non-empty seatId/);
      assert.throws(() => emitter.emitSeatTelemetry(null, 'thinking'), /valid non-empty seatId/);
      assert.throws(() => emitter.emitSeatTelemetry(undefined, 'thinking'), /valid non-empty seatId/);
      assert.throws(() => emitter.emitSeatTelemetry(42, 'thinking'), /valid non-empty seatId/);

      // Empty / invalid status
      assert.throws(() => emitter.emitSeatTelemetry('s1', ''), /valid status/);
      assert.throws(() => emitter.emitSeatTelemetry('s1', null), /valid status/);
      assert.throws(() => emitter.emitSeatTelemetry('s1', undefined), /valid status/);

      // Invalid state transition arguments
      assert.throws(() => emitter.emitStateTransition(null, {}), /valid "type"/);
      assert.throws(() => emitter.emitStateTransition({ type: '' }, {}), /valid "type"/);
      assert.throws(() => emitter.emitStateTransition({ type: 'EVT' }, null), /valid CouncilState/);
      assert.throws(() => emitter.emitStateTransition({ type: 'EVT' }, 'not-state'), /valid CouncilState/);
    });
  });

  // ==========================================================================
  // MISSION 2: ENGINE COORDINATOR STRESS & FAULT RECOVERY
  // ==========================================================================
  describe('Mission 2: Council Engine Coordinator Stress & Boundary Scenarios', () => {

    it('orchestrates multi-round debate with objection in round 1 and consensus in round 2', async () => {
      const mock = new MockAdapter();

      // Round 1: seat 2 objects
      mock.scriptSeatResponse({
        seatId: 's2',
        round: 1,
        phase: 'VOTING',
        response: { vote: 'object', reason: 'Need benchmark derivation proof', proofId: 'P1' }
      });

      // Round 2: seat 2 accepts
      mock.scriptSeatResponse({
        seatId: 's2',
        round: 2,
        phase: 'VOTING',
        response: { vote: 'accept' }
      });

      const engine = new CouncilEngine({
        topic: 'Multi-round Consensus Test',
        minQuorum: 2,
        maxRounds: 3,
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 'Systems Purist' },
          { id: 's2', harness: 'mock', model: 'm', soul: 'Performance Benchmarker' }
        ]
      }, { harnessResolver: () => mock });

      const result = await engine.run();

      assert.equal(result.ok, true, 'Deliberation should achieve unanimous consensus');
      assert.equal(result.verdict.kind, 'Unanimous Consensus');
      assert.equal(result.state.round, 2, 'Deliberation should finish in round 2');
      assert.equal(result.verdict.activeSeatCount, 2);
      assert.equal(result.verdict.excusedSeatCount, 0);
      assert.ok(result.snapshots.length > 10, 'Should record all trajectory transitions across rounds');
    });

    it('terminates in Dissent Report (Round Limit Reached) when objections remain unresolved through maxRounds', async () => {
      const mock = new MockAdapter();

      // Seat 2 objects on every round
      mock.scriptSeatResponse({
        seatId: 's2',
        phase: 'VOTING',
        response: { vote: 'object', reason: 'Uncompromising formal verification flaw', proofId: 'P1' }
      });

      const engine = new CouncilEngine({
        topic: 'Max Rounds Dissent Test',
        minQuorum: 2,
        maxRounds: 3,
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 'Engineer' },
          { id: 's2', harness: 'mock', model: 'm', soul: 'Formal Verifier' }
        ]
      }, { harnessResolver: () => mock });

      const result = await engine.run();

      assert.equal(result.ok, false, 'Consensus must be forbidden when round limit is reached with open objections');
      assert.equal(result.verdict.kind, 'Dissent Report (Round Limit Reached)');
      assert.equal(result.state.round, 3);
      assert.equal(result.verdict.unresolvedObjections.length, 3, 'All 3 objections across rounds 1, 2, 3 must be preserved');
      assert.equal(result.verdict.unresolvedObjections[0].status, 'open');
      assert.equal(result.verdict.unresolvedObjections[0].round, 1);
      assert.equal(result.verdict.unresolvedObjections[1].round, 2);
      assert.equal(result.verdict.unresolvedObjections[2].round, 3);
      assert.equal(result.verdict.unresolvedObjections[0].seatId, 's2');
    });

    it('recovers from seat fault during proof collection with bounded retry and terminal excusal', async () => {
      const mock = new MockAdapter();

      // Grok seat faults on proof collection
      mock.injectSeatFault('grok-seat', {
        phase: 'DELIBERATION',
        round: 1,
        error: new QuotaExhaustionError('Weekly Premium pool exhausted (429)')
      });

      const engine = new CouncilEngine({
        topic: 'Proof Collection Fault Recovery',
        minQuorum: 2,
        maxRetriesPerSeat: 1, // 1 retry allowed
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 'Engineer' },
          { id: 's2', harness: 'mock', model: 'm', soul: 'Architect' },
          { id: 'grok-seat', harness: 'mock', model: 'm', soul: 'Challenger' }
        ]
      }, { harnessResolver: () => mock });

      const faultEvents = [];
      const excusedEvents = [];
      engine.telemetry.on('seat_fault', (f) => faultEvents.push(f));
      engine.telemetry.on('seat_excused', (e) => excusedEvents.push(e));

      const result = await engine.run();

      assert.equal(result.ok, true, 'Deliberation should succeed with remaining active seats');
      assert.equal(result.verdict.kind, 'Unanimous Consensus');
      assert.equal(result.verdict.activeSeatCount, 2);
      assert.equal(result.verdict.excusedSeatCount, 1);

      // Verify grok-seat was excused after retries
      const grokSeat = result.state.seats.find((s) => s.id === 'grok-seat');
      assert.equal(grokSeat.status, 'excused');
      assert.equal(grokSeat.retries, 1);
      assert.equal(faultEvents.length, 2, 'Should record initial fault + retry exhaustion fault');
      assert.equal(excusedEvents.length, 1, 'Should record exactly one seat excusal event');
    });

    it('recovers from seat fault during voting with terminal excusal and turn retention', async () => {
      const mock = new MockAdapter();

      // s3 faults during voting
      mock.injectSeatFault('s3', {
        phase: 'VOTING',
        round: 1,
        error: new QuotaExhaustionError('Quota expired during voting phase')
      });

      const engine = new CouncilEngine({
        topic: 'Voting Phase Fault Recovery',
        minQuorum: 2,
        maxRetriesPerSeat: 0, // Zero retries -> immediate excusal
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 'Purist' },
          { id: 's2', harness: 'mock', model: 'm', soul: 'Pragmatist' },
          { id: 's3', harness: 'mock', model: 'm', soul: 'Auditor' }
        ]
      }, { harnessResolver: () => mock });

      const result = await engine.run();

      assert.equal(result.ok, true);
      assert.equal(result.verdict.kind, 'Unanimous Consensus');
      assert.equal(result.verdict.activeSeatCount, 2);
      assert.equal(result.verdict.excusedSeatCount, 1);

      // s3 submitted proof during deliberation; verify proof was retained
      const s3Proof = result.state.proofs.find((p) => p.seatId === 's3');
      assert.ok(s3Proof, 'Excused seat completed proof turn must be retained');
    });

    it('preserves open objection when raising seat faults and is excused, strictly preventing false consensus', async () => {
      const mock = new MockAdapter();

      // Seat 2 objects in round 1
      mock.scriptSeatResponse({
        seatId: 's2',
        round: 1,
        phase: 'VOTING',
        response: { vote: 'object', reason: 'Security isolation sandbox breach', proofId: 'P1' }
      });

      // Seat 2 faults in round 2 and exhausts retries
      mock.injectSeatFault('s2', {
        phase: 'DELIBERATION',
        round: 2,
        error: new QuotaExhaustionError('Token quota depleted in round 2')
      });

      const engine = new CouncilEngine({
        topic: 'Preserved Excused Objection Security Test',
        minQuorum: 2,
        maxRounds: 3,
        maxRetriesPerSeat: 0,
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 'Speed Advocate' },
          { id: 's2', harness: 'mock', model: 'm', soul: 'Security Purist' },
          { id: 's3', harness: 'mock', model: 'm', soul: 'Platform Architect' }
        ]
      }, { harnessResolver: () => mock });

      const result = await engine.run();

      assert.equal(result.ok, false, 'Unanimous consensus must be BLOCKED by preserved excused objection');
      assert.equal(result.verdict.kind, 'Dissent Report (Preserved Excused-Seat Objection)');
      assert.equal(result.verdict.activeSeatCount, 2);
      assert.equal(result.verdict.excusedSeatCount, 1);

      assert.equal(result.verdict.unresolvedObjections.length, 1);
      const preservedObj = result.verdict.unresolvedObjections[0];
      assert.equal(preservedObj.seatId, 's2');
      assert.equal(preservedObj.status, 'preserved_excused', 'Status must be locked to preserved_excused');
    });

    it('terminates immediately in Dissent Report (Below Quorum) when cascading faults drop active seats below minQuorum', async () => {
      const mock = new MockAdapter();

      // 4 seats configured, minQuorum is 3. Excusing 2 seats drops active seats to 2 (< 3).
      mock.injectSeatFault('seat-3', { error: new QuotaExhaustionError('seat-3 offline') });
      mock.injectSeatFault('seat-4', { error: new QuotaExhaustionError('seat-4 offline') });

      const engine = new CouncilEngine({
        topic: 'Cascading Quorum Drop Failure',
        minQuorum: 3,
        maxRetriesPerSeat: 0,
        seats: [
          { id: 'seat-1', harness: 'mock', model: 'm', soul: 'Soul 1' },
          { id: 'seat-2', harness: 'mock', model: 'm', soul: 'Soul 2' },
          { id: 'seat-3', harness: 'mock', model: 'm', soul: 'Soul 3' },
          { id: 'seat-4', harness: 'mock', model: 'm', soul: 'Soul 4' }
        ]
      }, { harnessResolver: () => mock });

      const result = await engine.run();

      assert.equal(result.ok, false, 'Consensus must be forbidden when active seats fall below quorum');
      assert.equal(result.verdict.kind, 'Dissent Report (Below Quorum)');
      assert.equal(result.verdict.activeSeatCount, 2);
      assert.equal(result.verdict.excusedSeatCount, 2);
      assert.equal(result.state.phase, 'completed');
    });

    it('respects AbortSignal before debate execution begins', async () => {
      const controller = new AbortController();

      const engine = new CouncilEngine({
        topic: 'Immediate Abort',
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 's' },
          { id: 's2', harness: 'mock', model: 'm', soul: 's' }
        ]
      }, { signal: controller.signal });

      controller.abort();
      const result = await engine.run();
      assert.equal(engine.aborted, true);
      assert.equal(result.ok, false);
      assert.equal(result.verdict, null);
      assert.equal(result.state.round, 0);
    });

    it('halts debate loop cleanly when AbortSignal fires mid-deliberation', async () => {
      const controller = new AbortController();
      const mock = new MockAdapter();

      const engine = new CouncilEngine({
        topic: 'Mid-Deliberation Abort',
        minQuorum: 2,
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 's1' },
          { id: 's2', harness: 'mock', model: 'm', soul: 's2' }
        ]
      }, { harnessResolver: () => mock, signal: controller.signal });

      engine.telemetry.on('proof_submitted', () => {
        controller.abort();
      });

      const result = await engine.run();
      assert.equal(engine.aborted, true);
      assert.equal(result.ok, false);
      assert.equal(engine.isCompleted(), false);
    });
  });

  // ==========================================================================
  // MISSION 3: CLI ARGUMENT, DEMO & INSPECT STRESS
  // ==========================================================================
  describe('Mission 3: Council CLI Robustness, Demo Execution & Inspect Verification', () => {

    it('displays full help text for --help and -h flags with exit code 0', async () => {
      const ioHelp = createMockIO();
      const code1 = await runCli(['--help'], ioHelp.io);
      assert.equal(code1, 0);
      assert.match(ioHelp.getStdout(), /The Council — Multi-Agent Consensus Deliberation Engine/);
      assert.match(ioHelp.getStdout(), /Usage:/);
      assert.match(ioHelp.getStdout(), /council run/);
      assert.match(ioHelp.getStdout(), /council demo/);
      assert.match(ioHelp.getStdout(), /council inspect/);

      const ioShort = createMockIO();
      const code2 = await runCli(['-h'], ioShort.io);
      assert.equal(code2, 0);
      assert.match(ioShort.getStdout(), /The Council/);
    });

    it('displays version for --version and -V flags with exit code 0', async () => {
      const io1 = createMockIO();
      const code1 = await runCli(['--version'], io1.io);
      assert.equal(code1, 0);
      assert.match(io1.getStdout(), /the-council v0\.1\.0/);

      const io2 = createMockIO();
      const code2 = await runCli(['-V'], io2.io);
      assert.equal(code2, 0);
      assert.match(io2.getStdout(), /the-council v0\.1\.0/);
    });

    it('rejects invalid arguments and flags with exit code 1', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--nonexistent-flag'], mockIO.io);

      assert.equal(code, 1);
      assert.match(mockIO.getStderr(), /CLI argument error/);
    });

    it('rejects unknown command with exit code 1', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['invalid-subcommand'], mockIO.io);

      assert.equal(code, 1);
      assert.match(mockIO.getStderr(), /Unknown command "invalid-subcommand"/);
    });

    it('runs deliberation with custom options via CLI flags', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--topic', 'CLI Integration Stress Test', '--rounds', '2', '--quorum', '2'], mockIO.io);

      assert.equal(code, 0);
      assert.match(mockIO.getStdout(), /THE COUNCIL — VERDICT/);
      assert.match(mockIO.getStdout(), /Topic\s+: CLI Integration Stress Test/);
      assert.match(mockIO.getStdout(), /Verdict\s+: Unanimous Consensus/);
    });

    it('executes demo walkthrough wt-better-os cleanly with exit code 0', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['demo', 'wt-better-os'], mockIO.io);

      assert.equal(code, 0);
      assert.match(mockIO.getStdout(), /Running Demo Walkthrough: Walkthrough 1/);
      assert.match(mockIO.getStdout(), /Unanimous Consensus/);
      assert.match(mockIO.getStdout(), /All 4 active Seats accepted/);
    });

    it('executes demo walkthrough wt-10-seats-quota cleanly with exit code 0', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['demo', 'wt-10-seats-quota'], mockIO.io);

      assert.equal(code, 0);
      assert.match(mockIO.getStdout(), /Running Demo Walkthrough: Walkthrough 2/);
      assert.match(mockIO.getStdout(), /Unanimous Consensus/);
      assert.match(mockIO.getStdout(), /All 9 active Seats accepted/);
    });

    it('executes demo walkthrough wt-opus-guardrails cleanly with exit code 0', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['demo', 'wt-opus-guardrails'], mockIO.io);

      assert.equal(code, 0);
      assert.match(mockIO.getStdout(), /Running Demo Walkthrough: Walkthrough 3/);
      assert.match(mockIO.getStdout(), /Dissent Report \(Preserved Excused-Seat Objection\)/);
    });

    it('executes demo with --json flag and emits valid JSON with snapshots', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['demo', 'wt-10-seats-quota', '--json'], mockIO.io);

      assert.equal(code, 0);
      const parsed = JSON.parse(mockIO.getStdout());
      assert.equal(parsed.id, 'wt-10-seats-quota');
      assert.equal(parsed.verdict.kind, 'Unanimous Consensus');
      assert.ok(Array.isArray(parsed.snapshots));
      assert.ok(parsed.snapshots.length >= 10);
    });

    it('fails demo command when unknown demo ID is provided', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['demo', 'nonexistent-walkthrough'], mockIO.io);

      assert.equal(code, 1);
      assert.match(mockIO.getStderr(), /Unknown demo walkthrough "nonexistent-walkthrough"/);
    });

    it('inspects valid single snapshot file and logs details', () => {
      const state = createInitialCouncilState();
      const snap = createSnapshot({ type: 'BEGIN_ROUND' }, state, { sequence: 7 });

      const tmpFile = path.join(os.tmpdir(), `cli-snap-test-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify(snap, null, 2));

      try {
        const mockIO = createMockIO();
        runCli(['inspect', tmpFile], mockIO.io);
        assert.match(mockIO.getStdout(), /Snapshot ID: snap-7-BEGIN_ROUND/);
        assert.match(mockIO.getStdout(), /Event: BEGIN_ROUND/);
        assert.match(mockIO.getStdout(), /Phase: preflight/);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('inspects valid trajectory snapshots array file and logs summary', () => {
      const state = createInitialCouncilState();
      const s1 = createSnapshot({ type: 'INIT' }, state, { sequence: 0 });
      const s2 = createSnapshot({ type: 'BEGIN_ROUND' }, state, { sequence: 1 });
      const s3 = createSnapshot({ type: 'START_JUDGING' }, state, { sequence: 2 });

      const tmpFile = path.join(os.tmpdir(), `cli-traj-test-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify([s1, s2, s3], null, 2));

      try {
        const mockIO = createMockIO();
        runCli(['inspect', tmpFile], mockIO.io);
        assert.match(mockIO.getStdout(), /Trajectory contains 3 snapshots/);
        assert.match(mockIO.getStdout(), /\[0\] INIT/);
        assert.match(mockIO.getStdout(), /\[1\] BEGIN_ROUND/);
        assert.match(mockIO.getStdout(), /\[2\] START_JUDGING/);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('inspect errors cleanly when file is missing or non-existent', async () => {
      const ioMissing = createMockIO();
      const code1 = await runCli(['inspect'], ioMissing.io);
      assert.equal(code1, 1);
      assert.match(ioMissing.getStderr(), /requires a path to a snapshot JSON file/);

      const ioNonExistent = createMockIO();
      const code2 = await runCli(['inspect', '/path/to/missing/snapshot.json'], ioNonExistent.io);
      assert.equal(code2, 1);
      assert.match(ioNonExistent.getStderr(), /Snapshot file not found/);
    });
  });
});
