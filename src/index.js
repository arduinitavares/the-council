/**
 * The Council — Production Consensus Deliberation Engine
 * ESM Module (Node >= 22)
 *
 * Core library entry point exporting state machine reducer, types,
 * proof validator, guards, domain contracts, dynamic seats,
 * harness adapters, real-time telemetry, and engine coordinator.
 */

// Explicitly disambiguate primary domain constants
export { VALID_PROOF_KINDS, CANONICAL_PHASES } from './types.js';

export * from './types.js';
export * from './proofs/validator.js';
export * from './machine/index.js';
export * from './seats/index.js';
export * from './harness/index.js';
export * from './telemetry/index.js';
export * from './engine/index.js';
export { VisualizerLiveWatcher } from './visualizer/live-watcher.js';
export { runCli } from './cli/index.js';
