import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CouncilEngine, resolveVotingSeatConfig } from '../../src/engine/council-engine.js';
import { resolveConfig, validateConfig } from '../../src/engine/config.js';
import { validateRetryFallbackCapability } from '../../src/engine/recovery.js';
import {
  HarnessRegistry,
  T3HarnessAdapter,
  T3McpClient,
  VALID_HARNESS_BACKENDS,
  resolveHarnessBackend
} from '../../src/harness/index.js';
import { VisualizerLiveWatcher } from '../../src/visualizer/live-watcher.js';
import { runCli } from '../../src/cli/index.js';
import { MCP_PROTOCOL_VERSION } from '../../src/harness/t3-mcp-client.js';

function startT3E2eServer({ authToken = 'test-t3-token', projectRoot, onToolCall }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      if (authToken && req.headers.authorization !== `Bearer ${authToken}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_mcp_credential', message: 'A valid T3 Code MCP credential is required.' }));
        return;
      }
      if (body?.method === 'initialize') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'e2e-sess-1' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: MCP_PROTOCOL_VERSION } }));
        return;
      }
      if (body?.method === 'notifications/initialized') {
        res.writeHead(202);
        res.end();
        return;
      }
      if (body?.method === 'tools/call') {
        const { name, arguments: args } = body.params;
        const payload = await onToolCall(name, args, { projectRoot });
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: payload } }));
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/mcp` });
    });
  });
}

const E2E_CAPABILITIES = {
  providers: [
    {
      providerInstanceId: 'codex',
      driverKind: 'codex',
      canRunChildTask: true,
      models: [
        {
          id: 'gpt-6.2-sol',
          options: [
            { id: 'reasoningEffort', values: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
            { id: 'serviceTier', values: ['standard', 'fast'] }
          ]
        },
        {
          id: 'gpt-6.2-astra',
          options: [
            { id: 'reasoningEffort', values: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
            { id: 'serviceTier', values: ['standard', 'fast'] }
          ]
        }
      ]
    },
    {
      providerInstanceId: 'antigravity',
      driverKind: 'antigravity',
      canRunChildTask: true,
      models: [
        {
          id: 'gemini-4-neon',
          options: [{ id: 'thought_level', values: ['low', 'medium', 'high', 'xhigh'] }]
        },
        {
          id: 'gemini-pro-orchestrator-neon',
          options: []
        }
      ]
    },
    {
      providerInstanceId: 'cursor',
      driverKind: 'cursor',
      canRunChildTask: true,
      models: [
        {
          id: 'grok-4.7',
          options: [{ id: 'reasoning_effort', values: ['low', 'medium', 'high', 'xhigh'] }]
        },
        {
          id: 'composer-2.5',
          options: [{ id: 'fastMode', values: ['default', 'fast'] }]
        }
      ]
    }
  ]
};

describe('Task 4: T3 MCP coexistence wiring, CLI preflight, recovery catalog & CouncilEngine E2E', () => {
  const servers = [];
  const tmpDirs = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const s = servers.pop();
      await new Promise((r) => s.close(r));
    }
    while (tmpDirs.length > 0) {
      const d = tmpDirs.pop();
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('runs full CouncilEngine lifecycle over HTTP T3 MCP with shared client, VisualizerLiveWatcher receipts, and voting scratch isolation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-t3-e2e-'));
    tmpDirs.push(tmpDir);
    const repoDir = path.join(tmpDir, 'repo');
    const runsDir = path.join(tmpDir, 'runs');
    fs.mkdirSync(repoDir, { recursive: true });

    const launches = [];
    const threadOutputs = new Map();
    let seq = 0;

    const { server, url } = await startT3E2eServer({
      projectRoot: repoDir,
      onToolCall: async (name, args) => {
        if (name === 'orchestrator_capabilities') return E2E_CAPABILITIES;
        if (name === 't3_project_list') return { projects: [{ id: 'proj-e2e', workspaceRoot: repoDir }] };
        if (name === 't3_thread_launch') {
          seq += 1;
          const tid = `th-${seq}`;
          const rid = `run-${seq}`;
          launches.push({ tid, rid, args });
          const title = args.title || '';
          if (title.includes('JUDGE_AUDIT_SYNTHESIS')) {
            threadOutputs.set(tid, JSON.stringify({
              summary: 'Adopt T3 MCP transport behind --backend t3.',
              proofDecisions: {
                P1: { status: 'admitted', note: 'Grounded' },
                P2: { status: 'admitted', note: 'Grounded' }
              },
              clauses: [{ context: 'Transport', conclusion: 'Use T3 MCP', citedProofIds: ['P1', 'P2'] }]
            }));
          } else if (title.includes('VOTING')) {
            threadOutputs.set(tid, JSON.stringify({ vote: 'accept' }));
          } else {
            threadOutputs.set(tid, JSON.stringify({
              scope: `Scope for ${title}`,
              kind: 'check',
              source: 'src/harness/t3.js',
              statement: `Verified check from ${title}`
            }));
          }
          return { threadId: tid, runId: rid };
        }
        if (name === 't3_thread_wait') {
          return { threadId: args.threadId, runId: args.runId, timedOut: false, status: 'completed', thread: { pendingRequestCount: 0 } };
        }
        if (name === 't3_thread_read' && args.view === 'messages') {
          return {
            items: [{ id: `m-${args.threadId}`, role: 'assistant', runId: `run-${args.threadId.slice(3)}`, text: threadOutputs.get(args.threadId), textTruncated: false }],
            hasMore: false
          };
        }
        if (name === 't3_thread_read' && args.view === 'activity') return { items: [], hasMore: false };
        if (name === 't3_thread_organize') return { ok: true };
        return {};
      }
    });
    servers.push(server);

    const registry = new HarnessRegistry({ backend: 't3', url, token: 'test-t3-token', cwd: repoDir });
    const codexAdapter = registry.get('codex');
    const agyAdapter = registry.get('antigravity');
    assert.ok(codexAdapter instanceof T3HarnessAdapter);
    assert.ok(codexAdapter.mcpClient instanceof T3McpClient);
    assert.equal(codexAdapter.mcpClient, agyAdapter.mcpClient, 'Registry shares one T3McpClient across logical harnesses');
    assert.equal(resolveHarnessBackend(undefined, {}), 'cli');

    const config = {
      topic: 'Should Council adopt T3 MCP transport?',
      maxRounds: 2,
      minQuorum: 2,
      cwd: repoDir,
      clarifications: ['Clarification Batch 1: Node >= 22 is mandatory.'],
      judge: { id: 'judge-astra', harness: 'codex', model: 'gpt-6.2-astra (xhigh)', soul: 'Impartial Judge' },
      seats: [
        { id: 'sol-seat', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', soul: 'Systems Architect' },
        { id: 'neon-seat', harness: 'antigravity', model: 'gemini-4-neon-xhigh', soul: 'Analytical Verifier' }
      ]
    };

    const engine = new CouncilEngine(config, { harnessRegistry: registry });
    const watcher = new VisualizerLiveWatcher({ initialConfig: config, outputDir: runsDir });
    watcher.attach(engine.getTelemetry());

    const result = await engine.run();
    watcher.stop();
    await registry.shutdownAll();

    assert.equal(result.ok, true);
    assert.equal(result.verdict.kind, 'Unanimous Consensus');
    assert.equal(watcher.liveRun.providerCalls.length, 5);
    assert.ok(watcher.liveRun.providerCalls.every((c) => c.transport === 't3-mcp' && c.exitCode === null));

    const delibLaunches = launches.filter((l) => l.args.title.includes('DELIBERATION'));
    assert.equal(delibLaunches.length, 2);
    assert.ok(delibLaunches.every((l) => l.args.projectId === 'proj-e2e' && l.args.workspaceStrategy?.type === 'root'));

    const voteLaunches = launches.filter((l) => l.args.title.includes('VOTING'));
    assert.equal(voteLaunches.length, 2);
    assert.ok(voteLaunches.every((l) => l.args.scratch === true && l.args.projectId === undefined));
  });

  it('preserves open Objection as preserved_excused when a Seat times out and is excused on T3 backend', async () => {
    let seq = 0;
    const threadMeta = new Map();
    const { server, url } = await startT3E2eServer({
      projectRoot: '/tmp',
      onToolCall: async (name, args) => {
        if (name === 'orchestrator_capabilities') return E2E_CAPABILITIES;
        if (name === 't3_project_list') return { projects: [] };
        if (name === 't3_thread_launch') {
          seq += 1;
          const tid = `th-${seq}`;
          const rid = `run-${seq}`;
          threadMeta.set(tid, { title: args.title || '', rid });
          return { threadId: tid, runId: rid };
        }
        if (name === 't3_thread_wait') {
          const meta = threadMeta.get(args.threadId);
          // Round 2 deliberation for grok-seat times out so grok-seat becomes an Excused Seat
          if (meta.title.includes('DELIBERATION R2') && meta.title.includes('grok-seat')) {
            await new Promise((r) => setTimeout(r, 150));
            return { threadId: args.threadId, runId: args.runId, timedOut: true, status: 'running' };
          }
          return { threadId: args.threadId, runId: args.runId, timedOut: false, status: 'completed', thread: { pendingRequestCount: 0 } };
        }
        if (name === 't3_thread_read' && args.view === 'messages') {
          const meta = threadMeta.get(args.threadId);
          let text;
          if (meta.title.includes('JUDGE_AUDIT_SYNTHESIS')) {
            text = JSON.stringify({
              summary: 'Synthesized candidate',
              proofDecisions: { P1: { status: 'admitted', note: 'ok' }, P2: { status: 'admitted', note: 'ok' }, P3: { status: 'admitted', note: 'ok' } },
              clauses: [{ context: 'Core', conclusion: 'Proceed', citedProofIds: ['P1'] }]
            });
          } else if (meta.title.includes('VOTING R1') && meta.title.includes('grok-seat')) {
            text = JSON.stringify({ vote: 'object', reason: 'Unresolved edge case', proofId: 'P2' });
          } else if (meta.title.includes('VOTING')) {
            text = JSON.stringify({ vote: 'accept' });
          } else {
            text = JSON.stringify({ scope: 'S', kind: 'check', source: 'spec.md', statement: `Claim ${meta.title}` });
          }
          return { items: [{ id: `m-${args.threadId}`, role: 'assistant', runId: meta.rid, text, textTruncated: false }], hasMore: false };
        }
        if (name === 't3_thread_read' && args.view === 'activity') return { items: [], hasMore: false };
        if (name === 't3_thread_interrupt' || name === 't3_thread_organize') return { ok: true };
        return {};
      }
    });
    servers.push(server);

    const registry = new HarnessRegistry({ backend: 't3', url, token: 'test-t3-token' });
    const engine = new CouncilEngine(
      {
        topic: 'Excused Seat objection lock under T3',
        maxRounds: 2,
        minQuorum: 2,
        maxRetriesPerSeat: 0,
        tools: 'none',
        timeoutMs: 80,
        judge: { id: 'judge-astra', harness: 'codex', model: 'gpt-6.2-astra (xhigh)', soul: 'Judge' },
        seats: [
          { id: 'sol-seat', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', soul: 'Sol' },
          { id: 'grok-seat', harness: 'cursor', model: 'grok-4.7-xhigh', soul: 'Grok' },
          { id: 'neon-seat', harness: 'antigravity', model: 'gemini-4-neon-xhigh', soul: 'Neon' }
        ]
      },
      { harnessRegistry: registry }
    );

    const result = await engine.run();
    await registry.shutdownAll();
    assert.equal(result.verdict.kind, 'Dissent Report (Preserved Excused-Seat Objection)');
    assert.ok(result.verdict.unresolvedObjections.some((o) => o.seatId === 'grok-seat' && o.status === 'preserved_excused'));
  });

  it('runCli --live --backend t3 fails preflight on 401 before Round 1 and validates --retry-effort-fallback without invoking listAntigravityModels', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-t3-cli-'));
    tmpDirs.push(tmpDir);
    const cfgPath = path.join(tmpDir, 't3-council.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        topic: 'CLI preflight check',
        maxRounds: 1,
        minQuorum: 2,
        tools: 'none',
        judge: { id: 'judge-astra', harness: 'codex', model: 'gpt-6.2-astra (xhigh)', soul: 'Judge' },
        seats: [
          { id: 'sol-seat', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', soul: 'Sol' },
          { id: 'neon-seat', harness: 'antigravity', model: 'gemini-4-neon-xhigh', soul: 'Neon' },
          { id: 'orch-seat', harness: 'antigravity', model: 'gemini-pro-orchestrator-neon', soul: 'Orchestrator' }
        ]
      })
    );

    let launchCount = 0;
    let healthChecks = 0;
    const { server, url } = await startT3E2eServer({
      authToken: 'valid-token',
      projectRoot: tmpDir,
      onToolCall: async (name, args) => {
        if (name === 'orchestrator_capabilities') {
          healthChecks += 1;
          return E2E_CAPABILITIES;
        }
        if (name === 't3_project_list') return { projects: [{ id: 'p-cli', workspaceRoot: tmpDir }] };
        if (name === 't3_thread_launch') {
          launchCount += 1;
          return { threadId: `th-${launchCount}`, runId: `run-${launchCount}` };
        }
        if (name === 't3_thread_wait') return { threadId: args.threadId, runId: args.runId, timedOut: false, status: 'completed', thread: { pendingRequestCount: 0 } };
        if (name === 't3_thread_read' && args.view === 'messages') {
          const isJudge = args.threadId === 'th-4';
          const isVote = Number(args.threadId.slice(3)) >= 5;
          const text = isJudge
            ? JSON.stringify({
                summary: 'Done',
                proofDecisions: { P1: { status: 'admitted', note: 'ok' }, P2: { status: 'admitted', note: 'ok' }, P3: { status: 'admitted', note: 'ok' } },
                clauses: [{ context: 'All', conclusion: 'Done', citedProofIds: ['P1'] }]
              })
            : isVote
              ? JSON.stringify({ vote: 'accept' })
              : JSON.stringify({ scope: 'CLI', kind: 'check', source: 'src/cli/index.js', statement: 'Preflight works' });
          return { items: [{ id: `m-${args.threadId}`, role: 'assistant', runId: `run-${args.threadId.slice(3)}`, text, textTruncated: false }], hasMore: false };
        }
        if (name === 't3_thread_read' && args.view === 'activity') return { items: [], hasMore: false };
        if (name === 't3_thread_organize') return { ok: true };
        return {};
      }
    });
    servers.push(server);

    const makeIo = (extra = {}) => {
      let out = '';
      let err = '';
      return {
        getStdout: () => out,
        getStderr: () => err,
        io: {
          stdout: { write: (s) => { out += s; return true; } },
          stderr: { write: (s) => { err += s; return true; } },
          exit: (code) => code,
          registerSignalHandlers: false,
          outputDir: path.join(tmpDir, 'out'),
          telemetryDir: path.join(tmpDir, 'tel'),
          ...extra
        }
      };
    };

    // 1. 401 fails preflight before any thread launch
    const badIo = makeIo({ t3Url: url, t3Token: 'wrong-token' });
    const badCode = await runCli(['run', '--live', '--backend', 't3', '-c', cfgPath, '--json'], badIo.io);
    assert.equal(badCode, 1);
    assert.match(badIo.getStderr(), /invalid_mcp_credential|preflight/i);
    assert.equal(launchCount, 0);

    // 2. Valid token + --retry-effort-fallback uses T3 capabilities and NEVER calls listAntigravityModels
    let agyProbeCalled = false;
    const okIo = makeIo({
      t3Url: url,
      t3Token: 'valid-token',
      listAntigravityModels: async () => {
        agyProbeCalled = true;
        throw new Error('listAntigravityModels must NEVER be invoked under --backend t3');
      }
    });
    const okCode = await runCli(
      ['run', '--live', '--backend', 't3', '-c', cfgPath, '--retry-effort-fallback', '--json'],
      okIo.io
    );
    assert.equal(okCode, 0, okIo.getStderr());
    assert.equal(agyProbeCalled, false);
    assert.equal(healthChecks, 1, 'Preflight healthCheck must be deduplicated across shared T3 client');
  });

  it('validates backend resolution, T3 v5 static recovery catalog + zero-effort orchestrator, and CLI preflight provider/project checks', async () => {
    assert.deepEqual(VALID_HARNESS_BACKENDS, ['cli', 't3']);
    assert.equal(resolveHarnessBackend(undefined, {}), 'cli');
    assert.equal(resolveHarnessBackend(undefined, { COUNCIL_HARNESS_BACKEND: 't3' }), 't3');
    assert.equal(resolveHarnessBackend('cli', { COUNCIL_HARNESS_BACKEND: 't3' }), 'cli');
    assert.throws(() => resolveHarnessBackend('invalid-backend', {}), /Unknown harness backend/i);

    const staticCheck = validateRetryFallbackCapability({
      config: {
        judge: { id: 'j', harness: 'codex', model: 'gpt-6.2-astra (xhigh)' },
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)' },
          { id: 's2', harness: 'antigravity', model: 'gemini-4-neon-xhigh' },
          { id: 's3', harness: 'antigravity', model: 'gemini-4-hydrogen-xhigh' },
          { id: 's4', harness: 'antigravity', model: 'gemini-pro-orchestrator-neon' }
        ]
      }
    });
    assert.equal(staticCheck.valid, true, staticCheck.errors.join('; '));
    assert.equal(staticCheck.results.s4.effectiveModel, 'gemini-pro-orchestrator-neon');
    assert.equal(staticCheck.results.s4.effectiveEffort, null);

    const badOrch = validateRetryFallbackCapability({
      config: {
        seats: [{ id: 's-bad', harness: 'antigravity', model: 'gemini-pro-orchestrator-neon-high' }]
      }
    });
    assert.equal(badOrch.valid, false);
    assert.match(badOrch.errors[0], /UNSUPPORTED_MODEL_EFFORT/);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-t3-preflight-'));
    tmpDirs.push(tmpDir);
    const unregisteredCwd = path.join(tmpDir, 'unregistered');
    fs.mkdirSync(unregisteredCwd, { recursive: true });

    const cfgPath = path.join(tmpDir, 'cfg.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        topic: 'Preflight checks',
        maxRounds: 1,
        minQuorum: 2,
        cwd: unregisteredCwd,
        judge: { id: 'j', harness: 'codex', model: 'gpt-6.2-astra (xhigh)', soul: 'Judge' },
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', soul: 'Sol' },
          { id: 's2', harness: 'antigravity', model: 'gemini-4-neon-xhigh', soul: 'Neon' }
        ]
      })
    );

    let agyAvailable = false;
    const { server, url } = await startT3E2eServer({
      authToken: 'tok',
      projectRoot: tmpDir,
      onToolCall: async (name) => {
        if (name === 'orchestrator_capabilities') {
          return {
            providers: [
              E2E_CAPABILITIES.providers[0],
              { ...E2E_CAPABILITIES.providers[1], canRunChildTask: agyAvailable }
            ]
          };
        }
        if (name === 't3_project_list') return { projects: [{ id: 'p-other', workspaceRoot: tmpDir }] };
        return {};
      }
    });
    servers.push(server);

    const runWithIo = async (args) => {
      let err = '';
      const code = await runCli(args, {
        stdout: { write: () => true },
        stderr: { write: (s) => { err += s; return true; } },
        exit: (c) => c,
        registerSignalHandlers: false,
        t3Url: url,
        t3Token: 'tok'
      });
      return { code, err };
    };

    // Secondary provider unavailable on shared client fails preflight
    const unavail = await runWithIo(['run', '--live', '--backend', 't3', '-c', cfgPath]);
    assert.equal(unavail.code, 1);
    assert.match(unavail.err, /T3 provider "antigravity" is unavailable/i);

    // Unregistered cwd fails preflight before Round 1
    agyAvailable = true;
    const noProj = await runWithIo(['run', '--live', '--backend', 't3', '-c', cfgPath]);
    assert.equal(noProj.code, 1);
    assert.match(noProj.err, /No registered T3 project matches cwd/i);
  });

  it('resolves configs/t3-best-of-families.json preset and validates initial and downshifted voting models across all 3 T3 harnesses', () => {
    const resolved = resolveConfig({ preset: 't3-best-of-families', topic: 'T3 preset validation' });
    assert.deepEqual(
      resolved.seats.map((s) => s.id),
      ['sol-voter', 'neon-voter', 'carbon-voter', 'grok-voter']
    );
    const grokSeat = resolved.seats.find((s) => s.id === 'grok-voter');
    assert.equal(grokSeat?.model, 'grok-4.7-high');
    assert.equal(grokSeat?.timeoutMs, 180000);
    const cfgCheck = validateConfig(resolved);
    assert.equal(cfgCheck.valid, true, cfgCheck.errors.join('; '));

    const participants = [{ role: 'judge', item: resolved.judge }, ...resolved.seats.map((s) => ({ role: 'seat', item: s }))];
    for (const { role, item } of participants) {
      const adapter = new T3HarnessAdapter({ provider: item.harness });
      adapter.validateModel(item.model);
      if (role === 'seat') {
        const votingCfg = resolveVotingSeatConfig(item, resolved, { harness: adapter });
        adapter.validateModel(votingCfg.model);
      }
    }
  });
});
