import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcIndexPath = path.resolve(__dirname, '../../src/index.js');

export const VALID_PROOF_KINDS = ['check', 'citation', 'benchmark', 'derivation'];

export const PHASES = {
  ROSTER_CONFIGURATION: 'preflight',
  DISCOVERY: 'clarifying',
  DELIBERATION: 'reviewing',
  JUDGE_AUDIT_SYNTHESIS: 'judging',
  VOTING: 'confirming',
  CONSENSUS_REACHED: 'completed',
  DISSENT_REPORT: 'completed',
  ROUND_TIMEOUT: 'completed',
  RECOVERY: 'seat_fault',
  // Canonical uppercase mappings
  preflight: 'preflight',
  clarifying: 'clarifying',
  reviewing: 'reviewing',
  judging: 'judging',
  confirming: 'confirming',
  completed: 'completed',
  seat_fault: 'seat_fault',
  judge_fault: 'judge_fault'
};

export const EVENTS = {
  ADD_SEAT: 'ADD_SEAT',
  SEAT_TELEMETRY: 'SEAT_TELEMETRY',
  START_CLARIFYING: 'START_CLARIFYING',
  PUBLISH_CLARIFICATION: 'PUBLISH_CLARIFICATION',
  BEGIN_ROUND: 'BEGIN_ROUND',
  SUBMIT_PROOF: 'SUBMIT_PROOF',
  START_JUDGING: 'START_JUDGING',
  JUDGE_AUDIT_AND_SYNTHESIZE: 'JUDGE_AUDIT_AND_SYNTHESIZE',
  CAST_VOTE: 'CAST_VOTE',
  WITHDRAW_OBJECTION: 'WITHDRAW_OBJECTION',
  SEAT_FAULT: 'SEAT_FAULT',
  RETRY_SEAT: 'RETRY_SEAT',
  EXCUSE_SEAT: 'EXCUSE_SEAT',
  JUDGE_FAULT: 'JUDGE_FAULT',
  RETRY_JUDGE: 'RETRY_JUDGE',
  EVALUATE_ROUND: 'EVALUATE_ROUND'
};

let productionModule = null;

if (fs.existsSync(srcIndexPath)) {
  try {
    productionModule = await import(srcIndexPath);
  } catch (err) {
    console.warn('[council-loader] Warning: failed to load src/index.js:', err.message);
  }
}

if (!productionModule) {
  throw new Error('[council-loader] src/index.js failed to load and prototype fallback has been removed.');
}

export const isUsingProductionSrc = Boolean(productionModule);

export function isPhaseMatch(phaseA, phaseB) {
  if (productionModule) {
    if (typeof productionModule.isPhaseMatch === 'function' && productionModule.isPhaseMatch(phaseA, phaseB)) {
      return true;
    }
    if (typeof productionModule.toPrototypePhase === 'function') {
      if (productionModule.toPrototypePhase(phaseA) === productionModule.toPrototypePhase(phaseB)) {
        return true;
      }
    }
  }
  const normA = (PHASES[phaseA] || phaseA).toLowerCase();
  const normB = (PHASES[phaseB] || phaseB).toLowerCase();
  return normA === normB;
}

export function assertPhase(state, expectedPhase) {
  const actual = state.phase;
  if (!isPhaseMatch(actual, expectedPhase)) {
    throw new Error(`Expected phase "${expectedPhase}", but actual phase was "${actual}"`);
  }
}

/**
 * Structural Proof Validator (PROJECT.md contract)
 */
export function validateProof(input) {
  if (productionModule && typeof productionModule.validateProof === 'function') {
    return productionModule.validateProof(input);
  }
  const errors = [];
  if (!input) {
    return { valid: false, errors: ['Proof input is required.'] };
  }
  if (!input.scope || !input.scope.trim()) {
    errors.push('Structural Proof Guard: "scope" condition is required.');
  }
  if (!input.kind || VALID_PROOF_KINDS.indexOf(input.kind) === -1) {
    errors.push('Structural Proof Guard: "kind" must be check, citation, benchmark, or derivation.');
  }
  if (!input.source || !input.source.trim()) {
    errors.push('Structural Proof Guard: verifiable "source" is required; bare opinions are forbidden.');
  }
  if (!input.statement || !input.statement.trim()) {
    errors.push('Structural Proof Guard: falsifiable "statement" is required.');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Candidate Proof-Binding Guard (PROJECT.md contract)
 */
export function validateCandidateClauses(clauses, admittedProofIds) {
  if (productionModule && typeof productionModule.validateCandidateClauses === 'function') {
    return productionModule.validateCandidateClauses(clauses, admittedProofIds);
  }
  const errors = [];
  if (!Array.isArray(clauses) || clauses.length === 0) {
    errors.push('Judge Candidate Guard: Candidate requires at least one clause.');
    return { valid: false, errors };
  }
  const admittedSet = admittedProofIds instanceof Set ? admittedProofIds : new Set(admittedProofIds || []);
  for (let i = 0; i < clauses.length; i++) {
    const cl = clauses[i];
    if (!cl.citedProofIds || cl.citedProofIds.length === 0) {
      errors.push('Judge Candidate Guard: Clause "' + (cl.context || 'Clause ' + (i + 1)) + '" cites no Proof IDs.');
      continue;
    }
    for (let j = 0; j < cl.citedProofIds.length; j++) {
      const pid = cl.citedProofIds[j];
      if (!admittedSet.has(pid)) {
        errors.push('Judge Candidate Guard: Clause "' + (cl.context || 'Clause ' + (i + 1)) + '" cites unverified Proof "' + pid + '".');
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Objection Immutability Guard (ADR 0003 Vulnerability Fix)
 */
export function canWithdrawObjection(state, objectionId, seatId) {
  if (productionModule && typeof productionModule.canWithdrawObjection === 'function') {
    return productionModule.canWithdrawObjection(state, objectionId, seatId);
  }
  const obj = (state.objections || []).find((o) => o.id === objectionId);
  if (!obj) {
    return { allowed: false, reason: 'Objection "' + objectionId + '" not found.' };
  }
  if (obj.status === 'preserved_excused') {
    return { allowed: false, reason: 'Objection is locked as preserved_excused and cannot be withdrawn.' };
  }
  const seat = (state.seats || []).find((s) => s.id === seatId);
  if (!seat || seat.status === 'excused') {
    return { allowed: false, reason: 'Excused seat cannot withdraw objections.' };
  }
  if (obj.seatId !== seatId) {
    return { allowed: false, reason: 'Objection Ownership Guard: Seat "' + seatId + '" cannot withdraw Objection "' + obj.id + '" owned by "' + obj.seatId + '".' };
  }
  return { allowed: true };
}

/**
 * Create initial Council state
 */
export function createInitialCouncilState(config) {
  if (productionModule && typeof productionModule.createInitialCouncilState === 'function') {
    return productionModule.createInitialCouncilState(config);
  }
  throw new Error('[council-loader] createInitialCouncilState is unavailable');
}

/**
 * Pure transition reducer
 */
export function transitionCouncil(state, event) {
  if (productionModule && typeof productionModule.transitionCouncil === 'function') {
    return productionModule.transitionCouncil(state, event);
  }
  throw new Error('[council-loader] transitionCouncil is unavailable');
}

/**
 * Graph introspection
 */
export function getDependencyAndStateGraph(state) {
  if (productionModule && typeof productionModule.getDependencyAndStateGraph === 'function') {
    return productionModule.getDependencyAndStateGraph(state);
  }
  throw new Error('[council-loader] getDependencyAndStateGraph is unavailable');
}
