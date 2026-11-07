/**
 * @fileoverview Dynamic Seat Configuration, Lifecycle & Turn Retention for The Council.
 * ESM Module (Node >= 22)
 *
 * Implements:
 * - Dynamic seat configuration and validation
 * - Seat lifecycle status transitions ('idle', 'thinking', 'proof_submitted', 'accepted', 'objected', 'fault_quota', 'excused')
 * - Permanent terminal excusal and turn retention
 * - Bounded retry tracking
 * - Telemetry payload formatting
 */

import { SEAT_STATUSES } from '../types.js';

/**
 * Valid seat status values re-exported from types.js.
 * @type {readonly ['idle', 'thinking', 'proof_submitted', 'accepted', 'objected', 'fault_quota', 'excused']}
 */
export const VALID_SEAT_STATUSES = SEAT_STATUSES;

/**
 * Allowed status transitions for a Seat.
 * 'excused' is a terminal state: once excused, no further transitions are permitted.
 * @type {Record<string, readonly string[]>}
 */
export const LEGAL_SEAT_TRANSITIONS = Object.freeze({
  idle: Object.freeze(['thinking', 'proof_submitted', 'fault_quota', 'fault_timeout', 'fault', 'excused']),
  thinking: Object.freeze(['idle', 'proof_submitted', 'accepted', 'objected', 'fault_quota', 'fault_timeout', 'fault', 'excused']),
  proof_submitted: Object.freeze(['idle', 'thinking', 'accepted', 'objected', 'fault_quota', 'fault_timeout', 'fault', 'excused']),
  accepted: Object.freeze(['idle', 'thinking', 'fault_quota', 'fault_timeout', 'fault', 'excused']),
  objected: Object.freeze(['idle', 'thinking', 'fault_quota', 'fault_timeout', 'fault', 'excused']),
  fault_quota: Object.freeze(['thinking', 'excused']),
  fault_timeout: Object.freeze(['thinking', 'excused']),
  fault: Object.freeze(['thinking', 'excused']),
  excused: Object.freeze([]) // Terminal state
});

/**
 * Validates a seat configuration object.
 * @param {any} config
 * @returns {{ valid: boolean; errors: string[] }}
 */
export function validateSeatConfig(config) {
  const errors = [];

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, errors: ['Seat configuration must be a non-null object.'] };
  }

  // 1. id validation
  if (!config.id || typeof config.id !== 'string' || !config.id.trim()) {
    errors.push('Seat requires a non-empty string "id".');
  } else if (!/^[a-zA-Z0-9_-]+$/.test(config.id.trim())) {
    errors.push(`Seat id "${config.id}" contains invalid characters. Must be alphanumeric, hyphen, or underscore.`);
  }

  // 2. harness validation
  if (!config.harness || typeof config.harness !== 'string' || !config.harness.trim()) {
    errors.push('Seat requires a non-empty string "harness".');
  }

  // 3. model validation
  if (!config.model || typeof config.model !== 'string' || !config.model.trim()) {
    errors.push('Seat requires a non-empty string "model".');
  }

  // 4. soul validation
  if (!config.soul) {
    errors.push('Seat requires a "soul" (string or Soul configuration).');
  } else if (typeof config.soul === 'string' && !config.soul.trim()) {
    errors.push('Seat soul cannot be an empty or whitespace string.');
  } else if (typeof config.soul !== 'string' && typeof config.soul !== 'object') {
    errors.push('Seat soul must be a non-empty string or Soul object.');
  }

  // 5. status validation (if provided)
  if (config.status !== undefined && !VALID_SEAT_STATUSES.includes(config.status)) {
    errors.push(`Invalid seat status "${config.status}". Must be one of: ${VALID_SEAT_STATUSES.join(', ')}.`);
  }

  // 6. retries validation (if provided)
  if (config.retries !== undefined && (!Number.isInteger(config.retries) || config.retries < 0)) {
    errors.push('Seat retries must be a non-negative integer.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Pure helper to check if a seat is active (not excused).
 * Works on both Seat class instances and plain CouncilState seat objects.
 * @param {any} seat
 * @returns {boolean}
 */
export function isSeatActive(seat) {
  return Boolean(seat && typeof seat === 'object' && seat.status !== 'excused');
}

/**
 * Pure helper to check if a seat is excused.
 * @param {any} seat
 * @returns {boolean}
 */
export function isSeatExcused(seat) {
  return Boolean(seat && typeof seat === 'object' && seat.status === 'excused');
}

/**
 * Representation of an individual voting participant in the Council.
 */
export class Seat {
  /**
   * @param {Object} config
   * @param {string} config.id - Unique identifier.
   * @param {string} config.harness - Execution harness ('codex', 'antigravity', 'cursor', 'mock').
   * @param {string} config.model - Model identifier (e.g. 'gpt-6-astra (max)').
   * @param {string | Object} config.soul - Soul persona/temperament.
   * @param {import('../types.js').SeatStatus} [config.status='idle'] - Live status.
   * @param {number} [config.retries=0] - Number of times retried after fault.
   * @param {string | null} [config.excusedReason=null] - Reason if excused.
   * @param {Array<Object>} [config.turns=[]] - Retained completed turn records.
   * @param {string} [config.createdAt] - Creation ISO timestamp.
   */
  constructor(config) {
    const check = validateSeatConfig(config);
    if (!check.valid) {
      throw new Error(`Invalid Seat configuration: ${check.errors.join('; ')}`);
    }

    this._id = config.id.trim();
    this._harness = config.harness.trim();
    this._model = config.model.trim();
    this._soul = typeof config.soul === 'string' ? config.soul.trim() : config.soul;
    this._status = config.status || 'idle';
    this._retries = config.retries ?? 0;
    this._excusedReason = config.excusedReason ?? null;
    this._turns = Array.isArray(config.turns) ? [...config.turns] : [];
    this._createdAt = config.createdAt || new Date().toISOString();
    this._updatedAt = this._createdAt;
  }

  get id() { return this._id; }
  get harness() { return this._harness; }
  get model() { return this._model; }
  get soul() { return this._soul; }
  get status() { return this._status; }
  get retries() { return this._retries; }
  get excusedReason() { return this._excusedReason; }
  get turns() { return [...this._turns]; }
  get createdAt() { return this._createdAt; }
  get updatedAt() { return this._updatedAt; }
  get isActive() { return this._status !== 'excused'; }
  get isExcused() { return this._status === 'excused'; }

  /**
   * Evaluates if transitioning to targetStatus is legally permitted.
   * @param {string} targetStatus
   * @returns {boolean}
   */
  canTransitionTo(targetStatus) {
    if (this._status === 'excused') return false;
    const allowed = LEGAL_SEAT_TRANSITIONS[this._status] || [];
    return allowed.includes(targetStatus);
  }

  /**
   * Transitions seat to a new lifecycle status.
   * @param {import('../types.js').SeatStatus} newStatus
   * @param {Object} [meta]
   * @returns {Seat} this instance for chaining
   */
  transition(newStatus, meta = {}) {
    if (!VALID_SEAT_STATUSES.includes(newStatus)) {
      throw new Error(`Cannot transition Seat "${this._id}" to unknown status "${newStatus}".`);
    }

    if (this._status === 'excused') {
      throw new Error(`Illegal transition: Seat "${this._id}" is permanently excused and cannot transition to "${newStatus}".`);
    }

    if (this._status === newStatus) {
      return this; // Idempotent no-op
    }

    if (!this.canTransitionTo(newStatus)) {
      throw new Error(`Illegal state transition for Seat "${this._id}": cannot transition from "${this._status}" to "${newStatus}".`);
    }

    this._status = newStatus;
    this._updatedAt = new Date().toISOString();

    if (meta.reason && newStatus === 'excused') {
      this._excusedReason = String(meta.reason).trim();
    }

    return this;
  }

  /**
   * Records a completed turn without mutating or deleting prior turns.
   * Guarantees turn retention across seat faults and excusal.
   * @param {Object} turnData
   * @returns {Seat}
   */
  recordTurn(turnData) {
    if (!turnData || typeof turnData !== 'object') {
      throw new Error('Turn record must be an object.');
    }

    this._turns.push({
      round: turnData.round ?? 0,
      phase: turnData.phase ?? 'unknown',
      action: turnData.action ?? 'turn',
      data: turnData.data ?? null,
      timestamp: new Date().toISOString()
    });

    this._updatedAt = new Date().toISOString();
    return this;
  }

  /**
   * Transitions seat to a fault state.
   * @param {string} [reason='Quota reached']
   * @param {import('../types.js').SeatStatus} [status='fault_quota']
   * @returns {Seat}
   */
  fault(reason = 'Quota reached', status = 'fault_quota') {
    return this.transition(status, { reason });
  }

  /**
   * Retries a faulted seat if retry cap allows.
   * @param {number} maxRetriesPerSeat
   * @returns {Seat}
   */
  retry(maxRetriesPerSeat = 1) {
    if (this._status !== 'fault_quota' && this._status !== 'fault_timeout' && this._status !== 'fault') {
      throw new Error(`Cannot retry Seat "${this._id}" from status "${this._status}". Must be in "fault_quota", "fault_timeout", or "fault".`);
    }

    if (this._retries >= maxRetriesPerSeat) {
      throw new Error(`Retry cap reached: Seat "${this._id}" has reached ${this._retries}/${maxRetriesPerSeat} retries. Excuse seat instead.`);
    }

    this._retries += 1;
    return this.transition('thinking');
  }

  /**
   * Excuses the seat permanently mid-run.
   * Retains all prior turns and completed records.
   * @param {string} [reason='Quota reached — excused mid-run']
   * @returns {Seat}
   */
  excuse(reason = 'Quota reached — excused mid-run') {
    return this.transition('excused', { reason });
  }

  /**
   * Serializes to standard plain object matching CouncilState.seats.
   * @returns {import('../types.js').Seat}
   */
  toJSON() {
    return {
      id: this._id,
      harness: this._harness,
      model: this._model,
      soul: typeof this._soul === 'object' && this._soul.toJSON ? this._soul.toJSON() : this._soul,
      status: this._status,
      retries: this._retries,
      excusedReason: this._excusedReason
    };
  }

  /**
   * Produces a real-time observer telemetry event payload.
   * @returns {{ seatId: string; status: import('../types.js').SeatStatus; timestamp: string }}
   */
  toTelemetryPayload() {
    return {
      seatId: this._id,
      status: this._status,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Factory creating a Seat instance.
 * @param {Object} config
 * @returns {Seat}
 */
export function createSeat(config) {
  return new Seat(config);
}
