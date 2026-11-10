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
import { persistRunTelemetry } from '../telemetry/ledger.js';

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
    event.type === 'RETRY_JUDGE'
  ) {
    return state?.judge?.id || 'judge';
  }
  return 'engine';
}

/**
 * Formats fault detail without duplicating `[<errorClass>]` when reason already begins with it.
 * @param {string} [errorClass]
 * @param {string} [reason]
 * @returns {string}
 */
function formatFaultDetail(errorClass, reason) {
  const rawReason = reason || 'unspecified';
  const cls = errorClass || 'Error';
  if (
    typeof rawReason === 'string' &&
    (rawReason.startsWith(`[${cls}]`) || rawReason.startsWith(`${cls}:`))
  ) {
    return rawReason;
  }
  return `${cls}: ${rawReason}`;
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

  if (state?.lastTransition?.ok === false) {
    const rawMsg = state.lastTransition.message || 'Guard rejected transition';
    const escapedType = String(event.type).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cleanMsg = String(rawMsg).replace(new RegExp(`^Guard\\s+rejected\\s+${escapedType}:\\s*`, 'i'), '');
    return `Rejected ${event.type}: ${cleanMsg || 'Guard rejected transition'}`;
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
      return `Seat "${event.seatId}" faulted (${formatFaultDetail(event.errorClass, event.reason)})`;
    case 'RETRY_SEAT':
      return `Retrying faulted Seat "${event.seatId}"`;
    case 'EXCUSE_SEAT':
      return `Excused Seat "${event.seatId}" (${event.reason || 'retries exhausted'})`;
    case 'JUDGE_FAULT': {
      const detail = formatFaultDetail(event.errorClass, event.reason || event.error);
      if (event.terminal === true) {
        return `Terminal Judge fault (${detail}) -> Dissent Report (Judge Fault)`;
      }
      return `Judge faulted (${detail})`;
    }
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

export const DEFAULT_OUTPUT_DIR = path.resolve(import.meta.dirname, '../../.council/runs');

export class VisualizerLiveWatcher {
  /**
   * @param {Object} [options]
   * @param {import('../telemetry/emitter.js').CouncilTelemetryEmitter} [options.telemetry]
   * @param {string} [options.outputDir] - Target runtime directory for run artifacts and manifest
   * @param {string} [options.telemetryDir] - Target directory for per-run telemetry ledger
   * @param {string} [options.runId] - Unique identifier for this deliberation run
   * @param {string} [options.outputPath] - Target path to latest pointer file
   * @param {Object} [options.initialConfig] - Snapshot of Council configuration
   */
  constructor(options = {}) {
    this.telemetry = options.telemetry || null;
    this.runId =
      typeof options.runId === 'string' && options.runId.trim()
        ? options.runId.trim()
        : `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    this.outputDir = options.outputDir
      ? path.resolve(options.outputDir)
      : options.outputPath
        ? path.dirname(path.resolve(options.outputPath))
        : DEFAULT_OUTPUT_DIR;
    this.telemetryDir = options.telemetryDir ? path.resolve(options.telemetryDir) : null;
    this.outputPath = options.outputPath
      ? path.resolve(options.outputPath)
      : path.join(this.outputDir, 'latest.js');
    this.runFilePath = path.join(this.outputDir, `${this.runId}.js`);
    this.metaFilePath = path.join(this.outputDir, `${this.runId}.meta.json`);
    this.indexFilePath = path.join(this.outputDir, 'index.js');
    this.initialConfig = options.initialConfig || {};
    this._stopped = false;
    this._prevSeatMap = new Map();
    this._prevProofMap = new Map();
    this._prevObjMap = new Map();

    const nowIso = new Date().toISOString();
    this.liveRun = {
      id: 'wt-live-latest',
      runId: this.runId,
      title: `Live Run: ${this.initialConfig.topic || 'Deliberation'}`,
      description: `Real-time observer stream for live deliberation: ${this.initialConfig.topic || 'Deliberation'}`,
      startedAt: nowIso,
      updatedAt: nowIso,
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
   * Builds a compact step event descriptor that avoids duplicating large proof/clarification payloads.
   * @param {Object} [event]
   * @returns {Object|null}
   * @private
   */
  _compactEvent(event) {
    if (!event || typeof event !== 'object') return null;
    if (event.type === 'SUBMIT_PROOF') {
      const p = event.proof && typeof event.proof === 'object' ? event.proof : event;
      const id = p.id || event.id;
      const seatId = p.seatId || event.seatId;
      const kind = p.kind || event.kind;
      const scope = p.scope || event.scope;
      return {
        type: 'SUBMIT_PROOF',
        ...(id ? { id } : {}),
        ...(seatId ? { seatId } : {}),
        ...(kind ? { kind } : {}),
        ...(scope ? { scope } : {})
      };
    }
    if (event.type === 'PUBLISH_CLARIFICATION') {
      return {
        type: 'PUBLISH_CLARIFICATION',
        ...(event.batch !== undefined ? { batch: event.batch } : {})
      };
    }
    const clone = (obj) => (typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));
    return clone(event);
  }

  /**
   * Rehydrates stateSnapshot and graph for a target step record on demand by accumulating incremental deltas.
   * @param {Object} targetStep
   * @returns {{ stateSnapshot: Object|null, graph: Object|null }}
   * @private
   */
  _rehydrateStepAt(targetStep) {
    const data = this.liveRun;
    if (!data || !Array.isArray(data.steps)) {
      return { stateSnapshot: null, graph: null };
    }
    const targetIdx = data.steps.indexOf(targetStep);
    if (targetIdx < 0) {
      return { stateSnapshot: null, graph: null };
    }

    const baseSeats =
      data.currentState && Array.isArray(data.currentState.seats)
        ? data.currentState.seats
        : data.initialConfig && Array.isArray(data.initialConfig.seats)
          ? data.initialConfig.seats
          : [];
    const baseSeatIds = new Set(baseSeats.map((bs) => bs.id));
    const baseJudge =
      data.currentState && data.currentState.judge
        ? data.currentState.judge
        : (data.initialConfig && data.initialConfig.judge) || null;
    const allProofs = data.currentState && Array.isArray(data.currentState.proofs) ? data.currentState.proofs : [];
    const allObjections =
      data.currentState && Array.isArray(data.currentState.objections) ? data.currentState.objections : [];
    const clarifications =
      data.currentState && Array.isArray(data.currentState.clarifications) ? data.currentState.clarifications : [];
    const evidence =
      data.currentState && Array.isArray(data.currentState.evidence)
        ? data.currentState.evidence
        : data.initialConfig && Array.isArray(data.initialConfig.evidence)
          ? data.initialConfig.evidence
          : [];
    const fullHistory = data.currentState && Array.isArray(data.currentState.history) ? data.currentState.history : [];
    const accHistory = fullHistory.length > data.steps.length ? fullHistory.slice(data.steps.length) : [];

    const seatMap = new Map();
    const proofMap = new Map();
    const objMap = new Map();

    let resultSnapshot = null;
    let resultGraph = null;

    for (let i = 0; i <= targetIdx; i++) {
      const st = data.steps[i];
      const d = st && st.stateDelta;
      if (!d) continue;

      if (typeof d.historyLength === 'number') {
        if (d.historyLength === 0) {
          accHistory.length = 0;
        } else if (d.historyEntry) {
          if (d.historyLength === 1) {
            accHistory.length = 0;
            accHistory.push(d.historyEntry);
          } else if (accHistory.length < d.historyLength) {
            accHistory.unshift(d.historyEntry);
          }
        }
      } else if (d.historyEntry && accHistory[0] !== d.historyEntry) {
        accHistory.unshift(d.historyEntry);
      }
      if (Array.isArray(d.removedSeatIds)) {
        for (const id of d.removedSeatIds) seatMap.delete(id);
      }
      for (const s of d.seatChanges || d.seatStates || []) {
        seatMap.set(s.id, s);
      }
      if (Array.isArray(d.removedProofIds)) {
        for (const id of d.removedProofIds) proofMap.delete(id);
      }
      for (const p of d.proofChanges || d.proofStatuses || []) {
        proofMap.set(p.id, p);
      }
      if (Array.isArray(d.removedObjectionIds)) {
        for (const id of d.removedObjectionIds) objMap.delete(id);
      }
      for (const o of d.objectionChanges || d.objectionStatuses || []) {
        objMap.set(o.id, o);
      }

      if (i === targetIdx) {
        const seats = baseSeats
          .filter((bs) => seatMap.has(bs.id))
          .map((bs) => {
            const ds = seatMap.get(bs.id);
            const merged = Object.assign({}, bs, { status: ds.status, retries: ds.retries ?? bs.retries ?? 0 });
            if (ds.faultReason !== undefined) merged.faultReason = ds.faultReason;
            else delete merged.faultReason;
            if (ds.errorClass !== undefined) merged.errorClass = ds.errorClass;
            else delete merged.errorClass;
            if (ds.excusedReason !== undefined) merged.excusedReason = ds.excusedReason;
            else delete merged.excusedReason;
            return merged;
          });
        seatMap.forEach((ds, id) => {
          if (!baseSeatIds.has(id)) {
            seats.push(Object.assign({}, ds));
          }
        });

        let judge = baseJudge ? Object.assign({}, baseJudge) : null;
        if (judge && d.judgeState) {
          judge.status = d.judgeState.status;
          if (d.judgeState.retries !== undefined) judge.retries = d.judgeState.retries;
          if (d.judgeState.faultReason !== undefined) judge.faultReason = d.judgeState.faultReason;
          else delete judge.faultReason;
          if (d.judgeState.errorClass !== undefined) judge.errorClass = d.judgeState.errorClass;
          else delete judge.errorClass;
        }

        const proofs = allProofs
          .filter((p) => proofMap.has(p.id))
          .map((p) => {
            const dp = proofMap.get(p.id);
            const mergedProof = Object.assign({}, p, {
              status: dp.status,
              judgeNote: dp.judgeNote !== undefined ? dp.judgeNote : null
            });
            if (dp.judgeAdmittedStatement !== undefined) mergedProof.judgeAdmittedStatement = dp.judgeAdmittedStatement;
            else delete mergedProof.judgeAdmittedStatement;
            if (dp.admissionKind !== undefined) mergedProof.admissionKind = dp.admissionKind;
            else delete mergedProof.admissionKind;
            if (dp.auditNote !== undefined) mergedProof.auditNote = dp.auditNote;
            else delete mergedProof.auditNote;
            return mergedProof;
          });

        const objections = allObjections
          .filter((o) => objMap.has(o.id))
          .map((o) => Object.assign({}, o, { status: objMap.get(o.id).status }));

        const stepClarifications =
          typeof d.clarificationCount === 'number' ? clarifications.slice(0, d.clarificationCount) : clarifications;

        if (data.currentGraph) {
          const activeNodeId = d.activeNodeId || d.phase;
          const outgoingEdges = Array.isArray(d.outgoingEdges)
            ? d.outgoingEdges
            : Array.isArray(data.currentGraph.edges)
              ? data.currentGraph.edges.filter((e) => e.from === activeNodeId)
              : [];
          const causalLinks = [];
          proofs.forEach((p) => {
            causalLinks.push({
              id: 'dep-seat-proof-' + p.id,
              fromKind: 'seat',
              fromId: p.seatId,
              toKind: 'proof',
              toId: p.id,
              status: p.status,
              label: p.kind
            });
          });
          if (d.candidate && Array.isArray(d.candidate.clauses)) {
            d.candidate.clauses.forEach((cl) => {
              (cl.citedProofIds || []).forEach((pid) => {
                const citedProof = proofs.find((p) => p.id === pid);
                causalLinks.push({
                  id: 'dep-proof-clause-' + pid + '-' + cl.id,
                  fromKind: 'proof',
                  fromId: pid,
                  toKind: 'clause',
                  toId: cl.id,
                  status: citedProof ? citedProof.status : 'admitted',
                  label: 'cites ' + pid
                });
              });
            });
          }
          objections.forEach((o) => {
            if (o.status !== 'withdrawn') {
              causalLinks.push({
                id: 'dep-obj-seat-' + o.id,
                fromKind: 'seat',
                fromId: o.seatId,
                toKind: 'objection',
                toId: o.id,
                status: o.status,
                label: 'owns ' + o.id
              });
              causalLinks.push({
                id: 'dep-obj-proof-' + o.id,
                fromKind: 'proof',
                fromId: o.proofId,
                toKind: 'objection',
                toId: o.id,
                status: o.status,
                label: 'backs ' + o.id
              });
            }
          });
          resultGraph = Object.assign({}, data.currentGraph, {
            activeNodeId,
            activeAlias: activeNodeId,
            canonicalPhase: d.canonicalPhase || data.currentGraph.canonicalPhase,
            lastEdgeId: d.lastEdgeId !== undefined ? d.lastEdgeId : data.currentGraph.lastEdgeId,
            outgoingEdges,
            causalLinks
          });
        }

        resultSnapshot = {
          phase: d.phase,
          previousPhase: d.previousPhase !== undefined ? d.previousPhase : null,
          canonicalPhase: d.canonicalPhase,
          ...(d.phaseAlias !== undefined ? { phaseAlias: d.phaseAlias } : {}),
          ...(d.lastEventName !== undefined ? { lastEventName: d.lastEventName } : {}),
          ...(d.returnPhase !== undefined ? { returnPhase: d.returnPhase } : {}),
          ...(d.faultSeatId !== undefined ? { faultSeatId: d.faultSeatId } : {}),
          round: d.round,
          maxRounds: d.maxRounds,
          minQuorum: d.minQuorum,
          ...(d.maxRetriesPerSeat !== undefined ? { maxRetriesPerSeat: d.maxRetriesPerSeat } : {}),
          clarificationBatch: d.clarificationBatch,
          ...(d.maxClarificationBatches !== undefined ? { maxClarificationBatches: d.maxClarificationBatches } : {}),
          topic: d.topic,
          lastTransition: d.lastTransition,
          candidate: d.candidate,
          verdict: d.verdict,
          seats,
          judge,
          proofs,
          objections,
          clarifications: stepClarifications,
          evidence,
          history: accHistory.slice()
        };
        Object.defineProperty(resultSnapshot, 'graph', {
          value: resultGraph || data.currentGraph || null,
          enumerable: false,
          configurable: true,
          writable: true
        });
      }
    }

    return { stateSnapshot: resultSnapshot, graph: resultGraph };
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
      Object.defineProperty(clonedState, 'graph', {
        value: clonedGraph,
        enumerable: false,
        configurable: true,
        writable: true
      });
      this.liveRun.currentGraph = clonedGraph;
    }

    this.liveRun.currentState = clonedState;
    this.liveRun.isRunning = state.phase !== 'completed';
    this.liveRun.updatedAt = timestamp || new Date().toISOString();

    const stepLabel = `${this.liveRun.steps.length + 1}. Transition: ${event?.type || 'EVENT'} -> ${state.phase} (Round ${state.round})`;
    const actor = getTransitionActor(event, state);
    const summary = getTransitionSummary(event, state);

    const nextSeatMap = new Map();
    const seatChanges = [];
    if (Array.isArray(clonedState.seats)) {
      for (const s of clonedState.seats) {
        const entry = {
          id: s.id,
          status: s.status,
          retries: s.retries ?? 0,
          ...(s.faultReason !== undefined ? { faultReason: s.faultReason } : {}),
          ...(s.errorClass !== undefined ? { errorClass: s.errorClass } : {}),
          ...(s.excusedReason !== undefined ? { excusedReason: s.excusedReason } : {})
        };
        nextSeatMap.set(s.id, entry);
        const prev = this._prevSeatMap.get(s.id);
        if (
          !prev ||
          prev.status !== entry.status ||
          prev.retries !== entry.retries ||
          prev.faultReason !== entry.faultReason ||
          prev.errorClass !== entry.errorClass ||
          prev.excusedReason !== entry.excusedReason
        ) {
          seatChanges.push(entry);
        }
      }
    }
    const removedSeatIds = [];
    for (const prevId of this._prevSeatMap.keys()) {
      if (!nextSeatMap.has(prevId)) {
        removedSeatIds.push(prevId);
      }
    }
    this._prevSeatMap = nextSeatMap;

    const nextProofMap = new Map();
    const proofChanges = [];
    if (Array.isArray(clonedState.proofs)) {
      for (const p of clonedState.proofs) {
        const entry = {
          id: p.id,
          status: p.status,
          judgeNote: p.judgeNote ?? null,
          ...(p.judgeAdmittedStatement !== undefined ? { judgeAdmittedStatement: p.judgeAdmittedStatement } : {}),
          ...(p.admissionKind !== undefined ? { admissionKind: p.admissionKind } : {}),
          ...(p.auditNote !== undefined ? { auditNote: p.auditNote } : {})
        };
        nextProofMap.set(p.id, entry);
        const prev = this._prevProofMap.get(p.id);
        if (
          !prev ||
          prev.status !== entry.status ||
          prev.judgeNote !== entry.judgeNote ||
          prev.judgeAdmittedStatement !== entry.judgeAdmittedStatement ||
          prev.admissionKind !== entry.admissionKind ||
          prev.auditNote !== entry.auditNote
        ) {
          proofChanges.push(entry);
        }
      }
    }
    const removedProofIds = [];
    for (const prevId of this._prevProofMap.keys()) {
      if (!nextProofMap.has(prevId)) {
        removedProofIds.push(prevId);
      }
    }
    this._prevProofMap = nextProofMap;

    const nextObjMap = new Map();
    const objectionChanges = [];
    if (Array.isArray(clonedState.objections)) {
      for (const o of clonedState.objections) {
        const entry = {
          id: o.id,
          status: o.status
        };
        nextObjMap.set(o.id, entry);
        const prev = this._prevObjMap.get(o.id);
        if (!prev || prev.status !== entry.status) {
          objectionChanges.push(entry);
        }
      }
    }
    const removedObjectionIds = [];
    for (const prevId of this._prevObjMap.keys()) {
      if (!nextObjMap.has(prevId)) {
        removedObjectionIds.push(prevId);
      }
    }
    this._prevObjMap = nextObjMap;

    const stateDelta = {
      phase: clonedState.phase,
      previousPhase: clonedState.previousPhase ?? null,
      canonicalPhase: clonedState.canonicalPhase,
      ...(clonedState.phaseAlias !== undefined ? { phaseAlias: clonedState.phaseAlias } : {}),
      ...(clonedState.lastEventName !== undefined ? { lastEventName: clonedState.lastEventName } : {}),
      ...(clonedState.returnPhase !== undefined ? { returnPhase: clonedState.returnPhase } : {}),
      ...(clonedState.faultSeatId !== undefined ? { faultSeatId: clonedState.faultSeatId } : {}),
      round: clonedState.round,
      maxRounds: clonedState.maxRounds,
      minQuorum: clonedState.minQuorum,
      ...(clonedState.maxRetriesPerSeat !== undefined ? { maxRetriesPerSeat: clonedState.maxRetriesPerSeat } : {}),
      clarificationBatch: clonedState.clarificationBatch,
      ...(clonedState.maxClarificationBatches !== undefined
        ? { maxClarificationBatches: clonedState.maxClarificationBatches }
        : {}),
      clarificationCount: Array.isArray(clonedState.clarifications) ? clonedState.clarifications.length : 0,
      topic: clonedState.topic,
      lastTransition: clonedState.lastTransition || null,
      candidate: clonedState.candidate || null,
      verdict: clonedState.verdict || null,
      seatChanges,
      ...(removedSeatIds.length > 0 ? { removedSeatIds } : {}),
      judgeState: clonedState.judge
        ? {
            id: clonedState.judge.id,
            status: clonedState.judge.status,
            retries: clonedState.judge.retries ?? 0,
            ...(clonedState.judge.faultReason !== undefined ? { faultReason: clonedState.judge.faultReason } : {}),
            ...(clonedState.judge.errorClass !== undefined ? { errorClass: clonedState.judge.errorClass } : {})
          }
        : null,
      proofChanges,
      ...(removedProofIds.length > 0 ? { removedProofIds } : {}),
      objectionChanges,
      ...(removedObjectionIds.length > 0 ? { removedObjectionIds } : {}),
      historyEntry: Array.isArray(clonedState.history) && clonedState.history.length > 0 ? clonedState.history[0] : null,
      historyLength: Array.isArray(clonedState.history) ? clonedState.history.length : 0,
      activeNodeId: clonedGraph?.activeNodeId || clonedState.phase,
      lastEdgeId: clonedGraph?.lastEdgeId ?? null,
      outgoingEdges: Array.isArray(clonedGraph?.outgoingEdges) ? clonedGraph.outgoingEdges : []
    };

    const stepRecord = {
      label: stepLabel,
      actor,
      summary,
      event: this._compactEvent(event),
      stateDelta,
      timestamp: timestamp || new Date().toISOString()
    };

    Object.defineProperty(stepRecord, 'stateSnapshot', {
      get: () => this._rehydrateStepAt(stepRecord).stateSnapshot,
      enumerable: false,
      configurable: true
    });
    Object.defineProperty(stepRecord, 'graph', {
      get: () => this._rehydrateStepAt(stepRecord).graph,
      enumerable: false,
      configurable: true
    });

    this.liveRun.steps.push(stepRecord);

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
        Object.defineProperty(this.liveRun.currentState, 'graph', {
          value: clonedGraph,
          enumerable: false,
          configurable: true,
          writable: true
        });
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
   * Atomically writes file content via a temp file + fs.renameSync.
   * @param {string} targetPath
   * @param {string} content
   * @private
   */
  _atomicWriteFile(targetPath, content) {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, targetPath);
  }

  /**
   * Reads existing run manifest entries from index.js if present.
   * @returns {Array<Object>}
   * @private
   */
  _readExistingIndex() {
    try {
      if (!fs.existsSync(this.indexFilePath)) return [];
      const raw = fs.readFileSync(this.indexFilePath, 'utf8');
      const match = raw.match(/\/\* COUNCIL_RUN_INDEX_START \*\/\s*([\s\S]*?)\s*\/\* COUNCIL_RUN_INDEX_END \*\//);
      if (!match) return [];
      const parsed = JSON.parse(match[1]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Builds the browser/VM-evaluable JS bundle for a serialized liveRun payload.
   * @param {string} payload
   * @param {boolean} isLatestPointer
   * @returns {string}
   * @private
   */
  _buildBundleScript(payload, isLatestPointer) {
    return `/**
 * Auto-generated by The Council VisualizerLiveWatcher.
 * Do not edit manually.
 */
(function (root) {
  'use strict';
  const data = ${payload};
  const isLatestPointer = ${Boolean(isLatestPointer)};
  if (data && data.currentState && data.currentGraph && !data.currentState.graph) {
    data.currentState.graph = data.currentGraph;
  }
  if (data && Array.isArray(data.steps)) {
    const baseSeats = (data.currentState && Array.isArray(data.currentState.seats))
      ? data.currentState.seats
      : ((data.initialConfig && Array.isArray(data.initialConfig.seats)) ? data.initialConfig.seats : []);
    const baseSeatIds = new Set(baseSeats.map(function (bs) { return bs.id; }));
    const baseJudge = (data.currentState && data.currentState.judge)
      ? data.currentState.judge
      : ((data.initialConfig && data.initialConfig.judge) || null);
    const allProofs = (data.currentState && Array.isArray(data.currentState.proofs)) ? data.currentState.proofs : [];
    const allObjections = (data.currentState && Array.isArray(data.currentState.objections)) ? data.currentState.objections : [];
    const clarifications = (data.currentState && Array.isArray(data.currentState.clarifications)) ? data.currentState.clarifications : [];
    const evidence = (data.currentState && Array.isArray(data.currentState.evidence))
      ? data.currentState.evidence
      : ((data.initialConfig && Array.isArray(data.initialConfig.evidence)) ? data.initialConfig.evidence : []);
    const fullHistory = (data.currentState && Array.isArray(data.currentState.history)) ? data.currentState.history : [];
    const accHistory = fullHistory.length > data.steps.length ? fullHistory.slice(data.steps.length) : [];
    const seatMap = new Map();
    const proofMap = new Map();
    const objMap = new Map();
    for (let i = 0; i < data.steps.length; i++) {
      const st = data.steps[i];
      const d = st && st.stateDelta;
      if (d) {
        if (typeof d.historyLength === 'number') {
          if (d.historyLength === 0) {
            accHistory.length = 0;
          } else if (d.historyEntry) {
            if (d.historyLength === 1) {
              accHistory.length = 0;
              accHistory.push(d.historyEntry);
            } else if (accHistory.length < d.historyLength) {
              accHistory.unshift(d.historyEntry);
            }
          }
        } else if (d.historyEntry && accHistory[0] !== d.historyEntry) {
          accHistory.unshift(d.historyEntry);
        }
        if (Array.isArray(d.removedSeatIds)) {
          d.removedSeatIds.forEach(function (id) { seatMap.delete(id); });
        }
        (d.seatChanges || d.seatStates || []).forEach(function (s) {
          seatMap.set(s.id, s);
        });
        const seats = baseSeats
          .filter(function (bs) { return seatMap.has(bs.id); })
          .map(function (bs) {
            const ds = seatMap.get(bs.id);
            const merged = Object.assign({}, bs, { status: ds.status, retries: ds.retries ?? bs.retries ?? 0 });
            if (ds.faultReason !== undefined) merged.faultReason = ds.faultReason; else delete merged.faultReason;
            if (ds.errorClass !== undefined) merged.errorClass = ds.errorClass; else delete merged.errorClass;
            if (ds.excusedReason !== undefined) merged.excusedReason = ds.excusedReason; else delete merged.excusedReason;
            return merged;
          });
        seatMap.forEach(function (ds, id) {
          if (!baseSeatIds.has(id)) {
            seats.push(Object.assign({}, ds));
          }
        });
        let judge = baseJudge ? Object.assign({}, baseJudge) : null;
        if (judge && d.judgeState) {
          judge.status = d.judgeState.status;
          if (d.judgeState.retries !== undefined) judge.retries = d.judgeState.retries;
          if (d.judgeState.faultReason !== undefined) judge.faultReason = d.judgeState.faultReason; else delete judge.faultReason;
          if (d.judgeState.errorClass !== undefined) judge.errorClass = d.judgeState.errorClass; else delete judge.errorClass;
        }
        if (Array.isArray(d.removedProofIds)) {
          d.removedProofIds.forEach(function (id) { proofMap.delete(id); });
        }
        (d.proofChanges || d.proofStatuses || []).forEach(function (p) {
          proofMap.set(p.id, p);
        });
        const proofs = allProofs
          .filter(function (p) { return proofMap.has(p.id); })
          .map(function (p) {
            const dp = proofMap.get(p.id);
            const mergedProof = Object.assign({}, p, {
              status: dp.status,
              judgeNote: dp.judgeNote !== undefined ? dp.judgeNote : null
            });
            if (dp.judgeAdmittedStatement !== undefined) mergedProof.judgeAdmittedStatement = dp.judgeAdmittedStatement; else delete mergedProof.judgeAdmittedStatement;
            if (dp.admissionKind !== undefined) mergedProof.admissionKind = dp.admissionKind; else delete mergedProof.admissionKind;
            if (dp.auditNote !== undefined) mergedProof.auditNote = dp.auditNote; else delete mergedProof.auditNote;
            return mergedProof;
          });
        if (Array.isArray(d.removedObjectionIds)) {
          d.removedObjectionIds.forEach(function (id) { objMap.delete(id); });
        }
        (d.objectionChanges || d.objectionStatuses || []).forEach(function (o) {
          objMap.set(o.id, o);
        });
        const objections = allObjections
          .filter(function (o) { return objMap.has(o.id); })
          .map(function (o) { return Object.assign({}, o, { status: objMap.get(o.id).status }); });
        const stepClarifications = typeof d.clarificationCount === 'number'
          ? clarifications.slice(0, d.clarificationCount)
          : clarifications;
        if (!st.graph && data.currentGraph) {
          const activeNodeId = d.activeNodeId || d.phase;
          const outgoingEdges = Array.isArray(d.outgoingEdges)
            ? d.outgoingEdges
            : (Array.isArray(data.currentGraph.edges)
                ? data.currentGraph.edges.filter(function (e) { return e.from === activeNodeId; })
                : []);
          const causalLinks = [];
          proofs.forEach(function (p) {
            causalLinks.push({
              id: 'dep-seat-proof-' + p.id,
              fromKind: 'seat',
              fromId: p.seatId,
              toKind: 'proof',
              toId: p.id,
              status: p.status,
              label: p.kind
            });
          });
          if (d.candidate && Array.isArray(d.candidate.clauses)) {
            d.candidate.clauses.forEach(function (cl) {
              (cl.citedProofIds || []).forEach(function (pid) {
                const citedProof = proofs.find(function (p) { return p.id === pid; });
                causalLinks.push({
                  id: 'dep-proof-clause-' + pid + '-' + cl.id,
                  fromKind: 'proof',
                  fromId: pid,
                  toKind: 'clause',
                  toId: cl.id,
                  status: citedProof ? citedProof.status : 'admitted',
                  label: 'cites ' + pid
                });
              });
            });
          }
          objections.forEach(function (o) {
            if (o.status !== 'withdrawn') {
              causalLinks.push({
                id: 'dep-obj-seat-' + o.id,
                fromKind: 'seat',
                fromId: o.seatId,
                toKind: 'objection',
                toId: o.id,
                status: o.status,
                label: 'owns ' + o.id
              });
              causalLinks.push({
                id: 'dep-obj-proof-' + o.id,
                fromKind: 'proof',
                fromId: o.proofId,
                toKind: 'objection',
                toId: o.id,
                status: o.status,
                label: 'backs ' + o.id
              });
            }
          });
          st.graph = Object.assign({}, data.currentGraph, {
            activeNodeId: activeNodeId,
            activeAlias: activeNodeId,
            canonicalPhase: d.canonicalPhase || data.currentGraph.canonicalPhase,
            lastEdgeId: d.lastEdgeId !== undefined ? d.lastEdgeId : data.currentGraph.lastEdgeId,
            outgoingEdges: outgoingEdges,
            causalLinks: causalLinks
          });
        }
        if (!st.stateSnapshot) {
          st.stateSnapshot = {
            phase: d.phase,
            previousPhase: d.previousPhase !== undefined ? d.previousPhase : null,
            canonicalPhase: d.canonicalPhase,
            ...(d.phaseAlias !== undefined ? { phaseAlias: d.phaseAlias } : {}),
            ...(d.lastEventName !== undefined ? { lastEventName: d.lastEventName } : {}),
            ...(d.returnPhase !== undefined ? { returnPhase: d.returnPhase } : {}),
            ...(d.faultSeatId !== undefined ? { faultSeatId: d.faultSeatId } : {}),
            round: d.round,
            maxRounds: d.maxRounds,
            minQuorum: d.minQuorum,
            ...(d.maxRetriesPerSeat !== undefined ? { maxRetriesPerSeat: d.maxRetriesPerSeat } : {}),
            clarificationBatch: d.clarificationBatch,
            ...(d.maxClarificationBatches !== undefined ? { maxClarificationBatches: d.maxClarificationBatches } : {}),
            topic: d.topic,
            lastTransition: d.lastTransition,
            candidate: d.candidate,
            verdict: d.verdict,
            seats: seats,
            judge: judge,
            proofs: proofs,
            objections: objections,
            clarifications: stepClarifications,
            evidence: evidence,
            history: accHistory.slice()
          };
          Object.defineProperty(st.stateSnapshot, 'graph', {
            value: st.graph || data.currentGraph || null,
            enumerable: false,
            configurable: true,
            writable: true
          });
        }
      }
    }
  }
  function isNotStale(existing, incoming) {
    if (!existing) return true;
    const existingSteps = Array.isArray(existing.steps) ? existing.steps.length : 0;
    const incomingSteps = Array.isArray(incoming.steps) ? incoming.steps.length : 0;
    if (incomingSteps !== existingSteps) return incomingSteps > existingSteps;
    return String(incoming.updatedAt || '') >= String(existing.updatedAt || '');
  }
  if (typeof window !== 'undefined') {
    window.CouncilRuns = window.CouncilRuns || {};
    if (data.runId && isNotStale(window.CouncilRuns[data.runId], data)) {
      window.CouncilRuns[data.runId] = data;
    }
    if (
      !window.CouncilLatestLiveRun ||
      (window.CouncilLatestLiveRun.runId === data.runId
        ? isNotStale(window.CouncilLatestLiveRun, data)
        : isLatestPointer)
    ) {
      window.CouncilLatestLiveRun = data;
    }
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.CouncilRuns = globalThis.CouncilRuns || {};
    if (data.runId && isNotStale(globalThis.CouncilRuns[data.runId], data)) {
      globalThis.CouncilRuns[data.runId] = data;
    }
    if (
      !globalThis.CouncilLatestLiveRun ||
      (globalThis.CouncilLatestLiveRun.runId === data.runId
        ? isNotStale(globalThis.CouncilLatestLiveRun, data)
        : isLatestPointer)
    ) {
      globalThis.CouncilLatestLiveRun = data;
    }
  }
  if (root) {
    root.CouncilRuns = root.CouncilRuns || {};
    if (data.runId && isNotStale(root.CouncilRuns[data.runId], data)) {
      root.CouncilRuns[data.runId] = data;
    }
    if (
      !root.CouncilLatestLiveRun ||
      (root.CouncilLatestLiveRun.runId === data.runId
        ? isNotStale(root.CouncilLatestLiveRun, data)
        : isLatestPointer)
    ) {
      root.CouncilLatestLiveRun = data;
    }
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
`;
  }

  /**
   * Atomically writes current liveRun to runFilePath, outputPath (latest.js), <runId>.meta.json, and updates index.js.
   * Wrapped in try/catch for observer safety so disk faults never crash deliberation.
   * @private
   */
  _writeAtomic() {
    if (this._stopped) return;

    try {
      const payload = JSON.stringify(this.liveRun, null, 2);
      const latestContent = this._buildBundleScript(payload, true);

      this._atomicWriteFile(this.outputPath, latestContent);
      if (this.runFilePath !== this.outputPath) {
        const runContent = this._buildBundleScript(payload, false);
        this._atomicWriteFile(this.runFilePath, runContent);
      }

      const currentEntry = {
        id: this.runId,
        runId: this.runId,
        file: `${this.runId}.js`,
        title: this.liveRun.title,
        topic: this.liveRun.currentState?.topic || this.liveRun.initialConfig?.topic || 'Deliberation',
        startedAt: this.liveRun.startedAt,
        updatedAt: this.liveRun.updatedAt,
        isRunning: this.liveRun.isRunning,
        verdictKind: this.liveRun.currentState?.verdict?.kind || null
      };
      this._atomicWriteFile(this.metaFilePath, JSON.stringify(currentEntry, null, 2));

      const byRunId = new Map();
      byRunId.set(this.runId, currentEntry);
      for (const entry of this._readExistingIndex()) {
        if (entry && entry.runId && !byRunId.has(entry.runId)) {
          const runJsPath = path.join(this.outputDir, `${entry.runId}.js`);
          const metaJsonPath = path.join(this.outputDir, `${entry.runId}.meta.json`);
          if (fs.existsSync(runJsPath) || fs.existsSync(metaJsonPath)) {
            byRunId.set(entry.runId, entry);
          }
        }
      }
      if (fs.existsSync(this.outputDir)) {
        const files = fs.readdirSync(this.outputDir);
        for (const name of files) {
          if (!name.endsWith('.meta.json')) continue;
          try {
            const parsed = JSON.parse(fs.readFileSync(path.join(this.outputDir, name), 'utf8'));
            if (parsed && parsed.runId) {
              byRunId.set(parsed.runId, parsed);
            }
          } catch {
            // Ignore unreadable or partially written meta files
          }
        }
      }
      byRunId.set(this.runId, currentEntry);

      const updatedIndex = Array.from(byRunId.values()).sort((a, b) => {
        const timeA = String(a.updatedAt || a.startedAt || '');
        const timeB = String(b.updatedAt || b.startedAt || '');
        if (timeA !== timeB) return timeB.localeCompare(timeA);
        const startA = String(a.startedAt || '');
        const startB = String(b.startedAt || '');
        if (startA !== startB) return startB.localeCompare(startA);
        if (a.runId === this.runId) return -1;
        if (b.runId === this.runId) return 1;
        return 0;
      });

      const indexJson = JSON.stringify(updatedIndex, null, 2);
      const indexContent = `/**
 * Auto-generated Run Manifest by The Council VisualizerLiveWatcher.
 * Do not edit manually.
 */
(function (root) {
  'use strict';
  const index = /* COUNCIL_RUN_INDEX_START */ ${indexJson} /* COUNCIL_RUN_INDEX_END */;
  if (typeof window !== 'undefined') {
    window.CouncilRunIndex = index;
    window.CouncilRuns = window.CouncilRuns || {};
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.CouncilRunIndex = index;
    globalThis.CouncilRuns = globalThis.CouncilRuns || {};
  }
  if (root) {
    root.CouncilRunIndex = index;
    root.CouncilRuns = root.CouncilRuns || {};
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
`;
      this._atomicWriteFile(this.indexFilePath, indexContent);

      if (this.liveRun.currentState?.phase === 'completed') {
        persistRunTelemetry({
          runId: this.runId,
          mode: 'live',
          state: this.liveRun.currentState,
          steps: this.liveRun.steps,
          providerCalls: this.liveRun.providerCalls,
          startedAt: this.liveRun.startedAt,
          completedAt: this.liveRun.updatedAt,
          outputDir: this.outputDir,
          ...(this.telemetryDir ? { telemetryDir: this.telemetryDir } : {})
        });
      }
    } catch {
      // Safe observer failure suppression: file write errors must never crash deliberation
    }
  }
}
