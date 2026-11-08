import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Seat,
  createSeat,
  validateSeatConfig,
  isSeatActive,
  isSeatExcused,
  VALID_SEAT_STATUSES,
  LEGAL_SEAT_TRANSITIONS
} from '../../src/seats/seat.js';

describe('Unit: Seat Lifecycle, Validation & Turn Retention (src/seats/seat.js)', () => {
  describe('validateSeatConfig', () => {
    it('accepts a valid minimal seat configuration', () => {
      const res = validateSeatConfig({
        id: 'astra-kernel',
        harness: 'codex',
        model: 'gpt-6-astra (max)',
        soul: 'Systems & Kernel Purist'
      });
      assert.equal(res.valid, true);
      assert.equal(res.errors.length, 0);
    });

    it('accepts a valid seat configuration with soul object and optional fields', () => {
      const res = validateSeatConfig({
        id: 'seat-1_test',
        harness: 'antigravity',
        model: 'gemini-4-argon-high',
        soul: { name: 'Auditor', lens: 'Compliance' },
        status: 'thinking',
        retries: 2
      });
      assert.equal(res.valid, true);
    });

    it('rejects null, non-object, and array configurations', () => {
      assert.equal(validateSeatConfig(null).valid, false);
      assert.equal(validateSeatConfig(undefined).valid, false);
      assert.equal(validateSeatConfig('not an object').valid, false);
      assert.equal(validateSeatConfig([]).valid, false);
    });

    it('rejects empty or invalid seat id', () => {
      assert.equal(validateSeatConfig({ id: '', harness: 'h', model: 'm', soul: 's' }).valid, false);
      assert.equal(validateSeatConfig({ id: '   ', harness: 'h', model: 'm', soul: 's' }).valid, false);
      assert.equal(validateSeatConfig({ id: 'bad id with spaces', harness: 'h', model: 'm', soul: 's' }).valid, false);
      assert.equal(validateSeatConfig({ id: 'bad@char!', harness: 'h', model: 'm', soul: 's' }).valid, false);
    });

    it('rejects missing or empty harness, model, and soul', () => {
      assert.equal(validateSeatConfig({ id: 's1', harness: '', model: 'm', soul: 's' }).valid, false);
      assert.equal(validateSeatConfig({ id: 's1', harness: 'h', model: '', soul: 's' }).valid, false);
      assert.equal(validateSeatConfig({ id: 's1', harness: 'h', model: 'm', soul: '' }).valid, false);
      assert.equal(validateSeatConfig({ id: 's1', harness: 'h', model: 'm', soul: '   ' }).valid, false);
      assert.equal(validateSeatConfig({ id: 's1', harness: 'h', model: 'm' }).valid, false);
    });

    it('rejects invalid status and invalid retries', () => {
      assert.equal(validateSeatConfig({ id: 's1', harness: 'h', model: 'm', soul: 's', status: 'invalid_status' }).valid, false);
      assert.equal(validateSeatConfig({ id: 's1', harness: 'h', model: 'm', soul: 's', retries: -1 }).valid, false);
      assert.equal(validateSeatConfig({ id: 's1', harness: 'h', model: 'm', soul: 's', retries: 1.5 }).valid, false);
      assert.equal(validateSeatConfig({ id: 's1', harness: 'h', model: 'm', soul: 's', retries: 'one' }).valid, false);
    });
  });

  describe('isSeatActive & isSeatExcused helpers', () => {
    it('correctly evaluates active vs excused seats', () => {
      assert.equal(isSeatActive({ status: 'idle' }), true);
      assert.equal(isSeatActive({ status: 'thinking' }), true);
      assert.equal(isSeatActive({ status: 'excused' }), false);
      assert.equal(isSeatActive(null), false);

      assert.equal(isSeatExcused({ status: 'excused' }), true);
      assert.equal(isSeatExcused({ status: 'idle' }), false);
      assert.equal(isSeatExcused(null), false);
    });
  });

  describe('Seat Class Lifecycle & Transitions', () => {
    it('creates a Seat instance with proper defaults', () => {
      const seat = createSeat({
        id: 'sol-speed',
        harness: 'codex',
        model: 'gpt-6.1-sol (max)',
        soul: 'Performance Auditor'
      });

      assert.equal(seat.id, 'sol-speed');
      assert.equal(seat.harness, 'codex');
      assert.equal(seat.model, 'gpt-6.1-sol (max)');
      assert.equal(seat.soul, 'Performance Auditor');
      assert.equal(seat.status, 'idle');
      assert.equal(seat.retries, 0);
      assert.equal(seat.excusedReason, null);
      assert.equal(seat.isActive, true);
      assert.equal(seat.isExcused, false);
      assert.deepEqual(seat.turns, []);
    });

    it('validates legal lifecycle transitions', () => {
      const seat = createSeat({
        id: 's1',
        harness: 'codex',
        model: 'gpt-6-astra',
        soul: 'Tester'
      });

      // idle -> thinking
      assert.equal(seat.canTransitionTo('thinking'), true);
      seat.transition('thinking');
      assert.equal(seat.status, 'thinking');

      // thinking -> proof_submitted
      assert.equal(seat.canTransitionTo('proof_submitted'), true);
      seat.transition('proof_submitted');
      assert.equal(seat.status, 'proof_submitted');

      // proof_submitted -> accepted
      assert.equal(seat.canTransitionTo('accepted'), true);
      seat.transition('accepted');
      assert.equal(seat.status, 'accepted');

      // accepted -> thinking (for next round)
      assert.equal(seat.canTransitionTo('thinking'), true);
      seat.transition('thinking');
      assert.equal(seat.status, 'thinking');

      // thinking -> objected
      assert.equal(seat.canTransitionTo('objected'), true);
      seat.transition('objected');
      assert.equal(seat.status, 'objected');
    });

    it('handles idempotent transitions without error', () => {
      const seat = createSeat({ id: 's1', harness: 'h', model: 'm', soul: 's', status: 'thinking' });
      assert.equal(seat.transition('thinking'), seat);
      assert.equal(seat.status, 'thinking');
    });

    it('rejects illegal transitions', () => {
      const seat = createSeat({ id: 's1', harness: 'h', model: 'm', soul: 's', status: 'idle' });
      // idle cannot transition directly to accepted
      assert.equal(seat.canTransitionTo('accepted'), false);
      assert.throws(() => seat.transition('accepted'), /Illegal state transition/);

      // unknown status
      assert.throws(() => seat.transition('nonexistent_status'), /unknown status/);
    });

    it('enforces permanent terminal excusal (excused seats can NEVER transition)', () => {
      const seat = createSeat({ id: 's1', harness: 'h', model: 'm', soul: 's' });
      seat.excuse('Quota exhausted');

      assert.equal(seat.status, 'excused');
      assert.equal(seat.isExcused, true);
      assert.equal(seat.isActive, false);
      assert.equal(seat.excusedReason, 'Quota exhausted');

      for (const st of VALID_SEAT_STATUSES) {
        assert.equal(seat.canTransitionTo(st), false);
        assert.throws(() => seat.transition(st), /permanently excused/);
      }
    });
  });

  describe('Bounded Retries', () => {
    it('tracks retries within configured bounds and caps them', () => {
      const seat = createSeat({ id: 's1', harness: 'h', model: 'm', soul: 's', status: 'idle' });
      seat.transition('thinking');
      seat.fault('Network timeout');

      assert.equal(seat.status, 'fault_quota');

      // First retry succeeds
      seat.retry(1);
      assert.equal(seat.retries, 1);
      assert.equal(seat.status, 'thinking');

      // Fault again
      seat.fault('Quota HTTP 429');
      assert.equal(seat.status, 'fault_quota');

      // Second retry exceeds cap of 1 -> throws
      assert.throws(() => seat.retry(1), /Retry cap reached/);

      // Must excuse instead
      seat.excuse('Exceeded retry cap');
      assert.equal(seat.status, 'excused');
    });

    it('rejects retry if seat is not in fault_quota state', () => {
      const seat = createSeat({ id: 's1', harness: 'h', model: 'm', soul: 's', status: 'thinking' });
      assert.throws(() => seat.retry(1), /Must be in "fault_quota"/);
    });
  });

  describe('Turn Retention Across Excusal', () => {
    it('preserves all completed turn history when seat is excused', () => {
      const seat = createSeat({ id: 's1', harness: 'codex', model: 'gpt-6-astra', soul: 'Purist' });

      seat.recordTurn({
        round: 1,
        phase: 'reviewing',
        action: 'SUBMIT_PROOF',
        data: { id: 'P1', statement: 'Statement 1' }
      });

      seat.recordTurn({
        round: 1,
        phase: 'confirming',
        action: 'CAST_VOTE',
        data: { vote: 'object', reason: 'Unsound' }
      });

      assert.equal(seat.turns.length, 2);
      assert.equal(seat.turns[0].action, 'SUBMIT_PROOF');
      assert.equal(seat.turns[1].action, 'CAST_VOTE');

      // Fault and excuse seat
      seat.fault('Quota exhausted');
      seat.excuse('Mid-run quota reached');

      // Verification: all turns must remain intact
      assert.equal(seat.isExcused, true);
      assert.equal(seat.turns.length, 2);
      assert.equal(seat.turns[0].data.id, 'P1');
      assert.equal(seat.turns[1].data.vote, 'object');
    });

    it('rejects non-object turn records', () => {
      const seat = createSeat({ id: 's1', harness: 'h', model: 'm', soul: 's' });
      assert.throws(() => seat.recordTurn(null), /Turn record must be an object/);
    });
  });

  describe('Serialization & Telemetry Payload', () => {
    it('serializes to standard plain object matching CouncilState.seats', () => {
      const seat = createSeat({
        id: 'astra-sre',
        harness: 'codex',
        model: 'gpt-6-astra',
        soul: 'SRE Specialist',
        status: 'proof_submitted',
        retries: 0
      });

      const json = seat.toJSON();
      assert.deepEqual(json, {
        id: 'astra-sre',
        harness: 'codex',
        model: 'gpt-6-astra',
        soul: 'SRE Specialist',
        status: 'proof_submitted',
        retries: 0,
        excusedReason: null,
        tools: 'read-only'
      });
    });

    it('generates real-time observer telemetry payload', () => {
      const seat = createSeat({
        id: 'argon-unix',
        harness: 'antigravity',
        model: 'gemini-4-argon-high',
        soul: 'Unix Dev',
        status: 'thinking'
      });

      const payload = seat.toTelemetryPayload();
      assert.equal(payload.seatId, 'argon-unix');
      assert.equal(payload.status, 'thinking');
      assert.ok(payload.timestamp);
      assert.doesNotThrow(() => new Date(payload.timestamp));
    });
  });
});
