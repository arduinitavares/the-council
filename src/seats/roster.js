/**
 * @fileoverview Council Roster Management, Dynamic Registration & Quorum Enforcement.
 * ESM Module (Node >= 22)
 *
 * Implements:
 * - Dynamic seat registration ('ADD_SEAT')
 * - Active vs excused seat tracking
 * - Quorum double-gating and lookahead ('minQuorum')
 * - Excusal with completed turn retention
 * - Batch operations (allActiveSeatsVoted, allActiveSeatsSubmittedProof, resetActiveSeats)
 * - Serialization to/from CouncilState
 */

import { Seat, createSeat } from './seat.js';
import { DEFAULT_CONFIG } from '../types.js';

/**
 * Roster manager for dynamic Seats in The Council.
 */
export class CouncilRoster {
  /**
   * @param {Object} [config]
   * @param {number} [config.minQuorum=2] - Minimum active seats for consensus.
   * @param {number} [config.maxRetriesPerSeat=1] - Maximum retry attempts before excusal.
   * @param {Array<Object | Seat>} [config.seats=[]] - Initial seat roster.
   */
  constructor(config = {}) {
    this._minQuorum = config.minQuorum ?? DEFAULT_CONFIG.minQuorum;
    this._maxRetriesPerSeat = config.maxRetriesPerSeat ?? DEFAULT_CONFIG.maxRetriesPerSeat;
    /** @type {Map<string, Seat>} */
    this._seats = new Map();

    if (Array.isArray(config.seats)) {
      this.addSeats(config.seats);
    }
  }

  get minQuorum() { return this._minQuorum; }
  set minQuorum(value) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`minQuorum must be an integer >= 1, got: ${value}`);
    }
    this._minQuorum = value;
  }

  get maxRetriesPerSeat() { return this._maxRetriesPerSeat; }
  set maxRetriesPerSeat(value) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`maxRetriesPerSeat must be a non-negative integer, got: ${value}`);
    }
    this._maxRetriesPerSeat = value;
  }

  /**
   * Adds an individual seat to the roster.
   * Enforces seat validation and ID uniqueness.
   * @param {Object | Seat} seatInput
   * @returns {Seat} the added Seat instance
   */
  addSeat(seatInput) {
    const seat = seatInput instanceof Seat ? seatInput : createSeat(seatInput);

    if (this._seats.has(seat.id)) {
      throw new Error(`Seat ID "${seat.id}" already exists in the Council roster.`);
    }

    this._seats.set(seat.id, seat);
    return seat;
  }

  /**
   * Batch adds multiple seats.
   * @param {Array<Object | Seat>} seats
   * @returns {Seat[]}
   */
  addSeats(seats) {
    if (!Array.isArray(seats)) {
      throw new Error('addSeats expects an array of seat configurations.');
    }
    return seats.map((s) => this.addSeat(s));
  }

  /**
   * Retrieves a seat by ID.
   * @param {string} seatId
   * @returns {Seat | undefined}
   */
  getSeat(seatId) {
    return this._seats.get(seatId);
  }

  /**
   * Checks whether a seat ID exists in the roster.
   * @param {string} seatId
   * @returns {boolean}
   */
  hasSeat(seatId) {
    return this._seats.has(seatId);
  }

  /**
   * Returns all seats (active and excused).
   * @returns {Seat[]}
   */
  getAllSeats() {
    return Array.from(this._seats.values());
  }

  /**
   * Returns all currently active (non-excused) seats.
   * @returns {Seat[]}
   */
  getActiveSeats() {
    return this.getAllSeats().filter((s) => s.isActive);
  }

  /**
   * Returns all excused seats.
   * @returns {Seat[]}
   */
  getExcusedSeats() {
    return this.getAllSeats().filter((s) => s.isExcused);
  }

  /**
   * Returns the count of active seats.
   * @returns {number}
   */
  getActiveCount() {
    return this.getActiveSeats().length;
  }

  /**
   * Returns the count of excused seats.
   * @returns {number}
   */
  getExcusedCount() {
    return this.getExcusedSeats().length;
  }

  /**
   * Returns total registered seat count.
   * @returns {number}
   */
  getTotalCount() {
    return this._seats.size;
  }

  /**
   * Returns seats filtered by execution harness.
   * @param {string} harness
   * @returns {Seat[]}
   */
  getSeatsByHarness(harness) {
    return this.getAllSeats().filter((s) => s.harness === harness);
  }

  /**
   * Returns seats filtered by model.
   * @param {string} model
   * @returns {Seat[]}
   */
  getSeatsByModel(model) {
    return this.getAllSeats().filter((s) => s.model === model);
  }

  /**
   * Evaluates if active seat count satisfies minimum quorum.
   * @returns {boolean}
   */
  hasQuorum() {
    return this.getActiveCount() >= this._minQuorum;
  }

  /**
   * Full quorum assessment.
   * @returns {{ hasQuorum: boolean; activeCount: number; minQuorum: number }}
   */
  checkQuorum() {
    const activeCount = this.getActiveCount();
    return {
      hasQuorum: activeCount >= this._minQuorum,
      activeCount,
      minQuorum: this._minQuorum
    };
  }

  /**
   * Lookahead check: evaluates whether excusing targetSeatId drops active seats below quorum.
   * @param {string} seatId
   * @returns {boolean} true if excusing this seat will cause quorum failure
   */
  willLoseQuorumOnExcusal(seatId) {
    const seat = this._seats.get(seatId);
    if (!seat) return true;
    if (seat.isExcused) {
      return this.getActiveCount() < this._minQuorum;
    }
    return (this.getActiveCount() - 1) < this._minQuorum;
  }

  /**
   * Updates live status of a seat.
   * Disallows mutating excused seats.
   * @param {string} seatId
   * @param {import('../types.js').SeatStatus} status
   * @param {Object} [meta]
   * @returns {Seat}
   */
  updateSeatStatus(seatId, status, meta = {}) {
    const seat = this._seats.get(seatId);
    if (!seat) {
      throw new Error(`Cannot update status: Seat "${seatId}" does not exist in roster.`);
    }
    return seat.transition(status, meta);
  }

  /**
   * Retries a faulted seat if retries remain within maxRetriesPerSeat.
   * @param {string} seatId
   * @returns {{ ok: boolean; seat?: Seat; error?: string }}
   */
  retrySeat(seatId) {
    const seat = this._seats.get(seatId);
    if (!seat) {
      return { ok: false, error: `Seat "${seatId}" not found in roster.` };
    }
    try {
      seat.retry(this._maxRetriesPerSeat);
      return { ok: true, seat };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Excuses a seat mid-run, preserves its prior turns, and checks quorum drop.
   * @param {string} seatId
   * @param {string} [reason='Quota reached — excused mid-run']
   * @returns {{ ok: boolean; seat: Seat; dropsBelowQuorum: boolean; activeCount: number }}
   */
  excuseSeat(seatId, reason = 'Quota reached — excused mid-run') {
    const seat = this._seats.get(seatId);
    if (!seat) {
      throw new Error(`Cannot excuse unknown Seat "${seatId}".`);
    }

    const dropsBelowQuorum = this.willLoseQuorumOnExcusal(seatId);
    seat.excuse(reason);
    const activeCount = this.getActiveCount();

    return {
      ok: true,
      seat,
      dropsBelowQuorum,
      activeCount
    };
  }

  /**
   * Checks if all active seats have completed voting ('accepted' or 'objected').
   * @returns {boolean}
   */
  allActiveSeatsVoted() {
    const active = this.getActiveSeats();
    if (active.length === 0) return false;
    return active.every((s) => s.status === 'accepted' || s.status === 'objected');
  }

  /**
   * Checks if all active seats have submitted a proof in the current round.
   * @returns {boolean}
   */
  allActiveSeatsSubmittedProof() {
    const active = this.getActiveSeats();
    if (active.length === 0) return false;
    return active.every((s) => s.status === 'proof_submitted');
  }

  /**
   * Batch resets active seats to targetStatus ('thinking' or 'idle') at round start.
   * Excused seats are untouched.
   * @param {import('../types.js').SeatStatus} [targetStatus='thinking']
   */
  resetActiveSeats(targetStatus = 'thinking') {
    this.getActiveSeats().forEach((seat) => {
      seat.transition(targetStatus);
    });
  }

  /**
   * Exports plain seat objects matching CouncilState.seats for the pure reducer.
   * @returns {Array<import('../types.js').Seat>}
   */
  toStateArray() {
    return this.getAllSeats().map((s) => s.toJSON());
  }

  /**
   * Hydrates a CouncilRoster from a CouncilState object.
   * @param {import('../types.js').CouncilState} state
   * @returns {CouncilRoster}
   */
  static fromState(state) {
    if (!state || !Array.isArray(state.seats)) {
      return new CouncilRoster();
    }
    const roster = new CouncilRoster({
      minQuorum: state.minQuorum,
      maxRetriesPerSeat: state.maxRetriesPerSeat
    });
    state.seats.forEach((s) => {
      roster.addSeat(s);
    });
    return roster;
  }

  /**
   * In-place sync from a CouncilState snapshot.
   * Updates statuses, retries, and excused reasons without losing references.
   * @param {import('../types.js').CouncilState} state
   */
  syncFromState(state) {
    if (!state || !Array.isArray(state.seats)) return;
    state.seats.forEach((stateSeat) => {
      const existing = this._seats.get(stateSeat.id);
      if (existing) {
        if (existing.status !== stateSeat.status) {
          if (stateSeat.status === 'excused') {
            existing.excuse(stateSeat.excusedReason || 'Excused via state sync');
          } else if (existing.canTransitionTo(stateSeat.status)) {
            existing.transition(stateSeat.status);
          }
        }
      } else {
        this.addSeat(stateSeat);
      }
    });
  }
}

/**
 * Factory creating a CouncilRoster.
 * @param {Object} [config]
 * @returns {CouncilRoster}
 */
export function createRoster(config) {
  return new CouncilRoster(config);
}
