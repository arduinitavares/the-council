import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  assertPhase,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 1: Feature Coverage — Discovery (Clarification Batches)', () => {
  function createPreflightState() {
    return createInitialCouncilState({
      seats: [
        { id: 'seat-1', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Architect' },
        { id: 'seat-2', harness: 'antigravity', model: 'gemini-4-argon', soul: 'Engineer' }
      ]
    });
  }

  it('2.1 should start clarification batch, transition to clarifying, and set active seats to thinking', () => {
    let state = createPreflightState();
    assertPhase(state, 'preflight');
    assert.equal(state.clarificationBatch, 0);

    state = transitionCouncil(state, { type: EVENTS.START_CLARIFYING });
    assert.equal(state.lastTransition.ok, true);
    assertPhase(state, 'clarifying');
    assert.equal(state.clarificationBatch, 1);
    assert.equal(state.seats[0].status, 'thinking');
    assert.equal(state.seats[1].status, 'thinking');
  });

  it('2.2 should publish clarification, record answer, and reset active seats to idle', () => {
    let state = createPreflightState();
    state = transitionCouncil(state, { type: EVENTS.START_CLARIFYING });
    const answer = 'Target platform is Linux OCI containers on ARM64.';

    state = transitionCouncil(state, {
      type: EVENTS.PUBLISH_CLARIFICATION,
      answer
    });
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.clarifications.length, 1);
    assert.equal(state.clarifications[0].batch, 1);
    assert.equal(state.clarifications[0].answer, answer);
    assert.equal(state.seats[0].status, 'idle');
    assert.equal(state.seats[1].status, 'idle');
  });

  it('2.3 should reject publishing clarification with empty or whitespace-only answer', () => {
    let state = createPreflightState();
    state = transitionCouncil(state, { type: EVENTS.START_CLARIFYING });

    const badAnswers = ['', '   ', '\t\n'];
    for (const ans of badAnswers) {
      const next = transitionCouncil(state, {
        type: EVENTS.PUBLISH_CLARIFICATION,
        answer: ans
      });
      assert.equal(next.lastTransition.ok, false);
      assert.match(next.lastTransition.message, /cannot be empty/);
    }
  });

  it('2.4 should reject publishing clarification when not in clarifying phase', () => {
    const state = createPreflightState();
    assertPhase(state, 'preflight');

    const next = transitionCouncil(state, {
      type: EVENTS.PUBLISH_CLARIFICATION,
      answer: 'Premature answer.'
    });
    assert.equal(next.lastTransition.ok, false);
    assert.match(next.lastTransition.message, /Can only publish clarification answers during clarifying/);
  });

  it('2.5 should enforce maxClarificationBatches limit', () => {
    let state = createInitialCouncilState({
      maxClarificationBatches: 2,
      seats: [
        { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' },
        { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
      ]
    });

    // Batch 1
    state = transitionCouncil(state, { type: EVENTS.START_CLARIFYING });
    assert.equal(state.lastTransition.ok, true);
    state = transitionCouncil(state, { type: EVENTS.PUBLISH_CLARIFICATION, answer: 'Answer 1' });

    // Batch 2
    state = transitionCouncil(state, { type: EVENTS.START_CLARIFYING });
    assert.equal(state.lastTransition.ok, true);
    state = transitionCouncil(state, { type: EVENTS.PUBLISH_CLARIFICATION, answer: 'Answer 2' });

    // Batch 3 - should be rejected by guard
    const batch3 = transitionCouncil(state, { type: EVENTS.START_CLARIFYING });
    assert.equal(batch3.lastTransition.ok, false);
    assert.match(batch3.lastTransition.message, /Maximum clarification batches/);
  });

  it('2.6 should support sequential multiple clarification batches', () => {
    let state = createPreflightState();
    state = transitionCouncil(state, { type: EVENTS.START_CLARIFYING });
    state = transitionCouncil(state, { type: EVENTS.PUBLISH_CLARIFICATION, answer: 'Q1 Answer' });
    state = transitionCouncil(state, { type: EVENTS.START_CLARIFYING });
    state = transitionCouncil(state, { type: EVENTS.PUBLISH_CLARIFICATION, answer: 'Q2 Answer' });

    assert.equal(state.clarificationBatch, 2);
    assert.equal(state.clarifications.length, 2);
    assert.equal(state.clarifications[0].batch, 1);
    assert.equal(state.clarifications[1].batch, 2);
  });
});
