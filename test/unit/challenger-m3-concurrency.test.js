/**
 * @fileoverview Empirical Concurrency & Determinism Challenge Suite for Milestone 3 (#24, #25)
 * Author: challenger_m3_1 (Empirical Challenger)
 * Framework: Node.js 22 native test runner (node:test, node:assert/strict)
 *
 * This test suite stress-tests the concurrency architecture and deterministic reducer ordering:
 * 1. Concurrency speedup under pool limits (4 seats @ 100ms in < 250ms vs > 400ms sequential).
 * 2. Pool limits enforcement (staggered waves under constrained concurrency).
 * 3. Deterministic Proof IDs (P1, P2, P3...) under inverted completion times (Seat 3 fast, Seat 1 slow).
 * 4. Deterministic Objection IDs (O1, O2, O3...) under inverted voting times.
 * 5. Random jitter / out-of-order race conditions across multiple iterations.
 * 6. Edge cases: maxConcurrentSeats = 1 (strict serial), maxConcurrentSeats = 50 (unbounded), 1 seat council.
 * 7. Fault tolerance under concurrency: seat faults (retry and excusal) without stalling other seats.
 * 8. Early abort signal interruption during concurrent in-flight turns.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CouncilEngine, mapConcurrent } from '../../src/engine/council-engine.js';
import { MockAdapter } from '../../src/harness/mock.js';
import { HarnessError, TimeoutError } from '../../src/harness/adapter.js';
import { formatDeliberationPrompt } from '../../src/seats/soul.js';

describe('Empirical Challenge: Milestone 3 Concurrency & Deterministic Reducer Ordering', () => {

  // =========================================================================
  // CHALLENGE 1: Concurrency Speedup & Pool Limits
  // =========================================================================
  describe('Challenge 1: Concurrency Speedup Benchmark', () => {
    it('achieves > 2.0x concurrency speedup: 4 seats @ 100ms finish in < 250ms vs > 400ms sequential', async () => {
      const delayMs = 100;
      const seatIds = ['s1', 's2', 's3', 's4'];

      // --- Part A: Concurrent Run (maxConcurrentSeats: 4) ---
      const concurrentMock = new MockAdapter();
      for (const id of seatIds) {
        concurrentMock.scriptSeatResponse({
          seatId: id,
          phase: 'DELIBERATION',
          response: async () => {
            await new Promise((r) => setTimeout(r, delayMs));
            return {
              scope: `Scope ${id}`,
              kind: 'benchmark',
              source: `Source ${id}`,
              statement: `Statement ${id}`
            };
          }
        });
      }

      const concurrentEngine = new CouncilEngine(
        {
          topic: 'Empirical Speedup Deliberation',
          maxConcurrentSeats: 4,
          minQuorum: 2,
          judge: { id: 'judge', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: seatIds.map((id) => ({ id, harness: 'mock', model: 'mock-model', soul: `Soul ${id}` }))
        },
        { harnessResolver: () => concurrentMock }
      );

      concurrentEngine.initRoster();
      const concurrentStart = Date.now();
      await concurrentEngine.runRound();
      const concurrentElapsed = Date.now() - concurrentStart;

      // --- Part B: Sequential Baseline (maxConcurrentSeats: 1) ---
      const sequentialMock = new MockAdapter();
      for (const id of seatIds) {
        sequentialMock.scriptSeatResponse({
          seatId: id,
          phase: 'DELIBERATION',
          response: async () => {
            await new Promise((r) => setTimeout(r, delayMs));
            return {
              scope: `Scope ${id}`,
              kind: 'benchmark',
              source: `Source ${id}`,
              statement: `Statement ${id}`
            };
          }
        });
      }

      const sequentialEngine = new CouncilEngine(
        {
          topic: 'Sequential Baseline Deliberation',
          maxConcurrentSeats: 1,
          minQuorum: 2,
          judge: { id: 'judge', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: seatIds.map((id) => ({ id, harness: 'mock', model: 'mock-model', soul: `Soul ${id}` }))
        },
        { harnessResolver: () => sequentialMock }
      );

      sequentialEngine.initRoster();
      const sequentialStart = Date.now();
      await sequentialEngine.runRound();
      const sequentialElapsed = Date.now() - sequentialStart;

      const speedup = sequentialElapsed / concurrentElapsed;

      // Assertions
      assert.ok(
        concurrentElapsed < 250,
        `Expected concurrent elapsed < 250ms, saw ${concurrentElapsed}ms`
      );
      assert.ok(
        sequentialElapsed >= 400,
        `Expected sequential elapsed >= 400ms, saw ${sequentialElapsed}ms`
      );
      assert.ok(
        speedup >= 2.0,
        `Expected speedup >= 2.0x, achieved ${speedup.toFixed(2)}x (${sequentialElapsed}ms / ${concurrentElapsed}ms)`
      );
      assert.equal(concurrentEngine.state.proofs.length, 4);
      assert.equal(sequentialEngine.state.proofs.length, 4);
    });

    it('enforces bounded concurrency pool: 4 seats @ 100ms with maxConcurrentSeats: 2 run in staggered pairs (~200-300ms)', async () => {
      const seatIds = ['s1', 's2', 's3', 's4'];
      let activeHarnessCalls = 0;
      let maxActiveCalls = 0;

      const mock = new MockAdapter();
      for (const id of seatIds) {
        mock.scriptSeatResponse({
          seatId: id,
          phase: 'DELIBERATION',
          response: async () => {
            activeHarnessCalls++;
            if (activeHarnessCalls > maxActiveCalls) {
              maxActiveCalls = activeHarnessCalls;
            }
            await new Promise((r) => setTimeout(r, 100));
            activeHarnessCalls--;
            return {
              scope: `Scope ${id}`,
              kind: 'check',
              source: `Source ${id}`,
              statement: `Statement ${id}`
            };
          }
        });
      }

      const engine = new CouncilEngine(
        {
          topic: 'Constrained Concurrency Pool',
          maxConcurrentSeats: 2,
          minQuorum: 2,
          judge: { id: 'judge', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: seatIds.map((id) => ({ id, harness: 'mock', model: 'mock-model', soul: `Soul ${id}` }))
        },
        { harnessResolver: () => mock }
      );

      engine.initRoster();
      const start = Date.now();
      await engine.runRound();
      const elapsed = Date.now() - start;

      assert.equal(maxActiveCalls, 2, `Expected max concurrent calls to be capped at 2, but observed ${maxActiveCalls}`);
      assert.ok(
        elapsed >= 200 && elapsed < 350,
        `Expected elapsed between 200ms and 350ms for 2 waves of 100ms, got ${elapsed}ms`
      );
      assert.equal(engine.state.proofs.length, 4);
    });
  });

  // =========================================================================
  // CHALLENGE 2: Deterministic Proof IDs Under Inverted Completion
  // =========================================================================
  describe('Challenge 2: Deterministic Proof IDs Under Out-of-Order Deliberation', () => {
    it('guarantees deterministic Proof IDs (P1=s1, P2=s2, P3=s3) when seat 3 finishes first and seat 1 finishes last', async () => {
      // Seat 3: 10ms, Seat 2: 50ms, Seat 1: 100ms
      const completionTimes = { s1: 100, s2: 50, s3: 10 };
      const finishOrder = [];

      const mock = new MockAdapter();
      for (const id of ['s1', 's2', 's3']) {
        mock.scriptSeatResponse({
          seatId: id,
          phase: 'DELIBERATION',
          response: async () => {
            await new Promise((r) => setTimeout(r, completionTimes[id]));
            finishOrder.push(id);
            return {
              scope: `Scope for ${id}`,
              kind: 'derivation',
              source: `Derived by ${id}`,
              statement: `Hypothesis proved by ${id}`
            };
          }
        });
      }

      const engine = new CouncilEngine(
        {
          topic: 'Inverted Deliberation Proof Order',
          maxConcurrentSeats: 3,
          minQuorum: 2,
          judge: { id: 'judge', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'mock', model: 'mock-model', soul: 'Soul 1' },
            { id: 's2', harness: 'mock', model: 'mock-model', soul: 'Soul 2' },
            { id: 's3', harness: 'mock', model: 'mock-model', soul: 'Soul 3' }
          ]
        },
        { harnessResolver: () => mock }
      );

      engine.initRoster();
      await engine.runRound();

      // Confirm physical completion happened in inverted order: s3 (10ms) -> s2 (50ms) -> s1 (100ms)
      assert.deepEqual(finishOrder, ['s3', 's2', 's1'], 'Expected asynchronous calls to finish in s3, s2, s1 order');

      // State machine MUST preserve roster order:
      // Proof 0 -> P1 from s1
      // Proof 1 -> P2 from s2
      // Proof 2 -> P3 from s3
      const proofs = engine.state.proofs;
      assert.equal(proofs.length, 3);

      assert.equal(proofs[0].id, 'P1');
      assert.equal(proofs[0].seatId, 's1');
      assert.equal(proofs[0].source, 'Derived by s1');

      assert.equal(proofs[1].id, 'P2');
      assert.equal(proofs[1].seatId, 's2');
      assert.equal(proofs[1].source, 'Derived by s2');

      assert.equal(proofs[2].id, 'P3');
      assert.equal(proofs[2].seatId, 's3');
      assert.equal(proofs[2].source, 'Derived by s3');

      // Check transition history order (oldest transition is at the end of the history array)
      const proofHistoryMessages = engine.state.history
        .filter((msg) => msg.includes('submitted Proof'))
        .reverse(); // Now chronological

      assert.ok(proofHistoryMessages[0].includes('Seat "s1" submitted Proof P1'));
      assert.ok(proofHistoryMessages[1].includes('Seat "s2" submitted Proof P2'));
      assert.ok(proofHistoryMessages[2].includes('Seat "s3" submitted Proof P3'));
    });

    it('guarantees deterministic proof ordering across 10 randomized-delay iterations', async () => {
      const seatIds = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];

      for (let run = 1; run <= 10; run++) {
        const mock = new MockAdapter();
        for (const id of seatIds) {
          const randomDelay = Math.floor(Math.random() * 40) + 5; // 5ms - 45ms jitter
          mock.scriptSeatResponse({
            seatId: id,
            phase: 'DELIBERATION',
            response: async () => {
              await new Promise((r) => setTimeout(r, randomDelay));
              return {
                scope: `Scope ${id}`,
                kind: 'citation',
                source: `Citation from ${id}`,
                statement: `Verified fact by ${id}`
              };
            }
          });
        }

        const engine = new CouncilEngine(
          {
            topic: `Random Jitter Deliberation Run ${run}`,
            maxConcurrentSeats: 5,
            minQuorum: 3,
            judge: { id: 'judge', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
            seats: seatIds.map((id) => ({ id, harness: 'mock', model: 'mock-model', soul: `Soul ${id}` }))
          },
          { harnessResolver: () => mock }
        );

        engine.initRoster();
        await engine.runRound();

        const proofs = engine.state.proofs;
        assert.equal(proofs.length, 5);
        for (let i = 0; i < seatIds.length; i++) {
          assert.equal(proofs[i].id, `P${i + 1}`);
          assert.equal(proofs[i].seatId, seatIds[i]);
        }
      }
    });
  });

  // =========================================================================
  // CHALLENGE 3: Deterministic Objection IDs Under Inverted Voting
  // =========================================================================
  describe('Challenge 3: Deterministic Objection IDs Under Out-of-Order Voting', () => {
    it('guarantees deterministic Objection IDs (O1=s1, O2=s2, O3=s3) when voter 3 votes first and voter 1 votes last', async () => {
      const voteTimes = { s1: 90, s2: 45, s3: 10 };
      const voteFinishOrder = [];

      const mock = new MockAdapter();

      // Script Deliberation proofs
      for (const id of ['s1', 's2', 's3']) {
        mock.scriptSeatResponse({
          seatId: id,
          phase: 'DELIBERATION',
          response: async () => ({
            scope: `Scope ${id}`,
            kind: 'check',
            source: `Source ${id}`,
            statement: `Statement ${id}`
          })
        });
      }

      // Script Judge to admit all proofs and synthesize candidate
      mock.executeJudgeAuditAndSynthesis = async ({ proofs }) => {
        const proofDecisions = {};
        for (const p of proofs) {
          proofDecisions[p.id] = { status: 'admitted', note: 'Valid proof' };
        }
        return {
          summary: 'Balanced synthesis',
          proofDecisions,
          clauses: [{ text: 'Consensus Clause', citedProofIds: ['P1', 'P2', 'P3'] }]
        };
      };

      // Script Inverted Voting where all seats object citing their own proof
      const seatProofMap = { s1: 'P1', s2: 'P2', s3: 'P3' };
      for (const id of ['s1', 's2', 's3']) {
        mock.scriptSeatResponse({
          seatId: id,
          phase: 'VOTING',
          response: async () => {
            await new Promise((r) => setTimeout(r, voteTimes[id]));
            voteFinishOrder.push(id);
            return {
              vote: 'object',
              reason: `Empirical objection from ${id}`,
              proofId: seatProofMap[id]
            };
          }
        });
      }

      const engine = new CouncilEngine(
        {
          topic: 'Inverted Objection ID Ordering',
          maxConcurrentSeats: 3,
          minQuorum: 2,
          judge: { id: 'judge', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'mock', model: 'mock-model', soul: 'Soul 1' },
            { id: 's2', harness: 'mock', model: 'mock-model', soul: 'Soul 2' },
            { id: 's3', harness: 'mock', model: 'mock-model', soul: 'Soul 3' }
          ]
        },
        { harnessResolver: () => mock }
      );

      engine.initRoster();
      await engine.runRound();

      // Confirm voting promises finished in inverted order: s3 (10ms) -> s2 (45ms) -> s1 (90ms)
      assert.deepEqual(voteFinishOrder, ['s3', 's2', 's1']);

      // State machine objections must be ordered strictly by roster order:
      // O1 -> s1 (citing P1)
      // O2 -> s2 (citing P2)
      // O3 -> s3 (citing P3)
      const objections = engine.state.objections;
      assert.equal(objections.length, 3);

      assert.equal(objections[0].id, 'O1');
      assert.equal(objections[0].seatId, 's1');
      assert.equal(objections[0].proofId, 'P1');
      assert.equal(objections[0].reason, 'Empirical objection from s1');

      assert.equal(objections[1].id, 'O2');
      assert.equal(objections[1].seatId, 's2');
      assert.equal(objections[1].proofId, 'P2');
      assert.equal(objections[1].reason, 'Empirical objection from s2');

      assert.equal(objections[2].id, 'O3');
      assert.equal(objections[2].seatId, 's3');
      assert.equal(objections[2].proofId, 'P3');
      assert.equal(objections[2].reason, 'Empirical objection from s3');

      // Verify state machine transition sequence in chronological order
      const voteHistoryMessages = engine.state.history
        .filter((msg) => msg.includes('raised Objection'))
        .reverse();

      assert.ok(voteHistoryMessages[0].includes('Seat "s1" raised Objection O1'));
      assert.ok(voteHistoryMessages[1].includes('Seat "s2" raised Objection O2'));
      assert.ok(voteHistoryMessages[2].includes('Seat "s3" raised Objection O3'));
    });
  });

  // =========================================================================
  // CHALLENGE 4: Edge Cases & Extreme Boundaries
  // =========================================================================
  describe('Challenge 4: Edge Cases & Extreme Boundaries', () => {
    it('handles maxConcurrentSeats: 1 (strictly serialized pool) correctly', async () => {
      const mock = new MockAdapter();
      for (const id of ['s1', 's2', 's3']) {
        mock.scriptSeatResponse({
          seatId: id,
          phase: 'DELIBERATION',
          response: async () => {
            await new Promise((r) => setTimeout(r, 30));
            return {
              scope: `Scope ${id}`,
              kind: 'check',
              source: `Source ${id}`,
              statement: `Statement ${id}`
            };
          }
        });
      }

      const engine = new CouncilEngine(
        {
          topic: 'Serialized Concurrency Test',
          maxConcurrentSeats: 1,
          minQuorum: 2,
          judge: { id: 'judge', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'mock', model: 'mock-model', soul: 'Soul 1' },
            { id: 's2', harness: 'mock', model: 'mock-model', soul: 'Soul 2' },
            { id: 's3', harness: 'mock', model: 'mock-model', soul: 'Soul 3' }
          ]
        },
        { harnessResolver: () => mock }
      );

      engine.initRoster();
      const start = Date.now();
      await engine.runRound();
      const elapsed = Date.now() - start;

      assert.ok(elapsed >= 90, `Serialized execution must take >= 90ms, elapsed was ${elapsed}ms`);
      assert.equal(engine.state.proofs.length, 3);
      assert.equal(engine.state.proofs[0].id, 'P1');
      assert.equal(engine.state.proofs[1].id, 'P2');
      assert.equal(engine.state.proofs[2].id, 'P3');
    });

    it('handles maxConcurrentSeats: 50 (unbounded, exceeds seat count) gracefully', async () => {
      const mock = new MockAdapter();
      for (const id of ['s1', 's2']) {
        mock.scriptSeatResponse({
          seatId: id,
          phase: 'DELIBERATION',
          response: async () => ({
            scope: `Scope ${id}`,
            kind: 'check',
            source: `Source ${id}`,
            statement: `Statement ${id}`
          })
        });
      }

      const engine = new CouncilEngine(
        {
          topic: 'High Limit Pool Test',
          maxConcurrentSeats: 50,
          minQuorum: 2,
          judge: { id: 'judge', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'mock', model: 'mock-model', soul: 'Soul 1' },
            { id: 's2', harness: 'mock', model: 'mock-model', soul: 'Soul 2' }
          ]
        },
        { harnessResolver: () => mock }
      );

      engine.initRoster();
      await engine.runRound();

      assert.equal(engine.state.proofs.length, 2);
      assert.equal(engine.state.proofs[0].id, 'P1');
      assert.equal(engine.state.proofs[1].id, 'P2');
    });

    it('handles single seat council (minQuorum: 1, maxConcurrentSeats: 1)', async () => {
      const mock = new MockAdapter();
      mock.scriptSeatResponse({
        seatId: 'solo',
        phase: 'DELIBERATION',
        response: async () => ({
          scope: 'Solo Scope',
          kind: 'citation',
          source: 'Solo Source',
          statement: 'Solo Statement'
        })
      });

      mock.executeJudgeAuditAndSynthesis = async ({ proofs }) => ({
        summary: 'Solo Synthesis',
        proofDecisions: { P1: { status: 'admitted', note: 'Solo Admitted' } },
        clauses: [{ text: 'Solo Clause', citedProofIds: ['P1'] }]
      });

      mock.scriptSeatResponse({
        seatId: 'solo',
        phase: 'VOTING',
        response: async () => ({ vote: 'accept' })
      });

      const engine = new CouncilEngine(
        {
          topic: 'Single Seat Council',
          maxConcurrentSeats: 1,
          minQuorum: 1,
          judge: { id: 'judge', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: [{ id: 'solo', harness: 'mock', model: 'mock-model', soul: 'Solo Soul' }]
        },
        { harnessResolver: () => mock }
      );

      engine.initRoster();
      await engine.runRound();

      assert.equal(engine.state.proofs.length, 1);
      assert.equal(engine.state.proofs[0].id, 'P1');
      assert.equal(engine.state.verdict?.kind, 'Unanimous Consensus');
    });

    it('handles out-of-order seat fault & excusal without dropping concurrent sister results', async () => {
      // Seat 1: throws quota fault after 40ms
      // Seat 2: succeeds in 10ms (finishes first!)
      // Seat 3: succeeds in 20ms
      const mock = new MockAdapter();

      mock.scriptSeatResponse({
        seatId: 's1',
        phase: 'DELIBERATION',
        response: async () => {
          await new Promise((r) => setTimeout(r, 40));
          throw new HarnessError('Quota exceeded for s1', {
            harness: 'mock',
            seatId: 's1',
            status: 'fault_quota'
          });
        }
      });

      mock.scriptSeatResponse({
        seatId: 's2',
        phase: 'DELIBERATION',
        response: async () => {
          await new Promise((r) => setTimeout(r, 10));
          return {
            scope: 'Scope s2',
            kind: 'benchmark',
            source: 'Source s2',
            statement: 'Statement s2'
          };
        }
      });

      mock.scriptSeatResponse({
        seatId: 's3',
        phase: 'DELIBERATION',
        response: async () => {
          await new Promise((r) => setTimeout(r, 20));
          return {
            scope: 'Scope s3',
            kind: 'check',
            source: 'Source s3',
            statement: 'Statement s3'
          };
        }
      });

      const engine = new CouncilEngine(
        {
          topic: 'Concurrent Fault Handling',
          maxConcurrentSeats: 3,
          minQuorum: 2, // Quorum is 2, so excusing s1 leaves 2 active seats (s2, s3) -> quorum maintained
          maxRetriesPerSeat: 0, // Immediately excuse on fault
          judge: { id: 'judge', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'mock', model: 'mock-model', soul: 'Soul 1' },
            { id: 's2', harness: 'mock', model: 'mock-model', soul: 'Soul 2' },
            { id: 's3', harness: 'mock', model: 'mock-model', soul: 'Soul 3' }
          ]
        },
        { harnessResolver: () => mock }
      );

      engine.initRoster();
      await engine.runRound();

      // Seat 1 should be excused
      const s1 = engine.state.seats.find((s) => s.id === 's1');
      assert.equal(s1.status, 'excused');

      // Seats 2 and 3 should have their pre-collected proofs submitted successfully!
      const proofs = engine.state.proofs;
      assert.equal(proofs.length, 2, 'Proofs from s2 and s3 must be retained even though s1 faulted');

      // Proof IDs: Since s1 was excused before submitting, s2 gets P1 and s3 gets P2
      assert.equal(proofs[0].id, 'P1');
      assert.equal(proofs[0].seatId, 's2');

      assert.equal(proofs[1].id, 'P2');
      assert.equal(proofs[1].seatId, 's3');
    });

    it('handles out-of-order seat fault with retry recovery while maintaining roster order', async () => {
      // Seat 1 fails on attempt 1 with TimeoutError (retryable, 30ms), succeeds on attempt 2 (10ms)
      // Seat 2 succeeds immediately (10ms)
      // Seat 3 succeeds immediately (15ms)
      let s1Attempts = 0;
      const mock = new MockAdapter();

      mock.scriptSeatResponse({
        seatId: 's1',
        phase: 'DELIBERATION',
        response: async () => {
          s1Attempts++;
          if (s1Attempts === 1) {
            await new Promise((r) => setTimeout(r, 30));
            throw new TimeoutError('Transient network timeout on s1', {
              harness: 'mock',
              seatId: 's1',
              timeoutMs: 30
            });
          }
          await new Promise((r) => setTimeout(r, 10));
          return {
            scope: 'Scope s1 (retry)',
            kind: 'derivation',
            source: 'Source s1',
            statement: 'Statement s1 recovered'
          };
        }
      });

      mock.scriptSeatResponse({
        seatId: 's2',
        phase: 'DELIBERATION',
        response: async () => {
          await new Promise((r) => setTimeout(r, 10));
          return {
            scope: 'Scope s2',
            kind: 'check',
            source: 'Source s2',
            statement: 'Statement s2'
          };
        }
      });

      mock.scriptSeatResponse({
        seatId: 's3',
        phase: 'DELIBERATION',
        response: async () => {
          await new Promise((r) => setTimeout(r, 15));
          return {
            scope: 'Scope s3',
            kind: 'benchmark',
            source: 'Source s3',
            statement: 'Statement s3'
          };
        }
      });

      const engine = new CouncilEngine(
        {
          topic: 'Concurrent Fault Retry Recovery',
          maxConcurrentSeats: 3,
          minQuorum: 2,
          maxRetriesPerSeat: 1, // Allow 1 retry
          judge: { id: 'judge', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'mock', model: 'mock-model', soul: 'Soul 1' },
            { id: 's2', harness: 'mock', model: 'mock-model', soul: 'Soul 2' },
            { id: 's3', harness: 'mock', model: 'mock-model', soul: 'Soul 3' }
          ]
        },
        { harnessResolver: () => mock }
      );

      engine.initRoster();
      await engine.runRound();

      assert.equal(s1Attempts, 2, 'Seat 1 should have been retried once');
      const proofs = engine.state.proofs;
      assert.equal(proofs.length, 3);

      // Even though s1 retried, because reducer application proceeds in roster order:
      // s1 is evaluated -> faults -> retries -> succeeds -> P1!
      // s2 was already waiting -> P2!
      // s3 was already waiting -> P3!
      assert.equal(proofs[0].id, 'P1');
      assert.equal(proofs[0].seatId, 's1');
      assert.equal(proofs[1].id, 'P2');
      assert.equal(proofs[1].seatId, 's2');
      assert.equal(proofs[2].id, 'P3');
      assert.equal(proofs[2].seatId, 's3');
    });

    it('terminates cleanly when aborted while concurrent tasks are in flight', async () => {
      const mock = new MockAdapter();
      for (const id of ['s1', 's2', 's3']) {
        mock.scriptSeatResponse({
          seatId: id,
          phase: 'DELIBERATION',
          response: async () => {
            await new Promise((r) => setTimeout(r, 150));
            return {
              scope: `Scope ${id}`,
              kind: 'check',
              source: `Source ${id}`,
              statement: `Statement ${id}`
            };
          }
        });
      }

      const controller = new AbortController();
      const engine = new CouncilEngine(
        {
          topic: 'Abort Concurrency Test',
          maxConcurrentSeats: 3,
          minQuorum: 2,
          judge: { id: 'judge', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'mock', model: 'mock-model', soul: 'Soul 1' },
            { id: 's2', harness: 'mock', model: 'mock-model', soul: 'Soul 2' },
            { id: 's3', harness: 'mock', model: 'mock-model', soul: 'Soul 3' }
          ]
        },
        { harnessResolver: () => mock, signal: controller.signal }
      );

      engine.initRoster();

      const roundPromise = engine.runRound();

      // Trigger abort after 30ms while promises are in-flight
      setTimeout(() => {
        controller.abort();
      }, 30);

      await roundPromise;
      assert.ok(engine.aborted, 'Engine should reflect aborted status');
      // No proofs should be submitted to state machine due to abort
      assert.equal(engine.state.proofs.length, 0, 'No proofs should be submitted when aborted in-flight');
    });
  });

  // =========================================================================
  // CHALLENGE 5: Adversarial Stress Vectors & Structural Invariants
  // =========================================================================
  describe('Challenge 5: Adversarial Stress Vectors & Invariants', () => {
    it('guarantees deterministic P1..P10 ordering on 10-seat roster under 4-worker pool with heavy jitter', async () => {
      const seatIds = Array.from({ length: 10 }, (_, i) => `seat-${String(i + 1).padStart(2, '0')}`);
      const mock = new MockAdapter();

      for (const id of seatIds) {
        mock.scriptSeatResponse({
          seatId: id,
          phase: 'DELIBERATION',
          response: async () => {
            // Highly variable completion times between 5ms and 60ms
            const jitter = Math.floor(Math.random() * 55) + 5;
            await new Promise((r) => setTimeout(r, jitter));
            return {
              scope: `Scope ${id}`,
              kind: 'citation',
              source: `Source from ${id}`,
              statement: `Statement from ${id}`
            };
          }
        });
      }

      const engine = new CouncilEngine(
        {
          topic: '10-Seat Deliberation Stress',
          maxConcurrentSeats: 4, // 4 concurrent workers handling 10 seats
          minQuorum: 5,
          judge: { id: 'judge', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: seatIds.map((id) => ({ id, harness: 'mock', model: 'mock-model', soul: `Soul ${id}` }))
        },
        { harnessResolver: () => mock }
      );

      engine.initRoster();
      await engine.runRound();

      assert.equal(engine.state.proofs.length, 10);
      for (let i = 0; i < 10; i++) {
        assert.equal(engine.state.proofs[i].id, `P${i + 1}`);
        assert.equal(engine.state.proofs[i].seatId, seatIds[i]);
      }
    });

    it('isolates tool policies without prompt crosstalk during concurrent turn execution', async () => {
      const mock = new MockAdapter();

      // Seat 1: tools: 'none'
      mock.scriptSeatResponse({
        seatId: 's-none',
        phase: 'DELIBERATION',
        response: async () => {
          await new Promise((r) => setTimeout(r, 15));
          return {
            scope: 'Scope None',
            kind: 'check',
            source: 'Source None',
            statement: 'Statement None'
          };
        }
      });

      // Seat 2: tools: 'read-only'
      mock.scriptSeatResponse({
        seatId: 's-read',
        phase: 'DELIBERATION',
        response: async () => {
          await new Promise((r) => setTimeout(r, 15));
          return {
            scope: 'Scope Read',
            kind: 'check',
            source: 'Source Read',
            statement: 'Statement Read'
          };
        }
      });

      const engine = new CouncilEngine(
        {
          topic: 'Tool Policy Crosstalk Stress',
          maxConcurrentSeats: 2,
          minQuorum: 2,
          judge: { id: 'judge', harness: 'mock', model: 'mock-judge', soul: 'Judge', tools: 'read-only' },
          seats: [
            { id: 's-none', harness: 'mock', model: 'mock-model', soul: 'Soul None', tools: 'none' },
            { id: 's-read', harness: 'mock', model: 'mock-model', soul: 'Soul Read', tools: 'read-only' }
          ]
        },
        { harnessResolver: () => mock }
      );

      engine.initRoster();
      await engine.runRound();

      const noneSeat = engine.config.seats.find((s) => s.id === 's-none');
      const readSeat = engine.config.seats.find((s) => s.id === 's-read');

      assert.equal(noneSeat.tools, 'none');
      assert.equal(readSeat.tools, 'read-only');

      const promptNone = formatDeliberationPrompt({ seat: noneSeat, soul: noneSeat.soul });
      const promptRead = formatDeliberationPrompt({ seat: readSeat, soul: readSeat.soul });

      assert.ok(!promptNone.includes('TOOL USAGE & VERIFICATION DIRECTIVE'));
      assert.ok(promptRead.includes('TOOL USAGE & VERIFICATION DIRECTIVE'));
      assert.equal(engine.state.proofs.length, 2);
    });

    it('cascading concurrent faults drop council below quorum and abort to Dissent Report immediately', async () => {
      // 3 seats: s1 faults, s2 faults, s3 succeeds
      // minQuorum: 2
      // Excusing s1 and s2 leaves 1 active seat < 2 -> Below Quorum dissent report!
      const mock = new MockAdapter();

      mock.scriptSeatResponse({
        seatId: 's1',
        phase: 'DELIBERATION',
        response: async () => {
          await new Promise((r) => setTimeout(r, 10));
          throw new HarnessError('s1 quota fault', { harness: 'mock', seatId: 's1', isQuotaFault: true });
        }
      });

      mock.scriptSeatResponse({
        seatId: 's2',
        phase: 'DELIBERATION',
        response: async () => {
          await new Promise((r) => setTimeout(r, 20));
          throw new HarnessError('s2 quota fault', { harness: 'mock', seatId: 's2', isQuotaFault: true });
        }
      });

      mock.scriptSeatResponse({
        seatId: 's3',
        phase: 'DELIBERATION',
        response: async () => {
          await new Promise((r) => setTimeout(r, 15));
          return { scope: 'Scope s3', kind: 'check', source: 'Source s3', statement: 'Statement s3' };
        }
      });

      const engine = new CouncilEngine(
        {
          topic: 'Cascading Faults Quorum Collapse',
          maxConcurrentSeats: 3,
          minQuorum: 2,
          maxRetriesPerSeat: 0,
          judge: { id: 'judge', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'mock', model: 'mock-model', soul: 'Soul 1' },
            { id: 's2', harness: 'mock', model: 'mock-model', soul: 'Soul 2' },
            { id: 's3', harness: 'mock', model: 'mock-model', soul: 'Soul 3' }
          ]
        },
        { harnessResolver: () => mock }
      );

      engine.initRoster();
      await engine.runRound();

      assert.equal(engine.state.phase, 'completed');
      assert.equal(engine.state.verdict?.kind, 'Dissent Report (Below Quorum)');
      assert.equal(engine.state.seats.filter((s) => s.status === 'excused').length, 2);
    });

    it('recovers deterministically when a concurrent voter votes with an invalid proof citation', async () => {
      const mock = new MockAdapter();

      for (const id of ['s1', 's2']) {
        mock.scriptSeatResponse({
          seatId: id,
          phase: 'DELIBERATION',
          response: async () => ({ scope: `Scope ${id}`, kind: 'check', source: `Source ${id}`, statement: `Statement ${id}` })
        });
      }

      mock.executeJudgeAuditAndSynthesis = async ({ proofs }) => ({
        summary: 'Synthesis',
        proofDecisions: { P1: { status: 'admitted' }, P2: { status: 'admitted' } },
        clauses: [{ text: 'Clause', citedProofIds: ['P1', 'P2'] }]
      });

      // s1 votes accept
      mock.scriptSeatResponse({
        seatId: 's1',
        phase: 'VOTING',
        response: async () => ({ vote: 'accept' })
      });

      // s2 attempts to object with invalid citation 'P999' on first try, then accepts on retry
      let s2VoteAttempts = 0;
      mock.scriptSeatResponse({
        seatId: 's2',
        phase: 'VOTING',
        response: async () => {
          s2VoteAttempts++;
          if (s2VoteAttempts === 1) {
            return { vote: 'object', reason: 'Invalid citation objection', proofId: 'P999' };
          }
          return { vote: 'accept' };
        }
      });

      const engine = new CouncilEngine(
        {
          topic: 'Invalid Citation Voting Recovery',
          maxConcurrentSeats: 2,
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          judge: { id: 'judge', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'mock', model: 'mock-model', soul: 'Soul 1' },
            { id: 's2', harness: 'mock', model: 'mock-model', soul: 'Soul 2' }
          ]
        },
        { harnessResolver: () => mock }
      );

      engine.initRoster();
      await engine.runRound();

      assert.equal(s2VoteAttempts, 2, 'Seat 2 should have been retried after invalid citation');
      assert.equal(engine.state.verdict?.kind, 'Unanimous Consensus');
    });
  });
});

