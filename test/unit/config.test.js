import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, resolveConfig, validatePositiveInteger } from '../../src/engine/config.js';

describe('Unit: Config Validation & Resolution (Milestone M5 / Issues #70, #72)', () => {
  describe('validatePositiveInteger helper', () => {
    it('accepts valid positive integers', () => {
      const errors = [];
      assert.equal(validatePositiveInteger(100, 'timeout', errors).valid, true);
      assert.equal(validatePositiveInteger(1, 'timeout', errors).valid, true);
      assert.equal(validatePositiveInteger(480000, 'timeout', errors).valid, true);
      assert.equal(errors.length, 0);
    });

    it('rejects zero, negative numbers, floats, non-numbers, and non-finite values', () => {
      const cases = [
        { val: 0, field: 'timeout' },
        { val: -5, field: 'seatBudget' },
        { val: 12.34, field: 'totalSeatBudgetMs' },
        { val: '60000', field: 'votingTimeoutMs' },
        { val: NaN, field: 'timeout' },
        { val: Infinity, field: 'timeout' },
        { val: null, field: 'timeout' },
        { val: {}, field: 'timeout' },
        { val: [], field: 'timeout' },
        { val: true, field: 'timeout' }
      ];

      for (const { val, field } of cases) {
        const errors = [];
        const res = validatePositiveInteger(val, field, errors);
        assert.equal(res.valid, false, `Expected ${val} to fail validation for ${field}`);
        assert.equal(errors.length, 1);
        assert.match(errors[0], new RegExp(`${field} must be a positive integer\\.`));
      }
    });

    it('ignores undefined values without appending errors', () => {
      const errors = [];
      assert.equal(validatePositiveInteger(undefined, 'timeout', errors).valid, true);
      assert.equal(errors.length, 0);
    });
  });

  describe('validateConfig M5 bounds and integer validation', () => {
    const validBaseConfig = {
      topic: 'Bounded retry budget validation',
      maxRounds: 3,
      minQuorum: 2,
      maxClarificationBatches: 2,
      maxRetriesPerSeat: 1,
      judge: { id: 'judge-1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
      seats: [
        { id: 'seat-1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Architect' },
        { id: 'seat-2', harness: 'cursor', model: 'grok-4.7-high', soul: 'Reviewer' }
      ]
    };

    it('validates timeout, seatBudget, totalSeatBudgetMs, and votingTimeoutMs as positive integers', () => {
      const res = validateConfig({
        ...validBaseConfig,
        timeout: 120000,
        seatBudget: 240000,
        totalSeatBudgetMs: 240000,
        votingTimeoutMs: 60000,
        votingReasoningEffort: 'low',
        preserveVotingEffort: false,
        votingTools: 'none'
      });
      assert.equal(res.valid, true);
      assert.equal(res.errors.length, 0);
    });

    it('rejects non-integer and non-positive timeout values', () => {
      for (const badVal of [0, -100, 45.5, 'fast']) {
        const res = validateConfig({ ...validBaseConfig, timeout: badVal });
        assert.equal(res.valid, false);
        assert.ok(res.errors.some((e) => e.includes('timeout must be a positive integer.')));
      }
    });

    it('rejects non-integer and non-positive seatBudget and totalSeatBudgetMs values', () => {
      const res1 = validateConfig({ ...validBaseConfig, seatBudget: -10 });
      assert.equal(res1.valid, false);
      assert.ok(res1.errors.some((e) => e.includes('seatBudget must be a positive integer.')));

      const res2 = validateConfig({ ...validBaseConfig, totalSeatBudgetMs: 0 });
      assert.equal(res2.valid, false);
      assert.ok(res2.errors.some((e) => e.includes('totalSeatBudgetMs must be a positive integer.')));

      const res3 = validateConfig({ ...validBaseConfig, seatBudget: 15.5 });
      assert.equal(res3.valid, false);
      assert.ok(res3.errors.some((e) => e.includes('seatBudget must be a positive integer.')));
    });

    it('rejects non-integer and non-positive votingTimeoutMs values', () => {
      for (const badVal of [0, -90000, 89.9, 'slow']) {
        const res = validateConfig({ ...validBaseConfig, votingTimeoutMs: badVal });
        assert.equal(res.valid, false);
        assert.ok(res.errors.some((e) => e.includes('votingTimeoutMs must be a positive integer.')));
      }
    });

    it('preserves exact legacy error string for timeoutMs', () => {
      const resNeg = validateConfig({ ...validBaseConfig, timeoutMs: -1000 });
      assert.equal(resNeg.valid, false);
      assert.ok(resNeg.errors.includes('timeoutMs must be a positive number.'));

      const resZero = validateConfig({ ...validBaseConfig, timeoutMs: 0 });
      assert.equal(resZero.valid, false);
      assert.ok(resZero.errors.includes('timeoutMs must be a positive number.'));

      const resStr = validateConfig({ ...validBaseConfig, timeoutMs: '10000' });
      assert.equal(resStr.valid, false);
      assert.ok(resStr.errors.includes('timeoutMs must be a positive number.'));
    });

    it('validates votingReasoningEffort, votingTools, and preserveVotingEffort options', () => {
      const badEffort = validateConfig({ ...validBaseConfig, votingReasoningEffort: 'extreme' });
      assert.equal(badEffort.valid, false);
      assert.ok(badEffort.errors.some((e) => e.includes('votingReasoningEffort')));

      const badTools = validateConfig({ ...validBaseConfig, votingTools: 'read-write' });
      assert.equal(badTools.valid, false);
      assert.ok(badTools.errors.some((e) => e.includes('votingTools')));

      const badPreserve = validateConfig({ ...validBaseConfig, preserveVotingEffort: 'yes' });
      assert.equal(badPreserve.valid, false);
      assert.ok(badPreserve.errors.some((e) => e.includes('preserveVotingEffort')));
    });

    it('validates seat-level M5 configurations', () => {
      const res = validateConfig({
        ...validBaseConfig,
        seats: [
          {
            id: 'seat-1',
            harness: 'codex',
            model: 'gpt-6-astra (max)',
            soul: 'Architect',
            seatBudget: -500,
            votingTimeoutMs: 12.5,
            votingReasoningEffort: 'ultra'
          },
          { id: 'seat-2', harness: 'cursor', model: 'grok-4.7-high', soul: 'Reviewer' }
        ]
      });
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('seatBudget must be a positive integer.')));
      assert.ok(res.errors.some((e) => e.includes('votingTimeoutMs must be a positive integer.')));
      assert.ok(res.errors.some((e) => e.includes('"votingReasoningEffort" to be one of:')));
    });

    it('validates judge.timeoutMs once without duplicate error messages', () => {
      const res = validateConfig({
        ...validBaseConfig,
        judge: {
          id: 'judge-1',
          harness: 'codex',
          model: 'gpt-6-astra (max)',
          soul: 'Judge',
          timeoutMs: -500
        }
      });
      assert.equal(res.valid, false);
      const matching = res.errors.filter((e) => e.includes('Judge requires "timeoutMs" to be a positive number.'));
      assert.equal(matching.length, 1);
    });
  });

  describe('resolveConfig alias normalization', () => {
    it('normalizes timeout to timeoutMs and preserves both', () => {
      const cfg = resolveConfig({
        topic: 'Alias check',
        timeout: 75000,
        judge: { id: 'j', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Soul' },
          { id: 's2', harness: 'cursor', model: 'grok-4.7-high', soul: 'Soul' }
        ]
      });
      assert.equal(cfg.timeoutMs, 75000);
      assert.equal(cfg.timeout, 75000);
    });

    it('normalizes seatBudget and seat-budget to totalSeatBudgetMs', () => {
      const cfg1 = resolveConfig({
        topic: 'Seat budget check',
        seatBudget: 180000,
        judge: { id: 'j', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Soul' },
          { id: 's2', harness: 'cursor', model: 'grok-4.7-high', soul: 'Soul' }
        ]
      });
      assert.equal(cfg1.totalSeatBudgetMs, 180000);
      assert.equal(cfg1.seatBudget, 180000);

      const cfg2 = resolveConfig({
        topic: 'Kebab-case seat-budget check',
        'seat-budget': 200000,
        judge: { id: 'j', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Soul' },
          { id: 's2', harness: 'cursor', model: 'grok-4.7-high', soul: 'Soul' }
        ]
      });
      assert.equal(cfg2.totalSeatBudgetMs, 200000);
    });

    it('defaults totalSeatBudgetMs to timeoutMs * 2 when timeoutMs is resolved', () => {
      const cfg = resolveConfig({
        topic: 'Default budget check',
        timeout: 60000,
        judge: { id: 'j', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Soul' },
          { id: 's2', harness: 'cursor', model: 'grok-4.7-high', soul: 'Soul' }
        ]
      });
      assert.equal(cfg.totalSeatBudgetMs, 120000);
    });

    it('defaults votingTimeoutMs to 90000 and resolves aliases', () => {
      const cfgDefault = resolveConfig({
        topic: 'Default voting timeout',
        judge: { id: 'j', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Soul' },
          { id: 's2', harness: 'cursor', model: 'grok-4.7-high', soul: 'Soul' }
        ]
      });
      assert.equal(cfgDefault.votingTimeoutMs, 90000);

      const cfgAlias = resolveConfig({
        topic: 'Kebab-case voting-timeout',
        'voting-timeout': 45000,
        judge: { id: 'j', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Soul' },
          { id: 's2', harness: 'cursor', model: 'grok-4.7-high', soul: 'Soul' }
        ]
      });
      assert.equal(cfgAlias.votingTimeoutMs, 45000);
    });

    it('normalizes judge.timeout to judge.timeoutMs and preserves both', () => {
      const cfg = resolveConfig({
        topic: 'Judge timeout alias check',
        judge: { id: 'j', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge', timeout: 45000 },
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Soul' },
          { id: 's2', harness: 'cursor', model: 'grok-4.7-high', soul: 'Soul' }
        ]
      });
      assert.equal(cfg.judge.timeoutMs, 45000);
      assert.equal(cfg.judge.timeout, 45000);
    });

    it('prioritizes judge.timeoutMs over judge.timeout when both are supplied', () => {
      const cfg = resolveConfig({
        topic: 'Judge timeout conflict check',
        judge: { id: 'j', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge', timeoutMs: 60000, timeout: 30000 },
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Soul' },
          { id: 's2', harness: 'cursor', model: 'grok-4.7-high', soul: 'Soul' }
        ]
      });
      assert.equal(cfg.judge.timeoutMs, 60000);
      assert.equal(cfg.judge.timeout, 60000);
    });

    it('preserves explicit global totalSeatBudgetMs / seatBudget on seats even when global timeoutMs is also set (#70)', () => {
      const cfg = resolveConfig({
        topic: 'Explicit global seat-budget + timeout check',
        timeout: 120000,
        seatBudget: 180000,
        judge: { id: 'j', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
        seats: [
          { id: 's-inherit', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Soul' },
          { id: 's-seat-timeout', harness: 'cursor', model: 'grok-4.7-high', soul: 'Soul', timeoutMs: 50000 },
          { id: 's-seat-budget', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Soul', seatBudget: 95000 }
        ]
      });
      assert.equal(cfg.timeoutMs, 120000);
      assert.equal(cfg.totalSeatBudgetMs, 180000);
      assert.equal(cfg.seats[0].timeoutMs, 120000);
      assert.equal(cfg.seats[0].totalSeatBudgetMs, 180000, 'Seat without seat-level timeout/budget must inherit explicit global seatBudget (180000), not timeoutMs * 2 (240000)');
      assert.equal(cfg.seats[1].timeoutMs, 50000);
      assert.equal(cfg.seats[1].totalSeatBudgetMs, 100000, 'Seat with explicit seat-level timeoutMs and no seat-level budget derives 2 * seatSpecificTimeout');
      assert.equal(cfg.seats[2].totalSeatBudgetMs, 95000);

      // Re-invoking resolveConfig on an already resolved config (as CouncilEngine constructor does) must preserve 180000
      const reResolved = resolveConfig(cfg);
      assert.equal(reResolved.seats[0].totalSeatBudgetMs, 180000);
      assert.equal(reResolved.seats[1].totalSeatBudgetMs, 100000);
      assert.equal(reResolved.seats[2].totalSeatBudgetMs, 95000);
    });
  });
});
