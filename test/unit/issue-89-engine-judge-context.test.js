import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateConfig, resolveConfig } from '../../src/engine/config.js';
import {
  resolveVotingSeatConfig,
  resolveRebuttalSeatConfig,
  CouncilEngine
} from '../../src/engine/council-engine.js';
import { createInitialCouncilState } from '../../src/machine/state.js';
import { transitionCouncil } from '../../src/machine/reducer.js';
import { formatJudgePrompt } from '../../src/seats/soul.js';
import { CodexAdapter } from '../../src/harness/codex.js';
import { MockAdapter } from '../../src/harness/mock.js';
import { TimeoutError } from '../../src/harness/adapter.js';
import * as cliModule from '../../src/cli/index.js';

function createTestIo(extra = {}) {
  let out = '';
  let err = '';
  let exitCode = null;
  return {
    stdout: {
      write(chunk) {
        out += String(chunk);
        return true;
      }
    },
    stderr: {
      write(chunk) {
        err += String(chunk);
        return true;
      }
    },
    exit(code) {
      exitCode = code;
      return code;
    },
    registerSignalHandlers: false,
    getStdout: () => out,
    getStderr: () => err,
    getExitCode: () => exitCode,
    ...extra
  };
}

describe('Issue #89: Engine Judge Context, Cancellation Forwarding, Phase Timeouts & Guard Hardening', () => {
  // ==========================================================================
  // CRITERION 1: Round 2+ Judge Context & Prior-Proof Immutability
  // ==========================================================================
  describe('Criterion 1: Round 2+ Judge Context & Prior-Proof Immutability', () => {
    it('omits prior-round context in Round 1 and includes Previous Candidate, Unresolved Open Objections, and Prior-Round Admitted Proofs in Round 2+', () => {
      const r1State = {
        round: 1,
        maxRounds: 3,
        topic: 'Distributed consensus lease design',
        candidate: null,
        objections: [],
        proofs: [
          {
            id: 'P1',
            round: 1,
            seatId: 'seat-1',
            kind: 'check',
            scope: 'Cloud',
            statement: 'Fencing tokens prevent split-brain writes.',
            source: 'Martin Kleppmann DDIA',
            status: 'pending'
          }
        ]
      };

      const r1Prompt = formatJudgePrompt({
        judge: { id: 'judge-1', model: 'gpt-6-astra (max)', soul: 'Impartial Proof Auditor' },
        topic: r1State.topic,
        round: 1,
        proofs: r1State.proofs,
        state: r1State
      });

      assert.equal(r1Prompt.includes('Previous Candidate'), false);
      assert.equal(r1Prompt.includes('Unresolved Open Objections'), false);
      assert.equal(r1Prompt.includes('Prior-Round Admitted Proofs'), false);

      const r2State = {
        round: 2,
        maxRounds: 3,
        topic: 'Distributed consensus lease design',
        candidate: {
          round: 1,
          summary: 'Use monotonic fencing tokens on every storage write.',
          clauses: [
            {
              id: 'C1',
              context: 'Cloud Storage Nodes',
              conclusion: 'Enforce monotonic fencing token validation at storage target.',
              citedProofIds: ['P1']
            }
          ]
        },
        objections: [
          {
            id: 'O1',
            round: 1,
            seatId: 'seat-2',
            proofId: 'P1',
            reason: 'Missing lease clock drift bound under network partition.',
            status: 'open'
          },
          {
            id: 'O2',
            round: 1,
            seatId: 'seat-1',
            proofId: 'P1',
            reason: 'Already resolved formatting note.',
            status: 'resolved'
          },
          {
            id: 'O3',
            round: 1,
            seatId: 'seat-3',
            proofId: 'P1',
            reason: 'Locked excused-seat NVMe flush latency constraint.',
            status: 'preserved_excused'
          }
        ],
        proofs: [
          {
            id: 'P1',
            round: 1,
            seatId: 'seat-1',
            kind: 'check',
            scope: 'Cloud Storage Nodes',
            statement: 'Fencing tokens prevent split-brain writes.',
            source: 'Martin Kleppmann DDIA',
            status: 'admitted',
            judgeNote: 'Verified in Round 1'
          },
          {
            id: 'P2',
            round: 2,
            seatId: 'seat-2',
            kind: 'derivation',
            scope: 'Lease Renewal',
            statement: 'Bounded monotonic clock drift requires 2x max network RTT margin.',
            source: 'Lease Drift Proof',
            status: 'pending'
          }
        ]
      };

      const r2Prompt = formatJudgePrompt({
        judge: { id: 'judge-1', model: 'gpt-6-astra (max)', soul: 'Impartial Proof Auditor' },
        topic: r2State.topic,
        round: 2,
        proofs: r2State.proofs.filter((p) => p.round === 2),
        state: r2State
      });

      assert.ok(
        r2Prompt.includes('Previous Candidate (Round 1)'),
        'Round 2 Judge prompt must include Previous Candidate (Round 1) section'
      );
      assert.ok(
        r2Prompt.includes('Use monotonic fencing tokens on every storage write.'),
        'Round 2 Judge prompt must include prior candidate summary'
      );
      assert.ok(
        r2Prompt.includes('C1') && r2Prompt.includes('P1'),
        'Round 2 Judge prompt must include prior clause C1 citing P1'
      );
      assert.ok(
        r2Prompt.includes('Unresolved Open Objections'),
        'Round 2 Judge prompt must include Unresolved Open Objections section'
      );
      assert.ok(
        r2Prompt.includes('O1') && r2Prompt.includes('Missing lease clock drift bound under network partition.'),
        'Round 2 Judge prompt must include open objection O1'
      );
      assert.ok(
        r2Prompt.includes('O3') && r2Prompt.includes('Locked excused-seat NVMe flush latency constraint.'),
        'Round 2 Judge prompt must include preserved_excused objection O3'
      );
      assert.equal(
        r2Prompt.includes('Already resolved formatting note.'),
        false,
        'Round 2 Judge prompt must exclude resolved objection O2'
      );
      assert.ok(
        r2Prompt.includes('Prior-Round Admitted Proofs'),
        'Round 2 Judge prompt must include Prior-Round Admitted Proofs section'
      );
      assert.ok(
        r2Prompt.includes('[P1]') && r2Prompt.includes('Fencing tokens prevent split-brain writes.'),
        'Round 2 Judge prompt must list prior admitted proof P1'
      );
      assert.match(
        r2Prompt,
        /do not re-audit|cannot be re-audited|already admitted|do not reject.*prior/i,
        'Round 2 Judge prompt must instruct Judge not to re-audit or reject settled prior-round proofs'
      );
    });

    it('keeps prior-round admitted proof status immutable during Round 2+ JUDGE_AUDIT_AND_SYNTHESIZE even if proofDecisions attempts to reject it', () => {
      let state = createInitialCouncilState({
        topic: 'Prior proof immutability check',
        minQuorum: 2,
        maxRounds: 3,
        judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
        seats: [
          { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Seat 1' },
          { id: 's2', harness: 'mock', model: 'gpt-6.1-sol (high)', soul: 'Seat 2' }
        ]
      });

      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's1',
        scope: 'Core',
        kind: 'check',
        source: 'Spec 1',
        statement: 'Round 1 verified fact'
      });
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's2',
        scope: 'Core',
        kind: 'check',
        source: 'Spec 2',
        statement: 'Round 1 secondary fact'
      });
      state = transitionCouncil(state, { type: 'START_JUDGING' });
      state = transitionCouncil(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        summary: 'Round 1 candidate summary',
        proofDecisions: {
          P1: { status: 'admitted', note: 'Verified in R1' },
          P2: { status: 'admitted', note: 'Verified in R1' }
        },
        clauses: [{ context: 'Core', conclusion: 'Initial conclusion', citedProofIds: ['P1'] }]
      });
      state = transitionCouncil(state, { type: 'CAST_VOTE', seatId: 's1', vote: 'accept' });
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 's2',
        vote: 'object',
        reason: 'Needs refinement',
        proofId: 'P2'
      });
      state = transitionCouncil(state, { type: 'EVALUATE_ROUND' });
      assert.equal(state.round, 2);

      // Submit Round 2 proof (P3)
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's2',
        scope: 'Refinement',
        kind: 'derivation',
        source: 'Spec 3',
        statement: 'Round 2 new proof statement'
      });
      state = transitionCouncil(state, { type: 'START_JUDGING' });

      // Judge attempts to flip P1 (round 1, admitted) to rejected while admitting P3 (round 2, pending)
      const next = transitionCouncil(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        summary: 'Round 2 synthesis preserving P1 and adding P3',
        proofDecisions: {
          P1: { status: 'rejected', note: 'Attempted retroactive flip' },
          P3: { status: 'admitted', note: 'Admitted in Round 2' }
        },
        clauses: [
          {
            context: 'Combined',
            conclusion: 'Updated conclusion citing both P1 and P3',
            citedProofIds: ['P1', 'P3']
          }
        ]
      });

      assert.equal(next.lastTransition.ok, true, `Expected transition to succeed: ${next.lastTransition.message}`);
      const p1After = next.proofs.find((p) => p.id === 'P1');
      const p3After = next.proofs.find((p) => p.id === 'P3');
      assert.equal(p1After.status, 'admitted', 'Prior-round proof P1 must remain admitted');
      assert.equal(p1After.judgeNote, 'Verified in R1', 'Prior-round proof P1 note must not be overwritten by rejection');
      assert.equal(p3After.status, 'admitted');
    });
  });

  // ==========================================================================
  // CRITERION 2: CouncilEngine Cancellation Forwarding & runCli Bounded Drain
  // ==========================================================================
  describe('Criterion 2: CouncilEngine Cancellation Forwarding & runCli Bounded Drain', () => {
    it('forwards signal (params.signal and params.context.signal) to executeSeatProof, executeJudgeAuditAndSynthesis, and executeSeatVote, and stops with 0 retries on abort', async () => {
      const observedSignals = {
        deliberation: [],
        judge: [],
        voting: []
      };

      const adapter = {
        async executeSeatProof(params) {
          observedSignals.deliberation.push({
            topSignal: params.signal,
            contextSignal: params.context?.signal
          });
          return {
            scope: 'Sys',
            kind: 'check',
            source: 'Spec',
            statement: `Proof from ${params.seat.id}`
          };
        },
        async executeJudgeAuditAndSynthesis(params) {
          observedSignals.judge.push({
            topSignal: params.signal,
            contextSignal: params.context?.signal
          });
          return {
            summary: 'Synthesized candidate',
            proofDecisions: {
              P1: { status: 'admitted', note: 'ok' },
              P2: { status: 'admitted', note: 'ok' }
            },
            clauses: [{ context: 'Sys', conclusion: 'Adopt spec', citedProofIds: ['P1', 'P2'] }]
          };
        },
        async executeSeatVote(params) {
          observedSignals.voting.push({
            topSignal: params.signal,
            contextSignal: params.context?.signal
          });
          return { vote: 'accept' };
        }
      };

      const controller = new AbortController();
      const engine = new CouncilEngine(
        {
          topic: 'Signal forwarding verification',
          maxRounds: 1,
          minQuorum: 2,
          judge: { id: 'judge', harness: 'custom', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'custom', model: 'gpt-6-astra (max)', soul: 'Seat 1' },
            { id: 's2', harness: 'custom', model: 'gpt-6.1-sol (high)', soul: 'Seat 2' }
          ]
        },
        {
          signal: controller.signal,
          harnessResolver: () => adapter
        }
      );

      const res = await engine.run();
      assert.equal(res.ok, true);
      assert.equal(observedSignals.deliberation.length, 2);
      assert.equal(observedSignals.judge.length, 1);
      assert.equal(observedSignals.voting.length, 2);

      for (const entry of [
        ...observedSignals.deliberation,
        ...observedSignals.judge,
        ...observedSignals.voting
      ]) {
        assert.ok(entry.topSignal instanceof AbortSignal, 'params.signal must be an AbortSignal');
        assert.ok(entry.contextSignal instanceof AbortSignal, 'params.context.signal must be an AbortSignal');
      }

      // Now verify mid-call abort during executeSeatProof stops immediately with 0 retries
      const abortController = new AbortController();
      let adapterSawAbort = false;
      let proofCalls = 0;

      const abortingAdapter = {
        async executeSeatProof(params) {
          proofCalls += 1;
          const sig = params.signal || params.context?.signal;
          if (proofCalls === 1) {
            abortController.abort(new Error('User cancelled deliberation'));
          }
          if (sig?.aborted) {
            adapterSawAbort = true;
          }
          const err = new Error('Operation aborted');
          err.name = 'AbortError';
          throw err;
        },
        async executeJudgeAuditAndSynthesis() {
          throw new Error('Judge should not run after abort');
        },
        async executeSeatVote() {
          throw new Error('Voting should not run after abort');
        }
      };

      const abortEngine = new CouncilEngine(
        {
          topic: 'Mid-call abort test',
          maxRounds: 2,
          minQuorum: 2,
          maxRetriesPerSeat: 2,
          maxRetriesPerJudge: 2,
          judge: { id: 'judge', harness: 'custom', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'custom', model: 'gpt-6-astra (max)', soul: 'Seat 1' },
            { id: 's2', harness: 'custom', model: 'gpt-6.1-sol (high)', soul: 'Seat 2' }
          ]
        },
        {
          signal: abortController.signal,
          harnessResolver: () => abortingAdapter
        }
      );

      await abortEngine.run();
      assert.equal(abortEngine.aborted, true);
      assert.equal(adapterSawAbort, true, 'Adapter must observe aborted signal');
      for (const s of abortEngine.state.seats) {
        assert.equal(s.retries, 0, `Seat ${s.id} must not be retried on abort`);
      }
      assert.equal(abortEngine.state.judge.retries, 0, 'Judge must not be retried on abort');
    });

    it('aborts remaining in-flight seats in-wave immediately when non-retryable seat faults drop active seats below minQuorum', async () => {
      let s3SignalAborted = false;
      let s3Timer = null;

      const adapter = {
        async executeSeatProof(params) {
          if (params.seat.id === 's1' || params.seat.id === 's2') {
            const fatalErr = new Error(`Non-retryable auth failure on ${params.seat.id}`);
            fatalErr.isRetryable = false;
            throw fatalErr;
          }
          // Seat 3 waits for wave abort signal (with a 250ms fallback timer so RED test never hangs)
          const sig = params.context?.signal || params.signal;
          return await new Promise((resolve, reject) => {
            if (sig?.aborted) {
              s3SignalAborted = true;
              reject(new Error('Seat 3 aborted by wave controller'));
              return;
            }
            const onAbort = () => {
              s3SignalAborted = true;
              if (s3Timer) clearTimeout(s3Timer);
              reject(new Error('Seat 3 aborted by wave controller'));
            };
            if (sig && typeof sig.addEventListener === 'function') {
              sig.addEventListener('abort', onAbort, { once: true });
            }
            s3Timer = setTimeout(() => {
              if (sig && typeof sig.removeEventListener === 'function') {
                sig.removeEventListener('abort', onAbort);
              }
              resolve({
                scope: 'Slow',
                kind: 'check',
                source: 'Timer',
                statement: 'Seat 3 finished slow timer without wave abort'
              });
            }, 250);
          });
        }
      };

      const engine = new CouncilEngine(
        {
          topic: 'In-wave quorum drop cancellation',
          maxRounds: 2,
          minQuorum: 2,
          maxRetriesPerSeat: 2,
          judge: { id: 'judge', harness: 'custom', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'custom', model: 'gpt-6-astra (max)', soul: 'Seat 1' },
            { id: 's2', harness: 'custom', model: 'gpt-6.1-sol (high)', soul: 'Seat 2' },
            { id: 's3', harness: 'custom', model: 'gemini-4-argon-high', soul: 'Seat 3' }
          ]
        },
        { harnessResolver: () => adapter }
      );

      const t0 = Date.now();
      const result = await engine.run();
      const elapsedMs = Date.now() - t0;

      assert.equal(
        s3SignalAborted,
        true,
        'Seat 3 must receive an in-wave abort signal as soon as s1 and s2 non-retryable faults drop quorum below 2'
      );
      assert.ok(elapsedMs < 200, `Expected immediate wave abort (<200ms), took ${elapsedMs}ms`);
      assert.equal(result.state.phase, 'completed');
      assert.equal(result.verdict?.kind, 'Dissent Report (Below Quorum)');
    });

    it('grants engineRunPromise a bounded drain window on io.signal abort so adapter cleanup finishes before liveWatcher.stop finalizes latest.js', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-89-drain-'));
      try {
        const abortController = new AbortController();
        let adapterCleanupDone = false;
        let cleanupDoneBeforeWatcherStop = false;
        let stopCallCount = 0;

        const customWatcher = {
          outputDir: tmpDir,
          telemetryDir: tmpDir,
          attach() {},
          stop() {
            stopCallCount += 1;
            cleanupDoneBeforeWatcherStop = adapterCleanupDone;
          }
        };

        const customRegistry = {
          get() {
            return {
              validateModel() {},
              async executeSeatProof(params) {
                const sig = params.signal || params.context?.signal;
                setTimeout(() => abortController.abort(new Error('External abort')), 10);
                await new Promise((resolve) => {
                  if (sig?.aborted) {
                    resolve();
                    return;
                  }
                  if (sig && typeof sig.addEventListener === 'function') {
                    sig.addEventListener('abort', resolve, { once: true });
                  } else {
                    setTimeout(resolve, 30);
                  }
                });
                // Simulate async child process teardown during bounded drain window
                await new Promise((r) => setTimeout(r, 35));
                adapterCleanupDone = true;
                throw new Error('Aborted after async adapter cleanup');
              }
            };
          }
        };

        const io = createTestIo({
          signal: abortController.signal,
          harnessRegistry: customRegistry,
          liveWatcher: customWatcher,
          abortDrainMs: 250
        });

        const exitCode = await cliModule.runCli(
          ['run', '--live', '--topic', 'Bounded drain test', '--output-dir', tmpDir, '--telemetry-dir', tmpDir],
          io
        );

        assert.equal(exitCode, 2);
        assert.ok(stopCallCount >= 1, 'liveWatcher.stop must be called');
        assert.equal(
          cleanupDoneBeforeWatcherStop,
          true,
          'Adapter cleanup must complete during bounded drain window before liveWatcher.stop is invoked'
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // ==========================================================================
  // CRITERION 3: Bare-Model Effort Downshift, Explicit Phase Timeouts,
  //              --rebuttal-* CLI Flags & --live Preflight
  // ==========================================================================
  describe('Criterion 3: Bare-Model Effort Downshift, Explicit Phase Timeouts, CLI Flags & Preflight', () => {
    it('downshifts bare models in resolveVotingSeatConfig and passes context.reasoningEffort === "low" into executeSeatVote', async () => {
      const astraVote = resolveVotingSeatConfig({ id: 's1', harness: 'codex', model: 'gpt-6-astra' }, {});
      assert.equal(astraVote.reasoningEffort, 'low');

      const argonVote = resolveVotingSeatConfig({ id: 's2', harness: 'antigravity', model: 'gemini-4-argon' }, {});
      assert.equal(argonVote.reasoningEffort, 'low');

      const grokVote = resolveVotingSeatConfig({ id: 's3', harness: 'cursor', model: 'grok-4.7' }, {});
      assert.equal(grokVote.reasoningEffort, 'low');

      const composerVote = resolveVotingSeatConfig({ id: 's4', harness: 'cursor', model: 'composer-2.5' }, {});
      assert.equal(composerVote.reasoningEffort, undefined);

      const preservedVote = resolveVotingSeatConfig(
        { id: 's5', harness: 'codex', model: 'gpt-6-astra', preserveVotingEffort: true },
        {}
      );
      assert.equal(preservedVote.reasoningEffort, undefined);

      // Verify CouncilEngine forwards context.reasoningEffort === 'low' into executeSeatVote for bare 'gpt-6-astra'
      const voteContexts = [];
      const adapter = {
        async executeSeatProof(params) {
          return {
            scope: 'General',
            kind: 'check',
            source: 'Src',
            statement: `Stmt from ${params.seat.id}`
          };
        },
        async executeJudgeAuditAndSynthesis() {
          return {
            summary: 'Candidate summary',
            proofDecisions: {
              P1: { status: 'admitted', note: 'ok' },
              P2: { status: 'admitted', note: 'ok' }
            },
            clauses: [{ context: 'General', conclusion: 'Conclusion', citedProofIds: ['P1', 'P2'] }]
          };
        },
        async executeSeatVote(params) {
          voteContexts.push({
            seatId: params.seat.id,
            seatReasoningEffort: params.seat.reasoningEffort,
            contextReasoningEffort: params.context?.reasoningEffort
          });
          return { vote: 'accept' };
        }
      };

      const engine = new CouncilEngine(
        {
          topic: 'Bare model voting effort forwarding',
          maxRounds: 1,
          minQuorum: 2,
          judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'codex', model: 'gpt-6-astra', soul: 'Seat 1' },
            { id: 's2', harness: 'cursor', model: 'composer-2.5', soul: 'Seat 2' }
          ]
        },
        { harnessResolver: () => adapter }
      );

      await engine.run();
      const s1Vote = voteContexts.find((v) => v.seatId === 's1');
      const s2Vote = voteContexts.find((v) => v.seatId === 's2');
      assert.equal(s1Vote?.contextReasoningEffort, 'low');
      assert.equal(s2Vote?.contextReasoningEffort, undefined);
    });

    it('computes reasoningEffort for explicit rebuttalModel overrides in resolveRebuttalSeatConfig', () => {
      const bareAstraRebuttal = resolveRebuttalSeatConfig(
        { id: 's1', harness: 'codex', model: 'gpt-6.1-sol', rebuttalModel: 'gpt-6-astra' },
        {}
      );
      assert.equal(bareAstraRebuttal.reasoningEffort, 'medium');

      const lowSolRebuttal = resolveRebuttalSeatConfig(
        { id: 's1', harness: 'codex', model: 'gpt-6.1-sol', rebuttalModel: 'gpt-6.1-sol (low)' },
        {}
      );
      assert.equal(lowSolRebuttal.reasoningEffort, 'low');

      const composerRebuttal = resolveRebuttalSeatConfig(
        { id: 's1', harness: 'cursor', model: 'gpt-6.1-sol', rebuttalModel: 'composer-2.5' },
        {}
      );
      assert.equal(composerRebuttal.reasoningEffort, undefined);
    });

    it('honors explicit votingTimeoutMs and explicit rebuttalTimeoutMs above deliberation timeoutMs while clamping to totalSeatBudgetMs and clamping implicit defaults', () => {
      // 1. Explicit votingTimeoutMs: 120000 with deliberation timeoutMs: 60000 and totalSeatBudgetMs: 300000
      const cfgExplicitVote = resolveConfig({
        topic: 'Explicit voting timeout',
        seats: [
          {
            id: 's1',
            harness: 'codex',
            model: 'gpt-6-astra',
            soul: 'Seat 1',
            timeoutMs: 60000,
            votingTimeoutMs: 120000,
            totalSeatBudgetMs: 300000
          },
          {
            id: 's2',
            harness: 'codex',
            model: 'gpt-6.1-sol',
            soul: 'Seat 2',
            timeoutMs: 45000,
            totalSeatBudgetMs: 300000
          }
        ]
      });

      const resolvedVoteS1 = resolveVotingSeatConfig(cfgExplicitVote.seats[0], cfgExplicitVote);
      assert.equal(
        resolvedVoteS1.votingTimeoutMs,
        120000,
        'Explicit votingTimeoutMs (120000) must not be clamped down to deliberation timeoutMs (60000)'
      );

      // Implicit votingTimeoutMs (default 90000) still clamps down to seat timeoutMs (45000)
      const resolvedVoteS2 = resolveVotingSeatConfig(cfgExplicitVote.seats[1], cfgExplicitVote);
      assert.equal(
        resolvedVoteS2.votingTimeoutMs,
        45000,
        'Implicit default votingTimeoutMs (90000) must still clamp down to seat timeoutMs (45000)'
      );

      // Explicit votingTimeoutMs exceeding totalSeatBudgetMs still clamps to totalSeatBudgetMs
      const overBudgetVote = resolveVotingSeatConfig(
        {
          id: 's3',
          harness: 'codex',
          model: 'gpt-6-astra',
          soul: 'Seat 3',
          timeoutMs: 60000,
          votingTimeoutMs: 400000,
          totalSeatBudgetMs: 300000
        },
        {}
      );
      assert.equal(overBudgetVote.votingTimeoutMs, 300000);

      // 2. Explicit rebuttalTimeoutMs: 180000 with deliberation timeoutMs: 90000 and totalSeatBudgetMs: 300000
      const resolvedRebuttal = resolveRebuttalSeatConfig(
        {
          id: 's1',
          harness: 'codex',
          model: 'gpt-6-astra (max)',
          soul: 'Seat 1',
          timeoutMs: 90000,
          rebuttalTimeoutMs: 180000,
          totalSeatBudgetMs: 300000
        },
        {}
      );
      assert.equal(
        resolvedRebuttal.rebuttalTimeoutMs,
        180000,
        'Explicit rebuttalTimeoutMs (180000) must not be clamped down to deliberation timeoutMs (90000)'
      );
    });

    it('parses --rebuttal-* CLI flags via parseCliArgs & buildCliFlagsForConfig and rejects invalid --rebuttal-timeout abc with exit code 1', async () => {
      assert.equal(typeof cliModule.parseCliArgs, 'function', 'parseCliArgs must be exported from src/cli/index.js');
      assert.equal(
        typeof cliModule.buildCliFlagsForConfig,
        'function',
        'buildCliFlagsForConfig must be exported from src/cli/index.js'
      );

      const parsed = cliModule.parseCliArgs([
        '--rebuttal-timeout',
        '90000',
        '--preserve-rebuttal-effort',
        '--rebuttal-tools',
        'readonly',
        '--rebuttal-reasoning-effort',
        'low',
        '--rebuttal-model',
        'gpt-6-astra'
      ]);
      const overrides = cliModule.buildCliFlagsForConfig(parsed.values);
      assert.equal(overrides.rebuttalTimeoutMs, 90000);
      assert.equal(overrides.preserveRebuttalEffort, true);
      assert.equal(overrides.rebuttalTools, 'read-only');
      assert.equal(overrides.rebuttalReasoningEffort, 'low');
      assert.equal(overrides.rebuttalModel, 'gpt-6-astra');

      const badIo = createTestIo();
      const badCode = await cliModule.runCli(
        ['run', '--mock', '--topic', 'Invalid rebuttal timeout', '--rebuttal-timeout', 'abc'],
        badIo
      );
      assert.equal(badCode, 1);
      assert.match(badIo.getStderr(), /rebuttal-timeout/i);
    });

    it('validates seat votingModel and rebuttalModel during --live preflight before Round 1 starts', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-89-preflight-'));
      try {
        const badVotingConfigPath = path.join(tmpDir, 'bad-voting-model.json');
        fs.writeFileSync(
          badVotingConfigPath,
          JSON.stringify({
            topic: 'Live preflight votingModel validation',
            maxRounds: 1,
            minQuorum: 2,
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
            seats: [
              {
                id: 's1',
                harness: 'codex',
                model: 'gpt-6-astra',
                votingModel: 'not-a-real-codex-model',
                soul: 'Seat 1'
              },
              {
                id: 's2',
                harness: 'codex',
                model: 'gpt-6.1-sol',
                soul: 'Seat 2'
              }
            ]
          }),
          'utf8'
        );

        const realCodexAdapter = new CodexAdapter();
        let round1Started = false;
        const safeRegistry = {
          get() {
            return {
              validateModel(m) {
                return realCodexAdapter.validateModel(m);
              },
              async executeSeatProof() {
                round1Started = true;
                throw new Error('Round 1 should not start when votingModel is invalid');
              }
            };
          }
        };

        const ioVoting = createTestIo({ harnessRegistry: safeRegistry });
        const votingExit = await cliModule.runCli(['run', '--live', '--config', badVotingConfigPath], ioVoting);
        assert.equal(votingExit, 1, 'Expected exit code 1 for invalid votingModel in --live preflight');
        assert.equal(round1Started, false, 'Round 1 must not start when votingModel fails preflight');
        assert.match(ioVoting.getStderr(), /not-a-real-codex-model/);

        const badRebuttalConfigPath = path.join(tmpDir, 'bad-rebuttal-model.json');
        fs.writeFileSync(
          badRebuttalConfigPath,
          JSON.stringify({
            topic: 'Live preflight rebuttalModel validation',
            maxRounds: 2,
            minQuorum: 2,
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
            seats: [
              {
                id: 's1',
                harness: 'codex',
                model: 'gpt-6-astra',
                rebuttalModel: 'not-a-real-rebuttal-model',
                soul: 'Seat 1'
              },
              {
                id: 's2',
                harness: 'codex',
                model: 'gpt-6.1-sol',
                soul: 'Seat 2'
              }
            ]
          }),
          'utf8'
        );

        const ioRebuttal = createTestIo({ harnessRegistry: safeRegistry });
        const rebuttalExit = await cliModule.runCli(['run', '--live', '--config', badRebuttalConfigPath], ioRebuttal);
        assert.equal(rebuttalExit, 1, 'Expected exit code 1 for invalid rebuttalModel in --live preflight');
        assert.equal(round1Started, false, 'Round 1 must not start when rebuttalModel fails preflight');
        assert.match(ioRebuttal.getStderr(), /not-a-real-rebuttal-model/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // ==========================================================================
  // CRITERION 4: Proof-ID Stripping/Guard, Per-Round Judge Retries,
  //              Dynamic Seat Voting Config, backingProof Normalization
  // ==========================================================================
  describe('Criterion 4: Proof-ID Stripping/Guard, Per-Round Judge Retries, Dynamic Seat Voting & backingProof', () => {
    it('strips provider-supplied proofInput.id in CouncilEngine so state.proofs assigns canonical sequential IDs (P1, P2) and reducer rejects duplicate explicit proof IDs', async () => {
      const adapter = {
        async executeSeatProof(params) {
          return {
            id: params.seat.id === 's1' ? 'P999' : 'CUSTOM_ID',
            scope: 'Core',
            kind: 'check',
            source: 'Spec',
            statement: `Statement from ${params.seat.id}`
          };
        },
        async executeJudgeAuditAndSynthesis() {
          return {
            summary: 'Candidate summary',
            proofDecisions: {
              P1: { status: 'admitted', note: 'ok' },
              P2: { status: 'admitted', note: 'ok' }
            },
            clauses: [{ context: 'Core', conclusion: 'Valid', citedProofIds: ['P1', 'P2'] }]
          };
        },
        async executeSeatVote() {
          return { vote: 'accept' };
        }
      };

      const engine = new CouncilEngine(
        {
          topic: 'Strip provider proofInput.id',
          maxRounds: 1,
          minQuorum: 2,
          judge: { id: 'judge', harness: 'custom', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'custom', model: 'gpt-6-astra (max)', soul: 'Seat 1' },
            { id: 's2', harness: 'custom', model: 'gpt-6.1-sol (high)', soul: 'Seat 2' }
          ]
        },
        { harnessResolver: () => adapter }
      );

      const res = await engine.run();
      assert.equal(res.ok, true);
      assert.equal(res.state.proofs[0].id, 'P1');
      assert.equal(res.state.proofs[1].id, 'P2');

      // Direct reducer SUBMIT_PROOF duplicate explicit ID check
      let state = createInitialCouncilState({
        topic: 'Duplicate proof ID guard',
        minQuorum: 2,
        maxRounds: 2,
        judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
        seats: [
          { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Seat 1' },
          { id: 's2', harness: 'mock', model: 'gpt-6.1-sol (high)', soul: 'Seat 2' }
        ]
      });
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        id: 'P1',
        seatId: 's1',
        scope: 'Core',
        kind: 'check',
        source: 'Src 1',
        statement: 'First proof'
      });
      assert.equal(state.lastTransition.ok, true);

      const dupState = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        id: 'P1',
        seatId: 's2',
        scope: 'Core',
        kind: 'check',
        source: 'Src 2',
        statement: 'Duplicate ID proof'
      });
      assert.equal(dupState.lastTransition.ok, false, 'Reducer must reject duplicate explicit proof ID P1');
    });

    it('validates and preserves maxRetriesPerJudge and resets Judge retry count per round so Round 1 retry does not starve Round 2', async () => {
      const resolved = resolveConfig({
        topic: 'Judge retries config',
        maxRetriesPerJudge: 2
      });
      assert.equal(resolved.maxRetriesPerJudge, 2);

      const invalid = validateConfig({
        topic: 'Invalid judge retries',
        maxRounds: 2,
        minQuorum: 2,
        maxClarificationBatches: 1,
        maxRetriesPerSeat: 1,
        maxRetriesPerJudge: -1
      });
      assert.equal(invalid.valid, false);
      assert.ok(invalid.errors.some((e) => e.includes('maxRetriesPerJudge')));

      // 2-round CouncilEngine run with maxRetriesPerJudge: 1 where Judge fails once in Round 1 AND fails once in Round 2
      const judgeAttemptsByRound = { 1: 0, 2: 0 };
      const adapter = {
        async executeSeatProof(params) {
          return {
            scope: 'Core',
            kind: 'check',
            source: 'Spec',
            statement: `Proof R${params.round} from ${params.seat.id}`
          };
        },
        async executeJudgeAuditAndSynthesis(params) {
          judgeAttemptsByRound[params.round] = (judgeAttemptsByRound[params.round] || 0) + 1;
          if (judgeAttemptsByRound[params.round] === 1) {
            throw new TimeoutError(`Judge transient timeout in Round ${params.round}`, {
              harness: 'custom',
              seatId: 'judge',
              timeoutMs: 1000
            });
          }
          const roundProofIds = params.proofs.map((p) => p.id);
          const decisions = {};
          for (const pid of roundProofIds) {
            decisions[pid] = { status: 'admitted', note: 'ok' };
          }
          return {
            summary: `Candidate for Round ${params.round}`,
            proofDecisions: decisions,
            clauses: [{ context: 'Core', conclusion: `Conclusion R${params.round}`, citedProofIds: roundProofIds }]
          };
        },
        async executeSeatVote(params) {
          if (params.round === 1 && params.seat.id === 's1') {
            return { vote: 'object', reason: 'Need Round 2', proofId: 'P1' };
          }
          return { vote: 'accept' };
        }
      };

      const engine = new CouncilEngine(
        {
          topic: 'Per-round judge retry budget',
          maxRounds: 2,
          minQuorum: 2,
          maxRetriesPerSeat: 0,
          maxRetriesPerJudge: 1,
          judge: { id: 'judge', harness: 'custom', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'custom', model: 'gpt-6-astra (max)', soul: 'Seat 1' },
            { id: 's2', harness: 'custom', model: 'gpt-6.1-sol (high)', soul: 'Seat 2' }
          ]
        },
        { harnessResolver: () => adapter }
      );

      const runRes = await engine.run();
      assert.equal(runRes.ok, true, `Expected 2-round consensus after Judge retries in both rounds, got ${runRes.verdict?.kind}`);
      assert.equal(judgeAttemptsByRound[1], 2);
      assert.equal(judgeAttemptsByRound[2], 2);
    });

    it('applies dynamic seat voting overrides (votingModel, votingTools, votingTimeoutMs) added via ADD_SEAT and normalizes backingProof on object votes', async () => {
      const voteCalls = [];
      const adapter = {
        async executeSeatProof(params) {
          return {
            scope: 'Core',
            kind: 'check',
            source: 'Spec',
            statement: `Proof from ${params.seat.id}`
          };
        },
        async executeJudgeAuditAndSynthesis(params) {
          const decisions = {};
          for (const p of params.proofs) {
            decisions[p.id] = { status: 'admitted', note: 'ok' };
          }
          return {
            summary: 'Candidate summary',
            proofDecisions: decisions,
            clauses: [{ context: 'Core', conclusion: 'Conclusion', citedProofIds: params.proofs.map((p) => p.id) }]
          };
        },
        async executeSeatVote(params) {
          voteCalls.push({
            seatId: params.seat.id,
            model: params.seat.model,
            tools: params.tools,
            timeoutMs: params.timeoutMs
          });
          if (params.seat.id === 'dyn-1') {
            // Return backingProof instead of proofId to verify normalization
            return {
              vote: 'object',
              reason: 'Dynamic seat objection using backingProof field',
              backingProof: 'P1'
            };
          }
          return { vote: 'accept' };
        }
      };

      const engine = new CouncilEngine(
        {
          topic: 'Dynamic seat voting overrides and backingProof normalization',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 0,
          judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Seat 1' },
            { id: 's2', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'Seat 2' }
          ]
        },
        { harnessResolver: () => adapter }
      );

      engine.initRoster();
      engine._step({
        type: 'ADD_SEAT',
        seat: {
          id: 'dyn-1',
          harness: 'codex',
          model: 'gpt-6.1-sol',
          soul: 'Dynamic Voter',
          votingModel: 'gpt-6-astra',
          votingTools: 'readonly',
          votingTimeoutMs: 75000
        }
      });

      await engine.runRound();

      const dynVoteCall = voteCalls.find((c) => c.seatId === 'dyn-1');
      assert.ok(dynVoteCall, 'Dynamic seat dyn-1 must participate in voting');
      assert.equal(dynVoteCall.model, 'gpt-6-astra');
      assert.equal(dynVoteCall.tools, 'readonly');
      assert.equal(dynVoteCall.timeoutMs, 75000);

      // Verify backingProof: 'P1' was normalized to proofId: 'P1' so CAST_VOTE succeeded and registered the objection
      assert.equal(engine.state.objections.length, 1);
      assert.equal(engine.state.objections[0].seatId, 'dyn-1');
      assert.equal(engine.state.objections[0].proofId, 'P1');
      assert.equal(engine.state.objections[0].status, 'open');
    });

    it('propagates adapter-local AbortError in proof, Judge, and vote phases to terminate the run cleanly without consensus, voting, or EVALUATE_ROUND throws', async () => {
      const makeAbortErr = () => {
        const err = new Error('Adapter cancelled');
        err.name = 'AbortError';
        err.code = 'ABORT_ERR';
        return err;
      };

      for (const cancelPhase of ['proof', 'judge', 'vote']) {
        let judgeInvoked = false;
        let voteInvoked = false;
        const parentCtrl = new AbortController(); // remains un-aborted!
        const harness = {
          async executeSeatProof(params) {
            if (cancelPhase === 'proof' && params.seat.id === 's1') {
              throw makeAbortErr();
            }
            return { scope: 'Core', kind: 'check', source: 'Spec', statement: `Proof ${params.seat.id}` };
          },
          async executeJudgeAuditAndSynthesis(params) {
            judgeInvoked = true;
            if (cancelPhase === 'judge') {
              throw makeAbortErr();
            }
            const decisions = Object.fromEntries(params.proofs.map((p) => [p.id, { status: 'admitted', note: 'ok' }]));
            return {
              summary: 'Summary',
              proofDecisions: decisions,
              clauses: [{ context: 'Core', conclusion: 'Done', citedProofIds: [params.proofs[0].id] }]
            };
          },
          async executeSeatVote(params) {
            voteInvoked = true;
            if (cancelPhase === 'vote' && params.seat.id === 's1') {
              throw makeAbortErr();
            }
            return { vote: 'accept' };
          }
        };

        const engine = new CouncilEngine(
          {
            topic: `Adapter-local cancellation in ${cancelPhase}`,
            maxRounds: 1,
            minQuorum: 2,
            maxRetriesPerSeat: 1,
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
            seats: [
              { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'S1' },
              { id: 's2', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'S2' },
              { id: 's3', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'S3' }
            ]
          },
          { signal: parentCtrl.signal, harnessResolver: () => harness }
        );

        const res = await engine.run();
        assert.equal(res.ok, false, `Expected ok=false on ${cancelPhase} cancellation`);
        assert.equal(res.aborted, true, `Expected aborted=true on ${cancelPhase} cancellation`);
        assert.equal(res.verdict, null, `Expected null verdict on ${cancelPhase} cancellation`);
        if (cancelPhase === 'proof') {
          assert.equal(judgeInvoked, false, 'Judge must not run after proof cancellation');
          assert.equal(voteInvoked, false, 'Voting must not run after proof cancellation');
        }
        if (cancelPhase === 'judge') {
          assert.equal(voteInvoked, false, 'Voting must not run after Judge cancellation');
        }
      }
    });

    it('materializes default maxRetriesPerJudge=1 in resolveConfig (independent of maxRetriesPerSeat: 0) and honors judge.maxRetries alias', async () => {
      const defaultResolved = resolveConfig({
        topic: 'Judge default retries',
        maxRetriesPerSeat: 0
      });
      assert.equal(defaultResolved.maxRetriesPerJudge, 1);

      const aliasResolved = resolveConfig({
        topic: 'Judge alias retries',
        maxRetriesPerSeat: 0,
        judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge', maxRetries: 3 }
      });
      assert.equal(aliasResolved.maxRetriesPerJudge, 3);

      let judgeAttempts = 0;
      const harness = {
        async executeSeatProof(params) {
          return { scope: 'S', kind: 'check', source: 'Src', statement: `P-${params.seat.id}` };
        },
        async executeJudgeAuditAndSynthesis(params) {
          judgeAttempts += 1;
          if (judgeAttempts === 1) {
            const err = new Error('Transient Judge failure');
            err.isRetryable = true;
            throw err;
          }
          const decisions = Object.fromEntries(params.proofs.map((p) => [p.id, { status: 'admitted', note: 'ok' }]));
          return {
            summary: 'Recovered',
            proofDecisions: decisions,
            clauses: [{ context: 'S', conclusion: 'OK', citedProofIds: [params.proofs[0].id] }]
          };
        },
        async executeSeatVote() {
          return { vote: 'accept' };
        }
      };

      const engine = new CouncilEngine(
        {
          topic: 'Judge default retry independence',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 0,
          judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'S1' },
            { id: 's2', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'S2' }
          ]
        },
        { harnessResolver: () => harness }
      );
      const res = await engine.run();
      assert.equal(res.ok, true);
      assert.equal(judgeAttempts, 2, 'Judge must get default 1 retry even when maxRetriesPerSeat is 0');
    });

    it('applies preserveRebuttalEffort and downshift rules consistently to explicit rebuttalModel overrides and falls back to backingProof on null/empty proofId', async () => {
      const { parseModelAndEffort } = await import('../../src/harness/cli-runner.js');

      // 1. Explicit parenthesized/high rebuttalModel with preserveRebuttalEffort=false downshifts BOTH model and reasoningEffort so runner executes at medium
      const downshiftedExplicit = resolveRebuttalSeatConfig({
        id: 's1',
        harness: 'codex',
        model: 'gpt-6.1-sol (high)',
        rebuttalModel: 'gpt-6-astra (max)'
      });
      assert.equal(downshiftedExplicit.model, 'gpt-6-astra (medium)');
      assert.equal(downshiftedExplicit.reasoningEffort, 'medium');
      assert.equal(parseModelAndEffort(downshiftedExplicit.model, downshiftedExplicit.reasoningEffort || 'high').effort, 'medium');

      // 2. Bare explicit rebuttalModel with preserveRebuttalEffort=true preserves high effort EVEN AFTER resolveConfig
      const resolvedPreservedExplicitCfg = resolveConfig({
        topic: 'Preserved bare rebuttalModel after resolveConfig',
        preserveRebuttalEffort: true,
        rebuttalModel: 'gpt-6-astra',
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'S1' },
          { id: 's2', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'S2' }
        ]
      });
      const preservedBareExplicit = resolveRebuttalSeatConfig(
        resolvedPreservedExplicitCfg.seats[0],
        resolvedPreservedExplicitCfg
      );
      assert.equal(preservedBareExplicit.model, 'gpt-6-astra');
      assert.equal(preservedBareExplicit.reasoningEffort, 'high');
      assert.equal(
        parseModelAndEffort(preservedBareExplicit.model, preservedBareExplicit.reasoningEffort || 'high').effort,
        'high'
      );

      // 2b. Bare seat WITHOUT rebuttalModel and preserveRebuttalEffort=true preserves high effort (no medium downshift) after resolveConfig
      const resolvedPreservedBareSeatCfg = resolveConfig({
        topic: 'Preserved bare seat without rebuttalModel after resolveConfig',
        preserveRebuttalEffort: true,
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra', soul: 'S1' },
          { id: 's2', harness: 'codex', model: 'gpt-6.1-sol', soul: 'S2' }
        ]
      });
      const preservedBareSeat = resolveRebuttalSeatConfig(
        resolvedPreservedBareSeatCfg.seats[0],
        resolvedPreservedBareSeatCfg
      );
      assert.equal(preservedBareSeat.model, 'gpt-6-astra');
      assert.equal(preservedBareSeat.reasoningEffort, undefined);
      assert.equal(
        parseModelAndEffort(preservedBareSeat.model, preservedBareSeat.reasoningEffort || 'high').effort,
        'high'
      );

      // 2c. Invalid embedded effort in explicit rebuttalModel (e.g. 'gpt-6-astra (bogus)') is NOT rewritten to '(medium)' and fails --live preflight
      const invalidExplicitCfg = resolveConfig({
        topic: 'Invalid explicit rebuttalModel effort must not be masked',
        rebuttalModel: 'gpt-6-astra (bogus)',
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'S1' },
          { id: 's2', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'S2' }
        ]
      });
      const invalidResolvedRebuttal = resolveRebuttalSeatConfig(
        invalidExplicitCfg.seats[0],
        invalidExplicitCfg
      );
      assert.equal(
        invalidResolvedRebuttal.model,
        'gpt-6-astra (bogus)',
        'resolveRebuttalSeatConfig must preserve invalid explicit rebuttalModel string so validation catches it'
      );

      const tmpPreflightDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue89-bogus-rebuttal-'));
      try {
        const cfgFile = path.join(tmpPreflightDir, 'config.json');
        fs.writeFileSync(
          cfgFile,
          JSON.stringify({
            topic: 'Bogus rebuttal effort preflight',
            maxRounds: 1,
            minQuorum: 2,
            rebuttalModel: 'gpt-6-astra (bogus)',
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
            seats: [
              { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'S1' },
              { id: 's2', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'S2' }
            ]
          })
        );
        const io = createTestIo();
        const exitCode = await cliModule.runCli(
          ['run', '--live', '--config', cfgFile, '--output-dir', path.join(tmpPreflightDir, 'out')],
          io
        );
        assert.equal(exitCode, 1, 'Expected --live preflight to fail on invalid rebuttalModel effort');
        assert.match(io.getStderr(), /Invalid rebuttalModel/i);

        // Also rejects Cursor grok-4.7-max in rebuttalModel even though downshiftModel would turn -max into -medium
        const cursorCfgFile = path.join(tmpPreflightDir, 'cursor-config.json');
        fs.writeFileSync(
          cursorCfgFile,
          JSON.stringify({
            topic: 'Bogus cursor max rebuttal effort preflight',
            maxRounds: 1,
            minQuorum: 2,
            rebuttalModel: 'grok-4.7-max',
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
            seats: [
              { id: 's1', harness: 'cursor', model: 'grok-4.7-high', soul: 'S1' },
              { id: 's2', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'S2' }
            ]
          })
        );
        const cursorIo = createTestIo();
        const cursorExit = await cliModule.runCli(
          ['run', '--live', '--config', cursorCfgFile, '--output-dir', path.join(tmpPreflightDir, 'out2')],
          cursorIo
        );
        assert.equal(cursorExit, 1, 'Expected --live preflight to fail on grok-4.7-max rebuttalModel');
        assert.match(cursorIo.getStderr(), /Invalid rebuttalModel/i);
      } finally {
        fs.rmSync(tmpPreflightDir, { recursive: true, force: true });
      }

      // 3. Falsy proofId (null and "") falls back to valid backingProof during voting
      const harness = {
        async executeSeatProof(params) {
          return { scope: 'S', kind: 'check', source: 'Src', statement: `Proof ${params.seat.id}` };
        },
        async executeJudgeAuditAndSynthesis(params) {
          const decisions = Object.fromEntries(params.proofs.map((p) => [p.id, { status: 'admitted', note: 'ok' }]));
          return {
            summary: 'Candidate',
            proofDecisions: decisions,
            clauses: [{ context: 'S', conclusion: 'C', citedProofIds: [params.proofs[0].id] }]
          };
        },
        async executeSeatVote(params) {
          if (params.seat.id === 's1') {
            return { vote: 'object', proofId: null, backingProof: 'P1', reason: 'Null proofId fallback' };
          }
          if (params.seat.id === 's2') {
            return { vote: 'object', proofId: '', backingProof: 'P2', reason: 'Empty proofId fallback' };
          }
          return { vote: 'accept' };
        }
      };

      const engine = new CouncilEngine(
        {
          topic: 'Falsy proofId backingProof fallback',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 0,
          judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'S1' },
            { id: 's2', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'S2' }
          ]
        },
        { harnessResolver: () => harness }
      );
      const res = await engine.run();
      assert.equal(res.verdict?.kind, 'Dissent Report (Round Limit Reached)');
      assert.equal(res.state.objections.length, 2);
      assert.equal(res.state.objections[0].proofId, 'P1');
      assert.equal(res.state.objections[1].proofId, 'P2');
    });
  });
});
