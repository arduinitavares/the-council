/**
 * @fileoverview High-Level Debate Loop Coordinator for The Council.
 * ESM Module (Node >= 22). Zero external dependencies.
 *
 * Orchestrates:
 * 1. Roster initialization and dynamic seat registration.
 * 2. Discovery phase with clarification question/answer broadcasting.
 * 3. Deliberation rounds loop:
 *    - Round start (`BEGIN_ROUND`).
 *    - Seat proof collection via harness adapters with real-time observer telemetry (`SEAT_TELEMETRY`).
 *    - Seat fault handling, bounded retry (`RETRY_SEAT`), and excusal (`EXCUSE_SEAT`) preserving completed turns.
 *    - Proof judging transition (`START_JUDGING`).
 *    - Judge proof auditing and proof-bound candidate synthesis (`JUDGE_AUDIT_AND_SYNTHESIZE`).
 *    - Voting (`CAST_VOTE`) with proof citations and objection tracking.
 *    - Round evaluation (`EVALUATE_ROUND`) resolving consensus, dissent report, or round iteration.
 * 4. Deterministic state snapshots and event emissions via `CouncilTelemetryEmitter`.
 */

import { createInitialCouncilState, activeSeats } from '../machine/state.js';
import { transitionCouncil } from '../machine/reducer.js';
import { validateProof } from '../proofs/validator.js';
import { createTelemetryEmitter } from '../telemetry/emitter.js';
import { resolveConfig } from './config.js';
import { HarnessError, InvalidResponseError } from '../harness/adapter.js';
import { MockAdapter } from '../harness/mock.js';
import { downshiftModel } from '../harness/cli-runner.js';

/**
 * Resolves the effective seat configuration for the VOTING phase.
 * Defaults tools to 'none' unless votingTools is explicitly set.
 * Downshifts high/max reasoning effort models unless preserveVotingEffort is true or votingModel is set.
 * Caps voting timeout to Math.min(seat.timeoutMs || config.timeoutMs || 240000, seat.votingTimeoutMs || config.votingTimeoutMs || 90000).
 *
 * @param {Object} seat
 * @param {Object} [engineConfig={}]
 * @returns {Object}
 */
export function resolveVotingSeatConfig(seat, engineConfig = {}) {
  const tools =
    seat.votingTools !== undefined
      ? seat.votingTools
      : (engineConfig.votingTools !== undefined ? engineConfig.votingTools : 'none');

  let model = seat.model;
  const preserveEffort =
    typeof seat.preserveVotingEffort === 'boolean'
      ? seat.preserveVotingEffort
      : (typeof engineConfig.preserveVotingEffort === 'boolean' ? engineConfig.preserveVotingEffort : false);

  if (seat.votingModel) {
    model = seat.votingModel;
  } else if (!preserveEffort) {
    const targetEffort = seat.votingReasoningEffort || engineConfig.votingReasoningEffort || 'low';
    model = downshiftModel(seat.model, targetEffort);
  }

  const baseTimeoutMs =
    seat.timeoutMs ||
    engineConfig.timeoutMs ||
    240000;
  const configuredVotingTimeoutMs =
    seat.votingTimeoutMs ||
    engineConfig.votingTimeoutMs ||
    90000;
  const totalSeatBudgetMs =
    seat.totalSeatBudgetMs ||
    seat.seatBudget ||
    engineConfig.totalSeatBudgetMs ||
    engineConfig.seatBudget;
  const rawVotingTimeoutMs = Math.min(baseTimeoutMs, configuredVotingTimeoutMs);
  const votingTimeoutMs =
    typeof totalSeatBudgetMs === 'number' && totalSeatBudgetMs > 0
      ? Math.min(rawVotingTimeoutMs, totalSeatBudgetMs)
      : rawVotingTimeoutMs;

  return {
    ...seat,
    model,
    tools,
    votingTimeoutMs
  };
}

/**
 * Concurrently maps an array of items with a worker pool limit.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapConcurrent(items, limit, fn) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  const results = new Array(items.length);
  let nextIndex = 0;
  const poolLimit = Math.max(1, Math.min(limit || items.length, items.length));
  const workers = new Array(poolLimit).fill(0).map(async () => {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export class CouncilEngine {
  /**
   * @param {Object} [config={}] - Council configuration object.
   * @param {Object} [options={}]
   * @param {import('../telemetry/emitter.js').CouncilTelemetryEmitter} [options.telemetry] - Custom emitter.
   * @param {(harnessType: string) => Object} [options.harnessResolver] - Function resolving harness adapter.
   * @param {Object} [options.harnessRegistry] - Registry resolving harness adapter.
   * @param {AbortSignal} [options.signal] - Optional cancellation signal.
   */
  constructor(config = {}, options = {}) {
    this.config = resolveConfig(config);
    this.telemetry = options.telemetry || createTelemetryEmitter();
    if (typeof options.harnessResolver === 'function') {
      this.harnessResolver = options.harnessResolver;
    } else if (options.harnessRegistry && typeof options.harnessRegistry.get === 'function') {
      this.harnessResolver = (type) => options.harnessRegistry.get(type);
    } else {
      this.harnessResolver = this._defaultHarnessResolver.bind(this);
    }
    this.signal = options.signal || null;
    this.state = createInitialCouncilState({
      ...this.config,
      seats: [],
      clarifications: [],
      maxClarificationBatches: Math.max(
        this.config.maxClarificationBatches,
        Array.isArray(this.config.clarifications) ? this.config.clarifications.length : 0
      )
    });
    this._configClarificationsPublished = false;
    this._publishedConfigClarificationCount = 0;
    this.aborted = Boolean(this.signal?.aborted);
    this._defaultMockAdapter = null;

    if (this.signal) {
      this.signal.addEventListener('abort', () => {
        this.aborted = true;
      });
    }
  }

  /**
   * Default harness fallback using MockAdapter.
   * @private
   */
  _defaultHarnessResolver(harnessType) {
    if (!this._defaultMockAdapter) {
      this._defaultMockAdapter = new MockAdapter({ name: harnessType || 'mock' });
    }
    return this._defaultMockAdapter;
  }

  /**
   * Transitions state machine, verifies guard check, and emits telemetry snapshot.
   * @param {Object} event
   * @returns {Object} next CouncilState
   */
  _step(event, throwOnError = false) {
    const prevState = this.state;
    const nextState = transitionCouncil(prevState, event);
    this.state = nextState;

    // Emit deterministic transition snapshot
    this.telemetry.emitStateTransition(event, nextState);

    if (!nextState.lastTransition.ok) {
      const errorMsg = `State transition guard rejected event ${event.type}: ${nextState.lastTransition.message}`;
      try {
        if (typeof this.telemetry.emitGuardRejected === 'function') {
          this.telemetry.emitGuardRejected({ event, message: errorMsg, state: nextState });
        } else if (typeof this.telemetry._safeEmit === 'function') {
          this.telemetry._safeEmit('guard_rejected', { event, message: errorMsg, state: nextState });
        } else {
          this.telemetry.emit('guard_rejected', { event, message: errorMsg, state: nextState });
        }
      } catch {
        // Isolate observer failures on custom telemetry implementations
      }
      if (throwOnError) {
        throw new Error(errorMsg);
      }
    }
    return nextState;
  }

  /**
   * Initializes dynamic seat roster via ADD_SEAT transitions.
   */
  initRoster() {
    if (!this.config.seats || !Array.isArray(this.config.seats)) return;
    for (const seat of this.config.seats) {
      if (!this.state.seats.some((s) => s.id === seat.id)) {
        const seatTools = seat.tools || this.config.tools || 'read-only';
        const seatTimeoutMs = typeof seat.timeoutMs === 'number' && seat.timeoutMs > 0
          ? seat.timeoutMs
          : (typeof this.config.timeoutMs === 'number' && this.config.timeoutMs > 0 ? this.config.timeoutMs : undefined);
        const seatTotalBudgetMs = typeof seat.totalSeatBudgetMs === 'number' && seat.totalSeatBudgetMs > 0
          ? seat.totalSeatBudgetMs
          : (typeof seat.seatBudget === 'number' && seat.seatBudget > 0
              ? seat.seatBudget
              : (typeof this.config.totalSeatBudgetMs === 'number' && this.config.totalSeatBudgetMs > 0
                  ? this.config.totalSeatBudgetMs
                  : (typeof this.config.seatBudget === 'number' && this.config.seatBudget > 0
                      ? this.config.seatBudget
                      : (seatTimeoutMs ? seatTimeoutMs * 2 : undefined))));
        const seatVotingTimeoutMs = typeof seat.votingTimeoutMs === 'number' && seat.votingTimeoutMs > 0
          ? seat.votingTimeoutMs
          : (typeof this.config.votingTimeoutMs === 'number' && this.config.votingTimeoutMs > 0 ? this.config.votingTimeoutMs : undefined);
        const seatVotingTools = seat.votingTools !== undefined ? seat.votingTools : this.config.votingTools;
        const seatPreserveVotingEffort = typeof seat.preserveVotingEffort === 'boolean'
          ? seat.preserveVotingEffort
          : this.config.preserveVotingEffort;
        const seatVotingReasoningEffort = seat.votingReasoningEffort || this.config.votingReasoningEffort;
        const seatVotingModel = seat.votingModel;
        const seatDisableHooks = seat.disableHooks !== undefined ? seat.disableHooks : this.config.disableHooks;
        const seatIgnoreUserConfig = seat.ignoreUserConfig !== undefined ? seat.ignoreUserConfig : this.config.ignoreUserConfig;
        const seatCwd = seat.cwd !== undefined ? seat.cwd : this.config.cwd;
        this._step({
          type: 'ADD_SEAT',
          seat: {
            id: seat.id,
            harness: seat.harness,
            model: seat.model,
            soul: typeof seat.soul === 'object' && seat.soul !== null && seat.soul.toJSON ? seat.soul.toJSON() : seat.soul,
            tools: seatTools,
            ...(seatTimeoutMs !== undefined ? { timeoutMs: seatTimeoutMs } : {}),
            ...(seatTotalBudgetMs !== undefined ? { totalSeatBudgetMs: seatTotalBudgetMs } : {}),
            ...(seatVotingTimeoutMs !== undefined ? { votingTimeoutMs: seatVotingTimeoutMs } : {}),
            ...(seatVotingTools !== undefined ? { votingTools: seatVotingTools } : {}),
            ...(seatPreserveVotingEffort ? { preserveVotingEffort: true } : {}),
            ...(seatVotingReasoningEffort ? { votingReasoningEffort: seatVotingReasoningEffort } : {}),
            ...(seatVotingModel ? { votingModel: seatVotingModel } : {}),
            ...(typeof seatDisableHooks === 'boolean' ? { disableHooks: seatDisableHooks } : {}),
            ...(typeof seatIgnoreUserConfig === 'boolean' ? { ignoreUserConfig: seatIgnoreUserConfig } : {}),
            ...(typeof seatCwd === 'string' && seatCwd.trim() ? { cwd: seatCwd.trim() } : {})
          }
        });
      }
    }
  }

  /**
   * Runs Discovery phase (Clarifications) if provided.
   * @param {Array<{ answer?: string, label?: string, source?: string, text?: string } | string>} [clarifications=[]]
   */
  async runDiscovery(clarifications = []) {
    if (this.aborted || this.isCompleted()) return;

    const extra = Array.isArray(clarifications) ? clarifications : [];
    const totalConfigItems = Array.isArray(this.config.clarifications) ? this.config.clarifications.length : 0;
    const remainingConfigItems =
      !this._configClarificationsPublished && totalConfigItems > this._publishedConfigClarificationCount
        ? this.config.clarifications.slice(this._publishedConfigClarificationCount)
        : [];
    const itemsToPublish =
      clarifications === this.config.clarifications
        ? remainingConfigItems
        : [...remainingConfigItems, ...extra];

    if (!itemsToPublish || itemsToPublish.length === 0) return;

    for (let i = 0; i < itemsToPublish.length; i++) {
      if (this.aborted || this.isCompleted()) break;
      if (this.state.clarificationBatch >= this.state.maxClarificationBatches) break;
      const item = itemsToPublish[i];
      let answer;
      let extraMeta = {};
      if (typeof item === 'object' && item !== null) {
        if (typeof item.answer === 'string' && item.answer.trim()) {
          answer = item.answer.trim();
        } else if (typeof item.label === 'string' && typeof item.text === 'string') {
          answer = `[${item.label.trim()}] (Source: ${String(item.source || '').trim()}): ${item.text.trim()}`;
        } else {
          answer = String(item);
        }
        if (Number.isInteger(item.batch) && item.batch >= 1) extraMeta.batch = item.batch;
        if (typeof item.question === 'string' && item.question.trim()) extraMeta.question = item.question.trim();
        if (typeof item.label === 'string' && item.label.trim()) extraMeta.label = item.label.trim();
        if (typeof item.source === 'string' && item.source.trim()) extraMeta.source = item.source.trim();
        if (typeof item.text === 'string' && item.text.trim()) extraMeta.text = item.text.trim();
      } else {
        answer = String(item);
      }
      this._step({
        type: 'START_CLARIFYING'
      });
      if (!this.state.lastTransition?.ok) break;
      this._step({
        type: 'PUBLISH_CLARIFICATION',
        answer,
        ...extraMeta
      });
      if (!this.state.lastTransition?.ok) break;
      if (i < remainingConfigItems.length) {
        this._publishedConfigClarificationCount += 1;
        if (this._publishedConfigClarificationCount >= totalConfigItems) {
          this._configClarificationsPublished = true;
        }
      } else if (totalConfigItems === 0) {
        this._configClarificationsPublished = true;
      }
    }
  }

  /**
   * Determines whether an error should be retried.
   * Errors that explicitly declare `isRetryable: false` (e.g. model policy violations,
   * authentication failures, non-zero CLI exits) are not retried.
   * @param {unknown} error
   * @returns {boolean}
   */
  _isRetryableError(error) {
    return !(error && typeof error === 'object' && error.isRetryable === false);
  }

  /**
   * Classifies a fault error into 'fault_quota', 'fault_timeout', or 'fault'.
   * @param {unknown} error
   * @returns {'fault_quota' | 'fault_timeout' | 'fault'}
   */
  _classifyFaultStatus(error) {
    if (error && typeof error === 'object') {
      if (error.isQuotaFault === true || error.name === 'QuotaExhaustionError') {
        return 'fault_quota';
      }
      if (error.name === 'TimeoutError' || typeof error.timeoutMs === 'number' || error.code === 'ETIMEDOUT') {
        return 'fault_timeout';
      }
      if (error.isQuotaFault === false) {
        return 'fault';
      }
    }
    const msg = error instanceof Error ? error.message : String(error || '');
    const stderr = error && typeof error === 'object' && typeof error.stderr === 'string' ? error.stderr : '';
    const combined = `${msg}\n${stderr}`;
    if (/timed?\s*out/i.test(combined)) {
      return 'fault_timeout';
    }
    if (/\b429\b|\bquota\b|rate[\s_-]*limit|pool[\s_]+exhausted|resource_exhausted/i.test(combined)) {
      return 'fault_quota';
    }
    return 'fault';
  }

  /**
   * Resolves the canonical HarnessError class name for a fault.
   * @param {unknown} error
   * @returns {'TimeoutError' | 'QuotaExhaustionError' | 'HarnessExecutionError' | 'InvalidResponseError' | 'AuthenticationError' | 'HarnessError'}
   */
  _classifyErrorClass(error) {
    const knownClasses = new Set([
      'TimeoutError',
      'QuotaExhaustionError',
      'HarnessExecutionError',
      'InvalidResponseError',
      'AuthenticationError',
      'HarnessError'
    ]);
    if (error instanceof HarnessError && typeof error.name === 'string' && knownClasses.has(error.name)) {
      return /** @type {any} */ (error.name);
    }
    if (error && typeof error === 'object' && typeof error.name === 'string' && knownClasses.has(error.name)) {
      return /** @type {any} */ (error.name);
    }

    const status = this._classifyFaultStatus(error);
    if (status === 'fault_timeout') {
      return 'TimeoutError';
    }
    if (status === 'fault_quota') {
      return 'QuotaExhaustionError';
    }

    const msg = error instanceof Error ? error.message : String(error || '');
    const stderr = error && typeof error === 'object' && typeof error.stderr === 'string' ? error.stderr : '';
    const combined = `${msg}\n${stderr}`;
    if (/\b(?:401|403)\b|unauthorized|authentication\s+failed|invalid[\s_-]*api[\s_-]*key/i.test(combined)) {
      return 'AuthenticationError';
    }
    if (/invalid\s+proof|violates.*schema|failed\s+to\s+parse|candidate\s+guard|unknown\s+vote/i.test(combined)) {
      return 'InvalidResponseError';
    }
    return 'HarnessExecutionError';
  }

  /**
   * Formats a single-line fault error message including the error class, message,
   * non-zero CLI exit code, and a bounded stderr excerpt when present.
   * @param {unknown} error
   * @returns {string}
   */
  _formatFaultReason(error) {
    const errorClass = this._classifyErrorClass(error);
    const rawMsg = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim();
    let reason =
      rawMsg.startsWith(`[${errorClass}]`) || rawMsg.startsWith(`${errorClass}:`)
        ? rawMsg
        : `[${errorClass}] ${rawMsg}`;

    if (error && typeof error === 'object') {
      const exitCode = error.exitCode ?? error.cause?.exitCode ?? null;
      const stderrRaw =
        typeof error.stderr === 'string' && error.stderr.trim()
          ? error.stderr.trim()
          : typeof error.cause?.stderr === 'string' && error.cause.stderr.trim()
          ? error.cause.stderr.trim()
          : '';

      if (exitCode !== null && exitCode !== undefined && !reason.includes(`exit code ${exitCode}`)) {
        reason += ` (exit code ${exitCode})`;
      }
      if (stderrRaw) {
        const stderrSingleLine = stderrRaw.replace(/\s+/g, ' ').trim();
        const stderrExcerpt =
          stderrSingleLine.length > 240 ? `${stderrSingleLine.slice(0, 237)}...` : stderrSingleLine;
        if (stderrExcerpt && !reason.includes(stderrExcerpt)) {
          reason += ` — stderr: ${stderrExcerpt}`;
        }
      }
    }
    return reason;
  }

  /**
   * Handles a faulted seat per ADR 0003: bounded retry or excusal.
   * Preserves completed turns and locks open objections as preserved_excused.
   * @param {string} seatId
   * @param {Error|string} error
   * @param {Object} [options={}]
   * @param {number} [options.remainingBudget] - Remaining budget in ms
   * @param {number} [options.seatElapsedMs] - Total time elapsed for seat in phase
   * @param {number} [options.totalSeatBudgetMs] - Total seat budget allocated
   * @returns {{ action: string, retries?: number, lockedObjections?: number }}
   */
  handleSeatFault(seatId, error, options = {}) {
    const errorClass = this._classifyErrorClass(error);
    const reason = this._formatFaultReason(error);
    const faultStatus = this._classifyFaultStatus(error);
    const seat = (this.state.seats || []).find((s) => s.id === seatId);
    const retries = seat ? seat.retries : 0;
    const isRetryable = this._isRetryableError(error);
    const remainingBudget = options.remainingBudget;
    const totalSeatBudgetMs = options.totalSeatBudgetMs;
    const minViableBudgetMs =
      typeof totalSeatBudgetMs === 'number' && totalSeatBudgetMs > 0
        ? Math.min(5000, Math.floor(totalSeatBudgetMs * 0.1))
        : 0;
    const budgetExhausted =
      typeof remainingBudget === 'number' &&
      (remainingBudget <= 0 || remainingBudget < minViableBudgetMs);

    this.telemetry.emitSeatTelemetry(seatId, faultStatus, { reason, errorClass });
    this.telemetry.emitSeatFault(seatId, reason, retries);
    this._step({ type: 'SEAT_FAULT', seatId, reason, status: faultStatus, errorClass });

    if (seat && isRetryable && retries < this.config.maxRetriesPerSeat && !budgetExhausted) {
      this._step({ type: 'RETRY_SEAT', seatId });
      return { action: 'retried', retries: seat.retries + 1 };
    } else {
      let excuseReason;
      if (budgetExhausted) {
        excuseReason = `Exhausted total seat phase time budget (${options.seatElapsedMs ?? 0}ms >= ${options.totalSeatBudgetMs ?? 0}ms): ${reason}`;
      } else if (isRetryable && retries > 0) {
        excuseReason = `Exhausted retries (${retries}/${this.config.maxRetriesPerSeat}): ${reason}`;
      } else {
        excuseReason = reason;
      }
      this._step({ type: 'EXCUSE_SEAT', seatId, reason: excuseReason, errorClass });
      const locked = (this.state.objections || []).filter((o) => o.seatId === seatId && o.status === 'preserved_excused').length;
      this.telemetry.emitSeatExcused(seatId, excuseReason, locked);
      return { action: 'excused', lockedObjections: locked };
    }
  }

  /**
   * Executes a single deliberation round end-to-end.
   * @returns {Promise<{ round: number, phase: string, verdict: Object | null }>}
   */
  async runRound() {
    if (this.isCompleted()) {
      return { round: this.state.round, phase: this.state.phase, verdict: this.state.verdict };
    }

    if (
      !this._configClarificationsPublished &&
      this.state.phase === 'preflight' &&
      Array.isArray(this.config.clarifications) &&
      this.config.clarifications.length > 0
    ) {
      await this.runDiscovery(this.config.clarifications);
    }

    // 1. BEGIN_ROUND
    if (this.state.phase !== 'reviewing') {
      this._step({ type: 'BEGIN_ROUND' });
    }
    const currentRound = this.state.round;
    this.telemetry.emitRoundStart(currentRound, activeSeats(this.state).map((s) => s.id));

    // 2. PROOF COLLECTION (Active seats submit proofs concurrently)
    // 2. PROOF COLLECTION (Active seats submit proofs concurrently across Attempt 0 and retry waves)
    const active = activeSeats(this.state);
    const concurrencyLimit = this.config.maxConcurrentSeats || active.length;

    const delibSlots = active.map((seat, index) => {
      const harness = this.harnessResolver(seat.harness);
      const configSeat = (this.config.seats || []).find((s) => s.id === seat.id) || {};
      const mergedSeat = { ...configSeat, ...seat };
      const rawTurnTimeoutMs = mergedSeat.timeoutMs || this.config.timeoutMs;
      const initialBaseTimeoutMs =
        rawTurnTimeoutMs ||
        (typeof harness.resolveTimeoutMs === 'function' ? harness.resolveTimeoutMs(mergedSeat.model) : 240000);
      const retryBaseTimeoutMs =
        rawTurnTimeoutMs ||
        (typeof harness.resolveTimeoutMs === 'function' ? harness.resolveTimeoutMs(mergedSeat.model) : 60000);
      const seatBudgetMs =
        mergedSeat.totalSeatBudgetMs ||
        mergedSeat.seatBudget ||
        this.config.totalSeatBudgetMs ||
        this.config.seatBudget;
      const totalSeatBudgetMs = seatBudgetMs || retryBaseTimeoutMs * 2;
      const initialTurnTimeoutMs =
        typeof rawTurnTimeoutMs === 'number' && typeof seatBudgetMs === 'number'
          ? Math.min(rawTurnTimeoutMs, seatBudgetMs)
          : (typeof rawTurnTimeoutMs === 'number'
              ? rawTurnTimeoutMs
              : (typeof seatBudgetMs === 'number' && seatBudgetMs < initialBaseTimeoutMs
                  ? seatBudgetMs
                  : undefined));

      return {
        index,
        seat,
        harness,
        mergedSeat,
        currentSeatConfig: { ...mergedSeat },
        baseTimeoutMs: retryBaseTimeoutMs,
        totalSeatBudgetMs,
        turnTimeoutMs: initialTurnTimeoutMs,
        seatElapsedMs: 0,
        proofInput: null,
        error: null,
        skipped: false,
        excused: seat.status === 'excused',
        committed: false,
        needsValidation: false
      };
    });

    const validateDelibWave = () => {
      for (let i = 0; i < delibSlots.length; i++) {
        if (this.aborted || this.isCompleted()) break;
        const slot = delibSlots[i];
        if (!slot.needsValidation || slot.skipped || slot.excused || slot.committed || slot.error) continue;
        slot.needsValidation = false;

        const validation = validateProof(slot.proofInput);
        if (!validation.valid) {
          slot.error = new InvalidResponseError(
            `Invalid proof from seat ${slot.seat.id}: ${validation.errors.join('; ')}`,
            {
              harness: slot.seat.harness,
              seatId: slot.seat.id,
              model: slot.seat.model,
              validationErrors: validation.errors
            }
          );
          slot.proofInput = null;
          continue;
        }

        const submitEvent = {
          type: 'SUBMIT_PROOF',
          id: slot.proofInput.id,
          seatId: slot.seat.id,
          scope: slot.proofInput.scope,
          kind: slot.proofInput.kind,
          source: slot.proofInput.source,
          statement: slot.proofInput.statement
        };
        const dryNext = transitionCouncil(this.state, submitEvent);
        if (!dryNext.lastTransition?.ok) {
          this._step(submitEvent);
          slot.error = new InvalidResponseError(
            this.state.lastTransition?.message || `Guard rejected SUBMIT_PROOF from seat ${slot.seat.id}`,
            {
              harness: slot.seat.harness,
              seatId: slot.seat.id,
              model: slot.seat.model
            }
          );
          slot.proofInput = null;
        }
      }
    };

    await mapConcurrent(delibSlots, concurrencyLimit, async (slot) => {
      if (this.aborted || this.isCompleted() || slot.excused || slot.seat.status === 'excused') {
        slot.skipped = true;
        return;
      }

      this.telemetry.emitSeatTelemetry(slot.seat.id, 'thinking');
      const t0 = Date.now();
      try {
        let proofInput;
        if (typeof slot.harness.executeSeatProof === 'function') {
          proofInput = await slot.harness.executeSeatProof({
            seat: slot.seat,
            soul: slot.seat.soul,
            round: currentRound,
            phase: 'DELIBERATION',
            state: this.state,
            topic: this.state.topic,
            timeoutMs: slot.turnTimeoutMs,
            tools: slot.seat.tools,
            telemetry: this.telemetry
          });
        } else if (typeof slot.harness.executeSeat === 'function') {
          proofInput = await slot.harness.executeSeat({
            seat: slot.seat,
            soul: slot.seat.soul,
            round: currentRound,
            phase: 'DELIBERATION',
            state: this.state,
            topic: this.state.topic,
            timeoutMs: slot.turnTimeoutMs,
            tools: slot.seat.tools,
            telemetry: this.telemetry
          });
        } else {
          throw new Error(`Harness for "${slot.seat.harness}" does not implement executeSeatProof or executeSeat`);
        }
        slot.seatElapsedMs += Date.now() - t0;
        slot.proofInput = proofInput;
        slot.error = null;
        slot.needsValidation = true;
      } catch (err) {
        const elapsedMs =
          typeof err?.timeoutMs === 'number' && err.timeoutMs > 0
            ? err.timeoutMs
            : (typeof err?.trace?.durationMs === 'number' && err.trace.durationMs > 0
                ? err.trace.durationMs
                : Date.now() - t0);
        slot.seatElapsedMs += elapsedMs;
        slot.proofInput = null;
        slot.error = err;
        slot.needsValidation = false;
      }
    });

    if (!this.isCompleted() && !this.aborted) {
      validateDelibWave();
    }

    const runDelibRetryWaves = async () => {
      while (!this.isCompleted() && !this.aborted) {
        const faultedSlots = delibSlots.filter((s) => s.error && !s.excused && !s.skipped && !s.committed);
        if (faultedSlots.length === 0) break;

        const retryBatch = [];
        for (const slot of faultedSlots) {
          if (this.isCompleted() || this.aborted) break;
          const liveSeat = (this.state.seats || []).find((s) => s.id === slot.seat.id);
          if (!liveSeat || liveSeat.status === 'excused') {
            slot.excused = true;
            slot.error = null;
            continue;
          }

          const remainingBudget = slot.totalSeatBudgetMs - slot.seatElapsedMs;
          const isTimeout =
            this._classifyFaultStatus(slot.error) === 'fault_timeout' ||
            this._classifyErrorClass(slot.error) === 'TimeoutError';

          const faultRes = this.handleSeatFault(slot.seat.id, slot.error, {
            remainingBudget,
            seatElapsedMs: slot.seatElapsedMs,
            totalSeatBudgetMs: slot.totalSeatBudgetMs
          });
          slot.error = null;

          if (this.isCompleted() || this.aborted) {
            break;
          }
          if (faultRes.action === 'excused') {
            slot.excused = true;
            continue;
          }

          slot.turnTimeoutMs = Math.min(slot.baseTimeoutMs, 90000, Math.max(1, remainingBudget));
          slot.currentSeatConfig = {
            ...slot.currentSeatConfig,
            retries: typeof faultRes.retries === 'number' ? faultRes.retries : (liveSeat.retries || 0) + 1,
            ...(isTimeout ? { tools: 'none' } : {})
          };
          retryBatch.push(slot);
        }

        if (this.isCompleted() || this.aborted || retryBatch.length === 0) {
          break;
        }

        await mapConcurrent(retryBatch, concurrencyLimit, async (slot) => {
          if (this.aborted || this.isCompleted() || slot.excused) {
            return;
          }

          this.telemetry.emitSeatTelemetry(slot.seat.id, 'thinking');
          const retryT0 = Date.now();
          try {
            let proofInput;
            if (typeof slot.harness.executeSeatProof === 'function') {
              proofInput = await slot.harness.executeSeatProof({
                seat: slot.currentSeatConfig,
                soul: slot.currentSeatConfig.soul,
                round: currentRound,
                phase: 'DELIBERATION',
                state: this.state,
                topic: this.state.topic,
                timeoutMs: slot.turnTimeoutMs,
                tools: slot.currentSeatConfig.tools,
                telemetry: this.telemetry
              });
            } else if (typeof slot.harness.executeSeat === 'function') {
              proofInput = await slot.harness.executeSeat({
                seat: slot.currentSeatConfig,
                soul: slot.currentSeatConfig.soul,
                round: currentRound,
                phase: 'DELIBERATION',
                state: this.state,
                topic: this.state.topic,
                timeoutMs: slot.turnTimeoutMs,
                tools: slot.currentSeatConfig.tools,
                telemetry: this.telemetry
              });
            }
            slot.seatElapsedMs += Date.now() - retryT0;
            slot.proofInput = proofInput;
            slot.error = null;
            slot.needsValidation = true;
          } catch (retryErr) {
            const retryDuration =
              typeof retryErr?.timeoutMs === 'number' && retryErr.timeoutMs > 0
                ? retryErr.timeoutMs
                : (typeof retryErr?.trace?.durationMs === 'number' && retryErr.trace.durationMs > 0
                    ? retryErr.trace.durationMs
                    : Date.now() - retryT0);
            slot.seatElapsedMs += retryDuration;
            slot.proofInput = null;
            slot.error = retryErr;
            slot.needsValidation = false;
          }
        });

        if (!this.isCompleted() && !this.aborted) {
          validateDelibWave();
        }
      }
    };

    // Resolve retry waves, then commit validated SUBMIT_PROOF transitions in strict roster order
    while (!this.isCompleted() && !this.aborted) {
      await runDelibRetryWaves();
      if (this.isCompleted() || this.aborted) break;

      let commitFaulted = false;
      for (let i = 0; i < delibSlots.length; i++) {
        if (this.isCompleted() || this.aborted) break;
        const slot = delibSlots[i];
        if (slot.skipped || slot.excused || slot.committed || !slot.proofInput) continue;
        const liveSeat = (this.state.seats || []).find((s) => s.id === slot.seat.id);
        if (!liveSeat || liveSeat.status === 'excused') continue;

        this._step({
          type: 'SUBMIT_PROOF',
          id: slot.proofInput.id,
          seatId: slot.seat.id,
          scope: slot.proofInput.scope,
          kind: slot.proofInput.kind,
          source: slot.proofInput.source,
          statement: slot.proofInput.statement
        });
        if (!this.state.lastTransition?.ok) {
          slot.error = new InvalidResponseError(
            this.state.lastTransition?.message || `Guard rejected SUBMIT_PROOF from seat ${slot.seat.id}`,
            {
              harness: slot.seat.harness,
              seatId: slot.seat.id,
              model: slot.seat.model
            }
          );
          slot.proofInput = null;
          commitFaulted = true;
          break;
        }
        slot.committed = true;
        this.telemetry.emitSeatTelemetry(slot.seat.id, 'proof_submitted');
        const latestProof = this.state.proofs[this.state.proofs.length - 1];
        this.telemetry.emitProofSubmitted(latestProof);
      }

      if (!commitFaulted) break;
    }

    if (this.isCompleted()) {
      return { round: currentRound, phase: this.state.phase, verdict: this.state.verdict };
    }

    // 3. JUDGING (Audit proofs and synthesize candidate)
    this._step({ type: 'START_JUDGING' });
    const judge = this.state.judge;
    this.telemetry.emitSeatTelemetry(judge.id, 'thinking');
    const judgeHarness = this.harnessResolver(judge.harness);
    const configJudge = this.config.judge || {};
    const mergedJudge = { ...configJudge, ...judge };
    const hasExplicitJudgeBudget =
      typeof configJudge._explicitJudgeBudget === 'boolean'
        ? configJudge._explicitJudgeBudget
        : Boolean(
            configJudge.totalSeatBudgetMs !== undefined ||
              configJudge.seatBudget !== undefined ||
              configJudge['seat-budget'] !== undefined ||
              judge.totalSeatBudgetMs !== undefined ||
              judge.seatBudget !== undefined
          );
    const hasExplicitJudgeTimeout =
      typeof configJudge._explicitJudgeTimeout === 'boolean'
        ? configJudge._explicitJudgeTimeout
        : Boolean(configJudge.timeoutMs !== undefined || configJudge.timeout !== undefined);
    const explicitJudgeTimeoutMs =
      configJudge.timeoutMs ?? configJudge.timeout ?? (hasExplicitJudgeTimeout ? judge.timeoutMs : undefined);
    const rawJudgeTimeoutMs = mergedJudge.timeoutMs || this.config.timeoutMs;
    const baseJudgeTimeoutMs =
      rawJudgeTimeoutMs ||
      (typeof judgeHarness.resolveTimeoutMs === 'function' ? judgeHarness.resolveTimeoutMs(mergedJudge.model) : 240000);
    const explicitGlobalSeatBudget =
      typeof this.config._explicitGlobalSeatBudget === 'boolean'
        ? this.config._explicitGlobalSeatBudget
        : Boolean(
            this.config.totalSeatBudgetMs &&
              (!this.config.timeoutMs || this.config.totalSeatBudgetMs !== this.config.timeoutMs * 2)
          );
    const explicitJudgeBudgetVal =
      mergedJudge.totalSeatBudgetMs ?? mergedJudge.seatBudget ?? configJudge['seat-budget'];
    const judgeBudgetMs =
      (hasExplicitJudgeBudget && typeof explicitJudgeBudgetVal === 'number' ? explicitJudgeBudgetVal : undefined) ||
      (hasExplicitJudgeTimeout && typeof explicitJudgeTimeoutMs === 'number' ? explicitJudgeTimeoutMs * 2 : undefined) ||
      (explicitGlobalSeatBudget ? this.config.totalSeatBudgetMs : undefined) ||
      (rawJudgeTimeoutMs ? rawJudgeTimeoutMs * 2 : (this.config.totalSeatBudgetMs || 480000));
    const minViableJudgeBudgetMs = Math.min(5000, Math.floor(judgeBudgetMs * 0.1));
    const initialJudgeTimeoutMs =
      typeof rawJudgeTimeoutMs === 'number'
        ? Math.min(rawJudgeTimeoutMs, judgeBudgetMs)
        : (judgeBudgetMs < baseJudgeTimeoutMs ? judgeBudgetMs : undefined);

    const roundProofs = this.state.proofs.filter((p) => p.round === currentRound || p.status === 'pending');
    const maxJudgeRetries = this.config.maxRetriesPerJudge ?? this.config.maxRetriesPerSeat ?? 1;
    let judgeExecuted = false;
    let judgeElapsedMs = 0;
    let currentJudgeConfig = { ...mergedJudge };
    let currentJudgeTimeoutMs = initialJudgeTimeoutMs;

    while (!judgeExecuted && !this.isCompleted() && !this.aborted) {
      const judgeT0 = Date.now();
      try {
        let synthesisResult;
        if (typeof judgeHarness.executeJudgeAuditAndSynthesis === 'function') {
          synthesisResult = await judgeHarness.executeJudgeAuditAndSynthesis({
            judge: currentJudgeConfig,
            round: currentRound,
            phase: 'JUDGE_AUDIT_SYNTHESIS',
            proofs: roundProofs,
            state: this.state,
            topic: this.state.topic,
            timeoutMs: currentJudgeTimeoutMs,
            tools: currentJudgeConfig.tools,
            telemetry: this.telemetry
          });
        } else if (typeof judgeHarness.executeJudge === 'function') {
          synthesisResult = await judgeHarness.executeJudge({
            judge: currentJudgeConfig,
            round: currentRound,
            phase: 'JUDGE_AUDIT_SYNTHESIS',
            proofs: roundProofs,
            state: this.state,
            topic: this.state.topic,
            timeoutMs: currentJudgeTimeoutMs,
            tools: currentJudgeConfig.tools,
            telemetry: this.telemetry
          });
        } else {
          throw new Error(`Harness for "${judge.harness}" does not implement executeJudgeAuditAndSynthesis or executeJudge`);
        }

        this._step({
          type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
          summary: synthesisResult ? synthesisResult.summary : undefined,
          proofDecisions: synthesisResult && synthesisResult.proofDecisions ? synthesisResult.proofDecisions : {},
          clauses: synthesisResult ? synthesisResult.clauses : undefined
        });

        if (!this.state.lastTransition.ok) {
          throw new InvalidResponseError(this.state.lastTransition.message, {
            harness: judge.harness,
            seatId: judge.id,
            model: judge.model
          });
        }

        judgeElapsedMs += Date.now() - judgeT0;
        judgeExecuted = true;
      } catch (err) {
        const attemptDuration =
          typeof err?.timeoutMs === 'number' && err.timeoutMs > 0
            ? err.timeoutMs
            : (typeof err?.trace?.durationMs === 'number' && err.trace.durationMs > 0
                ? err.trace.durationMs
                : Date.now() - judgeT0);
        judgeElapsedMs += attemptDuration;
        const remainingJudgeBudget = judgeBudgetMs - judgeElapsedMs;
        const judgeBudgetExhausted =
          remainingJudgeBudget <= 0 || remainingJudgeBudget < minViableJudgeBudgetMs;

        const errorClass = this._classifyErrorClass(err);
        const errorMsg = this._formatFaultReason(err);
        const faultStatus = this._classifyFaultStatus(err);
        const isTimeout = faultStatus === 'fault_timeout' || errorClass === 'TimeoutError';
        const isRetryable = this._isRetryableError(err);
        this.telemetry.emitSeatTelemetry(judge.id, faultStatus, { reason: errorMsg, errorClass });
        this._step({ type: 'JUDGE_FAULT', error: errorMsg, reason: errorMsg, status: faultStatus, errorClass });

        if (isRetryable && this.state.judge.retries < maxJudgeRetries && !judgeBudgetExhausted) {
          this._step({ type: 'RETRY_JUDGE' });
          currentJudgeConfig = {
            ...currentJudgeConfig,
            ...this.state.judge,
            ...(isTimeout ? { tools: 'none' } : { tools: currentJudgeConfig.tools })
          };
          currentJudgeTimeoutMs = Math.min(baseJudgeTimeoutMs, 90000, remainingJudgeBudget);
          this.telemetry.emitSeatTelemetry(judge.id, 'thinking');
        } else {
          const terminalReason = judgeBudgetExhausted
            ? `Exhausted total judge phase time budget (${judgeElapsedMs}ms >= ${judgeBudgetMs}ms): ${errorMsg}`
            : errorMsg;
          this._step({
            type: 'JUDGE_FAULT',
            error: terminalReason,
            reason: terminalReason,
            status: faultStatus,
            errorClass,
            terminal: true
          });
          this.telemetry.emitVerdict(this.state.verdict);
          break;
        }
      }
    }

    if (this.isCompleted()) {
      return { round: currentRound, phase: this.state.phase, verdict: this.state.verdict };
    }

    this.telemetry.emitCandidateSynthesized(this.state.candidate);

    // 4. VOTING (Active seats accept or object concurrently across Attempt 0 and retry waves)
    const voters = activeSeats(this.state);
    const voteConcurrencyLimit = this.config.maxConcurrentSeats || voters.length;

    const voteSlots = voters.map((seat, index) => {
      const seatHarness = this.harnessResolver(seat.harness);
      const configSeat = (this.config.seats || []).find((s) => s.id === seat.id) || {};
      const mergedSeat = { ...configSeat, ...seat };
      const votingSeat = resolveVotingSeatConfig(mergedSeat, this.config);
      const totalSeatBudgetMs =
        mergedSeat.totalSeatBudgetMs ||
        mergedSeat.seatBudget ||
        this.config.totalSeatBudgetMs ||
        this.config.seatBudget ||
        votingSeat.votingTimeoutMs * 2;
      const initialVoteTimeoutMs = Math.min(votingSeat.votingTimeoutMs, totalSeatBudgetMs);
      const effectiveVotingSeat = {
        ...seat,
        model: votingSeat.model,
        tools: votingSeat.tools !== undefined ? votingSeat.tools : 'none',
        votingTools: votingSeat.tools !== undefined ? votingSeat.tools : 'none',
        votingTimeoutMs: initialVoteTimeoutMs,
        ...(votingSeat.preserveVotingEffort !== undefined ? { preserveVotingEffort: votingSeat.preserveVotingEffort } : {})
      };

      return {
        index,
        seat,
        seatHarness,
        votingSeat,
        currentSeatConfig: effectiveVotingSeat,
        baseVoteTimeoutMs: votingSeat.votingTimeoutMs,
        totalSeatBudgetMs,
        turnTimeoutMs: initialVoteTimeoutMs,
        seatElapsedMs: 0,
        voteResult: null,
        error: null,
        skipped: false,
        excused: seat.status === 'excused',
        committed: false,
        needsValidation: false
      };
    });

    const validateVoteWave = () => {
      for (let i = 0; i < voteSlots.length; i++) {
        if (this.aborted || this.isCompleted()) break;
        const slot = voteSlots[i];
        if (!slot.needsValidation || slot.skipped || slot.excused || slot.committed || slot.error) continue;
        slot.needsValidation = false;

        const voteOutcome = slot.voteResult?.vote;
        if (voteOutcome !== 'accept' && voteOutcome !== 'object') {
          slot.error = new InvalidResponseError(
            `Unknown vote outcome "${voteOutcome}" from seat ${slot.seat.id}`,
            {
              harness: slot.seat.harness,
              seatId: slot.seat.id,
              model: slot.seat.model
            }
          );
          slot.voteResult = null;
          continue;
        }

        const castEvent =
          voteOutcome === 'accept'
            ? { type: 'CAST_VOTE', seatId: slot.seat.id, vote: 'accept' }
            : {
                type: 'CAST_VOTE',
                seatId: slot.seat.id,
                vote: 'object',
                reason: slot.voteResult.reason,
                proofId: slot.voteResult.proofId
              };
        const dryNext = transitionCouncil(this.state, castEvent);
        if (!dryNext.lastTransition?.ok) {
          this._step(castEvent);
          slot.error = new InvalidResponseError(
            this.state.lastTransition?.message || `Guard rejected CAST_VOTE from seat ${slot.seat.id}`,
            {
              harness: slot.seat.harness,
              seatId: slot.seat.id,
              model: slot.seat.model
            }
          );
          slot.voteResult = null;
        }
      }
    };

    await mapConcurrent(voteSlots, voteConcurrencyLimit, async (slot) => {
      if (this.aborted || this.isCompleted() || slot.excused || slot.seat.status === 'excused') {
        slot.skipped = true;
        return;
      }

      this.telemetry.emitSeatTelemetry(slot.seat.id, 'thinking');
      const t0 = Date.now();
      try {
        let voteResult;
        if (typeof slot.seatHarness.executeSeatVote === 'function') {
          voteResult = await slot.seatHarness.executeSeatVote({
            seat: slot.currentSeatConfig,
            soul: slot.seat.soul,
            candidate: this.state.candidate,
            round: currentRound,
            phase: 'VOTING',
            state: this.state,
            timeoutMs: slot.turnTimeoutMs,
            tools: slot.currentSeatConfig.tools,
            telemetry: this.telemetry
          });
        } else if (typeof slot.seatHarness.executeSeat === 'function') {
          voteResult = await slot.seatHarness.executeSeat({
            seat: slot.currentSeatConfig,
            soul: slot.seat.soul,
            candidate: this.state.candidate,
            round: currentRound,
            phase: 'VOTING',
            state: this.state,
            timeoutMs: slot.turnTimeoutMs,
            tools: slot.currentSeatConfig.tools,
            telemetry: this.telemetry
          });
        } else {
          throw new Error(`Harness for "${slot.seat.harness}" does not implement executeSeatVote or executeSeat`);
        }
        slot.seatElapsedMs += Date.now() - t0;
        slot.voteResult = voteResult;
        slot.error = null;
        slot.needsValidation = true;
      } catch (err) {
        const elapsedMs =
          typeof err?.timeoutMs === 'number' && err.timeoutMs > 0
            ? err.timeoutMs
            : (typeof err?.trace?.durationMs === 'number' && err.trace.durationMs > 0
                ? err.trace.durationMs
                : Date.now() - t0);
        slot.seatElapsedMs += elapsedMs;
        slot.voteResult = null;
        slot.error = err;
        slot.needsValidation = false;
      }
    });

    if (!this.isCompleted() && !this.aborted) {
      validateVoteWave();
    }

    const runVoteRetryWaves = async () => {
      while (!this.isCompleted() && !this.aborted) {
        const faultedSlots = voteSlots.filter((s) => s.error && !s.excused && !s.skipped && !s.committed);
        if (faultedSlots.length === 0) break;

        const retryBatch = [];
        for (const slot of faultedSlots) {
          if (this.isCompleted() || this.aborted) break;
          const liveSeat = (this.state.seats || []).find((s) => s.id === slot.seat.id);
          if (!liveSeat || liveSeat.status === 'excused') {
            slot.excused = true;
            slot.error = null;
            continue;
          }

          const remainingBudget = slot.totalSeatBudgetMs - slot.seatElapsedMs;
          const isTimeout =
            this._classifyFaultStatus(slot.error) === 'fault_timeout' ||
            this._classifyErrorClass(slot.error) === 'TimeoutError';

          const faultRes = this.handleSeatFault(slot.seat.id, slot.error, {
            remainingBudget,
            seatElapsedMs: slot.seatElapsedMs,
            totalSeatBudgetMs: slot.totalSeatBudgetMs
          });
          slot.error = null;

          if (this.isCompleted() || this.aborted) {
            break;
          }
          if (faultRes.action === 'excused') {
            slot.excused = true;
            continue;
          }

          slot.turnTimeoutMs = Math.min(slot.baseVoteTimeoutMs, 90000, Math.max(1, remainingBudget));
          const effectiveRetryTools = isTimeout
            ? 'none'
            : (slot.currentSeatConfig.tools !== undefined ? slot.currentSeatConfig.tools : 'none');
          slot.currentSeatConfig = {
            ...slot.currentSeatConfig,
            retries: typeof faultRes.retries === 'number' ? faultRes.retries : (liveSeat.retries || 0) + 1,
            tools: effectiveRetryTools,
            votingTools: effectiveRetryTools,
            votingTimeoutMs: slot.turnTimeoutMs
          };
          retryBatch.push(slot);
        }

        if (this.isCompleted() || this.aborted || retryBatch.length === 0) {
          break;
        }

        await mapConcurrent(retryBatch, voteConcurrencyLimit, async (slot) => {
          if (this.aborted || this.isCompleted() || slot.excused) {
            return;
          }

          this.telemetry.emitSeatTelemetry(slot.seat.id, 'thinking');
          const retryT0 = Date.now();
          try {
            let voteResult;
            if (typeof slot.seatHarness.executeSeatVote === 'function') {
              voteResult = await slot.seatHarness.executeSeatVote({
                seat: slot.currentSeatConfig,
                soul: slot.seat.soul,
                candidate: this.state.candidate,
                round: currentRound,
                phase: 'VOTING',
                state: this.state,
                timeoutMs: slot.turnTimeoutMs,
                tools: slot.currentSeatConfig.tools,
                telemetry: this.telemetry
              });
            } else if (typeof slot.seatHarness.executeSeat === 'function') {
              voteResult = await slot.seatHarness.executeSeat({
                seat: slot.currentSeatConfig,
                soul: slot.seat.soul,
                candidate: this.state.candidate,
                round: currentRound,
                phase: 'VOTING',
                state: this.state,
                timeoutMs: slot.turnTimeoutMs,
                tools: slot.currentSeatConfig.tools,
                telemetry: this.telemetry
              });
            }
            slot.seatElapsedMs += Date.now() - retryT0;
            slot.voteResult = voteResult;
            slot.error = null;
            slot.needsValidation = true;
          } catch (retryErr) {
            const retryDuration =
              typeof retryErr?.timeoutMs === 'number' && retryErr.timeoutMs > 0
                ? retryErr.timeoutMs
                : (typeof retryErr?.trace?.durationMs === 'number' && retryErr.trace.durationMs > 0
                    ? retryErr.trace.durationMs
                    : Date.now() - retryT0);
            slot.seatElapsedMs += retryDuration;
            slot.voteResult = null;
            slot.error = retryErr;
            slot.needsValidation = false;
          }
        });

        if (!this.isCompleted() && !this.aborted) {
          validateVoteWave();
        }
      }
    };

    // Resolve retry waves, then commit validated CAST_VOTE transitions in strict roster order
    while (!this.isCompleted() && !this.aborted) {
      await runVoteRetryWaves();
      if (this.isCompleted() || this.aborted) break;

      let commitFaulted = false;
      for (let i = 0; i < voteSlots.length; i++) {
        if (this.isCompleted() || this.aborted) break;
        const slot = voteSlots[i];
        if (slot.skipped || slot.excused || slot.committed || !slot.voteResult) continue;
        const liveSeat = (this.state.seats || []).find((s) => s.id === slot.seat.id);
        if (!liveSeat || liveSeat.status === 'excused') continue;

        if (slot.voteResult.vote === 'accept') {
          this._step({ type: 'CAST_VOTE', seatId: slot.seat.id, vote: 'accept' });
          if (!this.state.lastTransition?.ok) {
            slot.error = new InvalidResponseError(
              this.state.lastTransition?.message || `Guard rejected CAST_VOTE from seat ${slot.seat.id}`,
              {
                harness: slot.seat.harness,
                seatId: slot.seat.id,
                model: slot.seat.model
              }
            );
            slot.voteResult = null;
            commitFaulted = true;
            break;
          }
          slot.committed = true;
          this.telemetry.emitSeatTelemetry(slot.seat.id, 'accepted');
          this.telemetry.emitVoteCast(slot.seat.id, 'accept');
        } else if (slot.voteResult.vote === 'object') {
          this._step({
            type: 'CAST_VOTE',
            seatId: slot.seat.id,
            vote: 'object',
            reason: slot.voteResult.reason,
            proofId: slot.voteResult.proofId
          });
          if (!this.state.lastTransition?.ok) {
            slot.error = new InvalidResponseError(
              this.state.lastTransition?.message || `Guard rejected CAST_VOTE from seat ${slot.seat.id}`,
              {
                harness: slot.seat.harness,
                seatId: slot.seat.id,
                model: slot.seat.model
              }
            );
            slot.voteResult = null;
            commitFaulted = true;
            break;
          }
          slot.committed = true;
          this.telemetry.emitSeatTelemetry(slot.seat.id, 'objected');
          this.telemetry.emitVoteCast(slot.seat.id, 'object', slot.voteResult.reason, slot.voteResult.proofId);
          const latestObj = this.state.objections[this.state.objections.length - 1];
          this.telemetry.emitObjectionRaised(latestObj);
        }
      }

      if (!commitFaulted) break;
    }

    if (this.isCompleted()) {
      return { round: currentRound, phase: this.state.phase, verdict: this.state.verdict };
    }

    // 5. EVALUATE_ROUND
    this._step({ type: 'EVALUATE_ROUND' });
    if (this.state.verdict) {
      this.telemetry.emitVerdict(this.state.verdict);
    }

    return {
      round: currentRound,
      phase: this.state.phase,
      verdict: this.state.verdict
    };
  }

  /**
   * Runs the entire deliberation to completion.
   * @returns {Promise<{ ok: boolean, verdict: Object, state: Object, snapshots: Array, providerCalls: Array }>}
   */
  async run() {
    this.initRoster();

    if (!this._configClarificationsPublished && this.config.clarifications && this.config.clarifications.length > 0) {
      await this.runDiscovery(this.config.clarifications);
    }

    while (!this.isCompleted() && !this.aborted) {
      await this.runRound();
    }

    return {
      ok: Boolean(this.state.verdict && this.state.verdict.kind === 'Unanimous Consensus'),
      verdict: this.state.verdict,
      state: this.state,
      snapshots: this.telemetry.getSnapshots(),
      providerCalls: typeof this.telemetry.getProviderCalls === 'function' ? this.telemetry.getProviderCalls() : []
    };
  }

  isCompleted() {
    return this.state.phase === 'completed' || Boolean(this.state.verdict);
  }

  getState() {
    return this.state;
  }

  getTelemetry() {
    return this.telemetry;
  }
}

export function createCouncilEngine(config = {}, options = {}) {
  return new CouncilEngine(config, options);
}
