/**
 * @fileoverview Continuation Parent Loader, Eligibility Validator & State Factory (ADR-0006 / Issue #108).
 * Supports explicit, immutable `council continue <runId|snapshot-path>` ratification runs
 * for parent runs ending in `Dissent Report (Preserved Excused-Seat Objection)`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { VERDICT_KINDS } from '../types.js';
import { normalizePhase } from '../machine/constants.js';
import { activeSeats, cloneState } from '../machine/state.js';
import { DEFAULT_OUTPUT_DIR, parseRunBundleJs } from '../visualizer/live-watcher.js';

const SAFE_RUN_ID_REGEX = /^[a-zA-Z0-9._-]+$/;

/**
 * Validates whether a parent `CouncilState` is eligible for Continuation (ADR-0006).
 * Only completed runs whose Verdict is `Dissent Report (Preserved Excused-Seat Objection)`
 * with quorum met, all active seats accepted, zero open objections, a frozen Candidate,
 * and at least one valid `preserved_excused` objection backed by an excused Seat qualify.
 *
 * @param {Object | null | undefined} parentState
 * @returns {{
 *   valid: boolean,
 *   errors: string[],
 *   candidate: Object | null,
 *   targetSeats: Object[],
 *   preservedObjections: Object[],
 *   priorAcceptedSeats: Object[]
 * }}
 */
export function validateContinuationEligibility(parentState) {
  const errors = [];
  if (!parentState || typeof parentState !== 'object' || Array.isArray(parentState)) {
    return {
      valid: false,
      errors: ['Parent CouncilState must be a non-null object.'],
      candidate: null,
      targetSeats: [],
      preservedObjections: [],
      priorAcceptedSeats: []
    };
  }

  if (normalizePhase(parentState.phase) !== 'completed') {
    errors.push(`Parent run must be in "completed" phase (got "${parentState.phase || 'unknown'}").`);
  }

  const verdict = parentState.verdict;
  if (!verdict || typeof verdict !== 'object') {
    errors.push('Parent run must have a finalized Verdict.');
  } else if (verdict.kind !== VERDICT_KINDS.DISSENT_PRESERVED_OBJECTION) {
    errors.push(
      `Continuation requires Verdict "${VERDICT_KINDS.DISSENT_PRESERVED_OBJECTION}" (got "${verdict.kind || 'none'}").`
    );
  }

  const candidate = parentState.candidate || verdict?.candidate || null;
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.summary !== 'string' ||
    !candidate.summary.trim() ||
    !Array.isArray(candidate.clauses) ||
    candidate.clauses.length === 0
  ) {
    errors.push('Parent run must contain a frozen Candidate with a summary and at least one clause.');
  }

  const seats = Array.isArray(parentState.seats) ? parentState.seats : null;
  if (!seats || seats.length === 0) {
    errors.push('Parent run must contain a valid Seat roster.');
  }

  const minQuorum =
    typeof parentState.minQuorum === 'number' && Number.isInteger(parentState.minQuorum) && parentState.minQuorum >= 1
      ? parentState.minQuorum
      : 2;
  const active = seats ? activeSeats({ seats }) : [];
  if (active.length < minQuorum) {
    errors.push(`Parent run active seats (${active.length}) are below minQuorum (${minQuorum}).`);
  }
  const nonAcceptedActive = active.filter((s) => s.status !== 'accepted');
  if (nonAcceptedActive.length > 0) {
    errors.push(
      `Parent run active seat(s) must all have "accepted" status (found ${nonAcceptedActive.map((s) => `${s.id}:${s.status}`).join(', ')}).`
    );
  }

  const objections = Array.isArray(parentState.objections) ? parentState.objections : [];
  const openObjs = objections.filter((o) => o && o.status === 'open');
  if (openObjs.length > 0) {
    errors.push(
      `Parent run still has ${openObjs.length} active open Objection(s); only preserved_excused Objections qualify.`
    );
  }

  const preservedObjections = objections.filter((o) => o && o.status === 'preserved_excused');
  if (preservedObjections.length === 0) {
    errors.push('Parent run has zero preserved_excused Objections eligible for Continuation.');
  }

  const targetSeatIdSet = new Set();
  for (const obj of preservedObjections) {
    const sid = typeof obj.seatId === 'string' ? obj.seatId.trim() : '';
    if (!sid) {
      errors.push(`Preserved Objection "${obj.id || 'unknown'}" is missing a valid seatId.`);
      continue;
    }
    const matchingSeat = seats ? seats.find((s) => s && s.id === sid) : null;
    if (!matchingSeat) {
      errors.push(`Preserved Objection "${obj.id || 'unknown'}" references unknown Seat "${sid}".`);
      continue;
    }
    if (matchingSeat.status !== 'excused') {
      errors.push(
        `Preserved Objection "${obj.id || 'unknown'}" references Seat "${sid}" with status "${matchingSeat.status}" (expected "excused").`
      );
      continue;
    }
    if (
      typeof matchingSeat.harness !== 'string' ||
      !matchingSeat.harness.trim() ||
      typeof matchingSeat.model !== 'string' ||
      !matchingSeat.model.trim()
    ) {
      errors.push(`Excused Seat "${sid}" is missing required harness/model identity metadata.`);
      continue;
    }
    targetSeatIdSet.add(sid);
  }

  const proofs = Array.isArray(parentState.proofs) ? parentState.proofs : [];
  const admittedProofs = proofs.filter((p) => p && (p.status === 'admitted' || p.status === 'partially_admitted'));
  if (admittedProofs.length === 0) {
    errors.push('Parent run must retain at least one admitted or partially_admitted Proof.');
  }

  const targetSeats = seats
    ? seats.filter((s) => s && s.status === 'excused' && targetSeatIdSet.has(s.id))
    : [];

  return {
    valid: errors.length === 0,
    errors,
    candidate,
    targetSeats,
    preservedObjections,
    priorAcceptedSeats: active
  };
}

/**
 * Builds an immutable Continuation `CouncilState` in the `confirming` (VOTING) phase
 * without mutating `parentState`.
 *
 * @param {Object} parentState
 * @param {Object} [options={}]
 * @param {string} [options.parentRunId]
 * @param {string} [options.rootRunId]
 * @param {number} [options.maxRetriesPerSeat]
 * @returns {Object} Fresh Continuation CouncilState
 */
export function createContinuationCouncilState(parentState, options = {}) {
  const eligibility = validateContinuationEligibility(parentState);
  if (!eligibility.valid) {
    throw new Error(`Ineligible parent run for Continuation: ${eligibility.errors.join(' ')}`);
  }

  const parentRunId =
    typeof options.parentRunId === 'string' && options.parentRunId.trim()
      ? options.parentRunId.trim()
      : (typeof parentState.runId === 'string' && parentState.runId.trim() ? parentState.runId.trim() : '');
  if (!parentRunId) {
    throw new Error('Continuation requires a non-empty parentRunId.');
  }
  const rootRunId =
    typeof options.rootRunId === 'string' && options.rootRunId.trim()
      ? options.rootRunId.trim()
      : (typeof parentState.rootRunId === 'string' && parentState.rootRunId.trim()
          ? parentState.rootRunId.trim()
          : parentRunId);

  const next = cloneState(parentState);
  next.candidate =
    typeof structuredClone === 'function'
      ? structuredClone(eligibility.candidate)
      : JSON.parse(JSON.stringify(eligibility.candidate));
  const targetIdSet = new Set(eligibility.targetSeats.map((s) => s.id));
  const priorAcceptedIds = eligibility.priorAcceptedSeats.map((s) => s.id);
  const continuationTargetSeatIds = eligibility.targetSeats.map((s) => s.id);
  const inheritedTools = parentState.tools !== undefined ? parentState.tools : 'read-only';

  next.seats = (next.seats || []).map((seat) => {
    if (!seat || typeof seat !== 'object') return seat;
    if (targetIdSet.has(seat.id)) {
      const targetSeat = {
        ...seat,
        status: 'thinking',
        retries: 0,
        excusedReason: null,
        activeRetryDiagnostics: null,
        retryDiagnosticsHistory: [],
        tools: seat.tools !== undefined ? seat.tools : inheritedTools,
        ...(seat.excusedReason ? { priorExcusedReason: seat.excusedReason } : {})
      };
      delete targetSeat.faultReason;
      delete targetSeat.errorClass;
      return targetSeat;
    }
    const nonTarget = {
      ...seat,
      retries: 0,
      activeRetryDiagnostics: null,
      retryDiagnosticsHistory: []
    };
    delete nonTarget.faultReason;
    delete nonTarget.errorClass;
    return nonTarget;
  });

  if (typeof options.runId === 'string' && options.runId.trim()) {
    const requestedRunId = options.runId.trim();
    if (requestedRunId === parentRunId) {
      throw new Error(`Continuation runId "${requestedRunId}" must be distinct from parentRunId "${parentRunId}".`);
    }
    next.runId = requestedRunId;
  } else {
    next.runId = `${parentRunId}-cont-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
  }
  if (typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
    next.timeoutMs = options.timeoutMs;
  }
  if (
    typeof options.totalSeatBudgetMs === 'number' &&
    Number.isFinite(options.totalSeatBudgetMs) &&
    options.totalSeatBudgetMs > 0
  ) {
    next.totalSeatBudgetMs = options.totalSeatBudgetMs;
  }
  if (options.maxRetriesPerSeat !== undefined) {
    next.maxRetriesPerSeat = options.maxRetriesPerSeat;
  }

  next.phase = 'confirming';
  next.canonicalPhase = 'VOTING';
  next.phaseAlias = 'confirming';
  next.previousPhase = parentState.phase || 'completed';
  next.lastEventName = 'BEGIN_CONTINUATION';
  next.returnPhase = null;
  next.faultSeatId = null;
  next.verdict = null;
  next.runKind = 'continuation';
  next.parentRunId = parentRunId;
  next.rootRunId = rootRunId;
  next.continuationTargetSeatIds = Object.freeze([...continuationTargetSeatIds]);
  next.priorAcceptedSeatIds = Object.freeze([...priorAcceptedIds]);
  next.lastTransition = {
    ok: true,
    message: `Initialized Continuation from "${parentRunId}" (root "${rootRunId}") targeting seat(s): ${continuationTargetSeatIds.join(', ')}.`
  };
  next.history = [
    `[CONTINUATION] Initialized Continuation from parentRunId "${parentRunId}" (rootRunId "${rootRunId}") for seat(s): ${continuationTargetSeatIds.join(', ')}.`,
    ...(Array.isArray(next.history) ? next.history : [])
  ];

  return next;
}

function hydrateStateWithInitialConfig(state, initialConfig) {
  if (!state || typeof state !== 'object' || !initialConfig || typeof initialConfig !== 'object') {
    return state;
  }
  const hydrated = cloneState(state);
  if (!hydrated.cwd && typeof initialConfig.cwd === 'string' && initialConfig.cwd.trim()) {
    hydrated.cwd = initialConfig.cwd.trim();
  }
  const configSeats = Array.isArray(initialConfig.seats) ? initialConfig.seats : [];
  if (Array.isArray(hydrated.seats) && configSeats.length > 0) {
    hydrated.seats = hydrated.seats.map((seat) => {
      if (!seat || typeof seat !== 'object') return seat;
      const cfg = configSeats.find((c) => c && c.id === seat.id);
      if (!cfg) return seat;
      return {
        ...seat,
        ...(seat.tools === undefined && cfg.tools !== undefined ? { tools: cfg.tools } : {}),
        ...(seat.cwd === undefined && typeof cfg.cwd === 'string' && cfg.cwd.trim() ? { cwd: cfg.cwd.trim() } : {}),
        ...(seat.reasoningEffort === undefined && cfg.reasoningEffort !== undefined
          ? { reasoningEffort: cfg.reasoningEffort }
          : {}),
        ...(seat.timeoutMs === undefined && cfg.timeoutMs !== undefined ? { timeoutMs: cfg.timeoutMs } : {}),
        ...(seat.disableHooks === undefined && typeof cfg.disableHooks === 'boolean'
          ? { disableHooks: cfg.disableHooks }
          : {}),
        ...(seat.ignoreUserConfig === undefined && typeof cfg.ignoreUserConfig === 'boolean'
          ? { ignoreUserConfig: cfg.ignoreUserConfig }
          : {})
      };
    });
  }
  return hydrated;
}

function extractParentPayloadFromJson(parsed, sourcePath) {
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      throw new Error(`Snapshot array file "${sourcePath}" is empty.`);
    }
    const last = parsed[parsed.length - 1];
    if (!last || typeof last !== 'object' || !last.stateSnapshot) {
      throw new Error(`Snapshot array file "${sourcePath}" does not end with a valid stateSnapshot.`);
    }
    return {
      state: last.stateSnapshot,
      runId: last.runId || last.stateSnapshot.runId || null,
      parentRunId: last.parentRunId || last.stateSnapshot.parentRunId || null,
      rootRunId: last.rootRunId || last.stateSnapshot.rootRunId || null,
      initialConfig: null
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid parent snapshot JSON in "${sourcePath}".`);
  }

  if (parsed.state && typeof parsed.state === 'object') {
    return {
      state: parsed.state,
      runId: parsed.runId || parsed.state.runId || null,
      parentRunId: parsed.parentRunId || parsed.state.parentRunId || parsed.verdict?.parentRunId || null,
      rootRunId: parsed.rootRunId || parsed.state.rootRunId || parsed.verdict?.rootRunId || null,
      initialConfig: parsed.initialConfig || null
    };
  }

  if (parsed.stateSnapshot && typeof parsed.stateSnapshot === 'object') {
    return {
      state: parsed.stateSnapshot,
      runId: parsed.runId || parsed.stateSnapshot.runId || null,
      parentRunId: parsed.parentRunId || parsed.stateSnapshot.parentRunId || null,
      rootRunId: parsed.rootRunId || parsed.stateSnapshot.rootRunId || null,
      initialConfig: parsed.initialConfig || null
    };
  }

  if (parsed.currentState && typeof parsed.currentState === 'object') {
    return {
      state: parsed.currentState,
      runId: parsed.runId || parsed.currentState.runId || null,
      parentRunId: parsed.parentRunId || parsed.currentState.parentRunId || null,
      rootRunId: parsed.rootRunId || parsed.currentState.rootRunId || null,
      initialConfig: parsed.initialConfig || null
    };
  }

  if (typeof parsed.phase === 'string' && Array.isArray(parsed.seats)) {
    return {
      state: parsed,
      runId: parsed.runId || null,
      parentRunId: parsed.parentRunId || parsed.verdict?.parentRunId || null,
      rootRunId: parsed.rootRunId || parsed.verdict?.rootRunId || null,
      initialConfig: null
    };
  }

  throw new Error(`Unrecognized Council snapshot format in "${sourcePath}". Expected state, stateSnapshot, or currentState.`);
}

/**
 * Resolves and reads a parent run bundle or JSON snapshot without modifying the source artifact.
 *
 * @param {string} target - Run ID or file path to snapshot/run bundle
 * @param {Object} [options={}]
 * @param {string} [options.outputDir]
 * @param {string} [options.cwd]
 * @returns {{ sourcePath: string, parentRunId: string, rootRunId: string, state: Object, initialConfig: Object | null }}
 */
export function loadContinuationParent(target, options = {}) {
  const rawTarget = typeof target === 'string' ? target.trim() : '';
  if (!rawTarget) {
    throw new Error('Continuation target <runId|snapshot-path> is required.');
  }

  const baseCwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const outputDir = options.outputDir ? path.resolve(options.outputDir) : DEFAULT_OUTPUT_DIR;
  let sourcePath = null;

  const directPath = path.resolve(baseCwd, rawTarget);
  if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    sourcePath = directPath;
  } else if (
    SAFE_RUN_ID_REGEX.test(rawTarget) &&
    !rawTarget.includes('..') &&
    !rawTarget.includes('/') &&
    !rawTarget.includes('\\')
  ) {
    const candidates = [
      path.join(outputDir, `${rawTarget}.js`),
      path.join(outputDir, `${rawTarget}.json`),
      ...(rawTarget.endsWith('.js') || rawTarget.endsWith('.json')
        ? [path.join(outputDir, rawTarget)]
        : [])
    ];
    for (const candidatePath of candidates) {
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
        sourcePath = candidatePath;
        break;
      }
    }
  }

  if (!sourcePath) {
    throw new Error(`Parent run or snapshot not found: "${rawTarget}".`);
  }

  const content = fs.readFileSync(sourcePath, 'utf8');
  let extracted;

  if (sourcePath.toLowerCase().endsWith('.js')) {
    const bundle = parseRunBundleJs(content);
    if (!bundle?.parsedRun?.currentState) {
      throw new Error(`Malformed Council run bundle in "${sourcePath}": missing embedded currentState.`);
    }
    extracted = {
      state: bundle.parsedRun.currentState,
      runId: bundle.parsedRun.runId,
      parentRunId: bundle.parsedRun.parentRunId || bundle.parsedRun.currentState.parentRunId || null,
      rootRunId: bundle.parsedRun.rootRunId || bundle.parsedRun.currentState.rootRunId || null,
      initialConfig: bundle.parsedRun.initialConfig || null
    };
  } else {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new Error(`Malformed JSON in snapshot "${sourcePath}": ${err.message}`);
    }
    extracted = extractParentPayloadFromJson(parsed, sourcePath);
  }

  const hydratedState = hydrateStateWithInitialConfig(extracted.state, extracted.initialConfig);
  const baseNameId = path.basename(sourcePath).replace(/\.(?:js|json)$/i, '');
  const resolvedParentRunId =
    (typeof extracted.runId === 'string' && extracted.runId.trim() ? extracted.runId.trim() : '') ||
    baseNameId;
  const resolvedRootRunId =
    (typeof extracted.rootRunId === 'string' && extracted.rootRunId.trim()
      ? extracted.rootRunId.trim()
      : '') || resolvedParentRunId;

  return {
    sourcePath,
    parentRunId: resolvedParentRunId,
    rootRunId: resolvedRootRunId,
    state: hydratedState,
    initialConfig: extracted.initialConfig
  };
}
