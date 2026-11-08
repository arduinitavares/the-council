/**
 * @fileoverview Pure Observer Telemetry Subscriber for The Council Live Visualizer.
 * ESM Module (Node >= 22). Zero external dependencies.
 *
 * Subscribes to CouncilTelemetryEmitter ('state_transition', 'seat_telemetry') without
 * mutating CouncilEngine or state machine logic. Atomically persists
 * window.CouncilLatestLiveRun to src/visualizer/live-run-latest.js with production graph topology.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDependencyAndStateGraph } from '../machine/reducer.js';

/**
 * Resolves the primary actor identity responsible for a deliberation transition.
 * @param {Object} [event]
 * @param {Object} [state]
 * @returns {string} Actor identifier (seat ID, judge ID, or system/engine)
 */
export function getTransitionActor(event, state) {
  if (!event) return 'system';
  if (event.seat?.id) return event.seat.id;
  if (event.seatId) return event.seatId;
  if (event.proof?.seatId) return event.proof.seatId;
  if (event.vote?.seatId) return event.vote.seatId;
  if (
    event.type === 'START_JUDGING' ||
    event.type === 'JUDGE_AUDIT_AND_SYNTHESIZE' ||
    event.type === 'JUDGE_FAULT' ||
    event.type === 'RETRY_JUDGE' ||
    event.type === 'START_CLARIFYING' ||
    event.type === 'PUBLISH_CLARIFICATION'
  ) {
    return state?.judge?.id || 'judge';
  }
  return 'engine';
}

/**
 * Generates a human-readable action summary for deliberation transitions.
 * @param {Object} [event]
 * @param {Object} [state]
 * @returns {string} Human-readable summary
 */
export function getTransitionSummary(event, state) {
  if (!event || !event.type) {
    return `Transition to ${state?.phase || 'unknown phase'}`;
  }

  switch (event.type) {
    case 'ADD_SEAT': {
      const s = event.seat;
      return s ? `Added Seat "${s.id}" (${s.harness} / ${s.model})` : 'Added seat';
    }
    case 'START_CLARIFYING':
      return 'Started discovery & clarification phase';
    case 'PUBLISH_CLARIFICATION':
      return `Published clarification answer for Batch ${event.batch ?? state?.clarificationBatch ?? 1}`;
    case 'BEGIN_ROUND':
      return `Began Round ${state?.round ?? 1}/${state?.maxRounds ?? 3} proof collection`;
    case 'SUBMIT_PROOF': {
      const latestProof =
        Array.isArray(state?.proofs) && state.proofs.length > 0
          ? state.proofs[state.proofs.length - 1]
          : null;
      const p =
        event.proof && typeof event.proof === 'object'
          ? event.proof
          : event.seatId || event.kind || event.id
            ? {
                id: event.id || (latestProof?.seatId === event.seatId ? latestProof.id : ''),
                seatId: event.seatId || latestProof?.seatId,
                kind: event.kind || latestProof?.kind
              }
            : null;
      if (!p || !p.seatId) return 'Submitted proof';
      const proofIdPart = p.id ? `Proof ${p.id} ` : 'Proof ';
      return `Seat "${p.seatId}" submitted ${proofIdPart}[${p.kind || 'evidence'}]`;
    }
    case 'START_JUDGING':
      return `Initiated Judge audit & candidate synthesis for Round ${state?.round ?? 1}`;
    case 'JUDGE_AUDIT_AND_SYNTHESIZE': {
      const count = state?.candidate?.clauses?.length ?? 0;
      return `Judge audited proofs & synthesized Candidate with ${count} clause(s)`;
    }
    case 'CAST_VOTE': {
      const v =
        event.vote && typeof event.vote === 'object'
          ? event.vote
          : typeof event.vote === 'string'
            ? {
                seatId: event.seatId,
                vote: event.vote,
                proofId: event.proofId,
                reason: event.reason
              }
            : null;
      if (!v || !v.vote) return 'Cast vote';
      const seatLabel = v.seatId || 'unknown';
      return v.vote === 'accept'
        ? `Seat "${seatLabel}" voted ACCEPT (Round ${state?.round ?? 1})`
        : `Seat "${seatLabel}" voted OBJECT (Round ${state?.round ?? 1}${v.proofId ? ', cites Proof ' + v.proofId : ''})`;
    }
    case 'WITHDRAW_OBJECTION':
      return `Seat "${event.seatId}" withdrew Objection ${event.objectionId || ''}`;
    case 'SEAT_FAULT':
      return `Seat "${event.seatId}" faulted (${event.errorClass || 'Error'}: ${event.reason || 'unspecified'})`;
    case 'RETRY_SEAT':
      return `Retrying faulted Seat "${event.seatId}"`;
    case 'EXCUSE_SEAT':
      return `Excused Seat "${event.seatId}" (${event.reason || 'retries exhausted'})`;
    case 'JUDGE_FAULT':
      return `Judge faulted (${event.errorClass || 'Error'}: ${event.reason || event.error || 'unspecified'})`;
    case 'RETRY_JUDGE':
      return 'Retrying faulted Judge';
    case 'EVALUATE_ROUND': {
      if (state?.phase === 'completed') {
        return `Evaluated Round ${state?.round ?? 1}: Verdict — ${state?.verdict?.kind || 'Completed'}`;
      }
      if (state?.phase === 'reviewing') {
        return `Evaluated Round ${(state?.round ?? 2) - 1}: Open objections remain. Advanced to Round ${state?.round ?? 2}`;
      }
      return `Evaluated Round ${state?.round ?? 1} -> ${state?.phase || 'next'}`;
    }
    default:
      return `Transition: ${event.type} -> ${state?.phase || 'unknown'}`;
  }
}

export class VisualizerLiveWatcher {
  /**
   * @param {Object} [options]
   * @param {import('../telemetry/emitter.js').CouncilTelemetryEmitter} [options.telemetry]
   * @param {string} [options.outputPath] - Target path to live-run-latest.js
   * @param {Object} [options.initialConfig] - Snapshot of Council configuration
   */
  constructor(options = {}) {
    this.telemetry = options.telemetry || null;
    this.outputPath = options.outputPath || path.resolve(process.cwd(), 'src/visualizer/live-run-latest.js');
    this.initialConfig = options.initialConfig || {};
    this._stopped = false;

    this.liveRun = {
      id: 'wt-live-latest',
      title: `Live Run: ${this.initialConfig.topic || 'Deliberation'}`,
      description: `Real-time observer stream for live deliberation: ${this.initialConfig.topic || 'Deliberation'}`,
      updatedAt: new Date().toISOString(),
      isRunning: true,
      initialConfig: {
        topic: this.initialConfig.topic || '',
        maxRounds: this.initialConfig.maxRounds ?? 3,
        minQuorum: this.initialConfig.minQuorum ?? 2,
        judge: this.initialConfig.judge || null,
        seats: Array.isArray(this.initialConfig.seats) ? [...this.initialConfig.seats] : []
      },
      currentGraph: null,
      currentState: null,
      steps: [],
      providerCalls: []
    };

    this._boundStateTransition = this._handleStateTransition.bind(this);
    this._boundSeatTelemetry = this._handleSeatTelemetry.bind(this);
    this._boundProviderCall = this._handleProviderCall.bind(this);

    if (this.telemetry) {
      this.attach(this.telemetry);
    }

    this._writeAtomic();
  }

  /**
   * Attaches watcher to a telemetry emitter.
   * @param {import('../telemetry/emitter.js').CouncilTelemetryEmitter} telemetry
   */
  attach(telemetry) {
    if (!telemetry || typeof telemetry.on !== 'function') return;
    if (this.telemetry && this.telemetry !== telemetry) {
      this.detach();
    }
    this.telemetry = telemetry;
    this._stopped = false;
    this.telemetry.on('state_transition', this._boundStateTransition);
    this.telemetry.on('seat_telemetry', this._boundSeatTelemetry);
    this.telemetry.on('provider_call', this._boundProviderCall);
  }

  /**
   * Detaches watcher and removes all telemetry listeners.
   */
  detach() {
    this._stopped = true;
    if (this.telemetry && typeof this.telemetry.off === 'function') {
      this.telemetry.off('state_transition', this._boundStateTransition);
      this.telemetry.off('seat_telemetry', this._boundSeatTelemetry);
      this.telemetry.off('provider_call', this._boundProviderCall);
    }
  }

  /**
   * Alias for detach() for lifecycle cleanup.
   */
  stop() {
    this.detach();
  }

  /**
   * Safely computes production graph with defaults for partial states.
   * @param {Object} state
   * @returns {Object|null}
   * @private
   */
  _computeGraph(state) {
    if (!state) return null;
    try {
      const safeState = {
        seats: [],
        proofs: [],
        objections: [],
        candidate: null,
        minQuorum: 2,
        maxRounds: 3,
        round: 1,
        ...state
      };
      if (!Array.isArray(safeState.seats)) safeState.seats = [];
      if (!Array.isArray(safeState.proofs)) safeState.proofs = [];
      if (!Array.isArray(safeState.objections)) safeState.objections = [];
      return getDependencyAndStateGraph(safeState);
    } catch {
      return null;
    }
  }

  /**
   * Handles state machine transition event.
   * @private
   */
  _handleStateTransition({ event, state, snapshot, timestamp } = {}) {
    if (this._stopped || !state) return;

    const clone = (obj) => (typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));
    const clonedState = clone(state);
    const graph = this._computeGraph(state);
    const clonedGraph = graph ? clone(graph) : null;

    if (clonedGraph) {
      clonedState.graph = clonedGraph;
      this.liveRun.currentGraph = clonedGraph;
    }

    this.liveRun.currentState = clonedState;
    this.liveRun.isRunning = state.phase !== 'completed';
    this.liveRun.updatedAt = timestamp || new Date().toISOString();

    const stepLabel = `${this.liveRun.steps.length + 1}. Transition: ${event?.type || 'EVENT'} -> ${state.phase} (Round ${state.round})`;
    const actor = getTransitionActor(event, state);
    const summary = getTransitionSummary(event, state);

    this.liveRun.steps.push({
      label: stepLabel,
      actor,
      summary,
      event: event ? clone(event) : null,
      stateSnapshot: clonedState,
      graph: clonedGraph,
      timestamp: timestamp || new Date().toISOString()
    });

    this._writeAtomic();
  }

  /**
   * Handles real-time seat status telemetry.
   * @private
   */
  _handleSeatTelemetry({ seatId, status, metadata, timestamp } = {}) {
    if (this._stopped) return;

    const applyTelemetryToTarget = (target) => {
      if (!target) return;
      target.status = status;
      const isFaultStatus = status === 'fault_quota' || status === 'fault_timeout' || status === 'fault';
      if (isFaultStatus) {
        if (metadata && metadata.reason) {
          target.faultReason = metadata.reason;
        }
        if (metadata && metadata.errorClass) {
          target.errorClass = metadata.errorClass;
        }
      } else if (
        status === 'thinking' ||
        status === 'idle' ||
        status === 'proof_submitted' ||
        status === 'accepted' ||
        status === 'objected'
      ) {
        delete target.faultReason;
        delete target.errorClass;
      }
    };

    if (this.liveRun.currentState) {
      if (Array.isArray(this.liveRun.currentState.seats)) {
        const seat = this.liveRun.currentState.seats.find((s) => s.id === seatId);
        if (seat) {
          applyTelemetryToTarget(seat);
        }
      }
      if (this.liveRun.currentState.judge && this.liveRun.currentState.judge.id === seatId) {
        applyTelemetryToTarget(this.liveRun.currentState.judge);
      }

      // Re-derive graph topology with updated seat status
      const graph = this._computeGraph(this.liveRun.currentState);
      if (graph) {
        const clone = (obj) => (typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));
        const clonedGraph = clone(graph);
        this.liveRun.currentGraph = clonedGraph;
        this.liveRun.currentState.graph = clonedGraph;
      }
    }

    this.liveRun.updatedAt = timestamp || new Date().toISOString();
    this._writeAtomic();
  }

  /**
   * Handles provider CLI invocation telemetry records.
   * @param {Object} [record]
   * @private
   */
  _handleProviderCall(record) {
    if (this._stopped || !record || typeof record !== 'object') return;

    const clone = (obj) => (typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));
    if (!Array.isArray(this.liveRun.providerCalls)) {
      this.liveRun.providerCalls = [];
    }
    this.liveRun.providerCalls.push(clone(record));
    this.liveRun.updatedAt = record.timestamp || new Date().toISOString();
    this._writeAtomic();
  }

  /**
   * Atomically writes current liveRun to outputPath via temp file + fs.renameSync.
   * Wrapped in try/catch for observer safety so disk faults never crash deliberation.
   * @private
   */
  _writeAtomic() {
    if (this._stopped) return;

    try {
      const dir = path.dirname(this.outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tempPath = `${this.outputPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
      const payload = JSON.stringify(this.liveRun, null, 2);
      const content = `/**\n * Auto-generated by The Council VisualizerLiveWatcher.\n * Do not edit manually.\n */\n(function (root) {\n  'use strict';\n  const data = ${payload};\n  if (typeof window !== 'undefined') {\n    window.CouncilLatestLiveRun = data;\n  }\n  if (typeof globalThis !== 'undefined') {\n    globalThis.CouncilLatestLiveRun = data;\n  }\n  if (root) {\n    root.CouncilLatestLiveRun = data;\n  }\n})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));\n`;

      fs.writeFileSync(tempPath, content, 'utf8');
      fs.renameSync(tempPath, this.outputPath);
    } catch {
      // Safe observer failure suppression: file write errors must never crash deliberation
    }
  }
}
