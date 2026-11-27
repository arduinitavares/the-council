#!/usr/bin/env node

/**
 * @fileoverview The Council — CLI Entry Point (`bin/council`).
 * ESM Module (Node >= 22). Zero external dependencies.
 * Uses native `node:util.parseArgs` for argument parsing.
 *
 * Supported Commands:
 * - council run [options]       : Runs a debate with specified or default config.
 * - council demo [name]         : Runs one of the 3 canonical prototype walkthroughs.
 * - council inspect <file>      : Inspects a recorded trajectory snapshot JSON.
 */

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import {
  CouncilEngine,
  resolveVotingSeatConfig,
  resolveRebuttalSeatConfig
} from '../engine/council-engine.js';
import {
  validateContinuationEligibility,
  loadContinuationParent
} from '../engine/continuation.js';
import { loadConfigFile, resolveConfig } from '../engine/config.js';
import { deserializeSnapshot } from '../telemetry/snapshot.js';
import {
  persistRunTelemetry,
  loadTelemetrySummary,
  formatTelemetryTable
} from '../telemetry/ledger.js';
import { validateRetryFallbackCapability } from '../engine/recovery.js';
import { listAntigravityModels } from '../harness/cli-runner.js';
import {
  HarnessRegistry,
  T3HarnessAdapter,
  T3McpClient,
  resolveHarnessBackend,
  loginT3OAuth,
  logoutT3OAuth,
  getT3AuthStatus
} from '../harness/index.js';
import { DEFAULT_OUTPUT_DIR, VisualizerLiveWatcher } from '../visualizer/live-watcher.js';

function formatDiagnosticModelEffort(model, effort) {
  const modelText = typeof model === 'string' ? model.trim() : '';
  const effortText = typeof effort === 'string' ? effort.trim() : '';
  if (!modelText) {
    return effortText ? `(${effortText})` : 'unknown';
  }
  if (effortText) {
    const escapedEffort = effortText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`\\(${escapedEffort}\\)$`, 'i').test(modelText)) {
      return `${modelText} (${effortText})`;
    }
  }
  return modelText;
}

function formatRetryDiagnostic(diag) {
  if (!diag || typeof diag !== 'object') {
    return '';
  }
  const requested = formatDiagnosticModelEffort(diag.requestedModel, diag.requestedEffort);
  const effective = formatDiagnosticModelEffort(diag.effectiveModel || diag.requestedModel, diag.effectiveEffort);
  const parts = [`${requested} -> ${effective}`];
  if (diag.tools) {
    parts.push(`tools: ${diag.tools}`);
  }
  if (diag.fallbackReason) {
    parts.push(`reason: ${diag.fallbackReason}`);
  }
  return parts.join(', ');
}

function formatRetryDiagnosticsHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return '';
  }
  return history
    .map((diag, idx) => {
      const summary = formatRetryDiagnostic(diag);
      return summary ? `[${diag.attempt ?? idx + 1}] ${summary}` : '';
    })
    .filter(Boolean)
    .join('; ');
}

function attachVerboseTelemetryListeners(telemetry, logErr) {
  if (!telemetry || typeof telemetry.on !== 'function') {
    return;
  }
  telemetry.on('seat_telemetry', (t) => {
    const detail = t.metadata?.reason || t.metadata?.error;
    const diag = formatRetryDiagnostic(t.metadata?.retryDiagnostics);
    const diagSuffix = diag ? ` [${diag}]` : '';
    logErr(`[TELEMETRY] Seat "${t.seatId}" -> [${t.status.toUpperCase()}]${detail ? ` (${detail})` : ''}${diagSuffix}`);
  });
  telemetry.on('state_transition', (t) => {
    const detail = t.event?.reason || t.event?.error;
    const diag = formatRetryDiagnostic(t.event?.retryDiagnostics);
    const diagSuffix = diag ? ` [${diag}]` : '';
    logErr(`[TRANSITION] ${t.event.type} -> ${t.state.phase} (Round ${t.state.round})${detail ? `: ${detail}` : ''}${diagSuffix}`);
  });
}

export const HELP_TEXT = `
The Council — Multi-Agent Consensus Deliberation Engine (v0.1.0)

Usage:
  council run (--live | --mock) [options]
  council continue <runId|snapshot-path> (--live | --mock) [options]
  council login t3 [--url <mcp-url>] [--status] [--no-browser] [--json]
  council logout t3 [--url <mcp-url>] [--json]
  council telemetry [--days <N>] [--by model|seat] [--json]
  council demo [wt-better-os | wt-10-seats-quota | wt-opus-guardrails]
  council inspect <snapshot-file.json>

Options:
  -c, --config <path>         Path to JSON configuration file
  -p, --preset <name>         Built-in preset (architecture, product-comparison, security-audit, argon-only, t3-best-of-families, best-of-families)
  -t, --topic <string>        Debate topic problem statement
  -e, --evidence <path>       Path to JSON or Markdown/text evidence file (repeatable)
  -r, --rounds <number>       Maximum deliberation rounds (default: 3)
  -q, --quorum <number>       Minimum quorum of active seats (default: 2)
  -l, --live                  Run with live CLI harnesses and visualizer stream (required unless --mock)
  -m, --mock                  Run in hermetic deterministic simulated mock mode (required unless --live)
      --backend <cli|t3>      Live harness transport backend (default: COUNCIL_HARNESS_BACKEND or cli)
      --timeout <ms>          Turn timeout in milliseconds (positive integer)
      --seat-budget <ms>      Total seat phase budget in milliseconds (positive integer)
      --rebuttal-timeout <ms> Round 2+ rebuttal turn timeout in milliseconds (positive integer)
      --preserve-rebuttal-effort Disable Round 2+ rebuttal effort/timeout/tools downshift
      --rebuttal-tools <mode> Tool policy for Round 2+ rebuttal ('none' | 'read-only')
      --rebuttal-reasoning-effort <level> Override reasoning effort for Round 2+ rebuttal
      --rebuttal-model <id>   Override model selector for Round 2+ rebuttal
      --reasoning-effort <level> Set global default reasoning effort (does not trigger explicit conflict)
      --retry-effort-fallback Cap bounded retries on eligible failures at medium effort without raising low
      --policy-digest <hex>   Expected 64-char hex SHA-256 policy digest (requires --evidence-digest)
      --evidence-digest <hex> Expected 64-char hex SHA-256 frozen packet digest (requires --policy-digest)
      --cwd <dir>             Explicit working directory for seat/judge CLI inspection (alias: --workspace)
      --workspace <dir>       Alias for --cwd <dir>
      --days <number>         Filter telemetry leaderboard to the last N days (e.g. 7, 30)
      --by <model|seat>       Group telemetry leaderboard by canonical model or seat (default: model)
      --output-dir <path>     Custom runs/summary output directory
      --telemetry-dir <path>  Custom telemetry ledger directory
      --snapshot <path>       Write output JSON snapshot to a new path
      --url <mcp-url>         T3 MCP endpoint URL (login/logout, default: http://127.0.0.1:3773/mcp)
      --status                Show current T3 authentication status without refreshing or logging in
      --no-browser            Print T3 authorization URL without opening a browser tab
      --json                  Output result strictly as JSON (includes "mode": "live" | "mock")
  -v, --verbose               Print real-time observer telemetry events to stderr
  -h, --help                  Show this help message
  -V, --version               Show version
`;

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '../..');

function resolveInputPath(rawPath) {
  const strPath = String(rawPath);
  const cwdPath = path.resolve(process.cwd(), strPath);
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }
  if (!path.isAbsolute(strPath)) {
    const pkgPath = path.resolve(PACKAGE_ROOT, strPath);
    if (fs.existsSync(pkgPath)) {
      return pkgPath;
    }
  }
  return cwdPath;
}

function canonicalPathForCompare(filePath) {
  const resolved = path.resolve(filePath);
  const realNative = typeof fs.realpathSync.native === 'function' ? fs.realpathSync.native : fs.realpathSync;
  try {
    return realNative(resolved);
  } catch {
    try {
      return path.join(realNative(path.dirname(resolved)), path.basename(resolved));
    } catch {
      return resolved;
    }
  }
}

function isSameFilesystemTarget(pathA, pathB) {
  if (!pathA || !pathB) return false;
  if (canonicalPathForCompare(pathA) === canonicalPathForCompare(pathB)) {
    return true;
  }
  try {
    const statA = fs.statSync(path.resolve(pathA));
    const statB = fs.statSync(path.resolve(pathB));
    return statA.dev === statB.dev && statA.ino === statB.ino;
  } catch {
    return false;
  }
}

function parseEvidenceFile(rawPath) {
  const resolvedPath = resolveInputPath(rawPath);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    throw new Error(`Evidence file not found: "${resolvedPath}"`);
  }
  const content = fs.readFileSync(resolvedPath, 'utf8');
  if (resolvedPath.toLowerCase().endsWith('.json')) {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new Error(`Malformed JSON in evidence file "${resolvedPath}": ${err.message}`);
    }
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.evidence)) {
      return parsed.evidence;
    }
    if (parsed && typeof parsed === 'object') {
      return [parsed];
    }
    throw new Error(`Invalid evidence JSON in "${resolvedPath}": expected an array or object.`);
  }
  return [
    {
      label: path.basename(resolvedPath),
      source: rawPath,
      text: content
    }
  ];
}

/**
 * Parses CLI arguments using `node:util.parseArgs`.
 * @param {string[]} [rawArgs]
 * @returns {{ command: string, values: Object, positionals: string[] }}
 */
export function parseCliArgs(rawArgs = []) {
  const command = rawArgs[0] && !rawArgs[0].startsWith('-') ? rawArgs[0] : 'run';
  const flagArgs = command === rawArgs[0] ? rawArgs.slice(1) : rawArgs;
  const parsed = parseArgs({
    args: flagArgs,
    options: {
      config: { type: 'string', short: 'c' },
      preset: { type: 'string', short: 'p' },
      topic: { type: 'string', short: 't' },
      evidence: { type: 'string', short: 'e', multiple: true },
      rounds: { type: 'string', short: 'r' },
      quorum: { type: 'string', short: 'q' },
      live: { type: 'boolean', short: 'l', default: false },
      mock: { type: 'boolean', short: 'm', default: false },
      backend: { type: 'string' },
      timeout: { type: 'string' },
      'seat-budget': { type: 'string' },
      seatBudget: { type: 'string' },
      'rebuttal-timeout': { type: 'string' },
      rebuttalTimeout: { type: 'string' },
      'preserve-rebuttal-effort': { type: 'boolean' },
      preserveRebuttalEffort: { type: 'boolean' },
      'rebuttal-tools': { type: 'string' },
      rebuttalTools: { type: 'string' },
      'rebuttal-reasoning-effort': { type: 'string' },
      rebuttalReasoningEffort: { type: 'string' },
      'rebuttal-model': { type: 'string' },
      rebuttalModel: { type: 'string' },
      'reasoning-effort': { type: 'string' },
      reasoningEffort: { type: 'string' },
      'retry-effort-fallback': { type: 'boolean', default: false },
      retryEffortFallback: { type: 'boolean' },
      'policy-digest': { type: 'string' },
      policyDigest: { type: 'string' },
      'evidence-digest': { type: 'string' },
      evidenceDigest: { type: 'string' },
      cwd: { type: 'string' },
      workspace: { type: 'string' },
      days: { type: 'string' },
      by: { type: 'string' },
      'output-dir': { type: 'string' },
      'telemetry-dir': { type: 'string' },
      snapshot: { type: 'string' },
      url: { type: 'string' },
      status: { type: 'boolean', default: false },
      'no-browser': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'V', default: false }
    },
    allowPositionals: true
  });
  const retryEffortFallback = Boolean(
    parsed.values['retry-effort-fallback'] || parsed.values.retryEffortFallback
  );
  parsed.values.retryEffortFallback = retryEffortFallback;
  return {
    command,
    values: parsed.values,
    positionals: parsed.positionals,
    retryEffortFallback
  };
}

/**
 * Converts parsed CLI flag values into a configuration override object.
 * @param {Object} [values]
 * @returns {Object}
 */
export function buildCliFlagsForConfig(values = {}) {
  const overrides = {};
  if (values.preset !== undefined) overrides.preset = values.preset;
  if (values.topic !== undefined) overrides.topic = values.topic;
  if (values.rounds !== undefined) overrides.maxRounds = parseInt(values.rounds, 10);
  if (values.quorum !== undefined) overrides.minQuorum = parseInt(values.quorum, 10);
  const explicitCwd = values.cwd !== undefined ? values.cwd : values.workspace;
  if (explicitCwd !== undefined) overrides.cwd = explicitCwd;

  if (values.timeout !== undefined) {
    const rawTimeout = String(values.timeout).trim();
    const numTimeout = Number(rawTimeout);
    if (!rawTimeout || !Number.isInteger(numTimeout) || numTimeout <= 0 || !Number.isFinite(numTimeout)) {
      throw new Error(`--timeout must be a positive integer (received "${values.timeout}").`);
    }
    overrides.timeout = numTimeout;
    overrides.timeoutMs = numTimeout;
  }

  const rawSeatBudgetVal = values['seat-budget'] !== undefined ? values['seat-budget'] : values.seatBudget;
  if (rawSeatBudgetVal !== undefined) {
    const rawSeatBudget = String(rawSeatBudgetVal).trim();
    const numSeatBudget = Number(rawSeatBudget);
    if (!rawSeatBudget || !Number.isInteger(numSeatBudget) || numSeatBudget <= 0 || !Number.isFinite(numSeatBudget)) {
      throw new Error(`--seat-budget must be a positive integer (received "${rawSeatBudgetVal}").`);
    }
    overrides.seatBudget = numSeatBudget;
    overrides.totalSeatBudgetMs = numSeatBudget;
  }

  const rawRebuttalTimeoutVal =
    values['rebuttal-timeout'] !== undefined ? values['rebuttal-timeout'] : values.rebuttalTimeout;
  if (rawRebuttalTimeoutVal !== undefined) {
    const rawRebuttalTimeout = String(rawRebuttalTimeoutVal).trim();
    const numRebuttalTimeout = Number(rawRebuttalTimeout);
    if (
      !rawRebuttalTimeout ||
      !Number.isInteger(numRebuttalTimeout) ||
      numRebuttalTimeout <= 0 ||
      !Number.isFinite(numRebuttalTimeout)
    ) {
      throw new Error(`--rebuttal-timeout must be a positive integer (received "${rawRebuttalTimeoutVal}").`);
    }
    overrides.rebuttalTimeoutMs = numRebuttalTimeout;
  }

  const rawPreserveRebuttal =
    values['preserve-rebuttal-effort'] !== undefined
      ? values['preserve-rebuttal-effort']
      : values.preserveRebuttalEffort;
  if (rawPreserveRebuttal !== undefined) {
    overrides.preserveRebuttalEffort = Boolean(rawPreserveRebuttal);
  }

  const rawRebuttalTools =
    values['rebuttal-tools'] !== undefined ? values['rebuttal-tools'] : values.rebuttalTools;
  if (rawRebuttalTools !== undefined) {
    const normalizedTools = String(rawRebuttalTools).trim().toLowerCase();
    overrides.rebuttalTools = normalizedTools === 'readonly' ? 'read-only' : normalizedTools;
  }

  const rawRebuttalEffort =
    values['rebuttal-reasoning-effort'] !== undefined
      ? values['rebuttal-reasoning-effort']
      : values.rebuttalReasoningEffort;
  if (rawRebuttalEffort !== undefined) {
    overrides.rebuttalReasoningEffort = String(rawRebuttalEffort).trim().toLowerCase();
  }

  const rawRebuttalModel =
    values['rebuttal-model'] !== undefined ? values['rebuttal-model'] : values.rebuttalModel;
  if (rawRebuttalModel !== undefined) {
    overrides.rebuttalModel = String(rawRebuttalModel).trim();
  }

  const rawReasoningEffort =
    values['reasoning-effort'] !== undefined ? values['reasoning-effort'] : values.reasoningEffort;
  if (rawReasoningEffort !== undefined) {
    overrides.reasoningEffort = String(rawReasoningEffort).trim();
  }

  if (values['retry-effort-fallback'] === true || values.retryEffortFallback === true) {
    overrides.retryEffortFallback = true;
  }

  const rawPolicyDigest =
    values['policy-digest'] !== undefined ? values['policy-digest'] : values.policyDigest;
  const rawEvidenceDigest =
    values['evidence-digest'] !== undefined ? values['evidence-digest'] : values.evidenceDigest;
  if (rawPolicyDigest !== undefined || rawEvidenceDigest !== undefined) {
    overrides.expectedDigests = {
      ...(rawPolicyDigest !== undefined ? { policy: rawPolicyDigest } : {}),
      ...(rawEvidenceDigest !== undefined ? { evidence: rawEvidenceDigest } : {})
    };
  }

  return overrides;
}

/**
 * Runs the CLI command with the given argument list.
 * @param {string[]} [rawArgs]
 * @param {Object} [io]
 * @param {Object} [io.stdout]
 * @param {Object} [io.stderr]
 * @param {Function} [io.exit]
 * @returns {Promise<number>} exit code
 */
export async function runCli(rawArgs = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const exit = io.exit || ((code) => process.exit(code));

  const safeExit = async (code) => {
    if (stdout && typeof stdout.write === 'function' && typeof stdout.once === 'function') {
      if (!stdout.write('')) {
        await new Promise((resolve) => stdout.once('drain', resolve));
      }
    }
    return exit(code) ?? code;
  };

  const log = (...msg) => stdout.write(msg.join(' ') + '\n');
  const logErr = (...msg) => stderr.write(msg.join(' ') + '\n');

  let parsed;
  try {
    parsed = parseCliArgs(rawArgs);
  } catch (err) {
    logErr(`CLI argument error: ${err.message}\n`);
    logErr(HELP_TEXT);
    return await safeExit(1);
  }

  const { command, values, positionals } = parsed;

  if (values.help) {
    log(HELP_TEXT);
    return await safeExit(0);
  }

  if (values.version) {
    log('the-council v0.1.0 (Node ' + process.version + ')');
    return await safeExit(0);
  }

  if (command === 'login') {
    const target = (positionals[0] || 't3').trim().toLowerCase();
    if (target !== 't3') {
      logErr(`Unknown login provider "${positionals[0]}". Supported: t3`);
      return await safeExit(1);
    }
    const mcpUrl = values.url || io.t3Url || process.env.T3_MCP_URL;
    const storePath = io.tokenStorePath;
    if (values.status) {
      try {
        const statusFn = io.getT3AuthStatus || getT3AuthStatus;
        const st = statusFn({ url: mcpUrl, storePath });
        if (values.json) {
          log(JSON.stringify(st, null, 2));
        } else {
          log(`T3 MCP endpoint: ${st.url}`);
          log(`Authenticated  : ${st.authenticated ? 'yes' : 'no'} (source: ${st.source})`);
          if (st.scope) log(`Scopes         : ${st.scope}`);
          if (st.expiresAt) log(`Expires At     : ${st.expiresAt}${st.expired ? ' (expired)' : ''}`);
          log(`Token Store    : ${st.storePath}`);
        }
        return await safeExit(0);
      } catch (err) {
        logErr(`T3 auth status error: ${err.message}`);
        return await safeExit(1);
      }
    }

    try {
      const loginFn = io.loginT3OAuth || loginT3OAuth;
      const result = await loginFn({
        url: mcpUrl,
        storePath,
        noBrowser: Boolean(values['no-browser']),
        onAuthUrl: (authUrl) => {
          if (!values.json || values['no-browser']) {
            logErr(`Authorize The Council with T3 Code in your browser:\n  ${authUrl}`);
          }
        }
      });

      if (typeof process.env.T3_MCP_TOKEN === 'string' && process.env.T3_MCP_TOKEN.trim()) {
        logErr('Note: T3_MCP_TOKEN is set in your environment and overrides the saved OAuth credential until unset.');
      }

      let health = null;
      const skipHealth = Boolean(io.skipHealthCheck || (io.loginT3OAuth && !io.verifyT3Auth));
      if (!skipHealth) {
        if (typeof io.verifyT3Auth === 'function') {
          health = await io.verifyT3Auth(result.url);
        } else {
          const client = new T3McpClient({
            url: result.url,
            tokenStorePath: storePath,
            useEnvToken: false
          });
          try {
            health = await client.healthCheck();
          } finally {
            await client.close();
          }
        }
        if (health && health.ok === false) {
          throw new Error(`T3 verification failed after login: ${health.error || 'unknown error'}`);
        }
      }

      if (values.json) {
        log(JSON.stringify({ ...result, verified: health ? Boolean(health.ok) : null }, null, 2));
      } else {
        log(`Authenticated with T3 MCP: ${result.url}`);
        log(`Scopes      : ${result.scope}`);
        log(`Token Store : ${result.storePath}`);
        if (result.expiresAt) log(`Expires At  : ${result.expiresAt}`);
        if (health?.ok) log(`Verified    : ok (${health.latencyMs}ms)`);
      }
      return await safeExit(0);
    } catch (err) {
      logErr(`T3 login error: ${err.message}`);
      return await safeExit(1);
    }
  }

  if (command === 'logout') {
    const target = (positionals[0] || 't3').trim().toLowerCase();
    if (target !== 't3') {
      logErr(`Unknown logout provider "${positionals[0]}". Supported: t3`);
      return await safeExit(1);
    }
    try {
      const logoutFn = io.logoutT3OAuth || logoutT3OAuth;
      const result = await logoutFn({
        url: values.url || io.t3Url || process.env.T3_MCP_URL,
        storePath: io.tokenStorePath
      });
      if (values.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(`Cleared stored T3 credential for ${result.url} (removed=${result.removed}, revoked=${result.revoked})`);
      }
      return await safeExit(0);
    } catch (err) {
      logErr(`T3 logout error: ${err.message}`);
      return await safeExit(1);
    }
  }

  if (command === 'telemetry') {
    let parsedDays = null;
    if (values.days !== undefined) {
      const numDays = Number(values.days);
      if (!Number.isFinite(numDays) || numDays <= 0) {
        logErr(`Configuration error: --days must be a positive number (received "${values.days}").`);
        return await safeExit(1);
      }
      parsedDays = numDays;
    }

    const byRaw = values.by !== undefined ? String(values.by).trim().toLowerCase() : 'model';
    if (byRaw !== 'model' && byRaw !== 'seat') {
      logErr(`Configuration error: --by must be "model" or "seat" (received "${values.by}").`);
      return await safeExit(1);
    }

    const outputDir = values['output-dir'] || io.outputDir || io.liveWatcherOptions?.outputDir;
    const telemetryDir = values['telemetry-dir'] || io.telemetryDir || io.liveWatcherOptions?.telemetryDir;
    const includeMock = Boolean(io.includeMock || io.persistMockTelemetry);
    const summary = loadTelemetrySummary({
      outputDir,
      telemetryDir,
      days: parsedDays,
      now: io.now || new Date(),
      includeMock
    });

    if (values.json) {
      const payload = {
        ...summary,
        by: byRaw,
        groupBy: byRaw,
        window: summary.activeWindow.window,
        days: summary.activeWindow.days,
        rows: byRaw === 'seat' ? summary.activeWindow.bySeat : summary.activeWindow.byModel
      };
      log(JSON.stringify(payload, null, 2));
    } else {
      log(formatTelemetryTable(summary, { by: byRaw, days: parsedDays, now: io.now || new Date(), includeMock }));
    }
    return await safeExit(0);
  }

  if (command === 'inspect') {
    const filePath = positionals[0] || values.config;
    if (!filePath) {
      logErr('Error: "council inspect" requires a path to a snapshot JSON file.');
      return await safeExit(1);
    }
    const resolved = resolveInputPath(filePath);
    if (!fs.existsSync(resolved)) {
      logErr(`Error: Snapshot file not found: "${resolved}"`);
      return await safeExit(1);
    }
    const content = fs.readFileSync(resolved, 'utf8');
    const data = JSON.parse(content);
    const list = Array.isArray(data) ? data : Array.isArray(data?.snapshots) ? data.snapshots : null;
    if (list) {
      log(`Trajectory contains ${list.length} snapshots:`);
      list.forEach((s) => {
        log(`  [${s.sequence}] ${s.event?.type || 'EVENT'} -> Phase: ${s.metrics?.phase} (Round ${s.metrics?.round})`);
      });
    } else {
      const snap = deserializeSnapshot(content);
      log(`Snapshot ID: ${snap.id}`);
      log(`Event: ${snap.event?.type}`);
      log(`Phase: ${snap.metrics?.phase} (Round ${snap.metrics?.round})`);
      log(`Active Seats: ${snap.metrics?.activeSeatCount}`);
      log(`Verdict: ${snap.metrics?.verdictKind || 'None'}`);
    }
    return await safeExit(0);
  }

  if (command === 'demo') {
    const demoId = positionals[0] || 'wt-better-os';
    const wtPath = path.resolve(new URL('.', import.meta.url).pathname, '../fixtures/walkthrough-scenarios.js');
    const imported = await import(wtPath);
    const scenarios = imported.default || imported;
    const wts = scenarios.WALKTHROUGHS || imported.WALKTHROUGHS || [];
    const wt = wts.find((w) => w.id === demoId);
    if (!wt) {
      logErr(`Unknown demo walkthrough "${demoId}". Available: wt-better-os, wt-10-seats-quota, wt-opus-guardrails`);
      return await safeExit(1);
    }

    if (!values.json) {
      log(`\n=== Running Demo Walkthrough: ${wt.title} ===\n`);
      log(`Topic: ${wt.initialConfig.topic}\n`);
    }

    const engine = new CouncilEngine(wt.initialConfig);
    if (values.verbose) {
      attachVerboseTelemetryListeners(engine.getTelemetry(), logErr);
    }
    if (typeof io.onEngine === 'function') {
      io.onEngine(engine);
    }

    // Run walkthrough steps manually
    engine.initRoster();
    for (const step of wt.steps) {
      if (values.verbose) logErr(`Step: ${step.label}`);
      if (step.event) {
        engine._step(step.event);
      } else if (step.multiEvents) {
        for (const ev of step.multiEvents) {
          engine._step(ev);
        }
      }
    }

    if (values.json) {
      log(JSON.stringify({
        id: wt.id,
        verdict: engine.state.verdict,
        state: engine.state,
        snapshots: engine.getTelemetry().getSnapshots()
      }, null, 2));
    } else {
      log('\n=== Final Verdict ===');
      log(`Kind: ${engine.state.verdict?.kind}`);
      log(`Note: ${engine.state.verdict?.note}\n`);
    }
    return await safeExit(0);
  }

  if (command === 'run') {
    let overrides;
    let resolved;
    try {
      overrides = buildCliFlagsForConfig(values);
      if (Array.isArray(values.evidence) && values.evidence.length > 0) {
        const cliEvidence = [];
        for (const evPath of values.evidence) {
          cliEvidence.push(...parseEvidenceFile(evPath));
        }
        overrides.evidence = cliEvidence;
      }
      if (values.config) {
        resolved = loadConfigFile(values.config, overrides);
      } else {
        resolved = resolveConfig(overrides);
      }
    } catch (err) {
      logErr(`Configuration error: ${err.message}`);
      return await safeExit(1);
    }

    if (values.live && values.mock) {
      logErr('Execution mode error: Cannot specify both --live (-l) and --mock (-m). Choose one execution mode.');
      return await safeExit(1);
    }
    if (!values.live && !values.mock) {
      logErr('Execution mode error: Explicit mode selection required. Pass --live (-l) for real CLI harness deliberation or --mock (-m) for simulated mock mode.');
      return await safeExit(1);
    }

    const mode = values.live ? 'live' : 'mock';
    const engineOptions = {};
    if (typeof io.harnessResolver === 'function') {
      engineOptions.harnessResolver = io.harnessResolver;
    }
    const explicitOutputDir = values['output-dir'] || io.outputDir || io.liveWatcherOptions?.outputDir;
    const explicitTelemetryDir = values['telemetry-dir'] || io.telemetryDir || io.liveWatcherOptions?.telemetryDir;
    let liveWatcher = null;

    if (values.live) {
      let backend;
      try {
        backend = resolveHarnessBackend(values.backend ?? io.backend);
      } catch (err) {
        logErr(`Configuration error: ${err.message}`);
        return await safeExit(1);
      }
      const registryDefaults = {
        backend,
        ...(resolved.cwd ? { cwd: resolved.cwd } : {}),
        ...(io.t3McpClient ? { mcpClient: io.t3McpClient } : {}),
        ...(io.t3Url ? { url: io.t3Url } : {}),
        ...(io.t3Token ? { token: io.t3Token } : {}),
        ...(io.tokenStorePath ? { tokenStorePath: io.tokenStorePath } : {})
      };
      const harnessRegistry = io.harnessRegistry || new HarnessRegistry(registryDefaults);
      try {
        const participants = [
          ...(resolved.judge ? [{ role: 'judge', participant: resolved.judge }] : []),
          ...(Array.isArray(resolved.seats) ? resolved.seats.map((s) => ({ role: 'seat', participant: s })) : [])
        ];
        const resolvedAdapters = [];
        for (const { role, participant } of participants) {
          if (String(participant.harness || '').toLowerCase() === 'mock') {
            throw new Error(
              `Cannot use "mock" harness for ${role} "${participant.id}" in --live mode. Use --mock for simulated runs or configure a live harness (codex, antigravity, cursor).`
            );
          }
          const adapter = harnessRegistry.get(participant.harness);
          resolvedAdapters.push({ role, participant, adapter });
        }

        // Deduplicated T3 MCP preflight healthCheck + per-provider availability + project verification before validateModel & Round 1
        const t3Adapters = [...new Set(resolvedAdapters.map((r) => r.adapter).filter((a) => a instanceof T3HarnessAdapter))];
        let t3PreflightHealth = null;
        if (t3Adapters.length > 0) {
          t3PreflightHealth = await t3Adapters[0].healthCheck();
          if (!t3PreflightHealth?.ok) {
            throw new Error(`T3 MCP preflight failed: ${t3PreflightHealth?.error || 'unknown error'}`);
          }
          for (const t3Adapter of t3Adapters.slice(1)) {
            if (t3Adapter.mcpClient === t3Adapters[0].mcpClient) {
              if (t3PreflightHealth.capabilities) t3Adapter.setCapabilities(t3PreflightHealth.capabilities);
              if (t3PreflightHealth.projects) t3Adapter.setProjects(t3PreflightHealth.projects);
              if (!t3Adapter.isProviderAvailable()) {
                throw new Error(
                  `T3 MCP preflight failed: T3 provider "${t3Adapter.provider}" is unavailable or cannot run child tasks`
                );
              }
            } else {
              const adapterHealth = await t3Adapter.healthCheck();
              if (!adapterHealth?.ok) {
                throw new Error(`T3 MCP preflight failed: ${adapterHealth?.error || 'unknown error'}`);
              }
            }
          }
          for (const { participant, adapter } of resolvedAdapters) {
            if (!(adapter instanceof T3HarnessAdapter)) continue;
            const effectiveTools = participant.tools ?? resolved.tools ?? 'read-only';
            const effectiveCwd = effectiveTools === 'none' ? undefined : (participant.cwd || resolved.cwd);
            if (effectiveCwd) {
              await adapter.resolveProjectId(effectiveCwd);
            }
          }
        }

        for (const { role, participant, adapter } of resolvedAdapters) {
          if (adapter && typeof adapter.validateModel === 'function') {
            try {
              adapter.validateModel(participant.model);
            } catch (modelErr) {
              throw new Error(
                `Invalid model for ${role} "${participant.id}" (harness "${participant.harness}", model "${participant.model}"): ${modelErr.message}`
              );
            }
            if (role === 'seat') {
              const rawVotingModel =
                typeof participant.votingModel === 'string' && participant.votingModel.trim()
                  ? participant.votingModel.trim()
                  : undefined;
              if (rawVotingModel) {
                try {
                  adapter.validateModel(rawVotingModel);
                } catch (modelErr) {
                  throw new Error(
                    `Invalid votingModel for seat "${participant.id}" (harness "${participant.harness}", votingModel "${rawVotingModel}"): ${modelErr.message}`
                  );
                }
              }
              const votingCfg = resolveVotingSeatConfig(participant, resolved, { harness: adapter });
              if (votingCfg && votingCfg.model) {
                try {
                  adapter.validateModel(votingCfg.model);
                } catch (modelErr) {
                  throw new Error(
                    `Invalid votingModel for seat "${participant.id}" (harness "${participant.harness}", votingModel "${votingCfg.model}"): ${modelErr.message}`
                  );
                }
              }
              const rawRebuttalModel =
                participant.rebuttalModel ??
                participant['rebuttal-model'] ??
                resolved.rebuttalModel ??
                resolved['rebuttal-model'];
              if (typeof rawRebuttalModel === 'string' && rawRebuttalModel.trim()) {
                try {
                  adapter.validateModel(rawRebuttalModel.trim());
                } catch (modelErr) {
                  throw new Error(
                    `Invalid rebuttalModel for seat "${participant.id}" (harness "${participant.harness}", rebuttalModel "${rawRebuttalModel.trim()}"): ${modelErr.message}`
                  );
                }
              }
              const rebuttalCfg = resolveRebuttalSeatConfig(participant, resolved, { harness: adapter });
              if (rebuttalCfg && rebuttalCfg.model) {
                try {
                  adapter.validateModel(rebuttalCfg.model);
                } catch (modelErr) {
                  throw new Error(
                    `Invalid rebuttalModel for seat "${participant.id}" (harness "${participant.harness}", rebuttalModel "${rebuttalCfg.model}"): ${modelErr.message}`
                  );
                }
              }
            }
          }
        }
        if (resolved.retryEffortFallback) {
          const catalogByHarness = { ...(io.catalogByHarness || {}) };
          const verifiedCapabilitiesByHarness = { ...(io.verifiedCapabilitiesByHarness || {}) };
          let antigravityProbeError = null;
          if (t3Adapters.length > 0) {
            for (const t3Adapter of t3Adapters) {
              const caps = t3Adapter.getVerifiedCapabilities();
              if (caps) {
                verifiedCapabilitiesByHarness[t3Adapter.name] = caps;
                if (!catalogByHarness[t3Adapter.name] && Array.isArray(caps.selectors) && caps.selectors.length > 0) {
                  catalogByHarness[t3Adapter.name] = caps.selectors;
                }
              }
            }
          } else {
            const hasAntigravity = participants.some(
              ({ participant }) => String(participant?.harness || '').toLowerCase() === 'antigravity'
            );
            if (hasAntigravity && !catalogByHarness.antigravity) {
              const probeFn = io.listAntigravityModels || listAntigravityModels;
              const catRes = await probeFn();
              if (catRes?.ok && Array.isArray(catRes.selectors)) {
                catalogByHarness.antigravity = catRes.selectors;
              } else {
                antigravityProbeError = catRes?.error || 'agy models probe failed';
              }
            }
          }
          const capCheck = validateRetryFallbackCapability({
            config: resolved,
            catalogByHarness,
            verifiedCapabilitiesByHarness
          });
          if (!capCheck.valid) {
            const extraDetail = antigravityProbeError ? ` (${antigravityProbeError})` : '';
            throw new Error(`${capCheck.errors.join('; ')}${extraDetail}`);
          }
          engineOptions.catalogByHarness = catalogByHarness;
          if (Object.keys(verifiedCapabilitiesByHarness).length > 0) {
            engineOptions.verifiedCapabilitiesByHarness = verifiedCapabilitiesByHarness;
          }
        }
      } catch (err) {
        logErr(`Configuration error: ${err.message}`);
        return await safeExit(1);
      }
      engineOptions.harnessRegistry = harnessRegistry;
      liveWatcher =
        io.liveWatcher ||
        new VisualizerLiveWatcher({
          initialConfig: resolved,
          ...(explicitOutputDir ? { outputDir: explicitOutputDir } : {}),
          ...(explicitTelemetryDir ? { telemetryDir: explicitTelemetryDir } : {}),
          ...(io.liveWatcherOptions || {})
        });
    }

    const abortController = new AbortController();
    const composedSignal = io.signal ? AbortSignal.any([abortController.signal, io.signal]) : abortController.signal;
    engineOptions.signal = composedSignal;

    const SIGNAL_EXIT_CODES = {
      SIGINT: 130,
      SIGTERM: 143,
      SIGHUP: 129
    };
    const proc = io.process || process;
    let terminatingSignal = null;
    let signalExitCode = null;
    let externalAborted = false;
    let resolveSignalAbort = null;
    const signalAbortPromise = new Promise((resolve) => {
      resolveSignalAbort = resolve;
    });
    let resolveExternalAbort = null;
    const externalAbortPromise = new Promise((resolve) => {
      resolveExternalAbort = resolve;
    });
    const signalHandlers = new Map();
    let onComposedAbort = null;
    const cleanupSignalListeners = () => {
      for (const [sig, handler] of signalHandlers.entries()) {
        if (proc && typeof proc.off === 'function') {
          proc.off(sig, handler);
        } else if (proc && typeof proc.removeListener === 'function') {
          proc.removeListener(sig, handler);
        }
      }
      signalHandlers.clear();
      if (onComposedAbort && composedSignal && typeof composedSignal.removeEventListener === 'function') {
        composedSignal.removeEventListener('abort', onComposedAbort);
      }
    };

    if (io.registerSignalHandlers !== false && proc && typeof proc.on === 'function') {
      for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        const handler = () => {
          if (terminatingSignal) return;
          terminatingSignal = sig;
          signalExitCode = SIGNAL_EXIT_CODES[sig] || 130;
          cleanupSignalListeners();
          abortController.abort(new Error(`Aborted by ${sig}`));
          if (resolveSignalAbort) {
            resolveSignalAbort({ abortedBySignal: sig, exitCode: signalExitCode });
          }
        };
        signalHandlers.set(sig, handler);
        proc.on(sig, handler);
      }
    }

    onComposedAbort = () => {
      if (terminatingSignal || externalAborted) return;
      externalAborted = true;
      cleanupSignalListeners();
      if (resolveExternalAbort) {
        resolveExternalAbort({ kind: 'external_abort' });
      }
    };
    if (!composedSignal.aborted) {
      composedSignal.addEventListener('abort', onComposedAbort, { once: true });
    }

    const engine = new CouncilEngine(resolved, engineOptions);
    const runStartedAt = new Date().toISOString();

    if (liveWatcher) {
      liveWatcher.attach(engine.getTelemetry());
    }

    if (composedSignal.aborted) {
      engine.initRoster();
      onComposedAbort();
    }

    if (values.verbose) {
      attachVerboseTelemetryListeners(engine.getTelemetry(), logErr);
    }
    if (typeof io.onEngine === 'function') {
      io.onEngine(engine);
    }

    const drainMs = typeof io.abortDrainMs === 'number' && io.abortDrainMs >= 0 ? io.abortDrainMs : 1500;
    let result;
    try {
      let raceResult;
      let engineRunPromise = null;
      if (externalAborted) {
        raceResult = { kind: 'external_abort' };
      } else {
        engineRunPromise = engine.run();
        engineRunPromise.catch(() => {});
        raceResult = await Promise.race([
          engineRunPromise.then((res) => ({ kind: 'result', res })),
          signalAbortPromise.then((sigInfo) => ({ kind: 'signal', sigInfo })),
          externalAbortPromise
        ]);
      }
      if ((raceResult.kind === 'signal' || raceResult.kind === 'external_abort') && engineRunPromise && drainMs > 0) {
        let drainTimer = null;
        try {
          await Promise.race([
            engineRunPromise.catch(() => {}),
            new Promise((r) => {
              drainTimer = setTimeout(r, drainMs);
            })
          ]);
        } finally {
          if (drainTimer) {
            clearTimeout(drainTimer);
          }
        }
      }
      if (raceResult.kind === 'signal') {
        if (liveWatcher) {
          liveWatcher.stop({ reason: 'Aborted' });
        }
        return await safeExit(raceResult.sigInfo.exitCode);
      }
      if (raceResult.kind === 'external_abort') {
        const currentState = engine.getState();
        result = {
          ok: false,
          aborted: true,
          verdict: currentState?.verdict || null,
          state: currentState,
          snapshots: engine.getTelemetry().getSnapshots(),
          providerCalls:
            typeof engine.getTelemetry().getProviderCalls === 'function'
              ? engine.getTelemetry().getProviderCalls()
              : []
        };
      } else {
        result = raceResult.res;
      }
    } catch (runErr) {
      if (liveWatcher) {
        liveWatcher.stop({ reason: 'Aborted' });
      }
      throw runErr;
    } finally {
      cleanupSignalListeners();
      if (liveWatcher) {
        const wasAborted = Boolean(terminatingSignal || externalAborted || engine.aborted || result?.aborted);
        liveWatcher.stop(wasAborted ? { reason: 'Aborted' } : undefined);
      }
    }

    if (terminatingSignal && signalExitCode !== null) {
      return await safeExit(signalExitCode);
    }

    const resolvedOutputDir = explicitOutputDir || liveWatcher?.outputDir;
    const resolvedTelemetryDir = explicitTelemetryDir || liveWatcher?.telemetryDir;
    const snapshotOutPath = values.snapshot ? path.resolve(process.cwd(), values.snapshot) : null;
    const persistedRunId =
      liveWatcher?.runId ||
      io.runId ||
      io.liveWatcherOptions?.runId ||
      `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const exposeRunId = Boolean(snapshotOutPath || liveWatcher?.runId || io.runId || io.liveWatcherOptions?.runId);
    const allowModePersistence = mode !== 'mock' || Boolean(io.persistMockTelemetry);
    const shouldPersistTelemetry =
      allowModePersistence &&
      (Boolean(resolvedOutputDir || resolvedTelemetryDir || io.persistTelemetry || io.persistMockTelemetry) ||
        !process.env.NODE_TEST_CONTEXT);

    if (shouldPersistTelemetry && result?.state?.phase === 'completed') {
      try {
        persistRunTelemetry({
          runId: persistedRunId,
          mode,
          state: result.state,
          snapshots: engine.getTelemetry().getSnapshots(),
          providerCalls: engine.getTelemetry().getProviderCalls(),
          startedAt: liveWatcher?.liveRun?.startedAt || runStartedAt,
          completedAt: new Date().toISOString(),
          outputDir: resolvedOutputDir,
          telemetryDir: resolvedTelemetryDir,
          includeMock: Boolean(io.persistMockTelemetry)
        });
      } catch {
        // Isolate observer telemetry persistence errors
      }
    }

    const normalizeRetryFields = (participant) =>
      participant && typeof participant === 'object'
        ? {
            ...participant,
            activeRetryDiagnostics: participant.activeRetryDiagnostics ?? null,
            retryDiagnosticsHistory: Array.isArray(participant.retryDiagnosticsHistory)
              ? participant.retryDiagnosticsHistory
              : []
          }
        : participant;
    const normalizedJudge = normalizeRetryFields(result.state?.judge);
    const normalizedSeats = Array.isArray(result.state?.seats)
      ? result.state.seats.map(normalizeRetryFields)
      : result.state?.seats;
    const attributedProviderCalls = Array.isArray(result.providerCalls)
      ? result.providerCalls
      : engine.getTelemetry?.()?.getProviderCalls?.();
    const outputPayload = {
      mode,
      ...(exposeRunId ? { runId: persistedRunId } : {}),
      ...result,
      retryEffortFallback: Boolean(resolved.retryEffortFallback),
      ...(Array.isArray(attributedProviderCalls) ? { providerCalls: attributedProviderCalls } : {}),
      state: {
        ...result.state,
        ...(exposeRunId ? { runId: persistedRunId } : {}),
        ...(normalizedJudge ? { judge: normalizedJudge } : {}),
        ...(normalizedSeats ? { seats: normalizedSeats } : {}),
        ...(resolved.timeoutMs !== undefined ? { timeoutMs: resolved.timeoutMs } : {}),
        ...(resolved.totalSeatBudgetMs !== undefined ? { totalSeatBudgetMs: resolved.totalSeatBudgetMs } : {})
      }
    };

    if (snapshotOutPath) {
      const sanitizedInitialConfig = {
        topic: resolved.topic,
        maxRounds: resolved.maxRounds,
        minQuorum: resolved.minQuorum,
        ...(resolved.cwd ? { cwd: resolved.cwd } : {}),
        ...(resolved.tools ? { tools: resolved.tools } : {}),
        judge: normalizedJudge || resolved.judge || null,
        seats: Array.isArray(resolved.seats) ? resolved.seats.map((s) => ({ ...s })) : []
      };
      const snapshotPayload = {
        ...outputPayload,
        runId: persistedRunId,
        initialConfig: sanitizedInitialConfig,
        state: {
          ...outputPayload.state,
          runId: persistedRunId
        }
      };
      fs.mkdirSync(path.dirname(snapshotOutPath), { recursive: true });
      const tmpSnap = `${snapshotOutPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpSnap, JSON.stringify(snapshotPayload, null, 2), 'utf8');
      fs.renameSync(tmpSnap, snapshotOutPath);
    }

    if (values.json) {
      log(JSON.stringify(outputPayload, null, 2));
    } else {
      if (mode === 'mock') {
        log('\n============================================================');
        log('  SIMULATED (mock harness): not a real deliberation');
        log('============================================================');
      }
      log('\n========================================');
      log('         THE COUNCIL — VERDICT          ');
      log('========================================');
      log(`Mode    : ${mode === 'mock' ? 'SIMULATED (mock harness)' : 'LIVE'}`);
      log(`Topic   : ${resolved.topic}`);
      log(`Verdict : ${result.verdict?.kind || 'No verdict emitted'}`);
      log(`Rounds  : ${result.state.round}`);
      if (result.state?.judge) {
        log(`Judge   : ${result.state.judge.id} (${result.state.judge.harness} / ${result.state.judge.model})`);
        const judgeRetries = formatRetryDiagnosticsHistory(result.state.judge.retryDiagnosticsHistory);
        if (judgeRetries) {
          log(`          Retries: ${judgeRetries}`);
        }
      }
      log(`Seats   : ${result.state.seats.length} total (${result.verdict?.activeSeatCount || 0} active, ${result.verdict?.excusedSeatCount || 0} excused)`);

      const isColor = !process.env.NO_COLOR && Boolean(stdout.isTTY || process.env.FORCE_COLOR);
      const cyanBold = (str) => (isColor ? `\x1b[1m\x1b[36m${str}\x1b[0m` : str);
      const amber = (str) => (isColor ? `\x1b[33m${str}\x1b[0m` : str);

      const allProofs = result.state?.proofs || [];
      let admittedCount = 0;
      let partiallyAdmittedCount = 0;
      let rejectedCount = 0;
      for (const p of allProofs) {
        if (!p) continue;
        if (
          p.status === 'partially_admitted' ||
          p.status === 'admitted_with_caveat' ||
          p.admissionKind === 'partially_admitted'
        ) {
          partiallyAdmittedCount += 1;
        } else if (
          p.status === 'admitted' ||
          p.admissionKind === 'explicitly_admitted' ||
          p.admissionKind === 'default_admitted'
        ) {
          admittedCount += 1;
        } else if (p.status === 'rejected' || p.admissionKind === 'judge_rejected') {
          rejectedCount += 1;
        }
      }
      const tallyText = `Proof Audit: ${admittedCount} Admitted | ${partiallyAdmittedCount} Partially Admitted | ${rejectedCount} Rejected`;

      const candidate = result.verdict?.candidate || result.state?.candidate || null;
      const candidateSummary = typeof candidate?.summary === 'string' ? candidate.summary.trim() : '';
      if (candidateSummary) {
        const finalAnswerHeader =
          result.verdict?.kind === 'Unanimous Consensus'
            ? 'Final Answer:'
            : `Final Answer: (Proposed Candidate — ${result.verdict?.kind || 'Dissent Report'})`;
        log(`\n${finalAnswerHeader}`);
        log(
          candidateSummary
            .split('\n')
            .map((line) => '  ' + line)
            .join('\n')
        );
      }

      if (candidate && Array.isArray(candidate.clauses) && candidate.clauses.length > 0) {
        log('\nCandidate Clauses:');
        candidate.clauses.forEach((c) => {
          log(`  - [${c.id || c.context}] ${c.context}: ${c.conclusion} (Cited: ${(c.citedProofIds || []).join(', ')})`);
        });
      }

      log(`\n${cyanBold(tallyText)}`);

      if (result.state?.seats?.length > 0) {
        log('\nSeat Roll Call:');
        const allObjections = result.state?.objections || [];
        result.state.seats.forEach((s) => {
          const statusUpper = String(s.status || 'idle').toUpperCase();
          const seatProofs = allProofs.filter((p) => p && p.seatId === s.id);
          const proofsLabel =
            seatProofs.length > 0
              ? seatProofs.map((p) => `${p.id} (${p.status || 'pending'})`).join(', ')
              : 'none';
          const activeObjs = allObjections.filter((o) => o && o.seatId === s.id && o.status !== 'withdrawn');
          let extraSuffix = '';
          if (activeObjs.length > 0) {
            extraSuffix += ` — Objections: ${activeObjs.map((o) => o.id).join(', ')}`;
          }
          if (s.status === 'excused' && s.excusedReason) {
            extraSuffix += ` — Excused: ${s.excusedReason}`;
          }
          const seatRetries = formatRetryDiagnosticsHistory(s.retryDiagnosticsHistory);
          if (seatRetries) {
            extraSuffix += ` — Retries: ${seatRetries}`;
          }
          log(`  - [${statusUpper}] ${s.id} (${s.harness} / ${s.model}) — Proofs: ${proofsLabel}${extraSuffix}`);
        });
      }

      const excusedList = (result.state?.seats || []).filter((s) => s.status === 'excused');
      if (excusedList.length > 0) {
        log('\nExcused Seats:');
        excusedList.forEach((s) => {
          const excusedRetries = formatRetryDiagnosticsHistory(s.retryDiagnosticsHistory);
          const retrySuffix = excusedRetries ? ` — Retries: ${excusedRetries}` : '';
          log(`  - [${s.id}] (${s.harness} / ${s.model}): ${s.excusedReason || 'Excused'}${retrySuffix}`);
        });
      }

      if (result.verdict?.unresolvedObjections?.length > 0) {
        log('\nUnresolved Objections:');
        result.verdict.unresolvedObjections.forEach((o) => {
          log(`  - [${o.id}] (${o.status}) Seat "${o.seatId}": ${o.reason} (Proof: ${o.proofId})`);
        });
      }

      if (result.state?.proofs?.length > 0) {
        log('\nSubmitted Proofs:');
        result.state.proofs.forEach((p) => {
          const isPartial =
            p.status === 'partially_admitted' ||
            p.status === 'admitted_with_caveat' ||
            p.admissionKind === 'partially_admitted';
          const isAdmitted =
            !isPartial &&
            (p.status === 'admitted' ||
              p.admissionKind === 'explicitly_admitted' ||
              p.admissionKind === 'default_admitted');
          const isRejected =
            !isPartial &&
            !isAdmitted &&
            (p.status === 'rejected' || p.admissionKind === 'judge_rejected');
          const statusBadge = isPartial
            ? amber('[PARTIALLY ADMITTED]')
            : isAdmitted
            ? '[ADMITTED]'
            : isRejected
            ? '[REJECTED]'
            : `[${String(p.status || 'PENDING').toUpperCase()}]`;
          log(`  - [${p.id}] ${statusBadge} [${p.kind}] ${p.scope} — "${p.source}": ${p.statement}`);
          const seatIdStr = typeof p.seatId === 'string' && p.seatId.trim() ? p.seatId.trim() : '';
          const rawNote =
            typeof p.judgeNote === 'string'
              ? p.judgeNote.trim()
              : typeof p.auditNote === 'string'
              ? p.auditNote.trim()
              : '';
          const rawAdmittedStatement =
            typeof p.judgeAdmittedStatement === 'string' && p.judgeAdmittedStatement.trim()
              ? p.judgeAdmittedStatement.trim()
              : typeof p.admittedStatement === 'string' && p.admittedStatement.trim()
              ? p.admittedStatement.trim()
              : '';
          const metaParts = [];
          if (seatIdStr) {
            metaParts.push(`Seat : ${seatIdStr}`);
          }
          if (rawNote) {
            metaParts.push(`Judge Note: ${rawNote}`);
          }
          if (metaParts.length > 0) {
            log(`    ${metaParts.join(' | ')}`);
          }
          if (rawAdmittedStatement) {
            log(`    Admitted Core: ${rawAdmittedStatement}`);
          }
        });
      }

      log(`\nNote: ${result.verdict?.note || 'None'}`);
      log('========================================\n');
      if (mode === 'mock') {
        log('============================================================');
        log('  SIMULATED (mock harness): not a real deliberation');
        log('============================================================\n');
      }
    }

    return await safeExit(result.ok ? 0 : 2);
  }

  if (command === 'continue') {
    const target = positionals[0];
    if (!target) {
      logErr('Continuation error: "council continue" requires a <runId|snapshot-path>.');
      return await safeExit(1);
    }

    if (values.live && values.mock) {
      logErr('Execution mode error: Cannot specify both --live (-l) and --mock (-m). Choose one execution mode.');
      return await safeExit(1);
    }
    if (!values.live && !values.mock) {
      logErr('Execution mode error: Explicit mode selection required. Pass --live (-l) for real CLI harness deliberation or --mock (-m) for simulated mock mode.');
      return await safeExit(1);
    }

    const mode = values.live ? 'live' : 'mock';
    const explicitOutputDir = values['output-dir'] || io.outputDir || io.liveWatcherOptions?.outputDir;
    const explicitTelemetryDir = values['telemetry-dir'] || io.telemetryDir || io.liveWatcherOptions?.telemetryDir;

    let overrideFlags;
    try {
      overrideFlags = buildCliFlagsForConfig({
        ...(values.timeout !== undefined ? { timeout: values.timeout } : {}),
        ...(values['seat-budget'] !== undefined ? { 'seat-budget': values['seat-budget'] } : {}),
        ...(values.seatBudget !== undefined ? { seatBudget: values.seatBudget } : {}),
        ...(values.cwd !== undefined ? { cwd: values.cwd } : {}),
        ...(values.workspace !== undefined ? { workspace: values.workspace } : {})
      });
    } catch (err) {
      logErr(`Configuration error: ${err.message}`);
      return await safeExit(1);
    }

    let backend = null;
    if (values.backend !== undefined || values.live) {
      try {
        backend = resolveHarnessBackend(values.backend ?? (values.live ? io.backend : undefined));
      } catch (err) {
        logErr(`Configuration error: ${err.message}`);
        return await safeExit(1);
      }
    }

    let loaded;
    let eligibility;
    try {
      loaded = loadContinuationParent(target, { outputDir: explicitOutputDir });
      eligibility = validateContinuationEligibility(loaded.state);
      if (!eligibility.valid) {
        throw new Error(eligibility.errors.join(' '));
      }
    } catch (err) {
      logErr(`Continuation error: ${err.message}`);
      return await safeExit(1);
    }

    const snapshotOutPath = values.snapshot ? path.resolve(process.cwd(), values.snapshot) : null;
    if (
      snapshotOutPath &&
      loaded.sourcePath &&
      isSameFilesystemTarget(snapshotOutPath, loaded.sourcePath)
    ) {
      logErr(`Continuation error: Refusing to overwrite parent snapshot "${loaded.sourcePath}". Choose a new --snapshot path.`);
      return await safeExit(1);
    }

    let runId =
      io.runId ||
      io.liveWatcherOptions?.runId ||
      `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    if (runId === loaded.parentRunId) {
      runId = `${runId}-cont-${Math.random().toString(16).slice(2, 6)}`;
    }

    const effectiveDefaultCwd = overrideFlags.cwd || loaded.state.cwd;
    const targetSeatsForRun = eligibility.targetSeats.map((s) => ({
      ...s,
      ...(s.tools === undefined ? { tools: loaded.state.tools ?? 'read-only' } : {}),
      ...(overrideFlags.cwd && s.tools !== 'none' ? { cwd: overrideFlags.cwd } : {})
    }));

    const engineOptions = {
      runId,
      parentRunId: loaded.parentRunId,
      rootRunId: loaded.rootRunId,
      ...(overrideFlags.timeoutMs !== undefined ? { timeoutMs: overrideFlags.timeoutMs } : {}),
      ...(overrideFlags.totalSeatBudgetMs !== undefined ? { totalSeatBudgetMs: overrideFlags.totalSeatBudgetMs } : {}),
      ...(typeof io.harnessResolver === 'function' ? { harnessResolver: io.harnessResolver } : {}),
      ...(io.signal ? { signal: io.signal } : {})
    };

    if (values.live) {
      const harnessRegistry =
        io.harnessRegistry ||
        new HarnessRegistry({
          backend,
          ...(effectiveDefaultCwd ? { cwd: effectiveDefaultCwd } : {}),
          ...(io.t3McpClient ? { mcpClient: io.t3McpClient } : {}),
          ...(io.t3Url ? { url: io.t3Url } : {}),
          ...(io.t3Token ? { token: io.t3Token } : {}),
          ...(io.tokenStorePath ? { tokenStorePath: io.tokenStorePath } : {})
        });
      try {
        const resolvedAdapters = [];
        for (const seat of targetSeatsForRun) {
          if (String(seat.harness || '').toLowerCase() === 'mock') {
            throw new Error(
              `Cannot use "mock" harness for seat "${seat.id}" in --live mode. Use --mock for simulated runs or configure a live harness (codex, antigravity, cursor).`
            );
          }
          resolvedAdapters.push({ seat, adapter: harnessRegistry.get(seat.harness) });
        }

        const t3Adapters = [...new Set(resolvedAdapters.map((r) => r.adapter).filter((a) => a instanceof T3HarnessAdapter))];
        if (t3Adapters.length > 0) {
          const t3Health = await t3Adapters[0].healthCheck();
          if (!t3Health?.ok) {
            throw new Error(`T3 MCP preflight failed: ${t3Health?.error || 'unknown error'}`);
          }
          for (const t3Adapter of t3Adapters.slice(1)) {
            if (t3Adapter.mcpClient === t3Adapters[0].mcpClient) {
              if (t3Health.capabilities) t3Adapter.setCapabilities(t3Health.capabilities);
              if (t3Health.projects) t3Adapter.setProjects(t3Health.projects);
              if (!t3Adapter.isProviderAvailable()) {
                throw new Error(
                  `T3 MCP preflight failed: T3 provider "${t3Adapter.provider}" is unavailable or cannot run child tasks`
                );
              }
            } else {
              const adapterHealth = await t3Adapter.healthCheck();
              if (!adapterHealth?.ok) {
                throw new Error(`T3 MCP preflight failed: ${adapterHealth?.error || 'unknown error'}`);
              }
            }
          }
          for (const { seat, adapter } of resolvedAdapters) {
            if (!(adapter instanceof T3HarnessAdapter)) continue;
            const seatCwd = seat.tools === 'none' ? undefined : (seat.cwd || effectiveDefaultCwd);
            if (seatCwd) {
              await adapter.resolveProjectId(seatCwd);
            }
          }
        }

        for (const { seat, adapter } of resolvedAdapters) {
          if (adapter && typeof adapter.validateModel === 'function') {
            try {
              adapter.validateModel(seat.model);
            } catch (modelErr) {
              throw new Error(
                `Invalid model for seat "${seat.id}" (harness "${seat.harness}", model "${seat.model}"): ${modelErr.message}`
              );
            }
          }
        }
      } catch (err) {
        logErr(`Configuration error: ${err.message}`);
        return await safeExit(1);
      }
      engineOptions.harnessRegistry = harnessRegistry;
    }

    const allowModePersistence =
      mode !== 'mock' || Boolean(io.persistMockTelemetry || values['output-dir'] || values['telemetry-dir']);
    const shouldPersistWatcher = Boolean(
      io.liveWatcher ||
      values.live ||
      (allowModePersistence && (explicitOutputDir || io.persistTelemetry || io.persistMockTelemetry))
    );
    const effectiveWatcherOutputDir = explicitOutputDir || io.liveWatcherOptions?.outputDir || DEFAULT_OUTPUT_DIR;
    const candidateWatcherOutputPath = path.resolve(
      io.liveWatcherOptions?.outputPath || path.join(effectiveWatcherOutputDir, 'latest.js')
    );
    const preservesSourceLatest =
      Boolean(loaded.sourcePath) &&
      isSameFilesystemTarget(loaded.sourcePath, candidateWatcherOutputPath);
    const resolvedContinuationInitialConfig = loaded.initialConfig
      ? {
          ...loaded.initialConfig,
          ...(effectiveDefaultCwd ? { cwd: effectiveDefaultCwd } : {})
        }
      : {
          topic: loaded.state.topic,
          maxRounds: loaded.state.maxRounds,
          minQuorum: loaded.state.minQuorum,
          ...(effectiveDefaultCwd ? { cwd: effectiveDefaultCwd } : {}),
          judge: loaded.state.judge || null,
          seats: loaded.state.seats || []
        };
    const liveWatcher =
      io.liveWatcher ||
      (shouldPersistWatcher
        ? new VisualizerLiveWatcher({
            runId,
            runKind: 'continuation',
            parentRunId: loaded.parentRunId,
            rootRunId: loaded.rootRunId,
            initialConfig: resolvedContinuationInitialConfig,
            ...(explicitOutputDir ? { outputDir: explicitOutputDir } : {}),
            ...(explicitTelemetryDir ? { telemetryDir: explicitTelemetryDir } : {}),
            ...(io.liveWatcherOptions || {}),
            ...(preservesSourceLatest ? { outputPath: path.resolve(effectiveWatcherOutputDir, `${runId}.js`) } : {})
          })
        : null);

    const runStartedAt = new Date().toISOString();
    let activeEngine = null;
    engineOptions.onEngine = (engine) => {
      activeEngine = engine;
      if (liveWatcher) {
        liveWatcher.attach(engine.getTelemetry());
      }
      if (values.verbose) {
        attachVerboseTelemetryListeners(engine.getTelemetry(), logErr);
      }
      if (typeof io.onEngine === 'function') {
        io.onEngine(engine);
      }
    };

    const parentStateForRun = overrideFlags.cwd
      ? {
          ...loaded.state,
          cwd: overrideFlags.cwd,
          seats: (loaded.state.seats || []).map((s) =>
            eligibility.targetSeats.some((ts) => ts.id === s.id) && s.tools !== 'none'
              ? { ...s, cwd: overrideFlags.cwd }
              : s
          )
        }
      : loaded.state;

    let result;
    try {
      result = await CouncilEngine.runContinuation(parentStateForRun, engineOptions);
    } catch (runErr) {
      if (liveWatcher) {
        liveWatcher.stop({ reason: 'Aborted' });
      }
      throw runErr;
    } finally {
      if (liveWatcher) {
        liveWatcher.stop(result?.aborted ? { reason: 'Aborted' } : undefined);
      }
    }

    const resolvedOutputDir = explicitOutputDir || liveWatcher?.outputDir;
    const resolvedTelemetryDir = explicitTelemetryDir || liveWatcher?.telemetryDir;
    const shouldPersistTelemetry =
      allowModePersistence &&
      (Boolean(resolvedOutputDir || resolvedTelemetryDir || io.persistTelemetry || io.persistMockTelemetry) ||
        !process.env.NODE_TEST_CONTEXT);

    if (shouldPersistTelemetry && result?.state?.phase === 'completed') {
      try {
        persistRunTelemetry({
          runId,
          parentRunId: loaded.parentRunId,
          rootRunId: loaded.rootRunId,
          mode,
          state: result.state,
          snapshots: activeEngine ? activeEngine.getTelemetry().getSnapshots() : result.snapshots,
          providerCalls: result.providerCalls,
          startedAt: liveWatcher?.liveRun?.startedAt || runStartedAt,
          completedAt: new Date().toISOString(),
          outputDir: resolvedOutputDir,
          telemetryDir: resolvedTelemetryDir,
          includeMock: Boolean(io.persistMockTelemetry || values['output-dir'] || values['telemetry-dir'])
        });
      } catch {
        // Isolate observer telemetry persistence errors
      }
    }

    const outputPayload = {
      mode,
      runId,
      parentRunId: loaded.parentRunId,
      rootRunId: loaded.rootRunId,
      ...result,
      state: {
        ...result.state,
        runId
      }
    };

    if (snapshotOutPath) {
      const snapshotPayload = {
        ...outputPayload,
        initialConfig: resolvedContinuationInitialConfig
      };
      fs.mkdirSync(path.dirname(snapshotOutPath), { recursive: true });
      const tmpSnap = `${snapshotOutPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpSnap, JSON.stringify(snapshotPayload, null, 2), 'utf8');
      fs.renameSync(tmpSnap, snapshotOutPath);
    }

    if (values.json) {
      log(JSON.stringify(outputPayload, null, 2));
    } else {
      log('\n========================================');
      log('      THE COUNCIL — CONTINUATION        ');
      log('========================================');
      log(`Mode      : ${mode === 'mock' ? 'SIMULATED (mock harness)' : 'LIVE'}`);
      log(`Run ID    : ${runId}`);
      log(`Parent Run: ${loaded.parentRunId}`);
      log(`Root Run  : ${loaded.rootRunId}`);
      log(`Topic     : ${result.state.topic}`);
      log(`Verdict   : ${result.verdict?.kind || 'No verdict emitted'}`);
      log(`Note      : ${result.verdict?.note || 'None'}`);
      if (result.verdict?.unresolvedObjections?.length > 0) {
        log('\nUnresolved Objections:');
        result.verdict.unresolvedObjections.forEach((o) => {
          log(`  - [${o.id}] (${o.status}) Seat "${o.seatId}": ${o.reason} (Proof: ${o.proofId})`);
        });
      }
      log('========================================\n');
    }

    return await safeExit(result.ok ? 0 : 2);
  }

  logErr(`Unknown command "${command}". Run "council --help" for usage.`);
  return await safeExit(1);
}

// Direct execution guard
const currentFile = path.resolve(new URL(import.meta.url).pathname);
const executedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (currentFile === executedFile) {
  process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') process.exit(0);
  });
  process.stderr.on('error', (err) => {
    if (err.code === 'EPIPE') process.exit(0);
  });
  runCli().catch((err) => {
    console.error(`Fatal Council CLI error: ${err.stack || err.message}`);
    process.exit(1);
  });
}
