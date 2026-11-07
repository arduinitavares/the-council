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
import { MockAdapter } from '../harness/mock.js';

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
        this._step({
          type: 'ADD_SEAT',
          seat: {
            id: seat.id,
            harness: seat.harness,
            model: seat.model,
            soul: typeof seat.soul === 'object' && seat.soul !== null && seat.soul.toJSON ? seat.soul.toJSON() : seat.soul
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
   * Handles a faulted seat per ADR 0003: bounded retry or excusal.
   * Preserves completed turns and locks open objections as preserved_excused.
   * @param {string} seatId
   * @param {Error|string} error
   * @returns {{ action: string, retries?: number, lockedObjections?: number }}
   */
  handleSeatFault(seatId, error) {
    const reason = error instanceof Error ? error.message : String(error);
    const seat = (this.state.seats || []).find((s) => s.id === seatId);
    const retries = seat ? seat.retries : 0;

    this.telemetry.emitSeatFault(seatId, reason, retries);
    this._step({ type: 'SEAT_FAULT', seatId, reason });

    if (seat && retries < this.config.maxRetriesPerSeat) {
      this._step({ type: 'RETRY_SEAT', seatId });
      return { action: 'retried', retries: seat.retries + 1 };
    } else {
      this._step({ type: 'EXCUSE_SEAT', seatId, reason: `Exhausted retries or quota: ${reason}` });
      const locked = (this.state.objections || []).filter((o) => o.seatId === seatId && o.status === 'preserved_excused').length;
      this.telemetry.emitSeatExcused(seatId, reason, locked);
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

    // 2. PROOF COLLECTION (Active seats submit proofs)
    const active = activeSeats(this.state);
    for (const seat of active) {
      if (this.aborted || this.isCompleted()) break;
      if (seat.status === 'excused') continue;

      const harness = this.harnessResolver(seat.harness);
      let executed = false;

      while (!executed && !this.isCompleted() && !this.aborted) {
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
              topic: this.state.topic
            });
          } else if (typeof harness.executeSeat === 'function') {
            proofInput = await harness.executeSeat({
              seat,
              soul: seat.soul,
              round: currentRound,
              phase: 'DELIBERATION',
              state: this.state,
              topic: this.state.topic
            });
          } else {
            throw new Error(`Harness for "${seat.harness}" does not implement executeSeatProof or executeSeat`);
          }

          const validation = validateProof(proofInput);
          if (!validation.valid) {
            throw new Error(`Invalid proof from seat ${seat.id}: ${validation.errors.join('; ')}`);
          }

          this._step({
            type: 'SUBMIT_PROOF',
            id: proofInput.id,
            seatId: seat.id,
            scope: proofInput.scope,
            kind: proofInput.kind,
            source: proofInput.source,
            statement: proofInput.statement
          });

          this.telemetry.emitSeatTelemetry(seat.id, 'proof_submitted');
          const latestProof = this.state.proofs[this.state.proofs.length - 1];
          this.telemetry.emitProofSubmitted(latestProof);
          executed = true;
        } catch (err) {
          const faultRes = this.handleSeatFault(seat.id, err);
          if (faultRes.action === 'excused' || this.isCompleted()) {
            break;
          }
        }
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
            topic: this.state.topic
          });
        } else if (typeof judgeHarness.executeJudge === 'function') {
          synthesisResult = await judgeHarness.executeJudge({
            judge,
            round: currentRound,
            phase: 'JUDGE_AUDIT_SYNTHESIS',
            proofs: roundProofs,
            state: this.state,
            topic: this.state.topic
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
          throw new Error(this.state.lastTransition.message);
        }

        judgeExecuted = true;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.telemetry.emitSeatTelemetry(judge.id, 'fault_quota');
        this._step({ type: 'JUDGE_FAULT', error: errorMsg });

        if (this.state.judge.retries < maxJudgeRetries) {
          this._step({ type: 'RETRY_JUDGE' });
          this.telemetry.emitSeatTelemetry(judge.id, 'thinking');
        } else {
          this.state = {
            ...this.state,
            phase: 'completed',
            verdict: {
              kind: 'Dissent Report (Judge Fault)',
              candidate: null,
              unresolvedObjections: this.state.objections || [],
              activeSeatCount: activeSeats(this.state).length,
              excusedSeatCount: (this.state.seats || []).filter((s) => s.status === 'excused').length,
              note: `Judge candidate synthesis failed: ${errorMsg}`
            }
          };
          this.telemetry.emitVerdict(this.state.verdict);
          break;
        }
      }
    }

    if (this.isCompleted()) {
      return { round: currentRound, phase: this.state.phase, verdict: this.state.verdict };
    }

    this.telemetry.emitCandidateSynthesized(this.state.candidate);

    // 4. VOTING (Active seats accept or object)
    const voters = activeSeats(this.state);
    for (const seat of voters) {
      if (this.aborted || this.isCompleted()) break;
      if (seat.status === 'excused') continue;

      const seatHarness = this.harnessResolver(seat.harness);
      let executed = false;

      while (!executed && !this.isCompleted() && !this.aborted) {
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
              state: this.state
            });
          } else if (typeof seatHarness.executeSeat === 'function') {
            voteResult = await seatHarness.executeSeat({
              seat,
              soul: seat.soul,
              candidate: this.state.candidate,
              round: currentRound,
              phase: 'VOTING',
              state: this.state
            });
          } else {
            throw new Error(`Harness for "${seat.harness}" does not implement executeSeatVote or executeSeat`);
          }

          if (voteResult.vote === 'accept') {
            this._step({ type: 'CAST_VOTE', seatId: seat.id, vote: 'accept' });
            if (!this.state.lastTransition.ok) {
              throw new Error(this.state.lastTransition.message);
            }
            this.telemetry.emitSeatTelemetry(seat.id, 'accepted');
            this.telemetry.emitVoteCast(seat.id, 'accept');
          } else if (voteResult.vote === 'object') {
            this._step({
              type: 'CAST_VOTE',
              seatId: seat.id,
              vote: 'object',
              reason: voteResult.reason,
              proofId: voteResult.proofId
            });
            if (!this.state.lastTransition.ok) {
              throw new Error(this.state.lastTransition.message);
            }
            this.telemetry.emitSeatTelemetry(seat.id, 'objected');
            this.telemetry.emitVoteCast(seat.id, 'object', voteResult.reason, voteResult.proofId);
            const latestObj = this.state.objections[this.state.objections.length - 1];
            this.telemetry.emitObjectionRaised(latestObj);
          } else {
            throw new Error(`Unknown vote outcome "${voteResult.vote}" from seat ${seat.id}`);
          }
          executed = true;
        } catch (err) {
          const faultRes = this.handleSeatFault(seat.id, err);
          if (faultRes.action === 'excused' || this.isCompleted()) {
            break;
          }
        }
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
   * @returns {Promise<{ ok: boolean, verdict: Object, state: Object, snapshots: Array }>}
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
      snapshots: this.telemetry.getSnapshots()
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
