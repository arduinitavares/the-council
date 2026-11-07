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
    it('runs deliberation and prints formatted verdict', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--topic', 'Which editor?'], mockIO.io);

      assert.equal(code, 0);
      assert.match(mockIO.getStdout(), /THE COUNCIL — VERDICT/);
      assert.match(mockIO.getStdout(), /Topic\s+: Which editor\?/);
      assert.match(mockIO.getStdout(), /Verdict\s+: Unanimous Consensus/);
    });

    it('runs deliberation with --json flag and outputs valid JSON', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--topic', 'JSON Test', '--json'], mockIO.io);

      assert.equal(code, 0);
      const parsed = JSON.parse(mockIO.getStdout());
      assert.equal(parsed.ok, true);
      assert.equal(parsed.verdict.kind, 'Unanimous Consensus');
      assert.ok(Array.isArray(parsed.snapshots));
    });

    it('runs deliberation with --verbose and streams telemetry to stderr', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--verbose'], mockIO.io);

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
        const code = await runCli(['run', '-c', tmpFile, '--json'], mockIO.io);
        assert.equal(code, 0);
        const parsed = JSON.parse(mockIO.getStdout());
        assert.equal(parsed.state.topic, 'CLI Loaded Config Topic');
        assert.equal(parsed.state.seats.length, 2);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('runs deliberation with --preset architecture and resolves 4 preset seats', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--preset', 'architecture', '--json'], mockIO.io);

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
      const code = await runCli(['run', '-p', 'product-comparison', '--json'], mockIO.io);

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
      const code = await runCli(['run', '-p', 'security-audit', '-t', 'Audit Auth Service', '--json'], mockIO.io);

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

    it('prints Submitted Proofs: section before Candidate Clauses: in text verdict output', async () => {
      const mockIO = createMockIO();
      const code = await runCli(['run', '--topic', 'Proof Formatting Test'], mockIO.io);

      assert.equal(code, 0);
      const out = mockIO.getStdout();
      assert.match(out, /Submitted Proofs:/);
      assert.match(out, /Candidate Clauses:/);

      const proofsIndex = out.indexOf('Submitted Proofs:');
      const clausesIndex = out.indexOf('Candidate Clauses:');
      assert.ok(proofsIndex > 0, 'Submitted Proofs must be present');
      assert.ok(clausesIndex > proofsIndex, 'Submitted Proofs must appear BEFORE Candidate Clauses');

      assert.match(out, /\s+-\s+\[P\d+\]\s+\(admitted\)\s+\[check\]/);
    });

    it('runs deliberation with --live flag, attaching VisualizerLiveWatcher and HarnessRegistry', async () => {
      const tmpFile = path.join(os.tmpdir(), `live-cfg-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        topic: 'Live Flag Verification',
        seats: [
          { id: 'live-seat-1', harness: 'mock', model: 'mock-model', soul: 'Live Test Soul 1' },
          { id: 'live-seat-2', harness: 'mock', model: 'mock-model', soul: 'Live Test Soul 2' }
        ],
        judge: { id: 'live-judge', harness: 'mock', model: 'mock-model', soul: 'Live Judge Soul' }
      }));

      try {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--live', '-c', tmpFile, '--json'], mockIO.io);
        assert.equal(code, 0);
        const parsed = JSON.parse(mockIO.getStdout());
        assert.equal(parsed.ok, true);
        assert.equal(parsed.state.topic, 'Live Flag Verification');

        // Verify that live watcher created or updated live-run-latest.js
        const liveFile = path.resolve(process.cwd(), 'src/visualizer/live-run-latest.js');
        assert.ok(fs.existsSync(liveFile), 'live-run-latest.js must exist after --live run');
        const content = fs.readFileSync(liveFile, 'utf8');
        assert.match(content, /CouncilLatestLiveRun/);
        assert.match(content, /Live Flag Verification/);
      } finally {
        fs.unlinkSync(tmpFile);
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

      const code = await runCli(['run', '--topic', 'Drain Test', '--json'], {
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
});
