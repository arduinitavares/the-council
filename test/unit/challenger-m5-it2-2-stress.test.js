/**
 * @fileoverview Adversarial Stress Test Suite: Config Normalization & Judge Options (Milestone 5 Iteration 2)
 *
 * Authored by: challenger_m5_it2_2
 * Scope:
 * - resolveConfig normalization between judge.timeout and judge.timeoutMs
 * - Priority resolution: judge.timeoutMs takes precedence over judge.timeout
 * - Single error emission (no duplicate messages) on invalid judge.timeoutMs
 * - Descriptive validation error emission on invalid judge.timeout
 * - Integer guarantee for cfg.judge.timeoutMs
 * - CouncilEngine state initialization and execution integration with judge timeout
 * - Edge cases: zero, negative, floats, NaNs, infinities, booleans, objects, strings, presets
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateConfig, resolveConfig, validatePositiveInteger } from '../../src/engine/config.js';
import { CouncilEngine } from '../../src/engine/council-engine.js';
import { MockAdapter } from '../../src/harness/mock.js';

describe('Adversarial Stress Test: Config Normalization & Judge Options (challenger_m5_it2_2)', () => {
  const baseValidConfig = () => ({
    topic: 'Adversarial Judge Options Verification',
    maxRounds: 2,
    minQuorum: 2,
    maxClarificationBatches: 1,
    maxRetriesPerSeat: 1,
    judge: {
      id: 'judge-auditor',
      harness: 'mock',
      model: 'gpt-6-astra (max)',
      soul: 'Impartial Judge'
    },
    seats: [
      { id: 'seat-1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Soul 1' },
      { id: 'seat-2', harness: 'mock', model: 'grok-4.7-high', soul: 'Soul 2' }
    ]
  });

  // =========================================================================
  // 1. resolveConfig: judge.timeout vs judge.timeoutMs Combinations
  // =========================================================================
  describe('1. resolveConfig judge.timeout vs judge.timeoutMs combinations', () => {
    it('resolves when only judge.timeout is provided: populates both timeoutMs and timeout symmetrically', () => {
      const cfg = resolveConfig({
        ...baseValidConfig(),
        judge: {
          ...baseValidConfig().judge,
          timeout: 45000
        }
      });

      assert.equal(cfg.judge.timeoutMs, 45000);
      assert.equal(cfg.judge.timeout, 45000);
      assert.equal(Number.isInteger(cfg.judge.timeoutMs), true);
      assert.equal(Number.isInteger(cfg.judge.timeout), true);
    });

    it('resolves when only judge.timeoutMs is provided: populates both timeoutMs and timeout symmetrically', () => {
      const cfg = resolveConfig({
        ...baseValidConfig(),
        judge: {
          ...baseValidConfig().judge,
          timeoutMs: 60000
        }
      });

      assert.equal(cfg.judge.timeoutMs, 60000);
      assert.equal(cfg.judge.timeout, 60000);
      assert.equal(Number.isInteger(cfg.judge.timeoutMs), true);
      assert.equal(Number.isInteger(cfg.judge.timeout), true);
    });

    it('resolves when both are provided with different values: judge.timeoutMs takes strict priority', () => {
      const cfg = resolveConfig({
        ...baseValidConfig(),
        judge: {
          ...baseValidConfig().judge,
          timeoutMs: 90000,
          timeout: 30000
        }
      });

      // timeoutMs (90000) must override timeout (30000)
      assert.equal(cfg.judge.timeoutMs, 90000);
      assert.equal(cfg.judge.timeout, 90000);
      assert.notEqual(cfg.judge.timeoutMs, 30000);
    });

    it('resolves when both are provided with the same value: preserves consistent value across both fields', () => {
      const cfg = resolveConfig({
        ...baseValidConfig(),
        judge: {
          ...baseValidConfig().judge,
          timeoutMs: 50000,
          timeout: 50000
        }
      });

      assert.equal(cfg.judge.timeoutMs, 50000);
      assert.equal(cfg.judge.timeout, 50000);
    });

    it('resolves when neither is provided: leaves judge.timeoutMs and judge.timeout undefined on merged judge', () => {
      const cfg = resolveConfig(baseValidConfig());

      assert.equal(cfg.judge.timeoutMs, undefined);
      assert.equal(cfg.judge.timeout, undefined);
      assert.equal('timeoutMs' in cfg.judge, false);
      assert.equal('timeout' in cfg.judge, false);
    });

    it('preserves other judge properties unchanged when normalizing timeouts', () => {
      const cfg = resolveConfig({
        ...baseValidConfig(),
        judge: {
          id: 'custom-judge-id',
          harness: 'mock',
          model: 'claude-opus-5-5-high',
          soul: 'Deep verification soul',
          timeout: 75000,
          cwd: '/custom/workspace/path',
          disableHooks: true,
          ignoreUserConfig: true,
          tools: 'read-only'
        }
      });

      assert.equal(cfg.judge.id, 'custom-judge-id');
      assert.equal(cfg.judge.harness, 'mock');
      assert.equal(cfg.judge.model, 'claude-opus-5-5-high');
      assert.equal(cfg.judge.soul, 'Deep verification soul');
      assert.equal(cfg.judge.timeoutMs, 75000);
      assert.equal(cfg.judge.timeout, 75000);
      assert.equal(cfg.judge.cwd, '/custom/workspace/path');
      assert.equal(cfg.judge.disableHooks, true);
      assert.equal(cfg.judge.ignoreUserConfig, true);
      assert.equal(cfg.judge.tools, 'read-only');
    });

    it('correctly overrides preset judge timeouts when user specifies judge.timeout', () => {
      const cfg = resolveConfig({
        preset: 'architecture',
        judge: {
          timeout: 35000
        }
      });

      assert.equal(cfg.judge.id, 'judge-opus');
      assert.equal(cfg.judge.timeoutMs, 35000);
      assert.equal(cfg.judge.timeout, 35000);
    });
  });

  // =========================================================================
  // 2. Integer Guarantees & Rejection of Invalid Types in resolveConfig
  // =========================================================================
  describe('2. Integer guarantees and rejection of invalid types in resolveConfig', () => {
    it('guarantees cfg.judge.timeoutMs is an integer on valid positive inputs', () => {
      const testIntegers = [1, 50, 1000, 45000, 240000, 9999999];
      for (const val of testIntegers) {
        const cfg1 = resolveConfig({
          ...baseValidConfig(),
          judge: { ...baseValidConfig().judge, timeout: val }
        });
        assert.equal(cfg1.judge.timeoutMs, val);
        assert.equal(Number.isInteger(cfg1.judge.timeoutMs), true);

        const cfg2 = resolveConfig({
          ...baseValidConfig(),
          judge: { ...baseValidConfig().judge, timeoutMs: val }
        });
        assert.equal(cfg2.judge.timeoutMs, val);
        assert.equal(Number.isInteger(cfg2.judge.timeoutMs), true);
      }
    });

    it('rejects float judge.timeout in resolveConfig with descriptive positive integer error', () => {
      const floatValues = [45000.5, 12.34, 0.1, 99.999];
      for (const val of floatValues) {
        assert.throws(
          () =>
            resolveConfig({
              ...baseValidConfig(),
              judge: { ...baseValidConfig().judge, timeout: val }
            }),
          (err) => {
            assert.match(err.message, /Judge timeout must be a positive integer/);
            return true;
          }
        );
      }
    });

    it('rejects float judge.timeoutMs in resolveConfig via normalized validation', () => {
      const floatValues = [45000.5, 12.34, 0.1, 99.999];
      for (const val of floatValues) {
        assert.throws(
          () =>
            resolveConfig({
              ...baseValidConfig(),
              judge: { ...baseValidConfig().judge, timeoutMs: val }
            }),
          (err) => {
            assert.match(err.message, /Judge timeout must be a positive integer/);
            return true;
          }
        );
      }
    });

    it('rejects negative judge.timeout and judge.timeoutMs in resolveConfig', () => {
      assert.throws(
        () =>
          resolveConfig({
            ...baseValidConfig(),
            judge: { ...baseValidConfig().judge, timeout: -500 }
          }),
        (err) => {
          assert.match(err.message, /Judge timeout must be a positive integer/);
          return true;
        }
      );

      assert.throws(
        () =>
          resolveConfig({
            ...baseValidConfig(),
            judge: { ...baseValidConfig().judge, timeoutMs: -500 }
          }),
        (err) => {
          assert.match(err.message, /Judge requires "timeoutMs" to be a positive number/);
          return true;
        }
      );
    });

    it('rejects non-numeric string timeouts in resolveConfig', () => {
      assert.throws(
        () =>
          resolveConfig({
            ...baseValidConfig(),
            judge: { ...baseValidConfig().judge, timeout: 'fast' }
          }),
        (err) => {
          assert.match(err.message, /Judge timeout must be a positive integer/);
          return true;
        }
      );

      assert.throws(
        () =>
          resolveConfig({
            ...baseValidConfig(),
            judge: { ...baseValidConfig().judge, timeoutMs: '100ms' }
          }),
        (err) => {
          assert.match(err.message, /Judge requires "timeoutMs" to be a positive number/);
          return true;
        }
      );
    });
  });

  // =========================================================================
  // 3. validateConfig: Deduplication & Single Error Emission for judge.timeoutMs
  // =========================================================================
  describe('3. validateConfig single error emission and deduplication for judge.timeoutMs', () => {
    const invalidMsInputs = [
      { label: 'negative number -500', value: -500 },
      { label: 'negative number -1', value: -1 },
      { label: 'zero 0', value: 0 },
      { label: 'string "fast"', value: 'fast' },
      { label: 'string numeric "60000"', value: '60000' },
      { label: 'NaN', value: NaN },
      { label: 'Infinity', value: Infinity },
      { label: '-Infinity', value: -Infinity },
      { label: 'null', value: null },
      { label: 'boolean true', value: true },
      { label: 'boolean false', value: false },
      { label: 'empty object {}', value: {} },
      { label: 'array [5000]', value: [5000] }
    ];

    for (const { label, value } of invalidMsInputs) {
      it(`emits exactly ONE error for invalid judge.timeoutMs (${label}), never duplicates`, () => {
        const config = {
          ...baseValidConfig(),
          judge: {
            ...baseValidConfig().judge,
            timeoutMs: value
          }
        };

        const result = validateConfig(config);
        assert.equal(result.valid, false);

        const msErrors = result.errors.filter((e) =>
          e.includes('Judge requires "timeoutMs" to be a positive number.')
        );
        assert.equal(
          msErrors.length,
          1,
          `Expected exactly 1 timeoutMs error for ${label}, but got ${msErrors.length}: ${JSON.stringify(msErrors)}`
        );
      });
    }
  });

  // =========================================================================
  // 4. validateConfig: Descriptive Error for judge.timeout
  // =========================================================================
  describe('4. validateConfig descriptive error emission for judge.timeout', () => {
    const invalidTimeoutInputs = [
      { label: 'negative integer -100', value: -100 },
      { label: 'zero 0', value: 0 },
      { label: 'float 45000.5', value: 45000.5 },
      { label: 'string "fast"', value: 'fast' },
      { label: 'string numeric "45000"', value: '45000' },
      { label: 'null', value: null },
      { label: 'boolean true', value: true },
      { label: 'empty object {}', value: {} },
      { label: 'array [1000]', value: [1000] },
      { label: 'NaN', value: NaN },
      { label: 'Infinity', value: Infinity }
    ];

    for (const { label, value } of invalidTimeoutInputs) {
      it(`emits descriptive "Judge timeout must be a positive integer." error for ${label}`, () => {
        const config = {
          ...baseValidConfig(),
          judge: {
            ...baseValidConfig().judge,
            timeout: value
          }
        };

        const result = validateConfig(config);
        assert.equal(result.valid, false);

        const timeoutErrors = result.errors.filter((e) =>
          e.includes('Judge timeout must be a positive integer.')
        );
        assert.equal(
          timeoutErrors.length,
          1,
          `Expected exactly 1 timeout error for ${label}, but got ${timeoutErrors.length}: ${JSON.stringify(timeoutErrors)}`
        );
      });
    }

    it('emits distinct, non-duplicate errors when both judge.timeout and judge.timeoutMs are invalid', () => {
      const config = {
        ...baseValidConfig(),
        judge: {
          ...baseValidConfig().judge,
          timeoutMs: -500,
          timeout: -500
        }
      };

      const result = validateConfig(config);
      assert.equal(result.valid, false);

      const msErrors = result.errors.filter((e) =>
        e.includes('Judge requires "timeoutMs" to be a positive number.')
      );
      const timeoutErrors = result.errors.filter((e) =>
        e.includes('Judge timeout must be a positive integer.')
      );

      assert.equal(msErrors.length, 1);
      assert.equal(timeoutErrors.length, 1);
    });
  });

  // =========================================================================
  // 5. CouncilEngine Integration & Judge Execution Timeout Propagation
  // =========================================================================
  describe('5. CouncilEngine integration & execution timeout propagation', () => {
    it('propagates resolved judge.timeout to engine.state.judge.timeoutMs', () => {
      const engine = new CouncilEngine({
        ...baseValidConfig(),
        judge: {
          ...baseValidConfig().judge,
          timeout: 48000
        }
      });

      assert.equal(engine.state.judge.timeoutMs, 48000);
      assert.equal(engine.config.judge.timeoutMs, 48000);
      assert.equal(engine.config.judge.timeout, 48000);
    });

    it('propagates resolved judge.timeoutMs to engine.state.judge.timeoutMs', () => {
      const engine = new CouncilEngine({
        ...baseValidConfig(),
        judge: {
          ...baseValidConfig().judge,
          timeoutMs: 64000
        }
      });

      assert.equal(engine.state.judge.timeoutMs, 64000);
      assert.equal(engine.config.judge.timeoutMs, 64000);
      assert.equal(engine.config.judge.timeout, 64000);
    });

    it('prioritizes timeoutMs over timeout in engine.state.judge.timeoutMs when both are provided', () => {
      const engine = new CouncilEngine({
        ...baseValidConfig(),
        judge: {
          ...baseValidConfig().judge,
          timeoutMs: 80000,
          timeout: 40000
        }
      });

      assert.equal(engine.state.judge.timeoutMs, 80000);
      assert.equal(engine.config.judge.timeoutMs, 80000);
    });

    it('falls back to root cfg.timeoutMs in engine.state.judge.timeoutMs when judge timeout is not configured', () => {
      const engine = new CouncilEngine({
        ...baseValidConfig(),
        timeout: 72000
      });

      // judge has no timeout specified, so createInitialCouncilState falls back to root timeoutMs
      assert.equal(engine.state.judge.timeoutMs, 72000);
      assert.equal(engine.config.timeoutMs, 72000);
    });

    it('delivers the exact resolved judge timeout to judge execution in runRound()', async () => {
      let receivedTimeoutInHarness = null;
      let executedRound = null;

      const engine = new CouncilEngine({
        ...baseValidConfig(),
        maxRounds: 1,
        judge: {
          ...baseValidConfig().judge,
          timeout: 38500
        }
      });

      const originalResolver = engine.harnessResolver;
      engine.harnessResolver = (type) => {
        const adapter = originalResolver(type);
        const originalExecuteJudge = adapter.executeJudge.bind(adapter);
        adapter.executeJudge = async (params) => {
          receivedTimeoutInHarness = params.timeoutMs;
          executedRound = params.round;
          return originalExecuteJudge(params);
        };
        return adapter;
      };

      engine.initRoster();
      const roundResult = await engine.runRound();

      assert.equal(roundResult.verdict.kind, 'Unanimous Consensus');
      assert.equal(executedRound, 1);
      assert.equal(receivedTimeoutInHarness, 38500);
    });

    it('delivers prioritized timeoutMs to judge execution in runRound() when both are specified', async () => {
      let receivedTimeoutInHarness = null;

      const engine = new CouncilEngine({
        ...baseValidConfig(),
        maxRounds: 1,
        judge: {
          ...baseValidConfig().judge,
          timeoutMs: 82000,
          timeout: 35000
        }
      });

      const originalResolver = engine.harnessResolver;
      engine.harnessResolver = (type) => {
        const adapter = originalResolver(type);
        const originalExecuteJudge = adapter.executeJudge.bind(adapter);
        adapter.executeJudge = async (params) => {
          receivedTimeoutInHarness = params.timeoutMs;
          return originalExecuteJudge(params);
        };
        return adapter;
      };

      engine.initRoster();
      await engine.runRound();

      assert.equal(receivedTimeoutInHarness, 82000);
    });

    it('delivers inherited root timeout to judge execution in runRound() when judge timeout is omitted', async () => {
      let receivedTimeoutInHarness = null;

      const engine = new CouncilEngine({
        ...baseValidConfig(),
        maxRounds: 1,
        timeout: 95000
      });

      const originalResolver = engine.harnessResolver;
      engine.harnessResolver = (type) => {
        const adapter = originalResolver(type);
        const originalExecuteJudge = adapter.executeJudge.bind(adapter);
        adapter.executeJudge = async (params) => {
          receivedTimeoutInHarness = params.timeoutMs;
          return originalExecuteJudge(params);
        };
        return adapter;
      };

      engine.initRoster();
      await engine.runRound();

      assert.equal(receivedTimeoutInHarness, 95000);
    });
  });
});
