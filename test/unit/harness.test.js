import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HarnessAdapter,
  HarnessError,
  QuotaExhaustionError,
  TimeoutError,
  HarnessExecutionError,
  InvalidResponseError,
  AuthenticationError,
  CodexAdapter,
  AntigravityAdapter,
  CursorAdapter,
  MockAdapter,
  createHarnessAdapter,
  HarnessRegistry
} from '../../src/harness/index.js';

describe('Unit: Multi-Harness Adapters & Error Taxonomy (src/harness/)', () => {
  describe('Error Taxonomy', () => {
    it('constructs HarnessError with context metadata and cause', () => {
      const cause = new Error('Socket closed');
      const err = new HarnessError('Failed connection', {
        harness: 'codex',
        seatId: 'astra-1',
        model: 'gpt-6-astra',
        cause
      });

      assert.equal(err.name, 'HarnessError');
      assert.equal(err.message, 'Failed connection');
      assert.equal(err.harness, 'codex');
      assert.equal(err.seatId, 'astra-1');
      assert.equal(err.model, 'gpt-6-astra');
      assert.equal(err.cause, cause);
      assert.ok(err.timestamp);
    });

    it('identifies QuotaExhaustionError as retryable quota fault', () => {
      const err = new QuotaExhaustionError('Rate limit exceeded 429', {
        harness: 'cursor',
        seatId: 'grok-1'
      });

      assert.equal(err.name, 'QuotaExhaustionError');
      assert.equal(err.isQuotaFault, true);
      assert.equal(err.isRetryable, true);
    });

    it('identifies TimeoutError with timeoutMs', () => {
      const err = new TimeoutError('Execution timed out', { timeoutMs: 5000 });
      assert.equal(err.name, 'TimeoutError');
      assert.equal(err.timeoutMs, 5000);
      assert.equal(err.isRetryable, true);
    });

    it('identifies HarnessExecutionError with exitCode and stderr', () => {
      const err = new HarnessExecutionError('Process exited with code 1', {
        exitCode: 1,
        stderr: 'fatal: connection refused'
      });
      assert.equal(err.name, 'HarnessExecutionError');
      assert.equal(err.exitCode, 1);
      assert.equal(err.stderr, 'fatal: connection refused');
      assert.equal(err.isRetryable, false);
    });

    it('identifies InvalidResponseError with raw response and validation errors', () => {
      const err = new InvalidResponseError('Missing scope', {
        rawResponse: '{ "kind": "check" }',
        validationErrors: ['"scope" condition is required.']
      });
      assert.equal(err.name, 'InvalidResponseError');
      assert.equal(err.rawResponse, '{ "kind": "check" }');
      assert.deepEqual(err.validationErrors, ['"scope" condition is required.']);
    });
  });

  describe('Base HarnessAdapter: Lifecycle, Timeout & Parsing', () => {
    it('manages initialization, healthCheck, and shutdown lifecycle', async () => {
      const adapter = new HarnessAdapter({ name: 'test-base' });
      assert.equal(adapter.initialized, false);

      await adapter.initialize();
      assert.equal(adapter.initialized, true);
      const health = await adapter.healthCheck();
      assert.equal(health.ok, true);

      await adapter.shutdown();
      assert.equal(adapter.initialized, false);
    });

    it('executes operation within timeout boundary', async () => {
      const adapter = new HarnessAdapter({ timeoutMs: 1000 });
      const res = await adapter.executeWithTimeout(async () => 'fast result', 500);
      assert.equal(res, 'fast result');
    });

    it('aborts and throws TimeoutError when execution exceeds deadline', async () => {
      const adapter = new HarnessAdapter();
      await assert.rejects(
        async () => {
          await adapter.executeWithTimeout(
            () => new Promise((resolve) => setTimeout(resolve, 500)),
            20,
            { seatId: 'slow-seat' }
          );
        },
        (err) => err instanceof TimeoutError && err.timeoutMs === 20 && err.seatId === 'slow-seat'
      );
    });

    describe('parseStructuredOutput', () => {
      const adapter = new HarnessAdapter();

      it('parses clean JSON proof payload', () => {
        const raw = JSON.stringify({
          scope: 'Linux Servers',
          kind: 'citation',
          source: 'Kernel RFC 1234',
          statement: 'Namespaces isolate processes without virtualization.'
        });
        const proof = adapter.parseStructuredOutput(raw, 'proof');
        assert.equal(proof.kind, 'citation');
        assert.equal(proof.scope, 'Linux Servers');
      });

      it('strips markdown code block fences (```json ... ```)', () => {
        const raw = '```json\n{\n  "vote": "accept"\n}\n```';
        const parsed = adapter.parseStructuredOutput(raw, 'vote');
        assert.equal(parsed.vote, 'accept');
      });

      it('extracts JSON payload surrounded by conversational chatter', () => {
        const raw = 'Here is my evaluation:\n{\n  "vote": "object",\n  "reason": "Missing proof P1",\n  "proofId": "P1"\n}\nHope this helps!';
        const parsed = adapter.parseStructuredOutput(raw, 'vote');
        assert.equal(parsed.vote, 'object');
        assert.equal(parsed.proofId, 'P1');
      });

      it('validates judge_synthesis schema', () => {
        const raw = JSON.stringify({
          summary: 'Consensus candidate',
          clauses: [
            { context: 'Cloud', conclusion: 'Deploy on Linux', citedProofIds: ['P1'] }
          ]
        });
        const parsed = adapter.parseStructuredOutput(raw, 'judge_synthesis');
        assert.equal(parsed.summary, 'Consensus candidate');
        assert.equal(parsed.clauses.length, 1);
      });

      it('throws InvalidResponseError on malformed JSON or empty string', () => {
        assert.throws(() => adapter.parseStructuredOutput('', 'proof'), /empty or not a string/);
        assert.throws(() => adapter.parseStructuredOutput('not json at all', 'proof'), /Failed to parse/);
      });

      it('throws InvalidResponseError when payload schema is violated', () => {
        // Missing statement and source
        const invalidProof = JSON.stringify({ scope: 'general', kind: 'check' });
        assert.throws(
          () => adapter.parseStructuredOutput(invalidProof, 'proof'),
          (err) => err instanceof InvalidResponseError && err.validationErrors.length >= 2
        );

        // Object vote without reason or proofId
        const invalidVote = JSON.stringify({ vote: 'object' });
        assert.throws(
          () => adapter.parseStructuredOutput(invalidVote, 'vote'),
          (err) => err instanceof InvalidResponseError && err.validationErrors.length >= 2
        );
      });
    });
  });

  describe('Provider Adapters (Codex, Antigravity, Cursor)', () => {
    it('CodexAdapter, AntigravityAdapter, and CursorAdapter default this.spawnRunner to CLI runners', () => {
      const codex = new CodexAdapter();
      assert.equal(typeof codex.spawnRunner, 'function');
      assert.equal(codex.executable, 'codex');

      const agy = new AntigravityAdapter();
      assert.equal(typeof agy.spawnRunner, 'function');
      assert.equal(agy.executable, 'agy');

      const cursor = new CursorAdapter();
      assert.equal(typeof cursor.spawnRunner, 'function');
      assert.equal(cursor.executable, 'cursor-agent');
    });

    it('delegates seat and judge prompt formatting to soul.js including candidate and proof IDs', () => {
      const state = {
        topic: 'Engine Architecture',
        round: 1,
        maxRounds: 3,
        candidate: {
          round: 1,
          summary: 'Candidate recommendation',
          clauses: [{ context: 'Server', conclusion: 'Deploy on Linux', citedProofIds: ['P1'] }]
        },
        proofs: [
          { id: 'P1', kind: 'check', scope: 'Server', source: 'Kernel docs', statement: 'Linux namespaces isolate', status: 'admitted' },
          { id: 'P2', kind: 'citation', scope: 'Desktop', source: 'Survey', statement: 'Windows gaming', status: 'rejected' }
        ]
      };

      const adapters = [new CodexAdapter(), new AntigravityAdapter(), new CursorAdapter()];
      for (const adapter of adapters) {
        const votingPrompt = adapter.formatSeatPrompt({
          seat: { id: 'seat-1', model: 'gpt-6.1-sol' },
          soul: 'Pragmatic Engineer',
          round: 1,
          phase: 'VOTING',
          state
        });
        assert.match(votingPrompt, /Candidate Summary: "Candidate recommendation"/);
        assert.match(votingPrompt, /Clause C1 \[Server\]/);
        assert.match(votingPrompt, /\[P1\] \(check\) \[Server\]/);

        const judgePrompt = adapter.formatJudgePrompt({
          judge: { id: 'judge-1', soul: 'Impartial Judge' },
          round: 1,
          phase: 'JUDGE_AUDIT_SYNTHESIS',
          proofs: state.proofs,
          state
        });
        assert.match(judgePrompt, /\[P1\] \(check\) \[Server\]/);
        assert.match(judgePrompt, /\[P2\] \(citation\) \[Desktop\]/);
        assert.match(judgePrompt, /proofDecisions/);
        assert.match(judgePrompt, /citedProofIds/);
      }
    });

    it('forwards effectiveCwd (from executeSeat/executeJudge arg, callerContext.cwd, or adapter.cwd) into formatSeatPrompt and formatJudgePrompt across all 3 adapters', async () => {
      const adapterSpecs = [
        { Class: CodexAdapter, model: 'gpt-6-astra' },
        { Class: AntigravityAdapter, model: 'gemini-4-argon' },
        { Class: CursorAdapter, model: 'grok-4.7' }
      ];

      for (const { Class, model } of adapterSpecs) {
        const capturedPrompts = [];
        const adapter = new Class({
          cwd: '/repo/from-adapter',
          spawnRunner: async ({ prompt }) => {
            capturedPrompts.push(prompt);
            return JSON.stringify({
              scope: 'Workspace',
              kind: 'check',
              source: 'src/index.js',
              statement: 'Verified',
              vote: 'accept',
              summary: 'Judge summary',
              proofDecisions: { P1: { status: 'admitted', note: 'ok' } },
              clauses: [{ context: 'Workspace', conclusion: 'Verified', citedProofIds: ['P1'] }]
            });
          }
        });

        // 1. Adapter-level cwd activates workspace-attached directive in DELIBERATION, VOTING, and JUDGE
        await adapter.executeSeat({
          seat: { id: 's1', model },
          soul: 'Pragmatic Engineer',
          round: 1,
          phase: 'DELIBERATION',
          state: { topic: 'Check workspace' }
        });
        assert.equal(capturedPrompts.length, 1);
        assert.equal(/No local code workspace is attached/.test(capturedPrompts[0]), false);

        await adapter.executeSeat({
          seat: { id: 's1', model },
          soul: 'Pragmatic Engineer',
          round: 1,
          phase: 'VOTING',
          state: {
            topic: 'Check workspace',
            candidate: { round: 1, summary: 'S', clauses: [{ context: 'C', conclusion: 'X', citedProofIds: ['P1'] }] },
            proofs: [{ id: 'P1', kind: 'check', scope: 'C', source: 'S', statement: 'St', status: 'admitted' }]
          }
        });
        assert.equal(capturedPrompts.length, 2);
        assert.equal(/No local code workspace is attached/.test(capturedPrompts[1]), false);

        await adapter.executeJudge({
          judge: { id: 'j1', model, soul: 'Impartial Judge' },
          round: 1,
          phase: 'JUDGE_AUDIT_SYNTHESIS',
          proofs: [{ id: 'P1', kind: 'check', scope: 'C', source: 'S', statement: 'St' }],
          state: { topic: 'Check workspace' }
        });
        assert.equal(capturedPrompts.length, 3);
        assert.equal(/No local code workspace is attached/.test(capturedPrompts[2]), false);

        // 2. Without adapter.cwd, executeSeat({ cwd }) and executeJudge({ context: { cwd } }) also activate workspace directive
        const statelessPrompts = [];
        const statelessAdapter = new Class({
          spawnRunner: async ({ prompt }) => {
            statelessPrompts.push(prompt);
            return JSON.stringify({
              scope: 'Workspace',
              kind: 'check',
              source: 'src/index.js',
              statement: 'Verified',
              summary: 'Judge summary',
              proofDecisions: { P1: { status: 'admitted', note: 'ok' } },
              clauses: [{ context: 'Workspace', conclusion: 'Verified', citedProofIds: ['P1'] }]
            });
          }
        });

        await statelessAdapter.executeSeat({
          seat: { id: 's1', model },
          soul: 'Pragmatic Engineer',
          round: 1,
          phase: 'DELIBERATION',
          state: { topic: 'Check workspace' },
          cwd: '/repo/from-call'
        });
        assert.equal(/No local code workspace is attached/.test(statelessPrompts[0]), false);

        await statelessAdapter.executeJudge({
          judge: { id: 'j1', model, soul: 'Impartial Judge' },
          round: 1,
          phase: 'JUDGE_AUDIT_SYNTHESIS',
          proofs: [{ id: 'P1', kind: 'check', scope: 'C', source: 'S', statement: 'St' }],
          state: { topic: 'Check workspace' },
          context: { cwd: '/repo/from-context' }
        });
        assert.equal(/No local code workspace is attached/.test(statelessPrompts[1]), false);

        // 3. When no cwd is present anywhere, prompt still includes "No local code workspace is attached"
        await statelessAdapter.executeSeat({
          seat: { id: 's1', model },
          soul: 'Pragmatic Engineer',
          round: 1,
          phase: 'DELIBERATION',
          state: { topic: 'General external topic' }
        });
        assert.equal(/No local code workspace is attached/.test(statelessPrompts[2]), true);
      }
    });

    describe('CodexAdapter', () => {
      it('validates allowed models (gpt-6.1-sol, gpt-6-astra) and rejects invalid effort tiers or substring spoofs', () => {
        const adapter = new CodexAdapter();
        assert.doesNotThrow(() => adapter.validateModel('gpt-6.1-sol (max)'));
        assert.doesNotThrow(() => adapter.validateModel('gpt-6-astra (high)'));
        assert.doesNotThrow(() => adapter.validateModel('gpt-6-astra-max'));
        assert.throws(() => adapter.validateModel('claude-sonnet-5-5'), /not permitted under Codex route/);
        assert.throws(
          () => adapter.validateModel('gpt-6-astra (ultra)'),
          (err) => err instanceof HarnessExecutionError && /Unsupported reasoning effort "ultra"/.test(err.message)
        );
        assert.throws(
          () => adapter.validateModel('not-gpt-6-astra-high'),
          (err) => err instanceof HarnessExecutionError && /not permitted under Codex route/.test(err.message)
        );
        assert.throws(
          () => adapter.validateModel('gpt-6-astra-bogus (max)'),
          (err) => err instanceof HarnessExecutionError && /not permitted under Codex route/.test(err.message)
        );
        assert.throws(
          () => adapter.validateModel('gpt-6-astra-high (max)'),
          (err) => err instanceof HarnessExecutionError && /not permitted under Codex route/.test(err.message)
        );
      });

      it('classifies OpenAI quota and rate limit errors', () => {
        const adapter = new CodexAdapter();
        const err1 = adapter.classifyError(new Error('Rate limit exceeded: requests_per_minute_exceeded'));
        assert.ok(err1 instanceof QuotaExhaustionError);

        const err2 = adapter.classifyError(new Error('insufficient_quota (HTTP 429)'));
        assert.ok(err2 instanceof QuotaExhaustionError);
      });

      it('executes seat turn using custom spawnRunner', async () => {
        const adapter = new CodexAdapter({
          spawnRunner: async () => JSON.stringify({
            scope: 'Test',
            kind: 'check',
            source: 'Verified benchmark',
            statement: 'Test statement'
          })
        });

        const res = await adapter.executeSeat({
          seat: { id: 'sol-1', model: 'gpt-6.1-sol' },
          soul: 'Tester',
          round: 1,
          phase: 'DELIBERATION',
          state: { topic: 'Topic' }
        });
        assert.equal(res.statement, 'Test statement');
      });
    });

    describe('AntigravityAdapter', () => {
      it('validates allowed models (gemini-4-argon, gemini-4-carbon, claude-sonnet-5-5, claude-opus-5-5) and rejects invalid effort tiers or substring spoofs', () => {
        const adapter = new AntigravityAdapter();
        assert.doesNotThrow(() => adapter.validateModel('gemini-4-argon-high'));
        assert.doesNotThrow(() => adapter.validateModel('gemini-4-carbon-high'));
        assert.doesNotThrow(() => adapter.validateModel('gemini-4-carbon-low'));
        assert.doesNotThrow(() => adapter.validateModel('gemini-4-carbon-medium'));
        assert.doesNotThrow(() => adapter.validateModel('gemini-4-carbon'));
        assert.doesNotThrow(() => adapter.validateModel('gemini-4-carbon (high)'));
        assert.doesNotThrow(() => adapter.validateModel('claude-sonnet-5-5-high'));
        assert.doesNotThrow(() => adapter.validateModel('claude-opus-5-5-high'));
        assert.throws(
          () => adapter.validateModel('gpt-6.1-sol'),
          (err) =>
            err instanceof HarnessExecutionError &&
            /not permitted under Antigravity route\. Allowed: gemini-4-argon-\*, gemini-4-carbon-\*, claude-sonnet-5-5-\*, claude-opus-5-5-\*\./.test(
              err.message
            )
        );
        assert.throws(
          () => adapter.validateModel('gemini-4-argon (bogus)'),
          (err) => err instanceof HarnessExecutionError && /Unsupported reasoning effort "bogus"/.test(err.message)
        );
        assert.throws(
          () => adapter.validateModel('gemini-4-carbon (bogus)'),
          (err) => err instanceof HarnessExecutionError && /Unsupported reasoning effort "bogus"/.test(err.message)
        );
        assert.throws(
          () => adapter.validateModel('not-gemini-4-argon-high'),
          (err) => err instanceof HarnessExecutionError && /not permitted under Antigravity route/.test(err.message)
        );
        assert.throws(
          () => adapter.validateModel('not-gemini-4-carbon-high'),
          (err) => err instanceof HarnessExecutionError && /not permitted under Antigravity route/.test(err.message)
        );
        assert.throws(
          () => adapter.validateModel('gemini-4-carbon-high (high)'),
          (err) => err instanceof HarnessExecutionError && /not permitted under Antigravity route/.test(err.message)
        );
        assert.throws(
          () => adapter.validateModel('claude-opus-5-5-bogus (high)'),
          (err) => err instanceof HarnessExecutionError && /not permitted under Antigravity route/.test(err.message)
        );
      });

      it('rejects gemini-4-carbon-high on CodexAdapter and CursorAdapter, resolves timeouts by effort tier, and downshifts cleanly for VOTING (#75)', async () => {
        const agy = new AntigravityAdapter();
        const codex = new CodexAdapter();
        const cursor = new CursorAdapter();

        assert.throws(
          () => codex.validateModel('gemini-4-carbon-high'),
          (err) => err instanceof HarnessExecutionError && /not permitted under Codex route/.test(err.message)
        );
        assert.throws(
          () => cursor.validateModel('gemini-4-carbon-high'),
          (err) => err instanceof HarnessExecutionError && /not permitted under Cursor route/.test(err.message)
        );

        assert.equal(agy.resolveTimeoutMs('gemini-4-carbon-high'), 120000);
        assert.equal(agy.resolveTimeoutMs('gemini-4-carbon (high)'), 120000);
        assert.equal(agy.resolveTimeoutMs('gemini-4-carbon-medium'), 60000);
        assert.equal(agy.resolveTimeoutMs('gemini-4-carbon-low'), 60000);
        assert.equal(agy.resolveTimeoutMs('gemini-4-carbon'), 60000);

        const { downshiftModel } = await import('../../src/harness/cli-runner.js');
        const { resolveVotingSeatConfig } = await import('../../src/engine/council-engine.js');

        assert.equal(downshiftModel('gemini-4-carbon-high', 'low'), 'gemini-4-carbon-low');
        const votingSeat = resolveVotingSeatConfig({
          id: 'carbon-voter',
          harness: 'antigravity',
          model: 'gemini-4-carbon-high'
        });
        assert.equal(votingSeat.model, 'gemini-4-carbon-low');
        assert.equal(votingSeat.tools, 'none');
        assert.doesNotThrow(() => agy.validateModel(votingSeat.model));
      });

      it('classifies Gemini and Claude quota and resource errors', () => {
        const adapter = new AntigravityAdapter();
        const err1 = adapter.classifyError(new Error('RESOURCE_EXHAUSTED: quota window exhausted'));
        assert.ok(err1 instanceof QuotaExhaustionError);

        const err2 = adapter.classifyError(new Error('overloaded_error (HTTP 429)'));
        assert.ok(err2 instanceof QuotaExhaustionError);
      });
    });

    describe('CursorAdapter', () => {
      it('validates allowed models (grok-4.7, composer-2.5) and rejects invalid effort tiers, substring spoofs, and invented composer effort', () => {
        const adapter = new CursorAdapter();
        assert.doesNotThrow(() => adapter.validateModel('grok-4.7-high'));
        assert.doesNotThrow(() => adapter.validateModel('composer-2.5'));
        assert.throws(() => adapter.validateModel('gpt-6-astra'), /not permitted under Cursor route/);
        assert.throws(
          () => adapter.validateModel('grok-4.7 (ultra)'),
          (err) => err instanceof HarnessExecutionError && /Unsupported reasoning effort "ultra"/.test(err.message)
        );
        assert.throws(
          () => adapter.validateModel('not-grok-4.7-high'),
          (err) => err instanceof HarnessExecutionError && /not permitted under Cursor route/.test(err.message)
        );
        assert.throws(
          () => adapter.validateModel('composer-2.5 (high)'),
          (err) => err instanceof HarnessExecutionError && /not permitted under Cursor route/.test(err.message)
        );
        assert.throws(
          () => adapter.validateModel('composer-2.5-high'),
          (err) => err instanceof HarnessExecutionError && /not permitted under Cursor route/.test(err.message)
        );
      });

      it('classifies Cursor weekly included pool exhaustion signature', () => {
        const adapter = new CursorAdapter();
        const err = adapter.classifyError(new Error('Cursor weekly included pool exhausted (HTTP 429)'));
        assert.ok(err instanceof QuotaExhaustionError);
        assert.equal(err.isQuotaFault, true);
      });

      it('preserves existing HarnessError subclasses (e.g. InvalidResponseError, TimeoutError) even when message contains "429" or "rate_limit"', () => {
        const adapters = [new CodexAdapter(), new AntigravityAdapter(), new CursorAdapter()];
        for (const adapter of adapters) {
          const invalidResp = new InvalidResponseError(
            'Failed to parse "proof" JSON response: Unexpected token in "error 429 rate_limit_exceeded"',
            { harness: adapter.name, seatId: 's1' }
          );
          const classifiedInvalid = adapter.classifyError(invalidResp, { seatId: 's1' });
          assert.equal(classifiedInvalid, invalidResp);
          assert.ok(classifiedInvalid instanceof InvalidResponseError);
          assert.equal(classifiedInvalid instanceof QuotaExhaustionError, false);

          const timeoutErr = new TimeoutError(
            'Harness timed out after 42900ms while checking quota',
            { harness: adapter.name, seatId: 's1', timeoutMs: 42900 }
          );
          const classifiedTimeout = adapter.classifyError(timeoutErr, { seatId: 's1' });
          assert.equal(classifiedTimeout, timeoutErr);
          assert.ok(classifiedTimeout instanceof TimeoutError);
          assert.equal(classifiedTimeout instanceof QuotaExhaustionError, false);
        }
      });

      it('base classifyError classifies raw ETIMEDOUT into TimeoutError and raw 401/403 into AuthenticationError', () => {
        const adapter = new HarnessAdapter({ name: 'base' });
        const rawTimeout = Object.assign(new Error('spawn ETIMEDOUT after 60000ms'), { code: 'ETIMEDOUT' });
        const classifiedTimeout = adapter.classifyError(rawTimeout, { seatId: 's1' });
        assert.ok(classifiedTimeout instanceof TimeoutError);

        const rawAuth = new Error('HTTP 401 Unauthorized: invalid_api_key');
        const classifiedAuth = adapter.classifyError(rawAuth, { seatId: 's1' });
        assert.ok(classifiedAuth instanceof AuthenticationError);
        assert.equal(classifiedAuth.isRetryable, false);
      });
    });
  });

  describe('MockAdapter (Hermetic Deterministic Engine)', () => {
    it('provides default deterministic proof and voting outputs', async () => {
      const mock = new MockAdapter();

      const proof = await mock.executeSeat({
        seat: { id: 'seat-1' },
        soul: 'Rigorous Verifier',
        round: 1,
        phase: 'DELIBERATION',
        state: {}
      });
      assert.equal(proof.kind, 'check');
      assert.match(proof.statement, /Rigorous Verifier/);

      const vote = await mock.executeSeat({
        seat: { id: 'seat-1' },
        soul: 'Rigorous Verifier',
        round: 1,
        phase: 'VOTING',
        state: {}
      });
      assert.equal(vote.vote, 'accept');

      const judgeOutput = await mock.executeJudge({
        judge: { id: 'judge-1' },
        round: 1,
        phase: 'JUDGE_AUDIT_SYNTHESIS',
        proofs: [{ id: 'P1', round: 1, status: 'pending' }],
        state: {}
      });
      assert.equal(judgeOutput.clauses.length, 1);
      assert.deepEqual(judgeOutput.clauses[0].citedProofIds, ['P1']);
    });

    it('supports scripted seat and judge responses with exact and wildcard keys', async () => {
      const mock = new MockAdapter();

      // Script specific seat response for round 2 voting
      mock.scriptSeatResponse({
        seatId: 'astra-objector',
        round: 2,
        phase: 'VOTING',
        response: { vote: 'object', reason: 'Unsound clause 1', proofId: 'P1' }
      });

      // Wildcard script for judge round 1
      mock.scriptJudgeResponse({
        round: 1,
        response: {
          summary: 'Scripted summary',
          proofDecisions: { P1: { status: 'admitted' } },
          clauses: [{ context: 'C', conclusion: 'Conc', citedProofIds: ['P1'] }]
        }
      });

      const vote = await mock.executeSeat({
        seat: { id: 'astra-objector' },
        soul: 'Auditor',
        round: 2,
        phase: 'VOTING',
        state: {}
      });
      assert.equal(vote.vote, 'object');
      assert.equal(vote.proofId, 'P1');

      const judge = await mock.executeJudge({
        judge: { id: 'judge-astra' },
        round: 1,
        phase: 'JUDGE_AUDIT_SYNTHESIS',
        proofs: [],
        state: {}
      });
      assert.equal(judge.summary, 'Scripted summary');
    });

    it('injects seat fault with round, phase, and retry constraints', async () => {
      const mock = new MockAdapter();

      mock.injectSeatFault('faulty-seat', {
        round: 1,
        phase: 'DELIBERATION',
        afterRetries: 1,
        error: new QuotaExhaustionError('Weekly quota limit reached')
      });

      // Retries = 0 -> does not trigger
      const res1 = await mock.executeSeat({
        seat: { id: 'faulty-seat', retries: 0 },
        soul: 'Tester',
        round: 1,
        phase: 'DELIBERATION',
        state: {}
      });
      assert.ok(res1);

      // Retries = 1 -> triggers fault
      await assert.rejects(
        async () => {
          await mock.executeSeat({
            seat: { id: 'faulty-seat', retries: 1 },
            soul: 'Tester',
            round: 1,
            phase: 'DELIBERATION',
            state: {}
          });
        },
        (err) => err instanceof QuotaExhaustionError && /Weekly quota limit/.test(err.message)
      );
    });

    it('records prompts and verifies soul instruction injection', async () => {
      const mock = new MockAdapter();

      await mock.executeSeat({
        seat: { id: 'sec-auditor' },
        soul: 'Adversarial Challenger: focuses on race conditions',
        round: 1,
        phase: 'DELIBERATION',
        state: {}
      });

      assert.equal(mock.hasReceivedSoulContent('sec-auditor', 'Adversarial Challenger'), true);
      assert.equal(mock.hasReceivedSoulContent('sec-auditor', /race conditions/i), true);
      assert.equal(mock.hasReceivedSoulContent('sec-auditor', 'Unrelated text'), false);
    });

    it('resets all recorded state and fault rules cleanly', async () => {
      const mock = new MockAdapter();
      await mock.executeSeat({ seat: { id: 's1' }, soul: 'Soul', round: 1, phase: 'VOTING', state: {} });
      assert.equal(mock.callCount.seats, 1);
      assert.equal(mock.recordedPrompts.length, 1);

      mock.injectSeatFault('s1');
      mock.scriptSeatResponse({ seatId: 's1', response: { vote: 'accept' } });

      mock.reset();
      assert.equal(mock.callCount.seats, 0);
      assert.equal(mock.recordedPrompts.length, 0);
      assert.equal(mock.seatFaultInjections.size, 0);
      assert.equal(mock.scriptedSeatResponses.size, 0);

      // Now s1 executes without throwing fault
      const res = await mock.executeSeat({ seat: { id: 's1' }, soul: 'Soul', round: 1, phase: 'VOTING', state: {} });
      assert.equal(res.vote, 'accept');
    });
  });

  describe('createHarnessAdapter & HarnessRegistry', () => {
    it('creates appropriate harness adapter instances via factory', () => {
      assert.ok(createHarnessAdapter('codex') instanceof CodexAdapter);
      assert.ok(createHarnessAdapter('antigravity') instanceof AntigravityAdapter);
      assert.ok(createHarnessAdapter('cursor') instanceof CursorAdapter);
      assert.ok(createHarnessAdapter('mock') instanceof MockAdapter);
      assert.throws(() => createHarnessAdapter('unknown-harness'), /Unknown harness adapter type/);
    });

    it('HarnessRegistry caches and manages adapter instances', async () => {
      const registry = new HarnessRegistry({ timeoutMs: 1234 });
      const a1 = registry.get('mock');
      const a2 = registry.get('mock');
      assert.equal(a1, a2);
      assert.equal(a1.defaultTimeoutMs, 1234);

      const customMock = new MockAdapter();
      registry.register('custom', customMock);
      assert.equal(registry.get('custom'), customMock);

      await registry.shutdownAll();
      assert.equal(registry.instances.size, 0);
    });
  });

  describe('Round 1 Review Regressions: Live Adapter Partial Proofs & Tool-Free Isolation (#70, #71, #72)', () => {
    it('AntigravityAdapter, CodexAdapter, and CursorAdapter include partially_admitted proofs and caveats in VOTING prompts (#71, #72)', () => {
      const stateWithPartialProof = {
        topic: 'Distributed lock safety',
        candidate: 'Use leased locks with fencing tokens',
        clauses: [
          {
            id: 'C1',
            context: 'Fencing',
            conclusion: 'Attach monotonic fencing tokens to every write',
            citedProofIds: ['P1', 'P2']
          }
        ],
        proofs: [
          {
            id: 'P1',
            seatId: 's1',
            status: 'admitted',
            scope: 'Storage layer',
            kind: 'check',
            source: 'storage.js:42',
            statement: 'Storage rejects stale tokens'
          },
          {
            id: 'P2',
            seatId: 's2',
            status: 'partially_admitted',
            scope: 'Network partition',
            kind: 'trace',
            source: 'lease.js:88',
            statement: 'Original broad claim about lock expiry',
            judgeAdmittedStatement: 'Narrowed core: lease expiry requires fencing token validation',
            judgeNote: 'Admitted only for single-region deployments'
          },
          {
            id: 'P3',
            seatId: 's3',
            status: 'rejected',
            scope: 'Speculative',
            kind: 'counterexample',
            source: 'none',
            statement: 'Rejected proof statement must not appear'
          }
        ]
      };

      const adapters = [
        new AntigravityAdapter(),
        new CodexAdapter(),
        new CursorAdapter()
      ];

      for (const adapter of adapters) {
        const prompt = adapter.formatSeatPrompt({
          seat: { id: 'voter-1', model: 'gpt-6-astra (max)', votingTools: 'none' },
          soul: 'Strict Voter',
          round: 1,
          phase: 'VOTING',
          state: stateWithPartialProof,
          tools: 'none',
          cwd: '/should/be/omitted/when/tools/none'
        });

        assert.match(prompt, /\[P1\].*Storage rejects stale tokens/, `${adapter.name} must include admitted P1`);
        assert.match(
          prompt,
          /\[P2\].*\[PARTIALLY ADMITTED: Admitted only for single-region deployments\]/,
          `${adapter.name} must include partially_admitted P2 badge and caveat`
        );
        assert.match(prompt, /Original broad claim about lock expiry/, `${adapter.name} must preserve original P2 statement`);
        assert.match(
          prompt,
          /\(Admitted Core: Narrowed core: lease expiry requires fencing token validation\)/,
          `${adapter.name} must include P2 judgeAdmittedStatement`
        );
        assert.doesNotMatch(prompt, /Rejected proof statement must not appear/, `${adapter.name} must exclude rejected P3`);
        assert.match(prompt, /Do not invoke any tools during confirmation voting/, `${adapter.name} must emit tool-free voting directive when tools is none`);
      }
    });

    it('AntigravityAdapter, CodexAdapter, and CursorAdapter honor tools: "none" in executeSeat and executeJudge, stripping cwd and forwarding tools: "none" (#70, #72)', async () => {
      const adapterConfigs = [
        { Ctor: AntigravityAdapter, model: 'gemini-4-argon-high' },
        { Ctor: CodexAdapter, model: 'gpt-6-astra (max)' },
        { Ctor: CursorAdapter, model: 'grok-4.7-high' }
      ];

      for (const { Ctor, model } of adapterConfigs) {
        const dispatchedCalls = [];
        const adapter = new Ctor({
          cwd: '/live/repo/workspace',
          spawnRunner: async (req) => {
            dispatchedCalls.push(req);
            return JSON.stringify({
              vote: 'accept',
              summary: 'Synthesized',
              clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }],
              proofDecisions: { P1: { status: 'admitted', note: 'OK' } }
            });
          }
        });

        await adapter.executeSeat({
          seat: { id: 's1', model, tools: 'read-only', votingTools: 'none' },
          soul: 'Voter',
          round: 1,
          phase: 'VOTING',
          state: { topic: 'T', candidate: 'C', clauses: [], proofs: [] },
          tools: 'none',
          cwd: '/live/repo/workspace'
        });

        assert.equal(dispatchedCalls.length, 1);
        assert.equal(dispatchedCalls[0].tools, 'none', `${adapter.name} executeSeat must pass tools: 'none'`);
        assert.equal(dispatchedCalls[0].cwd, undefined, `${adapter.name} executeSeat must strip cwd when tools === 'none'`);
        assert.equal(dispatchedCalls[0].context.tools, 'none');
        assert.equal(dispatchedCalls[0].context.cwd, undefined);
        assert.match(dispatchedCalls[0].prompt, /Do not invoke any tools during confirmation voting/);

        await adapter.executeJudge({
          judge: { id: 'j1', model, tools: 'read-only' },
          soul: 'Judge',
          round: 1,
          phase: 'JUDGE_AUDIT_SYNTHESIS',
          proofs: [{ id: 'P1', seatId: 's1', status: 'pending', scope: 'S', kind: 'k', source: 'src', statement: 'stmt' }],
          state: { topic: 'T' },
          tools: 'none',
          cwd: '/live/repo/workspace'
        });

        assert.equal(dispatchedCalls.length, 2);
        assert.equal(dispatchedCalls[1].tools, 'none', `${adapter.name} executeJudge must pass tools: 'none'`);
        assert.equal(dispatchedCalls[1].cwd, undefined, `${adapter.name} executeJudge must strip cwd when tools === 'none'`);
        assert.equal(dispatchedCalls[1].context.tools, 'none');
        assert.equal(dispatchedCalls[1].context.cwd, undefined);
        assert.doesNotMatch(dispatchedCalls[1].prompt, /You have read-only inspection tools enabled/);
      }
    });

    it('runCodexCli, runAntigravityCli, and runCursorCli isolate subprocesses to an empty tempCwdDir and record tools: "none" when tools === "none" (#70, #72)', async () => {
      const { runCodexCli, runAntigravityCli, runCursorCli } = await import('../../src/harness/cli-runner.js');
      const { createTelemetryEmitter } = await import('../../src/telemetry/emitter.js');
      const repoCwd = process.cwd();
      const emitter = createTelemetryEmitter();

      let agySpawnCwd = null;
      let agySpawnArgs = null;
      await runAntigravityCli({
        model: 'gemini-4-argon-high',
        prompt: 'vote prompt',
        timeoutMs: 5000,
        cwd: repoCwd,
        tools: 'none',
        exec: async (_bin, args, opts) => {
          agySpawnCwd = opts.cwd;
          agySpawnArgs = args;
          return { stdout: JSON.stringify({ response: JSON.stringify({ vote: 'accept' }) }), stderr: '', exitCode: 0 };
        },
        context: {
          seatId: 's-agy',
          phase: 'VOTING',
          round: 1,
          cwd: repoCwd,
          tools: 'none',
          telemetry: emitter
        }
      });

      assert.notEqual(agySpawnCwd, repoCwd, 'runAntigravityCli must not run in repoCwd when tools is none');
      assert.match(agySpawnCwd, /council-seat-cwd-/, 'runAntigravityCli must run in isolated council-seat-cwd- temp dir');
      assert.equal(agySpawnArgs.includes(repoCwd), false);

      let cursorSpawnCwd = null;
      let cursorSpawnArgs = null;
      await runCursorCli({
        model: 'grok-4.7-high',
        prompt: 'vote prompt',
        timeoutMs: 5000,
        cwd: repoCwd,
        tools: 'none',
        exec: async (_bin, args, opts) => {
          cursorSpawnCwd = opts.cwd;
          cursorSpawnArgs = args;
          return { stdout: JSON.stringify({ result: JSON.stringify({ vote: 'accept' }) }), stderr: '', exitCode: 0 };
        },
        context: {
          seatId: 's-cursor',
          phase: 'VOTING',
          round: 1,
          cwd: repoCwd,
          tools: 'none',
          telemetry: emitter
        }
      });

      assert.notEqual(cursorSpawnCwd, repoCwd, 'runCursorCli must not run in repoCwd when tools is none');
      assert.match(cursorSpawnCwd, /council-seat-cwd-/, 'runCursorCli must run in isolated council-seat-cwd- temp dir');
      assert.equal(cursorSpawnArgs.includes('--workspace'), false, 'runCursorCli must not pass --workspace when tools is none');
      assert.equal(cursorSpawnArgs.includes(repoCwd), false);

      let codexSpawnCwd = null;
      let codexSpawnArgs = null;
      await runCodexCli({
        model: 'gpt-6-astra (max)',
        prompt: 'vote prompt',
        timeoutMs: 5000,
        cwd: repoCwd,
        tools: 'none',
        exec: async (_bin, args, opts) => {
          codexSpawnCwd = opts.cwd;
          codexSpawnArgs = args;
          return { stdout: JSON.stringify({ vote: 'accept' }), stderr: '', exitCode: 0 };
        },
        context: {
          seatId: 's-codex',
          phase: 'VOTING',
          round: 1,
          cwd: repoCwd,
          tools: 'none',
          telemetry: emitter
        }
      });

      assert.notEqual(codexSpawnCwd, repoCwd, 'runCodexCli must not run in repoCwd when tools is none');
      assert.match(codexSpawnCwd, /council-seat-cwd-/, 'runCodexCli must run in isolated council-seat-cwd- temp dir');
      assert.equal(codexSpawnArgs.includes('-C'), false, 'runCodexCli must not pass -C <cwd> when tools is none');
      assert.equal(codexSpawnArgs.includes(repoCwd), false);

      const providerCalls = emitter.getProviderCalls();
      assert.equal(providerCalls.length, 3);
      for (const call of providerCalls) {
        assert.equal(call.tools, 'none', `Telemetry provider_call for ${call.provider} must record tools: "none"`);
      }

      // Also verify that context.tools === 'none' isolates cwd and records tools: 'none' even when top-level tools is 'read-only'
      let codexContextOnlyCwd = null;
      await runCodexCli({
        model: 'gpt-6-astra (max)',
        prompt: 'vote prompt',
        timeoutMs: 5000,
        cwd: repoCwd,
        tools: 'read-only',
        exec: async (_bin, _args, opts) => {
          codexContextOnlyCwd = opts.cwd;
          return { stdout: JSON.stringify({ vote: 'accept' }), stderr: '', exitCode: 0 };
        },
        context: {
          seatId: 's-codex-ctx',
          phase: 'VOTING',
          round: 1,
          cwd: repoCwd,
          tools: 'none',
          telemetry: emitter
        }
      });
      assert.notEqual(codexContextOnlyCwd, repoCwd);
      assert.match(codexContextOnlyCwd, /council-seat-cwd-/);
      assert.equal(emitter.getProviderCalls()[3].tools, 'none');
    });
  });
});
