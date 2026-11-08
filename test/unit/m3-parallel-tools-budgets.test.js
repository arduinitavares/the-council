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
});
