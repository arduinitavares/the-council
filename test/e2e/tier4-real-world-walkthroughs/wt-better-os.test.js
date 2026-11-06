import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  assertPhase
} from '../../helpers/council.js';
import { getWalkthrough } from '../../fixtures/walkthrough-scenarios.js';

describe('Tier 4: Real-World Application Scenarios — wt-better-os Walkthrough Port', () => {
  it('should run Walkthrough 1: "What is the better OS?" (Context-Partitioned Consensus) to completion', () => {
    const wt = getWalkthrough('wt-better-os');
    let state = createInitialCouncilState(wt.initialConfig);

    assertPhase(state, 'preflight');
    assert.equal(state.seats.length, 4);

    // Execute all steps from walkthrough
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
        for (const evt of step.multiEvents) {
          state = transitionCouncil(state, evt);
          assert.equal(
            state.lastTransition.ok,
            true,
            `Step ${i + 1} sub-event (${evt.type}) failed: ${state.lastTransition.message}`
          );
        }
      }

      // Check intermediate milestones
      if (i === 1) {
        // Clarification answer published
        assert.equal(state.clarifications.length, 1);
        assert.match(state.clarifications[0].answer, /three target workloads/);
      } else if (i === 7) {
        // Round 1 candidate synthesized
        assertPhase(state, 'confirming');
        assert.ok(state.candidate);
        assert.equal(state.candidate.clauses.length, 3);
        assert.deepEqual(state.candidate.clauses[0].citedProofIds, ['P1']);
        assert.deepEqual(state.candidate.clauses[1].citedProofIds, ['P2']);
        assert.deepEqual(state.candidate.clauses[2].citedProofIds, ['P3']);
      } else if (i === 9) {
        // Round 1 evaluated -> advanced to Round 2 due to O1
        assertPhase(state, 'reviewing');
        assert.equal(state.round, 2);
        assert.equal(state.objections.length, 1);
        assert.equal(state.objections[0].status, 'open');
      } else if (i === 10) {
        // Round 2 candidate synthesized incorporating P1 and P4
        assertPhase(state, 'confirming');
        assert.deepEqual(state.candidate.clauses[0].citedProofIds, ['P1', 'P4']);
      }
    }

    // Final outcome assertion: Unanimous Consensus!
    assertPhase(state, 'completed');
    assert.ok(state.verdict);
    assert.equal(state.verdict.kind, 'Unanimous Consensus');
    assert.equal(state.verdict.activeSeatCount, 4);
    assert.equal(state.verdict.excusedSeatCount, 0);
    assert.equal(state.verdict.unresolvedObjections.length, 0);
    assert.match(state.verdict.note, /All 4 active Seats accepted/);
  });
});
