import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseModelAndEffort,
  execCli,
  recordProviderCall,
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
        '--json',
        '--disable',
        'hooks',
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
        'stream-json',
        '--trust',
        '--mode',
        'plan',
        '--sandbox',
        'enabled',
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
        '--json',
        '--disable',
        'hooks',
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

    it('disables user hooks by default (--disable hooks) while allowing opt-in disableHooks: false (#37)', async () => {
      let capturedArgs = null;
      const mockExec = async (bin, args) => {
        capturedArgs = args;
        return { stdout: 'ok', stderr: '', exitCode: 0 };
      };

      await runCodexCli({
        model: 'gpt-6-astra (max)',
        prompt: 'prompt',
        exec: mockExec
      });
      const disableIdx = capturedArgs.indexOf('--disable');
      assert.ok(disableIdx !== -1, 'Arguments must include --disable by default');
      assert.equal(capturedArgs[disableIdx + 1], 'hooks', '--disable must target hooks feature');

      // Opt-in to allow hooks if explicitly requested
      await runCodexCli({
        model: 'gpt-6-astra (max)',
        prompt: 'prompt',
        disableHooks: false,
        exec: mockExec
      });
      assert.equal(capturedArgs.includes('--disable'), false, 'disableHooks: false must omit --disable hooks');
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

    it('matches disableHooks precedence for ignoreUserConfig (explicit option overrides context) (#37)', async () => {
      let capturedArgs = null;
      const mockExec = async (_bin, args) => {
        capturedArgs = args;
        return { stdout: 'ok', stderr: '', exitCode: 0 };
      };

      // Explicit ignoreUserConfig: false overrides context.ignoreUserConfig: true
      await runCodexCli({
        model: 'gpt-6-astra (high)',
        prompt: 'prompt',
        ignoreUserConfig: false,
        context: { ignoreUserConfig: true },
        exec: mockExec
      });
      assert.equal(
        capturedArgs.includes('--ignore-user-config'),
        false,
        'Explicit ignoreUserConfig: false must override context.ignoreUserConfig: true'
      );

      // Explicit ignoreUserConfig: true overrides context.ignoreUserConfig: false
      await runCodexCli({
        model: 'gpt-6-astra (high)',
        prompt: 'prompt',
        ignoreUserConfig: true,
        context: { ignoreUserConfig: false },
        exec: mockExec
      });
      assert.equal(
        capturedArgs.includes('--ignore-user-config'),
        true,
        'Explicit ignoreUserConfig: true must override context.ignoreUserConfig: false'
      );

      // Omitted ignoreUserConfig uses context.ignoreUserConfig: true
      await runCodexCli({
        model: 'gpt-6-astra (high)',
        prompt: 'prompt',
        context: { ignoreUserConfig: true },
        exec: mockExec
      });
      assert.equal(
        capturedArgs.includes('--ignore-user-config'),
        true,
        'Omitted ignoreUserConfig must honor context.ignoreUserConfig: true'
      );
    });

    it('rejects non-boolean disableHooks and ignoreUserConfig at top-level, judge, and seats without coercing "false" to true (#37)', async () => {
      const { resolveConfig, validateConfig } = await import('../../src/engine/config.js');

      for (const badVal of ['false', 'true', 0, 1, null, {}]) {
        assert.throws(
          () => resolveConfig({ topic: 'T', disableHooks: badVal }),
          /disableHooks/
        );
        assert.throws(
          () => resolveConfig({ topic: 'T', ignoreUserConfig: badVal }),
          /ignoreUserConfig/
        );
        assert.throws(
          () =>
            resolveConfig({
              topic: 'T',
              judge: { id: 'j1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'J', disableHooks: badVal }
            }),
          /disableHooks/
        );
        assert.throws(
          () =>
            resolveConfig({
              topic: 'T',
              judge: { id: 'j1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'J', ignoreUserConfig: badVal }
            }),
          /ignoreUserConfig/
        );
        assert.throws(
          () =>
            resolveConfig({
              topic: 'T',
              seats: [
                { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'S1', disableHooks: badVal },
                { id: 's2', harness: 'codex', model: 'gpt-6.1-sol (max)', soul: 'S2' }
              ]
            }),
          /disableHooks/
        );
        assert.throws(
          () =>
            resolveConfig({
              topic: 'T',
              seats: [
                { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'S1', ignoreUserConfig: badVal },
                { id: 's2', harness: 'codex', model: 'gpt-6.1-sol (max)', soul: 'S2' }
              ]
            }),
          /ignoreUserConfig/
        );

        const directVal = validateConfig({
          topic: 'T',
          maxRounds: 1,
          minQuorum: 2,
          maxClarificationBatches: 0,
          maxRetriesPerSeat: 0,
          disableHooks: badVal,
          ignoreUserConfig: badVal
        });
        assert.equal(directVal.valid, false);
        assert.ok(directVal.errors.some((e) => e.includes('disableHooks')));
        assert.ok(directVal.errors.some((e) => e.includes('ignoreUserConfig')));
      }
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

  describe('recordProviderCall: Observer Isolation (Issue #36)', () => {
    it('isolates throwing onCallRecord, context.onCallRecord, and context.telemetry.emitProviderCall independently', () => {
      const calls = [];
      assert.doesNotThrow(() => {
        recordProviderCall({
          onCallRecord: (rec) => {
            calls.push(`onCallRecord:${rec.provider}`);
            throw new Error('onCallRecord failed');
          },
          context: {
            tools: 'read-only',
            onCallRecord: (rec) => {
              calls.push(`context.onCallRecord:${rec.provider}`);
              throw new Error('context.onCallRecord failed');
            },
            telemetry: {
              emitProviderCall: (rec) => {
                calls.push(`telemetry.emitProviderCall:${rec.provider}`);
                throw new Error('emitProviderCall failed');
              }
            }
          },
          record: {
            participantId: 's1',
            provider: 'codex',
            argv: ['exec'],
            exitCode: 0,
            durationMs: 12
          }
        });
      });

      assert.deepEqual(calls, [
        'onCallRecord:codex',
        'context.onCallRecord:codex',
        'telemetry.emitProviderCall:codex'
      ]);
    });

    it('prevents observer errors from failing successful runAntigravityCli, runCodexCli, or runCursorCli calls or double-recording', async () => {
      const runners = [
        { name: 'antigravity', fn: runAntigravityCli, model: 'gemini-3.1-pro (high)', stdout: '{"response":"ok-agy"}' },
        { name: 'codex', fn: runCodexCli, model: 'gpt-6-astra (max)', stdout: 'ok-codex' },
        { name: 'cursor', fn: runCursorCli, model: 'grok-4.7-high', stdout: 'ok-cursor' }
      ];

      for (const r of runners) {
        const records = [];
        let execCount = 0;
        const out = await r.fn({
          model: r.model,
          prompt: 'Prompt',
          exec: async () => {
            execCount += 1;
            return { stdout: r.stdout, stderr: '', exitCode: 0 };
          },
          onCallRecord: (rec) => {
            records.push({ source: 'direct', exitCode: rec.exitCode });
            throw new Error(`observer crash in ${r.name}`);
          },
          context: {
            seatId: 's1',
            onCallRecord: (rec) => {
              records.push({ source: 'context', exitCode: rec.exitCode });
              throw new Error(`context observer crash in ${r.name}`);
            },
            telemetry: {
              emitProviderCall: (rec) => {
                records.push({ source: 'telemetry', exitCode: rec.exitCode });
                throw new Error(`telemetry crash in ${r.name}`);
              }
            }
          }
        });

        assert.equal(out, `ok-${r.name === 'antigravity' ? 'agy' : r.name}`);
        assert.equal(execCount, 1, `${r.name} must only execute once`);
        assert.deepEqual(records, [
          { source: 'direct', exitCode: 0 },
          { source: 'context', exitCode: 0 },
          { source: 'telemetry', exitCode: 0 }
        ]);
      }
    });

    it('preserves original CLI error when exec fails and observer callbacks throw', async () => {
      const runners = [
        { name: 'antigravity', fn: runAntigravityCli, model: 'gemini-3.1-pro (high)' },
        { name: 'codex', fn: runCodexCli, model: 'gpt-6-astra (max)' },
        { name: 'cursor', fn: runCursorCli, model: 'grok-4.7-high' }
      ];

      for (const r of runners) {
        const originalError = new Error(`${r.name} execution failure`);
        originalError.exitCode = 42;

        await assert.rejects(
          async () =>
            r.fn({
              model: r.model,
              prompt: 'Prompt',
              exec: async () => {
                throw originalError;
              },
              onCallRecord: () => {
                throw new Error('observer failure should not mask original CLI error');
              },
              context: {
                onCallRecord: () => {
                  throw new Error('context observer failure should not mask original CLI error');
                },
                telemetry: {
                  emitProviderCall: () => {
                    throw new Error('telemetry failure should not mask original CLI error');
                  }
                }
              }
            }),
          (err) => {
            assert.strictEqual(err, originalError);
            return true;
          }
        );
      }
    });

    it('does not break runCursorCli ENOENT fallback when observer callbacks throw', async () => {
      const bins = [];
      const out = await runCursorCli({
        model: 'grok-4.7-high',
        prompt: 'Fallback prompt',
        exec: async (bin) => {
          bins.push(bin);
          if (bin === 'cursor-agent') {
            const err = new Error('spawn cursor-agent ENOENT');
            err.code = 'ENOENT';
            throw err;
          }
          return { stdout: 'fallback-ok', stderr: '', exitCode: 0 };
        },
        onCallRecord: () => {
          throw new Error('fallback observer crash');
        }
      });

      assert.equal(out, 'fallback-ok');
      assert.deepEqual(bins, ['cursor-agent', 'agent']);
    });
  });

  describe('extractCanonicalBaseModel', () => {
    it('extracts canonical base model and enforces no-double-effort and single-suffix rules', async () => {
      const { extractCanonicalBaseModel } = await import('../../src/harness/cli-runner.js');
      assert.equal(typeof extractCanonicalBaseModel, 'function');

      assert.equal(extractCanonicalBaseModel('gpt-6-astra (max)'), 'gpt-6-astra');
      assert.equal(extractCanonicalBaseModel('gpt-6.1-sol (high)'), 'gpt-6.1-sol');
      assert.equal(extractCanonicalBaseModel('gemini-4-argon-high'), 'gemini-4-argon');
      assert.equal(extractCanonicalBaseModel('claude-opus-5-5-high'), 'claude-opus-5-5');
      assert.equal(extractCanonicalBaseModel('grok-4.7-xhigh'), 'grok-4.7');
      assert.equal(extractCanonicalBaseModel('composer-2.5'), 'composer-2.5');

      // Double-effort with parens + suffix must NOT strip suffix
      assert.equal(extractCanonicalBaseModel('gpt-6-astra-high (max)'), 'gpt-6-astra-high');

      // Double-suffix without parens must only strip a single trailing effort suffix
      assert.equal(extractCanonicalBaseModel('gpt-6-astra-high-max'), 'gpt-6-astra-high');

      // Throws on unsupported effort
      assert.throws(() => extractCanonicalBaseModel('gpt-6-astra (ultra)'), /Unsupported reasoning effort/);
    });
  });

  describe('Issue #56: Error Redaction, Event Stream Trace Capture & Verified Skill Attribution', () => {
    it('redacts 4KB prompt from error.message and error.cmd when execCli or runner fails', async () => {
      const secret4kbPrompt = 'SECRET_DELIBERATION_PAYLOAD_'.repeat(160);
      await assert.rejects(
        async () => {
          await execCli(process.execPath, ['-e', 'console.error("Workspace Trust Required"); process.exit(2);', secret4kbPrompt], {
            prompt: secret4kbPrompt,
            timeoutMs: 2000
          });
        },
        (err) => {
          assert.equal(err.exitCode, 2);
          assert.ok(!err.message.includes(secret4kbPrompt), 'error.message must not leak the 4KB prompt');
          assert.match(err.message, /\[REDACTED prompt: length=/);
          assert.match(err.message, /Workspace Trust Required/);
          if (typeof err.cmd === 'string') {
            assert.ok(!err.cmd.includes(secret4kbPrompt), 'error.cmd must not leak the 4KB prompt');
          }
          return true;
        }
      );
    });

    it('parses Codex --json JSONL event stream, extracts final response, toolCalls, and verified SKILL.md reads with traceCoverage="full"', async () => {
      let recordedCall = null;
      const jsonlStream = [
        JSON.stringify({ type: 'thread.started', thread_id: 'thr_1' }),
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_1',
            type: 'command_execution',
            command: 'cat .agents/skills/ask-council/SKILL.md',
            status: 'completed',
            exit_code: 0
          }
        }),
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_2',
            type: 'mcp_tool_call',
            server: 'codegraph',
            tool: 'codegraph_explore',
            arguments: { path: 'skills/safe-refactor/SKILL.md' },
            status: 'completed'
          }
        }),
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_3',
            type: 'agent_message',
            text: '{"kind":"check","statement":"Verified","source":"src/index.js:1","scope":"unit"}'
          }
        })
      ].join('\n');

      const out = await runCodexCli({
        model: 'gpt-6-astra (max)',
        prompt: 'Submit proof',
        context: { seatId: 'astra-voter' },
        onCallRecord: (rec) => {
          recordedCall = rec;
        },
        exec: async () => ({ stdout: jsonlStream, stderr: '', exitCode: 0 })
      });

      assert.equal(out, '{"kind":"check","statement":"Verified","source":"src/index.js:1","scope":"unit"}');
      assert.ok(recordedCall);
      assert.equal(recordedCall.trace.traceCoverage, 'full');
      assert.equal(recordedCall.trace.toolCalls.length, 2);
      assert.equal(recordedCall.trace.toolCalls[0].kind, 'command_execution');
      assert.equal(recordedCall.trace.toolCalls[1].kind, 'mcp_tool_call');
      assert.deepEqual(recordedCall.trace.skillsRead, [
        { skill: 'ask-council', evidence: 'skill_instructions_read' },
        { skill: 'safe-refactor', evidence: 'skill_instructions_read' }
      ]);
    });

    it('parses Cursor --output-format stream-json event stream, passes --trust, and extracts tool/skill telemetry with traceCoverage="full"', async () => {
      let capturedArgs = null;
      let recordedCall = null;
      const streamJson = [
        JSON.stringify({ type: 'system', subtype: 'init' }),
        JSON.stringify({
          type: 'tool_call',
          subtype: 'started',
          tool_call: {
            readToolCall: {
              args: { path: '/repo/skills/ask-council/SKILL.md' }
            }
          }
        }),
        JSON.stringify({
          type: 'result',
          result: '{"vote":"accept","citedProofIds":["P-1"]}'
        })
      ].join('\n');

      const out = await runCursorCli({
        model: 'grok-4.7-xhigh',
        prompt: 'Vote on candidate',
        context: { seatId: 'grok-voter' },
        onCallRecord: (rec) => {
          recordedCall = rec;
        },
        exec: async (_bin, args) => {
          capturedArgs = args;
          return { stdout: streamJson, stderr: '', exitCode: 0 };
        }
      });

      assert.ok(capturedArgs.includes('--trust'), 'Cursor CLI args must include --trust');
      assert.ok(capturedArgs.includes('stream-json'), 'Cursor CLI args must include stream-json');
      assert.equal(out, '{"vote":"accept","citedProofIds":["P-1"]}');
      assert.ok(recordedCall);
      assert.equal(recordedCall.trace.traceCoverage, 'full');
      assert.equal(recordedCall.trace.toolCalls.length, 1);
      assert.deepEqual(recordedCall.trace.skillsRead, [
        { skill: 'ask-council', evidence: 'skill_instructions_read' }
      ]);
    });

    it('records traceCoverage="unavailable" for Antigravity CLI when no tool-event stream is exposed', async () => {
      let recordedCall = null;
      const out = await runAntigravityCli({
        model: 'gemini-4-argon (high)',
        prompt: 'Deliberate',
        context: { seatId: 'argon-voter' },
        onCallRecord: (rec) => {
          recordedCall = rec;
        },
        exec: async () => ({ stdout: '{"response":"{\\"vote\\":\\"accept\\"}"}', stderr: '', exitCode: 0 })
      });

      assert.equal(out, '{"vote":"accept"}');
      assert.ok(recordedCall);
      assert.equal(recordedCall.trace.traceCoverage, 'unavailable');
      assert.deepEqual(recordedCall.trace.toolCalls, []);
      assert.deepEqual(recordedCall.trace.skillsRead, []);
    });
  });
});




