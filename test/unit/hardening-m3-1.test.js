/**
 * @fileoverview Unit Test Suite for Milestone 3 Production Hardening
 * Verifies all 5 hardening mitigations in src/engine/council-engine.js and src/cli/index.js:
 * 1. Judge Candidate Synthesis Rejection Recovery (retry success and bounded fault termination).
 * 2. Seat Invalid Objection Citation Fault Handling (retry recovery, no false telemetry, and excusal).
 * 3. Multi-Round BEGIN_ROUND Guard Check (preventing spurious rejections and duplicate snapshots).
 * 4. Pre-Aborted Signal Constructor Initialization (immediate abort state).
 * 5. CLI Inspect Nested Snapshots Array Unwrapping.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { CouncilEngine } from '../../src/engine/index.js';
import { MockAdapter } from '../../src/harness/mock.js';
import { runCli } from '../../src/cli/index.js';

describe('Unit: Milestone 3 Production Hardening Mitigations (worker_m3_1)', () => {

  function createMockIO() {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let exitCode = null;

    return {
      io: {
        stdout: { write: (text) => { stdoutBuffer += text; } },
        stderr: { write: (text) => { stderrBuffer += text; } },
        exit: (code) => { exitCode = code; return code; }
      },
      getStdout: () => stdoutBuffer,
      getStderr: () => stderrBuffer,
      getExitCode: () => exitCode
    };
  }

  // ==========================================================================
  // FINDING 1: JUDGE CANDIDATE SYNTHESIS RECOVERY
  // ==========================================================================
  describe('Finding 1: Judge Candidate Synthesis Recovery', () => {
    it('should recover when Judge fails candidate synthesis on first attempt but succeeds on retry', async () => {
      const mockAdapter = new MockAdapter();
      let judgeAttempts = 0;

      mockAdapter.executeJudgeAuditAndSynthesis = async () => {
        judgeAttempts++;
        if (judgeAttempts === 1) {
          // Attempt 1: Malformed candidate (empty clauses array)
          return {
            summary: 'Malformed candidate',
            proofDecisions: { P1: { status: 'admitted' } },
            clauses: []
          };
        }
        // Attempt 2: Valid candidate citing admitted proof P1
        return {
          summary: 'Valid candidate on retry',
          proofDecisions: { P1: { status: 'admitted' } },
          clauses: [{ context: 'Core', conclusion: 'Passed', citedProofIds: ['P1'] }]
        };
      };

      const engine = new CouncilEngine({
        topic: 'Judge Retry Success',
        maxRounds: 2,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 's' },
          { id: 's2', harness: 'mock', model: 'm', soul: 's' }
        ]
      }, { harnessResolver: () => mockAdapter });

      const guardRejections = [];
      engine.getTelemetry().on('guard_rejected', (d) => guardRejections.push(d));

      const result = await engine.run();

      // Verify recovery and consensus
      assert.equal(judgeAttempts, 2, 'Judge was invoked twice (initial + retry)');
      assert.equal(engine.state.judge.retries, 1, 'Judge recorded 1 retry');
      assert.equal(result.ok, true, 'Deliberation succeeded in reaching consensus');
      assert.equal(result.verdict.kind, 'Unanimous Consensus');
      assert.equal(guardRejections.length, 1, 'Exactly one guard rejection recorded for first malformed attempt');
      assert.match(guardRejections[0].message, /Candidate requires at least one clause/);
    });

    it('should terminate with Dissent Report (Judge Fault) when Judge retries are exhausted', async () => {
      const mockAdapter = new MockAdapter();
      let judgeAttempts = 0;

      mockAdapter.executeJudgeAuditAndSynthesis = async () => {
        judgeAttempts++;
        return {
          summary: 'Persistently invalid candidate',
          proofDecisions: { P1: { status: 'admitted' } },
          clauses: [] // Always invalid
        };
      };

      const engine = new CouncilEngine({
        topic: 'Judge Retry Exhaustion',
        maxRounds: 3,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 's' },
          { id: 's2', harness: 'mock', model: 'm', soul: 's' }
        ]
      }, { harnessResolver: () => mockAdapter });

      const result = await engine.run();

      assert.equal(judgeAttempts, 2, 'Attempted initial + 1 retry before exhaustion');
      assert.equal(engine.state.judge.retries, 1);
      assert.equal(result.ok, false);
      assert.equal(result.verdict.kind, 'Dissent Report (Judge Fault)');
      assert.match(result.verdict.note, /Judge candidate synthesis failed/);
      assert.equal(engine.isCompleted(), true);
    });
  });

  // ==========================================================================
  // FINDING 2: SEAT INVALID OBJECTION CITATION FAULT HANDLING
  // ==========================================================================
  describe('Finding 2: Seat Invalid Objection Citation Fault Handling', () => {
    it('should retry faulted seat when objection cites invalid proof, succeeding when corrected on retry', async () => {
      const mockAdapter = new MockAdapter();
      let voterAttempts = 0;

      mockAdapter.executeSeatVote = async ({ seat }) => {
        if (seat.id === 'seat-objector') {
          voterAttempts++;
          if (voterAttempts === 1) {
            return { vote: 'object', reason: 'Invalid Proof ID', proofId: 'NON_EXISTENT_PROOF' };
          }
          // Correct citation on retry (P1 submitted by active seats)
          return { vote: 'object', reason: 'Valid Objection', proofId: 'P1' };
        }
        return { vote: 'accept' };
      };

      const engine = new CouncilEngine({
        topic: 'Seat Objection Retry Recovery',
        maxRounds: 2,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        seats: [
          { id: 'seat-voter', harness: 'mock', model: 'm', soul: 's' },
          { id: 'seat-objector', harness: 'mock', model: 'm', soul: 's' }
        ]
      }, { harnessResolver: () => mockAdapter });

      const falseTelemetry = [];
      engine.getTelemetry().on('seat_telemetry', (d) => {
        if (d.seatId === 'seat-objector' && d.status === 'objected') falseTelemetry.push(d);
      });

      engine.initRoster();
      const roundRes = await engine.runRound();

      // On attempt 1, guard rejected and no false telemetry was emitted
      // On attempt 2, valid objection was cast, advancing round to round 2
      assert.equal(voterAttempts, 2, 'Seat retried vote');
      assert.equal(engine.state.round, 2, 'Round advanced to 2 because open objection remains');
      assert.equal(engine.state.objections.length, 1, 'Valid objection recorded');
      assert.equal(engine.state.objections[0].proofId, 'P1');
      assert.equal(falseTelemetry.length, 1, 'Exactly one telemetry event emitted after valid citation');
    });

    it('should excuse seat and maintain quorum when other seats meet minQuorum', async () => {
      const mockAdapter = new MockAdapter();

      mockAdapter.executeSeatVote = async ({ seat }) => {
        if (seat.id === 's3-bad-citation') {
          return { vote: 'object', reason: 'Bad citation', proofId: 'NON_EXISTENT_PROOF' };
        }
        return { vote: 'accept' };
      };

      const engine = new CouncilEngine({
        topic: 'Seat Excusal Quorum Maintenance',
        maxRounds: 2,
        minQuorum: 2,
        maxRetriesPerSeat: 0, // Excuse immediately
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 's' },
          { id: 's2', harness: 'mock', model: 'm', soul: 's' },
          { id: 's3-bad-citation', harness: 'mock', model: 'm', soul: 's' }
        ]
      }, { harnessResolver: () => mockAdapter });

      const result = await engine.run();

      // s3 faulted and was excused; remaining 2 seats (s1, s2) meet minQuorum (2) and accept
      assert.equal(result.ok, true);
      assert.equal(result.verdict.kind, 'Unanimous Consensus');
      assert.equal(result.verdict.activeSeatCount, 2);
      assert.equal(result.verdict.excusedSeatCount, 1);
      const s3 = engine.state.seats.find((s) => s.id === 's3-bad-citation');
      assert.equal(s3.status, 'excused');
    });
  });

  // ==========================================================================
  // FINDING 3: MULTI-ROUND BEGIN_ROUND GUARD CHECK
  // ==========================================================================
  describe('Finding 3: Multi-Round BEGIN_ROUND Telemetry Cleanliness', () => {
    it('should run a 3-round deliberation without any spurious BEGIN_ROUND guard rejections', async () => {
      const mockAdapter = new MockAdapter();

      // Round 1: seat-obj objects to P1
      // Round 2: seat-obj objects to P1
      // Round 3: all accept
      mockAdapter.executeSeatVote = async ({ seat, round }) => {
        if (seat.id === 'seat-obj') {
          if (round === 1) return { vote: 'object', reason: 'Round 1 Objection', proofId: 'P1' };
          if (round === 2) return { vote: 'object', reason: 'Round 2 Objection', proofId: 'P1' };
        }
        return { vote: 'accept' };
      };

      const engine = new CouncilEngine({
        topic: '3-Round Clean Telemetry',
        maxRounds: 3,
        minQuorum: 2,
        seats: [
          { id: 'seat-ok', harness: 'mock', model: 'm', soul: 's' },
          { id: 'seat-obj', harness: 'mock', model: 'm', soul: 's' }
        ]
      }, { harnessResolver: () => mockAdapter });

      const guardRejections = [];
      engine.getTelemetry().on('guard_rejected', (d) => guardRejections.push(d));

      const result = await engine.run();

      assert.equal(result.ok, true);
      assert.equal(engine.state.round, 3);
      assert.equal(guardRejections.length, 0, 'Zero guard rejections across entire 3-round deliberation');

      const snapshots = engine.getTelemetry().getSnapshots();
      const beginRoundSnapshots = snapshots.filter((s) => s.event.type === 'BEGIN_ROUND');
      assert.equal(beginRoundSnapshots.length, 1, 'Only Round 1 stepped BEGIN_ROUND');
      assert.equal(beginRoundSnapshots[0].stateSnapshot.lastTransition.ok, true);
    });
  });

  // ==========================================================================
  // FINDING 4: PRE-ABORTED SIGNAL CONSTRUCTOR CHECK
  // ==========================================================================
  describe('Finding 4: Pre-Aborted Signal Constructor Check', () => {
    it('should initialize engine.aborted to true when given a pre-aborted signal', async () => {
      const preAborted = AbortSignal.abort('Operation pre-emptively cancelled');
      assert.equal(preAborted.aborted, true);

      const engine = new CouncilEngine({
        topic: 'Pre-aborted Engine',
        minQuorum: 2,
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 's' },
          { id: 's2', harness: 'mock', model: 'm', soul: 's' }
        ]
      }, { signal: preAborted });

      assert.equal(engine.aborted, true, 'engine.aborted initialized to true');
      const result = await engine.run();
      assert.equal(result.ok, false);
      assert.equal(engine.state.round, 0);
    });
  });

  // ==========================================================================
  // FINDING 5: CLI INSPECT NESTED SNAPSHOTS ARRAY UNWRAPPING
  // ==========================================================================
  describe('Finding 5: CLI Inspect Nested Snapshots Array Unwrapping', () => {
    it('should inspect nested snapshots object { ok: true, snapshots: [...] } from JSON runner', async () => {
      const mockIO = createMockIO();
      const tmpFile = path.join(os.tmpdir(), `nested-snapshots-${Date.now()}.json`);

      const payload = {
        ok: true,
        verdict: { kind: 'Unanimous Consensus' },
        snapshots: [
          { sequence: 1, event: { type: 'BEGIN_ROUND' }, metrics: { phase: 'reviewing', round: 1 } },
          { sequence: 2, event: { type: 'SUBMIT_PROOF' }, metrics: { phase: 'reviewing', round: 1 } },
          { sequence: 3, event: { type: 'EVALUATE_ROUND' }, metrics: { phase: 'completed', round: 1 } }
        ]
      };
      fs.writeFileSync(tmpFile, JSON.stringify(payload));

      try {
        const exitCode = await runCli(['inspect', tmpFile], mockIO.io);
        assert.equal(exitCode, 0);
        assert.match(mockIO.getStdout(), /Trajectory contains 3 snapshots:/);
        assert.match(mockIO.getStdout(), /\[1\] BEGIN_ROUND -> Phase: reviewing \(Round 1\)/);
        assert.match(mockIO.getStdout(), /\[2\] SUBMIT_PROOF -> Phase: reviewing \(Round 1\)/);
        assert.match(mockIO.getStdout(), /\[3\] EVALUATE_ROUND -> Phase: completed \(Round 1\)/);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });

    it('should inspect empty nested snapshots object { snapshots: [] } without error', async () => {
      const mockIO = createMockIO();
      const tmpFile = path.join(os.tmpdir(), `empty-snapshots-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({ snapshots: [] }));

      try {
        const exitCode = await runCli(['inspect', tmpFile], mockIO.io);
        assert.equal(exitCode, 0);
        assert.match(mockIO.getStdout(), /Trajectory contains 0 snapshots:/);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });
  });
});
