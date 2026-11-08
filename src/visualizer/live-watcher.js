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
    this.outputPath = options.outputPath
      ? path.resolve(options.outputPath)
      : path.join(this.outputDir, 'latest.js');
    this.runFilePath = path.join(this.outputDir, `${this.runId}.js`);
    this.indexFilePath = path.join(this.outputDir, 'index.js');
    this.initialConfig = options.initialConfig || {};
    this._stopped = false;

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
      return {
        type: 'SUBMIT_PROOF',
        ...(p.id ? { id: p.id } : {}),
        ...(p.seatId ? { seatId: p.seatId } : {}),
        ...(p.kind ? { kind: p.kind } : {}),
        ...(p.scope ? { scope: p.scope } : {})
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

    const stateDelta = {
      phase: clonedState.phase,
      canonicalPhase: clonedState.canonicalPhase,
      round: clonedState.round,
      maxRounds: clonedState.maxRounds,
      minQuorum: clonedState.minQuorum,
      clarificationBatch: clonedState.clarificationBatch,
      topic: clonedState.topic,
      lastTransition: clonedState.lastTransition || null,
      candidate: clonedState.candidate || null,
      verdict: clonedState.verdict || null,
      seatStates: Array.isArray(clonedState.seats)
        ? clonedState.seats.map((s) => ({
            id: s.id,
            status: s.status,
            retries: s.retries,
            ...(s.faultReason !== undefined ? { faultReason: s.faultReason } : {}),
            ...(s.errorClass !== undefined ? { errorClass: s.errorClass } : {}),
            ...(s.excusedReason !== undefined ? { excusedReason: s.excusedReason } : {})
          }))
        : [],
      judgeState: clonedState.judge
        ? {
            id: clonedState.judge.id,
            status: clonedState.judge.status,
            ...(clonedState.judge.faultReason !== undefined ? { faultReason: clonedState.judge.faultReason } : {}),
            ...(clonedState.judge.errorClass !== undefined ? { errorClass: clonedState.judge.errorClass } : {})
          }
        : null,
      proofStatuses: Array.isArray(clonedState.proofs)
        ? clonedState.proofs.map((p) => ({
            id: p.id,
            status: p.status,
            ...(p.auditNote !== undefined ? { auditNote: p.auditNote } : {})
          }))
        : [],
      objectionStatuses: Array.isArray(clonedState.objections)
        ? clonedState.objections.map((o) => ({ id: o.id, status: o.status }))
        : [],
      historyEntry: Array.isArray(clonedState.history) && clonedState.history.length > 0 ? clonedState.history[0] : null,
      activeNodeId: clonedGraph?.activeNodeId || clonedState.phase
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
      value: clonedState,
      enumerable: false,
      configurable: true,
      writable: true
    });
    Object.defineProperty(stepRecord, 'graph', {
      value: clonedGraph,
      enumerable: false,
      configurable: true,
      writable: true
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
   * Atomically writes current liveRun to runFilePath, outputPath (latest.js), and updates index.js.
   * Wrapped in try/catch for observer safety so disk faults never crash deliberation.
   * @private
   */
  _writeAtomic() {
    if (this._stopped) return;

    try {
      const payload = JSON.stringify(this.liveRun, null, 2);
      const content = `/**
 * Auto-generated by The Council VisualizerLiveWatcher.
 * Do not edit manually.
 */
(function (root) {
  'use strict';
  const data = ${payload};
  if (data && data.currentState && data.currentGraph && !data.currentState.graph) {
    data.currentState.graph = data.currentGraph;
  }
  if (data && Array.isArray(data.steps)) {
    const baseSeats = (data.currentState && Array.isArray(data.currentState.seats))
      ? data.currentState.seats
      : ((data.initialConfig && Array.isArray(data.initialConfig.seats)) ? data.initialConfig.seats : []);
    const baseJudge = (data.currentState && data.currentState.judge)
      ? data.currentState.judge
      : ((data.initialConfig && data.initialConfig.judge) || null);
    const allProofs = (data.currentState && Array.isArray(data.currentState.proofs)) ? data.currentState.proofs : [];
    const allObjections = (data.currentState && Array.isArray(data.currentState.objections)) ? data.currentState.objections : [];
    const clarifications = (data.currentState && Array.isArray(data.currentState.clarifications)) ? data.currentState.clarifications : [];
    const accHistory = [];
    for (let i = 0; i < data.steps.length; i++) {
      const st = data.steps[i];
      const d = st && st.stateDelta;
      if (d) {
        if (d.historyEntry) accHistory.unshift(d.historyEntry);
        if (!st.graph && data.currentGraph) {
          st.graph = Object.assign({}, data.currentGraph, { activeNodeId: d.activeNodeId || d.phase });
        }
        if (!st.stateSnapshot) {
          const seatMap = new Map((d.seatStates || []).map(function (s) { return [s.id, s]; }));
          const seats = baseSeats.map(function (bs) {
            const ds = seatMap.get(bs.id);
            if (!ds) return Object.assign({}, bs);
            const merged = Object.assign({}, bs, { status: ds.status, retries: ds.retries ?? bs.retries ?? 0 });
            if (ds.faultReason !== undefined) merged.faultReason = ds.faultReason; else delete merged.faultReason;
            if (ds.errorClass !== undefined) merged.errorClass = ds.errorClass; else delete merged.errorClass;
            if (ds.excusedReason !== undefined) merged.excusedReason = ds.excusedReason; else delete merged.excusedReason;
            return merged;
          });
          let judge = baseJudge ? Object.assign({}, baseJudge) : null;
          if (judge && d.judgeState) {
            judge.status = d.judgeState.status;
            if (d.judgeState.faultReason !== undefined) judge.faultReason = d.judgeState.faultReason; else delete judge.faultReason;
            if (d.judgeState.errorClass !== undefined) judge.errorClass = d.judgeState.errorClass; else delete judge.errorClass;
          }
          const proofMap = new Map((d.proofStatuses || []).map(function (p) { return [p.id, p]; }));
          const proofs = allProofs
            .filter(function (p) { return proofMap.has(p.id); })
            .map(function (p) {
              const dp = proofMap.get(p.id);
              return Object.assign({}, p, { status: dp.status }, dp.auditNote !== undefined ? { auditNote: dp.auditNote } : {});
            });
          const objMap = new Map((d.objectionStatuses || []).map(function (o) { return [o.id, o]; }));
          const objections = allObjections
            .filter(function (o) { return objMap.has(o.id); })
            .map(function (o) { return Object.assign({}, o, { status: objMap.get(o.id).status }); });
          st.stateSnapshot = {
            phase: d.phase,
            canonicalPhase: d.canonicalPhase,
            round: d.round,
            maxRounds: d.maxRounds,
            minQuorum: d.minQuorum,
            clarificationBatch: d.clarificationBatch,
            topic: d.topic,
            lastTransition: d.lastTransition,
            candidate: d.candidate,
            verdict: d.verdict,
            seats: seats,
            judge: judge,
            proofs: proofs,
            objections: objections,
            clarifications: clarifications,
            history: accHistory.slice(),
            graph: st.graph || data.currentGraph || null
          };
        }
      }
    }
  }
  if (typeof window !== 'undefined') {
    window.CouncilLatestLiveRun = data;
    window.CouncilRuns = window.CouncilRuns || {};
    if (data.runId) {
      window.CouncilRuns[data.runId] = data;
    }
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.CouncilLatestLiveRun = data;
    globalThis.CouncilRuns = globalThis.CouncilRuns || {};
    if (data.runId) {
      globalThis.CouncilRuns[data.runId] = data;
    }
  }
  if (root) {
    root.CouncilLatestLiveRun = data;
    root.CouncilRuns = root.CouncilRuns || {};
    if (data.runId) {
      root.CouncilRuns[data.runId] = data;
    }
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
`;

      this._atomicWriteFile(this.outputPath, content);
      if (this.runFilePath !== this.outputPath) {
        this._atomicWriteFile(this.runFilePath, content);
      }

      const existingIndex = this._readExistingIndex().filter((entry) => entry && entry.runId !== this.runId);
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
      const updatedIndex = [currentEntry, ...existingIndex];
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
    } catch {
      // Safe observer failure suppression: file write errors must never crash deliberation
    }
  }
}
