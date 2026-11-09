/**
 * @fileoverview Unit tests for VisualizerLiveWatcher (Pure Observer Telemetry Subscriber).
 * Verifies live telemetry subscription, atomic file persistence, stop() lifecycle cleanup,
 * and visualizer HTML integration for file:// Live Follow mode.
 */

import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTelemetryEmitter } from '../../src/telemetry/emitter.js';
import { VisualizerLiveWatcher } from '../../src/visualizer/live-watcher.js';

describe('Unit: VisualizerLiveWatcher (Pure Observer for Live Visualizer)', () => {
  let tmpDir;
  let tmpOut;
  let emitter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-watcher-test-'));
    tmpOut = path.join(tmpDir, 'live-run-latest.js');
    emitter = createTelemetryEmitter();
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('Initialization & Data Model', () => {
    it('initializes in-memory liveRun model and creates output file', () => {
      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputPath: tmpOut,
        initialConfig: {
          topic: 'Evaluate container orchestration architectures',
          maxRounds: 3,
          minQuorum: 2,
          judge: { id: 'judge-1', harness: 'antigravity', model: 'claude-opus-5-5-high' },
          seats: [{ id: 'seat-1', harness: 'codex', model: 'gpt-6-astra' }]
        }
      });

      assert.equal(watcher.liveRun.id, 'wt-live-latest');
      assert.equal(watcher.liveRun.title, 'Live Run: Evaluate container orchestration architectures');
      assert.equal(watcher.liveRun.isRunning, true);
      assert.equal(watcher.liveRun.initialConfig.topic, 'Evaluate container orchestration architectures');
      assert.equal(watcher.liveRun.initialConfig.maxRounds, 3);
      assert.equal(watcher.liveRun.initialConfig.minQuorum, 2);
      assert.equal(watcher.liveRun.steps.length, 0);

      // Verify initial file was written
      assert.ok(fs.existsSync(tmpOut), 'Target output file should exist after initialization');
      const content = fs.readFileSync(tmpOut, 'utf8');
      assert.match(content, /CouncilLatestLiveRun/);

      watcher.stop();
    });

    it('falls back to default initialConfig and output path when omitted', () => {
      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputPath: tmpOut
      });

      assert.equal(watcher.liveRun.title, 'Live Run: Deliberation');
      assert.equal(watcher.liveRun.initialConfig.topic, '');
      assert.equal(watcher.liveRun.initialConfig.maxRounds, 3);
      assert.equal(watcher.liveRun.initialConfig.minQuorum, 2);
      assert.deepEqual(watcher.liveRun.initialConfig.seats, []);
      assert.equal(watcher.liveRun.initialConfig.judge, null);

      watcher.stop();
    });
  });

  describe('Telemetry Subscriptions & Event Handling', () => {
    it('updates currentState, isRunning, and appends steps on state_transition', () => {
      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputPath: tmpOut,
        initialConfig: { topic: 'Testing state transitions' }
      });

      const fakeState1 = {
        phase: 'reviewing',
        round: 1,
        maxRounds: 3,
        topic: 'Testing state transitions',
        seats: [
          { id: 'seat-1', status: 'idle', harness: 'codex' },
          { id: 'seat-2', status: 'idle', harness: 'antigravity' }
        ],
        judge: { id: 'judge-1', status: 'idle', harness: 'antigravity' },
        proofs: [],
        candidate: null,
        objections: [],
        history: []
      };

      emitter.emitStateTransition({ type: 'BEGIN_ROUND' }, fakeState1);

      assert.equal(watcher.liveRun.steps.length, 1);
      assert.match(watcher.liveRun.steps[0].label, /Transition: BEGIN_ROUND -> reviewing \(Round 1\)/);
      assert.equal(watcher.liveRun.currentState.phase, 'reviewing');
      assert.equal(watcher.liveRun.isRunning, true);

      // Verify file on disk has updated state
      const fileData1 = fs.readFileSync(tmpOut, 'utf8');
      assert.match(fileData1, /"phase": "reviewing"/);

      // Transition to completed
      const fakeState2 = {
        ...fakeState1,
        phase: 'completed',
        verdict: { kind: 'Unanimous Consensus', note: 'Agreement reached' }
      };

      emitter.emitStateTransition({ type: 'EVALUATE_ROUND' }, fakeState2);

      assert.equal(watcher.liveRun.steps.length, 2);
      assert.equal(watcher.liveRun.currentState.phase, 'completed');
      assert.equal(watcher.liveRun.isRunning, false);

      const fileData2 = fs.readFileSync(tmpOut, 'utf8');
      assert.match(fileData2, /"isRunning": false/);
      assert.match(fileData2, /Unanimous Consensus/);

      watcher.stop();
    });

    it('updates seat and judge status in currentState on seat_telemetry', () => {
      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputPath: tmpOut
      });

      const initialState = {
        phase: 'reviewing',
        round: 1,
        seats: [
          { id: 'seat-1', status: 'idle' },
          { id: 'seat-2', status: 'idle' }
        ],
        judge: { id: 'judge-1', status: 'idle' },
        proofs: []
      };

      emitter.emitStateTransition({ type: 'BEGIN_ROUND' }, initialState);

      // Seat status telemetry
      emitter.emitSeatTelemetry('seat-1', 'thinking', { model: 'gpt-6-astra' });
      assert.equal(watcher.liveRun.currentState.seats[0].status, 'thinking');

      // Judge status telemetry
      emitter.emitSeatTelemetry('judge-1', 'auditing', { model: 'claude-opus' });
      assert.equal(watcher.liveRun.currentState.judge.status, 'auditing');

      const fileData = fs.readFileSync(tmpOut, 'utf8');
      assert.match(fileData, /"status": "thinking"/);
      assert.match(fileData, /"status": "auditing"/);

      watcher.stop();
    });
  });

  describe('Atomic File Persistence', () => {
    it('writes valid executable JS setting window.CouncilLatestLiveRun and globalThis.CouncilLatestLiveRun', () => {
      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputPath: tmpOut,
        initialConfig: { topic: 'Testing executable JS payload' }
      });

      const fileContent = fs.readFileSync(tmpOut, 'utf8');
      assert.match(fileContent, /window\.CouncilLatestLiveRun/);
      assert.match(fileContent, /globalThis\.CouncilLatestLiveRun/);

      // Execute code in a sandbox function simulating window and globalThis
      const mockWindow = {};
      const mockGlobal = {};
      const runner = new Function('window', 'globalThis', fileContent);
      runner(mockWindow, mockGlobal);

      assert.ok(mockWindow.CouncilLatestLiveRun, 'Should define window.CouncilLatestLiveRun');
      assert.ok(mockGlobal.CouncilLatestLiveRun, 'Should define globalThis.CouncilLatestLiveRun');
      assert.equal(mockWindow.CouncilLatestLiveRun.id, 'wt-live-latest');
      assert.equal(mockWindow.CouncilLatestLiveRun.title, 'Live Run: Testing executable JS payload');

      watcher.stop();
    });

    it('creates nested destination directories if they do not exist', () => {
      const deepOut = path.join(tmpDir, 'nested', 'deep', 'dir', 'live-run-latest.js');
      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputPath: deepOut,
        initialConfig: { topic: 'Deep directory test' }
      });

      assert.ok(fs.existsSync(deepOut));
      const content = fs.readFileSync(deepOut, 'utf8');
      assert.match(content, /Deep directory test/);

      watcher.stop();
    });

    it('safely handles file I/O errors without throwing or crashing deliberation', () => {
      // Pass an invalid path that cannot be written to
      const invalidPath = path.join(tmpDir, 'file-blocking-dir', 'live-run-latest.js');
      // Create a regular file at 'file-blocking-dir' so mkdir fails
      fs.writeFileSync(path.join(tmpDir, 'file-blocking-dir'), 'blocking');

      let watcher;
      assert.doesNotThrow(() => {
        watcher = new VisualizerLiveWatcher({
          telemetry: emitter,
          outputPath: invalidPath
        });
      });

      assert.doesNotThrow(() => {
        emitter.emitStateTransition({ type: 'BEGIN_ROUND' }, { phase: 'reviewing', round: 1 });
        emitter.emitSeatTelemetry('seat-1', 'thinking');
      });

      watcher.stop();
    });
  });

  describe('Lifecycle Cleanup (stop & detach)', () => {
    it('stop() removes event listeners and prevents further updates or file writes', () => {
      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputPath: tmpOut
      });

      // Emit initial transition
      emitter.emitStateTransition({ type: 'BEGIN_ROUND' }, { phase: 'reviewing', round: 1 });
      assert.equal(watcher.liveRun.steps.length, 1);

      // Call stop()
      watcher.stop();
      assert.equal(watcher._stopped, true);

      // Modify the file on disk to a marker value to detect if further writes occur
      fs.writeFileSync(tmpOut, '/* sentinel */', 'utf8');

      // Emit transition and seat telemetry after stop()
      emitter.emitStateTransition({ type: 'EVALUATE_ROUND' }, { phase: 'completed', round: 1 });
      emitter.emitSeatTelemetry('seat-1', 'thinking');

      // Internal model must not have updated
      assert.equal(watcher.liveRun.steps.length, 1);
      assert.equal(watcher.liveRun.currentState.phase, 'reviewing');

      // Disk file must remain untouched
      assert.equal(fs.readFileSync(tmpOut, 'utf8'), '/* sentinel */');
    });

    it('detach() is an alias for stop() and is idempotent', () => {
      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputPath: tmpOut
      });

      watcher.detach();
      assert.equal(watcher._stopped, true);

      // Calling detach() again should not throw
      assert.doesNotThrow(() => watcher.detach());
      assert.doesNotThrow(() => watcher.stop());
    });

    it('attach() rebinds to a new emitter and unsubscribes from the previous emitter', () => {
      const emitter1 = createTelemetryEmitter();
      const emitter2 = createTelemetryEmitter();

      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter1,
        outputPath: tmpOut
      });

      // Switch to emitter2
      watcher.attach(emitter2);

      // Emit on emitter1 - should NOT update
      emitter1.emitStateTransition({ type: 'BEGIN_ROUND' }, { phase: 'reviewing', round: 1 });
      assert.equal(watcher.liveRun.steps.length, 0);

      // Emit on emitter2 - SHOULD update
      emitter2.emitStateTransition({ type: 'BEGIN_ROUND' }, { phase: 'reviewing', round: 1 });
      assert.equal(watcher.liveRun.steps.length, 1);

      watcher.stop();
    });
  });

  describe('Visualizer HTML Integration & Live Follow Mode (src/visualizer/index.html)', () => {
    const htmlPath = path.resolve(import.meta.dirname, '../../src/visualizer/index.html');

    it('loads live-run-latest.js via optional/safe script tag', () => {
      const html = fs.readFileSync(htmlPath, 'utf8');
      assert.match(html, /<script\s+src=["']\.\/live-run-latest\.js["']/i, 'Should load ./live-run-latest.js');
    });

    it('defines Latest Live Run detection and integration', () => {
      const html = fs.readFileSync(htmlPath, 'utf8');
      assert.match(html, /CouncilLatestLiveRun/, 'Should reference CouncilLatestLiveRun');
      assert.match(html, /Latest Live Run/, 'Should render or support Latest Live Run tab');
    });

    it('implements 1-second interval dynamic script Live Follow mode with DOM cleanup over file://', () => {
      const html = fs.readFileSync(htmlPath, 'utf8');
      assert.match(html, /id=["']btn-live-follow["']/, 'Should have btn-live-follow control element');
      assert.match(html, /toggleLiveFollow\s*\(/, 'Should define toggleLiveFollow function');
      assert.match(html, /live-run-latest\.js\?t=/, 'Should dynamically reload live-run-latest.js with timestamp cache-buster');
      assert.match(html, /1000/, 'Should poll at 1000ms (1 second) interval');
      assert.match(html, /\.remove\(\)/, 'Should clean up dynamic script tags from the DOM');
    });
  });

  describe('Integration: CouncilEngine + VisualizerLiveWatcher', () => {
    it('observes a full live deliberation run without engine coupling', async () => {
      const { CouncilEngine } = await import('../../src/engine/council-engine.js');

      const config = {
        topic: 'Integration debate: Rust vs Go for high-throughput networking',
        maxRounds: 2,
        minQuorum: 2,
        judge: {
          id: 'judge-opus',
          harness: 'antigravity',
          model: 'claude-opus-5-5-high',
          soul: 'Impartial Proof Auditor'
        },
        seats: [
          { id: 'seat-rust', harness: 'codex', model: 'gpt-6-astra', soul: 'Systems Architect' },
          { id: 'seat-go', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Pragmatic Engineer' }
        ]
      };

      const engine = new CouncilEngine(config);
      const watcher = new VisualizerLiveWatcher({
        telemetry: engine.getTelemetry(),
        outputPath: tmpOut,
        initialConfig: config
      });

      // Execute engine deliberation
      const result = await engine.run();

      assert.ok(result.state.verdict, 'Deliberation should produce a verdict');
      assert.equal(watcher.liveRun.isRunning, false, 'Watcher should mark isRunning as false');
      assert.equal(watcher.liveRun.currentState.phase, 'completed');
      assert.ok(watcher.liveRun.steps.length > 3, 'Should record multiple state transition steps');

      // Verify persisted file contains final state and verdict
      const diskContent = fs.readFileSync(tmpOut, 'utf8');
      assert.match(diskContent, /Rust vs Go/);
      assert.match(diskContent, /"phase": "completed"/);
      assert.match(diskContent, /"isRunning": false/);

      // Verify it can be evaluated as JS in browser context
      const mockWindow = {};
      const evalFn = new Function('window', 'globalThis', diskContent);
      evalFn(mockWindow, {});

      assert.equal(mockWindow.CouncilLatestLiveRun.id, 'wt-live-latest');
      assert.equal(mockWindow.CouncilLatestLiveRun.currentState.phase, 'completed');
      assert.equal(mockWindow.CouncilLatestLiveRun.isRunning, false);

      watcher.stop();
    });

    it('transitions through the state machine on terminal Judge fault so observers see phase completed, verdict, and isRunning false', async () => {
      const { CouncilEngine } = await import('../../src/engine/council-engine.js');
      const { MockAdapter } = await import('../../src/harness/mock.js');

      const mockAdapter = new MockAdapter();
      mockAdapter.executeJudgeAuditAndSynthesis = async () => {
        throw new Error('Harness "codex" execution timed out after 240000ms');
      };

      const config = {
        topic: 'Judge Fault Observer Termination Test',
        maxRounds: 2,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        judge: {
          id: 'judge-astra',
          harness: 'codex',
          model: 'gpt-6-astra',
          soul: 'Impartial Proof Auditor'
        },
        seats: [
          { id: 'seat-1', harness: 'codex', model: 'gpt-6-astra', soul: 'Systems Architect' },
          { id: 'seat-2', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Pragmatic Engineer' }
        ]
      };

      const engine = new CouncilEngine(config, { harnessResolver: () => mockAdapter });
      const watcher = new VisualizerLiveWatcher({
        telemetry: engine.getTelemetry(),
        outputPath: tmpOut,
        initialConfig: config
      });

      const result = await engine.run();

      // Engine state and canonical phase must reflect terminal DISSENT_REPORT
      assert.equal(result.ok, false);
      assert.equal(result.state.phase, 'completed');
      assert.equal(result.state.canonicalPhase, 'DISSENT_REPORT');
      assert.equal(result.state.verdict?.kind, 'Dissent Report (Judge Fault)');
      assert.match(result.state.history[0], /Dissent Report \(Judge Fault\)/);

      // Telemetry snapshots must include the terminal completed snapshot
      const lastSnapshot = result.snapshots[result.snapshots.length - 1];
      assert.equal(lastSnapshot.stateSnapshot.phase, 'completed');
      assert.equal(lastSnapshot.stateSnapshot.canonicalPhase, 'DISSENT_REPORT');
      assert.equal(lastSnapshot.stateSnapshot.verdict?.kind, 'Dissent Report (Judge Fault)');

      // Live watcher must observe the terminal state and mark isRunning = false
      assert.equal(watcher.liveRun.isRunning, false, 'Watcher must mark isRunning as false on Judge fault termination');
      assert.equal(watcher.liveRun.currentState.phase, 'completed');
      assert.equal(watcher.liveRun.currentState.verdict?.kind, 'Dissent Report (Judge Fault)');
      assert.equal(watcher.liveRun.currentState.judge.status, 'fault_timeout');
      assert.equal(watcher.liveRun.currentState.judge.errorClass, 'TimeoutError');
      assert.match(watcher.liveRun.currentState.judge.faultReason, /^\[TimeoutError\]/);

      // Earlier step snapshots must NOT have been mutated in-place by later seat_telemetry events
      const beginRoundStep = watcher.liveRun.steps.find((s) => s.event?.type === 'BEGIN_ROUND');
      assert.ok(beginRoundStep);
      assert.equal(beginRoundStep.stateSnapshot.judge.status, 'idle');
      assert.equal(beginRoundStep.stateSnapshot.judge.faultReason, undefined);
      assert.equal(
        beginRoundStep.stateSnapshot.seats.every((s) => s.status === 'thinking'),
        true,
        'BEGIN_ROUND step snapshot seats must remain in their historical "thinking" state'
      );

      const diskContent = fs.readFileSync(tmpOut, 'utf8');
      const mockWindow = {};
      const evalFn = new Function('window', 'globalThis', diskContent);
      evalFn(mockWindow, {});

      assert.equal(mockWindow.CouncilLatestLiveRun.isRunning, false);
      assert.equal(mockWindow.CouncilLatestLiveRun.currentState.phase, 'completed');
      assert.equal(mockWindow.CouncilLatestLiveRun.currentState.verdict?.kind, 'Dissent Report (Judge Fault)');
      assert.match(mockWindow.CouncilLatestLiveRun.currentState.judge.faultReason, /^\[TimeoutError\]/);

      watcher.stop();
    });
  });

  describe('Production Graph Introspection in Live Snapshots (#21)', () => {
    it('attaches getDependencyAndStateGraph to currentGraph, currentState.graph, and step.graph on state_transition', () => {
      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputPath: tmpOut,
        initialConfig: { topic: 'Graph attachment test' }
      });

      const fakeState = {
        phase: 'reviewing',
        canonicalPhase: 'DELIBERATION',
        round: 1,
        maxRounds: 3,
        minQuorum: 2,
        topic: 'Graph attachment test',
        seats: [
          { id: 'seat-1', status: 'thinking', harness: 'codex' },
          { id: 'seat-2', status: 'thinking', harness: 'antigravity' }
        ],
        judge: { id: 'judge-1', status: 'idle', harness: 'codex' },
        proofs: [],
        candidate: null,
        objections: [],
        history: []
      };

      emitter.emitStateTransition({ type: 'BEGIN_ROUND' }, fakeState);

      assert.ok(watcher.liveRun.currentGraph, 'currentGraph should be defined');
      assert.ok(Array.isArray(watcher.liveRun.currentGraph.nodes), 'nodes should be an array');
      assert.ok(Array.isArray(watcher.liveRun.currentGraph.edges), 'edges should be an array');
      assert.ok(watcher.liveRun.currentState.graph, 'currentState.graph should be defined');
      assert.equal(watcher.liveRun.steps[0].graph.nodes.length, watcher.liveRun.currentGraph.nodes.length);

      // Verify reviewing node is marked active in graph
      const reviewingNode = watcher.liveRun.currentGraph.nodes.find((n) => n.id === 'reviewing');
      assert.ok(reviewingNode, 'Should include reviewing phase node');
      assert.equal(watcher.liveRun.currentGraph.activeNodeId, 'reviewing');

      watcher.stop();
    });

    it('enriches steps with actor and human-readable action summaries', () => {
      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputPath: tmpOut
      });

      const state1 = {
        phase: 'clarifying',
        round: 1,
        seats: [],
        judge: { id: 'judge-1' }
      };
      emitter.emitStateTransition({ type: 'START_CLARIFYING' }, state1);
      assert.equal(watcher.liveRun.steps[0].actor, 'engine');
      assert.equal(watcher.liveRun.steps[0].summary, 'Started discovery & clarification phase');

      const state2 = {
        phase: 'reviewing',
        round: 1,
        seats: [{ id: 'seat-1', status: 'thinking' }],
        judge: { id: 'judge-1' },
        proofs: []
      };
      emitter.emitStateTransition(
        {
          type: 'SUBMIT_PROOF',
          proof: { id: 'P1', seatId: 'seat-1', kind: 'check', scope: 'Containers' }
        },
        state2
      );
      assert.equal(watcher.liveRun.steps[1].actor, 'seat-1');
      assert.match(watcher.liveRun.steps[1].summary, /Seat "seat-1" submitted Proof P1 \[check\]/);

      const state3 = {
        phase: 'confirming',
        round: 1,
        seats: [{ id: 'seat-1', status: 'accepted' }],
        judge: { id: 'judge-1' }
      };
      emitter.emitStateTransition(
        {
          type: 'CAST_VOTE',
          vote: { seatId: 'seat-1', vote: 'accept' }
        },
        state3
      );
      assert.equal(watcher.liveRun.steps[2].actor, 'seat-1');
      assert.match(watcher.liveRun.steps[2].summary, /Seat "seat-1" voted ACCEPT/);

      // Also verify flat event shapes actually emitted by CouncilEngine & transitionCouncil (#40)
      emitter.emitStateTransition(
        {
          type: 'PUBLISH_CLARIFICATION',
          answer: 'Use Node >= 22'
        },
        { phase: 'clarifying', clarificationBatch: 2, seats: [], judge: { id: 'judge-1' } }
      );
      assert.equal(watcher.liveRun.steps[3].actor, 'engine');
      assert.equal(watcher.liveRun.steps[3].summary, 'Published clarification answer for Batch 2');

      emitter.emitStateTransition(
        {
          type: 'SUBMIT_PROOF',
          seatId: 'astra-voter',
          kind: 'check',
          scope: 'package.json',
          source: 'package.json:11',
          statement: 'engines.node >=22.0.0'
        },
        {
          phase: 'reviewing',
          round: 1,
          seats: [{ id: 'astra-voter', status: 'proof_submitted' }],
          judge: { id: 'judge-1' },
          proofs: [{ id: 'P1', seatId: 'astra-voter', kind: 'check' }]
        }
      );
      assert.equal(watcher.liveRun.steps[4].actor, 'astra-voter');
      assert.equal(watcher.liveRun.steps[4].summary, 'Seat "astra-voter" submitted Proof P1 [check]');

      emitter.emitStateTransition(
        {
          type: 'CAST_VOTE',
          seatId: 'astra-voter',
          vote: 'accept'
        },
        {
          phase: 'confirming',
          round: 1,
          seats: [{ id: 'astra-voter', status: 'accepted' }],
          judge: { id: 'judge-1' }
        }
      );
      assert.equal(watcher.liveRun.steps[5].actor, 'astra-voter');
      assert.equal(watcher.liveRun.steps[5].summary, 'Seat "astra-voter" voted ACCEPT (Round 1)');

      emitter.emitStateTransition(
        {
          type: 'CAST_VOTE',
          seatId: 'sol-voter',
          vote: 'object',
          reason: 'Missing citation',
          proofId: 'P2'
        },
        {
          phase: 'confirming',
          round: 1,
          seats: [{ id: 'sol-voter', status: 'objected' }],
          judge: { id: 'judge-1' }
        }
      );
      assert.equal(watcher.liveRun.steps[6].actor, 'sol-voter');
      assert.equal(watcher.liveRun.steps[6].summary, 'Seat "sol-voter" voted OBJECT (Round 1, cites Proof P2)');

      watcher.stop();
    });

    it('renders Rejected <event.type>: <message> on guard-rejected transitions, avoids duplicate [ErrorClass], and distinguishes terminal JUDGE_FAULT (#40)', async () => {
      const { getTransitionActor, getTransitionSummary } = await import('../../src/visualizer/live-watcher.js');

      // 1. Rejected transitions
      assert.equal(
        getTransitionSummary(
          { type: 'CAST_VOTE', seatId: 's1', vote: 'object', reason: 'Bad proofId', proofId: 'P999' },
          {
            phase: 'confirming',
            round: 1,
            lastTransition: {
              ok: false,
              message: 'Objection Proof Guard: Objection cites non-existent Proof "P999".'
            }
          }
        ),
        'Rejected CAST_VOTE: Objection Proof Guard: Objection cites non-existent Proof "P999".'
      );

      assert.equal(
        getTransitionSummary(
          { type: 'BEGIN_ROUND' },
          {
            phase: 'clarifying',
            round: 0,
            lastTransition: {
              ok: false,
              message: 'Guard rejected BEGIN_ROUND: Minimum 2 active seats required for deliberation.'
            }
          }
        ),
        'Rejected BEGIN_ROUND: Minimum 2 active seats required for deliberation.'
      );

      assert.equal(
        getTransitionSummary(
          { type: 'JUDGE_AUDIT_AND_SYNTHESIZE', clauses: [] },
          {
            phase: 'judging',
            round: 1,
            lastTransition: {
              ok: false,
              message: 'Judge Candidate Guard: Candidate requires at least one clause.'
            }
          }
        ),
        'Rejected JUDGE_AUDIT_AND_SYNTHESIZE: Judge Candidate Guard: Candidate requires at least one clause.'
      );

      const indexHtml = fs.readFileSync(path.resolve(import.meta.dirname, '../../src/visualizer/index.html'), 'utf8');
      assert.match(indexHtml, /flex-wrap:wrap;\s*gap:4px 8px;/);
      assert.match(indexHtml, /min-width:0;\s*overflow-wrap:anywhere;/);

      // 2. Non-duplicate [ErrorClass] in SEAT_FAULT and JUDGE_FAULT when reason already starts with [<errorClass>]
      assert.equal(
        getTransitionSummary(
          {
            type: 'SEAT_FAULT',
            seatId: 's1',
            errorClass: 'TimeoutError',
            reason: '[TimeoutError] Seat "s1" timed out after 5000ms'
          },
          { phase: 'seat_fault', round: 1 }
        ),
        'Seat "s1" faulted ([TimeoutError] Seat "s1" timed out after 5000ms)'
      );
      assert.equal(
        getTransitionSummary(
          {
            type: 'SEAT_FAULT',
            seatId: 's1',
            errorClass: 'TimeoutError',
            reason: 'Seat "s1" timed out after 5000ms'
          },
          { phase: 'seat_fault', round: 1 }
        ),
        'Seat "s1" faulted (TimeoutError: Seat "s1" timed out after 5000ms)'
      );

      // 3. Non-terminal vs terminal JUDGE_FAULT
      const nonTerminalJudgeSummary = getTransitionSummary(
        {
          type: 'JUDGE_FAULT',
          errorClass: 'TimeoutError',
          reason: '[TimeoutError] Judge timed out after 10000ms'
        },
        { phase: 'judge_fault', round: 1 }
      );
      assert.equal(nonTerminalJudgeSummary, 'Judge faulted ([TimeoutError] Judge timed out after 10000ms)');

      const terminalJudgeSummary = getTransitionSummary(
        {
          type: 'JUDGE_FAULT',
          errorClass: 'TimeoutError',
          reason: '[TimeoutError] Judge timed out after 10000ms',
          terminal: true
        },
        { phase: 'completed', round: 1 }
      );
      assert.notEqual(terminalJudgeSummary, nonTerminalJudgeSummary);
      assert.equal(
        terminalJudgeSummary,
        'Terminal Judge fault ([TimeoutError] Judge timed out after 10000ms) -> Dissent Report (Judge Fault)'
      );

      // 4. Clarification actor attribution
      assert.equal(getTransitionActor({ type: 'START_CLARIFYING' }, { judge: { id: 'judge-1' } }), 'engine');
      assert.equal(
        getTransitionActor({ type: 'PUBLISH_CLARIFICATION', answer: 'Yes' }, { judge: { id: 'judge-1' } }),
        'engine'
      );
    });

    it('verifies end-to-end CouncilEngine -> VisualizerLiveWatcher event contract for getTransitionActor and getTransitionSummary (#40)', async () => {
      const { CouncilEngine } = await import('../../src/engine/council-engine.js');
      const { InvalidResponseError, TimeoutError } = await import('../../src/harness/adapter.js');

      let s1ProofAttempts = 0;
      let judgeAttempts = 0;
      let s1VoteAttempts = 0;

      const customHarness = {
        executeSeatProof: async ({ seat }) => {
          if (seat.id === 'seat-alpha' && s1ProofAttempts === 0) {
            s1ProofAttempts += 1;
            throw new TimeoutError('Seat alpha timed out on first attempt', {
              harness: 'codex',
              seatId: 'seat-alpha',
              timeoutMs: 1000
            });
          }
          return {
            scope: 'Architecture',
            kind: 'check',
            source: 'src/engine/council-engine.js',
            statement: `Verified by ${seat.id}`
          };
        },
        executeJudgeAuditAndSynthesis: async () => {
          if (judgeAttempts === 0) {
            judgeAttempts += 1;
            // First attempt returns unverified proof citation -> rejected JUDGE_AUDIT_AND_SYNTHESIZE transition + JUDGE_FAULT + RETRY_JUDGE
            return {
              summary: 'Invalid synthesis citing P999',
              proofDecisions: { P1: { status: 'admitted', note: 'ok' }, P2: { status: 'admitted', note: 'ok' } },
              clauses: [{ id: 'C1', context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P999'] }]
            };
          }
          return {
            summary: 'Valid synthesis',
            proofDecisions: { P1: { status: 'admitted', note: 'ok' }, P2: { status: 'admitted', note: 'ok' } },
            clauses: [{ id: 'C1', context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1', 'P2'] }]
          };
        },
        executeSeatVote: async ({ seat }) => {
          if (seat.id === 'seat-alpha' && s1VoteAttempts === 0) {
            s1VoteAttempts += 1;
            // First vote objects citing non-existent P999 -> rejected CAST_VOTE transition + SEAT_FAULT (exhausts retries -> EXCUSE_SEAT)
            return { vote: 'object', reason: 'Bad proof reference', proofId: 'P999' };
          }
          return { vote: 'accept' };
        }
      };

      const engine = new CouncilEngine(
        {
          topic: 'Engine-to-Watcher Event Contract',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          clarifications: [{ answer: 'Target Node >= 22' }],
          judge: { id: 'judge-opus', harness: 'antigravity', model: 'claude-opus-5-5-high', soul: 'Judge' },
          seats: [
            { id: 'seat-alpha', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Alpha' },
            { id: 'seat-beta', harness: 'codex', model: 'gpt-6.1-sol (max)', soul: 'Beta' },
            { id: 'seat-gamma', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Gamma' }
          ]
        },
        {
          telemetry: emitter,
          harnessResolver: () => customHarness
        }
      );

      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputPath: tmpOut,
        initialConfig: engine.config
      });

      const result = await engine.run();
      watcher.stop();

      assert.equal(result.ok, true);
      const steps = watcher.liveRun.steps;

      // Verify actors and summaries across every step emitted by CouncilEngine
      const byType = (type) => steps.filter((s) => s.event?.type === type);

      const addSeats = byType('ADD_SEAT');
      assert.equal(addSeats.length, 3);
      assert.equal(addSeats[0].actor, 'seat-alpha');
      assert.match(addSeats[0].summary, /^Added Seat "seat-alpha"/);

      const startClarifying = byType('START_CLARIFYING')[0];
      assert.equal(startClarifying.actor, 'engine');
      assert.equal(startClarifying.summary, 'Started discovery & clarification phase');

      const publishClarification = byType('PUBLISH_CLARIFICATION')[0];
      assert.equal(publishClarification.actor, 'engine');
      assert.equal(publishClarification.summary, 'Published clarification answer for Batch 1');

      const beginRound = byType('BEGIN_ROUND')[0];
      assert.equal(beginRound.actor, 'engine');
      assert.equal(beginRound.summary, 'Began Round 1/1 proof collection');

      const seatFaults = byType('SEAT_FAULT');
      assert.equal(seatFaults.length, 2);
      assert.equal(seatFaults[0].actor, 'seat-alpha');
      assert.doesNotMatch(
        seatFaults[0].summary,
        /TimeoutError:\s*\[TimeoutError\]/,
        'Must not duplicate [TimeoutError] in SEAT_FAULT summary'
      );
      assert.match(seatFaults[0].summary, /^Seat "seat-alpha" faulted \(\[TimeoutError\]/);

      const retrySeats = byType('RETRY_SEAT');
      assert.equal(retrySeats.length, 1);
      assert.equal(retrySeats[0].actor, 'seat-alpha');
      assert.equal(retrySeats[0].summary, 'Retrying faulted Seat "seat-alpha"');

      const submitProofs = byType('SUBMIT_PROOF');
      assert.equal(submitProofs.length, 3);
      assert.equal(submitProofs[0].actor, 'seat-alpha');
      assert.equal(submitProofs[0].summary, 'Seat "seat-alpha" submitted Proof P1 [check]');

      const startJudging = byType('START_JUDGING')[0];
      assert.equal(startJudging.actor, 'judge-opus');
      assert.equal(startJudging.summary, 'Initiated Judge audit & candidate synthesis for Round 1');

      const judgeAudits = byType('JUDGE_AUDIT_AND_SYNTHESIZE');
      assert.equal(judgeAudits.length, 2);
      assert.equal(judgeAudits[0].actor, 'judge-opus');
      assert.match(
        judgeAudits[0].summary,
        /^Rejected JUDGE_AUDIT_AND_SYNTHESIZE: .*Judge Candidate Guard:/,
        'Rejected JUDGE_AUDIT_AND_SYNTHESIZE must render Rejected summary instead of false-positive success'
      );
      assert.equal(judgeAudits[1].actor, 'judge-opus');
      assert.equal(judgeAudits[1].summary, 'Judge audited proofs & synthesized Candidate with 1 clause(s)');

      const judgeFaults = byType('JUDGE_FAULT');
      assert.equal(judgeFaults.length, 1);
      assert.equal(judgeFaults[0].actor, 'judge-opus');
      assert.doesNotMatch(
        judgeFaults[0].summary,
        /InvalidResponseError:\s*\[InvalidResponseError\]/,
        'Must not duplicate [InvalidResponseError] in JUDGE_FAULT summary'
      );
      assert.match(judgeFaults[0].summary, /^Judge faulted \(\[InvalidResponseError\]/);

      const retryJudge = byType('RETRY_JUDGE')[0];
      assert.equal(retryJudge.actor, 'judge-opus');
      assert.equal(retryJudge.summary, 'Retrying faulted Judge');

      const castVotes = byType('CAST_VOTE');
      assert.equal(castVotes.length, 3);
      assert.equal(castVotes[0].actor, 'seat-alpha');
      assert.match(
        castVotes[0].summary,
        /^Rejected CAST_VOTE: .*Objection Guard:/,
        'Rejected CAST_VOTE must render Rejected summary instead of false-positive success'
      );
      assert.equal(castVotes[1].actor, 'seat-beta');
      assert.equal(castVotes[1].summary, 'Seat "seat-beta" voted ACCEPT (Round 1)');
      assert.equal(castVotes[2].actor, 'seat-gamma');
      assert.equal(castVotes[2].summary, 'Seat "seat-gamma" voted ACCEPT (Round 1)');

      const excuseSeats = byType('EXCUSE_SEAT');
      assert.equal(excuseSeats.length, 1);
      assert.equal(excuseSeats[0].actor, 'seat-alpha');
      assert.match(excuseSeats[0].summary, /^Excused Seat "seat-alpha"/);

      const evaluateRound = byType('EVALUATE_ROUND')[0];
      assert.equal(evaluateRound.actor, 'engine');
      assert.equal(evaluateRound.summary, 'Evaluated Round 1: Verdict — Unanimous Consensus');
    });

    it('handles partial states without throwing in _computeGraph', () => {
      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputPath: tmpOut
      });

      assert.doesNotThrow(() => {
        const graph = watcher._computeGraph({ phase: 'reviewing' });
        assert.ok(graph === null || typeof graph === 'object');
      });

      watcher.stop();
    });
  });

  describe('Soul Formatting Helpers (#19)', () => {
    let formatSoul;
    let renderSoulCardHtml;

    before(async () => {
      const visualizerMod = await import('../../src/visualizer/council-visualizer.js');
      const api = visualizerMod.default || globalThis.CouncilVisualizer || visualizerMod;
      formatSoul = api.formatSoul;
      renderSoulCardHtml = api.renderSoulCardHtml;
    });

    it('formats string soul as-is', () => {
      assert.equal(formatSoul('Systems & Kernel Purist'), 'Systems & Kernel Purist');
    });

    it('formats structured soul with name and lens cleanly without [object Object]', () => {
      const soul = {
        name: 'Pragmatic Systems Architect',
        temperament: 'pragmatic',
        lens: 'Operational simplicity and proven engineering patterns',
        rules: ['Demands single-binary deployment']
      };
      const formatted = formatSoul(soul);
      assert.equal(formatted, 'Pragmatic Systems Architect — Operational simplicity and proven engineering patterns');
      assert.doesNotMatch(formatted, /\[object Object\]/);
    });

    it('formats soul with name only, lens only, or temperament only', () => {
      assert.equal(formatSoul({ name: 'Systems Architect' }), 'Systems Architect');
      assert.equal(formatSoul({ lens: 'Security auditing' }), 'Security auditing');
      assert.equal(formatSoul({ temperament: 'adversarial' }), 'adversarial');
    });

    it('handles null, undefined, empty, or fallback object gracefully', () => {
      assert.equal(formatSoul(null), '');
      assert.equal(formatSoul(undefined), '');
      assert.equal(formatSoul(''), '');
      const fallback = formatSoul({ customKey: 'customValue' });
      assert.doesNotMatch(fallback, /\[object Object\]/);
    });

    it('renders structured soul card HTML without [object Object]', () => {
      const esc = (s) => String(s);
      const html = renderSoulCardHtml({
        name: 'Pragmatic Architect',
        lens: 'Simplicity'
      }, esc);
      assert.match(html, /Pragmatic Architect/);
      assert.match(html, /Simplicity/);
      assert.doesNotMatch(html, /\[object Object\]/);
    });

    it('handles non-string properties in formatSoul without crashing or emitting [object Object]', () => {
      // Numbers
      assert.doesNotThrow(() => formatSoul({ name: 42 }));
      assert.equal(formatSoul({ name: 42 }), '42');
      assert.equal(formatSoul({ lens: 100 }), '100');
      assert.equal(formatSoul({ name: 42, lens: 100 }), '42 — 100');

      // Booleans
      assert.doesNotThrow(() => formatSoul({ lens: true }));
      assert.equal(formatSoul({ lens: true }), 'true');

      // Arrays
      assert.doesNotThrow(() => formatSoul({ name: ['architect'] }));
      assert.equal(formatSoul({ name: ['architect'] }), 'architect');
      assert.doesNotThrow(() => formatSoul({ temperament: ['pragmatic', 'adversarial'] }));
      assert.equal(formatSoul({ temperament: ['pragmatic', 'adversarial'] }), 'pragmatic, adversarial');

      // Nested objects
      assert.doesNotThrow(() => formatSoul({ name: { nested: 'obj' } }));
      assert.doesNotMatch(formatSoul({ name: { nested: 'obj' } }), /\[object Object\]/);

      // Verify no [object Object] in any adversarial non-string permutation
      for (const input of [
        { name: 42 },
        { lens: true },
        { temperament: ['test'] },
        { name: null, lens: 99 },
        { temperament: 999 }
      ]) {
        const res = formatSoul(input);
        assert.doesNotMatch(res, /\[object Object\]/);
      }
    });

    it('handles non-string properties in renderSoulCardHtml without crashing or emitting [object Object]', () => {
      const esc = (s) => String(s);

      assert.doesNotThrow(() => renderSoulCardHtml({ name: 42 }, esc));
      const htmlNum = renderSoulCardHtml({ name: 42, lens: 100, temperament: 999 }, esc);
      assert.match(htmlNum, /42/);
      assert.match(htmlNum, /100/);
      assert.match(htmlNum, /999/);
      assert.doesNotMatch(htmlNum, /\[object Object\]/);

      assert.doesNotThrow(() => renderSoulCardHtml({ lens: true }, esc));
      const htmlBool = renderSoulCardHtml({ lens: true }, esc);
      assert.match(htmlBool, /true/);
      assert.doesNotMatch(htmlBool, /\[object Object\]/);

      assert.doesNotThrow(() => renderSoulCardHtml({ temperament: ['pragmatic'] }, esc));
      const htmlArr = renderSoulCardHtml({ temperament: ['pragmatic'] }, esc);
      assert.match(htmlArr, /pragmatic/);
      assert.doesNotMatch(htmlArr, /\[object Object\]/);
    });

    it('handles circular, nested, and null-prototype objects safely in formatSoul and renderSoulCardHtml', () => {
      const circular = { id: 'special' };
      circular.self = circular;

      assert.doesNotThrow(() => formatSoul(circular));
      const resSoul = formatSoul(circular);
      assert.equal(typeof resSoul, 'string');
      assert.doesNotMatch(resSoul, /\[object Object\]/);

      const esc = (s) => String(s);
      assert.doesNotThrow(() => renderSoulCardHtml(circular, esc));
      const resCard = renderSoulCardHtml(circular, esc);
      assert.equal(typeof resCard, 'string');
      assert.doesNotMatch(resCard, /\[object Object\]/);

      // Circular property inside soul.name
      const circularProp = {};
      circularProp.name = circularProp;
      assert.doesNotThrow(() => formatSoul(circularProp));
      assert.doesNotMatch(formatSoul(circularProp), /\[object Object\]/);
      assert.doesNotThrow(() => renderSoulCardHtml(circularProp, esc));
      assert.doesNotMatch(renderSoulCardHtml(circularProp, esc), /\[object Object\]/);

      const nullProto = Object.create(null);
      nullProto.name = 'Null Prototype Master';
      assert.equal(formatSoul(nullProto), 'Null Prototype Master');
    });
  });

  describe('Graph Label Truncation Helper (#19)', () => {
    let truncateAtWord;

    before(async () => {
      const visualizerMod = await import('../../src/visualizer/council-visualizer.js');
      const api = visualizerMod.default || globalThis.CouncilVisualizer || visualizerMod;
      truncateAtWord = api.truncateAtWord;
    });

    it('preserves strings within length limit without ellipsis', () => {
      assert.equal(truncateAtWord('Short label', 20), 'Short label');
    });

    it('truncates at word boundary before maxLen and appends ellipsis', () => {
      const input = 'Adaptive execution in high throughput networking';
      const truncated = truncateAtWord(input, 24);
      assert.ok(truncated.endsWith('…'));
      assert.ok(truncated.length <= 25);
      assert.equal(truncated, 'Adaptive execution in…');
    });

    it('falls back to hard cut with ellipsis if no space exists before maxLen', () => {
      const input = 'Supercalifragilisticexpialidocious';
      const truncated = truncateAtWord(input, 15);
      assert.ok(truncated.endsWith('…'));
      assert.equal(truncated.length, 15);
    });

    it('handles null, undefined, and empty string safely', () => {
      assert.equal(truncateAtWord(null), '');
      assert.equal(truncateAtWord(undefined), '');
      assert.equal(truncateAtWord(''), '');
    });

    it('handles non-positive maxLen and zero without throwing or trailing ellipsis', () => {
      assert.equal(truncateAtWord('hello world', 0), '');
      assert.equal(truncateAtWord('hello world', -1), '');
      assert.equal(truncateAtWord('hello world', -10), '');
      assert.equal(truncateAtWord('', 0), '');
      assert.equal(truncateAtWord('', -5), '');
      assert.equal(truncateAtWord('hello world', NaN), '');
      assert.equal(truncateAtWord('hello world', 1), '…');
    });

    it('safely slices multi-byte UTF-16 surrogate pairs (emojis) without producing unpaired surrogates', () => {
      const emojiStr = '🚀🔥🎉✨🌟';
      const unpairedSurrogatePattern = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

      for (let len = 1; len <= 10; len++) {
        const truncated = truncateAtWord(emojiStr, len);
        assert.equal(
          unpairedSurrogatePattern.test(truncated),
          false,
          `truncateAtWord("${emojiStr}", ${len}) returned unpaired surrogate: ${JSON.stringify(truncated)}`
        );
      }

      // Mixed text and multi-byte emojis
      const mixed = 'Deliberation 🚀 with high-throughput 🔥 clusters';
      for (let len = 5; len <= 35; len += 3) {
        const truncated = truncateAtWord(mixed, len);
        assert.equal(
          unpairedSurrogatePattern.test(truncated),
          false,
          `truncateAtWord("${mixed}", ${len}) returned unpaired surrogate: ${JSON.stringify(truncated)}`
        );
      }
    });
  });

  describe('Prototype Decoupling & File Deletions (#21, #22)', () => {
    const htmlPath = path.resolve(import.meta.dirname, '../../src/visualizer/index.html');
    const protoMachinePath = path.resolve(import.meta.dirname, '../../src/visualizer/council-machine.js');
    const protoWalkthroughsPath = path.resolve(import.meta.dirname, '../../src/visualizer/council-walkthroughs.js');

    it('ensures index.html does not load council-machine.js or council-walkthroughs.js', () => {
      const html = fs.readFileSync(htmlPath, 'utf8');
      assert.doesNotMatch(html, /council-machine\.js/);
      assert.doesNotMatch(html, /council-walkthroughs\.js/);
    });

    it('ensures index.html contains no references to CouncilMachine', () => {
      const html = fs.readFileSync(htmlPath, 'utf8');
      assert.doesNotMatch(html, /CouncilMachine/);
    });

    it('ensures index.html contains no prototype tabs or free-play controls', () => {
      const html = fs.readFileSync(htmlPath, 'utf8');
      assert.doesNotMatch(html, /wt-better-os/);
      assert.doesNotMatch(html, /wt-10-seats-quota/);
      assert.doesNotMatch(html, /wt-opus-guardrails/);
      assert.doesNotMatch(html, /Free-Play/);
      assert.doesNotMatch(html, /form-free-play/);
    });

    it('verifies src/visualizer/council-machine.js and council-walkthroughs.js are deleted', () => {
      assert.equal(fs.existsSync(protoMachinePath), false, 'council-machine.js must be deleted');
      assert.equal(fs.existsSync(protoWalkthroughsPath), false, 'council-walkthroughs.js must be deleted');
    });

    it('verifies src/visualizer/index.html includes accessible heading-graphs landmark', () => {
      const html = fs.readFileSync(htmlPath, 'utf8');
      assert.match(
        html,
        /<h2\s+id=["']heading-graphs["']\s+class=["']sr-only["']>/,
        'index.html must contain <h2 id="heading-graphs" class="sr-only">'
      );
      assert.match(
        html,
        /\.sr-only\s*\{/,
        'index.html must contain .sr-only styling'
      );
    });

    it('verifies index.html formatSoul safely handles circular objects without emitting [object Object]', () => {
      const html = fs.readFileSync(htmlPath, 'utf8');
      const formatSoulMatch = html.match(/function formatSoul\(soul\) \{[\s\S]*?\n    \}/);
      assert.ok(formatSoulMatch, 'index.html must define formatSoul function');
      const fn = new Function('soul', formatSoulMatch[0] + '\nreturn formatSoul(soul);');
      const circular = { a: 1 };
      circular.self = circular;
      const res = fn(circular);
      assert.doesNotMatch(res, /\[object Object\]/);
      assert.equal(res, '');
    });

    it('verifies index.html loads council-visualizer.js and delegates to CouncilVisualizer API', () => {
      const html = fs.readFileSync(htmlPath, 'utf8');
      assert.match(
        html,
        /<script\s+src=["']\.\/council-visualizer\.js["']>/,
        'index.html must load ./council-visualizer.js'
      );
      assert.match(
        html,
        /CouncilVisualizer\.formatSoul/,
        'index.html formatSoul must delegate to CouncilVisualizer.formatSoul'
      );
      assert.match(
        html,
        /CouncilVisualizer\.renderSoulCardHtml/,
        'index.html renderSoulCardHtml must delegate to CouncilVisualizer.renderSoulCardHtml'
      );
    });
  });

  describe('Provider Call Telemetry & End-to-End Engine Wiring (#18, #37)', () => {
    it('captures provider_call events in liveRun.providerCalls and persists to window.CouncilLatestLiveRun', () => {
      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputPath: tmpOut,
        initialConfig: { topic: 'Provider call persistence' }
      });

      assert.deepEqual(watcher.liveRun.providerCalls, []);

      emitter.emitProviderCall({
        participantId: 'astra-voter',
        provider: 'codex',
        argv: ['exec', '--ephemeral', '--disable', 'hooks', '[REDACTED prompt: length=42, sha256=deadbeefcafe]'],
        tools: 'read-only',
        exitCode: 0,
        durationMs: 1234
      });

      assert.equal(watcher.liveRun.providerCalls.length, 1);
      assert.equal(watcher.liveRun.providerCalls[0].participantId, 'astra-voter');
      assert.equal(watcher.liveRun.providerCalls[0].exitCode, 0);
      assert.equal(watcher.liveRun.providerCalls[0].durationMs, 1234);

      const fileContent = fs.readFileSync(tmpOut, 'utf8');
      const mockWindow = {};
      const runner = new Function('window', 'globalThis', fileContent);
      runner(mockWindow, mockWindow);
      assert.equal(mockWindow.CouncilLatestLiveRun.providerCalls.length, 1);
      assert.equal(mockWindow.CouncilLatestLiveRun.providerCalls[0].provider, 'codex');

      watcher.stop();
      emitter.emitProviderCall({
        participantId: 'ignored-after-stop',
        provider: 'codex',
        argv: [],
        exitCode: 0,
        durationMs: 10
      });
      assert.equal(watcher.liveRun.providerCalls.length, 1);
    });

    it('wires CouncilEngine + CodexAdapter + AntigravityAdapter + VisualizerLiveWatcher end-to-end', async () => {
      const { CouncilEngine } = await import('../../src/engine/council-engine.js');
      const { CodexAdapter } = await import('../../src/harness/codex.js');
      const { AntigravityAdapter } = await import('../../src/harness/antigravity.js');
      const { runCodexCli, runAntigravityCli } = await import('../../src/harness/cli-runner.js');

      const codexAdapter = new CodexAdapter({
        spawnRunner: (opts) =>
          runCodexCli({
            ...opts,
            exec: async (_bin, args) => {
              const prompt = args.at(-1) || '';
              if (prompt.includes('JUDGE AUDIT AND SYNTHESIS')) {
                return {
                  stdout: JSON.stringify({
                    summary: 'Synthesized candidate',
                    proofDecisions: {
                      P1: { status: 'admitted', note: 'Verified P1' },
                      P2: { status: 'admitted', note: 'Verified P2' }
                    },
                    clauses: [{ id: 'C1', context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1', 'P2'] }]
                  }),
                  stderr: '',
                  exitCode: 0
                };
              }
              if (prompt.includes('### Voting on Round')) {
                return { stdout: JSON.stringify({ vote: 'accept' }), stderr: '', exitCode: 0 };
              }
              return {
                stdout: JSON.stringify({
                  scope: 'Engine',
                  kind: 'check',
                  source: 'src/engine/council-engine.js',
                  statement: 'Codex verified statement'
                }),
                stderr: '',
                exitCode: 0
              };
            }
          })
      });

      const agyAdapter = new AntigravityAdapter({
        spawnRunner: (opts) =>
          runAntigravityCli({
            ...opts,
            exec: async (_bin, args) => {
              const printArg = args.find((a) => a.startsWith('--print=')) || '';
              if (printArg.includes('### Voting on Round')) {
                return {
                  stdout: JSON.stringify({ response: JSON.stringify({ vote: 'accept' }) }),
                  stderr: '',
                  exitCode: 0
                };
              }
              return {
                stdout: JSON.stringify({
                  response: JSON.stringify({
                    scope: 'Watcher',
                    kind: 'citation',
                    source: 'src/visualizer/live-watcher.js',
                    statement: 'AGY verified statement'
                  })
                }),
                stderr: '',
                exitCode: 0
              };
            }
          })
      });

      const engine = new CouncilEngine(
        {
          topic: 'End-to-end provider call telemetry check',
          maxRounds: 1,
          minQuorum: 2,
          maxConcurrentSeats: 2,
          judge: { id: 'judge-astra', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Impartial Judge' },
          seats: [
            { id: 'astra-voter', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Rigorous Architect' },
            { id: 'argon-voter', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Empirical Verifier' }
          ]
        },
        {
          telemetry: emitter,
          harnessResolver: (name) => (name === 'codex' ? codexAdapter : agyAdapter)
        }
      );

      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputPath: tmpOut,
        initialConfig: engine.config
      });

      const result = await engine.run();
      watcher.stop();

      assert.equal(result.ok, true);
      // 2 seat proofs + 1 judge synthesis + 2 seat votes = 5 provider calls
      const calls = emitter.getProviderCalls();
      assert.equal(calls.length, 5);
      assert.equal(result.providerCalls.length, 5);
      assert.equal(watcher.liveRun.providerCalls.length, 5);

      for (const step of watcher.liveRun.steps) {
        assert.doesNotMatch(step.summary, /undefined/, `Step summary must not contain "undefined": ${step.summary}`);
      }
      const castVoteSteps = watcher.liveRun.steps.filter((s) => s.event?.type === 'CAST_VOTE');
      assert.equal(castVoteSteps.length, 2);
      assert.equal(castVoteSteps[0].summary, 'Seat "astra-voter" voted ACCEPT (Round 1)');
      assert.equal(castVoteSteps[1].summary, 'Seat "argon-voter" voted ACCEPT (Round 1)');
      const submitProofSteps = watcher.liveRun.steps.filter((s) => s.event?.type === 'SUBMIT_PROOF');
      assert.equal(submitProofSteps.length, 2);
      assert.equal(submitProofSteps[0].summary, 'Seat "astra-voter" submitted Proof P1 [check]');
      assert.equal(submitProofSteps[1].summary, 'Seat "argon-voter" submitted Proof P2 [citation]');

      const codexCalls = calls.filter((c) => c.provider === 'codex');
      assert.equal(codexCalls.length, 3);
      for (const c of codexCalls) {
        assert.ok(c.argv.includes('--ephemeral'));
        assert.ok(c.argv.includes('--disable'));
        assert.ok(c.argv.includes('hooks'));
        assert.equal(c.exitCode, 0);
        assert.equal(typeof c.durationMs, 'number');
        assert.equal(c.tools, 'read-only');
        assert.ok(c.argv.some((a) => a.startsWith('[REDACTED prompt:')));
      }

      const agyCalls = calls.filter((c) => c.provider === 'antigravity');
      assert.equal(agyCalls.length, 2);
      for (const c of agyCalls) {
        assert.equal(c.participantId, 'argon-voter');
        assert.equal(c.exitCode, 0);
        assert.equal(typeof c.durationMs, 'number');
        assert.equal(c.tools, 'read-only');
      }
    });

    it('wires CursorAdapter into CouncilEngine providerCalls and preserves disableHooks / ignoreUserConfig across state (#37)', async () => {
      const { CouncilEngine } = await import('../../src/engine/council-engine.js');
      const { CodexAdapter } = await import('../../src/harness/codex.js');
      const { CursorAdapter } = await import('../../src/harness/cursor.js');
      const { runCodexCli, runCursorCli } = await import('../../src/harness/cli-runner.js');

      const codexAdapter = new CodexAdapter({
        spawnRunner: (opts) =>
          runCodexCli({
            ...opts,
            exec: async (_bin, args) => {
              const prompt = args.at(-1) || '';
              if (prompt.includes('JUDGE AUDIT AND SYNTHESIS')) {
                return {
                  stdout: JSON.stringify({
                    summary: 'Synthesized candidate with Cursor & Codex',
                    proofDecisions: {
                      P1: { status: 'admitted', note: 'Verified P1' },
                      P2: { status: 'admitted', note: 'Verified P2' }
                    },
                    clauses: [{ id: 'C1', context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1', 'P2'] }]
                  }),
                  stderr: '',
                  exitCode: 0
                };
              }
              if (prompt.includes('### Voting on Round')) {
                return { stdout: JSON.stringify({ vote: 'accept' }), stderr: '', exitCode: 0 };
              }
              return {
                stdout: JSON.stringify({
                  scope: 'CodexSeat',
                  kind: 'check',
                  source: 'src/harness/codex.js',
                  statement: 'Codex seat statement'
                }),
                stderr: '',
                exitCode: 0
              };
            }
          })
      });

      const cursorAdapter = new CursorAdapter({
        spawnRunner: (opts) =>
          runCursorCli({
            ...opts,
            exec: async (_bin, args) => {
              const prompt = args.at(-1) || '';
              if (prompt.includes('### Voting on Round')) {
                return { stdout: JSON.stringify({ vote: 'accept' }), stderr: '', exitCode: 0 };
              }
              return {
                stdout: JSON.stringify({
                  scope: 'CursorSeat',
                  kind: 'citation',
                  source: 'src/harness/cursor.js',
                  statement: 'Cursor seat statement'
                }),
                stderr: '',
                exitCode: 0
              };
            }
          })
      });

      const engine = new CouncilEngine(
        {
          topic: 'Preserve disableHooks and ignoreUserConfig in state',
          maxRounds: 1,
          minQuorum: 2,
          maxConcurrentSeats: 2,
          judge: {
            id: 'judge-astra',
            harness: 'codex',
            model: 'gpt-6-astra (max)',
            soul: 'Impartial Judge',
            disableHooks: false,
            ignoreUserConfig: true
          },
          seats: [
            {
              id: 'astra-voter',
              harness: 'codex',
              model: 'gpt-6-astra (max)',
              soul: 'Rigorous Architect',
              disableHooks: false,
              ignoreUserConfig: true
            },
            {
              id: 'grok-voter',
              harness: 'cursor',
              model: 'grok-4.7-high',
              soul: 'Skeptical Reviewer',
              tools: 'none'
            }
          ]
        },
        {
          telemetry: emitter,
          harnessResolver: (name) => (name === 'codex' ? codexAdapter : cursorAdapter)
        }
      );

      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputPath: tmpOut,
        initialConfig: engine.config
      });

      const result = await engine.run();
      watcher.stop();

      assert.equal(result.ok, true);
      const calls = emitter.getProviderCalls();
      assert.equal(calls.length, 5);
      assert.equal(result.providerCalls.length, 5);
      assert.equal(watcher.liveRun.providerCalls.length, 5);

      const codexCalls = calls.filter((c) => c.provider === 'codex');
      assert.equal(codexCalls.length, 3);
      for (const c of codexCalls) {
        assert.ok(c.argv.includes('--ephemeral'));
        assert.ok(
          c.argv.includes('--ignore-user-config'),
          `Expected --ignore-user-config in ${JSON.stringify(c.argv)}`
        );
        assert.equal(
          c.argv.includes('--disable'),
          false,
          `Expected disableHooks: false to omit --disable hooks in ${JSON.stringify(c.argv)}`
        );
      }

      const cursorCalls = calls.filter((c) => c.provider === 'cursor');
      assert.equal(cursorCalls.length, 2);
      for (const c of cursorCalls) {
        assert.equal(c.participantId, 'grok-voter');
        assert.equal(c.exitCode, 0);
        assert.equal(c.tools, 'none');
        assert.ok(c.argv.some((a) => a.startsWith('[REDACTED prompt:')));
      }

      // Also verify top-level config propagation and CodexAdapter constructor fallback
      const adapterWithDefaults = new CodexAdapter({
        disableHooks: false,
        ignoreUserConfig: true,
        spawnRunner: codexAdapter.spawnRunner
      });
      const emitter2 = createTelemetryEmitter();
      const engine2 = new CouncilEngine(
        {
          topic: 'Adapter constructor defaults',
          maxRounds: 1,
          minQuorum: 2,
          judge: { id: 'judge-astra', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'S1' },
            { id: 's2', harness: 'codex', model: 'gpt-6.1-sol (max)', soul: 'S2' }
          ]
        },
        {
          telemetry: emitter2,
          harnessResolver: () => adapterWithDefaults
        }
      );
      const res2 = await engine2.run();
      assert.equal(res2.ok, true);
      assert.equal(res2.providerCalls.length, 5);
      for (const c of res2.providerCalls) {
        assert.ok(c.argv.includes('--ignore-user-config'));
        assert.equal(c.argv.includes('--disable'), false);
      }

      const emitter3 = createTelemetryEmitter();
      const engine3 = new CouncilEngine(
        {
          topic: 'Top-level config defaults',
          maxRounds: 1,
          minQuorum: 2,
          disableHooks: false,
          ignoreUserConfig: true,
          judge: { id: 'judge-astra', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'S1' },
            { id: 's2', harness: 'codex', model: 'gpt-6.1-sol (max)', soul: 'S2' }
          ]
        },
        {
          telemetry: emitter3,
          harnessResolver: () => codexAdapter
        }
      );
      const res3 = await engine3.run();
      assert.equal(res3.ok, true);
      assert.equal(res3.providerCalls.length, 5);
      for (const c of res3.providerCalls) {
        assert.ok(c.argv.includes('--ignore-user-config'));
        assert.equal(c.argv.includes('--disable'), false);
      }
    });
  });

  describe('Run-Scoped Artifacts, Manifest Index, Sub-Quadratic Deltas & .gitignore (#20)', () => {
    it('defines root .gitignore covering .council/, src/visualizer/live-run-latest.js, .codegraph/, .DS_Store, node_modules/, and *.local.json', () => {
      const gitignorePath = path.resolve(import.meta.dirname, '../../.gitignore');
      assert.ok(fs.existsSync(gitignorePath), '.gitignore must exist at repo root');
      const content = fs.readFileSync(gitignorePath, 'utf8');
      assert.match(content, /^\.council\/?$/m);
      assert.match(content, /^src\/visualizer\/live-run-latest\.js$/m);
      assert.match(content, /^\.codegraph\/?$/m);
      assert.match(content, /^\.DS_Store$/m);
      assert.match(content, /^node_modules\/?$/m);
      assert.match(content, /^\*\.local\.json$/m);
    });

    it('defaults outputDir to <PACKAGE_ROOT>/.council/runs outside src/ and persists run-scoped <runId>.js, latest.js, and index.js across consecutive runs', () => {
      const runsDir = path.join(tmpDir, 'runs');
      const emitter1 = createTelemetryEmitter();
      const watcher1 = new VisualizerLiveWatcher({
        telemetry: emitter1,
        outputDir: runsDir,
        runId: 'run-first-001',
        initialConfig: { topic: 'First Run Topic' }
      });

      emitter1.emitStateTransition(
        { type: 'EVALUATE_ROUND' },
        {
          phase: 'completed',
          round: 1,
          topic: 'First Run Topic',
          verdict: { kind: 'Unanimous Consensus', note: 'First run done' },
          seats: [],
          proofs: [],
          objections: [],
          history: ['Verdict: Unanimous Consensus']
        }
      );
      watcher1.stop();

      const emitter2 = createTelemetryEmitter();
      const watcher2 = new VisualizerLiveWatcher({
        telemetry: emitter2,
        outputDir: runsDir,
        runId: 'run-second-002',
        initialConfig: { topic: 'Second Run Topic' }
      });

      emitter2.emitStateTransition(
        { type: 'EVALUATE_ROUND' },
        {
          phase: 'completed',
          round: 2,
          topic: 'Second Run Topic',
          verdict: { kind: 'Dissent Report (Round Limit Reached)', note: 'Second run dissent' },
          seats: [],
          proofs: [],
          objections: [],
          history: ['Verdict: Dissent Report']
        }
      );
      watcher2.stop();

      // Both run artifacts + latest.js + index.js must exist
      const run1File = path.join(runsDir, 'run-first-001.js');
      const run2File = path.join(runsDir, 'run-second-002.js');
      const latestFile = path.join(runsDir, 'latest.js');
      const indexFile = path.join(runsDir, 'index.js');

      assert.ok(fs.existsSync(run1File), 'First run artifact must exist');
      assert.ok(fs.existsSync(run2File), 'Second run artifact must exist');
      assert.ok(fs.existsSync(latestFile), 'latest.js pointer must exist');
      assert.ok(fs.existsSync(indexFile), 'index.js manifest must exist');

      // Evaluate index.js, latest.js, and run-first-001.js in browser sandbox
      const win = {};
      new Function('window', 'globalThis', fs.readFileSync(indexFile, 'utf8'))(win, win);
      assert.ok(Array.isArray(win.CouncilRunIndex), 'window.CouncilRunIndex must be an array');
      assert.equal(win.CouncilRunIndex.length, 2, 'CouncilRunIndex must list both consecutive runs');
      assert.equal(win.CouncilRunIndex[0].runId, 'run-second-002', 'Newest run must be first');
      assert.equal(win.CouncilRunIndex[1].runId, 'run-first-001', 'Earlier run must be preserved');

      new Function('window', 'globalThis', fs.readFileSync(latestFile, 'utf8'))(win, win);
      assert.equal(win.CouncilLatestLiveRun.runId, 'run-second-002');
      assert.equal(win.CouncilLatestLiveRun.currentState.topic, 'Second Run Topic');

      // Switch to earlier run by loading run-first-001.js
      new Function('window', 'globalThis', fs.readFileSync(run1File, 'utf8'))(win, win);
      assert.ok(win.CouncilRuns && win.CouncilRuns['run-first-001']);
      assert.equal(win.CouncilRuns['run-first-001'].currentState.topic, 'First Run Topic');
      assert.equal(win.CouncilRuns['run-first-001'].currentState.verdict.kind, 'Unanimous Consensus');
    });

    it('stores compact stateDelta on disk so 17-step deliberation grows sub-quadratically without repeating clarifications or prior history N times, while rehydrating step.stateSnapshot at runtime', () => {
      const runsDir = path.join(tmpDir, 'subquadratic');
      const largeClarification = 'CLARIFICATION_PAYLOAD_' + 'X'.repeat(4000);
      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputDir: runsDir,
        runId: 'run-subquad',
        initialConfig: {
          topic: 'Sub-Quadratic Snapshot Scaling Test',
          seats: [
            { id: 'seat-1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Soul 1 ' + 'S'.repeat(500) },
            { id: 'seat-2', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Soul 2 ' + 'S'.repeat(500) }
          ],
          judge: { id: 'judge-1', harness: 'antigravity', model: 'claude-opus-5-5-high', soul: 'Judge Soul' }
        }
      });

      const proofs = [];
      const history = [];
      for (let i = 1; i <= 17; i++) {
        proofs.push({
          id: `P${i}`,
          seatId: i % 2 === 0 ? 'seat-2' : 'seat-1',
          round: 1,
          kind: 'check',
          scope: `Scope ${i}`,
          source: `src/file-${i}.js`,
          statement: `Statement_${i}_` + 'P'.repeat(1000),
          status: i < 10 ? 'admitted' : 'pending'
        });
        history.unshift(`Step_${i}_history_entry_` + 'H'.repeat(300));

        const state = {
          phase: i === 17 ? 'completed' : 'reviewing',
          canonicalPhase: i === 17 ? 'CONSENSUS' : 'DELIBERATION',
          round: 1,
          maxRounds: 3,
          minQuorum: 2,
          topic: 'Sub-Quadratic Snapshot Scaling Test',
          clarifications: [{ batch: 1, answer: largeClarification }],
          seats: [
            { id: 'seat-1', harness: 'codex', model: 'gpt-6-astra (max)', status: i % 2 === 0 ? 'proof_submitted' : 'thinking', retries: 0, soul: 'Soul 1 ' + 'S'.repeat(500) },
            { id: 'seat-2', harness: 'antigravity', model: 'gemini-4-argon-high', status: 'thinking', retries: 0, soul: 'Soul 2 ' + 'S'.repeat(500) }
          ],
          judge: { id: 'judge-1', harness: 'antigravity', model: 'claude-opus-5-5-high', status: 'idle', soul: 'Judge Soul' },
          proofs: structuredClone(proofs),
          objections: [],
          candidate: i >= 10 ? { round: 1, summary: 'Candidate summary', clauses: [{ id: 'C1', context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }] } : null,
          verdict: i === 17 ? { kind: 'Unanimous Consensus', note: 'Agreed' } : null,
          history: [...history]
        };

        emitter.emitStateTransition({ type: 'SUBMIT_PROOF', seatId: 'seat-1', id: `P${i}`, kind: 'check' }, state);
      }

      watcher.stop();

      const latestFile = path.join(runsDir, 'latest.js');
      const rawDisk = fs.readFileSync(latestFile, 'utf8');

      // largeClarification must appear at most twice in the serialized file (never 17+ times across every step)
      const clarificationOccurrences = rawDisk.split('CLARIFICATION_PAYLOAD_').length - 1;
      assert.ok(
        clarificationOccurrences <= 2,
        `Expected largeClarification to not be duplicated across 17 steps, found ${clarificationOccurrences} occurrences`
      );

      // Statement_1_ must appear at most twice (in currentState.proofs and the single SUBMIT_PROOF event if present, not 17 times)
      const proof1Occurrences = rawDisk.split('Statement_1_').length - 1;
      assert.ok(
        proof1Occurrences <= 2,
        `Expected Statement_1_ to not be duplicated across 17 steps, found ${proof1Occurrences} occurrences`
      );

      // Evaluate in sandbox and verify every step has rehydrated stateSnapshot & graph
      const win = {};
      new Function('window', 'globalThis', rawDisk)(win, win);
      const loaded = win.CouncilLatestLiveRun;
      assert.equal(loaded.steps.length, 17);
      assert.ok(loaded.steps[0].stateDelta, 'Step 0 must have compact stateDelta');
      assert.ok(loaded.steps[0].stateSnapshot, 'Step 0 must rehydrate stateSnapshot at runtime');
      assert.equal(loaded.steps[0].stateSnapshot.phase, 'reviewing');
      assert.equal(loaded.steps[0].stateSnapshot.seats[0].status, 'thinking');
      assert.equal(loaded.steps[1].stateSnapshot.seats[0].status, 'proof_submitted');
      assert.equal(loaded.steps[16].stateSnapshot.phase, 'completed');
      assert.equal(loaded.steps[16].stateSnapshot.verdict.kind, 'Unanimous Consensus');
    });

    it('includes run-selector dropdown and .council/runs loader scripts in src/visualizer/index.html', () => {
      const htmlPath = path.resolve(import.meta.dirname, '../../src/visualizer/index.html');
      const html = fs.readFileSync(htmlPath, 'utf8');
      assert.match(html, /id=["']run-selector["']/, 'index.html must include #run-selector dropdown');
      assert.match(html, /\.\.\/\.\.\/\.council\/runs\/index\.js/, 'index.html must load ../../.council/runs/index.js');
      assert.match(html, /\.\.\/\.\.\/\.council\/runs\/latest\.js/, 'index.html must load ../../.council/runs/latest.js');
      assert.match(html, /selectRun\s*\(/, 'index.html must define selectRun handler');
    });

    it('never pollutes caller process.cwd() when instantiated from an external directory (#27)', async () => {
      const { DEFAULT_OUTPUT_DIR } = await import('../../src/visualizer/live-watcher.js');
      const prevCwd = process.cwd();
      const tmpExtCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'council-watcher-ext-cwd-'));
      const tmpRunsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-watcher-runs-'));
      try {
        process.chdir(tmpExtCwd);
        assert.ok(!DEFAULT_OUTPUT_DIR.startsWith(tmpExtCwd), 'DEFAULT_OUTPUT_DIR must not depend on process.cwd()');

        const watcher = new VisualizerLiveWatcher({
          telemetry: emitter,
          outputDir: tmpRunsDir,
          initialConfig: { topic: 'External CWD Isolation' }
        });
        emitter.emitStateTransition({ type: 'BEGIN_ROUND' }, { phase: 'reviewing', round: 1 });
        watcher.stop();

        assert.equal(fs.existsSync(path.join(tmpExtCwd, 'src')), false, 'Must not create src/ in caller cwd');
        assert.equal(fs.existsSync(path.join(tmpExtCwd, '.council')), false, 'Must not create .council/ in caller cwd');
        assert.deepEqual(fs.readdirSync(tmpExtCwd), [], 'Caller cwd must remain completely empty');
      } finally {
        process.chdir(prevCwd);
        fs.rmSync(tmpExtCwd, { recursive: true, force: true });
        fs.rmSync(tmpRunsDir, { recursive: true, force: true });
      }
    });

    it('rehydrates step-accurate step.graph (lastEdgeId, outgoingEdges, causalLinks) and step.stateSnapshot (previousPhase, evidence, clarifications) from disk and does not clobber CouncilLatestLiveRun when loading older <runId>.js', async () => {
      const { CouncilEngine } = await import('../../src/engine/council-engine.js');
      const { MockAdapter } = await import('../../src/harness/mock.js');

      const runsDir = path.join(tmpDir, 'rehydrate-runs');
      const mockAdapter = new MockAdapter();

      const config1 = {
        topic: 'Run 1 Historical Step Graph Inspection',
        maxRounds: 2,
        minQuorum: 2,
        evidence: [
          { id: 'E1', label: 'Perf Log', source: 'perf.log', text: 'p99=8ms' }
        ],
        clarifications: [
          { batch: 1, question: 'Region?', answer: 'Single region only' }
        ],
        judge: { id: 'judge-1', harness: 'mock', model: 'm-judge', soul: 'Judge' },
        seats: [
          { id: 'seat-1', harness: 'mock', model: 'm-1', soul: 'S1' },
          { id: 'seat-2', harness: 'mock', model: 'm-2', soul: 'S2' }
        ]
      };

      const engine1 = new CouncilEngine(config1, { harnessResolver: () => mockAdapter });
      const watcher1 = new VisualizerLiveWatcher({
        telemetry: engine1.getTelemetry(),
        outputDir: runsDir,
        runId: 'run-historical-1',
        initialConfig: config1
      });
      await engine1.run();
      watcher1.stop();

      // Run a second deliberation so latest.js points to run-latest-2
      const config2 = {
        ...config1,
        topic: 'Run 2 Newer Latest Run'
      };
      const engine2 = new CouncilEngine(config2, { harnessResolver: () => mockAdapter });
      const watcher2 = new VisualizerLiveWatcher({
        telemetry: engine2.getTelemetry(),
        outputDir: runsDir,
        runId: 'run-latest-2',
        initialConfig: config2
      });
      await engine2.run();
      watcher2.stop();

      const win = {};
      const indexCode = fs.readFileSync(path.join(runsDir, 'index.js'), 'utf8');
      const latestCode = fs.readFileSync(path.join(runsDir, 'latest.js'), 'utf8');
      const run1Code = fs.readFileSync(path.join(runsDir, 'run-historical-1.js'), 'utf8');

      new Function('window', 'globalThis', indexCode)(win, win);
      new Function('window', 'globalThis', latestCode)(win, win);
      assert.equal(win.CouncilLatestLiveRun.runId, 'run-latest-2');

      // Now dynamically load the older run-historical-1.js (as index.html does when selecting an older run)
      new Function('window', 'globalThis', run1Code)(win, win);

      // Loading an older <runId>.js must populate CouncilRuns['run-historical-1'] WITHOUT clobbering CouncilLatestLiveRun!
      assert.equal(
        win.CouncilLatestLiveRun.runId,
        'run-latest-2',
        'Loading historical <runId>.js must not overwrite window.CouncilLatestLiveRun'
      );
      const run1 = win.CouncilRuns['run-historical-1'];
      assert.ok(run1, 'CouncilRuns must contain run-historical-1');

      // Find the START_CLARIFYING, PUBLISH_CLARIFICATION, BEGIN_ROUND, SUBMIT_PROOF, and completed steps in run1
      const stepStartClarifying = run1.steps.find((s) => s.event?.type === 'START_CLARIFYING');
      const stepPublishClarification = run1.steps.find((s) => s.event?.type === 'PUBLISH_CLARIFICATION');
      const stepBeginRound = run1.steps.find((s) => s.event?.type === 'BEGIN_ROUND');
      const stepSubmitProof = run1.steps.find((s) => s.event?.type === 'SUBMIT_PROOF');
      const stepCompleted = run1.steps[run1.steps.length - 1];

      assert.ok(stepStartClarifying);
      assert.ok(stepPublishClarification);
      assert.ok(stepBeginRound);
      assert.ok(stepSubmitProof);
      assert.equal(stepCompleted.stateSnapshot.phase, 'completed');

      // At START_CLARIFYING (before PUBLISH_CLARIFICATION), clarifications should be empty in that step's snapshot
      assert.equal(stepStartClarifying.stateSnapshot.clarifications.length, 0);
      // At PUBLISH_CLARIFICATION, clarifications should have 1 item
      assert.equal(stepPublishClarification.stateSnapshot.clarifications.length, 1);

      // Every rehydrated step must preserve evidence and previousPhase
      assert.equal(stepBeginRound.stateSnapshot.evidence.length, 1);
      assert.equal(stepBeginRound.stateSnapshot.evidence[0].id, 'E1');
      assert.equal(stepBeginRound.stateSnapshot.previousPhase, 'clarifying');

      // Step-specific graph: at BEGIN_ROUND, lastEdgeId must be 'e-clar-rev' (not the final 'e-eval-consensus'),
      // outgoingEdges must be non-empty, and causalLinks must be empty before proofs are submitted!
      assert.equal(stepBeginRound.graph.activeNodeId, 'reviewing');
      assert.equal(stepBeginRound.graph.lastEdgeId, 'e-clar-rev');
      assert.ok(stepBeginRound.graph.outgoingEdges.length > 0, 'Historical reviewing step must have outgoingEdges');
      assert.equal(stepBeginRound.graph.causalLinks.length, 0, 'BEGIN_ROUND step must have 0 causal links');

      // After first SUBMIT_PROOF, causalLinks must have 1 link (dep-seat-proof-P1), not all final links or 0
      assert.equal(stepSubmitProof.graph.causalLinks.length, 1);
      assert.equal(stepSubmitProof.graph.causalLinks[0].toKind, 'proof');
      assert.equal(stepSubmitProof.graph.activeNodeId, 'reviewing');

      // Execute index.html inline controller script in a mock DOM to verify selectRun, pollLiveRun race safety, and inspectStep
      const htmlPath = path.resolve(import.meta.dirname, '../../src/visualizer/index.html');
      const html = fs.readFileSync(htmlPath, 'utf8');
      const inlineScriptMatch = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);
      assert.ok(inlineScriptMatch, 'index.html must contain main inline controller script');

      const elements = new Map();
      const getEl = (id) => {
        if (!elements.has(id)) {
          elements.set(id, {
            id,
            textContent: '',
            innerHTML: '',
            value: id === 'run-selector' ? 'latest' : '',
            className: '',
            style: {},
            classList: {
              add: () => {},
              remove: () => {},
              toggle: () => {}
            },
            remove: function () {
              elements.delete(this.id);
            }
          });
        }
        return elements.get(id);
      };

      const appendedScripts = [];
      const mockDoc = {
        getElementById: (id) => getEl(id),
        createElement: (tag) => ({
          tagName: tag.toUpperCase(),
          id: '',
          src: '',
          onload: null,
          onerror: null,
          remove: function () {
            if (this.id) elements.delete(this.id);
          }
        }),
        head: {
          appendChild: (el) => {
            if (el.id) elements.set(el.id, el);
            appendedScripts.push(el);
          }
        }
      };

      const renderedGraphs = [];
      const mockVisualizer = {
        escapeHtml: (s) => String(s ?? ''),
        formatSoul: (s) => String(s ?? ''),
        renderSoulCardHtml: (s) => `<div>${String(s ?? '')}</div>`,
        renderStateMachineSVG: (_svgEl, stateArg, graphArg) => {
          renderedGraphs.push({ kind: 'state', phase: stateArg.phase, graph: graphArg });
        },
        renderCausalDependencySVG: (_svgEl, stateArg, graphArg) => {
          renderedGraphs.push({ kind: 'causal', phase: stateArg.phase, graph: graphArg });
        }
      };

      const domWin = {
        CouncilRunIndex: win.CouncilRunIndex,
        CouncilLatestLiveRun: win.CouncilLatestLiveRun,
        CouncilRuns: { 'run-latest-2': win.CouncilLatestLiveRun }
      };

      const controllerFn = new Function(
        'window',
        'globalThis',
        'document',
        'CouncilVisualizer',
        'setInterval',
        'clearInterval',
        inlineScriptMatch[1] + '\nreturn { selectRun, inspectStep, pollLiveRun, updateRunSelector };'
      );
      const controller = controllerFn(
        domWin,
        domWin,
        mockDoc,
        mockVisualizer,
        () => 123,
        () => {}
      );

      // 1. Initial renderAll() populates #run-selector with options for latest, run-latest-2, and run-historical-1
      assert.match(getEl('run-selector').innerHTML, /run-latest-2/);
      assert.match(getEl('run-selector').innerHTML, /run-historical-1/);
      assert.equal(getEl('heading-topic').textContent, 'Run 2 Newer Latest Run');

      // 2. Start a pollLiveRun() so a #script-live-reload script is in-flight, then switch to run-historical-1
      controller.pollLiveRun();
      const inFlightLiveScript = appendedScripts.find((s) => s.id === 'script-live-reload');
      assert.ok(inFlightLiveScript, 'pollLiveRun must append #script-live-reload');

      controller.selectRun('run-historical-1');
      // Dynamic script for run-historical-1.js was appended; simulate its load
      const historicalScript = appendedScripts[appendedScripts.length - 1];
      assert.match(historicalScript.src, /run-historical-1\.js/);
      new Function('window', 'globalThis', run1Code)(domWin, domWin);
      historicalScript.onload();

      assert.equal(getEl('heading-topic').textContent, 'Run 1 Historical Step Graph Inspection');
      assert.equal(getEl('run-selector').value, 'run-historical-1');

      // 3. Even if the stale in-flight pollLiveRun script onload fires late, it must NOT overwrite the selected historical run
      if (inFlightLiveScript.onload) {
        inFlightLiveScript.onload();
      }
      assert.equal(getEl('heading-topic').textContent, 'Run 1 Historical Step Graph Inspection');
      assert.equal(getEl('run-selector').value, 'run-historical-1');

      // 4. Inspecting the BEGIN_ROUND step in run-historical-1 renders that step's exact graph
      const beginRoundIdx = domWin.CouncilRuns['run-historical-1'].steps.findIndex(
        (s) => s.event?.type === 'BEGIN_ROUND'
      );
      renderedGraphs.length = 0;
      controller.inspectStep(beginRoundIdx);
      const lastStateGraph = renderedGraphs.find((g) => g.kind === 'state');
      assert.ok(lastStateGraph);
      assert.equal(lastStateGraph.phase, 'reviewing');
      assert.equal(lastStateGraph.graph.activeNodeId, 'reviewing');
      assert.equal(lastStateGraph.graph.lastEdgeId, 'e-clar-rev');

      // 5. Switching back to 'latest' restores Run 2 Newer Latest Run
      controller.selectRun('latest');
      assert.equal(getEl('heading-topic').textContent, 'Run 2 Newer Latest Run');
    });

    it('matches original deep-cloned state and graph at every transition (ADD_SEAT, BEGIN_ROUND, SEAT_FAULT, RETRY_SEAT, EXCUSE_SEAT, SUBMIT_PROOF, START_JUDGING, JUDGE_AUDIT_AND_SYNTHESIZE, CAST_VOTE, EVALUATE_ROUND) without leaking future seats, future judgeNote, or dropping duplicate consecutive history entries', async () => {
      const { CouncilEngine } = await import('../../src/engine/council-engine.js');
      const { MockAdapter } = await import('../../src/harness/mock.js');
      const { QuotaExhaustionError } = await import('../../src/harness/adapter.js');
      const { getDependencyAndStateGraph, transitionCouncil } = await import('../../src/machine/reducer.js');
      const { createInitialCouncilState } = await import('../../src/machine/state.js');

      const runsDir = path.join(tmpDir, 'rehydrate-fidelity');
      const mockAdapter = new MockAdapter();
      // Script seat-2 to object in round 1 so objections and multi-round proof judgeNote transitions are exercised
      mockAdapter.scriptSeatResponse({
        seatId: 'seat-2',
        round: 1,
        phase: 'VOTING',
        response: { vote: 'object', reason: 'Needs round 2 refinement', proofId: 'P2' }
      });
      // Inject a fault on seat-3 in round 1 (retried once, then excused on second trigger)
      mockAdapter.injectSeatFault('seat-3', {
        round: 1,
        phase: 'DELIBERATION',
        maxTriggers: 2,
        error: new QuotaExhaustionError('Rate limit 429 on seat-3')
      });

      const config = {
        topic: 'Step-by-Step Rehydration Fidelity Test',
        maxRounds: 2,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        clarifications: [{ question: 'Env?', answer: 'Linux containers' }],
        judge: { id: 'judge-1', harness: 'mock', model: 'm-judge', soul: 'Judge' },
        seats: [
          { id: 'seat-1', harness: 'mock', model: 'm-1', soul: 'S1' },
          { id: 'seat-2', harness: 'mock', model: 'm-2', soul: 'S2' },
          { id: 'seat-3', harness: 'mock', model: 'm-3', soul: 'S3' }
        ]
      };

      const engine = new CouncilEngine(config, { harnessResolver: () => mockAdapter });
      const capturedSnapshots = [];
      engine.getTelemetry().on('state_transition', ({ event, state }) => {
        capturedSnapshots.push({
          eventType: event?.type,
          state: structuredClone(state),
          graph: structuredClone(getDependencyAndStateGraph(state))
        });
      });

      const watcher = new VisualizerLiveWatcher({
        telemetry: engine.getTelemetry(),
        outputDir: runsDir,
        runId: 'run-fidelity-check',
        initialConfig: config
      });

      await engine.run();
      watcher.stop();

      const win = {};
      const bundleCode = fs.readFileSync(path.join(runsDir, 'run-fidelity-check.js'), 'utf8');
      new Function('window', 'globalThis', bundleCode)(win, win);
      const rehydratedRun = win.CouncilRuns['run-fidelity-check'];

      assert.equal(rehydratedRun.steps.length, capturedSnapshots.length);
      assert.ok(capturedSnapshots.some((s) => s.eventType === 'ADD_SEAT'));
      assert.ok(capturedSnapshots.some((s) => s.eventType === 'BEGIN_ROUND'));
      assert.ok(capturedSnapshots.some((s) => s.eventType === 'SEAT_FAULT'));
      assert.ok(capturedSnapshots.some((s) => s.eventType === 'RETRY_SEAT'));
      assert.ok(capturedSnapshots.some((s) => s.eventType === 'EXCUSE_SEAT'));
      assert.ok(capturedSnapshots.some((s) => s.eventType === 'SUBMIT_PROOF'));
      assert.ok(capturedSnapshots.some((s) => s.eventType === 'START_JUDGING'));
      assert.ok(capturedSnapshots.some((s) => s.eventType === 'JUDGE_AUDIT_AND_SYNTHESIZE'));
      assert.ok(capturedSnapshots.some((s) => s.eventType === 'CAST_VOTE'));
      assert.ok(capturedSnapshots.some((s) => s.eventType === 'EVALUATE_ROUND'));

      // Specifically check Step 0 (ADD_SEAT for seat-1): seat-2 and seat-3 must NOT leak into Step 0
      assert.equal(capturedSnapshots[0].eventType, 'ADD_SEAT');
      assert.equal(rehydratedRun.steps[0].stateSnapshot.seats.length, 1);
      assert.equal(rehydratedRun.steps[0].stateSnapshot.seats[0].id, 'seat-1');
      assert.equal(rehydratedRun.steps[0].stateSnapshot.seats[0].status, 'idle');

      // Specifically check pending proof before judging: judgeNote must be null, not leaked from future JUDGE_AUDIT_AND_SYNTHESIZE
      const firstSubmitIdx = capturedSnapshots.findIndex((s) => s.eventType === 'SUBMIT_PROOF');
      assert.ok(firstSubmitIdx >= 0);
      assert.equal(rehydratedRun.steps[firstSubmitIdx].stateSnapshot.proofs.length, 1);
      assert.equal(rehydratedRun.steps[firstSubmitIdx].stateSnapshot.proofs[0].status, 'pending');
      assert.equal(rehydratedRun.steps[firstSubmitIdx].stateSnapshot.proofs[0].judgeNote, null);

      for (let i = 0; i < capturedSnapshots.length; i++) {
        const expected = capturedSnapshots[i].state;
        const expectedGraph = capturedSnapshots[i].graph;
        const actualDisk = rehydratedRun.steps[i].stateSnapshot;
        const actualMem = watcher.liveRun.steps[i].stateSnapshot;

        for (const actual of [actualDisk, actualMem]) {
          assert.equal(actual.phase, expected.phase, `Step ${i} (${capturedSnapshots[i].eventType}) phase mismatch`);
          assert.equal(actual.previousPhase, expected.previousPhase, `Step ${i} previousPhase mismatch`);
          assert.equal(actual.returnPhase, expected.returnPhase, `Step ${i} returnPhase mismatch`);
          assert.equal(actual.faultSeatId, expected.faultSeatId, `Step ${i} faultSeatId mismatch`);
          assert.equal(actual.maxRetriesPerSeat, expected.maxRetriesPerSeat, `Step ${i} maxRetriesPerSeat mismatch`);
          assert.equal(actual.round, expected.round, `Step ${i} round mismatch`);
          assert.deepEqual(actual.seats, expected.seats, `Step ${i} (${capturedSnapshots[i].eventType}) seats mismatch`);
          assert.deepEqual(actual.proofs, expected.proofs, `Step ${i} (${capturedSnapshots[i].eventType}) proofs mismatch`);
          assert.deepEqual(actual.objections, expected.objections, `Step ${i} (${capturedSnapshots[i].eventType}) objections mismatch`);
          assert.deepEqual(actual.candidate, expected.candidate, `Step ${i} (${capturedSnapshots[i].eventType}) candidate mismatch`);
          assert.deepEqual(actual.verdict, expected.verdict, `Step ${i} (${capturedSnapshots[i].eventType}) verdict mismatch`);
          assert.deepEqual(actual.history, expected.history, `Step ${i} (${capturedSnapshots[i].eventType}) history mismatch`);
        }
        assert.deepEqual(rehydratedRun.steps[i].graph, expectedGraph, `Step ${i} disk graph mismatch`);
        assert.deepEqual(watcher.liveRun.steps[i].graph, expectedGraph, `Step ${i} mem graph mismatch`);
      }

      // Also verify two consecutive identical guard-rejected transitions preserve both identical history[0] entries
      const dupHistEmitter = createTelemetryEmitter();
      const dupWatcher = new VisualizerLiveWatcher({
        telemetry: dupHistEmitter,
        outputDir: runsDir,
        runId: 'run-dup-history'
      });
      let s = createInitialCouncilState({ topic: 'Dup History Test', minQuorum: 2 });
      s = transitionCouncil(s, { type: 'BEGIN_ROUND' }); // Rejected #1 (0 active seats < 2)
      dupHistEmitter.emitStateTransition({ type: 'BEGIN_ROUND' }, s);
      s = transitionCouncil(s, { type: 'BEGIN_ROUND' }); // Rejected #2 (identical history[0] string!)
      dupHistEmitter.emitStateTransition({ type: 'BEGIN_ROUND' }, s);
      dupWatcher.stop();

      assert.equal(dupWatcher.liveRun.steps[0].stateSnapshot.history.length, 2);
      assert.equal(dupWatcher.liveRun.steps[1].stateSnapshot.history.length, 3);
      assert.equal(
        dupWatcher.liveRun.steps[1].stateSnapshot.history[0],
        dupWatcher.liveRun.steps[1].stateSnapshot.history[1]
      );
    });

    it('records O(1) incremental step deltas (seatChanges, proofChanges, objectionChanges) without retaining eager clonedState/clonedGraph values in memory, and preserves concurrent runs via <runId>.meta.json', () => {
      const runsDir = path.join(tmpDir, 'concurrent-and-incremental');
      const emitterA = createTelemetryEmitter();
      const emitterB = createTelemetryEmitter();

      const watcherA = new VisualizerLiveWatcher({
        telemetry: emitterA,
        outputDir: runsDir,
        runId: 'run-concurrent-A',
        initialConfig: {
          topic: 'Concurrent Run A',
          seats: [
            { id: 's1', harness: 'mock', model: 'm1', soul: 'Soul 1' },
            { id: 's2', harness: 'mock', model: 'm2', soul: 'Soul 2' }
          ]
        }
      });

      const watcherB = new VisualizerLiveWatcher({
        telemetry: emitterB,
        outputDir: runsDir,
        runId: 'run-concurrent-B',
        initialConfig: {
          topic: 'Concurrent Run B',
          seats: [
            { id: 's1', harness: 'mock', model: 'm1', soul: 'Soul 1' },
            { id: 's2', harness: 'mock', model: 'm2', soul: 'Soul 2' }
          ]
        }
      });

      // Interleave state transitions across watcherA and watcherB
      const proofsA = [];
      for (let i = 1; i <= 10; i++) {
        proofsA.push({
          id: `P${i}`,
          seatId: i % 2 === 0 ? 's2' : 's1',
          round: 1,
          kind: 'check',
          scope: 'Scope',
          source: 'src.js',
          statement: `Stmt ${i}`,
          status: 'pending',
          judgeNote: null
        });
        emitterA.emitStateTransition(
          { type: 'SUBMIT_PROOF', seatId: 's1', id: `P${i}`, kind: 'check' },
          {
            phase: 'reviewing',
            round: 1,
            topic: 'Concurrent Run A',
            seats: [
              { id: 's1', harness: 'mock', model: 'm1', soul: 'Soul 1', status: 'proof_submitted', retries: 0, excusedReason: null },
              { id: 's2', harness: 'mock', model: 'm2', soul: 'Soul 2', status: 'thinking', retries: 0, excusedReason: null }
            ],
            judge: { id: 'j1', status: 'idle' },
            proofs: structuredClone(proofsA),
            objections: [],
            history: [`Step ${i}`]
          }
        );
      }

      emitterB.emitStateTransition(
        { type: 'EVALUATE_ROUND' },
        {
          phase: 'completed',
          round: 1,
          topic: 'Concurrent Run B',
          verdict: { kind: 'Unanimous Consensus', note: 'Done B' },
          seats: [],
          proofs: [],
          objections: [],
          history: ['Done B']
        }
      );

      watcherA.stop();
      watcherB.stop();

      // 1. Each step in watcherA only records the newly added proof in proofChanges (1 per step = 10 total, not 10*11/2 = 55)
      const totalProofDeltaEntries = watcherA.liveRun.steps.reduce(
        (acc, st) => acc + (st.stateDelta.proofChanges || []).length,
        0
      );
      assert.equal(totalProofDeltaEntries, 10, 'Incremental proofChanges across 10 proof steps must be linear (10), not quadratic (55)');

      // Seats did not change after step 0, so steps 1..9 must have empty seatChanges
      for (let i = 1; i < watcherA.liveRun.steps.length; i++) {
        assert.equal(watcherA.liveRun.steps[i].stateDelta.seatChanges.length, 0);
      }

      // 2. stepRecord.stateSnapshot and stepRecord.graph must be lazy non-enumerable getters, not retained value properties
      const step0Desc = Object.getOwnPropertyDescriptor(watcherA.liveRun.steps[0], 'stateSnapshot');
      const graph0Desc = Object.getOwnPropertyDescriptor(watcherA.liveRun.steps[0], 'graph');
      assert.ok(step0Desc && typeof step0Desc.get === 'function', 'stateSnapshot must be a lazy getter on stepRecord');
      assert.equal(step0Desc.enumerable, false);
      assert.ok(graph0Desc && typeof graph0Desc.get === 'function', 'graph must be a lazy getter on stepRecord');
      assert.equal(graph0Desc.enumerable, false);

      // 3. Both concurrent runs have their own <runId>.meta.json and <runId>.js and both are preserved in index.js
      assert.ok(fs.existsSync(path.join(runsDir, 'run-concurrent-A.meta.json')));
      assert.ok(fs.existsSync(path.join(runsDir, 'run-concurrent-B.meta.json')));
      assert.ok(fs.existsSync(path.join(runsDir, 'run-concurrent-A.js')));
      assert.ok(fs.existsSync(path.join(runsDir, 'run-concurrent-B.js')));

      const win = {};
      new Function('window', 'globalThis', fs.readFileSync(path.join(runsDir, 'index.js'), 'utf8'))(win, win);
      const indexedIds = win.CouncilRunIndex.map((e) => e.runId);
      assert.ok(indexedIds.includes('run-concurrent-A'), 'CouncilRunIndex must preserve run-concurrent-A');
      assert.ok(indexedIds.includes('run-concurrent-B'), 'CouncilRunIndex must preserve run-concurrent-B');
    });

    it('getLiveRun() returns null while historical run is still loading and selectRun ignores out-of-order stale script.onload', () => {
      const htmlPath = path.resolve(import.meta.dirname, '../../src/visualizer/index.html');
      const html = fs.readFileSync(htmlPath, 'utf8');
      const inlineScriptMatch = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);
      assert.ok(inlineScriptMatch);

      const elements = new Map();
      const getEl = (id) => {
        if (!elements.has(id)) {
          elements.set(id, {
            id,
            textContent: '',
            innerHTML: '',
            value: id === 'run-selector' ? 'latest' : '',
            className: '',
            style: {},
            classList: { add: () => {}, remove: () => {}, toggle: () => {} },
            remove: function () {
              elements.delete(this.id);
            }
          });
        }
        return elements.get(id);
      };

      const appendedScripts = [];
      const mockDoc = {
        getElementById: (id) => getEl(id),
        createElement: (tag) => ({
          tagName: tag.toUpperCase(),
          id: '',
          src: '',
          onload: null,
          onerror: null,
          remove: function () {
            if (this.id) elements.delete(this.id);
          }
        }),
        head: {
          appendChild: (el) => {
            appendedScripts.push(el);
          }
        }
      };

      const mockVisualizer = {
        escapeHtml: (s) => String(s ?? ''),
        formatSoul: (s) => String(s ?? ''),
        renderSoulCardHtml: (s) => `<div>${String(s ?? '')}</div>`,
        renderStateMachineSVG: () => {},
        renderCausalDependencySVG: () => {}
      };

      const domWin = {
        CouncilRunIndex: [
          { runId: 'run-2', topic: 'Topic Run 2', isRunning: false },
          { runId: 'run-1', topic: 'Topic Run 1', isRunning: false }
        ],
        CouncilLatestLiveRun: {
          runId: 'run-latest',
          currentState: {
            topic: 'Latest Topic',
            phase: 'reviewing',
            round: 1,
            maxRounds: 3,
            minQuorum: 2,
            seats: [],
            proofs: [],
            objections: [],
            history: []
          },
          steps: []
        },
        CouncilRuns: {}
      };

      const controllerFn = new Function(
        'window',
        'globalThis',
        'document',
        'CouncilVisualizer',
        'setInterval',
        'clearInterval',
        inlineScriptMatch[1] + '\nreturn { selectRun, getLiveRun };'
      );
      const controller = controllerFn(domWin, domWin, mockDoc, mockVisualizer, () => 123, () => {});

      // Select 'run-1' (not yet in CouncilRuns) -> appends script1
      controller.selectRun('run-1');
      const script1 = appendedScripts[appendedScripts.length - 1];
      assert.match(script1.src, /run-1\.js/);

      // While 'run-1' is still loading (not in CouncilRuns), getLiveRun() must return null, NOT CouncilLatestLiveRun
      assert.equal(controller.getLiveRun(), null, 'getLiveRun() must return null when selected historical run is not loaded yet');

      // Before script1 finishes loading, user switches to 'run-2' -> appends script2
      controller.selectRun('run-2');
      const script2 = appendedScripts[appendedScripts.length - 1];
      assert.match(script2.src, /run-2\.js/);

      // script2 loads first
      domWin.CouncilRuns['run-2'] = {
        runId: 'run-2',
        currentState: {
          topic: 'Topic Run 2 Loaded',
          phase: 'completed',
          round: 1,
          maxRounds: 3,
          minQuorum: 2,
          seats: [],
          proofs: [],
          objections: [],
          history: []
        },
        steps: []
      };
      script2.onload();
      assert.equal(getEl('heading-topic').textContent, 'Topic Run 2 Loaded');

      // Now stale script1 for 'run-1' finishes loading late -> must be ignored!
      domWin.CouncilRuns['run-1'] = {
        runId: 'run-1',
        currentState: {
          topic: 'Stale Topic Run 1',
          phase: 'completed',
          round: 1,
          maxRounds: 3,
          minQuorum: 2,
          seats: [],
          proofs: [],
          objections: [],
          history: []
        },
        steps: []
      };
      script1.onload();
      assert.equal(
        getEl('heading-topic').textContent,
        'Topic Run 2 Loaded',
        'Out-of-order onload for run-1 must not clobber currently selected run-2'
      );
    });

    it('guards selectRun against A -> B -> A stale script.onload, resets all DOM panels when !councilState or script.onerror, and renders #proofs-list and seat proof badges (#53)', () => {
      const htmlPath = path.resolve(import.meta.dirname, '../../src/visualizer/index.html');
      const html = fs.readFileSync(htmlPath, 'utf8');
      assert.match(html, /id=["']proofs-list["']/, 'index.html must contain #proofs-list');
      assert.match(html, /id=["']lbl-proofs-count["']/, 'index.html must contain #lbl-proofs-count');
      const inlineScriptMatch = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);
      assert.ok(inlineScriptMatch);

      const elements = new Map();
      const getEl = (id) => {
        if (!elements.has(id)) {
          elements.set(id, {
            id,
            textContent: '',
            innerHTML: '',
            value: id === 'run-selector' ? 'latest' : '',
            className: '',
            style: {},
            classList: { add: () => {}, remove: () => {}, toggle: () => {} },
            remove: function () {
              elements.delete(this.id);
            }
          });
        }
        return elements.get(id);
      };

      const appendedScripts = [];
      const mockDoc = {
        getElementById: (id) => getEl(id),
        createElement: (tag) => ({
          tagName: tag.toUpperCase(),
          id: '',
          src: '',
          onload: null,
          onerror: null,
          remove: function () {
            if (this.id) elements.delete(this.id);
          }
        }),
        head: {
          appendChild: (el) => {
            appendedScripts.push(el);
          }
        }
      };

      const mockVisualizer = {
        escapeHtml: (s) => String(s ?? ''),
        formatSoul: (s) => String(s ?? ''),
        renderSoulCardHtml: (s) => `<div>${String(s ?? '')}</div>`,
        renderStateMachineSVG: () => {},
        renderCausalDependencySVG: () => {}
      };

      const domWin = {
        CouncilRunIndex: [
          { runId: 'run-A', topic: 'Topic A', isRunning: false },
          { runId: 'run-B', topic: 'Topic B', isRunning: false },
          { runId: 'run-missing', topic: 'Missing Run', isRunning: false }
        ],
        CouncilLatestLiveRun: {
          runId: 'run-latest',
          currentState: {
            topic: 'Latest Deliberation with Proofs',
            phase: 'completed',
            round: 1,
            maxRounds: 3,
            minQuorum: 2,
            verdict: { kind: 'Unanimous Consensus', note: 'Consensus reached' },
            candidate: {
              summary: 'Synthesized candidate summary',
              clauses: [{ id: 'C1', context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
            },
            judge: { id: 'judge-astra', harness: 'codex', model: 'gpt-6-astra (max)', status: 'idle', soul: 'Judge' },
            seats: [
              { id: 'sol-voter', harness: 'codex', model: 'gpt-6.1-sol (max)', status: 'accepted', soul: 'Sol', retries: 0 },
              { id: 'argon-voter', harness: 'antigravity', model: 'gemini-4-argon-high', status: 'accepted', soul: 'Argon', retries: 0 },
              { id: 'silent-voter', harness: 'antigravity', model: 'claude-opus-5-5-high', status: 'excused', soul: 'Opus', retries: 1, excusedReason: 'Quota exceeded' }
            ],
            proofs: [
              {
                id: 'P1',
                seatId: 'sol-voter',
                kind: 'citation',
                scope: 'Aerodynamics',
                source: 'NASM 1903',
                statement: 'Sustained controlled flight verified.',
                status: 'admitted',
                judgeNote: 'Admitted: primary archival record.'
              },
              {
                id: 'P2',
                seatId: 'argon-voter',
                kind: 'check',
                scope: 'Secondary Claim',
                source: 'Blog Post',
                statement: 'Unverified secondary claim.',
                status: 'rejected',
                judgeNote: 'Rejected: lacks primary evidence.'
              }
            ],
            objections: [],
            history: ['Completed']
          },
          steps: [
            {
              label: 'Step 1: Pending Proof',
              stateSnapshot: {
                topic: 'Latest Deliberation with Proofs',
                phase: 'reviewing',
                round: 1,
                maxRounds: 3,
                minQuorum: 2,
                seats: [
                  { id: 'sol-voter', harness: 'codex', model: 'gpt-6.1-sol (max)', status: 'proof_submitted', soul: 'Sol', retries: 0 },
                  { id: 'argon-voter', harness: 'antigravity', model: 'gemini-4-argon-high', status: 'thinking', soul: 'Argon', retries: 0 }
                ],
                proofs: [
                  {
                    id: 'P1',
                    seatId: 'sol-voter',
                    kind: 'citation',
                    scope: 'Aerodynamics',
                    source: 'NASM 1903',
                    statement: 'Sustained controlled flight verified.',
                    status: 'pending',
                    judgeNote: null
                  }
                ],
                objections: [],
                history: ['Step 1']
              }
            }
          ]
        },
        CouncilRuns: {}
      };

      const controllerFn = new Function(
        'window',
        'globalThis',
        'document',
        'CouncilVisualizer',
        'setInterval',
        'clearInterval',
        inlineScriptMatch[1] + '\nreturn { selectRun, inspectStep, restoreLatestSnapshot };'
      );
      const controller = controllerFn(domWin, domWin, mockDoc, mockVisualizer, () => 123, () => {});

      // 1. Verify #proofs-list and seat proof badges on initial render of Latest Run
      assert.equal(getEl('lbl-proofs-count').textContent, '2 proofs');
      assert.match(getEl('proofs-list').innerHTML, /P1/);
      assert.match(getEl('proofs-list').innerHTML, /admitted/);
      assert.match(getEl('proofs-list').innerHTML, /Seat: sol-voter/);
      assert.match(getEl('proofs-list').innerHTML, /Judge Note:<\/strong> Admitted: primary archival record\./);
      assert.match(getEl('proofs-list').innerHTML, /P2/);
      assert.match(getEl('proofs-list').innerHTML, /rejected/);
      assert.match(getEl('proofs-list').innerHTML, /Rejected: lacks primary evidence\./);
      assert.match(getEl('seats-grid').innerHTML, /P1: admitted/);
      assert.match(getEl('seats-grid').innerHTML, /P2: rejected/);
      assert.match(getEl('seats-grid').innerHTML, /Proofs: none/);

      // 2. Scrubbing to historical Step 0 updates #proofs-list and seat badges to pending state
      controller.inspectStep(0);
      assert.equal(getEl('lbl-proofs-count').textContent, '1 proof');
      assert.match(getEl('proofs-list').innerHTML, /pending/);
      assert.doesNotMatch(getEl('proofs-list').innerHTML, /Admitted: primary archival record/);
      assert.match(getEl('seats-grid').innerHTML, /P1: pending/);
      controller.restoreLatestSnapshot();
      assert.equal(getEl('lbl-proofs-count').textContent, '2 proofs');

      // 3. Test A -> B -> A sequence: selectRun('run-A'), then selectRun('run-B'), then selectRun('run-A') again
      controller.selectRun('run-A');
      const scriptA1 = appendedScripts[appendedScripts.length - 1];
      // Immediately upon selecting an unloaded run, stale panels from previous run must be cleared
      assert.equal(getEl('seats-grid').innerHTML, '');
      assert.equal(getEl('lbl-proofs-count').textContent, '0 proofs');
      assert.match(getEl('proofs-list').innerHTML, /No proofs submitted yet/);
      assert.match(getEl('clauses-list').innerHTML, /No candidate clauses synthesized yet/);

      controller.selectRun('run-B');
      controller.selectRun('run-A');
      const scriptA2 = appendedScripts[appendedScripts.length - 1];
      assert.notEqual(scriptA1, scriptA2);

      // Suppose scriptA1 (stale first request for run-A) fires onload with stale data -> must be ignored by reqId guard!
      domWin.CouncilRuns['run-A'] = {
        runId: 'run-A',
        currentState: {
          topic: 'Stale First Request Run A',
          phase: 'reviewing',
          round: 1,
          seats: [],
          proofs: [],
          objections: [],
          history: []
        },
        steps: []
      };
      scriptA1.onload();
      assert.notEqual(
        getEl('heading-topic').textContent,
        'Stale First Request Run A',
        'First scriptA1 onload in A -> B -> A sequence must be ignored by monotonic request counter'
      );

      // Now scriptA2 (current request for run-A) fires onload with fresh data -> must render!
      domWin.CouncilRuns['run-A'] = {
        runId: 'run-A',
        currentState: {
          topic: 'Fresh Second Request Run A',
          phase: 'completed',
          round: 1,
          seats: [],
          proofs: [],
          objections: [],
          history: []
        },
        steps: []
      };
      scriptA2.onload();
      assert.equal(getEl('heading-topic').textContent, 'Fresh Second Request Run A');

      // 4. Test script.onerror: selecting a missing/corrupt run clears stale state and displays failure message
      controller.selectRun('run-missing');
      const scriptMissing = appendedScripts[appendedScripts.length - 1];
      scriptMissing.onerror();
      assert.equal(getEl('badge-live-tag').textContent, 'Run: run-missing');
      assert.equal(getEl('heading-topic').textContent, 'Failed to load run run-missing.');
      assert.equal(getEl('seats-grid').innerHTML, '');
      assert.equal(getEl('lbl-proofs-count').textContent, '0 proofs');
    });

    it('evicts deleted runs from index.js when neither <runId>.js nor <runId>.meta.json exists on disk', () => {
      const runsDir = path.join(tmpDir, 'deleted-run-eviction');
      const emitter1 = createTelemetryEmitter();
      const watcher1 = new VisualizerLiveWatcher({
        telemetry: emitter1,
        outputDir: runsDir,
        runId: 'run-to-delete',
        initialConfig: { topic: 'Deleted Run Topic' }
      });
      watcher1.stop();

      assert.ok(fs.existsSync(path.join(runsDir, 'run-to-delete.js')));
      assert.ok(fs.existsSync(path.join(runsDir, 'run-to-delete.meta.json')));

      // Delete both <runId>.js and <runId>.meta.json from disk while leaving index.js intact
      fs.unlinkSync(path.join(runsDir, 'run-to-delete.js'));
      fs.unlinkSync(path.join(runsDir, 'run-to-delete.meta.json'));

      // Run a new watcher in the same directory
      const emitter2 = createTelemetryEmitter();
      const watcher2 = new VisualizerLiveWatcher({
        telemetry: emitter2,
        outputDir: runsDir,
        runId: 'run-surviving',
        initialConfig: { topic: 'Surviving Run Topic' }
      });
      watcher2.stop();

      const win = {};
      new Function('window', 'globalThis', fs.readFileSync(path.join(runsDir, 'index.js'), 'utf8'))(win, win);
      const indexedIds = win.CouncilRunIndex.map((e) => e.runId);
      assert.deepEqual(indexedIds, ['run-surviving'], 'Deleted run must not be resurrected from stale index.js');
    });
  });
});



