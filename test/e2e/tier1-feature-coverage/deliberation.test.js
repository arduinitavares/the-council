import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  assertPhase,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 1: Feature Coverage — Deliberation (Round Initialization)', () => {
  it('3.1 should begin round 1 from preflight, set phase to reviewing, and set active seats to thinking', () => {
    const state = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'antigravity', model: 'm2', soul: 'soul2' }
      ]
    });
    assert.equal(state.round, 0);
    assertPhase(state, 'preflight');

    const next = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(next.lastTransition.ok, true);
    assert.equal(next.round, 1);
    assertPhase(next, 'reviewing');
    assert.equal(next.seats[0].status, 'thinking');
    assert.equal(next.seats[1].status, 'thinking');
    assert.equal(next.judge.status, 'idle');
  });

  it('3.2 should begin round from clarifying phase', () => {
    let state = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'cursor', model: 'm2', soul: 'soul2' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.START_CLARIFYING });
    state = transitionCouncil(state, { type: EVENTS.PUBLISH_CLARIFICATION, answer: 'Fact broadcast.' });
    assertPhase(state, 'clarifying');

    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'reviewing');
    assert.equal(state.round, 1);
  });

  it('3.3 should reject BEGIN_ROUND when active seats are below minQuorum', () => {
    const state = createInitialCouncilState({
      minQuorum: 3,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    // active seats = 2, minQuorum = 3
    const next = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /below minimum quorum/);
  });

  it('3.4 should reject BEGIN_ROUND from invalid phase (e.g. judging, reviewing)', () => {
    let state = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assertPhase(state, 'reviewing');

    // Attempting BEGIN_ROUND while already in reviewing
    const badAttempt = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(badAttempt.lastTransition.ok, false);
    assert.match(badAttempt.lastTransition.message, /Cannot begin a deliberation round from phase/);
  });

  it('3.5 should reject BEGIN_ROUND when maxRounds limit already reached', () => {
    const state = createInitialCouncilState({
      maxRounds: 1,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    // Artificially simulate state at round 1
    state.round = 1;
    const next = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /Maximum deliberation rounds/);
  });

  it('3.6 should reset judge status to idle when starting a new round', () => {
    let state = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });
    state.judge.status = 'thinking';
    state = transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
    assert.equal(state.judge.status, 'idle');
  });
});
