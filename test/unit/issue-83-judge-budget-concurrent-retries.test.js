import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CouncilEngine } from '../../src/engine/council-engine.js';
import { resolveConfig } from '../../src/engine/config.js';
import { MockAdapter } from '../../src/harness/mock.js';
import { TimeoutError, QuotaExhaustionError } from '../../src/harness/adapter.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Issue #83: Symmetric Judge budget precedence & wave-based concurrent seat retries', () => {
  describe('1. Judge budget precedence (explicitJudgeBudget > explicitJudgeTimeout * 2 > explicitGlobalSeatBudget > 480000)', () => {
    it('honors explicit judge.timeoutMs over global totalSeatBudgetMs via both raw CouncilEngine and resolveConfig()', async () => {
      for (const mode of ['raw', 'resolved']) {
        const judgeCalls = [];
        const mockHarness = new MockAdapter();

        mockHarness.executeSeatProof = async (ctx) => ({
          scope: 'Core',
          kind: 'check',
          source: 'Spec',
          statement: `Proof from ${ctx.seat.id}`
        });

        mockHarness.executeJudgeAuditAndSynthesis = async (ctx) => {
          judgeCalls.push({
            timeoutMs: ctx.timeoutMs,
            tools: ctx.tools,
            judgeTools: ctx.judge.tools
          });
          if (judgeCalls.length === 1) {
            throw new TimeoutError('Judge timed out after 150000ms', {
              seatId: ctx.judge.id,
              harness: 'mock',
              timeoutMs: 150000
            });
          }
          return {
            summary: 'Synthesized on RETRY_JUDGE',
            clauses: [{ id: 'C1', context: 'Core', conclusion: 'Verified', citedProofIds: ['P1', 'P2'] }],
            proofDecisions: {
              P1: { status: 'admitted', note: 'OK' },
              P2: { status: 'admitted', note: 'OK' }
            }
          };
        };

        mockHarness.executeSeatVote = async () => ({ vote: 'accept' });

        const rawConfig = {
          topic: `Judge budget precedence (${mode})`,
          maxRounds: 1,
          minQuorum: 2,
          totalSeatBudgetMs: 130000, // --seat-budget 130000
          judge: {
            id: 'judge-explicit-timeout',
            harness: 'mock',
            model: 'gpt-6-astra (max)',
            soul: 'Impartial Judge',
            timeoutMs: 150000,
            tools: 'read-only'
          },
          seats: [
            { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'gemini-4-argon-high', soul: 'S2' }
          ]
        };

        const cfg = mode === 'resolved' ? resolveConfig(rawConfig) : rawConfig;
        if (mode === 'resolved') {
          assert.equal(cfg.judge.totalSeatBudgetMs, 300000);
          assert.equal(cfg.judge.seatBudget, 300000);
          assert.equal(cfg.judge.timeoutMs, 150000);
        }

        const engine = new CouncilEngine(cfg, { harnessResolver: () => mockHarness });
        engine.initRoster();
        const result = await engine.run();

        assert.equal(result.ok, true, `Expected consensus in ${mode} mode`);
        assert.equal(result.verdict.kind, 'Unanimous Consensus');
        assert.equal(result.state.judge.retries, 1);

        // Attempt 0 got full 150000ms (not clamped to 130000ms); Attempt 1 got min(150000, 90000, 300000 - 150000) = 90000ms
        assert.equal(judgeCalls.length, 2);
        assert.equal(judgeCalls[0].timeoutMs, 150000);
        assert.equal(judgeCalls[0].tools, 'read-only');
        assert.equal(judgeCalls[1].timeoutMs, 90000);
        assert.equal(judgeCalls[1].tools, 'none');
        assert.equal(judgeCalls[1].judgeTools, 'none');
      }
    });

    it('lets explicit judge.totalSeatBudgetMs / judge.seatBudget win over judge.timeoutMs * 2', async () => {
      for (const budgetField of ['totalSeatBudgetMs', 'seatBudget', 'seat-budget']) {
        const judgeCalls = [];
        const mockHarness = new MockAdapter();

        mockHarness.executeSeatProof = async (ctx) => ({
          scope: 'Core',
          kind: 'check',
          source: 'Spec',
          statement: `Proof from ${ctx.seat.id}`
        });

        mockHarness.executeJudgeAuditAndSynthesis = async (ctx) => {
          judgeCalls.push({ timeoutMs: ctx.timeoutMs, tools: ctx.tools });
          if (judgeCalls.length === 1) {
            throw new TimeoutError('Judge timed out after 100000ms', {
              seatId: ctx.judge.id,
              harness: 'mock',
              timeoutMs: 100000
            });
          }
          return {
            summary: 'Synthesized inside explicit Judge budget',
            clauses: [{ id: 'C1', context: 'Core', conclusion: 'Verified', citedProofIds: ['P1'] }],
            proofDecisions: { P1: { status: 'admitted', note: 'OK' } }
          };
        };

        mockHarness.executeSeatVote = async () => ({ vote: 'accept' });

        const rawConfig = {
          topic: `Explicit Judge ${budgetField}`,
          maxRounds: 1,
          minQuorum: 2,
          totalSeatBudgetMs: 400000,
          judge: {
            id: 'judge-explicit-budget',
            harness: 'mock',
            model: 'gpt-6-astra (max)',
            soul: 'Judge',
            timeoutMs: 150000,
            [budgetField]: 140000 // Clamps initial 150000 -> 140000; after 100000 timeout leaves 40000ms retry
          },
          seats: [
            { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'gemini-4-argon-high', soul: 'S2' }
          ]
        };

        const resolved = resolveConfig(rawConfig);
        assert.equal(resolved.judge.totalSeatBudgetMs, 140000);

        const engine = new CouncilEngine(resolved, { harnessResolver: () => mockHarness });
        engine.initRoster();
        const result = await engine.run();

        assert.equal(result.ok, true);
        assert.equal(judgeCalls.length, 2);
        assert.equal(judgeCalls[0].timeoutMs, 140000);
        assert.equal(judgeCalls[1].timeoutMs, 40000);
      }
    });
  });

  describe('2. Wave-based concurrent seat retries in DELIBERATION and VOTING', () => {
    it('executes DELIBERATION Attempt 1 retries concurrently in a single parallel wave with roster-ordered Proof IDs', async () => {
      const mockHarness = new MockAdapter();
      const attemptCount = new Map();
      let retryInFlight = 0;
      let maxRetryInFlight = 0;
      let retryWaveStartMs = 0;
      let retryWaveEndMs = 0;
      const retryTimeouts = new Map();
      const retryTools = new Map();

      let releaseBarrier;
      let arrivedAtBarrier = 0;
      const bothArrived = new Promise((resolve) => {
        releaseBarrier = resolve;
      });

      mockHarness.executeSeatProof = async (ctx) => {
        const id = ctx.seat.id;
        const attempt = attemptCount.get(id) || 0;
        attemptCount.set(id, attempt + 1);

        // Seat 0 and Seat 2 time out / return invalid proof on Attempt 0; Seat 1 succeeds immediately on Attempt 0!
        if (attempt === 0) {
          if (id === 'seat-0') {
            throw new TimeoutError('seat-0 timed out', { seatId: id, harness: 'mock', timeoutMs: 1000 });
          }
          if (id === 'seat-2') {
            return { scope: '', kind: 'invalid-kind', source: '', statement: '' }; // Invalid schema -> InvalidResponseError
          }
          return {
            scope: 'Seat1Scope',
            kind: 'check',
            source: 'Spec1',
            statement: 'Seat 1 Attempt 0 proof'
          };
        }

        // Attempt 1 retry wave (both seat-0 and seat-2 must enter concurrently!)
        if (retryWaveStartMs === 0) retryWaveStartMs = Date.now();
        retryInFlight++;
        maxRetryInFlight = Math.max(maxRetryInFlight, retryInFlight);
        retryTimeouts.set(id, ctx.timeoutMs);
        retryTools.set(id, ctx.tools);

        arrivedAtBarrier++;
        if (arrivedAtBarrier === 2) {
          releaseBarrier();
        }
        await Promise.race([bothArrived, sleep(250)]);
        // Make seat-0 finish slightly AFTER seat-2 to prove roster-order Proof ID assignment!
        await sleep(id === 'seat-0' ? 65 : 55);

        retryInFlight--;
        retryWaveEndMs = Date.now();

        return {
          scope: `${id}-scope`,
          kind: 'benchmark',
          source: `${id}-src`,
          statement: `${id} retry proof`
        };
      };

      mockHarness.executeJudgeAuditAndSynthesis = async (ctx) => {
        const ids = ctx.proofs.map((p) => p.id);
        return {
          summary: 'Synthesized',
          clauses: [{ id: 'C1', context: 'All', conclusion: 'OK', citedProofIds: ids }],
          proofDecisions: Object.fromEntries(ids.map((id) => [id, { status: 'admitted', note: 'OK' }]))
        };
      };

      mockHarness.executeSeatVote = async () => ({ vote: 'accept' });

      const engine = new CouncilEngine(
        {
          topic: 'Concurrent DELIBERATION retries',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          maxConcurrentSeats: 3,
          seats: [
            { id: 'seat-0', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'S0', tools: 'read-only' },
            { id: 'seat-1', harness: 'mock', model: 'gemini-4-argon-high', soul: 'S1', tools: 'read-only' },
            { id: 'seat-2', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'S2', tools: 'read-only' }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      engine.initRoster();
      const result = await engine.run();

      assert.equal(result.ok, true);
      assert.equal(maxRetryInFlight, 2, 'Both faulted seats must execute Attempt 1 concurrently');
      const retryWallMs = retryWaveEndMs - retryWaveStartMs;
      assert.ok(retryWallMs < 110, `Expected parallel 65ms/55ms retries < 110ms wall-clock, got ${retryWallMs}ms`);

      // Timeout stripped tools on seat-0, while non-timeout InvalidResponseError preserved read-only on seat-2
      assert.equal(retryTools.get('seat-0'), 'none');
      assert.equal(retryTools.get('seat-2'), 'read-only');
      assert.equal(retryTimeouts.get('seat-0'), 90000);
      assert.equal(retryTimeouts.get('seat-2'), 90000);

      // Strict roster-index Proof IDs despite seat-1 succeeding on Attempt 0 and seat-2 finishing retry before seat-0!
      assert.deepEqual(
        result.state.proofs.map((p) => ({ id: p.id, seatId: p.seatId })),
        [
          { id: 'P1', seatId: 'seat-0' },
          { id: 'P2', seatId: 'seat-1' },
          { id: 'P3', seatId: 'seat-2' }
        ]
      );
    });

    it('executes VOTING Attempt 1 retries concurrently in a single parallel wave with roster-ordered Objection IDs', async () => {
      const mockHarness = new MockAdapter();
      const voteAttempts = new Map();
      let retryInFlight = 0;
      let maxRetryInFlight = 0;
      let retryStartMs = 0;
      let retryEndMs = 0;

      let releaseBarrier;
      let arrived = 0;
      const bothArrived = new Promise((resolve) => {
        releaseBarrier = resolve;
      });

      mockHarness.executeSeatProof = async (ctx) => ({
        scope: 'VoteTest',
        kind: 'check',
        source: 'Spec',
        statement: `Proof by ${ctx.seat.id}`
      });

      mockHarness.executeJudgeAuditAndSynthesis = async () => ({
        summary: 'Candidate 1',
        clauses: [{ id: 'C1', context: 'VoteTest', conclusion: 'Draft', citedProofIds: ['P1', 'P2', 'P3'] }],
        proofDecisions: {
          P1: { status: 'admitted', note: 'OK' },
          P2: { status: 'admitted', note: 'OK' },
          P3: { status: 'admitted', note: 'OK' }
        }
      });

      mockHarness.executeSeatVote = async (ctx) => {
        const id = ctx.seat.id;
        const attempt = voteAttempts.get(id) || 0;
        voteAttempts.set(id, attempt + 1);

        if (attempt === 0) {
          if (id === 'voter-0') {
            throw new TimeoutError('voter-0 vote timeout', { seatId: id, harness: 'mock', timeoutMs: 1000 });
          }
          if (id === 'voter-1') {
            // Voter 1 objects immediately on Attempt 0!
            return { vote: 'object', reason: 'Voter 1 immediate objection', proofId: 'P2' };
          }
          if (id === 'voter-2') {
            throw new QuotaExhaustionError('429 temporary rate limit on voter-2');
          }
        }

        if (retryStartMs === 0) retryStartMs = Date.now();
        retryInFlight++;
        maxRetryInFlight = Math.max(maxRetryInFlight, retryInFlight);

        arrived++;
        if (arrived === 2) releaseBarrier();
        await Promise.race([bothArrived, sleep(250)]);
        // Voter 0 finishes slower than Voter 2, yet must still get O1 before Voter 1 (O2) and Voter 2 (O3)!
        await sleep(id === 'voter-0' ? 65 : 55);

        retryInFlight--;
        retryEndMs = Date.now();

        return {
          vote: 'object',
          reason: `${id} retry objection`,
          proofId: id === 'voter-0' ? 'P1' : 'P3'
        };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Concurrent VOTING retries',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          maxConcurrentSeats: 3,
          seats: [
            { id: 'voter-0', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'V0' },
            { id: 'voter-1', harness: 'mock', model: 'gemini-4-argon-high', soul: 'V1' },
            { id: 'voter-2', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'V2' }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      engine.initRoster();
      const result = await engine.run();

      assert.equal(maxRetryInFlight, 2, 'Both faulted voters must retry concurrently');
      const retryWallMs = retryEndMs - retryStartMs;
      assert.ok(retryWallMs < 110, `Expected parallel 65ms/55ms vote retries < 110ms wall-clock, got ${retryWallMs}ms`);

      assert.deepEqual(
        result.state.objections.map((o) => ({ id: o.id, seatId: o.seatId, proofId: o.proofId })),
        [
          { id: 'O1', seatId: 'voter-0', proofId: 'P1' },
          { id: 'O2', seatId: 'voter-1', proofId: 'P2' },
          { id: 'O3', seatId: 'voter-2', proofId: 'P3' }
        ]
      );
    });

    it('honors maxConcurrentSeats throttling during retry waves without counting queue wait time against seatElapsedMs', async () => {
      const mockHarness = new MockAdapter();
      const attempts = new Map();
      let inFlight = 0;
      let maxObservedInFlight = 0;
      const observedRetryTimeouts = new Map();

      mockHarness.executeSeatProof = async (ctx) => {
        const id = ctx.seat.id;
        const n = attempts.get(id) || 0;
        attempts.set(id, n + 1);

        inFlight++;
        maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
        try {
          if (n === 0) {
            await sleep(20);
            throw new QuotaExhaustionError(`429 on ${id} attempt 0`);
          }
          // Attempt 1: each seat sleeps 40ms sequentially under maxConcurrentSeats: 1.
          // Total wall-clock across 3 seats in retry wave 1 is ~120ms (> 95ms budget!),
          // yet each individual seat only spends ~20ms (attempt 0) + ~40ms (attempt 1) = ~60ms < 95ms!
          // If queue wait time were counted in seatElapsedMs, seat-2 would falsely exhaust its 95ms budget on wave 2!
          await sleep(40);
          if (n === 1) {
            throw new QuotaExhaustionError(`429 on ${id} attempt 1`);
          }
          observedRetryTimeouts.set(id, ctx.timeoutMs);
          return {
            scope: 'Throttle',
            kind: 'check',
            source: 'Spec',
            statement: `Proof from ${id}`
          };
        } finally {
          inFlight--;
        }
      };

      mockHarness.executeJudgeAuditAndSynthesis = async () => ({
        summary: 'OK',
        clauses: [{ id: 'C1', context: 'Throttle', conclusion: 'OK', citedProofIds: ['P1', 'P2', 'P3'] }],
        proofDecisions: {
          P1: { status: 'admitted', note: 'OK' },
          P2: { status: 'admitted', note: 'OK' },
          P3: { status: 'admitted', note: 'OK' }
        }
      });

      mockHarness.executeSeatVote = async () => ({ vote: 'accept' });

      const engine = new CouncilEngine(
        {
          topic: 'Throttled retry queue wait exclusion',
          maxRounds: 1,
          minQuorum: 3,
          maxRetriesPerSeat: 2,
          maxConcurrentSeats: 1,
          totalSeatBudgetMs: 95,
          timeoutMs: 80,
          seats: [
            { id: 't-0', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'T0' },
            { id: 't-1', harness: 'mock', model: 'gemini-4-argon-high', soul: 'T1' },
            { id: 't-2', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'T2' }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      engine.initRoster();
      const result = await engine.run();

      assert.equal(maxObservedInFlight, 1, 'maxConcurrentSeats: 1 must strictly throttle retry waves');
      assert.equal(result.ok, true, 'Queue wait time must not cause t-2 to exhaust its 95ms seat budget');
      assert.equal(result.verdict.kind, 'Unanimous Consensus');
      assert.ok((observedRetryTimeouts.get('t-2') || 0) >= 20, 't-2 retained its unqueued remaining budget');
    });

    it('halts immediately without dispatching retry waves or SUBMIT_PROOF / CAST_VOTE when EXCUSE_SEAT drops below minQuorum', async () => {
      // Case A: DELIBERATION quorum drop
      {
        const mockHarness = new MockAdapter();
        let retryCalls = 0;

        mockHarness.executeSeatProof = async (ctx) => {
          if (ctx.seat.id === 'fatal-seat') {
            const unretryable = new Error('Fatal auth failure');
            unretryable.isRetryable = false;
            throw unretryable;
          }
          if (ctx.seat.id === 'retryable-seat') {
            if ((ctx.seat.retries || 0) > 0) retryCalls++;
            throw new QuotaExhaustionError('Temporary 429');
          }
          return { scope: 'Q', kind: 'check', source: 'S', statement: 'Valid proof' };
        };

        const engine = new CouncilEngine(
          {
            topic: 'Deliberation quorum drop',
            maxRounds: 1,
            minQuorum: 3,
            maxRetriesPerSeat: 1,
            seats: [
              { id: 'ok-seat', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'S0' },
              { id: 'fatal-seat', harness: 'mock', model: 'gemini-4-argon-high', soul: 'S1' },
              { id: 'retryable-seat', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'S2' }
            ]
          },
          { harnessResolver: () => mockHarness }
        );

        const transitions = [];
        engine.getTelemetry().on('state_transition', (snap) => transitions.push(snap.event.type));

        engine.initRoster();
        const result = await engine.run();

        assert.equal(result.state.phase, 'completed');
        assert.match(result.state.verdict.kind, /Below Quorum/);
        assert.equal(retryCalls, 0, 'No subsequent retry wave should execute after quorum drop');
        assert.equal(transitions.includes('SUBMIT_PROOF'), false, 'No SUBMIT_PROOF committed after quorum drop');
      }

      // Case B: VOTING quorum drop
      {
        const mockHarness = new MockAdapter();
        let voteRetryCalls = 0;

        mockHarness.executeSeatProof = async (ctx) => ({
          scope: 'Q',
          kind: 'check',
          source: 'S',
          statement: `Proof by ${ctx.seat.id}`
        });

        mockHarness.executeJudgeAuditAndSynthesis = async () => ({
          summary: 'OK',
          clauses: [{ id: 'C1', context: 'Q', conclusion: 'OK', citedProofIds: ['P1', 'P2', 'P3'] }],
          proofDecisions: {
            P1: { status: 'admitted', note: 'OK' },
            P2: { status: 'admitted', note: 'OK' },
            P3: { status: 'admitted', note: 'OK' }
          }
        });

        mockHarness.executeSeatVote = async (ctx) => {
          if (ctx.seat.id === 'fatal-voter') {
            const unretryable = new Error('Fatal vote auth failure');
            unretryable.isRetryable = false;
            throw unretryable;
          }
          if (ctx.seat.id === 'retryable-voter') {
            if ((ctx.seat.retries || 0) > 0) voteRetryCalls++;
            throw new QuotaExhaustionError('Temporary vote 429');
          }
          return { vote: 'accept' };
        };

        const engine = new CouncilEngine(
          {
            topic: 'Voting quorum drop',
            maxRounds: 1,
            minQuorum: 3,
            maxRetriesPerSeat: 1,
            seats: [
              { id: 'ok-voter', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'S0' },
              { id: 'fatal-voter', harness: 'mock', model: 'gemini-4-argon-high', soul: 'S1' },
              { id: 'retryable-voter', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'S2' }
            ]
          },
          { harnessResolver: () => mockHarness }
        );

        const transitions = [];
        engine.getTelemetry().on('state_transition', (snap) => transitions.push(snap.event.type));

        engine.initRoster();
        const result = await engine.run();

        assert.equal(result.state.phase, 'completed');
        assert.match(result.state.verdict.kind, /Below Quorum/);
        assert.equal(voteRetryCalls, 0, 'No subsequent vote retry wave should execute after quorum drop');
        assert.equal(transitions.includes('CAST_VOTE'), false, 'No CAST_VOTE committed after quorum drop');
      }
    });
  });
});
