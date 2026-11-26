import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { T3HarnessAdapter, MAX_T3_PROMPT_CHARS } from '../../src/harness/t3.js';
import { T3McpClient } from '../../src/harness/t3-mcp-client.js';
import {
  TimeoutError,
  AbortError,
  HeadlessToolDeniedError,
  HarnessExecutionError
} from '../../src/harness/adapter.js';
import { createTelemetryEmitter } from '../../src/telemetry/emitter.js';

const MOCK_CAPABILITIES = {
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
        },
        {
          id: 'gpt-6-astra',
          options: [{ id: 'reasoningEffort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }]
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
        },
        {
          id: 'claude-opus-5-5',
          options: [{ id: 'thought_level', values: ['low', 'medium', 'high'] }]
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
          id: 'grok-4.6',
          options: [{ id: 'effort', values: ['low', 'medium', 'high'] }]
        },
        {
          id: 'composer-2.5',
          options: [{ id: 'fastMode', values: ['default', 'fast'] }]
        }
      ]
    }
  ]
};

const LEGACY_CAPABILITIES = {
  providers: [
    {
      provider: 'codex',
      canRunChildTask: true,
      models: [{ model: 'gpt-6.2-sol', optionKey: 'reasoningEffort', efforts: ['low', 'medium', 'high', 'xhigh'] }]
    },
    {
      provider: 'cursor',
      canRunChildTask: true,
      models: [{ model: 'grok-4.7', options: { reasoning_effort: { values: ['low', 'medium', 'high', 'xhigh'] } } }]
    }
  ]
};

describe('Task 3: T3HarnessAdapter direct contract tests', () => {
  it('translates modelSelection per live T3 and legacy provider capability wire shapes and omits effort for composer-2.5 and gemini-pro-orchestrator-neon', () => {
    const codex = new T3HarnessAdapter({ provider: 'codex', capabilities: MOCK_CAPABILITIES });
    assert.deepEqual(codex.translateModelSelection('gpt-6.2-sol (xhigh)'), {
      provider: 'codex',
      model: 'gpt-6.2-sol',
      options: { reasoningEffort: 'xhigh' }
    });
    assert.deepEqual(codex.getVerifiedCapabilities().models['gpt-6.2-sol'].efforts, [
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra'
    ]);

    const agy = new T3HarnessAdapter({ provider: 'antigravity', capabilities: MOCK_CAPABILITIES });
    assert.deepEqual(agy.translateModelSelection('gemini-4-neon-xhigh'), {
      provider: 'antigravity',
      model: 'gemini-4-neon',
      options: { thought_level: 'xhigh' }
    });
    assert.deepEqual(agy.translateModelSelection('gemini-pro-orchestrator-neon'), {
      provider: 'antigravity',
      model: 'gemini-pro-orchestrator-neon'
    });

    // When live T3 advertises thought_level for gemini-pro-orchestrator-neon, omitting effort stays omitted while explicit effort translates cleanly
    const agyLiveOrch = new T3HarnessAdapter({
      provider: 'antigravity',
      capabilities: {
        providers: [
          {
            providerInstanceId: 'antigravity',
            driverKind: 'antigravity',
            canRunChildTask: true,
            models: [
              {
                id: 'gemini-pro-orchestrator-neon',
                options: [{ id: 'thought_level', values: ['low', 'medium', 'high'] }]
              }
            ]
          }
        ]
      }
    });
    assert.deepEqual(agyLiveOrch.translateModelSelection('gemini-pro-orchestrator-neon'), {
      provider: 'antigravity',
      model: 'gemini-pro-orchestrator-neon'
    });
    assert.deepEqual(agyLiveOrch.translateModelSelection('gemini-pro-orchestrator-neon-high'), {
      provider: 'antigravity',
      model: 'gemini-pro-orchestrator-neon',
      options: { thought_level: 'high' }
    });

    const cursor = new T3HarnessAdapter({ provider: 'cursor', capabilities: MOCK_CAPABILITIES });
    assert.deepEqual(cursor.translateModelSelection('grok-4.7-xhigh'), {
      provider: 'cursor',
      model: 'grok-4.7',
      options: { reasoning_effort: 'xhigh' }
    });
    assert.deepEqual(cursor.translateModelSelection('grok-4.6-high'), {
      provider: 'cursor',
      model: 'grok-4.6',
      options: { effort: 'high' }
    });
    // composer-2.5 only has fastMode (no known effort option) -> optionKey: null, efforts: null
    assert.deepEqual(cursor.translateModelSelection('composer-2.5'), {
      provider: 'cursor',
      model: 'composer-2.5'
    });
    assert.equal(cursor.getVerifiedCapabilities().models['composer-2.5'].efforts, null);
    assert.throws(() => cursor.validateModel('composer-2.5 (high)'), /not permitted/i);

    // Legacy flat + object options shapes continue to decode cleanly
    const legacyCodex = new T3HarnessAdapter({ provider: 'codex', capabilities: LEGACY_CAPABILITIES });
    assert.deepEqual(legacyCodex.translateModelSelection('gpt-6.2-sol (high)'), {
      provider: 'codex',
      model: 'gpt-6.2-sol',
      options: { reasoningEffort: 'high' }
    });
    const legacyCursor = new T3HarnessAdapter({ provider: 'cursor', capabilities: LEGACY_CAPABILITIES });
    assert.deepEqual(legacyCursor.translateModelSelection('grok-4.7-xhigh'), {
      provider: 'cursor',
      model: 'grok-4.7',
      options: { reasoning_effort: 'xhigh' }
    });
  });

  it('handles direct QUESTION: and CLEAR: clarification turns, Proof/Vote/Judge turns, in-place _invocationMeta mutation, and confirmed-terminal archiving', async () => {
    const calls = [];
    const runsByThread = new Map();
    let responseText = 'QUESTION: What is the target Node.js version?';
    const mcpClient = new T3McpClient({
      callTool: async (name, args) => {
        calls.push({ name, args });
        if (name === 'orchestrator_capabilities') return MOCK_CAPABILITIES;
        if (name === 't3_project_list') return { projects: [{ id: 'proj-1', workspaceRoot: '/tmp/council-repo' }] };
        if (name === 't3_thread_launch') {
          const threadId = `th-${calls.length}`;
          const runId = `run-${calls.length}`;
          runsByThread.set(threadId, runId);
          return { threadId, runId };
        }
        if (name === 't3_thread_wait') {
          return {
            threadId: args.threadId,
            runId: args.runId,
            timedOut: false,
            status: 'completed',
            thread: { pendingRequestCount: 0 }
          };
        }
        if (name === 't3_thread_read' && args.view === 'messages') {
          return {
            items: [{ id: 'msg-1', role: 'assistant', runId: runsByThread.get(args.threadId), text: responseText, textTruncated: false }],
            hasMore: false,
            nextPosition: 1
          };
        }
        if (name === 't3_thread_read' && args.view === 'activity') {
          return { items: [], hasMore: false };
        }
        if (name === 't3_thread_organize') return { ok: true };
        return {};
      }
    });

    const telemetry = createTelemetryEmitter();
    const adapter = new T3HarnessAdapter({ provider: 'codex', mcpClient, capabilities: MOCK_CAPABILITIES });

    // 1. Clarification QUESTION:
    const qRes = await adapter.executeSeatClarification({
      seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', tools: 'none' },
      soul: 'Architect',
      round: 1,
      state: { topic: 'API versioning' },
      telemetry
    });
    assert.equal(qRes.needsClarification, true);
    assert.equal(qRes.status, 'question');
    assert.equal(qRes.question, 'What is the target Node.js version?');
    const qLaunch = calls.find((c) => c.name === 't3_thread_launch').args;
    assert.equal(qLaunch.scratch, true);
    assert.equal(qLaunch.projectId, undefined);
    assert.equal(qLaunch.interactionMode, 'plan');
    assert.equal(qLaunch.runtimeMode, 'auto');
    assert.equal(qLaunch.outputSchema, undefined);
    assert.ok(qLaunch.title && qLaunch.title.length > 0);
    assert.ok(qLaunch.clientRequestId);
    assert.ok(calls.some((c) => c.name === 't3_thread_organize' && c.args.action === 'archive'));

    // 2. Clarification CLEAR:
    responseText = 'CLEAR: Topic handoff has all needed context.';
    const cRes = await adapter.executeSeatClarification({
      seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', tools: 'none' },
      soul: 'Architect',
      round: 1,
      state: { topic: 'API versioning' },
      telemetry
    });
    assert.equal(cRes.needsClarification, false);
    assert.equal(cRes.status, 'clear');

    // 3. Deliberation Proof with explicit cwd + in-place _invocationMeta mutation
    responseText = JSON.stringify({
      scope: 'Node >= 22 runtime',
      kind: 'check',
      source: 'package.json:10-12',
      statement: 'Engine constraint requires Node >= 22.0.0.'
    });
    const callerContext = { _invocationMeta: {} };
    const metaRef = callerContext._invocationMeta;
    const proof = await adapter.executeSeatProof({
      seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', tools: 'read-only', cwd: '/tmp/council-repo' },
      soul: 'Architect',
      round: 1,
      state: { topic: 'Runtime check' },
      context: callerContext,
      telemetry
    });
    assert.equal(proof.kind, 'check');
    assert.equal(callerContext._invocationMeta, metaRef, '_invocationMeta must be mutated in place');
    assert.equal(callerContext._invocationMeta.effectiveCwd, '/tmp/council-repo');
    const proofLaunch = calls.filter((c) => c.name === 't3_thread_launch').at(-1).args;
    assert.equal(proofLaunch.projectId, 'proj-1');
    assert.deepEqual(proofLaunch.workspaceStrategy, { type: 'root' });

    // 4. Vote (tools: 'none' -> scratch: true) and Judge synthesis
    responseText = JSON.stringify({ vote: 'accept' });
    const vote = await adapter.executeSeatVote({
      seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (low)', tools: 'none' },
      soul: 'Architect',
      round: 1,
      state: { topic: 'Runtime check', candidate: { summary: 'Use Node 22', clauses: [] }, proofs: [] },
      telemetry
    });
    assert.equal(vote.vote, 'accept');

    responseText = JSON.stringify({
      summary: 'Use Node 22 ESM.',
      proofDecisions: { P1: { status: 'admitted', note: 'Verified' } },
      clauses: [{ context: 'Runtime', conclusion: 'Use Node 22', citedProofIds: ['P1'] }]
    });
    const judge = await adapter.executeJudge({
      judge: { id: 'judge-astra', harness: 'codex', model: 'gpt-6.2-astra (xhigh)', tools: 'none' },
      round: 1,
      proofs: [{ id: 'P1', seatId: 's1', scope: 'Runtime', kind: 'check', source: 'package.json', statement: 'Node 22' }],
      state: { topic: 'Runtime check' },
      telemetry
    });
    assert.equal(judge.clauses.length, 1);

    const providerCalls = telemetry.getProviderCalls();
    assert.equal(providerCalls.length, 5);
    assert.equal(providerCalls[0].provider, 'codex');
    assert.equal(providerCalls[0].transport, 't3-mcp');
    assert.equal(providerCalls[0].exitCode, null);
    assert.equal(providerCalls[0].signal, null);
  });

  it('paginates forward on hasMore === true and reassembles >20KB itemId/textOffset chunks, failing closed on truncation', async () => {
    const bigStatement = 'X'.repeat(21_500);
    const fullJson = JSON.stringify({
      scope: 'Large proof',
      kind: 'check',
      source: 'src/harness/t3.js',
      statement: bigStatement
    });
    const part1 = fullJson.slice(0, 20_000);
    const part2 = fullJson.slice(20_000);

    let failTruncated = false;
    const mcpClient = new T3McpClient({
      callTool: async (name, args) => {
        if (name === 't3_thread_launch') return { threadId: 'th-page', runId: 'run-page' };
        if (name === 't3_thread_wait') {
          return {
            threadId: 'th-page',
            runId: 'run-page',
            timedOut: false,
            status: 'completed',
            thread: { pendingRequestCount: 0 }
          };
        }
        if (name === 't3_thread_read' && args.view === 'messages' && args.itemId === 'msg-big') {
          if (failTruncated) {
            return {
              items: [{ id: 'msg-big', role: 'assistant', runId: 'run-page', text: part2, textTruncated: true }],
              hasMore: false
            };
          }
          return {
            items: [{ id: 'msg-big', role: 'assistant', runId: 'run-page', text: part2, textTruncated: false }],
            hasMore: false
          };
        }
        if (name === 't3_thread_read' && args.view === 'messages' && args.afterPosition === -1) {
          return {
            items: [{ id: 'msg-user', role: 'user', runId: 'run-page', text: 'prompt', textTruncated: false }],
            hasMore: true,
            nextPosition: 1
          };
        }
        if (name === 't3_thread_read' && args.view === 'messages' && args.afterPosition === 1) {
          return {
            items: [{ id: 'msg-big', role: 'assistant', runId: 'run-page', text: part1, textTruncated: true, nextTextOffset: 20_000 }],
            hasMore: false,
            nextPosition: 2 // Non-null nextPosition on last page must still stop because hasMore === false!
          };
        }
        if (name === 't3_thread_read' && args.view === 'activity') return { items: [], hasMore: false };
        if (name === 't3_thread_organize') return { ok: true };
        return {};
      }
    });

    const adapter = new T3HarnessAdapter({ provider: 'codex', mcpClient, capabilities: MOCK_CAPABILITIES });
    const proof = await adapter.executeSeatProof({
      seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', tools: 'none' },
      soul: 'Architect',
      round: 1,
      state: { topic: 'Pagination test' }
    });
    assert.equal(proof.statement.length, 21_500);

    // Fail closed if continuation remains truncated without a nextTextOffset
    failTruncated = true;
    await assert.rejects(
      () =>
        adapter.executeSeatProof({
          seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', tools: 'none' },
          soul: 'Architect',
          round: 1,
          state: { topic: 'Truncation fail-closed test' }
        }),
      (err) => err instanceof HarnessExecutionError && err.code === 'T3_READ_TRUNCATED'
    );
  });

  it('rejects failed run even when assistant_message contains schema-valid JSON, rejects >120k prompts pre-launch, and maps pendingRequestCount > 0 to HeadlessToolDeniedError', async () => {
    let launchCalls = 0;
    const interruptCalls = [];
    let mode = 'failed_run';
    const mcpClient = new T3McpClient({
      callTool: async (name, args) => {
        if (name === 't3_thread_launch') {
          launchCalls += 1;
          return { threadId: `th-${launchCalls}`, runId: `run-${launchCalls}` };
        }
        if (name === 't3_thread_wait') {
          if (mode === 'failed_run') {
            return {
              threadId: args.threadId,
              runId: args.runId,
              timedOut: false,
              status: 'failed',
              error: 'Upstream provider failed',
              thread: { pendingRequestCount: 0 }
            };
          }
          return {
            threadId: args.threadId,
            runId: args.runId,
            timedOut: true,
            status: 'running',
            thread: { pendingRequestCount: 1 }
          };
        }
        if (name === 't3_thread_read' && args.view === 'messages') {
          return {
            items: [{ id: 'm1', role: 'assistant', runId: args.runId, text: '{"vote":"accept"}', textTruncated: false }],
            hasMore: false
          };
        }
        if (name === 't3_thread_interrupt') {
          interruptCalls.push(args);
          return { ok: true };
        }
        return {};
      }
    });

    const adapter = new T3HarnessAdapter({ provider: 'codex', mcpClient, capabilities: MOCK_CAPABILITIES });

    // 1. Failed run with schema-valid JSON must reject
    await assert.rejects(
      () =>
        adapter.executeSeatVote({
          seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (low)', tools: 'none' },
          soul: 'Architect',
          round: 1,
          state: { topic: 'Fail check', candidate: { summary: 'S', clauses: [] }, proofs: [] }
        }),
      (err) => err instanceof HarnessExecutionError
    );

    // 2. >120,000 char prompt rejected pre-launch (zero new launches)
    const launchesBefore = launchCalls;
    await assert.rejects(
      () =>
        adapter.executeSeatProof({
          seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', tools: 'none' },
          soul: 'A'.repeat(MAX_T3_PROMPT_CHARS + 500),
          round: 1,
          state: { topic: 'Oversized prompt' }
        }),
      (err) => err instanceof HarnessExecutionError && err.code === 'T3_PROMPT_TOO_LARGE' && err.isRetryable === false
    );
    assert.equal(launchCalls, launchesBefore);

    // 3. pendingRequestCount > 0 -> interrupt without stop: true + HeadlessToolDeniedError
    mode = 'pending_request';
    await assert.rejects(
      () =>
        adapter.executeSeatProof({
          seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', tools: 'none' },
          soul: 'Architect',
          round: 1,
          state: { topic: 'Pending request stall' }
        }),
      (err) => err instanceof HeadlessToolDeniedError && err.code === 'HEADLESS_TOOL_DENIED'
    );
    assert.equal(interruptCalls.length, 1);
    assert.equal('stop' in interruptCalls[0], false, 't3_thread_interrupt must NEVER pass stop: true');

    // 4. Live capabilities without this provider must NOT silently fall back to static catalog
    adapter.setCapabilities({ antigravity: { canRunChildTask: true, models: [] } });
    assert.equal(adapter.isProviderAvailable(), false);
    assert.throws(() => adapter.validateModel('gpt-6.2-sol (xhigh)'), HarnessExecutionError);
  });

  it('sends run-scoped t3_thread_interrupt (no stop: true) on timeout/abort, skips archive when unconfirmed, and emits exactly 1 receipt via attempt gate', async () => {
    const interruptCalls = [];
    const organizeCalls = [];
    const mcpClient = new T3McpClient({
      callTool: async (name, args, { signal } = {}) => {
        if (name === 't3_thread_launch') return { threadId: 'th-slow', runId: 'run-slow' };
        if (name === 't3_thread_wait') {
          return await new Promise((resolve, reject) => {
            const t = setTimeout(
              () => resolve({ threadId: 'th-slow', runId: 'run-slow', timedOut: true, status: 'running' }),
              2000
            );
            signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(t);
                reject(new AbortError('wait aborted'));
              },
              { once: true }
            );
          });
        }
        if (name === 't3_thread_interrupt') {
          assert.equal(signal?.aborted, false, 'interrupt must use fresh timeout signal, not aborted turn signal');
          interruptCalls.push(args);
          return { ok: true };
        }
        if (name === 't3_thread_organize') {
          organizeCalls.push(args);
          return { ok: true };
        }
        return {};
      }
    });

    const records = [];
    const telemetry = createTelemetryEmitter();
    const adapter = new T3HarnessAdapter({
      provider: 'codex',
      mcpClient,
      capabilities: MOCK_CAPABILITIES,
      interruptTimeoutMs: 1500
    });

    await assert.rejects(
      () =>
        adapter.executeSeatProof({
          seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', tools: 'none' },
          soul: 'Architect',
          round: 1,
          timeoutMs: 40,
          state: { topic: 'Timeout test' },
          telemetry,
          onCallRecord: (rec) => records.push(rec)
        }),
      (err) => err instanceof TimeoutError && err._latchedTimeout === true
    );

    assert.equal(interruptCalls.length, 1);
    assert.equal(interruptCalls[0].threadId, 'th-slow');
    assert.equal(interruptCalls[0].runId, 'run-slow');
    assert.equal('stop' in interruptCalls[0], false);
    assert.equal(organizeCalls.length, 0, 'Must NOT archive unconfirmed thread');
    assert.equal(records.length, 1, 'Exactly one onCallRecord receipt must be emitted');
    assert.equal(telemetry.getProviderCalls().length, 1, 'Exactly one provider_call telemetry event must be emitted');
    assert.equal(records[0].provider, 'codex');
  });

  it('probes t3_thread_read for thread.pendingRequestCount when t3_thread_wait omits it and interrupts once with HeadlessToolDeniedError', async () => {
    const interruptCalls = [];
    const organizeCalls = [];
    const readCalls = [];
    const mcpClient = new T3McpClient({
      callTool: async (name, args) => {
        if (name === 't3_thread_launch') return { threadId: 'th-pending-probe', runId: 'run-pending-probe' };
        if (name === 't3_thread_wait') {
          return { threadId: args.threadId, runId: args.runId, timedOut: true, status: 'waiting' };
        }
        if (name === 't3_thread_read') {
          readCalls.push(args);
          return { thread: { pendingRequestCount: 1 }, items: [] };
        }
        if (name === 't3_thread_interrupt') {
          interruptCalls.push(args);
          return { ok: true };
        }
        if (name === 't3_thread_organize') {
          organizeCalls.push(args);
          return { ok: true };
        }
        return {};
      }
    });

    const adapter = new T3HarnessAdapter({ provider: 'codex', mcpClient, capabilities: MOCK_CAPABILITIES });
    await assert.rejects(
      () =>
        adapter.executeSeatProof({
          seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', tools: 'none' },
          soul: 'Architect',
          round: 1,
          state: { topic: 'Live pendingRequestCount probe test' }
        }),
      (err) => err instanceof HeadlessToolDeniedError && err.code === 'HEADLESS_TOOL_DENIED'
    );

    assert.equal(readCalls.length, 1);
    assert.equal(readCalls[0].threadId, 'th-pending-probe');
    assert.equal(readCalls[0].view, 'messages');
    assert.equal(readCalls[0].limit, 1);
    assert.equal(interruptCalls.length, 1);
    assert.equal(interruptCalls[0].threadId, 'th-pending-probe');
    assert.equal(interruptCalls[0].runId, 'run-pending-probe');
    assert.equal('stop' in interruptCalls[0], false);
    assert.equal(organizeCalls.length, 0);
  });

  it('throws T3_LAUNCH_MISSING_RUN without calling t3_thread_interrupt or t3_thread_organize when runId stays absent after probe', async () => {
    const interruptCalls = [];
    const organizeCalls = [];
    const mcpClient = new T3McpClient({
      callTool: async (name, args) => {
        if (name === 't3_thread_launch') return { threadId: 'th-no-run' };
        if (name === 't3_thread_read') return { items: [] };
        if (name === 't3_thread_interrupt') {
          interruptCalls.push(args);
          return { ok: true };
        }
        if (name === 't3_thread_organize') {
          organizeCalls.push(args);
          return { ok: true };
        }
        return {};
      }
    });

    const adapter = new T3HarnessAdapter({ provider: 'codex', mcpClient, capabilities: MOCK_CAPABILITIES });
    await assert.rejects(
      () =>
        adapter.executeSeatProof({
          seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', tools: 'none' },
          soul: 'Architect',
          round: 1,
          state: { topic: 'Missing runId test' }
        }),
      (err) => err instanceof HarnessExecutionError && err.code === 'T3_LAUNCH_MISSING_RUN'
    );

    assert.equal(interruptCalls.length, 0, 'Must NEVER call un-scoped t3_thread_interrupt without runId');
    assert.equal(organizeCalls.length, 0, 'Must NOT archive thread when launch lacked runId');
  });

  it('detects .council/ reads encoded in activity item.text while stripping raw file output from trace.toolCalls and onCallRecord receipts', async () => {
    const sensitiveDummyContent = 'TOP_SECRET_COUNCIL_LEDGER_DUMP_987654321';
    const mcpClient = new T3McpClient({
      callTool: async (name, args) => {
        if (name === 't3_thread_launch') return { threadId: 'th-act', runId: 'run-act' };
        if (name === 't3_thread_wait') {
          return { threadId: args.threadId, runId: args.runId, timedOut: false, status: 'completed' };
        }
        if (name === 't3_thread_read' && args.view === 'messages') {
          return {
            items: [{ id: 'm-act', role: 'assistant', runId: 'run-act', text: '{"vote":"accept"}', textTruncated: false }],
            hasMore: false
          };
        }
        if (name === 't3_thread_read' && args.view === 'activity') {
          return {
            items: [
              {
                id: 'act-1',
                kind: 'tool_call',
                toolName: 'read_file',
                text: `Tool: read_file(.council/runs/latest.js)\nOutput:\n${sensitiveDummyContent}`,
                output: sensitiveDummyContent,
                stdout: sensitiveDummyContent,
                content: sensitiveDummyContent
              }
            ],
            hasMore: false
          };
        }
        if (name === 't3_thread_organize') return { ok: true };
        return {};
      }
    });

    const records = [];
    const telemetry = createTelemetryEmitter();
    const adapter = new T3HarnessAdapter({ provider: 'codex', mcpClient, capabilities: MOCK_CAPABILITIES });

    await assert.rejects(
      () =>
        adapter.executeSeatVote({
          seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (low)', tools: 'none' },
          soul: 'Architect',
          round: 1,
          state: { topic: 'Forbidden activity scan', candidate: { summary: 'S', clauses: [] }, proofs: [] },
          telemetry,
          onCallRecord: (rec) => records.push(rec)
        }),
      (err) => {
        assert.ok(err instanceof HarnessExecutionError);
        assert.equal(err.code, 'FORBIDDEN_STATE_ACCESS');
        assert.equal(err.trace?.forbiddenStateAccess, true);
        assert.ok(err.trace.forbiddenAccessDetails.some((d) => d.includes('.council/runs/latest.js')));
        assert.equal(JSON.stringify(err.trace).includes(sensitiveDummyContent), false);
        return true;
      }
    );

    assert.equal(records.length, 1);
    assert.equal(telemetry.getProviderCalls().length, 1);
    assert.equal(records[0].trace.forbiddenStateAccess, true);
    assert.equal(records[0].trace.outcome, 'error');
    assert.ok(records[0].trace.forbiddenAccessDetails.some((d) => d.includes('.council/runs/latest.js')));
    assert.equal(JSON.stringify(records[0]).includes(sensitiveDummyContent), false, 'Receipt must NOT leak raw tool output');
    assert.equal('text' in records[0].trace.toolCalls[0], false);
    assert.equal('output' in records[0].trace.toolCalls[0], false);
    assert.equal('stdout' in records[0].trace.toolCalls[0], false);
    assert.equal('content' in records[0].trace.toolCalls[0], false);
  });

  it('emits exactly one failure telemetry receipt on post-launch MCP wait error with transport, threadId, runId, and outcome error', async () => {
    const interruptCalls = [];
    const mcpClient = new T3McpClient({
      callTool: async (name, args) => {
        if (name === 't3_thread_launch') return { threadId: 'th-err', runId: 'run-err' };
        if (name === 't3_thread_wait') {
          return { isError: true, content: [{ type: 'text', text: 'T3 MCP wait tool exploded' }] };
        }
        if (name === 't3_thread_interrupt') {
          interruptCalls.push(args);
          return { ok: true };
        }
        return {};
      }
    });

    const records = [];
    const telemetry = createTelemetryEmitter();
    const adapter = new T3HarnessAdapter({ provider: 'codex', mcpClient, capabilities: MOCK_CAPABILITIES });

    await assert.rejects(
      () =>
        adapter.executeSeatProof({
          seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', tools: 'none' },
          soul: 'Architect',
          round: 1,
          state: { topic: 'Post-launch wait MCP error' },
          telemetry,
          onCallRecord: (rec) => records.push(rec)
        }),
      (err) => err instanceof HarnessExecutionError && err.code === 'MCP_TOOL_ERROR'
    );

    assert.equal(interruptCalls.length, 1);
    assert.equal(records.length, 1);
    assert.equal(telemetry.getProviderCalls().length, 1);
    assert.equal(records[0].transport, 't3-mcp');
    assert.equal(records[0].threadId, 'th-err');
    assert.equal(records[0].runId, 'run-err');
    assert.equal(records[0].trace.outcome, 'error');
  });

  it('fails closed with T3_READ_TRUNCATED and skips archiving when truncated continuation returns empty items', async () => {
    const organizeCalls = [];
    const mcpClient = new T3McpClient({
      callTool: async (name, args) => {
        if (name === 't3_thread_launch') return { threadId: 'th-trunc-empty', runId: 'run-trunc-empty' };
        if (name === 't3_thread_wait') {
          return { threadId: args.threadId, runId: args.runId, timedOut: false, status: 'completed' };
        }
        if (name === 't3_thread_read' && args.view === 'messages' && args.itemId === 'msg-trunc') {
          return { items: [] };
        }
        if (name === 't3_thread_read' && args.view === 'messages') {
          return {
            items: [
              {
                id: 'msg-trunc',
                role: 'assistant',
                runId: 'run-trunc-empty',
                text: '{"vote":"acc',
                textTruncated: true,
                nextTextOffset: 20_000
              }
            ],
            hasMore: false
          };
        }
        if (name === 't3_thread_organize') {
          organizeCalls.push(args);
          return { ok: true };
        }
        return {};
      }
    });

    const adapter = new T3HarnessAdapter({ provider: 'codex', mcpClient, capabilities: MOCK_CAPABILITIES });
    await assert.rejects(
      () =>
        adapter.executeSeatVote({
          seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (low)', tools: 'none' },
          soul: 'Architect',
          round: 1,
          state: { topic: 'Empty continuation test', candidate: { summary: 'S', clauses: [] }, proofs: [] }
        }),
      (err) => err instanceof HarnessExecutionError && err.code === 'T3_READ_TRUNCATED'
    );

    assert.equal(organizeCalls.length, 0, 'Must NOT archive thread when continuation read failed with T3_READ_TRUNCATED');
  });

  it('rejects completed t3_thread_wait when returned runId is null or mismatched with T3_RUN_MISMATCH', async () => {
    const organizeCalls = [];
    const mcpClient = new T3McpClient({
      callTool: async (name, args) => {
        if (name === 't3_thread_launch') return { threadId: 'th-null-run', runId: 'run-expected' };
        if (name === 't3_thread_wait') {
          return { threadId: args.threadId, runId: null, timedOut: false, status: 'completed' };
        }
        if (name === 't3_thread_organize') {
          organizeCalls.push(args);
          return { ok: true };
        }
        return {};
      }
    });

    const adapter = new T3HarnessAdapter({ provider: 'codex', mcpClient, capabilities: MOCK_CAPABILITIES });
    await assert.rejects(
      () =>
        adapter.executeSeatVote({
          seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (low)', tools: 'none' },
          soul: 'Architect',
          round: 1,
          state: { topic: 'Null runId on completed wait', candidate: { summary: 'S', clauses: [] }, proofs: [] }
        }),
      (err) => err instanceof HarnessExecutionError && err.code === 'T3_RUN_MISMATCH'
    );

    assert.equal(organizeCalls.length, 0);
  });

  it('parses command_execution line 1 only, ignoring .council/ paths in stdout and excluding stdout from trace.toolCalls', async () => {
    const proofPayload = JSON.stringify({
      scope: 'README check',
      kind: 'check',
      source: 'README.md:1',
      statement: 'README exists.'
    });
    const mcpClient = new T3McpClient({
      callTool: async (name, args) => {
        if (name === 't3_thread_launch') return { threadId: 'th-cmd', runId: 'run-cmd' };
        if (name === 't3_thread_wait') {
          return { threadId: args.threadId, runId: args.runId, timedOut: false, status: 'completed' };
        }
        if (name === 't3_thread_read' && args.view === 'messages') {
          return {
            items: [{ id: 'm-cmd', role: 'assistant', runId: 'run-cmd', text: proofPayload, textTruncated: false }],
            hasMore: false
          };
        }
        if (name === 't3_thread_read' && args.view === 'activity') {
          return {
            items: [
              {
                id: 'act-cmd-1',
                type: 'command_execution',
                text: '$ cat README.md\n.council/runs/latest.js'
              }
            ],
            hasMore: false
          };
        }
        if (name === 't3_thread_organize') return { ok: true };
        return {};
      }
    });

    const records = [];
    const adapter = new T3HarnessAdapter({ provider: 'codex', mcpClient, capabilities: MOCK_CAPABILITIES });
    const proof = await adapter.executeSeatProof({
      seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', tools: 'none' },
      soul: 'Architect',
      round: 1,
      state: { topic: 'Command execution activity stdout isolation' },
      onCallRecord: (rec) => records.push(rec)
    });

    assert.equal(proof.kind, 'check');
    assert.equal(records.length, 1);
    assert.equal(records[0].trace.forbiddenStateAccess, false);
    assert.equal(records[0].trace.toolCalls.length, 1);
    assert.equal(records[0].trace.toolCalls[0].command, 'cat README.md');
    assert.equal(JSON.stringify(records[0].trace.toolCalls[0]).includes('cat README.md'), true);
    assert.equal(JSON.stringify(records[0].trace.toolCalls[0]).includes('.council/runs/latest.js'), false);
    assert.equal('text' in records[0].trace.toolCalls[0], false);
  });

  it('detects forbidden access in dynamic_tool complete and truncated JSON inputs while dropping output secrets, and ignores output-only .council/ mentions', async () => {
    const proofPayload = JSON.stringify({
      scope: 'Dynamic tool check',
      kind: 'check',
      source: 'src/app.js:1',
      statement: 'Checked app.'
    });

    const runWithActivity = async (activityItem) => {
      const records = [];
      const mcpClient = new T3McpClient({
        callTool: async (name, args) => {
          if (name === 't3_thread_launch') return { threadId: 'th-dyn', runId: 'run-dyn' };
          if (name === 't3_thread_wait') {
            return { threadId: args.threadId, runId: args.runId, timedOut: false, status: 'completed' };
          }
          if (name === 't3_thread_read' && args.view === 'messages') {
            return {
              items: [{ id: 'm-dyn', role: 'assistant', runId: 'run-dyn', text: proofPayload, textTruncated: false }],
              hasMore: false
            };
          }
          if (name === 't3_thread_read' && args.view === 'activity') {
            return { items: [activityItem], hasMore: false };
          }
          if (name === 't3_thread_organize') return { ok: true };
          return {};
        }
      });
      const adapter = new T3HarnessAdapter({ provider: 'codex', mcpClient, capabilities: MOCK_CAPABILITIES });
      return {
        adapter,
        records,
        exec: () =>
          adapter.executeSeatProof({
            seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', tools: 'none' },
            soul: 'Architect',
            round: 1,
            state: { topic: 'Dynamic tool activity wire parsing' },
            onCallRecord: (rec) => records.push(rec)
          })
      };
    };

    // 1. Complete JSON with forbidden input + sensitive output
    const completeRun = await runWithActivity({
      id: 'dyn-1',
      type: 'dynamic_tool',
      text: JSON.stringify({
        toolName: 'read_file',
        input: { path: '.council/runs/latest.js' },
        output: 'TOP_SECRET_FILE_BODY'
      })
    });
    await assert.rejects(
      () => completeRun.exec(),
      (err) => {
        assert.ok(err instanceof HarnessExecutionError);
        assert.equal(err.code, 'FORBIDDEN_STATE_ACCESS');
        assert.equal(err.trace.forbiddenStateAccess, true);
        assert.equal(JSON.stringify(err.trace.toolCalls).includes('TOP_SECRET_FILE_BODY'), false);
        assert.equal(err.trace.toolCalls[0].toolName, 'read_file');
        return true;
      }
    );
    assert.equal(completeRun.records.length, 1);
    assert.equal(JSON.stringify(completeRun.records[0].trace.toolCalls).includes('TOP_SECRET_FILE_BODY'), false);

    // 2. Truncated JSON cut off mid-"output" with forbidden path in "input"
    const truncatedRun = await runWithActivity({
      id: 'dyn-2',
      type: 'dynamic_tool',
      textTruncated: true,
      text: '{"toolName":"read_file","input":{"path":".council/runs/state.json"},"output":"TRUNCATED_SECRET_BODY_unclosed'
    });
    await assert.rejects(
      () => truncatedRun.exec(),
      (err) => {
        assert.ok(err instanceof HarnessExecutionError);
        assert.equal(err.code, 'FORBIDDEN_STATE_ACCESS');
        assert.equal(err.trace.forbiddenStateAccess, true);
        assert.equal(JSON.stringify(err.trace.toolCalls).includes('TRUNCATED_SECRET_BODY'), false);
        assert.equal(err.trace.toolCalls[0].toolName, 'read_file');
        return true;
      }
    );
    assert.equal(truncatedRun.records.length, 1);
    assert.equal(JSON.stringify(truncatedRun.records[0].trace.toolCalls).includes('TRUNCATED_SECRET_BODY'), false);

    // 3. dynamic_tool where .council/runs/state.json appears ONLY inside "output"
    const outputOnlyRun = await runWithActivity({
      id: 'dyn-3',
      type: 'dynamic_tool',
      text: JSON.stringify({
        toolName: 'grep',
        input: { query: 'healthCheck' },
        output: 'Matched .council/runs/state.json in stdout'
      })
    });
    const proof = await outputOnlyRun.exec();
    assert.equal(proof.kind, 'check');
    assert.equal(outputOnlyRun.records.length, 1);
    assert.equal(outputOnlyRun.records[0].trace.forbiddenStateAccess, false);
    assert.equal(
      JSON.stringify(outputOnlyRun.records[0].trace.toolCalls).includes('.council/runs/state.json'),
      false
    );
    assert.equal('text' in outputOnlyRun.records[0].trace.toolCalls[0], false);
  });

  it('ignores file_change item.text diffs/contents for forbidden scanning and excludes them from trace.toolCalls', async () => {
    const proofPayload = JSON.stringify({
      scope: 'App diff',
      kind: 'check',
      source: 'src/app.js:1',
      statement: 'File change reviewed.'
    });
    const mcpClient = new T3McpClient({
      callTool: async (name, args) => {
        if (name === 't3_thread_launch') return { threadId: 'th-file', runId: 'run-file' };
        if (name === 't3_thread_wait') {
          return { threadId: args.threadId, runId: args.runId, timedOut: false, status: 'completed' };
        }
        if (name === 't3_thread_read' && args.view === 'messages') {
          return {
            items: [{ id: 'm-file', role: 'assistant', runId: 'run-file', text: proofPayload, textTruncated: false }],
            hasMore: false
          };
        }
        if (name === 't3_thread_read' && args.view === 'activity') {
          return {
            items: [
              {
                id: 'act-file-1',
                type: 'file_change',
                path: 'src/app.js',
                text: 'diff --git\n+PRIVATE_FILE_CONTENT\n+.council/runs/x'
              }
            ],
            hasMore: false
          };
        }
        if (name === 't3_thread_organize') return { ok: true };
        return {};
      }
    });

    const records = [];
    const adapter = new T3HarnessAdapter({ provider: 'codex', mcpClient, capabilities: MOCK_CAPABILITIES });
    const proof = await adapter.executeSeatProof({
      seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', tools: 'none' },
      soul: 'Architect',
      round: 1,
      state: { topic: 'file_change activity privacy' },
      onCallRecord: (rec) => records.push(rec)
    });

    assert.equal(proof.kind, 'check');
    assert.equal(records.length, 1);
    assert.equal(records[0].trace.forbiddenStateAccess, false);
    assert.equal(records[0].trace.toolCalls[0].path, 'src/app.js');
    assert.equal(JSON.stringify(records[0].trace.toolCalls).includes('PRIVATE_FILE_CONTENT'), false);
    assert.equal(JSON.stringify(records[0].trace.toolCalls).includes('.council/runs/x'), false);
    assert.equal('text' in records[0].trace.toolCalls[0], false);
  });

  it('fails closed with T3_READ_TRUNCATED and skips archiving when continuation returns mismatched itemId or empty text with textTruncated: false', async () => {
    const runContinuationCase = async (continuationItems) => {
      const organizeCalls = [];
      const mcpClient = new T3McpClient({
        callTool: async (name, args) => {
          if (name === 't3_thread_launch') return { threadId: 'th-cont', runId: 'run-cont' };
          if (name === 't3_thread_wait') {
            return { threadId: args.threadId, runId: args.runId, timedOut: false, status: 'completed' };
          }
          if (name === 't3_thread_read' && args.view === 'messages' && args.itemId === 'msg-target') {
            return { items: continuationItems, hasMore: false };
          }
          if (name === 't3_thread_read' && args.view === 'messages') {
            return {
              items: [
                {
                  id: 'msg-target',
                  role: 'assistant',
                  runId: 'run-cont',
                  text: '{"vote":"acc',
                  textTruncated: true,
                  nextTextOffset: 20_000
                }
              ],
              hasMore: false
            };
          }
          if (name === 't3_thread_organize') {
            organizeCalls.push(args);
            return { ok: true };
          }
          return {};
        }
      });

      const adapter = new T3HarnessAdapter({ provider: 'codex', mcpClient, capabilities: MOCK_CAPABILITIES });
      await assert.rejects(
        () =>
          adapter.executeSeatVote({
            seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (low)', tools: 'none' },
            soul: 'Architect',
            round: 1,
            state: { topic: 'Continuation fail-closed test', candidate: { summary: 'S', clauses: [] }, proofs: [] }
          }),
        (err) => err instanceof HarnessExecutionError && err.code === 'T3_READ_TRUNCATED'
      );
      assert.equal(organizeCalls.length, 0);
    };

    // 1. Mismatched itemId only
    await runContinuationCase([{ id: 'msg-other', role: 'assistant', text: 'unrelated', textTruncated: false }]);

    // 2. Matching itemId with empty text even when textTruncated: false
    await runContinuationCase([{ id: 'msg-target', role: 'assistant', text: '', textTruncated: false }]);
  });

  it('does not promote stdout line 2 when command_execution text starts with a blank line', async () => {
    const proofPayload = JSON.stringify({
      scope: 'Blank line command',
      kind: 'check',
      source: 'README.md:1',
      statement: 'Checked safely.'
    });
    const mcpClient = new T3McpClient({
      callTool: async (name, args) => {
        if (name === 't3_thread_launch') return { threadId: 'th-blank-cmd', runId: 'run-blank-cmd' };
        if (name === 't3_thread_wait') {
          return { threadId: args.threadId, runId: args.runId, timedOut: false, status: 'completed' };
        }
        if (name === 't3_thread_read' && args.view === 'messages') {
          return {
            items: [{ id: 'm-blank', role: 'assistant', runId: 'run-blank-cmd', text: proofPayload, textTruncated: false }],
            hasMore: false
          };
        }
        if (name === 't3_thread_read' && args.view === 'activity') {
          return {
            items: [
              {
                id: 'act-blank-cmd',
                type: 'command_execution',
                text: '\n.council/runs/latest.js\nTOP_SECRET_STDOUT'
              }
            ],
            hasMore: false
          };
        }
        if (name === 't3_thread_organize') return { ok: true };
        return {};
      }
    });

    const records = [];
    const adapter = new T3HarnessAdapter({ provider: 'codex', mcpClient, capabilities: MOCK_CAPABILITIES });
    const proof = await adapter.executeSeatProof({
      seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', tools: 'none' },
      soul: 'Architect',
      round: 1,
      state: { topic: 'Blank leading line command_execution' },
      onCallRecord: (rec) => records.push(rec)
    });

    assert.equal(proof.kind, 'check');
    assert.equal(records.length, 1);
    assert.equal(records[0].trace.forbiddenStateAccess, false);
    assert.equal(JSON.stringify(records[0].trace.toolCalls).includes('.council/runs/latest.js'), false);
    assert.equal(JSON.stringify(records[0].trace.toolCalls).includes('TOP_SECRET_STDOUT'), false);
  });

  it('preserves forbidden path detection inside truncated dynamic_tool input that contains an input "output" key', async () => {
    const proofPayload = JSON.stringify({
      scope: 'Truncated nested output key',
      kind: 'check',
      source: 'src/app.js:1',
      statement: 'Checked.'
    });
    const mcpClient = new T3McpClient({
      callTool: async (name, args) => {
        if (name === 't3_thread_launch') return { threadId: 'th-nested-out', runId: 'run-nested-out' };
        if (name === 't3_thread_wait') {
          return { threadId: args.threadId, runId: args.runId, timedOut: false, status: 'completed' };
        }
        if (name === 't3_thread_read' && args.view === 'messages') {
          return {
            items: [{ id: 'm-nested', role: 'assistant', runId: 'run-nested-out', text: proofPayload, textTruncated: false }],
            hasMore: false
          };
        }
        if (name === 't3_thread_read' && args.view === 'activity') {
          return {
            items: [
              {
                id: 'act-nested-out',
                type: 'dynamic_tool',
                textTruncated: true,
                text: '{"toolName":"write_file","input":{"output":"diff","path":".council/runs/latest.js","content":"unclosed'
              }
            ],
            hasMore: false
          };
        }
        if (name === 't3_thread_organize') return { ok: true };
        return {};
      }
    });

    const adapter = new T3HarnessAdapter({ provider: 'codex', mcpClient, capabilities: MOCK_CAPABILITIES });
    await assert.rejects(
      () =>
        adapter.executeSeatProof({
          seat: { id: 's1', harness: 'codex', model: 'gpt-6.2-sol (xhigh)', tools: 'none' },
          soul: 'Architect',
          round: 1,
          state: { topic: 'Truncated dynamic_tool input with output field' }
        }),
      (err) => err instanceof HarnessExecutionError && err.code === 'FORBIDDEN_STATE_ACCESS'
    );
  });
});
