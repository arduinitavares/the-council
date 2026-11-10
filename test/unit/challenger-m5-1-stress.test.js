/**
 * @fileoverview Adversarial Stress & Boundary Challenge Suite for Milestone M5.
 * Author: challenger_m5_1 (Empirical Challenger)
 * Focus: Engine Timeouts, Retry Bounding, Config Validation Fuzzing, Tool-Loop Guard.
 * Zero external dependencies. Uses Node.js built-in test runner (node --test).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, resolveConfig, validatePositiveInteger } from '../../src/engine/config.js';
import { CouncilEngine, resolveVotingSeatConfig } from '../../src/engine/council-engine.js';
import { TimeoutError, HarnessExecutionError, InvalidResponseError } from '../../src/harness/adapter.js';
import { MockAdapter } from '../../src/harness/mock.js';
import { CodexAdapter } from '../../src/harness/codex.js';
import { formatDeliberationPrompt, formatVotingPrompt } from '../../src/seats/soul.js';

describe('Adversarial Challenger M5-1: Engine Timeouts, Retry Bounding & Config Fuzzing', () => {

  // ==========================================================================
  // Section 1: Config Validation & Helper Fuzzing
  // ==========================================================================
  describe('1. Config Validation Fuzzing & Boundary Conditions', () => {
    const invalidFuzzInputs = [
      0,
      -0,
      -1,
      -100,
      -Infinity,
      Infinity,
      NaN,
      1.5,
      0.1,
      0.0000001,
      99999.9999,
      '',
      '   ',
      '240000',
      '0',
      '-1',
      '1.5',
      'fast',
      {},
      { value: 100 },
      [],
      [1],
      [240000],
      null,
      true,
      false,
      100n,
      Symbol('test'),
      () => 120000
    ];

    it('1.1 validatePositiveInteger rejects all non-positive, non-integer, and non-numeric boundary inputs', () => {
      for (const input of invalidFuzzInputs) {
        const errors = [];
        const res = validatePositiveInteger(input, 'fuzzField', errors);
        assert.equal(res.valid, false, `Expected input ${String(input)} (${typeof input}) to be rejected`);
        assert.equal(errors.length, 1);
        assert.equal(errors[0], 'fuzzField must be a positive integer.');
      }
    });

    it('1.2 validatePositiveInteger accepts valid positive integers and ignores undefined', () => {
      const validInputs = [1, 2, 50, 1000, 60000, 240000, 480000, Number.MAX_SAFE_INTEGER];
      for (const val of validInputs) {
        const errors = [];
        const res = validatePositiveInteger(val, 'validField', errors);
        assert.equal(res.valid, true);
        assert.equal(errors.length, 0);
      }

      // undefined is treated as optional/omitted
      const undefErrors = [];
      const undefRes = validatePositiveInteger(undefined, 'optionalField', undefErrors);
      assert.equal(undefRes.valid, true);
      assert.equal(undefErrors.length, 0);
    });

    it('1.3 validateConfig rejects invalid boundary inputs for root timeout, seatBudget, totalSeatBudgetMs, and votingTimeoutMs', () => {
      const validBaseConfig = {
        topic: 'Boundary Fuzzing Base',
        maxRounds: 3,
        minQuorum: 2,
        maxClarificationBatches: 0,
        maxRetriesPerSeat: 0,
        judge: { id: 'j1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
        seats: [
          { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Architect' },
          { id: 's2', harness: 'mock', model: 'grok-4.7-high', soul: 'Verifier' }
        ]
      };

      const fieldsToTest = ['timeout', 'seatBudget', 'totalSeatBudgetMs', 'votingTimeoutMs'];
      for (const field of fieldsToTest) {
        for (const badVal of invalidFuzzInputs) {
          const cfg = { ...validBaseConfig, [field]: badVal };
          const res = validateConfig(cfg);
          assert.equal(res.valid, false, `Expected validateConfig to reject ${field}=${String(badVal)}`);
          assert.ok(
            res.errors.some((e) => e.includes(`${field} must be a positive integer.`)),
            `Expected error message containing "${field} must be a positive integer." but got: ${res.errors.join('; ')}`
          );
        }
      }
    });

    it('1.4 validateConfig preserves exact legacy error string for timeoutMs', () => {
      const validBase = {
        topic: 'Legacy timeoutMs check',
        maxRounds: 3,
        minQuorum: 2,
        maxClarificationBatches: 0,
        maxRetriesPerSeat: 0,
        judge: { id: 'j', harness: 'mock', model: 'm', soul: 'J' },
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 'S1' },
          { id: 's2', harness: 'mock', model: 'm', soul: 'S2' }
        ]
      };

      for (const badVal of [0, -1, -5000, NaN, Infinity, -Infinity, '240000', null, {}, []]) {
        const res = validateConfig({ ...validBase, timeoutMs: badVal });
        assert.equal(res.valid, false);
        assert.ok(
          res.errors.includes('timeoutMs must be a positive number.'),
          `Expected exact string "timeoutMs must be a positive number." for ${badVal}`
        );
      }
    });

    it('1.5 validateConfig rejects invalid boundary inputs for seat-level budget and timeout fields', () => {
      const validBase = {
        topic: 'Seat-level boundary fuzzing',
        maxRounds: 3,
        minQuorum: 2,
        maxClarificationBatches: 0,
        maxRetriesPerSeat: 0,
        judge: { id: 'j', harness: 'mock', model: 'm', soul: 'J' },
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 'S1' },
          { id: 's2', harness: 'mock', model: 'm', soul: 'S2' }
        ]
      };

      const seatFields = ['timeout', 'seatBudget', 'totalSeatBudgetMs', 'votingTimeoutMs'];
      for (const field of seatFields) {
        for (const badVal of [0, -1, 1.5, '240000', NaN, Infinity, null, {}]) {
          const cfg = {
            ...validBase,
            seats: [
              { id: 's1', harness: 'mock', model: 'm', soul: 'S1', [field]: badVal },
              { id: 's2', harness: 'mock', model: 'm', soul: 'S2' }
            ]
          };
          const res = validateConfig(cfg);
          assert.equal(res.valid, false, `Expected seat field ${field}=${String(badVal)} to be rejected`);
          assert.ok(
            res.errors.some((e) => e.includes(`Seat "s1" ${field} must be a positive integer.`)),
            `Expected seat-attributed error for ${field}=${badVal}`
          );
        }
      }
    });

    it('1.6 resolveConfig normalizes aliases and throws on invalid boundary inputs', () => {
      const base = {
        topic: 'Resolution test',
        judge: { id: 'j', harness: 'mock', model: 'm', soul: 'J' },
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 'S1' },
          { id: 's2', harness: 'mock', model: 'm', soul: 'S2' }
        ]
      };

      // Valid resolution: aliases normalized
      const resolved = resolveConfig({
        ...base,
        timeout: 100000,
        seatBudget: 250000,
        'voting-timeout': 45000
      });
      assert.equal(resolved.timeoutMs, 100000);
      assert.equal(resolved.timeout, 100000);
      assert.equal(resolved.totalSeatBudgetMs, 250000);
      assert.equal(resolved.seatBudget, 250000);
      assert.equal(resolved.votingTimeoutMs, 45000);

      // Default budget is timeoutMs * 2 when seatBudget not provided
      const resolvedDefaultBudget = resolveConfig({ ...base, timeout: 60000 });
      assert.equal(resolvedDefaultBudget.totalSeatBudgetMs, 120000);

      // Throws descriptive error on invalid boundary input
      assert.throws(
        () => resolveConfig({ ...base, seatBudget: -1 }),
        /Invalid Council configuration.*seatBudget must be a positive integer\./
      );
      assert.throws(
        () => resolveConfig({ ...base, timeout: 0 }),
        /Invalid Council configuration.*timeout must be a positive integer\./
      );
    });
  });

  // ==========================================================================
  // Section 2: Engine Retry Budget Fuzzing & Boundary Conditions
  // ==========================================================================
  describe('2. Engine Retry Budget Fuzzing & Boundary Conditions', () => {

    it('2.1 excuses seat immediately without retry when seatElapsedMs exactly equals totalSeatBudgetMs', async () => {
      let attempts = 0;
      const mockHarness = new MockAdapter();
      mockHarness.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 's-boundary-equal') {
          attempts++;
          throw new TimeoutError('Deliberation timed out after 240000ms', {
            seatId: ctx.seat.id,
            harness: 'mock',
            timeoutMs: 240000
          });
        }
        return { scope: 'A', kind: 'check', source: 'S', statement: 'Statement' };
      };

      const engine = new CouncilEngine({
        topic: 'Exact budget equality boundary',
        maxRounds: 1,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        judge: { id: 'j', harness: 'mock', model: 'm', soul: 'J' },
        seats: [
          {
            id: 's-boundary-equal',
            harness: 'mock',
            model: 'grok-4.7-high',
            soul: 'S1',
            timeoutMs: 240000,
            totalSeatBudgetMs: 240000 // exactly equal: 240000 - 240000 = 0
          },
          { id: 's2', harness: 'mock', model: 'm', soul: 'S2' },
          { id: 's3', harness: 'mock', model: 'm', soul: 'S3' }
        ]
      }, { harnessResolver: () => mockHarness });

      engine.initRoster();
      const res = await engine.run();
      assert.equal(res.ok, true);

      // Must NOT attempt a retry: remainingBudget = 0 <= 0 triggers immediate excusal
      assert.equal(attempts, 1, 'Seat must not be retried when remainingBudget === 0');

      const seatState = res.state.seats.find((s) => s.id === 's-boundary-equal');
      assert.equal(seatState.status, 'excused');
      assert.match(
        seatState.excusedReason,
        /Exhausted total seat phase time budget \(240000ms >= 240000ms\)/
      );
    });

    it('2.2 excuses seat immediately without retry when remainingBudget is negative', async () => {
      let attempts = 0;
      const mockHarness = new MockAdapter();
      mockHarness.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 's-boundary-neg') {
          attempts++;
          throw new TimeoutError('Deliberation timed out after 250000ms', {
            seatId: ctx.seat.id,
            harness: 'mock',
            timeoutMs: 250000
          });
        }
        return { scope: 'A', kind: 'check', source: 'S', statement: 'Statement' };
      };

      const engine = new CouncilEngine({
        topic: 'Negative remaining budget boundary',
        maxRounds: 1,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        judge: { id: 'j', harness: 'mock', model: 'm', soul: 'J' },
        seats: [
          {
            id: 's-boundary-neg',
            harness: 'mock',
            model: 'grok-4.7-high',
            soul: 'S1',
            timeoutMs: 250000,
            totalSeatBudgetMs: 200000 // negative remaining: 200000 - 250000 = -50000
          },
          { id: 's2', harness: 'mock', model: 'm', soul: 'S2' },
          { id: 's3', harness: 'mock', model: 'm', soul: 'S3' }
        ]
      }, { harnessResolver: () => mockHarness });

      engine.initRoster();
      const res = await engine.run();
      assert.equal(res.ok, true);

      // Must NOT attempt a retry: remainingBudget = -50000 <= 0 triggers immediate excusal
      assert.equal(attempts, 1, 'Seat must not be retried when remainingBudget < 0');

      const seatState = res.state.seats.find((s) => s.id === 's-boundary-neg');
      assert.equal(seatState.status, 'excused');
      assert.match(
        seatState.excusedReason,
        /Exhausted total seat phase time budget \(250000ms >= 200000ms\)/
      );
    });

    it('2.3 caps retry timeout to 1ms when remainingBudget is 1ms', async () => {
      const attempts = [];
      const mockHarness = new MockAdapter();
      mockHarness.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 's-boundary-1ms') {
          attempts.push({ timeoutMs: ctx.timeoutMs, tools: ctx.tools });
          if (attempts.length === 1) {
            throw new TimeoutError('Timed out after 240000ms', {
              seatId: ctx.seat.id,
              harness: 'mock',
              timeoutMs: 240000
            });
          }
        }
        return { scope: 'A', kind: 'check', source: 'S', statement: 'Statement' };
      };

      const engine = new CouncilEngine({
        topic: '1ms remaining budget boundary',
        maxRounds: 1,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        judge: { id: 'j', harness: 'mock', model: 'm', soul: 'J' },
        seats: [
          {
            id: 's-boundary-1ms',
            harness: 'mock',
            model: 'grok-4.7-high',
            soul: 'S1',
            timeoutMs: 240000,
            totalSeatBudgetMs: 240001 // remaining budget: 240001 - 240000 = 1ms
          },
          { id: 's2', harness: 'mock', model: 'm', soul: 'S2' }
        ]
      }, { harnessResolver: () => mockHarness });

      engine.initRoster();
      const res = await engine.run();
      assert.equal(res.ok, true);

      assert.equal(attempts.length, 2);
      assert.equal(attempts[0].timeoutMs, 240000);
      // Math.min(240000, 90000, 1) === 1
      assert.equal(attempts[1].timeoutMs, 1, 'Retry timeout must be strictly capped to 1ms');
    });

    it('2.4 caps retry timeout to 90000ms when turnTimeoutMs is 240000ms and remaining budget is 120000ms', async () => {
      const attempts = [];
      const mockHarness = new MockAdapter();
      mockHarness.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 's-boundary-90s') {
          attempts.push({ timeoutMs: ctx.timeoutMs, tools: ctx.tools });
          if (attempts.length === 1) {
            throw new TimeoutError('Timed out after 240000ms', {
              seatId: ctx.seat.id,
              harness: 'mock',
              timeoutMs: 240000
            });
          }
        }
        return { scope: 'A', kind: 'check', source: 'S', statement: 'Statement' };
      };

      const engine = new CouncilEngine({
        topic: '90s cap boundary check',
        maxRounds: 1,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        judge: { id: 'j', harness: 'mock', model: 'm', soul: 'J' },
        seats: [
          {
            id: 's-boundary-90s',
            harness: 'mock',
            model: 'grok-4.7-high',
            soul: 'S1',
            timeoutMs: 240000,
            totalSeatBudgetMs: 360000 // remaining budget: 360000 - 240000 = 120000ms
          },
          { id: 's2', harness: 'mock', model: 'm', soul: 'S2' }
        ]
      }, { harnessResolver: () => mockHarness });

      engine.initRoster();
      const res = await engine.run();
      assert.equal(res.ok, true);

      assert.equal(attempts.length, 2);
      assert.equal(attempts[0].timeoutMs, 240000);
      // Math.min(240000, 90000, 120000) === 90000
      assert.equal(
        attempts[1].timeoutMs,
        90000,
        'Retry timeout must be capped at 90000ms (NOT 120000ms or 240000ms)'
      );
    });

    it('2.5 accumulates phase duration across multiple retries and excuses immediately once budget is exhausted', async () => {
      const attempts = [];
      const mockHarness = new MockAdapter();
      mockHarness.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 's-multi-retry') {
          attempts.push(ctx.timeoutMs);
          throw new TimeoutError(`Timed out after ${ctx.timeoutMs}ms`, {
            seatId: ctx.seat.id,
            harness: 'mock',
            timeoutMs: ctx.timeoutMs
          });
        }
        return { scope: 'A', kind: 'check', source: 'S', statement: 'Statement' };
      };

      const engine = new CouncilEngine({
        topic: 'Multi-retry budget accumulation',
        maxRounds: 1,
        minQuorum: 2,
        maxRetriesPerSeat: 5, // allows up to 5 retries, but budget only permits 1 retry
        judge: { id: 'j', harness: 'mock', model: 'm', soul: 'J' },
        seats: [
          {
            id: 's-multi-retry',
            harness: 'mock',
            model: 'grok-4.7-high',
            soul: 'S1',
            timeoutMs: 90000,
            totalSeatBudgetMs: 150000 // initial 90s + remaining 60s = 150s (exhausted on attempt 2)
          },
          { id: 's2', harness: 'mock', model: 'm', soul: 'S2' },
          { id: 's3', harness: 'mock', model: 'm', soul: 'S3' }
        ]
      }, { harnessResolver: () => mockHarness });

      engine.initRoster();
      const res = await engine.run();
      assert.equal(res.ok, true);

      // Attempt 1: 90000ms. Elapsed = 90000ms. Remaining = 60000ms.
      // Attempt 2: retry with min(90000, 90000, 60000) = 60000ms. Elapsed = 150000ms. Remaining = 0ms.
      // Next attempt prevented by budgetExhausted.
      assert.equal(attempts.length, 2, 'Must stop retrying as soon as cumulative budget is exhausted');
      assert.equal(attempts[0], 90000);
      assert.equal(attempts[1], 60000);

      const seatState = res.state.seats.find((s) => s.id === 's-multi-retry');
      assert.equal(seatState.status, 'excused');
      assert.match(
        seatState.excusedReason,
        /Exhausted total seat phase time budget \(150000ms >= 150000ms\)/
      );
    });

    it('2.6 bounds voting retry timeout to remaining budget and 90s cap', async () => {
      const voteAttempts = [];
      const mockHarness = new MockAdapter();
      mockHarness.executeSeatVote = async (ctx) => {
        if (ctx.seat.id === 's-voter-bound') {
          voteAttempts.push({ timeoutMs: ctx.timeoutMs, tools: ctx.tools });
          if (voteAttempts.length === 1) {
            throw new TimeoutError('Voting timed out after 90000ms', {
              seatId: ctx.seat.id,
              harness: 'mock',
              timeoutMs: 90000
            });
          }
        }
        return { vote: 'accept' };
      };

      const engine = new CouncilEngine({
        topic: 'Voting retry budget bounding',
        maxRounds: 1,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        judge: { id: 'j', harness: 'mock', model: 'm', soul: 'J' },
        seats: [
          {
            id: 's-voter-bound',
            harness: 'mock',
            model: 'grok-4.7-high',
            soul: 'S1',
            totalSeatBudgetMs: 160000 // default voting timeout = 90s. total budget 160s. Remaining after 90s = 70s.
          },
          { id: 's2', harness: 'mock', model: 'm', soul: 'S2' }
        ]
      }, { harnessResolver: () => mockHarness });

      engine.initRoster();
      const res = await engine.run();
      assert.equal(res.ok, true);

      assert.equal(voteAttempts.length, 2);
      // Attempt 1: default 90000ms
      assert.equal(voteAttempts[0].timeoutMs, 90000);
      // Attempt 2 (retry): remaining budget = 160000 - 90000 = 70000ms.
      // Capped to min(90000, 90000, 70000) = 70000ms.
      assert.equal(voteAttempts[1].timeoutMs, 70000);
    });
  });

  // ==========================================================================
  // Section 3: Tool-Loop Guard & Prompt Directives
  // ==========================================================================
  describe('3. Tool-Loop Guard & Prompt Directive Enforcement', () => {
    const codex = new CodexAdapter();

    it('3.1 disables tools on retry after TimeoutError and strips file/grep tool directives from deliberation prompt', async () => {
      const attempts = [];
      const mockHarness = new MockAdapter();
      mockHarness.executeSeatProof = async (ctx) => {
        const prompt = codex.formatSeatPrompt({
          seat: ctx.seat,
          soul: ctx.soul,
          round: ctx.round,
          phase: ctx.phase,
          state: ctx.state
        });
        if (ctx.seat.id === 's-guard-timeout') {
          attempts.push({
            seatId: ctx.seat.id,
            tools: ctx.tools,
            seatTools: ctx.seat.tools,
            prompt
          });
          if (attempts.length === 1) {
            throw new TimeoutError('Deliberation timed out after 60000ms', {
              seatId: ctx.seat.id,
              harness: 'mock',
              timeoutMs: 60000
            });
          }
        }
        return { scope: 'A', kind: 'check', source: 'S', statement: 'Statement' };
      };

      const engine = new CouncilEngine({
        topic: 'Deliberation tool-loop guard after TimeoutError',
        maxRounds: 1,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        seats: [
          {
            id: 's-guard-timeout',
            harness: 'mock',
            model: 'grok-4.7-high',
            soul: 'Architect',
            tools: 'read-only',
            timeoutMs: 60000,
            totalSeatBudgetMs: 120000
          },
          { id: 's2', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Partner' }
        ]
      }, { harnessResolver: () => mockHarness });

      engine.initRoster();
      const res = await engine.run();
      assert.equal(res.ok, true);

      assert.equal(attempts.length, 2);

      // Attempt 1: Read-only inspection tools active
      assert.equal(attempts[0].tools, 'read-only');
      assert.equal(attempts[0].seatTools, 'read-only');
      assert.ok(attempts[0].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE'));
      assert.ok(attempts[0].prompt.includes('You have read-only inspection tools enabled'));

      // Attempt 2 (Retry): Tool-loop guard forces tools to 'none'
      assert.equal(attempts[1].tools, 'none', 'Retry attempt must receive tools: none');
      assert.equal(attempts[1].seatTools, 'none', 'Retry seat.tools must be set to none');

      // Prompt verification: All tool directives and file/grep instructions MUST be omitted
      assert.equal(
        attempts[1].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE'),
        false,
        'Retry prompt must not contain TOOL USAGE & VERIFICATION DIRECTIVE'
      );
      assert.equal(
        attempts[1].prompt.includes('read-only inspection tools enabled'),
        false,
        'Retry prompt must not state inspection tools are enabled'
      );
      assert.equal(
        attempts[1].prompt.includes('rg, grep, find, ls'),
        false,
        'Retry prompt must not contain tool command references (rg, grep, find, ls)'
      );
      assert.equal(
        attempts[1].prompt.includes('local filesystem search'),
        false,
        'Retry prompt must not contain local filesystem search directives'
      );

      // STRICT ANTI-CHEATING RULE and strict JSON output contract must be preserved
      assert.ok(attempts[1].prompt.includes('STRICT ANTI-CHEATING RULE'));
      assert.ok(attempts[1].prompt.includes('OUTPUT CONTRACT (strict JSON):'));
    });

    it('3.2 disables tools on retry after fault_timeout (generic timeout error) and strips directives', async () => {
      const attempts = [];
      const mockHarness = new MockAdapter();
      mockHarness.executeSeatProof = async (ctx) => {
        const prompt = codex.formatSeatPrompt({
          seat: ctx.seat,
          soul: ctx.soul,
          round: ctx.round,
          phase: ctx.phase,
          state: ctx.state
        });
        if (ctx.seat.id === 's-guard-generic') {
          attempts.push({
            seatId: ctx.seat.id,
            tools: ctx.tools,
            seatTools: ctx.seat.tools,
            prompt
          });
          if (attempts.length === 1) {
            const err = new Error('Connection timed out after 60000ms');
            err.code = 'ETIMEDOUT';
            throw err;
          }
        }
        return { scope: 'A', kind: 'check', source: 'S', statement: 'Statement' };
      };

      const engine = new CouncilEngine({
        topic: 'Deliberation tool-loop guard after generic fault_timeout',
        maxRounds: 1,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        seats: [
          {
            id: 's-guard-generic',
            harness: 'mock',
            model: 'grok-4.7-high',
            soul: 'Architect',
            tools: 'read-only',
            timeoutMs: 60000,
            totalSeatBudgetMs: 120000
          },
          { id: 's2', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Partner' }
        ]
      }, { harnessResolver: () => mockHarness });

      engine.initRoster();
      const res = await engine.run();
      assert.equal(res.ok, true);

      assert.equal(attempts.length, 2);
      assert.equal(attempts[1].tools, 'none');
      assert.equal(attempts[1].seatTools, 'none');
      assert.equal(attempts[1].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE'), false);
    });

    it('3.3 preserves tools: read-only on retry when fault is NOT a timeout (e.g. HarnessExecutionError)', async () => {
      const attempts = [];
      const mockHarness = new MockAdapter();
      mockHarness.executeSeatProof = async (ctx) => {
        const prompt = codex.formatSeatPrompt({
          seat: ctx.seat,
          soul: ctx.soul,
          round: ctx.round,
          phase: ctx.phase,
          state: ctx.state
        });
        if (ctx.seat.id === 's-guard-nontimeout') {
          attempts.push({
            seatId: ctx.seat.id,
            tools: ctx.tools,
            seatTools: ctx.seat.tools,
            prompt
          });
          if (attempts.length === 1) {
            throw new HarnessExecutionError('Transient network hangup', {
              seatId: ctx.seat.id,
              harness: 'mock',
              isRetryable: true
            });
          }
        }
        return { scope: 'A', kind: 'check', source: 'S', statement: 'Statement' };
      };

      const engine = new CouncilEngine({
        topic: 'Deliberation non-timeout preserves tools',
        maxRounds: 1,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        seats: [
          {
            id: 's-guard-nontimeout',
            harness: 'mock',
            model: 'grok-4.7-high',
            soul: 'Architect',
            tools: 'read-only',
            timeoutMs: 60000,
            totalSeatBudgetMs: 120000
          },
          { id: 's2', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Partner' }
        ]
      }, { harnessResolver: () => mockHarness });

      engine.initRoster();
      const res = await engine.run();
      assert.equal(res.ok, true);

      assert.equal(attempts.length, 2);
      // Non-timeout retry preserves tools: read-only
      assert.equal(attempts[0].tools, 'read-only');
      assert.equal(attempts[1].tools, 'read-only');
      assert.equal(attempts[1].seatTools, 'read-only');
      assert.ok(attempts[1].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE'));
    });

    it('3.4 defaults confirmation voting to tools: none with tool-free prompt directive', () => {
      const voterSeat = {
        id: 'voter-default',
        harness: 'codex',
        model: 'gpt-6-astra (max)',
        soul: 'Architect',
        tools: 'read-only' // Has read-only in deliberation
      };

      const resolved = resolveVotingSeatConfig(voterSeat, {});
      assert.equal(resolved.tools, 'none', 'Voting phase must default tools to none');

      const prompt = formatVotingPrompt({
        soul: voterSeat.soul,
        seat: resolved,
        tools: resolved.tools
      });

      assert.ok(
        prompt.includes(
          'Do not invoke any tools during confirmation voting. Evaluate the Candidate Clauses strictly against the audited Proofs provided above and return your JSON vote immediately.'
        )
      );
      assert.equal(prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE'), false);
    });

    it('3.5 enforces tools: none on voting retry after TimeoutError under default voting settings', async () => {
      const voteAttempts = [];
      const mockHarness = new MockAdapter();
      mockHarness.executeSeatVote = async (ctx) => {
        const prompt = codex.formatSeatPrompt({
          seat: ctx.seat,
          soul: ctx.soul,
          round: ctx.round,
          phase: ctx.phase,
          state: ctx.state
        });
        if (ctx.seat.id === 's-voter-timeout-guard') {
          voteAttempts.push({
            seatId: ctx.seat.id,
            timeoutMs: ctx.timeoutMs,
            tools: ctx.tools,
            seatTools: ctx.seat.tools,
            prompt
          });
          if (voteAttempts.length === 1) {
            throw new TimeoutError('Voting call timed out after 90000ms', {
              seatId: ctx.seat.id,
              harness: 'mock',
              timeoutMs: 90000
            });
          }
        }
        return { vote: 'accept' };
      };

      const engine = new CouncilEngine({
        topic: 'Voting retry tool-loop guard',
        maxRounds: 1,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        judge: { id: 'j', harness: 'mock', model: 'm', soul: 'J' },
        seats: [
          {
            id: 's-voter-timeout-guard',
            harness: 'mock',
            model: 'grok-4.7-high',
            soul: 'Architect',
            tools: 'read-only', // Read-only in deliberation
            totalSeatBudgetMs: 200000
          },
          { id: 's2', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Partner' }
        ]
      }, { harnessResolver: () => mockHarness });

      engine.initRoster();
      const res = await engine.run();
      assert.equal(res.ok, true);

      assert.equal(voteAttempts.length, 2);

      // Attempt 1: defaults to tools: 'none'
      assert.equal(voteAttempts[0].tools, 'none');
      assert.ok(
        voteAttempts[0].prompt.includes('Do not invoke any tools during confirmation voting')
      );
      assert.equal(
        voteAttempts[0].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE'),
        false
      );

      // Attempt 2 (retry): remains tools: 'none' with tool-free prompt
      assert.equal(voteAttempts[1].tools, 'none');
      assert.ok(
        voteAttempts[1].prompt.includes('Do not invoke any tools during confirmation voting')
      );
      assert.equal(
        voteAttempts[1].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE'),
        false
      );
    });
  });

  // ==========================================================================
  // Section 4: Property-Based Randomized Fuzzing Harness
  // ==========================================================================
  describe('4. Property-Based Randomized Fuzzing Harness', () => {
    it('4.1 survives 100 randomized adversarial inputs without unhandled exceptions or NaN leakage', () => {
      const generators = [
        () => Math.floor(Math.random() * -1000000), // negative integers
        () => Math.random() * 10000, // positive floats
        () => (Math.random() - 0.5) * 10000, // random floats
        () => Math.random().toString(36).substring(2), // random strings
        () => ' '.repeat(Math.floor(Math.random() * 10)), // whitespace strings
        () => null,
        () => undefined,
        () => NaN,
        () => Infinity,
        () => -Infinity,
        () => ({ [Math.random().toString(36)]: Math.random() }),
        () => [Math.random()]
      ];

      for (let i = 0; i < 100; i++) {
        const gen = generators[i % generators.length];
        const val = gen();
        const errors = [];
        const res = validatePositiveInteger(val, `fuzz_${i}`, errors);

        // Verification invariants:
        if (val === undefined) {
          assert.equal(res.valid, true);
          assert.equal(errors.length, 0);
        } else if (typeof val === 'number' && Number.isInteger(val) && val > 0 && Number.isFinite(val)) {
          assert.equal(res.valid, true);
          assert.equal(errors.length, 0);
        } else {
          assert.equal(res.valid, false);
          assert.equal(errors.length, 1);
          assert.equal(errors[0], `fuzz_${i} must be a positive integer.`);
        }
      }
    });
  });
});
