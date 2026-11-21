/**
 * @fileoverview Base Harness Adapter Interface and Error Taxonomy for The Council.
 * ESM Module (Node >= 22). Zero external dependencies.
 */

import {
  VALID_DRAIN_STATUSES,
  MAX_CLI_ERROR_MESSAGE_BYTES,
  MAX_CLI_STDERR_BYTES,
  parseModelAndEffort,
  recordProviderCall,
  normalizeProviderTrace,
  normalizeExitCode,
  normalizeSignalName,
  sliceUtf8Bytes,
  redactPromptInText,
  sanitizeLifecycleMetadata,
  createAttemptTelemetryGate,
  runWithAttemptTelemetryGate,
  getActiveAttemptTelemetryGate,
  markAttemptGateCancelled,
  markAttemptGateFinalized,
  PROVIDER_HTTP_429_REGEX,
  PROVIDER_HTTP_AUTH_REGEX
} from './cli-runner.js';

export {
  PROVIDER_HTTP_429_REGEX,
  PROVIDER_HTTP_AUTH_REGEX
};

const MAX_ENVELOPE_ERROR_BYTES = 1024;
const attemptPromptRegistry = new WeakMap();

/**
 * Associates an attempt prompt with a context object without mutating enumerable
 * context properties, allowing timeout/abort diagnostics to redact prompt leaks.
 *
 * @param {Object} context
 * @param {string} prompt
 */
export function registerAttemptPrompt(context, prompt) {
  if (context && typeof context === 'object' && typeof prompt === 'string' && prompt) {
    attemptPromptRegistry.set(context, prompt);
  }
}

/**
 * Returns true when an error must be handled by base HarnessAdapter.classifyError
 * before provider-specific quota patterns are inspected.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isReservedClassificationError(error) {
  return Boolean(
    error instanceof HarnessError ||
      error?.name === 'AbortError' ||
      error?.code === 'ABORT_ERR' ||
      error?._latchedTimeout === true ||
      error?.name === 'TimeoutError' ||
      error?.code === 'ETIMEDOUT' ||
      error?.code === 'FORBIDDEN_STATE_ACCESS' ||
      error?.trace?.forbiddenStateAccess === true ||
      /\[ForbiddenStateAccessError\]/i.test(error?.message || '') ||
      error?.name === 'HeadlessToolDeniedError' ||
      error?.code === 'HEADLESS_TOOL_DENIED'
  );
}

export const EFFORT_TIMEOUT_MAP = Object.freeze({
  max: 240000,
  xhigh: 240000,
  high: 120000,
  medium: 60000,
  low: 60000
});

export const DEFAULT_TIMEOUT_MS = 60000;

// ============================================================================
// ERROR TAXONOMY
// ============================================================================

/**
 * Base error class for all harness-related failures.
 */
export class HarnessError extends Error {
  /**
   * @param {string} message
   * @param {Object} [options]
   * @param {string} [options.harness='unknown']
   * @param {string} [options.seatId]
   * @param {string} [options.model]
   * @param {boolean} [options.isQuotaFault=false]
   * @param {boolean} [options.isRetryable=false]
   * @param {Error} [options.cause]
   */
  constructor(message, options = {}) {
    const rawMessage = message === undefined ? '' : String(message);
    super(sliceUtf8Bytes(rawMessage, MAX_CLI_ERROR_MESSAGE_BYTES));
    this.name = this.constructor.name;
    this.harness = options.harness || 'unknown';
    this.seatId = options.seatId || null;
    this.model = options.model || null;
    this.isQuotaFault = Boolean(options.isQuotaFault);
    this.isRetryable = Boolean(options.isRetryable);
    this.timestamp = new Date().toISOString();
    if (options.cause) {
      this.cause = options.cause;
    }
    if (options.inheritCauseDiagnostics === false) {
      Object.defineProperty(this, 'inheritCauseDiagnostics', {
        value: false,
        enumerable: false,
        configurable: true
      });
    }
    const diagCause = options.inheritCauseDiagnostics !== false ? options.cause : undefined;
    const rawCode =
      typeof options.code === 'string' && options.code.trim()
        ? options.code.trim()
        : typeof diagCause?.code === 'string' && diagCause.code.trim()
          ? diagCause.code.trim()
          : '';
    if (rawCode) {
      this.code = rawCode;
    }
    const drainStatus = options.drainStatus ?? diagCause?.drainStatus;
    if (typeof drainStatus === 'string' && VALID_DRAIN_STATUSES.has(drainStatus)) {
      this.drainStatus = drainStatus;
    }
    const isExpired = this.drainStatus === 'drain_expired';
    const trace = isExpired ? undefined : (options.trace ?? diagCause?.trace);
    if (trace !== undefined && trace !== null) {
      this.trace = trace;
    }
    const lifecycle = isExpired
      ? null
      : sanitizeLifecycleMetadata(options.lifecycle ?? diagCause?.lifecycle ?? trace?.lifecycle);
    if (lifecycle) {
      this.lifecycle = lifecycle;
    }
    const drainDurationMs = options.drainDurationMs ?? diagCause?.drainDurationMs;
    if (typeof drainDurationMs === 'number' && Number.isFinite(drainDurationMs) && drainDurationMs >= 0) {
      this.drainDurationMs = drainDurationMs;
    }
    if (options._latchedTimeout === true || diagCause?._latchedTimeout === true) {
      this._latchedTimeout = true;
    }
    const hasOwnExitCode =
      Object.prototype.hasOwnProperty.call(options, 'exitCode') && options.exitCode !== undefined;
    const hasOwnSignal =
      Object.prototype.hasOwnProperty.call(options, 'signal') && options.signal !== undefined;
    if (isExpired) {
      this.exitCode = null;
      this.signal = null;
      this.stderr = '';
    } else {
      this.exitCode = hasOwnExitCode
        ? normalizeExitCode(options.exitCode)
        : normalizeExitCode(diagCause?.exitCode);
      this.signal = hasOwnSignal
        ? normalizeSignalName(options.signal)
        : normalizeSignalName(diagCause?.signal);
      const rawStderr = options.stderr ?? diagCause?.stderr ?? '';
      this.stderr = typeof rawStderr === 'string' ? sliceUtf8Bytes(rawStderr, MAX_CLI_STDERR_BYTES) : '';
      const rawEnvelope = options.envelopeError ?? diagCause?.envelopeError;
      if (typeof rawEnvelope === 'string' && rawEnvelope.trim()) {
        this.envelopeError = sliceUtf8Bytes(rawEnvelope, MAX_ENVELOPE_ERROR_BYTES);
      }
    }
  }
}

/**
 * Thrown when a seat or judge encounters rate limits, token quotas,
 * or weekly subscription pool exhaustion (e.g. HTTP 429).
 */
export class QuotaExhaustionError extends HarnessError {
  /**
   * @param {string} message
   * @param {Object} [options]
   */
  constructor(message, options = {}) {
    super(message, {
      ...options,
      isQuotaFault: true,
      isRetryable: true // Retryable within maxRetriesPerSeat
    });
  }
}

/**
 * Thrown when an adapter execution exceeds the configured deadline.
 */
export class TimeoutError extends HarnessError {
  /**
   * @param {string} message
   * @param {Object} [options]
   * @param {number} [options.timeoutMs]
   */
  constructor(message, options = {}) {
    super(message, {
      ...options,
      isQuotaFault: false,
      isRetryable: true
    });
    this.timeoutMs = options.timeoutMs || null;
  }
}

/**
 * Thrown when an underlying process exits with non-zero code or unexpected stderr.
 */
export class HarnessExecutionError extends HarnessError {
  /**
   * @param {string} message
   * @param {Object} [options]
   * @param {number|null} [options.exitCode]
   * @param {string} [options.stderr]
   */
  constructor(message, options = {}) {
    super(message, {
      ...options,
      isQuotaFault: false,
      isRetryable: Boolean(options.isRetryable)
    });
  }
}

/**
 * Thrown when the model returns unparseable or schema-violating output.
 */
export class InvalidResponseError extends HarnessError {
  /**
   * @param {string} message
   * @param {Object} [options]
   * @param {string} [options.rawResponse]
   * @param {string[]} [options.validationErrors]
   */
  constructor(message, options = {}) {
    super(message, {
      ...options,
      isQuotaFault: false,
      isRetryable: true
    });
    this.rawResponse = options.rawResponse || '';
    this.validationErrors = options.validationErrors || [];
  }
}

/**
 * Thrown when API or CLI authentication fails (HTTP 401/403).
 */
export class AuthenticationError extends HarnessError {
  /**
   * @param {string} message
   * @param {Object} [options]
   */
  constructor(message, options = {}) {
    super(message, {
      ...options,
      isQuotaFault: false,
      isRetryable: false
    });
  }
}

/**
 * Thrown when headless CLI execution rejects or denies requested tools/actions.
 */
export class HeadlessToolDeniedError extends HarnessError {
  /**
   * @param {string} message
   * @param {Object} [options]
   */
  constructor(message, options = {}) {
    super(message, {
      ...options,
      isQuotaFault: false,
      isRetryable: options.isRetryable !== undefined ? Boolean(options.isRetryable) : true
    });
    this.code =
      typeof options.code === 'string' && options.code.trim()
        ? options.code.trim()
        : 'HEADLESS_TOOL_DENIED';
    const diagCause = options.inheritCauseDiagnostics !== false ? options.cause : undefined;
    this.deniedActions = Array.isArray(options.deniedActions) ? options.deniedActions : [];
    this.trace = options.trace ?? diagCause?.trace ?? null;
    const finishedReason = options.finishedReason ?? diagCause?.finishedReason;
    if (typeof finishedReason === 'string' && finishedReason) {
      this.finishedReason = finishedReason;
    }
    const envelopeError = options.envelopeError ?? diagCause?.envelopeError;
    if (typeof envelopeError === 'string' && envelopeError.trim()) {
      this.envelopeError = sliceUtf8Bytes(envelopeError, MAX_ENVELOPE_ERROR_BYTES);
    }
  }
}

/**
 * Thrown when an adapter execution is cancelled via AbortSignal.
 */
export class AbortError extends HarnessError {
  /**
   * @param {string} message
   * @param {Object} [options]
   */
  constructor(message = 'The operation was aborted', options = {}) {
    super(message, {
      ...options,
      isQuotaFault: false,
      isRetryable: false
    });
    this.name = 'AbortError';
    this.code =
      typeof options.code === 'string' && options.code.trim() ? options.code.trim() : 'ABORT_ERR';
  }
}

/**
 * Factory helper for canonical non-retryable AbortError instances.
 *
 * @param {string} [message]
 * @param {Object} [options]
 * @returns {AbortError}
 */
export function createAbortError(message = 'The operation was aborted', options = {}) {
  return new AbortError(message, options);
}

/**
 * Resolves effective tools and workspace cwd for a single participant invocation
 * using the canonical precedence shared across all harness adapters and the engine.
 *
 * @param {Object} [options]
 * @returns {{ effectiveTools: string, configuredWorkspaceCwd: string|undefined, effectiveCwd: string|undefined }}
 */
export function resolveAttemptExecutionWorkspace({
  role = 'seat',
  phase = 'DELIBERATION',
  participant,
  seat,
  judge,
  state = {},
  config,
  tools,
  cwd,
  callerContext,
  context,
  adapter
} = {}) {
  const actor = participant ?? seat ?? judge ?? {};
  const ctx = callerContext ?? context;
  const isVoting = phase === 'VOTING' || phase === 'confirming';
  let effectiveTools;
  if (tools === 'none' || ctx?.tools === 'none') {
    effectiveTools = 'none';
  } else if (role === 'judge') {
    effectiveTools = tools ?? ctx?.tools ?? actor?.tools ?? config?.tools ?? 'read-only';
  } else {
    effectiveTools =
      tools ??
      ctx?.tools ??
      (isVoting ? actor?.votingTools ?? actor?.tools : actor?.tools) ??
      config?.tools ??
      'read-only';
  }

  const configuredWorkspaceCwd = [
    cwd,
    ctx?.cwd,
    actor?.cwd,
    state?.cwd,
    adapter?.cwd,
    adapter?.config?.cwd,
    config?.cwd
  ]
    .find((c) => typeof c === 'string' && c.trim())
    ?.trim();

  const effectiveCwd = effectiveTools === 'none' ? undefined : configuredWorkspaceCwd;
  return { effectiveTools, configuredWorkspaceCwd, effectiveCwd };
}

/**
 * Resolves attempt workspace settings, mutates `callerContext._invocationMeta` in place,
 * and returns the shared reference along with `retryDiagnostics`.
 *
 * @param {Object} [params]
 * @returns {{ effectiveTools: string, configuredWorkspaceCwd: string|undefined, effectiveCwd: string|undefined, invocationMeta: Object, retryDiagnostics: Object|null }}
 */
export function captureAttemptInvocationMeta(params = {}) {
  const workspace = resolveAttemptExecutionWorkspace(params);
  const callerContext = params.callerContext;
  const invocationMeta =
    callerContext && typeof callerContext === 'object'
      ? (callerContext._invocationMeta ||= {})
      : {};
  Object.assign(invocationMeta, workspace);
  return {
    ...workspace,
    invocationMeta,
    retryDiagnostics: callerContext?.retryDiagnostics || null
  };
}

// ============================================================================
// ABSTRACT BASE HARNESS ADAPTER
// ============================================================================

/**
 * Abstract Base Class for Council Harness Adapters.
 */
export class HarnessAdapter {
  /**
   * @param {Object} [config]
   * @param {string} [config.name='base']
   * @param {number} [config.timeoutMs=60000]
   * @param {Function} [config.logger]
   */
  constructor(config = {}) {
    this.config = config;
    this.name = config.name || 'base';
    this.defaultTimeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.logger = config.logger || (() => {});
    this.cwd = config.cwd;
    this.initialized = false;
  }

  /**
   * Resolves execution timeout in milliseconds, dynamically scaling by model reasoning effort when unset.
   *
   * @param {string} [model] - Model string with optional effort (e.g. 'gpt-6-astra (max)')
   * @param {number} [explicitTimeoutMs] - Explicit timeout override
   * @returns {number} Timeout in milliseconds
   */
  resolveTimeoutMs(model, explicitTimeoutMs) {
    if (typeof explicitTimeoutMs === 'number' && explicitTimeoutMs > 0 && Number.isFinite(explicitTimeoutMs)) {
      return explicitTimeoutMs;
    }
    if (this.defaultTimeoutMs !== DEFAULT_TIMEOUT_MS) {
      return this.defaultTimeoutMs;
    }
    if (typeof model === 'string' && model.trim()) {
      const trimmed = model.trim().toLowerCase();
      const parenMatch = trimmed.match(/^([^(]+)\s*\(([^)]+)\)$/);
      if (parenMatch) {
        const effort = parenMatch[2].trim();
        if (EFFORT_TIMEOUT_MAP[effort]) {
          return EFFORT_TIMEOUT_MAP[effort];
        }
      }
      for (const suffix of ['-xhigh', '-max', '-high', '-medium', '-low']) {
        if (trimmed.endsWith(suffix)) {
          const effort = suffix.slice(1);
          if (EFFORT_TIMEOUT_MAP[effort]) {
            return EFFORT_TIMEOUT_MAP[effort];
          }
        }
      }
    }
    return this.defaultTimeoutMs;
  }

  /**
   * Initialize adapter resources, verify executable/API connectivity.
   * @returns {Promise<void>}
   */
  async initialize() {
    this.initialized = true;
  }

  /**
   * Teardown adapter resources, close open handles or processes.
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.initialized = false;
  }

  /**
   * Perform a lightweight health check.
   * @returns {Promise<{ ok: boolean, latencyMs?: number, error?: string }>}
   */
  async healthCheck() {
    return { ok: this.initialized };
  }

  /**
   * Execute a seat turn in the council debate.
   * Dispatches proof submission in DELIBERATION or vote casting in VOTING.
   *
   * @param {Object} params
   * @param {Object} params.seat - Seat configuration object { id, model, soul, ... }
   * @param {string} params.soul - Soul temperament and domain instructions
   * @param {number} params.round - Current deliberation round index
   * @param {string} params.phase - Current canonical council phase
   * @param {Object} params.state - Current council state snapshot
   * @param {number} [params.timeoutMs] - Optional execution timeout override
   * @returns {Promise<Object>} Execution result (proof payload, vote payload, or clarification)
   */
  async executeSeat(params) {
    throw new Error(`executeSeat must be implemented by subclass ${this.constructor.name}`);
  }

  /**
   * Helper alias to execute pre-deliberation clarification discovery for a seat.
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async executeSeatClarification(params) {
    return this.executeSeat({ ...params, phase: params.phase || 'CLARIFICATION' });
  }

  /**
   * Helper alias to execute proof submission for a seat.
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async executeSeatProof(params) {
    return this.executeSeat({ ...params, phase: params.phase || 'DELIBERATION' });
  }

  /**
   * Helper alias to execute vote casting for a seat.
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async executeSeatVote(params) {
    return this.executeSeat({ ...params, phase: params.phase || 'VOTING' });
  }

  /**
   * Execute a judge turn in the council debate.
   * Audits submitted proofs and synthesizes proof-bound candidate clauses.
   *
   * @param {Object} params
   * @param {Object} params.judge - Judge configuration object { id, model, soul, ... }
   * @param {number} params.round - Current deliberation round index
   * @param {string} [params.phase] - Current canonical council phase
   * @param {Array<Object>} params.proofs - Proofs submitted for auditing
   * @param {Object} params.state - Current council state snapshot
   * @param {number} [params.timeoutMs] - Optional execution timeout override
   * @returns {Promise<Object>} Synthesis payload { summary, proofDecisions, clauses }
   */
  async executeJudge(params) {
    throw new Error(`executeJudge must be implemented by subclass ${this.constructor.name}`);
  }

  /**
   * Helper alias to execute judge audit and candidate synthesis.
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async executeJudgeAuditAndSynthesis(params) {
    return this.executeJudge({ ...params, phase: params.phase || 'JUDGE_AUDIT_SYNTHESIS' });
  }

  _buildAttemptAbortError(context = {}, causeOverride, externalSignal) {
    const hasOwnCause = causeOverride instanceof Error;
    const hasSignalReason = !hasOwnCause && externalSignal?.reason instanceof Error;
    return createAbortError(
      `Harness "${this.name}" execution aborted for seat "${context.seatId || 'unknown'}"`,
      {
        harness: this.name,
        seatId: context.seatId,
        model: context.model,
        ...(hasOwnCause
          ? { cause: causeOverride }
          : hasSignalReason
            ? { cause: externalSignal.reason, inheritCauseDiagnostics: false }
            : {})
      }
    );
  }

  _emitFallbackAttemptRecord({ gate, context, err, drainResult, startedAt }) {
    if (!gate || gate.recorded || gate.finalized) {
      return;
    }
    const isExpired = drainResult?.drainStatus === 'drain_expired';
    const rawTrace = !isExpired && err?.trace && typeof err.trace === 'object' ? err.trace : null;
    const durationMs =
      typeof rawTrace?.durationMs === 'number' && Number.isFinite(rawTrace.durationMs)
        ? rawTrace.durationMs
        : Math.max(0, Date.now() - startedAt);
    const stderr =
      !isExpired && typeof err?.stderr === 'string' && err.stderr.length > 0
        ? err.stderr
        : undefined;
    const lifecycle = isExpired ? undefined : (err?.lifecycle ?? undefined);
    const trace = {
      ...(rawTrace || {
        traceCoverage: 'unavailable',
        toolCalls: [],
        skillsRead: [],
        forbiddenStateAccess: false,
        forbiddenAccessDetails: []
      }),
      durationMs,
      outcome: 'error',
      ...(stderr ? { stderr } : {}),
      ...(lifecycle ? { lifecycle } : {})
    };

    const prompt = resolveAttemptPrompt(context);
    this.recordProviderCall({
      context,
      attemptGate: gate,
      allowCancelledFallback: true,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: this.name,
        model: context?.model,
        ...(prompt ? { prompt } : {}),
        tools: context?.tools === 'none' ? 'none' : context?.tools || 'read-only',
        exitCode: isExpired ? null : normalizeExitCode(err?.exitCode),
        signal: isExpired ? null : normalizeSignalName(err?.signal),
        ...(drainResult?.drainStatus ? { drainStatus: drainResult.drainStatus } : {}),
        ...(typeof drainResult?.drainDurationMs === 'number'
          ? { drainDurationMs: drainResult.drainDurationMs }
          : {}),
        ...(lifecycle ? { lifecycle } : {}),
        durationMs,
        trace
      }
    });
  }

  _recordDirectFnErrorIfUngated(err, { gate, context, startedAt }) {
    if (!err?.trace || err._providerCallRecorded || gate.recorded || gate.finalized || gate.cancelled) {
      return;
    }
    const prompt = resolveAttemptPrompt(context);
    const durationMs =
      typeof err.trace.durationMs === 'number' && Number.isFinite(err.trace.durationMs)
        ? err.trace.durationMs
        : Math.max(0, Date.now() - startedAt);
    this.recordProviderCall({
      context,
      attemptGate: gate,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: this.name,
        model: context?.model,
        ...(prompt ? { prompt } : {}),
        tools: context?.tools === 'none' ? 'none' : context?.tools || 'read-only',
        exitCode: normalizeExitCode(err.exitCode),
        signal: normalizeSignalName(err.signal),
        durationMs,
        trace: { ...err.trace, outcome: 'error' }
      }
    });
    err._providerCallRecorded = true;
  }

  _throwDiagnosticOutcome({ targetErr, drainResult, context, gate, startedAt, externalSignal = null }) {
    attachDrainDiagnostics(targetErr, drainResult, context, externalSignal);
    this._emitFallbackAttemptRecord({ gate, context, err: targetErr, drainResult, startedAt });
    markAttemptGateFinalized(gate);
    throw targetErr;
  }

  async _finalizeTimeoutOrAbort({
    firstCause,
    latchedTimeoutErr,
    fnPromise,
    context,
    gate,
    startedAt,
    externalSignal
  }) {
    const drainResult = await drainSettledAttempt(fnPromise, context?.abortDrainMs);
    if (firstCause === 'timeout' && latchedTimeoutErr) {
      latchedTimeoutErr._latchedTimeout = true;
      this._throwDiagnosticOutcome({
        targetErr: latchedTimeoutErr,
        drainResult,
        context,
        gate,
        startedAt,
        externalSignal
      });
    }

    const externalReason = externalSignal?.reason;
    const isExternalReason =
      externalReason !== undefined &&
      externalReason !== null &&
      drainResult.settledError === externalReason;
    const abortErr =
      !isExternalReason && drainResult.settledError instanceof AbortError
        ? drainResult.settledError
        : this._buildAttemptAbortError(
            context,
            isExternalReason ? undefined : drainResult.settledError,
            externalSignal
          );
    this._throwDiagnosticOutcome({
      targetErr: abortErr,
      drainResult,
      context,
      gate,
      startedAt,
      externalSignal
    });
  }

  _handleSettledFnError(err, { controls, context, gate, startedAt, externalSignal }) {
    if (settledIsAbort(err, externalSignal, controls.firstCause)) {
      const externalReason = externalSignal?.reason;
      const isExternalReason =
        externalReason !== undefined && externalReason !== null && err === externalReason;
      const abortErr =
        !isExternalReason && err instanceof AbortError
          ? err
          : this._buildAttemptAbortError(context, isExternalReason ? undefined : err, externalSignal);
      this._throwDiagnosticOutcome({
        targetErr: abortErr,
        drainResult: { drainStatus: 'settled', drainDurationMs: 0, settledError: err },
        context,
        gate,
        startedAt,
        externalSignal
      });
    }
    const prompt = resolveAttemptPrompt(context);
    if (err && typeof err === 'object' && err !== externalSignal?.reason) {
      sanitizeErrorDiagnostics(err, prompt, externalSignal?.reason);
    }
    this._recordDirectFnErrorIfUngated(err, { gate, context, startedAt });
    throw err;
  }

  _handleAttemptError(err, { provider, context, onCallRecord, tools }) {
    const activeGate = getActiveAttemptTelemetryGate();
    const gateBlocked = Boolean(
      activeGate && (activeGate.recorded || activeGate.finalized || activeGate.cancelled)
    );
    if (err?.trace && !err._providerCallRecorded && !gateBlocked) {
      const prompt = resolveAttemptPrompt(context);
      this.recordProviderCall({
        context,
        ...(activeGate ? { attemptGate: activeGate } : {}),
        ...(typeof onCallRecord === 'function' && onCallRecord !== context?.onCallRecord
          ? { onCallRecord }
          : {}),
        record: {
          participantId: context.seatId,
          provider,
          model: context.model,
          ...(prompt ? { prompt } : {}),
          tools,
          exitCode: normalizeExitCode(err.exitCode),
          signal: normalizeSignalName(err.signal),
          durationMs: typeof err.trace.durationMs === 'number' ? err.trace.durationMs : 0,
          trace: { ...err.trace, outcome: 'error' }
        }
      });
      err._providerCallRecorded = true;
    }
    throw this.classifyError(err, context);
  }

  _createExecutionRaceControls(externalSignal, effectiveTimeoutMs, context, gate) {
    const timeoutController = new AbortController();
    const composedSignal = externalSignal
      ? AbortSignal.any([externalSignal, timeoutController.signal])
      : timeoutController.signal;
    const state = {
      firstCause: null,
      latchedTimeoutErr: null,
      timer: null,
      onExternalAbort: null,
      composedSignal
    };
    let triggerExternalAbort = null;
    const externalAbortPromise = externalSignal
      ? new Promise((resolve) => {
          triggerExternalAbort = resolve;
        })
      : null;

    if (externalSignal) {
      state.onExternalAbort = () => {
        if (state.firstCause === null) {
          state.firstCause = 'external';
          markAttemptGateCancelled(gate);
          if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
          }
        }
        triggerExternalAbort?.({ type: 'external' });
      };
      externalSignal.addEventListener('abort', state.onExternalAbort, { once: true });
      if (externalSignal.aborted) {
        externalSignal.removeEventListener('abort', state.onExternalAbort);
        state.preAborted = true;
        return state;
      }
    }

    state.externalAbortPromise = externalAbortPromise;
    state.timeoutPromise = new Promise((resolve) => {
      state.timer = setTimeout(() => {
        state.timer = null;
        if (state.firstCause !== null) {
          return;
        }
        state.firstCause = 'timeout';
        markAttemptGateCancelled(gate);
        state.latchedTimeoutErr = new TimeoutError(
          `Harness "${this.name}" execution timed out after ${effectiveTimeoutMs}ms for seat "${context.seatId || 'unknown'}"`,
          {
            harness: this.name,
            seatId: context.seatId,
            model: context.model,
            timeoutMs: effectiveTimeoutMs,
            _latchedTimeout: true
          }
        );
        timeoutController.abort();
        resolve({ type: 'timeout' });
      }, effectiveTimeoutMs);
    });
    return state;
  }

  _cleanupRaceControls(state, externalSignal) {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (externalSignal && state.onExternalAbort) {
      externalSignal.removeEventListener('abort', state.onExternalAbort);
      state.onExternalAbort = null;
    }
  }

  /**
   * Execute an async operation with strict timeout boundary and first-cause cancellation latch.
   *
   * @template T
   * @param {(signal: AbortSignal) => Promise<T>} fn
   * @param {number} [timeoutMs]
   * @param {Object} [context]
   * @returns {Promise<T>}
   */
  async executeWithTimeout(fn, timeoutMs, context = {}) {
    const effectiveTimeoutMs = this.resolveTimeoutMs(context.model, timeoutMs);
    const externalSignal = context?.signal || null;

    if (externalSignal?.aborted) {
      throw this._buildAttemptAbortError(context, undefined, externalSignal);
    }

    const startedAt = Date.now();
    const gate = createAttemptTelemetryGate({ managedByExecuteWithTimeout: true });
    const controls = this._createExecutionRaceControls(externalSignal, effectiveTimeoutMs, context, gate);
    if (controls.preAborted) {
      markAttemptGateFinalized(gate);
      throw this._buildAttemptAbortError(context, undefined, externalSignal);
    }

    try {
      let fnPromise;
      try {
        fnPromise = runWithAttemptTelemetryGate(gate, () =>
          Promise.resolve(fn(controls.composedSignal))
        );
      } catch (syncErr) {
        this._handleSettledFnError(syncErr, { controls, context, gate, startedAt, externalSignal });
      }

      // Prevent unhandled rejection when timeout or abortDrainMs wins before fnPromise settles
      fnPromise.catch(() => {});

      const raceInputs = [
        controls.timeoutPromise,
        fnPromise.then(
          (value) => ({ type: 'fn_ok', value }),
          (error) => ({ type: 'fn_err', error })
        )
      ];
      if (controls.externalAbortPromise) {
        raceInputs.push(controls.externalAbortPromise);
      }

      const outcome = await Promise.race(raceInputs);
      const common = { fnPromise, context, gate, startedAt, externalSignal };

      if (outcome.type === 'timeout' || (controls.firstCause === 'timeout' && controls.latchedTimeoutErr)) {
        await this._finalizeTimeoutOrAbort({
          ...common,
          firstCause: 'timeout',
          latchedTimeoutErr: controls.latchedTimeoutErr
        });
      }
      if (outcome.type === 'external' || (controls.firstCause === 'external' && externalSignal?.aborted)) {
        this._cleanupRaceControls(controls, externalSignal);
        await this._finalizeTimeoutOrAbort({ ...common, firstCause: 'external', latchedTimeoutErr: null });
      }
      if (outcome.type === 'fn_err') {
        this._handleSettledFnError(outcome.error, { controls, context, gate, startedAt, externalSignal });
      }
      if (externalSignal?.aborted && controls.firstCause !== 'timeout') {
        this._throwDiagnosticOutcome({
          targetErr: this._buildAttemptAbortError(context, undefined, externalSignal),
          drainResult: { drainStatus: 'fulfilled', drainDurationMs: 0, settledError: null },
          context,
          gate,
          startedAt,
          externalSignal
        });
      }

      return outcome.value;
    } finally {
      this._cleanupRaceControls(controls, externalSignal);
      markAttemptGateFinalized(gate);
      attemptPromptRegistry.delete(context);
    }
  }

  /**
   * Safely records provider call telemetry via cli-runner.
   *
   * @param {Object} params
   */
  recordProviderCall(params) {
    return recordProviderCall(params);
  }

  _buildClassifiedErrorOptions(error, context = {}) {
    return buildClassifiedErrorOptions(this.name, error, context);
  }

  /**
   * Template method: Classifies a raw error into the canonical error taxonomy.
   *
   * @param {Error|any} error
   * @param {Object} [context]
   * @returns {HarnessError}
   */
  classifyError(error, context = {}) {
    const prompt = resolveAttemptPrompt(context);
    const externalReason = context?.signal?.reason;
    const isSameExternalReason =
      externalReason !== undefined && externalReason !== null && error === externalReason;
    if (error && typeof error === 'object' && !isSameExternalReason) {
      sanitizeErrorDiagnostics(error, prompt, externalReason);
    }
    if (error instanceof AbortError) {
      return error;
    }

    const rawMsg = typeof error?.message === 'string' ? error.message : String(error);
    const msg = redactPromptInText(rawMsg, prompt, {
      minPromptLength: 8,
      maxBytes: MAX_CLI_ERROR_MESSAGE_BYTES
    });
    const baseOptions = this._buildClassifiedErrorOptions(error, context);
    const raw = [msg, baseOptions.stderr, baseOptions.envelopeError].filter(Boolean).join(' ');

    // Cancellation / AbortSignal guard (non-retryable)
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
      return new AbortError(msg, baseOptions);
    }

    // Preserve already-latched TimeoutError with attached diagnostics intact; never reclassify from stderr
    if (error instanceof TimeoutError) {
      return error;
    }
    if (error?._latchedTimeout === true) {
      return new TimeoutError(msg, {
        ...baseOptions,
        timeoutMs: error?.timeoutMs || null,
        _latchedTimeout: true
      });
    }

    if (error instanceof HarnessError) {
      return error;
    }

    // Forbidden .council/ state access guard
    if (
      error?.code === 'FORBIDDEN_STATE_ACCESS' ||
      error?.trace?.forbiddenStateAccess === true ||
      /\[ForbiddenStateAccessError\]/i.test(msg)
    ) {
      return new HarnessExecutionError(msg, {
        ...baseOptions,
        code: 'FORBIDDEN_STATE_ACCESS',
        isRetryable: true
      });
    }

    // Headless tool denial guard
    if (error?.name === 'HeadlessToolDeniedError' || error?.code === 'HEADLESS_TOOL_DENIED') {
      return new HeadlessToolDeniedError(msg, {
        ...baseOptions,
        deniedActions: error?.deniedActions ?? error?.trace?.deniedActions,
        finishedReason: error?.finishedReason ?? baseOptions.trace?.finishedReason,
        envelopeError: baseOptions.envelopeError ?? baseOptions.trace?.envelopeError,
        isRetryable: error?.isRetryable !== undefined ? Boolean(error.isRetryable) : true
      });
    }

    // Timeout pattern
    if (
      error?.name === 'TimeoutError' ||
      error?.code === 'ETIMEDOUT' ||
      (error?.killed && error?.signal === 'SIGTERM') ||
      /\btimed?\s*out\b/i.test(raw)
    ) {
      return new TimeoutError(msg, {
        ...baseOptions,
        timeoutMs: error?.timeoutMs || null
      });
    }

    // Authentication / PID-safe HTTP 401/403 pattern
    if (
      PROVIDER_HTTP_AUTH_REGEX.test(raw) ||
      /\b(?:unauthenticated|unauthorized|authentication\s+failed|invalid[\s_-]*api[\s_-]*key|permission_denied)\b/i.test(
        raw
      )
    ) {
      return new AuthenticationError(msg, baseOptions);
    }

    // Common PID-safe HTTP 429 / Quota pattern
    if (PROVIDER_HTTP_429_REGEX.test(raw) || /\bquota\b|rate[\s_-]*limit|resource_exhausted/i.test(raw)) {
      return new QuotaExhaustionError(msg, baseOptions);
    }

    return new HarnessExecutionError(msg, baseOptions);
  }

  _withRetryFeedback(prompt, feedback) {
    return typeof feedback === 'string' && feedback
      ? prompt + '\n\nValidation retry instructions:\n' + feedback.slice(0, 1000)
      : prompt;
  }

  /**
   * Extracts and parses JSON from raw LLM output, stripping markdown fences.
   *
   * @param {string} rawText
   * @param {'proof'|'vote'|'judge_synthesis'|'clarification'} schemaType
   * @returns {Object}
   */
  parseStructuredOutput(rawText, schemaType) {
    if (rawText && typeof rawText === 'object' && rawText.trace && typeof rawText.trace === 'object') {
      const normalizedTrace = normalizeProviderTrace(rawText.trace);
      if (normalizedTrace.forbiddenStateAccess) {
        const err = new Error(
          `[ForbiddenStateAccessError] Seat attempted to access forbidden .council/ state artifact: ${normalizedTrace.forbiddenAccessDetails.join(', ')}`
        );
        err.code = 'FORBIDDEN_STATE_ACCESS';
        err.trace = normalizedTrace;
        throw err;
      }
    }

    const resolvedText =
      rawText && typeof rawText === 'object'
        ? (typeof rawText.text === 'string'
          ? rawText.text
          : (typeof rawText.rawOutput === 'string' ? rawText.rawOutput : null))
        : rawText;
    if (typeof resolvedText !== 'string' || !resolvedText.trim()) {
      throw new InvalidResponseError('Model output was empty or not a string', {
        harness: this.name,
        rawResponse: String(resolvedText ?? rawText)
      });
    }

    const trimmed = resolvedText.trim();

    if (schemaType === 'clarification') {
      const questionMatch = trimmed.match(/(?:^|\n)\s*QUESTION\s*:\s*([\s\S]+)$/i);
      if (questionMatch && questionMatch[1].trim()) {
        return {
          needsClarification: true,
          status: 'question',
          question: questionMatch[1].trim(),
          raw: trimmed
        };
      }
      if (/(?:^|\n)\s*CLEAR(?:\s*:|$)/i.test(trimmed)) {
        return {
          needsClarification: false,
          status: 'clear',
          question: null,
          raw: trimmed
        };
      }
    }

    // 1. Search for all markdown code blocks (```(?:json)? ... ```)
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
    const codeBlocks = [];
    let match;
    while ((match = codeBlockRegex.exec(trimmed)) !== null) {
      codeBlocks.push(match[1].trim());
    }

    // Evaluate code blocks in reverse (last block first, since final answer is placed at end)
    for (let i = codeBlocks.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(codeBlocks[i]);
        const errors = this._validatePayloadSchema(parsed, schemaType);
        if (errors.length === 0) {
          return parsed;
        }
      } catch {
        // Not valid JSON in this block, continue
      }
    }

    // 2. Extract balanced JSON objects from raw text (handles tool chatter preceding output)
    const candidates = [];
    let braceDepth = 0;
    let startIndex = -1;
    let inString = false;
    let escape = false;

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];

      if (inString) {
        if (escape) {
          escape = false;
        } else if (char === '\\') {
          escape = true;
        } else if (char === '"') {
          inString = false;
        }
      } else {
        if (char === '"') {
          inString = true;
        } else if (char === '{') {
          if (braceDepth === 0) {
            startIndex = i;
          }
          braceDepth++;
        } else if (char === '}') {
          braceDepth--;
          if (braceDepth === 0 && startIndex !== -1) {
            candidates.push(trimmed.substring(startIndex, i + 1));
            startIndex = -1;
          } else if (braceDepth < 0) {
            braceDepth = 0;
            startIndex = -1;
          }
        }
      }
    }

    // Test extracted candidates in reverse order
    let lastParsedObj = null;
    let lastValidationError = null;

    for (let i = candidates.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(candidates[i]);
        const errors = this._validatePayloadSchema(parsed, schemaType);
        if (errors.length === 0) {
          return parsed;
        }
        if (!lastParsedObj) {
          lastParsedObj = parsed;
          lastValidationError = errors;
        }
      } catch {
        // Candidate was not valid JSON
      }
    }

    // 3. Fallback: If we parsed a valid JSON object that failed schema validation, report schema errors
    if (lastParsedObj && lastValidationError) {
      throw new InvalidResponseError(
        `Model response violates ${schemaType} schema: ${lastValidationError.join('; ')}`,
        {
          harness: this.name,
          rawResponse: rawText,
          validationErrors: lastValidationError
        }
      );
    }

    // 4. Fallback: If single code block was present but had invalid JSON
    if (codeBlocks.length > 0) {
      try {
        JSON.parse(codeBlocks[codeBlocks.length - 1]);
      } catch (err) {
        throw new InvalidResponseError(`Failed to parse model JSON: ${err.message}`, {
          harness: this.name,
          rawResponse: rawText,
          cause: err
        });
      }
    }

    // 5. Direct parse fallback
    try {
      const direct = JSON.parse(trimmed);
      const errors = this._validatePayloadSchema(direct, schemaType);
      if (errors.length > 0) {
        throw new InvalidResponseError(
          `Model response violates ${schemaType} schema: ${errors.join('; ')}`,
          {
            harness: this.name,
            rawResponse: rawText,
            validationErrors: errors
          }
        );
      }
      return direct;
    } catch (err) {
      if (err instanceof InvalidResponseError) throw err;
      throw new InvalidResponseError(`Failed to parse model JSON: ${err.message}`, {
        harness: this.name,
        rawResponse: rawText,
        cause: err
      });
    }
  }

  /**
   * Internal schema validator for parsed responses.
   * @private
   */
  _validatePayloadSchema(data, schemaType) {
    const errors = [];
    if (!data || typeof data !== 'object') {
      return ['Response payload must be a non-null object'];
    }

    switch (schemaType) {
      case 'clarification':
        if (
          typeof data.question !== 'string' &&
          typeof data.needsClarification !== 'boolean' &&
          typeof data.status !== 'string'
        ) {
          errors.push('Clarification payload requires "question", "needsClarification", or "status".');
        }
        break;

      case 'proof':
        if (!data.scope || typeof data.scope !== 'string' || !data.scope.trim()) {
          errors.push('"scope" condition is required.');
        }
        if (!['check', 'citation', 'benchmark', 'derivation'].includes(data.kind)) {
          errors.push('"kind" must be check, citation, benchmark, or derivation.');
        }
        if (!data.source || typeof data.source !== 'string' || !data.source.trim()) {
          errors.push('verifiable "source" is required; bare opinions are forbidden.');
        }
        if (!data.statement || typeof data.statement !== 'string' || !data.statement.trim()) {
          errors.push('falsifiable "statement" is required.');
        }
        break;

      case 'vote':
        if (!['accept', 'object'].includes(data.vote)) {
          errors.push('"vote" must be "accept" or "object".');
        }
        if (data.vote === 'object') {
          if (!data.reason || typeof data.reason !== 'string' || !data.reason.trim()) {
            errors.push('An objection requires a concrete "reason".');
          }
          const normalizedProofId =
            typeof data.proofId === 'string' && data.proofId.trim()
              ? data.proofId.trim()
              : typeof data.backingProof === 'string' && data.backingProof.trim()
                ? data.backingProof.trim()
                : '';
          if (normalizedProofId) {
            data.proofId = normalizedProofId;
          } else {
            errors.push('An objection must cite a "proofId" or provide a "backingProof".');
          }
        }
        break;

      case 'judge_synthesis':
        if (!data.summary || typeof data.summary !== 'string') {
          errors.push('Candidate "summary" is required.');
        }
        if (!Array.isArray(data.clauses) || data.clauses.length === 0) {
          errors.push('Candidate requires at least one clause.');
        } else {
          data.clauses.forEach((c, idx) => {
            if (!c.context || typeof c.context !== 'string') {
              errors.push(`Clause ${idx + 1} requires a "context" string.`);
            }
            if (!c.conclusion || typeof c.conclusion !== 'string') {
              errors.push(`Clause ${idx + 1} requires a "conclusion" string.`);
            }
            if (!Array.isArray(c.citedProofIds) || c.citedProofIds.length === 0) {
              errors.push(`Clause ${idx + 1} must cite at least one Proof ID.`);
            }
          });
        }
        break;
    }

    return errors;
  }
}

function resolveAttemptPrompt(context) {
  if (typeof context?.prompt === 'string' && context.prompt) {
    return context.prompt;
  }
  if (context && typeof context === 'object') {
    return attemptPromptRegistry.get(context) || '';
  }
  return '';
}

async function drainSettledAttempt(fnPromise, abortDrainMs) {
  const drainStartedAt = Date.now();
  const hasExplicitAbortDrain =
    typeof abortDrainMs === 'number' &&
    Number.isFinite(abortDrainMs) &&
    abortDrainMs >= 0;

  let settled = false;
  let settledError = null;
  let settledFulfilled = false;
  const waitForSettlement = fnPromise.then(
    () => {
      settled = true;
      settledFulfilled = true;
    },
    (err) => {
      settled = true;
      settledError = err;
    }
  );

  if (hasExplicitAbortDrain) {
    let drainTimer = null;
    try {
      await Promise.race([
        waitForSettlement,
        new Promise((resolve) => {
          drainTimer = setTimeout(resolve, abortDrainMs);
        })
      ]);
    } finally {
      if (drainTimer) {
        clearTimeout(drainTimer);
      }
    }
  } else {
    await waitForSettlement;
  }

  return {
    drainStatus: !settled ? 'drain_expired' : settledFulfilled ? 'fulfilled' : 'settled',
    drainDurationMs: Math.max(0, Date.now() - drainStartedAt),
    settledError
  };
}

function pickOwnOrCause(obj, key, allowCause = true) {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined) {
    return obj[key];
  }
  if (
    allowCause &&
    obj.cause &&
    typeof obj.cause === 'object' &&
    Object.prototype.hasOwnProperty.call(obj.cause, key) &&
    obj.cause[key] !== undefined
  ) {
    return obj.cause[key];
  }
  return undefined;
}

function tryAssignDiagnosticProp(obj, key, value) {
  try {
    obj[key] = value;
    return true;
  } catch {
    return false;
  }
}

function sanitizeTraceDiagnostics(trace, prompt = '') {
  if (!trace || typeof trace !== 'object') {
    return trace;
  }
  const opts = { minPromptLength: 8 };
  const nextStderr =
    typeof trace.stderr === 'string' && trace.stderr.length > 0
      ? sliceUtf8Bytes(
          redactPromptInText(trace.stderr, prompt, { ...opts, maxBytes: MAX_CLI_STDERR_BYTES }),
          MAX_CLI_STDERR_BYTES
        )
      : undefined;
  const nextEnvelope =
    typeof trace.envelopeError === 'string' && trace.envelopeError.length > 0
      ? sliceUtf8Bytes(
          redactPromptInText(trace.envelopeError, prompt, { ...opts, maxBytes: MAX_ENVELOPE_ERROR_BYTES }),
          MAX_ENVELOPE_ERROR_BYTES
        )
      : undefined;
  const hasLifecycle = trace.lifecycle !== undefined && trace.lifecycle !== null;
  const nextLifecycle = hasLifecycle ? sanitizeLifecycleMetadata(trace.lifecycle) : null;
  const stderrChanged = nextStderr !== undefined && nextStderr !== trace.stderr;
  const envelopeChanged = nextEnvelope !== undefined && nextEnvelope !== trace.envelopeError;
  if (!stderrChanged && !envelopeChanged && !hasLifecycle) {
    return trace;
  }
  const cloned = {
    ...trace,
    ...(nextStderr !== undefined ? { stderr: nextStderr } : {}),
    ...(nextEnvelope !== undefined ? { envelopeError: nextEnvelope } : {})
  };
  if (nextLifecycle) {
    cloned.lifecycle = nextLifecycle;
  } else if (hasLifecycle) {
    delete cloned.lifecycle;
  }
  return cloned;
}

function buildSanitizedCauseFallback(error, prompt = '') {
  if (!error || typeof error !== 'object') {
    return error;
  }
  const opts = { minPromptLength: 8 };
  const rawMsg = typeof error.message === 'string' ? error.message : String(error.message ?? error);
  const cleanMsg = redactPromptInText(rawMsg, prompt, { ...opts, maxBytes: MAX_CLI_ERROR_MESSAGE_BYTES });
  const clone = new Error(cleanMsg);
  if (typeof error.name === 'string' && error.name) clone.name = error.name;
  if (typeof error.code === 'string' && error.code.trim()) clone.code = error.code.trim();
  clone.exitCode = normalizeExitCode(error.exitCode);
  clone.signal = normalizeSignalName(error.signal);
  clone.stderr =
    typeof error.stderr === 'string' && error.stderr.length > 0
      ? sliceUtf8Bytes(
          redactPromptInText(error.stderr, prompt, { ...opts, maxBytes: MAX_CLI_STDERR_BYTES }),
          MAX_CLI_STDERR_BYTES
        )
      : '';
  if (typeof error.envelopeError === 'string' && error.envelopeError.trim()) {
    clone.envelopeError = sliceUtf8Bytes(
      redactPromptInText(error.envelopeError, prompt, { ...opts, maxBytes: MAX_ENVELOPE_ERROR_BYTES }),
      MAX_ENVELOPE_ERROR_BYTES
    );
  }
  if (error.trace && typeof error.trace === 'object') {
    clone.trace = sanitizeTraceDiagnostics(error.trace, prompt);
  }
  const lifecycle = sanitizeLifecycleMetadata(error.lifecycle ?? error.trace?.lifecycle);
  if (lifecycle) {
    clone.lifecycle = lifecycle;
  }
  return clone;
}

function sanitizeErrorDiagnostics(error, prompt = '', externalReason = undefined, depth = 0, seen = new Set()) {
  if (!error || typeof error !== 'object' || seen.has(error)) {
    return { mutatedClean: true };
  }
  if (externalReason !== undefined && externalReason !== null && error === externalReason) {
    return { mutatedClean: true };
  }
  seen.add(error);
  const opts = { minPromptLength: 8 };
  let mutatedClean = true;

  if (typeof error.message === 'string' && error.message.length > 0) {
    const cleanMsg = redactPromptInText(error.message, prompt, {
      ...opts,
      maxBytes: MAX_CLI_ERROR_MESSAGE_BYTES
    });
    if (cleanMsg !== error.message && !tryAssignDiagnosticProp(error, 'message', cleanMsg)) {
      mutatedClean = false;
    }
  }
  if (typeof error.stderr === 'string' && error.stderr.length > 0) {
    const cleanStderr = sliceUtf8Bytes(
      redactPromptInText(error.stderr, prompt, { ...opts, maxBytes: MAX_CLI_STDERR_BYTES }),
      MAX_CLI_STDERR_BYTES
    );
    if (cleanStderr !== error.stderr && !tryAssignDiagnosticProp(error, 'stderr', cleanStderr)) {
      mutatedClean = false;
    }
  }
  if (typeof error.envelopeError === 'string' && error.envelopeError.length > 0) {
    const cleanEnv = sliceUtf8Bytes(
      redactPromptInText(error.envelopeError, prompt, { ...opts, maxBytes: MAX_ENVELOPE_ERROR_BYTES }),
      MAX_ENVELOPE_ERROR_BYTES
    );
    if (cleanEnv !== error.envelopeError && !tryAssignDiagnosticProp(error, 'envelopeError', cleanEnv)) {
      mutatedClean = false;
    }
  }
  if (error.trace && typeof error.trace === 'object') {
    const cleanTrace = sanitizeTraceDiagnostics(error.trace, prompt);
    if (cleanTrace !== error.trace && !tryAssignDiagnosticProp(error, 'trace', cleanTrace)) {
      mutatedClean = false;
    }
  }
  if (
    depth < 2 &&
    error.inheritCauseDiagnostics !== false &&
    error.cause &&
    typeof error.cause === 'object' &&
    !(externalReason !== undefined && externalReason !== null && error.cause === externalReason)
  ) {
    const nested = sanitizeErrorDiagnostics(error.cause, prompt, externalReason, depth + 1, seen);
    if (!nested.mutatedClean) {
      const fallbackCause = buildSanitizedCauseFallback(error.cause, prompt);
      if (!tryAssignDiagnosticProp(error, 'cause', fallbackCause)) {
        mutatedClean = false;
      }
    }
  }
  return { mutatedClean };
}

function attachDrainDiagnostics(targetErr, drainResult, context = {}, externalSignal = null) {
  if (!targetErr || typeof targetErr !== 'object') {
    return targetErr;
  }
  const { drainStatus, drainDurationMs, settledError } = drainResult;
  if (typeof drainStatus === 'string' && VALID_DRAIN_STATUSES.has(drainStatus)) {
    targetErr.drainStatus = drainStatus;
  }
  if (typeof drainDurationMs === 'number' && Number.isFinite(drainDurationMs) && drainDurationMs >= 0) {
    targetErr.drainDurationMs = drainDurationMs;
  }
  const externalReason = externalSignal?.reason;
  const isExternalReasonItself =
    externalReason !== undefined && externalReason !== null && settledError === externalReason;
  const prompt = resolveAttemptPrompt(context);
  const { mutatedClean } =
    settledError && typeof settledError === 'object' && !isExternalReasonItself
      ? sanitizeErrorDiagnostics(settledError, prompt, externalReason)
      : { mutatedClean: true };
  if (settledError !== undefined && settledError !== null && settledError !== targetErr) {
    targetErr.cause =
      mutatedClean || isExternalReasonItself ? settledError : buildSanitizedCauseFallback(settledError, prompt);
  }
  if (drainStatus === 'drain_expired' || isExternalReasonItself) {
    if (isExternalReasonItself) {
      Object.defineProperty(targetErr, 'inheritCauseDiagnostics', {
        value: false,
        enumerable: false,
        configurable: true
      });
    }
    targetErr.exitCode = null;
    targetErr.signal = null;
    targetErr.stderr = '';
    delete targetErr.lifecycle;
    delete targetErr.trace;
    delete targetErr.envelopeError;
    return targetErr;
  }

  const allowSettledCause =
    settledError?.inheritCauseDiagnostics !== false &&
    !(externalReason !== undefined && externalReason !== null && settledError?.cause === externalReason);
  if (!allowSettledCause) {
    Object.defineProperty(targetErr, 'inheritCauseDiagnostics', {
      value: false,
      enumerable: false,
      configurable: true
    });
  }
  targetErr.exitCode = normalizeExitCode(pickOwnOrCause(settledError, 'exitCode', allowSettledCause));
  targetErr.signal = normalizeSignalName(pickOwnOrCause(settledError, 'signal', allowSettledCause));

  const rawStderr =
    (typeof settledError?.stderr === 'string' && settledError.stderr) ||
    (typeof settledError?.trace?.stderr === 'string' && settledError.trace.stderr) ||
    (allowSettledCause && typeof settledError?.cause?.stderr === 'string' ? settledError.cause.stderr : '');
  targetErr.stderr = rawStderr
    ? sliceUtf8Bytes(
        redactPromptInText(rawStderr, prompt, { minPromptLength: 8, maxBytes: MAX_CLI_STDERR_BYTES }),
        MAX_CLI_STDERR_BYTES
      )
    : '';

  const settledTrace = settledError?.trace ?? (allowSettledCause ? settledError?.cause?.trace : undefined);
  const sanitizedLifecycle = sanitizeLifecycleMetadata(
    settledError?.lifecycle ??
      settledTrace?.lifecycle ??
      (allowSettledCause ? settledError?.cause?.lifecycle ?? settledError?.cause?.trace?.lifecycle : undefined)
  );
  if (sanitizedLifecycle) {
    targetErr.lifecycle = sanitizedLifecycle;
  }

  const rawEnvelope =
    [
      settledError?.envelopeError,
      settledTrace?.envelopeError,
      ...(allowSettledCause ? [settledError?.cause?.envelopeError] : [])
    ].find((v) => typeof v === 'string' && v.trim()) || '';
  const sanitizedEnvelope = rawEnvelope
    ? sliceUtf8Bytes(
        redactPromptInText(rawEnvelope, prompt, { minPromptLength: 8, maxBytes: MAX_ENVELOPE_ERROR_BYTES }),
        MAX_ENVELOPE_ERROR_BYTES
      )
    : '';
  if (sanitizedEnvelope) {
    targetErr.envelopeError = sanitizedEnvelope;
  }

  if (settledTrace && typeof settledTrace === 'object') {
    const cleanTrace = sanitizeTraceDiagnostics(settledTrace, prompt);
    targetErr.trace =
      sanitizedLifecycle && !cleanTrace.lifecycle
        ? { ...cleanTrace, lifecycle: sanitizedLifecycle }
        : cleanTrace;
  }
  return targetErr;
}

function buildClassifiedErrorOptions(harness, error, context = {}) {
  const prompt = resolveAttemptPrompt(context);
  const externalReason = context?.signal?.reason;
  const isErrObj = Boolean(error && typeof error === 'object');
  const isSameExternalReason =
    externalReason !== undefined && externalReason !== null && error === externalReason;
  const { mutatedClean } =
    isErrObj && !isSameExternalReason
      ? sanitizeErrorDiagnostics(error, prompt, externalReason)
      : { mutatedClean: true };
  const allowCause =
    error?.inheritCauseDiagnostics !== false &&
    !(externalReason !== undefined && externalReason !== null && error?.cause === externalReason);

  const rawStderrValue =
    typeof error?.stderr === 'string'
      ? error.stderr
      : allowCause && typeof error?.cause?.stderr === 'string'
        ? error.cause.stderr
        : '';
  const stderr = rawStderrValue
    ? sliceUtf8Bytes(
        redactPromptInText(rawStderrValue, prompt, { minPromptLength: 8, maxBytes: MAX_CLI_STDERR_BYTES }),
        MAX_CLI_STDERR_BYTES
      )
    : '';

  const rawEnvelopeValue =
    (typeof error?.envelopeError === 'string' && error.envelopeError.trim() ? error.envelopeError : '') ||
    (allowCause && typeof error?.cause?.envelopeError === 'string' && error.cause.envelopeError.trim()
      ? error.cause.envelopeError
      : '');
  const envelopeError = rawEnvelopeValue
    ? sliceUtf8Bytes(
        redactPromptInText(rawEnvelopeValue, prompt, { minPromptLength: 8, maxBytes: MAX_ENVELOPE_ERROR_BYTES }),
        MAX_ENVELOPE_ERROR_BYTES
      )
    : '';

  const rawTrace = error?.trace ?? (allowCause ? error?.cause?.trace : null) ?? null;
  const trace = rawTrace && typeof rawTrace === 'object' ? sanitizeTraceDiagnostics(rawTrace, prompt) : null;
  const lifecycle =
    error?.lifecycle ??
    trace?.lifecycle ??
    (allowCause ? error?.cause?.lifecycle ?? error?.cause?.trace?.lifecycle : null) ??
    null;

  return {
    harness,
    seatId: context.seatId,
    model: context.model,
    exitCode: normalizeExitCode(pickOwnOrCause(error, 'exitCode', allowCause)),
    signal: normalizeSignalName(pickOwnOrCause(error, 'signal', allowCause)),
    stderr,
    ...(envelopeError ? { envelopeError } : {}),
    trace,
    lifecycle,
    drainStatus: error?.drainStatus ?? (allowCause ? error?.cause?.drainStatus : undefined),
    drainDurationMs: error?.drainDurationMs ?? (allowCause ? error?.cause?.drainDurationMs : undefined),
    ...(allowCause ? {} : { inheritCauseDiagnostics: false }),
    ...(typeof error?.code === 'string' && error.code.trim() ? { code: error.code.trim() } : {}),
    ...(error?._latchedTimeout === true ? { _latchedTimeout: true } : {}),
    cause: !isErrObj || mutatedClean || isSameExternalReason ? error : buildSanitizedCauseFallback(error, prompt)
  };
}

function settledIsAbort(error, externalSignal, firstCause) {
  if (firstCause === 'timeout') {
    return false;
  }
  if (externalSignal?.aborted) {
    return true;
  }
  return Boolean(error && typeof error === 'object' && (error.name === 'AbortError' || error.code === 'ABORT_ERR'));
}
