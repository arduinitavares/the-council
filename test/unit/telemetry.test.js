import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createSnapshot,
  serializeSnapshot,
  deserializeSnapshot,
  SnapshotRecorder,
  createSnapshotRecorder,
  CouncilTelemetryEmitter,
  createTelemetryEmitter,
  canonicalizeModelKey,
  buildRunTelemetryRecord,
  aggregateTelemetryWindow,
  persistRunTelemetry,
  loadTelemetrySummary,
  formatTelemetryTable
} from '../../src/telemetry/index.js';
import { createInitialCouncilState } from '../../src/machine/state.js';
import { transitionCouncil as reduceCouncilState } from '../../src/machine/reducer.js';

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

    it('isolates sibling listeners when an earlier listener throws and preserves prependListener and once semantics (Issue #36)', () => {
      const emitter = createTelemetryEmitter({ clock: fixedClock });
      const callOrder = [];
      const errors = [];

      emitter.on('error', (err) => {
        errors.push(err);
      });

      emitter.on('round_start', () => {
        callOrder.push('first-on-throws');
        throw new Error('first listener failed');
      });

      emitter.once('round_start', () => {
        callOrder.push('once-throws');
        // Reentrant emission inside throwing once listener must not re-fire this once listener
        emitter.emitRoundStart(99, ['s1']);
        throw new Error('once listener failed');
      });

      emitter.on('round_start', (payload) => {
        callOrder.push(`second-on:${payload.round}`);
      });

      emitter.prependListener('round_start', (payload) => {
        callOrder.push(`prepended:${payload.round}`);
      });

      emitter.emitRoundStart(1, ['s1', 's2']);
      emitter.emitRoundStart(2, ['s1', 's2']);

      // First emission (round 1):
      // 1. prepended:1
      // 2. first-on-throws (throws -> error 1)
      // 3. once-throws -> reentrant emitRoundStart(99):
      //    - prepended:99
      //    - first-on-throws (throws -> error 2)
      //    - second-on:99 (once-throws is already removed!)
      //    then once-throws throws -> error 3
      // 4. second-on:1
      // Second emission (round 2):
      // 1. prepended:2
      // 2. first-on-throws (throws -> error 4)
      // 3. second-on:2 (once-throws does not fire again)
      assert.deepEqual(callOrder, [
        'prepended:1',
        'first-on-throws',
        'once-throws',
        'prepended:99',
        'first-on-throws',
        'second-on:99',
        'second-on:1',
        'prepended:2',
        'first-on-throws',
        'second-on:2'
      ]);
      assert.equal(errors.length, 4);
      assert.equal(errors[0].eventName, 'round_start');
      assert.equal(errors[0].error, 'first listener failed');
      assert.equal(errors[2].error, 'once listener failed');
    });

    it('isolates throwing error listeners without recursion or unhandled error crashes when default error listener is removed (Issue #36)', () => {
      const emitter = createTelemetryEmitter({ clock: fixedClock });
      emitter.removeAllListeners('error');

      // With zero 'error' listeners, a throwing event listener must still not throw
      emitter.on('verdict', () => {
        throw new Error('unhandled observer failure');
      });
      assert.doesNotThrow(() => {
        emitter.emitVerdict({ kind: 'Unanimous Consensus' });
      });

      // With multiple 'error' listeners where the first throws, subsequent 'error' listeners still run without recursion
      const receivedErrors = [];
      emitter.on('error', () => {
        throw new Error('broken error listener');
      });
      emitter.on('error', (errPayload) => {
        receivedErrors.push(errPayload);
      });

      assert.doesNotThrow(() => {
        emitter.emitVerdict({ kind: 'Unanimous Consensus' });
      });
      assert.equal(receivedErrors.length, 1);
      assert.equal(receivedErrors[0].eventName, 'verdict');
      assert.equal(receivedErrors[0].error, 'unhandled observer failure');
    });

    it('exposes emitGuardRejected with observer isolation (Issue #36)', () => {
      const emitter = createTelemetryEmitter({ clock: fixedClock });
      const received = [];
      const errors = [];

      emitter.on('error', (e) => errors.push(e));
      emitter.on('guard_rejected', () => {
        throw new Error('guard observer crashed');
      });
      emitter.on('guard_rejected', (payload) => {
        received.push(payload);
      });

      const state = createInitialCouncilState();
      assert.doesNotThrow(() => {
        emitter.emitGuardRejected({
          event: { type: 'CAST_VOTE' },
          message: 'Guard rejected CAST_VOTE',
          state
        });
      });

      assert.equal(received.length, 1);
      assert.equal(received[0].event.type, 'CAST_VOTE');
      assert.equal(received[0].message, 'Guard rejected CAST_VOTE');
      assert.equal(received[0].state, state);
      assert.equal(received[0].timestamp, '2026-11-07T00:00:00.000Z');
      assert.equal(errors.length, 1);
      assert.equal(errors[0].eventName, 'guard_rejected');
    });

    it('bounds providerCalls history to maxHistory while emitting every provider_call event (Issue #36)', () => {
      const emitter = createTelemetryEmitter({ clock: fixedClock, maxHistory: 3 });
      const emittedIds = [];

      emitter.on('provider_call', (rec) => {
        emittedIds.push(rec.callIndex);
      });

      for (let i = 1; i <= 5; i++) {
        emitter.emitProviderCall({
          participantId: i % 2 === 0 ? 'seat-even' : 'seat-odd',
          provider: 'codex',
          callIndex: i,
          exitCode: 0,
          durationMs: 10 * i
        });
      }

      assert.deepEqual(emittedIds, [1, 2, 3, 4, 5]);
      const allCalls = emitter.getProviderCalls();
      assert.equal(allCalls.length, 3);
      assert.deepEqual(
        allCalls.map((c) => c.callIndex),
        [3, 4, 5]
      );
      assert.deepEqual(
        emitter.getProviderCalls('seat-odd').map((c) => c.callIndex),
        [3, 5]
      );
    });

    it('retains 0 history items when maxHistory: 0 while still emitting live events, and falls back to 500 for negative or non-integer values', () => {
      const zeroEmitter = createTelemetryEmitter({ clock: fixedClock, maxHistory: 0 });
      assert.equal(zeroEmitter.maxHistory, 0);

      const liveTelemetry = [];
      const liveProviderCalls = [];
      zeroEmitter.on('seat_telemetry', (t) => liveTelemetry.push(t));
      zeroEmitter.on('provider_call', (c) => liveProviderCalls.push(c));

      zeroEmitter.emitSeatTelemetry('seat-1', 'thinking');
      zeroEmitter.emitProviderCall({ participantId: 'seat-1', provider: 'codex', exitCode: 0, durationMs: 12 });

      assert.equal(liveTelemetry.length, 1);
      assert.equal(liveProviderCalls.length, 1);
      assert.equal(zeroEmitter.getTelemetryHistory().length, 0);
      assert.equal(zeroEmitter.getProviderCalls().length, 0);

      const negEmitter = createTelemetryEmitter({ maxHistory: -10 });
      assert.equal(negEmitter.maxHistory, 500);

      const strEmitter = createTelemetryEmitter({ maxHistory: 'not-a-number' });
      assert.equal(strEmitter.maxHistory, 500);

      const floatEmitter = createTelemetryEmitter({ maxHistory: 3.5 });
      assert.equal(floatEmitter.maxHistory, 500);
    });
  });

  describe('Issue #56: Proof Admission Kinds & Cross-Run Telemetry Ledger', () => {
    it('distinguishes explicitly_admitted, default_admitted, and judge_rejected in JUDGE_AUDIT_AND_SYNTHESIZE (status and boolean admitted)', () => {
      let state = createInitialCouncilState({
        topic: 'Admission Kind Test',
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'S1' },
          { id: 's2', harness: 'cursor', model: 'grok-4.7-xhigh', soul: 'S2' },
          { id: 's3', harness: 'antigravity', model: 'gemini-4-argon (high)', soul: 'S3' }
        ]
      });

      state = reduceCouncilState(state, { type: 'BEGIN_ROUND' });
      state = reduceCouncilState(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's1',
        id: 'P-1',
        kind: 'check',
        statement: 'Check 1',
        source: 'src/a.js:1',
        scope: 'unit'
      });
      state = reduceCouncilState(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's2',
        id: 'P-2',
        kind: 'citation',
        statement: 'Cite 2',
        source: 'docs/b.md:1',
        scope: 'doc'
      });
      state = reduceCouncilState(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's3',
        id: 'P-3',
        kind: 'benchmark',
        statement: 'Bench 3',
        source: 'bench/c.js:1',
        scope: 'perf'
      });

      state = reduceCouncilState(state, { type: 'START_JUDGING' });
      state = reduceCouncilState(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        proofDecisions: {
          'P-1': { admitted: true, note: 'Explicitly verified' },
          'P-3': { admitted: false, note: 'Unreproducible benchmark' }
          // P-2 omitted -> default_admitted
        },
        summary: 'Synthesized candidate',
        clauses: [{ id: 'C-1', context: 'All', conclusion: 'Use A and B', citedProofIds: ['P-1'] }]
      });

      assert.equal(state.lastTransition.ok, true);
      const p1 = state.proofs.find((p) => p.id === 'P-1');
      const p2 = state.proofs.find((p) => p.id === 'P-2');
      const p3 = state.proofs.find((p) => p.id === 'P-3');

      assert.equal(p1.status, 'admitted');
      assert.equal(p1.admissionKind, 'explicitly_admitted');
      assert.equal(p2.status, 'admitted');
      assert.equal(p2.admissionKind, 'default_admitted');
      assert.equal(p3.status, 'rejected');
      assert.equal(p3.admissionKind, 'judge_rejected');
    });

    it('canonicalizes model keys consistently across parenthesized and hyphenated effort syntax', () => {
      const k1 = canonicalizeModelKey('antigravity', 'gemini-4-argon-high');
      const k2 = canonicalizeModelKey('antigravity', 'gemini-4-argon (high)');
      assert.equal(k1.key, 'antigravity/gemini-4-argon (high)');
      assert.equal(k2.key, 'antigravity/gemini-4-argon (high)');

      const c1 = canonicalizeModelKey('antigravity', 'gemini-4-carbon-high');
      const c2 = canonicalizeModelKey('antigravity', 'gemini-4-carbon (high)');
      assert.equal(c1.key, 'antigravity/gemini-4-carbon (high)');
      assert.equal(c2.key, 'antigravity/gemini-4-carbon (high)');
      assert.equal(c1.model, 'gemini-4-carbon');
      assert.equal(c1.effort, 'high');

      const cLow = canonicalizeModelKey('antigravity', 'gemini-4-carbon-low');
      assert.equal(cLow.key, 'antigravity/gemini-4-carbon (low)');

      const k3 = canonicalizeModelKey('cursor', 'grok-4.7-xhigh');
      assert.equal(k3.key, 'cursor/grok-4.7 (xhigh)');
    });

    it('persists idempotent per-run telemetry records, separates guard-rejected proofs, preserves Trace N/A, and counts final clause citations strictly from terminal verdict', () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'council-telemetry-ledger-'));
      const outputDir = path.join(tmpRoot, 'runs');
      const telemetryDir = path.join(tmpRoot, 'telemetry');

      try {
        const state = {
          phase: 'completed',
          round: 1,
          topic: 'Telemetry Ledger Verification',
          judge: { id: 'judge-1', harness: 'codex', model: 'gpt-6-astra (max)', status: 'completed' },
          seats: [
            { id: 'astra-voter', harness: 'codex', model: 'gpt-6-astra (max)', status: 'accepted', retries: 0 },
            { id: 'grok-voter', harness: 'cursor', model: 'grok-4.7-xhigh', status: 'accepted', retries: 1 },
            { id: 'argon-voter', harness: 'antigravity', model: 'gemini-4-argon-high', status: 'excused', retries: 1 }
          ],
          proofs: [
            { id: 'P-1', seatId: 'astra-voter', status: 'admitted', admissionKind: 'explicitly_admitted' },
            { id: 'P-2', seatId: 'grok-voter', status: 'admitted', admissionKind: 'default_admitted' },
            { id: 'P-3', seatId: 'grok-voter', status: 'rejected', admissionKind: 'judge_rejected' }
          ],
          verdict: {
            kind: 'Unanimous Consensus',
            candidate: {
              summary: 'Final synthesis',
              clauses: [
                { id: 'C-1', context: 'When X', conclusion: 'Do Y', citedProofIds: ['P-1'] }
              ]
            }
          }
        };

        const guardRejectedEvents = [
          { event: { type: 'SUBMIT_PROOF', seatId: 'grok-voter' }, message: 'Empty source' }
        ];

        const providerCalls = [
          {
            participantId: 'astra-voter',
            provider: 'codex',
            exitCode: 0,
            durationMs: 120,
            trace: {
              traceCoverage: 'full',
              toolCalls: [{ kind: 'command_execution', name: 'rg' }, { kind: 'mcp_tool_call', name: 'codegraph:explore' }],
              skillsRead: [{ skill: 'ask-council', evidence: 'skill_instructions_read' }]
            }
          },
          {
            participantId: 'grok-voter',
            provider: 'cursor',
            exitCode: 0,
            durationMs: 95,
            trace: {
              traceCoverage: 'full',
              toolCalls: [{ kind: 'readToolCall', name: 'readToolCall' }],
              skillsRead: []
            }
          },
          {
            participantId: 'argon-voter',
            provider: 'antigravity',
            exitCode: 0,
            durationMs: 80,
            trace: {
              traceCoverage: 'unavailable',
              toolCalls: [],
              skillsRead: []
            }
          }
        ];

        // Persist twice with the same runId to prove idempotency
        persistRunTelemetry({
          runId: 'run-test-56',
          completedAt: '2026-11-09T00:00:00.000Z',
          now: '2026-11-09T01:00:00.000Z',
          state,
          providerCalls,
          guardRejectedEvents,
          outputDir,
          telemetryDir
        });
        const { record, summary } = persistRunTelemetry({
          runId: 'run-test-56',
          completedAt: '2026-11-09T00:00:00.000Z',
          now: '2026-11-09T01:00:00.000Z',
          state,
          providerCalls,
          guardRejectedEvents,
          outputDir,
          telemetryDir
        });

        assert.equal(record.schemaVersion, 1);
        assert.equal(summary.totalRuns, 1, 'Repeated persistence with same runId must be idempotent');

        // Verify files written on disk
        assert.ok(fs.existsSync(path.join(telemetryDir, 'runs', 'run-test-56.json')));
        assert.ok(fs.existsSync(path.join(outputDir, 'telemetry-summary.json')));
        assert.ok(fs.existsSync(path.join(outputDir, 'telemetry-summary.js')));

        const allWin = summary.windows.all;
        const astraRow = allWin.byModel.find((m) => m.key === 'codex/gpt-6-astra (max)');
        const grokRow = allWin.byModel.find((m) => m.key === 'cursor/grok-4.7 (xhigh)');
        const argonRow = allWin.byModel.find((m) => m.key === 'antigravity/gemini-4-argon (high)');

        assert.ok(astraRow);
        assert.equal(astraRow.runs, 1);
        assert.equal(astraRow.proofsSubmitted, 1);
        assert.equal(astraRow.explicitlyAdmitted, 1);
        assert.equal(astraRow.defaultAdmitted, 0);
        assert.equal(astraRow.judgeRejected, 0);
        assert.equal(astraRow.finalClauseCitations, 1);
        assert.equal(astraRow.finalClauseCitationRate, 100);
        assert.equal(astraRow.observedToolCalls, 2);
        assert.deepEqual(astraRow.skillsRead, [
          { skill: 'ask-council', evidence: 'skill_instructions_read', count: 1 }
        ]);

        assert.ok(grokRow);
        assert.equal(grokRow.proofsSubmitted, 2);
        assert.equal(grokRow.guardRejectedProofs, 1);
        assert.equal(grokRow.explicitlyAdmitted, 0);
        assert.equal(grokRow.defaultAdmitted, 1);
        assert.equal(grokRow.judgeRejected, 1);
        assert.equal(grokRow.finalClauseCitations, 0);
        assert.equal(grokRow.retries, 1);
        assert.equal(grokRow.observedToolCalls, 1);

        assert.ok(argonRow);
        assert.equal(argonRow.excusedRuns, 1);
        assert.equal(argonRow.excusedRate, 100);
        assert.equal(argonRow.observedToolCalls, null, 'Unavailable trace coverage must never be coerced to 0 tool calls');
        assert.equal(argonRow.traceCoverage.unavailableRuns, 1);

        // Verify loadTelemetrySummary and formatTelemetryTable
        const loaded = loadTelemetrySummary({ outputDir, telemetryDir, days: 7, now: '2026-11-09T01:00:00.000Z' });
        assert.ok(loaded.customWindow);
        assert.equal(loaded.customWindow.totalRuns, 1);

        const tableText = formatTelemetryTable(loaded, { by: 'model', windowKey: '7d' });
        assert.match(tableText, /codex\/gpt-6-astra \(max\)/);
        assert.match(tableText, /Trace N\/A/);
        assert.match(tableText, /\[ask-council:skill_instructions_read\]/);
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });

    it('handles note-only decision objects and boolean decisions in JUDGE_AUDIT_AND_SYNTHESIZE guard and reducer', () => {
      let state = createInitialCouncilState({
        topic: 'Decision Variants Test',
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'S1' },
          { id: 's2', harness: 'cursor', model: 'grok-4.7-xhigh', soul: 'S2' },
          { id: 's3', harness: 'antigravity', model: 'gemini-4-argon (high)', soul: 'S3' }
        ]
      });

      state = reduceCouncilState(state, { type: 'BEGIN_ROUND' });
      state = reduceCouncilState(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's1',
        id: 'P-1',
        kind: 'check',
        statement: 'Check 1',
        source: 'src/a.js:1',
        scope: 'unit'
      });
      state = reduceCouncilState(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's2',
        id: 'P-2',
        kind: 'citation',
        statement: 'Cite 2',
        source: 'docs/b.md:1',
        scope: 'doc'
      });
      state = reduceCouncilState(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's3',
        id: 'P-3',
        kind: 'benchmark',
        statement: 'Bench 3',
        source: 'bench/c.js:1',
        scope: 'perf'
      });
      state = reduceCouncilState(state, { type: 'START_JUDGING' });

      // Attempt to cite P-3 when rejected via boolean `admitted: false` must be rejected by guard
      const rejectedByGuard = reduceCouncilState(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        proofDecisions: {
          'P-3': { admitted: false, note: 'Rejected via boolean' }
        },
        summary: 'Bad synthesis citing rejected proof',
        clauses: [{ id: 'C-1', context: 'All', conclusion: 'Bad', citedProofIds: ['P-3'] }]
      });
      assert.equal(rejectedByGuard.lastTransition.ok, false);

      // Valid synthesis with boolean true, note-only object, and boolean false
      state = reduceCouncilState(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        proofDecisions: {
          'P-1': true,
          'P-2': { note: 'Reviewed note without explicit status' },
          'P-3': false
        },
        summary: 'Valid synthesis',
        clauses: [{ id: 'C-1', context: 'All', conclusion: 'Good', citedProofIds: ['P-1', 'P-2'] }]
      });

      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.proofs.find((p) => p.id === 'P-1').admissionKind, 'explicitly_admitted');
      assert.equal(state.proofs.find((p) => p.id === 'P-2').status, 'admitted');
      assert.equal(state.proofs.find((p) => p.id === 'P-2').admissionKind, 'default_admitted');
      assert.equal(state.proofs.find((p) => p.id === 'P-3').status, 'rejected');
      assert.equal(state.proofs.find((p) => p.id === 'P-3').admissionKind, 'judge_rejected');
    });

    it('groups multiple seats sharing the same canonical model within a single run so byModel.runs equals runs participated and preserves guardRejections when snapshots are present', () => {
      const state = {
        phase: 'completed',
        round: 1,
        topic: 'Multi-Seat Same-Model Run',
        judge: { id: 'judge-1', harness: 'antigravity', model: 'gemini-4-argon (high)', status: 'completed' },
        seats: [
          { id: 'argon-seat-1', harness: 'antigravity', model: 'gemini-4-argon (high)', status: 'accepted', retries: 0 },
          { id: 'argon-seat-2', harness: 'antigravity', model: 'gemini-4-argon-high', status: 'accepted', retries: 1 },
          { id: 'astra-seat-1', harness: 'codex', model: 'gpt-6-astra (max)', status: 'accepted', retries: 0 }
        ],
        proofs: [
          { id: 'P-1', seatId: 'argon-seat-1', status: 'admitted', admissionKind: 'explicitly_admitted' },
          { id: 'P-2', seatId: 'argon-seat-2', status: 'admitted', admissionKind: 'default_admitted' },
          { id: 'P-3', seatId: 'astra-seat-1', status: 'admitted', admissionKind: 'explicitly_admitted' }
        ],
        verdict: {
          kind: 'Unanimous Consensus',
          candidate: {
            summary: 'Consensus',
            clauses: [{ id: 'C-1', context: 'All', conclusion: 'Agree', citedProofIds: ['P-1', 'P-3'] }]
          }
        }
      };

      let snapshotGetterCalled = false;
      const stepsWithCommittedDelta = [
        {
          event: { type: 'SUBMIT_PROOF', seatId: 'argon-seat-1', id: 'P-1' },
          stateDelta: { lastTransition: { ok: true, event: 'SUBMIT_PROOF' } },
          get stateSnapshot() {
            snapshotGetterCalled = true;
            return { lastTransition: { ok: true, event: 'SUBMIT_PROOF' } };
          }
        }
      ];

      const rec = buildRunTelemetryRecord({
        runId: 'run-multi-seat-same-model',
        completedAt: '2026-11-09T02:00:00.000Z',
        state,
        snapshots: stepsWithCommittedDelta,
        guardRejectedEvents: [
          { event: { type: 'SUBMIT_PROOF', seatId: 'argon-seat-2' }, message: 'Invalid proof' }
        ],
        providerCalls: [
          {
            participantId: 'argon-seat-1',
            provider: 'antigravity',
            exitCode: 0,
            trace: { traceCoverage: 'unavailable', toolCalls: [], skillsRead: [] }
          },
          {
            participantId: 'argon-seat-2',
            provider: 'antigravity',
            exitCode: 0,
            trace: { traceCoverage: 'unavailable', toolCalls: [], skillsRead: [] }
          },
          {
            participantId: 'astra-seat-1',
            provider: 'codex',
            exitCode: 0,
            trace: {
              traceCoverage: 'full',
              toolCalls: [{ kind: 'command_execution', name: 'rg' }],
              skillsRead: [{ skill: 'ask-council', evidence: 'skill_instructions_read' }]
            }
          }
        ]
      });

      assert.equal(snapshotGetterCalled, false, 'Should inspect stateDelta.lastTransition before invoking lazy stateSnapshot getter');
      const argonSeat2 = rec.seats.find((s) => s.seatId === 'argon-seat-2');
      assert.equal(argonSeat2.guardRejectedProofs, 1, 'guardRejectedEvents must be counted even when snapshots array is non-empty');

      const win = aggregateTelemetryWindow([rec], { days: null, now: '2026-11-09T03:00:00.000Z' });
      assert.equal(win.totalRuns, 1);

      const argonModel = win.byModel.find((m) => m.key === 'antigravity/gemini-4-argon (high)');
      assert.ok(argonModel);
      assert.equal(argonModel.runs, 1, 'Model appearing on 2 seats in 1 run must count as 1 run in byModel');
      assert.deepEqual(argonModel.seatIds, ['argon-seat-1', 'argon-seat-2']);
      assert.equal(argonModel.proofsSubmitted, 2);
      assert.equal(argonModel.guardRejectedProofs, 1);
      assert.equal(argonModel.explicitlyAdmitted, 1);
      assert.equal(argonModel.defaultAdmitted, 1);
      assert.equal(argonModel.retries, 1);
      assert.equal(argonModel.traceCoverage.unavailableRuns, 1);
      assert.equal(argonModel.observedToolCalls, null);

      assert.equal(win.bySeat.length, 3);
    });

    it('excludes mode: "mock" records by default in aggregateTelemetryWindow (unless includeMock: true), keeps newest model on bySeat, and deduplicates supplemental guardRejectedEvents across seats', () => {
      const baseState = {
        phase: 'completed',
        round: 1,
        topic: 'Ledger Polish Test',
        judge: { id: 'judge-1', harness: 'codex', model: 'gpt-6-astra (max)', status: 'completed' },
        seats: [
          { id: 'seat-shared', harness: 'codex', model: 'gpt-6-astra (max)', status: 'accepted', retries: 0 },
          { id: 'seat-other', harness: 'cursor', model: 'grok-4.7-xhigh', status: 'accepted', retries: 0 }
        ],
        proofs: [
          { id: 'P-1', seatId: 'seat-shared', status: 'admitted', admissionKind: 'explicitly_admitted' }
        ],
        verdict: {
          kind: 'Unanimous Consensus',
          candidate: {
            summary: 'Consensus',
            clauses: [{ id: 'C-1', context: 'All', conclusion: 'Done', citedProofIds: ['P-1'] }]
          }
        }
      };

      // Snapshot already has a rejected SUBMIT_PROOF for seat-shared (P-bad-1, compacted without statement)
      // AND a keyless/statementless rejected SUBMIT_PROOF for seat-other,
      // while guardRejectedEvents has a full duplicate of P-bad-1 (with statement) and two distinct keyless/statementless rejected proofs for seat-other.
      const sharedEmptyRef = { type: 'SUBMIT_PROOF', seatId: 'seat-other' };
      const olderLiveRec = buildRunTelemetryRecord({
        runId: 'run-live-old',
        mode: 'live',
        completedAt: '2026-11-08T00:00:00.000Z',
        state: {
          ...baseState,
          seats: [
            { id: 'seat-shared', harness: 'antigravity', model: 'gemini-4-argon (high)', status: 'accepted', retries: 0 },
            { id: 'seat-other', harness: 'cursor', model: 'grok-4.7-xhigh', status: 'accepted', retries: 0 }
          ]
        },
        snapshots: [
          {
            event: { type: 'SUBMIT_PROOF', seatId: 'seat-shared', id: 'P-bad-1' },
            lastTransition: { ok: false, event: 'SUBMIT_PROOF' }
          },
          {
            event: sharedEmptyRef,
            lastTransition: { ok: false, event: 'SUBMIT_PROOF' }
          }
        ],
        guardRejectedEvents: [
          { event: { type: 'SUBMIT_PROOF', seatId: 'seat-shared', id: 'P-bad-1', statement: 'Bad 1' } },
          { event: sharedEmptyRef },
          { event: { type: 'SUBMIT_PROOF', seatId: 'seat-other', statement: '' } }
        ]
      });

      assert.equal(
        olderLiveRec.seats.find((s) => s.seatId === 'seat-shared').guardRejectedProofs,
        1,
        'Duplicate rejected proof in compacted snapshots and guardRejectedEvents must not be double-counted'
      );
      assert.equal(
        olderLiveRec.seats.find((s) => s.seatId === 'seat-other').guardRejectedProofs,
        2,
        'A keyless/statementless snapshot rejection must deduplicate by object reference but must not suppress a distinct keyless/statementless guardRejectedEvents entry for the same seat'
      );

      const newerLiveRec = buildRunTelemetryRecord({
        runId: 'run-live-new',
        mode: 'live',
        completedAt: '2026-11-09T00:00:00.000Z',
        state: baseState
      });

      const mockRec = buildRunTelemetryRecord({
        runId: 'run-mock-sim',
        mode: 'mock',
        completedAt: '2026-11-09T01:00:00.000Z',
        state: baseState
      });

      // Default aggregateTelemetryWindow excludes mode: 'mock'
      const defaultWin = aggregateTelemetryWindow([olderLiveRec, newerLiveRec, mockRec], {
        days: null,
        now: '2026-11-09T02:00:00.000Z'
      });
      assert.equal(defaultWin.totalRuns, 2, 'Mock run must be excluded by default');

      // Verify bySeat keeps newest run model metadata (codex/gpt-6-astra (max)) while recording both historical models
      const sharedSeatBucket = defaultWin.bySeat.find((b) => b.key === 'seat-shared');
      assert.ok(sharedSeatBucket);
      assert.equal(sharedSeatBucket.provider, 'codex');
      assert.equal(sharedSeatBucket.model, 'gpt-6-astra');
      assert.equal(sharedSeatBucket.effort, 'max');
      assert.deepEqual(sharedSeatBucket.models, [
        'antigravity/gemini-4-argon (high)',
        'codex/gpt-6-astra (max)'
      ]);

      // With includeMock: true, mock run is included
      const withMockWin = aggregateTelemetryWindow([olderLiveRec, newerLiveRec, mockRec], {
        days: null,
        now: '2026-11-09T02:00:00.000Z',
        includeMock: true
      });
      assert.equal(withMockWin.totalRuns, 3, 'Mock run must be included when includeMock: true');
    });

    it('aggregates forbiddenStateAccess and deduplicated forbiddenAccessDetails onto persisted seat telemetry records (Issue #63)', () => {
      const state = {
        phase: 'completed',
        round: 1,
        topic: 'Anti-Cheating Telemetry Persistence',
        judge: { id: 'judge-1', harness: 'codex', model: 'gpt-6-astra (max)', status: 'completed' },
        seats: [
          { id: 'cheater-retried', harness: 'codex', model: 'gpt-6-astra (max)', status: 'accepted', retries: 1 },
          { id: 'clean-seat', harness: 'cursor', model: 'grok-4.7-xhigh', status: 'accepted', retries: 0 }
        ],
        proofs: [
          { id: 'P-1', seatId: 'cheater-retried', status: 'admitted', admissionKind: 'explicitly_admitted' },
          { id: 'P-2', seatId: 'clean-seat', status: 'admitted', admissionKind: 'explicitly_admitted' }
        ],
        verdict: {
          kind: 'Unanimous Consensus',
          candidate: {
            summary: 'Consensus',
            clauses: [{ id: 'C-1', context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P-1', 'P-2'] }]
          }
        }
      };

      const providerCalls = [
        {
          participantId: 'cheater-retried',
          provider: 'codex',
          exitCode: 1,
          durationMs: 110,
          trace: {
            traceCoverage: 'full',
            outcome: 'error',
            toolCalls: [{ kind: 'command_execution', name: 'cat', command: 'cat .council/runs/latest.js' }],
            skillsRead: [],
            forbiddenStateAccess: true,
            forbiddenAccessDetails: ['cat .council/runs/latest.js', '.council/runs/latest.js']
          }
        },
        {
          participantId: 'cheater-retried',
          provider: 'codex',
          exitCode: 0,
          durationMs: 95,
          trace: {
            traceCoverage: 'full',
            outcome: 'success',
            toolCalls: [],
            skillsRead: [],
            forbiddenStateAccess: false,
            forbiddenAccessDetails: ['  .council/runs/latest.js  ']
          }
        },
        {
          participantId: 'clean-seat',
          provider: 'cursor',
          exitCode: 0,
          durationMs: 80,
          trace: {
            traceCoverage: 'full',
            outcome: 'success',
            toolCalls: [],
            skillsRead: [],
            forbiddenStateAccess: false,
            forbiddenAccessDetails: []
          }
        }
      ];

      const rec = buildRunTelemetryRecord({
        runId: 'run-cheater-telemetry-63',
        mode: 'live',
        completedAt: '2026-11-09T03:00:00.000Z',
        state,
        providerCalls
      });

      const cheaterRec = rec.seats.find((s) => s.seatId === 'cheater-retried');
      const cleanRec = rec.seats.find((s) => s.seatId === 'clean-seat');

      assert.equal(cheaterRec.forbiddenStateAccess, true);
      assert.ok(Object.isFrozen(cheaterRec.forbiddenAccessDetails));
      assert.deepEqual(cheaterRec.forbiddenAccessDetails, [
        'cat .council/runs/latest.js',
        '.council/runs/latest.js'
      ]);

      assert.equal(cleanRec.forbiddenStateAccess, false);
      assert.ok(Object.isFrozen(cleanRec.forbiddenAccessDetails));
      assert.deepEqual(cleanRec.forbiddenAccessDetails, []);
    });
  });

  // ==========================================================================
  // ISSUE #71: PARTIAL PROOF ADMISSION IN TELEMETRY LEDGER
  // ==========================================================================
  describe('Issue #71: Partial Proof Admission in Telemetry Ledger', () => {
    it('TEL-1: tracks partiallyAdmitted count on seat records in buildRunTelemetryRecord', () => {
      const state = {
        phase: 'completed',
        round: 1,
        topic: 'Partial Proof Admission Telemetry',
        judge: { id: 'judge-1', harness: 'codex', model: 'gpt-6-astra (max)', status: 'completed' },
        seats: [
          { id: 'seat-partial', harness: 'antigravity', model: 'gemini-4-argon (high)', status: 'accepted', retries: 0 },
          { id: 'seat-admitted', harness: 'codex', model: 'gpt-6-astra (max)', status: 'accepted', retries: 0 },
          { id: 'seat-rejected', harness: 'cursor', model: 'grok-4.7-xhigh', status: 'accepted', retries: 0 }
        ],
        proofs: [
          { id: 'P-1', seatId: 'seat-partial', status: 'partially_admitted', admissionKind: 'partially_admitted' },
          { id: 'P-2', seatId: 'seat-admitted', status: 'admitted', admissionKind: 'explicitly_admitted' },
          { id: 'P-3', seatId: 'seat-rejected', status: 'rejected', admissionKind: 'judge_rejected' }
        ],
        verdict: {
          kind: 'Unanimous Consensus',
          candidate: {
            summary: 'Consensus',
            clauses: [{ id: 'C-1', context: 'All', conclusion: 'Agree', citedProofIds: ['P-1', 'P-2'] }]
          }
        }
      };

      const rec = buildRunTelemetryRecord({
        runId: 'run-issue-71-telemetry',
        completedAt: '2026-11-10T12:00:00.000Z',
        state
      });

      const partialSeat = rec.seats.find((s) => s.seatId === 'seat-partial');
      const admittedSeat = rec.seats.find((s) => s.seatId === 'seat-admitted');
      const rejectedSeat = rec.seats.find((s) => s.seatId === 'seat-rejected');

      assert.equal(partialSeat.partiallyAdmitted, 1, 'seat-partial must record 1 partiallyAdmitted proof');
      assert.equal(partialSeat.explicitlyAdmitted, 0);
      assert.equal(partialSeat.judgeRejected, 0, 'partially_admitted must not count as judgeRejected');
      assert.equal(partialSeat.finalClauseCitations, 1);

      assert.equal(admittedSeat.explicitlyAdmitted, 1);
      assert.equal(admittedSeat.partiallyAdmitted, 0);
      assert.equal(admittedSeat.judgeRejected, 0);

      assert.equal(rejectedSeat.judgeRejected, 1);
      assert.equal(rejectedSeat.partiallyAdmitted, 0);
      assert.equal(rejectedSeat.explicitlyAdmitted, 0);
    });

    it('TEL-2: aggregates partiallyAdmitted counts across runs into byModel and bySeat without inflating judgeRejectionRate', () => {
      const state = {
        phase: 'completed',
        round: 1,
        topic: 'Partial Aggregation',
        judge: { id: 'judge-1', harness: 'codex', model: 'gpt-6-astra (max)', status: 'completed' },
        seats: [
          { id: 'argon-1', harness: 'antigravity', model: 'gemini-4-argon (high)', status: 'accepted', retries: 0 }
        ],
        proofs: [
          { id: 'P-1', seatId: 'argon-1', status: 'partially_admitted', admissionKind: 'partially_admitted' },
          { id: 'P-2', seatId: 'argon-1', status: 'admitted', admissionKind: 'explicitly_admitted' }
        ],
        verdict: {
          kind: 'Unanimous Consensus',
          candidate: {
            summary: 'Consensus',
            clauses: [{ id: 'C-1', context: 'All', conclusion: 'Agree', citedProofIds: ['P-1', 'P-2'] }]
          }
        }
      };

      const rec = buildRunTelemetryRecord({
        runId: 'run-partial-agg',
        completedAt: '2026-11-10T12:00:00.000Z',
        state
      });

      const win = aggregateTelemetryWindow([rec], { days: null, now: '2026-11-10T13:00:00.000Z' });
      const argonModel = win.byModel.find((m) => m.key === 'antigravity/gemini-4-argon (high)');
      assert.ok(argonModel);
      assert.equal(argonModel.proofsSubmitted, 2);
      assert.equal(argonModel.explicitlyAdmitted, 1);
      assert.equal(argonModel.partiallyAdmitted, 1);
      assert.equal(argonModel.judgeRejected, 0);
      assert.equal(argonModel.judgeRejectionRate, 0, 'judgeRejectionRate must remain 0% when 1 admitted and 1 partially admitted');

      const argonSeat = win.bySeat.find((s) => s.key === 'argon-1');
      assert.ok(argonSeat);
      assert.equal(argonSeat.partiallyAdmitted, 1);
    });

    it('TEL-3: end-to-end integration: reduceCouncilState with partially_admitted flows cleanly into buildRunTelemetryRecord', () => {
      let state = createInitialCouncilState({
        topic: 'E2E State to Telemetry',
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Arch' },
          { id: 's2', harness: 'antigravity', model: 'gemini-4-argon (high)', soul: 'QA' }
        ]
      });
      state = reduceCouncilState(state, { type: 'BEGIN_ROUND' });
      state = reduceCouncilState(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's1',
        id: 'P-1',
        kind: 'citation',
        source: 'ref.md',
        scope: 'scope',
        statement: 'Core statement with secondary overclaim.'
      });
      state = reduceCouncilState(state, { type: 'START_JUDGING' });
      state = reduceCouncilState(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        proofDecisions: {
          'P-1': {
            status: 'partially_admitted',
            admittedStatement: 'Core statement.',
            note: 'Excised secondary overclaim.'
          }
        },
        summary: 'Candidate',
        clauses: [{ id: 'C-1', context: 'All', conclusion: 'Verified', citedProofIds: ['P-1'] }]
      });
      state = reduceCouncilState(state, { type: 'CAST_VOTE', seatId: 's1', vote: 'accept' });
      state = reduceCouncilState(state, { type: 'CAST_VOTE', seatId: 's2', vote: 'accept' });
      state = reduceCouncilState(state, { type: 'EVALUATE_ROUND' });

      assert.equal(state.phase, 'completed');
      const rec = buildRunTelemetryRecord({
        runId: 'run-e2e-partial-telemetry',
        completedAt: '2026-11-10T12:00:00.000Z',
        state
      });

      const s1 = rec.seats.find((s) => s.seatId === 's1');
      assert.equal(s1.partiallyAdmitted, 1);
      assert.equal(s1.explicitlyAdmitted, 0);
      assert.equal(s1.judgeRejected, 0);
    });
  });
});
