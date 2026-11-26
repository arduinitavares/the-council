/**
 * @fileoverview Shared Harness Telemetry, Attempt Gate, Redaction, and Diagnostic Helpers.
 * Zero external dependencies. Acyclic module depending only on ./model-utils.js.
 * Node >= 22 ESM.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { parseModelAndEffort, extractCanonicalBaseModel } from './model-utils.js';

const _validDrainStatusesSet = new Set(['fulfilled', 'settled', 'drain_expired']);
const _throwDrainStatusesReadOnly = () => {
  throw new TypeError('VALID_DRAIN_STATUSES is read-only');
};

export const VALID_DRAIN_STATUSES = Object.freeze({
  get size() {
    return _validDrainStatusesSet.size;
  },
  has(value) {
    return _validDrainStatusesSet.has(value);
  },
  values() {
    return _validDrainStatusesSet.values();
  },
  [Symbol.iterator]() {
    return _validDrainStatusesSet[Symbol.iterator]();
  },
  add: _throwDrainStatusesReadOnly,
  delete: _throwDrainStatusesReadOnly,
  clear: _throwDrainStatusesReadOnly
});

export const LIFECYCLE_ISO_KEYS = Object.freeze([
  'spawnedAt',
  'firstStdoutAt',
  'lastStdoutAt',
  'firstStderrAt',
  'lastStderrAt',
  'sigtermSentAt',
  'sigkillSentAt',
  'settledAt'
]);

export const LIFECYCLE_INT_KEYS = Object.freeze([
  'stdoutBytes',
  'stdoutChunks',
  'stderrBytes',
  'stderrChunks'
]);

export const MAX_CLI_ERROR_MESSAGE_BYTES = 2048;
export const MAX_CLI_STDERR_BYTES = 4096;

const MAX_TRACE_SCAN_BYTES = 262_144;

export const PROVIDER_HTTP_429_REGEX =
  /(?:\bhttp(?:\/\d(?:\.\d)?)?\s*429\b|\b(?:status(?:\s*code)?|error(?:\s*code)?|response(?:\s*code)?)\s*[:=]?\s*429\b|"status"\s*:\s*429\b|"code"\s*:\s*429\b|\b429\s+(?:too\s+many\s+requests|resource[\s_-]*exhausted|rate[\s_-]*limit))/i;

export const PROVIDER_HTTP_AUTH_REGEX =
  /(?:\bhttp(?:\/\d(?:\.\d)?)?\s*(?:401|403)\b|\b(?:status(?:\s*code)?|error(?:\s*code)?|response(?:\s*code)?)\s*[:=]?\s*(?:401|403)\b|"status"\s*:\s*(?:401|403)\b|"code"\s*:\s*(?:401|403)\b|\b(?:401|403)\s+(?:unauthorized|forbidden|unauthenticated|permission[\s_-]*denied))/i;

const ISO_8601_TIMESTAMP_REGEX =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

const NON_PROMPT_VALUE_FLAGS = new Set([
  '-e',
  '--eval',
  '-m',
  '--model',
  '-c',
  '--mode',
  '--sandbox',
  '--output-format',
  '--effort',
  '--disable'
]);

const SHORT_CLI_FLAG_REGEX = /^-+[a-zA-Z0-9][-a-zA-Z0-9_]*$/;

const EXCLUDED_TRACE_OUTPUT_KEYS = new Set([
  'aggregated_output',
  'output',
  'result',
  'stdout',
  'stderr',
  'content',
  'text',
  'response'
]);

const BASIC_FORBIDDEN_COUNCIL_REGEX =
  /(?:^|[\\/\s"'`(=,\[{:;])\.council(?:$|[\\/\s"'`),.:;\]}?!])|(?:^|[\\/\s"'`(=,\[{:;])latest\.js(?=$|[:\s"'`),.\]}?!])|(?:^|[\\/\s"'`(=,\[{:;])[a-z0-9._-]+\.(?:meta\.json|events\.jsonl)(?=$|[:\s"'`),.\]}?!])|(?:^|[\\/\s"'`(=,\[{:;])telemetry-summary(?:\.[a-z0-9]+)?(?=$|[:\s"'`),.\]}?!])/i;

const NO_EFFORT_MODELS = new Set(['composer-2.5', 'gemini-pro-orchestrator-neon']);

export function sliceUtf8Bytes(str, maxBytes = MAX_TRACE_SCAN_BYTES) {
  if (typeof str !== 'string' || !str) return '';
  if (typeof maxBytes !== 'number' || !Number.isFinite(maxBytes) || maxBytes <= 0) return '';
  const cap = Math.floor(maxBytes);
  if (cap <= 0) return '';
  let pre = str.length > cap ? str.slice(0, cap) : str;
  if (str.length > cap && pre.length > 0) {
    const lastCode = pre.charCodeAt(pre.length - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
      pre = pre.slice(0, -1);
    }
  }
  const buf = Buffer.from(pre, 'utf8');
  if (buf.length <= cap) {
    return pre;
  }
  let end = cap;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return buf.subarray(0, end).toString('utf8');
}

/**
 * Redacts prompt string in CLI argv for telemetry logging, replacing it with length and sha256 hash.
 * Handles exact prompt arguments and --print=<prompt> flags.
 *
 * @param {string[]} args
 * @param {string} [prompt='']
 * @returns {string[]}
 */
export function redactArgv(args, prompt = '') {
  if (!Array.isArray(args)) {
    return [];
  }
  const promptStr = typeof prompt === 'string' ? prompt : String(prompt || '');
  const hash = createHash('sha256').update(promptStr).digest('hex').slice(0, 12);
  const length = promptStr.length;
  const summary = `[REDACTED prompt: length=${length}, sha256=${hash}]`;

  return args.map((arg) => {
    if (arg === prompt) {
      return summary;
    }
    if (typeof arg === 'string' && prompt && arg === `--print=${prompt}`) {
      return `--print=${summary}`;
    }
    return arg;
  });
}

/**
 * Infers the prompt string from CLI arguments when not explicitly provided.
 *
 * @param {string} executable
 * @param {string[]} [args=[]]
 * @param {string} [explicitPrompt='']
 * @returns {string}
 */
export function inferPromptFromArgs(executable, args = [], explicitPrompt = '') {
  if (typeof explicitPrompt === 'string' && explicitPrompt.length > 0) {
    return explicitPrompt;
  }
  if (!Array.isArray(args) || args.length === 0) {
    return '';
  }
  for (const arg of args) {
    if (typeof arg === 'string' && arg.startsWith('--print=') && arg.length > '--print='.length) {
      return arg.slice('--print='.length);
    }
  }
  if (args.length >= 2) {
    const lastArg = args[args.length - 1];
    const prevArg = String(args[args.length - 2] || '');
    if (
      typeof lastArg === 'string' &&
      lastArg.length > 0 &&
      !SHORT_CLI_FLAG_REGEX.test(lastArg) &&
      !NON_PROMPT_VALUE_FLAGS.has(prevArg)
    ) {
      return lastArg;
    }
  } else if (args.length === 1) {
    const onlyArg = args[0];
    if (typeof onlyArg === 'string' && onlyArg.length >= 8 && !SHORT_CLI_FLAG_REGEX.test(onlyArg)) {
      return onlyArg;
    }
  }
  return '';
}

function isAsciiAlnumCode(code) {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function matchesTokenBoundary(text, idx, needle) {
  if (!needle) return false;
  if (isAsciiAlnumCode(needle.charCodeAt(0)) && idx > 0 && isAsciiAlnumCode(text.charCodeAt(idx - 1))) {
    return false;
  }
  const end = idx + needle.length;
  if (
    isAsciiAlnumCode(needle.charCodeAt(needle.length - 1)) &&
    end < text.length &&
    isAsciiAlnumCode(text.charCodeAt(end))
  ) {
    return false;
  }
  return true;
}

function findNextPairMatch(text, pair, fromPos) {
  let pos = fromPos;
  while (pos < text.length) {
    const idx = text.indexOf(pair.needle, pos);
    if (idx === -1) return -1;
    if (!pair.boundaryOnly || matchesTokenBoundary(text, idx, pair.needle)) {
      return idx;
    }
    pos = idx + 1;
  }
  return -1;
}

function buildPromptRedactionPairs(text, prompt, options = {}) {
  const args = Array.isArray(options?.args) ? options.args : [];
  const executable = typeof options?.executable === 'string' ? options.executable : '';
  const explicitPrompt = typeof prompt === 'string' ? prompt : '';
  const detectedPrompt = explicitPrompt || inferPromptFromArgs(executable, args, '');
  if (!detectedPrompt) {
    return [];
  }
  const minPromptLength =
    typeof options?.minPromptLength === 'number' && Number.isFinite(options.minPromptLength)
      ? options.minPromptLength
      : 1;
  const redactBareUnbounded = detectedPrompt.length >= minPromptLength || text === detectedPrompt;
  const redactBareBounded = !redactBareUnbounded && Boolean(explicitPrompt);
  const redactedSummary = redactArgv([detectedPrompt], detectedPrompt)[0] || '[PROMPT REDACTED]';
  const pairs = [];
  const addPair = (needle, replacement, boundaryOnly = false) => {
    if (needle && replacement !== undefined && needle !== replacement) {
      pairs.push({ needle, replacement, boundaryOnly });
    }
  };
  if (!redactBareUnbounded && args.length > 0) {
    const redactedArgs = redactArgv(args, detectedPrompt);
    const rawCmd = [executable, ...args].filter(Boolean).join(' ');
    const redactedCmd = [executable, ...redactedArgs].filter(Boolean).join(' ');
    if (rawCmd) {
      addPair(rawCmd, redactedCmd, false);
    }
    if (args.length >= 2) {
      addPair(args.join(' '), redactedArgs.join(' '), false);
    }
  }
  addPair(`--print=${detectedPrompt}`, `--print=${redactedSummary}`, false);
  if (redactBareUnbounded) {
    addPair(detectedPrompt, redactedSummary, false);
  } else if (redactBareBounded) {
    addPair(detectedPrompt, redactedSummary, true);
  }
  pairs.sort((a, b) => b.needle.length - a.needle.length);
  return pairs;
}

function appendBoundedTrailingSlice(rebuilt, rebuiltBytes, text, pos, maxBytesCap) {
  const remainingBytes = Math.max(0, maxBytesCap - rebuiltBytes);
  if (remainingBytes <= 0) {
    return rebuilt;
  }
  const tail = pos === 0 ? text.slice(0, remainingBytes + 4) : text.slice(pos, pos + remainingBytes + 4);
  return rebuilt + tail;
}

/**
 * Redacts literal prompt and prompt-arg occurrences in text in a single pass,
 * optionally capping the resulting UTF-8 byte length via sliceUtf8Bytes.
 *
 * @param {string} text
 * @param {string} [prompt='']
 * @param {Object} [options]
 * @returns {string}
 */
export function redactPromptInText(text, prompt = '', options = {}) {
  if (typeof text !== 'string' || !text) {
    return '';
  }
  const hasMaxBytes =
    typeof options?.maxBytes === 'number' && Number.isFinite(options.maxBytes) && options.maxBytes >= 0;
  if (typeof options?.maxBytes === 'number' && (!Number.isFinite(options.maxBytes) || options.maxBytes <= 0)) {
    return '';
  }
  const maxBytesCap = hasMaxBytes ? Math.floor(options.maxBytes) : Infinity;
  const pairs = buildPromptRedactionPairs(text, prompt, options);
  if (pairs.length === 0) {
    return hasMaxBytes ? sliceUtf8Bytes(text, options.maxBytes) : text;
  }
  const nextIndices = pairs.map((pair) => findNextPairMatch(text, pair, 0));
  let pos = 0;
  let rebuilt = '';
  let rebuiltBytes = 0;
  while (pos < text.length) {
    let bestIdx = -1;
    let bestPair = null;
    for (let i = 0; i < pairs.length; i += 1) {
      let idx = nextIndices[i];
      if (idx === -1) continue;
      if (idx < pos) {
        idx = findNextPairMatch(text, pairs[i], pos);
        nextIndices[i] = idx;
        if (idx === -1) continue;
      }
      if (
        bestIdx === -1 ||
        idx < bestIdx ||
        (idx === bestIdx && pairs[i].needle.length > bestPair.needle.length)
      ) {
        bestIdx = idx;
        bestPair = pairs[i];
      }
    }
    if (bestIdx === -1) {
      rebuilt = hasMaxBytes
        ? appendBoundedTrailingSlice(rebuilt, rebuiltBytes, text, pos, maxBytesCap)
        : (pos === 0 ? text : rebuilt + text.slice(pos));
      break;
    }
    const prefix = text.slice(pos, bestIdx);
    if (hasMaxBytes) {
      const remainingBytes = Math.max(0, maxBytesCap - rebuiltBytes);
      if (prefix.length > remainingBytes + 4) {
        rebuilt += prefix.slice(0, remainingBytes + 4);
        break;
      }
    }
    const piece = prefix + bestPair.replacement;
    rebuilt += piece;
    pos = bestIdx + bestPair.needle.length;
    if (hasMaxBytes) {
      rebuiltBytes += Buffer.byteLength(piece, 'utf8');
      if (rebuiltBytes >= maxBytesCap) {
        break;
      }
    }
  }
  return hasMaxBytes ? sliceUtf8Bytes(rebuilt, options.maxBytes) : rebuilt;
}

/**
 * Normalizes a CLI exit code to a finite number or null (never string error codes like 'ENOENT').
 *
 * @param {*} value
 * @returns {number|null}
 */
export function normalizeExitCode(value) {
  return typeof value === 'number' && Number.isFinite(value) ? (value === 0 ? 0 : value) : null;
}

/**
 * Normalizes a POSIX signal name to trimmed uppercase /^SIG[A-Z0-9]+$/ or null.
 *
 * @param {*} value
 * @returns {string|null}
 */
export function normalizeSignalName(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return /^SIG[A-Z0-9]+$/.test(normalized) ? normalized : null;
}

/**
 * Validates and clones CLI lifecycle metadata into a frozen object, or returns null when empty/invalid.
 *
 * @param {*} raw
 * @returns {Readonly<Object>|null}
 */
export function sanitizeLifecycleMetadata(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const out = {};
  for (const key of LIFECYCLE_ISO_KEYS) {
    const val = raw[key];
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (ISO_8601_TIMESTAMP_REGEX.test(trimmed) && Number.isFinite(Date.parse(trimmed))) {
        out[key] = trimmed;
      }
    }
  }
  for (const key of LIFECYCLE_INT_KEYS) {
    const val = raw[key];
    if (typeof val === 'number' && Number.isInteger(val) && val >= 0) {
      out[key] = val === 0 ? 0 : val;
    }
  }
  if (typeof raw.groupDrainExhausted === 'boolean') {
    out.groupDrainExhausted = raw.groupDrainExhausted;
  }
  if (Array.isArray(raw.attemptedSignals)) {
    const seen = new Set();
    const signals = [];
    for (const item of raw.attemptedSignals) {
      const sig = normalizeSignalName(item);
      if (sig && !seen.has(sig)) {
        seen.add(sig);
        signals.push(sig);
        if (signals.length >= 8) break;
      }
    }
    if (signals.length > 0) {
      out.attemptedSignals = Object.freeze(signals);
    }
  }
  return Object.keys(out).length > 0 ? Object.freeze(out) : null;
}

const attemptTelemetryGateStorage = new AsyncLocalStorage();

export function createAttemptTelemetryGate(meta = {}) {
  const safeMeta = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  return {
    ...safeMeta,
    recorded: Boolean(safeMeta.recorded),
    finalized: Boolean(safeMeta.finalized),
    cancelled: Boolean(safeMeta.cancelled),
    managedByExecuteWithTimeout: Boolean(safeMeta.managedByExecuteWithTimeout)
  };
}

export function runWithAttemptTelemetryGate(gate, fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('runWithAttemptTelemetryGate requires a function');
  }
  return attemptTelemetryGateStorage.run(gate && typeof gate === 'object' ? gate : null, fn);
}

export function getActiveAttemptTelemetryGate() {
  return attemptTelemetryGateStorage.getStore() || null;
}

export function markAttemptGateFinalized(gate) {
  if (gate && typeof gate === 'object') {
    gate.finalized = true;
    return gate;
  }
  return null;
}

export function markAttemptGateCancelled(gate) {
  if (gate && typeof gate === 'object') {
    gate.cancelled = true;
    return gate;
  }
  return null;
}

/**
 * Lightweight, shell-parser-free `.council/` artifact scanner for tool call inputs.
 * Ignores tool output keys (stdout, stderr, output, result, content, text, response).
 *
 * @param {Array<Object>|Object|string} toolCalls
 * @returns {{ forbiddenStateAccess: boolean, forbiddenAccessDetails: string[] }}
 */
export function detectBasicForbiddenCouncilAccess(toolCalls) {
  if (typeof toolCalls === 'string') {
    const bounded = sliceUtf8Bytes(toolCalls, MAX_TRACE_SCAN_BYTES).trim();
    const matched = Boolean(bounded) && BASIC_FORBIDDEN_COUNCIL_REGEX.test(bounded);
    return {
      forbiddenStateAccess: matched,
      forbiddenAccessDetails: matched ? [bounded] : []
    };
  }
  const list = Array.isArray(toolCalls)
    ? toolCalls
    : toolCalls && typeof toolCalls === 'object'
      ? [toolCalls]
      : [];
  const details = new Set();
  const visited = new Set();

  const walk = (val, depth) => {
    if (depth > 20 || val === null || val === undefined) return;
    if (typeof val === 'string') {
      const bounded = sliceUtf8Bytes(val, MAX_TRACE_SCAN_BYTES).trim();
      if (!bounded) return;
      if ((bounded.startsWith('{') && bounded.endsWith('}')) || (bounded.startsWith('[') && bounded.endsWith(']'))) {
        try {
          walk(JSON.parse(bounded), depth + 1);
          return;
        } catch {
          // Inspect as raw string when not valid JSON
        }
      }
      if (BASIC_FORBIDDEN_COUNCIL_REGEX.test(bounded)) {
        details.add(bounded);
      }
      return;
    }
    if (typeof val !== 'object' || visited.has(val)) return;
    visited.add(val);
    if (Array.isArray(val)) {
      for (const item of val) walk(item, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(val)) {
      if (EXCLUDED_TRACE_OUTPUT_KEYS.has(k)) continue;
      walk(v, depth + 1);
    }
  };

  for (const item of list) {
    walk(item, 0);
  }
  const listDetails = [...details];
  return {
    forbiddenStateAccess: listDetails.length > 0,
    forbiddenAccessDetails: listDetails
  };
}

let defaultForbiddenAccessDetector = detectBasicForbiddenCouncilAccess;

export function registerForbiddenAccessDetector(detector) {
  defaultForbiddenAccessDetector =
    typeof detector === 'function' ? detector : detectBasicForbiddenCouncilAccess;
}

/**
 * Normalizes trace metadata on a provider call record.
 *
 * @param {Object} [trace]
 * @param {Object} [defaults]
 * @returns {{ traceCoverage: 'full'|'partial'|'unavailable', toolCalls: Array<Object>, skillsRead: Array<Object>, forbiddenStateAccess: boolean, forbiddenAccessDetails: string[], durationMs: number, outcome: 'success'|'error' }}
 */
export function normalizeProviderTrace(trace, defaults = {}) {
  const validCoverages = new Set(['full', 'partial', 'unavailable']);
  const defaultCoverage = defaults.provider === 'antigravity' ? 'unavailable' : 'partial';
  const traceCoverage = validCoverages.has(trace?.traceCoverage)
    ? trace.traceCoverage
    : defaultCoverage;
  const toolCalls = Array.isArray(trace?.toolCalls) ? trace.toolCalls : [];
  const skillsRead = Array.isArray(trace?.skillsRead) ? trace.skillsRead : [];
  const detector =
    typeof defaults.detectForbiddenAccess === 'function'
      ? defaults.detectForbiddenAccess
      : defaultForbiddenAccessDetector;
  const detectedForbidden =
    toolCalls.length > 0
      ? detector(toolCalls)
      : { forbiddenStateAccess: false, forbiddenAccessDetails: [] };
  const mergedDetails = [
    ...new Set([
      ...(Array.isArray(trace?.forbiddenAccessDetails) ? trace.forbiddenAccessDetails : []),
      ...detectedForbidden.forbiddenAccessDetails
    ])
  ];
  const forbiddenStateAccess =
    Boolean(trace?.forbiddenStateAccess) ||
    detectedForbidden.forbiddenStateAccess ||
    mergedDetails.length > 0;
  const durationMs =
    typeof trace?.durationMs === 'number'
      ? trace.durationMs
      : (typeof defaults.durationMs === 'number' ? defaults.durationMs : 0);
  const outcome =
    forbiddenStateAccess
      ? 'error'
      : trace?.outcome === 'error' || trace?.outcome === 'success'
        ? trace.outcome
        : (defaults.exitCode === 0 || defaults.exitCode === undefined ? 'success' : 'error');

  const promptHint = typeof defaults.prompt === 'string' ? defaults.prompt : '';
  const redactOpts = {
    executable: defaults.executable,
    args: defaults.args,
    minPromptLength: 8
  };
  const boundedStderr =
    typeof trace?.stderr === 'string' && trace.stderr.length > 0
      ? redactPromptInText(trace.stderr, promptHint, { ...redactOpts, maxBytes: MAX_CLI_STDERR_BYTES })
      : '';
  const boundedEnvelopeError =
    typeof trace?.envelopeError === 'string' && trace.envelopeError.length > 0
      ? redactPromptInText(trace.envelopeError, promptHint, { ...redactOpts, maxBytes: 1024 })
      : '';
  const lifecycle = sanitizeLifecycleMetadata(trace?.lifecycle ?? defaults.lifecycle);

  return {
    traceCoverage,
    toolCalls,
    skillsRead,
    forbiddenStateAccess,
    forbiddenAccessDetails: mergedDetails,
    durationMs,
    outcome,
    ...(boundedStderr ? { stderr: boundedStderr } : {}),
    ...(Array.isArray(trace?.deniedActions)
      ? { deniedActions: trace.deniedActions }
      : {}),
    ...(boundedEnvelopeError ? { envelopeError: boundedEnvelopeError } : {}),
    ...(typeof trace?.finishedReason === 'string' && trace.finishedReason.length > 0
      ? { finishedReason: trace.finishedReason }
      : {}),
    ...(lifecycle ? { lifecycle } : {})
  };
}

function inferEffortForTelemetry(modelString, defaultEffort) {
  if (typeof modelString !== 'string' || !modelString.trim()) {
    return undefined;
  }
  const trimmed = modelString.trim();
  const fallback =
    typeof defaultEffort === 'string' && defaultEffort.trim() ? defaultEffort.trim().toLowerCase() : 'high';
  try {
    const baseModel = extractCanonicalBaseModel(trimmed, fallback);
    if (NO_EFFORT_MODELS.has(baseModel) || NO_EFFORT_MODELS.has(trimmed.toLowerCase())) {
      return null;
    }
    return parseModelAndEffort(trimmed, fallback).effort;
  } catch {
    return typeof defaultEffort === 'string' && defaultEffort.trim()
      ? defaultEffort.trim().toLowerCase()
      : undefined;
  }
}

function buildProviderCallRecord({ context, record }) {
  const pickDefined = (...values) => {
    for (const value of values) {
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const retryDiagnostics =
    record.retryDiagnostics !== undefined ? record.retryDiagnostics : context?.retryDiagnostics;
  const phase = record.phase ?? context?.phase;
  const round = record.round ?? context?.round;
  const hasRetryDiag = Boolean(retryDiagnostics && typeof retryDiagnostics === 'object');
  const rawEffectiveModel = record.model || context?.model;
  const attempt =
    typeof record.attempt === 'number'
      ? record.attempt
      : typeof retryDiagnostics?.attempt === 'number'
        ? retryDiagnostics.attempt
        : typeof context?.attempt === 'number'
          ? context.attempt
          : !hasRetryDiag
            ? 0
            : undefined;
  const requestedModel = pickDefined(
    record.requestedModel,
    retryDiagnostics?.requestedModel,
    context?.requestedModel,
    context?.seat?.model,
    rawEffectiveModel
  );
  const requestedEffort = pickDefined(
    record.requestedEffort,
    retryDiagnostics?.requestedEffort,
    context?.requestedEffort,
    inferEffortForTelemetry(requestedModel || rawEffectiveModel, context?.reasoningEffort)
  );
  const effectiveEffort = pickDefined(
    record.effectiveEffort,
    retryDiagnostics?.effectiveEffort,
    inferEffortForTelemetry(rawEffectiveModel, record.reasoningEffort ?? context?.reasoningEffort)
  );
  const capabilityProvenance = pickDefined(
    record.capabilityProvenance,
    retryDiagnostics?.capabilityProvenance,
    context?.capabilityProvenance,
    null
  );
  const fallbackApplied =
    typeof record.fallbackApplied === 'boolean'
      ? record.fallbackApplied
      : typeof retryDiagnostics?.fallbackApplied === 'boolean'
        ? retryDiagnostics.fallbackApplied
        : false;
  const fallbackReason = pickDefined(record.fallbackReason, retryDiagnostics?.fallbackReason, null);
  const drainStatus = VALID_DRAIN_STATUSES.has(record.drainStatus) ? record.drainStatus : undefined;
  const drainDurationMs =
    typeof record.drainDurationMs === 'number' &&
    Number.isFinite(record.drainDurationMs) &&
    record.drainDurationMs >= 0
      ? record.drainDurationMs
      : undefined;
  const exitCode = drainStatus === 'drain_expired' ? null : normalizeExitCode(record.exitCode);
  const signal = drainStatus === 'drain_expired' ? null : normalizeSignalName(record.signal);
  const promptHint =
    typeof record.prompt === 'string' && record.prompt
      ? record.prompt
      : (typeof context?.prompt === 'string' ? context.prompt : '');
  const normalizedTrace = normalizeProviderTrace(record.trace, {
    durationMs: record.durationMs,
    exitCode,
    provider: record.provider,
    prompt: promptHint,
    lifecycle: record.trace?.lifecycle ?? record.lifecycle
  });

  const {
    drainStatus: _ds,
    drainDurationMs: _dd,
    exitCode: _ec,
    signal: _sig,
    lifecycle: _lc,
    prompt: _pr,
    ...restRecord
  } = record;

  return {
    ...restRecord,
    ...(record.model || context?.model ? { model: record.model || context?.model } : {}),
    ...(typeof phase === 'string' && phase ? { phase } : {}),
    ...(typeof round === 'number' ? { round } : {}),
    ...(typeof attempt === 'number' ? { attempt } : {}),
    ...(requestedModel !== undefined ? { requestedModel } : {}),
    ...(requestedEffort !== undefined ? { requestedEffort } : {}),
    ...(effectiveEffort !== undefined ? { effectiveEffort } : {}),
    ...(capabilityProvenance !== undefined ? { capabilityProvenance } : {}),
    ...(typeof fallbackApplied === 'boolean' ? { fallbackApplied } : {}),
    ...(fallbackReason !== undefined ? { fallbackReason } : {}),
    exitCode,
    signal,
    ...(drainStatus ? { drainStatus } : {}),
    ...(drainDurationMs !== undefined ? { drainDurationMs } : {}),
    tools:
      record.tools === 'none' || context?.tools === 'none'
        ? 'none'
        : (record.tools || context?.tools || 'read-only'),
    trace: normalizedTrace
  };
}

/**
 * Helper to safely record provider call telemetry once per active attempt gate.
 * Observer errors in onCallRecord, context.onCallRecord, or telemetry.emitProviderCall
 * are isolated so they never alter provider execution outcomes or trigger duplicate recording.
 *
 * @returns {boolean} true if emitted, false if skipped/invalid/gated
 */
export function recordProviderCall({
  context,
  onCallRecord,
  record,
  attemptGate,
  allowCancelledFallback = false
} = {}) {
  const gate = attemptGate || getActiveAttemptTelemetryGate();
  if (gate && (gate.recorded || gate.finalized || (gate.cancelled && !allowCancelledFallback))) {
    return false;
  }
  if (!record || typeof record !== 'object') {
    return false;
  }
  let enrichedRecord;
  try {
    enrichedRecord = buildProviderCallRecord({ context, record });
  } catch {
    return false;
  }
  if (gate) {
    gate.recorded = true;
  }
  try {
    if (typeof onCallRecord === 'function') {
      onCallRecord(enrichedRecord);
    }
  } catch {
    // Isolate direct observer callback failure
  }
  try {
    if (typeof context?.onCallRecord === 'function' && context.onCallRecord !== onCallRecord) {
      context.onCallRecord(enrichedRecord);
    }
  } catch {
    // Isolate context observer callback failure
  }
  try {
    if (context?.telemetry && typeof context.telemetry.emitProviderCall === 'function') {
      context.telemetry.emitProviderCall(enrichedRecord);
    }
  } catch {
    // Isolate telemetry emitter failure
  }
  return true;
}
