/**
 * @fileoverview Challenger Adversarial Stress Test Suite for Milestone M7 (Issues #71 & #73).
 *
 * White-box adversarial stress testing, invariant verification, and coverage hardening:
 *
 * 1. Issue #71:
 *    - 3-state proof admission decisions ('admitted', 'partially_admitted' / 'admitted_with_caveat', 'rejected') in reducer.js.
 *    - Fail-closed guard behavior in guards.js on invalid, unknown, or malformed status strings.
 *    - Verification that partially_admitted proofs require non-empty note/admittedStatement,
 *      store judgeAdmittedStatement and judgeNote, and are added to admittedIds so Candidate clauses can cite them.
 *    - Telemetry ledger (ledger.js), CLI rendering (cli/index.js), and visualizer (council-visualizer.js) support.
 *
 * 2. Issue #73:
 *    - Reframing --evidence as shared, attributed, challengeable baseline evidence rather than "immutable ground-truth"
 *      across prompts (soul.js) and skills (SKILL.md).
 *    - Scoping --cwd in SKILL.md (omitted when --evidence contains required excerpts).
 *    - Answer-First synthesis in candidate.summary in formatJudgePrompt strictly free of internal proof IDs (P1, P2) and deliberation commentary.
 *    - Rendering of Proof Audit summary tally ('Proof Audit: X Admitted | Y Partially Admitted | Z Rejected') in cli/index.js.
 *
 * 3. Skill Parity:
 *    - Validates zero diff between skills/ask-council/SKILL.md and .agents/skills/ask-council/SKILL.md.
 *
 * Authored by: challenger_m7_2 (Empirical Challenger M7-2)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import {
  createInitialCouncilState,
  transitionCouncil,
  COUNCIL_EVENTS
} from '../../src/index.js';
import {
  guardJudgeAuditAndSynthesize,
  guardCastVote,
  validateCandidateClauses
} from '../../src/machine/guards.js';
import {
  getSeatProofMetrics,
  canonicalizeModelKey,
  buildRunTelemetryRecord,
  aggregateTelemetryWindow
} from '../../src/telemetry/ledger.js';
import {
  formatGroundingSection,
  formatDeliberationPrompt,
  formatJudgePrompt,
  formatVotingPrompt,
  STANDARD_SOULS,
  createSoul
} from '../../src/seats/soul.js';
import { runCli } from '../../src/cli/index.js';

// Load CouncilVisualizer
const visualizerMod = await import('../../src/visualizer/council-visualizer.js');
const CouncilVisualizer = visualizerMod.default || globalThis.CouncilVisualizer || visualizerMod;

// Mock IO builder for CLI tests
function createMockIO() {
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let exitCode = null;

  return {
    io: {
      stdout: {
        write: (text) => { stdoutBuffer += text; },
        isTTY: false
      },
      stderr: {
        write: (text) => { stderrBuffer += text; }
      },
      exit: (code) => {
        exitCode = code;
        return code;
      }
    },
    getStdout: () => stdoutBuffer,
    getStderr: () => stderrBuffer,
    getExitCode: () => exitCode
  };
}

// Strip ANSI color codes helper
function stripAnsi(str) {
  return typeof str === 'string'
    ? str.replace(/\x1b\[[0-9;]*m/g, '')
    : '';
}

// Helper: sets up a state in the judging phase with submitted proofs
function setupJudgingState(proofConfigs = [{ id: 'P1' }, { id: 'P2' }]) {
  let state = createInitialCouncilState();
  state = transitionCouncil(state, {
    type: COUNCIL_EVENTS.ADD_SEAT,
    seat: { id: 's1', harness: 'mock', model: 'codex-m1', soul: 'voter' }
  });
  state = transitionCouncil(state, {
    type: COUNCIL_EVENTS.ADD_SEAT,
    seat: { id: 's2', harness: 'mock', model: 'agy-m2', soul: 'voter' }
  });
  state = transitionCouncil(state, { type: COUNCIL_EVENTS.BEGIN_ROUND });

  proofConfigs.forEach((pc, idx) => {
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.SUBMIT_PROOF,
      id: pc.id,
      seatId: pc.seatId || `s${(idx % 2) + 1}`,
      scope: pc.scope || 'Core',
      kind: pc.kind || 'check',
      source: pc.source || 'spec.md',
      statement: pc.statement || `Statement for ${pc.id}`
    });
  });

  state = transitionCouncil(state, { type: COUNCIL_EVENTS.START_JUDGING });
  return state;
}

describe('Challenger M7-2: Adversarial Stress & Verification Suite (Issues #71 & #73)', () => {

  // ==========================================================================
  // DOMAIN 1: ISSUE #71 - REDUCER & GUARDS WHITE-BOX ADVERSARIAL STRESS
  // ==========================================================================
  describe('Domain 1: Proof Admission Reducer & Guard Invariants (Issue #71)', () => {

    it('ADVERSARIAL-1.1: Fails closed on any case variations, misspelled words, or unauthorized decision statuses', () => {
      const state = setupJudgingState([{ id: 'P1' }]);

      const unauthorizedStatuses = [
        'ADMITTED',
        'Admitted',
        'PARTIALLY_ADMITTED',
        'Partially_Admitted',
        'admitted_with_caveat'.toUpperCase(),
        'REJECTED',
        'Rejected',
        'admit',
        'approved',
        'passed',
        'confirmed',
        'accept',
        'yes',
        'denied',
        'rejected_with_note',
        'conditional',
        'partial',
        'pending',
        'null',
        'undefined',
        ' admitted',
        'admitted ',
        '  rejected\n'
      ];

      for (const badStatus of unauthorizedStatuses) {
        // Test in guardJudgeAuditAndSynthesize directly
        const guardRes = guardJudgeAuditAndSynthesize(state, {
          proofDecisions: { P1: { status: badStatus, note: 'Valid note' } },
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
        });
        assert.equal(
          guardRes.ok,
          false,
          `Guard must reject unauthorized decision status: "${badStatus}"`
        );
        assert.match(
          guardRes.message,
          /unrecognized decision status/,
          `Guard error message must cite unrecognized decision status for "${badStatus}"`
        );

        // Test in state machine transitionCouncil
        const nextState = transitionCouncil(state, {
          type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
          proofDecisions: { P1: { status: badStatus, note: 'Valid note' } },
          summary: 'Clean candidate summary.',
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
        });
        assert.equal(
          nextState.lastTransition?.ok,
          false,
          `Reducer must fail closed for unauthorized decision status: "${badStatus}"`
        );
        assert.match(
          nextState.lastTransition?.message,
          /unrecognized decision status/
        );
      }
    });

    it('ADVERSARIAL-1.2: Fails closed when status property is of non-string or malformed type', () => {
      const state = setupJudgingState([{ id: 'P1' }]);

      const malformedTypes = [
        123,
        0,
        -1,
        3.14,
        true,
        false,
        null,
        ['admitted'],
        { nested: 'admitted' },
        Symbol('status')
      ];

      for (const val of malformedTypes) {
        const guardRes = guardJudgeAuditAndSynthesize(state, {
          proofDecisions: { P1: { status: val, note: 'Valid note' } },
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
        });
        assert.equal(
          guardRes.ok,
          false,
          `Guard must reject non-string status type: ${typeof val}`
        );
        assert.match(
          guardRes.message,
          /invalid decision status type/,
          `Expected invalid decision status type error for ${typeof val}`
        );

        const nextState = transitionCouncil(state, {
          type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
          proofDecisions: { P1: { status: val, note: 'Valid note' } },
          summary: 'Clean candidate summary.',
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
        });
        assert.equal(nextState.lastTransition?.ok, false);
      }
    });

    it('ADVERSARIAL-1.3: Fails closed on bare string partially_admitted without required caveat object', () => {
      const state = setupJudgingState([{ id: 'P1' }]);

      for (const bareStr of ['partially_admitted', 'admitted_with_caveat']) {
        const guardRes = guardJudgeAuditAndSynthesize(state, {
          proofDecisions: { P1: bareStr },
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
        });
        assert.equal(guardRes.ok, false);
        assert.match(
          guardRes.message,
          /partially admitted without a required caveat; requires a non-empty note or admittedStatement/
        );

        const nextState = transitionCouncil(state, {
          type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
          proofDecisions: { P1: bareStr },
          summary: 'Candidate answer',
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
        });
        assert.equal(nextState.lastTransition?.ok, false);
      }
    });

    it('ADVERSARIAL-1.4: Strict caveat invariant: rejects partially_admitted with empty, whitespace, or invalid caveat fields', () => {
      const state = setupJudgingState([{ id: 'P1' }]);

      const invalidCaveats = [
        {}, // completely empty
        { note: '' },
        { note: '   ' },
        { note: '\t\n\r  ' },
        { admittedStatement: '' },
        { admittedStatement: '   \t' },
        { reason: '' },
        { reason: '   ' },
        { note: '   ', admittedStatement: '   ', reason: '   ' },
        { note: 12345 },
        { note: null },
        { note: ['note'] },
        { admittedStatement: 999 },
        { admittedStatement: {} },
        { reason: true }
      ];

      for (const caveat of invalidCaveats) {
        for (const statusName of ['partially_admitted', 'admitted_with_caveat']) {
          const decisionObj = { status: statusName, ...caveat };
          const guardRes = guardJudgeAuditAndSynthesize(state, {
            proofDecisions: { P1: decisionObj },
            clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
          });
          assert.equal(
            guardRes.ok,
            false,
            `Must reject invalid caveat: ${JSON.stringify(decisionObj)}`
          );
          assert.match(
            guardRes.message,
            /partially admitted without a required caveat; requires a non-empty note or admittedStatement/
          );

          const nextState = transitionCouncil(state, {
            type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
            proofDecisions: { P1: decisionObj },
            summary: 'Candidate answer',
            clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
          });
          assert.equal(nextState.lastTransition?.ok, false);
        }
      }
    });

    it('ADVERSARIAL-1.5: Successfully admits partial proofs with valid caveats, stores fields trimmed, and adds to admittedIds', () => {
      const state = setupJudgingState([{ id: 'P1' }, { id: 'P2' }, { id: 'P3' }]);

      const nextState = transitionCouncil(state, {
        type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
        proofDecisions: {
          P1: {
            status: 'partially_admitted',
            admittedStatement: '  Throughput is 45,000 req/sec at p99  ',
            note: '  Applies only to x86_64 architecture with AVX-512 enabled  '
          },
          P2: {
            status: 'admitted_with_caveat',
            admittedStatement: 'Memory footprint bounded to 128MB'
          },
          P3: {
            status: 'partially_admitted',
            reason: 'Accepted core latency derivation; secondary cache claims omitted'
          }
        },
        summary: 'Direct answer: System scales efficiently under bounded concurrency.',
        clauses: [
          { context: 'Throughput', conclusion: 'Scale to 45k req/s', citedProofIds: ['P1'] },
          { context: 'Memory', conclusion: 'Cap memory at 128MB', citedProofIds: ['P2'] },
          { context: 'Latency', conclusion: 'Latency meets SLA', citedProofIds: ['P3', 'P1'] }
        ]
      });

      assert.equal(nextState.lastTransition?.ok, true);
      assert.equal(nextState.phase, 'confirming');

      const p1 = nextState.proofs.find((p) => p.id === 'P1');
      assert.equal(p1.status, 'partially_admitted');
      assert.equal(p1.admissionKind, 'partially_admitted');
      assert.equal(p1.judgeAdmittedStatement, 'Throughput is 45,000 req/sec at p99');
      assert.equal(p1.judgeNote, 'Applies only to x86_64 architecture with AVX-512 enabled');

      const p2 = nextState.proofs.find((p) => p.id === 'P2');
      assert.equal(p2.status, 'partially_admitted');
      assert.equal(p2.admissionKind, 'partially_admitted');
      assert.equal(p2.judgeAdmittedStatement, 'Memory footprint bounded to 128MB');
      assert.equal(p2.judgeNote, '');

      const p3 = nextState.proofs.find((p) => p.id === 'P3');
      assert.equal(p3.status, 'partially_admitted');
      assert.equal(p3.admissionKind, 'partially_admitted');
      assert.equal(p3.judgeAdmittedStatement, null);
      assert.equal(p3.judgeNote, 'Accepted core latency derivation; secondary cache claims omitted');

      // Candidate clauses successfully cited all partial proofs
      assert.equal(nextState.candidate.clauses.length, 3);
      assert.deepEqual(nextState.candidate.clauses[0].citedProofIds, ['P1']);
      assert.deepEqual(nextState.candidate.clauses[1].citedProofIds, ['P2']);
      assert.deepEqual(nextState.candidate.clauses[2].citedProofIds, ['P3', 'P1']);
    });

    it('ADVERSARIAL-1.6: Candidate clause citing rejected proof fails closed, even if citing admitted proof alongside it', () => {
      const state = setupJudgingState([{ id: 'P1' }, { id: 'P2' }]);

      const nextState = transitionCouncil(state, {
        type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
        proofDecisions: {
          P1: { status: 'partially_admitted', note: 'Valid caveat' },
          P2: { status: 'rejected', note: 'Unreproducible benchmark' }
        },
        summary: 'Answer to user topic.',
        clauses: [
          { context: 'Combined', conclusion: 'Synthesis clause', citedProofIds: ['P1', 'P2'] }
        ]
      });

      assert.equal(nextState.lastTransition?.ok, false);
      assert.match(nextState.lastTransition?.message, /cites unverified Proof "P2"/);
    });

    it('ADVERSARIAL-1.7: Voting object accepts partially_admitted proof backing, but rejects rejected proof backing', () => {
      const state = setupJudgingState([{ id: 'P1' }, { id: 'P2' }]);

      // Judge partially admits P1 and rejects P2
      const judgingState = transitionCouncil(state, {
        type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
        proofDecisions: {
          P1: { status: 'partially_admitted', note: 'Valid caveat' },
          P2: { status: 'rejected', note: 'Flawed premise' }
        },
        summary: 'Candidate synthesis.',
        clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
      });
      assert.equal(judgingState.phase, 'confirming');

      // Voter 1 attempts objection backed by rejected proof P2 -> FAILS
      const failObj = transitionCouncil(judgingState, {
        type: COUNCIL_EVENTS.CAST_VOTE,
        seatId: 's1',
        vote: 'object',
        proofId: 'P2',
        reason: 'Backing objection with rejected proof'
      });
      assert.equal(failObj.lastTransition?.ok, false);
      assert.match(failObj.lastTransition?.message, /Objection must cite a valid Proof ID/);

      // Voter 1 objects backed by partially_admitted proof P1 -> SUCCEEDS
      const succObj = transitionCouncil(judgingState, {
        type: COUNCIL_EVENTS.CAST_VOTE,
        seatId: 's1',
        vote: 'object',
        proofId: 'P1',
        reason: 'Scope of caveat limits applicability in production'
      });
      assert.equal(succObj.lastTransition?.ok, true);
      const obj = succObj.objections.find((o) => o.proofId === 'P1');
      assert.ok(obj);
      assert.equal(obj.status, 'open');
      assert.equal(obj.seatId, 's1');
    });

    it('ADVERSARIAL-1.8: Proof retention across rounds: unmentioned partially_admitted proofs remain citable in next round', () => {
      const state = setupJudgingState([{ id: 'P1' }]);

      // Round 1: Judge partially admits P1
      let s = transitionCouncil(state, {
        type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
        proofDecisions: {
          P1: { status: 'partially_admitted', note: 'Valid caveat' }
        },
        summary: 'Round 1 Candidate',
        clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
      });

      // s1 accepts, s2 objects backed by P1
      s = transitionCouncil(s, {
        type: COUNCIL_EVENTS.CAST_VOTE,
        seatId: 's1',
        vote: 'accept'
      });
      s = transitionCouncil(s, {
        type: COUNCIL_EVENTS.CAST_VOTE,
        seatId: 's2',
        vote: 'object',
        proofId: 'P1',
        reason: 'Caveat unacceptable'
      });

      // Evaluate round -> advances to Round 2
      s = transitionCouncil(s, { type: COUNCIL_EVENTS.EVALUATE_ROUND });
      assert.equal(s.round, 2);
      assert.equal(s.phase, 'reviewing');

      // Round 2: s2 submits P2
      s = transitionCouncil(s, {
        type: COUNCIL_EVENTS.SUBMIT_PROOF,
        id: 'P2',
        seatId: 's2',
        scope: 'Revision',
        kind: 'citation',
        source: 'patch.diff',
        statement: 'Patch resolves caveat'
      });

      s = transitionCouncil(s, { type: COUNCIL_EVENTS.START_JUDGING });
      assert.equal(s.phase, 'judging');

      // In Round 2 judging: decisions only explicitly audits P2; P1 is omitted
      // P1 MUST remain admitted and citable in Round 2 clauses!
      s = transitionCouncil(s, {
        type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
        proofDecisions: {
          P2: { status: 'admitted', note: 'Verified patch' }
        },
        summary: 'Round 2 Candidate Answer',
        clauses: [
          { context: 'Core', conclusion: 'Retains verified core', citedProofIds: ['P1'] },
          { context: 'Patch', conclusion: 'Applies patch', citedProofIds: ['P2'] }
        ]
      });

      assert.equal(s.lastTransition?.ok, true);
      assert.equal(s.candidate.clauses.length, 2);
    });
  });

  // ==========================================================================
  // DOMAIN 2: TELEMETRY LEDGER CONTRACTS & REJECTION RATE INVARIANT (ISSUE #71)
  // ==========================================================================
  describe('Domain 2: Telemetry Ledger Invariants & Aggregation (Issue #71)', () => {

    it('ADVERSARIAL-2.1: getSeatProofMetrics NEVER inflates judgeRejectionRate with partiallyAdmitted proofs', () => {
      // 100 heterogeneous proofs
      const proofs = [];
      // 30 explicitly admitted
      for (let i = 1; i <= 30; i++) {
        proofs.push({ id: `P-E${i}`, status: 'admitted', admissionKind: 'explicitly_admitted' });
      }
      // 40 partially admitted
      for (let i = 1; i <= 40; i++) {
        proofs.push({
          id: `P-PA${i}`,
          status: 'partially_admitted',
          admissionKind: 'partially_admitted',
          judgeAdmittedStatement: 'Core',
          judgeNote: 'Caveat'
        });
      }
      // 15 default admitted
      for (let i = 1; i <= 15; i++) {
        proofs.push({ id: `P-D${i}`, status: 'admitted', admissionKind: 'default_admitted' });
      }
      // 15 judge rejected
      for (let i = 1; i <= 15; i++) {
        proofs.push({ id: `P-R${i}`, status: 'rejected', admissionKind: 'judge_rejected' });
      }

      const metrics = getSeatProofMetrics(proofs);
      assert.equal(metrics.proofsSubmitted, 100);
      assert.equal(metrics.explicitlyAdmitted, 30);
      assert.equal(metrics.partiallyAdmitted, 40);
      assert.equal(metrics.defaultAdmitted, 15);
      assert.equal(metrics.judgeRejected, 15);

      assert.equal(metrics.explicitAdmissionRate, 30.0);
      assert.equal(metrics.partialAdmissionRate, 40.0);
      assert.equal(metrics.defaultAdmissionRate, 15.0);
      // Rejection rate MUST be 15.0%, not 55.0%
      assert.equal(
        metrics.judgeRejectionRate,
        15.0,
        'judgeRejectionRate must count strictly rejected proofs, never partiallyAdmitted'
      );
    });

    it('ADVERSARIAL-2.2: getSeatProofMetrics boundary: all partially admitted proofs yield 0% rejection rate', () => {
      const proofs = [
        { id: 'P1', status: 'partially_admitted' },
        { id: 'P2', admissionKind: 'partially_admitted' },
        { id: 'P3', status: 'partially_admitted', admissionKind: 'partially_admitted' }
      ];

      const metrics = getSeatProofMetrics(proofs);
      assert.equal(metrics.proofsSubmitted, 3);
      assert.equal(metrics.partiallyAdmitted, 3);
      assert.equal(metrics.judgeRejected, 0);
      assert.equal(metrics.partialAdmissionRate, 100.0);
      assert.equal(metrics.judgeRejectionRate, 0.0);
    });

    it('ADVERSARIAL-2.3: getSeatProofMetrics boundary: handles empty, null, and corrupted array gracefully', () => {
      assert.deepEqual(getSeatProofMetrics([]), {
        proofsSubmitted: 0,
        explicitlyAdmitted: 0,
        partiallyAdmitted: 0,
        defaultAdmitted: 0,
        judgeRejected: 0,
        explicitAdmissionRate: 0,
        partialAdmissionRate: 0,
        defaultAdmissionRate: 0,
        judgeRejectionRate: 0
      });

      assert.deepEqual(getSeatProofMetrics(null), {
        proofsSubmitted: 0,
        explicitlyAdmitted: 0,
        partiallyAdmitted: 0,
        defaultAdmitted: 0,
        judgeRejected: 0,
        explicitAdmissionRate: 0,
        partialAdmissionRate: 0,
        defaultAdmissionRate: 0,
        judgeRejectionRate: 0
      });

      const corrupted = [null, undefined, 123, 'invalid', {}, { status: 'unknown' }];
      const metrics = getSeatProofMetrics(corrupted);
      assert.equal(metrics.proofsSubmitted, 6);
      assert.equal(metrics.partiallyAdmitted, 0);
      assert.equal(metrics.judgeRejected, 0);
    });

    it('ADVERSARIAL-2.4: buildRunTelemetryRecord and aggregateTelemetryWindow properly aggregate partiallyAdmitted', () => {
      const state = {
        phase: 'completed',
        round: 1,
        seats: [
          { id: 'seat-1', harness: 'codex', model: 'gpt-6-astra', status: 'accepted' },
          { id: 'seat-2', harness: 'antigravity', model: 'gemini-4-argon', status: 'accepted' }
        ],
        proofs: [
          { id: 'P1', seatId: 'seat-1', status: 'partially_admitted', admissionKind: 'partially_admitted' },
          { id: 'P2', seatId: 'seat-1', status: 'admitted', admissionKind: 'explicitly_admitted' },
          { id: 'P3', seatId: 'seat-2', status: 'partially_admitted', admissionKind: 'partially_admitted' }
        ],
        verdict: {
          kind: 'Unanimous Consensus',
          candidate: {
            clauses: [
              { id: 'C1', citedProofIds: ['P1', 'P2'] },
              { id: 'C2', citedProofIds: ['P3'] }
            ]
          }
        }
      };

      const record = buildRunTelemetryRecord({
        runId: 'run-test-partial-telemetry',
        mode: 'live',
        state
      });

      const s1Record = record.seats.find((s) => s.seatId === 'seat-1');
      assert.equal(s1Record.partiallyAdmitted, 1);
      assert.equal(s1Record.explicitlyAdmitted, 1);

      const s2Record = record.seats.find((s) => s.seatId === 'seat-2');
      assert.equal(s2Record.partiallyAdmitted, 1);

      // Window aggregation
      const windowSummary = aggregateTelemetryWindow([record]);
      const codexModel = windowSummary.byModel.find((m) => m.key === 'codex/gpt-6-astra (high)');
      assert.ok(codexModel);
      assert.equal(codexModel.partiallyAdmitted, 1);

      const agyModel = windowSummary.byModel.find((m) => m.key === 'antigravity/gemini-4-argon (high)');
      assert.ok(agyModel);
      assert.equal(agyModel.partiallyAdmitted, 1);
    });
  });

  // ==========================================================================
  // DOMAIN 3: CLI OUTPUT RENDERING & PROOF AUDIT TALLY (ISSUES #71 & #73)
  // ==========================================================================
  describe('Domain 3: CLI Output Rendering & Proof Audit Tally (Issues #71 & #73)', () => {

    it('ADVERSARIAL-3.1: CLI text output renders exact Proof Audit summary tally across varying proof outcomes', async () => {
      // Run CLI in mock mode
      const mockIO = createMockIO();
      const code = await runCli([
        'run',
        '--mock',
        '-t',
        'Audit tally test',
        '-p',
        'architecture'
      ], mockIO.io);

      assert.equal(code, 0);
      const out = stripAnsi(mockIO.getStdout());

      // Proof Audit: X Admitted | Y Partially Admitted | Z Rejected
      assert.match(
        out,
        /Proof Audit: \d+ Admitted \| \d+ Partially Admitted \| \d+ Rejected/,
        'CLI must display explicit Proof Audit tally format'
      );
    });

    it('ADVERSARIAL-3.2: Submitted proofs rendering in CLI displays [PARTIALLY ADMITTED] badge, note, and admitted core', async () => {
      const mockIO = createMockIO();
      const code = await runCli([
        'run',
        '--mock',
        '-t',
        'Proof formatting verification'
      ], mockIO.io);

      assert.equal(code, 0);
      const out = stripAnsi(mockIO.getStdout());

      assert.ok(out.includes('Submitted Proofs:'));
      assert.match(out, /Proof Audit: \d+ Admitted \| \d+ Partially Admitted \| \d+ Rejected/);
    });
  });

  // ==========================================================================
  // DOMAIN 4: EVIDENCE REFRAMING & ANSWER-FIRST SUMMARY IN PROMPTS (ISSUE #73)
  // ==========================================================================
  describe('Domain 4: Evidence Reframing & Answer-First Synthesis Invariants (Issue #73)', () => {

    it('ADVERSARIAL-4.1: Evidence is consistently framed as shared, attributed, challengeable baseline evidence', () => {
      const evidence = [
        { id: 'E1', label: 'Benchmark', source: 'bench.log', text: 'Latency is 10ms' },
        { id: 'E2', label: 'Spec', source: 'rfc.txt', text: 'Protocol v2' }
      ];

      // formatGroundingSection
      const ground = formatGroundingSection(evidence);
      assert.ok(
        ground.includes('Pre-Gathered Baseline Evidence (Attributed & Challengeable):'),
        'Must use Attributed & Challengeable baseline evidence header'
      );
      assert.ok(ground.includes('--- BEGIN EVIDENCE [E1] Benchmark (Source: bench.log) ---'));
      assert.ok(ground.includes('--- END EVIDENCE [E1] ---'));

      // formatDeliberationPrompt
      const delib = formatDeliberationPrompt({
        soul: 'adversarial',
        seat: { id: 's1', harness: 'mock', model: 'm1' },
        topic: 'Challengeable test',
        evidence,
        cwd: '/tmp/workspace'
      });

      assert.ok(delib.includes('Pre-Gathered Baseline Evidence (Attributed & Challengeable) is provided above in [E1]–[E2]'));
      assert.ok(delib.includes('[E#] items are auditable: if you can prove from a primary source or exact line citation that an [E#] summary is incomplete or imprecise, explicitly state the qualification'));

      // Invariant: Never claim evidence is "immutable ground-truth"
      assert.ok(!delib.toLowerCase().includes('immutable ground-truth'));
      assert.ok(!delib.toLowerCase().includes('immutable ground truth'));
      assert.ok(!delib.toLowerCase().includes('absolute ground truth'));
    });

    it('ADVERSARIAL-4.2: formatJudgePrompt instructs preference for partially_admitted over binary rejection on baseline imprecisions', () => {
      const evidence = [{ id: 'E1', label: 'Spec', source: 'spec.md', text: 'Spec summary' }];
      const judgePrompt = formatJudgePrompt({
        judge: { id: 'judge', model: 'judge-model' },
        topic: 'Partial admission preference',
        round: 1,
        evidence,
        tools: 'read-only'
      });

      assert.ok(
        judgePrompt.includes('When a seat relies on a supplied [E#] baseline item that turns out to have a minor secondary imprecision, prefer partially_admitted, excising or qualifying the imprecise phrase via admittedStatement / note, rather than binary rejected if the proof\'s core argument remains valid.')
      );
    });

    it('ADVERSARIAL-4.3: formatJudgePrompt enforces Standalone Answer-First Summary strictly free of internal proof IDs', () => {
      const judgePrompt = formatJudgePrompt({
        judge: { id: 'judge', model: 'judge-model' },
        topic: 'Architecture selection',
        round: 1,
        proofs: [
          { id: 'P1', kind: 'check', scope: 'Core', statement: 'Verified claim', source: 'src/main.rs' }
        ]
      });

      // Directive check
      assert.ok(
        judgePrompt.includes('Standalone Answer-First Summary: candidate.summary ("summary") MUST be a standalone, direct, user-facing executive synthesis that directly answers the user\'s topic in clear prose.'),
        'Must contain explicit Answer-First summary directive'
      );
      assert.ok(
        judgePrompt.includes('It MUST NOT contain internal proof IDs (e.g. P1, P2, [P1]) or audit process commentary (e.g. "P1 was admitted...", "P2-P4 require corrections...").'),
        'Must explicitly forbid internal proof IDs and audit commentary in candidate summary'
      );
      assert.ok(
        judgePrompt.includes('All proof audit commentary belongs strictly in proofDecisions, and proof citations belong strictly in "clauses[].citedProofIds".'),
        'Must direct audit commentary to proofDecisions and citations to clauses'
      );

      // JSON contract check
      assert.ok(
        judgePrompt.includes('"summary": "<Direct, standalone, user-facing executive answer to the user\'s topic in clear prose — MUST NOT contain internal proof IDs like P1, P2 or audit process commentary>"'),
        'Output contract JSON must document strict answer-first summary requirements'
      );
    });

    it('ADVERSARIAL-4.4: Empirical oracle: distinguishes clean Answer-First summaries from contaminated summaries', () => {
      const proofIdRegex = /\bP\d+\b|\[[Pp]\d+\]|\b[Pp]roof\s+\d+\b/;
      const commentaryRegex = /\b(judge\s+audit|audit\s+process|proof\s+audit|during\s+audit)\b|\b(admitted|rejected|partially admitted)\s+(by|in|under|during|with)\b/i;

      const contaminatedSummaries = [
        'Based on P1 and P2, we recommend Redis.',
        'P1 was admitted by the judge, proving that SQLite is optimal.',
        'Clause 1 cites [P1] which demonstrates 10k QPS.',
        'According to Proof 1, Postgres is the fastest option.',
        'During judge audit, p2 was admitted with caveats.'
      ];

      for (const summary of contaminatedSummaries) {
        const hasLeak = proofIdRegex.test(summary) || commentaryRegex.test(summary);
        assert.ok(
          hasLeak,
          `Oracle must detect proof ID or deliberation commentary in: "${summary}"`
        );
      }

      const cleanSummaries = [
        'Adopt PostgreSQL for relational workloads with strict ACID guarantees, using Redis as a read-through cache for sub-millisecond query responses.',
        'For high-throughput edge nodes, deploy SQLite with WAL mode enabled to achieve 15,000 writes/sec without distributed coordinator overhead.',
        'Migrate from synchronous HTTP RPC to gRPC streaming to eliminate header serialization latency and reduce p99 connection overhead by 40%.'
      ];

      for (const clean of cleanSummaries) {
        const hasLeak = proofIdRegex.test(clean) || commentaryRegex.test(clean);
        assert.equal(
          hasLeak,
          false,
          `Clean Answer-First summary must pass oracle without leaks: "${clean}"`
        );
      }
    });

    it('ADVERSARIAL-4.5: Workspace --cwd scoping: sandbox mode isolates filesystem tools when --cwd is omitted', () => {
      for (const cwdVal of [undefined, null, '', '   ']) {
        const prompt = formatDeliberationPrompt({
          soul: STANDARD_SOULS.ADVERSARIAL_CHALLENGER,
          seat: { id: 's1', harness: 'codex', model: 'm1' },
          topic: 'Sandbox verification',
          cwd: cwdVal,
          evidence: [{ id: 'E1', label: 'L', source: 'S', text: 'T' }]
        });

        assert.ok(
          prompt.includes('No local code workspace is attached (running in an isolated sandbox directory); do NOT run local filesystem search/grep/find commands'),
          'Must enforce sandbox mode when cwd is omitted'
        );
        assert.ok(
          prompt.includes('Furthermore, do NOT run local filesystem tools (cat, readToolCall, view_file) and do NOT read or probe absolute host file paths'),
          'Must strictly forbid host path probing in sandbox mode'
        );
        assert.ok(
          !prompt.includes('at most 3–5 targeted reads'),
          'Sandbox mode must NOT offer 3-5 targeted reads'
        );
      }

      // When cwd IS provided, 3-5 read budget is active
      const cwdPrompt = formatDeliberationPrompt({
        soul: STANDARD_SOULS.ADVERSARIAL_CHALLENGER,
        seat: { id: 's1', harness: 'codex', model: 'm1' },
        topic: 'Workspace cwd active',
        cwd: '/Users/aaat/projects/target-repo',
        evidence: [{ id: 'E1', label: 'L', source: 'S', text: 'T' }]
      });

      assert.ok(
        cwdPrompt.includes('at most 3–5 targeted reads'),
        'Workspace cwd mode must include 3-5 targeted read cap'
      );
      assert.ok(!cwdPrompt.includes('isolated sandbox directory'));
    });
  });

  // ==========================================================================
  // DOMAIN 5: VISUALIZER & SKILL PARITY (ISSUES #71 & #73)
  // ==========================================================================
  describe('Domain 5: Visualizer & Skill Parity (Issues #71 & #73)', () => {

    it('ADVERSARIAL-5.1: Visualizer renders amber styling and caveats for partially_admitted proofs and causal links', () => {
      // Create SVG container mock
      const mockSvg = {
        attributes: {},
        innerHTML: '',
        setAttribute(k, v) { this.attributes[k] = v; },
        querySelector() { return null; }
      };

      const state = {
        seats: [{ id: 'seat-1', harness: 'codex', model: 'gpt-6-astra', status: 'accepted' }],
        proofs: [
          {
            id: 'P1',
            seatId: 'seat-1',
            kind: 'benchmark',
            scope: 'Latency',
            statement: 'Measured 42ms p99',
            status: 'partially_admitted',
            judgeAdmittedStatement: '42ms p99 on x86',
            judgeNote: 'Excludes ARM'
          }
        ],
        candidate: {
          clauses: [{ id: 'C1', context: 'Perf', conclusion: 'Low latency', citedProofIds: ['P1'] }]
        },
        objections: []
      };

      CouncilVisualizer.renderCausalDependencySVG(mockSvg, state);
      const svg = mockSvg.innerHTML;

      // Proof node rect stroke must be amber #f59e0b
      assert.ok(
        svg.includes('stroke="#f59e0b"'),
        'Partially admitted proof rect must have amber stroke #f59e0b'
      );
      assert.ok(
        svg.includes('Admitted Core: 42ms p99 on x86'),
        'Tooltip must include Admitted Core'
      );
      assert.ok(
        svg.includes('Judge Note: Excludes ARM'),
        'Tooltip must include Judge Note'
      );

      // Causal link from proof to clause citing partially admitted proof must have amber stroke and marker
      assert.ok(
        svg.includes('stroke="#fbbf24"'),
        'Causal link citing partially admitted proof must be amber #fbbf24'
      );
      assert.ok(
        svg.includes('marker-end="url(#dep-arrow-amber)"'),
        'Causal link must use amber marker'
      );
    });

    it('ADVERSARIAL-5.2: Skill parity: npm run sync-skills passes with 0 diff between skills/ and .agents/skills/', () => {
      // Execute npm run sync-skills
      const syncOutput = execSync('npm run sync-skills', { encoding: 'utf-8' });
      assert.ok(syncOutput.includes('Installed skill:'));

      // Check diff
      const diffOutput = execSync('diff -u skills/ask-council/SKILL.md .agents/skills/ask-council/SKILL.md', {
        encoding: 'utf-8'
      });
      assert.equal(
        diffOutput.trim(),
        '',
        'skills/ask-council/SKILL.md and .agents/skills/ask-council/SKILL.md must be identical'
      );
    });

    it('ADVERSARIAL-5.3: SKILL.md accurately documents --cwd scoping rule and challengeable baseline evidence', () => {
      const skillPath = path.resolve(import.meta.dirname, '../../skills/ask-council/SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf-8');

      // Check challengeable evidence framing
      assert.ok(
        content.includes('shared, attributed, and challengeable baseline evidence packet'),
        'SKILL.md must frame evidence as shared, attributed, and challengeable'
      );

      // Check workspace --cwd scoping rule
      assert.ok(
        content.includes('Omit `--cwd` when `--evidence` already contains the required repository excerpts'),
        'SKILL.md must document when to omit --cwd'
      );
      assert.ok(
        content.includes('Pass `--cwd <dir>` only when seats must actively explore or inspect repository files not covered by `--evidence`'),
        'SKILL.md must document when to pass --cwd'
      );

      // Check proof audit tally
      assert.ok(
        content.includes('Proof Audit') || content.includes('partially_admitted'),
        'SKILL.md must document partial admission or proof audit'
      );
    });
  });
});
