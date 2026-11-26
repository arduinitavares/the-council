import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as modelUtils from '../../src/harness/model-utils.js';
import * as telemetryUtils from '../../src/harness/telemetry-utils.js';
import * as cliRunner from '../../src/harness/cli-runner.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

describe('Task 1: Shared model-utils, telemetry-utils, and T3_MCP_TOKEN CLI env stripping', () => {
  it('exports exact model/effort helpers from model-utils.js and re-exports identical references from cli-runner.js', () => {
    const expectedKeys = [
      'CODEX_EFFORT_MAP',
      'ALLOWED_EFFORTS',
      'parseModelAndEffort',
      'extractCanonicalBaseModel',
      'downshiftEffort',
      'downshiftModel'
    ];
    for (const key of expectedKeys) {
      assert.ok(key in modelUtils, `model-utils.js missing ${key}`);
      assert.equal(cliRunner[key], modelUtils[key], `cli-runner.js must re-export identical ${key}`);
    }

    assert.deepEqual(modelUtils.parseModelAndEffort('gpt-6.2-sol (xhigh)'), {
      model: 'gpt-6.2-sol',
      effort: 'xhigh',
      codexEffort: 'xhigh'
    });
    assert.equal(modelUtils.extractCanonicalBaseModel('gemini-4-neon-xhigh'), 'gemini-4-neon');
    assert.equal(modelUtils.downshiftEffort('xhigh', 'medium'), 'medium');
    assert.equal(modelUtils.downshiftEffort('low', 'medium'), 'low');
    assert.equal(modelUtils.downshiftModel('gpt-6.2-astra (xhigh)', 'medium'), 'gpt-6.2-astra (medium)');
  });

  it('exports exact telemetry, gate, redaction, and forbidden-access helpers from telemetry-utils.js and re-exports them from cli-runner.js', () => {
    const expectedKeys = [
      'VALID_DRAIN_STATUSES',
      'LIFECYCLE_ISO_KEYS',
      'LIFECYCLE_INT_KEYS',
      'MAX_CLI_ERROR_MESSAGE_BYTES',
      'MAX_CLI_STDERR_BYTES',
      'PROVIDER_HTTP_429_REGEX',
      'PROVIDER_HTTP_AUTH_REGEX',
      'sliceUtf8Bytes',
      'redactPromptInText',
      'normalizeExitCode',
      'normalizeSignalName',
      'sanitizeLifecycleMetadata',
      'createAttemptTelemetryGate',
      'runWithAttemptTelemetryGate',
      'getActiveAttemptTelemetryGate',
      'markAttemptGateFinalized',
      'markAttemptGateCancelled',
      'normalizeProviderTrace',
      'recordProviderCall'
    ];
    for (const key of expectedKeys) {
      assert.ok(key in telemetryUtils, `telemetry-utils.js missing ${key}`);
      assert.equal(cliRunner[key], telemetryUtils[key], `cli-runner.js must re-export identical ${key}`);
    }
    assert.equal(typeof telemetryUtils.detectBasicForbiddenCouncilAccess, 'function');
    assert.equal(typeof telemetryUtils.registerForbiddenAccessDetector, 'function');

    const detected = telemetryUtils.detectBasicForbiddenCouncilAccess([
      { name: 'read_file', arguments: { path: '.council/runs/latest.js' }, output: 'ignored output' }
    ]);
    assert.equal(detected.forbiddenStateAccess, true);
    assert.deepEqual(detected.forbiddenAccessDetails, ['.council/runs/latest.js']);

    const benignOutputOnly = telemetryUtils.detectBasicForbiddenCouncilAccess([
      { name: 'shell', command: 'git status', stdout: '.council/runs/latest.js' }
    ]);
    assert.equal(benignOutputOnly.forbiddenStateAccess, false);

    // Issue #63 parity: cli-runner.js registers shell-aware detectForbiddenCouncilAccess on load
    const benignExclusionTrace = cliRunner.normalizeProviderTrace({
      outcome: 'success',
      toolCalls: [
        { command: 'grep -rn --exclude-dir=.council foo src/' },
        { command: "find . -path '*/.council/*' -prune -o -name '*.js' -print" }
      ]
    });
    assert.equal(benignExclusionTrace.forbiddenStateAccess, false);
    assert.equal(benignExclusionTrace.outcome, 'success');

    const trace = telemetryUtils.normalizeProviderTrace({
      outcome: 'success',
      toolCalls: [{ command: 'cat .council/runs/latest.js' }]
    });
    assert.equal(trace.forbiddenStateAccess, true);
    assert.equal(trace.outcome, 'error');
    assert.deepEqual(trace.forbiddenAccessDetails, ['cat .council/runs/latest.js']);
  });

  it('decouples adapter.js, config.js, council-engine.js, recovery.js, and ledger.js from cli-runner.js', () => {
    const decoupledFiles = [
      'src/harness/model-utils.js',
      'src/harness/telemetry-utils.js',
      'src/harness/adapter.js',
      'src/engine/config.js',
      'src/engine/council-engine.js',
      'src/engine/recovery.js',
      'src/telemetry/ledger.js'
    ];
    for (const rel of decoupledFiles) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.equal(
        /from\s+['"][^'"]*cli-runner\.js['"]/.test(src),
        false,
        `${rel} must not import cli-runner.js`
      );
    }
    const adapterSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/harness/adapter.js'), 'utf8');
    assert.equal(/\bparseModelAndEffort\b/.test(adapterSrc), false, 'adapter.js drops unused parseModelAndEffort import');
  });

  it('strips T3_MCP_TOKEN in buildSanitizedCliEnv both with and without cwd', () => {
    const prev = process.env.T3_MCP_TOKEN;
    process.env.T3_MCP_TOKEN = 'secret-t3-token-123';
    try {
      const withCwd = cliRunner.buildSanitizedCliEnv('/tmp/work');
      assert.equal('T3_MCP_TOKEN' in withCwd, false);
      assert.equal(withCwd.PWD, '/tmp/work');

      const withoutCwd = cliRunner.buildSanitizedCliEnv(undefined);
      assert.ok(withoutCwd && typeof withoutCwd === 'object');
      assert.equal('T3_MCP_TOKEN' in withoutCwd, false);

      const explicitEnv = cliRunner.buildSanitizedCliEnv('', {
        PATH: '/usr/bin',
        T3_MCP_TOKEN: 'explicit-secret'
      });
      assert.equal('T3_MCP_TOKEN' in explicitEnv, false);
      assert.equal(explicitEnv.PATH, '/usr/bin');
    } finally {
      if (prev === undefined) delete process.env.T3_MCP_TOKEN;
      else process.env.T3_MCP_TOKEN = prev;
    }
  });

  it('strips T3_MCP_TOKEN from child env in listAntigravityModels for both exec and runner paths', async () => {
    const prev = process.env.T3_MCP_TOKEN;
    process.env.T3_MCP_TOKEN = 'secret-t3-token-agy';
    try {
      let seenExecOpts = null;
      const execRes = await cliRunner.listAntigravityModels({
        exec: async (_bin, _args, opts) => {
          seenExecOpts = opts;
          return { exitCode: 0, stdout: 'gemini-4-neon-high  Gemini 4 Neon\n', stderr: '' };
        }
      });
      assert.equal(execRes.ok, true);
      assert.ok(seenExecOpts?.env && typeof seenExecOpts.env === 'object');
      assert.equal('T3_MCP_TOKEN' in seenExecOpts.env, false);

      let seenRunnerOpts = null;
      const runnerRes = await cliRunner.listAntigravityModels({
        runner: async (opts) => {
          seenRunnerOpts = opts;
          return { exitCode: 0, stdout: 'gemini-4-neon-high  Gemini 4 Neon\n', stderr: '' };
        }
      });
      assert.equal(runnerRes.ok, true);
      assert.ok(seenRunnerOpts?.env && typeof seenRunnerOpts.env === 'object');
      assert.equal('T3_MCP_TOKEN' in seenRunnerOpts.env, false);
    } finally {
      if (prev === undefined) delete process.env.T3_MCP_TOKEN;
      else process.env.T3_MCP_TOKEN = prev;
    }
  });
});
