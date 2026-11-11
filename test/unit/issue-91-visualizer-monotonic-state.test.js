import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { VisualizerLiveWatcher } from '../../src/visualizer/live-watcher.js';

const HTML_PATH = path.resolve(import.meta.dirname, '../../src/visualizer/index.html');
const VIS_JS_PATH = path.resolve(import.meta.dirname, '../../src/visualizer/council-visualizer.js');

await import(VIS_JS_PATH);
const CouncilVisualizerReal = globalThis.CouncilVisualizer;

function readVisualizerHtml() {
  return fs.readFileSync(HTML_PATH, 'utf8');
}

function extractInlineControllerSource(html) {
  const match = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);
  assert.ok(match, 'index.html must contain main inline controller script before </body>');
  return match[1];
}

function makeTempDir(prefix = 'council-issue-91-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createVisualizerHarness({
  win = {},
  visualizer = CouncilVisualizerReal,
  initiallyHidden = false,
  nowFn = () => Date.now()
} = {}) {
  const html = readVisualizerHtml();
  const scriptBody = extractInlineControllerSource(html);

  const elements = new Map();
  const appendedScripts = [];
  const docListeners = new Map();
  const timeouts = new Map();
  const intervals = new Map();
  let nextTimerId = 1;
  let hidden = initiallyHidden;

  function makeClassList(el) {
    return {
      _set: new Set(String(el.className || '').split(/\s+/).filter(Boolean)),
      add(token) {
        this._set.add(token);
        el.className = Array.from(this._set).join(' ');
      },
      remove(token) {
        this._set.delete(token);
        el.className = Array.from(this._set).join(' ');
      },
      toggle(token, force) {
        const shouldHave = force !== undefined ? Boolean(force) : !this._set.has(token);
        if (shouldHave) this._set.add(token);
        else this._set.delete(token);
        el.className = Array.from(this._set).join(' ');
        return shouldHave;
      },
      contains(token) {
        return String(el.className || '')
          .split(/\s+/)
          .filter(Boolean)
          .includes(token);
      }
    };
  }

  function makeElement(id, tagName = 'DIV') {
    let rawHtml = '';
    let rawText = '';
    const children = [];
    const listeners = new Map();
    const attrs = new Map();

    const el = {
      id,
      tagName,
      value:
        id === 'run-selector'
          ? 'latest'
          : id === 'telemetry-group-by'
            ? 'model'
            : id === 'telemetry-window'
              ? 'all'
              : '',
      className: '',
      hidden: false,
      style: {},
      dataset: {},
      children,
      options: children,
      innerHTMLWrites: 0,
      textContentWrites: 0,
      replaceChildrenCalls: 0,
      appendChildCalls: 0,
      listeners,
      get textContent() {
        return rawText;
      },
      set textContent(val) {
        rawText = String(val ?? '');
        this.textContentWrites += 1;
      },
      get innerHTML() {
        return rawHtml;
      },
      set innerHTML(val) {
        rawHtml = String(val ?? '');
        this.innerHTMLWrites += 1;
      },
      get firstChild() {
        return children[0] || null;
      },
      setAttribute(name, val) {
        attrs.set(name, String(val));
        if (name === 'id') this.id = String(val);
        if (name.startsWith('data-')) {
          const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          this.dataset[camel] = String(val);
        }
      },
      getAttribute(name) {
        return attrs.has(name) ? attrs.get(name) : null;
      },
      removeAttribute(name) {
        attrs.delete(name);
      },
      hasAttribute(name) {
        return attrs.has(name);
      },
      appendChild(child) {
        this.appendChildCalls += 1;
        children.push(child);
        return child;
      },
      removeChild(child) {
        const i = children.indexOf(child);
        if (i >= 0) children.splice(i, 1);
        return child;
      },
      replaceChildren(...next) {
        this.replaceChildrenCalls += 1;
        children.length = 0;
        children.push(...next);
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatchEvent(type, eventObj = {}) {
        const handlers = listeners.get(type) || [];
        for (const fn of handlers) {
          fn.call(this, { target: this, ...eventObj });
        }
      },
      querySelector(selector) {
        const stepMatch = selector.match(/^\[data-step-idx="(\d+)"\]$/);
        if (stepMatch) {
          const idx = stepMatch[1];
          if (rawHtml.includes(`data-step-idx="${idx}"`)) {
            if (!this._stepNodes) this._stepNodes = new Map();
            if (!this._stepNodes.has(idx)) {
              const rowNode = makeElement(`step-row-${idx}`, 'BUTTON');
              rowNode.setAttribute('data-step-idx', idx);
              rowNode.focus = () => {
                mockDoc.activeElement = rowNode;
                rowNode.focusCalls = (rowNode.focusCalls || 0) + 1;
              };
              this._stepNodes.set(idx, rowNode);
            }
            return this._stepNodes.get(idx);
          }
          return null;
        }
        return null;
      },
      remove() {
        this.removed = true;
        if (this.id && elements.get(this.id) === this) {
          elements.delete(this.id);
        }
      }
    };
    el.classList = makeClassList(el);
    return el;
  }

  function getEl(id) {
    if (!elements.has(id)) {
      const tag = id.endsWith('-svg')
        ? 'SVG'
        : id.includes('selector') || id.startsWith('telemetry-')
          ? 'SELECT'
          : 'DIV';
      elements.set(id, makeElement(id, tag));
    }
    return elements.get(id);
  }

  const knownIds = [
    'run-selector',
    'badge-live-tag',
    'stream-badge',
    'status-pill',
    'status-pill-text',
    'lbl-elapsed',
    'btn-live-follow',
    'btn-live-follow-label',
    'heading-topic',
    'lbl-phase',
    'lbl-round',
    'lbl-max-rounds',
    'lbl-quorum',
    'lbl-verdict-status',
    'verdict-box',
    'verdict-title',
    'verdict-body',
    'synthesis-text',
    'transition-text',
    'lbl-clauses-count',
    'clauses-list',
    'lbl-objs-count',
    'objections-list',
    'lbl-roster-count',
    'seats-grid',
    'lbl-proofs-count',
    'proofs-list',
    'btn-tab-topology',
    'btn-tab-causal',
    'stage-topology',
    'stage-causal',
    'state-machine-svg',
    'causal-dependency-svg',
    'btn-jump-latest',
    'timeline-list',
    'lbl-telemetry-runs',
    'telemetry-group-by',
    'telemetry-window',
    'telemetry-leaderboard-body'
  ];
  for (const id of knownIds) getEl(id);

  const mockDoc = {
    activeElement: null,
    get hidden() {
      return hidden;
    },
    set hidden(v) {
      hidden = Boolean(v);
    },
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => makeElement('', tag.toUpperCase()),
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    dispatchEvent(type, ev = {}) {
      for (const fn of docListeners.get(type) || []) {
        fn(ev);
      }
    },
    head: {
      appendChild: (el) => {
        if (el.id) elements.set(el.id, el);
        appendedScripts.push(el);
      }
    }
  };

  const fakeSetTimeout = (fn, ms) => {
    const id = nextTimerId++;
    let unrefCalled = false;
    const handle = {
      id,
      ms,
      unref() {
        unrefCalled = true;
      },
      get unrefCalled() {
        return unrefCalled;
      }
    };
    timeouts.set(id, { id, fn, ms, handle });
    return handle;
  };

  const fakeClearTimeout = (handle) => {
    const id = handle && typeof handle === 'object' ? handle.id : handle;
    timeouts.delete(id);
  };

  const fakeSetInterval = (fn, ms) => {
    const id = nextTimerId++;
    const handle = { id, ms, unref() {} };
    intervals.set(id, { id, fn, ms, handle });
    return handle;
  };

  const fakeClearInterval = (handle) => {
    const id = handle && typeof handle === 'object' ? handle.id : handle;
    intervals.delete(id);
  };

  const fakeDate = Object.assign(
    function (...args) {
      return new Date(...args);
    },
    {
      now: () => nowFn(),
      parse: (s) => Date.parse(s)
    }
  );

  const domWin = { ...win };

  const controllerFn = new Function(
    'window',
    'globalThis',
    'document',
    'CouncilVisualizer',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'Date',
    `${scriptBody}
    return {
      selectRun,
      inspectStep,
      restoreLatestSnapshot,
      pollLiveRun,
      updateRunSelector,
      renderTelemetryLeaderboard,
      renderAll,
      switchGraphTab,
      toggleLiveFollow,
      startLiveFollow,
      stopLiveFollow,
      updateElapsedTimer,
      getInternalState: () => ({
        liveFollowActive,
        pollInFlight,
        pollEpoch,
        currentStepIdx,
        selectedRunId,
        councilState
      })
    };`
  );

  const controller = controllerFn(
    domWin,
    domWin,
    mockDoc,
    visualizer,
    fakeSetTimeout,
    fakeClearTimeout,
    fakeSetInterval,
    fakeClearInterval,
    fakeDate
  );

  return {
    controller,
    domWin,
    mockDoc,
    elements,
    getEl,
    appendedScripts,
    timeouts,
    intervals,
    setHidden(nextHidden) {
      mockDoc.hidden = nextHidden;
      mockDoc.dispatchEvent('visibilitychange');
    },
    runNextTimeout() {
      const first = timeouts.values().next().value;
      if (!first) return false;
      timeouts.delete(first.id);
      first.fn();
      return true;
    },
    tickIntervals() {
      for (const entry of Array.from(intervals.values())) {
        entry.fn();
      }
    }
  };
}

describe('Issue #91: Monotonic Run-State Reconciliation, Historical Step Inspection & Idle Watch Mode', () => {
  describe('1. Separate Run Terminal Status from Historical Snapshot Inspection', () => {
    it('preserves COMPLETED: CONSENSUS / CONSENSUS REACHED and Verdict Banner when scrubbing historical steps on a finished consensus run', () => {
      const completedConsensusRun = {
        runId: 'run-consensus-done',
        isRunning: false,
        verdictKind: 'Unanimous Consensus',
        startedAt: '2026-11-11T10:00:00.000Z',
        updatedAt: '2026-11-11T10:02:00.000Z',
        currentState: {
          topic: 'Monotonic State Architecture',
          phase: 'completed',
          round: 2,
          maxRounds: 3,
          minQuorum: 2,
          verdict: {
            kind: 'Unanimous Consensus',
            note: 'All seats converged on proof-backed design.'
          },
          candidate: {
            summary: 'Round 2 final synthesis.',
            clauses: [{ id: 'C1', context: 'Terminal state', conclusion: 'Separate terminalState from councilState.', citedProofIds: ['P1'] }]
          },
          lastTransition: { message: 'Evaluated Round 2: Verdict — Unanimous Consensus' },
          seats: [{ id: 'seat-1', harness: 'codex', model: 'gpt-5.4', status: 'accepted', retries: 0 }],
          proofs: [{ id: 'P1', seatId: 'seat-1', status: 'admitted', kind: 'code', statement: 'Verified.' }],
          objections: [],
          history: ['Evaluated Round 2: Verdict — Unanimous Consensus']
        },
        steps: [
          {
            label: 'Step 1: Round 1 reviewing',
            stateSnapshot: {
              topic: 'Monotonic State Architecture',
              phase: 'reviewing',
              round: 1,
              maxRounds: 3,
              minQuorum: 2,
              verdict: null,
              candidate: null,
              lastTransition: { message: 'Began Round 1/3 proof collection' },
              seats: [{ id: 'seat-1', harness: 'codex', model: 'gpt-5.4', status: 'thinking', retries: 0 }],
              proofs: [],
              objections: [],
              history: ['Began Round 1/3 proof collection']
            }
          },
          {
            label: 'Step 2: Round 2 completed',
            stateSnapshot: {
              topic: 'Monotonic State Architecture',
              phase: 'completed',
              round: 2,
              maxRounds: 3,
              minQuorum: 2,
              verdict: {
                kind: 'Unanimous Consensus',
                note: 'All seats converged on proof-backed design.'
              },
              candidate: {
                summary: 'Round 2 final synthesis.',
                clauses: [{ id: 'C1', context: 'Terminal state', conclusion: 'Separate terminalState from councilState.', citedProofIds: ['P1'] }]
              },
              lastTransition: { message: 'Evaluated Round 2: Verdict — Unanimous Consensus' },
              seats: [{ id: 'seat-1', harness: 'codex', model: 'gpt-5.4', status: 'accepted', retries: 0 }],
              proofs: [{ id: 'P1', seatId: 'seat-1', status: 'admitted', kind: 'code', statement: 'Verified.' }],
              objections: [],
              history: ['Evaluated Round 2: Verdict — Unanimous Consensus']
            }
          }
        ]
      };

      const { controller, getEl } = createVisualizerHarness({
        win: {
          CouncilLatestLiveRun: completedConsensusRun,
          CouncilRuns: { 'run-consensus-done': completedConsensusRun }
        }
      });

      // Initially at latest snapshot: completed consensus
      assert.equal(getEl('status-pill').className, 'badge badge-completed');
      assert.equal(getEl('status-pill-text').textContent, 'COMPLETED: CONSENSUS');
      assert.equal(getEl('lbl-verdict-status').textContent, 'CONSENSUS REACHED');
      assert.equal(getEl('verdict-box').className, 'verdict-banner consensus');
      assert.equal(getEl('verdict-title').textContent, 'Verdict: Unanimous Consensus');

      // Inspect historical Step 0 (phase === 'reviewing', verdict === null)
      controller.inspectStep(0);

      // Run-level terminal status and verdict banner MUST NOT flip to ABORTED!
      assert.equal(getEl('status-pill').className, 'badge badge-completed');
      assert.equal(getEl('status-pill-text').textContent, 'COMPLETED: CONSENSUS');
      assert.equal(getEl('lbl-verdict-status').className, 'badge badge-completed');
      assert.equal(getEl('lbl-verdict-status').textContent, 'CONSENSUS REACHED');
      assert.equal(getEl('verdict-box').className, 'verdict-banner consensus');
      assert.equal(getEl('verdict-title').textContent, 'Verdict: Unanimous Consensus');
      assert.equal(getEl('verdict-body').textContent, 'All seats converged on proof-backed design.');

      // Meanwhile, step-scoped panels reflect Step 0 snapshot accurately
      assert.equal(getEl('lbl-phase').textContent, 'reviewing');
      assert.equal(getEl('lbl-round').textContent, '1');
      assert.equal(getEl('synthesis-text').textContent, 'No Candidate synthesized yet for Round 1.');
      assert.equal(getEl('transition-text').textContent, 'Began Round 1/3 proof collection');
      assert.doesNotMatch(getEl('transition-text').textContent, /aborted/i);
      assert.match(getEl('timeline-list').innerHTML, /aria-current="step" data-step-idx="0"/);

      // Jump back to latest snapshot
      controller.restoreLatestSnapshot();
      assert.equal(getEl('lbl-phase').textContent, 'completed');
      assert.equal(getEl('lbl-round').textContent, '2');
      assert.equal(getEl('synthesis-text').textContent, 'Round 2 final synthesis.');
      assert.doesNotMatch(getEl('timeline-list').innerHTML, /aria-current="step"/);
    });

    it('preserves COMPLETED: DISSENT / DISSENT REPORT when inspecting earlier steps on a finished dissent run, while keeping ABORTED for genuinely aborted runs', () => {
      const dissentRun = {
        runId: 'run-dissent-done',
        isRunning: false,
        verdictKind: 'Dissent Report',
        currentState: {
          topic: 'Dissenting Run',
          phase: 'completed',
          round: 3,
          maxRounds: 3,
          minQuorum: 2,
          verdict: { kind: 'Dissent Report', note: 'Bounded dissent after Round 3.' },
          seats: [],
          proofs: [],
          objections: [],
          history: ['Bounded dissent']
        },
        steps: [
          {
            label: 'Step 1: Proving',
            stateSnapshot: {
              topic: 'Dissenting Run',
              phase: 'proving',
              round: 1,
              maxRounds: 3,
              minQuorum: 2,
              verdict: null,
              lastTransition: { message: 'Submitting proofs' },
              seats: [],
              proofs: [],
              objections: [],
              history: ['Submitting proofs']
            }
          }
        ]
      };

      const { controller, getEl } = createVisualizerHarness({
        win: { CouncilLatestLiveRun: dissentRun }
      });

      controller.inspectStep(0);
      assert.equal(getEl('status-pill').className, 'badge badge-failed');
      assert.equal(getEl('status-pill-text').textContent, 'COMPLETED: DISSENT');
      assert.equal(getEl('lbl-verdict-status').textContent, 'DISSENT REPORT');
      assert.equal(getEl('verdict-title').textContent, 'Verdict: Dissent Report');
      assert.equal(getEl('lbl-phase').textContent, 'proving');
      assert.equal(getEl('transition-text').textContent, 'Submitting proofs');
    });
  });

  describe('2. Graceful Rendering of Pre-Transition Aborted Runs (currentState: null)', () => {
    it('renders pre-transition aborted run (currentState: null, isRunning: false) as ABORTED: PREFLIGHT instead of IDLE/EVALUATING or LOAD FAILED', () => {
      const preflightAbortedRun = {
        runId: 'run-preflight-aborted',
        isRunning: false,
        verdictKind: 'Aborted',
        startedAt: '2026-11-11T10:10:00.000Z',
        updatedAt: '2026-11-11T10:10:02.000Z',
        initialConfig: {
          topic: 'Preflight Signal Abort Topic',
          maxRounds: 4,
          minQuorum: 3
        },
        currentState: null,
        steps: []
      };

      const { controller, getEl, appendedScripts, domWin } = createVisualizerHarness({
        win: {
          CouncilRunIndex: [
            {
              runId: 'run-preflight-aborted',
              topic: 'Preflight Signal Abort Topic',
              isRunning: false,
              verdictKind: 'Aborted',
              updatedAt: '2026-11-11T10:10:02.000Z'
            },
            {
              runId: 'run-remote-aborted',
              topic: 'Remote Preflight Aborted',
              isRunning: false,
              verdictKind: 'Aborted',
              updatedAt: '2026-11-11T10:11:00.000Z'
            }
          ],
          CouncilLatestLiveRun: preflightAbortedRun,
          CouncilRuns: {
            'run-preflight-aborted': preflightAbortedRun
          }
        }
      });

      assert.equal(getEl('heading-topic').textContent, 'Preflight Signal Abort Topic');
      assert.equal(getEl('lbl-phase').textContent, 'preflight');
      assert.equal(getEl('lbl-round').textContent, '0');
      assert.equal(getEl('lbl-max-rounds').textContent, '4');
      assert.equal(getEl('lbl-quorum').textContent, '3');
      assert.equal(getEl('status-pill').className, 'badge badge-failed');
      assert.equal(getEl('status-pill-text').textContent, 'ABORTED: PREFLIGHT');
      assert.equal(getEl('lbl-verdict-status').className, 'badge badge-failed');
      assert.equal(getEl('lbl-verdict-status').textContent, 'RUN ABORTED');
      assert.equal(getEl('verdict-box').className, 'verdict-banner dissent');
      assert.equal(getEl('verdict-title').textContent, 'Deliberation Aborted (Before Initialization)');
      assert.equal(getEl('verdict-body').textContent, 'Run stopped before deliberation state was initialized.');
      assert.equal(getEl('transition-text').textContent, 'Run aborted before initialization in phase "preflight".');

      // Selecting cached pre-init aborted run via selectRun('run-preflight-aborted') must NOT trigger renderFailedRunLoad
      const scriptsBeforeCachedSelect = appendedScripts.length;
      controller.selectRun('run-preflight-aborted');
      assert.equal(appendedScripts.length, scriptsBeforeCachedSelect, 'Cached preflight-aborted run must not re-append script');
      assert.equal(getEl('status-pill-text').textContent, 'ABORTED: PREFLIGHT');
      assert.equal(getEl('verdict-title').textContent, 'Deliberation Aborted (Before Initialization)');
      assert.doesNotMatch(getEl('status-pill-text').textContent, /LOAD FAILED/);

      // Selecting remote pre-init aborted run via script.onload with currentState: null must render ABORTED: PREFLIGHT (not LOAD FAILED)
      controller.selectRun('run-remote-aborted');
      const selectScript = appendedScripts[appendedScripts.length - 1];
      assert.equal(selectScript.id, 'script-run-select');
      domWin.CouncilRuns['run-remote-aborted'] = {
        runId: 'run-remote-aborted',
        isRunning: false,
        verdictKind: 'Aborted',
        initialConfig: { topic: 'Remote Preflight Aborted', maxRounds: 2, minQuorum: 2 },
        currentState: null,
        steps: []
      };
      selectScript.onload();
      assert.equal(getEl('heading-topic').textContent, 'Remote Preflight Aborted');
      assert.equal(getEl('status-pill-text').textContent, 'ABORTED: PREFLIGHT');
      assert.equal(getEl('verdict-title').textContent, 'Deliberation Aborted (Before Initialization)');

      // Selecting a run whose script loads without registering in CouncilRuns still shows LOAD FAILED
      controller.selectRun('run-corrupt-empty');
      const corruptScript = appendedScripts[appendedScripts.length - 1];
      corruptScript.onload();
      assert.equal(getEl('status-pill-text').textContent, 'LOAD FAILED');
    });
  });

  describe('3. Monotonic isNotStale, Cross-Run Latest Guard, Reconciliation updatedAt & Cache Invalidation', () => {
    it('enforces monotonic isRunning: false in _buildBundleScript and prevents older latest.js from overwriting newer CouncilLatestLiveRun', () => {
      const outDir = makeTempDir('council-91-bundle-');
      try {
        const watcher = new VisualizerLiveWatcher({
          runId: 'run-mono-1',
          outputDir: outDir,
          initialConfig: { topic: 'Monotonic Bundle Test' }
        });
        watcher.stop({ reason: 'Aborted' });

        // Build a finalized bundle (isRunning: false) and a stale running bundle (isRunning: true, even with a later timestamp)
        const finalizedPayload = JSON.stringify({
          runId: 'run-mono-1',
          isRunning: false,
          verdictKind: 'Aborted',
          startedAt: '2026-11-11T10:00:00.000Z',
          updatedAt: '2026-11-11T10:01:00.000Z',
          currentState: null,
          steps: [{ label: 'Step 1' }]
        });
        const staleRunningPayload = JSON.stringify({
          runId: 'run-mono-1',
          isRunning: true,
          verdictKind: null,
          startedAt: '2026-11-11T10:00:00.000Z',
          updatedAt: '2026-11-11T10:05:00.000Z',
          currentState: null,
          steps: [{ label: 'Step 1' }, { label: 'Step 2' }]
        });

        const finalizedScript = watcher._buildBundleScript(finalizedPayload, true);
        const staleRunningScript = watcher._buildBundleScript(staleRunningPayload, true);

        const sandbox = { window: {}, globalThis: {} };
        sandbox.window = sandbox;
        sandbox.globalThis = sandbox;

        vm.runInNewContext(finalizedScript, sandbox);
        assert.equal(sandbox.CouncilRuns['run-mono-1'].isRunning, false);
        assert.equal(sandbox.CouncilLatestLiveRun.isRunning, false);

        // Executing stale running bundle for same runId MUST NOT revert isRunning back to true
        vm.runInNewContext(staleRunningScript, sandbox);
        assert.equal(
          sandbox.CouncilRuns['run-mono-1'].isRunning,
          false,
          'Finalized run in CouncilRuns[runId] must never revert to isRunning: true'
        );
        assert.equal(
          sandbox.CouncilLatestLiveRun.isRunning,
          false,
          'Finalized run in CouncilLatestLiveRun must never revert to isRunning: true'
        );

        // Now load a newer active run into CouncilLatestLiveRun
        const newerRunPayload = JSON.stringify({
          runId: 'run-mono-2',
          isRunning: true,
          startedAt: '2026-11-11T11:00:00.000Z',
          updatedAt: '2026-11-11T11:00:05.000Z',
          currentState: { topic: 'Newer Run', phase: 'reviewing', round: 1 },
          steps: []
        });
        vm.runInNewContext(watcher._buildBundleScript(newerRunPayload, true), sandbox);
        assert.equal(sandbox.CouncilLatestLiveRun.runId, 'run-mono-2');

        // Late-arriving older latest.js (run-mono-1, startedAt 10:00 < 11:00, isRunning: false) must NOT overwrite run-mono-2
        vm.runInNewContext(finalizedScript, sandbox);
        assert.equal(
          sandbox.CouncilLatestLiveRun.runId,
          'run-mono-2',
          'Older finished latest.js must not overwrite a newer run in CouncilLatestLiveRun'
        );

        // Delayed older RUNNING latest.js for already-finalized run-mono-1 (startedAt 10:00 < 11:00) MUST NOT overwrite run-mono-2 or resurrect run-mono-1!
        vm.runInNewContext(staleRunningScript, sandbox);
        assert.equal(
          sandbox.CouncilRuns['run-mono-1'].isRunning,
          false,
          'Delayed running payload for finalized run-mono-1 must remain rejected in CouncilRuns'
        );
        assert.equal(
          sandbox.CouncilLatestLiveRun.runId,
          'run-mono-2',
          'Delayed running payload for finalized older run-mono-1 must never resurrect in CouncilLatestLiveRun'
        );
        assert.equal(sandbox.CouncilLatestLiveRun.isRunning, true);
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });

    it('bumps updatedAt on _reconcileStaleRunOnDisk, reconciles PID-reused entries exceeding staleRunThresholdMs, and exports COUNCIL_RUNS_INDEX alias', () => {
      const outDir = makeTempDir('council-91-reconcile-');
      try {
        const oldIso = '2026-11-11T08:00:00.000Z';
        // Create an orphaned run whose PID was later reused by another OS process
        const orphanWatcher = new VisualizerLiveWatcher({
          runId: 'run-pid-reused',
          pid: 424242,
          outputDir: outDir,
          initialConfig: { topic: 'PID Reused Orphan' },
          killProbe: () => true
        });
        orphanWatcher.detach();

        // Backdate its timestamps on disk to simulate an orphan from hours ago whose PID is now reused
        const metaPath = path.join(outDir, 'run-pid-reused.meta.json');
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        meta.startedAt = oldIso;
        meta.updatedAt = oldIso;
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

        const runJsPath = path.join(outDir, 'run-pid-reused.js');
        const rawJs = fs.readFileSync(runJsPath, 'utf8').replace(/"updatedAt":\s*"[^"]+"/g, `"updatedAt": "${oldIso}"`);
        fs.writeFileSync(runJsPath, rawJs);

        // Start a new watcher where killProbe says PID 424242 is alive (PID reuse!), but updatedAt is > staleRunThresholdMs
        const activeWatcher = new VisualizerLiveWatcher({
          runId: 'run-active-now',
          outputDir: outDir,
          staleRunThresholdMs: 1000,
          initialConfig: { topic: 'Active Now' },
          killProbe: () => true
        });

        const indexSandbox = { window: {}, globalThis: {} };
        indexSandbox.window = indexSandbox;
        indexSandbox.globalThis = indexSandbox;
        vm.runInNewContext(fs.readFileSync(path.join(outDir, 'index.js'), 'utf8'), indexSandbox);

        assert.ok(Array.isArray(indexSandbox.CouncilRunIndex), 'CouncilRunIndex must be exported');
        assert.ok(Array.isArray(indexSandbox.COUNCIL_RUNS_INDEX), 'COUNCIL_RUNS_INDEX alias must be exported');
        assert.deepEqual(indexSandbox.COUNCIL_RUNS_INDEX, indexSandbox.CouncilRunIndex);

        const reconciledEntry = indexSandbox.CouncilRunIndex.find((e) => e.runId === 'run-pid-reused');
        assert.ok(reconciledEntry);
        assert.equal(reconciledEntry.isRunning, false, 'PID-reused entry older than staleRunThresholdMs must be reconciled');
        assert.equal(reconciledEntry.verdictKind, 'Aborted');
        assert.ok(
          String(reconciledEntry.updatedAt) > oldIso,
          `Reconciled entry updatedAt (${reconciledEntry.updatedAt}) must be strictly newer than old updatedAt (${oldIso})`
        );

        const runSandbox = { window: {}, globalThis: {} };
        runSandbox.window = runSandbox;
        runSandbox.globalThis = runSandbox;
        vm.runInNewContext(fs.readFileSync(runJsPath, 'utf8'), runSandbox);
        assert.equal(runSandbox.CouncilRuns['run-pid-reused'].isRunning, false);
        assert.ok(String(runSandbox.CouncilRuns['run-pid-reused'].updatedAt) > oldIso);

        activeWatcher.stop();
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });

    it('invalidates stale window.CouncilRuns[runId] cache entries when manifest index reports isRunning: false or newer updatedAt, and guards onRunLoaded with pollEpoch', () => {
      const { controller, getEl, domWin, appendedScripts } = createVisualizerHarness({
        win: {
          COUNCIL_RUNS_INDEX: [
            {
              runId: 'run-cached-stale',
              topic: 'Previously Cached Running Run',
              isRunning: true,
              updatedAt: '2026-11-11T10:00:00.000Z'
            }
          ],
          CouncilLatestLiveRun: {
            runId: 'run-latest-active',
            isRunning: true,
            startedAt: '2026-11-11T10:05:00.000Z',
            updatedAt: '2026-11-11T10:05:01.000Z',
            currentState: { topic: 'Latest Active', phase: 'reviewing', round: 1, seats: [] },
            steps: []
          },
          CouncilRuns: {
            'run-cached-stale': {
              runId: 'run-cached-stale',
              isRunning: true,
              updatedAt: '2026-11-11T10:00:00.000Z',
              currentState: { topic: 'Previously Cached Running Run', phase: 'reviewing', round: 1, seats: [] },
              steps: []
            }
          }
        }
      });

      // Capture in-flight latest.js script from initial poll BEFORE switching runs
      const initialLatestScript = appendedScripts.find((s) => s.id === 'script-live-reload');
      assert.ok(initialLatestScript);

      // Update manifest via COUNCIL_RUNS_INDEX to mark 'run-cached-stale' as reconciled (isRunning: false)
      domWin.COUNCIL_RUNS_INDEX = [
        {
          runId: 'run-cached-stale',
          topic: 'Previously Cached Running Run',
          isRunning: false,
          verdictKind: 'Aborted',
          updatedAt: '2026-11-11T10:06:00.000Z'
        }
      ];

      // Selecting 'run-cached-stale' must evict the stale isRunning: true cache and fetch run-cached-stale.js
      const countBeforeSelect = appendedScripts.length;
      controller.selectRun('run-cached-stale');
      assert.equal(
        domWin.CouncilRuns['run-cached-stale'],
        undefined,
        'Stale cached run (isRunning: true vs manifest isRunning: false) must be evicted from CouncilRuns'
      );
      assert.equal(appendedScripts.length, countBeforeSelect + 1, 'selectRun must fetch fresh <runId>.js after cache eviction');
      const freshRunScript = appendedScripts[appendedScripts.length - 1];
      assert.match(freshRunScript.src, /run-cached-stale\.js\?t=/);

      domWin.CouncilRuns['run-cached-stale'] = {
        runId: 'run-cached-stale',
        isRunning: false,
        verdictKind: 'Aborted',
        updatedAt: '2026-11-11T10:06:00.000Z',
        currentState: {
          topic: 'Previously Cached Running Run',
          phase: 'reviewing',
          round: 1,
          verdict: null,
          seats: []
        },
        steps: []
      };
      freshRunScript.onload();
      assert.equal(getEl('status-pill-text').textContent, 'ABORTED: REVIEWING');

      // Now fire the stale initialLatestScript.onload() from epoch 1 — pollEpoch guard must ignore it!
      initialLatestScript.onload();
      assert.equal(controller.getInternalState().selectedRunId, 'run-cached-stale');
      assert.equal(getEl('heading-topic').textContent, 'Previously Cached Running Run');
      assert.equal(getEl('status-pill-text').textContent, 'ABORTED: REVIEWING');

      // Also verify that when a run is ALREADY selected and updateRunSelector() sees a newer manifest entry, it immediately re-fetches <runId>.js!
      domWin.CouncilRuns['run-already-selected'] = {
        runId: 'run-already-selected',
        isRunning: true,
        updatedAt: '2026-11-11T10:10:00.000Z',
        currentState: { topic: 'Already Selected Running', phase: 'proving', round: 1, verdict: null, seats: [] },
        steps: []
      };
      domWin.COUNCIL_RUNS_INDEX.push({
        runId: 'run-already-selected',
        topic: 'Already Selected Running',
        isRunning: true,
        updatedAt: '2026-11-11T10:10:00.000Z'
      });
      controller.selectRun('run-already-selected');
      assert.equal(getEl('status-pill-text').textContent, 'RUNNING: PROVING');

      // Manifest now reconciles 'run-already-selected' to Aborted WHILE it is already selected!
      const scriptsBeforeManifestRefresh = appendedScripts.length;
      domWin.COUNCIL_RUNS_INDEX = domWin.COUNCIL_RUNS_INDEX.map((e) =>
        e.runId === 'run-already-selected'
          ? { ...e, isRunning: false, verdictKind: 'Aborted', updatedAt: '2026-11-11T10:12:00.000Z' }
          : e
      );
      controller.updateRunSelector();
      assert.equal(
        appendedScripts.length,
        scriptsBeforeManifestRefresh + 1,
        'updateRunSelector must automatically re-fetch the currently selected run when invalidated by manifest'
      );
      const reloadSelectedScript = appendedScripts[appendedScripts.length - 1];
      assert.match(reloadSelectedScript.src, /run-already-selected\.js\?t=/);
      domWin.CouncilRuns['run-already-selected'] = {
        runId: 'run-already-selected',
        isRunning: false,
        verdictKind: 'Aborted',
        updatedAt: '2026-11-11T10:12:00.000Z',
        currentState: { topic: 'Already Selected Running', phase: 'proving', round: 1, verdict: null, seats: [] },
        steps: []
      };
      reloadSelectedScript.onload();
      assert.equal(getEl('status-pill-text').textContent, 'ABORTED: PROVING');

      // Isolate pollEpoch guard while selectedRunId === 'latest' (toggle OFF -> ON -> fire stale epoch onload!)
      controller.selectRun('latest');
      const epochOnLatestScript = appendedScripts.filter((s) => s.id === 'script-live-reload').pop();
      assert.ok(epochOnLatestScript);
      getEl('btn-live-follow').dispatchEvent('click'); // OFF (increments pollEpoch)
      getEl('btn-live-follow').dispatchEvent('click'); // ON (new pollEpoch, still selectedRunId === 'latest'!)
      domWin.CouncilLatestLiveRun = {
        runId: 'run-stale-epoch-attempt',
        isRunning: false,
        verdictKind: 'Aborted',
        currentState: { topic: 'STALE EPOCH SHOULD BE IGNORED', phase: 'reviewing', round: 1, verdict: null, seats: [] },
        steps: []
      };
      epochOnLatestScript.onload();
      assert.equal(
        getEl('heading-topic').textContent,
        'Latest Active',
        'Stale pollEpoch onload while selectedRunId === "latest" must be ignored'
      );
    });
  });

  describe('4. Throttled Idle Watch Mode (2500ms) on Latest Live Run & Automatic New-Run Discovery', () => {
    it('stays in Idle Watch Mode (2500ms) when latest run is finished, performs zero DOM writes on unchanged idle ticks, auto-switches to a newly started run (1000ms), and stops on manual toggle OFF', () => {
      let nowMs = Date.parse('2026-11-11T12:00:30.000Z');
      const finishedRun1 = {
        runId: 'run-finished-1',
        isRunning: false,
        verdictKind: 'Unanimous Consensus',
        startedAt: '2026-11-11T12:00:00.000Z',
        updatedAt: '2026-11-11T12:00:20.000Z',
        currentState: {
          topic: 'Finished Run 1',
          phase: 'completed',
          round: 1,
          verdict: { kind: 'Unanimous Consensus', note: 'Done 1' },
          seats: [],
          proofs: [],
          objections: [],
          history: ['Done 1']
        },
        steps: [
          {
            label: 'Step 1: Reviewing',
            stateSnapshot: {
              topic: 'Finished Run 1',
              phase: 'reviewing',
              round: 1,
              verdict: null,
              seats: [],
              proofs: [],
              objections: [],
              history: ['Reviewing 1']
            }
          }
        ]
      };

      const { controller, getEl, domWin, appendedScripts, timeouts, intervals, runNextTimeout } = createVisualizerHarness({
        nowFn: () => nowMs,
        win: {
          CouncilRunIndex: [{ runId: 'run-finished-1', topic: 'Finished Run 1', isRunning: false, verdictKind: 'Unanimous Consensus' }],
          CouncilLatestLiveRun: finishedRun1
        }
      });

      const settleLastPollBatch = () => {
        const batch = appendedScripts.slice(-3);
        for (const s of batch) {
          if (s.onload) s.onload();
        }
      };

      // Booting on a finished 'latest' run enters Idle Watch Mode (aria-pressed="true", 2500ms poll, 0 active elapsed intervals)
      assert.equal(controller.getInternalState().liveFollowActive, true);
      assert.equal(getEl('btn-live-follow').getAttribute('aria-pressed'), 'true');
      assert.equal(getEl('btn-live-follow-label').textContent, 'Live Follow: ON (Idle)');
      assert.equal(intervals.size, 0, 'Elapsed interval must not run while latest run is finished');
      assert.equal(appendedScripts.length, 3, 'Initial poll must fire on boot even when initial run is finished');

      settleLastPollBatch();
      assert.equal(timeouts.size, 1, 'Idle Watch Mode must schedule a background discovery poll');
      const idleTimer = Array.from(timeouts.values())[0];
      assert.equal(idleTimer.ms, 2500, 'Idle Watch Mode poll delay must be throttled to 2500ms');

      // Inspect step 0 while in Idle Watch Mode and verify unchanged idle poll tick produces 0 live-region or DOM writes
      controller.inspectStep(0);
      assert.equal(controller.getInternalState().currentStepIdx, 0);

      const transitionWritesBefore = getEl('transition-text').textContentWrites;
      const clausesWritesBefore = getEl('clauses-list').innerHTMLWrites;
      const timelineWritesBefore = getEl('timeline-list').innerHTMLWrites;

      assert.equal(runNextTimeout(), true);
      settleLastPollBatch();

      assert.equal(getEl('transition-text').textContentWrites, transitionWritesBefore, 'Unchanged idle poll must not write to #transition-text live region');
      assert.equal(getEl('clauses-list').innerHTMLWrites, clausesWritesBefore, 'Unchanged idle poll must not rewrite #clauses-list');
      assert.equal(getEl('timeline-list').innerHTMLWrites, timelineWritesBefore, 'Unchanged idle poll must not rewrite #timeline-list');
      assert.equal(Array.from(timeouts.values())[0].ms, 2500, 'Remains at 2500ms while still idle');

      // Now simulate a brand new live run ('run-active-2') starting on disk during the next idle poll!
      const newActiveRun2 = {
        runId: 'run-active-2',
        isRunning: true,
        verdictKind: null,
        startedAt: '2026-11-11T12:00:25.000Z',
        updatedAt: '2026-11-11T12:00:28.000Z',
        currentState: {
          topic: 'Newly Discovered Active Run 2',
          phase: 'proving',
          round: 1,
          verdict: null,
          seats: [{ id: 's1', harness: 'codex', model: 'gpt-5.4', status: 'thinking', retries: 0 }],
          proofs: [],
          objections: [],
          lastTransition: { message: 'Started proving on Run 2' },
          history: ['Started proving on Run 2']
        },
        steps: [{ label: 'Run 2 Step 1', stateSnapshot: null }]
      };
      domWin.CouncilLatestLiveRun = newActiveRun2;
      domWin.CouncilRunIndex = [
        { runId: 'run-active-2', topic: 'Newly Discovered Active Run 2', isRunning: true },
        { runId: 'run-finished-1', topic: 'Finished Run 1', isRunning: false, verdictKind: 'Unanimous Consensus' }
      ];

      assert.equal(runNextTimeout(), true);
      settleLastPollBatch();

      // Visualizer automatically resets currentStepIdx to -1, renders Run 2, switches to 1000ms active polling & starts elapsed timer!
      assert.equal(controller.getInternalState().currentStepIdx, -1, 'New runId on latest must reset currentStepIdx to -1');
      assert.equal(getEl('heading-topic').textContent, 'Newly Discovered Active Run 2');
      assert.equal(getEl('status-pill-text').textContent, 'RUNNING: PROVING');
      assert.equal(getEl('btn-live-follow-label').textContent, 'Live Follow: ON (1s)');
      assert.equal(Array.from(timeouts.values())[0].ms, 1000, 'Active run must poll at 1000ms');
      assert.equal(intervals.size, 1, 'Elapsed 1s interval must start when active run is discovered');

      // Now Run 2 finishes -> transitions back to 2500ms Idle Watch Mode without turning off Live Follow
      domWin.CouncilLatestLiveRun = {
        ...newActiveRun2,
        isRunning: false,
        verdictKind: 'Unanimous Consensus',
        updatedAt: '2026-11-11T12:00:35.000Z',
        currentState: {
          ...newActiveRun2.currentState,
          phase: 'completed',
          verdict: { kind: 'Unanimous Consensus', note: 'Run 2 Done' }
        }
      };
      assert.equal(runNextTimeout(), true);
      settleLastPollBatch();

      assert.equal(controller.getInternalState().liveFollowActive, true);
      assert.equal(getEl('btn-live-follow').getAttribute('aria-pressed'), 'true');
      assert.equal(getEl('btn-live-follow-label').textContent, 'Live Follow: ON (Idle)');
      assert.equal(Array.from(timeouts.values())[0].ms, 2500);
      assert.equal(intervals.size, 0);

      // Clicking #btn-live-follow manually turns OFF Idle Watch Mode completely
      getEl('btn-live-follow').dispatchEvent('click');
      assert.equal(controller.getInternalState().liveFollowActive, false);
      assert.equal(getEl('btn-live-follow').getAttribute('aria-pressed'), 'false');
      assert.equal(getEl('btn-live-follow-label').textContent, 'Live Follow: OFF');
      assert.equal(timeouts.size, 0, 'Manual toggle OFF must clear idle watch timeout');
      assert.equal(intervals.size, 0);
    });
  });
});
