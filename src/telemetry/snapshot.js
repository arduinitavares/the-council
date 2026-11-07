/**
 * @fileoverview Deterministic State Snapshot Generator for The Council.
 * ESM Module (Node >= 22). Zero external dependencies.
 *
 * Produces immutable, serializable state snapshots capturing:
 * { id, sequence, timestamp, event, stateSnapshot, metrics }
 * Supports clock injection for deterministic replay and verification.
 */

import { cloneState, activeSeats } from '../machine/state.js';
import { toCanonicalPhase } from '../machine/constants.js';

/**
 * @typedef {Object} SnapshotMetrics
 * @property {number} round - Deliberation round index.
 * @property {string} phase - Current state phase.
 * @property {string} canonicalPhase - Canonical state phase.
 * @property {number} activeSeatCount - Active non-excused seats.
 * @property {number} excusedSeatCount - Excused seats.
 * @property {number} proofCount - Total submitted proofs.
 * @property {number} admittedProofCount - Admitted proofs.
 * @property {number} openObjectionCount - Open objections.
 * @property {number} preservedObjectionCount - Preserved excused objections.
 * @property {boolean} hasVerdict - True if deliberation finished.
 * @property {string | null} verdictKind - Verdict kind or null.
 */

/**
 * @typedef {Object} CouncilSnapshot
 * @property {string} id - Unique snapshot identifier (e.g. "snap-1-BEGIN_ROUND").
 * @property {number} sequence - Monotonic 0-based sequence number.
 * @property {string} timestamp - ISO-8601 UTC timestamp.
 * @property {Object} event - Frozen copy of triggering event.
 * @property {Object} stateSnapshot - Deeply cloned, frozen CouncilState.
 * @property {SnapshotMetrics} metrics - High-level metrics for fast filtering.
 */

/**
 * Creates a deterministic state snapshot.
 * @param {Object} event - The CouncilEvent that triggered the transition.
 * @param {Object} state - The resulting CouncilState.
 * @param {Object} [options]
 * @param {number} [options.sequence=0] - Monotonic sequence index.
 * @param {string} [options.timestamp] - Explicit timestamp (overrides clock).
 * @param {() => string} [options.clock] - Timestamp provider function.
 * @returns {Readonly<CouncilSnapshot>}
 */
export function createSnapshot(event, state, options = {}) {
  if (!state || typeof state !== 'object') {
    throw new Error('createSnapshot requires a valid CouncilState object.');
  }

  const sequence = typeof options.sequence === 'number' ? options.sequence : 0;
  const timestamp = options.timestamp || (options.clock ? options.clock() : new Date().toISOString());
  const eventCopy = event ? JSON.parse(JSON.stringify(event)) : { type: 'UNKNOWN' };
  const stateCopy = cloneState(state);

  const active = activeSeats(stateCopy);
  const excused = (stateCopy.seats || []).filter((s) => s.status === 'excused');
  const proofs = stateCopy.proofs || [];
  const admitted = proofs.filter((p) => p.status === 'admitted');
  const openObjs = (stateCopy.objections || []).filter((o) => o.status === 'open');
  const preservedObjs = (stateCopy.objections || []).filter((o) => o.status === 'preserved_excused');

  const metrics = Object.freeze({
    round: stateCopy.round || 0,
    phase: stateCopy.phase,
    canonicalPhase: toCanonicalPhase(stateCopy.phase, stateCopy.faultSeatId ? 'seat_fault' : undefined, stateCopy.verdict?.kind),
    activeSeatCount: active.length,
    excusedSeatCount: excused.length,
    proofCount: proofs.length,
    admittedProofCount: admitted.length,
    openObjectionCount: openObjs.length,
    preservedObjectionCount: preservedObjs.length,
    hasVerdict: Boolean(stateCopy.verdict),
    verdictKind: stateCopy.verdict ? stateCopy.verdict.kind : null
  });

  const snapshotId = `snap-${sequence}-${eventCopy.type || 'EVENT'}`;

  const snapshot = {
    id: snapshotId,
    sequence,
    timestamp,
    event: Object.freeze(eventCopy),
    stateSnapshot: Object.freeze(stateCopy),
    metrics
  };

  return Object.freeze(snapshot);
}

/**
 * Serializes a snapshot to JSON.
 * @param {CouncilSnapshot} snapshot
 * @param {boolean} [pretty=false]
 * @returns {string}
 */
export function serializeSnapshot(snapshot, pretty = false) {
  return JSON.stringify(snapshot, null, pretty ? 2 : undefined);
}

/**
 * Deserializes and validates a snapshot from JSON.
 * @param {string} jsonString
 * @returns {CouncilSnapshot}
 */
export function deserializeSnapshot(jsonString) {
  const parsed = JSON.parse(jsonString);
  if (!parsed || !parsed.id || !parsed.stateSnapshot || !parsed.event) {
    throw new Error('Invalid snapshot structure: missing required snapshot fields.');
  }
  return parsed;
}

/**
 * Snapshot recorder accumulator for storing deliberation trajectories.
 */
export class SnapshotRecorder {
  constructor(options = {}) {
    this.clock = options.clock || (() => new Date().toISOString());
    this.maxSnapshots = options.maxSnapshots || 1000;
    this.snapshots = [];
    this._sequence = 0;
  }

  /**
   * Records a state transition snapshot.
   * @param {Object} event
   * @param {Object} state
   * @returns {CouncilSnapshot}
   */
  record(event, state) {
    const snapshot = createSnapshot(event, state, {
      sequence: this._sequence++,
      clock: this.clock
    });
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
    return snapshot;
  }

  /**
   * Returns all recorded snapshots.
   * @returns {CouncilSnapshot[]}
   */
  getSnapshots() {
    return [...this.snapshots];
  }

  /**
   * Returns the most recent snapshot or null.
   * @returns {CouncilSnapshot | null}
   */
  getLatest() {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  /**
   * Clears all recorded snapshots and resets sequence.
   */
  clear() {
    this.snapshots = [];
    this._sequence = 0;
  }

  /**
   * Exports trajectory to a JSON array string.
   * @param {boolean} [pretty=false]
   * @returns {string}
   */
  exportJson(pretty = false) {
    return JSON.stringify(this.snapshots, null, pretty ? 2 : undefined);
  }
}

export function createSnapshotRecorder(options = {}) {
  return new SnapshotRecorder(options);
}
