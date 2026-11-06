import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  assertPhase,
  PHASES,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 1: Feature Coverage — Roster Configuration (ADD_SEAT)', () => {
  it('1.1 should add dynamic seat with valid id, harness, model, and soul during preflight', () => {
    let state = createInitialCouncilState();
    assertPhase(state, 'preflight');
    const seatConfig = {
      id: 'astra-sre',
      harness: 'codex',
      model: 'gpt-6-astra (max)',
      soul: 'Site Reliability Engineer: verifies fault tolerance and telemetry.'
    };
    state = transitionCouncil(state, {
      type: EVENTS.ADD_SEAT,
      seat: seatConfig
    });

    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.seats.length, 1);
    assert.equal(state.seats[0].id, 'astra-sre');
    assert.equal(state.seats[0].harness, 'codex');
    assert.equal(state.seats[0].model, 'gpt-6-astra (max)');
    assert.equal(state.seats[0].soul, seatConfig.soul);
    assert.equal(state.seats[0].status, 'idle');
    assert.equal(state.seats[0].retries, 0);
  });

  it('1.2 should reject adding seat with missing required fields', () => {
    const state = createInitialCouncilState();
    const badSeats = [
      { harness: 'codex', model: 'm1', soul: 's1' }, // missing id
      { id: 's1', model: 'm1', soul: 's1' },           // missing harness
      { id: 's1', harness: 'codex', soul: 's1' },       // missing model
      { id: 's1', harness: 'codex', model: 'm1' }        // missing soul
    ];

    for (const badSeat of badSeats) {
      const next = transitionCouncil(state, {
        type: EVENTS.ADD_SEAT,
        seat: badSeat
      });
      assert.equal(next.lastTransition.ok, false);
      assert.match(next.lastTransition.message, /requires id, harness, model, and soul/);
    }
  });

  it('1.3 should reject adding duplicate seat id', () => {
    let state = createInitialCouncilState();
    const seat = {
      id: 'unique-seat',
      harness: 'codex',
      model: 'gpt-6.1-sol',
      soul: 'Pragmatic Dev'
    };
    state = transitionCouncil(state, { type: EVENTS.ADD_SEAT, seat });
    assert.equal(state.lastTransition.ok, true);

    const duplicateAttempt = transitionCouncil(state, { type: EVENTS.ADD_SEAT, seat });
    assert.equal(duplicateAttempt.lastTransition.ok, false);
    assert.match(duplicateAttempt.lastTransition.message, /already exists/);
  });

  it('1.4 should reject adding seat after preflight phase', () => {
    let state = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    // Advance to reviewing/deliberation
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assertPhase(state, 'reviewing');

    const lateSeat = {
      id: 'late-seat',
      harness: 'antigravity',
      model: 'gemini-4-argon-high',
      soul: 'Late Participant'
    };
    const next = transitionCouncil(state, { type: EVENTS.ADD_SEAT, seat: lateSeat });
    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /only be added during preflight/);
  });

  it('1.5 should support 10 dynamic seats across multi-harness (Codex, Antigravity, Cursor)', () => {
    let state = createInitialCouncilState();
    const harnesses = ['codex', 'antigravity', 'cursor'];
    for (let i = 1; i <= 10; i++) {
      const harness = harnesses[(i - 1) % harnesses.length];
      state = transitionCouncil(state, {
        type: EVENTS.ADD_SEAT,
        seat: {
          id: `seat-${i}`,
          harness,
          model: `model-${i}`,
          soul: `Soul #${i} on ${harness}`
        }
      });
      assert.equal(state.lastTransition.ok, true);
    }
    assert.equal(state.seats.length, 10);
  });

  it('1.6 should support multiple seats sharing the same model with distinct souls', () => {
    let state = createInitialCouncilState();
    const model = 'gpt-6-astra (max)';
    const seat1 = { id: 'astra-purist', harness: 'codex', model, soul: 'Purist architect' };
    const seat2 = { id: 'astra-pragmatist', harness: 'codex', model, soul: 'Pragmatist delivery' };

    state = transitionCouncil(state, { type: EVENTS.ADD_SEAT, seat: seat1 });
    state = transitionCouncil(state, { type: EVENTS.ADD_SEAT, seat: seat2 });

    assert.equal(state.seats.length, 2);
    assert.equal(state.seats[0].model, state.seats[1].model);
    assert.notEqual(state.seats[0].soul, state.seats[1].soul);
  });

  it('1.7 should preserve custom initial configuration parameters (minQuorum, maxRounds, maxRetriesPerSeat)', () => {
    const customConfig = {
      topic: 'Custom Deliberation Topic',
      minQuorum: 4,
      maxRounds: 5,
      maxRetriesPerSeat: 3,
      maxClarificationBatches: 3
    };
    const state = createInitialCouncilState(customConfig);
    assert.equal(state.topic, customConfig.topic);
    assert.equal(state.minQuorum, 4);
    assert.equal(state.maxRounds, 5);
    assert.equal(state.maxRetriesPerSeat, 3);
    assert.equal(state.maxClarificationBatches, 3);
  });
});
