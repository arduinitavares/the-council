/**
 * @fileoverview EventEmitter-based Real-Time Telemetry and State Transition Pub/Sub.
 * ESM Module (Node >= 22). Zero external dependencies.
 *
 * Implements:
 * - Decoupled real-time seat status telemetry (`SEAT_TELEMETRY`) independent of state machine phase transitions.
 * - Deterministic state transition snapshots (`emitStateTransition`).
 * - High-level event topics (`seat_telemetry`, `state_transition`, `round_start`, `proof_submitted`,
 *   `candidate_synthesized`, `vote_cast`, `seat_fault`, `seat_excused`, `verdict`).
 * - Observer safety: listener errors are caught and emitted via 'error' without crashing deliberation.
 */

import { EventEmitter } from 'node:events';
import { createSnapshot, createSnapshotRecorder } from './snapshot.js';

export class CouncilTelemetryEmitter extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {(() => string)} [options.clock] - Custom timestamp provider for testing.
   * @param {number} [options.maxHistory=500] - In-memory event buffer limit.
   * @param {boolean} [options.recordSnapshots=true] - Whether to accumulate snapshots.
   */
  constructor(options = {}) {
    super();
    this.clock = options.clock || (() => new Date().toISOString());
    this.maxHistory = options.maxHistory || 500;
    this.telemetryHistory = [];
    this.providerCalls = [];
    this.recorder = options.recordSnapshots !== false ? createSnapshotRecorder({ clock: this.clock }) : null;
    // Default no-op error listener to ensure observer safety and prevent unhandled error crashes
    this.on('error', () => {});
  }

  /**
   * Safely emits an event without throwing if an observer listener fails.
   * @private
   */
  _safeEmit(eventName, data) {
    try {
      this.emit(eventName, data);
    } catch (err) {
      this.emit('error', {
        eventName,
        error: err instanceof Error ? err.message : String(err),
        timestamp: this.clock()
      });
    }
  }

  /**
   * Emits real-time observer seat status updates decoupled from state machine phase transitions.
   * @param {string} seatId - Target seat identifier.
   * @param {string} status - One of SEAT_STATUSES.
   * @param {Object} [metadata={}] - Optional telemetry payload (model, elapsedMs, progress).
   */
  emitSeatTelemetry(seatId, status, metadata = {}) {
    if (!seatId || typeof seatId !== 'string') {
      throw new Error('emitSeatTelemetry requires a valid non-empty seatId string.');
    }
    if (!status || typeof status !== 'string') {
      throw new Error('emitSeatTelemetry requires a valid status string.');
    }

    const payload = Object.freeze({
      seatId,
      status,
      metadata: Object.freeze({ ...metadata }),
      timestamp: this.clock()
    });

    this.telemetryHistory.push(payload);
    if (this.telemetryHistory.length > this.maxHistory) {
      this.telemetryHistory.shift();
    }

    this._safeEmit('seat_telemetry', payload);
    this._safeEmit(`seat_telemetry:${seatId}`, payload);
  }

  /**
   * Emits a formal state machine transition with an immutable snapshot.
   * @param {Object} event - The CouncilEvent that transitioned the machine.
   * @param {Object} state - The updated CouncilState after transition.
   * @returns {import('./snapshot.js').CouncilSnapshot}
   */
  emitStateTransition(event, state) {
    if (!event || !event.type) {
      throw new Error('emitStateTransition requires an event with a valid "type" property.');
    }
    if (!state || typeof state !== 'object') {
      throw new Error('emitStateTransition requires a valid CouncilState object.');
    }

    const snapshot = this.recorder ? this.recorder.record(event, state) : createSnapshot(event, state, { clock: this.clock });

    const payload = Object.freeze({
      event: snapshot.event,
      state: snapshot.stateSnapshot,
      snapshot,
      timestamp: snapshot.timestamp
    });

    this._safeEmit('state_transition', payload);
    this._safeEmit(`transition:${event.type}`, payload);

    return snapshot;
  }

  /**
   * Emits high-level lifecycle events for observer convenience.
   */
  emitRoundStart(round, activeSeats) {
    this._safeEmit('round_start', { round, activeSeats, timestamp: this.clock() });
  }

  emitProofSubmitted(proof) {
    this._safeEmit('proof_submitted', { proof, timestamp: this.clock() });
  }

  emitCandidateSynthesized(candidate) {
    this._safeEmit('candidate_synthesized', { candidate, timestamp: this.clock() });
  }

  emitVoteCast(seatId, vote, reason = null, proofId = null) {
    this._safeEmit('vote_cast', { seatId, vote, reason, proofId, timestamp: this.clock() });
  }

  emitObjectionRaised(objection) {
    this._safeEmit('objection_raised', { objection, timestamp: this.clock() });
  }

  emitSeatFault(seatId, reason, retries) {
    this._safeEmit('seat_fault', { seatId, reason, retries, timestamp: this.clock() });
  }

  emitSeatExcused(seatId, reason, lockedObjectionsCount) {
    this._safeEmit('seat_excused', { seatId, reason, lockedObjectionsCount, timestamp: this.clock() });
  }

  emitVerdict(verdict) {
    this._safeEmit('verdict', { verdict, timestamp: this.clock() });
  }

  /**
   * Emits and buffers provider call telemetry.
   * @param {Object} callRecord
   * @returns {Readonly<Object>}
   */
  emitProviderCall(callRecord) {
    if (!callRecord || typeof callRecord !== 'object') {
      throw new Error('emitProviderCall requires a valid callRecord object.');
    }
    const record = Object.freeze({
      ...callRecord,
      timestamp: this.clock()
    });
    this.providerCalls.push(record);
    this._safeEmit('provider_call', record);
    return record;
  }

  /**
   * Returns recorded provider call history.
   * @param {string} [participantId]
   * @returns {Array<Object>}
   */
  getProviderCalls(participantId) {
    if (participantId) {
      return this.providerCalls.filter((c) => c.participantId === participantId);
    }
    return [...this.providerCalls];
  }

  /**
   * Returns all recorded snapshots.
   * @returns {import('./snapshot.js').CouncilSnapshot[]}
   */
  getSnapshots() {
    return this.recorder ? this.recorder.getSnapshots() : [];
  }

  /**
   * Returns telemetry history records.
   * @param {string} [seatId] - Optional seatId filter.
   * @returns {Array<Object>}
   */
  getTelemetryHistory(seatId) {
    if (seatId) {
      return this.telemetryHistory.filter((t) => t.seatId === seatId);
    }
    return [...this.telemetryHistory];
  }

  /**
   * Clears internal telemetry and snapshot history.
   */
  clear() {
    this.telemetryHistory = [];
    this.providerCalls = [];
    if (this.recorder) {
      this.recorder.clear();
    }
  }
}

export function createTelemetryEmitter(options = {}) {
  return new CouncilTelemetryEmitter(options);
}
