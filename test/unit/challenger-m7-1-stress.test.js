/**
 * @fileoverview Adversarial Stress & Verification Suite for Milestone M7 (Issues #70 & #72).
 * Authored by: challenger_m7_1 (Empirical Challenger)
 * Focus: White-box verification and boundary hardening for:
 *   1. Issue #70: Bounded retry time budgets (totalSeatBudgetMs), Math.min capping,
 *      tool-loop disabling on retry (tools: 'none'), CLI flags (--timeout, --seat-budget),
 *      and host filesystem probing ban (!hasWorkspaceCwd / targeted read bounds).
 *   2. Issue #72: Tool-free voting defaults (tools: 'none'), reasoning effort downshifting,
 *      Cursor adapter downshifted Grok model validation, voting timeout capping,
 *      and formatVotingPrompt directives.
 * Zero external dependencies. Uses Node.js built-in test runner (node --test).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CouncilEngine, resolveVotingSeatConfig } from '../../src/engine/council-engine.js';
import { resolveConfig, validateConfig, validatePositiveInteger } from '../../src/engine/config.js';
import { downshiftEffort, downshiftModel } from '../../src/harness/cli-runner.js';
import { CursorAdapter } from '../../src/harness/cursor.js';
import { MockAdapter } from '../../src/harness/mock.js';
import {
  TimeoutError,
  HarnessExecutionError,
  InvalidResponseError,
  QuotaExhaustionError
} from '../../src/harness/adapter.js';
import {
  formatDeliberationPrompt,
  formatVotingPrompt,
  formatJudgePrompt,
  ANTI_CHEATING_RULE
} from '../../src/seats/soul.js';
import { runCli } from '../../src/cli/index.js';

describe('Adversarial Challenger M7-1: Issues #70 & #72 Stress Suite', () => {

  // ==========================================================================
  // Section 1: Issue #70 - Bounded Retry Time Budgets & Math.min Capping
  // ==========================================================================
  describe('1. Issue #70: Bounded Retry Time Budgets (totalSeatBudgetMs) & Multi-Step Tracking', () => {

    it('1.1 immediately excuses seat without retry when initial fault exhausts full budget (remainingBudget === 0)', async () => {
      const mockHarness = new MockAdapter();
      let exhaustedSeatAttempts = 0;

      mockHarness.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 'budget-exhausted-seat') {
          exhaustedSeatAttempts++;
          throw new TimeoutError('Seat deliberation timed out after 60000ms', {
            seatId: ctx.seat.id,
            harness: 'mock',
            timeoutMs: 60000
          });
        }
        return {
          id: `P-${ctx.seat.id}`,
          kind: 'check',
          scope: 'Verification',
          source: 'unit-test',
          statement: 'Passed'
        };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Exact budget exhaustion',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 2,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'budget-exhausted-seat',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Skeptic',
              timeoutMs: 60000,
              totalSeatBudgetMs: 60000 // Exactly equal to timeout
            },
            {
              id: 'seat-survivor-1',
              harness: 'mock',
              model: 'gpt-6-astra (max)',
              soul: 'Architect'
            },
            {
              id: 'seat-survivor-2',
              harness: 'mock',
              model: 'gemini-4-argon-high',
              soul: 'Empiricist'
            }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      engine.initRoster();
      const result = await engine.run();

      // Only 1 call attempted for budget-exhausted-seat, no retries permitted
      assert.equal(exhaustedSeatAttempts, 1);
      const excusedSeat = engine.state.seats.find((s) => s.id === 'budget-exhausted-seat');
      assert.ok(excusedSeat);
      assert.equal(excusedSeat.status, 'excused');
      assert.match(excusedSeat.excusedReason, /Exhausted total seat phase time budget \(60000ms >= 60000ms\)/);
      assert.equal(result.ok, true); // Still reaches consensus with surviving quorum
    });

    it('1.2 immediately excuses seat when initial fault overspends budget (remainingBudget < 0)', async () => {
      const mockHarness = new MockAdapter();
      let overspentSeatAttempts = 0;

      mockHarness.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 'overspent-seat') {
          overspentSeatAttempts++;
          throw new TimeoutError('Seat deliberation timed out after 75000ms', {
            seatId: ctx.seat.id,
            harness: 'mock',
            timeoutMs: 75000
          });
        }
        return {
          id: `P-${ctx.seat.id}`,
          kind: 'check',
          scope: 'Verification',
          source: 'unit-test',
          statement: 'Passed'
        };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Overspent budget exhaustion',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 3,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'overspent-seat',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Skeptic',
              timeoutMs: 60000,
              totalSeatBudgetMs: 50000 // Budget is less than the elapsed duration
            },
            {
              id: 'seat-survivor-1',
              harness: 'mock',
              model: 'gpt-6-astra (max)',
              soul: 'Architect'
            },
            {
              id: 'seat-survivor-2',
              harness: 'mock',
              model: 'gemini-4-argon-high',
              soul: 'Empiricist'
            }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      engine.initRoster();
      const result = await engine.run();

      assert.equal(overspentSeatAttempts, 1);
      const excusedSeat = engine.state.seats.find((s) => s.id === 'overspent-seat');
      assert.ok(excusedSeat);
      assert.equal(excusedSeat.status, 'excused');
      assert.match(excusedSeat.excusedReason, /Exhausted total seat phase time budget \(75000ms >= 50000ms\)/);
      assert.equal(result.ok, true);
    });

    it('1.3 tracks cumulative phase elapsed time across multiple retries and bounds retryTimeoutMs at each step', async () => {
      const mockHarness = new MockAdapter();
      const capturedRetryTimeouts = [];

      mockHarness.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 'multi-retry-seat') {
          capturedRetryTimeouts.push(ctx.timeoutMs);
          const attempt = capturedRetryTimeouts.length;
          if (attempt === 1) {
            // First attempt burns 35000ms
            throw new TimeoutError('Attempt 1 timeout', {
              seatId: ctx.seat.id,
              harness: 'mock',
              timeoutMs: 35000
            });
          } else if (attempt === 2) {
            // Second attempt burns 45000ms (cumulative 80000ms of 100000ms)
            throw new TimeoutError('Attempt 2 timeout', {
              seatId: ctx.seat.id,
              harness: 'mock',
              timeoutMs: 45000
            });
          } else if (attempt === 3) {
            // Third attempt burns 25000ms (cumulative 105000ms >= 100000ms)
            throw new TimeoutError('Attempt 3 timeout', {
              seatId: ctx.seat.id,
              harness: 'mock',
              timeoutMs: 25000
            });
          }
        }
        return {
          id: `P-${ctx.seat.id}`,
          kind: 'check',
          scope: 'Verification',
          source: 'unit-test',
          statement: 'Passed'
        };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Cumulative budget tracking',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 4,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'multi-retry-seat',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Skeptic',
              timeoutMs: 120000,
              totalSeatBudgetMs: 100000
            },
            {
              id: 'seat-survivor-1',
              harness: 'mock',
              model: 'gpt-6-astra (max)',
              soul: 'Architect'
            },
            {
              id: 'seat-survivor-2',
              harness: 'mock',
              model: 'gemini-4-argon-high',
              soul: 'Empiricist'
            }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      engine.initRoster();
      const result = await engine.run();

      // Check captured retry timeouts:
      // Initial call: ctx.timeoutMs is clamped to Math.min(120000, 100000) = 100000
      // Retry 1: remainingBudget = 100000 - 35000 = 65000. Math.min(120000, 90000, 65000) = 65000
      // Retry 2: remainingBudget = 100000 - 80000 = 20000. Math.min(120000, 90000, 20000) = 20000
      assert.deepEqual(capturedRetryTimeouts, [100000, 65000, 20000]);

      const excusedSeat = engine.state.seats.find((s) => s.id === 'multi-retry-seat');
      assert.ok(excusedSeat);
      assert.equal(excusedSeat.status, 'excused');
      assert.match(excusedSeat.excusedReason, /Exhausted total seat phase time budget \(105000ms >= 100000ms\)/);
      assert.equal(result.ok, true);
    });

    it('1.4 verifies Math.min(baseTimeoutMs, 90000, remainingBudget) selects each candidate branch correctly', async () => {
      const mockHarness = new MockAdapter();
      const recordedTimeouts = {};

      mockHarness.executeSeatProof = async (ctx) => {
        recordedTimeouts[ctx.seat.id] = recordedTimeouts[ctx.seat.id] || [];
        recordedTimeouts[ctx.seat.id].push(ctx.timeoutMs);
        if (recordedTimeouts[ctx.seat.id].length === 1) {
          throw new TimeoutError('Trigger retry', {
            seatId: ctx.seat.id,
            harness: 'mock',
            timeoutMs: 10000
          });
        }
        return {
          id: `P-${ctx.seat.id}`,
          kind: 'check',
          scope: 'Verification',
          source: 'unit-test',
          statement: 'Passed'
        };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Math.min 3-branch verification',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            // Branch A: baseTimeoutMs is smallest (25000 < 90000 < remaining 90000)
            {
              id: 'branch-a-seat',
              harness: 'mock',
              model: 'custom',
              soul: 'Skeptic',
              timeoutMs: 25000,
              totalSeatBudgetMs: 100000
            },
            // Branch B: 90000 is smallest (90000 < base 150000 < remaining 190000)
            {
              id: 'branch-b-seat',
              harness: 'mock',
              model: 'custom',
              soul: 'Architect',
              timeoutMs: 150000,
              totalSeatBudgetMs: 200000
            },
            // Branch C: remainingBudget is smallest (remaining 40000 < 90000 < base 120000)
            {
              id: 'branch-c-seat',
              harness: 'mock',
              model: 'custom',
              soul: 'Empiricist',
              timeoutMs: 120000,
              totalSeatBudgetMs: 50000 // After 10000ms elapsed, remaining is 40000ms
            }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      engine.initRoster();
      const result = await engine.run();
      assert.equal(result.ok, true);

      // Branch A: Math.min(25000, 90000, 90000) = 25000
      assert.equal(recordedTimeouts['branch-a-seat'][1], 25000);
      // Branch B: Math.min(150000, 90000, 190000) = 90000
      assert.equal(recordedTimeouts['branch-b-seat'][1], 90000);
      // Branch C: Math.min(120000, 90000, 40000) = 40000
      assert.equal(recordedTimeouts['branch-c-seat'][1], 40000);
    });
  });

  // ==========================================================================
  // Section 2: Issue #70 - Disabling Exploratory Tool Loops on Retry
  // ==========================================================================
  describe('2. Issue #70: Tool-Loop Guard on Retry (tools: "none")', () => {

    it('2.1 deliberation retry after TimeoutError strips read-only tools to "none" in execution context and prompt', async () => {
      const mockHarness = new MockAdapter();
      const capturedDeliberationCalls = [];

      mockHarness.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 'delib-timeout-seat') {
          const attempt = capturedDeliberationCalls.length + 1;
          const prompt = formatDeliberationPrompt({
            soul: ctx.soul,
            seat: ctx.seat,
            tools: ctx.tools,
            topic: ctx.topic
          });
          capturedDeliberationCalls.push({
            attempt,
            tools: ctx.tools,
            seatTools: ctx.seat.tools,
            timeoutMs: ctx.timeoutMs,
            prompt
          });
          if (attempt === 1) {
            throw new TimeoutError('Deliberation burned 240s in exploratory tool loop', {
              seatId: ctx.seat.id,
              harness: 'mock',
              timeoutMs: 240000
            });
          }
        }
        return {
          id: `P-${ctx.seat.id}`,
          kind: 'check',
          scope: 'Verification',
          source: 'unit-test',
          statement: 'Deliberation succeeded'
        };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Tool-loop disabling verification',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'delib-timeout-seat',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Skeptic',
              tools: 'read-only',
              timeoutMs: 240000,
              totalSeatBudgetMs: 400000
            },
            {
              id: 'seat-peer',
              harness: 'mock',
              model: 'gpt-6-astra (max)',
              soul: 'Architect'
            }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      engine.initRoster();
      const result = await engine.run();
      assert.equal(result.ok, true);

      assert.equal(capturedDeliberationCalls.length, 2);
      // Attempt 1: tools was read-only
      assert.equal(capturedDeliberationCalls[0].tools, 'read-only');
      assert.equal(capturedDeliberationCalls[0].seatTools, 'read-only');
      assert.ok(capturedDeliberationCalls[0].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));

      // Attempt 2 (Retry after TimeoutError): tools MUST be 'none'
      assert.equal(capturedDeliberationCalls[1].tools, 'none');
      assert.equal(capturedDeliberationCalls[1].seatTools, 'none');
      assert.equal(capturedDeliberationCalls[1].timeoutMs, 90000); // Bounded to 90s
      assert.ok(!capturedDeliberationCalls[1].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
      assert.ok(capturedDeliberationCalls[1].prompt.includes(ANTI_CHEATING_RULE));
    });

    it('2.2 voting retry after TimeoutError strips explicit votingTools "read-only" to "none"', async () => {
      const mockHarness = new MockAdapter();
      const capturedVoteCalls = [];

      mockHarness.executeSeatVote = async (ctx) => {
        if (ctx.seat.id === 'voting-timeout-seat') {
          const attempt = capturedVoteCalls.length + 1;
          const prompt = formatVotingPrompt({
            soul: ctx.soul,
            seat: ctx.seat,
            tools: ctx.tools,
            candidate: ctx.candidate,
            admittedProofs: []
          });
          capturedVoteCalls.push({
            attempt,
            tools: ctx.tools,
            seatTools: ctx.seat.tools,
            seatVotingTools: ctx.seat.votingTools,
            timeoutMs: ctx.timeoutMs,
            prompt
          });
          if (attempt === 1) {
            throw new TimeoutError('Voting timed out', {
              seatId: ctx.seat.id,
              harness: 'mock',
              timeoutMs: 60000
            });
          }
        }
        return { vote: 'accept' };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Voting tool override retry',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'voting-timeout-seat',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Skeptic',
              votingTools: 'read-only', // Explicit override
              timeoutMs: 120000,
              totalSeatBudgetMs: 200000
            },
            {
              id: 'seat-peer',
              harness: 'mock',
              model: 'gpt-6-astra (max)',
              soul: 'Architect'
            }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      engine.initRoster();
      const result = await engine.run();
      assert.equal(result.ok, true);

      assert.equal(capturedVoteCalls.length, 2);
      // Attempt 1: had votingTools 'read-only'
      assert.equal(capturedVoteCalls[0].tools, 'read-only');
      assert.ok(capturedVoteCalls[0].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));

      // Attempt 2: retry after TimeoutError strips tools to 'none'
      assert.equal(capturedVoteCalls[1].tools, 'none');
      assert.equal(capturedVoteCalls[1].seatTools, 'none');
      assert.equal(capturedVoteCalls[1].seatVotingTools, 'none');
      assert.ok(!capturedVoteCalls[1].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
      assert.ok(
        capturedVoteCalls[1].prompt.includes(
          'Do not invoke any tools during confirmation voting. Evaluate the Candidate Clauses strictly against the audited Proofs provided above and return your JSON vote immediately.'
        )
      );
    });
  });

  // ==========================================================================
  // Section 3: Issue #70 - CLI Flags --timeout and --seat-budget
  // ==========================================================================
  describe('3. Issue #70: CLI Flags --timeout and --seat-budget', () => {

    function createMockIo() {
      let stdoutStr = '';
      let stderrStr = '';
      let exitCode = null;
      return {
        io: {
          stdout: { write: (msg) => { stdoutStr += msg; }, isTTY: false },
          stderr: { write: (msg) => { stderrStr += msg; } },
          exit: (code) => { exitCode = code; return code; }
        },
        getStdout: () => stdoutStr,
        getStderr: () => stderrStr,
        getExitCode: () => exitCode
      };
    }

    it('3.1 parses --timeout and --seat-budget and exposes them on JSON output state', async () => {
      const { io, getStdout, getExitCode } = createMockIo();

      const exitCode = await runCli([
        'run',
        '--mock',
        '--topic', 'Test CLI budget flags',
        '--timeout', '45000',
        '--seat-budget', '90000',
        '--json'
      ], io);

      assert.equal(exitCode, 0);
      assert.equal(getExitCode(), 0);

      const parsed = JSON.parse(getStdout());
      assert.equal(parsed.mode, 'mock');
      assert.equal(parsed.state.timeoutMs, 45000);
      assert.equal(parsed.state.totalSeatBudgetMs, 90000);
    });

    it('3.2 parses camelCase --seatBudget alias correctly', async () => {
      const { io, getStdout, getExitCode } = createMockIo();

      const exitCode = await runCli([
        'run',
        '--mock',
        '--topic', 'Test CLI camelCase alias',
        '--timeout', '30000',
        '--seatBudget', '80000',
        '--json'
      ], io);

      assert.equal(exitCode, 0);
      assert.equal(getExitCode(), 0);

      const parsed = JSON.parse(getStdout());
      assert.equal(parsed.state.timeoutMs, 30000);
      assert.equal(parsed.state.totalSeatBudgetMs, 80000);
    });

    it('3.3 rejects invalid --timeout boundary inputs with exit 1 and descriptive error', async () => {
      const invalidTimeouts = ['0', '-10', 'NaN', 'abc', '1.5', ''];
      for (const val of invalidTimeouts) {
        const { io, getStderr, getExitCode } = createMockIo();
        const args = val.startsWith('-')
          ? ['run', '--mock', '--topic', 'Test invalid timeout', `--timeout=${val}`]
          : ['run', '--mock', '--topic', 'Test invalid timeout', '--timeout', val];

        const code = await runCli(args, io);

        assert.equal(code, 1, `Expected exit 1 for --timeout "${val}"`);
        assert.equal(getExitCode(), 1);
        assert.match(getStderr(), /Configuration error: --timeout must be a positive integer/);
      }
    });

    it('3.4 rejects invalid --seat-budget boundary inputs with exit 1 and descriptive error', async () => {
      const invalidBudgets = ['0', '-500', 'not-a-num', '99.9', ''];
      for (const val of invalidBudgets) {
        const { io, getStderr, getExitCode } = createMockIo();
        const args = val.startsWith('-')
          ? ['run', '--mock', '--topic', 'Test invalid seat budget', `--seat-budget=${val}`]
          : ['run', '--mock', '--topic', 'Test invalid seat budget', '--seat-budget', val];

        const code = await runCli(args, io);

        assert.equal(code, 1, `Expected exit 1 for --seat-budget "${val}"`);
        assert.equal(getExitCode(), 1);
        assert.match(getStderr(), /Configuration error: --seat-budget must be a positive integer/);
      }
    });

    it('3.5 defaults seat budget to timeout * 2 when --timeout is provided but --seat-budget is omitted', () => {
      const resolved = resolveConfig({
        timeout: 40000
      });
      assert.equal(resolved.timeoutMs, 40000);
      assert.equal(resolved.totalSeatBudgetMs, 80000);
      for (const seat of resolved.seats) {
        assert.equal(seat.timeoutMs, 40000);
        assert.equal(seat.totalSeatBudgetMs, 80000);
      }
    });
  });

  // ==========================================================================
  // Section 4: Issue #70 & #73 - Host Path Probing Ban & Targeted Read Bounds
  // ==========================================================================
  describe('4. Issue #70 & #73: Host Path Probing Ban and Baseline Evidence Directives', () => {

    const testEvidence = [
      {
        id: 'E1',
        label: 'Kernel Spec',
        source: 'kernel/arch.md',
        text: 'Preemption timer interval is 10ms.'
      },
      {
        id: 'E2',
        label: 'Driver Source',
        source: 'drivers/net/virtio.c',
        text: 'Ring size is 256 descriptors.'
      }
    ];

    it('4.1 forbids reading absolute host paths when !hasWorkspaceCwd in deliberation, voting, and judge prompts', () => {
      const delibPrompt = formatDeliberationPrompt({
        soul: 'Impartial Auditor',
        seat: { id: 's1', tools: 'read-only' },
        topic: 'Filesystem policy verification',
        evidence: testEvidence,
        cwd: null
      });

      const votePrompt = formatVotingPrompt({
        soul: 'Impartial Auditor',
        seat: { id: 's1', tools: 'read-only' },
        candidate: { round: 1, summary: 'Candidate', clauses: [] },
        admittedProofs: [],
        evidence: testEvidence,
        cwd: null
      });

      const judgePrompt = formatJudgePrompt({
        judge: { id: 'j1', soul: 'Impartial Judge' },
        topic: 'Filesystem policy verification',
        round: 1,
        proofs: [],
        evidence: testEvidence,
        cwd: null
      });

      for (const prompt of [delibPrompt, votePrompt, judgePrompt]) {
        assert.match(
          prompt,
          /do NOT read or probe absolute host file paths mentioned in the topic or evidence packet/
        );
        assert.match(
          prompt,
          /do NOT run local filesystem tools \(cat, readToolCall, view_file\)/
        );
      }
    });

    it('4.2 caps local reads to 3–5 targeted spot-checks when hasWorkspaceCwd && resolvedEvidence.length > 0', () => {
      const delibPrompt = formatDeliberationPrompt({
        soul: 'Impartial Auditor',
        seat: { id: 's1', tools: 'read-only' },
        topic: 'Targeted read bounds',
        evidence: testEvidence,
        cwd: '/Users/aaat/projects/target-repo'
      });

      const judgePrompt = formatJudgePrompt({
        judge: { id: 'j1', soul: 'Impartial Judge' },
        topic: 'Targeted read bounds',
        round: 1,
        proofs: [],
        evidence: testEvidence,
        cwd: '/Users/aaat/projects/target-repo'
      });

      for (const prompt of [delibPrompt, judgePrompt]) {
        assert.match(prompt, /at most 3–5 targeted reads/);
      }
    });

    it('4.3 frames evidence as attributed & challengeable baseline context across all prompts', () => {
      const delibPrompt = formatDeliberationPrompt({
        soul: 'Impartial Auditor',
        seat: { id: 's1' },
        topic: 'Evidence framing',
        evidence: testEvidence
      });

      const judgePrompt = formatJudgePrompt({
        judge: { id: 'j1', soul: 'Impartial Judge' },
        topic: 'Evidence framing',
        round: 1,
        proofs: [],
        evidence: testEvidence
      });

      for (const prompt of [delibPrompt, judgePrompt]) {
        assert.match(prompt, /Pre-Gathered Baseline Evidence \(Attributed & Challengeable\)/);
      }
    });
  });

  // ==========================================================================
  // Section 5: Issue #72 - Voting Tool Defaults & Reasoning Effort Downshift
  // ==========================================================================
  describe('5. Issue #72: Voting Tool Defaults, Effort Downshift & Cursor Validation', () => {

    it('5.1 defaults voting tools to "none" when seat.tools is "read-only" and seat.votingTools is undefined', () => {
      const seat = {
        id: 'voter-default',
        harness: 'codex',
        model: 'gpt-6-astra (max)',
        tools: 'read-only'
      };
      const votingConfig = resolveVotingSeatConfig(seat);
      assert.equal(votingConfig.tools, 'none');
    });

    it('5.2 respects explicit seat.votingTools override over engineConfig and defaults', () => {
      const seat = {
        id: 'voter-override',
        harness: 'codex',
        model: 'gpt-6-astra (max)',
        tools: 'none',
        votingTools: 'read-only'
      };
      const votingConfig = resolveVotingSeatConfig(seat, { votingTools: 'none' });
      assert.equal(votingConfig.tools, 'read-only');
    });

    it('5.3 downshifts reasoning effort matrix for both hyphenated and parenthesized models', () => {
      // Suffix models
      assert.equal(downshiftModel('grok-4.7-xhigh'), 'grok-4.7-low');
      assert.equal(downshiftModel('grok-4.7-high'), 'grok-4.7-low');
      assert.equal(downshiftModel('claude-opus-5-5-high'), 'claude-opus-5-5-low');
      assert.equal(downshiftModel('gemini-4-argon-high'), 'gemini-4-argon-low');

      // Parenthesized models
      assert.equal(downshiftModel('gpt-6-astra (max)'), 'gpt-6-astra (low)');
      assert.equal(downshiftModel('gpt-6.1-sol (high)'), 'gpt-6.1-sol (low)');

      // Target medium downshift
      assert.equal(downshiftModel('grok-4.7-xhigh', 'medium'), 'grok-4.7-medium');
      assert.equal(downshiftModel('gpt-6-astra (max)', 'medium'), 'gpt-6-astra (medium)');

      // Non-tiered models untouched
      assert.equal(downshiftModel('composer-2.5'), 'composer-2.5');

      // Lower tiers are never upshifted
      assert.equal(downshiftModel('grok-4.7-low', 'medium'), 'grok-4.7-low');
    });

    it('5.4 CursorAdapter.validateModel permits downshifted Grok variants and Composer-2.5', () => {
      const adapter = new CursorAdapter();

      // Downshifted and high/xhigh variants all permitted without throwing
      assert.doesNotThrow(() => adapter.validateModel('grok-4.7-low'));
      assert.doesNotThrow(() => adapter.validateModel('grok-4.7-medium'));
      assert.doesNotThrow(() => adapter.validateModel('grok-4.7-high'));
      assert.doesNotThrow(() => adapter.validateModel('grok-4.7-xhigh'));
      assert.doesNotThrow(() => adapter.validateModel('composer-2.5'));
    });

    it('5.5 CursorAdapter.validateModel strictly rejects invalid models or unauthorized effort tiers', () => {
      const adapter = new CursorAdapter();

      assert.throws(
        () => adapter.validateModel('grok-4.7-ultra'),
        /Model "grok-4.7-ultra" is not permitted under Cursor route/
      );
      assert.throws(
        () => adapter.validateModel('composer-2.5-high'),
        /Model "composer-2.5-high" is not permitted under Cursor route/
      );
      assert.throws(
        () => adapter.validateModel('gpt-6-astra (max)'),
        /Model "gpt-6-astra \(max\)" is not permitted under Cursor route/
      );
    });

    it('5.6 caps votingTimeoutMs to Math.min(seatTimeout, votingTimeout, 90000)', () => {
      // Default cap 90000ms
      const cfg1 = resolveVotingSeatConfig({ id: 's1', timeoutMs: 240000 });
      assert.equal(cfg1.votingTimeoutMs, 90000);

      // Respects lower seat timeout
      const cfg2 = resolveVotingSeatConfig({ id: 's2', timeoutMs: 30000 });
      assert.equal(cfg2.votingTimeoutMs, 30000);

      // Respects lower explicit votingTimeoutMs
      const cfg3 = resolveVotingSeatConfig({ id: 's3', timeoutMs: 240000, votingTimeoutMs: 45000 });
      assert.equal(cfg3.votingTimeoutMs, 45000);
    });

    it('5.7 formatVotingPrompt instructs immediate tool-free JSON voting when tools is "none"', () => {
      const prompt = formatVotingPrompt({
        soul: 'Skeptic',
        seat: { id: 's1', votingTools: 'none' },
        candidate: { round: 1, summary: 'Summary', clauses: [] },
        admittedProofs: []
      });

      assert.match(
        prompt,
        /Do not invoke any tools during confirmation voting\. Evaluate the Candidate Clauses strictly against the audited Proofs provided above and return your JSON vote immediately\./
      );
      assert.ok(!prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
    });
  });

  // ==========================================================================
  // Section 6: End-to-End Multi-Seat Deliberation & Voting Integration
  // ==========================================================================
  describe('6. End-to-End Integration: Downshift, Timeout Capping & Tool Suppression in Live Engine', () => {

    it('6.1 executes full Council deliberation and confirmation voting with downshift, tool-free default, and timeout capping', async () => {
      const capturedPhases = [];
      const mockHarness = new MockAdapter();

      mockHarness.executeSeatProof = async (ctx) => {
        capturedPhases.push({
          seatId: ctx.seat.id,
          phase: ctx.phase,
          model: ctx.seat.model,
          tools: ctx.tools,
          timeoutMs: ctx.timeoutMs
        });
        return {
          id: `P-${ctx.seat.id}`,
          kind: 'citation',
          scope: 'Architecture',
          source: 'RFC-100',
          statement: `Proof from ${ctx.seat.id}`
        };
      };

      mockHarness.executeSeatVote = async (ctx) => {
        capturedPhases.push({
          seatId: ctx.seat.id,
          phase: ctx.phase,
          model: ctx.seat.model,
          tools: ctx.tools,
          timeoutMs: ctx.timeoutMs
        });
        return { vote: 'accept' };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Full consensus deliberation',
          maxRounds: 1,
          minQuorum: 3,
          judge: {
            id: 'judge-audit',
            harness: 'mock',
            model: 'gpt-6-astra (max)',
            soul: 'Impartial Judge'
          },
          seats: [
            {
              id: 'grok-voter',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Skeptic',
              tools: 'read-only',
              timeoutMs: 240000
            },
            {
              id: 'sol-voter',
              harness: 'mock',
              model: 'gpt-6.1-sol (high)',
              soul: 'Architect',
              tools: 'read-only',
              timeoutMs: 180000
            },
            {
              id: 'argon-preserved',
              harness: 'mock',
              model: 'gemini-4-argon-high',
              soul: 'Empiricist',
              tools: 'read-only',
              preserveVotingEffort: true,
              timeoutMs: 120000
            }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      engine.initRoster();
      const result = await engine.run();

      assert.equal(result.ok, true);
      assert.equal(result.verdict.kind, 'Unanimous Consensus');

      // Deliberation phase assertions
      const delibCalls = capturedPhases.filter((p) => p.phase === 'DELIBERATION');
      assert.equal(delibCalls.length, 3);
      for (const call of delibCalls) {
        assert.equal(call.tools, 'read-only');
      }
      assert.equal(delibCalls.find((c) => c.seatId === 'grok-voter').model, 'grok-4.7-xhigh');
      assert.equal(delibCalls.find((c) => c.seatId === 'sol-voter').model, 'gpt-6.1-sol (high)');
      assert.equal(delibCalls.find((c) => c.seatId === 'argon-preserved').model, 'gemini-4-argon-high');

      // Voting phase assertions
      const voteCalls = capturedPhases.filter((p) => p.phase === 'VOTING');
      assert.equal(voteCalls.length, 3);
      for (const call of voteCalls) {
        // All default to tools: 'none'
        assert.equal(call.tools, 'none');
        // All capped to voting timeout 90000ms
        assert.equal(call.timeoutMs, 90000);
      }

      // Model downshifts
      assert.equal(voteCalls.find((c) => c.seatId === 'grok-voter').model, 'grok-4.7-low');
      assert.equal(voteCalls.find((c) => c.seatId === 'sol-voter').model, 'gpt-6.1-sol (low)');
      // Preserved effort remains high
      assert.equal(voteCalls.find((c) => c.seatId === 'argon-preserved').model, 'gemini-4-argon-high');
    });
  });
});
