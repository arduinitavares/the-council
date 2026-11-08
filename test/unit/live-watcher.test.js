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
    const htmlPath = path.resolve('src/visualizer/index.html');

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
      assert.equal(watcher.liveRun.steps[0].actor, 'judge-1');
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
    const htmlPath = path.resolve('src/visualizer/index.html');
    const protoMachinePath = path.resolve('src/visualizer/council-machine.js');
    const protoWalkthroughsPath = path.resolve('src/visualizer/council-walkthroughs.js');

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
});


