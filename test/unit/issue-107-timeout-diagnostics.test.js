/**
 * @fileoverview Unit & integration tests for Issue #107 timeout, process-group,
 * drain lifecycle, prompt-redaction bounds, and terminal fault surfacing.
 * Uses local fake Node child-process fixtures and public contracts only.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  VALID_DRAIN_STATUSES,
  LIFECYCLE_ISO_KEYS,
  LIFECYCLE_INT_KEYS,
  MAX_CLI_ERROR_MESSAGE_BYTES,
  MAX_CLI_STDERR_BYTES,
  normalizeExitCode,
  normalizeSignalName,
  sliceUtf8Bytes,
  redactPromptInText,
  sanitizeCliError,
  sanitizeLifecycleMetadata,
  createAttemptTelemetryGate,
  runWithAttemptTelemetryGate,
  getActiveAttemptTelemetryGate,
  markAttemptGateFinalized,
  recordProviderCall,
  execCli,
  runAntigravityCli,
  runCodexCli,
  runCursorCli
} from '../../src/harness/cli-runner.js';
import {
  HarnessAdapter,
  TimeoutError,
  HarnessExecutionError,
  AbortError
} from '../../src/harness/adapter.js';
import { AntigravityAdapter } from '../../src/harness/antigravity.js';
import { CodexAdapter } from '../../src/harness/codex.js';
import { CursorAdapter } from '../../src/harness/cursor.js';
import { MockAdapter } from '../../src/harness/mock.js';
import { CouncilEngine } from '../../src/engine/council-engine.js';
import {
  MAX_PRIMARY_FAULT_REASON_CHARS,
  boundSingleLineFaultMessage,
  formatErrorDiagnosticSuffix
} from '../../src/engine/recovery.js';
import { createTelemetryEmitter } from '../../src/telemetry/emitter.js';
import { buildRunTelemetryRecord } from '../../src/telemetry/ledger.js';
import { VisualizerLiveWatcher } from '../../src/visualizer/live-watcher.js';

const tempDirs = [];

function createTempDir(prefix = 'council-issue107-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFakeScript(dir, name, code) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, code, 'utf8');
  return filePath;
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
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for file ${filePath}`);
}

function assertValidIso(value, label = 'timestamp') {
  assert.equal(typeof value, 'string', `${label} should be an ISO string`);
  assert.ok(Number.isFinite(Date.parse(value)), `${label} should parse as a finite timestamp`);
}

function assertPidDead(pid, label = 'process') {
  assert.throws(
    () => process.kill(pid, 0),
    (err) => Boolean(err && err.code === 'ESRCH'),
    `Expected ${label} (pid=${pid}) to be terminated (ESRCH)`
  );
}

function createConceptualSelfContained() {
  return {
    kind: 'full_context',
    label: 'Hermetic issue-107 test context',
    phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
    roundScope: 'all_rounds',
    conceptualNoExternalVerification: true
  };
}

function makeFakeCodexExec(scriptPath) {
  return (_bin, args, execOpts) => execCli(process.execPath, [scriptPath, ...args], execOpts);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('Issue #107 — CLI Timeout Diagnostics, Drain Lifecycle & Fault Surfacing', () => {
  describe('1. Public Constants & Pure Diagnostic Helpers', () => {
    it('exports expected constants and normalizes exit codes, signals, and lifecycle metadata', () => {
      assert.deepEqual([...VALID_DRAIN_STATUSES], ['fulfilled', 'settled', 'drain_expired']);
      assert.ok(Object.isFrozen(VALID_DRAIN_STATUSES));
      assert.throws(() => VALID_DRAIN_STATUSES.add('bogus'), TypeError);
      assert.throws(() => VALID_DRAIN_STATUSES.delete('fulfilled'), TypeError);
      assert.ok(Object.isFrozen(LIFECYCLE_ISO_KEYS));
      assert.ok(Object.isFrozen(LIFECYCLE_INT_KEYS));
      assert.equal(MAX_CLI_ERROR_MESSAGE_BYTES, 2048);
      assert.equal(MAX_CLI_STDERR_BYTES, 4096);
      assert.equal(MAX_PRIMARY_FAULT_REASON_CHARS, 500);

      assert.strictEqual(normalizeExitCode(0), 0);
      assert.strictEqual(normalizeExitCode(-0), 0);
      assert.strictEqual(normalizeExitCode(2), 2);
      assert.strictEqual(normalizeExitCode('ENOENT'), null);
      assert.strictEqual(normalizeExitCode(NaN), null);
      assert.strictEqual(normalizeExitCode(null), null);

      assert.strictEqual(normalizeSignalName(' sigterm '), 'SIGTERM');
      assert.strictEqual(normalizeSignalName('SIGKILL'), 'SIGKILL');
      assert.strictEqual(normalizeSignalName('NOTASIG'), null);
      assert.strictEqual(normalizeSignalName(9), null);

      const sanitized = sanitizeLifecycleMetadata({
        spawnedAt: '2026-11-21T12:00:00.000Z',
        firstStdoutAt: 'not-an-iso',
        settledAt: '2026-11-21T12:00:01.000Z',
        stdoutBytes: 128,
        stdoutChunks: -3,
        stderrBytes: 0,
        stderrChunks: 2,
        groupDrainExhausted: true,
        attemptedSignals: [' sigterm ', 'SIGTERM', 'sigkill', 'BAD', 'SIGUSR1', 'SIGUSR2', 'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGPIPE', 'SIGALRM']
      });
      assert.ok(sanitized && Object.isFrozen(sanitized));
      assert.equal(sanitized.spawnedAt, '2026-11-21T12:00:00.000Z');
      assert.equal('firstStdoutAt' in sanitized, false);
      assert.equal(sanitized.settledAt, '2026-11-21T12:00:01.000Z');
      assert.equal(sanitized.stdoutBytes, 128);
      assert.equal('stdoutChunks' in sanitized, false);
      assert.equal(sanitized.stderrBytes, 0);
      assert.equal(sanitized.stderrChunks, 2);
      assert.equal(sanitized.groupDrainExhausted, true);
      assert.ok(Object.isFrozen(sanitized.attemptedSignals));
      assert.equal(sanitized.attemptedSignals.length, 8);
      assert.deepEqual(sanitized.attemptedSignals.slice(0, 2), ['SIGTERM', 'SIGKILL']);
    });

    it('bounds and formats diagnostic suffixes while suppressing exitCode/signal when drain_expired', () => {
      const longMsg = 'line1\n  line2   ' + '🚀'.repeat(200);
      const bounded = boundSingleLineFaultMessage(longMsg, 60);
      assert.equal(bounded.includes('\n'), false);
      assert.ok(bounded.length <= 60);
      assert.ok(!bounded.includes('\uFFFD'));

      const settledSuffix = formatErrorDiagnosticSuffix(
        {
          exitCode: 2,
          signal: 'SIGTERM',
          drainStatus: 'settled',
          stderr: 'fatal: config failure',
          envelopeError: 'envelope failure'
        },
        '[TimeoutError] Timed out'
      );
      assert.match(settledSuffix, /\(exit code 2\)/);
      assert.match(settledSuffix, /\(signal SIGTERM\)/);
      assert.match(settledSuffix, /\(drain: settled\)/);
      assert.match(settledSuffix, /— stderr: fatal: config failure/);
      assert.match(settledSuffix, /— envelope: envelope failure/);

      const expiredSuffix = formatErrorDiagnosticSuffix(
        {
          exitCode: 2,
          signal: 'SIGKILL',
          drainStatus: 'drain_expired',
          stderr: 'late stderr',
          envelopeError: 'late envelope',
          cause: { stderr: 'sibling cause stderr', envelopeError: 'sibling cause envelope' }
        },
        '[TimeoutError] Timed out'
      );
      assert.doesNotMatch(expiredSuffix, /exit code/);
      assert.doesNotMatch(expiredSuffix, /SIGKILL/);
      assert.doesNotMatch(expiredSuffix, /stderr|late stderr|sibling cause/);
      assert.doesNotMatch(expiredSuffix, /envelope|late envelope/);
      assert.match(expiredSuffix, /\(drain: drain_expired\)/);

      // Whole-token exitCode/signal dedupe and >240-char excerpt prefix dedupe
      const wholeTokenSuffix = formatErrorDiagnosticSuffix(
        { exitCode: 2, signal: 'SIGKILL' },
        'prior exit code 20 SIGKILLER'
      );
      assert.match(wholeTokenSuffix, /\(exit code 2\)/);
      assert.match(wholeTokenSuffix, /\(signal SIGKILL\)/);
      assert.strictEqual(
        formatErrorDiagnosticSuffix({ signal: 'SIGKILL' }, 'terminated by signal SIGKILLER'),
        ' (signal SIGKILL)'
      );

      const longStderr = 'verbose diagnostic failure ' + 'x'.repeat(280);
      const dedupedLongSuffix = formatErrorDiagnosticSuffix(
        { stderr: longStderr, envelopeError: 'unique envelope detail' },
        `[HarnessExecutionError] ${longStderr}`
      );
      assert.doesNotMatch(dedupedLongSuffix, /— stderr:/);
      assert.match(dedupedLongSuffix, /— envelope: unique envelope detail/);

      // Duplicate observer identity (onCallRecord === context.onCallRecord) fires once
      const sharedCalls = [];
      const sharedObserver = (rec) => sharedCalls.push(rec);
      const emittedShared = recordProviderCall({
        context: { onCallRecord: sharedObserver },
        onCallRecord: sharedObserver,
        record: {
          participantId: 'seat-dedupe',
          provider: 'codex',
          model: 'gpt-6-astra',
          exitCode: 0,
          durationMs: 10,
          trace: { outcome: 'success', durationMs: 10 }
        }
      });
      assert.strictEqual(emittedShared, true);
      assert.equal(sharedCalls.length, 1);
    });
  });

  describe('2. Fake Child-Process Fixtures: Normal Exit, Non-Zero Exit, Signal Exit & ENOENT', () => {
    it('records exitCode 0, lifecycle timestamps, and byte/chunk counts on normal exit', async () => {
      const tmpDir = createTempDir();
      const codexPayload = JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: '{"scope":"cli","kind":"check","source":"fixture","statement":"ok"}' }
      });
      const script = writeFakeScript(
        tmpDir,
        'normal-exit.cjs',
        `
          const payload = ${JSON.stringify(codexPayload + '\n')};
          const half = Math.floor(payload.length / 2);
          process.stdout.write(payload.slice(0, half));
          process.stderr.write('diag-err-line\\n');
          setTimeout(() => {
            process.stdout.write(payload.slice(half));
            process.exit(0);
          }, 25);
        `
      );

      const direct = await execCli(process.execPath, [script]);
      assert.strictEqual(direct.exitCode, 0);
      assert.strictEqual(direct.stdout, codexPayload + '\n');
      assert.strictEqual(direct.stderr, 'diag-err-line\n');
      assert.ok(direct.lifecycle && Object.isFrozen(direct.lifecycle));
      assertValidIso(direct.lifecycle.spawnedAt, 'spawnedAt');
      assertValidIso(direct.lifecycle.firstStdoutAt, 'firstStdoutAt');
      assertValidIso(direct.lifecycle.lastStdoutAt, 'lastStdoutAt');
      assertValidIso(direct.lifecycle.firstStderrAt, 'firstStderrAt');
      assertValidIso(direct.lifecycle.lastStderrAt, 'lastStderrAt');
      assertValidIso(direct.lifecycle.settledAt, 'settledAt');
      assert.equal(direct.lifecycle.sigtermSentAt, undefined);
      assert.equal(direct.lifecycle.sigkillSentAt, undefined);
      assert.equal(direct.lifecycle.stdoutBytes, Buffer.byteLength(codexPayload + '\n', 'utf8'));
      assert.ok(direct.lifecycle.stdoutChunks >= 2);
      assert.equal(direct.lifecycle.stderrBytes, Buffer.byteLength('diag-err-line\n', 'utf8'));
      assert.ok(direct.lifecycle.stderrChunks >= 1);
      assert.equal(direct.lifecycle.groupDrainExhausted, false);

      const emittedCalls = [];
      const out = await runCodexCli({
        model: 'gpt-6-astra',
        prompt: 'Verify normal exit lifecycle',
        exec: makeFakeCodexExec(script),
        onCallRecord: (rec) => emittedCalls.push(rec)
      });
      assert.match(out, /"statement":"ok"/);
      assert.equal(emittedCalls.length, 1);
      assert.strictEqual(emittedCalls[0].exitCode, 0);
      assert.strictEqual(emittedCalls[0].signal, null);
      assert.equal(emittedCalls[0].trace.outcome, 'success');
      assertValidIso(emittedCalls[0].trace.lifecycle.spawnedAt, 'trace.lifecycle.spawnedAt');
      assertValidIso(emittedCalls[0].trace.lifecycle.firstStdoutAt, 'trace.lifecycle.firstStdoutAt');
      assertValidIso(emittedCalls[0].trace.lifecycle.settledAt, 'trace.lifecycle.settledAt');
    });

    it('captures numeric exitCode 2 with prompt-redacted, byte-bounded stderr and message', async () => {
      const tmpDir = createTempDir();
      const promptSecret = 'SECRET_PROMPT_NONZERO_TOKEN_424242';
      const script = writeFakeScript(
        tmpDir,
        'exit-two.cjs',
        `
          const printArg = process.argv.find((a) => a.startsWith('--print=')) || '';
          const leaked = printArg ? printArg.slice('--print='.length) : ${JSON.stringify(promptSecret)};
          const leak = 'ERR_START leak=' + leaked + ' ' + printArg + ' ' + 'Z'.repeat(5500);
          process.stderr.write(leak);
          process.exit(2);
        `
      );

      await assert.rejects(
        execCli(process.execPath, [script, `--print=${promptSecret}`], { prompt: promptSecret }),
        (err) => {
          assert.strictEqual(err.exitCode, 2);
          assert.strictEqual(err.signal, null);
          assert.ok(Buffer.byteLength(err.stderr, 'utf8') <= MAX_CLI_STDERR_BYTES);
          assert.ok(Buffer.byteLength(err.message, 'utf8') <= MAX_CLI_ERROR_MESSAGE_BYTES);
          assert.equal(err.stderr.includes(promptSecret), false);
          assert.equal(err.message.includes(promptSecret), false);
          assert.equal(err.cmd.includes(promptSecret), false);
          assert.match(err.stderr, /\[REDACTED prompt:/);
          assert.ok(err.lifecycle);
          assert.equal('firstStdoutAt' in err.lifecycle, false);
          assertValidIso(err.lifecycle.firstStderrAt, 'firstStderrAt');
          assert.ok(err.lifecycle.stderrBytes > MAX_CLI_STDERR_BYTES);
          return true;
        }
      );

      const emittedCalls = [];
      const adapter = new AntigravityAdapter({
        spawnRunner: (opts) =>
          runAntigravityCli({
            ...opts,
            exec: makeFakeCodexExec(script)
          })
      });

      await assert.rejects(
        adapter.executeSeat({
          seat: { id: 'seat-exit2', model: 'gemini-4-argon-high', tools: 'none' },
          soul: 'Auditor',
          round: 1,
          phase: 'DELIBERATION',
          state: { topic: promptSecret, clarifications: [], proofs: [], objections: [] },
          onCallRecord: (rec) => emittedCalls.push(rec)
        }),
        (err) => {
          assert.ok(err instanceof HarnessExecutionError);
          assert.strictEqual(err.exitCode, 2);
          assert.strictEqual(err.signal, null);
          assert.ok(Buffer.byteLength(err.stderr, 'utf8') <= MAX_CLI_STDERR_BYTES);
          assert.equal(err.stderr.includes(promptSecret), false);
          assert.equal(err.message.includes(promptSecret), false);
          return true;
        }
      );

      assert.equal(emittedCalls.length, 1);
      assert.strictEqual(emittedCalls[0].exitCode, 2);
      assert.strictEqual(emittedCalls[0].signal, null);
      assert.equal(emittedCalls[0].trace.outcome, 'error');
      assert.equal(emittedCalls[0].trace.stderr.includes(promptSecret), false);
    });

    it('reports exitCode null and signal on signal termination with zero surviving POSIX process-group children', async () => {
      const tmpDir = createTempDir();

      // 1. Direct signal self-termination
      const selfKillScript = writeFakeScript(
        tmpDir,
        'self-signal.cjs',
        `process.kill(process.pid, 'SIGKILL');`
      );
      await assert.rejects(
        execCli(process.execPath, [selfKillScript]),
        (err) => {
          assert.strictEqual(err.exitCode, null);
          assert.strictEqual(err.signal, 'SIGKILL');
          assertValidIso(err.lifecycle?.settledAt, 'settledAt');
          return true;
        }
      );

      // 2. Process group termination of parent trapping SIGTERM + grandchild
      if (process.platform !== 'win32') {
        const pidFile = path.join(tmpDir, 'pgroup-pids.json');
        const pgroupScript = writeFakeScript(
          tmpDir,
          'pgroup-parent.cjs',
          `
            const fs = require('node:fs');
            const { spawn } = require('node:child_process');
            process.on('SIGTERM', () => {});
            const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });
            fs.writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify({ parentPid: process.pid, childPid: child.pid }));
            setInterval(() => {}, 1000);
          `
        );

        const controller = new AbortController();
        const runPromise = execCli(process.execPath, [pgroupScript], {
          signal: controller.signal,
          killGraceMs: 60
        });
        const { parentPid, childPid } = JSON.parse(await waitForFile(pidFile));
        controller.abort();

        await assert.rejects(runPromise, (err) => {
          assert.strictEqual(err.exitCode, null);
          assert.strictEqual(err.signal, 'SIGKILL');
          assertValidIso(err.lifecycle?.sigtermSentAt, 'sigtermSentAt');
          assertValidIso(err.lifecycle?.sigkillSentAt, 'sigkillSentAt');
          assert.ok(err.lifecycle?.attemptedSignals.includes('SIGTERM'));
          assert.ok(err.lifecycle?.attemptedSignals.includes('SIGKILL'));
          return true;
        });

        assertPidDead(parentPid, 'parent process');
        assertPidDead(childPid, 'grandchild process in group');

        // 3. Signal-killed POSIX leader with surviving grandchild (stdio: 'ignore') drains group before settling
        const leaderPidFile = path.join(tmpDir, 'leader-killed-pids.json');
        const leaderKillScript = writeFakeScript(
          tmpDir,
          'leader-self-kill.cjs',
          `
            const fs = require('node:fs');
            const { spawn } = require('node:child_process');
            const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });
            fs.writeFileSync(${JSON.stringify(leaderPidFile)}, JSON.stringify({ parentPid: process.pid, childPid: child.pid }));
            setTimeout(() => process.kill(process.pid, 'SIGKILL'), 25);
          `
        );
        await assert.rejects(
          execCli(process.execPath, [leaderKillScript], { killGraceMs: 60 }),
          (err) => {
            assert.strictEqual(err.exitCode, null);
            assert.strictEqual(err.signal, 'SIGKILL');
            return true;
          }
        );
        const leaderPids = JSON.parse(await waitForFile(leaderPidFile));
        assertPidDead(leaderPids.parentPid, 'self-killed leader');
        assertPidDead(leaderPids.childPid, 'surviving grandchild after leader SIGKILL');

        // 4. Signal-killed POSIX leader whose grandchild inherits stdio pipes (no timeoutMs, no abort) settles cleanly
        const pipePidFile = path.join(tmpDir, 'leader-pipe-pids.json');
        const inheritedPipeScript = writeFakeScript(
          tmpDir,
          'leader-pipe-self-kill.cjs',
          `
            const fs = require('node:fs');
            const { spawn } = require('node:child_process');
            const child = spawn(
              process.execPath,
              ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'],
              { stdio: 'inherit' }
            );
            fs.writeFileSync(${JSON.stringify(pipePidFile)}, JSON.stringify({ parentPid: process.pid, childPid: child.pid }));
            setTimeout(() => process.kill(process.pid, 'SIGKILL'), 25);
          `
        );
        await assert.rejects(
          execCli(process.execPath, [inheritedPipeScript], { killGraceMs: 60 }),
          (err) => {
            assert.strictEqual(err.exitCode, null);
            assert.strictEqual(err.signal, 'SIGKILL');
            return true;
          }
        );
        const pipePids = JSON.parse(await waitForFile(pipePidFile));
        assertPidDead(pipePids.parentPid, 'pipe-inherited self-killed leader');
        assertPidDead(pipePids.childPid, 'pipe-inheriting grandchild after leader SIGKILL');
      }
    });

    it('preserves code ENOENT and exitCode null across execCli, classifyError, and adapter execution', async () => {
      const missingBin = path.join(os.tmpdir(), `nonexistent-council-bin-${Date.now()}-${Math.random()}`);
      const secret = 'SECRET_ENOENT_PROMPT_777777';

      let caughtExecErr = null;
      await assert.rejects(
        execCli(missingBin, [`--print=${secret}`], { prompt: secret }),
        (err) => {
          caughtExecErr = err;
          assert.strictEqual(err.code, 'ENOENT');
          assert.strictEqual(err.exitCode, null);
          assert.strictEqual(err.signal, null);
          assert.equal(err.message.includes(secret), false);
          assert.equal('spawnedAt' in err.lifecycle, false);
          assert.strictEqual(err.lifecycle?.spawnedAt, undefined);
          assertValidIso(err.lifecycle?.settledAt, 'settledAt');
          if (Array.isArray(err.spawnargs)) {
            for (const arg of err.spawnargs) {
              if (typeof arg === 'string') {
                assert.equal(arg.includes(secret), false);
              }
            }
          }
          return true;
        }
      );

      for (const adapter of [
        new HarnessAdapter({ name: 'base' }),
        new AntigravityAdapter(),
        new CodexAdapter(),
        new CursorAdapter()
      ]) {
        const classified = adapter.classifyError(caughtExecErr, { seatId: 'seat-enoent', model: 'm1' });
        assert.ok(classified instanceof HarnessExecutionError);
        assert.strictEqual(classified.code, 'ENOENT');
        assert.strictEqual(classified.exitCode, null);
        assert.strictEqual(classified.signal, null);
        assert.strictEqual(classified.cause, caughtExecErr);
        if (Array.isArray(classified.cause?.spawnargs)) {
          for (const arg of classified.cause.spawnargs) {
            if (typeof arg === 'string') {
              assert.equal(arg.includes(secret), false);
            }
          }
        }
      }

      const emittedCalls = [];
      const cursor = new CursorAdapter({
        spawnRunner: (opts) =>
          runCursorCli({
            ...opts,
            executable: missingBin
          })
      });
      await assert.rejects(
        cursor.executeSeat({
          seat: { id: 'seat-cursor-enoent', model: 'grok-4.7-high', tools: 'none' },
          soul: 'Auditor',
          round: 1,
          phase: 'DELIBERATION',
          state: { topic: 'ENOENT propagation', clarifications: [], proofs: [], objections: [] },
          onCallRecord: (rec) => emittedCalls.push(rec)
        }),
        (err) => {
          assert.ok(err instanceof HarnessExecutionError);
          assert.strictEqual(err.code, 'ENOENT');
          assert.strictEqual(err.exitCode, null);
          return true;
        }
      );
      assert.equal(emittedCalls.length, 1);
      assert.strictEqual(emittedCalls[0].exitCode, null);

      // Standalone sanitizeCliError with omitted args on real Node ENOENT (spawnargs lacks executable prefix)
      const standaloneSecret = 'SECRET_STANDALONE_ENOENT_555';
      const rawEnoent = await new Promise((resolve) => {
        const child = spawn(missingBin, [`--print=${standaloneSecret}`]);
        child.on('error', resolve);
      });
      rawEnoent.message = `spawn ${missingBin} ENOENT --print=${standaloneSecret}`;
      sanitizeCliError(rawEnoent, missingBin);
      assert.equal(rawEnoent.message.includes(standaloneSecret), false);
      assert.ok(Array.isArray(rawEnoent.spawnargs));
      for (const arg of rawEnoent.spawnargs) {
        if (typeof arg === 'string') {
          assert.equal(arg.includes(standaloneSecret), false);
        }
      }
    });
  });

  describe('3. Timeout Before First Stdout, Abort Race, Drain Settlement & Drain Expiry', () => {
    it('latches TimeoutError before first stdout and keeps TimeoutError despite 429/401/MAX_TOKENS in stderr', async () => {
      const tmpDir = createTempDir();
      const script = writeFakeScript(
        tmpDir,
        'timeout-no-stdout.cjs',
        `
          process.stderr.write('HTTP 429 rate_limit_error 401 unauthorized MAX_TOKENS\\n');
          process.on('SIGTERM', () => {
            setTimeout(() => process.exit(1), 20);
          });
          setInterval(() => {}, 1000);
        `
      );

      const emittedCalls = [];
      const codex = new CodexAdapter({
        spawnRunner: (opts) =>
          runCodexCli({
            ...opts,
            exec: makeFakeCodexExec(script)
          })
      });

      let latchedErr = null;
      await assert.rejects(
        codex.executeSeat({
          seat: { id: 'seat-timeout-pre-stdout', model: 'gpt-6-astra', tools: 'none' },
          soul: 'Critic',
          round: 1,
          phase: 'DELIBERATION',
          timeoutMs: 160,
          killGraceMs: 250,
          abortDrainMs: 400,
          state: { topic: 'Timeout latch test', clarifications: [], proofs: [], objections: [] },
          onCallRecord: (rec) => emittedCalls.push(rec)
        }),
        (err) => {
          latchedErr = err;
          assert.ok(err instanceof TimeoutError);
          assert.equal(err.name, 'TimeoutError');
          assert.equal(err.isRetryable, true);
          assert.equal(err.isQuotaFault, false);
          assert.equal(err.drainStatus, 'settled');
          assert.strictEqual(err.exitCode, 1);
          assert.match(err.stderr, /429/);
          assert.match(err.stderr, /401/);
          assert.match(err.stderr, /MAX_TOKENS/);
          assert.ok(err.lifecycle);
          assert.equal('firstStdoutAt' in err.lifecycle, false);
          assert.equal(err.lifecycle.stdoutBytes, 0);
          assert.equal(err.lifecycle.stdoutChunks, 0);
          assertValidIso(err.lifecycle.spawnedAt, 'spawnedAt');
          assertValidIso(err.lifecycle.firstStderrAt, 'firstStderrAt');
          assertValidIso(err.lifecycle.sigtermSentAt, 'sigtermSentAt');
          assertValidIso(err.lifecycle.settledAt, 'settledAt');
          return true;
        }
      );

      for (const adapter of [
        new HarnessAdapter({ name: 'base' }),
        new AntigravityAdapter(),
        new CodexAdapter(),
        new CursorAdapter()
      ]) {
        const reclassified = adapter.classifyError(latchedErr, { seatId: 'seat-timeout-pre-stdout', model: 'm' });
        assert.ok(reclassified instanceof TimeoutError);
        assert.equal(reclassified.name, 'TimeoutError');
        assert.equal(reclassified.isQuotaFault, false);
        assert.equal(reclassified.isRetryable, true);
        assert.strictEqual(reclassified.exitCode, 1);
      }

      assert.equal(emittedCalls.length, 1);
      assert.equal(emittedCalls[0].drainStatus, 'settled');
      assert.strictEqual(emittedCalls[0].exitCode, 1);
    });

    it('latches first-cause winner when caller abort races timeout in both orders', async () => {
      const tmpDir = createTempDir();
      const slowCleanupScript = writeFakeScript(
        tmpDir,
        'slow-cleanup.cjs',
        `
          process.on('SIGTERM', () => {
            setTimeout(() => process.exit(0), 120);
          });
          setInterval(() => {}, 1000);
        `
      );

      // 1. Caller aborts at 30ms while timeoutMs is 180ms and cleanup takes 120ms -> AbortError wins
      const abortFirstController = new AbortController();
      const adapterA = new CodexAdapter({
        spawnRunner: (opts) => runCodexCli({ ...opts, exec: makeFakeCodexExec(slowCleanupScript) })
      });
      setTimeout(() => abortFirstController.abort(), 30);
      await assert.rejects(
        adapterA.executeSeat({
          seat: { id: 'seat-abort-first', model: 'gpt-6-astra', tools: 'none' },
          soul: 'Critic',
          round: 1,
          phase: 'DELIBERATION',
          timeoutMs: 180,
          killGraceMs: 400,
          signal: abortFirstController.signal,
          state: { topic: 'Abort wins race', clarifications: [], proofs: [], objections: [] }
        }),
        (err) => {
          assert.ok(err instanceof AbortError);
          assert.equal(err instanceof TimeoutError, false);
          assert.equal(err.code, 'ABORT_ERR');
          assert.equal(err.isRetryable, false);
          return true;
        }
      );

      // 2. Timeout wins at 140ms, caller aborts mid-drain at 175ms -> TimeoutError stays latched
      const abortLateController = new AbortController();
      const adapterB = new CodexAdapter({
        spawnRunner: (opts) => runCodexCli({ ...opts, exec: makeFakeCodexExec(slowCleanupScript) })
      });
      setTimeout(() => abortLateController.abort(), 175);
      await assert.rejects(
        adapterB.executeSeat({
          seat: { id: 'seat-timeout-first', model: 'gpt-6-astra', tools: 'none' },
          soul: 'Critic',
          round: 1,
          phase: 'DELIBERATION',
          timeoutMs: 140,
          killGraceMs: 400,
          signal: abortLateController.signal,
          state: { topic: 'Timeout wins race', clarifications: [], proofs: [], objections: [] }
        }),
        (err) => {
          assert.ok(err instanceof TimeoutError);
          assert.equal(err instanceof AbortError, false);
          assert.equal(err.isRetryable, true);
          assert.equal(err.drainStatus, 'settled');
          return true;
        }
      );
    });

    it('attaches exitCode/signal/stderr/lifecycle on drain settlement and emits exactly one provider_call even if observer throws', async () => {
      const tmpDir = createTempDir();
      const secret = 'SECRET_DRAIN_SETTLE_TOKEN_555555';
      const script = writeFakeScript(
        tmpDir,
        'drain-settle.cjs',
        `
          const leaked = process.argv[process.argv.length - 1] || ${JSON.stringify(secret)};
          process.stderr.write('pre-sigterm ' + leaked + '\\n');
          process.on('SIGTERM', () => {
            setTimeout(() => {
              process.stderr.write('final-drain-stderr\\n');
              process.exit(3);
            }, 35);
          });
          setInterval(() => {}, 1000);
        `
      );

      const telemetry = createTelemetryEmitter();
      const telemetryCalls = [];
      const observerCalls = [];
      telemetry.on('provider_call', (rec) => telemetryCalls.push(rec));

      const codex = new CodexAdapter({
        spawnRunner: (opts) =>
          runCodexCli({
            ...opts,
            exec: makeFakeCodexExec(script)
          })
      });

      await assert.rejects(
        codex.executeSeat({
          seat: { id: 'seat-drain-settle', model: 'gpt-6-astra', tools: 'none' },
          soul: 'Critic',
          round: 1,
          phase: 'DELIBERATION',
          timeoutMs: 150,
          killGraceMs: 500,
          abortDrainMs: 600,
          telemetry,
          onCallRecord: (rec) => {
            observerCalls.push(rec);
            throw new Error('observer callback failure must not cause duplicate receipt');
          },
          state: { topic: secret, clarifications: [], proofs: [], objections: [] }
        }),
        (err) => {
          assert.ok(err instanceof TimeoutError);
          assert.equal(err.drainStatus, 'settled');
          assert.equal(typeof err.drainDurationMs, 'number');
          assert.ok(err.drainDurationMs >= 0);
          assert.strictEqual(err.exitCode, 3);
          assert.strictEqual(err.signal, null);
          assert.match(err.stderr, /final-drain-stderr/);
          assert.equal(err.stderr.includes(secret), false);
          assertValidIso(err.lifecycle?.spawnedAt, 'spawnedAt');
          assertValidIso(err.lifecycle?.sigtermSentAt, 'sigtermSentAt');
          assertValidIso(err.lifecycle?.settledAt, 'settledAt');
          return true;
        }
      );

      assert.equal(observerCalls.length, 1);
      assert.equal(telemetryCalls.length, 1);
      assert.equal(telemetryCalls[0].drainStatus, 'settled');
      assert.strictEqual(telemetryCalls[0].exitCode, 3);
      assert.strictEqual(telemetryCalls[0].signal, null);
      assert.equal(telemetryCalls[0].trace.outcome, 'error');
      assert.match(telemetryCalls[0].trace.stderr, /final-drain-stderr/);
      assert.equal(telemetryCalls[0].trace.stderr.includes(secret), false);
      assertValidIso(telemetryCalls[0].trace.lifecycle?.settledAt, 'trace.lifecycle.settledAt');
    });

    it('emits single drain_expired provider_call with null exitCode/signal and ignores late callbacks', async () => {
      const tmpDir = createTempDir();
      const pidFile = path.join(tmpDir, 'stubborn-child.pid');
      const lateScript = writeFakeScript(
        tmpDir,
        'drain-expire.cjs',
        `
          const fs = require('node:fs');
          process.on('SIGTERM', () => {});
          fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
          setInterval(() => {}, 1000);
        `
      );

      const telemetry = createTelemetryEmitter();
      const telemetryCalls = [];
      const observerCalls = [];
      telemetry.on('provider_call', (rec) => telemetryCalls.push(rec));

      let lateFinished = false;
      let lateRecordResult = null;

      const codex = new CodexAdapter({
        spawnRunner: async (opts) => {
          try {
            return await runCodexCli({
              ...opts,
              exec: async (_bin, args, execOpts) => {
                // Delay rejection past abortDrainMs while still spawning & cleaning up a real child
                try {
                  await execCli(process.execPath, [lateScript, ...args], execOpts);
                } catch (err) {
                  await new Promise((resolve) => setTimeout(resolve, 180));
                  throw err;
                }
              }
            });
          } finally {
            lateFinished = true;
            lateRecordResult = recordProviderCall({
              context: opts.context,
              onCallRecord: (rec) => observerCalls.push(rec),
              record: {
                participantId: 'seat-drain-expired',
                provider: 'codex',
                model: opts.model,
                exitCode: 7,
                signal: 'SIGKILL',
                durationMs: 250,
                trace: { outcome: 'error', durationMs: 250 }
              }
            });
          }
        }
      });

      await assert.rejects(
        codex.executeSeat({
          seat: { id: 'seat-drain-expired', model: 'gpt-6-astra', tools: 'none' },
          soul: 'Critic',
          round: 1,
          phase: 'DELIBERATION',
          timeoutMs: 160,
          killGraceMs: 60,
          abortDrainMs: 25,
          telemetry,
          onCallRecord: (rec) => observerCalls.push(rec),
          state: { topic: 'Drain expiry test', clarifications: [], proofs: [], objections: [] }
        }),
        (err) => {
          assert.ok(err instanceof TimeoutError);
          assert.equal(err.drainStatus, 'drain_expired');
          assert.strictEqual(err.exitCode, null);
          assert.strictEqual(err.signal, null);
          assert.strictEqual(err.stderr, '');
          return true;
        }
      );

      const childPid = Number(await waitForFile(pidFile));
      assert.equal(observerCalls.length, 1);
      assert.equal(telemetryCalls.length, 1);
      assert.equal(telemetryCalls[0].drainStatus, 'drain_expired');
      assert.strictEqual(telemetryCalls[0].exitCode, null);
      assert.strictEqual(telemetryCalls[0].signal, null);

      // Wait for the late settlement & late recordProviderCall callback
      const deadline = Date.now() + 2000;
      while (!lateFinished && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      assert.equal(lateFinished, true);
      assert.strictEqual(lateRecordResult, false);
      assert.equal(observerCalls.length, 1);
      assert.equal(telemetryCalls.length, 1);
      assertPidDead(childPid, 'drain_expired child');

      // Also verify direct gate lifecycle ignores late recordProviderCall after markAttemptGateFinalized
      const directGate = createAttemptTelemetryGate({ managedByExecuteWithTimeout: true });
      const gateCalls = [];
      await runWithAttemptTelemetryGate(directGate, async () => {
        assert.strictEqual(getActiveAttemptTelemetryGate(), directGate);
        markAttemptGateFinalized(directGate);
        const emitted = recordProviderCall({
          onCallRecord: (rec) => gateCalls.push(rec),
          record: {
            participantId: 'late-direct',
            provider: 'codex',
            model: 'gpt-6-astra',
            exitCode: 0,
            durationMs: 5,
            trace: { outcome: 'success', durationMs: 5 }
          }
        });
        assert.strictEqual(emitted, false);
      });
      assert.equal(gateCalls.length, 0);
    });

    it('reports observed close signal null when timeout child traps SIGTERM and exits numerically', async () => {
      const tmpDir = createTempDir();
      const readyFile = path.join(tmpDir, 'trap-ready.marker');
      const script = writeFakeScript(
        tmpDir,
        'timeout-trap-numeric-exit.cjs',
        `
          const fs = require('node:fs');
          process.on('SIGTERM', () => {
            setTimeout(() => process.exit(3), 20);
          });
          fs.writeFileSync(${JSON.stringify(readyFile)}, 'ready');
          setInterval(() => {}, 1000);
        `
      );

      await assert.rejects(
        execCli(process.execPath, [script], { timeoutMs: 160, killGraceMs: 400 }),
        (err) => {
          assert.equal(fs.existsSync(readyFile), true);
          assert.strictEqual(err.code, 'ETIMEDOUT');
          assert.strictEqual(err.exitCode, 3);
          assert.strictEqual(err.signal, null);
          assert.ok(err.lifecycle?.attemptedSignals.includes('SIGTERM'));
          assertValidIso(err.lifecycle?.sigtermSentAt, 'sigtermSentAt');
          return true;
        }
      );
    });

    it('reserves single error receipt when runner fulfills after timeout latches (drainStatus fulfilled)', async () => {
      const telemetry = createTelemetryEmitter();
      const telemetryCalls = [];
      const observerCalls = [];
      telemetry.on('provider_call', (rec) => telemetryCalls.push(rec));

      const validCodexOut = JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: '{"scope":"gate","kind":"check","source":"fixture","statement":"late fulfill"}' }
      });

      const codex = new CodexAdapter({
        spawnRunner: (opts) =>
          runCodexCli({
            ...opts,
            exec: async () => {
              await new Promise((resolve) => setTimeout(resolve, 110));
              return { stdout: validCodexOut, stderr: '', exitCode: 0 };
            }
          })
      });

      await assert.rejects(
        codex.executeSeat({
          seat: { id: 'seat-fulfill-late', model: 'gpt-6-astra', tools: 'none' },
          soul: 'Auditor',
          round: 1,
          phase: 'DELIBERATION',
          timeoutMs: 45,
          abortDrainMs: 350,
          telemetry,
          onCallRecord: (rec) => observerCalls.push(rec),
          state: { topic: 'Fulfill after timeout', clarifications: [], proofs: [], objections: [] }
        }),
        (err) => {
          assert.ok(err instanceof TimeoutError);
          assert.equal(err.drainStatus, 'fulfilled');
          return true;
        }
      );

      assert.equal(observerCalls.length, 1);
      assert.equal(telemetryCalls.length, 1);
      assert.equal(telemetryCalls[0].drainStatus, 'fulfilled');
      assert.equal(telemetryCalls[0].trace.outcome, 'error');
    });

    it('emits single redacted error receipt for ordinary traced spawnRunner rejection before timeout', async () => {
      const telemetry = createTelemetryEmitter();
      const telemetryCalls = [];
      const observerCalls = [];
      telemetry.on('provider_call', (rec) => telemetryCalls.push(rec));

      const codex = new CodexAdapter({
        spawnRunner: async (opts) => {
          const err = new Error('Traced custom runner failure');
          err.exitCode = 2;
          err.stderr = `leak stderr ${opts.prompt}`;
          err.trace = {
            traceCoverage: 'partial',
            toolCalls: [],
            skillsRead: [],
            forbiddenStateAccess: false,
            forbiddenAccessDetails: [],
            durationMs: 14,
            outcome: 'error',
            stderr: `leak trace stderr ${opts.prompt}`,
            envelopeError: `leak envelope ${opts.prompt}`
          };
          throw err;
        }
      });

      await assert.rejects(
        codex.executeSeat({
          seat: { id: 'seat-traced-reject', model: 'gpt-6-astra', tools: 'none' },
          soul: 'Auditor',
          round: 1,
          phase: 'DELIBERATION',
          timeoutMs: 500,
          telemetry,
          onCallRecord: (rec) => observerCalls.push(rec),
          state: { topic: 'SECRET_TRACED_REJECT_TOPIC_888888', clarifications: [], proofs: [], objections: [] }
        }),
        (err) => {
          assert.ok(err instanceof HarnessExecutionError);
          assert.strictEqual(err.exitCode, 2);
          assert.equal(String(err.stderr).includes('SECRET_TRACED_REJECT_TOPIC_888888'), false);
          assert.equal(String(err.trace?.stderr || '').includes('SECRET_TRACED_REJECT_TOPIC_888888'), false);
          assert.equal(String(err.trace?.envelopeError || '').includes('SECRET_TRACED_REJECT_TOPIC_888888'), false);
          assert.equal(String(err.cause?.stderr || '').includes('SECRET_TRACED_REJECT_TOPIC_888888'), false);
          assert.equal(
            String(err.cause?.trace?.envelopeError || '').includes('SECRET_TRACED_REJECT_TOPIC_888888'),
            false
          );
          return true;
        }
      );

      assert.equal(observerCalls.length, 1);
      assert.equal(telemetryCalls.length, 1);
      assert.equal(telemetryCalls[0].trace.outcome, 'error');
      assert.equal(telemetryCalls[0].trace.stderr.includes('SECRET_TRACED_REJECT_TOPIC_888888'), false);
      assert.equal(telemetryCalls[0].trace.envelopeError.includes('SECRET_TRACED_REJECT_TOPIC_888888'), false);

      // Direct executeWithTimeout throwing traced non-abort Error (async & sync) also emits once
      const baseAdapter = new HarnessAdapter({ name: 'base' });
      const directCalls = [];
      await assert.rejects(
        baseAdapter.executeWithTimeout(
          async () => {
            const directErr = new Error('direct fn traced error');
            directErr.exitCode = 4;
            directErr.trace = {
              traceCoverage: 'unavailable',
              toolCalls: [],
              skillsRead: [],
              forbiddenStateAccess: false,
              forbiddenAccessDetails: [],
              durationMs: 7,
              outcome: 'error'
            };
            throw directErr;
          },
          500,
          { seatId: 'seat-direct-traced', model: 'm1', onCallRecord: (rec) => directCalls.push(rec) }
        ),
        (err) => err.exitCode === 4
      );
      assert.equal(directCalls.length, 1);
      assert.equal(directCalls[0].trace.outcome, 'error');
      assert.strictEqual(directCalls[0].drainStatus, undefined);

      const syncCalls = [];
      await assert.rejects(
        baseAdapter.executeWithTimeout(
          () => {
            const syncErr = new Error('sync fn traced error');
            syncErr.exitCode = 6;
            syncErr.trace = {
              traceCoverage: 'unavailable',
              toolCalls: [],
              skillsRead: [],
              forbiddenStateAccess: false,
              forbiddenAccessDetails: [],
              durationMs: 3,
              outcome: 'error'
            };
            throw syncErr;
          },
          500,
          { seatId: 'seat-sync-traced', model: 'm1', onCallRecord: (rec) => syncCalls.push(rec) }
        ),
        (err) => err.exitCode === 6
      );
      assert.equal(syncCalls.length, 1);
      assert.equal(syncCalls[0].exitCode, 6);
      assert.equal(syncCalls[0].trace.outcome, 'error');
    });

    it('sanitizes envelopeError during drain and isolates expired-drain AbortError from sibling signal.reason diagnostics', async () => {
      // 1. Settled error carrying oversized prompt-bearing envelopeError is redacted and <= 1024 B
      const baseAdapter = new HarnessAdapter({ name: 'base' });
      const promptSecret = 'SECRET_ENVELOPE_PROMPT_123456';
      const settledCalls = [];
      let settledErr = null;
      await assert.rejects(
        baseAdapter.executeWithTimeout(
          async (signal) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => {
                  const err = new Error('settled abort with envelope leak');
                  err.exitCode = 5;
                  err.envelopeError = `env ${promptSecret} ` + 'E'.repeat(1500);
                  err.trace = {
                    traceCoverage: 'unavailable',
                    toolCalls: [],
                    skillsRead: [],
                    forbiddenStateAccess: false,
                    forbiddenAccessDetails: [],
                    durationMs: 12,
                    outcome: 'error',
                    envelopeError: `trace env ${promptSecret} ` + 'T'.repeat(1500)
                  };
                  reject(err);
                },
                { once: true }
              );
            }),
          35,
          {
            seatId: 'seat-envelope-drain',
            model: 'm1',
            prompt: promptSecret,
            abortDrainMs: 250,
            onCallRecord: (rec) => settledCalls.push(rec)
          }
        ),
        (err) => {
          settledErr = err;
          assert.ok(err instanceof TimeoutError);
          assert.equal(err.drainStatus, 'settled');
          assert.ok(Buffer.byteLength(err.envelopeError, 'utf8') <= 1024);
          assert.ok(Buffer.byteLength(err.trace.envelopeError, 'utf8') <= 1024);
          assert.equal(err.envelopeError.includes(promptSecret), false);
          assert.equal(err.trace.envelopeError.includes(promptSecret), false);
          assert.equal(String(err.cause?.envelopeError || '').includes(promptSecret), false);
          assert.equal(String(err.cause?.trace?.envelopeError || '').includes(promptSecret), false);
          return true;
        }
      );
      const envSuffix = formatErrorDiagnosticSuffix(settledErr, '[TimeoutError] Timed out');
      assert.match(envSuffix, /— envelope:/);
      assert.equal(envSuffix.includes(promptSecret), false);
      assert.equal(settledCalls.length, 1);

      // 2. Expired drain aborted by external signal.reason carrying sibling diagnostics does NOT leak onto AbortError or receipt
      const siblingErr = new Error('Sibling seat failed');
      siblingErr.exitCode = 9;
      siblingErr.signal = 'SIGKILL';
      siblingErr.stderr = 'sibling stderr secret';
      siblingErr.envelopeError = 'sibling envelope secret';
      siblingErr.lifecycle = { spawnedAt: '2026-11-21T12:00:00.000Z', settledAt: '2026-11-21T12:00:01.000Z' };
      siblingErr.trace = {
        traceCoverage: 'full',
        toolCalls: [{ tool: 'read' }],
        skillsRead: [],
        forbiddenStateAccess: false,
        forbiddenAccessDetails: [],
        durationMs: 55,
        outcome: 'error',
        stderr: 'sibling trace stderr',
        envelopeError: 'sibling trace envelope',
        lifecycle: siblingErr.lifecycle
      };

      const extController = new AbortController();
      const expiredCalls = [];
      let expiredAbortErr = null;
      setTimeout(() => extController.abort(siblingErr), 20);

      await assert.rejects(
        baseAdapter.executeWithTimeout(
          () => new Promise(() => {}),
          500,
          {
            seatId: 'seat-expired-sibling',
            model: 'm1',
            signal: extController.signal,
            abortDrainMs: 25,
            onCallRecord: (rec) => expiredCalls.push(rec)
          }
        ),
        (err) => {
          expiredAbortErr = err;
          assert.ok(err instanceof AbortError);
          assert.equal(err.drainStatus, 'drain_expired');
          assert.strictEqual(err.exitCode, null);
          assert.strictEqual(err.signal, null);
          assert.strictEqual(err.stderr, '');
          assert.strictEqual(err.lifecycle, undefined);
          assert.strictEqual(err.trace, undefined);
          assert.strictEqual(err.envelopeError, undefined);
          return true;
        }
      );

      assert.equal(expiredCalls.length, 1);
      assert.equal(expiredCalls[0].drainStatus, 'drain_expired');
      assert.strictEqual(expiredCalls[0].exitCode, null);
      assert.strictEqual(expiredCalls[0].signal, null);
      assert.strictEqual(expiredCalls[0].trace.stderr, undefined);
      assert.strictEqual(expiredCalls[0].trace.envelopeError, undefined);
      assert.strictEqual(expiredCalls[0].trace.lifecycle, undefined);
      const expiredSuffix = formatErrorDiagnosticSuffix(expiredAbortErr, '[AbortError] aborted');
      assert.strictEqual(expiredSuffix, ' (drain: drain_expired)');

      // 3. Settled abort keeps child exitCode: null / signal: 'SIGTERM' separate from sibling reason exitCode: 9
      const settledSiblingCtrl = new AbortController();
      const settledSiblingCalls = [];
      setTimeout(() => settledSiblingCtrl.abort(siblingErr), 20);
      await assert.rejects(
        baseAdapter.executeWithTimeout(
          (signal) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => {
                  const childAbort = new AbortError('child aborted locally', {
                    harness: 'base',
                    seatId: 'seat-settled-sibling',
                    exitCode: null,
                    signal: 'SIGTERM',
                    inheritCauseDiagnostics: false,
                    cause: settledSiblingCtrl.signal.reason
                  });
                  reject(childAbort);
                },
                { once: true }
              );
            }),
          500,
          {
            seatId: 'seat-settled-sibling',
            model: 'm1',
            signal: settledSiblingCtrl.signal,
            onCallRecord: (rec) => settledSiblingCalls.push(rec)
          }
        ),
        (err) => {
          assert.ok(err instanceof AbortError);
          assert.strictEqual(err.exitCode, null);
          assert.strictEqual(err.signal, 'SIGTERM');
          assert.strictEqual(err.stderr, '');
          assert.strictEqual(err.trace, undefined);
          return true;
        }
      );
      assert.equal(settledSiblingCalls.length, 1);
      assert.strictEqual(settledSiblingCalls[0].exitCode, null);
      assert.strictEqual(settledSiblingCalls[0].signal, 'SIGTERM');

      // 4. Operation rejecting directly with externalSignal.reason (even a sibling AbortError) does not leak or mutate it
      const siblingAbortReason = new AbortError('sibling seat aborted', {
        harness: 'base',
        seatId: 'other-seat',
        exitCode: 9,
        signal: 'SIGKILL',
        stderr: 'other seat stderr',
        envelopeError: 'other seat env',
        trace: {
          traceCoverage: 'full',
          toolCalls: [],
          skillsRead: [],
          forbiddenStateAccess: false,
          forbiddenAccessDetails: [],
          durationMs: 30,
          outcome: 'error',
          stderr: 'other trace stderr',
          envelopeError: 'other trace env'
        }
      });
      const directReasonCtrl = new AbortController();
      const directReasonCalls = [];
      let directReasonThrown = null;
      setTimeout(() => directReasonCtrl.abort(siblingAbortReason), 20);
      await assert.rejects(
        baseAdapter.executeWithTimeout(
          (signal) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(directReasonCtrl.signal.reason), { once: true });
            }),
          500,
          {
            seatId: 'seat-direct-reason',
            model: 'm1',
            signal: directReasonCtrl.signal,
            onCallRecord: (rec) => directReasonCalls.push(rec)
          }
        ),
        (err) => {
          directReasonThrown = err;
          assert.ok(err instanceof AbortError);
          assert.notStrictEqual(err, siblingAbortReason);
          assert.equal(err.drainStatus, 'settled');
          assert.strictEqual(err.exitCode, null);
          assert.strictEqual(err.signal, null);
          assert.strictEqual(err.stderr, '');
          assert.strictEqual(err.trace, undefined);
          assert.strictEqual(err.lifecycle, undefined);
          assert.strictEqual(err.envelopeError, undefined);
          return true;
        }
      );
      assert.strictEqual(directReasonCalls.length, 1);
      assert.strictEqual(directReasonCalls[0].exitCode, null);
      assert.strictEqual(directReasonCalls[0].signal, null);
      assert.strictEqual(siblingAbortReason.exitCode, 9);
      assert.strictEqual(siblingAbortReason.stderr, 'other seat stderr');
      assert.strictEqual(
        formatErrorDiagnosticSuffix(directReasonThrown, '[AbortError] aborted'),
        ' (drain: settled)'
      );
    });
  });

  describe('4. Prompt Redaction & UTF-8 Byte Bounds', () => {
    it('slices multi-byte UTF-8 without splitting surrogate pairs or emitting U+FFFD and bounds stderr/message/envelope', async () => {
      const multiByte = '🚀é中'.repeat(1200);
      const sliced15 = sliceUtf8Bytes(multiByte, 15);
      assert.ok(Buffer.byteLength(sliced15, 'utf8') <= 15);
      assert.equal(sliced15.includes('\uFFFD'), false);

      // Surrogate pair boundary check: '🚀' is 4 UTF-8 bytes and 2 UTF-16 code units
      const rocketBoundary = sliceUtf8Bytes('ab🚀cd', 5);
      assert.strictEqual(rocketBoundary, 'ab');
      assert.equal(rocketBoundary.includes('\uFFFD'), false);

      const secret = 'SECRET_MULTI_BYTE_TOKEN_999999';
      const rawText = `header --print=${secret} middle ${secret} ` + '🚀'.repeat(1500);
      const redactedBounded = redactPromptInText(rawText, secret, { maxBytes: MAX_CLI_STDERR_BYTES });
      assert.ok(Buffer.byteLength(redactedBounded, 'utf8') <= MAX_CLI_STDERR_BYTES);
      assert.equal(redactedBounded.includes(secret), false);
      assert.equal(redactedBounded.includes('\uFFFD'), false);
      assert.match(redactedBounded, /\[REDACTED prompt:/);

      const err = new HarnessExecutionError(`msg ${secret} ` + '🚀'.repeat(800), {
        harness: 'codex',
        seatId: 'seat-bounds',
        stderr: `err ${secret} ` + 'é'.repeat(3000)
      });
      assert.ok(Buffer.byteLength(err.message, 'utf8') <= MAX_CLI_ERROR_MESSAGE_BYTES);
      assert.ok(Buffer.byteLength(err.stderr, 'utf8') <= MAX_CLI_STDERR_BYTES);
      assert.equal(err.message.includes('\uFFFD'), false);
      assert.equal(err.stderr.includes('\uFFFD'), false);

      const recorded = [];
      const emitted = recordProviderCall({
        onCallRecord: (rec) => recorded.push(rec),
        record: {
          participantId: 'seat-bounds',
          provider: 'antigravity',
          model: 'gemini-4-argon-high',
          prompt: secret,
          exitCode: 1,
          durationMs: 12,
          trace: {
            outcome: 'error',
            durationMs: 12,
            stderr: rawText,
            envelopeError: `env ${secret} ` + '中'.repeat(600)
          }
        }
      });
      assert.strictEqual(emitted, true);
      assert.equal(recorded.length, 1);
      assert.ok(Buffer.byteLength(recorded[0].trace.stderr, 'utf8') <= MAX_CLI_STDERR_BYTES);
      assert.ok(Buffer.byteLength(recorded[0].trace.envelopeError, 'utf8') <= 1024);
      assert.equal(recorded[0].trace.stderr.includes(secret), false);
      assert.equal(recorded[0].trace.envelopeError.includes(secret), false);
      assert.equal(recorded[0].trace.stderr.includes('\uFFFD'), false);
      assert.equal(recorded[0].trace.envelopeError.includes('\uFFFD'), false);

      // Short explicit prompt (< 8 chars) is redacted on token boundaries while 1-char 'P' preserves words like 'Permission denied'
      assert.equal(
        redactPromptInText('fatal: stderr s3cr3t occurred', 's3cr3t', { minPromptLength: 8 }).includes('s3cr3t'),
        false
      );
      assert.equal(
        redactPromptInText('Permission denied', 'P', { minPromptLength: 8 }),
        'Permission denied'
      );

      const shortPromptCalls = [];
      await assert.rejects(
        runCodexCli({
          model: 'gpt-6-astra',
          prompt: 's3cr3t',
          onCallRecord: (rec) => shortPromptCalls.push(rec),
          exec: async () => {
            const err = new Error('failed on s3cr3t');
            err.exitCode = 1;
            err.stderr = 'stderr line with s3cr3t inside';
            throw err;
          }
        }),
        (err) => {
          assert.equal(err.message.includes('s3cr3t'), false);
          assert.equal(err.stderr.includes('s3cr3t'), false);
          return true;
        }
      );
      assert.equal(shortPromptCalls.length, 1);
      assert.equal(shortPromptCalls[0].trace.stderr.includes('s3cr3t'), false);
    });
  });

  describe('5. End-to-End CouncilEngine + ledger.js + VisualizerLiveWatcher Fault Surfacing', () => {
    it('surfaces terminal judge timeout fault in CouncilEngine, ledger.js, and VisualizerLiveWatcher while preserving excused-seat open objection', async () => {
      const tmpDir = createTempDir();
      const liveOut = path.join(tmpDir, 'live-run-latest.js');
      const settleScript = writeFakeScript(
        tmpDir,
        'seat-round2-timeout.cjs',
        `
          process.stderr.write('HTTP 429 rate_limit_error while tool stalled\\n');
          process.on('SIGTERM', () => {
            setTimeout(() => process.exit(4), 25);
          });
          setInterval(() => {}, 1000);
        `
      );
      const expireScript = writeFakeScript(
        tmpDir,
        'judge-round2-timeout.cjs',
        `
          process.stderr.write('429 upstream stalled\\n');
          process.on('SIGTERM', () => {});
          setInterval(() => {}, 1000);
        `
      );

      const telemetry = createTelemetryEmitter();
      const watcher = new VisualizerLiveWatcher({
        telemetry,
        outputPath: liveOut,
        initialConfig: {
          topic: 'Issue 107 End-to-End Fault Surfacing',
          maxRounds: 2,
          minQuorum: 2,
          judge: { id: 'judge-1', harness: 'codex', model: 'gpt-6-astra' },
          seats: [
            { id: 's1', harness: 'mock', model: 'gpt-6-astra' },
            { id: 's2', harness: 'mock', model: 'gpt-6-astra' },
            { id: 's3', harness: 'codex', model: 'gpt-6-astra' }
          ]
        }
      });

      const mockAdapter = new MockAdapter();
      mockAdapter.scriptSeatResponse({
        seatId: 's3',
        round: 1,
        phase: 'VOTING',
        response: { vote: 'object', reason: 'Missing timeout bound proof', proofId: 'P3' }
      });

      const codexAdapter = new CodexAdapter({
        spawnRunner: async (opts) => {
          const seatId = opts.context?.seatId;
          const round = opts.context?.round;
          const phase = opts.context?.phase;
          if (seatId === 's3' && round === 1 && phase === 'DELIBERATION') {
            return JSON.stringify({
              scope: 'Timeout Guard',
              kind: 'check',
              source: 'fixture',
              statement: 'Seat 3 round 1 proof'
            });
          }
          if (seatId === 's3' && round === 1 && phase === 'VOTING') {
            return JSON.stringify({
              vote: 'object',
              reason: 'Missing timeout bound proof',
              proofId: 'P3'
            });
          }
          if (seatId === 's3' && round === 2 && phase === 'DELIBERATION') {
            return runCodexCli({ ...opts, exec: makeFakeCodexExec(settleScript) });
          }
          if (seatId === 'judge-1' && round === 1) {
            const proofDecisions = {};
            for (const p of opts.context?.proofs || []) {
              proofDecisions[p.id] = { decision: 'admit', note: 'admitted' };
            }
            return JSON.stringify({
              summary: 'Round 1 candidate',
              proofDecisions: Object.keys(proofDecisions).length
                ? proofDecisions
                : { P1: { decision: 'admit' }, P2: { decision: 'admit' }, P3: { decision: 'admit' } },
              clauses: [{ id: 'C1', context: 'Timeout', conclusion: 'Bound drains', citedProofIds: ['P1', 'P2', 'P3'] }]
            });
          }
          if (seatId === 'judge-1' && round === 2) {
            return runCodexCli({
              ...opts,
              exec: async (_bin, args, execOpts) => {
                try {
                  return await execCli(process.execPath, [expireScript, ...args], execOpts);
                } catch (err) {
                  await new Promise((resolve) => setTimeout(resolve, 140));
                  throw err;
                }
              }
            });
          }
          return '{}';
        }
      });

      // Let mockAdapter handle normal seat turns for s1/s2 and round-1 judge; route s3 & round-2 judge via codexAdapter
      const origExecuteJudge = mockAdapter.executeJudgeAuditAndSynthesis.bind(mockAdapter);
      const liveHarnessResolver = (type) => {
        if (type === 'codex') {
          return {
            resolveTimeoutMs: (m, t) => codexAdapter.resolveTimeoutMs(m, t),
            executeSeatProof: (args) => codexAdapter.executeSeatProof({ ...args, abortDrainMs: 300, killGraceMs: 250 }),
            executeSeatVote: (args) => codexAdapter.executeSeatVote(args),
            executeJudgeAuditAndSynthesis: (args) => {
              if (args.round === 1) {
                return origExecuteJudge(args);
              }
              return codexAdapter.executeJudgeAuditAndSynthesis({ ...args, abortDrainMs: 25, killGraceMs: 40 });
            }
          };
        }
        return mockAdapter;
      };

      const engine = new CouncilEngine(
        {
          topic: 'Issue 107 End-to-End Fault Surfacing',
          maxRounds: 2,
          minQuorum: 2,
          maxRetriesPerSeat: 0,
          maxRetriesPerJudge: 0,
          tools: 'none',
          selfContainedInput: createConceptualSelfContained(),
          judge: { id: 'judge-1', harness: 'codex', model: 'gpt-6-astra', timeoutMs: 150, maxRetries: 0 },
          seats: [
            { id: 's1', harness: 'mock', model: 'gpt-6-astra', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'gpt-6-astra', soul: 'S2' },
            { id: 's3', harness: 'codex', model: 'gpt-6-astra', soul: 'S3', timeoutMs: 150 }
          ]
        },
        {
          telemetry,
          harnessResolver: liveHarnessResolver
        }
      );

      let result;
      try {
        result = await engine.run();
      } finally {
        watcher.stop();
      }

      // CouncilEngine assertions: s3 excused + open objection preserved_excused + terminal judge timeout fault
      assert.equal(result.ok, false);
      assert.equal(engine.state.phase, 'completed');
      assert.equal(result.verdict.kind, 'Dissent Report (Judge Fault)');

      const s3 = engine.state.seats.find((s) => s.id === 's3');
      assert.equal(s3.status, 'excused');
      assert.equal(s3.errorClass, 'TimeoutError');
      assert.match(s3.excusedReason, /\[TimeoutError\]/);
      assert.match(s3.excusedReason, /\(exit code 4\)/);
      assert.match(s3.excusedReason, /\(drain: settled\)/);

      assert.equal(result.verdict.unresolvedObjections.length, 1);
      assert.equal(result.verdict.unresolvedObjections[0].seatId, 's3');
      assert.equal(result.verdict.unresolvedObjections[0].status, 'preserved_excused');

      assert.equal(engine.state.judge.status, 'fault_timeout');
      assert.equal(engine.state.judge.errorClass, 'TimeoutError');
      assert.match(engine.state.judge.faultReason, /\[TimeoutError\]/);
      assert.match(engine.state.judge.faultReason, /\(drain: drain_expired\)/);
      assert.doesNotMatch(engine.state.judge.faultReason, /exit code/);

      // Ledger assertions
      const ledgerRecord = buildRunTelemetryRecord({
        runId: 'issue-107-e2e-run',
        state: engine.state,
        snapshots: result.snapshots,
        providerCalls: result.providerCalls
      });
      assert.equal(ledgerRecord.judge.status, 'fault_timeout');
      assert.equal(ledgerRecord.judge.errorClass, 'TimeoutError');
      assert.match(ledgerRecord.judge.faultReason, /\[TimeoutError\]/);
      const ledgerS3 = ledgerRecord.seats.find((s) => s.seatId === 's3');
      assert.equal(ledgerS3.status, 'excused');
      assert.equal(ledgerS3.excused, true);

      // VisualizerLiveWatcher assertions
      assert.equal(watcher.liveRun.isRunning, false);
      assert.equal(watcher.liveRun.currentState.judge.status, 'fault_timeout');
      assert.equal(watcher.liveRun.currentState.judge.errorClass, 'TimeoutError');
      assert.match(watcher.liveRun.currentState.judge.faultReason, /\[TimeoutError\]/);
      const watchedObj = watcher.liveRun.currentState.objections.find((o) => o.seatId === 's3');
      assert.equal(watchedObj.status, 'preserved_excused');

      const liveFileContent = fs.readFileSync(liveOut, 'utf8');
      assert.match(liveFileContent, /"status": "fault_timeout"/);
      assert.match(liveFileContent, /"errorClass": "TimeoutError"/);
      assert.match(liveFileContent, /"status": "preserved_excused"/);
    });

    it('preserves canceled-wave seat timeout faults across subsequent transitions in VisualizerLiveWatcher until cleared', async () => {
      const tmpDir = createTempDir();
      const liveOut = path.join(tmpDir, 'live-run-latest.js');
      const readyFile = path.join(tmpDir, 's1-armed.marker');
      const seatTimeoutScript = writeFakeScript(
        tmpDir,
        'wave-seat-timeout.cjs',
        `
          const fs = require('node:fs');
          process.stderr.write('429 rate_limit_error during canceled wave\\n');
          process.on('SIGTERM', () => {
            setTimeout(() => process.exit(5), 200);
          });
          fs.writeFileSync(${JSON.stringify(readyFile)}, String(process.pid));
          setInterval(() => {}, 1000);
        `
      );

      const telemetry = createTelemetryEmitter();
      const watcher = new VisualizerLiveWatcher({
        telemetry,
        outputPath: liveOut,
        initialConfig: {
          topic: 'Canceled Wave Fault Overlay',
          maxRounds: 1,
          minQuorum: 2,
          judge: { id: 'judge-1', harness: 'mock', model: 'gpt-6-astra' },
          seats: [
            { id: 's1', harness: 'codex', model: 'gpt-6-astra' },
            { id: 's2', harness: 'mock', model: 'gpt-6-astra' }
          ]
        }
      });

      const codexAdapter = new CodexAdapter({
        spawnRunner: (opts) => runCodexCli({ ...opts, exec: makeFakeCodexExec(seatTimeoutScript) })
      });
      const mockAdapter = new MockAdapter();
      const origExecuteSeat = mockAdapter.executeSeat.bind(mockAdapter);
      mockAdapter.executeSeat = async (ctx) => {
        if (ctx.seat.id === 's2') {
          await waitForFile(readyFile);
          await new Promise((resolve) => setTimeout(resolve, 140));
          throw new HarnessExecutionError('Fatal seat 2 exit', {
            harness: 'mock',
            seatId: 's2',
            exitCode: 2,
            stderr: 'fatal seat 2 error',
            isRetryable: false
          });
        }
        return origExecuteSeat(ctx);
      };

      const engine = new CouncilEngine(
        {
          topic: 'Canceled Wave Fault Overlay',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 0,
          tools: 'none',
          selfContainedInput: createConceptualSelfContained(),
          judge: { id: 'judge-1', harness: 'mock', model: 'gpt-6-astra' },
          seats: [
            { id: 's1', harness: 'codex', model: 'gpt-6-astra', soul: 'S1', timeoutMs: 140 },
            { id: 's2', harness: 'mock', model: 'gpt-6-astra', soul: 'S2' }
          ]
        },
        {
          telemetry,
          harnessResolver: (type) =>
            type === 'codex'
              ? {
                  resolveTimeoutMs: (m, t) => codexAdapter.resolveTimeoutMs(m, t),
                  executeSeatProof: (args) => codexAdapter.executeSeatProof({ ...args, abortDrainMs: 500, killGraceMs: 400 })
                }
              : mockAdapter
        }
      );

      try {
        const result = await engine.run();
        assert.equal(result.ok, false);
        assert.equal(result.verdict.kind, 'Dissent Report (Below Quorum)');

        // s1 faulted with latched timeout right before wave cancellation; s2's SEAT_FAULT -> EXCUSE_SEAT -> completed
        // transitions must NOT overwrite s1's fault_timeout status, errorClass, and faultReason in the live watcher.
        const watchedS1 = watcher.liveRun.currentState.seats.find((s) => s.id === 's1');
        assert.equal(watchedS1.status, 'fault_timeout');
        assert.equal(watchedS1.errorClass, 'TimeoutError');
        assert.match(watchedS1.faultReason, /\[TimeoutError\]/);
        assert.match(watchedS1.faultReason, /\(exit code 5\)/);

        // Emitting RESET clears the observer fault overlay
        telemetry.emitStateTransition(
          { type: 'RESET' },
          {
            ...engine.state,
            phase: 'preflight',
            round: 0,
            verdict: null,
            seats: engine.state.seats.map((s) => ({ ...s, status: 'idle' }))
          }
        );
        const resetS1 = watcher.liveRun.currentState.seats.find((s) => s.id === 's1');
        assert.equal(resetS1.status, 'idle');
      } finally {
        watcher.stop();
      }
    });

    it('keeps seat fault overlay visible across sibling SUBMIT_PROOF transitions until cleared by RETRY_SEAT', () => {
      const tmpDir = createTempDir();
      const liveOut = path.join(tmpDir, 'live-run-latest.js');
      const telemetry = createTelemetryEmitter();
      const watcher = new VisualizerLiveWatcher({
        telemetry,
        outputPath: liveOut,
        initialConfig: { topic: 'Sibling Transition Overlay' }
      });

      try {
        const baseState = {
          phase: 'seat_fault',
          round: 1,
          maxRounds: 2,
          minQuorum: 2,
          topic: 'Sibling Transition Overlay',
          faultSeatId: 's1',
          seats: [
            { id: 's1', status: 'fault', faultReason: '[HarnessExecutionError] exit 2', errorClass: 'HarnessExecutionError' },
            { id: 's2', status: 'thinking' }
          ],
          judge: { id: 'judge-1', status: 'idle' },
          proofs: [],
          objections: [],
          history: []
        };
        telemetry.emitStateTransition({ type: 'SEAT_FAULT', seatId: 's1' }, baseState);

        telemetry.emitStateTransition(
          { type: 'SUBMIT_PROOF', seatId: 's2' },
          {
            ...baseState,
            phase: 'reviewing',
            faultSeatId: null,
            seats: [
              { id: 's1', status: 'thinking' },
              { id: 's2', status: 'proof_submitted' }
            ]
          }
        );
        const s1AfterSibling = watcher.liveRun.currentState.seats.find((s) => s.id === 's1');
        assert.equal(s1AfterSibling.status, 'fault');
        assert.equal(s1AfterSibling.errorClass, 'HarnessExecutionError');
        assert.equal(s1AfterSibling.faultReason, '[HarnessExecutionError] exit 2');

        telemetry.emitStateTransition(
          { type: 'RETRY_SEAT', seatId: 's1' },
          {
            ...baseState,
            phase: 'reviewing',
            faultSeatId: null,
            seats: [
              { id: 's1', status: 'thinking' },
              { id: 's2', status: 'proof_submitted' }
            ]
          }
        );
        const s1AfterRetry = watcher.liveRun.currentState.seats.find((s) => s.id === 's1');
        assert.equal(s1AfterRetry.status, 'thinking');
        assert.equal(s1AfterRetry.faultReason, undefined);
      } finally {
        watcher.stop();
      }
    });
  });
});
