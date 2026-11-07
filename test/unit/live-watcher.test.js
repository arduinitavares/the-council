/**
 * @fileoverview Unit tests for VisualizerLiveWatcher (Pure Observer Telemetry Subscriber).
 * Verifies live telemetry subscription, atomic file persistence, stop() lifecycle cleanup,
 * and visualizer HTML integration for file:// Live Follow mode.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
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

      const diskContent = fs.readFileSync(tmpOut, 'utf8');
      const mockWindow = {};
      const evalFn = new Function('window', 'globalThis', diskContent);
      evalFn(mockWindow, {});

      assert.equal(mockWindow.CouncilLatestLiveRun.isRunning, false);
      assert.equal(mockWindow.CouncilLatestLiveRun.currentState.phase, 'completed');
      assert.equal(mockWindow.CouncilLatestLiveRun.currentState.verdict?.kind, 'Dissent Report (Judge Fault)');

      watcher.stop();
    });
  });
});
