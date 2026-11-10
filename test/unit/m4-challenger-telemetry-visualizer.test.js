/**
 * @fileoverview Adversarial empirical stress testing for Milestone M4 (Issue #71):
 * Telemetry Ledger and Visualizer Live Watcher contracts.
 *
 * Verifies:
 * 1. High-volume mixture stress testing into CouncilTelemetryLedger.
 * 2. Invariant verification that partiallyAdmitted proofs NEVER inflate judgeRejectionRate across 100+ runs & multiple models.
 * 3. Boundary conditions and fuzzing for getSeatProofMetrics (empty, null, undefined, malformed, large arrays).
 * 4. Visualizer live-watcher 50+ sequential step deltas and state reconstruction fidelity (in-memory + browser bundle).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  getSeatProofMetrics,
  canonicalizeModelKey,
  buildRunTelemetryRecord,
  aggregateTelemetryWindow,
  buildTelemetrySummary,
  persistRunTelemetry,
  loadTelemetrySummary,
  formatTelemetryTable
} from '../../src/telemetry/ledger.js';
import { createSnapshot } from '../../src/telemetry/snapshot.js';
import { CouncilTelemetryEmitter } from '../../src/telemetry/emitter.js';
import { VisualizerLiveWatcher } from '../../src/visualizer/live-watcher.js';
import { createInitialCouncilState, cloneState } from '../../src/machine/state.js';
import { transitionCouncil } from '../../src/machine/reducer.js';

describe('Milestone M4 Challenger: Telemetry Ledger & Visualizer Empirical Stress Tests', () => {
  describe('Dimension 1: High-Volume Mixtures into CouncilTelemetryLedger', () => {
    it('processes 120 heterogeneous runs with 1,000+ proofs without NaN, overflow, or invariant breakdown', () => {
      const models = [
        { harness: 'codex', model: 'gpt-6-astra (max)' },
        { harness: 'antigravity', model: 'gemini-4-argon (high)' },
        { harness: 'cursor', model: 'claude-3-5-sonnet (high)' },
        { harness: 'cursor', model: 'grok-beta (high)' }
      ];

      const runRecords = [];
      const numRuns = 120;

      for (let r = 1; r <= numRuns; r++) {
        const runId = `stress-run-${String(r).padStart(3, '0')}`;
        const seats = models.map((m, idx) => ({
          id: `seat-${idx + 1}`,
          harness: m.harness,
          model: m.model,
          status: 'accepted',
          retries: r % 3 === 0 ? 1 : 0
        }));

        const proofs = [];
        let proofIdx = 1;
        const proofsPerSeat = 2 + (r % 5); // 2 to 6 proofs per seat

        for (const seat of seats) {
          for (let p = 0; p < proofsPerSeat; p++) {
            const pId = `P-${r}-${proofIdx++}`;
            const outcome = (r + proofIdx + p) % 4;
            if (outcome === 0) {
              // Explicitly admitted
              proofs.push({
                id: pId,
                seatId: seat.id,
                kind: 'check',
                status: 'admitted',
                admissionKind: 'explicitly_admitted',
                scope: 'core',
                statement: `Verified assertion ${pId}`
              });
            } else if (outcome === 1) {
              // Partially admitted
              proofs.push({
                id: pId,
                seatId: seat.id,
                kind: 'citation',
                status: 'partially_admitted',
                admissionKind: 'partially_admitted',
                scope: 'evidence',
                statement: `Complex claim ${pId} with overclaim`,
                judgeAdmittedStatement: `Clean core ${pId}`,
                judgeNote: `Excised secondary claim for ${pId}`
              });
            } else if (outcome === 2) {
              // Default admitted
              proofs.push({
                id: pId,
                seatId: seat.id,
                kind: 'benchmark',
                status: 'admitted',
                admissionKind: 'default_admitted',
                scope: 'perf',
                statement: `Baseline perf ${pId}`
              });
            } else {
              // Judge rejected
              proofs.push({
                id: pId,
                seatId: seat.id,
                kind: 'derivation',
                status: 'rejected',
                admissionKind: 'judge_rejected',
                scope: 'logic',
                statement: `Flawed logic ${pId}`,
                judgeNote: `Contradiction detected in ${pId}`
              });
            }
          }
        }

        const admittedAndPartialIds = proofs
          .filter((p) => p.status === 'admitted' || p.status === 'partially_admitted')
          .map((p) => p.id);

        const clauses = admittedAndPartialIds.length > 0
          ? [
              {
                id: `C-${r}-1`,
                context: 'Synthesis',
                conclusion: 'Consensus point',
                citedProofIds: admittedAndPartialIds.slice(0, Math.min(3, admittedAndPartialIds.length))
              }
            ]
          : [{ id: `C-${r}-1`, context: 'Fallback', conclusion: 'None', citedProofIds: [] }];

        const state = {
          phase: 'completed',
          round: 1,
          topic: `High Volume Run ${r}`,
          seats,
          judge: { id: 'judge-main', harness: 'codex', model: 'gpt-6-astra (max)', status: 'completed' },
          proofs,
          verdict: {
            kind: 'Unanimous Consensus',
            candidate: {
              summary: `Consensus summary for run ${r}`,
              clauses
            }
          }
        };

        const record = buildRunTelemetryRecord({
          runId,
          state,
          startedAt: new Date(Date.now() - 60000).toISOString(),
          completedAt: new Date().toISOString()
        });

        runRecords.push(record);

        // Per-record invariant checks
        for (const seatRec of record.seats) {
          const sumCategories =
            seatRec.explicitlyAdmitted +
            seatRec.partiallyAdmitted +
            seatRec.defaultAdmitted +
            seatRec.judgeRejected;
          assert.equal(
            seatRec.proofsSubmitted,
            sumCategories,
            `Seat ${seatRec.seatId} submitted count must equal category sum`
          );
          assert.ok(Number.isFinite(seatRec.partiallyAdmitted), 'partiallyAdmitted must be finite');
          assert.ok(Number.isFinite(seatRec.judgeRejected), 'judgeRejected must be finite');
        }
      }

      // Aggregate window across all 120 runs
      const windowAll = aggregateTelemetryWindow(runRecords, { days: null });
      assert.equal(windowAll.totalRuns, 120);
      assert.equal(windowAll.byModel.length, 4);

      // Verify each model bucket invariants
      for (const bucket of windowAll.byModel) {
        const sumCategories =
          bucket.explicitlyAdmitted +
          bucket.partiallyAdmitted +
          bucket.defaultAdmitted +
          bucket.judgeRejected;
        assert.equal(
          bucket.proofsSubmitted,
          sumCategories,
          `Bucket ${bucket.key} submitted count must strictly equal sum of subcategories`
        );
        assert.ok(bucket.proofsSubmitted > 100, `Bucket ${bucket.key} should aggregate >100 proofs`);
        assert.ok(bucket.partiallyAdmitted > 0, `Bucket ${bucket.key} should contain partiallyAdmitted proofs`);

        // Check rates are finite numbers between 0 and 100
        const rates = [
          bucket.explicitAdmissionRate,
          bucket.partialAdmissionRate,
          bucket.defaultAdmissionRate,
          bucket.judgeRejectionRate,
          bucket.finalClauseCitationRate,
          bucket.excusedRate
        ];
        for (const r of rates) {
          assert.ok(!Number.isNaN(r), `Rate ${r} must not be NaN`);
          assert.ok(Number.isFinite(r), `Rate ${r} must be finite`);
          assert.ok(r >= 0 && r <= 100, `Rate ${r} must be between 0 and 100`);
        }

        // Admission and rejection rates should sum to ~100% within rounding tolerance
        const rateSum =
          bucket.explicitAdmissionRate +
          bucket.partialAdmissionRate +
          bucket.defaultAdmissionRate +
          bucket.judgeRejectionRate;
        assert.ok(
          Math.abs(rateSum - 100) <= 0.6,
          `Rate sum (${rateSum}) for ${bucket.key} should be within 0.6% of 100%`
        );
      }

      // Verify ASCII table formatting produces valid, aligned output with Part.Admit% column
      const tableOutput = formatTelemetryTable({ windows: { all: windowAll } }, { days: null });
      assert.ok(tableOutput.includes('Part.Admit%'), 'Table must contain Part.Admit% column');
      assert.ok(tableOutput.includes('JudgeRej%'), 'Table must contain JudgeRej% column');
      assert.ok(tableOutput.includes('gpt-6-astra (max)'), 'Table must list gpt-6-astra');
      assert.ok(tableOutput.includes('gemini-4-argon (high)'), 'Table must list gemini-4-argon');
    });
  });

  describe('Dimension 2: Non-Inflation Invariant Verification Across 100+ Runs', () => {
    it('guarantees that partiallyAdmitted proofs NEVER inflate judgeRejectionRate or judgeRejected count', () => {
      // Invariant: If a seat submits proofs that are only admitted and partially admitted (0 rejected),
      // judgeRejected MUST be 0 and judgeRejectionRate MUST be 0.0% across all 100 runs.
      const runs = [];
      const numRuns = 100;

      for (let r = 1; r <= numRuns; r++) {
        // Vary partial admission ratio from 1% to 99%
        const partialCount = 1 + (r % 10);
        const admittedCount = 10 - partialCount;

        const proofs = [];
        for (let i = 0; i < partialCount; i++) {
          proofs.push({
            id: `P-part-${r}-${i}`,
            seatId: 'seat-alpha',
            kind: 'citation',
            status: 'partially_admitted',
            admissionKind: 'partially_admitted',
            scope: 'test',
            statement: 'Partial',
            judgeAdmittedStatement: 'Core',
            judgeNote: 'Note'
          });
        }
        for (let i = 0; i < admittedCount; i++) {
          proofs.push({
            id: `P-adm-${r}-${i}`,
            seatId: 'seat-alpha',
            kind: 'check',
            status: 'admitted',
            admissionKind: 'explicitly_admitted',
            scope: 'test',
            statement: 'Full'
          });
        }

        const state = {
          phase: 'completed',
          round: 1,
          topic: `Zero Rejection Run ${r}`,
          seats: [{ id: 'seat-alpha', harness: 'antigravity', model: 'gemini-4-argon (high)', status: 'accepted' }],
          proofs,
          verdict: {
            kind: 'Unanimous Consensus',
            candidate: {
              summary: 'Summary',
              clauses: [{ id: 'C1', context: 'All', conclusion: 'Done', citedProofIds: [`P-part-${r}-0`] }]
            }
          }
        };

        const rec = buildRunTelemetryRecord({
          runId: `zero-rej-run-${r}`,
          state
        });

        runs.push(rec);

        const seatAlpha = rec.seats.find((s) => s.seatId === 'seat-alpha');
        assert.equal(seatAlpha.judgeRejected, 0, `Run ${r}: judgeRejected must be 0`);
        assert.equal(seatAlpha.partiallyAdmitted, partialCount, `Run ${r}: partiallyAdmitted count must match`);
        assert.equal(seatAlpha.explicitlyAdmitted, admittedCount, `Run ${r}: explicitlyAdmitted count must match`);
      }

      // Aggregate window across all 100 zero-rejection runs
      const win = aggregateTelemetryWindow(runs, { days: null });
      const model = win.byModel.find((m) => m.key === 'antigravity/gemini-4-argon (high)');
      assert.ok(model, 'Model bucket must exist');
      assert.equal(model.runs, 100);
      assert.equal(model.judgeRejected, 0, 'judgeRejected MUST be 0 across all 100 runs');
      assert.equal(model.judgeRejectionRate, 0, 'judgeRejectionRate MUST be 0.0% across all 100 runs');
      assert.ok(model.partiallyAdmitted > 0, 'partiallyAdmitted must be > 0');
      assert.ok(model.partialAdmissionRate > 0, 'partialAdmissionRate must be > 0');

      const seatAlpha = win.bySeat.find((s) => s.key === 'seat-alpha');
      assert.equal(seatAlpha.judgeRejected, 0);
      assert.equal(seatAlpha.judgeRejectionRate, 0);
    });

    it('verifies 100% partial admission results in 0% judgeRejectionRate and 100% partialAdmissionRate', () => {
      const proofs = Array.from({ length: 50 }, (_, i) => ({
        id: `P-100p-${i}`,
        seatId: 'seat-sol',
        kind: 'derivation',
        status: 'partially_admitted',
        admissionKind: 'partially_admitted',
        scope: 'pure-partial',
        statement: `Derivation ${i}`,
        judgeAdmittedStatement: `Verified Core ${i}`,
        judgeNote: 'Excluded secondary lemma'
      }));

      const state = {
        phase: 'completed',
        round: 1,
        topic: '100% Partial Admission Test',
        seats: [{ id: 'seat-sol', harness: 'codex', model: 'gpt-6-astra (max)', status: 'accepted' }],
        proofs,
        verdict: {
          kind: 'Unanimous Consensus',
          candidate: { summary: 'Pure partial', clauses: [{ id: 'C1', context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P-100p-0'] }] }
        }
      };

      const rec = buildRunTelemetryRecord({ runId: 'run-100-partial', state });
      const seat = rec.seats[0];
      assert.equal(seat.proofsSubmitted, 50);
      assert.equal(seat.partiallyAdmitted, 50);
      assert.equal(seat.explicitlyAdmitted, 0);
      assert.equal(seat.defaultAdmitted, 0);
      assert.equal(seat.judgeRejected, 0);

      const win = aggregateTelemetryWindow([rec], { days: null });
      const solBucket = win.byModel[0];
      assert.equal(solBucket.proofsSubmitted, 50);
      assert.equal(solBucket.partiallyAdmitted, 50);
      assert.equal(solBucket.partialAdmissionRate, 100);
      assert.equal(solBucket.judgeRejected, 0);
      assert.equal(solBucket.judgeRejectionRate, 0);
    });

    it('preserves exact rejection count and rate when mixed with partial admissions (does not conflate)', () => {
      // 20 admitted, 30 partially admitted, 50 rejected -> total 100 submitted
      // judgeRejected must be exactly 50, judgeRejectionRate must be 50.0%
      const proofs = [
        ...Array.from({ length: 20 }, (_, i) => ({
          id: `P-adm-${i}`,
          seatId: 'seat-mix',
          status: 'admitted',
          admissionKind: 'explicitly_admitted'
        })),
        ...Array.from({ length: 30 }, (_, i) => ({
          id: `P-part-${i}`,
          seatId: 'seat-mix',
          status: 'partially_admitted',
          admissionKind: 'partially_admitted',
          judgeAdmittedStatement: 'core'
        })),
        ...Array.from({ length: 50 }, (_, i) => ({
          id: `P-rej-${i}`,
          seatId: 'seat-mix',
          status: 'rejected',
          admissionKind: 'judge_rejected'
        }))
      ];

      const metrics = getSeatProofMetrics(proofs);
      assert.equal(metrics.proofsSubmitted, 100);
      assert.equal(metrics.explicitlyAdmitted, 20);
      assert.equal(metrics.partiallyAdmitted, 30);
      assert.equal(metrics.defaultAdmitted, 0);
      assert.equal(metrics.judgeRejected, 50);
      assert.equal(metrics.explicitAdmissionRate, 20);
      assert.equal(metrics.partialAdmissionRate, 30);
      assert.equal(metrics.defaultAdmissionRate, 0);
      assert.equal(metrics.judgeRejectionRate, 50); // NOT 80%
    });
  });

  describe('Dimension 3: Boundary Conditions & Fuzzing for getSeatProofMetrics', () => {
    it('handles empty arrays, undefined, null, and non-array types cleanly with zero rates and no NaN', () => {
      const edgeInputs = [
        [],
        undefined,
        null,
        '',
        'random string',
        12345,
        true,
        false,
        {},
        { proofs: [] },
        Symbol('foo'),
        () => []
      ];

      for (const input of edgeInputs) {
        const res = getSeatProofMetrics(input);
        assert.ok(res && typeof res === 'object', `Should return an object for input: ${String(input)}`);
        assert.equal(res.proofsSubmitted, 0);
        assert.equal(res.explicitlyAdmitted, 0);
        assert.equal(res.partiallyAdmitted, 0);
        assert.equal(res.defaultAdmitted, 0);
        assert.equal(res.judgeRejected, 0);
        assert.equal(res.explicitAdmissionRate, 0);
        assert.equal(res.partialAdmissionRate, 0);
        assert.equal(res.defaultAdmissionRate, 0);
        assert.equal(res.judgeRejectionRate, 0);

        for (const [key, val] of Object.entries(res)) {
          assert.equal(typeof val, 'number', `${key} must be a number`);
          assert.ok(!Number.isNaN(val), `${key} must not be NaN for input: ${String(input)}`);
          assert.ok(Number.isFinite(val), `${key} must be finite for input: ${String(input)}`);
        }
      }
    });

    it('survives corrupted proof objects within arrays (nulls, primitives, empty objects)', () => {
      const corruptArray = [
        null,
        undefined,
        0,
        42,
        false,
        true,
        '',
        'not a proof',
        {},
        { someProp: 'foo' },
        { status: null },
        { status: 123 },
        { status: 'unknown_status' },
        { admissionKind: 'unknown_kind' },
        { status: 'partially_admitted' }, // valid partially_admitted
        { admissionKind: 'partially_admitted' }, // valid partially_admitted via admissionKind
        { status: 'admitted', admissionKind: 'explicitly_admitted' }, // valid admitted
        { status: 'rejected' } // valid rejected
      ];

      const res = getSeatProofMetrics(corruptArray);
      assert.ok(res);
      assert.equal(res.proofsSubmitted, corruptArray.length);
      assert.equal(res.partiallyAdmitted, 2);
      assert.equal(res.explicitlyAdmitted, 1);
      assert.equal(res.judgeRejected, 1);
      assert.equal(res.defaultAdmitted, 0);

      // Verify all rates are valid numbers between 0 and 100
      for (const [key, val] of Object.entries(res)) {
        assert.ok(!Number.isNaN(val), `${key} must not be NaN`);
        assert.ok(Number.isFinite(val), `${key} must be finite`);
      }
    });

    it('resolves conflicting status vs admissionKind predictably in favor of partial admission', () => {
      // If a proof has status === 'partially_admitted' and admissionKind === 'judge_rejected'
      const conflictingProof1 = [{ status: 'partially_admitted', admissionKind: 'judge_rejected' }];
      const res1 = getSeatProofMetrics(conflictingProof1);
      assert.equal(res1.partiallyAdmitted, 1);
      assert.equal(res1.judgeRejected, 0);

      // If a proof has admissionKind === 'partially_admitted' and status === 'rejected'
      const conflictingProof2 = [{ status: 'rejected', admissionKind: 'partially_admitted' }];
      const res2 = getSeatProofMetrics(conflictingProof2);
      assert.equal(res2.partiallyAdmitted, 1);
      assert.equal(res2.judgeRejected, 0);
    });

    it('survives prototype pollution attack payloads', () => {
      const maliciousProofs = [
        JSON.parse('{"__proto__": {"status": "rejected", "admissionKind": "judge_rejected"}}'),
        JSON.parse('{"constructor": {"prototype": {"status": "rejected"}}}')
      ];

      const res = getSeatProofMetrics(maliciousProofs);
      assert.equal(res.proofsSubmitted, 2);
      assert.equal(res.judgeRejected, 0);
      assert.equal(res.partiallyAdmitted, 0);
      assert.equal(res.explicitlyAdmitted, 0);
    });

    it('scales linearly to 20,000 proofs in a single call in under 100ms', () => {
      const largeProofs = Array.from({ length: 20000 }, (_, i) => {
        const mod = i % 4;
        if (mod === 0) return { status: 'admitted', admissionKind: 'explicitly_admitted' };
        if (mod === 1) return { status: 'partially_admitted', admissionKind: 'partially_admitted' };
        if (mod === 2) return { status: 'admitted', admissionKind: 'default_admitted' };
        return { status: 'rejected', admissionKind: 'judge_rejected' };
      });

      const t0 = performance.now();
      const res = getSeatProofMetrics(largeProofs);
      const elapsed = performance.now() - t0;

      assert.equal(res.proofsSubmitted, 20000);
      assert.equal(res.explicitlyAdmitted, 5000);
      assert.equal(res.partiallyAdmitted, 5000);
      assert.equal(res.defaultAdmitted, 5000);
      assert.equal(res.judgeRejected, 5000);
      assert.equal(res.explicitAdmissionRate, 25);
      assert.equal(res.partialAdmissionRate, 25);
      assert.equal(res.defaultAdmissionRate, 25);
      assert.equal(res.judgeRejectionRate, 25);
      assert.ok(elapsed < 100, `Large proof metric computation took ${elapsed.toFixed(1)}ms (expected <100ms)`);
    });
  });

  describe('Dimension 4: Live Watcher Step Deltas & State Reconstruction (50+ Steps)', () => {
    it('accurately tracks judgeAdmittedStatement across 55 sequential steps without forward or backward leakage', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-watcher-stress-'));
      const runDir = path.join(tempDir, 'runs');
      fs.mkdirSync(runDir, { recursive: true });

      const emitter = new CouncilTelemetryEmitter();
      const runId = 'stress-watcher-run-55';
      const watcher = new VisualizerLiveWatcher({
        telemetry: emitter,
        outputDir: runDir,
        runId,
        initialConfig: {
          topic: '55-Step Deliberation Stress',
          maxRounds: 3,
          minQuorum: 2,
          judge: { id: 'judge-1', harness: 'codex', model: 'gpt-6-astra (max)' },
          seats: [
            { id: 'seat-1', harness: 'antigravity', model: 'gemini-4-argon (high)' },
            { id: 'seat-2', harness: 'codex', model: 'gpt-6-astra (max)' }
          ]
        }
      });

      // Build state step-by-step
      let state = createInitialCouncilState({
        topic: '55-Step Deliberation Stress',
        maxRounds: 3,
        minQuorum: 2,
        judge: { id: 'judge-1', harness: 'codex', model: 'gpt-6-astra (max)' },
        seats: [
          { id: 'seat-1', harness: 'antigravity', model: 'gemini-4-argon (high)' },
          { id: 'seat-2', harness: 'codex', model: 'gpt-6-astra (max)' }
        ]
      });

      // Helper to transition state and emit event
      const advance = (event) => {
        state = transitionCouncil(state, event);
        emitter.emitStateTransition(event, cloneState(state));
      };

      // Step 1: START_CLARIFYING
      advance({ type: 'START_CLARIFYING' });

      // Step 2: PUBLISH_CLARIFICATION batch 1
      advance({ type: 'PUBLISH_CLARIFICATION', batch: 1, answer: 'Answer 1' });

      // Step 3: BEGIN_ROUND 1
      advance({ type: 'BEGIN_ROUND' });

      // Steps 4–49: Submit 46 proofs sequentially across seats (23 by seat-1, 23 by seat-2)
      for (let p = 1; p <= 46; p++) {
        const sid = p % 2 === 1 ? 'seat-1' : 'seat-2';
        advance({
          type: 'SUBMIT_PROOF',
          seatId: sid,
          id: `P-${p}`,
          kind: p % 2 === 0 ? 'citation' : 'check',
          source: `doc-${p}.md`,
          scope: `scope-${p}`,
          statement: `Statement for proof P-${p} containing detailed assertions.`
        });
      }

      // Step 50: START_JUDGING
      advance({ type: 'START_JUDGING' });

      // Step 51: JUDGE_AUDIT_AND_SYNTHESIZE:
      // P-1 to P-15: admitted
      // P-16 to P-35: partially_admitted (each with unique admittedStatement and note)
      // P-36 to P-46: rejected
      const proofDecisions = {};
      for (let p = 1; p <= 15; p++) {
        proofDecisions[`P-${p}`] = { status: 'admitted', note: `Solid check P-${p}` };
      }
      for (let p = 16; p <= 35; p++) {
        proofDecisions[`P-${p}`] = {
          status: 'partially_admitted',
          admittedStatement: `Admitted Core Statement for P-${p}`,
          note: `Excised extraneous conjecture for P-${p}`
        };
      }
      for (let p = 36; p <= 46; p++) {
        proofDecisions[`P-${p}`] = { status: 'rejected', note: `Refuted lemma P-${p}` };
      }

      advance({
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        proofDecisions,
        summary: 'Synthesized Candidate Clauses',
        clauses: [
          { id: 'C-1', context: 'Fully Admitted Core', conclusion: 'Solid', citedProofIds: ['P-1', 'P-2'] },
          { id: 'C-2', context: 'Partially Admitted Core', conclusion: 'Bounded', citedProofIds: ['P-16', 'P-17'] }
        ]
      });

      // Steps 52–53: Cast votes (seat-1 accepts, seat-2 objects backed by partially admitted P-16)
      advance({ type: 'CAST_VOTE', seatId: 'seat-1', vote: 'accept' });
      advance({ type: 'CAST_VOTE', seatId: 'seat-2', vote: 'object', proofId: 'P-16', reason: 'Unresolved caveat on P-16' });

      // Step 54: Seat fault on seat-2
      advance({ type: 'SEAT_FAULT', seatId: 'seat-2', errorClass: 'TimeoutError', reason: 'Timeout on deliberation' });

      // Step 55: RETRY_SEAT
      advance({ type: 'RETRY_SEAT', seatId: 'seat-2' });

      // Step 56: WITHDRAW_OBJECTION
      const openObj = state.objections.find((o) => o.status === 'open');
      assert.ok(openObj, 'Open objection must exist');
      advance({ type: 'WITHDRAW_OBJECTION', seatId: 'seat-2', objectionId: openObj.id });

      // Step 57: Cast vote again (accept)
      advance({ type: 'CAST_VOTE', seatId: 'seat-2', vote: 'accept' });

      // Step 58: EVALUATE_ROUND -> completed round 1
      advance({ type: 'EVALUATE_ROUND' });

      assert.equal(state.phase, 'completed');
      watcher.stop();

      const steps = watcher.liveRun.steps;
      assert.ok(steps.length >= 55, `Watcher should have recorded >= 55 steps (actual: ${steps.length})`);

      // 1. Verify BACKWARD ISOLATION:
      // In all steps before judging (steps 0 to 49), NO proof in stateSnapshot has judgeAdmittedStatement
      for (let i = 0; i <= 49; i++) {
        const snap = steps[i].stateSnapshot;
        assert.ok(snap, `Step ${i} must rehydrate stateSnapshot`);
        for (const p of snap.proofs) {
          assert.equal(
            p.judgeAdmittedStatement,
            undefined,
            `Step ${i} (pre-judging) proof ${p.id} must NOT have judgeAdmittedStatement`
          );
        }
      }

      // 2. Verify FORWARD FIDELITY:
      // At step 50 (JUDGE_AUDIT_AND_SYNTHESIZE) and all subsequent steps,
      // partially admitted proofs retain their exact judgeAdmittedStatement and judgeNote
      for (let i = 50; i < steps.length; i++) {
        const snap = steps[i].stateSnapshot;
        assert.ok(snap, `Step ${i} must rehydrate stateSnapshot`);

        for (let p = 16; p <= 35; p++) {
          const proof = snap.proofs.find((pr) => pr.id === `P-${p}`);
          assert.ok(proof, `Step ${i}: proof P-${p} must exist`);
          assert.equal(proof.status, 'partially_admitted', `Step ${i}: P-${p} status must be partially_admitted`);
          assert.equal(
            proof.judgeAdmittedStatement,
            `Admitted Core Statement for P-${p}`,
            `Step ${i}: P-${p} judgeAdmittedStatement must match exactly`
          );
          assert.equal(
            proof.judgeNote,
            `Excised extraneous conjecture for P-${p}`,
            `Step ${i}: P-${p} judgeNote must match`
          );
        }

        // Fully admitted proofs must NOT have judgeAdmittedStatement
        for (let p = 1; p <= 15; p++) {
          const proof = snap.proofs.find((pr) => pr.id === `P-${p}`);
          assert.equal(proof.status, 'admitted');
          assert.equal(proof.judgeAdmittedStatement, undefined);
        }

        // Rejected proofs must NOT have judgeAdmittedStatement
        for (let p = 36; p <= 46; p++) {
          const proof = snap.proofs.find((pr) => pr.id === `P-${p}`);
          assert.equal(proof.status, 'rejected');
          assert.equal(proof.judgeAdmittedStatement, undefined);
        }

        // Causal links check: Clause C2 cites partially admitted proof P-16 & P-17
        const graph = steps[i].graph;
        assert.ok(graph, `Step ${i} must rehydrate graph`);
        const linkP16 = graph.causalLinks.find((l) => l.id === 'dep-proof-clause-P-16-C2');
        assert.ok(linkP16, `Step ${i}: causal link dep-proof-clause-P-16-C2 must exist`);
        assert.equal(linkP16.status, 'partially_admitted', `Step ${i}: causal link status must be partially_admitted`);
      }

      // 3. Verify BROWSER REPLAY REHYDRATION from disk bundle:
      // Load the generated runtime script `<runId>.js` and execute in sandbox
      const bundlePath = path.join(runDir, `${runId}.js`);
      assert.ok(fs.existsSync(bundlePath), 'Live run bundle JS must exist on disk');
      const bundleSource = fs.readFileSync(bundlePath, 'utf8');

      const mockWindow = {};
      const evalBundle = new Function('window', 'globalThis', bundleSource);
      evalBundle(mockWindow, mockWindow);

      const rehydratedRun = mockWindow.CouncilRuns[runId];
      assert.ok(rehydratedRun, 'CouncilRuns must contain rehydrated run');
      assert.equal(rehydratedRun.steps.length, steps.length);

      // Verify browser rehydration step snapshots match in-memory step snapshots exactly
      for (let i = 0; i < steps.length; i++) {
        const inMemSnap = steps[i].stateSnapshot;
        const browserSnap = rehydratedRun.steps[i].stateSnapshot;

        assert.equal(browserSnap.phase, inMemSnap.phase);
        assert.equal(browserSnap.round, inMemSnap.round);
        assert.equal(browserSnap.proofs.length, inMemSnap.proofs.length);

        for (let p = 0; p < inMemSnap.proofs.length; p++) {
          const ip = inMemSnap.proofs[p];
          const bp = browserSnap.proofs[p];
          assert.equal(bp.id, ip.id);
          assert.equal(bp.status, ip.status);
          assert.equal(bp.judgeAdmittedStatement, ip.judgeAdmittedStatement);
          assert.equal(bp.judgeNote, ip.judgeNote);
        }
      }

      // Cleanup tempDir
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
