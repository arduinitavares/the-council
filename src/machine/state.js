/**
 * Production State Factory and State Helpers for The Council State Machine
 * ESM Module (Node >= 22)
 */

import {
  COUNCIL_PHASES,
  DEFAULT_COUNCIL_CONFIG,
  normalizePhase,
  toCanonicalPhase,
  isPhaseMatch,
  toPrototypePhase
} from './constants.js';

/**
 * Creates the initial CouncilState from configuration.
 * @param {Object} [config]
 * @returns {Object} CouncilState
 */
export function createInitialCouncilState(config = {}) {
  const cfg = config || {};
  const defaultJudge = DEFAULT_COUNCIL_CONFIG.defaultJudge;

  const rawJudge = cfg.judge || {};
  const judgeTools = rawJudge.tools || cfg.tools || defaultJudge.tools || 'read-only';
  const judgeTimeoutMs = typeof rawJudge.timeoutMs === 'number' && rawJudge.timeoutMs > 0
    ? rawJudge.timeoutMs
    : (typeof cfg.timeoutMs === 'number' && cfg.timeoutMs > 0 ? cfg.timeoutMs : undefined);
  const judgeDisableHooks = rawJudge.disableHooks !== undefined ? rawJudge.disableHooks : cfg.disableHooks;
  const judgeIgnoreUserConfig = rawJudge.ignoreUserConfig !== undefined ? rawJudge.ignoreUserConfig : cfg.ignoreUserConfig;
  const judgeCwd = rawJudge.cwd !== undefined ? rawJudge.cwd : cfg.cwd;
  const judge = {
    id: rawJudge.id || defaultJudge.id,
    harness: rawJudge.harness || defaultJudge.harness,
    model: rawJudge.model || defaultJudge.model,
    soul: rawJudge.soul || defaultJudge.soul,
    status: 'idle',
    retries: 0,
    tools: judgeTools,
    ...(typeof judgeTimeoutMs === 'number' ? { timeoutMs: judgeTimeoutMs } : {}),
    ...(typeof judgeDisableHooks === 'boolean' ? { disableHooks: judgeDisableHooks } : {}),
    ...(typeof judgeIgnoreUserConfig === 'boolean' ? { ignoreUserConfig: judgeIgnoreUserConfig } : {}),
    ...(typeof judgeCwd === 'string' && judgeCwd.trim() ? { cwd: judgeCwd.trim() } : {})
  };

  const seats = (cfg.seats || []).map((s) => {
    const seatTools = s.tools || cfg.tools || 'read-only';
    const seatTimeoutMs = typeof s.timeoutMs === 'number' && s.timeoutMs > 0
      ? s.timeoutMs
      : (typeof cfg.timeoutMs === 'number' && cfg.timeoutMs > 0 ? cfg.timeoutMs : undefined);
    const seatDisableHooks = s.disableHooks !== undefined ? s.disableHooks : cfg.disableHooks;
    const seatIgnoreUserConfig = s.ignoreUserConfig !== undefined ? s.ignoreUserConfig : cfg.ignoreUserConfig;
    const seatCwd = s.cwd !== undefined ? s.cwd : cfg.cwd;
    return {
      id: s.id,
      harness: s.harness,
      model: s.model,
      soul: s.soul,
      status: 'idle',
      retries: 0,
      excusedReason: null,
      tools: seatTools,
      ...(seatTimeoutMs !== undefined ? { timeoutMs: seatTimeoutMs } : {}),
      ...(typeof seatDisableHooks === 'boolean' ? { disableHooks: seatDisableHooks } : {}),
      ...(typeof seatIgnoreUserConfig === 'boolean' ? { ignoreUserConfig: seatIgnoreUserConfig } : {}),
      ...(typeof seatCwd === 'string' && seatCwd.trim() ? { cwd: seatCwd.trim() } : {})
    };
  });

  const initialPhase = cfg.phase ? normalizePhase(cfg.phase) : 'preflight';

  const evidence = Object.freeze(
    (Array.isArray(cfg.evidence) ? cfg.evidence : []).map((item, idx) =>
      Object.freeze({
        id: typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `E${idx + 1}`,
        label: String(item?.label || '').trim(),
        source: String(item?.source || '').trim(),
        text: String(item?.text || '').trim()
      })
    )
  );

  const clarifications = (Array.isArray(cfg.clarifications) ? cfg.clarifications : []).map((item, idx) => {
    if (typeof item === 'string') {
      return { batch: idx + 1, answer: item.trim() };
    }
    const labelStr = typeof item?.label === 'string' ? item.label.trim() : '';
    const sourceStr = typeof item?.source === 'string' ? item.source.trim() : '';
    const textStr = typeof item?.text === 'string' ? item.text.trim() : '';
    const hasAnswer = typeof item?.answer === 'string' && item.answer.trim().length > 0;
    const answer = hasAnswer ? item.answer.trim() : `[${labelStr}] (Source: ${sourceStr}): ${textStr}`;
    return {
      batch: Number.isInteger(item?.batch) && item.batch >= 1 ? item.batch : idx + 1,
      answer,
      ...(typeof item?.question === 'string' && item.question.trim() ? { question: item.question.trim() } : {}),
      ...(labelStr ? { label: labelStr } : {}),
      ...(sourceStr ? { source: sourceStr } : {}),
      ...(textStr ? { text: textStr } : {})
    };
  });

  const baseMaxClarificationBatches = cfg.maxClarificationBatches ?? DEFAULT_COUNCIL_CONFIG.maxClarificationBatches;

  return {
    topic: cfg.topic || DEFAULT_COUNCIL_CONFIG.topic,
    ...(typeof cfg.cwd === 'string' && cfg.cwd.trim() ? { cwd: cfg.cwd.trim() } : {}),
    phase: initialPhase,
    canonicalPhase: toCanonicalPhase(initialPhase),
    phaseAlias: toPrototypePhase(initialPhase),
    previousPhase: null,
    lastEventName: 'INIT',
    returnPhase: null,
    faultSeatId: null,
    round: 0,
    maxRounds: cfg.maxRounds ?? DEFAULT_COUNCIL_CONFIG.maxRounds,
    clarificationBatch: 0,
    maxClarificationBatches: Math.max(baseMaxClarificationBatches, clarifications.length),
    minQuorum: cfg.minQuorum ?? DEFAULT_COUNCIL_CONFIG.minQuorum,
    maxRetriesPerSeat: cfg.maxRetriesPerSeat ?? DEFAULT_COUNCIL_CONFIG.maxRetriesPerSeat,
    evidence,
    clarifications,
    judge,
    seats,
    proofs: [],
    candidate: null,
    objections: [],
    verdict: null,
    lastTransition: { ok: true, message: 'Initialized Council state machine in Roster Configuration.' },
    history: ['[INIT] Council initialized in roster configuration state.']
  };
}

/**
 * Deep-clones the CouncilState deterministically.
 * Uses native structuredClone (Node >= 17).
 * @param {Object} state
 * @returns {Object} cloned state
 */
export function cloneState(state) {
  const cloned =
    typeof structuredClone === 'function'
      ? structuredClone(state)
      : JSON.parse(JSON.stringify(state));
  if (cloned && Array.isArray(cloned.evidence)) {
    cloned.evidence = Object.freeze(cloned.evidence.map((item) => Object.freeze(item)));
  }
  return cloned;
}

/**
 * Returns all active seats (seats whose status is not 'excused').
 * @param {Object} state
 * @returns {Array<Object>} active seats
 */
export function activeSeats(state) {
  if (!state || !Array.isArray(state.seats)) return [];
  return state.seats.filter((s) => s && s.status !== 'excused');
}

/**
 * Returns all excused seats.
 * @param {Object} state
 * @returns {Array<Object>} excused seats
 */
export function excusedSeats(state) {
  if (!state || !Array.isArray(state.seats)) return [];
  return state.seats.filter((s) => s && s.status === 'excused');
}

/**
 * Checks if the active seat count meets or exceeds the minimum quorum.
 * @param {Object} state
 * @returns {boolean}
 */
export function isQuorumSatisfied(state) {
  if (!state) return false;
  return activeSeats(state).length >= (state.minQuorum ?? DEFAULT_COUNCIL_CONFIG.minQuorum);
}

/**
 * Returns all objections with status === 'open'.
 * @param {Object} state
 * @returns {Array<Object>}
 */
export function getOpenObjections(state) {
  if (!state || !Array.isArray(state.objections)) return [];
  return state.objections.filter((o) => o && o.status === 'open');
}

/**
 * Returns all objections with status === 'preserved_excused'.
 * @param {Object} state
 * @returns {Array<Object>}
 */
export function getPreservedObjections(state) {
  if (!state || !Array.isArray(state.objections)) return [];
  return state.objections.filter((o) => o && o.status === 'preserved_excused');
}

/**
 * Returns admitted proofs up to the current or specified round.
 * @param {Object} state
 * @param {number} [round] optional round filter
 * @returns {Array<Object>}
 */
export function getAdmittedProofs(state, round) {
  if (!state || !Array.isArray(state.proofs)) return [];
  return state.proofs.filter(
    (p) =>
      p &&
      (p.status === 'admitted' || p.status === 'partially_admitted') &&
      (round === undefined || p.round === round)
  );
}

/**
 * Finds a seat by id.
 * @param {Object} state
 * @param {string} seatId
 * @returns {Object|undefined}
 */
export function findSeat(state, seatId) {
  if (!state || !Array.isArray(state.seats) || !seatId) return undefined;
  return state.seats.find((s) => s && s.id === seatId);
}

/**
 * Finds a proof by id.
 * @param {Object} state
 * @param {string} proofId
 * @returns {Object|undefined}
 */
export function findProof(state, proofId) {
  if (!state || !Array.isArray(state.proofs) || !proofId) return undefined;
  return state.proofs.find((p) => p && p.id === proofId);
}

/**
 * Resolves the status of a cited proof for causal link rendering.
 * @param {Object} state
 * @param {string} proofId
 * @returns {string}
 */
export function resolveCitedProofStatus(state, proofId) {
  const citedProof = findProof(state, proofId);
  return citedProof && citedProof.status ? citedProof.status : 'admitted';
}

/**
 * Finds an objection by id.
 * @param {Object} state
 * @param {string} objectionId
 * @returns {Object|undefined}
 */
export function findObjection(state, objectionId) {
  if (!state || !Array.isArray(state.objections) || !objectionId) return undefined;
  return state.objections.find((o) => o && o.id === objectionId);
}

const CANONICAL_TERMINAL_PHASES = new Set(['CONSENSUS_REACHED', 'DISSENT_REPORT', 'ROUND_TIMEOUT']);

/**
 * Checks if current state phase matches the given phase name (canonical or alias).
 * Disambiguates canonical terminal phases and recovery sub-states
 * while supporting querying by either canonical phase or prototype alias.
 * @param {Object} state
 * @param {string} phaseName
 * @returns {boolean}
 */
export function isPhase(state, phaseName) {
  if (!state || !phaseName) return false;
  const target = String(phaseName).trim();
  if (!target) return false;
  const targetUpper = target.toUpperCase();

  // 1. Direct match with canonicalPhase
  if (state.canonicalPhase && state.canonicalPhase.toUpperCase() === targetUpper) {
    return true;
  }

  // 2. Disambiguate terminal canonical phases:
  // If target is specifically CONSENSUS_REACHED, DISSENT_REPORT, or ROUND_TIMEOUT,
  // but state.canonicalPhase did not match it, return false.
  if (CANONICAL_TERMINAL_PHASES.has(targetUpper)) {
    return false;
  }

  // 3. Disambiguate recovery sub-phases: judge_fault vs seat_fault
  if (target.toLowerCase() === 'judge_fault') {
    return state.phase === 'judge_fault' || state.phaseAlias === 'judge_fault';
  }
  if (target.toLowerCase() === 'seat_fault') {
    return state.phase === 'seat_fault' || state.phaseAlias === 'seat_fault';
  }

  // 4. General resolution via isPhaseMatch using state.phase or state.canonicalPhase
  return (
    isPhaseMatch(state.phase, phaseName) ||
    Boolean(state.canonicalPhase && isPhaseMatch(state.canonicalPhase, phaseName))
  );
}
