/**
 * @fileoverview Unit tests for Milestone 3: Parallel Seat Turns, Read-Only Tool Policy, and Time Budgets (#24, #25).
 * Validates the 4 core pillars:
 * 1. Concurrency proof (parallel vs sequential elapsed time)
 * 2. Deterministic reducer ordering (out-of-order promise completion applied in strict roster order)
 * 3. Tool policy enforcement, validation, and prompt injection (read-only vs none, rejection of write)
 * 4. Dynamic effort-scaled time budgets and chatter-resilient JSON parsing
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CouncilEngine, mapConcurrent } from '../../src/engine/council-engine.js';
import { validateConfig, resolveConfig } from '../../src/engine/config.js';
import { VALID_TOOL_POLICIES } from '../../src/types.js';
import {
  formatDeliberationPrompt,
  formatVotingPrompt,
  formatJudgePrompt
} from '../../src/seats/soul.js';
import {
  HarnessAdapter,
  EFFORT_TIMEOUT_MAP,
  DEFAULT_TIMEOUT_MS,
  InvalidResponseError
} from '../../src/harness/adapter.js';
import { MockAdapter } from '../../src/harness/mock.js';
import { AntigravityAdapter } from '../../src/harness/antigravity.js';
import { Seat } from '../../src/seats/seat.js';
import { createInitialCouncilState } from '../../src/machine/state.js';
import { runCursorCli, recordProviderCall } from '../../src/harness/cli-runner.js';

describe('Milestone 3: Parallel Seat Turns & Read-Only Tool Budgets (#24, #25)', () => {
  // =========================================================================
  // PILLAR 1: Concurrency Proof Tests
  // =========================================================================
  describe('Pillar 1: Concurrency Proof & Pool Limiting', () => {
    it('mapConcurrent runs tasks with bounded pool limit and preserves result order', async () => {
      const items = [1, 2, 3, 4, 5];
      let activeWorkers = 0;
      let maxSeenConcurrency = 0;

      const results = await mapConcurrent(items, 2, async (item) => {
        activeWorkers++;
        if (activeWorkers > maxSeenConcurrency) {
          maxSeenConcurrency = activeWorkers;
        }
        await new Promise((r) => setTimeout(r, 20));
        activeWorkers--;
        return item * 10;
      });

      assert.deepEqual(results, [10, 20, 30, 40, 50]);
      assert.ok(maxSeenConcurrency <= 2, `Expected max concurrency <= 2, saw ${maxSeenConcurrency}`);
    });

    it('executes 3 deliberation seat turns concurrently in under 550ms vs 600ms sequential', async () => {
      const mockAdapter = new MockAdapter();
      const delayMs = 180;
      for (const s of ['s1', 's2', 's3']) {
        mockAdapter.scriptSeatResponse({
          seatId: s,
          phase: 'DELIBERATION',
          response: async () => {
            await new Promise((r) => setTimeout(r, delayMs));
            return {
              scope: `General ${s}`,
              kind: 'check',
              source: `Verification from ${s}`,
              statement: `Statement from ${s}`
            };
          }
        });
      }

      const engine = new CouncilEngine(
        {
          topic: 'Parallel Deliberation Benchmark',
          maxConcurrentSeats: 3,
          minQuorum: 2,
          judge: { id: 'judge-1', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Soul 1' },
            { id: 's2', harness: 'mock', model: 'gpt-5-sol (high)', soul: 'Soul 2' },
            { id: 's3', harness: 'mock', model: 'gemini-4-argon-high', soul: 'Soul 3' }
          ]
        },
        { harnessResolver: () => mockAdapter }
      );

      engine.initRoster();
      const start = Date.now();
      await engine.runRound();
      const elapsed = Date.now() - start;

      // In sequential mode, 3 x 180ms = 540ms minimum + judge + votes.
      // In concurrent mode, deliberation proof collection takes ~180-250ms total.
      assert.ok(
        elapsed < 550,
        `Expected concurrent deliberation < 550ms, elapsed was ${elapsed}ms`
      );
      assert.equal(engine.state.proofs.length, 3);
    });

    it('executes voter turns concurrently in voting phase', async () => {
      const mockAdapter = new MockAdapter();
      const voteDelayMs = 100;

      // Script proofs to return immediately
      for (const s of ['s1', 's2', 's3']) {
        mockAdapter.scriptSeatResponse({
          seatId: s,
          phase: 'DELIBERATION',
          response: async () => ({
            scope: 'Proof',
            kind: 'check',
            source: 'Benchmark',
            statement: `Proof from ${s}`
          })
        });
      }

      // Script votes with delay
      for (const s of ['s1', 's2', 's3']) {
        mockAdapter.scriptSeatResponse({
          seatId: s,
          phase: 'VOTING',
          response: async () => {
            await new Promise((r) => setTimeout(r, voteDelayMs));
            return { vote: 'accept' };
          }
        });
      }

      const engine = new CouncilEngine(
        {
          topic: 'Parallel Voting Benchmark',
          maxConcurrentSeats: 3,
          minQuorum: 2,
          judge: { id: 'judge-1', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'mock', model: 'gpt-6-astra', soul: 'Soul 1' },
            { id: 's2', harness: 'mock', model: 'gpt-5-sol', soul: 'Soul 2' },
            { id: 's3', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'Soul 3' }
          ]
        },
        { harnessResolver: () => mockAdapter }
      );

      engine.initRoster();
      const start = Date.now();
      await engine.runRound();
      const elapsed = Date.now() - start;

      // 3 x 100ms = 300ms sequential voting. Concurrently ~100-180ms.
      assert.ok(elapsed < 450, `Expected concurrent voting < 450ms, elapsed was ${elapsed}ms`);
      assert.equal(engine.state.phase, 'completed');
      assert.equal(engine.state.verdict?.kind, 'Unanimous Consensus');
    });

    it('honors maxConcurrentSeats pool bounding when seat count exceeds limit', async () => {
      const mockAdapter = new MockAdapter();
      let activeConcurrency = 0;
      let peakConcurrency = 0;

      for (const s of ['s1', 's2', 's3', 's4']) {
        mockAdapter.scriptSeatResponse({
          seatId: s,
          phase: 'DELIBERATION',
          response: async () => {
            activeConcurrency++;
            if (activeConcurrency > peakConcurrency) peakConcurrency = activeConcurrency;
            await new Promise((r) => setTimeout(r, 40));
            activeConcurrency--;
            return { scope: 'Test', kind: 'check', source: 'Source', statement: `Proof from ${s}` };
          }
        });
      }

      const engine = new CouncilEngine(
        {
          topic: 'Concurrency Pool Limiting',
          maxConcurrentSeats: 2, // Limit to 2 concurrent seats
          minQuorum: 2,
          judge: { id: 'judge-1', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'mock', model: 'm1', soul: 'Soul 1' },
            { id: 's2', harness: 'mock', model: 'm2', soul: 'Soul 2' },
            { id: 's3', harness: 'mock', model: 'm3', soul: 'Soul 3' },
            { id: 's4', harness: 'mock', model: 'm4', soul: 'Soul 4' }
          ]
        },
        { harnessResolver: () => mockAdapter }
      );

      engine.initRoster();
      await engine.runRound();
      assert.ok(
        peakConcurrency <= 2,
        `Expected peak concurrency <= 2, but observed ${peakConcurrency}`
      );
      assert.equal(engine.state.proofs.length, 4);
    });
  });

  // =========================================================================
  // PILLAR 2: Deterministic Reducer Ordering Tests
  // =========================================================================
  describe('Pillar 2: Deterministic Reducer Ordering', () => {
    it('guarantees deterministic proof IDs (P1, P2, P3) regardless of out-of-order promise completion', async () => {
      const mockAdapter = new MockAdapter();

      // Inverted resolution order: s3 finishes first (20ms), s2 second (80ms), s1 last (160ms)
      mockAdapter.scriptSeatResponse({
        seatId: 's1',
        phase: 'DELIBERATION',
        response: async () => {
          await new Promise((r) => setTimeout(r, 160));
          return { scope: 'A', kind: 'check', source: 'srcA', statement: 'Statement 1' };
        }
      });
      mockAdapter.scriptSeatResponse({
        seatId: 's2',
        phase: 'DELIBERATION',
        response: async () => {
          await new Promise((r) => setTimeout(r, 80));
          return { scope: 'B', kind: 'check', source: 'srcB', statement: 'Statement 2' };
        }
      });
      mockAdapter.scriptSeatResponse({
        seatId: 's3',
        phase: 'DELIBERATION',
        response: async () => {
          await new Promise((r) => setTimeout(r, 20));
          return { scope: 'C', kind: 'check', source: 'srcC', statement: 'Statement 3' };
        }
      });

      const engine = new CouncilEngine(
        {
          topic: 'Deterministic Order Verification',
          maxConcurrentSeats: 3,
          minQuorum: 2,
          judge: { id: 'judge-1', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'mock', model: 'm1', soul: 'soul1' },
            { id: 's2', harness: 'mock', model: 'm2', soul: 'soul2' },
            { id: 's3', harness: 'mock', model: 'm3', soul: 'soul3' }
          ]
        },
        { harnessResolver: () => mockAdapter }
      );

      engine.initRoster();
      await engine.runRound();

      const proofs = engine.state.proofs;
      assert.equal(proofs.length, 3);
      // Roster order must be strictly preserved: P1 -> s1, P2 -> s2, P3 -> s3
      assert.equal(proofs[0].id, 'P1');
      assert.equal(proofs[0].seatId, 's1');
      assert.equal(proofs[1].id, 'P2');
      assert.equal(proofs[1].seatId, 's2');
      assert.equal(proofs[2].id, 'P3');
      assert.equal(proofs[2].seatId, 's3');
    });

    it('guarantees deterministic objection IDs (O1, O2) during out-of-order voting completion', async () => {
      const mockAdapter = new MockAdapter();

      // Proofs resolve immediately
      for (const s of ['s1', 's2', 's3']) {
        mockAdapter.scriptSeatResponse({
          seatId: s,
          phase: 'DELIBERATION',
          response: async () => ({
            scope: 'Scope',
            kind: 'check',
            source: 'Source',
            statement: `Proof from ${s}`
          })
        });
      }

      // Votes resolve out-of-order: s3 objects fast (20ms), s2 accepts (60ms), s1 objects slow (120ms)
      mockAdapter.scriptSeatResponse({
        seatId: 's3',
        phase: 'VOTING',
        response: async () => {
          await new Promise((r) => setTimeout(r, 20));
          return { vote: 'object', reason: 'Dispute from s3', proofId: 'P3' };
        }
      });
      mockAdapter.scriptSeatResponse({
        seatId: 's2',
        phase: 'VOTING',
        response: async () => {
          await new Promise((r) => setTimeout(r, 60));
          return { vote: 'accept' };
        }
      });
      mockAdapter.scriptSeatResponse({
        seatId: 's1',
        phase: 'VOTING',
        response: async () => {
          await new Promise((r) => setTimeout(r, 120));
          return { vote: 'object', reason: 'Dispute from s1', proofId: 'P1' };
        }
      });

      const engine = new CouncilEngine(
        {
          topic: 'Deterministic Objections Order',
          maxConcurrentSeats: 3,
          maxRounds: 1, // Stop after round 1
          minQuorum: 2,
          judge: { id: 'judge-1', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'mock', model: 'm1', soul: 'soul1' },
            { id: 's2', harness: 'mock', model: 'm2', soul: 'soul2' },
            { id: 's3', harness: 'mock', model: 'm3', soul: 'soul3' }
          ]
        },
        { harnessResolver: () => mockAdapter }
      );

      engine.initRoster();
      await engine.runRound();

      const objections = engine.state.objections;
      assert.equal(objections.length, 2);
      // Roster order: s1 voted object, s2 accepted, s3 voted object.
      // Therefore O1 must belong to s1 and O2 must belong to s3.
      assert.equal(objections[0].id, 'O1');
      assert.equal(objections[0].seatId, 's1');
      assert.equal(objections[1].id, 'O2');
      assert.equal(objections[1].seatId, 's3');
    });

    it('handles seat fault retries in strict roster order during proof collection', async () => {
      const mockAdapter = new MockAdapter();
      let s1Attempts = 0;

      // s1 fails on first attempt after 10ms, succeeds on retry
      mockAdapter.scriptSeatResponse({
        seatId: 's1',
        phase: 'DELIBERATION',
        response: async () => {
          s1Attempts++;
          if (s1Attempts === 1) {
            throw new Error('Temporary network glitch on s1');
          }
          return { scope: 'S1', kind: 'check', source: 'Source1', statement: 'Statement 1' };
        }
      });

      // s2 finishes cleanly after 20ms
      mockAdapter.scriptSeatResponse({
        seatId: 's2',
        phase: 'DELIBERATION',
        response: async () => {
          await new Promise((r) => setTimeout(r, 20));
          return { scope: 'S2', kind: 'check', source: 'Source2', statement: 'Statement 2' };
        }
      });

      const engine = new CouncilEngine(
        {
          topic: 'Seat Fault Roster Order',
          maxConcurrentSeats: 2,
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          judge: { id: 'judge-1', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'mock', model: 'm1', soul: 'soul1' },
            { id: 's2', harness: 'mock', model: 'm2', soul: 'soul2' }
          ]
        },
        { harnessResolver: () => mockAdapter }
      );

      engine.initRoster();
      await engine.runRound();

      const proofs = engine.state.proofs;
      assert.equal(proofs.length, 2);
      assert.equal(proofs[0].id, 'P1');
      assert.equal(proofs[0].seatId, 's1');
      assert.equal(proofs[1].id, 'P2');
      assert.equal(proofs[1].seatId, 's2');
    });
  });

  // =========================================================================
  // PILLAR 3: Tool Policy & Prompt Verification Tests
  // =========================================================================
  describe('Pillar 3: Tool Policy Enforcement, Prompt Directives & CLI Sandboxes', () => {
    it('VALID_TOOL_POLICIES contains only none and read-only and is immutable', () => {
      assert.deepEqual(VALID_TOOL_POLICIES, ['none', 'read-only']);
      assert.ok(Object.isFrozen(VALID_TOOL_POLICIES));
    });

    it('validateConfig validates tools, timeoutMs, and maxConcurrentSeats', () => {
      const baseValid = {
        topic: 'Valid Tool Config',
        maxRounds: 3,
        minQuorum: 2,
        maxClarificationBatches: 2,
        maxRetriesPerSeat: 1
      };

      // Valid configuration
      const validRes = validateConfig({
        ...baseValid,
        timeoutMs: 30000,
        maxConcurrentSeats: 4,
        judge: { id: 'j', harness: 'codex', model: 'm', soul: 's', tools: 'read-only', timeoutMs: 40000 },
        seats: [
          { id: 's1', harness: 'codex', model: 'm', soul: 's', tools: 'none', timeoutMs: 15000 },
          { id: 's2', harness: 'codex', model: 'm', soul: 's', tools: 'read-only' }
        ]
      });
      assert.equal(validRes.valid, true);
      assert.equal(validRes.errors.length, 0);

      // Invalid: write capability
      const writeRes = validateConfig({
        ...baseValid,
        seats: [
          { id: 's1', harness: 'codex', model: 'm', soul: 's', tools: 'write' },
          { id: 's2', harness: 'codex', model: 'm', soul: 's' }
        ]
      });
      assert.equal(writeRes.valid, false);
      assert.match(writeRes.errors[0], /tools.*none.*read-only/i);

      // Invalid: negative timeoutMs
      const timeoutRes = validateConfig({
        ...baseValid,
        timeoutMs: -500,
        seats: [
          { id: 's1', harness: 'codex', model: 'm', soul: 's' },
          { id: 's2', harness: 'codex', model: 'm', soul: 's' }
        ]
      });
      assert.equal(timeoutRes.valid, false);
      assert.match(timeoutRes.errors[0], /timeoutMs.*positive number/i);

      // Invalid: maxConcurrentSeats < 1
      const concurrencyRes = validateConfig({
        ...baseValid,
        maxConcurrentSeats: 0,
        seats: [
          { id: 's1', harness: 'codex', model: 'm', soul: 's' },
          { id: 's2', harness: 'codex', model: 'm', soul: 's' }
        ]
      });
      assert.equal(concurrencyRes.valid, false);
      assert.match(concurrencyRes.errors[0], /maxConcurrentSeats.*integer >= 1/i);

      // resolveConfig rejects write tools with error
      assert.throws(
        () => resolveConfig({ topic: 'Write test', seats: [{ id: 's1', harness: 'codex', model: 'm', soul: 's', tools: 'write' }] }),
        /Write tools are strictly forbidden/
      );
    });

    it('resolveConfig defaults tools to read-only and maxConcurrentSeats to seat count or 10', () => {
      const resolved = resolveConfig({
        topic: 'Resolving Defaults',
        seats: [
          { id: 's1', harness: 'codex', model: 'm', soul: 's' },
          { id: 's2', harness: 'codex', model: 'm', soul: 's' }
        ]
      });

      assert.equal(resolved.judge.tools, 'read-only');
      assert.equal(resolved.seats[0].tools, 'read-only');
      assert.equal(resolved.seats[1].tools, 'read-only');
      assert.equal(resolved.maxConcurrentSeats, 2);
    });

    it('injects verification directives into soul prompts when tools is read-only', () => {
      const delibReadOnly = formatDeliberationPrompt({
        seat: { id: 's1', model: 'm', tools: 'read-only' },
        soul: 'System Architect',
        round: 1,
        topic: 'Architecture Review'
      });
      assert.match(delibReadOnly, /verify claims against sources/i);

      const votingReadOnly = formatVotingPrompt({
        seat: { id: 's1', model: 'm', tools: 'read-only' },
        soul: 'System Architect',
        round: 1,
        topic: 'Architecture Review',
        candidate: { round: 1, summary: 'Proposal', clauses: [] }
      });
      assert.match(votingReadOnly, /verify disputed candidate clauses/i);

      const judgeReadOnly = formatJudgePrompt({
        judge: { id: 'j1', model: 'm', tools: 'read-only' },
        round: 1,
        topic: 'Architecture Review',
        proofs: []
      });
      assert.match(judgeReadOnly, /spot-check submitted proof sources and citations/i);
    });

    it('omits verification directives from soul prompts when tools is none', () => {
      const delibNone = formatDeliberationPrompt({
        seat: { id: 's1', model: 'm', tools: 'none' },
        soul: 'System Architect',
        round: 1,
        topic: 'Architecture Review'
      });
      assert.doesNotMatch(delibNone, /verify claims against sources/i);

      const votingNone = formatVotingPrompt({
        seat: { id: 's1', model: 'm', tools: 'none' },
        soul: 'System Architect',
        round: 1,
        topic: 'Architecture Review',
        candidate: { round: 1, summary: 'Proposal', clauses: [] }
      });
      assert.doesNotMatch(votingNone, /verify disputed candidate claims/i);

      const judgeNone = formatJudgePrompt({
        judge: { id: 'j1', model: 'm', tools: 'none' },
        round: 1,
        topic: 'Architecture Review',
        proofs: []
      });
      assert.doesNotMatch(judgeNone, /verify submitted proof sources and citations/i);
    });

    it('runCursorCli enforces --mode plan and --sandbox enabled', async () => {
      const capturedCalls = [];
      const mockExec = async (cmd, args, opts) => {
        capturedCalls.push({ cmd, args });
        return { stdout: '{"vote":"accept"}', stderr: '', exitCode: 0 };
      };

      await runCursorCli({
        model: 'composer-2-fast',
        prompt: 'Check architecture',
        exec: mockExec
      });

      assert.equal(capturedCalls.length, 1);
      const args = capturedCalls[0].args;
      assert.ok(args.includes('--mode'), 'Cursor CLI must specify --mode');
      assert.equal(args[args.indexOf('--mode') + 1], 'plan');
      assert.ok(args.includes('--sandbox'), 'Cursor CLI must specify --sandbox');
      assert.equal(args[args.indexOf('--sandbox') + 1], 'enabled');
    });

    it('recordProviderCall captures tools policy in telemetry record', () => {
      const telemetry = {
        calls: [],
        emitProviderCall(rec) {
          this.calls.push(rec);
        }
      };

      recordProviderCall({
        context: { telemetry, tools: 'read-only' },
        record: {
          participantId: 's1',
          provider: 'cursor',
          model: 'composer-2-fast',
          prompt: 'test',
          durationMs: 120,
          exitCode: 0
        }
      });

      assert.equal(telemetry.calls.length, 1);
      assert.equal(telemetry.calls[0].tools, 'read-only');
    });
  });

  // =========================================================================
  // PILLAR 4: Effort-Scaled Timeouts & Resilient Parsing Tests
  // =========================================================================
  describe('Pillar 4: Dynamic Effort-Scaled Timeouts & Resilient Parsing', () => {
    it('EFFORT_TIMEOUT_MAP defines correct timeout tiers', () => {
      assert.equal(EFFORT_TIMEOUT_MAP.max, 240000);
      assert.equal(EFFORT_TIMEOUT_MAP.xhigh, 240000);
      assert.equal(EFFORT_TIMEOUT_MAP.high, 120000);
      assert.equal(EFFORT_TIMEOUT_MAP.medium, 60000);
      assert.equal(EFFORT_TIMEOUT_MAP.low, 60000);
    });

    it('HarnessAdapter dynamically resolves timeouts by effort tier', () => {
      const adapter = new HarnessAdapter();

      // Max / xhigh tiers (240s)
      assert.equal(adapter.resolveTimeoutMs('gpt-6-astra (max)'), 240000);
      assert.equal(adapter.resolveTimeoutMs('gpt-6.1-sol (xhigh)'), 240000);

      // High tier (120s)
      assert.equal(adapter.resolveTimeoutMs('gemini-4-argon-high'), 120000);
      assert.equal(adapter.resolveTimeoutMs('claude-opus-5-5-high'), 120000);

      // Medium / low tiers (60s)
      assert.equal(adapter.resolveTimeoutMs('claude-sonnet-4-5-medium'), 60000);
      assert.equal(adapter.resolveTimeoutMs('model-low'), 60000);

      // Default fallback (60s)
      assert.equal(adapter.resolveTimeoutMs('custom-model-no-tier'), DEFAULT_TIMEOUT_MS);
    });

    it('HarnessAdapter prioritizes explicit timeout overrides over dynamic effort defaults', () => {
      const adapter = new HarnessAdapter();
      // Explicit 15s override on max effort model
      assert.equal(adapter.resolveTimeoutMs('gpt-6-astra (max)', 15000), 15000);
      // Adapter custom constructor timeout
      const customAdapter = new HarnessAdapter({ timeoutMs: 45000 });
      assert.equal(customAdapter.resolveTimeoutMs('gpt-6-astra (max)'), 45000);
    });

    it('executeWithTimeout aborts when call exceeds dynamic timeout', async () => {
      const adapter = new HarnessAdapter({ timeoutMs: 50 }); // Fast 50ms timeout for test

      await assert.rejects(
        () =>
          adapter.executeWithTimeout(
            () => new Promise((resolve) => setTimeout(resolve, 200)),
            50,
            { seatId: 'test-seat', model: 'mock' }
          ),
        /timed out after 50ms/
      );
    });

    it('resiliently parses JSON payload preceded by markdown tool execution chatter', () => {
      const adapter = new HarnessAdapter();

      const chatterWithCodeBlocks = `
I ran a read-only search on the kernel codebase:
\`\`\`json
{ "tool": "grep_search", "status": "executed", "matches": 2 }
\`\`\`
Based on the code inspection, here is my formal proof:
\`\`\`json
{
  "scope": "Linux Kernel CGroup",
  "kind": "citation",
  "source": "kernel/cgroup.c:120",
  "statement": "cgroups v2 hierarchy is unified."
}
\`\`\`
Deliberation concluded.`;

      const parsed = adapter.parseStructuredOutput(chatterWithCodeBlocks, 'proof');
      assert.equal(parsed.kind, 'citation');
      assert.equal(parsed.source, 'kernel/cgroup.c:120');
      assert.equal(parsed.statement, 'cgroups v2 hierarchy is unified.');
    });

    it('resiliently extracts JSON candidate from raw text without code fences', () => {
      const adapter = new HarnessAdapter();

      const rawInlineChatter = `
Tool call: {"path": "package.json", "op": "read"}
Read 1200 bytes. Found engine version >= 22.0.0.
{
  "vote": "accept"
}
Final thought: candidate satisfies all constraints.`;

      const parsedVote = adapter.parseStructuredOutput(rawInlineChatter, 'vote');
      assert.equal(parsedVote.vote, 'accept');
    });

    it('throws InvalidResponseError with schema details when candidate violates schema', () => {
      const adapter = new HarnessAdapter();

      const invalidCandidate = `
\`\`\`json
{
  "vote": "invalid_vote_action",
  "extra": "unrecognized"
}
\`\`\``;

      assert.throws(
        () => adapter.parseStructuredOutput(invalidCandidate, 'vote'),
        (err) => {
          assert.ok(err instanceof InvalidResponseError);
          assert.match(err.message, /violates vote schema/i);
          return true;
        }
      );
    });

    it('throws InvalidResponseError for empty or whitespace-only response', () => {
      const adapter = new HarnessAdapter();
      assert.throws(
        () => adapter.parseStructuredOutput('', 'proof'),
        (err) => {
          assert.ok(err instanceof InvalidResponseError);
          assert.match(err.message, /empty or not a string/i);
          return true;
        }
      );
    });
  });

  // =========================================================================
  // PILLAR 5: State Machine & CouncilEngine Tool Policy and Timeout Plumbing (#24, #25)
  // =========================================================================
  describe('Pillar 5: State Machine & CouncilEngine Tool Policy and Timeout Plumbing (#24, #25)', () => {
    it('validates tools and timeoutMs in validateSeatConfig and Seat model', () => {
      const validSeat = new Seat({
        id: 'seat-test',
        harness: 'mock',
        model: 'mock-model',
        soul: 'Test Soul',
        tools: 'none',
        timeoutMs: 15000
      });
      assert.equal(validSeat.tools, 'none');
      assert.equal(validSeat.timeoutMs, 15000);
      const json = validSeat.toJSON();
      assert.equal(json.tools, 'none');
      assert.equal(json.timeoutMs, 15000);

      // Rejections
      assert.throws(
        () => new Seat({ id: 's', harness: 'm', model: 'm', soul: 's', tools: 'write' }),
        /Invalid seat tools policy "write"/
      );
      assert.throws(
        () => new Seat({ id: 's', harness: 'm', model: 'm', soul: 's', timeoutMs: -10 }),
        /Seat timeoutMs must be a positive number/
      );
    });

    it('preserves seat and judge tools and timeoutMs in createInitialCouncilState and CouncilEngine.state', () => {
      const config = {
        topic: 'Preserve Tools and Timeouts in State',
        tools: 'none',
        timeoutMs: 60000,
        judge: {
          id: 'judge-1',
          harness: 'mock',
          model: 'mock-judge',
          soul: 'Judge Soul',
          tools: 'none',
          timeoutMs: 25000
        },
        seats: [
          {
            id: 's1',
            harness: 'mock',
            model: 'mock-model-1',
            soul: 'Soul 1',
            tools: 'none',
            timeoutMs: 15000
          },
          {
            id: 's2',
            harness: 'mock',
            model: 'mock-model-2',
            soul: 'Soul 2',
            tools: 'read-only',
            timeoutMs: 30000
          }
        ]
      };

      // 1. Direct createInitialCouncilState inspection
      const rawState = createInitialCouncilState(config);
      assert.equal(rawState.judge.tools, 'none', 'Raw state judge tools must be "none"');
      assert.equal(rawState.judge.timeoutMs, 25000, 'Raw state judge timeoutMs must be 25000');
      assert.equal(rawState.seats[0].tools, 'none', 'Raw state s1 tools must be "none"');
      assert.equal(rawState.seats[0].timeoutMs, 15000, 'Raw state s1 timeoutMs must be 15000');
      assert.equal(rawState.seats[1].tools, 'read-only', 'Raw state s2 tools must be "read-only"');
      assert.equal(rawState.seats[1].timeoutMs, 30000, 'Raw state s2 timeoutMs must be 30000');

      // 2. CouncilEngine with initRoster() inspection
      const engine = new CouncilEngine(config);
      engine.initRoster();

      assert.equal(engine.state.judge.tools, 'none', 'Judge tools must be "none"');
      assert.equal(engine.state.judge.timeoutMs, 25000, 'Judge timeoutMs must be preserved');

      const s1 = engine.state.seats.find((s) => s.id === 's1');
      const s2 = engine.state.seats.find((s) => s.id === 's2');
      assert.ok(s1, 'Seat s1 must exist in state');
      assert.ok(s2, 'Seat s2 must exist in state');

      assert.equal(s1.tools, 'none', 'Seat s1 tools must be "none"');
      assert.equal(s1.timeoutMs, 15000, 'Seat s1 timeoutMs must be 15000');

      assert.equal(s2.tools, 'read-only', 'Seat s2 tools must be "read-only"');
      assert.equal(s2.timeoutMs, 30000, 'Seat s2 timeoutMs must be 30000');
    });

    it('inherits root tools and timeoutMs on seats and judge when unspecified', () => {
      const config = {
        topic: 'Inherit Root Policies',
        tools: 'none',
        timeoutMs: 45000,
        seats: [
          { id: 's1', harness: 'mock', model: 'mock-1', soul: 'Soul 1' },
          { id: 's2', harness: 'mock', model: 'mock-2', soul: 'Soul 2' }
        ]
      };

      // 1. Direct createInitialCouncilState inspection
      const rawState = createInitialCouncilState(config);
      assert.equal(rawState.judge.tools, 'none', 'Raw state judge must inherit root tools: "none"');
      assert.equal(rawState.judge.timeoutMs, 45000, 'Raw state judge must inherit root timeoutMs: 45000');
      assert.equal(rawState.seats[0].tools, 'none', 'Raw state s1 must inherit root tools: "none"');
      assert.equal(rawState.seats[0].timeoutMs, 45000, 'Raw state s1 must inherit root timeoutMs: 45000');

      // 2. CouncilEngine with initRoster() inspection
      const engine = new CouncilEngine(config);
      engine.initRoster();

      assert.equal(engine.state.judge.tools, 'none', 'Judge must inherit root tools: "none"');
      assert.equal(engine.state.judge.timeoutMs, 45000, 'Judge must inherit root timeoutMs: 45000');
      assert.equal(engine.state.seats[0].tools, 'none', 'Seat s1 must inherit root tools: "none"');
      assert.equal(engine.state.seats[0].timeoutMs, 45000, 'Seat s1 must inherit root timeoutMs: 45000');
    });

    it('preserves tools and timeoutMs during dynamic ADD_SEAT transitions and initRoster()', () => {
      const engine = new CouncilEngine({
        topic: 'Dynamic ADD_SEAT Preservation',
        seats: [
          { id: 's1', harness: 'mock', model: 'm1', soul: 'Soul 1' },
          { id: 's2', harness: 'mock', model: 'm2', soul: 'Soul 2' }
        ]
      });

      // Direct ADD_SEAT transition to reducer
      engine._step({
        type: 'ADD_SEAT',
        seat: {
          id: 's3',
          harness: 'mock',
          model: 'm3',
          soul: 'Soul 3',
          tools: 'none',
          timeoutMs: 12000
        }
      });

      const s3 = engine.state.seats.find((s) => s.id === 's3');
      assert.ok(s3, 'Dynamically added seat s3 must exist in state');
      assert.equal(s3.tools, 'none', 'Dynamic seat s3 must preserve tools: "none"');
      assert.equal(s3.timeoutMs, 12000, 'Dynamic seat s3 must preserve timeoutMs: 12000');

      // Test initRoster forwarding of tools and timeoutMs
      const lateEngine = new CouncilEngine({
        topic: 'Late Roster Init',
        seats: [
          { id: 'seatA', harness: 'mock', model: 'mA', soul: 'Soul A' },
          { id: 'seatB', harness: 'mock', model: 'mB', soul: 'Soul B' }
        ]
      });
      // Simulate adding a configured seat before initRoster
      lateEngine.config.seats.push({
        id: 'seatC',
        harness: 'mock',
        model: 'mC',
        soul: 'Soul C',
        tools: 'none',
        timeoutMs: 18000
      });
      lateEngine.initRoster();

      const seatC = lateEngine.state.seats.find((s) => s.id === 'seatC');
      assert.ok(seatC, 'Late roster seatC must be added to state');
      assert.equal(seatC.tools, 'none', 'Late roster seatC must forward tools: "none"');
      assert.equal(seatC.timeoutMs, 18000, 'Late roster seatC must forward timeoutMs: 18000');
    });

    it('omits prompt verification directives during deliberation and voting when seat tools is "none"', async () => {
      const capturedPrompts = [];
      const mockRunner = async ({ prompt, context }) => {
        capturedPrompts.push({
          seatId: context.seatId,
          tools: context.tools,
          prompt
        });

        // If Judge call, return valid candidate synthesis
        if (context.seatId === 'test-judge') {
          return JSON.stringify({
            summary: 'Unified Deliberation Candidate',
            proofDecisions: {
              P1: { status: 'admitted', note: 'Valid proof 1' },
              P2: { status: 'admitted', note: 'Valid proof 2' }
            },
            clauses: [
              {
                context: 'Architecture Context',
                conclusion: 'Adopt unified architecture',
                citedProofIds: ['P1', 'P2']
              }
            ]
          });
        }

        // If Voting call, return ballot
        if (prompt.includes('CAST BALLOT') || prompt.includes('Voting on Round')) {
          return JSON.stringify({ vote: 'accept' });
        }

        // Deliberation proof return
        return JSON.stringify({
          scope: 'Architecture',
          kind: 'check',
          source: 'System Spec',
          statement: `Verified assertion from ${context.seatId}`
        });
      };

      const adapter = new AntigravityAdapter({ spawnRunner: mockRunner });
      const engine = new CouncilEngine(
        {
          topic: 'Runtime Prompt Directive Verification',
          tools: 'read-only', // Global default is read-only
          judge: {
            id: 'test-judge',
            harness: 'antigravity',
            model: 'gemini-4-argon-high',
            soul: 'Impartial Judge',
            tools: 'none' // Judge configured with tools: none
          },
          seats: [
            {
              id: 'seat-none',
              harness: 'antigravity',
              model: 'gemini-4-argon-high',
              soul: 'No-Tools Lens',
              tools: 'none', // Explicit none
              timeoutMs: 15000
            },
            {
              id: 'seat-readonly',
              harness: 'antigravity',
              model: 'gemini-4-argon-high',
              soul: 'Read-Only Lens',
              tools: 'read-only', // Explicit read-only
              timeoutMs: 25000
            }
          ]
        },
        { harnessResolver: () => adapter }
      );

      engine.initRoster();
      await engine.runRound();

      // 1. Verify Deliberation prompts
      const sNoneDelib = capturedPrompts.find(
        (p) => p.seatId === 'seat-none' && p.prompt.includes('Deliberation Round 1')
      );
      const sReadonlyDelib = capturedPrompts.find(
        (p) => p.seatId === 'seat-readonly' && p.prompt.includes('Deliberation Round 1')
      );

      assert.ok(sNoneDelib, 'Must capture deliberation prompt for seat-none');
      assert.ok(sReadonlyDelib, 'Must capture deliberation prompt for seat-readonly');

      assert.equal(sNoneDelib.tools, 'none', 'seat-none context.tools must be "none"');
      assert.equal(sReadonlyDelib.tools, 'read-only', 'seat-readonly context.tools must be "read-only"');

      assert.ok(
        !sNoneDelib.prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'),
        'Deliberation prompt for seat-none must NOT contain tool directive'
      );
      assert.ok(
        sReadonlyDelib.prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'),
        'Deliberation prompt for seat-readonly MUST contain tool directive'
      );

      // 2. Verify Judge prompt
      const judgeCall = capturedPrompts.find((p) => p.seatId === 'test-judge');
      assert.ok(judgeCall, 'Must capture judge prompt');
      assert.equal(judgeCall.tools, 'none', 'Judge context.tools must be "none"');
      assert.ok(
        !judgeCall.prompt.includes('4. Spot-check proof sources: You have read-only inspection tools enabled.'),
        'Judge prompt with tools: "none" must NOT contain spot-check directive'
      );

      // 3. Verify Voting prompts
      const sNoneVote = capturedPrompts.find(
        (p) => p.seatId === 'seat-none' && (p.prompt.includes('CAST BALLOT') || p.prompt.includes('Voting on Round'))
      );
      const sReadonlyVote = capturedPrompts.find(
        (p) => p.seatId === 'seat-readonly' && (p.prompt.includes('CAST BALLOT') || p.prompt.includes('Voting on Round'))
      );

      assert.ok(sNoneVote, 'Must capture voting prompt for seat-none');
      assert.ok(sReadonlyVote, 'Must capture voting prompt for seat-readonly');

      assert.equal(sNoneVote.tools, 'none', 'Voting context.tools for seat-none must be "none"');
      assert.equal(sReadonlyVote.tools, 'read-only', 'Voting context.tools for seat-readonly must be "read-only"');

      assert.ok(
        !sNoneVote.prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'),
        'Voting prompt for seat-none must NOT contain tool directive'
      );
      assert.ok(
        sReadonlyVote.prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'),
        'Voting prompt for seat-readonly MUST contain tool directive'
      );
    });

    it('propagates seat-specific timeoutMs and judge timeoutMs to harness calls', async () => {
      const dispatchedTimeouts = [];

      class SpyHarnessAdapter extends HarnessAdapter {
        constructor() {
          super({ name: 'spy' });
        }
        async executeSeatProof({ seat, timeoutMs }) {
          dispatchedTimeouts.push({ seatId: seat.id, phase: 'DELIBERATION', timeoutMs });
          return { scope: 'Test', kind: 'check', source: 'Source', statement: `Statement from ${seat.id}` };
        }
        async executeJudgeAuditAndSynthesis({ judge, timeoutMs }) {
          dispatchedTimeouts.push({ seatId: judge.id, phase: 'JUDGING', timeoutMs });
          return {
            summary: 'Spy Synthesis',
            proofDecisions: { P1: { status: 'admitted' }, P2: { status: 'admitted' } },
            clauses: [{ context: 'C', conclusion: 'Conc', citedProofIds: ['P1', 'P2'] }]
          };
        }
        async executeSeatVote({ seat, timeoutMs }) {
          dispatchedTimeouts.push({ seatId: seat.id, phase: 'VOTING', timeoutMs });
          return { vote: 'accept' };
        }
      }

      const spyAdapter = new SpyHarnessAdapter();
      const engine = new CouncilEngine(
        {
          topic: 'Timeout Propagation Verification',
          timeoutMs: 90000, // Global fallback timeout: 90s
          judge: {
            id: 'custom-judge',
            harness: 'spy',
            model: 'judge-model',
            soul: 'Judge',
            timeoutMs: 22000 // Custom judge timeout: 22s
          },
          seats: [
            {
              id: 'seat-fast',
              harness: 'spy',
              model: 'model-1',
              soul: 'Soul 1',
              timeoutMs: 14000 // Custom seat timeout: 14s
            },
            {
              id: 'seat-default',
              harness: 'spy',
              model: 'model-2',
              soul: 'Soul 2' // No override: should fallback to global 90s
            }
          ]
        },
        { harnessResolver: () => spyAdapter }
      );

      engine.initRoster();
      await engine.runRound();

      // Deliberation timeouts
      const fastDelib = dispatchedTimeouts.find((d) => d.seatId === 'seat-fast' && d.phase === 'DELIBERATION');
      const defaultDelib = dispatchedTimeouts.find((d) => d.seatId === 'seat-default' && d.phase === 'DELIBERATION');
      assert.ok(fastDelib, 'fastDelib timeout must be recorded');
      assert.ok(defaultDelib, 'defaultDelib timeout must be recorded');
      assert.equal(fastDelib.timeoutMs, 14000, 'seat-fast must receive its configured 14000ms timeout');
      assert.equal(defaultDelib.timeoutMs, 90000, 'seat-default must fall back to engine-level 90000ms timeout');

      // Judging timeout
      const judgeCall = dispatchedTimeouts.find((d) => d.seatId === 'custom-judge' && d.phase === 'JUDGING');
      assert.ok(judgeCall, 'Judge timeout must be recorded');
      assert.equal(judgeCall.timeoutMs, 22000, 'Judge must receive its configured 22000ms timeout');

      // Voting timeouts
      const fastVote = dispatchedTimeouts.find((d) => d.seatId === 'seat-fast' && d.phase === 'VOTING');
      const defaultVote = dispatchedTimeouts.find((d) => d.seatId === 'seat-default' && d.phase === 'VOTING');
      assert.ok(fastVote, 'fastVote timeout must be recorded');
      assert.ok(defaultVote, 'defaultVote timeout must be recorded');
      assert.equal(fastVote.timeoutMs, 14000, 'seat-fast voting must receive 14000ms timeout');
      assert.equal(defaultVote.timeoutMs, 90000, 'seat-default voting must receive 90000ms timeout');
    });
  });
});
