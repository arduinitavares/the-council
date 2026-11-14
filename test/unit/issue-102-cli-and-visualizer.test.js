import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { VisualizerLiveWatcher, getTransitionSummary } from '../../src/visualizer/live-watcher.js';
import { CouncilTelemetryEmitter } from '../../src/telemetry/emitter.js';
import { buildRunTelemetryRecord, canonicalizeModelKey, persistRunTelemetry } from '../../src/telemetry/ledger.js';

function makeDiag(overrides = {}) {
  return {
    participantId: 's1',
    role: 'seat',
    phase: 'DELIBERATION',
    round: 1,
    attempt: 1,
    requestedModel: 'gemini-4-argon-high',
    requestedEffort: 'high',
    effectiveModel: 'gemini-4-argon-medium',
    effectiveEffort: 'medium',
    capabilityProvenance: 'adapter_static_policy',
    fallbackEnabled: true,
    fallbackApplied: true,
    fallbackReason: 'TimeoutError',
    tools: 'none',
    ...overrides
  };
}

function createIndexHtmlHarness(initialRun) {
  const html = fs.readFileSync(path.resolve('src/visualizer/index.html'), 'utf8');
  const scriptMatches = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  const inlineScript = scriptMatches
    .map((m) => m[1] || '')
    .filter((code) => code.trim().length > 0)
    .join('\n');

  const elements = new Map();
  const makeEl = (id) => {
    const classSet = new Set();
    const attrs = new Map();
    const el = {
      id,
      _innerHTML: '',
      _textContent: '',
      value: '',
      disabled: false,
      style: {
        _props: new Map(),
        setProperty(k, v) {
          this._props.set(k, v);
        }
      },
      dataset: {},
      classList: {
        add(...names) {
          names.forEach((n) => classSet.add(n));
        },
        remove(...names) {
          names.forEach((n) => classSet.delete(n));
        },
        toggle(name, force) {
          if (force === undefined) {
            if (classSet.has(name)) classSet.delete(name);
            else classSet.add(name);
            return classSet.has(name);
          }
          if (force) classSet.add(name);
          else classSet.delete(name);
          return Boolean(force);
        },
        contains(name) {
          return classSet.has(name);
        }
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
      },
      getAttribute(k) {
        return attrs.has(k) ? attrs.get(k) : null;
      },
      addEventListener() {},
      removeEventListener() {},
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      appendChild() {},
      scrollIntoView() {},
      focus() {},
      contains() {
        return false;
      }
    };
    Object.defineProperty(el, 'innerHTML', {
      get() {
        return this._innerHTML;
      },
      set(v) {
        this._innerHTML = String(v);
      }
    });
    Object.defineProperty(el, 'textContent', {
      get() {
        return this._textContent;
      },
      set(v) {
        this._textContent = String(v);
      }
    });
    return el;
  };

  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  };

  const doc = {
    getElementById: getEl,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => makeEl(`created-${tag}`),
    addEventListener: () => {},
    body: makeEl('body'),
    head: makeEl('head')
  };

  const storage = new Map();
  const win = {
    location: { search: '', hash: '', href: 'http://localhost/' },
    addEventListener: () => {},
    CouncilLatestLiveRun: initialRun,
    CouncilLiveRuns: initialRun ? { [initialRun.runId || 'run-1']: initialRun } : {},
    CouncilRunIndex: []
  };

  const sandbox = {
    window: win,
    globalThis: win,
    document: doc,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => {
      if (typeof fn === 'function') fn();
      return 1;
    },
    console,
    Math,
    Date,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    RegExp
  };
  win.window = win;
  win.globalThis = win;

  vm.runInNewContext(inlineScript, sandbox);
  return { sandbox, elements, getEl };
}

describe('Issue #102 Task 4: Sparse replay deltas, ledger retry history & visualizer observability', () => {
  it('initializes clean retry fields at step 0 without end-of-run leakage, retains omitted sparse seat deltas, and clears activeRetryDiagnostics only on explicit null', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-102-replay-'));
    try {
      const s1Diag = makeDiag({ participantId: 's1', attempt: 1, fallbackReason: 'TimeoutError' });
      const judgeDiag = makeDiag({
        participantId: 'judge',
        role: 'judge',
        phase: 'JUDGE_AUDIT_SYNTHESIS',
        attempt: 1,
        requestedModel: 'gpt-6-astra',
        requestedEffort: 'max',
        effectiveModel: 'gpt-6-astra',
        effectiveEffort: 'medium',
        fallbackReason: 'HeadlessToolDeniedError',
        tools: 'none'
      });

      const watcher = new VisualizerLiveWatcher({
        outputPath: path.join(tmpDir, 'latest.js'),
        initialConfig: { topic: 'Sparse replay test' }
      });

      const steps = [
        {
          label: '1. Transition: BEGIN_ROUND -> deliberation (Round 1)',
          actor: 'engine',
          summary: 'Started round 1',
          event: { type: 'BEGIN_ROUND' },
          stateDelta: {
            phase: 'deliberation',
            canonicalPhase: 'DELIBERATION',
            round: 1,
            maxRounds: 3,
            minQuorum: 2,
            clarificationBatch: 0,
            topic: 'Sparse replay test',
            seatChanges: [
              { id: 's1', status: 'thinking', retries: 0 },
              { id: 's2', status: 'thinking', retries: 0 }
            ],
            judgeState: { id: 'judge', status: 'idle', retries: 0 }
          }
        },
        {
          label: '2. Transition: RETRY_SEAT -> deliberation (Round 1)',
          actor: 's1',
          summary: 'Retrying s1',
          event: { type: 'RETRY_SEAT', seatId: 's1', retryDiagnostics: s1Diag },
          stateDelta: {
            phase: 'deliberation',
            canonicalPhase: 'DELIBERATION',
            round: 1,
            maxRounds: 3,
            minQuorum: 2,
            clarificationBatch: 0,
            topic: 'Sparse replay test',
            seatChanges: [
              {
                id: 's1',
                status: 'thinking',
                retries: 1,
                activeRetryDiagnostics: s1Diag,
                retryDiagnosticsHistory: [s1Diag]
              }
            ],
            judgeState: { id: 'judge', status: 'idle', retries: 0 }
          }
        },
        {
          label: '3. Transition: SUBMIT_PROOF -> deliberation (Round 1)',
          actor: 's2',
          summary: 's2 submitted proof',
          event: { type: 'SUBMIT_PROOF', seatId: 's2' },
          stateDelta: {
            phase: 'deliberation',
            canonicalPhase: 'DELIBERATION',
            round: 1,
            maxRounds: 3,
            minQuorum: 2,
            clarificationBatch: 0,
            topic: 'Sparse replay test',
            // Sparse: omits s1 while s2 updates
            seatChanges: [{ id: 's2', status: 'proof_submitted', retries: 0 }],
            judgeState: null
          }
        },
        {
          label: '4. Transition: SUBMIT_PROOF -> deliberation (Round 1)',
          actor: 's1',
          summary: 's1 status pulse without retryDiagnostics fields',
          event: { type: 'SUBMIT_PROOF', seatId: 's1' },
          stateDelta: {
            phase: 'deliberation',
            canonicalPhase: 'DELIBERATION',
            round: 1,
            maxRounds: 3,
            minQuorum: 2,
            clarificationBatch: 0,
            topic: 'Sparse replay test',
            // Sparse: s1 status updates without activeRetryDiagnostics/retryDiagnosticsHistory keys
            seatChanges: [{ id: 's1', status: 'thinking', retries: 1 }],
            judgeState: null
          }
        },
        {
          label: '5. Transition: SUBMIT_PROOF -> deliberation (Round 1)',
          actor: 's1',
          summary: 's1 submitted proof and cleared activeRetryDiagnostics',
          event: { type: 'SUBMIT_PROOF', seatId: 's1' },
          stateDelta: {
            phase: 'deliberation',
            canonicalPhase: 'DELIBERATION',
            round: 1,
            maxRounds: 3,
            minQuorum: 2,
            clarificationBatch: 0,
            topic: 'Sparse replay test',
            seatChanges: [{ id: 's1', status: 'proof_submitted', retries: 1, activeRetryDiagnostics: null }],
            judgeState: {
              id: 'judge',
              status: 'auditing',
              retries: 1,
              activeRetryDiagnostics: judgeDiag,
              retryDiagnosticsHistory: [judgeDiag]
            }
          }
        },
        {
          label: '6. Transition: CAST_VOTE -> voting (Round 1)',
          actor: 's2',
          summary: 's2 voted while judge omits retry fields',
          event: { type: 'CAST_VOTE', seatId: 's2' },
          stateDelta: {
            phase: 'voting',
            canonicalPhase: 'VOTING',
            round: 1,
            maxRounds: 3,
            minQuorum: 2,
            clarificationBatch: 0,
            topic: 'Sparse replay test',
            seatChanges: [{ id: 's2', status: 'accepted', retries: 0 }],
            judgeState: { id: 'judge', status: 'auditing' }
          }
        },
        {
          label: '7. Transition: JUDGE_AUDIT_AND_SYNTHESIZE -> voting (Round 1)',
          actor: 'judge',
          summary: 'Judge finished and cleared activeRetryDiagnostics',
          event: { type: 'JUDGE_AUDIT_AND_SYNTHESIZE' },
          stateDelta: {
            phase: 'voting',
            canonicalPhase: 'VOTING',
            round: 1,
            maxRounds: 3,
            minQuorum: 2,
            clarificationBatch: 0,
            topic: 'Sparse replay test',
            seatChanges: [],
            judgeState: { id: 'judge', status: 'idle', activeRetryDiagnostics: null }
          }
        }
      ];

      watcher.liveRun = {
        id: 'wt-live-latest',
        runId: 'run-sparse-test',
        title: 'Sparse replay test',
        steps,
        currentGraph: { nodes: [], edges: [], activeNodeId: 'voting', lastEdgeId: null, outgoingEdges: [] },
        currentState: {
          phase: 'completed',
          round: 1,
          topic: 'Sparse replay test',
          judge: {
            id: 'judge',
            harness: 'codex',
            model: 'gpt-6-astra (max)',
            status: 'idle',
            retries: 1,
            activeRetryDiagnostics: judgeDiag,
            retryDiagnosticsHistory: [judgeDiag]
          },
          seats: [
            {
              id: 's1',
              harness: 'antigravity',
              model: 'gemini-4-argon-high',
              status: 'proof_submitted',
              retries: 1,
              activeRetryDiagnostics: s1Diag,
              retryDiagnosticsHistory: [s1Diag]
            },
            {
              id: 's2',
              harness: 'codex',
              model: 'gpt-6.1-sol (high)',
              status: 'accepted',
              retries: 0,
              activeRetryDiagnostics: null,
              retryDiagnosticsHistory: []
            }
          ],
          proofs: [],
          objections: [],
          clarifications: [],
          evidence: [],
          history: []
        }
      };

      // Step 0 must NEVER inherit end-of-run activeRetryDiagnostics or retryDiagnosticsHistory from currentState
      const at0 = watcher._rehydrateStepAt(steps[0]).stateSnapshot;
      assert.equal(at0.seats[0].activeRetryDiagnostics, null);
      assert.deepEqual(at0.seats[0].retryDiagnosticsHistory, []);
      assert.equal(at0.judge.activeRetryDiagnostics, null);
      assert.deepEqual(at0.judge.retryDiagnosticsHistory, []);

      // Step 1 activates s1 retry diagnostics
      const at1 = watcher._rehydrateStepAt(steps[1]).stateSnapshot;
      assert.deepEqual(at1.seats[0].activeRetryDiagnostics, s1Diag);
      assert.deepEqual(at1.seats[0].retryDiagnosticsHistory, [s1Diag]);

      // Step 2 updates only s2; s1 must RETAIN activeRetryDiagnostics and retryDiagnosticsHistory
      const at2 = watcher._rehydrateStepAt(steps[2]).stateSnapshot;
      assert.deepEqual(at2.seats[0].activeRetryDiagnostics, s1Diag);
      assert.deepEqual(at2.seats[0].retryDiagnosticsHistory, [s1Diag]);
      assert.equal(at2.seats[1].status, 'proof_submitted');

      // Step 3 updates s1 status without retry fields; s1 must still RETAIN activeRetryDiagnostics and retryDiagnosticsHistory
      const at3 = watcher._rehydrateStepAt(steps[3]).stateSnapshot;
      assert.deepEqual(at3.seats[0].activeRetryDiagnostics, s1Diag);
      assert.deepEqual(at3.seats[0].retryDiagnosticsHistory, [s1Diag]);

      // Step 4 explicitly clears s1.activeRetryDiagnostics = null while keeping s1.retryDiagnosticsHistory; judge activates
      const at4 = watcher._rehydrateStepAt(steps[4]).stateSnapshot;
      assert.equal(at4.seats[0].activeRetryDiagnostics, null);
      assert.deepEqual(at4.seats[0].retryDiagnosticsHistory, [s1Diag]);
      assert.deepEqual(at4.judge.activeRetryDiagnostics, judgeDiag);
      assert.deepEqual(at4.judge.retryDiagnosticsHistory, [judgeDiag]);

      // Step 5 omits judge retry fields; judge must RETAIN activeRetryDiagnostics and retryDiagnosticsHistory
      const at5 = watcher._rehydrateStepAt(steps[5]).stateSnapshot;
      assert.deepEqual(at5.judge.activeRetryDiagnostics, judgeDiag);
      assert.deepEqual(at5.judge.retryDiagnosticsHistory, [judgeDiag]);
      assert.equal(at5.judge.retries, 1);

      // Step 6 explicitly clears judge.activeRetryDiagnostics = null while keeping judge.retryDiagnosticsHistory
      const at6 = watcher._rehydrateStepAt(steps[6]).stateSnapshot;
      assert.equal(at6.judge.activeRetryDiagnostics, null);
      assert.deepEqual(at6.judge.retryDiagnosticsHistory, [judgeDiag]);

      // Verify _buildBundleScript executes identical sparse-safe replay in browser/VM runtime
      const bundleJs = watcher._buildBundleScript(JSON.stringify(watcher.liveRun), true);
      const sandbox = { window: {}, globalThis: {} };
      vm.runInNewContext(bundleJs, sandbox);
      const bundledRun = sandbox.window.CouncilLatestLiveRun;
      const snap = (idx) => JSON.parse(JSON.stringify(bundledRun.steps[idx].stateSnapshot));
      assert.equal(snap(0).seats[0].activeRetryDiagnostics, null);
      assert.deepEqual(snap(0).seats[0].retryDiagnosticsHistory, []);
      assert.equal(snap(0).judge.activeRetryDiagnostics, null);
      assert.deepEqual(snap(0).judge.retryDiagnosticsHistory, []);
      assert.deepEqual(snap(2).seats[0].activeRetryDiagnostics, s1Diag);
      assert.equal(snap(4).seats[0].activeRetryDiagnostics, null);
      assert.deepEqual(snap(4).seats[0].retryDiagnosticsHistory, [s1Diag]);
      assert.deepEqual(snap(5).judge.activeRetryDiagnostics, judgeDiag);
      assert.equal(snap(6).judge.activeRetryDiagnostics, null);
      assert.deepEqual(snap(6).judge.retryDiagnosticsHistory, [judgeDiag]);

      watcher.stop();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('tracks retryDiagnostics across _handleStateTransition, _handleSeatTelemetry, and getTransitionSummary', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-102-events-'));
    try {
      const emitter = new CouncilTelemetryEmitter({ clock: () => '2026-11-14T00:00:00.000Z' });
      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputPath: path.join(tmpDir, 'latest.js'),
        initialConfig: { topic: 'Telemetry watcher test' }
      });

      const s1Diag = makeDiag({ participantId: 's1', attempt: 1, fallbackReason: 'TimeoutError', tools: 'none' });
      const judgeDiag = makeDiag({
        participantId: 'judge',
        role: 'judge',
        phase: 'JUDGE_AUDIT_SYNTHESIS',
        attempt: 1,
        requestedModel: 'gpt-6-astra',
        requestedEffort: 'max',
        effectiveModel: 'gpt-6-astra',
        effectiveEffort: 'medium',
        fallbackReason: 'HeadlessToolDeniedError',
        tools: 'none'
      });

      // Plain RETRY_SEAT / RETRY_JUDGE summaries without retryDiagnostics stay backward-compatible
      assert.equal(getTransitionSummary({ type: 'RETRY_SEAT', seatId: 's1' }, {}), 'Retrying faulted Seat "s1"');
      assert.equal(getTransitionSummary({ type: 'RETRY_JUDGE' }, {}), 'Retrying faulted Judge');

      // Attributed summaries include requested -> effective model/effort, tools, and fallbackReason
      const seatSummary = getTransitionSummary({ type: 'RETRY_SEAT', seatId: 's1', retryDiagnostics: s1Diag }, {});
      assert.match(seatSummary, /gemini-4-argon-high \(high\) -> gemini-4-argon-medium \(medium\)/);
      assert.match(seatSummary, /tools=none/);
      assert.match(seatSummary, /TimeoutError/);

      const judgeSummary = getTransitionSummary({ type: 'RETRY_JUDGE', retryDiagnostics: judgeDiag }, {});
      assert.match(judgeSummary, /gpt-6-astra \(max\) -> gpt-6-astra \(medium\)/);
      assert.match(judgeSummary, /tools=none/);
      assert.match(judgeSummary, /HeadlessToolDeniedError/);

      const baseState = {
        phase: 'deliberation',
        canonicalPhase: 'DELIBERATION',
        round: 1,
        maxRounds: 3,
        minQuorum: 2,
        clarificationBatch: 0,
        topic: 'Telemetry watcher test',
        judge: {
          id: 'judge',
          harness: 'codex',
          model: 'gpt-6-astra (max)',
          status: 'idle',
          retries: 0,
          activeRetryDiagnostics: null,
          retryDiagnosticsHistory: []
        },
        seats: [
          {
            id: 's1',
            harness: 'antigravity',
            model: 'gemini-4-argon-high',
            status: 'thinking',
            retries: 0,
            activeRetryDiagnostics: null,
            retryDiagnosticsHistory: []
          },
          {
            id: 's2',
            harness: 'codex',
            model: 'gpt-6.1-sol (high)',
            status: 'thinking',
            retries: 0,
            activeRetryDiagnostics: null,
            retryDiagnosticsHistory: []
          }
        ],
        proofs: [],
        objections: [],
        clarifications: [],
        evidence: [],
        history: []
      };

      emitter.emitStateTransition({ type: 'BEGIN_ROUND' }, baseState);

      // Step 1: only retry diagnostics change on s1 (status stays 'thinking'); _prevSeatMap must detect JSON delta
      const retryState = structuredClone(baseState);
      retryState.seats[0].retries = 1;
      retryState.seats[0].activeRetryDiagnostics = s1Diag;
      retryState.seats[0].retryDiagnosticsHistory = [s1Diag];
      emitter.emitStateTransition({ type: 'RETRY_SEAT', seatId: 's1', retryDiagnostics: s1Diag }, retryState);

      assert.equal(watcher.liveRun.steps[1].stateDelta.seatChanges.length, 1);
      assert.equal(watcher.liveRun.steps[1].stateDelta.seatChanges[0].id, 's1');
      assert.deepEqual(watcher.liveRun.steps[1].stateDelta.seatChanges[0].activeRetryDiagnostics, s1Diag);
      assert.deepEqual(watcher.liveRun.steps[1].stateDelta.seatChanges[0].retryDiagnosticsHistory, [s1Diag]);

      // Step 2: Seat s2 transitions cleanly; sparse delta omits s1
      const s2State = structuredClone(retryState);
      s2State.seats[1].status = 'proof_submitted';
      emitter.emitStateTransition({ type: 'SUBMIT_PROOF', seatId: 's2' }, s2State);
      assert.deepEqual(watcher.liveRun.steps[2].stateDelta.seatChanges.map((c) => c.id), ['s2']);

      // Replaying step 2 still retains s1.activeRetryDiagnostics
      assert.deepEqual(watcher.liveRun.steps[2].stateSnapshot.seats[0].activeRetryDiagnostics, s1Diag);

      // Direct telemetry event & emitter telemetry update currentState.activeRetryDiagnostics without mutating step 0
      const updatedDiag = makeDiag({ participantId: 's1', attempt: 2, fallbackReason: 'HeadlessToolDeniedError' });
      emitter.emitSeatTelemetry('s1', 'thinking', { retryDiagnostics: updatedDiag });
      assert.deepEqual(watcher.liveRun.currentState.seats[0].activeRetryDiagnostics, updatedDiag);
      assert.equal(watcher.liveRun.steps[0].stateSnapshot.seats[0].activeRetryDiagnostics, null);

      // Also support direct event.retryDiagnostics shape if passed to _handleSeatTelemetry
      watcher._handleSeatTelemetry({ seatId: 'judge', status: 'auditing', retryDiagnostics: judgeDiag });
      assert.deepEqual(watcher.liveRun.currentState.judge.activeRetryDiagnostics, judgeDiag);

      // Judge stateTransition preserves activeRetryDiagnostics, retryDiagnosticsHistory, and retries
      const judgeRetryState = structuredClone(s2State);
      judgeRetryState.judge.retries = 1;
      judgeRetryState.judge.status = 'auditing';
      judgeRetryState.judge.activeRetryDiagnostics = judgeDiag;
      judgeRetryState.judge.retryDiagnosticsHistory = [judgeDiag];
      emitter.emitStateTransition({ type: 'RETRY_JUDGE', retryDiagnostics: judgeDiag }, judgeRetryState);

      const jDelta = watcher.liveRun.steps[3].stateDelta.judgeState;
      assert.equal(jDelta.retries, 1);
      assert.deepEqual(jDelta.activeRetryDiagnostics, judgeDiag);
      assert.deepEqual(jDelta.retryDiagnosticsHistory, [judgeDiag]);

      watcher.stop();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('persists defensive frozen retryDiagnosticsHistory on seats and judge in buildRunTelemetryRecord without altering canonical modelKey', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-102-ledger-'));
    try {
      const seatDiag = makeDiag({ participantId: 's1', fallbackReason: 'TimeoutError' });
      const judgeDiag = makeDiag({
        participantId: 'judge',
        role: 'judge',
        phase: 'JUDGE_AUDIT_SYNTHESIS',
        requestedModel: 'gpt-6-astra',
        requestedEffort: 'max',
        effectiveModel: 'gpt-6-astra',
        effectiveEffort: 'medium',
        fallbackReason: 'HeadlessToolDeniedError'
      });

      const seatInputHistory = [seatDiag];
      const judgeInputHistory = [judgeDiag];

      const record = buildRunTelemetryRecord({
        runId: 'run-ledger-102',
        mode: 'live',
        state: {
          topic: 'Ledger retry test',
          round: 1,
          verdict: { kind: 'consensus_reached' },
          judge: {
            id: 'judge',
            harness: 'codex',
            model: 'gpt-6-astra (max)',
            retryDiagnosticsHistory: judgeInputHistory
          },
          seats: [
            {
              id: 's1',
              harness: 'antigravity',
              model: 'gemini-4-argon-high',
              status: 'accepted',
              retries: 1,
              retryDiagnosticsHistory: seatInputHistory
            },
            {
              id: 's2',
              harness: 'codex',
              model: 'gpt-6.1-sol (high)',
              status: 'accepted',
              retries: 0
            }
          ],
          proofs: [],
          objections: []
        }
      });

      // Mutating caller's input after building record must not mutate record
      seatDiag.fallbackReason = 'MUTATED';
      seatInputHistory.push(makeDiag({ attempt: 99 }));
      judgeInputHistory.length = 0;

      const expectedSeatCanonical = canonicalizeModelKey('antigravity', 'gemini-4-argon-high');
      const expectedJudgeCanonical = canonicalizeModelKey('codex', 'gpt-6-astra (max)');

      assert.equal(record.seats[0].model, expectedSeatCanonical.model);
      assert.equal(record.seats[0].effort, expectedSeatCanonical.effort);
      assert.equal(record.seats[0].modelKey, expectedSeatCanonical.key);
      assert.equal(record.seats[0].retryDiagnosticsHistory.length, 1);
      assert.equal(record.seats[0].retryDiagnosticsHistory[0].fallbackReason, 'TimeoutError');
      assert.equal(Object.isFrozen(record.seats[0].retryDiagnosticsHistory), true);
      assert.equal(Object.isFrozen(record.seats[0].retryDiagnosticsHistory[0]), true);

      assert.deepEqual(record.seats[1].retryDiagnosticsHistory, []);
      assert.equal(Object.isFrozen(record.seats[1].retryDiagnosticsHistory), true);

      assert.equal(record.judge.model, expectedJudgeCanonical.model);
      assert.equal(record.judge.effort, expectedJudgeCanonical.effort);
      assert.equal(record.judge.key, expectedJudgeCanonical.key);
      assert.equal(record.judge.retryDiagnosticsHistory.length, 1);
      assert.equal(record.judge.retryDiagnosticsHistory[0].effectiveEffort, 'medium');
      assert.equal(Object.isFrozen(record.judge.retryDiagnosticsHistory), true);

      const { paths } = persistRunTelemetry({
        telemetryDir: tmpDir,
        record
      });
      const persisted = JSON.parse(fs.readFileSync(paths.runRecordPath, 'utf8'));
      assert.equal(persisted.seats[0].retryDiagnosticsHistory.length, 1);
      assert.equal(persisted.judge.retryDiagnosticsHistory.length, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('renders escaped activeRetryDiagnostics and retryDiagnosticsHistory badges on both Judge and Seat cards without mutating primary model labels', () => {
    const xssActiveSeatDiag = makeDiag({
      participantId: 's1',
      attempt: 1,
      requestedModel: 'gemini-4-argon-high',
      effectiveModel: 'gemini-4-argon-medium<img src=x onerror=alert(1)>',
      effectiveEffort: 'medium',
      fallbackReason: 'TimeoutError<script>alert(2)</script>'
    });
    const xssJudgeDiag = makeDiag({
      participantId: 'judge',
      role: 'judge',
      attempt: 2,
      requestedModel: 'gpt-6-astra (max)',
      effectiveModel: 'gpt-6-astra"<svg onload=alert(3)>',
      effectiveEffort: 'medium',
      fallbackReason: 'HeadlessToolDeniedError'
    });

    const initialRun = {
      id: 'wt-live-latest',
      runId: 'run-html-102',
      title: 'Visualizer Retry Diagnostics',
      isRunning: true,
      currentState: {
        phase: 'deliberation',
        round: 1,
        maxRounds: 3,
        minQuorum: 2,
        maxRetriesPerSeat: 2,
        topic: 'Visualizer retry card test',
        judge: {
          id: 'judge',
          harness: 'codex',
          model: 'gpt-6-astra (max)',
          status: 'auditing',
          retries: 1,
          activeRetryDiagnostics: xssJudgeDiag,
          retryDiagnosticsHistory: [xssJudgeDiag]
        },
        seats: [
          {
            id: 's1',
            harness: 'antigravity',
            model: 'gemini-4-argon-high',
            status: 'thinking',
            retries: 1,
            activeRetryDiagnostics: xssActiveSeatDiag,
            retryDiagnosticsHistory: [xssActiveSeatDiag]
          }
        ],
        proofs: [],
        objections: [],
        clarifications: [],
        evidence: [],
        history: []
      },
      steps: []
    };

    const { getEl } = createIndexHtmlHarness(initialRun);
    const seatsHtmlOut = getEl('seats-grid').innerHTML;

    // Primary model labels remain unchanged
    assert.match(seatsHtmlOut, /gpt-6-astra \(max\) · non-voting/);
    assert.match(seatsHtmlOut, /gemini-4-argon-high · retries 1\/2/);

    // Both Judge and Seat render activeRetryDiagnostics and retryDiagnosticsHistory badges
    assert.match(seatsHtmlOut, /Retry #2 · effective:/);
    assert.match(seatsHtmlOut, /Retry #1 · effective:/);
    assert.match(seatsHtmlOut, /HeadlessToolDeniedError/);
    assert.match(seatsHtmlOut, /TimeoutError/);
    assert.match(seatsHtmlOut, /retry-diagnostics-active/);
    assert.match(seatsHtmlOut, /retry-diagnostics-history/);

    // All untrusted dynamic values must be HTML-escaped (no raw tags or inline handler payloads)
    assert.doesNotMatch(seatsHtmlOut, /<img\b/i);
    assert.doesNotMatch(seatsHtmlOut, /<script\b/i);
    assert.doesNotMatch(seatsHtmlOut, /<svg\b/i);
    assert.match(seatsHtmlOut, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(seatsHtmlOut, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
    assert.match(seatsHtmlOut, /&lt;svg onload=alert\(3\)&gt;/);
  });
});
