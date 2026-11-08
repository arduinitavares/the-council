import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseModelAndEffort,
  execCli,
  runAntigravityCli,
  runCodexCli,
  runCursorCli,
  redactArgv,
  CODEX_EFFORT_MAP,
  ALLOWED_EFFORTS
} from '../../src/harness/cli-runner.js';

describe('Unit: Direct CLI Outbound Runner (src/harness/cli-runner.js)', () => {
  describe('parseModelAndEffort', () => {
    it('parses model and effort from parenthesized model string', () => {
      const res1 = parseModelAndEffort('gpt-6-astra (max)');
      assert.deepEqual(res1, { model: 'gpt-6-astra', effort: 'max', codexEffort: 'max' });

      const res2 = parseModelAndEffort('gpt-6.1-sol (high)');
      assert.deepEqual(res2, { model: 'gpt-6.1-sol', effort: 'high', codexEffort: 'high' });

      const res3 = parseModelAndEffort('gpt-6-astra (xhigh)');
      assert.deepEqual(res3, { model: 'gpt-6-astra', effort: 'xhigh', codexEffort: 'xhigh' });

      const res4 = parseModelAndEffort('model-name (low)');
      assert.deepEqual(res4, { model: 'model-name', effort: 'low', codexEffort: 'low' });
    });

    it('parses model and effort with hyphenated suffix or default fallback', () => {
      const res1 = parseModelAndEffort('gemini-4-argon-high');
      assert.equal(res1.model, 'gemini-4-argon-high');
      assert.equal(res1.effort, 'high');
      assert.equal(res1.codexEffort, 'high');

      const res2 = parseModelAndEffort('composer-2.5', 'high');
      assert.deepEqual(res2, { model: 'composer-2.5', effort: 'high', codexEffort: 'high' });

      const res3 = parseModelAndEffort('claude-opus-5-5-high');
      assert.equal(res3.model, 'claude-opus-5-5-high');
      assert.equal(res3.effort, 'high');

      const res4 = parseModelAndEffort('grok-4.7-xhigh');
      assert.equal(res4.model, 'grok-4.7-xhigh');
      assert.equal(res4.effort, 'xhigh');
      assert.equal(res4.codexEffort, 'xhigh');

      const res5 = parseModelAndEffort('custom-model');
      assert.deepEqual(res5, { model: 'custom-model', effort: 'high', codexEffort: 'high' });
    });

    it('throws on empty, null, undefined, or non-string inputs', () => {
      assert.throws(() => parseModelAndEffort(null), /modelString must be a non-empty string/);
      assert.throws(() => parseModelAndEffort(undefined), /modelString must be a non-empty string/);
      assert.throws(() => parseModelAndEffort(''), /modelString must be a non-empty string/);
      assert.throws(() => parseModelAndEffort('   '), /modelString must be a non-empty string/);
      assert.throws(() => parseModelAndEffort(123), /modelString must be a non-empty string/);
    });
  });

  describe('execCli', () => {
    it('executes command successfully and returns stdout, stderr, and exitCode 0', async () => {
      const ok = await execCli('node', ['-e', 'process.stdout.write("hello from cli"); process.stderr.write("info log");']);
      assert.equal(ok.stdout, 'hello from cli');
      assert.equal(ok.stderr, 'info log');
      assert.equal(ok.exitCode, 0);
    });

    it('attaches exitCode, stdout, and stderr on non-zero exit', async () => {
      await assert.rejects(
        async () => execCli('node', ['-e', 'process.stderr.write("quota exceeded 429"); process.stdout.write("partial"); process.exit(42);']),
        (err) => {
          assert.equal(err.exitCode, 42);
          assert.ok(err.stderr.includes('quota exceeded 429'));
          assert.equal(err.stdout, 'partial');
          return true;
        }
      );
    });

    it('handles non-existent binary with ENOENT error', async () => {
      await assert.rejects(
        async () => execCli('non-existent-binary-12345678', ['--version']),
        (err) => {
          assert.equal(err.code, 'ENOENT');
          return true;
        }
      );
    });

    it('supports AbortSignal to cancel running process', async () => {
      const controller = new AbortController();
      const promise = execCli('node', ['-e', 'setTimeout(() => {}, 10000)'], {
        signal: controller.signal
      });
      setTimeout(() => controller.abort(), 50);

      await assert.rejects(
        async () => promise,
        (err) => {
          assert.ok(err.name === 'AbortError' || err.code === 'ABORT_ERR' || err.killed);
          return true;
        }
      );
    });

    it('supports timeoutMs to terminate slow execution', async () => {
      await assert.rejects(
        async () => execCli('node', ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 50 }),
        (err) => {
          assert.ok(err.killed || err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM');
          return true;
        }
      );
    });

    it('closes child stdin immediately so processes reading piped stdin until EOF do not hang', async () => {
      const asyncRead = await execCli(
        process.execPath,
        [
          '-e',
          'let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (c) => { input += c; }); process.stdin.on("end", () => { process.stdout.write("eof:" + input); });'
        ],
        { timeoutMs: 500 }
      );
      assert.equal(asyncRead.exitCode, 0);
      assert.equal(asyncRead.stdout, 'eof:');

      const syncRead = await execCli(
        process.execPath,
        [
          '-e',
          'const fs = require("node:fs"); process.stdout.write("sync-eof:" + fs.readFileSync(0, "utf8"));'
        ],
        { timeoutMs: 500 }
      );
      assert.equal(syncRead.exitCode, 0);
      assert.equal(syncRead.stdout, 'sync-eof:');
    });

    it('writes options.input to child stdin before closing EOF and suppresses EPIPE on early exit', async () => {
      const withInput = await execCli(
        process.execPath,
        [
          '-e',
          'let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (c) => { input += c; }); process.stdin.on("end", () => { process.stdout.write("received:" + input); });'
        ],
        { input: 'explicit stdin payload', timeoutMs: 500 }
      );
      assert.equal(withInput.exitCode, 0);
      assert.equal(withInput.stdout, 'received:explicit stdin payload');

      const earlyExit = await execCli(
        process.execPath,
        ['-e', 'process.exit(0);'],
        { input: 'x'.repeat(2 * 1024 * 1024), timeoutMs: 1000 }
      );
      assert.equal(earlyExit.exitCode, 0);
    });
  });

  describe('runAntigravityCli', () => {
    it('constructs correct CLI flags and unwraps JSON envelope', async () => {
      let captured = null;
      const mockExec = async (bin, args, opts) => {
        captured = { bin, args, opts };
        return {
          stdout: JSON.stringify({ response: '{"vote":"accept"}' }),
          stderr: '',
          exitCode: 0
        };
      };

      const out = await runAntigravityCli({
        model: 'gemini-4-argon-high',
        prompt: 'Evaluate candidate',
        exec: mockExec
      });

      assert.equal(captured.bin, 'agy');
      assert.deepEqual(captured.args, [
        '--output-format',
        'json',
        '--mode',
        'plan',
        '--sandbox',
        '--disable-slash-commands',
        '--model',
        'gemini-4-argon-high',
        '--effort',
        'high',
        '--print=Evaluate candidate'
      ]);
      assert.equal(out, '{"vote":"accept"}');
    });

    it('returns raw trimmed stdout if not wrapped in response JSON property', async () => {
      const mockExec = async () => ({
        stdout: '  {"vote":"object","reason":"Defect"}  \n',
        stderr: '',
        exitCode: 0
      });

      const out = await runAntigravityCli({
        model: 'claude-opus-5-5-high',
        prompt: 'Audit proofs',
        exec: mockExec
      });

      assert.equal(out, '{"vote":"object","reason":"Defect"}');
    });
  });

  describe('runCodexCli', () => {
    it('constructs exec args with sandbox, skip-git, and model_reasoning_effort', async () => {
      let captured = null;
      const mockExec = async (bin, args, opts) => {
        captured = { bin, args, opts };
        return {
          stdout: '{"vote":"accept"}',
          stderr: '',
          exitCode: 0
        };
      };

      const out = await runCodexCli({
        model: 'gpt-6-astra (max)',
        prompt: 'Audit and synthesize candidate',
        exec: mockExec
      });

      assert.equal(captured.bin, 'codex');
      assert.deepEqual(captured.args, [
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '-m',
        'gpt-6-astra',
        '-c',
        'model_reasoning_effort="max"',
        'Audit and synthesize candidate'
      ]);
      assert.equal(out, '{"vote":"accept"}');
    });

    it('completes without hanging when default execCli spawns a codex process that reads piped stdin until EOF', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-codex-stdin-'));
      const fakeExecSubcommandScript = path.join(tmpDir, 'exec');
      fs.writeFileSync(
        fakeExecSubcommandScript,
        [
          'let stdinBuf = "";',
          'process.stdin.setEncoding("utf8");',
          'process.stdin.on("data", (chunk) => { stdinBuf += chunk; });',
          'process.stdin.on("end", () => {',
          '  process.stdout.write(JSON.stringify({ vote: "accept", stdinBytes: stdinBuf.length, prompt: process.argv.at(-1) }));',
          '});'
        ].join('\n')
      );

      try {
        const out = await runCodexCli({
          executable: process.execPath,
          cwd: tmpDir,
          model: 'gpt-6.1-sol (high)',
          prompt: 'Verify closed stdin pipe',
          timeoutMs: 1000
        });
        assert.deepEqual(JSON.parse(out), {
          vote: 'accept',
          stdinBytes: 0,
          prompt: 'Verify closed stdin pipe'
        });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('runCursorCli', () => {
    it('constructs cursor-agent args and returns trimmed stdout', async () => {
      let captured = null;
      const mockExec = async (bin, args, opts) => {
        captured = { bin, args, opts };
        return {
          stdout: '  {"vote":"accept"}  \n',
          stderr: '',
          exitCode: 0
        };
      };

      const out = await runCursorCli({
        model: 'grok-4.7-high',
        prompt: 'Deliberate',
        exec: mockExec
      });

      assert.equal(captured.bin, 'cursor-agent');
      assert.deepEqual(captured.args, [
        '--print',
        '--output-format',
        'text',
        '--model',
        'grok-4.7-high',
        'Deliberate'
      ]);
      assert.equal(out, '{"vote":"accept"}');
    });

    it('falls back to agent binary if cursor-agent throws ENOENT', async () => {
      const calls = [];
      const mockExec = async (bin, args, opts) => {
        calls.push(bin);
        if (bin === 'cursor-agent') {
          const err = new Error('spawn cursor-agent ENOENT');
          err.code = 'ENOENT';
          throw err;
        }
        return {
          stdout: '{"vote":"accept"}',
          stderr: '',
          exitCode: 0
        };
      };

      const out = await runCursorCli({
        model: 'grok-4.7-high',
        prompt: 'Deliberate',
        exec: mockExec
      });

      assert.deepEqual(calls, ['cursor-agent', 'agent']);
      assert.equal(out, '{"vote":"accept"}');
    });

    it('re-throws error if agent also fails or if non-ENOENT error occurs', async () => {
      const mockExec = async () => {
        const err = new Error('Permission denied');
        err.code = 'EACCES';
        throw err;
      };

      await assert.rejects(
        async () => runCursorCli({ model: 'grok-4.7-high', prompt: 'P', exec: mockExec }),
        /Permission denied/
      );
    });
  });

  describe('parseModelAndEffort: Codex Effort Preservation (Issue #15)', () => {
    it('preserves "max" effort for parenthesized model strings', () => {
      const res = parseModelAndEffort('gpt-6-astra (max)');
      assert.deepEqual(res, {
        model: 'gpt-6-astra',
        effort: 'max',
        codexEffort: 'max'
      });
    });

    it('preserves "max" effort regardless of case or whitespace', () => {
      const variations = [
        'gpt-6-astra (MAX)',
        'gpt-6-astra (Max)',
        '  gpt-6-astra   (  max  )  '
      ];
      for (const v of variations) {
        const res = parseModelAndEffort(v);
        assert.equal(res.codexEffort, 'max', `Failed for variation: ${v}`);
        assert.equal(res.effort, 'max', `Failed for variation: ${v}`);
      }
    });

    it('preserves "max" effort for hyphenated suffix syntax', () => {
      const res = parseModelAndEffort('model-max');
      assert.deepEqual(res, {
        model: 'model-max',
        effort: 'max',
        codexEffort: 'max'
      });
    });

    it('preserves "max" effort when specified as defaultEffort fallback', () => {
      const res = parseModelAndEffort('plain-model', 'max');
      assert.deepEqual(res, {
        model: 'plain-model',
        effort: 'max',
        codexEffort: 'max'
      });
    });

    it('distinguishes "max" and "xhigh" as separate, non-aliased tiers', () => {
      const maxRes = parseModelAndEffort('gpt-6-astra (max)');
      const xhighRes = parseModelAndEffort('gpt-6-astra (xhigh)');
      assert.equal(maxRes.codexEffort, 'max');
      assert.equal(xhighRes.codexEffort, 'xhigh');
      assert.notEqual(maxRes.codexEffort, xhighRes.codexEffort);
    });
  });

  describe('parseModelAndEffort: Unsupported Effort Rejection (Issue #15)', () => {
    it('throws descriptive configuration error for unrecognized parenthesized effort', () => {
      const invalidEfforts = ['ultra', 'extreme', 'ultra-mega', 'turbo', 'none', 'super-high'];
      for (const invalid of invalidEfforts) {
        assert.throws(
          () => parseModelAndEffort(`gpt-6-astra (${invalid})`),
          (err) => {
            assert.match(err.message, new RegExp(`Unsupported reasoning effort "${invalid}"`, 'i'));
            assert.match(err.message, /Allowed:.*(max|xhigh|high|medium|low)/i);
            return true;
          },
          `Expected error for invalid effort: ${invalid}`
        );
      }
    });

    it('throws descriptive error if defaultEffort parameter is invalid', () => {
      assert.throws(
        () => parseModelAndEffort('plain-model', 'ultra'),
        (err) => {
          assert.match(err.message, /Unsupported reasoning effort "ultra"/i);
          assert.match(err.message, /Allowed:/i);
          return true;
        }
      );
    });

    it('rejects unsupported effort before calling child_process in runCodexCli', async () => {
      let childSpawned = false;
      const mockExec = async () => {
        childSpawned = true;
        return { stdout: 'ok', exitCode: 0 };
      };

      await assert.rejects(
        async () => runCodexCli({
          model: 'gpt-6-astra (unsupported_effort)',
          prompt: 'test prompt',
          exec: mockExec
        }),
        /Unsupported reasoning effort "unsupported_effort"/i
      );

      assert.equal(childSpawned, false, 'Process must not be spawned if model effort is invalid');
    });
  });

  describe('runCodexCli: Ephemeral Isolation & Argument Invariants (Issue #18)', () => {
    it('unconditionally includes "--ephemeral" in Codex exec arguments', async () => {
      let capturedArgs = null;
      const mockExec = async (bin, args) => {
        capturedArgs = args;
        return { stdout: '{"vote":"accept"}', stderr: '', exitCode: 0 };
      };

      await runCodexCli({
        model: 'gpt-6-astra (max)',
        prompt: 'Synthesize research',
        exec: mockExec
      });

      assert.ok(capturedArgs.includes('--ephemeral'), 'Arguments must include --ephemeral');
      const ephemeralIdx = capturedArgs.indexOf('--ephemeral');
      const promptIdx = capturedArgs.indexOf('Synthesize research');
      const execIdx = capturedArgs.indexOf('exec');
      assert.equal(execIdx, 0, 'exec must be the first argument');
      assert.ok(ephemeralIdx > execIdx, '--ephemeral must come after exec');
      assert.ok(ephemeralIdx < promptIdx, '--ephemeral must come before prompt');
    });

    it('passes model_reasoning_effort="max" when model has max effort', async () => {
      let capturedArgs = null;
      const mockExec = async (bin, args) => {
        capturedArgs = args;
        return { stdout: 'ok', stderr: '', exitCode: 0 };
      };

      await runCodexCli({
        model: 'gpt-6-astra (max)',
        prompt: 'Audit topic',
        exec: mockExec
      });

      const cIndex = capturedArgs.indexOf('-c');
      assert.ok(cIndex !== -1, 'Arguments must contain -c flag');
      assert.equal(
        capturedArgs[cIndex + 1],
        'model_reasoning_effort="max"',
        'Reasoning effort must be "max" without downgrade'
      );
    });

    it('matches the exact argument specification in PROJECT.md', async () => {
      let captured = null;
      const mockExec = async (bin, args, opts) => {
        captured = { bin, args, opts };
        return { stdout: '{"vote":"accept"}', stderr: '', exitCode: 0 };
      };

      await runCodexCli({
        model: 'gpt-6.1-sol (max)',
        prompt: 'Execute round',
        exec: mockExec
      });

      assert.equal(captured.bin, 'codex');
      assert.deepEqual(captured.args, [
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '-m',
        'gpt-6.1-sol',
        '-c',
        'model_reasoning_effort="max"',
        'Execute round'
      ]);
    });

    it('supports opt-in strict isolation (--ignore-user-config)', async () => {
      let capturedArgs = null;
      const mockExec = async (bin, args) => {
        capturedArgs = args;
        return { stdout: 'ok', stderr: '', exitCode: 0 };
      };

      // Default: does not include --ignore-user-config (preserves auth)
      await runCodexCli({
        model: 'gpt-6-astra (high)',
        prompt: 'prompt',
        exec: mockExec
      });
      assert.equal(capturedArgs.includes('--ignore-user-config'), false);

      // Opt-in: ignoreUserConfig: true
      await runCodexCli({
        model: 'gpt-6-astra (high)',
        prompt: 'prompt',
        ignoreUserConfig: true,
        exec: mockExec
      });
      assert.ok(capturedArgs.includes('--ignore-user-config'));
      assert.equal(capturedArgs.indexOf('--ignore-user-config'), capturedArgs.indexOf('--ephemeral') + 1);
    });
  });

  describe('runCodexCli: Telemetry & Prompt Redaction (PROJECT.md:45)', () => {
    it('redacts prompt content in recorded argv while preserving flags', async () => {
      let recordedCall = null;
      const secretPrompt = 'Confidential deliberative deliberation prompt with sensitive data';

      await runCodexCli({
        model: 'gpt-6-astra (max)',
        prompt: secretPrompt,
        context: { seatId: 'astra-1' },
        onCallRecord: (record) => { recordedCall = record; },
        exec: async () => ({ stdout: 'ok', exitCode: 0 })
      });

      assert.ok(recordedCall, 'onCallRecord must be invoked');
      assert.equal(recordedCall.participantId, 'astra-1');
      assert.equal(recordedCall.provider, 'codex');
      assert.equal(recordedCall.exitCode, 0);
      assert.ok(typeof recordedCall.durationMs === 'number');

      // Verify prompt is redacted in argv
      assert.ok(!recordedCall.argv.includes(secretPrompt), 'Prompt must not appear in recorded argv');
      const redactedArg = recordedCall.argv.find((a) => a.startsWith('[REDACTED prompt:'));
      assert.ok(redactedArg, 'Argv must contain redacted prompt summary');
      assert.ok(redactedArg.includes(`length=${secretPrompt.length}`));
    });

    it('records non-zero exitCode and call duration upon CLI failure', async () => {
      let recordedCall = null;
      const failingExec = async () => {
        const err = new Error('Execution failed');
        err.exitCode = 127;
        throw err;
      };

      await assert.rejects(
        async () => runCodexCli({
          model: 'gpt-6-astra (max)',
          prompt: 'test',
          onCallRecord: (record) => { recordedCall = record; },
          exec: failingExec
        })
      );

      assert.ok(recordedCall);
      assert.equal(recordedCall.exitCode, 127);
      assert.ok(recordedCall.durationMs >= 0);
    });
  });

  describe('redactArgv helper', () => {
    it('returns empty array if args is not an array', () => {
      assert.deepEqual(redactArgv(null), []);
      assert.deepEqual(redactArgv(undefined), []);
      assert.deepEqual(redactArgv('string'), []);
    });

    it('redacts prompt positional arg and --print=<prompt> arg', () => {
      const prompt = 'my secret prompt';
      const args1 = ['exec', prompt];
      const redacted1 = redactArgv(args1, prompt);
      assert.equal(redacted1[0], 'exec');
      assert.match(redacted1[1], /^\[REDACTED prompt: length=16, sha256=[a-f0-9]{12}\]$/);

      const args2 = ['--print=' + prompt, '--other'];
      const redacted2 = redactArgv(args2, prompt);
      assert.match(redacted2[0], /^--print=\[REDACTED prompt: length=16, sha256=[a-f0-9]{12}\]$/);
      assert.equal(redacted2[1], '--other');
    });
  });
});

