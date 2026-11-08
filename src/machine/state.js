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
  const judge = {
    id: rawJudge.id || defaultJudge.id,
    harness: rawJudge.harness || defaultJudge.harness,
    model: rawJudge.model || defaultJudge.model,
    soul: rawJudge.soul || defaultJudge.soul,
    status: 'idle',
    retries: 0,
    tools: judgeTools,
    ...(judgeTimeoutMs !== undefined ? { timeoutMs: judgeTimeoutMs } : {})
  };

  const seats = (cfg.seats || []).map((s) => {
    const seatTools = s.tools || cfg.tools || 'read-only';
    const seatTimeoutMs = typeof s.timeoutMs === 'number' && s.timeoutMs > 0
      ? s.timeoutMs
      : (typeof cfg.timeoutMs === 'number' && cfg.timeoutMs > 0 ? cfg.timeoutMs : undefined);
    return {
      id: s.id,
      harness: s.harness,
      model: s.model,
      soul: s.soul,
      status: 'idle',
      retries: 0,
      excusedReason: null,
      tools: seatTools,
      ...(seatTimeoutMs !== undefined ? { timeoutMs: seatTimeoutMs } : {})
    };
  });

  const initialPhase = cfg.phase ? normalizePhase(cfg.phase) : 'preflight';

  return {
    topic: cfg.topic || DEFAULT_COUNCIL_CONFIG.topic,
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
    maxClarificationBatches: cfg.maxClarificationBatches ?? DEFAULT_COUNCIL_CONFIG.maxClarificationBatches,
    minQuorum: cfg.minQuorum ?? DEFAULT_COUNCIL_CONFIG.minQuorum,
    maxRetriesPerSeat: cfg.maxRetriesPerSeat ?? DEFAULT_COUNCIL_CONFIG.maxRetriesPerSeat,
    clarifications: [],
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
  if (typeof structuredClone === 'function') {
    return structuredClone(state);
  }
  return JSON.parse(JSON.stringify(state));
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
    (p) => p && p.status === 'admitted' && (round === undefined || p.round === round)
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
