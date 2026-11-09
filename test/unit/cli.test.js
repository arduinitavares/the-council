import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runCli, HELP_TEXT } from '../../src/cli/index.js';
import { createInitialCouncilState } from '../../src/machine/state.js';
import { createSnapshot } from '../../src/telemetry/snapshot.js';

describe('Unit: Council CLI Runner (src/cli/index.js & bin/council)', () => {
  function createMockIO() {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let exitCode = null;

    return {
      io: {
        stdout: {
          write: (text) => { stdoutBuffer += text; }
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

  describe('Help & Version Flags', () => {
    it('--help displays help message and exits 0', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['--help'], mockIO.io);

      assert.equal(code, 0);
      assert.match(mockIO.getStdout(), /The Council — Multi-Agent Consensus Deliberation Engine/);
      assert.match(mockIO.getStdout(), /Usage:/);
      assert.match(mockIO.getStdout(), /-p, --preset <name>/);
      assert.match(mockIO.getStdout(), /-l, --live/);
    });

    it('-h displays help message and exits 0', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['-h'], mockIO.io);

      assert.equal(code, 0);
      assert.match(mockIO.getStdout(), /The Council/);
    });

    it('--version displays version and exits 0', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['--version'], mockIO.io);

      assert.equal(code, 0);
      assert.match(mockIO.getStdout(), /the-council v0\.1\.0/);
    });
  });

  describe('Command: council run', () => {
    it('fails fast with exit code 1 when neither --live nor --mock is specified (Issue #17)', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--topic', 'Missing Mode Test'], mockIO.io);

      assert.equal(code, 1);
      assert.match(mockIO.getStderr(), /--live.*--mock|--mock.*--live/i);
      assert.equal(mockIO.getStdout(), '');
    });

    it('fails fast with exit code 1 when both --live and --mock are specified (Issue #17)', async () => {
      const { MockAdapter } = await import('../../src/harness/mock.js');
      const mockIO = createMockIO();
      mockIO.io.harnessRegistry = { get: () => new MockAdapter() };
      mockIO.io.liveWatcher = { attach: () => {}, stop: () => {} };
      const code = await runCli(['run', '--live', '--mock', '--topic', 'Conflicting Mode Test'], mockIO.io);

      assert.equal(code, 1);
      assert.match(mockIO.getStderr(), /both.*--live.*--mock/i);
    });

    it('prints prominent SIMULATED banner at top and bottom of human output in --mock mode (Issue #17)', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--mock', '--topic', 'Which editor?'], mockIO.io);

      assert.equal(code, 0);
      const out = mockIO.getStdout();
      assert.match(out, /THE COUNCIL — VERDICT/);
      assert.match(out, /Topic\s+: Which editor\?/);
      assert.match(out, /Verdict\s+: Unanimous Consensus/);

      const banner = 'SIMULATED (mock harness): not a real deliberation';
      const firstIdx = out.indexOf(banner);
      const lastIdx = out.lastIndexOf(banner);
      const verdictHeaderIdx = out.indexOf('THE COUNCIL — VERDICT');

      assert.ok(firstIdx !== -1, 'Mock run stdout must contain the simulated banner');
      assert.ok(firstIdx < verdictHeaderIdx, 'Simulated banner must appear at the top before the verdict header');
      assert.ok(lastIdx > verdictHeaderIdx, 'Simulated banner must also appear at the bottom after the verdict');
    });

    it('includes mode: "mock" in --mock --json output and mode: "live" in --live --json output (Issue #17)', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--mock', '--topic', 'JSON Test', '--json'], mockIO.io);

      assert.equal(code, 0);
      const parsed = JSON.parse(mockIO.getStdout());
      assert.equal(parsed.mode, 'mock');
      assert.equal(parsed.ok, true);
      assert.equal(parsed.verdict.kind, 'Unanimous Consensus');
      assert.ok(Array.isArray(parsed.snapshots));

      const { HarnessRegistry } = await import('../../src/harness/index.js');
      const tmpFile = path.join(os.tmpdir(), `live-mode-json-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        topic: 'Live JSON Mode Test',
        seats: [
          { id: 'live-seat-1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Live Test Soul 1' },
          { id: 'live-seat-2', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Live Test Soul 2' }
        ],
        judge: { id: 'live-judge', harness: 'antigravity', model: 'claude-opus-5-5-high', soul: 'Live Judge Soul' }
      }));

      try {
        const liveIO = createMockIO();
        liveIO.io.liveWatcher = { attach: () => {}, stop: () => {} };
        liveIO.io.harnessRegistry = new HarnessRegistry({
          spawnRunner: async ({ prompt }) => {
            if (prompt.includes('VOTING') || prompt.includes('"vote"')) {
              return JSON.stringify({ vote: 'accept' });
            }
            if (prompt.includes('proofDecisions') || prompt.includes('clauses')) {
              return JSON.stringify({
                summary: 'Synthesized live candidate',
                proofDecisions: { P1: { status: 'admitted' }, P2: { status: 'admitted' } },
                clauses: [{ context: 'General', conclusion: 'Verified live mode', citedProofIds: ['P1'] }]
              });
            }
            return JSON.stringify({
              scope: 'General',
              kind: 'check',
              source: 'Live harness check',
              statement: 'Verified statement'
            });
          }
        });
        const liveCode = await runCli(['run', '--live', '-c', tmpFile, '--json'], liveIO.io);
        assert.equal(liveCode, 0);
        const liveParsed = JSON.parse(liveIO.getStdout());
        assert.equal(liveParsed.mode, 'live');
        assert.equal(liveParsed.ok, true);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });

    it('documents explicit --live / --mock mode selection in HELP_TEXT and skills/ask-council/SKILL.md (Issue #17)', () => {
      assert.match(HELP_TEXT, /council run \(--live \| --mock\)/);
      assert.match(HELP_TEXT, /-l, --live.*required unless --mock/i);
      assert.match(HELP_TEXT, /-m, --mock.*required unless --live/i);
      assert.doesNotMatch(HELP_TEXT, /--mock.*\(default\)/i);

      const skillPath = path.resolve(import.meta.dirname, '../../skills/ask-council/SKILL.md');
      const skillContent = fs.readFileSync(skillPath, 'utf8');
      assert.match(skillContent, /--live/);
      assert.match(skillContent, /--mock/);
      assert.match(skillContent, /SIMULATED \(mock harness\): not a real deliberation/);
    });

    it('runs deliberation with --verbose and streams telemetry to stderr', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--mock', '--verbose'], mockIO.io);

      assert.equal(code, 0);
      assert.match(mockIO.getStderr(), /\[TELEMETRY\]/);
      assert.match(mockIO.getStderr(), /\[TRANSITION\]/);
    });

    it('loads configuration from --config file', async () => {
      const tmpFile = path.join(os.tmpdir(), `cli-cfg-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        topic: 'CLI Loaded Config Topic',
        minQuorum: 2,
        seats: [
          { id: 'seat-a', harness: 'mock', model: 'm', soul: 's' },
          { id: 'seat-b', harness: 'mock', model: 'm', soul: 's' }
        ]
      }));

      try {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-c', tmpFile, '--json'], mockIO.io);
        assert.equal(code, 0);
        const parsed = JSON.parse(mockIO.getStdout());
        assert.equal(parsed.state.topic, 'CLI Loaded Config Topic');
        assert.equal(parsed.state.seats.length, 2);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('allows combining -c config file with -t, -p, -r, and -q overrides without mutating frozen config', async () => {
      const tmpFile = path.join(os.tmpdir(), `cli-cfg-override-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        topic: 'Base File Topic',
        maxRounds: 8,
        minQuorum: 2
      }));

      try {
        const mockIO = createMockIO();
        const code = await runCli(
          ['run', '--mock', '-c', tmpFile, '-t', 'Overridden Topic', '-r', '3', '-q', '2', '-p', 'architecture', '--json'],
          mockIO.io
        );
        assert.equal(code, 0);
        const parsed = JSON.parse(mockIO.getStdout());
        assert.equal(parsed.state.topic, 'Overridden Topic');
        assert.equal(parsed.state.maxRounds, 3);
        assert.equal(parsed.state.minQuorum, 2);
        assert.equal(parsed.state.seats.length, 4);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('runs deliberation with --preset architecture and resolves 4 preset seats', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--mock', '--preset', 'architecture', '--json'], mockIO.io);

      assert.equal(code, 0);
      const parsed = JSON.parse(mockIO.getStdout());
      assert.equal(parsed.state.seats.length, 4);
      assert.deepEqual(
        parsed.state.seats.map((s) => s.id),
        ['astra-systems', 'sol-pragmatic', 'argon-staff', 'opus-domain']
      );
      assert.equal(parsed.state.judge.id, 'judge-opus');
    });

    it('runs deliberation with -p product-comparison and resolves product-comparison seats', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--mock', '-p', 'product-comparison', '--json'], mockIO.io);

      assert.equal(code, 0);
      const parsed = JSON.parse(mockIO.getStdout());
      assert.equal(parsed.state.seats.length, 4);
      assert.deepEqual(
        parsed.state.seats.map((s) => s.id),
        ['astra-specs', 'astra-ux', 'argon-value', 'grok-skeptic']
      );
    });

    it('allows overriding topic with -t while using -p preset', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--mock', '-p', 'security-audit', '-t', 'Audit Auth Service', '--json'], mockIO.io);

      assert.equal(code, 0);
      const parsed = JSON.parse(mockIO.getStdout());
      assert.equal(parsed.state.topic, 'Audit Auth Service');
      assert.equal(parsed.state.seats.length, 3);
      assert.equal(parsed.state.judge.id, 'judge-astra');
    });

    it('fails with error for unknown preset name', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--preset', 'nonexistent-preset'], mockIO.io);

      assert.equal(code, 1);
      assert.match(mockIO.getStderr(), /Unknown preset "nonexistent-preset"/);
    });

    it('fails with code 1 and unknown preset error when --preset is empty string', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--preset', ''], mockIO.io);

      assert.equal(code, 1);
      assert.match(mockIO.getStderr(), /Unknown preset ""/);
    });

    it('prints answer-first verdict hierarchy (Final Answer -> Candidate Clauses -> Seat Roll Call -> Submitted Proofs) with Judge, seat roll call, and proof attribution (#53)', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--mock', '-p', 'architecture', '--topic', 'Proof Formatting Test'], mockIO.io);

      assert.equal(code, 0);
      const out = mockIO.getStdout();
      assert.match(out, /Judge\s+:\s+judge-opus \(antigravity \/ claude-opus-5-5-high\)/);
      assert.match(out, /Final Answer:/);
      assert.match(out, /Candidate Clauses:/);
      assert.match(out, /Seat Roll Call:/);
      assert.match(out, /Submitted Proofs:/);

      const finalAnswerIndex = out.indexOf('Final Answer:');
      const clausesIndex = out.indexOf('Candidate Clauses:');
      const rollCallIndex = out.indexOf('Seat Roll Call:');
      const proofsIndex = out.indexOf('Submitted Proofs:');

      assert.ok(finalAnswerIndex > 0, 'Final Answer must be present');
      assert.ok(clausesIndex > finalAnswerIndex, 'Candidate Clauses must appear after Final Answer');
      assert.ok(rollCallIndex > clausesIndex, 'Seat Roll Call must appear after Candidate Clauses');
      assert.ok(proofsIndex > rollCallIndex, 'Submitted Proofs must appear after Seat Roll Call');

      assert.match(out, /-\s+\[ACCEPTED\]\s+astra-systems \(codex \/ gpt-6-astra \(max\)\) — Proofs: P1 \(admitted\)/);
      assert.match(out, /\s+-\s+\[P\d+\]\s+\(admitted\)\s+\[check\]/);
      assert.match(out, /Seat : astra-systems \| Judge Note:/);
    });

    it('runs deliberation with --live flag, attaching VisualizerLiveWatcher and HarnessRegistry', async () => {
      const { HarnessRegistry } = await import('../../src/harness/index.js');
      const tmpFile = path.join(os.tmpdir(), `live-cfg-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        topic: 'Live Flag Verification',
        seats: [
          { id: 'live-seat-1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Live Test Soul 1' },
          { id: 'live-seat-2', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Live Test Soul 2' }
        ],
        judge: { id: 'live-judge', harness: 'antigravity', model: 'claude-opus-5-5-high', soul: 'Live Judge Soul' }
      }));

      const tmpRunsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-live-runs-'));
      try {
        const mockIO = createMockIO();
        mockIO.io.liveWatcherOptions = { outputDir: tmpRunsDir, runId: 'cli-test-run-1' };
        mockIO.io.harnessRegistry = new HarnessRegistry({
          spawnRunner: async ({ prompt }) => {
            if (prompt.includes('VOTING') || prompt.includes('"vote"')) {
              return JSON.stringify({ vote: 'accept' });
            }
            if (prompt.includes('proofDecisions') || prompt.includes('clauses')) {
              return JSON.stringify({
                summary: 'Live candidate summary',
                proofDecisions: { P1: { status: 'admitted' }, P2: { status: 'admitted' } },
                clauses: [{ context: 'Core', conclusion: 'Live verified', citedProofIds: ['P1'] }]
              });
            }
            return JSON.stringify({
              scope: 'Core',
              kind: 'check',
              source: 'Harness runner',
              statement: 'Verified live proof'
            });
          }
        });
        const code = await runCli(['run', '--live', '-c', tmpFile, '--json'], mockIO.io);
        assert.equal(code, 0);
        const parsed = JSON.parse(mockIO.getStdout());
        assert.equal(parsed.ok, true);
        assert.equal(parsed.mode, 'live');
        assert.equal(parsed.state.topic, 'Live Flag Verification');

        // Verify that live watcher created latest.js, index.js, and <runId>.js in isolated outputDir
        const latestFile = path.join(tmpRunsDir, 'latest.js');
        const runFile = path.join(tmpRunsDir, 'cli-test-run-1.js');
        const indexFile = path.join(tmpRunsDir, 'index.js');
        assert.ok(fs.existsSync(latestFile), 'latest.js must exist in outputDir after --live run');
        assert.ok(fs.existsSync(runFile), 'run-scoped artifact must exist in outputDir after --live run');
        assert.ok(fs.existsSync(indexFile), 'index.js manifest must exist in outputDir after --live run');
        const content = fs.readFileSync(latestFile, 'utf8');
        assert.match(content, /CouncilLatestLiveRun/);
        assert.match(content, /Live Flag Verification/);
      } finally {
        fs.unlinkSync(tmpFile);
        fs.rmSync(tmpRunsDir, { recursive: true, force: true });
      }
    });

    it('rejects harness: "mock" on a seat or judge in --live mode with exit code 1 and zero watcher attachment (Issue #17)', async () => {
      const { HarnessRegistry } = await import('../../src/harness/index.js');
      const tmpMockSeat = path.join(os.tmpdir(), `live-mock-seat-${Date.now()}.json`);
      const tmpMockJudge = path.join(os.tmpdir(), `live-mock-judge-${Date.now()}.json`);

      fs.writeFileSync(tmpMockSeat, JSON.stringify({
        topic: 'Mock Seat Spoof in Live Mode',
        seats: [
          { id: 'astra-1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Valid Seat' },
          { id: 'spoof-mock-seat', harness: 'mock', model: 'mock-model', soul: 'Spoofed Seat' }
        ],
        judge: { id: 'judge-opus', harness: 'antigravity', model: 'claude-opus-5-5-high', soul: 'Valid Judge' }
      }));

      fs.writeFileSync(tmpMockJudge, JSON.stringify({
        topic: 'Mock Judge Spoof in Live Mode',
        seats: [
          { id: 'astra-1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Valid Seat 1' },
          { id: 'argon-2', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Valid Seat 2' }
        ],
        judge: { id: 'spoof-mock-judge', harness: 'mock', model: 'mock-model', soul: 'Spoofed Judge' }
      }));

      try {
        let spawnCalls = 0;
        let watcherAttached = 0;
        const trackingRegistry = new HarnessRegistry({
          spawnRunner: async () => {
            spawnCalls += 1;
            return '{}';
          }
        });
        const trackingWatcher = {
          attach: () => { watcherAttached += 1; },
          stop: () => {}
        };

        const seatIO = createMockIO();
        seatIO.io.harnessRegistry = trackingRegistry;
        seatIO.io.liveWatcher = trackingWatcher;
        const seatCode = await runCli(['run', '--live', '-c', tmpMockSeat], seatIO.io);
        assert.equal(seatCode, 1);
        assert.equal(spawnCalls, 0, 'Must not spawn any provider when seat uses mock harness in --live mode');
        assert.equal(watcherAttached, 0, 'Must not attach watcher when seat uses mock harness in --live mode');
        assert.match(seatIO.getStderr(), /Cannot use "mock" harness for seat "spoof-mock-seat" in --live mode/i);

        const judgeIO = createMockIO();
        judgeIO.io.harnessRegistry = trackingRegistry;
        judgeIO.io.liveWatcher = trackingWatcher;
        const judgeCode = await runCli(['run', '--live', '-c', tmpMockJudge], judgeIO.io);
        assert.equal(judgeCode, 1);
        assert.equal(spawnCalls, 0, 'Must not spawn any provider when judge uses mock harness in --live mode');
        assert.equal(watcherAttached, 0, 'Must not attach watcher when judge uses mock harness in --live mode');
        assert.match(judgeIO.getStderr(), /Cannot use "mock" harness for judge "spoof-mock-judge" in --live mode/i);
      } finally {
        if (fs.existsSync(tmpMockSeat)) fs.unlinkSync(tmpMockSeat);
        if (fs.existsSync(tmpMockJudge)) fs.unlinkSync(tmpMockJudge);
      }
    });

    it('rejects unknown or rejected models, invalid effort tiers, and substring-spoofed models up front in --live mode before attaching watcher or spawning any provider (Issue #16)', async () => {
      const { HarnessRegistry } = await import('../../src/harness/index.js');
      const tmpSeatBad = path.join(os.tmpdir(), `live-bad-seat-model-${Date.now()}.json`);
      const tmpJudgeBad = path.join(os.tmpdir(), `live-bad-judge-model-${Date.now()}.json`);
      const tmpBadEffort = path.join(os.tmpdir(), `live-bad-effort-${Date.now()}.json`);
      const tmpSpoofModel = path.join(os.tmpdir(), `live-spoof-model-${Date.now()}.json`);

      fs.writeFileSync(tmpSeatBad, JSON.stringify({
        topic: 'Preflight Bad Seat Model',
        seats: [
          { id: 'astra-valid', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Valid Seat' },
          { id: 'sol-invalid-seat', harness: 'codex', model: 'gpt-5-sol (high)', soul: 'Invalid Seat' }
        ],
        judge: { id: 'judge-opus', harness: 'antigravity', model: 'claude-opus-5-5-high', soul: 'Valid Judge' }
      }));

      fs.writeFileSync(tmpJudgeBad, JSON.stringify({
        topic: 'Preflight Bad Judge Model',
        seats: [
          { id: 'astra-valid-1', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Valid Seat 1' },
          { id: 'astra-valid-2', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'Valid Seat 2' }
        ],
        judge: { id: 'judge-bad-cursor', harness: 'cursor', model: 'grok-4-skeptic', soul: 'Invalid Judge' }
      }));

      fs.writeFileSync(tmpBadEffort, JSON.stringify({
        topic: 'Preflight Bad Effort Tier',
        seats: [
          { id: 'astra-ultra', harness: 'codex', model: 'gpt-6-astra (ultra)', soul: 'Bad Effort Seat' },
          { id: 'argon-valid', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Valid Seat' }
        ],
        judge: { id: 'judge-opus', harness: 'antigravity', model: 'claude-opus-5-5-high', soul: 'Valid Judge' }
      }));

      fs.writeFileSync(tmpSpoofModel, JSON.stringify({
        topic: 'Preflight Substring Spoof Model',
        seats: [
          { id: 'astra-valid', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Valid Seat' },
          { id: 'spoof-seat', harness: 'codex', model: 'not-gpt-6-astra-high', soul: 'Spoof Seat' }
        ],
        judge: { id: 'judge-opus', harness: 'antigravity', model: 'claude-opus-5-5-high', soul: 'Valid Judge' }
      }));

      try {
        let spawnCalls = 0;
        let watcherAttached = 0;
        const trackingRegistry = new HarnessRegistry({
          spawnRunner: async () => {
            spawnCalls += 1;
            return '{}';
          }
        });
        const trackingWatcher = {
          attach: () => { watcherAttached += 1; },
          stop: () => {}
        };

        const seatIO = createMockIO();
        seatIO.io.harnessRegistry = trackingRegistry;
        seatIO.io.liveWatcher = trackingWatcher;
        const seatCode = await runCli(['run', '--live', '-c', tmpSeatBad], seatIO.io);
        assert.equal(seatCode, 1);
        assert.equal(spawnCalls, 0, 'Must not spawn any provider when seat model is invalid');
        assert.equal(watcherAttached, 0, 'Must not attach watcher when seat model is invalid');
        assert.match(seatIO.getStderr(), /sol-invalid-seat/);
        assert.match(seatIO.getStderr(), /gpt-5-sol \(high\)/);

        const judgeIO = createMockIO();
        judgeIO.io.harnessRegistry = trackingRegistry;
        judgeIO.io.liveWatcher = trackingWatcher;
        const judgeCode = await runCli(['run', '--live', '-c', tmpJudgeBad], judgeIO.io);
        assert.equal(judgeCode, 1);
        assert.equal(spawnCalls, 0, 'Must not spawn any provider when judge model is invalid');
        assert.equal(watcherAttached, 0, 'Must not attach watcher when judge model is invalid');
        assert.match(judgeIO.getStderr(), /judge-bad-cursor/);
        assert.match(judgeIO.getStderr(), /grok-4-skeptic/);

        const effortIO = createMockIO();
        effortIO.io.harnessRegistry = trackingRegistry;
        effortIO.io.liveWatcher = trackingWatcher;
        const effortCode = await runCli(['run', '--live', '-c', tmpBadEffort], effortIO.io);
        assert.equal(effortCode, 1);
        assert.equal(spawnCalls, 0, 'Must not spawn any provider when effort tier is invalid');
        assert.equal(watcherAttached, 0, 'Must not attach watcher when effort tier is invalid');
        assert.match(effortIO.getStderr(), /astra-ultra/);
        assert.match(effortIO.getStderr(), /Unsupported reasoning effort "ultra"/);

        const spoofIO = createMockIO();
        spoofIO.io.harnessRegistry = trackingRegistry;
        spoofIO.io.liveWatcher = trackingWatcher;
        const spoofCode = await runCli(['run', '--live', '-c', tmpSpoofModel], spoofIO.io);
        assert.equal(spoofCode, 1);
        assert.equal(spawnCalls, 0, 'Must not spawn any provider when model is substring-spoofed');
        assert.equal(watcherAttached, 0, 'Must not attach watcher when model is substring-spoofed');
        assert.match(spoofIO.getStderr(), /spoof-seat/);
        assert.match(spoofIO.getStderr(), /not-gpt-6-astra-high/);
      } finally {
        for (const f of [tmpSeatBad, tmpJudgeBad, tmpBadEffort, tmpSpoofModel]) {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        }
      }
    });

    it('waits for stdout drain before exiting when piped stdout buffer is full', async () => {
      const { EventEmitter } = await import('node:events');
      let exitCalled = false;
      let drainListenerAttached = false;
      let buffered = '';

      const fakePipedStdout = new EventEmitter();
      fakePipedStdout.write = (chunk) => {
        if (chunk === '') {
          return false;
        }
        buffered += chunk;
        return false;
      };

      const originalOnce = fakePipedStdout.once.bind(fakePipedStdout);
      fakePipedStdout.once = (event, listener) => {
        if (event === 'drain') {
          drainListenerAttached = true;
          setImmediate(() => {
            fakePipedStdout.emit('drain');
          });
        }
        return originalOnce(event, listener);
      };

      const mockExit = (code) => {
        exitCalled = true;
        return code;
      };

      const code = await runCli(['run', '--mock', '--topic', 'Drain Test', '--json'], {
        stdout: fakePipedStdout,
        stderr: { write: () => {} },
        exit: mockExit
      });

      assert.equal(code, 0);
      assert.equal(drainListenerAttached, true, 'Must attach drain listener when buffer full');
      assert.equal(exitCalled, true, 'Exit must be called after drain');
      assert.ok(buffered.length > 0);
      const parsed = JSON.parse(buffered);
      assert.equal(parsed.ok, true);
    });

    it('prints underlying fault reasons, exitCode, and stderr in -v verbose output and lists Excused Seats in verdict summary', async () => {
      const { MockAdapter } = await import('../../src/harness/mock.js');
      const { HarnessExecutionError, TimeoutError } = await import('../../src/harness/adapter.js');

      const mockAdapter = new MockAdapter();
      const origExecuteSeat = mockAdapter.executeSeat.bind(mockAdapter);
      mockAdapter.executeSeat = async (ctx) => {
        if (ctx.seat.id === 'seat-cli-fail') {
          throw new HarnessExecutionError('CLI process failed', {
            harness: 'codex',
            seatId: 'seat-cli-fail',
            exitCode: 2,
            stderr: 'fatal: unknown flag --bad-arg'
          });
        }
        return origExecuteSeat(ctx);
      };
      mockAdapter.executeJudgeAuditAndSynthesis = async () => {
        throw new TimeoutError('Harness "antigravity" execution timed out after 240000ms', {
          harness: 'antigravity',
          seatId: 'judge-main',
          timeoutMs: 240000
        });
      };

      const tmpFile = path.join(os.tmpdir(), `cli-fault-verbose-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        topic: 'Verbose Fault Diagnostics Test',
        minQuorum: 2,
        maxRetriesPerSeat: 0,
        seats: [
          { id: 'seat-ok-1', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'S1' },
          { id: 'seat-ok-2', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'S2' },
          { id: 'seat-cli-fail', harness: 'codex', model: 'gpt-6-astra', soul: 'S3' }
        ],
        judge: { id: 'judge-main', harness: 'antigravity', model: 'claude-opus-5-5-high', soul: 'Judge' }
      }));

      try {
        const mockIO = createMockIO();
        mockIO.io.harnessRegistry = { get: () => mockAdapter };
        mockIO.io.liveWatcher = {
          attach: () => {},
          stop: () => {}
        };

        const code = await runCli(['run', '--live', '-v', '-c', tmpFile], mockIO.io);
        assert.equal(code, 2);

        const stderr = mockIO.getStderr();
        const stdout = mockIO.getStdout();

        // Verbose stderr must show the actual fault statuses, error classes, and reasons (including exit code and stderr)
        assert.match(stderr, /\[TELEMETRY\] Seat "seat-cli-fail" -> \[FAULT\] \(\[HarnessExecutionError\].*exit code 2.*stderr: fatal: unknown flag --bad-arg.*\)/);
        assert.match(stderr, /\[TRANSITION\] SEAT_FAULT -> seat_fault \(Round 1\): \[HarnessExecutionError\].*exit code 2/);
        assert.match(stderr, /\[TRANSITION\] EXCUSE_SEAT -> reviewing \(Round 1\): .*\[HarnessExecutionError\].*exit code 2/);
        assert.match(stderr, /\[TELEMETRY\] Seat "judge-main" -> \[FAULT_TIMEOUT\] \(\[TimeoutError\].*timed out after 240000ms.*\)/);
        assert.match(stderr, /\[TRANSITION\] JUDGE_FAULT -> completed \(Round 1\): \[TimeoutError\].*timed out after 240000ms/);

        // Human stdout verdict summary must list Excused Seats with their excusedReason and error class
        assert.match(stdout, /Excused Seats:/);
        assert.match(stdout, /seat-cli-fail.*\[HarnessExecutionError\].*exit code 2.*stderr: fatal: unknown flag --bad-arg/);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });
  });

  describe('Command: council demo', () => {
    it('runs demo wt-better-os to completion', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['demo', 'wt-better-os'], mockIO.io);

      assert.equal(code, 0);
      assert.match(mockIO.getStdout(), /Running Demo Walkthrough: Walkthrough 1/);
      assert.match(mockIO.getStdout(), /Unanimous Consensus/);
    });

    it('runs demo wt-10-seats-quota to completion', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['demo', 'wt-10-seats-quota'], mockIO.io);

      assert.equal(code, 0);
      assert.match(mockIO.getStdout(), /Running Demo Walkthrough: Walkthrough 2/);
      assert.match(mockIO.getStdout(), /Unanimous Consensus/);
    });

    it('runs demo wt-opus-guardrails to completion', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['demo', 'wt-opus-guardrails'], mockIO.io);

      assert.equal(code, 0);
      assert.match(mockIO.getStdout(), /Running Demo Walkthrough: Walkthrough 3/);
      assert.match(mockIO.getStdout(), /Dissent Report \(Preserved Excused-Seat Objection\)/);
    });

    it('runs demo with --json flag and outputs structured JSON', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['demo', 'wt-better-os', '--json'], mockIO.io);

      assert.equal(code, 0);
      const parsed = JSON.parse(mockIO.getStdout());
      assert.equal(parsed.id, 'wt-better-os');
      assert.equal(parsed.verdict.kind, 'Unanimous Consensus');
      assert.ok(parsed.snapshots.length > 0);
    });

    it('fails with error for unknown demo id', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['demo', 'nonexistent-demo'], mockIO.io);

      assert.equal(code, 1);
      assert.match(mockIO.getStderr(), /Unknown demo walkthrough "nonexistent-demo"/);
    });
  });

  describe('Command: council inspect', () => {
    it('inspects a single snapshot JSON file', () => {
      const state = createInitialCouncilState();
      const snap = createSnapshot({ type: 'BEGIN_ROUND' }, state, { sequence: 5 });

      const tmpFile = path.join(os.tmpdir(), `snap-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify(snap));

      try {
        const mockIO = createMockIO();
        runCli(['inspect', tmpFile], mockIO.io);
        assert.match(mockIO.getStdout(), /Snapshot ID: snap-5-BEGIN_ROUND/);
        assert.match(mockIO.getStdout(), /Event: BEGIN_ROUND/);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('inspects a trajectory array JSON file', () => {
      const state = createInitialCouncilState();
      const snap1 = createSnapshot({ type: 'INIT' }, state, { sequence: 0 });
      const snap2 = createSnapshot({ type: 'BEGIN_ROUND' }, state, { sequence: 1 });

      const tmpFile = path.join(os.tmpdir(), `traj-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify([snap1, snap2]));

      try {
        const mockIO = createMockIO();
        runCli(['inspect', tmpFile], mockIO.io);
        assert.match(mockIO.getStdout(), /Trajectory contains 2 snapshots/);
        assert.match(mockIO.getStdout(), /\[0\] INIT/);
        assert.match(mockIO.getStdout(), /\[1\] BEGIN_ROUND/);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('inspect errors if file path is missing or non-existent', async () => {
      const mockIO1 = createMockIO();
      const code1 = await runCli(['inspect'], mockIO1.io);
      assert.equal(code1, 1);
      assert.match(mockIO1.getStderr(), /requires a path/);

      const mockIO2 = createMockIO();
      const code2 = await runCli(['inspect', '/path/to/missing/file.json'], mockIO2.io);
      assert.equal(code2, 1);
      assert.match(mockIO2.getStderr(), /not found/);
    });
  });

  describe('Error Handling', () => {
    it('handles argument parsing errors', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--unknown-flag'], mockIO.io);

      assert.equal(code, 1);
      assert.match(mockIO.getStderr(), /CLI argument error/);
    });

    it('rejects unrecognized commands', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['invalidcommand'], mockIO.io);

      assert.equal(code, 1);
      assert.match(mockIO.getStderr(), /Unknown command "invalidcommand"/);
    });
  });

  describe('Issue #27: CWD-Independent CLI, Config/Preset Resolution & Skill Installation', () => {
    it('runCli --live from an external cwd never creates src/ or .council/ in caller cwd', async () => {
      const { MockAdapter } = await import('../../src/harness/mock.js');
      const prevCwd = process.cwd();
      const tmpExtCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cli-ext-cwd-'));
      const tmpRunsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cli-runs-'));

      try {
        process.chdir(tmpExtCwd);
        const mockIO = createMockIO();
        const mockAdapter = new MockAdapter();
        mockIO.io.harnessRegistry = { get: () => mockAdapter };
        mockIO.io.liveWatcherOptions = { outputDir: tmpRunsDir };

        const code = await runCli(['run', '--live', '-p', 'argon-only', '-t', 'External CWD live test'], mockIO.io);
        assert.equal(code, 0);
        assert.equal(fs.existsSync(path.join(tmpExtCwd, 'src')), false, 'Must not create src/ in caller cwd');
        assert.equal(fs.existsSync(path.join(tmpExtCwd, '.council')), false, 'Must not create .council/ in caller cwd');
        assert.deepEqual(fs.readdirSync(tmpExtCwd), [], 'Caller cwd must remain completely empty');
      } finally {
        process.chdir(prevCwd);
        fs.rmSync(tmpExtCwd, { recursive: true, force: true });
        fs.rmSync(tmpRunsDir, { recursive: true, force: true });
      }
    });

    it('runCli --mock with -c configs/best-of-families.json and -p best-of-families succeeds from an external cwd', async () => {
      const prevCwd = process.cwd();
      const tmpExtCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cli-ext-cfg-'));

      try {
        process.chdir(tmpExtCwd);

        const mockIO1 = createMockIO();
        const code1 = await runCli(
          ['run', '--mock', '-c', 'configs/best-of-families.json', '-t', 'From external cwd -c', '--json'],
          mockIO1.io
        );
        assert.equal(code1, 0, `Expected exit 0 for -c configs/best-of-families.json, stderr: ${mockIO1.getStderr()}`);
        const parsed1 = JSON.parse(mockIO1.getStdout());
        assert.equal(parsed1.ok, true);
        assert.equal(parsed1.state.judge.id, 'judge-astra');
        assert.deepEqual(parsed1.state.seats.map((s) => s.id), ['sol-voter', 'argon-voter', 'opus-voter', 'grok-voter']);

        const mockIO2 = createMockIO();
        const code2 = await runCli(
          ['run', '--mock', '-p', 'best-of-families', '-t', 'From external cwd -p', '--json'],
          mockIO2.io
        );
        assert.equal(code2, 0, `Expected exit 0 for -p best-of-families, stderr: ${mockIO2.getStderr()}`);
        const parsed2 = JSON.parse(mockIO2.getStdout());
        assert.equal(parsed2.ok, true);
        assert.equal(parsed2.state.judge.id, 'judge-astra');
        assert.deepEqual(parsed2.state.seats.map((s) => s.id), ['sol-voter', 'argon-voter', 'opus-voter', 'grok-voter']);
        assert.deepEqual(fs.readdirSync(tmpExtCwd), [], 'Caller cwd must remain completely empty');
      } finally {
        process.chdir(prevCwd);
        fs.rmSync(tmpExtCwd, { recursive: true, force: true });
      }
    });

    it('install-skill script copies a real file (not a symlink) and SKILL.md uses CWD-independent paths', async () => {
      const repoRoot = path.resolve(import.meta.dirname, '../..');
      const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
      assert.ok(pkg.scripts && pkg.scripts['install-skill'], 'package.json must define "install-skill" script');

      const { installSkill } = await import('../../scripts/install-skill.js');
      const tmpSkillRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'council-skill-target-'));
      const tmpUserRoot = path.join(tmpSkillRoot, 'user-skills');
      const tmpWorkspaceRoot = path.join(tmpSkillRoot, 'workspace-skills');
      try {
        const result = installSkill({
          userSkillsRoot: tmpUserRoot,
          workspaceSkillsRoot: tmpWorkspaceRoot
        });
        assert.ok(result.installedPaths.length >= 2);
        const targetSkillFile = path.join(tmpUserRoot, 'ask-council', 'SKILL.md');
        const tempWorkspaceSkillFile = path.join(tmpWorkspaceRoot, 'ask-council', 'SKILL.md');
        assert.ok(fs.existsSync(targetSkillFile), 'Installed SKILL.md must exist');
        assert.equal(fs.lstatSync(targetSkillFile).isSymbolicLink(), false, 'Installed SKILL.md must not be a symlink');
        assert.ok(fs.existsSync(tempWorkspaceSkillFile), 'Installed workspace SKILL.md must exist');
        assert.equal(fs.lstatSync(tempWorkspaceSkillFile).isSymbolicLink(), false, 'Installed workspace SKILL.md must not be a symlink');

        const sourceSkillFile = path.join(repoRoot, 'skills', 'ask-council', 'SKILL.md');
        const workspaceSkillFile = path.join(repoRoot, '.agents', 'skills', 'ask-council', 'SKILL.md');
        assert.ok(fs.existsSync(sourceSkillFile), 'skills/ask-council/SKILL.md must exist');
        assert.ok(fs.existsSync(workspaceSkillFile), '.agents/skills/ask-council/SKILL.md must exist');
        assert.equal(fs.lstatSync(sourceSkillFile).isSymbolicLink(), false, 'Source SKILL.md must not be a symlink');
        assert.equal(fs.lstatSync(sourceSkillFile).isFile(), true, 'Source SKILL.md must be a regular file');
        assert.equal(fs.lstatSync(workspaceSkillFile).isSymbolicLink(), false, 'Workspace SKILL.md must not be a symlink');
        assert.equal(fs.lstatSync(workspaceSkillFile).isFile(), true, 'Workspace SKILL.md must be a regular file');
        assert.equal(
          Buffer.compare(fs.readFileSync(sourceSkillFile), fs.readFileSync(workspaceSkillFile)),
          0,
          'skills/ask-council/SKILL.md and .agents/skills/ask-council/SKILL.md must be byte-for-byte identical'
        );

        const skillContent = fs.readFileSync(targetSkillFile, 'utf8');
        assert.match(skillContent, /\/Users\/aaat\/projects\/the-council\/bin\/council/);
        assert.match(skillContent, /open \/Users\/aaat\/projects\/the-council\/src\/visualizer\/index\.html/);
        assert.doesNotMatch(skillContent, /^\s*\.\/bin\/council/m);
        assert.doesNotMatch(skillContent, /^\s*open src\/visualizer\/index\.html/m);
      } finally {
        fs.rmSync(tmpSkillRoot, { recursive: true, force: true });
      }
    });
  });

  describe('Issue #23: --evidence CLI Flag, Merging & Prompt Grounding', () => {
    it('supports --evidence (-e) with JSON and Markdown/text files, merges with config evidence, and injects [E1] label/source/text into seat and judge prompts', async () => {
      const { MockAdapter } = await import('../../src/harness/mock.js');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cli-evidence-'));
      const jsonEvPath = path.join(tmpDir, 'api-evidence.json');
      const mdEvPath = path.join(tmpDir, 'local-notes.md');
      const cfgPath = path.join(tmpDir, 'council-cfg.json');

      fs.writeFileSync(
        jsonEvPath,
        JSON.stringify([
          {
            label: 'Localhost Metrics Endpoint',
            source: 'http://127.0.0.1:8790/metrics',
            text: 'p99_latency_ms=11.4 queue_depth=0'
          }
        ])
      );
      fs.writeFileSync(mdEvPath, '# Benchmark Note\nSQLite WAL throughput reached 18,400 writes/sec.');
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({
          topic: 'Evaluate local service performance',
          minQuorum: 2,
          evidence: [
            {
              label: 'Config Inline Evidence',
              source: 'config/service.yaml',
              text: 'worker_threads: 4'
            }
          ],
          seats: [
            { id: 'seat-alpha', harness: 'mock', model: 'm1', soul: 'Systems Architect' },
            { id: 'seat-beta', harness: 'mock', model: 'm2', soul: 'Performance Analyst' }
          ],
          judge: { id: 'judge-main', harness: 'mock', model: 'mj', soul: 'Auditor' }
        })
      );

      try {
        const mockAdapter = new MockAdapter();
        const mockIO = createMockIO();
        mockIO.io.harnessResolver = () => mockAdapter;

        const code = await runCli(
          ['run', '--mock', '-c', cfgPath, '-e', jsonEvPath, '--evidence', mdEvPath, '--json'],
          mockIO.io
        );
        assert.equal(code, 0, `Expected exit 0, stderr: ${mockIO.getStderr()}`);

        const parsed = JSON.parse(mockIO.getStdout());
        assert.equal(parsed.ok, true);
        assert.equal(parsed.state.evidence.length, 3);
        assert.equal(parsed.state.evidence[0].id, 'E1');
        assert.equal(parsed.state.evidence[0].label, 'Config Inline Evidence');
        assert.equal(parsed.state.evidence[1].id, 'E2');
        assert.equal(parsed.state.evidence[1].label, 'Localhost Metrics Endpoint');
        assert.equal(parsed.state.evidence[2].id, 'E3');
        assert.equal(parsed.state.evidence[2].label, 'local-notes.md');

        // Verify seat deliberation & voting prompts and judge prompt all received the evidence
        const seatDelibPrompts = mockAdapter.recordedPrompts.filter(
          (p) => p.seatId === 'seat-alpha' && p.phase === 'DELIBERATION'
        );
        const seatVotePrompts = mockAdapter.recordedPrompts.filter(
          (p) => p.seatId === 'seat-alpha' && p.phase === 'VOTING'
        );
        const judgePrompts = mockAdapter.recordedPrompts.filter((p) => p.seatId === 'judge-main');

        assert.equal(seatDelibPrompts.length, 1);
        assert.equal(seatVotePrompts.length, 1);
        assert.equal(judgePrompts.length, 1);

        for (const entry of [seatDelibPrompts[0], seatVotePrompts[0], judgePrompts[0]]) {
          assert.match(entry.prompt, /\[E1\] Config Inline Evidence \(Source: config\/service\.yaml\): worker_threads: 4/);
          assert.match(entry.prompt, /\[E2\] Localhost Metrics Endpoint \(Source: http:\/\/127\.0\.0\.1:8790\/metrics\): p99_latency_ms=11\.4/);
          assert.match(entry.prompt, /\[E3\] local-notes\.md \(Source: .*local-notes\.md\): # Benchmark Note/);
        }
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('documents -e, --evidence and evidence / clarifications config keys in HELP_TEXT and skills/ask-council/SKILL.md', () => {
      assert.match(HELP_TEXT, /-e, --evidence <path>/);
      assert.match(HELP_TEXT, /evidence/i);

      const skillPath = path.resolve(import.meta.dirname, '../../skills/ask-council/SKILL.md');
      const skillContent = fs.readFileSync(skillPath, 'utf8');
      assert.match(skillContent, /--evidence/);
      assert.match(skillContent, /"evidence"/);
      assert.match(skillContent, /Evidence Gathering & Grounding/);
    });

    it('resolves relative --evidence path against PACKAGE_ROOT when invoked from an external working directory', async () => {
      const prevCwd = process.cwd();
      const tmpExtCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'council-ev-ext-cwd-'));
      try {
        process.chdir(tmpExtCwd);
        const mockIO = createMockIO();
        // Reference package.json relative to PACKAGE_ROOT (which does not exist in tmpExtCwd)
        const code = await runCli(
          ['run', '--mock', '-t', 'External CWD Evidence Fallback', '-e', 'README.md', '--json'],
          mockIO.io
        );
        assert.equal(code, 0, `Expected exit 0, stderr: ${mockIO.getStderr()}`);
        const parsed = JSON.parse(mockIO.getStdout());
        assert.equal(parsed.ok, true);
        assert.equal(parsed.state.evidence.length, 1);
        assert.equal(parsed.state.evidence[0].id, 'E1');
        assert.equal(parsed.state.evidence[0].label, 'README.md');
      } finally {
        process.chdir(prevCwd);
        fs.rmSync(tmpExtCwd, { recursive: true, force: true });
      }
    });

    it('surfaces candidate.summary as Final Answer, seat roll call with rejected/none proofs, and Judge Note rationale in human verdict output (#53)', async () => {
      const { HarnessRegistry } = await import('../../src/harness/index.js');
      const { QuotaExhaustionError } = await import('../../src/harness/adapter.js');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cli-53-'));
      const cfgPath = path.join(tmpDir, 'cfg.json');
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({
          topic: 'Who invented the airplane?',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 0,
          judge: { id: 'judge-astra', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            { id: 'sol-voter', harness: 'codex', model: 'gpt-6.1-sol (max)', soul: 'Sol' },
            { id: 'argon-voter', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Argon' },
            { id: 'excused-voter', harness: 'antigravity', model: 'claude-opus-5-5-high', soul: 'Opus' }
          ]
        })
      );

      try {
        const customAdapter = {
          executeSeatProof: async ({ seat }) => {
            if (seat.id === 'excused-voter') {
              throw new QuotaExhaustionError('429 rate limit exceeded', {
                harness: seat.harness,
                seatId: seat.id,
                model: seat.model
              });
            }
            if (seat.id === 'sol-voter') {
              return {
                scope: 'Controlled Powered Flight',
                kind: 'citation',
                source: 'Smithsonian NASM 1903 Log',
                statement: 'Wright Flyer achieved sustained controlled flight on 17 December 1903.'
              };
            }
            return {
              scope: 'Unverified Claim',
              kind: 'citation',
              source: 'Secondary Blog',
              statement: 'Unsubstantiated claim without telemetry.'
            };
          },
          executeJudgeAuditAndSynthesis: async () => ({
            summary: 'Under sustained, powered, pilot-controlled flight criteria, the Wright brothers (1903) and Santos-Dumont (1906) represent distinct FAI vs.assisted-takeoff milestones.',
            proofDecisions: {
              P1: { status: 'admitted', note: 'Primary archival telemetry verified.' },
              P2: { status: 'rejected', note: 'Rejected: lacks primary source verification.' }
            },
            clauses: [
              {
                id: 'C1',
                context: 'Controlled Powered Flight (1903)',
                conclusion: 'Wilbur and Orville Wright achieved sustained controlled flight at Kitty Hawk.',
                citedProofIds: ['P1']
              }
            ]
          }),
          executeSeatVote: async () => ({ vote: 'accept' })
        };

        const registry = new HarnessRegistry();
        registry.register('codex', customAdapter);
        registry.register('antigravity', customAdapter);

        const mockIO = createMockIO();
        mockIO.io.harnessRegistry = registry;
        mockIO.io.liveWatcherOptions = { outputDir: path.join(tmpDir, 'runs'), runId: 'run-cli-53' };

        const code = await runCli(['run', '--live', '-c', cfgPath], mockIO.io);
        assert.equal(code, 0);
        const out = mockIO.getStdout();

        assert.match(out, /Judge\s+:\s+judge-astra \(codex \/ gpt-6-astra \(max\)\)/);
        assert.match(out, /Final Answer:\n\s+Under sustained, powered, pilot-controlled flight criteria/);
        assert.match(out, /-\s+\[ACCEPTED\]\s+sol-voter \(codex \/ gpt-6\.1-sol \(max\)\) — Proofs: P1 \(admitted\)/);
        assert.match(out, /-\s+\[ACCEPTED\]\s+argon-voter \(antigravity \/ gemini-4-argon-high\) — Proofs: P2 \(rejected\)/);
        assert.match(out, /-\s+\[EXCUSED\]\s+excused-voter \(antigravity \/ claude-opus-5-5-high\) — Proofs: none — Excused:/);
        assert.match(out, /Seat : sol-voter \| Judge Note: Primary archival telemetry verified\./);
        assert.match(out, /Seat : argon-voter \| Judge Note: Rejected: lacks primary source verification\./);

        // Verify non-consensus (Dissent Report) qualifies Final Answer header and indents multi-line candidateSummary
        const dissentAdapter = {
          ...customAdapter,
          executeJudgeAuditAndSynthesis: async () => ({
            summary: 'Line 1 of proposed candidate.\nLine 2 of proposed candidate.',
            proofDecisions: {
              P1: { status: 'admitted', note: 'Primary archival telemetry verified.' },
              P2: { status: 'admitted', note: 'Admitted for objection test.' }
            },
            clauses: [
              {
                id: 'C1',
                context: 'Controlled Powered Flight (1903)',
                conclusion: 'Wilbur and Orville Wright achieved sustained controlled flight at Kitty Hawk.',
                citedProofIds: ['P1']
              }
            ]
          }),
          executeSeatVote: async ({ seat }) =>
            seat.id === 'argon-voter'
              ? { vote: 'object', reason: 'Disputes catapult vs unassisted criteria', proofId: 'P2' }
              : { vote: 'accept' }
        };
        const dissentRegistry = new HarnessRegistry();
        dissentRegistry.register('codex', dissentAdapter);
        dissentRegistry.register('antigravity', dissentAdapter);

        const dissentIO = createMockIO();
        dissentIO.io.harnessRegistry = dissentRegistry;
        dissentIO.io.liveWatcherOptions = { outputDir: path.join(tmpDir, 'runs'), runId: 'run-cli-53-dissent' };

        const dissentCode = await runCli(['run', '--live', '-c', cfgPath], dissentIO.io);
        assert.equal(dissentCode, 2);
        const dissentOut = dissentIO.getStdout();
        assert.match(dissentOut, /Verdict\s+:\s+Dissent Report \(Round Limit Reached\)/);
        assert.match(
          dissentOut,
          /Final Answer: \(Proposed Candidate — Dissent Report \(Round Limit Reached\)\)\n  Line 1 of proposed candidate\.\n  Line 2 of proposed candidate\./
        );

        // Issue #56: Verify `council telemetry` reads persisted telemetry from those completed runs
        const telIO = createMockIO();
        const telCode = await runCli(
          ['telemetry', '--by', 'model', '--days', '30', '--output-dir', path.join(tmpDir, 'runs')],
          telIO.io
        );
        assert.equal(telCode, 0);
        const telOut = telIO.getStdout();
        assert.match(telOut, /Cross-Run Telemetry Leaderboard/i);
        assert.match(telOut, /codex\/gpt-6\.1-sol \(max\)/);
        assert.match(telOut, /antigravity\/gemini-4-argon \(high\)/);

        const telJsonIO = createMockIO();
        const telJsonCode = await runCli(
          ['telemetry', '--by', 'seat', '--json', '--output-dir', path.join(tmpDir, 'runs')],
          telJsonIO.io
        );
        assert.equal(telJsonCode, 0);
        const telJson = JSON.parse(telJsonIO.getStdout());
        assert.equal(telJson.by, 'seat');
        assert.equal(telJson.totalRuns, 2);
        assert.ok(Array.isArray(telJson.rows));
        assert.ok(telJson.rows.some((r) => r.key === 'sol-voter'));

        // Reject invalid --by or --days
        const badByIO = createMockIO();
        const badByCode = await runCli(['telemetry', '--by', 'invalid'], badByIO.io);
        assert.equal(badByCode, 1);
        assert.match(badByIO.getStderr(), /--by must be "model" or "seat"/);

        const badDaysIO = createMockIO();
        const badDaysCode = await runCli(['telemetry', '--days', '0'], badDaysIO.io);
        assert.equal(badDaysCode, 1);
        assert.match(badDaysIO.getStderr(), /--days must be a positive number/);

        // Verify `council run --mock` does NOT persist to telemetryDir by default (unless io.persistMockTelemetry: true)
        const mockRunsDir = path.join(tmpDir, 'mock-runs');
        const mockTelDir = path.join(tmpDir, 'mock-telemetry');
        const mockRunIO = createMockIO();
        mockRunIO.io.outputDir = mockRunsDir;
        mockRunIO.io.telemetryDir = mockTelDir;
        const mockRunCode = await runCli(
          ['run', '--mock', '-t', 'Simulated Run Should Not Pollute Telemetry', '--json'],
          mockRunIO.io
        );
        assert.equal(mockRunCode, 0);
        assert.equal(
          fs.existsSync(path.join(mockTelDir, 'runs')),
          false,
          'council run --mock must not persist telemetry records by default'
        );

        // Opt-in io.persistMockTelemetry: true persists mock telemetry and includes it in summary
        const optInMockIO = createMockIO();
        optInMockIO.io.outputDir = mockRunsDir;
        optInMockIO.io.telemetryDir = mockTelDir;
        optInMockIO.io.persistMockTelemetry = true;
        optInMockIO.io.runId = 'run-mock-opt-in';
        const optInCode = await runCli(
          ['run', '--mock', '-t', 'Opt-in Simulated Telemetry', '--json'],
          optInMockIO.io
        );
        assert.equal(optInCode, 0);
        assert.equal(
          fs.existsSync(path.join(mockTelDir, 'runs', 'run-mock-opt-in.json')),
          true,
          'council run --mock must persist telemetry when io.persistMockTelemetry: true'
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});

