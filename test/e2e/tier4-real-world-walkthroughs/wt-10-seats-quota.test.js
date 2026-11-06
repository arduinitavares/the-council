import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  assertPhase
} from '../../helpers/council.js';
import { getWalkthrough } from '../../fixtures/walkthrough-scenarios.js';

describe('Tier 4: Real-World Application Scenarios — wt-10-seats-quota Walkthrough Port', () => {
  it('should run Walkthrough 2: 10-Seat Multi-Harness Roster + Quota Fault to completion', () => {
    const wt = getWalkthrough('wt-10-seats-quota');
    let state = createInitialCouncilState(wt.initialConfig);

    assertPhase(state, 'preflight');
    assert.equal(state.seats.length, 10);
    assert.equal(state.maxRetriesPerSeat, 1);

    // Step 1: Begin Round 1
    state = transitionCouncil(state, wt.steps[0].event);
    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'reviewing');
    assert.equal(state.round, 1);

    // Step 2: 9 seats submit proofs / telemetry
    for (const evt of wt.steps[1].multiEvents) {
      state = transitionCouncil(state, evt);
      assert.equal(state.lastTransition.ok, true);
    }
    assert.equal(state.proofs.length, 2);

    // Step 3: Seat #8 hits quota -> SEAT_FAULT
    state = transitionCouncil(state, wt.steps[2].event);
    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'seat_fault');
    assert.equal(state.faultSeatId, 'grok-contrarian');

    // Step 4: Retry seat #8 once (1/1 allowed)
    state = transitionCouncil(state, wt.steps[3].event);
    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'reviewing');
    const grokSeat = state.seats.find((s) => s.id === 'grok-contrarian');
    assert.equal(grokSeat.retries, 1);

    // Step 5: Seat #8 faults again -> second retry BLOCKED by guard
    const fault2 = wt.steps[4].multiEvents[0];
    state = transitionCouncil(state, fault2);
    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'seat_fault');

    const retry2 = wt.steps[4].multiEvents[1];
    state = transitionCouncil(state, retry2);
    assert.equal(state.lastTransition.ok, false); // Blocked by guard!
    assert.match(state.lastTransition.message, /Retry Cap Guard/);
    assertPhase(state, 'seat_fault'); // Stays in seat_fault

    // Step 6: Excuse Seat #8 ("quota is reached, dude is off")
    state = transitionCouncil(state, wt.steps[5].event);
    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'reviewing');
    const excusedSeat = state.seats.find((s) => s.id === 'grok-contrarian');
    assert.equal(excusedSeat.status, 'excused');
    const remainingActive = state.seats.filter((s) => s.status !== 'excused');
    assert.equal(remainingActive.length, 9);

    // Step 7: Judge synthesizes Candidate & remaining 9 active seats vote accept -> Consensus!
    for (const evt of wt.steps[6].multiEvents) {
      state = transitionCouncil(state, evt);
      assert.equal(state.lastTransition.ok, true, `Event ${evt.type} failed: ${state.lastTransition.message}`);
    }

    // Final outcome assertion: Unanimous Consensus with 9 active seats!
    assertPhase(state, 'completed');
    assert.ok(state.verdict);
    assert.equal(state.verdict.kind, 'Unanimous Consensus');
    assert.equal(state.verdict.activeSeatCount, 9);
    assert.equal(state.verdict.excusedSeatCount, 1);
    assert.match(state.verdict.note, /All 9 active Seats accepted/);
  });
});
