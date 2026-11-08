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
    this.state = createInitialCouncilState({ ...this.config, seats: [] });
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
      this.telemetry.emit('guard_rejected', { event, message: errorMsg, state: nextState });
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
        const seatDisableHooks = seat.disableHooks !== undefined ? seat.disableHooks : this.config.disableHooks;
        const seatIgnoreUserConfig = seat.ignoreUserConfig !== undefined ? seat.ignoreUserConfig : this.config.ignoreUserConfig;
        this._step({
          type: 'ADD_SEAT',
          seat: {
            id: seat.id,
            harness: seat.harness,
            model: seat.model,
            soul: typeof seat.soul === 'object' && seat.soul !== null && seat.soul.toJSON ? seat.soul.toJSON() : seat.soul,
            tools: seatTools,
            ...(seatTimeoutMs !== undefined ? { timeoutMs: seatTimeoutMs } : {}),
            ...(typeof seatDisableHooks === 'boolean' ? { disableHooks: seatDisableHooks } : {}),
            ...(typeof seatIgnoreUserConfig === 'boolean' ? { ignoreUserConfig: seatIgnoreUserConfig } : {})
          }
        });
      }
    }
  }

  /**
   * Runs Discovery phase (Clarifications) if provided.
   * @param {Array<{ answer: string }>} [clarifications=[]]
   */
  async runDiscovery(clarifications = []) {
    if (!clarifications || clarifications.length === 0) return;

    for (let i = 0; i < clarifications.length; i++) {
      if (this.aborted || this.isCompleted()) break;
      const item = clarifications[i];
      this._step({ type: 'START_CLARIFYING' });
      this._step({
        type: 'PUBLISH_CLARIFICATION',
        answer: typeof item === 'object' && item.answer ? item.answer : String(item)
      });
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
   * @returns {{ action: string, retries?: number, lockedObjections?: number }}
   */
  handleSeatFault(seatId, error) {
    const errorClass = this._classifyErrorClass(error);
    const reason = this._formatFaultReason(error);
    const faultStatus = this._classifyFaultStatus(error);
    const seat = (this.state.seats || []).find((s) => s.id === seatId);
    const retries = seat ? seat.retries : 0;
    const isRetryable = this._isRetryableError(error);

    this.telemetry.emitSeatTelemetry(seatId, faultStatus, { reason, errorClass });
    this.telemetry.emitSeatFault(seatId, reason, retries);
    this._step({ type: 'SEAT_FAULT', seatId, reason, status: faultStatus, errorClass });

    if (seat && isRetryable && retries < this.config.maxRetriesPerSeat) {
      this._step({ type: 'RETRY_SEAT', seatId });
      return { action: 'retried', retries: seat.retries + 1 };
    } else {
      const excuseReason =
        isRetryable && retries > 0
          ? `Exhausted retries (${retries}/${this.config.maxRetriesPerSeat}): ${reason}`
          : reason;
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

    // 1. BEGIN_ROUND
    if (this.state.phase !== 'reviewing') {
      this._step({ type: 'BEGIN_ROUND' });
    }
    const currentRound = this.state.round;
    this.telemetry.emitRoundStart(currentRound, activeSeats(this.state).map((s) => s.id));

    // 2. PROOF COLLECTION (Active seats submit proofs concurrently)
    const active = activeSeats(this.state);
    const concurrencyLimit = this.config.maxConcurrentSeats || active.length;

    const turnResults = await mapConcurrent(active, concurrencyLimit, async (seat) => {
      if (this.aborted || this.isCompleted() || seat.status === 'excused') {
        return { seat, proofInput: null, error: null, skipped: true };
      }

      this.telemetry.emitSeatTelemetry(seat.id, 'thinking');
      const harness = this.harnessResolver(seat.harness);
      const turnTimeoutMs = seat.timeoutMs || this.config.timeoutMs;

      try {
        let proofInput;
        if (typeof harness.executeSeatProof === 'function') {
          proofInput = await harness.executeSeatProof({
            seat,
            soul: seat.soul,
            round: currentRound,
            phase: 'DELIBERATION',
            state: this.state,
            topic: this.state.topic,
            timeoutMs: turnTimeoutMs,
            telemetry: this.telemetry
          });
        } else if (typeof harness.executeSeat === 'function') {
          proofInput = await harness.executeSeat({
            seat,
            soul: seat.soul,
            round: currentRound,
            phase: 'DELIBERATION',
            state: this.state,
            topic: this.state.topic,
            timeoutMs: turnTimeoutMs,
            telemetry: this.telemetry
          });
        } else {
          throw new Error(`Harness for "${seat.harness}" does not implement executeSeatProof or executeSeat`);
        }
        return { seat, proofInput, error: null };
      } catch (err) {
        return { seat, proofInput: null, error: err };
      }
    });

    // Apply proof collection results in strict roster order
    for (let i = 0; i < active.length; i++) {
      if (this.aborted || this.isCompleted()) break;
      const seat = active[i];
      let res = turnResults[i];
      if (res?.skipped || seat.status === 'excused') continue;

      const harness = this.harnessResolver(seat.harness);
      const turnTimeoutMs = seat.timeoutMs || this.config.timeoutMs;

      while (!this.isCompleted() && !this.aborted) {
        if (res.error) {
          const faultRes = this.handleSeatFault(seat.id, res.error);
          if (faultRes.action === 'excused' || this.isCompleted()) {
            break;
          }
          // Retry the faulted seat
          this.telemetry.emitSeatTelemetry(seat.id, 'thinking');
          try {
            let proofInput;
            if (typeof harness.executeSeatProof === 'function') {
              proofInput = await harness.executeSeatProof({
                seat,
                soul: seat.soul,
                round: currentRound,
                phase: 'DELIBERATION',
                state: this.state,
                topic: this.state.topic,
                timeoutMs: turnTimeoutMs,
                telemetry: this.telemetry
              });
            } else if (typeof harness.executeSeat === 'function') {
              proofInput = await harness.executeSeat({
                seat,
                soul: seat.soul,
                round: currentRound,
                phase: 'DELIBERATION',
                state: this.state,
                topic: this.state.topic,
                timeoutMs: turnTimeoutMs,
                telemetry: this.telemetry
              });
            }
            res = { seat, proofInput, error: null };
          } catch (retryErr) {
            res = { seat, proofInput: null, error: retryErr };
            continue;
          }
        }

        const validation = validateProof(res.proofInput);
        if (!validation.valid) {
          const valErr = new InvalidResponseError(
            `Invalid proof from seat ${seat.id}: ${validation.errors.join('; ')}`,
            {
              harness: seat.harness,
              seatId: seat.id,
              model: seat.model,
              validationErrors: validation.errors
            }
          );
          res = { seat, proofInput: null, error: valErr };
          continue;
        }

        this._step({
          type: 'SUBMIT_PROOF',
          id: res.proofInput.id,
          seatId: seat.id,
          scope: res.proofInput.scope,
          kind: res.proofInput.kind,
          source: res.proofInput.source,
          statement: res.proofInput.statement
        });
        if (!this.state.lastTransition?.ok) {
          const transErr = new InvalidResponseError(
            this.state.lastTransition?.message || `Guard rejected SUBMIT_PROOF from seat ${seat.id}`,
            {
              harness: seat.harness,
              seatId: seat.id,
              model: seat.model
            }
          );
          res = { seat, proofInput: null, error: transErr };
          continue;
        }

        this.telemetry.emitSeatTelemetry(seat.id, 'proof_submitted');
        const latestProof = this.state.proofs[this.state.proofs.length - 1];
        this.telemetry.emitProofSubmitted(latestProof);
        break;
      }
    }

    if (this.isCompleted()) {
      return { round: currentRound, phase: this.state.phase, verdict: this.state.verdict };
    }

    // 3. JUDGING (Audit proofs and synthesize candidate)
    this._step({ type: 'START_JUDGING' });
    const judge = this.state.judge;
    this.telemetry.emitSeatTelemetry(judge.id, 'thinking');
    const judgeHarness = this.harnessResolver(judge.harness);
    const judgeTimeoutMs = judge.timeoutMs || this.config.timeoutMs;

    const roundProofs = this.state.proofs.filter((p) => p.round === currentRound || p.status === 'pending');
    const maxJudgeRetries = this.config.maxRetriesPerJudge ?? this.config.maxRetriesPerSeat ?? 1;
    let judgeExecuted = false;

    while (!judgeExecuted && !this.isCompleted() && !this.aborted) {
      try {
        let synthesisResult;
        if (typeof judgeHarness.executeJudgeAuditAndSynthesis === 'function') {
          synthesisResult = await judgeHarness.executeJudgeAuditAndSynthesis({
            judge,
            round: currentRound,
            phase: 'JUDGE_AUDIT_SYNTHESIS',
            proofs: roundProofs,
            state: this.state,
            topic: this.state.topic,
            timeoutMs: judgeTimeoutMs,
            telemetry: this.telemetry
          });
        } else if (typeof judgeHarness.executeJudge === 'function') {
          synthesisResult = await judgeHarness.executeJudge({
            judge,
            round: currentRound,
            phase: 'JUDGE_AUDIT_SYNTHESIS',
            proofs: roundProofs,
            state: this.state,
            topic: this.state.topic,
            timeoutMs: judgeTimeoutMs,
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

        judgeExecuted = true;
      } catch (err) {
        const errorClass = this._classifyErrorClass(err);
        const errorMsg = this._formatFaultReason(err);
        const faultStatus = this._classifyFaultStatus(err);
        const isRetryable = this._isRetryableError(err);
        this.telemetry.emitSeatTelemetry(judge.id, faultStatus, { reason: errorMsg, errorClass });
        this._step({ type: 'JUDGE_FAULT', error: errorMsg, reason: errorMsg, status: faultStatus, errorClass });

        if (isRetryable && this.state.judge.retries < maxJudgeRetries) {
          this._step({ type: 'RETRY_JUDGE' });
          this.telemetry.emitSeatTelemetry(judge.id, 'thinking');
        } else {
          this._step({
            type: 'JUDGE_FAULT',
            error: errorMsg,
            reason: errorMsg,
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

    // 4. VOTING (Active seats accept or object concurrently)
    const voters = activeSeats(this.state);
    const voteConcurrencyLimit = this.config.maxConcurrentSeats || voters.length;

    const voteResults = await mapConcurrent(voters, voteConcurrencyLimit, async (seat) => {
      if (this.aborted || this.isCompleted() || seat.status === 'excused') {
        return { seat, voteResult: null, error: null, skipped: true };
      }

      this.telemetry.emitSeatTelemetry(seat.id, 'thinking');
      const seatHarness = this.harnessResolver(seat.harness);
      const voteTimeoutMs = seat.timeoutMs || this.config.timeoutMs;

      try {
        let voteResult;
        if (typeof seatHarness.executeSeatVote === 'function') {
          voteResult = await seatHarness.executeSeatVote({
            seat,
            soul: seat.soul,
            candidate: this.state.candidate,
            round: currentRound,
            phase: 'VOTING',
            state: this.state,
            timeoutMs: voteTimeoutMs,
            telemetry: this.telemetry
          });
        } else if (typeof seatHarness.executeSeat === 'function') {
          voteResult = await seatHarness.executeSeat({
            seat,
            soul: seat.soul,
            candidate: this.state.candidate,
            round: currentRound,
            phase: 'VOTING',
            state: this.state,
            timeoutMs: voteTimeoutMs,
            telemetry: this.telemetry
          });
        } else {
          throw new Error(`Harness for "${seat.harness}" does not implement executeSeatVote or executeSeat`);
        }
        return { seat, voteResult, error: null };
      } catch (err) {
        return { seat, voteResult: null, error: err };
      }
    });

    // Apply voting results in strict roster order
    for (let i = 0; i < voters.length; i++) {
      if (this.aborted || this.isCompleted()) break;
      const seat = voters[i];
      let res = voteResults[i];
      if (res?.skipped || seat.status === 'excused') continue;

      const seatHarness = this.harnessResolver(seat.harness);
      const voteTimeoutMs = seat.timeoutMs || this.config.timeoutMs;

      while (!this.isCompleted() && !this.aborted) {
        if (res.error) {
          const faultRes = this.handleSeatFault(seat.id, res.error);
          if (faultRes.action === 'excused' || this.isCompleted()) {
            break;
          }
          // Retry the faulted seat
          this.telemetry.emitSeatTelemetry(seat.id, 'thinking');
          try {
            let voteResult;
            if (typeof seatHarness.executeSeatVote === 'function') {
              voteResult = await seatHarness.executeSeatVote({
                seat,
                soul: seat.soul,
                candidate: this.state.candidate,
                round: currentRound,
                phase: 'VOTING',
                state: this.state,
                timeoutMs: voteTimeoutMs,
                telemetry: this.telemetry
              });
            } else if (typeof seatHarness.executeSeat === 'function') {
              voteResult = await seatHarness.executeSeat({
                seat,
                soul: seat.soul,
                candidate: this.state.candidate,
                round: currentRound,
                phase: 'VOTING',
                state: this.state,
                timeoutMs: voteTimeoutMs,
                telemetry: this.telemetry
              });
            }
            res = { seat, voteResult, error: null };
          } catch (retryErr) {
            res = { seat, voteResult: null, error: retryErr };
            continue;
          }
        }

        if (res.voteResult.vote === 'accept') {
          this._step({ type: 'CAST_VOTE', seatId: seat.id, vote: 'accept' });
          if (!this.state.lastTransition.ok) {
            const transErr = new InvalidResponseError(this.state.lastTransition.message, {
              harness: seat.harness,
              seatId: seat.id,
              model: seat.model
            });
            res = { seat, voteResult: null, error: transErr };
            continue;
          }
          this.telemetry.emitSeatTelemetry(seat.id, 'accepted');
          this.telemetry.emitVoteCast(seat.id, 'accept');
        } else if (res.voteResult.vote === 'object') {
          this._step({
            type: 'CAST_VOTE',
            seatId: seat.id,
            vote: 'object',
            reason: res.voteResult.reason,
            proofId: res.voteResult.proofId
          });
          if (!this.state.lastTransition.ok) {
            const transErr = new InvalidResponseError(this.state.lastTransition.message, {
              harness: seat.harness,
              seatId: seat.id,
              model: seat.model
            });
            res = { seat, voteResult: null, error: transErr };
            continue;
          }
          this.telemetry.emitSeatTelemetry(seat.id, 'objected');
          this.telemetry.emitVoteCast(seat.id, 'object', res.voteResult.reason, res.voteResult.proofId);
          const latestObj = this.state.objections[this.state.objections.length - 1];
          this.telemetry.emitObjectionRaised(latestObj);
        } else {
          const invErr = new InvalidResponseError(`Unknown vote outcome "${res.voteResult?.vote}" from seat ${seat.id}`, {
            harness: seat.harness,
            seatId: seat.id,
            model: seat.model
          });
          res = { seat, voteResult: null, error: invErr };
          continue;
        }
        break;
      }
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

    if (this.config.clarifications && this.config.clarifications.length > 0) {
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
