import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil
} from '../../src/index.js';
import { getWalkthrough, WALKTHROUGHS } from '../fixtures/walkthrough-scenarios.js';

describe('Unit: Prototype Walkthroughs against Production Engine (src/index.js)', () => {
  it('confirms all 3 canonical walkthroughs are available', () => {
    assert.equal(WALKTHROUGHS.length, 3);
    assert.deepEqual(
      WALKTHROUGHS.map((w) => w.id),
      ['wt-better-os', 'wt-10-seats-quota', 'wt-opus-guardrails']
    );
  });

  it('runs Walkthrough 1 (wt-better-os): Context-Partitioned Consensus to completion', () => {
    const wt = getWalkthrough('wt-better-os');
    let state = createInitialCouncilState(wt.initialConfig);

    assert.equal(state.phase, 'preflight');
    assert.equal(state.canonicalPhase, 'ROSTER_CONFIGURATION');
    assert.equal(state.seats.length, 4);

    for (let i = 0; i < wt.steps.length; i++) {
      const step = wt.steps[i];
      if (step.event) {
        state = transitionCouncil(state, step.event);
        assert.equal(
          state.lastTransition.ok,
          true,
          `Step ${i + 1} (${step.label}) failed: ${state.lastTransition.message}`
        );
      } else if (step.multiEvents) {
        for (const ev of step.multiEvents) {
          state = transitionCouncil(state, ev);
          assert.equal(
            state.lastTransition.ok,
            true,
            `Step ${i + 1} sub-event (${ev.type}) failed: ${state.lastTransition.message}`
          );
        }
      }
    }

    assert.equal(state.phase, 'completed');
    assert.equal(state.canonicalPhase, 'CONSENSUS_REACHED');
    assert.ok(state.verdict);
    assert.equal(state.verdict.kind, 'Unanimous Consensus');
    assert.equal(state.verdict.activeSeatCount, 4);
    assert.equal(state.verdict.excusedSeatCount, 0);
    assert.equal(state.verdict.unresolvedObjections.length, 0);
  });

  it('runs Walkthrough 2 (wt-10-seats-quota): 10-Seat Multi-Harness Roster + Quota Fault to completion', () => {
    const wt = getWalkthrough('wt-10-seats-quota');
    let state = createInitialCouncilState(wt.initialConfig);

    assert.equal(state.phase, 'preflight');
    assert.equal(state.canonicalPhase, 'ROSTER_CONFIGURATION');
    assert.equal(state.seats.length, 10);
    assert.equal(state.maxRetriesPerSeat, 1);

    // Step 1: Begin Round 1
    state = transitionCouncil(state, wt.steps[0].event);
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.phase, 'reviewing');

    // Step 2: 9 seats submit proofs / telemetry
    for (const evt of wt.steps[1].multiEvents) {
      state = transitionCouncil(state, evt);
      assert.equal(state.lastTransition.ok, true);
    }
    assert.equal(state.proofs.length, 2);

    // Step 3: Seat #8 hits quota -> SEAT_FAULT
    state = transitionCouncil(state, wt.steps[2].event);
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.phase, 'seat_fault');
    assert.equal(state.canonicalPhase, 'RECOVERY');
    assert.equal(state.faultSeatId, 'grok-contrarian');

    // Step 4: Retry seat #8 once (1/1 allowed)
    state = transitionCouncil(state, wt.steps[3].event);
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.phase, 'reviewing');
    const grokSeat = state.seats.find((s) => s.id === 'grok-contrarian');
    assert.equal(grokSeat.retries, 1);

    // Step 5: Seat #8 faults again -> second retry BLOCKED by guard
    const fault2 = wt.steps[4].multiEvents[0];
    state = transitionCouncil(state, fault2);
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.phase, 'seat_fault');

    const retry2 = wt.steps[4].multiEvents[1];
    state = transitionCouncil(state, retry2);
    assert.equal(state.lastTransition.ok, false); // Blocked by Retry Cap Guard!
    assert.match(state.lastTransition.message, /Retry Cap Guard/);
    assert.equal(state.phase, 'seat_fault');

    // Step 6: Excuse Seat #8 ("quota is reached, dude is off")
    state = transitionCouncil(state, wt.steps[5].event);
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.phase, 'reviewing');
    const excusedSeat = state.seats.find((s) => s.id === 'grok-contrarian');
    assert.equal(excusedSeat.status, 'excused');
    const remainingActive = state.seats.filter((s) => s.status !== 'excused');
    assert.equal(remainingActive.length, 9);

    // Step 7: Judge synthesizes Candidate & remaining 9 active seats vote accept -> Consensus!
    for (const evt of wt.steps[6].multiEvents) {
      state = transitionCouncil(state, evt);
      assert.equal(state.lastTransition.ok, true);
    }

    // Final outcome assertion: Unanimous Consensus with 9 active seats
    assert.equal(state.phase, 'completed');
    assert.equal(state.canonicalPhase, 'CONSENSUS_REACHED');
    assert.ok(state.verdict);
    assert.equal(state.verdict.kind, 'Unanimous Consensus');
    assert.equal(state.verdict.activeSeatCount, 9);
    assert.equal(state.verdict.excusedSeatCount, 1);
    assert.match(state.verdict.note, /All 9 active Seats accepted/);
  });

  it('runs Walkthrough 3 (wt-opus-guardrails): Guardrails & Preserved Excused-Seat Objection', () => {
    const wt = getWalkthrough('wt-opus-guardrails');
    let state = createInitialCouncilState(wt.initialConfig);

    assert.equal(state.phase, 'preflight');
    assert.equal(state.canonicalPhase, 'ROSTER_CONFIGURATION');
    assert.equal(state.seats.length, 3);

    // Step 1: Begin Round 1
    state = transitionCouncil(state, wt.steps[0].event);
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.phase, 'reviewing');

    // Step 2: [ILLEGAL] Bare opinion without source -> BLOCKED by structural guard
    const badProofEvt = wt.steps[1].event;
    state = transitionCouncil(state, badProofEvt);
    assert.equal(state.lastTransition.ok, false);
    assert.match(
      state.lastTransition.message,
      /verifiable "source" is required; bare opinions are forbidden/
    );
    assert.equal(state.phase, 'reviewing');
    assert.equal(state.proofs.length, 0);

    // Step 3: Submit valid proofs P1 & P2 and enter judging
    for (const evt of wt.steps[2].multiEvents) {
      state = transitionCouncil(state, evt);
      assert.equal(state.lastTransition.ok, true);
    }
    assert.equal(state.proofs.length, 2);
    assert.equal(state.phase, 'judging');

    // Step 4: [ILLEGAL] Judge tries to cite non-admitted proof P_FAKE -> BLOCKED by proof-binding guard
    const fakeCiteEvt = wt.steps[3].event;
    state = transitionCouncil(state, fakeCiteEvt);
    assert.equal(state.lastTransition.ok, false);
    assert.match(state.lastTransition.message, /cites unverified Proof "P_FAKE"/);
    assert.equal(state.phase, 'judging');
    assert.equal(state.candidate, null);

    // Step 5: Judge synthesizes valid candidate; opus-auditor raises objection O1 backed by P2
    for (const evt of wt.steps[4].multiEvents) {
      state = transitionCouncil(state, evt);
      assert.equal(state.lastTransition.ok, true);
    }
    assert.equal(state.phase, 'confirming');
    assert.ok(state.candidate);
    assert.equal(state.objections.length, 1);
    assert.equal(state.objections[0].id, 'O1');
    assert.equal(state.objections[0].seatId, 'opus-auditor');
    assert.equal(state.objections[0].status, 'open');

    // Step 6: [ILLEGAL] sol-speed tries to withdraw opus-auditor's objection O1 -> BLOCKED by ownership guard
    const illegalWithdrawalEvt = wt.steps[5].event;
    state = transitionCouncil(state, illegalWithdrawalEvt);
    assert.equal(state.lastTransition.ok, false);
    assert.match(state.lastTransition.message, /Objection Ownership Guard/);
    assert.equal(state.objections[0].status, 'open');

    // Step 7: opus-auditor hits quota & is excused -> O1 locked as preserved_excused
    for (const evt of wt.steps[6].multiEvents) {
      state = transitionCouncil(state, evt);
      assert.equal(state.lastTransition.ok, true);
    }
    assert.equal(state.phase, 'confirming');
    assert.equal(state.objections[0].status, 'preserved_excused');

    // Step 8: Evaluate round -> Blocks false consensus and emits Dissent Report preserving O1!
    state = transitionCouncil(state, wt.steps[7].event);
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.phase, 'completed');
    assert.equal(state.canonicalPhase, 'DISSENT_REPORT');
    assert.ok(state.verdict);
    assert.equal(
      state.verdict.kind,
      'Dissent Report (Preserved Excused-Seat Objection)'
    );
    assert.equal(state.verdict.activeSeatCount, 2);
    assert.equal(state.verdict.excusedSeatCount, 1);
    assert.equal(state.verdict.unresolvedObjections.length, 1);
    assert.equal(state.verdict.unresolvedObjections[0].status, 'preserved_excused');
    assert.equal(state.verdict.unresolvedObjections[0].id, 'O1');
    assert.match(state.verdict.note, /Objection\(s\) from an Excused Seat remain locked/);
  });
});
