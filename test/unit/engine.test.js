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
import { QuotaExhaustionError } from '../../src/harness/adapter.js';

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
  });
});
