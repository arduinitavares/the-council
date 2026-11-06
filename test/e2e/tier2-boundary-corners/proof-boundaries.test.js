import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  validateProof,
  EVENTS
} from '../../helpers/council.js';

describe('Tier 2: Boundary & Corner Cases — Proof Validation', () => {
  function getReviewingState() {
    let state = createInitialCouncilState({
      seats: [
        { id: 's1', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Engineer' },
        { id: 's2', harness: 'antigravity', model: 'gemini-4-argon', soul: 'Reviewer' }
      ]
    });
    return transitionCouncil(state, { type: EVENTS.BEGIN_ROUND });
  }

  it('B1.1 should reject proof with empty or whitespace-only scope', () => {
    const state = getReviewingState();
    const badScopes = ['', '   ', '\t\n\r'];
    for (const scope of badScopes) {
      const next = transitionCouncil(state, {
        type: EVENTS.SUBMIT_PROOF,
        seatId: 's1',
        scope,
        kind: 'check',
        source: 'Valid Source',
        statement: 'Valid Statement'
      });
      assert.equal(next.lastTransition.ok, false);
      assert.match(next.lastTransition.message, /"scope" condition is required/);
    }
  });

  it('B1.2 should reject proof with invalid or empty proof kind', () => {
    const state = getReviewingState();
    const badKinds = ['opinion', 'guess', 'vibe', '', 'CHECK', 'Citation'];
    for (const kind of badKinds) {
      const next = transitionCouncil(state, {
        type: EVENTS.SUBMIT_PROOF,
        seatId: 's1',
        scope: 'Production',
        kind,
        source: 'Valid Source',
        statement: 'Valid Statement'
      });
      assert.equal(next.lastTransition.ok, false);
      assert.match(next.lastTransition.message, /"kind" must be check, citation, benchmark, or derivation/);
    }
  });

  it('B1.3 should reject proof with empty or whitespace-only source (Bare Opinion Guard)', () => {
    const state = getReviewingState();
    const badSources = ['', '   ', '\t \n '];
    for (const source of badSources) {
      const next = transitionCouncil(state, {
        type: EVENTS.SUBMIT_PROOF,
        seatId: 's1',
        scope: 'Production',
        kind: 'citation',
        source,
        statement: 'Unit tests feel fast.'
      });
      assert.equal(next.lastTransition.ok, false);
      assert.match(next.lastTransition.message, /verifiable "source" is required; bare opinions are forbidden/);
    }
  });

  it('B1.4 should reject proof with empty or whitespace-only statement', () => {
    const state = getReviewingState();
    const badStatements = ['', '   ', ' \n\t '];
    for (const statement of badStatements) {
      const next = transitionCouncil(state, {
        type: EVENTS.SUBMIT_PROOF,
        seatId: 's1',
        scope: 'Production',
        kind: 'check',
        source: 'uname -a',
        statement
      });
      assert.equal(next.lastTransition.ok, false);
      assert.match(next.lastTransition.message, /falsifiable "statement" is required/);
    }
  });

  it('B1.5 should accept proof with special characters, unicode, and multi-line markdown', () => {
    let state = getReviewingState();
    const complexStatement = `### Formal Theorem π & Invariant Ω
- Clause (∀x ∈ ℂ): |e^{ix}| = 1
- Emoji support: 🚀 Council deliberation ✅
- Quotes and escapes: "hello" 'world' \`code snippet\`
- Multi-line description:
  Line 1
  Line 2
    Indented line 3`;

    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P_UNICODE',
      seatId: 's1',
      scope: 'Mathematical Foundations (𝔽_q)',
      kind: 'derivation',
      source: 'Euler Formula & Unicode 15.0 Spec (RFC 3629)',
      statement: complexStatement
    });

    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.proofs[0].statement, complexStatement);
    assert.equal(state.proofs[0].scope, 'Mathematical Foundations (𝔽_q)');
  });

  it('B1.6 should accept large statement payloads (stress boundary: 64KB string)', () => {
    let state = getReviewingState();
    const largeStatement = 'A'.repeat(64 * 1024); // 64 KB
    state = transitionCouncil(state, {
      type: EVENTS.SUBMIT_PROOF,
      id: 'P_LARGE',
      seatId: 's1',
      scope: 'Large benchmark log',
      kind: 'benchmark',
      source: 'perf log output',
      statement: largeStatement
    });

    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.proofs[0].statement.length, 64 * 1024);
  });
});
