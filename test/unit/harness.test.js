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
    describe('CodexAdapter', () => {
      it('validates allowed models (gpt-6.1-sol, gpt-6-astra)', () => {
        const adapter = new CodexAdapter();
        assert.doesNotThrow(() => adapter.validateModel('gpt-6.1-sol (max)'));
        assert.doesNotThrow(() => adapter.validateModel('gpt-6-astra (high)'));
        assert.throws(() => adapter.validateModel('claude-sonnet-5-5'), /not permitted under Codex route/);
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
      it('validates allowed models (gemini-4-argon, claude-sonnet-5-5, claude-opus-5-5)', () => {
        const adapter = new AntigravityAdapter();
        assert.doesNotThrow(() => adapter.validateModel('gemini-4-argon-high'));
        assert.doesNotThrow(() => adapter.validateModel('claude-sonnet-5-5-high'));
        assert.doesNotThrow(() => adapter.validateModel('claude-opus-5-5-high'));
        assert.throws(() => adapter.validateModel('gpt-6.1-sol'), /not permitted under Antigravity route/);
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
      it('validates allowed models (grok-4.7, composer-2.5)', () => {
        const adapter = new CursorAdapter();
        assert.doesNotThrow(() => adapter.validateModel('grok-4.7-high'));
        assert.doesNotThrow(() => adapter.validateModel('composer-2.5'));
        assert.throws(() => adapter.validateModel('gpt-6-astra'), /not permitted under Cursor route/);
      });

      it('classifies Cursor weekly included pool exhaustion signature', () => {
        const adapter = new CursorAdapter();
        const err = adapter.classifyError(new Error('Cursor weekly included pool exhausted (HTTP 429)'));
        assert.ok(err instanceof QuotaExhaustionError);
        assert.equal(err.isQuotaFault, true);
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
});
