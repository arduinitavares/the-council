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
      provider: 'codex',
      canRunChildTask: true,
      models: [
        { model: 'gpt-6.2-sol', optionKey: 'reasoningEffort', efforts: ['low', 'medium', 'high', 'xhigh'] },
        { model: 'gpt-6.2-astra', optionKey: 'reasoningEffort', efforts: ['low', 'medium', 'high', 'xhigh'] },
        { model: 'gpt-6-astra', optionKey: 'reasoningEffort', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }
      ]
    },
    {
      provider: 'antigravity',
      canRunChildTask: true,
      models: [
        { model: 'gemini-4-neon', optionKey: 'thought_level', efforts: ['low', 'medium', 'high', 'xhigh'] },
        { model: 'gemini-pro-orchestrator-neon', optionKey: null, efforts: null },
        { model: 'claude-opus-5-5', optionKey: 'thought_level', efforts: ['low', 'medium', 'high'] }
      ]
    },
    {
      provider: 'cursor',
      canRunChildTask: true,
      models: [
        { model: 'grok-4.7', optionKey: 'reasoning_effort', efforts: ['low', 'medium', 'high', 'xhigh'] },
        { model: 'grok-4.6', optionKey: 'effort', efforts: ['low', 'medium', 'high'] },
        { model: 'composer-2.5', optionKey: null, efforts: null }
      ]
    }
  ]
};

describe('Task 3: T3HarnessAdapter direct contract tests', () => {
  it('translates modelSelection per provider capability option key and omits effort for composer-2.5 and gemini-pro-orchestrator-neon', () => {
    const codex = new T3HarnessAdapter({ provider: 'codex', capabilities: MOCK_CAPABILITIES });
    assert.deepEqual(codex.translateModelSelection('gpt-6.2-sol (xhigh)'), {
      provider: 'codex',
      model: 'gpt-6.2-sol',
      options: { reasoningEffort: 'xhigh' }
    });

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
    assert.deepEqual(cursor.translateModelSelection('composer-2.5'), {
      provider: 'cursor',
      model: 'composer-2.5'
    });
    assert.throws(() => cursor.validateModel('composer-2.5 (high)'), /not permitted/i);
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
});
