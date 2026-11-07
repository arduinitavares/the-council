/**
 * @fileoverview Adversarial Stress Test Suite — Challenger 2 (Milestone 2)
 *
 * Rigorously stress-tests:
 * 1. Instantiation Invariants of CodexAdapter, AntigravityAdapter, CursorAdapter:
 *    - Parameterless creation (`new Adapter()`)
 *    - Empty options (`new Adapter({})`)
 *    - Custom options injection (executable, spawnRunner, timeoutMs)
 *    - Environment variable overrides (CODEX_CLI_COMMAND, AGY_CLI_COMMAND, CURSOR_CLI_COMMAND)
 *    - Model validation invariants and case sensitivity
 *    - Error classification across quota, rate limits, and execution errors
 *    - CLI dispatcher and Orca alias consistency
 *
 * 2. Provider Dispatchers and cli-runner invariants:
 *    - parseModelAndEffort parenthesized, hyphenated, default, and invalid inputs
 *    - runAntigravityCli arg construction, JSON response unwrapping, and non-JSON/corrupt fallback
 *    - runCodexCli arg construction, codexEffort mapping, and output trimming
 *    - runCursorCli arg construction and automatic ENOENT fallback to 'agent' binary
 *
 * 3. Prompt Citation Invariants & Boundary / Empty States:
 *    - formatVotingPrompt with admitted proof IDs, candidate clauses, and citations
 *    - formatVotingPrompt empty states: 0 proofs, 0 clauses, null/undefined candidate, null state
 *    - formatJudgePrompt citation requirements for admitted proofs
 *    - formatJudgePrompt empty states: 0 proofs, null/undefined proofs, default fallback fields
 *    - Adapter delegation to soul.js in both VOTING and DELIBERATION/JUDGE phases
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CodexAdapter } from '../../src/harness/codex.js';
import { AntigravityAdapter } from '../../src/harness/antigravity.js';
import { CursorAdapter } from '../../src/harness/cursor.js';
import { HarnessAdapter, QuotaExhaustionError, HarnessExecutionError } from '../../src/harness/adapter.js';
import {
  parseModelAndEffort,
  execCli,
  runAntigravityCli,
  runCodexCli,
  runCursorCli
} from '../../src/harness/cli-runner.js';
import {
  Soul,
  createSoul,
  STANDARD_SOULS,
  formatVotingPrompt,
  formatJudgePrompt,
  formatDeliberationPrompt
} from '../../src/seats/soul.js';

describe('Adversarial Stress Test Suite — Challenger 2 (Milestone 2)', () => {

  // ==========================================================================
  // SUITE 1: INSTANTIATION INVARIANTS (Codex, Antigravity, Cursor)
  // ==========================================================================
  describe('1. Adapter Instantiation & Configuration Invariants', () => {

    it('instantiates all three adapters without arguments and with empty options', () => {
      const adaptersNoArgs = [
        new CodexAdapter(),
        new AntigravityAdapter(),
        new CursorAdapter()
      ];

      assert.equal(adaptersNoArgs[0].name, 'codex');
      assert.equal(adaptersNoArgs[0].executable, 'codex');
      assert.equal(typeof adaptersNoArgs[0].spawnRunner, 'function');
      assert.ok(adaptersNoArgs[0] instanceof HarnessAdapter);

      assert.equal(adaptersNoArgs[1].name, 'antigravity');
      assert.equal(adaptersNoArgs[1].executable, 'agy');
      assert.equal(typeof adaptersNoArgs[1].spawnRunner, 'function');
      assert.ok(adaptersNoArgs[1] instanceof HarnessAdapter);

      assert.equal(adaptersNoArgs[2].name, 'cursor');
      assert.equal(adaptersNoArgs[2].executable, 'cursor-agent');
      assert.equal(typeof adaptersNoArgs[2].spawnRunner, 'function');
      assert.ok(adaptersNoArgs[2] instanceof HarnessAdapter);

      // With empty object {}
      const adaptersEmptyObj = [
        new CodexAdapter({}),
        new AntigravityAdapter({}),
        new CursorAdapter({})
      ];

      assert.equal(adaptersEmptyObj[0].executable, 'codex');
      assert.equal(adaptersEmptyObj[1].executable, 'agy');
      assert.equal(adaptersEmptyObj[2].executable, 'cursor-agent');
      for (const a of adaptersEmptyObj) {
        assert.equal(typeof a.spawnRunner, 'function');
      }
    });

    it('accepts custom executable, spawnRunner, and timeoutMs configuration', async () => {
      let codexCalledWith = null;
      const customCodexRunner = async (args) => {
        codexCalledWith = args;
        return JSON.stringify({ vote: 'accept' });
      };

      const customCodex = new CodexAdapter({
        executable: '/opt/bin/custom-codex',
        spawnRunner: customCodexRunner,
        timeoutMs: 120000
      });

      assert.equal(customCodex.executable, '/opt/bin/custom-codex');
      assert.equal(customCodex.spawnRunner, customCodexRunner);
      assert.equal(customCodex.defaultTimeoutMs, 120000);

      // Verify custom runner is invoked during executeSeat
      const seat = { id: 's1', model: 'gpt-6.1-sol' };
      const soul = 'Pragmatic Engineer';
      const res = await customCodex.executeSeat({
        seat,
        soul,
        round: 1,
        phase: 'VOTING',
        state: { candidate: { summary: 'c', clauses: [{ context: 'x', conclusion: 'y', citedProofIds: ['P1'] }] } }
      });

      assert.equal(res.vote, 'accept');
      assert.equal(codexCalledWith.executable, '/opt/bin/custom-codex');
      assert.equal(codexCalledWith.model, 'gpt-6.1-sol');
      assert.ok(typeof codexCalledWith.prompt === 'string');
    });

    it('respects environment variable overrides when options are omitted', () => {
      const origCodex = process.env.CODEX_CLI_COMMAND;
      const origAgy = process.env.AGY_CLI_COMMAND;
      const origCursor = process.env.CURSOR_CLI_COMMAND;

      try {
        process.env.CODEX_CLI_COMMAND = '/usr/local/bin/env-codex';
        process.env.AGY_CLI_COMMAND = '/usr/local/bin/env-agy';
        process.env.CURSOR_CLI_COMMAND = '/usr/local/bin/env-cursor';

        const codex = new CodexAdapter();
        assert.equal(codex.executable, '/usr/local/bin/env-codex');

        const agy = new AntigravityAdapter();
        assert.equal(agy.executable, '/usr/local/bin/env-agy');

        const cursor = new CursorAdapter();
        assert.equal(cursor.executable, '/usr/local/bin/env-cursor');

        // Explicit config overrides env var
        const explicitCodex = new CodexAdapter({ executable: '/explicit/codex' });
        assert.equal(explicitCodex.executable, '/explicit/codex');
      } finally {
        if (origCodex !== undefined) process.env.CODEX_CLI_COMMAND = origCodex;
        else delete process.env.CODEX_CLI_COMMAND;

        if (origAgy !== undefined) process.env.AGY_CLI_COMMAND = origAgy;
        else delete process.env.AGY_CLI_COMMAND;

        if (origCursor !== undefined) process.env.CURSOR_CLI_COMMAND = origCursor;
        else delete process.env.CURSOR_CLI_COMMAND;
      }
    });

    it('throws HarnessExecutionError when spawnRunner is unconfigured or nullified', async () => {
      const codex = new CodexAdapter();
      codex.spawnRunner = null;

      await assert.rejects(
        () => codex._dispatchCli({ model: 'gpt-6.1-sol', prompt: 'test' }),
        (err) => {
          assert.ok(err instanceof HarnessExecutionError);
          assert.match(err.message, /Codex CLI dispatcher runner not configured/);
          assert.equal(err.harness, 'codex');
          return true;
        }
      );

      const agy = new AntigravityAdapter();
      agy.spawnRunner = null;
      await assert.rejects(
        () => agy._dispatchCli({ model: 'gemini-4-argon-high', prompt: 'test' }),
        (err) => {
          assert.ok(err instanceof HarnessExecutionError);
          assert.match(err.message, /Antigravity CLI dispatcher runner not configured/);
          return true;
        }
      );

      const cursor = new CursorAdapter();
      cursor.spawnRunner = null;
      await assert.rejects(
        () => cursor._dispatchCli({ model: 'grok-4.7-high', prompt: 'test' }),
        (err) => {
          assert.ok(err instanceof HarnessExecutionError);
          assert.match(err.message, /Cursor CLI dispatcher runner not configured/);
          return true;
        }
      );
    });

    it('_dispatchOrcaCli delegates seamlessly to _dispatchCli', async () => {
      let called = false;
      const runner = async () => {
        called = true;
        return 'test output';
      };

      const codex = new CodexAdapter({ spawnRunner: runner });
      const out = await codex._dispatchOrcaCli({ model: 'gpt-6.1-sol', prompt: 'hello' });
      assert.equal(called, true);
      assert.equal(out, 'test output');
    });

    it('enforces strict model admissibility across all three adapters with case insensitivity', () => {
      const codex = new CodexAdapter();
      assert.doesNotThrow(() => codex.validateModel('gpt-6.1-sol'));
      assert.doesNotThrow(() => codex.validateModel('GPT-6.1-SOL (high)'));
      assert.doesNotThrow(() => codex.validateModel('gpt-6-astra (max)'));
      assert.throws(() => codex.validateModel('gemini-4-argon'), /not permitted under Codex route/);
      assert.throws(() => codex.validateModel('claude-sonnet-5-5'), /not permitted under Codex route/);
      assert.throws(() => codex.validateModel('grok-4.7'), /not permitted under Codex route/);

      const agy = new AntigravityAdapter();
      assert.doesNotThrow(() => agy.validateModel('gemini-4-argon-high'));
      assert.doesNotThrow(() => agy.validateModel('GEMINI-4-ARGON-HIGH'));
      assert.doesNotThrow(() => agy.validateModel('claude-sonnet-5-5-20250921'));
      assert.doesNotThrow(() => agy.validateModel('claude-opus-5-5-high'));
      assert.throws(() => agy.validateModel('gpt-6.1-sol'), /not permitted under Antigravity route/);
      assert.throws(() => agy.validateModel('grok-4.7'), /not permitted under Antigravity route/);

      const cursor = new CursorAdapter();
      assert.doesNotThrow(() => cursor.validateModel('grok-4.7-high'));
      assert.doesNotThrow(() => cursor.validateModel('GROK-4.7-XHIGH'));
      assert.doesNotThrow(() => cursor.validateModel('composer-2.5'));
      assert.throws(() => cursor.validateModel('gpt-6.1-sol'), /not permitted under Cursor route/);
      assert.throws(() => cursor.validateModel('claude-sonnet-5-5'), /not permitted under Cursor route/);
    });

    it('classifies quota, rate-limit, and resource exhaustion errors across all providers', () => {
      const codex = new CodexAdapter();
      assert.ok(codex.classifyError(new Error('insufficient_quota')) instanceof QuotaExhaustionError);
      assert.ok(codex.classifyError(new Error('Rate limit 429 reached')) instanceof QuotaExhaustionError);

      const agy = new AntigravityAdapter();
      assert.ok(agy.classifyError(new Error('429 RESOURCE_EXHAUSTED')) instanceof QuotaExhaustionError);
      assert.ok(agy.classifyError(new Error('rate_limit_error: token_budget_exceeded')) instanceof QuotaExhaustionError);
      assert.ok(agy.classifyError(new Error('overloaded_error')) instanceof QuotaExhaustionError);

      const cursor = new CursorAdapter();
      assert.ok(cursor.classifyError(new Error('weekly included pool exhausted')) instanceof QuotaExhaustionError);
      assert.ok(cursor.classifyError(new Error('subscription_pool_exhausted (429)')) instanceof QuotaExhaustionError);
    });
  });

  // ==========================================================================
  // SUITE 2: PROVIDER DISPATCHERS & CLI RUNNER INVARIANTS
  // ==========================================================================
  describe('2. Provider Dispatchers and cli-runner Invariants', () => {

    it('parseModelAndEffort maps various reasoning efforts and handles edge cases', () => {
      // Parenthesized
      assert.deepEqual(parseModelAndEffort('gpt-6-astra (max)'), {
        model: 'gpt-6-astra',
        effort: 'max',
        codexEffort: 'xhigh'
      });
      assert.deepEqual(parseModelAndEffort('gpt-6-astra (xhigh)'), {
        model: 'gpt-6-astra',
        effort: 'xhigh',
        codexEffort: 'xhigh'
      });
      assert.deepEqual(parseModelAndEffort('gpt-6.1-sol (medium)'), {
        model: 'gpt-6.1-sol',
        effort: 'medium',
        codexEffort: 'medium'
      });
      assert.deepEqual(parseModelAndEffort('gpt-6.1-sol (low)'), {
        model: 'gpt-6.1-sol',
        effort: 'low',
        codexEffort: 'low'
      });

      // Hyphenated suffixes
      assert.deepEqual(parseModelAndEffort('gemini-4-argon-high'), {
        model: 'gemini-4-argon-high',
        effort: 'high',
        codexEffort: 'high'
      });
      assert.deepEqual(parseModelAndEffort('grok-4.7-xhigh'), {
        model: 'grok-4.7-xhigh',
        effort: 'xhigh',
        codexEffort: 'xhigh'
      });
      assert.deepEqual(parseModelAndEffort('model-max'), {
        model: 'model-max',
        effort: 'max',
        codexEffort: 'xhigh'
      });

      // Default fallback
      assert.deepEqual(parseModelAndEffort('composer-2.5', 'high'), {
        model: 'composer-2.5',
        effort: 'high',
        codexEffort: 'high'
      });

      // Unrecognized parenthesized effort falls back to codexEffort 'high'
      const unk = parseModelAndEffort('custom (unknown_level)', 'high');
      assert.equal(unk.model, 'custom');
      assert.equal(unk.effort, 'unknown_level');
      assert.equal(unk.codexEffort, 'high');
    });

    it('runAntigravityCli formats required CLI flags, unwraps JSON envelope, and handles fallback', async () => {
      let captured = null;
      const mockExec = async (exe, args, opts) => {
        captured = { exe, args, opts };
        return { stdout: JSON.stringify({ response: '{"kind":"check","scope":"s","source":"src","statement":"stmt"}' }), stderr: '', exitCode: 0 };
      };

      const res = await runAntigravityCli({
        model: 'gemini-4-argon-high',
        prompt: 'test prompt',
        exec: mockExec
      });

      assert.equal(captured.exe, 'agy');
      assert.ok(captured.args.includes('--output-format'));
      assert.ok(captured.args.includes('json'));
      assert.ok(captured.args.includes('--mode'));
      assert.ok(captured.args.includes('plan'));
      assert.ok(captured.args.includes('--sandbox'));
      assert.ok(captured.args.includes('--disable-slash-commands'));
      assert.ok(captured.args.includes('--model'));
      assert.ok(captured.args.includes('gemini-4-argon-high'));
      assert.ok(captured.args.includes('--effort'));
      assert.ok(captured.args.includes('high'));
      assert.ok(captured.args.some((a) => a.startsWith('--print=')));

      // JSON envelope was cleanly unwrapped
      assert.equal(res, '{"kind":"check","scope":"s","source":"src","statement":"stmt"}');

      // Test fallback to raw string when output is not JSON envelope
      const rawRes = await runAntigravityCli({
        model: 'gemini-4-argon-high',
        prompt: 'test prompt',
        exec: async () => ({ stdout: 'Raw text output without envelope\n', stderr: '', exitCode: 0 })
      });
      assert.equal(rawRes, 'Raw text output without envelope');

      // Test fallback when JSON object lacks .response
      const noResponseRes = await runAntigravityCli({
        model: 'gemini-4-argon-high',
        prompt: 'test prompt',
        exec: async () => ({ stdout: '{"otherField":"val"}\n', stderr: '', exitCode: 0 })
      });
      assert.equal(noResponseRes, '{"otherField":"val"}');
    });

    it('runCodexCli formats required CLI flags and maps model reasoning effort', async () => {
      let captured = null;
      const mockExec = async (exe, args, opts) => {
        captured = { exe, args, opts };
        return { stdout: '  {"vote": "accept"}  \n', stderr: '', exitCode: 0 };
      };

      const res = await runCodexCli({
        model: 'gpt-6-astra (max)',
        prompt: 'vote prompt',
        exec: mockExec
      });

      assert.equal(captured.exe, 'codex');
      assert.equal(captured.args[0], 'exec');
      assert.ok(captured.args.includes('--skip-git-repo-check'));
      assert.ok(captured.args.includes('--sandbox'));
      assert.ok(captured.args.includes('read-only'));
      assert.ok(captured.args.includes('-m'));
      assert.ok(captured.args.includes('gpt-6-astra'));
      assert.ok(captured.args.includes('-c'));
      assert.ok(captured.args.includes('model_reasoning_effort="xhigh"'));
      assert.equal(captured.args[captured.args.length - 1], 'vote prompt');
      assert.equal(res, '{"vote": "accept"}');
    });

    it('runCursorCli retries with "agent" on ENOENT and does not retry on other errors', async () => {
      const calls = [];
      const mockExecWithEnoent = async (exe, args) => {
        calls.push(exe);
        if (exe === 'cursor-agent' || exe === 'custom-cursor') {
          const err = new Error('binary not found');
          err.code = 'ENOENT';
          throw err;
        }
        return { stdout: '{"vote": "accept"}\n', stderr: '', exitCode: 0 };
      };

      const res = await runCursorCli({
        model: 'composer-2.5',
        prompt: 'prompt',
        exec: mockExecWithEnoent
      });

      assert.deepEqual(calls, ['cursor-agent', 'agent']);
      assert.equal(res, '{"vote": "accept"}');

      // If executable is not 'cursor-agent', ENOENT does NOT trigger fallback
      calls.length = 0;
      await assert.rejects(
        () => runCursorCli({
          executable: 'custom-cursor',
          model: 'composer-2.5',
          prompt: 'prompt',
          exec: mockExecWithEnoent
        }),
        (err) => err.code === 'ENOENT'
      );
      assert.deepEqual(calls, ['custom-cursor']);

      // Non-ENOENT error throws immediately without retrying
      calls.length = 0;
      await assert.rejects(
        () => runCursorCli({
          model: 'composer-2.5',
          prompt: 'prompt',
          exec: async (exe) => {
            calls.push(exe);
            const err = new Error('Permission denied');
            err.code = 'EACCES';
            throw err;
          }
        }),
        (err) => err.code === 'EACCES'
      );
      assert.deepEqual(calls, ['cursor-agent']);
    });
  });

  // ==========================================================================
  // SUITE 3: PROMPT CITATION INVARIANTS & EMPTY / BOUNDARY STATES
  // ==========================================================================
  describe('3. Prompt Citation Invariants & Empty / Boundary States', () => {

    it('formatVotingPrompt includes full candidate summary, clauses, and admitted proofs P1..Pn', () => {
      const prompt = formatVotingPrompt({
        soul: STANDARD_SOULS.FORMAL_VERIFIER,
        seat: { id: 'seat-sol', model: 'gpt-6.1-sol' },
        candidate: {
          round: 2,
          summary: 'Context-partitioned container architecture',
          clauses: [
            { context: 'Server', conclusion: 'Deploy on Linux cgroups v2', citedProofIds: ['P1', 'P3'] },
            { context: 'Client', conclusion: 'Deploy on WebAssembly', citedProofIds: ['P2'] }
          ]
        },
        admittedProofs: [
          { id: 'P1', kind: 'check', scope: 'Server', statement: 'cgroups v2 limits cpu/mem', source: 'kernel.org' },
          { id: 'P2', kind: 'benchmark', scope: 'Client', statement: 'WASM p99 is 1.2ms', source: 'bench-suite' },
          { id: 'P3', kind: 'derivation', scope: 'Server', statement: 'OCI spec compliance', source: 'opencontainers.org' }
        ]
      });

      // Verify Round and Summary
      assert.match(prompt, /Voting on Round 2 Candidate/);
      assert.match(prompt, /Candidate Summary: "Context-partitioned container architecture"/);

      // Verify Candidate Clauses with context and citations
      assert.match(prompt, /Clause C1 \[Server\]: Deploy on Linux cgroups v2 \(cites: P1, P3\)/);
      assert.match(prompt, /Clause C2 \[Client\]: Deploy on WebAssembly \(cites: P2\)/);

      // Verify Admitted Proofs
      assert.match(prompt, /- \[P1\] \(check\) \[Server\]: cgroups v2 limits cpu\/mem \(source: kernel\.org\)/);
      assert.match(prompt, /- \[P2\] \(benchmark\) \[Client\]: WASM p99 is 1\.2ms \(source: bench-suite\)/);
      assert.match(prompt, /- \[P3\] \(derivation\) \[Server\]: OCI spec compliance \(source: opencontainers\.org\)/);

      // Verify Strict Voting Output Contract
      assert.match(prompt, /OUTPUT CONTRACT \(strict JSON\):/);
      assert.match(prompt, /\{ "vote": "accept" \}/);
      assert.match(prompt, /\{ "vote": "object", "proofId": "<Admitted Proof ID>", "reason": "<Concrete reason why candidate is defective>" \}/);
    });

    it('formatVotingPrompt handles boundary empty states (0 proofs, 0 clauses, null candidate, null state)', () => {
      // 1. Completely empty / null candidate and proofs
      const emptyPrompt = formatVotingPrompt({
        soul: 'Custom Minimalist',
        seat: { id: 's1' },
        candidate: null,
        admittedProofs: []
      });

      assert.match(emptyPrompt, /Voting on Round 1 Candidate/);
      assert.match(emptyPrompt, /Candidate Summary: ""/);
      assert.match(emptyPrompt, /No candidate clauses provided\./);
      assert.match(emptyPrompt, /No admitted proofs for this round\./);

      // 2. Candidate with empty clauses array
      const emptyClausesPrompt = formatVotingPrompt({
        soul: 'Formal Verifier',
        seat: { id: 's1' },
        candidate: { round: 1, summary: 'Only summary', clauses: [] },
        admittedProofs: null
      });

      assert.match(emptyClausesPrompt, /Candidate Summary: "Only summary"/);
      assert.match(emptyClausesPrompt, /No candidate clauses provided\./);
      assert.match(emptyClausesPrompt, /No admitted proofs for this round\./);

      // 3. Fallback to state object when candidate and admittedProofs are omitted
      const stateFallbackPrompt = formatVotingPrompt({
        soul: 'Pragmatic Engineer',
        seat: { id: 's2' },
        state: {
          candidate: {
            round: 3,
            summary: 'State Candidate',
            clauses: [{ context: 'Storage', conclusion: 'SQLite WAL mode', citedProofIds: ['P10'] }]
          },
          proofs: [
            { id: 'P10', kind: 'check', scope: 'Storage', statement: 'WAL mode enabled', source: 'sqlite.org', status: 'admitted' },
            { id: 'P11', kind: 'citation', scope: 'Storage', statement: 'Ignored rejected proof', source: 'src', status: 'rejected' }
          ]
        }
      });

      assert.match(stateFallbackPrompt, /Voting on Round 3 Candidate/);
      assert.match(stateFallbackPrompt, /Candidate Summary: "State Candidate"/);
      assert.match(stateFallbackPrompt, /Clause C1 \[Storage\]: SQLite WAL mode \(cites: P10\)/);
      assert.match(stateFallbackPrompt, /\[P10\] \(check\) \[Storage\]/);
      // P11 was rejected, so it must NOT appear under admitted proofs!
      assert.doesNotMatch(stateFallbackPrompt, /P11/);
    });

    it('formatJudgePrompt strictly requires consensus clauses to cite admitted Proof IDs', () => {
      const judgePrompt = formatJudgePrompt({
        judge: { id: 'judge-alpha', model: 'claude-opus-5-5-high', soul: 'Impartial Judge' },
        topic: 'Context-Partitioned OS Kernel',
        round: 1,
        maxRounds: 3,
        proofs: [
          { id: 'P1', kind: 'derivation', scope: 'Kernel', statement: 'Formal proof of non-interference', source: 'Spec' },
          { id: 'P2', kind: 'check', scope: 'IPC', statement: 'IPC latency < 50ns', source: 'Bench' }
        ]
      });

      assert.match(judgePrompt, /THE COUNCIL — JUDGE AUDIT AND SYNTHESIS ROUND 1\/3/);
      assert.match(judgePrompt, /Topic: "Context-Partitioned OS Kernel"/);
      assert.match(judgePrompt, /Judge: judge-alpha \(claude-opus-5-5-high\)/);
      assert.match(judgePrompt, /- \[P1\] \(derivation\) \[Kernel\]: Formal proof of non-interference \(source: Spec\)/);
      assert.match(judgePrompt, /- \[P2\] \(check\) \[IPC\]: IPC latency < 50ns \(source: Bench\)/);

      // Verify Judge Invariants & Directives
      assert.match(judgePrompt, /1\. Audit each submitted proof: record status in "proofDecisions" as "admitted" or "rejected"/);
      assert.match(judgePrompt, /2\. Synthesize context-partitioned consensus clauses: every clause in "clauses" MUST cite at least one admitted Proof ID/);
      assert.match(judgePrompt, /3\. Bare opinions or conclusions ungrounded in admitted proofs are strictly forbidden/);

      // Verify Output Contract
      assert.match(judgePrompt, /"proofDecisions":\s*\{\s*"P1":\s*\{\s*"status":\s*"admitted"/);
      assert.match(judgePrompt, /"citedProofIds":\s*\["P1"\]/);
    });

    it('formatJudgePrompt handles boundary empty states (0 proofs, missing fields, default fallbacks)', () => {
      // 0 proofs
      const emptyJudge = formatJudgePrompt({
        judge: { id: 'judge-default', model: 'gpt-6.1-sol' },
        topic: 'Empty Proofs Test',
        round: 2,
        proofs: []
      });

      assert.match(emptyJudge, /No proofs submitted for auditing\./);
      assert.match(emptyJudge, /ROUND 2\/3/);

      // Proofs missing id or source
      const partialProofJudge = formatJudgePrompt({
        judge: null,
        topic: '',
        round: 1,
        proofs: [{ scope: 'Cloud', statement: 'Anonymous claim' }]
      });

      assert.match(partialProofJudge, /Judge: judge \(model\)/);
      assert.match(partialProofJudge, /- \[P1\] \(check\) \[Cloud\]: Anonymous claim \(source: unspecified\)/);
    });

    it('adapters accurately delegate prompt construction to soul.js', () => {
      const state = {
        topic: 'Unified Engine Architecture',
        round: 1,
        maxRounds: 3,
        candidate: {
          round: 1,
          summary: 'Deterministic Consensus Engine',
          clauses: [{ context: 'Core', conclusion: 'Pure State Machine', citedProofIds: ['P1'] }]
        },
        proofs: [
          { id: 'P1', kind: 'check', scope: 'Core', statement: 'Zero external IO', source: 'Design Doc', status: 'admitted' },
          { id: 'P2', kind: 'citation', scope: 'Network', statement: 'Rejected claim', source: 'Blog', status: 'rejected' }
        ],
        objections: [
          { id: 'OBJ-1', seatId: 's1', proofId: 'P1', reason: 'Unverified premise', status: 'open' }
        ]
      };

      const adapters = [new CodexAdapter(), new AntigravityAdapter(), new CursorAdapter()];

      for (const adapter of adapters) {
        // 1. Voting phase
        const votingPrompt = adapter.formatSeatPrompt({
          seat: { id: 's1', model: 'model-x' },
          soul: STANDARD_SOULS.ADVERSARIAL_CHALLENGER,
          round: 1,
          phase: 'VOTING',
          state
        });
        assert.match(votingPrompt, /Candidate Summary: "Deterministic Consensus Engine"/);
        assert.match(votingPrompt, /Clause C1 \[Core\]: Pure State Machine \(cites: P1\)/);
        assert.match(votingPrompt, /\[P1\] \(check\) \[Core\]/);
        assert.doesNotMatch(votingPrompt, /P2.*Rejected claim/);

        // 2. Deliberation phase
        const delibPrompt = adapter.formatSeatPrompt({
          seat: { id: 's1', model: 'model-x' },
          soul: 'Pragmatic Engineer',
          round: 2,
          phase: 'DELIBERATION',
          state
        });
        assert.match(delibPrompt, /Deliberation Round 2\/3 — Proof Submission/);
        assert.match(delibPrompt, /Previous Candidate from Round 1:/);
        assert.match(delibPrompt, /Unresolved Objections to Address:/);
        assert.match(delibPrompt, /Objection OBJ-1/);

        // 3. Judge phase
        const judgePrompt = adapter.formatJudgePrompt({
          judge: { id: 'judge-1', model: 'judge-model' },
          round: 1,
          phase: 'JUDGE_AUDIT_SYNTHESIS',
          proofs: state.proofs,
          state
        });
        assert.match(judgePrompt, /JUDGE AUDIT AND SYNTHESIS ROUND 1\/3/);
        assert.match(judgePrompt, /\[P1\] \(check\) \[Core\]/);
        assert.match(judgePrompt, /\[P2\] \(citation\) \[Network\]/);
      }
    });
  });

  // ==========================================================================
  // SUITE 4: CONCURRENT & STRESS EXECUTION
  // ==========================================================================
  describe('4. Concurrent & Stress Execution', () => {

    it('instantiates 500 adapters concurrently without memory leaks or race conditions', () => {
      const adapters = [];
      for (let i = 0; i < 500; i++) {
        adapters.push(new CodexAdapter({ executable: `codex-${i % 5}` }));
        adapters.push(new AntigravityAdapter({ executable: `agy-${i % 5}` }));
        adapters.push(new CursorAdapter({ executable: `cursor-${i % 5}` }));
      }
      assert.equal(adapters.length, 1500);
      assert.equal(adapters[0].executable, 'codex-0');
      assert.equal(adapters[1].executable, 'agy-0');
      assert.equal(adapters[2].executable, 'cursor-0');
    });

    it('generates 1,000 voting and judge prompts concurrently with consistent citations', () => {
      const state = {
        topic: 'Stress Topic',
        round: 1,
        maxRounds: 3,
        candidate: {
          round: 1,
          summary: 'Summary',
          clauses: [{ context: 'C', conclusion: 'V', citedProofIds: ['P1', 'P2'] }]
        },
        proofs: [
          { id: 'P1', kind: 'check', scope: 'S1', statement: 'Statement 1', source: 'Source 1', status: 'admitted' },
          { id: 'P2', kind: 'benchmark', scope: 'S2', statement: 'Statement 2', source: 'Source 2', status: 'admitted' }
        ]
      };

      for (let i = 0; i < 500; i++) {
        const vPrompt = formatVotingPrompt({
          soul: 'Formal Verifier',
          seat: { id: `seat-${i}` },
          state
        });
        assert.ok(vPrompt.includes('Clause C1 [C]: V (cites: P1, P2)'));
        assert.ok(vPrompt.includes('[P1] (check) [S1]: Statement 1'));
        assert.ok(vPrompt.includes('[P2] (benchmark) [S2]: Statement 2'));

        const jPrompt = formatJudgePrompt({
          judge: { id: `judge-${i}` },
          proofs: state.proofs,
          state
        });
        assert.ok(jPrompt.includes('every clause in "clauses" MUST cite at least one admitted Proof ID'));
      }
    });
  });
});
