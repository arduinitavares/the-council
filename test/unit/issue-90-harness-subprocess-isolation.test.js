import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  execCli,
  parseModelAndEffort,
  runCodexCli,
  runAntigravityCli,
  runCursorCli,
  detectForbiddenCouncilAccess,
  parseCodexEventStream,
  parseCursorEventStream
} from '../../src/harness/cli-runner.js';
import {
  HarnessAdapter,
  AbortError,
  TimeoutError,
  HarnessExecutionError,
  InvalidResponseError
} from '../../src/harness/adapter.js';
import { CodexAdapter } from '../../src/harness/codex.js';
import { AntigravityAdapter } from '../../src/harness/antigravity.js';
import { CursorAdapter } from '../../src/harness/cursor.js';

async function waitForFile(filePath, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (content.length > 0) {
        return content;
      }
    }
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

describe('Issue #90 — Harness Subprocess Cancellation & Isolation', () => {
  describe('Seam A: execCli SIGTERM -> SIGKILL escalation & close-before-settle', () => {
    it('delivers SIGTERM on abort, escalates to SIGKILL after killGraceMs when child traps SIGTERM, and settles only after ESRCH', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue90-seam-a-'));
      const pidFile = path.join(tmpDir, 'child.pid');
      const sigtermFile = path.join(tmpDir, 'sigterm.seen');
      const controller = new AbortController();

      const childScript = [
        'const fs = require("node:fs");',
        `process.on("SIGTERM", () => { fs.writeFileSync(${JSON.stringify(sigtermFile)}, "trapped"); });`,
        `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
        'setInterval(() => {}, 1000);'
      ].join(' ');

      try {
        const execPromise = execCli(process.execPath, ['-e', childScript], {
          signal: controller.signal,
          killGraceMs: 80
        });

        const pidStr = await waitForFile(pidFile);
        const childPid = Number(pidStr);
        assert.ok(Number.isInteger(childPid) && childPid > 0);

        controller.abort();

        await assert.rejects(
          execPromise,
          (err) => {
            assert.equal(err.name, 'AbortError');
            assert.equal(err.code, 'ABORT_ERR');
            return true;
          }
        );

        // Immediately upon settlement, child must already be dead (ESRCH) and must have received SIGTERM first.
        assert.equal(fs.existsSync(sigtermFile), true, 'Child should receive SIGTERM before SIGKILL escalation');
        assert.throws(
          () => process.kill(childPid, 0),
          (killErr) => killErr && killErr.code === 'ESRCH',
          'Child PID must already be terminated (ESRCH) before execCli settles'
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('rejects pre-aborted signal immediately with AbortError without spawning a child', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue90-seam-a-preabort-'));
      const markerFile = path.join(tmpDir, 'spawned.marker');
      const controller = new AbortController();
      controller.abort();

      try {
        await assert.rejects(
          execCli(
            process.execPath,
            ['-e', `require("node:fs").writeFileSync(${JSON.stringify(markerFile)}, "ran")`],
            { signal: controller.signal }
          ),
          (err) => err.name === 'AbortError' && err.code === 'ABORT_ERR'
        );
        assert.equal(fs.existsSync(markerFile), false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('escalates timeoutMs expiry from SIGTERM to SIGKILL when child ignores SIGTERM and settles after ESRCH', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue90-seam-a-timeout-'));
      const pidFile = path.join(tmpDir, 'child.pid');

      const childScript = [
        'const fs = require("node:fs");',
        'process.on("SIGTERM", () => {});',
        `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
        'setInterval(() => {}, 1000);'
      ].join(' ');

      try {
        const execPromise = execCli(process.execPath, ['-e', childScript], {
          timeoutMs: 120,
          killGraceMs: 80
        });

        const childPid = Number(await waitForFile(pidFile));
        await assert.rejects(
          execPromise,
          (err) => {
            assert.equal(err.killed, true);
            return true;
          }
        );

        assert.throws(
          () => process.kill(childPid, 0),
          (killErr) => killErr && killErr.code === 'ESRCH'
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('Seam B: AbortError taxonomy, first-cause latch & 4-phase adapter signal propagation', () => {
    it('classifies AbortError as non-retryable across all adapters while keeping FORBIDDEN_STATE_ACCESS retryable', () => {
      const adapters = [
        new HarnessAdapter({ name: 'base' }),
        new CodexAdapter(),
        new AntigravityAdapter(),
        new CursorAdapter()
      ];

      for (const adapter of adapters) {
        const rawAbort = Object.assign(new Error('Cancelled during rate_limit 429 output'), {
          name: 'AbortError',
          code: 'ABORT_ERR',
          stderr: '429 rate_limit'
        });
        const classifiedAbort = adapter.classifyError(rawAbort, { seatId: 's1', model: 'm1' });
        assert.equal(classifiedAbort instanceof AbortError, true);
        assert.equal(classifiedAbort.name, 'AbortError');
        assert.equal(classifiedAbort.code, 'ABORT_ERR');
        assert.equal(classifiedAbort.isRetryable, false);
        assert.equal(classifiedAbort.isQuotaFault, false);

        const rawForbidden = Object.assign(new Error('[ForbiddenStateAccessError] blocked'), {
          code: 'FORBIDDEN_STATE_ACCESS'
        });
        const classifiedForbidden = adapter.classifyError(rawForbidden, { seatId: 's1', model: 'm1' });
        assert.equal(classifiedForbidden instanceof HarnessExecutionError, true);
        assert.equal(classifiedForbidden.code, 'FORBIDDEN_STATE_ACCESS');
        assert.equal(classifiedForbidden.isRetryable, true);
      }
    });

    it('rejects pre-aborted external signal in executeWithTimeout without invoking fn', async () => {
      const adapter = new HarnessAdapter({ name: 'base' });
      const controller = new AbortController();
      controller.abort();
      let invoked = false;

      await assert.rejects(
        adapter.executeWithTimeout(
          async () => {
            invoked = true;
            return 'unexpected';
          },
          500,
          { seatId: 's1', model: 'm1', signal: controller.signal }
        ),
        (err) => err instanceof AbortError && err.isRetryable === false
      );
      assert.equal(invoked, false);
    });

    it('latches external abort as first cause even when SIGKILL cleanup exceeds timeoutMs, and honors explicit abortDrainMs', async () => {
      const adapter = new HarnessAdapter({ name: 'base' });
      const controller = new AbortController();
      let cleanupCompleted = false;

      const runPromise = adapter.executeWithTimeout(
        async (composedSignal) => {
          await new Promise((resolve) => {
            composedSignal.addEventListener(
              'abort',
              () => {
                // Simulate 120ms SIGTERM -> SIGKILL + temp cleanup exceeding the 60ms timeoutMs
                setTimeout(() => {
                  cleanupCompleted = true;
                  resolve();
                }, 120);
              },
              { once: true }
            );
          });
          return 'done';
        },
        60,
        { seatId: 's1', model: 'm1', signal: controller.signal }
      );

      setTimeout(() => controller.abort(), 20);

      await assert.rejects(
        runPromise,
        (err) => {
          assert.equal(err instanceof AbortError, true, `Expected AbortError, got ${err?.name}`);
          assert.equal(err instanceof TimeoutError, false);
          assert.equal(err.isRetryable, false);
          return true;
        }
      );
      assert.equal(cleanupCompleted, true, 'executeWithTimeout must wait for fn cleanup settlement by default');

      // Explicit numeric abortDrainMs bounds wait on non-cooperative fn
      const stuckController = new AbortController();
      const t0 = Date.now();
      const stuckPromise = adapter.executeWithTimeout(
        () => new Promise(() => {}),
        5000,
        { seatId: 's1', model: 'm1', signal: stuckController.signal, abortDrainMs: 30 }
      );
      setTimeout(() => stuckController.abort(), 15);
      await assert.rejects(stuckPromise, (err) => err instanceof AbortError);
      assert.ok(Date.now() - t0 < 1000, 'abortDrainMs must bound non-cooperative wait');
    });

    it('preserves retryable TimeoutError over cooperative AbortError when internal deadline expires first (with or without externalSignal)', async () => {
      const adapter = new HarnessAdapter({ name: 'base' });
      const cooperativeAbortFn = (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new AbortError('cooperative abort on signal')),
            { once: true }
          );
        });

      await assert.rejects(
        adapter.executeWithTimeout(cooperativeAbortFn, 20, {
          seatId: 'seat-no-ext-signal',
          model: 'gpt-6.1-sol (high)'
        }),
        (err) => err instanceof TimeoutError && !(err instanceof AbortError) && err.isRetryable === true,
        'Internal timeout without externalSignal must reject with retryable TimeoutError, not AbortError'
      );

      const unAbortedExternal = new AbortController();
      await assert.rejects(
        adapter.executeWithTimeout(cooperativeAbortFn, 20, {
          seatId: 'seat-with-ext-signal',
          model: 'gpt-6.1-sol (high)',
          signal: unAbortedExternal.signal
        }),
        (err) => err instanceof TimeoutError && !(err instanceof AbortError) && err.isRetryable === true,
        'Internal timeout with un-aborted externalSignal must reject with retryable TimeoutError, not AbortError'
      );
    });

    it('drains SIGTERM -> SIGKILL subprocess settlement and council-seat-cwd-* cleanup on deadline timeout (with or without externalSignal, preserving first-cause TimeoutError and honoring abortDrainMs)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue90-timeout-drain-'));
      const scriptFile = path.join(tmpDir, 'trap-timeout-child.cjs');

      try {
        // 1. Without externalSignal: internal timeoutMs expires while child traps SIGTERM
        const infoNoExt = path.join(tmpDir, 'info-no-ext.json');
        fs.writeFileSync(
          scriptFile,
          [
            'const fs = require("node:fs");',
            'process.on("SIGTERM", () => {});',
            `fs.writeFileSync(${JSON.stringify(infoNoExt)}, JSON.stringify({ pid: process.pid, cwd: process.cwd() }));`,
            'setInterval(() => {}, 1000);'
          ].join('\n')
        );

        const adapterNoExt = new CodexAdapter({
          spawnRunner: (runnerOpts) =>
            runCodexCli({
              ...runnerOpts,
              exec: (_bin, _args, execOpts) => execCli(process.execPath, [scriptFile], execOpts)
            })
        });

        const noExtPromise = adapterNoExt.executeSeatProof({
          seat: { id: 'seat-timeout-no-ext', model: 'gpt-6.1-sol (high)', tools: 'read-only' },
          soul: 'pragmatist',
          round: 1,
          timeoutMs: 90,
          killGraceMs: 180,
          state: { topic: 'Verify timeout drain without externalSignal', maxRounds: 2, clarifications: [], proofs: [], objections: [] }
        });

        const { pid: pidNoExt, cwd: cwdNoExt } = JSON.parse(await waitForFile(infoNoExt));
        assert.match(path.basename(cwdNoExt), /^council-seat-cwd-/);

        await assert.rejects(
          noExtPromise,
          (err) => err instanceof TimeoutError && !(err instanceof AbortError) && err.isRetryable === true,
          'Timeout without externalSignal must reject with retryable TimeoutError'
        );

        assert.throws(
          () => process.kill(pidNoExt, 0),
          (killErr) => killErr && killErr.code === 'ESRCH',
          'Subprocess must already be dead (ESRCH) before TimeoutError rejects (no externalSignal)'
        );
        assert.equal(
          fs.existsSync(cwdNoExt),
          false,
          'council-seat-cwd-* must already be cleaned up before TimeoutError rejects (no externalSignal)'
        );

        // 2. With externalSignal (which also aborts AFTER timeoutMs fires during the SIGKILL drain):
        // must still drain child + temp dir AND preserve first-cause retryable TimeoutError
        const infoWithExt = path.join(tmpDir, 'info-with-ext.json');
        const scriptWithExt = path.join(tmpDir, 'trap-timeout-ext.cjs');
        fs.writeFileSync(
          scriptWithExt,
          [
            'const fs = require("node:fs");',
            'process.on("SIGTERM", () => {});',
            `fs.writeFileSync(${JSON.stringify(infoWithExt)}, JSON.stringify({ pid: process.pid, cwd: process.cwd() }));`,
            'setInterval(() => {}, 1000);'
          ].join('\n')
        );

        const lateExternal = new AbortController();
        const adapterWithExt = new CodexAdapter({
          spawnRunner: (runnerOpts) =>
            runCodexCli({
              ...runnerOpts,
              exec: (_bin, _args, execOpts) => execCli(process.execPath, [scriptWithExt], execOpts)
            })
        });

        const withExtPromise = adapterWithExt.executeSeatProof({
          seat: { id: 'seat-timeout-with-ext', model: 'gpt-6.1-sol (high)', tools: 'read-only' },
          soul: 'pragmatist',
          round: 1,
          timeoutMs: 90,
          killGraceMs: 220,
          signal: lateExternal.signal,
          state: { topic: 'Verify timeout drain with late externalSignal', maxRounds: 2, clarifications: [], proofs: [], objections: [] }
        });

        const { pid: pidWithExt, cwd: cwdWithExt } = JSON.parse(await waitForFile(infoWithExt));
        setTimeout(() => lateExternal.abort(), 140);

        await assert.rejects(
          withExtPromise,
          (err) => err instanceof TimeoutError && !(err instanceof AbortError) && err.isRetryable === true,
          'Timeout with externalSignal aborting mid-drain must preserve first-cause TimeoutError'
        );

        assert.throws(
          () => process.kill(pidWithExt, 0),
          (killErr) => killErr && killErr.code === 'ESRCH',
          'Subprocess must already be dead (ESRCH) before TimeoutError rejects (with externalSignal)'
        );
        assert.equal(
          fs.existsSync(cwdWithExt),
          false,
          'council-seat-cwd-* must already be cleaned up before TimeoutError rejects (with externalSignal)'
        );

        // 3. Explicit abortDrainMs bounds non-cooperative fn wait on deadline timeout too
        const baseAdapter = new HarnessAdapter({ name: 'base' });
        const tBound0 = Date.now();
        await assert.rejects(
          baseAdapter.executeWithTimeout(
            () => new Promise(() => {}),
            25,
            { seatId: 's-drain-bound', model: 'm1', abortDrainMs: 30 }
          ),
          (err) => err instanceof TimeoutError && err.isRetryable === true
        );
        assert.ok(Date.now() - tBound0 < 1000, 'abortDrainMs must bound non-cooperative timeout drain');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('waits for real SIGTERM-trapping child close (ESRCH) and council-seat-cwd-* cleanup across AbortSignal.any([signal]) with killGraceMs: 600', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue90-adapter-grace600-'));
      const infoFile = path.join(tmpDir, 'child-info.json');
      const scriptFile = path.join(tmpDir, 'trap-child.cjs');
      fs.writeFileSync(
        scriptFile,
        [
          'const fs = require("node:fs");',
          'process.on("SIGTERM", () => {});',
          `fs.writeFileSync(${JSON.stringify(infoFile)}, JSON.stringify({ pid: process.pid, cwd: process.cwd() }));`,
          'setInterval(() => {}, 1000);'
        ].join('\n')
      );

      const controller = new AbortController();
      const wrappedSignal = AbortSignal.any([controller.signal]);
      const adapter = new CodexAdapter({
        spawnRunner: (runnerOpts) =>
          runCodexCli({
            ...runnerOpts,
            exec: (_bin, _args, execOpts) => execCli(process.execPath, [scriptFile], execOpts)
          })
      });

      try {
        const seatPromise = adapter.executeSeatProof({
          seat: { id: 'seat-grace', model: 'gpt-6.1-sol (high)', tools: 'read-only' },
          soul: 'pragmatist',
          round: 1,
          timeoutMs: 400, // Deliberately shorter than killGraceMs: 600 to prove first-cause latch + full drain
          killGraceMs: 600,
          signal: wrappedSignal,
          state: { topic: 'Verify 600ms SIGKILL drain', maxRounds: 2, clarifications: [], proofs: [], objections: [] }
        });

        const rawInfo = await waitForFile(infoFile);
        const { pid: childPid, cwd: childCwd } = JSON.parse(rawInfo);
        assert.match(path.basename(childCwd), /^council-seat-cwd-/);
        assert.equal(fs.existsSync(childCwd), true);

        const abortAt = Date.now();
        controller.abort();

        await assert.rejects(
          seatPromise,
          (err) => err instanceof AbortError && err.isRetryable === false
        );
        const drainElapsed = Date.now() - abortAt;

        assert.ok(
          drainElapsed >= 540,
          `Expected adapter abort to honor killGraceMs: 600 before settling, settled in ${drainElapsed}ms`
        );
        assert.throws(
          () => process.kill(childPid, 0),
          (killErr) => killErr && killErr.code === 'ESRCH'
        );
        assert.equal(fs.existsSync(childCwd), false, 'council-seat-cwd-* must be deleted before rejection');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('forwards signal across executeSeatClarification, executeSeatProof, executeJudgeAuditAndSynthesis, and executeSeatVote on all 3 live adapters', async () => {
      const specs = [
        { AdapterClass: CodexAdapter, model: 'gpt-6.1-sol (high)' },
        { AdapterClass: AntigravityAdapter, model: 'gemini-4-argon-high' },
        { AdapterClass: CursorAdapter, model: 'grok-4.7-high' }
      ];

      for (const { AdapterClass, model } of specs) {
        const phases = ['clarification', 'proof', 'judge', 'vote'];
        for (const kind of phases) {
          const controller = new AbortController();
          let observedSignal = null;

          const adapter = new AdapterClass({
            spawnRunner: async ({ signal }) => {
              observedSignal = signal;
              await new Promise((_, reject) => {
                signal.addEventListener(
                  'abort',
                  () => {
                    const err = new Error('aborted');
                    err.name = 'AbortError';
                    err.code = 'ABORT_ERR';
                    reject(err);
                  },
                  { once: true }
                );
                setTimeout(() => controller.abort(), 10);
              });
              return '';
            }
          });

          const commonState = {
            topic: 'Test cancellation propagation',
            maxRounds: 2,
            clarifications: [],
            proofs: [{ id: 'P1', status: 'admitted', statement: 's', source: 'src', scope: 'all', kind: 'check' }],
            objections: [],
            candidate: { summary: 'sum', clauses: [{ id: 'C1', context: 'ctx', conclusion: 'conc', citedProofIds: ['P1'] }] }
          };

          let callPromise;
          if (kind === 'clarification') {
            callPromise = adapter.executeSeatClarification({
              seat: { id: 'seat-1', model },
              soul: 'pragmatist',
              round: 1,
              state: commonState,
              signal: controller.signal
            });
          } else if (kind === 'proof') {
            callPromise = adapter.executeSeatProof({
              seat: { id: 'seat-1', model },
              soul: 'pragmatist',
              round: 1,
              state: commonState,
              signal: controller.signal
            });
          } else if (kind === 'judge') {
            callPromise = adapter.executeJudgeAuditAndSynthesis({
              judge: { id: 'judge-1', model },
              round: 1,
              proofs: commonState.proofs,
              state: commonState,
              signal: controller.signal
            });
          } else {
            callPromise = adapter.executeSeatVote({
              seat: { id: 'seat-1', model },
              soul: 'pragmatist',
              round: 1,
              state: commonState,
              signal: controller.signal
            });
          }

          await assert.rejects(
            callPromise,
            (err) => err instanceof AbortError && err.isRetryable === false,
            `${AdapterClass.name} ${kind} must reject with non-retryable AbortError`
          );
          assert.equal(observedSignal?.aborted, true, `${AdapterClass.name} ${kind} must propagate aborted signal`);
        }

        // Also verify executeSeatClarification parses CLEAR: / QUESTION: outputs cleanly when not aborted
        const okAdapter = new AdapterClass({
          spawnRunner: async () => 'QUESTION: What is the target Node.js runtime?'
        });
        const clarRes = await okAdapter.executeSeatClarification({
          seat: { id: 'seat-1', model },
          soul: 'pragmatist',
          round: 1,
          state: { topic: 'Clarify runtime', maxClarificationBatches: 2 }
        });
        assert.equal(clarRes.needsClarification, true);
        assert.match(clarRes.question, /target Node\.js runtime/);
      }
    });
  });

  describe('Seam B & C (Slice 3): Canonical CLI model selectors & strict objection proofId normalization', () => {
    it('parseModelAndEffort honors defaultEffort and fallbackReasoningEffort when inline effort is omitted', () => {
      assert.deepEqual(parseModelAndEffort('gpt-6.1-sol', undefined, 'low'), {
        model: 'gpt-6.1-sol',
        effort: 'low',
        codexEffort: 'low'
      });
      assert.deepEqual(parseModelAndEffort('gpt-6-astra', 'medium'), {
        model: 'gpt-6-astra',
        effort: 'medium',
        codexEffort: 'medium'
      });
    });

    it('runCodexCli emits canonical -m <gpt-6-astra|gpt-6.1-sol> and -c model_reasoning_effort even on hyphenated inputs', async () => {
      const captured = [];
      const mockExec = async (_bin, args) => {
        captured.push(args);
        return { stdout: '{"vote":"accept"}\n', stderr: '', exitCode: 0 };
      };

      await runCodexCli({ model: 'gpt-6.1-sol-low', prompt: 'p1', exec: mockExec });
      await runCodexCli({ model: 'gpt-6-astra-max', prompt: 'p2', exec: mockExec });

      assert.equal(captured[0][captured[0].indexOf('-m') + 1], 'gpt-6.1-sol');
      assert.ok(captured[0].includes('model_reasoning_effort="low"'));
      assert.equal(captured[1][captured[1].indexOf('-m') + 1], 'gpt-6-astra');
      assert.ok(captured[1].includes('model_reasoning_effort="max"'));
    });

    it('runAntigravityCli emits --model <family>-<low|medium|high> (clamping xhigh/max to high) while preserving dated/legacy strings', async () => {
      const captured = [];
      const mockExec = async (_bin, args) => {
        captured.push(args);
        return { stdout: '{"response":"ok"}', stderr: '', exitCode: 0 };
      };

      await runAntigravityCli({ model: 'gemini-4-argon (max)', prompt: 'p1', exec: mockExec });
      await runAntigravityCli({ model: 'gemini-4-carbon', context: { reasoningEffort: 'low' }, prompt: 'p2', exec: mockExec });
      await runAntigravityCli({ model: 'claude-opus-5-5-20260501', prompt: 'p3', exec: mockExec });
      await runAntigravityCli({ model: 'gemini-3.1-pro (high)', prompt: 'p4', exec: mockExec });

      assert.equal(captured[0][captured[0].indexOf('--model') + 1], 'gemini-4-argon-high');
      assert.equal(captured[0][captured[0].indexOf('--effort') + 1], 'max');

      assert.equal(captured[1][captured[1].indexOf('--model') + 1], 'gemini-4-carbon-low');
      assert.equal(captured[1][captured[1].indexOf('--effort') + 1], 'low');

      assert.equal(captured[2][captured[2].indexOf('--model') + 1], 'claude-opus-5-5-20260501');
      assert.equal(captured[3][captured[3].indexOf('--model') + 1], 'gemini-3.1-pro');
    });

    it('forwards judge.reasoningEffort, context.reasoningEffort, and top-level reasoningEffort in executeJudge and executeSeat across Codex, Antigravity, and Cursor adapters', async () => {
      const judgeJson = JSON.stringify({
        summary: 'Synthesized consensus',
        clauses: [{ id: 'C1', context: 'ctx', conclusion: 'conc', citedProofIds: ['P1'] }]
      });
      const voteJson = JSON.stringify({ vote: 'accept' });
      const proofs = [{ id: 'P1', status: 'admitted', statement: 's', source: 'src', scope: 'all', kind: 'check' }];
      const baseState = {
        topic: 'Verify judge reasoningEffort forwarding',
        maxRounds: 2,
        clarifications: [],
        proofs,
        objections: [],
        candidate: { summary: 'sum', clauses: [{ id: 'C1', context: 'ctx', conclusion: 'conc', citedProofIds: ['P1'] }] }
      };

      // 1. CodexAdapter
      const codexArgvs = [];
      const codexAdapter = new CodexAdapter({
        spawnRunner: (opts) =>
          runCodexCli({
            ...opts,
            exec: async (_bin, args) => {
              codexArgvs.push(args);
              const payload = args.some((a) => String(a).includes('JUDGE')) ? judgeJson : judgeJson;
              return {
                stdout: JSON.stringify({
                  type: 'item.completed',
                  item: { type: 'agent_message', text: codexArgvs.length === 3 ? voteJson : payload }
                }),
                stderr: '',
                exitCode: 0
              };
            }
          })
      });

      await codexAdapter.executeJudgeAuditAndSynthesis({
        judge: { id: 'judge-codex', model: 'gpt-6.1-sol', reasoningEffort: 'low', tools: 'none' },
        round: 1,
        proofs,
        state: baseState
      });
      await codexAdapter.executeJudgeAuditAndSynthesis({
        judge: { id: 'judge-codex', model: 'gpt-6.1-sol', reasoningEffort: 'low', tools: 'none' },
        reasoningEffort: 'medium',
        round: 1,
        proofs,
        state: baseState
      });
      await codexAdapter.executeSeatVote({
        seat: { id: 'seat-codex', model: 'gpt-6-astra', tools: 'none' },
        reasoningEffort: 'low',
        soul: 'pragmatist',
        round: 1,
        state: baseState
      });

      assert.equal(codexArgvs[0][codexArgvs[0].indexOf('-m') + 1], 'gpt-6.1-sol');
      assert.ok(codexArgvs[0].includes('model_reasoning_effort="low"'), `Expected low effort in ${JSON.stringify(codexArgvs[0])}`);
      assert.ok(codexArgvs[1].includes('model_reasoning_effort="medium"'), `Expected top-level medium effort override in ${JSON.stringify(codexArgvs[1])}`);
      assert.equal(codexArgvs[2][codexArgvs[2].indexOf('-m') + 1], 'gpt-6-astra');
      assert.ok(codexArgvs[2].includes('model_reasoning_effort="low"'), `Expected top-level low effort on executeSeat in ${JSON.stringify(codexArgvs[2])}`);

      // 2. AntigravityAdapter
      const agyArgvs = [];
      const agyAdapter = new AntigravityAdapter({
        spawnRunner: (opts) =>
          runAntigravityCli({
            ...opts,
            exec: async (_bin, args) => {
              agyArgvs.push(args);
              return {
                stdout: JSON.stringify({ response: agyArgvs.length === 3 ? voteJson : judgeJson }),
                stderr: '',
                exitCode: 0
              };
            }
          })
      });

      await agyAdapter.executeJudgeAuditAndSynthesis({
        judge: { id: 'judge-agy', model: 'gemini-4-argon', reasoningEffort: 'low', tools: 'none' },
        round: 1,
        proofs,
        state: baseState
      });
      await agyAdapter.executeJudgeAuditAndSynthesis({
        judge: { id: 'judge-agy', model: 'gemini-4-argon', tools: 'none' },
        context: { reasoningEffort: 'medium' },
        round: 1,
        proofs,
        state: baseState
      });
      await agyAdapter.executeSeatVote({
        seat: { id: 'seat-agy', model: 'gemini-4-carbon', tools: 'none' },
        reasoningEffort: 'low',
        soul: 'pragmatist',
        round: 1,
        state: baseState
      });

      assert.equal(agyArgvs[0][agyArgvs[0].indexOf('--model') + 1], 'gemini-4-argon-low');
      assert.equal(agyArgvs[0][agyArgvs[0].indexOf('--effort') + 1], 'low');
      assert.equal(agyArgvs[1][agyArgvs[1].indexOf('--model') + 1], 'gemini-4-argon-medium');
      assert.equal(agyArgvs[1][agyArgvs[1].indexOf('--effort') + 1], 'medium');
      assert.equal(agyArgvs[2][agyArgvs[2].indexOf('--model') + 1], 'gemini-4-carbon-low');
      assert.equal(agyArgvs[2][agyArgvs[2].indexOf('--effort') + 1], 'low');

      // 3. CursorAdapter (including composer-2.5 guard against invented reasoningEffort)
      const cursorArgvs = [];
      const cursorContexts = [];
      const cursorAdapter = new CursorAdapter({
        spawnRunner: (opts) => {
          cursorContexts.push(opts.context);
          return runCursorCli({
            ...opts,
            exec: async (_bin, args) => {
              cursorArgvs.push(args);
              return {
                stdout: `${JSON.stringify({ type: 'result', result: cursorArgvs.length === 3 ? voteJson : judgeJson })}\n`,
                stderr: '',
                exitCode: 0
              };
            }
          });
        }
      });

      await cursorAdapter.executeJudgeAuditAndSynthesis({
        judge: { id: 'judge-cursor', model: 'grok-4.7', reasoningEffort: 'low', tools: 'none' },
        round: 1,
        proofs,
        state: baseState
      });
      await cursorAdapter.executeJudgeAuditAndSynthesis({
        judge: { id: 'judge-composer', model: 'composer-2.5', reasoningEffort: 'low', tools: 'none' },
        reasoningEffort: 'low',
        round: 1,
        proofs,
        state: baseState
      });
      await cursorAdapter.executeSeatVote({
        seat: { id: 'seat-cursor', model: 'grok-4.7', tools: 'none' },
        reasoningEffort: 'medium',
        soul: 'pragmatist',
        round: 1,
        state: baseState
      });

      assert.equal(cursorArgvs[0][cursorArgvs[0].indexOf('--model') + 1], 'grok-4.7-low');
      assert.equal(cursorArgvs[1][cursorArgvs[1].indexOf('--model') + 1], 'composer-2.5');
      assert.equal(cursorContexts[1].reasoningEffort, undefined, 'composer-2.5 must not carry invented reasoningEffort');
      assert.equal(cursorArgvs[2][cursorArgvs[2].indexOf('--model') + 1], 'grok-4.7-medium');
    });

    it('normalizes non-empty string backingProof into proofId and rejects vote === "object" without non-empty string proofId or backingProof', () => {
      const adapter = new HarnessAdapter({ name: 'base' });

      const fromBacking = adapter.parseStructuredOutput(
        JSON.stringify({ vote: 'object', backingProof: '  P2  ', reason: 'Counterexample P2' }),
        'vote'
      );
      assert.equal(fromBacking.proofId, 'P2');

      assert.throws(
        () =>
          adapter.parseStructuredOutput(
            JSON.stringify({
              vote: 'object',
              backingProof: { scope: 's', kind: 'check', source: 'src', statement: 'stmt' },
              reason: 'Missing string proofId'
            }),
            'vote'
          ),
        (err) => err instanceof InvalidResponseError
      );

      assert.throws(
        () =>
          adapter.parseStructuredOutput(
            JSON.stringify({ vote: 'object', proofId: '   ', reason: 'Whitespace proofId' }),
            'vote'
          ),
        (err) => err instanceof InvalidResponseError
      );
    });
  });

  describe('Seam C (Slice 4): council-safe-cwd-* workspace copy, symlink & 0555 hygiene', () => {
    it('executes directly in explicitCwd with zero copy when .council is absent', async () => {
      const cleanRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'issue90-clean-repo-'));
      fs.writeFileSync(path.join(cleanRepo, 'README.md'), 'hello');

      try {
        const observedCwds = [];
        const mockExec = async (_bin, _args, opts) => {
          observedCwds.push(opts.cwd);
          return { stdout: '{"response":"{\\"vote\\":\\"accept\\"}"}\n', stderr: '', exitCode: 0 };
        };

        await runCodexCli({ model: 'gpt-6.1-sol (high)', prompt: 'p', cwd: cleanRepo, exec: mockExec });
        await runAntigravityCli({ model: 'gemini-4-argon-high', prompt: 'p', cwd: cleanRepo, exec: mockExec });
        await runCursorCli({ model: 'grok-4.7-high', prompt: 'p', cwd: cleanRepo, exec: mockExec });

        for (const seen of observedCwds) {
          assert.equal(seen, cleanRepo);
        }
      } finally {
        fs.rmSync(cleanRepo, { recursive: true, force: true });
      }
    });

    it('isolates into council-safe-cwd-* when .council exists, omits .council/node_modules/broken/escaping symlinks, remaps internal symlinks, preserves source 0555 mode, and cleans up on exit and abort', async () => {
      const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue90-dotcouncil-repo-'));
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue90-outside-'));
      fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'outside-secret');

      fs.mkdirSync(path.join(repoDir, '.council', 'runs'), { recursive: true });
      fs.writeFileSync(path.join(repoDir, '.council', 'runs', 'state.json'), '{"secret":true}');
      fs.mkdirSync(path.join(repoDir, 'node_modules', 'pkg'), { recursive: true });
      fs.writeFileSync(path.join(repoDir, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;');

      fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(repoDir, 'src', 'app.js'), 'export const x = 42;');
      fs.mkdirSync(path.join(repoDir, '..assets'), { recursive: true });
      fs.writeFileSync(path.join(repoDir, '..assets', 'a.js'), 'export const asset = 1;');
      // Internal safe symlink + internal ..assets symlink
      fs.symlinkSync(path.join(repoDir, 'src', 'app.js'), path.join(repoDir, 'app-link.js'));
      fs.symlinkSync(path.join(repoDir, '..assets', 'a.js'), path.join(repoDir, 'dotdot-asset-link.js'));
      // Broken symlink
      fs.symlinkSync(path.join(repoDir, 'does-not-exist.txt'), path.join(repoDir, 'broken-link.txt'));
      // Workspace-escaping symlink
      fs.symlinkSync(path.join(outsideDir, 'secret.txt'), path.join(repoDir, 'escape-link.txt'));
      // Symlink pointing into .council
      fs.symlinkSync(path.join(repoDir, '.council', 'runs', 'state.json'), path.join(repoDir, 'council-link.json'));

      // Read-only 0555 directory containing a file
      const roDir = path.join(repoDir, 'readonly-dir');
      fs.mkdirSync(roDir);
      fs.writeFileSync(path.join(roDir, 'info.txt'), 'readonly-info');
      fs.chmodSync(roDir, 0o555);

      let capturedSafeCwd = null;

      try {
        await runCodexCli({
          model: 'gpt-6.1-sol (high)',
          prompt: 'inspect',
          cwd: repoDir,
          exec: async (_bin, _args, opts) => {
            capturedSafeCwd = opts.cwd;
            assert.notEqual(fs.realpathSync(opts.cwd), fs.realpathSync(repoDir));
            assert.match(path.basename(opts.cwd), /^council-safe-cwd-/);

            assert.equal(fs.existsSync(path.join(opts.cwd, '.council')), false);
            assert.equal(fs.existsSync(path.join(opts.cwd, 'node_modules')), false);
            assert.equal(fs.existsSync(path.join(opts.cwd, 'src', 'app.js')), true);
            assert.equal(fs.existsSync(path.join(opts.cwd, 'readonly-dir', 'info.txt')), true);

            // Broken, escaping, and .council-targeting symlinks must be omitted
            assert.throws(() => fs.lstatSync(path.join(opts.cwd, 'broken-link.txt')));
            assert.throws(() => fs.lstatSync(path.join(opts.cwd, 'escape-link.txt')));
            assert.throws(() => fs.lstatSync(path.join(opts.cwd, 'council-link.json')));

            // Internal symlink must remain a symlink and resolve inside opts.cwd, NOT repoDir
            const linkStat = fs.lstatSync(path.join(opts.cwd, 'app-link.js'));
            assert.equal(linkStat.isSymbolicLink(), true);
            const resolvedLink = fs.realpathSync(path.join(opts.cwd, 'app-link.js'));
            assert.equal(resolvedLink, path.join(fs.realpathSync(opts.cwd), 'src', 'app.js'));

            // Internal symlink targeting a valid ..assets entry inside workspace must also be preserved and remapped
            const dotdotLinkStat = fs.lstatSync(path.join(opts.cwd, 'dotdot-asset-link.js'));
            assert.equal(dotdotLinkStat.isSymbolicLink(), true);
            assert.equal(
              fs.realpathSync(path.join(opts.cwd, 'dotdot-asset-link.js')),
              path.join(fs.realpathSync(opts.cwd), '..assets', 'a.js')
            );

            // Source 0555 directory permissions must NOT be mutated
            assert.equal(fs.statSync(roDir).mode & 0o777, 0o555);
            // Copy's readonly-dir must be 0700 (owner-writable) in temp copy per spec
            assert.equal(fs.statSync(path.join(opts.cwd, 'readonly-dir')).mode & 0o777, 0o700);

            return { stdout: '{"vote":"accept"}\n', stderr: '', exitCode: 0 };
          }
        });

        assert.ok(capturedSafeCwd);
        assert.equal(fs.existsSync(capturedSafeCwd), false, 'Temp safe cwd must be removed after normal exit');
        assert.equal(fs.statSync(roDir).mode & 0o777, 0o555, 'Original 0555 mode must remain intact');

        // Also verify temp copy cleanup when aborted via SIGKILL escalation on real subprocess
        const abortController = new AbortController();
        const pidMarker = path.join(outsideDir, 'abort-child.pid');
        let abortCwdSeen = null;

        const abortRunPromise = runAntigravityCli({
          executable: process.execPath,
          model: 'gemini-4-argon-high',
          prompt: 'test',
          cwd: repoDir,
          signal: abortController.signal,
          exec: ( _bin, _args, opts) => {
            abortCwdSeen = opts.cwd;
            const trapScript = [
              'const fs = require("node:fs");',
              'process.on("SIGTERM", () => {});',
              `fs.writeFileSync(${JSON.stringify(pidMarker)}, String(process.pid));`,
              'setInterval(() => {}, 1000);'
            ].join(' ');
            return execCli(process.execPath, ['-e', trapScript], {
              ...opts,
              killGraceMs: 60
            });
          }
        });

        const childPid = Number(await waitForFile(pidMarker));
        abortController.abort();

        await assert.rejects(abortRunPromise, (err) => err.code === 'ABORT_ERR');
        assert.throws(() => process.kill(childPid, 0), (e) => e.code === 'ESRCH');
        assert.ok(abortCwdSeen);
        assert.equal(fs.existsSync(abortCwdSeen), false, 'Temp safe cwd must be cleaned up after SIGKILL abort');
      } finally {
        try {
          fs.chmodSync(roDir, 0o755);
        } catch {
          // ignore
        }
        fs.rmSync(repoDir, { recursive: true, force: true });
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it('isolates when .council is a file or symlink and fails closed if workspace copy encounters an unreadable file', async () => {
      const fileDotCouncilRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'issue90-file-dotcouncil-'));
      fs.writeFileSync(path.join(fileDotCouncilRepo, '.council'), 'marker-file');
      fs.writeFileSync(path.join(fileDotCouncilRepo, 'ok.txt'), 'ok');

      try {
        let usedCwd = null;
        await runCursorCli({
          model: 'grok-4.7-high',
          prompt: 'p',
          cwd: fileDotCouncilRepo,
          exec: async (_bin, _args, opts) => {
            usedCwd = opts.cwd;
            assert.match(path.basename(opts.cwd), /^council-safe-cwd-/);
            assert.equal(fs.existsSync(path.join(opts.cwd, '.council')), false);
            return { stdout: '{"type":"result","result":"ok"}\n', stderr: '', exitCode: 0 };
          }
        });
        assert.equal(fs.existsSync(usedCwd), false);

        // Unreadable file (0000) causes copy to fail closed without spawning exec and cleans up partial council-safe-cwd-*
        if (typeof process.getuid === 'function' && process.getuid() !== 0) {
          const secretUnreadable = path.join(fileDotCouncilRepo, 'unreadable.bin');
          fs.writeFileSync(secretUnreadable, 'cannot-read');
          fs.chmodSync(secretUnreadable, 0o000);
          const beforeTmp = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('council-safe-cwd-')));
          let spawned = false;
          try {
            await assert.rejects(
              runCodexCli({
                model: 'gpt-6.1-sol (high)',
                prompt: 'p',
                cwd: fileDotCouncilRepo,
                exec: async () => {
                  spawned = true;
                  return { stdout: '{}', stderr: '', exitCode: 0 };
                }
              })
            );
            assert.equal(spawned, false, 'Must fail closed without spawning CLI when copy fails');
            const afterTmp = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('council-safe-cwd-') && !beforeTmp.has(n));
            assert.deepEqual(afterTmp, [], 'Partial council-safe-cwd-* directory must be cleaned up on copy failure');
          } finally {
            fs.chmodSync(secretUnreadable, 0o600);
          }
        }
      } finally {
        fs.rmSync(fileDotCouncilRepo, { recursive: true, force: true });
      }
    });

    it('surfaces non-ENOENT cleanupTempWorkspace errors on success while ignoring ENOENT and preserving primary execution errors', async () => {
      const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue90-cleanup-err-repo-'));
      fs.mkdirSync(path.join(repoDir, '.council'), { recursive: true });
      fs.writeFileSync(path.join(repoDir, 'index.js'), 'export default 1;\n');

      const origRmSync = fs.rmSync;
      const origChmodSync = fs.chmodSync;
      const leakedTempDirs = new Set();

      try {
        // 1. EBUSY from rmSync during cleanup after successful CLI runs must reject across all 3 runners (incl. Cursor fallback)
        fs.rmSync = (targetPath, opts) => {
          if (typeof targetPath === 'string' && path.basename(targetPath).startsWith('council-safe-cwd-')) {
            leakedTempDirs.add(targetPath);
            const busyErr = new Error(`EBUSY: resource busy or locked, rmdir '${targetPath}'`);
            busyErr.code = 'EBUSY';
            throw busyErr;
          }
          return origRmSync(targetPath, opts);
        };

        await assert.rejects(
          runCodexCli({
            model: 'gpt-6.1-sol (high)',
            prompt: 'p',
            cwd: repoDir,
            exec: async () => ({ stdout: '{"vote":"accept"}\n', stderr: '', exitCode: 0 })
          }),
          (err) => err && err.code === 'EBUSY'
        );

        await assert.rejects(
          runAntigravityCli({
            model: 'gemini-4-argon-high',
            prompt: 'p',
            cwd: repoDir,
            exec: async () => ({ stdout: '{"response":"ok"}\n', stderr: '', exitCode: 0 })
          }),
          (err) => err && err.code === 'EBUSY'
        );

        await assert.rejects(
          runCursorCli({
            executable: 'cursor-agent',
            model: 'grok-4.7-high',
            prompt: 'p',
            cwd: repoDir,
            exec: async (bin) => {
              if (bin === 'cursor-agent') {
                const enoent = new Error('spawn cursor-agent ENOENT');
                enoent.code = 'ENOENT';
                throw enoent;
              }
              return { stdout: '{"type":"result","result":"ok"}\n', stderr: '', exitCode: 0 };
            }
          }),
          (err) => err && err.code === 'EBUSY'
        );

        // 2. Primary execution failure must NOT be masked when cleanup ALSO throws EBUSY
        await assert.rejects(
          runCodexCli({
            model: 'gpt-6.1-sol (high)',
            prompt: 'p',
            cwd: repoDir,
            exec: async () => {
              const execErr = new Error('CLI crashed');
              execErr.exitCode = 42;
              throw execErr;
            }
          }),
          (err) => err && err.exitCode === 42 && err.code !== 'EBUSY'
        );

        // 3. EPERM from chmodSync inside makeTempDirsWritableForCleanup on success must also reject
        fs.rmSync = origRmSync;
        let triggerChmodFailure = false;
        fs.chmodSync = (targetPath, mode) => {
          if (
            triggerChmodFailure &&
            typeof targetPath === 'string' &&
            path.basename(targetPath).startsWith('council-seat-cwd-')
          ) {
            leakedTempDirs.add(targetPath);
            const permErr = new Error(`EPERM: operation not permitted, chmod '${targetPath}'`);
            permErr.code = 'EPERM';
            throw permErr;
          }
          return origChmodSync(targetPath, mode);
        };

        await assert.rejects(
          runCodexCli({
            model: 'gpt-6.1-sol (high)',
            prompt: 'p',
            tools: 'none',
            exec: async (_bin, _args, opts) => {
              leakedTempDirs.add(opts.cwd);
              triggerChmodFailure = true;
              return { stdout: '{"vote":"accept"}\n', stderr: '', exitCode: 0 };
            }
          }),
          (err) => err && err.code === 'EPERM'
        );

        // 4. ENOENT (already removed directory) during cleanup must still resolve cleanly
        fs.chmodSync = origChmodSync;
        const okText = await runCodexCli({
          model: 'gpt-6.1-sol (high)',
          prompt: 'p',
          tools: 'none',
          exec: async (_bin, _args, opts) => {
            origRmSync(opts.cwd, { recursive: true, force: true });
            return { stdout: '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n', stderr: '', exitCode: 0 };
          }
        });
        assert.equal(okText, 'ok');
      } finally {
        fs.rmSync = origRmSync;
        fs.chmodSync = origChmodSync;
        for (const dir of leakedTempDirs) {
          origRmSync(dir, { recursive: true, force: true });
        }
        origRmSync(repoDir, { recursive: true, force: true });
      }
    });
  });

  describe('Seam C (Slice 5): Closed linear-time O(n) lexical trace detector', () => {
    it('enforces 262,144-byte per-field UTF-8 scan cap (<100ms) and completes 20-nested-loop / delimiter strings in <50ms', () => {
      const padding256k = 'a'.repeat(262_144);
      const overCapInput = `${padding256k} cat .council/runs/secret.json`;

      const tCap0 = performance.now();
      const capRes = detectForbiddenCouncilAccess([
        { name: 'bash', input: { command: overCapInput } }
      ]);
      const capElapsedMs = performance.now() - tCap0;

      assert.equal(capRes.forbiddenStateAccess, false, 'Bytes past 262,144 cap in a single field must not be scanned');
      assert.ok(capElapsedMs < 100, `Expected 262,144-byte scan <100ms, got ${capElapsedMs.toFixed(2)}ms`);

      // Multi-byte UTF-8 (2 bytes per char -> 131,072 chars === 262,144 UTF-8 bytes) caps at 262,144 UTF-8 bytes
      const utf8Padding256k = 'é'.repeat(131_072);
      const utf8OverCapRes = detectForbiddenCouncilAccess([
        { name: 'bash', input: { command: `${utf8Padding256k} cat .council/runs/secret.json` } }
      ]);
      assert.equal(utf8OverCapRes.forbiddenStateAccess, false, 'Multi-byte UTF-8 past 262,144 bytes must not be scanned');

      // Per-field cap: a 262,144-byte benign first tool call must NOT blind detection on a second tool call
      const multiCallRes = detectForbiddenCouncilAccess([
        { name: 'bash', input: { command: padding256k } },
        { name: 'bash', input: { command: 'cat .council/runs/secret.json' } }
      ]);
      assert.equal(multiCallRes.forbiddenStateAccess, true, 'Large benign field must not blind subsequent tool-call inspection');

      // Adversarial 262,144-byte metacharacter and quote inputs must stay linear (<100ms)
      for (const ch of ['[', '*', '{']) {
        const meta256k = ch.repeat(262_144);
        const tMeta0 = performance.now();
        const metaRes = detectForbiddenCouncilAccess([
          { name: 'bash', input: { command: meta256k } }
        ]);
        const metaElapsedMs = performance.now() - tMeta0;
        assert.equal(metaRes.forbiddenStateAccess, false);
        assert.ok(metaElapsedMs < 100, `Expected 256KiB '${ch}' scan <100ms, got ${metaElapsedMs.toFixed(2)}ms`);
      }

      for (const quoteAdv of [
        `/${"$'".repeat(131_071)}`,
        `/${'"'.repeat(262_143)}`,
        `/${"'/a'".repeat(65_535)}`
      ]) {
        const tQ0 = performance.now();
        const qRes = detectForbiddenCouncilAccess(
          [{ name: 'bash', input: { command: quoteAdv } }],
          null,
          { forbiddenWorkspaceRoots: ['/tmp/repo'] }
        );
        const qElapsedMs = performance.now() - tQ0;
        assert.equal(qRes.forbiddenStateAccess, false);
        assert.ok(qElapsedMs < 100, `Expected 256KiB quote scan <100ms, got ${qElapsedMs.toFixed(2)}ms`);
      }

      const nestedLoops = `${'for i in 1 2; do '.repeat(20)}echo safe_command_arg; ${'done; '.repeat(20)} ${'('.repeat(20)}echo ok${')'.repeat(20)} ${'@('.repeat(20)}foo|bar${')'.repeat(20)}`;
      const tLoop0 = performance.now();
      const loopRes = detectForbiddenCouncilAccess([
        { name: 'bash', input: { command: nestedLoops } }
      ]);
      const loopElapsedMs = performance.now() - tLoop0;

      assert.equal(loopRes.forbiddenStateAccess, false);
      assert.ok(loopElapsedMs < 50, `Expected 20-nested-loop scan <50ms, got ${loopElapsedMs.toFixed(2)}ms`);
    });

    it('keeps find exclusion stripping linear (<100ms) on 262,144-byte repeated -path commands and large argv arrays', () => {
      const repeatedFindPath = `find ${'-path x '.repeat(33_000)}`.slice(0, 262_144);
      const tFind0 = performance.now();
      const findRes = detectForbiddenCouncilAccess([
        { name: 'bash', input: { command: repeatedFindPath } }
      ]);
      const findElapsedMs = performance.now() - tFind0;
      assert.equal(findRes.forbiddenStateAccess, false);
      assert.ok(
        findElapsedMs < 100,
        `Expected 262,144-byte find -path scan <100ms, got ${findElapsedMs.toFixed(2)}ms`
      );

      const repeatedParenFind = `find \\( ${'-path x -o '.repeat(24_000)}`.slice(0, 262_144);
      const tParen0 = performance.now();
      const parenRes = detectForbiddenCouncilAccess([
        { name: 'bash', input: { command: repeatedParenFind } }
      ]);
      const parenElapsedMs = performance.now() - tParen0;
      assert.equal(parenRes.forbiddenStateAccess, false);
      assert.ok(
        parenElapsedMs < 100,
        `Expected 262,144-byte find paren -path scan <100ms, got ${parenElapsedMs.toFixed(2)}ms`
      );

      const largeFindArgv = ['find', '.'];
      for (let i = 0; i < 10_000; i += 1) {
        largeFindArgv.push('-path', 'x');
      }
      const tArgv0 = performance.now();
      const argvRes = detectForbiddenCouncilAccess([
        { name: 'exec', args: { argv: largeFindArgv } }
      ]);
      const argvElapsedMs = performance.now() - tArgv0;
      assert.equal(argvRes.forbiddenStateAccess, false);
      assert.ok(
        argvElapsedMs < 100,
        `Expected large find argv scan <100ms, got ${argvElapsedMs.toFixed(2)}ms`
      );
    });

    it('detects literal .council and one-shot base64 / printf octal .council tokens across Codex, Cursor, and Antigravity traces', async () => {
      const b64Council = Buffer.from('.council/runs/latest.json', 'utf8').toString('base64');
      const octalCouncil = "printf '\\056\\143\\157\\165\\156\\143\\151\\154/runs'";

      // Codex JSONL stream with base64 token
      const codexStream = [
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'command_execution', command: `echo ${b64Council} | base64 -d`, exit_code: 0 }
        }),
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: '{"vote":"accept"}' }
        })
      ].join('\n');
      const codexParsed = parseCodexEventStream(codexStream);
      assert.equal(codexParsed.forbiddenStateAccess, true);

      // Cursor stream-json with printf octal token
      const cursorStream = [
        JSON.stringify({
          type: 'tool_call',
          subtype: 'completed',
          tool_call: { shellToolCall: { args: { command: octalCouncil } } }
        }),
        JSON.stringify({ type: 'result', result: '{"vote":"accept"}' })
      ].join('\n');
      const cursorParsed = parseCursorEventStream(cursorStream);
      assert.equal(cursorParsed.forbiddenStateAccess, true);

      // Antigravity JSON envelope with toolCalls containing octal .council
      await assert.rejects(
        runAntigravityCli({
          model: 'gemini-4-argon-high',
          prompt: 'audit',
          exec: async () => ({
            stdout: JSON.stringify({
              response: '{"vote":"accept"}',
              toolCalls: [{ name: 'run_command', input: { command: "cat $'\\056council/latest.js'" } }]
            }),
            stderr: '',
            exitCode: 0
          })
        }),
        (err) => err.code === 'FORBIDDEN_STATE_ACCESS'
      );

      // Base64 payload after >1,024 benign base64-like tokens (>128 decoded) within 262,144 bytes must still be caught
      const tailB64 = Buffer.from('.council/runs/state.json', 'utf8').toString('base64');
      const manyPrefixTokensCmd = `${'QUFBQUFB '.repeat(1200)}${tailB64}`;
      const manyPrefixRes = detectForbiddenCouncilAccess([
        { name: 'bash', input: { command: manyPrefixTokensCmd } }
      ]);
      assert.equal(
        manyPrefixRes.forbiddenStateAccess,
        true,
        'Base64 forbidden path after >1,024 benign base64-like tokens within 262,144 bytes must be detected'
      );

      // Single base64 token >512 chars encoding a path targeting .council must still be caught
      const longSingleB64 = Buffer.from(`${'src/'.repeat(120)}.council/runs/state.json`, 'utf8').toString('base64');
      assert.ok(longSingleB64.length > 512);
      const longB64Res = detectForbiddenCouncilAccess([
        { name: 'bash', input: { command: `echo ${longSingleB64} | base64 -d` } }
      ]);
      assert.equal(
        longB64Res.forbiddenStateAccess,
        true,
        'Base64 token >512 chars within 262,144-byte cap must be detected'
      );

      // Non-ASCII valid UTF-8 base64 paths (.council/café.json and non-ASCII forbiddenWorkspaceRoots) must be detected
      const utf8CouncilB64 = Buffer.from('.council/café.json', 'utf8').toString('base64');
      const utf8CouncilRes = detectForbiddenCouncilAccess([
        { name: 'bash', input: { command: `echo ${utf8CouncilB64} | base64 -d` } }
      ]);
      assert.equal(
        utf8CouncilRes.forbiddenStateAccess,
        true,
        'Base64 valid non-ASCII UTF-8 .council/café.json path must be detected'
      );

      const utf8Root = '/Users/alexandré/repo';
      const utf8RootB64 = Buffer.from(`${utf8Root}/src/index.js`, 'utf8').toString('base64');
      const utf8RootRes = detectForbiddenCouncilAccess(
        [{ name: 'bash', input: { command: `echo ${utf8RootB64} | base64 -d` } }],
        null,
        { forbiddenWorkspaceRoots: [utf8Root] }
      );
      assert.equal(
        utf8RootRes.forbiddenStateAccess,
        true,
        'Base64 valid non-ASCII UTF-8 forbiddenWorkspaceRoots path must be detected'
      );

      // Dense 262,144-byte benign base64-like stream must stay linear (<100ms)
      const denseBenignB64 = 'YS9iLmNk '.repeat(29_128).slice(0, 262_144);
      const tDense0 = performance.now();
      const denseRes = detectForbiddenCouncilAccess(
        [{ name: 'bash', input: { command: denseBenignB64 } }],
        null,
        { forbiddenWorkspaceRoots: ['/tmp/forbidden-root'] }
      );
      const denseElapsedMs = performance.now() - tDense0;
      assert.equal(denseRes.forbiddenStateAccess, false);
      assert.ok(
        denseElapsedMs < 100,
        `Expected dense 262,144-byte base64 scan <100ms, got ${denseElapsedMs.toFixed(2)}ms`
      );

      // Dense 262,144-byte invalid-UTF-8 base64 stream ('////////') must also stay non-throwing and <100ms
      const denseInvalidUtf8B64 = '//////// '.repeat(29_128).slice(0, 262_144);
      const tInvalid0 = performance.now();
      const invalidRes = detectForbiddenCouncilAccess(
        [{ name: 'bash', input: { command: denseInvalidUtf8B64 } }],
        null,
        { forbiddenWorkspaceRoots: ['/tmp/forbidden-root'] }
      );
      const invalidElapsedMs = performance.now() - tInvalid0;
      assert.equal(invalidRes.forbiddenStateAccess, false);
      assert.ok(
        invalidElapsedMs < 100,
        `Expected dense 262,144-byte invalid-UTF-8 base64 scan <100ms, got ${invalidElapsedMs.toFixed(2)}ms`
      );
    });

    it('detects normalized explicitCwd and realpath(explicitCwd) across token forms without false-positiving on sibling paths', async () => {
      const baseTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'issue90-root-detect-'));
      const realRepo = path.join(baseTmp, 'real-repo');
      const symlinkRepo = path.join(baseTmp, 'alias-repo');
      fs.mkdirSync(path.join(realRepo, '.council'), { recursive: true });
      fs.writeFileSync(path.join(realRepo, 'index.js'), 'export default 1;');
      fs.symlinkSync(realRepo, symlinkRepo);

      const resolvedAlias = path.resolve(symlinkRepo);
      const resolvedReal = fs.realpathSync(symlinkRepo);
      const roots = [resolvedAlias, resolvedReal];

      try {
        const positiveCommands = [
          `ls ${resolvedAlias}`,
          `cat "${resolvedReal}/src/../index.js"`,
          `TARGET=${resolvedAlias}/index.js node -e "1"`,
          `git -C${resolvedReal} status`,
          `rg --dir=${resolvedAlias} pattern`,
          `curl file://${encodeURI(resolvedReal)}/index.js`
        ];

        for (const cmd of positiveCommands) {
          const res = detectForbiddenCouncilAccess(
            [{ name: 'bash', input: { command: cmd } }],
            null,
            { forbiddenWorkspaceRoots: roots }
          );
          assert.equal(res.forbiddenStateAccess, true, `Expected forbidden root match for: ${cmd}`);
        }

        const negativeCommands = [
          `ls /archive${resolvedReal}`,
          `ls ${resolvedReal}+backup`,
          `ls ${resolvedReal},old`,
          `ls ${resolvedAlias}+worktree`,
          `ls ${resolvedAlias},bak`
        ];

        for (const cmd of negativeCommands) {
          const res = detectForbiddenCouncilAccess(
            [{ name: 'bash', input: { command: cmd } }],
            null,
            { forbiddenWorkspaceRoots: roots }
          );
          assert.equal(res.forbiddenStateAccess, false, `Must NOT false-positive on sibling path: ${cmd}`);
        }

        const fixedQuotedRoot = ['/tmp/repo'];
        const quotedSiblingNegatives = [
          'cat "/tmp/repo backup"',
          "cat '/tmp/repo backup'",
          'cat "/tmp/repo)"',
          'cat "/tmp/repo}"',
          'cat "/tmp/repo]"',
          'cat "/tmp/repo "',
          'rg --dir="/tmp/repo backup" pat',
          'git -C"/tmp/repo backup" status',
          'TARGET="/tmp/repo backup" node -e 1',
          "cat $'/tmp/repo\\040backup'",
          "printf '/tmp/repo\\040backup'",
          'echo -e "/tmp/repo\\x20backup"'
        ];
        for (const cmd of quotedSiblingNegatives) {
          const res = detectForbiddenCouncilAccess(
            [{ name: 'bash', input: { command: cmd } }],
            null,
            { forbiddenWorkspaceRoots: fixedQuotedRoot }
          );
          assert.equal(
            res.forbiddenStateAccess,
            false,
            `Must NOT false-positive on quoted/escaped sibling path: ${cmd}`
          );
        }

        const quotedRootPositives = [
          'cat "/tmp/repo"',
          "cat '/tmp/repo'",
          'cat "/tmp/repo/file"',
          'rg --dir="/tmp/repo/file" pat',
          'git -C"/tmp/repo" status',
          'TARGET="/tmp/repo/index.js" node -e 1',
          '(cat /tmp/repo)',
          'cat {/tmp/repo}',
          'cat [/tmp/repo/file]',
          "cat $'/tmp/repo\\057file'",
          "printf '/tmp/repo\\057file'",
          'echo -e "/tmp/repo\\x2ffile"',
          "# don't skip\ncat /tmp/repo/file"
        ];
        for (const cmd of quotedRootPositives) {
          const res = detectForbiddenCouncilAccess(
            [{ name: 'bash', input: { command: cmd } }],
            null,
            { forbiddenWorkspaceRoots: fixedQuotedRoot }
          );
          assert.equal(
            res.forbiddenStateAccess,
            true,
            `Expected forbidden root match for quoted/grouped form: ${cmd}`
          );
        }

        const winRoots = ['C:\\work\\repo'];
        for (const winCmd of [
          'type C:\\work\\repo\\sub\\..\\index.js',
          'git -CC:\\work\\repo status',
          'rg --dir=c:\\work\\repo pattern',
          'curl file:///c:/work/repo/sub/../index.js',
          'curl file://localhost/C:/work/repo/index.js'
        ]) {
          const winRes = detectForbiddenCouncilAccess(
            [{ name: 'bash', input: { command: winCmd } }],
            null,
            { forbiddenWorkspaceRoots: winRoots }
          );
          assert.equal(winRes.forbiddenStateAccess, true, `Expected win32 root match for: ${winCmd}`);
        }

        for (const winSafeCmd of [
          'dir C:\\archive\\work\\repo',
          'dir C:\\work\\repo+backup',
          'dir C:\\work\\repo,old'
        ]) {
          const winSafeRes = detectForbiddenCouncilAccess(
            [{ name: 'bash', input: { command: winSafeCmd } }],
            null,
            { forbiddenWorkspaceRoots: winRoots }
          );
          assert.equal(winSafeRes.forbiddenStateAccess, false, `Must NOT false-positive on win32 sibling path: ${winSafeCmd}`);
        }

        // End-to-end runner check: when symlinkRepo has .council, runCodexCli isolates to council-safe-cwd-*
        // and rejects any tool call referencing either symlinkRepo or realRepo with FORBIDDEN_STATE_ACCESS.
        await assert.rejects(
          runCodexCli({
            model: 'gpt-6.1-sol (high)',
            prompt: 'inspect',
            cwd: symlinkRepo,
            exec: async () => ({
              stdout: [
                JSON.stringify({
                  type: 'item.completed',
                  item: { type: 'command_execution', command: `git -C${resolvedReal} log -n 1`, exit_code: 0 }
                }),
                JSON.stringify({
                  type: 'item.completed',
                  item: { type: 'agent_message', text: '{"vote":"accept"}' }
                })
              ].join('\n'),
              stderr: '',
              exitCode: 0
            })
          }),
          (err) => err.code === 'FORBIDDEN_STATE_ACCESS'
        );
      } finally {
        fs.rmSync(baseTmp, { recursive: true, force: true });
      }
    });
  });
});
