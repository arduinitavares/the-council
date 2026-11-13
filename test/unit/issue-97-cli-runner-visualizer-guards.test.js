import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  execCli,
  runAntigravityCli,
  runCodexCli,
  runCursorCli
} from '../../src/harness/cli-runner.js';

const HTML_PATH = path.resolve(import.meta.dirname, '../../src/visualizer/index.html');
const VIS_JS_PATH = path.resolve(import.meta.dirname, '../../src/visualizer/council-visualizer.js');

await import(VIS_JS_PATH);
const CouncilVisualizerReal = globalThis.CouncilVisualizer;

function createVisualizerHarness() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const match = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);
  assert.ok(match, 'index.html must contain inline controller script before </body>');
  const scriptBody = match[1];

  const elements = new Map();
  const appendedScripts = [];
  const docListeners = new Map();

  function makeClassList(el) {
    return {
      _set: new Set(String(el.className || '').split(/\s+/).filter(Boolean)),
      add(token) { this._set.add(token); el.className = Array.from(this._set).join(' '); },
      remove(token) { this._set.delete(token); el.className = Array.from(this._set).join(' '); },
      toggle(token, force) {
        const shouldHave = force !== undefined ? Boolean(force) : !this._set.has(token);
        if (shouldHave) this._set.add(token);
        else this._set.delete(token);
        el.className = Array.from(this._set).join(' ');
        return shouldHave;
      },
      contains(token) { return this._set.has(token); }
    };
  }

  function makeElement(id, tagName = 'DIV') {
    const children = [];
    const attrs = new Map();
    const el = {
      id,
      tagName,
      value: id === 'run-selector' ? 'latest' : id === 'telemetry-group-by' ? 'model' : id === 'telemetry-window' ? 'all' : '',
      className: '',
      hidden: false,
      style: {},
      dataset: {},
      children,
      options: children,
      textContent: '',
      innerHTML: '',
      setAttribute(name, val) { attrs.set(name, String(val)); if (name === 'id') this.id = String(val); },
      getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
      removeAttribute(name) { attrs.delete(name); },
      hasAttribute(name) { return attrs.has(name); },
      appendChild(child) { children.push(child); return child; },
      removeChild(child) { const i = children.indexOf(child); if (i >= 0) children.splice(i, 1); return child; },
      replaceChildren(...next) { children.length = 0; children.push(...next); },
      addEventListener() {},
      querySelector() { return null; },
      remove() {
        this.removed = true;
        if (this.id && elements.get(this.id) === this) elements.delete(this.id);
      }
    };
    el.classList = makeClassList(el);
    return el;
  }

  const knownIds = [
    'run-selector', 'badge-live-tag', 'stream-badge', 'status-pill', 'status-pill-text',
    'lbl-elapsed', 'btn-live-follow', 'btn-live-follow-label', 'heading-topic', 'lbl-phase',
    'lbl-round', 'lbl-max-rounds', 'lbl-quorum', 'lbl-verdict-status', 'verdict-box',
    'verdict-title', 'verdict-body', 'synthesis-text', 'transition-text', 'lbl-clauses-count',
    'clauses-list', 'lbl-objs-count', 'objections-list', 'lbl-roster-count', 'seats-grid',
    'lbl-proofs-count', 'proofs-list', 'btn-tab-topology', 'btn-tab-causal', 'stage-topology',
    'stage-causal', 'state-machine-svg', 'causal-dependency-svg', 'btn-jump-latest',
    'timeline-list', 'lbl-telemetry-runs', 'telemetry-group-by', 'telemetry-window',
    'telemetry-leaderboard-body'
  ];
  for (const id of knownIds) elements.set(id, makeElement(id));

  const mockDoc = {
    activeElement: null,
    hidden: false,
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => makeElement('', tag.toUpperCase()),
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    head: {
      appendChild: (el) => {
        if (el.id) elements.set(el.id, el);
        appendedScripts.push(el);
      }
    }
  };

  let nextTimerId = 1;
  const fakeSetTimeout = (fn, ms) => ({ id: nextTimerId++, fn, ms, unref() {} });
  const fakeClearTimeout = () => {};
  const fakeSetInterval = (fn, ms) => ({ id: nextTimerId++, fn, ms, unref() {} });
  const fakeClearInterval = () => {};
  const domWin = {};

  const controllerFn = new Function(
    'window', 'globalThis', 'document', 'CouncilVisualizer',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date',
    `${scriptBody}
    return {
      pollLiveRun,
      stopLiveFollow,
      startLiveFollow,
      selectRun,
      getInternalState: () => ({ liveFollowActive, pollInFlight, pollEpoch, selectedRunId }),
      setInternalState: (patch) => {
        if (Object.prototype.hasOwnProperty.call(patch, 'liveFollowActive')) liveFollowActive = patch.liveFollowActive;
        if (Object.prototype.hasOwnProperty.call(patch, 'selectedRunId')) selectedRunId = patch.selectedRunId;
        if (Object.prototype.hasOwnProperty.call(patch, 'pollEpoch')) pollEpoch = patch.pollEpoch;
      }
    };`
  );

  const controller = controllerFn(
    domWin, domWin, mockDoc, CouncilVisualizerReal,
    fakeSetTimeout, fakeClearTimeout, fakeSetInterval, fakeClearInterval, Date
  );

  return { controller, appendedScripts };
}

async function waitForFile(filePath, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (content.length > 0) {
        return content;
      }
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function assertPidDead(pid, label = 'process') {
  assert.throws(
    () => process.kill(pid, 0),
    (err) => err && err.code === 'ESRCH',
    `Expected ${label} (pid=${pid}) to be terminated (ESRCH)`
  );
}

describe('Issue #97 — CLI Runner & Visualizer Guards', () => {
  describe('Slice 1: runAntigravityCli envelope normalization and trace.outcome classification', () => {
    it('keeps --output-format json, normalizes empty/whitespace output to "", and records trace.outcome === "error"', async () => {
      const emptyPayloads = [
        '{"response":""}',
        '{"response":"  "}',
        '{"response":"   \\n\\t  "}',
        '',
        '   ',
        '{"response":"","finished_reason":"print_timeout"}',
        '{"response":"   ","finished_reason":"interrupted"}'
      ];

      for (const stdout of emptyPayloads) {
        let capturedArgs = null;
        const directRecords = [];
        const telemetryRecords = [];

        const out = await runAntigravityCli({
          model: 'gemini-4-argon-high',
          prompt: 'Evaluate candidate',
          context: {
            seatId: 'argon-seat',
            telemetry: {
              emitProviderCall: (rec) => telemetryRecords.push(rec)
            }
          },
          onCallRecord: (rec) => directRecords.push(rec),
          exec: async (_bin, args) => {
            capturedArgs = args;
            return { stdout, stderr: '', exitCode: 0 };
          }
        });

        assert.ok(Array.isArray(capturedArgs));
        const fmtIdx = capturedArgs.indexOf('--output-format');
        assert.notEqual(fmtIdx, -1, 'Expected --output-format flag');
        assert.equal(capturedArgs[fmtIdx + 1], 'json', 'Must preserve --output-format json');

        assert.equal(out, '', `Expected "" for payload ${JSON.stringify(stdout)}`);
        assert.equal(directRecords.length, 1);
        assert.equal(telemetryRecords.length, 1);
        assert.equal(
          directRecords[0].trace.outcome,
          'error',
          `Expected error outcome in onCallRecord for ${JSON.stringify(stdout)}`
        );
        assert.equal(
          telemetryRecords[0].trace.outcome,
          'error',
          `Expected error outcome in telemetry for ${JSON.stringify(stdout)}`
        );
      }
    });

    it('preserves non-empty response verbatim while recording trace.outcome === "error" when failure metadata is present', async () => {
      const failureCases = [
        { stdout: '{"response":"partial","finished_reason":"error"}', expected: 'partial' },
        { stdout: '{"response":"partial","finished_reason":"print_timeout"}', expected: 'partial' },
        { stdout: '{"response":"partial","finished_reason":"interrupted"}', expected: 'partial' },
        { stdout: '{"response":"partial","error":{"message":"failed"}}', expected: 'partial' },
        { stdout: '{"response":"  partial  ","error":"boom"}', expected: '  partial  ' }
      ];

      for (const { stdout, expected } of failureCases) {
        const directRecords = [];
        const telemetryRecords = [];

        const out = await runAntigravityCli({
          model: 'gemini-4-argon-high',
          prompt: 'Evaluate candidate',
          context: {
            seatId: 'argon-seat',
            telemetry: {
              emitProviderCall: (rec) => telemetryRecords.push(rec)
            }
          },
          onCallRecord: (rec) => directRecords.push(rec),
          exec: async () => ({ stdout, stderr: '', exitCode: 0 })
        });

        assert.equal(out, expected, `Expected verbatim response for ${stdout}`);
        assert.equal(directRecords.length, 1);
        assert.equal(telemetryRecords.length, 1);
        assert.equal(directRecords[0].trace.outcome, 'error');
        assert.equal(telemetryRecords[0].trace.outcome, 'error');
      }
    });

    it('records trace.outcome === "success" and preserves response verbatim for valid non-empty envelopes without failure metadata', async () => {
      const validCases = [
        { stdout: '{"response":"{\\"vote\\":\\"accept\\"}"}', expected: '{"vote":"accept"}' },
        { stdout: '{"response":"  valid  ","finished_reason":"stop","error":null}', expected: '  valid  ' }
      ];

      for (const { stdout, expected } of validCases) {
        const directRecords = [];
        const telemetryRecords = [];

        const out = await runAntigravityCli({
          model: 'gemini-4-argon-high',
          prompt: 'Evaluate candidate',
          context: {
            seatId: 'argon-seat',
            telemetry: {
              emitProviderCall: (rec) => telemetryRecords.push(rec)
            }
          },
          onCallRecord: (rec) => directRecords.push(rec),
          exec: async () => ({ stdout, stderr: '', exitCode: 0 })
        });

        assert.equal(out, expected);
        assert.equal(directRecords.length, 1);
        assert.equal(telemetryRecords.length, 1);
        assert.equal(directRecords[0].trace.outcome, 'success');
        assert.equal(telemetryRecords[0].trace.outcome, 'success');
      }
    });
  });

  describe('Slice 2: POSIX spawn process-group isolation and stdio destruction in execCli', { skip: process.platform === 'win32' }, () => {
    const trackedPids = new Set();
    after(() => {
      for (const pid of trackedPids) {
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }
      trackedPids.clear();
    });

    it('spawns subprocess as its own POSIX process-group leader (pgid === pid) and collects full normal-exit output', { timeout: 4000 }, async () => {
      const childScript = [
        'const { execFileSync } = require("node:child_process");',
        'const pgid = Number(execFileSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" }).trim());',
        'process.stdout.write(JSON.stringify({ pid: process.pid, pgid }) + "\\n");',
        'setTimeout(() => { process.stdout.write("flushed-tail"); process.stderr.write("stderr-tail"); }, 30);'
      ].join(' ');

      const res = await execCli(process.execPath, ['-e', childScript], { timeoutMs: 2000 });
      assert.equal(res.exitCode, 0);
      const [firstLine, tail] = res.stdout.split('\n');
      const info = JSON.parse(firstLine);
      assert.equal(info.pgid, info.pid, `Expected pgid === pid, got pgid=${info.pgid}, pid=${info.pid}`);
      assert.equal(tail, 'flushed-tail');
      assert.equal(res.stderr, 'stderr-tail');
    });

    it('aborting a SIGTERM-trapping leader with a 1500ms inherited-pipe grandchild settles in <400ms and kills both (ESRCH)', { timeout: 4000 }, async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue97-abort-group-'));
      const leaderPidFile = path.join(tmpDir, 'leader.pid');
      const childPidFile = path.join(tmpDir, 'child.pid');
      const controller = new AbortController();

      const leaderScript = [
        'const fs = require("node:fs");',
        'const { spawn } = require("node:child_process");',
        'process.on("SIGTERM", () => {});',
        'const gc = spawn(process.execPath, ["-e", "setTimeout(() => {}, 1500);"], { stdio: "inherit" });',
        `fs.writeFileSync(${JSON.stringify(childPidFile)}, String(gc.pid));`,
        `fs.writeFileSync(${JSON.stringify(leaderPidFile)}, String(process.pid));`,
        'setTimeout(() => process.exit(0), 2000);'
      ].join(' ');

      let leaderPid = 0;
      let childPid = 0;
      try {
        const execPromise = execCli(process.execPath, ['-e', leaderScript], {
          signal: controller.signal,
          killGraceMs: 50
        });

        leaderPid = Number(await waitForFile(leaderPidFile));
        childPid = Number(await waitForFile(childPidFile));
        trackedPids.add(leaderPid);
        trackedPids.add(childPid);

        const abortAt = Date.now();
        controller.abort();

        await assert.rejects(
          execPromise,
          (err) => err && err.name === 'AbortError' && err.code === 'ABORT_ERR'
        );

        const elapsed = Date.now() - abortAt;
        assert.ok(elapsed < 400, `Expected abort settlement < 400ms, took ${elapsed}ms`);
        assertPidDead(leaderPid, 'leader');
        assertPidDead(childPid, 'inherited-pipe grandchild');
      } finally {
        try { if (childPid) process.kill(childPid, 'SIGKILL'); } catch {}
        try { if (leaderPid) process.kill(leaderPid, 'SIGKILL'); } catch {}
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('timing out a SIGTERM-trapping leader with a 1500ms inherited-pipe grandchild settles in <400ms and kills both (ESRCH)', { timeout: 4000 }, async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue97-timeout-group-'));
      const leaderPidFile = path.join(tmpDir, 'leader.pid');
      const childPidFile = path.join(tmpDir, 'child.pid');

      const leaderScript = [
        'const fs = require("node:fs");',
        'const { spawn } = require("node:child_process");',
        'process.on("SIGTERM", () => {});',
        'const gc = spawn(process.execPath, ["-e", "setTimeout(() => {}, 1500);"], { stdio: "inherit" });',
        `fs.writeFileSync(${JSON.stringify(childPidFile)}, String(gc.pid));`,
        `fs.writeFileSync(${JSON.stringify(leaderPidFile)}, String(process.pid));`,
        'setTimeout(() => process.exit(0), 2000);'
      ].join(' ');

      let leaderPid = 0;
      let childPid = 0;
      try {
        const startedAt = Date.now();
        const execPromise = execCli(process.execPath, ['-e', leaderScript], {
          timeoutMs: 80,
          killGraceMs: 50
        });

        leaderPid = Number(await waitForFile(leaderPidFile));
        childPid = Number(await waitForFile(childPidFile));
        trackedPids.add(leaderPid);
        trackedPids.add(childPid);

        await assert.rejects(
          execPromise,
          (err) => err && err.killed === true && err.code === 'ETIMEDOUT'
        );

        const elapsed = Date.now() - startedAt;
        assert.ok(elapsed < 400, `Expected timeout settlement < 400ms, took ${elapsed}ms`);
        assertPidDead(leaderPid, 'leader');
        assertPidDead(childPid, 'inherited-pipe grandchild');
      } finally {
        try { if (childPid) process.kill(childPid, 'SIGKILL'); } catch {}
        try { if (leaderPid) process.kill(leaderPid, 'SIGKILL'); } catch {}
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('still escalates SIGKILL against -pid when leader exits immediately on SIGTERM while in-group grandchild ignores SIGTERM', { timeout: 4000 }, async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue97-leader-exits-'));
      const leaderPidFile = path.join(tmpDir, 'leader.pid');
      const childPidFile = path.join(tmpDir, 'child.pid');
      const readyFile = path.join(tmpDir, 'grandchild.ready');
      const controller = new AbortController();

      const grandchildCode = [
        'const fs = require("node:fs");',
        'process.on("SIGTERM", () => {});',
        `fs.writeFileSync(${JSON.stringify(readyFile)}, "ready");`,
        'setTimeout(() => {}, 1500);'
      ].join(' ');
      const leaderScript = [
        'const fs = require("node:fs");',
        'const { spawn } = require("node:child_process");',
        `const gc = spawn(process.execPath, ["-e", ${JSON.stringify(grandchildCode)}], { stdio: "inherit" });`,
        `fs.writeFileSync(${JSON.stringify(childPidFile)}, String(gc.pid));`,
        `fs.writeFileSync(${JSON.stringify(leaderPidFile)}, String(process.pid));`,
        'setTimeout(() => process.exit(0), 2000);'
      ].join(' ');

      let leaderPid = 0;
      let childPid = 0;
      try {
        const execPromise = execCli(process.execPath, ['-e', leaderScript], {
          signal: controller.signal,
          killGraceMs: 50
        });

        leaderPid = Number(await waitForFile(leaderPidFile));
        childPid = Number(await waitForFile(childPidFile));
        trackedPids.add(leaderPid);
        trackedPids.add(childPid);
        await waitForFile(readyFile);

        const abortAt = Date.now();
        controller.abort();

        await assert.rejects(
          execPromise,
          (err) => err && err.name === 'AbortError' && err.code === 'ABORT_ERR'
        );

        const elapsed = Date.now() - abortAt;
        assert.ok(elapsed < 400, `Expected settlement < 400ms, took ${elapsed}ms`);
        assertPidDead(leaderPid, 'leader');
        assertPidDead(childPid, 'SIGTERM-ignoring in-group grandchild');
      } finally {
        try { if (childPid) process.kill(childPid, 'SIGKILL'); } catch {}
        try { if (leaderPid) process.kill(leaderPid, 'SIGKILL'); } catch {}
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('still escalates SIGKILL against -pid when leader exits on SIGTERM and in-group grandchild closes stdio (stdio: ignore)', { timeout: 4000 }, async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue97-closed-stdio-gc-'));
      const leaderPidFile = path.join(tmpDir, 'leader.pid');
      const childPidFile = path.join(tmpDir, 'child.pid');
      const readyFile = path.join(tmpDir, 'grandchild.ready');

      const grandchildCode = [
        'const fs = require("node:fs");',
        'process.on("SIGTERM", () => {});',
        `fs.writeFileSync(${JSON.stringify(readyFile)}, "ready");`,
        'setTimeout(() => {}, 1500);'
      ].join(' ');
      const leaderScript = [
        'const fs = require("node:fs");',
        'const { spawn } = require("node:child_process");',
        `const gc = spawn(process.execPath, ["-e", ${JSON.stringify(grandchildCode)}], { stdio: "ignore" });`,
        'gc.unref();',
        `fs.writeFileSync(${JSON.stringify(childPidFile)}, String(gc.pid));`,
        `fs.writeFileSync(${JSON.stringify(leaderPidFile)}, String(process.pid));`,
        'setTimeout(() => process.exit(0), 2000);'
      ].join(' ');

      let leaderPid = 0;
      let childPid = 0;
      try {
        const execPromise = execCli(process.execPath, ['-e', leaderScript], {
          timeoutMs: 120,
          killGraceMs: 50
        });

        leaderPid = Number(await waitForFile(leaderPidFile));
        childPid = Number(await waitForFile(childPidFile));
        trackedPids.add(leaderPid);
        trackedPids.add(childPid);
        await waitForFile(readyFile);

        const startedWaitAt = Date.now();
        await assert.rejects(
          execPromise,
          (err) => err && err.killed === true && err.code === 'ETIMEDOUT'
        );

        const elapsed = Date.now() - startedWaitAt;
        assert.ok(elapsed < 400, `Expected bounded escalation settlement < 400ms, took ${elapsed}ms`);
        assertPidDead(leaderPid, 'leader');
        assertPidDead(childPid, 'closed-stdio SIGTERM-ignoring in-group grandchild');
      } finally {
        try { if (childPid) process.kill(childPid, 'SIGKILL'); } catch {}
        try { if (leaderPid) process.kill(leaderPid, 'SIGKILL'); } catch {}
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('keeps existing drainTimer refd when close arrives after SIGKILL with delayed group reaping (no exit 13 unsettled await)', { timeout: 4000 }, () => {
      const cliRunnerUrl = new URL('../../src/harness/cli-runner.js', import.meta.url).href;
      const probeScript = `
        import { execCli } from ${JSON.stringify(cliRunnerUrl)};
        const origKill = process.kill.bind(process);
        let lagProbeOnce = true;
        process.kill = (pid, sig) => {
          if (pid < 0 && (sig === 0 || sig === undefined) && lagProbeOnce) {
            lagProbeOnce = false;
            return true;
          }
          return origKill(pid, sig);
        };
        try {
          await execCli(process.execPath, ['-e', 'setTimeout(() => {}, 1000);'], {
            timeoutMs: 25,
            killGraceMs: 0
          });
          process.exit(2);
        } catch (err) {
          if (err && err.code === 'ETIMEDOUT') {
            process.stdout.write('SETTLED_OK');
            process.exit(0);
          }
          process.exit(3);
        }
      `;
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', probeScript], {
        encoding: 'utf8'
      });
      assert.equal(out, 'SETTLED_OK');
    });

    it('maxBuffer overflow terminates a SIGTERM-trapping process group cleanly and settles with ERR_CHILD_PROCESS_STDIO_MAXBUFFER', { timeout: 4000 }, async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue97-maxbuffer-group-'));
      const leaderPidFile = path.join(tmpDir, 'leader.pid');
      const childPidFile = path.join(tmpDir, 'child.pid');

      const leaderScript = [
        'const fs = require("node:fs");',
        'const { spawn } = require("node:child_process");',
        'process.on("SIGTERM", () => {});',
        'const gc = spawn(process.execPath, ["-e", "setTimeout(() => {}, 1500);"], { stdio: "inherit" });',
        `fs.writeFileSync(${JSON.stringify(childPidFile)}, String(gc.pid));`,
        `fs.writeFileSync(${JSON.stringify(leaderPidFile)}, String(process.pid));`,
        'setTimeout(() => { process.stdout.write("x".repeat(16384)); }, 40);',
        'setTimeout(() => process.exit(0), 2000);'
      ].join(' ');

      let leaderPid = 0;
      let childPid = 0;
      try {
        const startedAt = Date.now();
        const execPromise = execCli(process.execPath, ['-e', leaderScript], {
          maxBuffer: 2048,
          killGraceMs: 50
        });

        leaderPid = Number(await waitForFile(leaderPidFile));
        childPid = Number(await waitForFile(childPidFile));
        trackedPids.add(leaderPid);
        trackedPids.add(childPid);

        await assert.rejects(
          execPromise,
          (err) => err && err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        );

        const elapsed = Date.now() - startedAt;
        assert.ok(elapsed < 500, `Expected maxBuffer termination < 500ms, took ${elapsed}ms`);
        assertPidDead(leaderPid, 'leader');
        assertPidDead(childPid, 'inherited-pipe grandchild');
      } finally {
        try { if (childPid) process.kill(childPid, 'SIGKILL'); } catch {}
        try { if (leaderPid) process.kill(leaderPid, 'SIGKILL'); } catch {}
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('settles within bounded killGraceMs drain when an escaped detached grandchild holds inherited pipes', { timeout: 4000 }, async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue97-escaped-detached-'));
      const leaderPidFile = path.join(tmpDir, 'leader.pid');
      const escapedPidFile = path.join(tmpDir, 'escaped.pid');
      const controller = new AbortController();

      const leaderScript = [
        'const fs = require("node:fs");',
        'const { spawn } = require("node:child_process");',
        'process.on("SIGTERM", () => {});',
        'const escaped = spawn(process.execPath, ["-e", "setTimeout(() => {}, 1500);"], { detached: true, stdio: ["ignore", 1, 2] });',
        'escaped.unref();',
        `fs.writeFileSync(${JSON.stringify(escapedPidFile)}, String(escaped.pid));`,
        `fs.writeFileSync(${JSON.stringify(leaderPidFile)}, String(process.pid));`,
        'setTimeout(() => process.exit(0), 2000);'
      ].join(' ');

      let leaderPid = 0;
      let escapedPid = 0;
      try {
        const execPromise = execCli(process.execPath, ['-e', leaderScript], {
          signal: controller.signal,
          killGraceMs: 50
        });

        leaderPid = Number(await waitForFile(leaderPidFile));
        escapedPid = Number(await waitForFile(escapedPidFile));
        trackedPids.add(leaderPid);
        trackedPids.add(escapedPid);

        // Verify escaped grandchild is indeed in a different PGID
        const escapedPgid = Number(
          execFileSync('ps', ['-o', 'pgid=', '-p', String(escapedPid)], { encoding: 'utf8' }).trim()
        );
        assert.notEqual(escapedPgid, leaderPid, 'Escaped grandchild should have its own PGID');

        const abortAt = Date.now();
        controller.abort();

        await assert.rejects(
          execPromise,
          (err) => err && err.name === 'AbortError' && err.code === 'ABORT_ERR'
        );

        const elapsed = Date.now() - abortAt;
        assert.ok(elapsed < 400, `Expected bounded drain settlement < 400ms, took ${elapsed}ms`);
        assertPidDead(leaderPid, 'leader');
      } finally {
        try { if (escapedPid) process.kill(escapedPid, 'SIGKILL'); } catch {}
        try { if (leaderPid) process.kill(leaderPid, 'SIGKILL'); } catch {}
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('cleans up temp workspaces with zero leaked dirs on abort across runCodexCli, runAntigravityCli, and runCursorCli', { timeout: 10000 }, async () => {
      const sourceRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'issue97-repo-with-council-'));
      fs.mkdirSync(path.join(sourceRepo, '.council'));
      fs.writeFileSync(path.join(sourceRepo, 'README.md'), 'hello');

      const runners = [
        { name: 'codex-safe', fn: runCodexCli, model: 'gpt-6-astra (high)', tools: 'read-only', cwd: sourceRepo },
        { name: 'agy-safe', fn: runAntigravityCli, model: 'gemini-4-argon-high', tools: 'read-only', cwd: sourceRepo },
        { name: 'cursor-safe', fn: runCursorCli, model: 'grok-4.7-high', tools: 'read-only', cwd: sourceRepo },
        { name: 'codex-none', fn: runCodexCli, model: 'gpt-6-astra (high)', tools: 'none', cwd: undefined },
        { name: 'agy-none', fn: runAntigravityCli, model: 'gemini-4-argon-high', tools: 'none', cwd: undefined },
        { name: 'cursor-none', fn: runCursorCli, model: 'grok-4.7-high', tools: 'none', cwd: undefined }
      ];

      try {
        for (const r of runners) {
          const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue97-runner-marker-'));
          const pidFile = path.join(markerDir, 'leader.pid');
          const controller = new AbortController();
          let capturedExecCwd = null;

          const trapScript = [
            'const fs = require("node:fs");',
            'const { spawn } = require("node:child_process");',
            'process.on("SIGTERM", () => {});',
            'spawn(process.execPath, ["-e", "setTimeout(() => {}, 1500);"], { stdio: "inherit" });',
            `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
            'setTimeout(() => process.exit(0), 2000);'
          ].join(' ');

          try {
            const runPromise = r.fn({
              model: r.model,
              prompt: 'Audit repo',
              tools: r.tools,
              cwd: r.cwd,
              signal: controller.signal,
              killGraceMs: 50,
              exec: (_bin, _args, opts) => {
                capturedExecCwd = opts.cwd;
                return execCli(process.execPath, ['-e', trapScript], opts);
              }
            });

            const pid = Number(await waitForFile(pidFile));
            trackedPids.add(pid);
            controller.abort();

            await assert.rejects(
              runPromise,
              (err) => err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')
            );

            assert.ok(capturedExecCwd, `${r.name} should create an isolated temp cwd`);
            assert.equal(
              fs.existsSync(capturedExecCwd),
              false,
              `${r.name} leaked temp workspace dir: ${capturedExecCwd}`
            );
          } finally {
            fs.rmSync(markerDir, { recursive: true, force: true });
          }
        }
      } finally {
        fs.rmSync(sourceRepo, { recursive: true, force: true });
      }
    });
  });

  describe('Slice 3: Visualizer pollLiveRun script.onerror guard', () => {
    it('never appends #script-live-fallback when liveFollowActive becomes false and clears pollInFlight on final branch settle', () => {
      const { controller, appendedScripts } = createVisualizerHarness();
      controller.pollLiveRun();

      const idxScript = appendedScripts.find((s) => s.id === 'script-index-reload');
      const telScript = appendedScripts.find((s) => s.id === 'script-telemetry-reload');
      const liveScript = appendedScripts.find((s) => s.id === 'script-live-reload');
      assert.ok(idxScript && telScript && liveScript);

      // Disable liveFollowActive before #script-live-reload fires onerror (within same epoch)
      controller.setInternalState({ liveFollowActive: false });
      assert.equal(controller.getInternalState().pollInFlight, true);

      idxScript.onerror();
      telScript.onerror();
      assert.equal(controller.getInternalState().pollInFlight, true, 'pollInFlight stays true until final branch settles');

      liveScript.onerror();
      const fallbacks = appendedScripts.filter((s) => s.id === 'script-live-fallback');
      assert.equal(fallbacks.length, 0, '#script-live-fallback must not be appended when liveFollowActive is false');
      assert.equal(controller.getInternalState().pollInFlight, false, 'Active-epoch final branch must clear pollInFlight');
    });

    it('never appends #script-live-fallback when selectedRunId changes away from "latest" and clears pollInFlight on final branch settle', () => {
      const { controller, appendedScripts } = createVisualizerHarness();
      controller.pollLiveRun();

      const idxScript = appendedScripts.find((s) => s.id === 'script-index-reload');
      const telScript = appendedScripts.find((s) => s.id === 'script-telemetry-reload');
      const liveScript = appendedScripts.find((s) => s.id === 'script-live-reload');

      controller.setInternalState({ selectedRunId: 'run-historical-123' });
      idxScript.onerror();
      telScript.onerror();
      liveScript.onerror();

      const fallbacks = appendedScripts.filter((s) => s.id === 'script-live-fallback');
      assert.equal(fallbacks.length, 0, '#script-live-fallback must not be appended when selectedRunId !== "latest"');
      assert.equal(controller.getInternalState().pollInFlight, false);
    });

    it('never appends #script-live-fallback when pollEpoch advances and stale onBranchSettled() does not clear newer pollInFlight', () => {
      const { controller, appendedScripts } = createVisualizerHarness();
      controller.pollLiveRun();

      const staleIdx = appendedScripts.find((s) => s.id === 'script-index-reload');
      const staleTel = appendedScripts.find((s) => s.id === 'script-telemetry-reload');
      const staleLive = appendedScripts.find((s) => s.id === 'script-live-reload');

      // Stop and start a newer poll (advancing pollEpoch and setting pollInFlight = true for newer poll)
      controller.stopLiveFollow();
      controller.startLiveFollow();
      assert.equal(controller.getInternalState().pollInFlight, true);

      // Fire all 3 stale handlers from epoch 1
      staleIdx.onerror();
      staleTel.onerror();
      staleLive.onerror();

      const fallbacks = appendedScripts.filter((s) => s.id === 'script-live-fallback');
      assert.equal(fallbacks.length, 0, '#script-live-fallback must not be appended for stale pollEpoch');
      assert.equal(
        controller.getInternalState().pollInFlight,
        true,
        'Stale epoch onBranchSettled() must not clear newer poll pollInFlight'
      );
    });

    it('still appends #script-live-fallback for active latest-run poll onerror', () => {
      const { controller, appendedScripts } = createVisualizerHarness();
      controller.pollLiveRun();

      const liveScript = appendedScripts.find((s) => s.id === 'script-live-reload');
      liveScript.onerror();

      const fallbacks = appendedScripts.filter((s) => s.id === 'script-live-fallback');
      assert.equal(fallbacks.length, 1, 'Active latest-run poll must still append #script-live-fallback');
    });
  });
});
