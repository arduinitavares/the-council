import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CouncilEngine } from '../../src/engine/council-engine.js';
import { MockAdapter } from '../../src/harness/mock.js';
import { QuotaExhaustionError } from '../../src/harness/adapter.js';
import { createInitialCouncilState } from '../../src/machine/state.js';
import { transitionCouncil } from '../../src/machine/reducer.js';
import { buildRunTelemetryRecord } from '../../src/telemetry/ledger.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Issue #95: Quorum-collapse conservation & terminal thinking settlement', () => {
  describe('(a) Deliberation pre-collapse conservation', () => {
    for (const maxRetriesPerSeat of [1, 0]) {
      it(`conserves Wave-1 proofs P1, P2 in strict roster order when Seats 3 & 4 exhaust retries (maxRetriesPerSeat=${maxRetriesPerSeat})`, async () => {
        const mockHarness = new MockAdapter();
        mockHarness.executeSeatProof = async (ctx) => {
          if (ctx.seat.id === 's3' || ctx.seat.id === 's4') {
            throw new QuotaExhaustionError(`Quota exhausted on ${ctx.seat.id}`);
          }
          return {
            scope: `Scope ${ctx.seat.id}`,
            kind: 'check',
            source: `Source ${ctx.seat.id}`,
            statement: `Proof from ${ctx.seat.id}`
          };
        };

        const engine = new CouncilEngine(
          {
            topic: 'Deliberation conservation on quorum collapse',
            maxRounds: 2,
            minQuorum: 3,
            maxRetriesPerSeat,
            seats: [
              { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'S1' },
              { id: 's2', harness: 'mock', model: 'gemini-4-argon-high', soul: 'S2' },
              { id: 's3', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'S3' },
              { id: 's4', harness: 'mock', model: 'grok-4.7-high', soul: 'S4' }
            ]
          },
          { harnessResolver: () => mockHarness }
        );

        const transitions = [];
        const proofEvents = [];
        engine.getTelemetry().on('state_transition', (snap) => {
          transitions.push({
            type: snap.event.type,
            seatId: snap.event.seatId,
            phase: snap.state.phase
          });
        });
        engine.getTelemetry().on('proof_submitted', (evt) => {
          proofEvents.push(evt.proof);
        });

        const result = await engine.run();

        assert.equal(result.state.phase, 'completed');
        assert.equal(result.state.verdict?.kind, 'Dissent Report (Below Quorum)');
        assert.deepEqual(
          result.state.proofs.map((p) => ({ id: p.id, seatId: p.seatId })),
          [
            { id: 'P1', seatId: 's1' },
            { id: 'P2', seatId: 's2' }
          ]
        );
        assert.deepEqual(
          proofEvents.map((p) => ({ id: p.id, seatId: p.seatId })),
          [
            { id: 'P1', seatId: 's1' },
            { id: 'P2', seatId: 's2' }
          ]
        );

        const byId = Object.fromEntries(result.state.seats.map((s) => [s.id, s]));
        assert.equal(byId.s1.status, 'proof_submitted');
        assert.equal(byId.s2.status, 'proof_submitted');
        assert.equal(byId.s3.status, 'excused');
        assert.equal(byId.s4.status, 'excused');
        assert.equal(
          result.state.seats.some((s) => s.status === 'thinking'),
          false,
          'Zero seats may remain in status thinking'
        );
        assert.notEqual(result.state.judge.status, 'thinking', 'Judge must not remain in status thinking');

        const completedIdx = transitions.findIndex((t) => t.phase === 'completed');
        assert.notEqual(completedIdx, -1);
        assert.equal(
          transitions.slice(completedIdx + 1).some((t) => t.type === 'SUBMIT_PROOF' || t.type === 'EXCUSE_SEAT'),
          false,
          'Zero SUBMIT_PROOF or EXCUSE_SEAT transitions after completed'
        );

        const ledger = buildRunTelemetryRecord({
          runId: `issue-95-delib-${maxRetriesPerSeat}`,
          state: result.state,
          snapshots: result.snapshots
        });
        const ledgerById = Object.fromEntries(ledger.seats.map((s) => [s.seatId, s]));
        assert.equal(ledgerById.s1.status, 'proof_submitted');
        assert.equal(ledgerById.s1.proofsSubmitted, 1);
        assert.equal(ledgerById.s2.status, 'proof_submitted');
        assert.equal(ledgerById.s2.proofsSubmitted, 1);
        assert.equal(ledgerById.s3.status, 'excused');
        assert.equal(ledgerById.s4.status, 'excused');
      });
    }
  });

  describe('(b) Voting pre-collapse conservation', () => {
    for (const maxRetriesPerSeat of [1, 0]) {
      it(`conserves Wave-1 object/accept votes and O1 in unresolvedObjections when Seats 3 & 4 exhaust retries (maxRetriesPerSeat=${maxRetriesPerSeat})`, async () => {
        const mockHarness = new MockAdapter();
        mockHarness.executeSeatProof = async (ctx) => ({
          scope: `Scope ${ctx.seat.id}`,
          kind: 'check',
          source: `Source ${ctx.seat.id}`,
          statement: `Proof from ${ctx.seat.id}`
        });
        mockHarness.executeJudgeAuditAndSynthesis = async () => ({
          summary: 'Candidate',
          clauses: [
            { id: 'C1', context: 'All', conclusion: 'Hold', citedProofIds: ['P1', 'P2', 'P3', 'P4'] }
          ],
          proofDecisions: {
            P1: { status: 'admitted', note: 'OK' },
            P2: { status: 'admitted', note: 'OK' },
            P3: { status: 'admitted', note: 'OK' },
            P4: { status: 'admitted', note: 'OK' }
          }
        });
        mockHarness.executeSeatVote = async (ctx) => {
          if (ctx.seat.id === 's1') {
            return { vote: 'object', reason: 'Counterexample backed by P1', proofId: 'P1' };
          }
          if (ctx.seat.id === 's2') {
            return { vote: 'accept' };
          }
          throw new QuotaExhaustionError(`Voting quota exhausted on ${ctx.seat.id}`);
        };

        const engine = new CouncilEngine(
          {
            topic: 'Voting conservation on quorum collapse',
            maxRounds: 2,
            minQuorum: 3,
            maxRetriesPerSeat,
            seats: [
              { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'S1' },
              { id: 's2', harness: 'mock', model: 'gemini-4-argon-high', soul: 'S2' },
              { id: 's3', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'S3' },
              { id: 's4', harness: 'mock', model: 'grok-4.7-high', soul: 'S4' }
            ]
          },
          { harnessResolver: () => mockHarness }
        );

        const transitions = [];
        const voteEvents = [];
        const objectionEvents = [];
        engine.getTelemetry().on('state_transition', (snap) => {
          transitions.push({
            type: snap.event.type,
            seatId: snap.event.seatId,
            phase: snap.state.phase
          });
        });
        engine.getTelemetry().on('vote_cast', (evt) => voteEvents.push(evt));
        engine.getTelemetry().on('objection_raised', (evt) => objectionEvents.push(evt.objection));

        const result = await engine.run();

        assert.equal(result.state.phase, 'completed');
        assert.equal(result.state.verdict?.kind, 'Dissent Report (Below Quorum)');
        assert.deepEqual(
          result.state.objections.map((o) => ({ id: o.id, seatId: o.seatId, proofId: o.proofId, status: o.status })),
          [{ id: 'O1', seatId: 's1', proofId: 'P1', status: 'open' }]
        );
        assert.deepEqual(
          result.state.verdict.unresolvedObjections.map((o) => ({ id: o.id, seatId: o.seatId })),
          [{ id: 'O1', seatId: 's1' }]
        );
        assert.deepEqual(
          voteEvents.map((v) => ({ seatId: v.seatId, vote: v.vote })),
          [
            { seatId: 's1', vote: 'object' },
            { seatId: 's2', vote: 'accept' }
          ]
        );
        assert.deepEqual(
          objectionEvents.map((o) => ({ id: o.id, seatId: o.seatId })),
          [{ id: 'O1', seatId: 's1' }]
        );

        const byId = Object.fromEntries(result.state.seats.map((s) => [s.id, s]));
        assert.equal(byId.s1.status, 'objected');
        assert.equal(byId.s2.status, 'accepted');
        assert.equal(byId.s3.status, 'excused');
        assert.equal(byId.s4.status, 'excused');
        assert.equal(result.state.seats.some((s) => s.status === 'thinking'), false);
        assert.notEqual(result.state.judge.status, 'thinking');

        const completedIdx = transitions.findIndex((t) => t.phase === 'completed');
        assert.notEqual(completedIdx, -1);
        assert.equal(
          transitions.slice(completedIdx + 1).some((t) => t.type === 'CAST_VOTE' || t.type === 'EXCUSE_SEAT'),
          false,
          'Zero CAST_VOTE or EXCUSE_SEAT transitions after completed'
        );

        const ledger = buildRunTelemetryRecord({
          runId: `issue-95-vote-${maxRetriesPerSeat}`,
          state: result.state,
          snapshots: result.snapshots
        });
        const ledgerById = Object.fromEntries(ledger.seats.map((s) => [s.seatId, s]));
        assert.equal(ledgerById.s1.status, 'objected');
        assert.equal(ledgerById.s2.status, 'accepted');
        assert.equal(ledgerById.s3.status, 'excused');
        assert.equal(ledgerById.s4.status, 'excused');
      });
    }
  });

  describe('(c) Simultaneous faults & post-await internal abort conservation (minQuorum: 4)', () => {
    it('conserves resolved siblings before collapsing fault, skips second fault after completed, and settles thinking siblings to idle in Deliberation', async () => {
      const mockHarness = new MockAdapter();
      mockHarness.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 's1') {
          return { scope: 'S1', kind: 'check', source: 'Spec', statement: 'Fast sibling s1' };
        }
        if (ctx.seat.id === 's2') {
          // Resolves slightly after s3 triggers delibWaveController.abort(), ignoring signal
          await sleep(25);
          return { scope: 'S2', kind: 'check', source: 'Spec', statement: 'Late-resolved sibling s2' };
        }
        if (ctx.seat.id === 's3') {
          await sleep(5);
          const fatal = new Error('Fatal auth error on s3');
          fatal.isRetryable = false;
          throw fatal;
        }
        // s4: fails simultaneously before wave abort or waits and aborts
        await sleep(5);
        const fatal = new Error('Fatal auth error on s4');
        fatal.isRetryable = false;
        throw fatal;
      };

      const engine = new CouncilEngine(
        {
          topic: 'Simultaneous faults minQuorum 4 Deliberation',
          maxRounds: 1,
          minQuorum: 4,
          maxRetriesPerSeat: 1,
          seats: [
            { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'gemini-4-argon-high', soul: 'S2' },
            { id: 's3', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'S3' },
            { id: 's4', harness: 'mock', model: 'grok-4.7-high', soul: 'S4' }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      let faultCalls = 0;
      let faultCallsAfterCompleted = 0;
      const origHandleSeatFault = engine.handleSeatFault.bind(engine);
      engine.handleSeatFault = (seatId, err, opts) => {
        faultCalls += 1;
        if (engine.state.phase === 'completed') {
          faultCallsAfterCompleted += 1;
        }
        return origHandleSeatFault(seatId, err, opts);
      };

      const transitions = [];
      engine.getTelemetry().on('state_transition', (snap) => {
        transitions.push({ type: snap.event.type, phase: snap.state.phase });
      });

      const result = await engine.run();

      assert.equal(result.state.phase, 'completed');
      assert.equal(result.state.verdict?.kind, 'Dissent Report (Below Quorum)');
      assert.deepEqual(
        result.state.proofs.map((p) => ({ id: p.id, seatId: p.seatId })),
        [
          { id: 'P1', seatId: 's1' },
          { id: 'P2', seatId: 's2' }
        ],
        'Both fast s1 and already-resolved s2 (despite internal wave abort) must be conserved in roster order'
      );
      assert.equal(faultCalls, 1, 'Only the first collapsing fault may call handleSeatFault');
      assert.equal(faultCallsAfterCompleted, 0, 'Zero handleSeatFault calls after phase === completed');

      const byId = Object.fromEntries(result.state.seats.map((s) => [s.id, s]));
      assert.equal(byId.s1.status, 'proof_submitted');
      assert.equal(byId.s2.status, 'proof_submitted');
      assert.equal(byId.s3.status, 'excused');
      assert.equal(byId.s4.status, 'idle', 'Unprocessed sibling fault after quorum collapse settles from thinking to idle');
      assert.equal(result.state.seats.some((s) => s.status === 'thinking'), false);

      const completedIdx = transitions.findIndex((t) => t.phase === 'completed');
      assert.equal(
        transitions.slice(completedIdx + 1).length,
        0,
        'Zero state transitions allowed after phase === completed'
      );
    });

    it('settles signal-aborted thinking sibling to idle when simultaneous faults collapse quorum (minQuorum: 4)', async () => {
      const mockHarness = new MockAdapter();
      mockHarness.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 's1') {
          return { scope: 'S1', kind: 'check', source: 'Spec', statement: 'Valid s1' };
        }
        if (ctx.seat.id === 's2') {
          const sig = ctx.signal || ctx.context?.signal;
          return await new Promise((resolve, reject) => {
            const onAbort = () => {
              const err = new Error('Wave aborted');
              err.name = 'AbortError';
              reject(err);
            };
            if (sig?.aborted) return onAbort();
            sig?.addEventListener('abort', onAbort, { once: true });
            setTimeout(() => resolve({ scope: 'S2', kind: 'check', source: 'Spec', statement: 'Slow s2' }), 200);
          });
        }
        const fatal = new Error(`Fatal error on ${ctx.seat.id}`);
        fatal.isRetryable = false;
        throw fatal;
      };

      const engine = new CouncilEngine(
        {
          topic: 'Aborted thinking sibling settles to idle',
          maxRounds: 1,
          minQuorum: 4,
          maxRetriesPerSeat: 0,
          seats: [
            { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'gemini-4-argon-high', soul: 'S2' },
            { id: 's3', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'S3' },
            { id: 's4', harness: 'mock', model: 'grok-4.7-high', soul: 'S4' }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      const result = await engine.run();
      assert.equal(result.state.phase, 'completed');
      assert.equal(Boolean(result.aborted), false);
      assert.deepEqual(
        result.state.proofs.map((p) => ({ id: p.id, seatId: p.seatId })),
        [{ id: 'P1', seatId: 's1' }]
      );
      const byId = Object.fromEntries(result.state.seats.map((s) => [s.id, s]));
      assert.equal(byId.s1.status, 'proof_submitted');
      assert.equal(byId.s2.status, 'idle');
      assert.equal(byId.s3.status, 'excused');
      assert.equal(byId.s4.status, 'idle');
      assert.equal(result.state.seats.some((s) => s.status === 'thinking'), false);
    });

    it('continues flushing remaining valid Voting slots without retrying when a commit-time guard rejects slot 0 during pre-collapse flush', async () => {
      const mockHarness = new MockAdapter();
      mockHarness.executeSeatProof = async (ctx) => ({
        scope: 'S',
        kind: 'check',
        source: 'Spec',
        statement: `Proof ${ctx.seat.id}`
      });
      mockHarness.executeJudgeAuditAndSynthesis = async () => ({
        summary: 'Candidate',
        clauses: [{ id: 'C1', context: 'S', conclusion: 'Hold', citedProofIds: ['P1', 'P2', 'P3', 'P4'] }],
        proofDecisions: {
          P1: { status: 'admitted', note: 'OK' },
          P2: { status: 'admitted', note: 'OK' },
          P3: { status: 'admitted', note: 'OK' },
          P4: { status: 'admitted', note: 'OK' }
        }
      });

      let s1VoteCalls = 0;
      mockHarness.executeSeatVote = async (ctx) => {
        if (ctx.seat.id === 's1') {
          s1VoteCalls += 1;
          return { vote: 'accept' };
        }
        if (ctx.seat.id === 's2') {
          // Resolves after s3 triggers voteWaveController.abort()
          await sleep(25);
          return { vote: 'object', reason: 'Critical flaw', proofId: 'P2' };
        }
        await sleep(5);
        const fatal = new Error(`Fatal voting error on ${ctx.seat.id}`);
        fatal.isRetryable = false;
        throw fatal;
      };

      const engine = new CouncilEngine(
        {
          topic: 'Pre-collapse Voting flush with commit-time guard rejection',
          maxRounds: 1,
          minQuorum: 4,
          maxRetriesPerSeat: 1,
          seats: [
            { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'gemini-4-argon-high', soul: 'S2' },
            { id: 's3', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'S3' },
            { id: 's4', harness: 'mock', model: 'grok-4.7-high', soul: 'S4' }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      // Inject a commit-time CAST_VOTE rejection on s1 during flush (not during dry-run validateVoteWave)
      const origStep = engine._step.bind(engine);
      let rejectedS1VoteOnce = false;
      engine._step = (event, throwOnError) => {
        if (event.type === 'CAST_VOTE' && event.seatId === 's1' && !rejectedS1VoteOnce) {
          rejectedS1VoteOnce = true;
          engine.state = {
            ...engine.state,
            lastTransition: { ok: false, message: 'Injected commit-time CAST_VOTE rejection on s1' }
          };
          return engine.state;
        }
        return origStep(event, throwOnError);
      };

      let faultCalls = 0;
      const origHandleSeatFault = engine.handleSeatFault.bind(engine);
      engine.handleSeatFault = (seatId, err, opts) => {
        faultCalls += 1;
        assert.notEqual(engine.state.phase, 'completed', 'handleSeatFault must never run after completed');
        return origHandleSeatFault(seatId, err, opts);
      };

      const result = await engine.run();

      assert.equal(result.state.phase, 'completed');
      assert.equal(result.state.verdict?.kind, 'Dissent Report (Below Quorum)');
      assert.equal(s1VoteCalls, 1, 'No retry wave may start when commit-time guard rejects during pre-collapse flush');
      assert.equal(faultCalls, 1, 'Only the first collapsing fault calls handleSeatFault');
      assert.deepEqual(
        result.state.objections.map((o) => ({ id: o.id, seatId: o.seatId, proofId: o.proofId })),
        [{ id: 'O1', seatId: 's2', proofId: 'P2' }],
        'Remaining valid slot s2 must still be flushed and conserved in verdict.unresolvedObjections'
      );
      assert.deepEqual(
        result.state.verdict.unresolvedObjections.map((o) => ({ id: o.id, seatId: o.seatId })),
        [{ id: 'O1', seatId: 's2' }]
      );

      const byId = Object.fromEntries(result.state.seats.map((s) => [s.id, s]));
      assert.equal(byId.s1.status, 'idle');
      assert.equal(byId.s2.status, 'objected');
      assert.equal(byId.s3.status, 'excused');
      assert.equal(byId.s4.status, 'idle');
      assert.equal(result.state.seats.some((s) => s.status === 'thinking'), false);
    });
  });

  describe('(d) Blind retry prompts & strict roster ordering when quorum holds', () => {
    it('keeps retry prompts blind to sibling current-round proofs/votes and preserves P1..Pn / O1..On roster order', async () => {
      const mockHarness = new MockAdapter();
      const observedDelibProofsOnRetry = [];
      const observedVoteObjectionsOnRetry = [];

      let s1DelibAttempt = 0;
      mockHarness.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 's1') {
          s1DelibAttempt += 1;
          if (s1DelibAttempt === 1) {
            throw new QuotaExhaustionError('Transient 429 on s1 proof');
          }
          observedDelibProofsOnRetry.push(ctx.state.proofs.filter((p) => p.round === ctx.round).length);
        }
        return {
          scope: `Scope ${ctx.seat.id}`,
          kind: 'check',
          source: `Source ${ctx.seat.id}`,
          statement: `Proof ${ctx.seat.id}`
        };
      };

      mockHarness.executeJudgeAuditAndSynthesis = async () => ({
        summary: 'Candidate',
        clauses: [{ id: 'C1', context: 'All', conclusion: 'Hold', citedProofIds: ['P1', 'P2', 'P3'] }],
        proofDecisions: {
          P1: { status: 'admitted', note: 'OK' },
          P2: { status: 'admitted', note: 'OK' },
          P3: { status: 'admitted', note: 'OK' }
        }
      });

      let s1VoteAttempt = 0;
      mockHarness.executeSeatVote = async (ctx) => {
        if (ctx.seat.id === 's1') {
          s1VoteAttempt += 1;
          if (s1VoteAttempt === 1) {
            throw new QuotaExhaustionError('Transient 429 on s1 vote');
          }
          observedVoteObjectionsOnRetry.push(ctx.state.objections.filter((o) => o.round === ctx.round).length);
          return { vote: 'object', reason: 'S1 objects', proofId: 'P1' };
        }
        if (ctx.seat.id === 's2') {
          return { vote: 'object', reason: 'S2 objects', proofId: 'P2' };
        }
        return { vote: 'object', reason: 'S3 objects', proofId: 'P3' };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Blind retry + roster order',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 2,
          seats: [
            { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'gemini-4-argon-high', soul: 'S2' },
            { id: 's3', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'S3' }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      const result = await engine.run();

      assert.deepEqual(observedDelibProofsOnRetry, [0], 'Retrying s1 must not observe Wave-1 sibling proofs');
      assert.deepEqual(observedVoteObjectionsOnRetry, [0], 'Retrying s1 must not observe Wave-1 sibling objections');
      assert.deepEqual(
        result.state.proofs.map((p) => ({ id: p.id, seatId: p.seatId })),
        [
          { id: 'P1', seatId: 's1' },
          { id: 'P2', seatId: 's2' },
          { id: 'P3', seatId: 's3' }
        ]
      );
      assert.deepEqual(
        result.state.objections.map((o) => ({ id: o.id, seatId: o.seatId })),
        [
          { id: 'O1', seatId: 's1' },
          { id: 'O2', seatId: 's2' },
          { id: 'O3', seatId: 's3' }
        ]
      );
    });
  });

  describe('(e) External AbortError cancellation', () => {
    it('preserves no-commit exit on external AbortController cancellation even when a sibling already resolved', async () => {
      const ac = new AbortController();
      const mockHarness = new MockAdapter();
      mockHarness.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 's1') {
          return { scope: 'S1', kind: 'check', source: 'Spec', statement: 'Fast s1' };
        }
        if (ctx.seat.id === 's2') {
          await sleep(10);
          ac.abort(new Error('External cancel'));
          const err = new Error('External cancel');
          err.name = 'AbortError';
          throw err;
        }
        await sleep(50);
        return { scope: 'S3', kind: 'check', source: 'Spec', statement: 'Slow s3' };
      };

      const engine = new CouncilEngine(
        {
          topic: 'External abort no-commit',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 2,
          seats: [
            { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'gemini-4-argon-high', soul: 'S2' },
            { id: 's3', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'S3' }
          ]
        },
        { harnessResolver: () => mockHarness, signal: ac.signal }
      );

      const transitions = [];
      engine.getTelemetry().on('state_transition', (snap) => transitions.push(snap.event.type));

      const result = await engine.run();
      assert.equal(result.aborted, true);
      assert.equal(result.state.proofs.length, 0);
      assert.equal(transitions.includes('SUBMIT_PROOF'), false);
    });
  });

  describe('(f) Direct transitionCouncil terminal normalization', () => {
    function buildBaseState() {
      let state = createInitialCouncilState({
        topic: 'Direct reducer terminal normalization',
        minQuorum: 3,
        maxRounds: 1,
        maxRetriesPerSeat: 1,
        seats: [
          { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'S1' },
          { id: 's2', harness: 'mock', model: 'gemini-4-argon-high', soul: 'S2' },
          { id: 's3', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'S3' },
          { id: 's4', harness: 'mock', model: 'grok-4.7-high', soul: 'S4' },
          { id: 's5', harness: 'mock', model: 'composer-2.5', soul: 'S5' }
        ]
      });
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      return state;
    }

    it('normalizes thinking participants on EXCUSE_SEAT below minQuorum while preserving proof_submitted, excused, and fault* statuses', () => {
      let state = buildBaseState();
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's1',
        scope: 'S1',
        kind: 'check',
        source: 'Spec',
        statement: 'Valid proof'
      });
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 's5', reason: 'Earlier fault' });
      // Inject transient thinking + fault metadata on s2, fault_quota on s3, thinking on judge
      state = {
        ...state,
        judge: { ...state.judge, status: 'thinking', faultReason: 'stale', errorClass: 'TimeoutError' },
        seats: state.seats.map((s) => {
          if (s.id === 's2') return { ...s, status: 'thinking', faultReason: 'stale', errorClass: 'TimeoutError' };
          if (s.id === 's3') return { ...s, status: 'fault_quota', faultReason: '429', errorClass: 'QuotaExhaustionError' };
          return s;
        })
      };

      // Excusing s4 drops active seats from 4 to 3? Wait: 5 total, s5 excused -> 4 active, excuse s4 -> 3; need minQuorum 4 or excuse s3+s4
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 's4', reason: 'Fault s4' });
      assert.equal(state.phase, 'reviewing');

      // Now 3 active (s1, s2, s3), minQuorum 3. Excusing s2... wait: let's keep s2 thinking and excuse s4 when active=3, minQuorum=3
      let collapseState = { ...state, minQuorum: 4 };
      // Currently active: s1 (proof_submitted), s2 (thinking), s3 (fault_quota); excused: s4, s5 -> wait active=3 < 4
      // Reset to 4 active with minQuorum=4 so excusing s4 collapses!
      let ready = buildBaseState();
      ready = transitionCouncil(ready, {
        type: 'SUBMIT_PROOF',
        seatId: 's1',
        scope: 'S1',
        kind: 'check',
        source: 'Spec',
        statement: 'Valid proof'
      });
      ready = transitionCouncil(ready, { type: 'EXCUSE_SEAT', seatId: 's5', reason: 'Earlier fault' });
      ready = {
        ...ready,
        minQuorum: 4,
        judge: { ...ready.judge, status: 'thinking', faultReason: 'stale', errorClass: 'TimeoutError' },
        seats: ready.seats.map((s) => {
          if (s.id === 's2') return { ...s, status: 'thinking', faultReason: 'stale', errorClass: 'TimeoutError' };
          if (s.id === 's3') return { ...s, status: 'fault_quota', faultReason: '429', errorClass: 'QuotaExhaustionError' };
          return s;
        })
      };

      const completed = transitionCouncil(ready, { type: 'EXCUSE_SEAT', seatId: 's4', reason: 'Collapsed quorum' });
      assert.equal(completed.phase, 'completed');
      assert.equal(completed.verdict?.kind, 'Dissent Report (Below Quorum)');

      const byId = Object.fromEntries(completed.seats.map((s) => [s.id, s]));
      assert.equal(byId.s1.status, 'proof_submitted');
      assert.equal(byId.s2.status, 'idle');
      assert.equal(byId.s2.faultReason, undefined);
      assert.equal(byId.s2.errorClass, undefined);
      assert.equal(byId.s3.status, 'fault_quota');
      assert.equal(byId.s3.faultReason, '429');
      assert.equal(byId.s4.status, 'excused');
      assert.equal(byId.s5.status, 'excused');
      assert.equal(completed.judge.status, 'idle');
      assert.equal(completed.judge.faultReason, undefined);
      assert.equal(completed.judge.errorClass, undefined);

      const ledger = buildRunTelemetryRecord({ runId: 'direct-excuse', state: completed });
      const ledgerById = Object.fromEntries(ledger.seats.map((s) => [s.seatId, s]));
      assert.equal(ledgerById.s1.status, 'proof_submitted');
      assert.equal(ledgerById.s2.status, 'idle');
      assert.equal(ledgerById.s3.status, 'fault_quota');
      assert.equal(ledgerById.s4.status, 'excused');
    });

    it('normalizes thinking seats on terminal JUDGE_FAULT while preserving judge fault status and non-thinking seat statuses', () => {
      let state = buildBaseState();
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's1',
        scope: 'S1',
        kind: 'check',
        source: 'Spec',
        statement: 'Valid proof'
      });
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 's5', reason: 'Excused' });
      state = transitionCouncil(state, { type: 'START_JUDGING' });
      state = {
        ...state,
        seats: state.seats.map((s) =>
          s.id === 's3' ? { ...s, status: 'fault_timeout', faultReason: 'Timeout', errorClass: 'TimeoutError' } : s
        )
      };

      const completed = transitionCouncil(state, {
        type: 'JUDGE_FAULT',
        status: 'fault_quota',
        errorClass: 'QuotaExhaustionError',
        reason: 'Judge 429',
        terminal: true
      });

      assert.equal(completed.phase, 'completed');
      assert.equal(completed.verdict?.kind, 'Dissent Report (Judge Fault)');
      assert.equal(completed.judge.status, 'fault_quota');
      assert.equal(completed.judge.faultReason, 'Judge 429');

      const byId = Object.fromEntries(completed.seats.map((s) => [s.id, s]));
      assert.equal(byId.s1.status, 'proof_submitted');
      assert.equal(byId.s2.status, 'idle');
      assert.equal(byId.s3.status, 'fault_timeout');
      assert.equal(byId.s4.status, 'idle');
      assert.equal(byId.s5.status, 'excused');
      assert.equal(completed.seats.some((s) => s.status === 'thinking'), false);

      const ledger = buildRunTelemetryRecord({ runId: 'direct-judge-fault', state: completed });
      const ledgerById = Object.fromEntries(ledger.seats.map((s) => [s.seatId, s]));
      assert.equal(ledgerById.s2.status, 'idle');
      assert.equal(ledgerById.s3.status, 'fault_timeout');
    });

    it('normalizes thinking judge/seats on terminal EVALUATE_ROUND while preserving accepted, objected, and excused statuses', () => {
      let state = createInitialCouncilState({
        topic: 'Terminal EVALUATE_ROUND normalization',
        minQuorum: 2,
        maxRounds: 1,
        seats: [
          { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'S1' },
          { id: 's2', harness: 'mock', model: 'gemini-4-argon-high', soul: 'S2' },
          { id: 's3', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'S3' }
        ]
      });
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's1',
        scope: 'S1',
        kind: 'check',
        source: 'Spec',
        statement: 'P1'
      });
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 's3', reason: 'Faulted' });
      state = transitionCouncil(state, { type: 'START_JUDGING' });
      state = transitionCouncil(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        summary: 'Candidate',
        proofDecisions: { P1: { status: 'admitted', note: 'OK' } },
        clauses: [{ id: 'C1', context: 'S1', conclusion: 'Hold', citedProofIds: ['P1'] }]
      });
      state = transitionCouncil(state, { type: 'CAST_VOTE', seatId: 's1', vote: 'accept' });
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 's2',
        vote: 'object',
        reason: 'Still open',
        proofId: 'P1'
      });
      // Simulate stale thinking status on judge before EVALUATE_ROUND completes
      state = {
        ...state,
        judge: { ...state.judge, status: 'thinking' }
      };

      const completed = transitionCouncil(state, { type: 'EVALUATE_ROUND' });
      assert.equal(completed.phase, 'completed');
      assert.equal(completed.verdict?.kind, 'Dissent Report (Round Limit Reached)');
      assert.equal(completed.judge.status, 'idle');

      const byId = Object.fromEntries(completed.seats.map((s) => [s.id, s]));
      assert.equal(byId.s1.status, 'accepted');
      assert.equal(byId.s2.status, 'objected');
      assert.equal(byId.s3.status, 'excused');
      assert.equal(completed.seats.some((s) => s.status === 'thinking'), false);

      const ledger = buildRunTelemetryRecord({ runId: 'direct-eval', state: completed });
      const ledgerById = Object.fromEntries(ledger.seats.map((s) => [s.seatId, s]));
      assert.equal(ledgerById.s1.status, 'accepted');
      assert.equal(ledgerById.s2.status, 'objected');
      assert.equal(ledgerById.s3.status, 'excused');
    });
  });
});
