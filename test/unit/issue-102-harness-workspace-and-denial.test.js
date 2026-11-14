import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as rootModule from '../../src/index.js';
import * as typesModule from '../../src/types.js';
import * as harnessIndex from '../../src/harness/index.js';
import * as adapterModule from '../../src/harness/adapter.js';
import * as cliRunner from '../../src/harness/cli-runner.js';

const {
  HarnessAdapter,
  QuotaExhaustionError,
  AuthenticationError,
  HarnessExecutionError,
  TimeoutError,
  AbortError
} = adapterModule;

const {
  AntigravityAdapter,
  CodexAdapter,
  CursorAdapter,
  MockAdapter
} = harnessIndex;

function makeTempDir(prefix = 'council-issue102-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmDir(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('Issue 102 exports HeadlessToolDeniedError, PID-safe regexes, and resolveAttemptExecutionWorkspace across adapter, harness index, and root index', () => {
  for (const mod of [adapterModule, harnessIndex, rootModule]) {
    assert.equal(typeof mod.HeadlessToolDeniedError, 'function');
    assert.ok(mod.PROVIDER_HTTP_429_REGEX instanceof RegExp);
    assert.ok(mod.PROVIDER_HTTP_AUTH_REGEX instanceof RegExp);
    assert.equal(typeof mod.resolveAttemptExecutionWorkspace, 'function');
  }

  assert.ok(typesModule.ERROR_CLASSES.includes('HeadlessToolDeniedError'));

  const DeniedError = harnessIndex.HeadlessToolDeniedError;
  const err = new DeniedError('Tool denied in headless mode', {
    harness: 'antigravity',
    seatId: 'seat-1',
    model: 'gemini-4-argon-high',
    exitCode: 0,
    stderr: 'permission denied for read_file',
    deniedActions: [{ tool: 'read_file', reason: 'headless_denied' }],
    finishedReason: 'STOP',
    envelopeError: 'permission_denied',
    trace: { outcome: 'error', deniedActions: [{ tool: 'read_file', reason: 'headless_denied' }] }
  });

  assert.ok(err instanceof adapterModule.HarnessError);
  assert.equal(err.name, 'HeadlessToolDeniedError');
  assert.equal(err.code, 'HEADLESS_TOOL_DENIED');
  assert.equal(err.isQuotaFault, false);
  assert.equal(err.isRetryable, true);
  assert.equal(err.exitCode, 0);
  assert.deepEqual(err.deniedActions, [{ tool: 'read_file', reason: 'headless_denied' }]);
  assert.equal(err.finishedReason, 'STOP');
  assert.equal(err.envelopeError, 'permission_denied');
});

test('PID-safe HTTP 429 and 401/403 regexes reject PIDs/ports/counts and match real HTTP status signatures across all adapters', () => {
  const { PROVIDER_HTTP_429_REGEX, PROVIDER_HTTP_AUTH_REGEX } = adapterModule;

  const benignPidMessages = [
    '(node:429) ExperimentalWarning: Example harmless warning',
    '(node:401) DeprecationWarning: harmless pid warning',
    '(node:403) Warning: harmless pid warning',
    'Child process pid 429 exited with status 1',
    'Terminated pid=429 via SIGTERM',
    'Killed pid:401 during cleanup',
    'Subprocess 403 ended abnormally',
    'Listening on port 429 for worker',
    'Processed 401 items in batch'
  ];

  for (const text of benignPidMessages) {
    assert.equal(PROVIDER_HTTP_429_REGEX.test(text), false, `false 429 match on: ${text}`);
    assert.equal(PROVIDER_HTTP_AUTH_REGEX.test(text), false, `false auth match on: ${text}`);
  }

  const real429Messages = [
    'HTTP 429 Too Many Requests',
    'HTTP/1.1 429 Too Many Requests',
    'status: 429',
    'statusCode=429',
    'error code=429',
    '{"error":{"code":429,"message":"Too many requests"}}'
  ];
  for (const text of real429Messages) {
    assert.equal(PROVIDER_HTTP_429_REGEX.test(text), true, `missed 429 match on: ${text}`);
  }

  const realAuthMessages = [
    'HTTP 401 Unauthorized',
    'HTTP/2 403 Forbidden',
    'status=401',
    'status code: 403',
    'error code=401',
    '{"code":403,"message":"Forbidden"}'
  ];
  for (const text of realAuthMessages) {
    assert.equal(PROVIDER_HTTP_AUTH_REGEX.test(text), true, `missed auth match on: ${text}`);
  }

  const adapters = [
    new HarnessAdapter({ name: 'base' }),
    new AntigravityAdapter({}),
    new CodexAdapter({}),
    new CursorAdapter({})
  ];

  for (const adapter of adapters) {
    const pidErr = Object.assign(new Error('Process failed (pid 429)'), {
      exitCode: 1,
      stderr: '(node:429) ExperimentalWarning: harmless; kill -TERM pid=429 pid:401 worker 403'
    });
    const classifiedPid = adapter.classifyError(pidErr, { seatId: 's1', model: 'm1' });
    assert.ok(
      classifiedPid instanceof HarnessExecutionError,
      `${adapter.name} must classify PID noise as HarnessExecutionError, got ${classifiedPid.constructor.name}`
    );
    assert.equal(classifiedPid instanceof QuotaExhaustionError, false);
    assert.equal(classifiedPid instanceof AuthenticationError, false);

    const quotaErr = Object.assign(new Error('Request failed'), {
      exitCode: 1,
      stderr: 'HTTP/1.1 429 Too Many Requests'
    });
    const classifiedQuota = adapter.classifyError(quotaErr, { seatId: 's1', model: 'm1' });
    assert.ok(
      classifiedQuota instanceof QuotaExhaustionError,
      `${adapter.name} must classify HTTP 429 as QuotaExhaustionError, got ${classifiedQuota.constructor.name}`
    );

    const authErr = Object.assign(new Error('Auth failed'), {
      exitCode: 1,
      stderr: 'HTTP/1.1 403 Forbidden'
    });
    const classifiedAuth = adapter.classifyError(authErr, { seatId: 's1', model: 'm1' });
    assert.ok(
      classifiedAuth instanceof AuthenticationError,
      `${adapter.name} must classify HTTP 403 as AuthenticationError, got ${classifiedAuth.constructor.name}`
    );
  }
});

test('stripKnownBenignAntigravityWarning and hasExplicitProviderErrorSignature isolate benign warnings from explicit errors', () => {
  const cleaned = cliRunner.stripKnownBenignAntigravityWarning(
    '  warning: --mode plan has no effect while slash command expansion is disabled.\n(node:429) ExperimentalWarning: harmless\n'
  );
  assert.equal(cleaned, '(node:429) ExperimentalWarning: harmless');
  assert.equal(cliRunner.hasExplicitProviderErrorSignature(cleaned), false);
  assert.equal(cliRunner.hasExplicitProviderErrorSignature('status=429 resource_exhausted'), true);
  assert.equal(cliRunner.hasExplicitProviderErrorSignature('HTTP 401 Unauthorized'), true);
  assert.equal(cliRunner.hasExplicitProviderErrorSignature('model_not_found'), true);
});

test('prepareIsolatedCliWorkspace excludes .codegraph (case-insensitive), .council, node_modules, symlinks, canonicalizes via realpathSync, and sets _invocationMeta only in copy branch', async () => {
  const workspaceRoot = makeTempDir('council-codegraph-repo-');
  const outsideSecretDir = makeTempDir('council-outside-secret-');
  let copyResult;

  try {
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'src', 'app.js'), 'export const ok = true;\n');
    fs.mkdirSync(path.join(workspaceRoot, '.CodeGraph', 'index'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, '.CodeGraph', 'index', 'graph.sqlite'), 'secret-graph');
    fs.mkdirSync(path.join(workspaceRoot, 'packages', 'sub', '.codegraph'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'packages', 'sub', '.codegraph', 'db.bin'), 'nested-graph');
    fs.mkdirSync(path.join(workspaceRoot, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'node_modules', 'pkg', 'index.js'), 'dep');
    fs.mkdirSync(path.join(workspaceRoot, 'packages', 'sub', 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'packages', 'sub', 'node_modules', 'dep', 'x.js'), 'nested-dep');

    fs.writeFileSync(path.join(outsideSecretDir, 'leak.txt'), 'do-not-follow');
    fs.symlinkSync(
      path.join(workspaceRoot, '.CodeGraph', 'index', 'graph.sqlite'),
      path.join(workspaceRoot, 'src', 'link-to-codegraph')
    );
    fs.symlinkSync(
      path.join(workspaceRoot, 'node_modules', 'pkg', 'index.js'),
      path.join(workspaceRoot, 'src', 'link-to-nm')
    );

    const copyContext = { seatId: 'seat-copy' };
    copyResult = cliRunner.prepareIsolatedCliWorkspace({
      effectiveTools: 'read-only',
      cwd: workspaceRoot,
      context: copyContext,
      env: { OLDPWD: '/stale/oldpwd', INIT_CWD: '/stale/initcwd', PATH: process.env.PATH || '' }
    });

    assert.equal(copyResult.isolated, true);
    assert.ok(path.basename(copyResult.tempCwdDir).startsWith('council-safe-cwd-'));
    assert.equal(copyResult.effectiveCwd, fs.realpathSync(copyResult.tempCwdDir));
    assert.equal(copyResult.effectiveEnv.PWD, copyResult.effectiveCwd);
    assert.equal(copyResult.env.PWD, copyResult.effectiveCwd);
    assert.equal('OLDPWD' in copyResult.effectiveEnv, false);
    assert.equal('INIT_CWD' in copyResult.effectiveEnv, false);

    assert.equal(fs.existsSync(path.join(copyResult.effectiveCwd, 'src', 'app.js')), true);
    assert.equal(fs.existsSync(path.join(copyResult.effectiveCwd, '.CodeGraph')), false);
    assert.equal(fs.existsSync(path.join(copyResult.effectiveCwd, '.codegraph')), false);
    assert.equal(fs.existsSync(path.join(copyResult.effectiveCwd, 'packages', 'sub', '.codegraph')), false);
    assert.equal(fs.existsSync(path.join(copyResult.effectiveCwd, 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(copyResult.effectiveCwd, 'packages', 'sub', 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(copyResult.effectiveCwd, 'src', 'link-to-codegraph')), false);
    assert.equal(fs.existsSync(path.join(copyResult.effectiveCwd, 'src', 'link-to-nm')), false);

    assert.ok(Array.isArray(copyContext._invocationMeta?.trustedEphemeralRoots));
    assert.ok(copyContext._invocationMeta.trustedEphemeralRoots.includes(copyResult.effectiveCwd));
    assert.ok(Array.isArray(copyContext._invocationMeta?.forbiddenWorkspaceRoots));
    assert.ok(copyContext._invocationMeta.forbiddenWorkspaceRoots.includes(fs.realpathSync(workspaceRoot)));

    // Clean directory branch (no .council, no .codegraph)
    const cleanDir = makeTempDir('council-clean-repo-');
    try {
      const cleanContext = { seatId: 'seat-clean' };
      const cleanRes = cliRunner.prepareIsolatedCliWorkspace(cleanDir, cleanContext);
      assert.equal(cleanRes.isolated, false);
      assert.equal(cleanRes.tempCwdDir, null);
      assert.equal(cleanRes.effectiveCwd, fs.realpathSync(cleanDir));
      assert.equal(cleanRes.effectiveEnv.PWD, cleanRes.effectiveCwd);
      assert.equal('OLDPWD' in cleanRes.effectiveEnv, false);
      assert.equal('INIT_CWD' in cleanRes.effectiveEnv, false);
      assert.equal(cleanContext._invocationMeta, undefined);
    } finally {
      rmDir(cleanDir);
    }

    // tools === 'none' branch
    const noneContext = { seatId: 'seat-none' };
    const noneRes = cliRunner.prepareIsolatedCliWorkspace({
      effectiveTools: 'none',
      cwd: workspaceRoot,
      context: noneContext,
      env: { OLDPWD: '/old', INIT_CWD: '/init', PATH: process.env.PATH || '' }
    });
    try {
      assert.equal(noneRes.isolated, false);
      assert.ok(path.basename(noneRes.tempCwdDir).startsWith('council-seat-cwd-'));
      assert.equal(noneRes.effectiveCwd, fs.realpathSync(noneRes.tempCwdDir));
      assert.equal(noneRes.effectiveEnv.PWD, noneRes.effectiveCwd);
      assert.equal('OLDPWD' in noneRes.effectiveEnv, false);
      assert.equal('INIT_CWD' in noneRes.effectiveEnv, false);
      assert.equal(noneContext._invocationMeta, undefined);
    } finally {
      await noneRes.cleanup();
      assert.equal(fs.existsSync(noneRes.tempCwdDir), false);
    }

    // Virtual non-existent clean cwd (ENOENT) falls back to path.resolve without failing
    const nonexistentPath = path.join(workspaceRoot, 'does-not-exist-yet');
    const virtualRes = cliRunner.prepareIsolatedCliWorkspace({
      effectiveTools: 'read-only',
      cwd: nonexistentPath,
      context: { seatId: 'seat-virtual' }
    });
    assert.equal(virtualRes.isolated, false);
    assert.equal(virtualRes.effectiveCwd, path.resolve(nonexistentPath));
    assert.equal(virtualRes.effectiveEnv.PWD, path.resolve(nonexistentPath));

    await copyResult.cleanup();
    assert.equal(fs.existsSync(copyResult.tempCwdDir), false);
  } finally {
    if (copyResult?.tempCwdDir) {
      rmDir(copyResult.tempCwdDir);
    }
    rmDir(workspaceRoot);
    rmDir(outsideSecretDir);
  }
});

test('resolveAttemptExecutionWorkspace and all 4 adapters mutate callerContext._invocationMeta by shared reference and pass retryDiagnostics', async () => {
  const proofPayload = JSON.stringify({
    scope: 'auth',
    kind: 'check',
    source: 'src/app.js:1',
    statement: 'Verified cleanly'
  });
  const judgePayload = JSON.stringify({
    summary: 'All admitted',
    clauses: [{ context: 'auth', conclusion: 'safe', citedProofIds: ['P1'] }]
  });

  const noneWorkspace = adapterModule.resolveAttemptExecutionWorkspace({
    role: 'seat',
    phase: 'DELIBERATION',
    participant: { id: 'seat-1', tools: 'none', cwd: '/seat/ignored' },
    state: { cwd: '/state/root' },
    callerContext: { cwd: '/caller/root' }
  });
  assert.equal(noneWorkspace.effectiveTools, 'none');
  assert.equal(noneWorkspace.configuredWorkspaceCwd, '/caller/root');
  assert.equal(noneWorkspace.effectiveCwd, undefined);

  let capturedAgyCtx = null;
  const agyAdapter = new AntigravityAdapter({
    spawnRunner: async ({ context }) => {
      capturedAgyCtx = context;
      return proofPayload;
    }
  });
  const callerCtxAgy = {
    cwd: '/tmp/agy-repo',
    phase: 'DELIBERATION',
    round: 1,
    retryDiagnostics: {
      attempt: 2,
      requestedModel: 'gemini-4-argon-high',
      requestedEffort: 'high',
      effectiveEffort: 'medium',
      capabilityProvenance: 'detected',
      fallbackApplied: true,
      fallbackReason: 'effort_downgrade'
    }
  };
  await agyAdapter.executeSeat({
    seat: { id: 'seat-1', role: 'reviewer', harness: 'antigravity', model: 'gemini-4-argon-high' },
    soul: 'Reviewer: check empirical invariants',
    round: 1,
    phase: 'DELIBERATION',
    state: { topic: 'Verify auth' },
    context: callerCtxAgy
  });
  assert.ok(callerCtxAgy._invocationMeta);
  assert.equal(capturedAgyCtx._invocationMeta, callerCtxAgy._invocationMeta);
  assert.equal(capturedAgyCtx._invocationMeta.effectiveTools, 'read-only');
  assert.equal(capturedAgyCtx._invocationMeta.effectiveCwd, '/tmp/agy-repo');
  assert.deepEqual(capturedAgyCtx.retryDiagnostics, callerCtxAgy.retryDiagnostics);

  // End-to-end shared reference test with real AntigravityAdapter -> runAntigravityCli -> prepareIsolatedCliWorkspace
  const e2eRepo = makeTempDir('council-adapter-e2e-');
  try {
    fs.mkdirSync(path.join(e2eRepo, '.codegraph'), { recursive: true });
    const e2eCallerCtx = { cwd: e2eRepo };
    const e2eAgyAdapter = new AntigravityAdapter({
      spawnRunner: (opts) =>
        cliRunner.runAntigravityCli({
          ...opts,
          exec: async (_bin, _args, execOpts) => {
            assert.equal(fs.existsSync(path.join(execOpts.cwd, '.codegraph')), false);
            return { exitCode: 0, stdout: JSON.stringify({ response: proofPayload }), stderr: '' };
          }
        })
    });
    await e2eAgyAdapter.executeSeat({
      seat: { id: 'seat-e2e', role: 'reviewer', harness: 'antigravity', model: 'gemini-4-argon-high' },
      soul: 'Reviewer: verify isolation',
      round: 1,
      phase: 'DELIBERATION',
      state: { topic: 'Verify auth' },
      context: e2eCallerCtx
    });
    assert.ok(e2eCallerCtx._invocationMeta?.trustedEphemeralRoots?.length > 0);
    assert.ok(e2eCallerCtx._invocationMeta?.forbiddenWorkspaceRoots?.includes(fs.realpathSync(e2eRepo)));
  } finally {
    rmDir(e2eRepo);
  }

  let capturedCodexCtx = null;
  const codexAdapter = new CodexAdapter({
    spawnRunner: async ({ context }) => {
      capturedCodexCtx = context;
      return judgePayload;
    }
  });
  const callerCtxCodex = { cwd: '/tmp/codex-repo' };
  await codexAdapter.executeJudge({
    judge: { id: 'judge-1', harness: 'codex', model: 'gpt-6.1-sol' },
    round: 1,
    phase: 'JUDGE_AUDIT_SYNTHESIS',
    proofs: [{ id: 'P1', seatId: 'seat-1', round: 1, scope: 'auth', kind: 'check', source: 'src/app.js:1', statement: 'Verified cleanly', status: 'pending' }],
    state: { topic: 'Verify auth' },
    context: callerCtxCodex
  });
  assert.equal(capturedCodexCtx._invocationMeta, callerCtxCodex._invocationMeta);
  assert.equal(capturedCodexCtx._invocationMeta.effectiveCwd, '/tmp/codex-repo');
  assert.equal(capturedCodexCtx.retryDiagnostics, null);

  let capturedCursorCtx = null;
  const cursorAdapter = new CursorAdapter({
    spawnRunner: async ({ context }) => {
      capturedCursorCtx = context;
      return proofPayload;
    }
  });
  const callerCtxCursor = { cwd: '/tmp/cursor-repo' };
  await cursorAdapter.executeSeat({
    seat: { id: 'seat-2', role: 'reviewer', harness: 'cursor', model: 'composer-2.5' },
    soul: 'Reviewer: check empirical invariants',
    round: 1,
    phase: 'DELIBERATION',
    state: { topic: 'Verify auth' },
    context: callerCtxCursor
  });
  assert.equal(capturedCursorCtx._invocationMeta, callerCtxCursor._invocationMeta);
  assert.equal(capturedCursorCtx._invocationMeta.effectiveCwd, '/tmp/cursor-repo');
  assert.equal(capturedCursorCtx.retryDiagnostics, null);

  let capturedMockCtx = null;
  const mockAdapter = new MockAdapter();
  mockAdapter.scriptSeatResponse({
    seatId: 'seat-mock',
    response: ({ context }) => {
      capturedMockCtx = context;
      return {
        scope: 'auth',
        kind: 'check',
        source: 'src/app.js:1',
        statement: 'mocked'
      };
    }
  });
  const callerCtxMock = { cwd: '/tmp/mock-repo' };
  await mockAdapter.executeSeat({
    seat: { id: 'seat-mock', role: 'reviewer', harness: 'mock', model: 'mock-model' },
    round: 1,
    phase: 'DELIBERATION',
    state: { topic: 'Verify auth' },
    context: callerCtxMock
  });
  assert.equal(capturedMockCtx._invocationMeta, callerCtxMock._invocationMeta);
  assert.equal(capturedMockCtx._invocationMeta.effectiveCwd, '/tmp/mock-repo');
  assert.equal(capturedMockCtx.retryDiagnostics, null);
});

test('runAntigravityCli keeps Promise<string> return and honors Spec section 3 precedence on exitCode 0 and nonzero', async () => {
  const agyAdapter = new AntigravityAdapter({});

  // 1. Happy path returns string + forwards retryDiagnostics / telemetry fields
  const recordedCalls = [];
  const happyOut = await cliRunner.runAntigravityCli({
    model: 'gemini-4-argon-high',
    prompt: 'Analyze module',
    tools: 'none',
    context: {
      seatId: 'seat-happy',
      phase: 'DELIBERATION',
      round: 1,
      retryDiagnostics: {
        attempt: 1,
        requestedModel: 'gemini-4-argon-high',
        requestedEffort: 'high',
        effectiveEffort: 'medium',
        capabilityProvenance: 'detected',
        fallbackApplied: true,
        fallbackReason: 'quota_downgrade'
      }
    },
    onCallRecord: (rec) => recordedCalls.push(rec),
    exec: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ response: 'All checks look clean.' }),
      stderr: 'WARNING: --mode plan has no effect while slash command expansion is disabled.'
    })
  });
  assert.equal(typeof happyOut, 'string');
  assert.equal(happyOut, 'All checks look clean.');
  assert.equal(recordedCalls.length, 1);
  assert.equal(recordedCalls[0].phase, 'DELIBERATION');
  assert.equal(recordedCalls[0].round, 1);
  assert.equal(recordedCalls[0].attempt, 1);
  assert.equal(recordedCalls[0].requestedEffort, 'high');
  assert.equal(recordedCalls[0].effectiveEffort, 'medium');
  assert.equal(recordedCalls[0].fallbackApplied, true);
  assert.equal(recordedCalls[0].trace.stderr, undefined);

  // 2. Step 1: exitCode 0 + forbiddenStateAccess wins over non-empty response and denied_actions -> FORBIDDEN_STATE_ACCESS
  await assert.rejects(
    () =>
      cliRunner.runAntigravityCli({
        model: 'gemini-4-argon-high',
        prompt: 'Analyze module',
        tools: 'none',
        exec: async () => ({
          exitCode: 0,
          stdout: JSON.stringify({
            response: 'partial',
            denied_actions: [{ tool: 'read_file', path: '.council/votes.json' }]
          }),
          stderr: ''
        })
      }),
    (err) => err.code === 'FORBIDDEN_STATE_ACCESS' && err.trace?.forbiddenStateAccess === true
  );

  // 3. Step 2: Non-empty resolvedOutput with denied_actions returns verbatim string (#97 compat) with trace.outcome === 'error'
  const step2Calls = [];
  const partialOut = await cliRunner.runAntigravityCli({
    model: 'gemini-4-argon-high',
    prompt: 'Analyze module',
    tools: 'none',
    onCallRecord: (rec) => step2Calls.push(rec),
    exec: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        response: 'usable fallback output',
        denied_actions: [{ tool: 'read_file', reason: 'headless_denied' }]
      }),
      stderr: '(node:401) harmless warning'
    })
  });
  assert.equal(partialOut, 'usable fallback output');
  assert.equal(step2Calls.length, 1);
  assert.equal(step2Calls[0].trace.outcome, 'error');
  assert.equal(step2Calls[0].trace.stderr, '(node:401) harmless warning');

  // 4. Step 3: Empty resolvedOutput with denied_actions throws HEADLESS_TOOL_DENIED and classifies to HeadlessToolDeniedError
  const deniedRecords = [];
  await assert.rejects(
    () =>
      cliRunner.runAntigravityCli({
        model: 'gemini-4-argon-high',
        prompt: 'Analyze module',
        tools: 'none',
        onCallRecord: (rec) => deniedRecords.push(rec),
        exec: async () => ({
          exitCode: 0,
          stdout: JSON.stringify({
            response: '',
            denied_actions: [{ tool: 'run_command', reason: 'headless_denied' }]
          }),
          stderr: 'headless policy denied run_command'
        })
      }),
    (err) => {
      assert.equal(err.code, 'HEADLESS_TOOL_DENIED');
      assert.equal(err.exitCode, 0);
      assert.ok(Array.isArray(err.trace?.deniedActions) && err.trace.deniedActions.length === 1);
      assert.equal(err.trace.outcome, 'error');
      const classified = agyAdapter.classifyError(err, { seatId: 's1', model: 'gemini-4-argon-high' });
      assert.ok(classified instanceof adapterModule.HeadlessToolDeniedError);
      assert.equal(classified.isRetryable, true);
      assert.equal(classified.exitCode, 0);
      return true;
    }
  );
  assert.equal(deniedRecords.length, 1);

  // 5. Step 4: Empty resolvedOutput with explicit HTTP 429 in envelope error throws with exitCode 0 -> QuotaExhaustionError
  await assert.rejects(
    () =>
      cliRunner.runAntigravityCli({
        model: 'gemini-4-argon-high',
        prompt: 'Analyze module',
        tools: 'none',
        exec: async () => ({
          exitCode: 0,
          stdout: JSON.stringify({
            response: '',
            error: { code: 429, message: 'Resource exhausted: HTTP 429 Too Many Requests' }
          }),
          stderr: 'status=429'
        })
      }),
    (err) => {
      assert.equal(err.exitCode, 0);
      assert.ok(err.trace?.envelopeError?.includes('429'));
      const classified = agyAdapter.classifyError(err, { seatId: 's1', model: 'gemini-4-argon-high' });
      assert.ok(classified instanceof QuotaExhaustionError);
      return true;
    }
  );

  // 6. Step 5: Empty resolvedOutput with only benign warning + (node:429) unknown warning returns '' without throwing
  const step5Calls = [];
  const emptyWarningOut = await cliRunner.runAntigravityCli({
    model: 'gemini-4-argon-high',
    prompt: 'Analyze module',
    tools: 'none',
    onCallRecord: (rec) => step5Calls.push(rec),
    exec: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ response: '', finished_reason: 'print_timeout' }),
      stderr: 'WARNING: --mode plan has no effect while slash command expansion is disabled.\n(node:429) ExperimentalWarning: harmless'
    })
  });
  assert.equal(emptyWarningOut, '');
  assert.equal(step5Calls.length, 1);
  assert.equal(step5Calls[0].trace.outcome, 'error');
  assert.equal(step5Calls[0].trace.stderr, '(node:429) ExperimentalWarning: harmless');

  // 7. Nonzero exitCode + denied_actions (no quota/auth) -> HEADLESS_TOOL_DENIED -> HeadlessToolDeniedError preserving exitCode 1
  await assert.rejects(
    () =>
      cliRunner.runAntigravityCli({
        model: 'gemini-4-argon-high',
        prompt: 'Analyze module',
        tools: 'none',
        exec: async () => {
          const err = new Error('agy exited 1');
          err.exitCode = 1;
          err.stdout = JSON.stringify({
            denied_actions: [{ tool: 'edit_file', reason: 'approval_required' }]
          });
          err.stderr = 'WARNING: --mode plan has no effect while slash command expansion is disabled.\nTool approval rejected';
          throw err;
        }
      }),
    (err) => {
      assert.equal(err.code, 'HEADLESS_TOOL_DENIED');
      assert.equal(err.exitCode, 1);
      assert.equal(err.stderr, 'Tool approval rejected');
      const classified = agyAdapter.classifyError(err, { seatId: 's1', model: 'gemini-4-argon-high' });
      assert.ok(classified instanceof adapterModule.HeadlessToolDeniedError);
      assert.equal(classified.exitCode, 1);
      return true;
    }
  );

  // 8. Nonzero exitCode + timeout/abort is preserved over denied_actions
  const abortClassified = agyAdapter.classifyError(
    Object.assign(new Error('Aborted'), { name: 'AbortError', code: 'ABORT_ERR', exitCode: 130 }),
    { seatId: 's1', model: 'gemini-4-argon-high' }
  );
  assert.ok(abortClassified instanceof AbortError);

  const timeoutClassified = agyAdapter.classifyError(
    Object.assign(new Error('Timed out'), { code: 'ETIMEDOUT', exitCode: 124 }),
    { seatId: 's1', model: 'gemini-4-argon-high' }
  );
  assert.ok(timeoutClassified instanceof TimeoutError);
});

test('listAntigravityModels parses selector output via runner and exec and handles failures cleanly', async () => {
  assert.equal(typeof cliRunner.listAntigravityModels, 'function');

  const sampleTable = [
    'Available models:',
    '  gemini-4-argon-high       Gemini 4 Argon (High)',
    '  gemini-4-carbon-medium Gemini 4 Carbon (Medium)',
    '  composer-2.5              Composer 2.5'
  ].join('\n');

  const runnerRes = await cliRunner.listAntigravityModels({
    timeoutMs: 3000,
    runner: async ({ command, args, timeoutMs }) => {
      assert.equal(command, 'agy');
      assert.deepEqual(args, ['models']);
      assert.equal(timeoutMs, 3000);
      return { exitCode: 0, stdout: sampleTable, stderr: '' };
    }
  });
  assert.equal(runnerRes.ok, true);
  assert.deepEqual(runnerRes.selectors, ['gemini-4-argon-high', 'gemini-4-carbon-medium', 'composer-2.5']);

  const execRes = await cliRunner.listAntigravityModels({
    exec: async (cmd, args) => {
      assert.equal(cmd, 'agy');
      assert.deepEqual(args, ['models']);
      return { exitCode: 0, stdout: 'gemini-4-argon-low   Gemini 4 Argon (Low)\n', stderr: '' };
    }
  });
  assert.equal(execRes.ok, true);
  assert.deepEqual(execRes.selectors, ['gemini-4-argon-low']);

  const failRes = await cliRunner.listAntigravityModels({
    exec: async () => {
      const err = new Error('agy not found');
      err.code = 'ENOENT';
      throw err;
    }
  });
  assert.equal(failRes.ok, false);
  assert.deepEqual(failRes.selectors, []);
  assert.ok(failRes.error);
});

test('Important 1 & Minor 1: scans raw denied actions (arguments.file_path, >50 entries, >512 chars) and emits Wave-0 attribution + explicit null fields', async () => {
  const repoDir = makeTempDir('council-raw-denied-');
  try {
    // 1. arguments.file_path targeting .council/state.json escalates to FORBIDDEN_STATE_ACCESS (empty and nonempty responses)
    await assert.rejects(
      () =>
        cliRunner.runAntigravityCli({
          model: 'gemini-4-argon-high',
          prompt: 'Analyze module',
          tools: 'none',
          cwd: repoDir,
          exec: async () => ({
            exitCode: 0,
            stdout: JSON.stringify({
              response: '',
              denied_actions: [
                {
                  tool: 'read_file',
                  arguments: { file_path: path.join(repoDir, '.council/state.json') },
                  reason: 'blocked'
                }
              ]
            }),
            stderr: ''
          })
        }),
      (err) => err?.code === 'FORBIDDEN_STATE_ACCESS'
    );

    await assert.rejects(
      () =>
        cliRunner.runAntigravityCli({
          model: 'gemini-4-argon-high',
          prompt: 'Analyze module',
          tools: 'none',
          cwd: repoDir,
          exec: async () => ({
            exitCode: 0,
            stdout: JSON.stringify({
              response: 'Nonempty output',
              denied_actions: [
                {
                  tool: 'read_file',
                  arguments: { file_path: '.council/state.json' }
                }
              ]
            }),
            stderr: ''
          })
        }),
      (err) => err?.code === 'FORBIDDEN_STATE_ACCESS'
    );

    // 2. Entry #55 (past the 50-item sanitize cap) targeting .council/ escalates to FORBIDDEN_STATE_ACCESS
    const paddedDenied = Array.from({ length: 54 }, (_, idx) => ({
      tool: 'read_file',
      arguments: { file_path: `src/file-${idx}.js` }
    }));
    paddedDenied.push({
      tool: 'read_file',
      arguments: { file_path: '.council/telemetry-summary.json' }
    });
    await assert.rejects(
      () =>
        cliRunner.runAntigravityCli({
          model: 'gemini-4-argon-high',
          prompt: 'Analyze module',
          tools: 'none',
          exec: async () => ({
            exitCode: 0,
            stdout: JSON.stringify({ response: '', denied_actions: paddedDenied }),
            stderr: ''
          })
        }),
      (err) => err?.code === 'FORBIDDEN_STATE_ACCESS'
    );

    // 3. Field >512 chars with .council/ after offset 512 is still caught before sanitization truncates it
    const longPrefix = 'x'.repeat(600);
    await assert.rejects(
      () =>
        cliRunner.runAntigravityCli({
          model: 'gemini-4-argon-high',
          prompt: 'Analyze module',
          tools: 'none',
          exec: async () => ({
            exitCode: 0,
            stdout: JSON.stringify({
              response: '',
              denied_actions: [
                {
                  tool: 'read_file',
                  arguments: { file_path: `${longPrefix}/.council/state.json` }
                }
              ]
            }),
            stderr: ''
          })
        }),
      (err) => err?.code === 'FORBIDDEN_STATE_ACCESS'
    );

    // 4. Benign arguments.file_path is preserved on sanitized HeadlessToolDeniedError.deniedActions
    await assert.rejects(
      () =>
        cliRunner.runAntigravityCli({
          model: 'gemini-4-argon-high',
          prompt: 'Analyze module',
          tools: 'none',
          exec: async () => ({
            exitCode: 0,
            stdout: JSON.stringify({
              response: '',
              denied_actions: [
                {
                  tool: 'read_file',
                  arguments: { file_path: 'src/auth.js' },
                  reason: 'approval_required'
                }
              ]
            }),
            stderr: ''
          })
        }),
      (err) => {
        assert.equal(err.code, 'HEADLESS_TOOL_DENIED');
        assert.equal(err.deniedActions?.[0]?.arguments?.file_path, 'src/auth.js');
        return true;
      }
    );

    // 5. Wave-0 attribution defaults + explicit null preservation in recordProviderCall
    const wave0Calls = [];
    await cliRunner.runAntigravityCli({
      model: 'gemini-4-argon-high',
      prompt: 'Wave 0 call',
      tools: 'none',
      context: { seatId: 's-wave0', phase: 'DELIBERATION', round: 1, retryDiagnostics: null },
      onCallRecord: (rec) => wave0Calls.push(rec),
      exec: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ response: 'ok' }),
        stderr: ''
      })
    });
    assert.equal(wave0Calls.length, 1);
    assert.equal(wave0Calls[0].attempt, 0);
    assert.equal(wave0Calls[0].requestedModel, 'gemini-4-argon-high');
    assert.equal(wave0Calls[0].requestedEffort, 'high');
    assert.equal(wave0Calls[0].effectiveEffort, 'high');
    assert.equal(wave0Calls[0].capabilityProvenance, null);
    assert.equal(wave0Calls[0].fallbackApplied, false);
    assert.equal(wave0Calls[0].fallbackReason, null);
    assert.ok('capabilityProvenance' in wave0Calls[0]);
    assert.ok('fallbackReason' in wave0Calls[0]);

    // 6. Composer-2.5 preserves explicit null requestedEffort / effectiveEffort / fallbackReason (no invented 'high')
    const composerWave0 = [];
    cliRunner.recordProviderCall({
      context: { seatId: 's-comp-w0', retryDiagnostics: null },
      onCallRecord: (rec) => composerWave0.push(rec),
      record: { provider: 'cursor', model: 'composer-2.5', tools: 'none', exitCode: 0, durationMs: 5, trace: {} }
    });
    assert.equal(composerWave0[0].attempt, 0);
    assert.equal(composerWave0[0].requestedModel, 'composer-2.5');
    assert.ok('requestedEffort' in composerWave0[0]);
    assert.equal(composerWave0[0].requestedEffort, null);
    assert.ok('effectiveEffort' in composerWave0[0]);
    assert.equal(composerWave0[0].effectiveEffort, null);
    assert.ok('fallbackReason' in composerWave0[0]);
    assert.equal(composerWave0[0].fallbackReason, null);

    const composerRetry = [];
    cliRunner.recordProviderCall({
      context: {
        seatId: 's-comp-retry',
        retryDiagnostics: {
          attempt: 1,
          requestedModel: 'composer-2.5',
          requestedEffort: null,
          effectiveEffort: null,
          capabilityProvenance: 'adapter_static_policy',
          fallbackApplied: false,
          fallbackReason: null
        }
      },
      onCallRecord: (rec) => composerRetry.push(rec),
      record: { provider: 'cursor', model: 'composer-2.5', tools: 'none', exitCode: 0, durationMs: 5, trace: {} }
    });
    assert.ok('requestedEffort' in composerRetry[0]);
    assert.equal(composerRetry[0].requestedEffort, null);
    assert.ok('effectiveEffort' in composerRetry[0]);
    assert.equal(composerRetry[0].effectiveEffort, null);
    assert.ok('fallbackReason' in composerRetry[0]);
    assert.equal(composerRetry[0].fallbackReason, null);
  } finally {
    rmDir(repoDir);
  }
});
