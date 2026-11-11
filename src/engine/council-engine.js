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
import { HarnessAdapter, HarnessError, InvalidResponseError } from '../harness/adapter.js';
import { MockAdapter } from '../harness/mock.js';
import {
  downshiftEffort,
  downshiftModel,
  extractCanonicalBaseModel,
  parseModelAndEffort
} from '../harness/cli-runner.js';

const DEFAULT_TIMEOUT_RESOLVER = new HarnessAdapter();

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

  const targetEffort =
    String(seat.votingReasoningEffort || engineConfig.votingReasoningEffort || 'low')
      .trim()
      .toLowerCase() || 'low';

  let reasoningEffort;
  if (seat.votingModel) {
    model = seat.votingModel;
    let baseModel = '';
    let parsedEffort = targetEffort;
    try {
      baseModel = extractCanonicalBaseModel(model, targetEffort);
      parsedEffort = parseModelAndEffort(model, targetEffort).effort || targetEffort;
    } catch {
      baseModel = '';
      parsedEffort = targetEffort;
    }
    if (baseModel && baseModel !== 'composer-2.5' && (!preserveEffort || seat.votingReasoningEffort)) {
      reasoningEffort = parsedEffort;
    }
  } else if (!preserveEffort) {
    let baseModel = '';
    let currentEffort = 'high';
    try {
      baseModel = extractCanonicalBaseModel(seat.model, 'high');
      currentEffort = parseModelAndEffort(seat.model, 'high').effort || 'high';
    } catch {
      baseModel = '';
      currentEffort = 'high';
    }
    model = downshiftModel(seat.model, targetEffort);
    if (baseModel !== 'composer-2.5') {
      reasoningEffort = downshiftEffort(currentEffort, targetEffort);
    }
  } else if (seat.votingReasoningEffort) {
    reasoningEffort = String(seat.votingReasoningEffort).trim().toLowerCase();
  }

  const baseTimeoutMs =
    seat.timeoutMs ||
    engineConfig.timeoutMs ||
    240000;
  const configuredVotingTimeoutMs =
    seat.votingTimeoutMs ||
    seat.votingTimeout ||
    seat['voting-timeout'] ||
    engineConfig.votingTimeoutMs ||
    engineConfig.votingTimeout ||
    engineConfig['voting-timeout'] ||
    90000;
  const totalSeatBudgetMs =
    seat.totalSeatBudgetMs ||
    seat.seatBudget ||
    engineConfig.totalSeatBudgetMs ||
    engineConfig.seatBudget;

  const configSeatMatch =
    Array.isArray(engineConfig?.seats) && seat?.id
      ? engineConfig.seats.find((s) => s && s.id === seat.id)
      : undefined;
  const hasExplicitVotingTimeout =
    typeof seat?._explicitVotingTimeout === 'boolean'
      ? seat._explicitVotingTimeout
      : (typeof configSeatMatch?._explicitVotingTimeout === 'boolean'
          ? configSeatMatch._explicitVotingTimeout
          : (typeof engineConfig?._explicitVotingTimeout === 'boolean'
              ? Boolean(
                  engineConfig._explicitVotingTimeout ||
                    seat?.votingTimeoutMs !== undefined ||
                    seat?.votingTimeout !== undefined ||
                    seat?.['voting-timeout'] !== undefined
                )
              : Boolean(
                  seat?.votingTimeoutMs !== undefined ||
                    seat?.votingTimeout !== undefined ||
                    seat?.['voting-timeout'] !== undefined ||
                    engineConfig?.votingTimeoutMs !== undefined ||
                    engineConfig?.votingTimeout !== undefined ||
                    engineConfig?.['voting-timeout'] !== undefined
                )));

  const rawVotingTimeoutMs = hasExplicitVotingTimeout
    ? configuredVotingTimeoutMs
    : Math.min(baseTimeoutMs, configuredVotingTimeoutMs);
  const votingTimeoutMs =
    typeof totalSeatBudgetMs === 'number' && totalSeatBudgetMs > 0
      ? Math.min(rawVotingTimeoutMs, totalSeatBudgetMs)
      : rawVotingTimeoutMs;

  return {
    ...seat,
    model,
    tools,
    votingTimeoutMs,
    ...(reasoningEffort ? { reasoningEffort } : {})
  };
}

/**
 * Resolves the effective transient seat configuration for Round 2+ targeted rebuttals
 * executed by active seats that accepted the prior round's Candidate and hold zero open objections.
 *
 * Defaults:
 * - Downshifts reasoning effort to `rebuttalReasoningEffort` ('medium') unless `preserveRebuttalEffort: true`
 *   or an explicit `rebuttalModel` override is provided.
 * - Resolves `tools` to `rebuttalTools ?? (hasSeatOrGlobalCwd ? 'read-only' : 'none')` unless
 *   `preserveRebuttalEffort: true` (which preserves deliberation `tools` unless `rebuttalTools` is set).
 * - Caps initial rebuttal turn timeout to `rebuttalTimeoutMs ?? 90000` (clamped by `totalSeatBudgetMs`),
 *   unless `preserveRebuttalEffort: true` and no explicit `rebuttalTimeoutMs` was configured.
 *
 * @param {Object} seat
 * @param {Object} [engineConfig={}]
 * @param {Object} [options={}]
 * @param {{ resolveTimeoutMs?: (model?: string, explicitTimeoutMs?: number) => number }} [options.harness]
 * @returns {Object}
 */
export function resolveRebuttalSeatConfig(seat, engineConfig = {}, options = {}) {
  const preserveEffort =
    typeof seat.preserveRebuttalEffort === 'boolean'
      ? seat.preserveRebuttalEffort
      : (typeof seat['preserve-rebuttal-effort'] === 'boolean'
          ? seat['preserve-rebuttal-effort']
          : (typeof engineConfig.preserveRebuttalEffort === 'boolean'
              ? engineConfig.preserveRebuttalEffort
              : (typeof engineConfig['preserve-rebuttal-effort'] === 'boolean'
                  ? engineConfig['preserve-rebuttal-effort']
                  : false)));

  const baseTools =
    seat.tools !== undefined
      ? seat.tools
      : (engineConfig.tools !== undefined ? engineConfig.tools : 'read-only');
  const explicitRebuttalTools =
    seat.rebuttalTools !== undefined
      ? seat.rebuttalTools
      : (seat['rebuttal-tools'] !== undefined
          ? seat['rebuttal-tools']
          : (engineConfig.rebuttalTools !== undefined
              ? engineConfig.rebuttalTools
              : engineConfig['rebuttal-tools']));
  const hasSeatOrGlobalCwd = Boolean(
    (typeof seat.cwd === 'string' && seat.cwd.trim()) ||
      (typeof engineConfig.cwd === 'string' && engineConfig.cwd.trim())
  );
  const tools =
    explicitRebuttalTools !== undefined
      ? explicitRebuttalTools
      : (preserveEffort
          ? baseTools
          : (hasSeatOrGlobalCwd && baseTools !== 'none' ? 'read-only' : 'none'));

  const explicitRebuttalModelRaw =
    seat.rebuttalModel !== undefined
      ? seat.rebuttalModel
      : (seat['rebuttal-model'] !== undefined
          ? seat['rebuttal-model']
          : (engineConfig.rebuttalModel !== undefined
              ? engineConfig.rebuttalModel
              : engineConfig['rebuttal-model']));
  const explicitRebuttalModel =
    typeof explicitRebuttalModelRaw === 'string' && explicitRebuttalModelRaw.trim()
      ? explicitRebuttalModelRaw.trim()
      : undefined;

  const rawTargetEffort =
    seat.rebuttalReasoningEffort ??
    seat.rebuttalEffort ??
    seat['rebuttal-reasoning-effort'] ??
    engineConfig.rebuttalReasoningEffort ??
    engineConfig.rebuttalEffort ??
    engineConfig['rebuttal-reasoning-effort'] ??
    'medium';
  const targetEffort = String(rawTargetEffort).trim().toLowerCase() || 'medium';

  let model = seat.model;
  let reasoningEffort;
  if (explicitRebuttalModel) {
    model = explicitRebuttalModel;
    let baseModel = '';
    let parsedEffort = targetEffort;
    try {
      baseModel = extractCanonicalBaseModel(explicitRebuttalModel, targetEffort);
      parsedEffort = parseModelAndEffort(explicitRebuttalModel, targetEffort).effort || targetEffort;
    } catch {
      baseModel = '';
      parsedEffort = targetEffort;
    }
    if (baseModel && baseModel !== 'composer-2.5') {
      const hasExplicitRebuttalEffort =
        seat.rebuttalReasoningEffort !== undefined ||
        seat.rebuttalEffort !== undefined ||
        seat['rebuttal-reasoning-effort'] !== undefined ||
        engineConfig.rebuttalReasoningEffort !== undefined ||
        engineConfig.rebuttalEffort !== undefined ||
        engineConfig['rebuttal-reasoning-effort'] !== undefined;
      reasoningEffort = hasExplicitRebuttalEffort
        ? downshiftEffort(parsedEffort, targetEffort)
        : parsedEffort;
    }
  } else if (!preserveEffort) {
    let baseModel = '';
    let currentEffort = 'high';
    try {
      baseModel = extractCanonicalBaseModel(seat.model, 'high');
      currentEffort = parseModelAndEffort(seat.model, 'high').effort || 'high';
    } catch {
      baseModel = '';
      currentEffort = 'high';
    }
    model = downshiftModel(seat.model, targetEffort);
    if (baseModel !== 'composer-2.5') {
      reasoningEffort = downshiftEffort(currentEffort, targetEffort);
    }
  }

  const explicitRebuttalTimeout =
    seat.rebuttalTimeoutMs !== undefined
      ? seat.rebuttalTimeoutMs
      : (seat.rebuttalTimeout !== undefined
          ? seat.rebuttalTimeout
          : (seat['rebuttal-timeout'] !== undefined
              ? seat['rebuttal-timeout']
              : (engineConfig.rebuttalTimeoutMs !== undefined
                  ? engineConfig.rebuttalTimeoutMs
                  : (engineConfig.rebuttalTimeout !== undefined
                      ? engineConfig.rebuttalTimeout
                      : engineConfig['rebuttal-timeout']))));

  const explicitBaseTimeout = seat.timeoutMs || engineConfig.timeoutMs;
  const totalSeatBudgetMs =
    seat.totalSeatBudgetMs ||
    seat.seatBudget ||
    seat['seat-budget'] ||
    engineConfig.totalSeatBudgetMs ||
    engineConfig.seatBudget ||
    engineConfig['seat-budget'];

  const timeoutResolver =
    options?.harness && typeof options.harness.resolveTimeoutMs === 'function'
      ? options.harness
      : DEFAULT_TIMEOUT_RESOLVER;

  let rawRebuttalTimeoutMs;
  if (explicitRebuttalTimeout !== undefined) {
    rawRebuttalTimeoutMs = explicitRebuttalTimeout;
  } else if (preserveEffort) {
    rawRebuttalTimeoutMs = timeoutResolver.resolveTimeoutMs(seat.model, explicitBaseTimeout);
  } else {
    const capBaseTimeoutMs = explicitBaseTimeout || 240000;
    rawRebuttalTimeoutMs = Math.min(capBaseTimeoutMs, 90000);
  }

  const rebuttalTimeoutMs =
    typeof totalSeatBudgetMs === 'number' && totalSeatBudgetMs > 0
      ? Math.min(rawRebuttalTimeoutMs, totalSeatBudgetMs)
      : rawRebuttalTimeoutMs;

  return {
    ...seat,
    model,
    tools,
    rebuttalTimeoutMs,
    preserveRebuttalEffort: preserveEffort,
    ...(tools === 'none' && seat.cwd !== undefined ? { cwd: undefined } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {})
  };
}

/**
 * Infers the set of active seats whose final vote on `priorRound` was `accept`
 * directly from `state.history` and `state.objections` when `engine.state` was
 * hydrated via pure `transitionCouncil(...)` calls outside `CouncilEngine._step`.
 *
 * `state.history` prepends newest entries at index 0 (`[OK] ...`).
 *
 * @param {Object} state
 * @param {number} priorRound
 * @returns {Set<string>}
 */
function inferPriorRoundAcceptedSeatsFromState(state, priorRound) {
  const accepted = new Set();
  if (!state || priorRound < 1) return accepted;
  const history = Array.isArray(state.history) ? state.history : [];
  const objections = Array.isArray(state.objections) ? state.objections : [];

  for (const seat of state.seats || []) {
    if (!seat?.id || seat.status === 'excused') continue;
    const acceptEntry = `[OK] Seat "${seat.id}" voted ACCEPT on Round ${priorRound} Candidate.`;
    const acceptIdx = history.indexOf(acceptEntry);
    if (acceptIdx === -1) continue;

    const priorSeatObjs = objections.filter((o) => o.seatId === seat.id && o.round === priorRound);
    if (priorSeatObjs.some((o) => o.status === 'open')) continue;

    const objectedAfterAccept = priorSeatObjs.some((o) => {
      const prefix = `[OK] Seat "${seat.id}" raised Objection ${o.id} `;
      const objIdx = history.findIndex((h) => typeof h === 'string' && h.startsWith(prefix));
      return objIdx !== -1 && objIdx < acceptIdx;
    });
    if (!objectedAfterAccept) {
      accepted.add(seat.id);
    }
  }
  return accepted;
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
    this._acceptedSeatsByRound = new Map();
    this._dynamicSeatConfigs = new Map();
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
    const prevRound = prevState?.round || 0;
    const prevAcceptedIds = (prevState?.seats || [])
      .filter((s) => s.status === 'accepted')
      .map((s) => s.id);
    const nextState = transitionCouncil(prevState, event);
    this.state = nextState;

    if (nextState.lastTransition?.ok) {
      if (event?.type === 'RESET') {
        this._acceptedSeatsByRound.clear();
        this._dynamicSeatConfigs.clear();
      } else {
        if (event?.type === 'ADD_SEAT' && event.seat?.id) {
          this._dynamicSeatConfigs.set(event.seat.id, { ...event.seat });
        }
        if (event?.type === 'CAST_VOTE' && event.seatId && prevRound >= 1) {
          if (!this._acceptedSeatsByRound.has(prevRound)) {
            this._acceptedSeatsByRound.set(prevRound, new Set());
          }
          const roundSet = this._acceptedSeatsByRound.get(prevRound);
          if (event.vote === 'accept') {
            roundSet.add(event.seatId);
          } else if (event.vote === 'object') {
            roundSet.delete(event.seatId);
          }
        }
        if (event?.type === 'EXCUSE_SEAT') {
          const targetId = event.seatId || event.id;
          if (targetId) {
            for (const roundSet of this._acceptedSeatsByRound.values()) {
              roundSet.delete(targetId);
            }
          }
        }
        if (nextState.round > prevRound && prevRound >= 1) {
          this._acceptedSeatsByRound.set(prevRound, new Set(prevAcceptedIds));
        }
      }
    }

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
   * Creates a per-wave AbortController composed with `this.signal` when present.
   * @private
   * @returns {{ controller: AbortController, signal: AbortSignal }}
   */
  _createWaveController() {
    const controller = new AbortController();
    const signal = this.signal
      ? AbortSignal.any([this.signal, controller.signal])
      : controller.signal;
    return { controller, signal };
  }

  /**
   * Determines whether an error or active signal represents an abort/cancellation.
   * @private
   * @param {unknown} error
   * @param {AbortSignal | null} [waveSignal=null]
   * @returns {boolean}
   */
  _isAbortError(error, waveSignal = null) {
    if (this.aborted || this.signal?.aborted || waveSignal?.aborted) {
      return true;
    }
    if (!error || typeof error !== 'object') {
      return false;
    }
    return error.name === 'AbortError' || error.code === 'ABORT_ERR';
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
    this._step({ type: 'SEAT_FAULT', seatId, reason, status: faultStatus, errorClass }, true);

    if (seat && isRetryable && retries < this.config.maxRetriesPerSeat && !budgetExhausted) {
      this._step({ type: 'RETRY_SEAT', seatId }, true);
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
      this._step({ type: 'EXCUSE_SEAT', seatId, reason: excuseReason, errorClass }, true);
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
      this._step({ type: 'BEGIN_ROUND' }, true);
    }
    const currentRound = this.state.round;
    this.telemetry.emitRoundStart(currentRound, activeSeats(this.state).map((s) => s.id));

    // 2. PROOF COLLECTION (Active seats submit proofs concurrently across Attempt 0 and retry waves)
    const active = activeSeats(this.state);
    const concurrencyLimit = this.config.maxConcurrentSeats || active.length;
    const openObjections = (this.state.objections || []).filter((o) => o.status === 'open');
    const priorRoundAcceptedIds =
      currentRound >= 2
        ? (this._acceptedSeatsByRound.has(currentRound - 1)
            ? this._acceptedSeatsByRound.get(currentRound - 1)
            : inferPriorRoundAcceptedSeatsFromState(this.state, currentRound - 1))
        : new Set();

    const delibSlots = active.map((seat, index) => {
      const harness = this.harnessResolver(seat.harness);
      const dynamicSeat = this._dynamicSeatConfigs.get(seat.id) || {};
      const configSeat = (this.config.seats || []).find((s) => s.id === seat.id) || {};
      const mergedSeat = { ...dynamicSeat, ...configSeat, ...seat };
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

      const isRebuttal =
        currentRound >= 2 &&
        openObjections.length > 0 &&
        !openObjections.some((o) => o.seatId === seat.id) &&
        priorRoundAcceptedIds.has(seat.id);

      let rebuttalSeat = null;
      let currentSeatConfig = { ...mergedSeat };
      let effectiveBaseTimeoutMs = retryBaseTimeoutMs;
      let effectiveTurnTimeoutMs = initialTurnTimeoutMs;

      if (isRebuttal) {
        rebuttalSeat = resolveRebuttalSeatConfig(mergedSeat, this.config, { harness });
        const hasExplicitRebuttalTimeout =
          mergedSeat.rebuttalTimeoutMs !== undefined ||
          mergedSeat.rebuttalTimeout !== undefined ||
          mergedSeat['rebuttal-timeout'] !== undefined ||
          this.config.rebuttalTimeoutMs !== undefined ||
          this.config.rebuttalTimeout !== undefined ||
          this.config['rebuttal-timeout'] !== undefined;

        effectiveTurnTimeoutMs =
          rebuttalSeat.preserveRebuttalEffort && !hasExplicitRebuttalTimeout
            ? initialTurnTimeoutMs
            : Math.min(rebuttalSeat.rebuttalTimeoutMs, totalSeatBudgetMs);
        effectiveBaseTimeoutMs =
          rebuttalSeat.preserveRebuttalEffort && !hasExplicitRebuttalTimeout
            ? retryBaseTimeoutMs
            : (hasExplicitRebuttalTimeout
                ? rebuttalSeat.rebuttalTimeoutMs
                : Math.min(retryBaseTimeoutMs, rebuttalSeat.rebuttalTimeoutMs));
        currentSeatConfig = {
          ...seat,
          model: rebuttalSeat.model,
          tools: rebuttalSeat.tools,
          rebuttalTimeoutMs: rebuttalSeat.rebuttalTimeoutMs,
          preserveRebuttalEffort: rebuttalSeat.preserveRebuttalEffort,
          ...(rebuttalSeat.tools === 'none' && seat.cwd !== undefined ? { cwd: undefined } : {}),
          ...(rebuttalSeat.reasoningEffort ? { reasoningEffort: rebuttalSeat.reasoningEffort } : {})
        };
      }

      return {
        index,
        seat,
        harness,
        mergedSeat,
        isRebuttal,
        rebuttalSeat,
        currentSeatConfig,
        baseTimeoutMs: effectiveBaseTimeoutMs,
        totalSeatBudgetMs,
        turnTimeoutMs: effectiveTurnTimeoutMs,
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
              model: slot.isRebuttal ? slot.currentSeatConfig.model : slot.seat.model,
              validationErrors: validation.errors
            }
          );
          slot.proofInput = null;
          continue;
        }

        const submitEvent = {
          type: 'SUBMIT_PROOF',
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
              model: slot.isRebuttal ? slot.currentSeatConfig.model : slot.seat.model
            }
          );
          slot.proofInput = null;
        }
      }
    };

    const { controller: delibWaveController, signal: delibWaveSignal } = this._createWaveController();
    const activeCountAtDelibWaveStart = activeSeats(this.state).length;
    let unrecoverableDelibFaults = 0;

    await mapConcurrent(delibSlots, concurrencyLimit, async (slot) => {
      if (
        this.aborted ||
        this.signal?.aborted ||
        delibWaveSignal.aborted ||
        this.isCompleted() ||
        slot.excused ||
        slot.seat.status === 'excused'
      ) {
        if (this.signal?.aborted) {
          this.aborted = true;
        }
        slot.skipped = true;
        return;
      }

      this.telemetry.emitSeatTelemetry(slot.seat.id, 'thinking');
      const t0 = Date.now();
      try {
        const callSeat = slot.isRebuttal ? slot.currentSeatConfig : slot.seat;
        const callTools = slot.isRebuttal ? slot.currentSeatConfig.tools : slot.seat.tools;
        const callContext = slot.isRebuttal
          ? {
              rebuttalMode: true,
              mode: 'rebuttal',
              tools: callTools,
              signal: delibWaveSignal,
              ...(slot.currentSeatConfig.reasoningEffort
                ? { reasoningEffort: slot.currentSeatConfig.reasoningEffort }
                : {})
            }
          : {
              tools: callTools,
              signal: delibWaveSignal
            };
        const delibCallExtras = slot.isRebuttal
          ? {
              rebuttalMode: true,
              mode: 'rebuttal',
              signal: delibWaveSignal,
              context: callContext
            }
          : {
              signal: delibWaveSignal,
              context: callContext
            };
        let proofInput;
        if (typeof slot.harness.executeSeatProof === 'function') {
          proofInput = await slot.harness.executeSeatProof({
            seat: callSeat,
            soul: slot.seat.soul,
            round: currentRound,
            phase: 'DELIBERATION',
            state: this.state,
            topic: this.state.topic,
            timeoutMs: slot.turnTimeoutMs,
            tools: callTools,
            telemetry: this.telemetry,
            ...delibCallExtras
          });
        } else if (typeof slot.harness.executeSeat === 'function') {
          proofInput = await slot.harness.executeSeat({
            seat: callSeat,
            soul: slot.seat.soul,
            round: currentRound,
            phase: 'DELIBERATION',
            state: this.state,
            topic: this.state.topic,
            timeoutMs: slot.turnTimeoutMs,
            tools: callTools,
            telemetry: this.telemetry,
            ...delibCallExtras
          });
        } else {
          throw new Error(`Harness for "${slot.seat.harness}" does not implement executeSeatProof or executeSeat`);
        }
        if (this.signal?.aborted) {
          this.aborted = true;
        }
        if (this.aborted || delibWaveSignal.aborted) {
          slot.aborted = true;
          slot.skipped = true;
          slot.proofInput = null;
          slot.error = null;
          slot.needsValidation = false;
          return;
        }
        slot.seatElapsedMs += Date.now() - t0;
        slot.proofInput = proofInput;
        slot.error = null;
        slot.needsValidation = true;
      } catch (err) {
        if (this.signal?.aborted) {
          this.aborted = true;
        }
        if (this._isAbortError(err, delibWaveSignal)) {
          slot.aborted = true;
          slot.skipped = true;
          slot.proofInput = null;
          slot.error = null;
          slot.needsValidation = false;
          return;
        }
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

        const remainingBudget = slot.totalSeatBudgetMs - slot.seatElapsedMs;
        const minViable =
          typeof slot.totalSeatBudgetMs === 'number' && slot.totalSeatBudgetMs > 0
            ? Math.min(5000, Math.floor(slot.totalSeatBudgetMs * 0.1))
            : 0;
        const willExcuseImmediately =
          !this._isRetryableError(err) ||
          (slot.seat.retries || 0) >= this.config.maxRetriesPerSeat ||
          remainingBudget <= 0 ||
          remainingBudget < minViable;
        if (willExcuseImmediately) {
          unrecoverableDelibFaults += 1;
          if (
            !delibWaveController.signal.aborted &&
            activeCountAtDelibWaveStart - unrecoverableDelibFaults < this.state.minQuorum
          ) {
            delibWaveController.abort(new Error('Active seats dropped below minimum quorum'));
          }
        }
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
          const effectiveRetryTools = isTimeout
            ? 'none'
            : (slot.currentSeatConfig.tools !== undefined ? slot.currentSeatConfig.tools : 'read-only');
          slot.currentSeatConfig = {
            ...slot.currentSeatConfig,
            retries: typeof faultRes.retries === 'number' ? faultRes.retries : (liveSeat.retries || 0) + 1,
            tools: effectiveRetryTools,
            ...(effectiveRetryTools === 'none' && slot.currentSeatConfig.cwd !== undefined
              ? { cwd: undefined }
              : {})
          };
          retryBatch.push(slot);
        }

        if (this.isCompleted() || this.aborted || retryBatch.length === 0) {
          break;
        }

        const { controller: delibRetryController, signal: delibRetrySignal } = this._createWaveController();
        const activeCountAtRetryStart = activeSeats(this.state).length;
        let unrecoverableRetryFaults = 0;

        await mapConcurrent(retryBatch, concurrencyLimit, async (slot) => {
          if (
            this.aborted ||
            this.signal?.aborted ||
            delibRetrySignal.aborted ||
            this.isCompleted() ||
            slot.excused
          ) {
            if (this.signal?.aborted) {
              this.aborted = true;
            }
            return;
          }

          this.telemetry.emitSeatTelemetry(slot.seat.id, 'thinking');
          const retryT0 = Date.now();
          try {
            const retryContext = slot.isRebuttal
              ? {
                  rebuttalMode: true,
                  mode: 'rebuttal',
                  tools: slot.currentSeatConfig.tools,
                  signal: delibRetrySignal,
                  ...(slot.currentSeatConfig.reasoningEffort
                    ? { reasoningEffort: slot.currentSeatConfig.reasoningEffort }
                    : {})
                }
              : {
                  tools: slot.currentSeatConfig.tools,
                  signal: delibRetrySignal
                };
            const delibRetryExtras = slot.isRebuttal
              ? {
                  rebuttalMode: true,
                  mode: 'rebuttal',
                  signal: delibRetrySignal,
                  context: retryContext
                }
              : {
                  signal: delibRetrySignal,
                  context: retryContext
                };
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
                telemetry: this.telemetry,
                ...delibRetryExtras
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
                telemetry: this.telemetry,
                ...delibRetryExtras
              });
            }
            if (this.signal?.aborted) {
              this.aborted = true;
            }
            if (this.aborted || delibRetrySignal.aborted) {
              slot.aborted = true;
              slot.skipped = true;
              slot.proofInput = null;
              slot.error = null;
              slot.needsValidation = false;
              return;
            }
            slot.seatElapsedMs += Date.now() - retryT0;
            slot.proofInput = proofInput;
            slot.error = null;
            slot.needsValidation = true;
          } catch (retryErr) {
            if (this.signal?.aborted) {
              this.aborted = true;
            }
            if (this._isAbortError(retryErr, delibRetrySignal)) {
              slot.aborted = true;
              slot.skipped = true;
              slot.proofInput = null;
              slot.error = null;
              slot.needsValidation = false;
              return;
            }
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

            const remainingBudget = slot.totalSeatBudgetMs - slot.seatElapsedMs;
            const minViable =
              typeof slot.totalSeatBudgetMs === 'number' && slot.totalSeatBudgetMs > 0
                ? Math.min(5000, Math.floor(slot.totalSeatBudgetMs * 0.1))
                : 0;
            const currentSeatRetries = slot.currentSeatConfig.retries || 0;
            const willExcuseOnRetry =
              !this._isRetryableError(retryErr) ||
              currentSeatRetries >= this.config.maxRetriesPerSeat ||
              remainingBudget <= 0 ||
              remainingBudget < minViable;
            if (willExcuseOnRetry) {
              unrecoverableRetryFaults += 1;
              if (
                !delibRetryController.signal.aborted &&
                activeCountAtRetryStart - unrecoverableRetryFaults < this.state.minQuorum
              ) {
                delibRetryController.abort(new Error('Active seats dropped below minimum quorum'));
              }
            }
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
              model: slot.isRebuttal ? slot.currentSeatConfig.model : slot.seat.model
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

    if (this.isCompleted() || this.aborted) {
      return { round: currentRound, phase: this.state.phase, verdict: this.state.verdict };
    }

    // 3. JUDGING (Audit proofs and synthesize candidate)
    this._step({ type: 'START_JUDGING' }, true);
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
    const maxJudgeRetries =
      this.config.maxRetriesPerJudge ??
      this.config.judge?.maxRetries ??
      this.config.maxRetriesPerSeat ??
      1;
    let judgeRoundRetries = 0;
    let judgeExecuted = false;
    let judgeElapsedMs = 0;
    let currentJudgeConfig = { ...mergedJudge };
    let currentJudgeTimeoutMs = initialJudgeTimeoutMs;

    while (!judgeExecuted && !this.isCompleted() && !this.aborted) {
      if (this.signal?.aborted) {
        this.aborted = true;
        break;
      }
      const { signal: judgeSignal } = this._createWaveController();
      const judgeT0 = Date.now();
      try {
        const judgeContext = {
          tools: currentJudgeConfig.tools,
          signal: judgeSignal
        };
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
            telemetry: this.telemetry,
            signal: judgeSignal,
            context: judgeContext
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
            telemetry: this.telemetry,
            signal: judgeSignal,
            context: judgeContext
          });
        } else {
          throw new Error(`Harness for "${judge.harness}" does not implement executeJudgeAuditAndSynthesis or executeJudge`);
        }

        if (this.signal?.aborted) {
          this.aborted = true;
        }
        if (this.aborted || judgeSignal.aborted || this.isCompleted()) {
          break;
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
        if (this.signal?.aborted) {
          this.aborted = true;
        }
        if (this._isAbortError(err, judgeSignal) || this.isCompleted()) {
          break;
        }
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
        this._step({ type: 'JUDGE_FAULT', error: errorMsg, reason: errorMsg, status: faultStatus, errorClass }, true);

        if (isRetryable && judgeRoundRetries < maxJudgeRetries && !judgeBudgetExhausted) {
          judgeRoundRetries += 1;
          this._step({ type: 'RETRY_JUDGE' }, true);
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
          this._step(
            {
              type: 'JUDGE_FAULT',
              error: terminalReason,
              reason: terminalReason,
              status: faultStatus,
              errorClass,
              terminal: true
            },
            true
          );
          this.telemetry.emitVerdict(this.state.verdict);
          break;
        }
      }
    }

    if (this.isCompleted() || this.aborted) {
      return { round: currentRound, phase: this.state.phase, verdict: this.state.verdict };
    }

    this.telemetry.emitCandidateSynthesized(this.state.candidate);

    // 4. VOTING (Active seats accept or object concurrently across Attempt 0 and retry waves)
    const voters = activeSeats(this.state);
    const voteConcurrencyLimit = this.config.maxConcurrentSeats || voters.length;

    const voteSlots = voters.map((seat, index) => {
      const seatHarness = this.harnessResolver(seat.harness);
      const dynamicSeat = this._dynamicSeatConfigs.get(seat.id) || {};
      const configSeat = (this.config.seats || []).find((s) => s.id === seat.id) || {};
      const mergedSeat = { ...configSeat, ...dynamicSeat, ...seat };
      if (
        typeof configSeat._explicitVotingTimeout === 'boolean' &&
        dynamicSeat.votingTimeoutMs === undefined &&
        dynamicSeat.votingTimeout === undefined &&
        dynamicSeat['voting-timeout'] === undefined &&
        seat.votingTimeoutMs === undefined
      ) {
        Object.defineProperty(mergedSeat, '_explicitVotingTimeout', {
          value: configSeat._explicitVotingTimeout,
          enumerable: false,
          configurable: true
        });
      }
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
        ...(votingSeat.preserveVotingEffort !== undefined ? { preserveVotingEffort: votingSeat.preserveVotingEffort } : {}),
        ...(votingSeat.reasoningEffort ? { reasoningEffort: votingSeat.reasoningEffort } : {})
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

        const resolvedProofId =
          slot.voteResult?.proofId !== undefined
            ? slot.voteResult.proofId
            : slot.voteResult?.backingProof;
        if (voteOutcome === 'object' && resolvedProofId !== undefined && slot.voteResult.proofId === undefined) {
          slot.voteResult = {
            ...slot.voteResult,
            proofId: resolvedProofId
          };
        }

        const castEvent =
          voteOutcome === 'accept'
            ? { type: 'CAST_VOTE', seatId: slot.seat.id, vote: 'accept' }
            : {
                type: 'CAST_VOTE',
                seatId: slot.seat.id,
                vote: 'object',
                reason: slot.voteResult.reason,
                proofId: resolvedProofId
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

    const { controller: voteWaveController, signal: voteWaveSignal } = this._createWaveController();
    const activeCountAtVoteWaveStart = activeSeats(this.state).length;
    let unrecoverableVoteFaults = 0;

    await mapConcurrent(voteSlots, voteConcurrencyLimit, async (slot) => {
      if (
        this.aborted ||
        this.signal?.aborted ||
        voteWaveSignal.aborted ||
        this.isCompleted() ||
        slot.excused ||
        slot.seat.status === 'excused'
      ) {
        if (this.signal?.aborted) {
          this.aborted = true;
        }
        slot.skipped = true;
        return;
      }

      this.telemetry.emitSeatTelemetry(slot.seat.id, 'thinking');
      const t0 = Date.now();
      try {
        const voteContext = {
          tools: slot.currentSeatConfig.tools,
          signal: voteWaveSignal,
          ...(slot.currentSeatConfig.reasoningEffort
            ? { reasoningEffort: slot.currentSeatConfig.reasoningEffort }
            : {})
        };
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
            telemetry: this.telemetry,
            signal: voteWaveSignal,
            context: voteContext
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
            telemetry: this.telemetry,
            signal: voteWaveSignal,
            context: voteContext
          });
        } else {
          throw new Error(`Harness for "${slot.seat.harness}" does not implement executeSeatVote or executeSeat`);
        }
        if (this.signal?.aborted) {
          this.aborted = true;
        }
        if (this.aborted || voteWaveSignal.aborted) {
          slot.aborted = true;
          slot.skipped = true;
          slot.voteResult = null;
          slot.error = null;
          slot.needsValidation = false;
          return;
        }
        slot.seatElapsedMs += Date.now() - t0;
        slot.voteResult = voteResult;
        slot.error = null;
        slot.needsValidation = true;
      } catch (err) {
        if (this.signal?.aborted) {
          this.aborted = true;
        }
        if (this._isAbortError(err, voteWaveSignal)) {
          slot.aborted = true;
          slot.skipped = true;
          slot.voteResult = null;
          slot.error = null;
          slot.needsValidation = false;
          return;
        }
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

        const remainingBudget = slot.totalSeatBudgetMs - slot.seatElapsedMs;
        const minViable =
          typeof slot.totalSeatBudgetMs === 'number' && slot.totalSeatBudgetMs > 0
            ? Math.min(5000, Math.floor(slot.totalSeatBudgetMs * 0.1))
            : 0;
        const liveSeat = (this.state.seats || []).find((s) => s.id === slot.seat.id);
        const currentRetries = liveSeat ? liveSeat.retries : (slot.seat.retries || 0);
        const willExcuseImmediately =
          !this._isRetryableError(err) ||
          currentRetries >= this.config.maxRetriesPerSeat ||
          remainingBudget <= 0 ||
          remainingBudget < minViable;
        if (willExcuseImmediately) {
          unrecoverableVoteFaults += 1;
          if (
            !voteWaveController.signal.aborted &&
            activeCountAtVoteWaveStart - unrecoverableVoteFaults < this.state.minQuorum
          ) {
            voteWaveController.abort(new Error('Active seats dropped below minimum quorum'));
          }
        }
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

        const { controller: voteRetryController, signal: voteRetrySignal } = this._createWaveController();
        const activeCountAtVoteRetryStart = activeSeats(this.state).length;
        let unrecoverableVoteRetryFaults = 0;

        await mapConcurrent(retryBatch, voteConcurrencyLimit, async (slot) => {
          if (
            this.aborted ||
            this.signal?.aborted ||
            voteRetrySignal.aborted ||
            this.isCompleted() ||
            slot.excused
          ) {
            if (this.signal?.aborted) {
              this.aborted = true;
            }
            return;
          }

          this.telemetry.emitSeatTelemetry(slot.seat.id, 'thinking');
          const retryT0 = Date.now();
          try {
            const voteRetryContext = {
              tools: slot.currentSeatConfig.tools,
              signal: voteRetrySignal,
              ...(slot.currentSeatConfig.reasoningEffort
                ? { reasoningEffort: slot.currentSeatConfig.reasoningEffort }
                : {})
            };
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
                telemetry: this.telemetry,
                signal: voteRetrySignal,
                context: voteRetryContext
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
                telemetry: this.telemetry,
                signal: voteRetrySignal,
                context: voteRetryContext
              });
            }
            if (this.signal?.aborted) {
              this.aborted = true;
            }
            if (this.aborted || voteRetrySignal.aborted) {
              slot.aborted = true;
              slot.skipped = true;
              slot.voteResult = null;
              slot.error = null;
              slot.needsValidation = false;
              return;
            }
            slot.seatElapsedMs += Date.now() - retryT0;
            slot.voteResult = voteResult;
            slot.error = null;
            slot.needsValidation = true;
          } catch (retryErr) {
            if (this.signal?.aborted) {
              this.aborted = true;
            }
            if (this._isAbortError(retryErr, voteRetrySignal)) {
              slot.aborted = true;
              slot.skipped = true;
              slot.voteResult = null;
              slot.error = null;
              slot.needsValidation = false;
              return;
            }
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

            const remainingBudget = slot.totalSeatBudgetMs - slot.seatElapsedMs;
            const minViable =
              typeof slot.totalSeatBudgetMs === 'number' && slot.totalSeatBudgetMs > 0
                ? Math.min(5000, Math.floor(slot.totalSeatBudgetMs * 0.1))
                : 0;
            const currentSeatRetries = slot.currentSeatConfig.retries || 0;
            const willExcuseOnVoteRetry =
              !this._isRetryableError(retryErr) ||
              currentSeatRetries >= this.config.maxRetriesPerSeat ||
              remainingBudget <= 0 ||
              remainingBudget < minViable;
            if (willExcuseOnVoteRetry) {
              unrecoverableVoteRetryFaults += 1;
              if (
                !voteRetryController.signal.aborted &&
                activeCountAtVoteRetryStart - unrecoverableVoteRetryFaults < this.state.minQuorum
              ) {
                voteRetryController.abort(new Error('Active seats dropped below minimum quorum'));
              }
            }
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
          const resolvedProofId =
            slot.voteResult.proofId !== undefined
              ? slot.voteResult.proofId
              : slot.voteResult.backingProof;
          this._step({
            type: 'CAST_VOTE',
            seatId: slot.seat.id,
            vote: 'object',
            reason: slot.voteResult.reason,
            proofId: resolvedProofId
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
          this.telemetry.emitVoteCast(slot.seat.id, 'object', slot.voteResult.reason, resolvedProofId);
          const latestObj = this.state.objections[this.state.objections.length - 1];
          this.telemetry.emitObjectionRaised(latestObj);
        }
      }

      if (!commitFaulted) break;
    }

    if (this.isCompleted() || this.aborted) {
      return { round: currentRound, phase: this.state.phase, verdict: this.state.verdict };
    }

    // 5. EVALUATE_ROUND
    this._step({ type: 'EVALUATE_ROUND' }, true);
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
