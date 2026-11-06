import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  assertPhase
} from '../../helpers/council.js';
import { getWalkthrough } from '../../fixtures/walkthrough-scenarios.js';

describe('Tier 4: Real-World Application Scenarios — wt-opus-guardrails Walkthrough Port', () => {
  it('should run Walkthrough 3: Opus 5.5 Guardrails & Excused-Seat Objection Preservation to completion', () => {
    const wt = getWalkthrough('wt-opus-guardrails');
    let state = createInitialCouncilState(wt.initialConfig);

    assertPhase(state, 'preflight');
    assert.equal(state.seats.length, 3);

    // Step 1: Begin Round 1
    state = transitionCouncil(state, wt.steps[0].event);
    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'reviewing');

    // Step 2: [ILLEGAL] Bare opinion without source -> BLOCKED by structural guard
    const badProofEvt = wt.steps[1].event;
    state = transitionCouncil(state, badProofEvt);
    assert.equal(state.lastTransition.ok, false);
    assert.match(state.lastTransition.message, /verifiable "source" is required; bare opinions are forbidden/);
    assertPhase(state, 'reviewing');
    assert.equal(state.proofs.length, 0); // Proof was not added

    // Step 3: Submit valid proofs P1 & P2 and enter judging
    for (const evt of wt.steps[2].multiEvents) {
      state = transitionCouncil(state, evt);
      assert.equal(state.lastTransition.ok, true);
    }
    assert.equal(state.proofs.length, 2);
    assertPhase(state, 'judging');

    // Step 4: [ILLEGAL] Judge tries to cite non-admitted proof P_FAKE -> BLOCKED by proof-binding guard
    const fakeCiteEvt = wt.steps[3].event;
    state = transitionCouncil(state, fakeCiteEvt);
    assert.equal(state.lastTransition.ok, false);
    assert.match(state.lastTransition.message, /cites unverified Proof "P_FAKE"/);
    assertPhase(state, 'judging'); // Stays in judging
    assert.equal(state.candidate, null);

    // Step 5: Judge synthesizes valid candidate; opus-auditor raises objection O1 backed by P2
    for (const evt of wt.steps[4].multiEvents) {
      state = transitionCouncil(state, evt);
      assert.equal(state.lastTransition.ok, true);
    }
    assertPhase(state, 'confirming');
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
    assertPhase(state, 'confirming');
    assert.equal(state.objections[0].status, 'preserved_excused');

    // Step 8: Evaluate round -> Blocks false consensus and emits Dissent Report preserving O1!
    state = transitionCouncil(state, wt.steps[7].event);
    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'completed');
    assert.ok(state.verdict);
    assert.equal(state.verdict.kind, 'Dissent Report (Preserved Excused-Seat Objection)');
    assert.equal(state.verdict.activeSeatCount, 2);
    assert.equal(state.verdict.excusedSeatCount, 1);
    assert.equal(state.verdict.unresolvedObjections.length, 1);
    assert.equal(state.verdict.unresolvedObjections[0].status, 'preserved_excused');
    assert.equal(state.verdict.unresolvedObjections[0].id, 'O1');
    assert.match(state.verdict.note, /Objection\(s\) from an Excused Seat remain locked/);
  });
});
