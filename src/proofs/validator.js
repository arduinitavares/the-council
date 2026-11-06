/**
 * @fileoverview Pure structural proof validator for The Council.
 * Enforces verifiable proof criteria: non-empty scope, valid kind, non-empty source,
 * and falsifiable statement. Bare opinions without a source are strictly forbidden.
 */

import { VALID_PROOF_KINDS } from '../types.js';

/**
 * Validates a structured proof input against the Council's proof rules:
 * - scope: non-empty trimmed string defining context boundary.
 * - kind: one of 'check', 'citation', 'benchmark', 'derivation'.
 * - source: non-empty trimmed string citing verifiable evidence (bare opinions forbidden).
 * - statement: non-empty trimmed string stating a falsifiable assertion.
 *
 * @param {import('../types.js').ProofInput} input - Proof data to validate.
 * @returns {import('../types.js').ProofValidationResult} Result with valid flag and error messages.
 */
export function validateProof(input) {
  const errors = [];

  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      errors: ['Structural Proof Guard: proof input must be an object.']
    };
  }

  // 1. Scope condition check
  if (typeof input.scope !== 'string' || !input.scope.trim()) {
    errors.push('Structural Proof Guard: "scope" condition is required.');
  }

  // 2. Kind check
  if (typeof input.kind !== 'string' || !VALID_PROOF_KINDS.includes(input.kind)) {
    errors.push('Structural Proof Guard: "kind" must be check, citation, benchmark, or derivation.');
  }

  // 3. Source check (verifiable evidence required; bare opinions forbidden)
  if (typeof input.source !== 'string' || !input.source.trim()) {
    errors.push('Structural Proof Guard: verifiable "source" is required; bare opinions are forbidden.');
  }

  // 4. Statement check (falsifiable assertion required)
  if (typeof input.statement !== 'string' || !input.statement.trim()) {
    errors.push('Structural Proof Guard: falsifiable "statement" is required.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Checks if a given string is an admitted ProofKind.
 * @param {string} kind
 * @returns {boolean}
 */
export function isValidProofKind(kind) {
  return typeof kind === 'string' && VALID_PROOF_KINDS.includes(kind);
}

/**
 * Sanitizes proof input fields by trimming whitespace.
 * @param {import('../types.js').ProofInput} input
 * @returns {import('../types.js').ProofInput}
 */
export function sanitizeProofInput(input) {
  if (!input || typeof input !== 'object') return input;
  return {
    ...input,
    scope: typeof input.scope === 'string' ? input.scope.trim() : '',
    kind: input.kind,
    source: typeof input.source === 'string' ? input.source.trim() : '',
    statement: typeof input.statement === 'string' ? input.statement.trim() : ''
  };
}

/**
 * Formats a valid proof input into a full Proof record.
 * @param {import('../types.js').ProofInput} input
 * @param {{ round: number; seatId: string; idIndex: number }} meta
 * @returns {import('../types.js').Proof}
 */
export function formatProofRecord(input, meta) {
  const clean = sanitizeProofInput(input);
  return {
    id: clean.id || ('P' + meta.idIndex),
    round: typeof clean.round === 'number' ? clean.round : meta.round,
    seatId: clean.seatId || meta.seatId,
    scope: clean.scope,
    kind: clean.kind,
    source: clean.source,
    statement: clean.statement,
    status: 'pending',
    judgeNote: null
  };
}
