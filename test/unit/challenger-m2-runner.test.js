/**
 * @fileoverview Adversarial Stress Test Suite — Challenger M2-1 (CLI Runner Robustness & Error Handling)
 * Empirically challenges:
 * 1. parseModelAndEffort: unusual inputs, spaces, multiple parentheses, missing effort, invalid types, casing
 * 2. execCli: abort signals (immediate vs delayed), timeouts, non-zero exits, large buffers, special characters
 * 3. Provider dispatchers: invalid JSON responses, ENOENT fallback on cursor-agent vs agent, model argument propagation
 * 4. Error classification: verify errors thrown by execCli and dispatchers are classified by HarnessAdapter.classifyError
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseModelAndEffort,
  execCli,
  runAntigravityCli,
  runCodexCli,
  runCursorCli
} from '../../src/harness/cli-runner.js';
import {
  HarnessAdapter,
  HarnessError,
  QuotaExhaustionError,
  TimeoutError,
  HarnessExecutionError,
  InvalidResponseError
} from '../../src/harness/adapter.js';
import { AntigravityAdapter } from '../../src/harness/antigravity.js';
import { CodexAdapter } from '../../src/harness/codex.js';
import { CursorAdapter } from '../../src/harness/cursor.js';

describe('Adversarial Stress: Milestone 2 CLI Runner & Adapter Robustness', () => {

  // ==========================================================================
  // SECTION 1: parseModelAndEffort Edge Cases & Stress
  // ==========================================================================
  describe('1. parseModelAndEffort Edge Cases & Type Stress', () => {

    it('rejects invalid types: null, undefined, numbers, booleans, objects, arrays, symbols, functions', () => {
      const invalidInputs = [
        null,
        undefined,
        0,
        123,
        -1,
        NaN,
        true,
        false,
        {},
        { model: 'gpt-6' },
        [],
        ['gpt-6'],
        Symbol('model'),
        () => 'gpt-6'
      ];

      for (const input of invalidInputs) {
        assert.throws(
          () => parseModelAndEffort(input),
          /modelString must be a non-empty string/,
          `Should reject type ${typeof input}`
        );
      }
    });

    it('rejects empty or whitespace-only strings', () => {
      const emptyStrings = ['', ' ', '   ', '\t', '\n', '\r\n', '  \t  \n  '];
      for (const str of emptyStrings) {
        assert.throws(
          () => parseModelAndEffort(str),
          /modelString must be a non-empty string/
        );
      }
    });

    it('handles extreme whitespace around and inside parentheses', () => {
      const res = parseModelAndEffort('   gpt-6-astra   (   max   )   ');
      assert.deepEqual(res, {
        model: 'gpt-6-astra',
        effort: 'max',
        codexEffort: 'max'
      });

      const res2 = parseModelAndEffort('\tgpt-6.1-sol\t(\tHIGH\t)\n');
      assert.deepEqual(res2, {
        model: 'gpt-6.1-sol',
        effort: 'high',
        codexEffort: 'high'
      });
    });

    it('handles uppercase and mixed-case effort and model strings', () => {
      const res1 = parseModelAndEffort('GPT-6-ASTRA (MAX)');
      assert.equal(res1.model, 'GPT-6-ASTRA');
      assert.equal(res1.effort, 'max');
      assert.equal(res1.codexEffort, 'max');

      const res2 = parseModelAndEffort('gemini-4-argon-HIGH');
      assert.equal(res2.model, 'gemini-4-argon-HIGH');
      assert.equal(res2.effort, 'high');
      assert.equal(res2.codexEffort, 'high');

      const res3 = parseModelAndEffort('grok-4.7-XHIGH');
      assert.equal(res3.model, 'grok-4.7-XHIGH');
      assert.equal(res3.effort, 'xhigh');
      assert.equal(res3.codexEffort, 'xhigh');

      const res4 = parseModelAndEffort('claude-opus-5-5-LOW');
      assert.equal(res4.model, 'claude-opus-5-5-LOW');
      assert.equal(res4.effort, 'low');
      assert.equal(res4.codexEffort, 'low');
    });

    it('handles multiple or nested parentheses gracefully', () => {
      // Model with version in paren followed by effort in paren
      // e.g. "model (v1) (max)" does not match single parenMatch, falls back safely
      const res = parseModelAndEffort('custom-model (v1) (max)');
      assert.equal(res.model, 'custom-model (v1) (max)');
      assert.equal(res.effort, 'high');
      assert.equal(res.codexEffort, 'high');

      // Nested parentheses "model ((max))" falls back safely to default effort
      const resNested = parseModelAndEffort('model ((max))');
      assert.equal(resNested.model, 'model ((max))');
      assert.equal(resNested.effort, 'high');
      assert.equal(resNested.codexEffort, 'high');
    });

    it('handles empty or whitespace-only parentheses', () => {
      // Empty parenthesis "model ()" does not match regex with [^)]+, falls back to default
      const resEmpty = parseModelAndEffort('model ()');
      assert.equal(resEmpty.model, 'model ()');
      assert.equal(resEmpty.effort, 'high');
      assert.equal(resEmpty.codexEffort, 'high');

      // Whitespace parenthesis "model (   )"
      const resSpace = parseModelAndEffort('model (   )');
      assert.equal(resSpace.model, 'model');
      assert.equal(resSpace.effort, '');
      assert.equal(resSpace.codexEffort, 'high');
    });

    it('rejects unrecognized or custom effort strings with descriptive configuration error', () => {
      assert.throws(
        () => parseModelAndEffort('custom-model (ultra)'),
        /Unsupported reasoning effort "ultra"\. Allowed: /i
      );
    });

    it('respects defaultEffort parameter variations', () => {
      const res1 = parseModelAndEffort('plain-model', 'low');
      assert.deepEqual(res1, {
        model: 'plain-model',
        effort: 'low',
        codexEffort: 'low'
      });

      const res2 = parseModelAndEffort('plain-model', 'MAX');
      assert.deepEqual(res2, {
        model: 'plain-model',
        effort: 'max',
        codexEffort: 'max'
      });

      // When unrecognized effort is in paren, rejects with error even if defaultEffort is provided
      assert.throws(
        () => parseModelAndEffort('plain-model (unknown)', 'medium'),
        /Unsupported reasoning effort "unknown"\. Allowed: /i
      );
    });

    it('does not false-positive match hyphenated suffixes without hyphens', () => {
      const res1 = parseModelAndEffort('modelmax');
      assert.equal(res1.effort, 'high'); // Fallback, not 'max'

      const res2 = parseModelAndEffort('modelhigh');
      assert.equal(res2.effort, 'high'); // Fallback, not suffix

      const res3 = parseModelAndEffort('model-maximum');
      assert.equal(res3.effort, 'high'); // '-maximum' is not in recognized suffixes
    });
  });

  // ==========================================================================
  // SECTION 2: execCli Process Lifecycle & Edge Cases
  // ==========================================================================
  describe('2. execCli Lifecycle, Signals, Timeouts, Buffers & Special Characters', () => {

    it('handles immediate abort signal (signal already aborted prior to call)', async () => {
      const controller = new AbortController();
      controller.abort();

      await assert.rejects(
        async () => execCli('node', ['-e', 'process.stdout.write("should not run")'], {
          signal: controller.signal
        }),
        (err) => {
          assert.ok(err.name === 'AbortError' || err.code === 'ABORT_ERR');
          return true;
        }
      );
    });

    it('handles delayed abort signal while process is actively running', async () => {
      const controller = new AbortController();
      const startTime = Date.now();
      const promise = execCli('node', ['-e', 'setInterval(() => {}, 1000)'], {
        signal: controller.signal
      });

      setTimeout(() => controller.abort(), 75);

      await assert.rejects(
        async () => promise,
        (err) => {
          const duration = Date.now() - startTime;
          assert.ok(duration < 1000, `Abort should terminate quickly, took ${duration}ms`);
          assert.ok(err.name === 'AbortError' || err.code === 'ABORT_ERR' || err.killed);
          return true;
        }
      );
    });

    it('handles command timeouts accurately via timeoutMs', async () => {
      const startTime = Date.now();
      await assert.rejects(
        async () => execCli('node', ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 80 }),
        (err) => {
          const duration = Date.now() - startTime;
          assert.ok(duration < 500, `Timeout should terminate process, took ${duration}ms`);
          assert.ok(err.killed || err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM');
          return true;
        }
      );
    });

    it('captures exitCode, stdout, and stderr for diverse non-zero exit codes', async () => {
      const testCases = [
        { code: 1, stderr: 'General error' },
        { code: 2, stderr: 'Misuse of shell built-in' },
        { code: 42, stderr: 'Application custom exit' },
        { code: 127, stderr: 'Command not found simulation' }
      ];

      for (const tc of testCases) {
        await assert.rejects(
          async () => execCli('node', [
            '-e',
            `process.stdout.write("partial-out-${tc.code}"); process.stderr.write("${tc.stderr}"); process.exit(${tc.code});`
          ]),
          (err) => {
            assert.equal(err.exitCode, tc.code);
            assert.equal(err.stdout, `partial-out-${tc.code}`);
            assert.equal(err.stderr, tc.stderr);
            return true;
          }
        );
      }
    });

    it('handles large stdout buffers (> 1MB) without truncation under default 10MB limit', async () => {
      // Generate 1.2MB of stdout data
      const dataSize = 1.2 * 1024 * 1024;
      const script = `process.stdout.write('X'.repeat(${Math.floor(dataSize)}));`;
      const result = await execCli('node', ['-e', script]);

      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.length, Math.floor(dataSize));
      assert.equal(result.stderr, '');
    });

    it('enforces maxBuffer limit and rejects when stdout exceeds custom maxBuffer', async () => {
      // 20KB output with 5KB maxBuffer
      const script = `process.stdout.write('Y'.repeat(20480));`;
      await assert.rejects(
        async () => execCli('node', ['-e', script], { maxBuffer: 5120 }),
        (err) => {
          assert.ok(err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxBuffer/i.test(err.message));
          assert.ok(err.stdout.length > 0, 'Partial stdout should be retained');
          return true;
        }
      );
    });

    it('safely passes arguments with special characters, quotes, newlines, and metacharacters without shell expansion', async () => {
      const specialArgs = [
        'arg with spaces',
        'arg"with"double\'quotes\'and`backticks`',
        'arg\nwith\nnewlines\rand\ttabs',
        'arg; rm -rf / ; echo pwned',
        'arg && echo "injected" || echo "failed"',
        'arg | cat | grep test',
        '$HOME $PATH `whoami` $(id)',
        'arg > /dev/null < /dev/zero',
        'Unicode: 🚀 é à ç ü ñ 測試 123'
      ];

      // Echo each argument on its own line and verify verbatim receipt
      const script = `
        for (let i = 1; i < process.argv.length; i++) {
          process.stdout.write(Buffer.from(process.argv[i]).toString('base64') + '\\n');
        }
      `;

      const result = await execCli('node', ['-e', script, ...specialArgs]);
      assert.equal(result.exitCode, 0);

      const receivedLines = result.stdout.trim().split('\n');
      assert.equal(receivedLines.length, specialArgs.length);

      for (let i = 0; i < specialArgs.length; i++) {
        const decoded = Buffer.from(receivedLines[i], 'base64').toString('utf8');
        assert.equal(decoded, specialArgs[i], `Argument index ${i} should be passed verbatim`);
      }
    });

    it('propagates cwd and env options to the child process', async () => {
      const script = `
        process.stdout.write(JSON.stringify({
          cwd: process.cwd(),
          customEnv: process.env.COUNCIL_TEST_VAR
        }));
      `;

      const result = await execCli('node', ['-e', script], {
        cwd: '/tmp',
        env: { ...process.env, COUNCIL_TEST_VAR: 'verified_empirical_value' }
      });

      assert.equal(result.exitCode, 0);
      const parsed = JSON.parse(result.stdout);
      // macOS /tmp is symlinked to /private/tmp
      assert.ok(parsed.cwd === '/tmp' || parsed.cwd === '/private/tmp');
      assert.equal(parsed.customEnv, 'verified_empirical_value');
    });
  });

  // ==========================================================================
  // SECTION 3: Provider Dispatchers Robustness & Fallback
  // ==========================================================================
  describe('3. Provider Dispatchers: Invalid JSON, ENOENT Fallback & Argument Mapping', () => {

    describe('runAntigravityCli', () => {
      it('correctly unwraps valid JSON response envelope', async () => {
        const mockExec = async (bin, args) => ({
          stdout: JSON.stringify({ response: '{"vote":"accept","notes":"All clean"}' }),
          stderr: '',
          exitCode: 0
        });

        const res = await runAntigravityCli({
          model: 'gemini-4-argon-high',
          prompt: 'Evaluate candidate',
          exec: mockExec
        });
        assert.equal(res, '{"vote":"accept","notes":"All clean"}');
      });

      it('falls back to raw stdout on malformed or truncated JSON', async () => {
        const mockExec = async () => ({
          stdout: '  {"response": "truncated...  \n',
          stderr: '',
          exitCode: 0
        });

        const res = await runAntigravityCli({
          model: 'gemini-4-argon-high',
          prompt: 'Evaluate',
          exec: mockExec
        });
        assert.equal(res, '{"response": "truncated...');
      });

      it('falls back to raw stdout when response property is non-string or missing', async () => {
        // response is an object, not string
        const mockExec1 = async () => ({
          stdout: JSON.stringify({ response: { vote: 'accept' } }),
          stderr: '',
          exitCode: 0
        });
        const res1 = await runAntigravityCli({ model: 'gemini-4-argon-high', prompt: 'P', exec: mockExec1 });
        assert.equal(res1, JSON.stringify({ response: { vote: 'accept' } }));

        // response is a number
        const mockExec2 = async () => ({
          stdout: JSON.stringify({ response: 42 }),
          stderr: '',
          exitCode: 0
        });
        const res2 = await runAntigravityCli({ model: 'gemini-4-argon-high', prompt: 'P', exec: mockExec2 });
        assert.equal(res2, JSON.stringify({ response: 42 }));

        // response property missing altogether
        const mockExec3 = async () => ({
          stdout: JSON.stringify({ output: 'plain text' }),
          stderr: '',
          exitCode: 0
        });
        const res3 = await runAntigravityCli({ model: 'gemini-4-argon-high', prompt: 'P', exec: mockExec3 });
        assert.equal(res3, JSON.stringify({ output: 'plain text' }));
      });

      it('handles empty stdout gracefully', async () => {
        const mockExec = async () => ({ stdout: '', stderr: '', exitCode: 0 });
        const res = await runAntigravityCli({ model: 'gemini-4-argon-high', prompt: 'P', exec: mockExec });
        assert.equal(res, '');
      });

      it('correctly maps model and effort arguments for parenthesized model', async () => {
        let capturedArgs = null;
        const mockExec = async (bin, args) => {
          capturedArgs = args;
          return { stdout: '{"response":"ok"}', stderr: '', exitCode: 0 };
        };

        await runAntigravityCli({
          model: 'claude-sonnet-5-5 (max)',
          prompt: 'Test prompt',
          exec: mockExec
        });

        assert.ok(capturedArgs.includes('--model'));
        assert.equal(capturedArgs[capturedArgs.indexOf('--model') + 1], 'claude-sonnet-5-5');
        assert.ok(capturedArgs.includes('--effort'));
        assert.equal(capturedArgs[capturedArgs.indexOf('--effort') + 1], 'max');
        assert.ok(capturedArgs.includes('--print=Test prompt'));
      });
    });

    describe('runCodexCli', () => {
      it('correctly maps model, codexEffort max, and includes --ephemeral for max effort', async () => {
        let capturedArgs = null;
        const mockExec = async (bin, args) => {
          capturedArgs = args;
          return { stdout: '  {"vote":"accept"}  \n', stderr: '', exitCode: 0 };
        };

        const res = await runCodexCli({
          model: 'gpt-6-astra (max)',
          prompt: 'Audit topic',
          exec: mockExec
        });

        assert.equal(res, '{"vote":"accept"}');
        assert.deepEqual(capturedArgs, [
          'exec',
          '--ephemeral',
          '--skip-git-repo-check',
          '--sandbox', 'read-only',
          '-m', 'gpt-6-astra',
          '-c', 'model_reasoning_effort="max"',
          'Audit topic'
        ]);
      });

      it('correctly maps default effort high when none specified in model string', async () => {
        let capturedArgs = null;
        const mockExec = async (bin, args) => {
          capturedArgs = args;
          return { stdout: 'ok', stderr: '', exitCode: 0 };
        };

        await runCodexCli({
          model: 'gpt-6.1-sol',
          prompt: 'Prompt',
          exec: mockExec
        });

        assert.ok(capturedArgs.includes('-c'));
        assert.equal(capturedArgs[capturedArgs.indexOf('-c') + 1], 'model_reasoning_effort="high"');
      });
    });

    describe('runCursorCli', () => {
      it('retries with "agent" when "cursor-agent" throws ENOENT', async () => {
        const attemptedBins = [];
        const mockExec = async (bin, args, opts) => {
          attemptedBins.push(bin);
          if (bin === 'cursor-agent') {
            const err = new Error('spawn cursor-agent ENOENT');
            err.code = 'ENOENT';
            throw err;
          }
          return { stdout: '{"vote":"accept"}', stderr: '', exitCode: 0 };
        };

        const res = await runCursorCli({
          model: 'grok-4.7-high',
          prompt: 'Deliberate',
          exec: mockExec
        });

        assert.deepEqual(attemptedBins, ['cursor-agent', 'agent']);
        assert.equal(res, '{"vote":"accept"}');
      });

      it('does NOT fallback to "agent" when error is not ENOENT (e.g. exitCode 1 or quota)', async () => {
        const attemptedBins = [];
        const mockExec = async (bin) => {
          attemptedBins.push(bin);
          const err = new Error('HTTP 429: weekly included pool exhausted');
          err.exitCode = 1;
          err.code = 1;
          throw err;
        };

        await assert.rejects(
          async () => runCursorCli({
            model: 'grok-4.7-high',
            prompt: 'Deliberate',
            exec: mockExec
          }),
          /weekly included pool exhausted/
        );

        assert.deepEqual(attemptedBins, ['cursor-agent'], 'Should not attempt agent fallback on non-ENOENT error');
      });

      it('does NOT fallback to "agent" if executable was custom and throws ENOENT', async () => {
        const attemptedBins = [];
        const mockExec = async (bin) => {
          attemptedBins.push(bin);
          const err = new Error('custom binary not found');
          err.code = 'ENOENT';
          throw err;
        };

        await assert.rejects(
          async () => runCursorCli({
            executable: 'my-custom-cursor',
            model: 'grok-4.7-high',
            prompt: 'Deliberate',
            exec: mockExec
          }),
          /custom binary not found/
        );

        assert.deepEqual(attemptedBins, ['my-custom-cursor']);
      });

      it('propagates error when fallback "agent" binary also fails with ENOENT', async () => {
        const attemptedBins = [];
        const mockExec = async (bin) => {
          attemptedBins.push(bin);
          const err = new Error(`spawn ${bin} ENOENT`);
          err.code = 'ENOENT';
          throw err;
        };

        await assert.rejects(
          async () => runCursorCli({
            model: 'composer-2.5',
            prompt: 'Deliberate',
            exec: mockExec
          }),
          /spawn agent ENOENT/
        );

        assert.deepEqual(attemptedBins, ['cursor-agent', 'agent']);
      });
    });
  });

  // ==========================================================================
  // SECTION 4: Error Classification Integration & Taxonomy Verification
  // ==========================================================================
  describe('4. Error Classification Integration (HarnessAdapter.classifyError)', () => {

    it('classifies real execCli non-zero exits containing 429 and quota signatures in stderr into QuotaExhaustionError across all adapters', async () => {
      const adapters = [
        new AntigravityAdapter(),
        new CodexAdapter(),
        new CursorAdapter()
      ];

      // Real execCli execution where stderr contains quota patterns
      const quotaStderrs = [
        '429 Too Many Requests',
        'RESOURCE_EXHAUSTED: quota window exhausted',
        'rate_limit_error: TPM limit reached',
        'insufficient_quota: you exceeded your current quota',
        'Cursor weekly included pool exhausted (HTTP 429)'
      ];

      for (const adapter of adapters) {
        for (const stderrText of quotaStderrs) {
          // If the stderrText is provider-specific, only test against relevant adapters or 429
          const isRelevant = stderrText.includes('429') ||
            (adapter.name === 'antigravity' && (stderrText.includes('RESOURCE_EXHAUSTED') || stderrText.includes('rate_limit_error'))) ||
            (adapter.name === 'codex' && stderrText.includes('insufficient_quota')) ||
            (adapter.name === 'cursor' && stderrText.includes('weekly included pool exhausted'));

          if (!isRelevant) continue;

          await assert.rejects(
            async () => execCli('node', ['-e', `process.stderr.write("${stderrText}"); process.exit(1);`]),
            (realErr) => {
              const classified = adapter.classifyError(realErr, { seatId: 'seat-test', model: 'test-model' });
              assert.ok(
                classified instanceof QuotaExhaustionError,
                `Adapter ${adapter.name} should classify stderr containing "${stderrText}" as QuotaExhaustionError`
              );
              assert.equal(classified.isQuotaFault, true);
              assert.equal(classified.isRetryable, true);
              assert.equal(classified.seatId, 'seat-test');
              assert.equal(classified.model, 'test-model');
              assert.equal(classified.cause, realErr);
              return true;
            }
          );
        }
      }
    });

    it('classifies execCli non-zero exit without quota pattern into HarnessExecutionError', () => {
      const adapters = [
        new AntigravityAdapter(),
        new CodexAdapter(),
        new CursorAdapter()
      ];

      for (const adapter of adapters) {
        const rawErr = new Error('Command failed: generic fatal error');
        rawErr.exitCode = 127;
        rawErr.stderr = 'command not found';
        rawErr.stdout = '';

        const classified = adapter.classifyError(rawErr, { seatId: 'seat-exec', model: 'test-model' });
        assert.ok(classified instanceof HarnessExecutionError);
        assert.equal(classified.isQuotaFault, false);
        assert.equal(classified.isRetryable, false);
        assert.equal(classified.exitCode, 127);
        assert.equal(classified.stderr, 'command not found');
        assert.equal(classified.seatId, 'seat-exec');
      }
    });

    it('classifies execCli ENOENT error into HarnessExecutionError with exitCode preserved', () => {
      const adapter = new HarnessAdapter({ name: 'test' });
      const enoentErr = new Error('spawn binary ENOENT');
      enoentErr.code = 'ENOENT';
      enoentErr.exitCode = null;
      enoentErr.stderr = '';

      const classified = adapter.classifyError(enoentErr, { seatId: 'seat-enoent' });
      assert.ok(classified instanceof HarnessExecutionError);
      assert.equal(classified.exitCode, 'ENOENT');
    });

    it('preserves existing HarnessError instances without double-wrapping', () => {
      const adapter = new HarnessAdapter();
      const existingTimeout = new TimeoutError('Operation timed out', { timeoutMs: 1000 });
      const classified = adapter.classifyError(existingTimeout);
      assert.strictEqual(classified, existingTimeout);
    });

    it('end-to-end: adapter.executeSeat with failing spawnRunner correctly throws classified error', async () => {
      const agy = new AntigravityAdapter({
        spawnRunner: async () => {
          const err = new Error('Command failed: agy');
          err.exitCode = 1;
          err.stderr = 'rate_limit_error: quota window exhausted (HTTP 429)';
          throw err;
        }
      });

      await assert.rejects(
        async () => agy.executeSeat({
          seat: { id: 'argon-1', model: 'gemini-4-argon-high' },
          soul: 'Pragmatic Engineer',
          round: 1,
          phase: 'DELIBERATION',
          state: { topic: 'Architecture' }
        }),
        (err) => {
          assert.ok(err instanceof QuotaExhaustionError, 'Should throw QuotaExhaustionError');
          assert.equal(err.seatId, 'argon-1');
          assert.equal(err.model, 'gemini-4-argon-high');
          assert.equal(err.isQuotaFault, true);
          return true;
        }
      );
    });

    it('end-to-end: adapter.executeJudge with failing spawnRunner correctly throws classified error', async () => {
      const codex = new CodexAdapter({
        spawnRunner: async () => {
          const err = new Error('Command failed: codex');
          err.exitCode = 1;
          err.stderr = 'fatal: syntax error in config';
          throw err;
        }
      });

      await assert.rejects(
        async () => codex.executeJudge({
          judge: { id: 'astra-judge', model: 'gpt-6-astra' },
          round: 1,
          phase: 'JUDGE_AUDIT_SYNTHESIS',
          proofs: [],
          state: { topic: 'Architecture' }
        }),
        (err) => {
          assert.ok(err instanceof HarnessExecutionError, 'Should throw HarnessExecutionError');
          assert.equal(err.seatId, 'astra-judge');
          assert.equal(err.exitCode, 1);
          assert.equal(err.stderr, 'fatal: syntax error in config');
          return true;
        }
      );
    });

    it('end-to-end: timeout during adapter.executeSeat aborts runner and throws TimeoutError', async () => {
      let runnerSignalAborted = false;
      const cursor = new CursorAdapter({
        timeoutMs: 50,
        spawnRunner: async ({ signal }) => {
          return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => {
              runnerSignalAborted = true;
              const err = new Error('Process aborted');
              err.name = 'AbortError';
              reject(err);
            });
          });
        }
      });

      await assert.rejects(
        async () => cursor.executeSeat({
          seat: { id: 'grok-1', model: 'grok-4.7-high' },
          soul: 'Auditor',
          round: 1,
          phase: 'DELIBERATION',
          state: { topic: 'Testing' }
        }),
        (err) => {
          assert.ok(err instanceof TimeoutError);
          assert.equal(err.seatId, 'grok-1');
          assert.equal(err.timeoutMs, 50);
          return true;
        }
      );

      assert.equal(runnerSignalAborted, true, 'Runner AbortSignal must be aborted on timeout');
    });
  });

  // ==========================================================================
  // SECTION 5: Concurrency, Prompt Propagation & Proof Citation Invariants
  // ==========================================================================
  describe('5. Concurrency & Prompt Hardening Invariants (Candidate & Admitted Proof IDs)', () => {

    it('handles 20 concurrent execCli executions without FD leaks or race conditions', async () => {
      const concurrency = 20;
      const tasks = Array.from({ length: concurrency }, (_, idx) => {
        return execCli('node', ['-e', `process.stdout.write("task-${idx}");`]);
      });

      const results = await Promise.all(tasks);
      assert.equal(results.length, concurrency);
      for (let i = 0; i < concurrency; i++) {
        assert.equal(results[i].exitCode, 0);
        assert.equal(results[i].stdout, `task-${i}`);
      }
    });

    it('preserves multi-line, JSON-containing, markdown prompts through all dispatchers without character loss', async () => {
      const complexPrompt = `
# Topic: Critical Architecture Review
Here is a JSON candidate:
\`\`\`json
{
  "summary": "Distributed state machine with Paxos",
  "clauses": [
    { "context": "Storage", "conclusion": "Zero daemon SQLite", "citedProofIds": ["P1", "P2"] }
  ]
}
\`\`\`
Special characters: $VAR "quotes" 'single' \`backticks\` \\backslashes\\ ; rm -rf / && echo 1
      `.trim();

      // Test Antigravity
      let capturedAgy = null;
      await runAntigravityCli({
        model: 'gemini-4-argon-high',
        prompt: complexPrompt,
        exec: async (bin, args) => {
          capturedAgy = args;
          return { stdout: '{"response":"ok"}', stderr: '', exitCode: 0 };
        }
      });
      assert.ok(capturedAgy.includes('--print=' + complexPrompt));

      // Test Codex
      let capturedCodex = null;
      await runCodexCli({
        model: 'gpt-6-astra (max)',
        prompt: complexPrompt,
        exec: async (bin, args) => {
          capturedCodex = args;
          return { stdout: 'ok', stderr: '', exitCode: 0 };
        }
      });
      assert.equal(capturedCodex[capturedCodex.length - 1], complexPrompt);

      // Test Cursor
      let capturedCursor = null;
      await runCursorCli({
        model: 'grok-4.7-high',
        prompt: complexPrompt,
        exec: async (bin, args) => {
          capturedCursor = args;
          return { stdout: 'ok', stderr: '', exitCode: 0 };
        }
      });
      assert.equal(capturedCursor[capturedCursor.length - 1], complexPrompt);
    });

    it('guarantees voting prompts on all 3 adapters require citing candidate and admitted proof IDs', () => {
      const state = {
        topic: 'Live Harness Test',
        round: 2,
        maxRounds: 5,
        candidate: {
          round: 1,
          summary: 'Verified live execution architecture',
          clauses: [
            { context: 'CLI Seam', conclusion: 'Direct execFile', citedProofIds: ['P1', 'P3'] }
          ]
        },
        proofs: [
          { id: 'P1', status: 'admitted', scope: 'Harness', statement: 'execFile works', kind: 'check', source: 'src/harness/cli-runner.js' },
          { id: 'P2', status: 'rejected', scope: 'Harness', statement: 'Daemon works', kind: 'check', source: 'none' },
          { id: 'P3', status: 'admitted', scope: 'Process', statement: 'AbortSignal terminates', kind: 'check', source: 'test' }
        ],
        objections: [
          { id: 'OBJ-1', seatId: 'seat-1', status: 'open', proofId: 'P1', reason: 'Latency check required' }
        ]
      };

      const adapters = [
        new AntigravityAdapter(),
        new CodexAdapter(),
        new CursorAdapter()
      ];

      for (const adapter of adapters) {
        const votingPrompt = adapter.formatSeatPrompt({
          seat: { id: 'seat-1', model: 'gpt-6.1-sol' },
          soul: 'Security Auditor',
          round: 2,
          phase: 'VOTING',
          state
        });

        // Must include Candidate summary
        assert.match(votingPrompt, /Verified live execution architecture/);
        // Must include Clause C1 and cited proofs
        assert.match(votingPrompt, /Clause C1 \[CLI Seam\]/);
        assert.match(votingPrompt, /P1, P3/);
        // Must include admitted proofs P1 and P3, but NOT rejected proof P2 in admitted section
        assert.match(votingPrompt, /\[P1\] \(check\) \[Harness\]: execFile works/);
        assert.match(votingPrompt, /\[P3\] \(check\) \[Process\]: AbortSignal terminates/);
        assert.doesNotMatch(votingPrompt, /\[P2\] \(check\)/);

        // Deliberation Prompt verification (includes open objections to address)
        const delibPrompt = adapter.formatSeatPrompt({
          seat: { id: 'seat-1', model: 'gpt-6.1-sol' },
          soul: 'Security Auditor',
          round: 2,
          phase: 'DELIBERATION',
          state
        });
        assert.match(delibPrompt, /OBJ-1/);
        assert.match(delibPrompt, /Latency check required/);

        // Judge Prompt verification
        const judgePrompt = adapter.formatJudgePrompt({
          judge: { id: 'judge-1', soul: 'Impartial Judge' },
          round: 2,
          phase: 'JUDGE_AUDIT_SYNTHESIS',
          proofs: state.proofs,
          state
        });

        assert.match(judgePrompt, /\[P1\] \(check\) \[Harness\]/);
        assert.match(judgePrompt, /\[P2\] \(check\) \[Harness\]/);
        assert.match(judgePrompt, /\[P3\] \(check\) \[Process\]/);
        assert.match(judgePrompt, /proofDecisions/);
        assert.match(judgePrompt, /citedProofIds/);
      }
    });
  });
});
