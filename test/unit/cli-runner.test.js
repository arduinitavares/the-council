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
  runCursorCli
} from '../../src/harness/cli-runner.js';

describe('Unit: Direct CLI Outbound Runner (src/harness/cli-runner.js)', () => {
  describe('parseModelAndEffort', () => {
    it('parses model and effort from parenthesized model string', () => {
      const res1 = parseModelAndEffort('gpt-6-astra (max)');
      assert.deepEqual(res1, { model: 'gpt-6-astra', effort: 'max', codexEffort: 'xhigh' });

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
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '-m',
        'gpt-6-astra',
        '-c',
        'model_reasoning_effort="xhigh"',
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
});

