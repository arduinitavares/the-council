/**
 * @fileoverview Adversarial Stress Test Suite for Milestone M5 (Issues #70 & #72).
 * Created by empirical challenger challenger_m5_2.
 * Zero external dependencies. Uses Node.js built-in test runner (node --test).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { downshiftEffort, downshiftModel, parseModelAndEffort } from '../../src/harness/cli-runner.js';
import { resolveVotingSeatConfig, CouncilEngine } from '../../src/engine/council-engine.js';
import { CursorAdapter } from '../../src/harness/cursor.js';
import { formatVotingPrompt } from '../../src/seats/soul.js';
import { MockAdapter } from '../../src/harness/mock.js';
import { TimeoutError, HarnessExecutionError } from '../../src/harness/adapter.js';

describe('Adversarial Stress Test: Milestone M5 Voting Optimization & Effort Downshift', () => {

  // ==========================================================================
  // Section 1: Reasoning Effort Downshift Matrix & Edge Cases
  // ==========================================================================
  describe('1. Reasoning Effort Downshift Matrix', () => {
    
    it('1.1 verifies downshift of hyphenated grok variants to low and medium', () => {
      // Suffix formats
      assert.equal(downshiftModel('grok-4.7-xhigh', 'low'), 'grok-4.7-low');
      assert.equal(downshiftModel('grok-4.7-high', 'low'), 'grok-4.7-low');
      assert.equal(downshiftModel('grok-4.7-medium', 'low'), 'grok-4.7-low');
      assert.equal(downshiftModel('grok-4.7-low', 'low'), 'grok-4.7-low');

      // Target medium downshift
      assert.equal(downshiftModel('grok-4.7-xhigh', 'medium'), 'grok-4.7-medium');
      assert.equal(downshiftModel('grok-4.7-high', 'medium'), 'grok-4.7-medium');
      assert.equal(downshiftModel('grok-4.7-medium', 'medium'), 'grok-4.7-medium');
    });

    it('1.2 verifies downshift of parenthesized model formats', () => {
      assert.equal(downshiftModel('gpt-6-astra (max)', 'low'), 'gpt-6-astra (low)');
      assert.equal(downshiftModel('gpt-6-astra (high)', 'low'), 'gpt-6-astra (low)');
      assert.equal(downshiftModel('gpt-6-astra (medium)', 'low'), 'gpt-6-astra (low)');
      assert.equal(downshiftModel('gpt-6-astra (low)', 'low'), 'gpt-6-astra (low)');

      // Target medium
      assert.equal(downshiftModel('gpt-6-astra (max)', 'medium'), 'gpt-6-astra (medium)');
      assert.equal(downshiftModel('gpt-6-astra (high)', 'medium'), 'gpt-6-astra (medium)');
      assert.equal(downshiftModel('gpt-6.1-sol (xhigh)', 'medium'), 'gpt-6.1-sol (medium)');
    });

    it('1.3 verifies non-tiered models remain strictly unchanged', () => {
      const nonTiered = [
        'composer-2.5',
        'claude-3-opus',
        'claude-3-5-sonnet',
        'llama-3.3-70b-instruct',
        'custom-specialist-model',
        'gpt-4o-mini'
      ];

      for (const m of nonTiered) {
        assert.equal(downshiftModel(m, 'low'), m);
        assert.equal(downshiftModel(m, 'medium'), m);
      }
    });

    it('1.4 strictly forbids upshifting lower effort tiers (never upshift invariant)', () => {
      // Effort level directly
      assert.equal(downshiftEffort('low', 'medium'), 'low');
      assert.equal(downshiftEffort('low', 'high'), 'low');
      assert.equal(downshiftEffort('low', 'xhigh'), 'low');
      assert.equal(downshiftEffort('low', 'max'), 'low');
      assert.equal(downshiftEffort('medium', 'high'), 'medium');
      assert.equal(downshiftEffort('medium', 'max'), 'medium');

      // Models
      assert.equal(downshiftModel('grok-4.7-low', 'medium'), 'grok-4.7-low');
      assert.equal(downshiftModel('grok-4.7-low', 'high'), 'grok-4.7-low');
      assert.equal(downshiftModel('gpt-6-astra (low)', 'medium'), 'gpt-6-astra (low)');
      assert.equal(downshiftModel('gpt-6-astra (low)', 'max'), 'gpt-6-astra (low)');
      assert.equal(downshiftModel('gemini-4-argon-medium', 'high'), 'gemini-4-argon-medium');
    });

    it('1.5 handles adversarial edge cases: casing, whitespace, and deceptive names', () => {
      // Mixed casing
      assert.equal(downshiftModel('GROK-4.7-XHIGH', 'low'), 'GROK-4.7-low');
      assert.equal(downshiftModel('gRoK-4.7-HiGh', 'low'), 'gRoK-4.7-low');
      assert.equal(downshiftModel('Gpt-6-Astra (MAX)', 'low'), 'Gpt-6-Astra (low)');
      assert.equal(downshiftModel('gpt-6-astra (   High   )', 'low'), 'gpt-6-astra (low)');

      // Whitespace
      assert.equal(downshiftModel('   grok-4.7-xhigh   ', 'low'), 'grok-4.7-low');
      assert.equal(downshiftModel('   composer-2.5   ', 'low'), 'composer-2.5');

      // Deceptive model names that contain 'high' or 'low' not as suffix
      assert.equal(downshiftModel('model-high-priority', 'low'), 'model-high-priority');
      assert.equal(downshiftModel('model-low-latency', 'low'), 'model-low-latency');
      assert.equal(downshiftModel('high-performance-cluster', 'low'), 'high-performance-cluster');

      // Empty, null, undefined, non-string
      assert.equal(downshiftModel('', 'low'), '');
      assert.equal(downshiftModel('   ', 'low'), '   ');
      assert.equal(downshiftModel(null, 'low'), null);
      assert.equal(downshiftModel(undefined, 'low'), undefined);
      assert.equal(downshiftModel(12345, 'low'), 12345);
      assert.deepEqual(downshiftModel({ model: 'grok' }, 'low'), { model: 'grok' });
    });
  });

  // ==========================================================================
  // Section 2: Voting Configuration Overrides & Precedence Hierarchy
  // ==========================================================================
  describe('2. Voting Overrides Hierarchy', () => {
    const defaultSeat = {
      id: 'seat-test',
      harness: 'cursor',
      model: 'grok-4.7-xhigh',
      soul: 'Skeptic',
      tools: 'read-only',
      timeoutMs: 240000
    };

    it('2.1 verify preserveVotingEffort === true completely disables downshifting', () => {
      // Seat level override
      const seatPreserved = resolveVotingSeatConfig({
        ...defaultSeat,
        preserveVotingEffort: true
      });
      assert.equal(seatPreserved.model, 'grok-4.7-xhigh');

      // Engine level default inherited by seat
      const enginePreserved = resolveVotingSeatConfig(defaultSeat, {
        preserveVotingEffort: true
      });
      assert.equal(enginePreserved.model, 'grok-4.7-xhigh');

      // Seat-level preserveVotingEffort: false explicitly overrides engine-level true
      const seatExplicitFalse = resolveVotingSeatConfig(
        { ...defaultSeat, preserveVotingEffort: false },
        { preserveVotingEffort: true }
      );
      assert.equal(seatExplicitFalse.model, 'grok-4.7-low');
    });

    it('2.2 verify explicit votingModel overrides both default downshifting and preserveVotingEffort', () => {
      // explicit votingModel overrides downshifting
      const cfg1 = resolveVotingSeatConfig({
        ...defaultSeat,
        votingModel: 'custom-voting-oracle'
      });
      assert.equal(cfg1.model, 'custom-voting-oracle');

      // explicit votingModel overrides preserveVotingEffort: true
      const cfg2 = resolveVotingSeatConfig({
        ...defaultSeat,
        preserveVotingEffort: true,
        votingModel: 'pinned-lightweight-model'
      });
      assert.equal(cfg2.model, 'pinned-lightweight-model');

      // explicit votingModel overrides votingReasoningEffort
      const cfg3 = resolveVotingSeatConfig({
        ...defaultSeat,
        votingReasoningEffort: 'medium',
        votingModel: 'pinned-custom-voter'
      });
      assert.equal(cfg3.model, 'pinned-custom-voter');
    });

    it('2.3 verify explicit votingTools overrides default tool-free policy', () => {
      // Default is 'none'
      const cfgDefault = resolveVotingSeatConfig(defaultSeat);
      assert.equal(cfgDefault.tools, 'none');

      // Seat level votingTools: 'read-only'
      const cfgSeatOverride = resolveVotingSeatConfig({
        ...defaultSeat,
        votingTools: 'read-only'
      });
      assert.equal(cfgSeatOverride.tools, 'read-only');

      // Engine level votingTools: 'read-only' inherited
      const cfgEngineOverride = resolveVotingSeatConfig(defaultSeat, {
        votingTools: 'read-only'
      });
      assert.equal(cfgEngineOverride.tools, 'read-only');

      // Seat level votingTools: 'none' overrides engine-level 'read-only'
      const cfgSeatWins = resolveVotingSeatConfig(
        { ...defaultSeat, votingTools: 'none' },
        { votingTools: 'read-only' }
      );
      assert.equal(cfgSeatWins.tools, 'none');
    });

    it('2.4 verifies prompt generation matches tool override directives', () => {
      const candidate = {
        round: 1,
        summary: 'Audit Candidate',
        clauses: [{ context: 'C1', conclusion: 'Claim', citedProofIds: ['P1'] }]
      };
      const admittedProofs = [{ id: 'P1', kind: 'check', scope: 'Global', statement: 'Verified', source: 'Doc' }];

      // Default 'none' tools injects immediate tool-free instructions
      const toolFreePrompt = formatVotingPrompt({
        soul: 'Test Soul',
        candidate,
        admittedProofs,
        tools: 'none'
      });
      assert.ok(toolFreePrompt.includes('Do not invoke any tools during confirmation voting'));
      assert.ok(toolFreePrompt.includes('return your JSON vote immediately'));
      assert.ok(!toolFreePrompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));

      // Explicit 'read-only' tools injects tool usage directive
      const readOnlyPrompt = formatVotingPrompt({
        soul: 'Test Soul',
        candidate,
        admittedProofs,
        tools: 'read-only'
      });
      assert.ok(!readOnlyPrompt.includes('Do not invoke any tools during confirmation voting'));
      assert.ok(readOnlyPrompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
    });
  });

  // ==========================================================================
  // Section 3: Voting Timeout Capping Scenarios
  // ==========================================================================
  describe('3. Voting Timeout Capping Bounds', () => {
    it('3.1 bounds large deliberation timeouts to voting timeout cap (default 90000ms)', () => {
      const seat = {
        id: 'seat-1',
        timeoutMs: 240000
      };
      const cfg = resolveVotingSeatConfig(seat);
      assert.equal(cfg.votingTimeoutMs, 90000);
    });

    it('3.2 preserves small deliberation timeouts without inflating to voting cap', () => {
      // 5,000ms deliberation timeout must NOT inflate to 90,000ms
      const seat5s = {
        id: 'seat-fast',
        timeoutMs: 5000
      };
      const cfg5s = resolveVotingSeatConfig(seat5s);
      assert.equal(cfg5s.votingTimeoutMs, 5000);

      // 45,000ms deliberation timeout preserves 45,000ms
      const seat45s = {
        id: 'seat-mid',
        timeoutMs: 45000
      };
      const cfg45s = resolveVotingSeatConfig(seat45s);
      assert.equal(cfg45s.votingTimeoutMs, 45000);
    });

    it('3.3 respects explicit votingTimeoutMs at seat and engine levels bounded by base timeout', () => {
      // Seat-level custom votingTimeoutMs smaller than timeoutMs
      const cfg1 = resolveVotingSeatConfig({
        id: 's1',
        timeoutMs: 120000,
        votingTimeoutMs: 30000
      });
      assert.equal(cfg1.votingTimeoutMs, 30000);

      // Engine-level custom votingTimeoutMs
      const cfg2 = resolveVotingSeatConfig(
        { id: 's2', timeoutMs: 180000 },
        { votingTimeoutMs: 45000 }
      );
      assert.equal(cfg2.votingTimeoutMs, 45000);

      // Explicit per-seat votingTimeoutMs exceeds small base timeout and is clamped only by totalSeatBudgetMs (Issue #89)
      const cfg3 = resolveVotingSeatConfig({
        id: 's3',
        timeoutMs: 10000,
        votingTimeoutMs: 60000
      });
      assert.equal(cfg3.votingTimeoutMs, 60000);

      const cfg4 = resolveVotingSeatConfig({
        id: 's4',
        timeoutMs: 10000,
        votingTimeoutMs: 60000,
        totalSeatBudgetMs: 40000
      });
      assert.equal(cfg4.votingTimeoutMs, 40000);
    });
  });

  // ==========================================================================
  // Section 4: Cursor Harness Model Validation Matrix
  // ==========================================================================
  describe('4. CursorAdapter Model Validation Matrix', () => {
    const adapter = new CursorAdapter();

    it('4.1 accepts all downshifted and canonical grok-4.7 variants', () => {
      const allowedGrok = [
        'grok-4.7-low',
        'grok-4.7-medium',
        'grok-4.7-high',
        'grok-4.7-xhigh'
      ];

      for (const m of allowedGrok) {
        assert.doesNotThrow(() => adapter.validateModel(m), `Expected "${m}" to be accepted`);
      }
    });

    it('4.2 accepts composer-2.5 and case variations with whitespace', () => {
      assert.doesNotThrow(() => adapter.validateModel('composer-2.5'));
      assert.doesNotThrow(() => adapter.validateModel('COMPOSER-2.5'));
      assert.doesNotThrow(() => adapter.validateModel('  composer-2.5  '));
      assert.doesNotThrow(() => adapter.validateModel('GROK-4.7-LOW'));
      assert.doesNotThrow(() => adapter.validateModel('  grok-4.7-medium  '));
      assert.doesNotThrow(() => adapter.validateModel('Grok-4.7-XHigh'));
    });

    it('4.3 strictly rejects unauthorized effort tiers for grok', () => {
      const rejectedGrok = [
        'grok-4.7-max',
        'grok-4.7-ultra',
        'grok-4.7-turbo',
        'grok-4-high'
      ];

      for (const m of rejectedGrok) {
        assert.throws(
          () => adapter.validateModel(m),
          (err) => {
            assert.ok(err instanceof HarnessExecutionError);
            assert.match(err.message, /not permitted under Cursor route/);
            return true;
          },
          `Expected "${m}" to be rejected`
        );
      }
    });

    it('4.4 strictly rejects composer-2.5 with invented reasoning effort', () => {
      const invalidComposer = [
        'composer-2.5-high',
        'composer-2.5-low',
        'composer-2.5-medium',
        'composer-2.5 (max)',
        'composer-2'
      ];

      for (const m of invalidComposer) {
        assert.throws(
          () => adapter.validateModel(m),
          (err) => {
            assert.ok(err instanceof HarnessExecutionError);
            assert.match(err.message, /not permitted under Cursor route/);
            return true;
          },
          `Expected "${m}" to be rejected`
        );
      }
    });

    it('4.5 strictly rejects foreign model lineages under Cursor route', () => {
      const foreignModels = [
        'gpt-6-astra (max)',
        'gpt-6.1-sol (high)',
        'gemini-4-argon-high',
        'claude-opus-5-5-high',
        'deepseek-r1-high'
      ];

      for (const m of foreignModels) {
        assert.throws(
          () => adapter.validateModel(m),
          (err) => {
            assert.ok(err instanceof HarnessExecutionError);
            assert.match(err.message, /not permitted under Cursor route/);
            return true;
          }
        );
      }
    });
  });

  // ==========================================================================
  // Section 5: End-to-End Adversarial Engine Deliberation & Voting Stress
  // ==========================================================================
  describe('5. End-to-End CouncilEngine Deliberation & Voting Stress', () => {
    it('5.1 executes multi-seat debate with diverse voting configs, verifying downshift and tool-free isolation', async () => {
      const capturedCalls = [];
      const mockHarness = new MockAdapter();
      const origExecuteSeat = mockHarness.executeSeat.bind(mockHarness);

      mockHarness.executeSeat = async (ctx) => {
        capturedCalls.push({
          seatId: ctx.seat.id,
          phase: ctx.phase,
          model: ctx.seat.model,
          timeoutMs: ctx.timeoutMs,
          tools: ctx.tools,
          votingTools: ctx.seat.votingTools
        });

        if (ctx.phase === 'VOTING') {
          return { vote: 'accept' };
        }
        return origExecuteSeat(ctx);
      };

      const engine = new CouncilEngine(
        {
          topic: 'Adversarial Stress Test Debate',
          maxRounds: 1,
          minQuorum: 3,
          judge: {
            id: 'judge-audit',
            harness: 'mock',
            model: 'gpt-6-astra (max)',
            soul: 'Judge'
          },
          seats: [
            // Seat 1: Default cursor grok -> downshifts to low, tools: none, timeout: 90000
            {
              id: 'seat-grok-xhigh',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Skeptic',
              timeoutMs: 240000,
              tools: 'read-only'
            },
            // Seat 2: Preserved effort -> model stays gpt-6-astra (max), tools: none, timeout: 45000
            {
              id: 'seat-preserved-astra',
              harness: 'mock',
              model: 'gpt-6-astra (max)',
              soul: 'Purist',
              preserveVotingEffort: true,
              timeoutMs: 45000,
              tools: 'read-only'
            },
            // Seat 3: Explicit votingModel & votingTools: read-only
            {
              id: 'seat-custom-voting',
              harness: 'mock',
              model: 'gemini-4-argon-high',
              soul: 'Security Auditor',
              votingModel: 'gemini-4-flash-verifier',
              votingTools: 'read-only',
              votingTimeoutMs: 30000,
              timeoutMs: 240000,
              tools: 'read-only'
            }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      engine.initRoster();
      const res = await engine.run();
      assert.equal(res.ok, true);

      // Verify VOTING calls
      const voteCalls = capturedCalls.filter((c) => c.phase === 'VOTING');
      assert.equal(voteCalls.length, 3);

      // Seat 1 verification
      const s1 = voteCalls.find((c) => c.seatId === 'seat-grok-xhigh');
      assert.ok(s1);
      assert.equal(s1.model, 'grok-4.7-low', 'Expected grok-4.7-xhigh to downshift to grok-4.7-low');
      assert.equal(s1.timeoutMs, 90000, 'Expected voting timeout capped to 90000ms');
      assert.equal(s1.tools, 'none', 'Expected voting tools defaulted to none');

      // Seat 2 verification
      const s2 = voteCalls.find((c) => c.seatId === 'seat-preserved-astra');
      assert.ok(s2);
      assert.equal(s2.model, 'gpt-6-astra (max)', 'Expected model effort preserved');
      assert.equal(s2.timeoutMs, 45000, 'Expected small deliberation timeout preserved');
      assert.equal(s2.tools, 'none', 'Expected voting tools defaulted to none');

      // Seat 3 verification
      const s3 = voteCalls.find((c) => c.seatId === 'seat-custom-voting');
      assert.ok(s3);
      assert.equal(s3.model, 'gemini-4-flash-verifier', 'Expected custom votingModel to override');
      assert.equal(s3.timeoutMs, 30000, 'Expected votingTimeoutMs 30000ms respected');
      assert.equal(s3.tools, 'read-only', 'Expected votingTools read-only override respected');
    });

    it('5.2 handles voting timeout fault and retry with tool suppression', async () => {
      let voteAttempts = 0;
      const capturedRetryCalls = [];
      const mockHarness = new MockAdapter();
      const origExecuteSeat = mockHarness.executeSeat.bind(mockHarness);

      mockHarness.executeSeat = async (ctx) => {
        if (ctx.phase === 'VOTING' && ctx.seat.id === 'seat-faulting-voter') {
          voteAttempts++;
          capturedRetryCalls.push({
            attempt: voteAttempts,
            tools: ctx.tools,
            timeoutMs: ctx.timeoutMs
          });
          if (voteAttempts === 1) {
            throw new TimeoutError('Execution timed out during voting', {
              harness: 'mock',
              seatId: ctx.seat.id,
              timeoutMs: 90000
            });
          }
          return { vote: 'accept' };
        }
        if (ctx.phase === 'VOTING') {
          return { vote: 'accept' };
        }
        return origExecuteSeat(ctx);
      };

      const engine = new CouncilEngine(
        {
          topic: 'Voting Retry Tool Guard Test',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          totalSeatBudgetMs: 300000,
          judge: { id: 'j', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'seat-faulting-voter',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Skeptic',
              votingTools: 'read-only', // initially read-only
              timeoutMs: 240000
            },
            {
              id: 'seat-ok',
              harness: 'mock',
              model: 'composer-2.5',
              soul: 'Helper'
            }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      engine.initRoster();
      const res = await engine.run();
      assert.equal(res.ok, true);
      assert.equal(voteAttempts, 2, 'Expected 1 fault + 1 retry');

      // Attempt 1 was 'read-only'
      assert.equal(capturedRetryCalls[0].tools, 'read-only');
      // Attempt 2 after timeout MUST force tools: 'none'
      assert.equal(capturedRetryCalls[1].tools, 'none', 'Retry after timeout must suppress tools to none');
      assert.ok(capturedRetryCalls[1].timeoutMs <= 90000, 'Retry timeout must be capped');
    });
  });
});
