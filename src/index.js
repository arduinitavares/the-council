/**
 * The Council — Production Consensus Deliberation Engine
 * ESM Module (Node >= 22)
 *
 * Core library entry point exporting state machine reducer, types,
 * proof validator, guards, and domain contracts.
 */

export * from './types.js';
export * from './proofs/validator.js';
export * from './machine/index.js';
