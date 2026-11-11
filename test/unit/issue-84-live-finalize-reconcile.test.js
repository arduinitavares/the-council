import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { VisualizerLiveWatcher } from '../../src/visualizer/live-watcher.js';
import { createTelemetryEmitter } from '../../src/telemetry/emitter.js';
import { runCli } from '../../src/cli/index.js';
import { HarnessRegistry } from '../../src/harness/index.js';
import { HarnessAdapter } from '../../src/harness/adapter.js';

const HTML_PATH = path.resolve(import.meta.dirname, '../../src/visualizer/index.html');
const VIS_JS_PATH = path.resolve(import.meta.dirname, '../../src/visualizer/council-visualizer.js');
await import(VIS_JS_PATH);
const CouncilVisualizerReal = globalThis.CouncilVisualizer;

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-${Date.now()}-`));
}

function evalBundle(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const ctx = { window: {}, globalThis: {} };
  ctx.globalThis = ctx;
  vm.runInNewContext(code, ctx);
  return {
    latest: ctx.window.CouncilLatestLiveRun,
    runs: ctx.window.CouncilRuns || {},
    index: ctx.window.CouncilRunIndex || []
  };
}

function createVisualizerDomRuntime(liveRun, runIndex = []) {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const scriptMatch = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);
  assert.ok(scriptMatch, 'index.html must contain inline controller script');
  const scriptBody = scriptMatch[1];

  const elements = new Map();
  const makeClassList = (el) => ({
    add(...tokens) {
      const set = new Set((el.className || '').split(/\s+/).filter(Boolean));
      for (const t of tokens) set.add(t);
      el.className = [...set].join(' ');
    },
    remove(...tokens) {
      const set = new Set((el.className || '').split(/\s+/).filter(Boolean));
      for (const t of tokens) set.delete(t);
      el.className = [...set].join(' ');
    },
    contains(token) {
      return new Set((el.className || '').split(/\s+/).filter(Boolean)).has(token);
    },
    toggle(token, force) {
      const set = new Set((el.className || '').split(/\s+/).filter(Boolean));
      const shouldAdd = force !== undefined ? Boolean(force) : !set.has(token);
      if (shouldAdd) set.add(token);
      else set.delete(token);
      el.className = [...set].join(' ');
      return shouldAdd;
    }
  });

  const makeEl = (id = '', tag = 'DIV') => {
    const attrs = new Map();
    const children = [];
    const el = {
      id,
      tagName: tag,
      className: '',
      textContent: '',
      innerHTML: '',
      value: tag === 'SELECT' ? 'latest' : '',
      hidden: false,
      style: {},
      dataset: {},
      children,
      get options() {
        return children;
      },
      get firstChild() {
        return children[0] || null;
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
      },
      getAttribute(k) {
        return attrs.has(k) ? attrs.get(k) : null;
      },
      removeAttribute(k) {
        attrs.delete(k);
      },
      appendChild(c) {
        children.push(c);
        return c;
      },
      removeChild(c) {
        const idx = children.indexOf(c);
        if (idx >= 0) children.splice(idx, 1);
        return c;
      },
      replaceChildren(...next) {
        children.length = 0;
        children.push(...next);
      },
      addEventListener() {},
      querySelector() {
        return null;
      }
    };
    el.classList = makeClassList(el);
    return el;
  };

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
    'graphs-tablist',
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
  for (const id of knownIds) {
    const tag = id.includes('selector') ? 'SELECT' : id.startsWith('btn-') ? 'BUTTON' : 'DIV';
    elements.set(id, makeEl(id, tag));
  }

  const mockDoc = {
    hidden: false,
    activeElement: null,
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => makeEl('', tag.toUpperCase()),
    addEventListener() {},
    head: { appendChild() {} }
  };

  const win = {
    CouncilLatestLiveRun: liveRun,
    CouncilRuns: liveRun?.runId ? { [liveRun.runId]: liveRun } : {},
    CouncilRunIndex: runIndex,
    CouncilTelemetrySummary: null
  };

  const controllerFn = new Function(
    'window',
    'globalThis',
    'document',
    'CouncilVisualizer',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    `${scriptBody}
    return { renderAll, updateRunSelector };`
  );

  const api = controllerFn(
    win,
    win,
    mockDoc,
    CouncilVisualizerReal,
    () => 1,
    () => {},
    () => 1,
    () => {}
  );
  return { elements, win, api };
}

class FakeLiveHarness extends HarnessAdapter {
  constructor(handlers = {}) {
    super({ name: 'codex' });
    this.handlers = handlers;
  }
  validateModel() {}
  async executeSeatProof(ctx) {
    if (this.handlers.executeSeatProof) return this.handlers.executeSeatProof(ctx);
    return { scope: 'S', kind: 'check', source: 'Src', statement: `Proof by ${ctx.seat.id}` };
  }
  async executeJudgeAuditAndSynthesis(ctx) {
    if (this.handlers.executeJudgeAuditAndSynthesis) return this.handlers.executeJudgeAuditAndSynthesis(ctx);
    return {
      summary: 'Consensus candidate',
      clauses: [{ id: 'C1', context: 'S', conclusion: 'Verified', citedProofIds: ['P1'] }],
      proofDecisions: { P1: { status: 'admitted', note: 'OK' } }
    };
  }
  async executeSeatVote(ctx) {
    if (this.handlers.executeSeatVote) return this.handlers.executeSeatVote(ctx);
    return { vote: 'accept' };
  }
}

describe('Issue #84: Live run finalization on SIGINT/SIGTERM/abort & stale [RUNNING] manifest reconciliation', () => {
  it('1. flushes isRunning: false, pid, and verdictKind: "Aborted" on liveWatcher.stop() and is idempotent on repeated stop()', () => {
    const outDir = makeTempDir('council-84-stop');
    const telDir = makeTempDir('council-84-tel');
    try {
      const telemetry = createTelemetryEmitter();
      const watcher = new VisualizerLiveWatcher({
        telemetry,
        runId: 'run-aborted-test',
        outputDir: outDir,
        telemetryDir: telDir,
        initialConfig: { topic: 'Mid-deliberation stop' }
      });

      telemetry.emitStateTransition(
        { type: 'BEGIN_ROUND' },
        {
          phase: 'reviewing',
          round: 1,
          maxRounds: 3,
          minQuorum: 2,
          topic: 'Mid-deliberation stop',
          seats: [{ id: 's1', status: 'thinking', retries: 0 }],
          judge: { id: 'j1', status: 'idle', retries: 0 },
          proofs: [],
          objections: [],
          clarifications: [],
          evidence: [],
          history: ['Round 1 started'],
          verdict: null
        }
      );

      // Before stop(): isRunning is true and pid is recorded
      const metaBefore = JSON.parse(fs.readFileSync(path.join(outDir, 'run-aborted-test.meta.json'), 'utf8'));
      assert.equal(metaBefore.isRunning, true);
      assert.equal(metaBefore.pid, process.pid);

      watcher.stop();
      // Repeated stop() with a different reason must be idempotent and not overwrite
      watcher.stop({ reason: 'DifferentReason' });

      const metaAfter = JSON.parse(fs.readFileSync(path.join(outDir, 'run-aborted-test.meta.json'), 'utf8'));
      assert.equal(metaAfter.isRunning, false);
      assert.equal(metaAfter.verdictKind, 'Aborted');
      assert.equal(metaAfter.pid, process.pid);

      const latestEval = evalBundle(path.join(outDir, 'latest.js'));
      assert.equal(latestEval.latest.isRunning, false);
      assert.equal(latestEval.latest.verdictKind, 'Aborted');

      const runEval = evalBundle(path.join(outDir, 'run-aborted-test.js'));
      assert.equal(runEval.runs['run-aborted-test'].isRunning, false);
      assert.equal(runEval.runs['run-aborted-test'].verdictKind, 'Aborted');

      const indexEval = evalBundle(path.join(outDir, 'index.js'));
      const entry = indexEval.index.find((e) => e.runId === 'run-aborted-test');
      assert.ok(entry);
      assert.equal(entry.isRunning, false);
      assert.equal(entry.verdictKind, 'Aborted');
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.rmSync(telDir, { recursive: true, force: true });
    }
  });

  it('2. preserves exact completed verdictKind and isRunning: false when stop() runs after normal completion', () => {
    for (const expectedVerdict of ['Unanimous Consensus', 'Dissent Report (Round Limit Reached)']) {
      const outDir = makeTempDir('council-84-completed');
      const telDir = makeTempDir('council-84-completed-tel');
      try {
        const telemetry = createTelemetryEmitter();
        const watcher = new VisualizerLiveWatcher({
          telemetry,
          runId: 'run-completed-test',
          outputDir: outDir,
          telemetryDir: telDir,
          initialConfig: { topic: 'Normal completion' }
        });

        telemetry.emitStateTransition(
          { type: 'EVALUATE_ROUND' },
          {
            phase: 'completed',
            round: 1,
            maxRounds: 3,
            minQuorum: 2,
            topic: 'Normal completion',
            seats: [{ id: 's1', status: 'accepted', retries: 0 }],
            judge: { id: 'j1', status: 'idle', retries: 0 },
            proofs: [],
            objections: [],
            clarifications: [],
            evidence: [],
            history: ['Completed'],
            verdict: { kind: expectedVerdict, note: 'Done' }
          }
        );

        // Simulate CLI finally { liveWatcher.stop({ reason: 'Aborted' }) }
        watcher.stop();

        const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'run-completed-test.meta.json'), 'utf8'));
        assert.equal(meta.isRunning, false);
        assert.equal(meta.verdictKind, expectedVerdict);

        const indexEval = evalBundle(path.join(outDir, 'index.js'));
        assert.equal(indexEval.index[0].isRunning, false);
        assert.equal(indexEval.index[0].verdictKind, expectedVerdict);
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.rmSync(telDir, { recursive: true, force: true });
      }
    }
  });

  it('3. aborts CouncilEngine, finalizes liveWatcher on disk, cleans up listeners without leaks, and exits 130/143/129 on SIGINT/SIGTERM/SIGHUP or mid-run throw/abort', async () => {
    const signals = [
      { sig: 'SIGINT', expectedExit: 130 },
      { sig: 'SIGTERM', expectedExit: 143 },
      { sig: 'SIGHUP', expectedExit: 129 }
    ];

    for (const { sig, expectedExit } of signals) {
      const outDir = makeTempDir(`council-84-${sig}`);
      const telDir = makeTempDir(`council-84-${sig}-tel`);
      const cfgFile = path.join(outDir, 'cfg.json');
      fs.writeFileSync(
        cfgFile,
        JSON.stringify({
          topic: `Signal ${sig} teardown`,
          minQuorum: 2,
          maxRounds: 1,
          seats: [
            { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'S1' },
            { id: 's2', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'S2' }
          ],
          judge: { id: 'j1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' }
        })
      );

      try {
        const fakeProc = new EventEmitter();
        let releaseHang;
        const hangPromise = new Promise((r) => {
          releaseHang = r;
        });

        let notifyEnteredSeat;
        const enteredSeat = new Promise((r) => {
          notifyEnteredSeat = r;
        });

        const registry = new HarnessRegistry();
        registry.register(
          'codex',
          new FakeLiveHarness({
            executeSeatProof: async () => {
              notifyEnteredSeat();
              await hangPromise;
              return { scope: 'S', kind: 'check', source: 'Src', statement: 'Proof' };
            }
          })
        );

        let recordedExit = null;
        const cliPromise = runCli(
          ['run', '--live', '-c', cfgFile, '--output-dir', outDir, '--telemetry-dir', telDir],
          {
            stdout: { write: () => true },
            stderr: { write: () => true },
            exit: (code) => {
              recordedExit = code;
              return code;
            },
            process: fakeProc,
            harnessRegistry: registry,
            liveWatcherOptions: { runId: `run-${sig.toLowerCase()}` }
          }
        );

        await enteredSeat;
        assert.equal(fakeProc.listenerCount('SIGINT'), 1);
        assert.equal(fakeProc.listenerCount('SIGTERM'), 1);
        assert.equal(fakeProc.listenerCount('SIGHUP'), 1);

        fakeProc.emit(sig);
        const code = await cliPromise;
        releaseHang();

        assert.equal(code, expectedExit);
        assert.equal(recordedExit, expectedExit);

        // Zero listener leaks after runCli unwinds
        assert.equal(fakeProc.listenerCount('SIGINT'), 0);
        assert.equal(fakeProc.listenerCount('SIGTERM'), 0);
        assert.equal(fakeProc.listenerCount('SIGHUP'), 0);

        const runId = `run-${sig.toLowerCase()}`;
        const meta = JSON.parse(fs.readFileSync(path.join(outDir, `${runId}.meta.json`), 'utf8'));
        assert.equal(meta.isRunning, false);
        assert.equal(meta.verdictKind, 'Aborted');

        const latestEval = evalBundle(path.join(outDir, 'latest.js'));
        assert.equal(latestEval.latest.isRunning, false);
        assert.equal(latestEval.latest.verdictKind, 'Aborted');

        const indexEval = evalBundle(path.join(outDir, 'index.js'));
        const entry = indexEval.index.find((e) => e.runId === runId);
        assert.equal(entry.isRunning, false);
        assert.equal(entry.verdictKind, 'Aborted');
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.rmSync(telDir, { recursive: true, force: true });
      }
    }

    // Also verify repeated normal runCli() calls leave zero process listener leaks and external io.signal abort finalizes liveWatcher
    const outDir = makeTempDir('council-84-abort-signal');
    const telDir = makeTempDir('council-84-abort-tel');
    const cfgFile = path.join(outDir, 'cfg.json');
    fs.writeFileSync(
      cfgFile,
      JSON.stringify({
        topic: 'External signal abort',
        minQuorum: 2,
        maxRounds: 1,
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'S1' },
          { id: 's2', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'S2' }
        ],
        judge: { id: 'j1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' }
      })
    );
    try {
      const beforeSigint = process.listenerCount('SIGINT');
      const beforeSigterm = process.listenerCount('SIGTERM');
      const beforeSighup = process.listenerCount('SIGHUP');

      const extAbort = new AbortController();
      const registry = new HarnessRegistry();
      registry.register(
        'codex',
        new FakeLiveHarness({
          executeSeatProof: async () => {
            extAbort.abort(new Error('Caller cancelled'));
            return { scope: 'S', kind: 'check', source: 'Src', statement: 'Proof' };
          }
        })
      );

      for (let k = 0; k < 3; k++) {
        await runCli(
          ['run', '--live', '-c', cfgFile, '--output-dir', outDir, '--telemetry-dir', telDir],
          {
            stdout: { write: () => true },
            stderr: { write: () => true },
            exit: (c) => c,
            signal: extAbort.signal,
            harnessRegistry: registry,
            liveWatcherOptions: { runId: `run-ext-abort-${k}` }
          }
        );
      }

      assert.equal(process.listenerCount('SIGINT'), beforeSigint);
      assert.equal(process.listenerCount('SIGTERM'), beforeSigterm);
      assert.equal(process.listenerCount('SIGHUP'), beforeSighup);

      const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'run-ext-abort-2.meta.json'), 'utf8'));
      assert.equal(meta.isRunning, false);
      assert.equal(meta.verdictKind, 'Aborted');
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.rmSync(telDir, { recursive: true, force: true });
    }
  });

  it('4. reconciles dead-PID (ESRCH) and stale missing-PID entries across *.meta.json, <runId>.js, and index.js while preserving live (incl. EPERM) and fresh legacy runs', () => {
    const outDir = makeTempDir('council-84-reconcile');
    const telDir = makeTempDir('council-84-reconcile-tel');
    try {
      const now = Date.now();
      const oldIso = new Date(now - 60 * 60 * 1000).toISOString(); // 60m old (> 30m default)
      const freshIso = new Date(now - 2 * 60 * 1000).toISOString(); // 2m old (< 30m)

      // 1) Dead PID (ESRCH) run created by an earlier crashed watcher (real _buildBundleScript format)
      const deadWatcher = new VisualizerLiveWatcher({
        runId: 'run-dead-pid',
        pid: 999001,
        outputDir: outDir,
        telemetryDir: telDir,
        initialConfig: { topic: 'SIGKILL orphaned run' },
        killProbe: () => true
      });
      deadWatcher.detach(); // Detach WITHOUT stop() to simulate SIGKILL crash!

      // 2) Live PID returning EPERM (owned by another user — MUST NOT mark dead!)
      const epermWatcher = new VisualizerLiveWatcher({
        runId: 'run-eperm-live',
        pid: 999002,
        outputDir: outDir,
        telemetryDir: telDir,
        initialConfig: { topic: 'Other user live run' },
        killProbe: () => true
      });
      epermWatcher.detach();

      // 3) Stale legacy entry without pid (and window.COUNCIL_LIVE_RUN = ...; format!)
      fs.writeFileSync(
        path.join(outDir, 'run-legacy-stale.meta.json'),
        JSON.stringify(
          {
            id: 'run-legacy-stale',
            runId: 'run-legacy-stale',
            file: 'run-legacy-stale.js',
            title: 'Legacy stale run',
            topic: 'Legacy stale',
            startedAt: oldIso,
            updatedAt: oldIso,
            isRunning: true,
            verdictKind: null
          },
          null,
          2
        )
      );
      fs.writeFileSync(
        path.join(outDir, 'run-legacy-stale.js'),
        `window.COUNCIL_LIVE_RUN = ${JSON.stringify({
          runId: 'run-legacy-stale',
          isRunning: true,
          verdictKind: null,
          startedAt: oldIso,
          updatedAt: oldIso,
          steps: []
        })};\n`
      );

      // 4) Fresh legacy entry without pid (< staleRunThresholdMs — MUST remain isRunning: true!)
      fs.writeFileSync(
        path.join(outDir, 'run-legacy-fresh.meta.json'),
        JSON.stringify(
          {
            id: 'run-legacy-fresh',
            runId: 'run-legacy-fresh',
            file: 'run-legacy-fresh.js',
            title: 'Legacy fresh run',
            topic: 'Legacy fresh',
            startedAt: freshIso,
            updatedAt: freshIso,
            isRunning: true,
            verdictKind: null
          },
          null,
          2
        )
      );

      // Now launch a new watcher with deterministic killProbe
      const activeWatcher = new VisualizerLiveWatcher({
        runId: 'run-current-active',
        outputDir: outDir,
        telemetryDir: telDir,
        staleRunThresholdMs: 10 * 60 * 1000, // 10 minutes
        initialConfig: { topic: 'Current active run' },
        killProbe: (pid) => {
          if (pid === 999001) {
            const err = new Error('No such process');
            err.code = 'ESRCH';
            throw err;
          }
          if (pid === 999002) {
            const err = new Error('Operation not permitted');
            err.code = 'EPERM';
            throw err;
          }
          return true;
        }
      });

      // Verify index.js
      const indexEval = evalBundle(path.join(outDir, 'index.js'));
      const byId = new Map(indexEval.index.map((e) => [e.runId, e]));

      // Dead PID -> reconciled!
      assert.equal(byId.get('run-dead-pid').isRunning, false);
      assert.equal(byId.get('run-dead-pid').verdictKind, 'Aborted');
      const deadMeta = JSON.parse(fs.readFileSync(path.join(outDir, 'run-dead-pid.meta.json'), 'utf8'));
      assert.equal(deadMeta.isRunning, false);
      assert.equal(deadMeta.verdictKind, 'Aborted');
      const deadRunEval = evalBundle(path.join(outDir, 'run-dead-pid.js'));
      assert.equal(deadRunEval.runs['run-dead-pid'].isRunning, false);
      assert.equal(deadRunEval.runs['run-dead-pid'].verdictKind, 'Aborted');

      // Stale legacy without PID -> reconciled!
      assert.equal(byId.get('run-legacy-stale').isRunning, false);
      assert.equal(byId.get('run-legacy-stale').verdictKind, 'Aborted');
      const staleMeta = JSON.parse(fs.readFileSync(path.join(outDir, 'run-legacy-stale.meta.json'), 'utf8'));
      assert.equal(staleMeta.isRunning, false);
      assert.equal(staleMeta.verdictKind, 'Aborted');
      const staleRunEval = evalBundle(path.join(outDir, 'run-legacy-stale.js'));
      assert.equal(staleRunEval.runs['run-legacy-stale'].isRunning, false);
      assert.equal(staleRunEval.runs['run-legacy-stale'].verdictKind, 'Aborted');

      // EPERM live PID -> untouched!
      assert.equal(byId.get('run-eperm-live').isRunning, true);
      assert.equal(byId.get('run-eperm-live').verdictKind, null);

      // Fresh legacy without PID -> untouched!
      assert.equal(byId.get('run-legacy-fresh').isRunning, true);
      assert.equal(byId.get('run-legacy-fresh').verdictKind, null);

      activeWatcher.stop();
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.rmSync(telDir, { recursive: true, force: true });
    }
  });

  it('5. renders stopped non-completed runs in src/visualizer/index.html as ABORTED without contradictory COMPLETED: DISSENT or .running banner', () => {
    const abortedLiveRun = {
      id: 'wt-live-latest',
      runId: 'run-aborted-ui',
      isRunning: false,
      verdictKind: 'Aborted',
      startedAt: '2026-11-11T05:00:00.000Z',
      updatedAt: '2026-11-11T05:01:00.000Z',
      currentState: {
        topic: 'Aborted UI Check',
        phase: 'reviewing',
        round: 1,
        maxRounds: 3,
        minQuorum: 2,
        verdict: null,
        candidate: null,
        seats: [{ id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', status: 'thinking', retries: 0 }],
        judge: { id: 'j1', harness: 'codex', model: 'gpt-6-astra (max)', status: 'idle', retries: 0 },
        proofs: [],
        objections: [],
        lastTransition: { ok: true, message: 'Began Round 1/3 proof collection' },
        history: ['Began Round 1/3 proof collection']
      },
      steps: []
    };
    const runIndex = [
      {
        runId: 'run-aborted-ui',
        topic: 'Aborted UI Check',
        isRunning: false,
        verdictKind: 'Aborted'
      }
    ];

    const { elements, api } = createVisualizerDomRuntime(abortedLiveRun, runIndex);
    api.updateRunSelector();
    api.renderAll();

    const statusPill = elements.get('status-pill');
    const statusPillText = elements.get('status-pill-text');
    const verdictStatus = elements.get('lbl-verdict-status');
    const verdictBox = elements.get('verdict-box');
    const verdictTitle = elements.get('verdict-title');
    const verdictBody = elements.get('verdict-body');
    const transitionText = elements.get('transition-text');
    const runSelector = elements.get('run-selector');

    assert.equal(statusPill.className, 'badge badge-failed');
    assert.equal(statusPillText.textContent, 'ABORTED: REVIEWING');
    assert.equal(verdictStatus.className, 'badge badge-failed');
    assert.equal(verdictStatus.textContent, 'RUN ABORTED');

    assert.equal(verdictBox.classList.contains('running'), false);
    assert.equal(verdictBox.className, 'verdict-banner dissent');
    assert.equal(verdictTitle.textContent, 'Deliberation Aborted (Round 1)');
    assert.doesNotMatch(verdictTitle.textContent, /Deliberation in Progress/);
    assert.doesNotMatch(statusPillText.textContent, /COMPLETED: DISSENT/);
    assert.match(verdictBody.textContent, /stopped before reaching a terminal verdict/i);
    assert.match(transitionText.textContent, /aborted before reaching a terminal verdict/i);
    assert.doesNotMatch(transitionText.textContent, /Began Round 1\/3/);

    const runOpt = runSelector.options.find((o) => o.value === 'run-aborted-ui');
    assert.ok(runOpt);
    assert.match(runOpt.textContent, /\[Aborted\]$/);
  });

  it('3c. external io.signal cancellation while executeSeatProof() remains pending finalizes all artifacts immediately without waiting on stuck provider', async () => {
    const outDir = makeTempDir('council-84-pending-ext-abort');
    const telDir = makeTempDir('council-84-pending-ext-abort-tel');
    const cfgFile = path.join(outDir, 'config.json');
    fs.writeFileSync(
      cfgFile,
      JSON.stringify({
        topic: 'Pending external signal abort test',
        minQuorum: 2,
        maxRounds: 1,
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'A' },
          { id: 's2', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'B' }
        ],
        judge: { id: 'j1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' }
      })
    );

    let releasePendingProvider;
    const neverEndingUntilCleaned = new Promise((resolve) => {
      releasePendingProvider = resolve;
    });

    try {
      const beforeSigint = process.listenerCount('SIGINT');
      const beforeSigterm = process.listenerCount('SIGTERM');
      const beforeSighup = process.listenerCount('SIGHUP');

      const extAbort = new AbortController();
      let enteredSeat = false;
      const registry = new HarnessRegistry();
      registry.register(
        'codex',
        new FakeLiveHarness({
          executeSeatProof: async () => {
            if (!enteredSeat) {
              enteredSeat = true;
              setImmediate(() => extAbort.abort(new Error('External caller timeout')));
            }
            return neverEndingUntilCleaned;
          }
        })
      );

      const exitCode = await runCli(
        ['run', '--live', '-c', cfgFile, '--output-dir', outDir, '--telemetry-dir', telDir],
        {
          stdout: { write: () => true },
          stderr: { write: () => true },
          exit: (c) => c,
          signal: extAbort.signal,
          harnessRegistry: registry,
          liveWatcherOptions: { runId: 'run-ext-pending' }
        }
      );

      assert.equal(exitCode, 2);
      assert.equal(process.listenerCount('SIGINT'), beforeSigint);
      assert.equal(process.listenerCount('SIGTERM'), beforeSigterm);
      assert.equal(process.listenerCount('SIGHUP'), beforeSighup);

      const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'run-ext-pending.meta.json'), 'utf8'));
      assert.equal(meta.isRunning, false);
      assert.equal(meta.verdictKind, 'Aborted');

      const latestEval = evalBundle(path.join(outDir, 'latest.js'));
      assert.equal(latestEval.latest.isRunning, false);
      assert.equal(latestEval.latest.verdictKind, 'Aborted');

      const runEval = evalBundle(path.join(outDir, 'run-ext-pending.js'));
      assert.equal(runEval.runs['run-ext-pending'].isRunning, false);
      assert.equal(runEval.runs['run-ext-pending'].verdictKind, 'Aborted');

      const indexEval = evalBundle(path.join(outDir, 'index.js'));
      const entry = indexEval.index.find((e) => e.runId === 'run-ext-pending');
      assert.equal(entry.isRunning, false);
      assert.equal(entry.verdictKind, 'Aborted');
    } finally {
      releasePendingProvider({ scope: 'S', kind: 'check', source: 'Src', statement: 'Done' });
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.rmSync(telDir, { recursive: true, force: true });
    }
  });

  it('4b. reconciles legacy bundles containing "};" and "CouncilRuns" inside JSON strings, retains retry eligibility on corrupt bundle, and reconciles latest.js under custom outputPath', () => {
    const outDir = makeTempDir('council-84-edge-reconcile');
    const telDir = makeTempDir('council-84-edge-reconcile-tel');
    try {
      const oldIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      // 1) Legacy bundle whose step text contains BOTH `};` AND `CouncilRuns`
      fs.writeFileSync(
        path.join(outDir, 'run-tricky-legacy.meta.json'),
        JSON.stringify(
          {
            id: 'run-tricky-legacy',
            runId: 'run-tricky-legacy',
            file: 'run-tricky-legacy.js',
            title: 'Tricky Legacy',
            topic: 'Parser edge case',
            startedAt: oldIso,
            updatedAt: oldIso,
            isRunning: true,
            verdictKind: null
          },
          null,
          2
        )
      );
      fs.writeFileSync(
        path.join(outDir, 'run-tricky-legacy.js'),
        `window.COUNCIL_LIVE_RUN = ${JSON.stringify({
          runId: 'run-tricky-legacy',
          isRunning: true,
          verdictKind: null,
          startedAt: oldIso,
          updatedAt: oldIso,
          steps: [
            {
              summary: 'Code snippet: const fn = () => { return window.CouncilRuns; }; statement'
            }
          ]
        })};\n`
      );

      // 2) Corrupt/half-written `<runId>.js` — should retain retry eligibility in `.meta.json` until repaired
      fs.writeFileSync(
        path.join(outDir, 'run-half-written.meta.json'),
        JSON.stringify(
          {
            id: 'run-half-written',
            runId: 'run-half-written',
            pid: 999404,
            file: 'run-half-written.js',
            title: 'Half Written',
            topic: 'Partial write',
            startedAt: oldIso,
            updatedAt: oldIso,
            isRunning: true,
            verdictKind: null
          },
          null,
          2
        )
      );
      fs.writeFileSync(path.join(outDir, 'run-half-written.js'), 'window.COUNCIL_LIVE_RUN = {"runId":"run-half-written"');

      // 3) Dead-PID orphan referenced by default `latest.js` while new watcher writes to custom `outputPath`
      const orphanWatcher = new VisualizerLiveWatcher({
        runId: 'run-orphan-latest',
        pid: 999405,
        outputDir: outDir,
        telemetryDir: telDir,
        initialConfig: { topic: 'Orphaned default latest.js' },
        killProbe: () => true
      });
      orphanWatcher.detach();
      assert.equal(evalBundle(path.join(outDir, 'latest.js')).latest.isRunning, true);

      const customWatcher = new VisualizerLiveWatcher({
        runId: 'run-custom-ptr',
        outputDir: outDir,
        outputPath: path.join(outDir, 'custom-pointer.js'),
        telemetryDir: telDir,
        staleRunThresholdMs: 10 * 60 * 1000,
        initialConfig: { topic: 'Custom pointer watcher' },
        killProbe: (pid) => {
          if (pid === 999404 || pid === 999405) {
            const err = new Error('No such process');
            err.code = 'ESRCH';
            throw err;
          }
          return true;
        }
      });

      // Verify tricky legacy bundle parsed & registered in CouncilRuns cleanly!
      const trickyMeta = JSON.parse(fs.readFileSync(path.join(outDir, 'run-tricky-legacy.meta.json'), 'utf8'));
      assert.equal(trickyMeta.isRunning, false);
      assert.equal(trickyMeta.verdictKind, 'Aborted');
      const trickyEval = evalBundle(path.join(outDir, 'run-tricky-legacy.js'));
      assert.ok(trickyEval.runs['run-tricky-legacy'], 'CouncilRuns[runId] must be registered even when payload mentions CouncilRuns');
      assert.equal(trickyEval.runs['run-tricky-legacy'].isRunning, false);
      assert.equal(trickyEval.runs['run-tricky-legacy'].verdictKind, 'Aborted');
      assert.match(trickyEval.runs['run-tricky-legacy'].steps[0].summary, /};\s*statement/);

      // Verify default latest.js pointing to dead `run-orphan-latest` was reconciled even under custom outputPath!
      const defaultLatestEval = evalBundle(path.join(outDir, 'latest.js'));
      assert.equal(defaultLatestEval.latest.runId, 'run-orphan-latest');
      assert.equal(defaultLatestEval.latest.isRunning, false);
      assert.equal(defaultLatestEval.latest.verdictKind, 'Aborted');

      // Verify half-written bundle retained `isRunning: true` in meta on disk for retry, then reconciles once valid!
      const halfMetaBefore = JSON.parse(fs.readFileSync(path.join(outDir, 'run-half-written.meta.json'), 'utf8'));
      assert.equal(halfMetaBefore.isRunning, true);

      fs.writeFileSync(
        path.join(outDir, 'run-half-written.js'),
        `window.COUNCIL_LIVE_RUN = ${JSON.stringify({
          runId: 'run-half-written',
          isRunning: true,
          verdictKind: null
        })};\n`
      );
      customWatcher.stop();

      const halfMetaAfter = JSON.parse(fs.readFileSync(path.join(outDir, 'run-half-written.meta.json'), 'utf8'));
      assert.equal(halfMetaAfter.isRunning, false);
      assert.equal(halfMetaAfter.verdictKind, 'Aborted');
      const halfEvalAfter = evalBundle(path.join(outDir, 'run-half-written.js'));
      assert.equal(halfEvalAfter.runs['run-half-written'].isRunning, false);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.rmSync(telDir, { recursive: true, force: true });
    }
  });
});
