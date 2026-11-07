import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  validateConfig,
  resolveConfig,
  loadConfigFile,
  CouncilEngine,
  createCouncilEngine
} from '../../src/engine/index.js';
import { MockAdapter } from '../../src/harness/mock.js';
import {
  QuotaExhaustionError,
  HarnessExecutionError,
  AuthenticationError,
  TimeoutError
} from '../../src/harness/adapter.js';

describe('Unit: Council Engine Coordinator & Config (src/engine/)', () => {
  describe('Config Validation & Resolution', () => {
    it('validates a correct configuration object', () => {
      const res = validateConfig({
        topic: 'Which database?',
        maxRounds: 3,
        minQuorum: 2,
        maxClarificationBatches: 2,
        maxRetriesPerSeat: 1,
        judge: { id: 'j1', harness: 'codex' },
        seats: [
          { id: 's1', harness: 'codex', model: 'm', soul: 'soul1' },
          { id: 's2', harness: 'cursor', model: 'm', soul: 'soul2' }
        ]
      });
      assert.equal(res.valid, true);
    });

    it('rejects invalid parameters and seat constraints', () => {
      assert.equal(validateConfig(null).valid, false);
      assert.equal(validateConfig({ topic: '' }).valid, false);
      assert.equal(validateConfig({ topic: 'T', maxRounds: 0 }).valid, false);
      assert.equal(validateConfig({ topic: 'T', minQuorum: 0 }).valid, false);
      assert.equal(validateConfig({ topic: 'T', minQuorum: 3, seats: [{ id: 's1', harness: 'h', model: 'm', soul: 's' }] }).valid, false); // seats < minQuorum
      assert.equal(validateConfig({ topic: 'T', minQuorum: 2, seats: [{ id: 's1', harness: 'h', model: 'm', soul: 's' }, { id: 's1', harness: 'h', model: 'm', soul: 's' }] }).valid, false); // duplicate
    });

    it('resolveConfig applies defaults and freezes output', () => {
      const resolved = resolveConfig({ topic: 'Default Test' });
      assert.equal(resolved.topic, 'Default Test');
      assert.equal(resolved.minQuorum, 2);
      assert.equal(resolved.maxRounds, 3);
      assert.equal(resolved.judge.id, 'judge-astra');
      assert.equal(resolved.seats.length, 3);
      assert.ok(Object.isFrozen(resolved));
    });

    it('loadConfigFile loads and parses JSON file', () => {
      const tmpFile = path.join(os.tmpdir(), `council-cfg-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        topic: 'Loaded Topic',
        minQuorum: 2,
        seats: [
          { id: 's1', harness: 'codex', model: 'm', soul: 's' },
          { id: 's2', harness: 'codex', model: 'm', soul: 's' }
        ]
      }));

      try {
        const cfg = loadConfigFile(tmpFile, { maxRounds: 5 });
        assert.equal(cfg.topic, 'Loaded Topic');
        assert.equal(cfg.maxRounds, 5);
        assert.equal(cfg.seats.length, 2);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('loadConfigFile throws on missing file or malformed JSON', () => {
      assert.throws(() => loadConfigFile('/nonexistent/path/config.json'), /not found/);

      const badFile = path.join(os.tmpdir(), `council-bad-${Date.now()}.json`);
      fs.writeFileSync(badFile, '{ bad json');
      try {
        assert.throws(() => loadConfigFile(badFile), /Malformed JSON/);
      } finally {
        fs.unlinkSync(badFile);
      }
    });
  });

  describe('CouncilEngine Coordinator Lifecycle', () => {
    it('initializes dynamic roster via initRoster', () => {
      const engine = createCouncilEngine({
        topic: 'Topic',
        minQuorum: 2,
        seats: [
          { id: 's1', harness: 'codex', model: 'm', soul: 's1' },
          { id: 's2', harness: 'antigravity', model: 'm', soul: 's2' }
        ]
      });

      assert.equal(engine.state.seats.length, 0);
      engine.initRoster();
      assert.equal(engine.state.seats.length, 2);
      assert.equal(engine.state.seats[0].id, 's1');
      assert.equal(engine.state.seats[1].id, 's2');
    });

    it('runs Discovery phase with clarification batches', async () => {
      const engine = createCouncilEngine({
        topic: 'Discovery Topic',
        clarifications: [
          { answer: 'Target workload is containerized cloud' },
          { answer: 'Target latency SLA is p99 < 50ms' }
        ]
      });

      engine.initRoster();
      await engine.runDiscovery(engine.config.clarifications);

      assert.equal(engine.state.clarifications.length, 2);
      assert.match(engine.state.clarifications[0].answer, /containerized cloud/);
      assert.match(engine.state.clarifications[1].answer, /p99 < 50ms/);
    });

    it('executes a round and achieves Unanimous Consensus with default mock harness', async () => {
      const engine = new CouncilEngine({
        topic: 'Evaluation Topic',
        minQuorum: 2,
        seats: [
          { id: 's1', harness: 'mock', model: 'm', soul: 'Kernel Purist' },
          { id: 's2', harness: 'mock', model: 'm', soul: 'Gamer' }
        ]
      });

      const result = await engine.run();
      assert.equal(result.ok, true);
      assert.equal(result.verdict.kind, 'Unanimous Consensus');
      assert.equal(result.verdict.activeSeatCount, 2);
      assert.equal(result.verdict.excusedSeatCount, 0);
      assert.equal(engine.state.round, 1);
      assert.ok(result.snapshots.length >= 8); // Recorded state transitions
    });

    it('handles seat fault with bounded retry and excusal', async () => {
      const mockHarness = new MockAdapter();

      // Configure grok-1 to fault on deliberation proof submission
      mockHarness.injectSeatFault('grok-1', {
        round: 1,
        phase: 'DELIBERATION',
        error: new QuotaExhaustionError('Weekly pool exhausted (429)')
      });

      const engine = new CouncilEngine(
        {
          topic: 'Fault Recovery',
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          seats: [
            { id: 's1', harness: 'mock', model: 'm', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'm', soul: 'S2' },
            { id: 'grok-1', harness: 'mock', model: 'm', soul: 'Contrarian' }
          ]
        },
        {
          harnessResolver: () => mockHarness
        }
      );

      const result = await engine.run();
      assert.equal(result.ok, true);
      assert.equal(result.verdict.kind, 'Unanimous Consensus');
      assert.equal(result.verdict.activeSeatCount, 2);
      assert.equal(result.verdict.excusedSeatCount, 1);

      const grokSeat = engine.state.seats.find((s) => s.id === 'grok-1');
      assert.equal(grokSeat.status, 'excused');
      assert.match(grokSeat.excusedReason, /Weekly pool exhausted/);
    });

    it('terminates immediately in Dissent Report (Below Quorum) when excusal drops seats below minQuorum', async () => {
      const mockHarness = new MockAdapter();

      // Council has 2 seats, minQuorum is 2. Excusing s2 drops active seats to 1 (< 2).
      mockHarness.injectSeatFault('s2', {
        round: 1,
        phase: 'DELIBERATION',
        maxTriggers: 5,
        error: new QuotaExhaustionError('Hard quota exhaustion')
      });

      const engine = new CouncilEngine(
        {
          topic: 'Quorum Failure',
          minQuorum: 2,
          maxRetriesPerSeat: 0, // No retries -> immediate excusal
          seats: [
            { id: 's1', harness: 'mock', model: 'm', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'm', soul: 'S2' }
          ]
        },
        {
          harnessResolver: () => mockHarness
        }
      );

      const result = await engine.run();
      assert.equal(result.ok, false);
      assert.equal(result.verdict.kind, 'Dissent Report (Below Quorum)');
      assert.equal(result.verdict.activeSeatCount, 1);
      assert.equal(result.verdict.excusedSeatCount, 1);
    });

    it('preserves excused seat objections and terminates in Dissent Report', async () => {
      const mockHarness = new MockAdapter();

      // Script s2 to object in round 1
      mockHarness.scriptSeatResponse({
        seatId: 's2',
        round: 1,
        phase: 'VOTING',
        response: { vote: 'object', reason: 'Security boundary breach', proofId: 'P2' }
      });

      // s2 faults in round 2 and is excused
      mockHarness.injectSeatFault('s2', {
        round: 2,
        phase: 'DELIBERATION',
        error: new QuotaExhaustionError('Quota expired')
      });

      const engine = new CouncilEngine(
        {
          topic: 'Preserved Objection Test',
          minQuorum: 2,
          maxRounds: 3,
          maxRetriesPerSeat: 0,
          seats: [
            { id: 's1', harness: 'mock', model: 'm', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'm', soul: 'S2' },
            { id: 's3', harness: 'mock', model: 'm', soul: 'S3' }
          ]
        },
        {
          harnessResolver: () => mockHarness
        }
      );

      const result = await engine.run();
      assert.equal(result.ok, false);
      assert.equal(result.verdict.kind, 'Dissent Report (Preserved Excused-Seat Objection)');
      assert.equal(result.verdict.unresolvedObjections.length, 1);
      assert.equal(result.verdict.unresolvedObjections[0].status, 'preserved_excused');
    });

    it('respects AbortSignal cancellation', async () => {
      const controller = new AbortController();
      const engine = new CouncilEngine(
        { topic: 'Abort Test', seats: [{ id: 's1', harness: 'mock', model: 'm', soul: 's' }, { id: 's2', harness: 'mock', model: 'm', soul: 's' }] },
        { signal: controller.signal }
      );

      controller.abort();
      const result = await engine.run();
      assert.equal(engine.aborted, true);
    });

    it('does not retry a Seat when the error is non-retryable (isRetryable === false)', async () => {
      const mockHarness = new MockAdapter();
      let badSeatCalls = 0;

      const origExecute = mockHarness.executeSeat.bind(mockHarness);
      mockHarness.executeSeat = async (ctx) => {
        if (ctx.seat.id === 's3-bad-model') {
          badSeatCalls += 1;
          throw new HarnessExecutionError(
            'Harness "codex" rejects forbidden model "gemini-3.1-pro". Allowed families: gpt-*',
            { harness: 'codex', isRetryable: false }
          );
        }
        return origExecute(ctx);
      };

      const engine = new CouncilEngine(
        {
          topic: 'Non-retryable Seat Fault',
          minQuorum: 2,
          maxRetriesPerSeat: 2,
          seats: [
            { id: 's1', harness: 'mock', model: 'm', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'm', soul: 'S2' },
            { id: 's3-bad-model', harness: 'mock', model: 'gemini-3.1-pro', soul: 'S3' }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      const result = await engine.run();
      assert.equal(badSeatCalls, 1, 'Non-retryable seat error must not be retried');
      const s3 = engine.state.seats.find((s) => s.id === 's3-bad-model');
      assert.equal(s3.retries, 0, 'Seat retries counter must remain 0');
      assert.equal(s3.status, 'excused');
      assert.match(s3.excusedReason, /rejects forbidden model/);
      assert.equal(result.ok, true);
    });

    it('does not retry the Judge when the error is non-retryable (isRetryable === false)', async () => {
      const mockHarness = new MockAdapter();
      let judgeCalls = 0;

      mockHarness.executeJudgeAuditAndSynthesis = async () => {
        judgeCalls += 1;
        throw new AuthenticationError('Antigravity authentication failed (401)', { harness: 'antigravity' });
      };

      const engine = new CouncilEngine(
        {
          topic: 'Non-retryable Judge Fault',
          minQuorum: 2,
          maxRetriesPerSeat: 2,
          seats: [
            { id: 's1', harness: 'mock', model: 'm', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'm', soul: 'S2' }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      const result = await engine.run();
      assert.equal(judgeCalls, 1, 'Non-retryable judge error must not be retried');
      assert.equal(engine.state.judge.retries, 0, 'Judge retries counter must remain 0');
      assert.equal(result.ok, false);
      assert.equal(result.verdict.kind, 'Dissent Report (Judge Fault)');
      assert.match(result.verdict.note, /Antigravity authentication failed/);
    });

    it('classifies TimeoutError as fault_timeout (not fault_quota) and does not label timeout excusals as quota', async () => {
      const mockHarness = new MockAdapter();
      const origExecuteSeat = mockHarness.executeSeat.bind(mockHarness);
      mockHarness.executeSeat = async (ctx) => {
        if (ctx.seat.id === 's3-timeout') {
          throw new TimeoutError('Harness "cursor" execution timed out after 240000ms for seat "s3-timeout"', {
            harness: 'cursor',
            seatId: 's3-timeout',
            timeoutMs: 240000
          });
        }
        return origExecuteSeat(ctx);
      };
      mockHarness.executeJudgeAuditAndSynthesis = async () => {
        throw new TimeoutError('Harness "codex" execution timed out after 240000ms for seat "judge-astra"', {
          harness: 'codex',
          seatId: 'judge-astra',
          timeoutMs: 240000
        });
      };

      const engine = new CouncilEngine(
        {
          topic: 'Timeout Fault Classification',
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          seats: [
            { id: 's1', harness: 'mock', model: 'm', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'm', soul: 'S2' },
            { id: 's3-timeout', harness: 'mock', model: 'm', soul: 'S3' }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      const telemetryStatuses = [];
      engine.getTelemetry().on('seat_telemetry', (evt) => {
        telemetryStatuses.push(evt);
      });

      const result = await engine.run();

      // Neither seat nor judge timeout should ever emit fault_quota
      const quotaTelemetry = telemetryStatuses.filter((t) => t.status === 'fault_quota');
      assert.equal(quotaTelemetry.length, 0, 'Timeout faults must never emit fault_quota status');

      const seatTimeoutTelemetry = telemetryStatuses.filter(
        (t) => t.seatId === 's3-timeout' && t.status === 'fault_timeout'
      );
      assert.ok(seatTimeoutTelemetry.length >= 1, 'Seat timeout must emit fault_timeout status');
      assert.match(seatTimeoutTelemetry[0].metadata?.reason || '', /timed out after 240000ms/);

      const judgeTimeoutTelemetry = telemetryStatuses.filter(
        (t) => t.seatId === engine.state.judge.id && t.status === 'fault_timeout'
      );
      assert.ok(judgeTimeoutTelemetry.length >= 1, 'Judge timeout must emit fault_timeout status');
      assert.equal(result.state.judge.status, 'fault_timeout');

      const s3 = result.state.seats.find((s) => s.id === 's3-timeout');
      assert.equal(s3.status, 'excused');
      assert.match(s3.excusedReason, /Exhausted retries \(1\/1\):.*timed out after 240000ms/);
      assert.doesNotMatch(s3.excusedReason, /or quota/i);
    });

    it('surfaces CLI exitCode and stderr in Seat and Judge fault reasons and classifies generic execution failures as fault', async () => {
      const mockHarness = new MockAdapter();
      const origExecuteSeat = mockHarness.executeSeat.bind(mockHarness);
      mockHarness.executeSeat = async (ctx) => {
        if (ctx.seat.id === 's3-cli-err') {
          throw new HarnessExecutionError('Codex model policy rejected "quota-model" (429)', {
            harness: 'codex',
            seatId: 's3-cli-err',
            exitCode: 2,
            stderr: 'error: unexpected argument --unknown-flag (quota check)'
          });
        }
        return origExecuteSeat(ctx);
      };
      mockHarness.executeJudgeAuditAndSynthesis = async () => {
        throw new HarnessExecutionError('Judge CLI crashed', {
          harness: 'antigravity',
          seatId: 'judge-astra',
          exitCode: 127,
          stderr: 'zsh: command not found: agy'
        });
      };

      const engine = new CouncilEngine(
        {
          topic: 'CLI ExitCode and Stderr Surfacing',
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          seats: [
            { id: 's1', harness: 'mock', model: 'm', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'm', soul: 'S2' },
            { id: 's3-cli-err', harness: 'mock', model: 'm', soul: 'S3' }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      const telemetryStatuses = [];
      engine.getTelemetry().on('seat_telemetry', (evt) => {
        telemetryStatuses.push(evt);
      });

      const result = await engine.run();

      const seatFaultTelemetry = telemetryStatuses.find(
        (t) => t.seatId === 's3-cli-err' && t.status === 'fault'
      );
      assert.ok(seatFaultTelemetry, 'Seat CLI error must emit status "fault"');
      assert.match(seatFaultTelemetry.metadata?.reason || '', /exit code 2/);
      assert.match(seatFaultTelemetry.metadata?.reason || '', /stderr: error: unexpected argument --unknown-flag/);

      const s3 = result.state.seats.find((s) => s.id === 's3-cli-err');
      assert.match(s3.excusedReason, /exit code 2/);
      assert.match(s3.excusedReason, /stderr: error: unexpected argument --unknown-flag/);

      assert.equal(result.state.judge.status, 'fault');
      assert.match(result.verdict.note, /exit code 127/);
      assert.match(result.verdict.note, /stderr: zsh: command not found: agy/);
    });

    it('classifies TimeoutError as fault_timeout even when seatId contains "quota" or timeoutMs contains "429" (e.g. 42900ms)', async () => {
      const mockHarness = new MockAdapter();
      const origExecuteSeat = mockHarness.executeSeat.bind(mockHarness);
      mockHarness.executeSeat = async (ctx) => {
        if (ctx.seat.id === 'quota-analyst') {
          throw new TimeoutError('Seat "quota-analyst" timed out after 42900ms', {
            harness: 'codex',
            seatId: 'quota-analyst',
            timeoutMs: 42900
          });
        }
        return origExecuteSeat(ctx);
      };
      mockHarness.executeJudgeAuditAndSynthesis = async () => {
        throw new TimeoutError('Judge "judge-quota-auditor" timed out after 42900ms', {
          harness: 'codex',
          seatId: 'judge-quota-auditor',
          timeoutMs: 42900
        });
      };

      const engine = new CouncilEngine(
        {
          topic: 'Timeout vs Quota Collision Test',
          minQuorum: 2,
          maxRetriesPerSeat: 0,
          judge: { id: 'judge-quota-auditor', harness: 'mock', model: 'm', soul: 'J' },
          seats: [
            { id: 's1', harness: 'mock', model: 'm', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'm', soul: 'S2' },
            { id: 'quota-analyst', harness: 'mock', model: 'm', soul: 'S3' }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      const telemetryStatuses = [];
      engine.getTelemetry().on('seat_telemetry', (evt) => {
        telemetryStatuses.push(evt);
      });

      const result = await engine.run();

      const seatTimeoutTelemetry = telemetryStatuses.find(
        (t) => t.seatId === 'quota-analyst' && t.status === 'fault_timeout'
      );
      assert.ok(seatTimeoutTelemetry, 'TimeoutError on seat "quota-analyst" (42900ms) must emit fault_timeout');
      assert.equal(seatTimeoutTelemetry.metadata?.errorClass, 'TimeoutError');
      assert.match(seatTimeoutTelemetry.metadata?.reason || '', /^\[TimeoutError\]/);
      assert.equal(
        telemetryStatuses.some((t) => t.seatId === 'quota-analyst' && t.status === 'fault_quota'),
        false,
        'TimeoutError must not be misclassified as fault_quota'
      );
      assert.equal(result.state.judge.status, 'fault_timeout');
      assert.equal(result.state.judge.errorClass, 'TimeoutError');
      assert.match(result.state.judge.faultReason, /^\[TimeoutError\]/);
    });

    it('includes error class name and collapses/bounds multi-line stderr to a single-line excerpt', async () => {
      const mockHarness = new MockAdapter();
      const longMultilineStderr =
        'line 1: fatal CLI crash\nline 2: stack trace frame A\n' + 'x'.repeat(500);
      mockHarness.executeSeat = async (ctx) => {
        if (ctx.seat.id === 's3-noisy') {
          throw new HarnessExecutionError('CLI exited unexpectedly', {
            harness: 'codex',
            seatId: 's3-noisy',
            exitCode: 1,
            stderr: longMultilineStderr
          });
        }
        return {
          scope: 'Scope',
          kind: 'check',
          source: 'Source',
          statement: 'Valid proof statement'
        };
      };
      mockHarness.executeJudgeAuditAndSynthesis = async () => {
        // Return malformed candidate clauses (citing non-existent proof P999) to trigger InvalidResponseError guard
        return {
          summary: 'Bad synthesis',
          proofDecisions: { P1: { status: 'admitted', note: 'ok' } },
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P999'] }]
        };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Bounded Single-Line Stderr & InvalidResponseError Guard Test',
          minQuorum: 2,
          maxRetriesPerSeat: 0,
          seats: [
            { id: 's1', harness: 'mock', model: 'm', soul: 'S1' },
            { id: 's2', harness: 'mock', model: 'm', soul: 'S2' },
            { id: 's3-noisy', harness: 'mock', model: 'm', soul: 'S3' }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      const result = await engine.run();
      const noisySeat = result.state.seats.find((s) => s.id === 's3-noisy');
      assert.equal(noisySeat.errorClass, 'HarnessExecutionError');
      assert.match(noisySeat.excusedReason, /^\[HarnessExecutionError\] CLI exited unexpectedly \(exit code 1\) — stderr: line 1: fatal CLI crash line 2: stack trace frame A /);
      assert.equal(noisySeat.excusedReason.includes('\n'), false, 'Formatted fault reason must be single-line');
      assert.ok(noisySeat.excusedReason.endsWith('...'), 'Long stderr must be truncated with ellipsis');
      assert.ok(noisySeat.excusedReason.length < 350, 'Formatted fault reason must be bounded');

      // Judge candidate guard failure must be classified as InvalidResponseError
      assert.equal(result.state.judge.status, 'fault');
      assert.equal(result.state.judge.errorClass, 'InvalidResponseError');
      assert.match(result.state.judge.faultReason, /^\[InvalidResponseError\]/);
    });
  });
});

