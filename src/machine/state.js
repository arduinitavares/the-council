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
  const judge = {
    id: rawJudge.id || defaultJudge.id,
    harness: rawJudge.harness || defaultJudge.harness,
    model: rawJudge.model || defaultJudge.model,
    soul: rawJudge.soul || defaultJudge.soul,
    status: 'idle',
    retries: 0
  };

  const seats = (cfg.seats || []).map((s) => ({
    id: s.id,
    harness: s.harness,
    model: s.model,
    soul: s.soul,
    status: 'idle',
    retries: 0,
    excusedReason: null
  }));

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
  return (state.seats || []).filter((s) => s.status !== 'excused');
}

/**
 * Returns all excused seats.
 * @param {Object} state
 * @returns {Array<Object>} excused seats
 */
export function excusedSeats(state) {
  return (state.seats || []).filter((s) => s.status === 'excused');
}

/**
 * Checks if the active seat count meets or exceeds the minimum quorum.
 * @param {Object} state
 * @returns {boolean}
 */
export function isQuorumSatisfied(state) {
  return activeSeats(state).length >= (state.minQuorum ?? DEFAULT_COUNCIL_CONFIG.minQuorum);
}

/**
 * Returns all objections with status === 'open'.
 * @param {Object} state
 * @returns {Array<Object>}
 */
export function getOpenObjections(state) {
  return (state.objections || []).filter((o) => o.status === 'open');
}

/**
 * Returns all objections with status === 'preserved_excused'.
 * @param {Object} state
 * @returns {Array<Object>}
 */
export function getPreservedObjections(state) {
  return (state.objections || []).filter((o) => o.status === 'preserved_excused');
}

/**
 * Returns admitted proofs up to the current or specified round.
 * @param {Object} state
 * @param {number} [round] optional round filter
 * @returns {Array<Object>}
 */
export function getAdmittedProofs(state, round) {
  return (state.proofs || []).filter(
    (p) => p.status === 'admitted' && (round === undefined || p.round === round)
  );
}

/**
 * Finds a seat by id.
 * @param {Object} state
 * @param {string} seatId
 * @returns {Object|undefined}
 */
export function findSeat(state, seatId) {
  return (state.seats || []).find((s) => s.id === seatId);
}

/**
 * Finds a proof by id.
 * @param {Object} state
 * @param {string} proofId
 * @returns {Object|undefined}
 */
export function findProof(state, proofId) {
  return (state.proofs || []).find((p) => p.id === proofId);
}

/**
 * Finds an objection by id.
 * @param {Object} state
 * @param {string} objectionId
 * @returns {Object|undefined}
 */
export function findObjection(state, objectionId) {
  return (state.objections || []).find((o) => o.id === objectionId);
}

/**
 * Checks if current state phase matches the given phase name (canonical or alias).
 * @param {Object} state
 * @param {string} phaseName
 * @returns {boolean}
 */
export function isPhase(state, phaseName) {
  return isPhaseMatch(state.phase, phaseName);
}
