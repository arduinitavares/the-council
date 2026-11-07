import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateProof,
  isValidProofKind,
  sanitizeProofInput,
  formatProofRecord
} from '../../src/proofs/validator.js';

import {
  createInitialCouncilState,
  transitionCouncil,
  canRetrySeat,
  guardRetrySeat,
  checkQuorum,
  guardBeginRound,
  dropsBelowQuorumOnExcusal,
  guardEvaluateRound
} from '../../src/index.js';

describe('Adversarial Stress Test Suite — Challenger 2 (Empirical Proof, Quorum & Retry Hardening)', () => {

  // ==========================================================================
  // MISSION 1: STRESS-TEST validateProof
  // ==========================================================================
  describe('Mission 1: Stress-test validateProof against hostile and boundary inputs', () => {
    it('rejects null, undefined, primitive numbers, booleans, and functions', () => {
      const nonObjects = [
        null,
        undefined,
        0,
        123,
        -42,
        3.14159,
        NaN,
        Infinity,
        -Infinity,
        true,
        false,
        Symbol('proof'),
        () => {},
        function() {}
      ];

      for (const input of nonObjects) {
        const res = validateProof(input);
        assert.equal(res.valid, false, `Expected ${String(input)} to be invalid`);
        assert.ok(
          res.errors.includes('Structural Proof Guard: proof input must be an object.'),
          `Expected object error for ${String(input)}`
        );
      }
    });

    it('rejects empty object and objects missing all required fields', () => {
      const emptyRes = validateProof({});
      assert.equal(emptyRes.valid, false);
      assert.equal(emptyRes.errors.length, 4);
      assert.ok(emptyRes.errors.includes('Structural Proof Guard: "scope" condition is required.'));
      assert.ok(emptyRes.errors.includes('Structural Proof Guard: "kind" must be check, citation, benchmark, or derivation.'));
      assert.ok(emptyRes.errors.includes('Structural Proof Guard: verifiable "source" is required; bare opinions are forbidden.'));
      assert.ok(emptyRes.errors.includes('Structural Proof Guard: falsifiable "statement" is required.'));
    });

    it('rejects whitespace-only strings across all fields', () => {
      const whitespaceInputs = [
        '   ',
        '\t\t\t',
        '\n\r\n',
        '  \t  \n  \r  '
      ];

      for (const ws of whitespaceInputs) {
        const proof = {
          scope: ws,
          kind: 'check',
          source: ws,
          statement: ws
        };
        const res = validateProof(proof);
        assert.equal(res.valid, false);
        assert.ok(res.errors.includes('Structural Proof Guard: "scope" condition is required.'));
        assert.ok(res.errors.includes('Structural Proof Guard: verifiable "source" is required; bare opinions are forbidden.'));
        assert.ok(res.errors.includes('Structural Proof Guard: falsifiable "statement" is required.'));
      }
    });

    it('rejects multi-byte Unicode whitespace characters in scope, source, and statement', () => {
      // Test individual and combinations of Unicode whitespace characters
      const unicodeWhitespaces = [
        '\u00A0', // No-break space
        '\u1680', // Ogham space mark
        '\u2000', // En quad
        '\u2001', // Em quad
        '\u2002', // En space
        '\u2003', // Em space
        '\u2004', // Three-per-em space
        '\u2005', // Four-per-em space
        '\u2006', // Six-per-em space
        '\u2007', // Figure space
        '\u2008', // Punctuation space
        '\u2009', // Thin space
        '\u200A', // Hair space
        '\u2028', // Line separator
        '\u2029', // Paragraph separator
        '\u202F', // Narrow no-break space
        '\u205F', // Medium mathematical space
        '\u3000', // Ideographic space (CJK fullwidth space)
        '\uFEFF', // Zero width no-break space / byte order mark
        '\u00A0\u3000\u2003\u2028', // Composite multi-byte Unicode whitespace
      ];

      for (const uws of unicodeWhitespaces) {
        const proof = {
          scope: uws,
          kind: 'citation',
          source: uws,
          statement: uws
        };
        const res = validateProof(proof);
        assert.equal(res.valid, false, `Expected unicode whitespace U+${uws.charCodeAt(0).toString(16)} to be rejected`);
        assert.ok(res.errors.includes('Structural Proof Guard: "scope" condition is required.'));
        assert.ok(res.errors.includes('Structural Proof Guard: verifiable "source" is required; bare opinions are forbidden.'));
        assert.ok(res.errors.includes('Structural Proof Guard: falsifiable "statement" is required.'));
      }
    });

    it('strictly rejects invalid kinds including opinion, hunch, vibe, guess, capitalized or corrupted', () => {
      const invalidKinds = [
        'opinion',
        'hunch',
        'vibe',
        'guess',
        'feeling',
        'intuition',
        'Check',
        'CHECK',
        'CITATION',
        'BENCHMARK',
        'DERIVATION',
        'check ',
        ' citation',
        'check\0',
        '__proto__',
        'constructor',
        null,
        undefined,
        123,
        {},
        []
      ];

      for (const kind of invalidKinds) {
        const proof = {
          scope: 'Scope Alpha',
          kind,
          source: 'primary-source.txt',
          statement: 'Verifiable factual statement.'
        };
        const res = validateProof(proof);
        assert.equal(res.valid, false, `Expected kind "${kind}" to be rejected`);
        assert.ok(
          res.errors.includes('Structural Proof Guard: "kind" must be check, citation, benchmark, or derivation.'),
          `Expected invalid kind error for "${kind}"`
        );
      }
    });

    it('strictly enforces that any proof lacking a verifiable source is rejected', () => {
      const nonVerifiableSources = [
        '',
        ' ',
        '   \t   ',
        '\u3000\u3000',
        null,
        undefined,
        12345,
        false,
        true,
        {},
        [],
        ['array-source'],
        { url: 'https://example.com' }
      ];

      for (const badSource of nonVerifiableSources) {
        const proof = {
          scope: 'Context Scope',
          kind: 'derivation',
          source: badSource,
          statement: 'Mathematical proof step.'
        };
        const res = validateProof(proof);
        assert.equal(res.valid, false, `Expected non-verifiable source ${JSON.stringify(badSource)} to be rejected`);
        assert.ok(
          res.errors.includes('Structural Proof Guard: verifiable "source" is required; bare opinions are forbidden.')
        );
      }
    });

    it('enforces validator behavior inside transitionCouncil(SUBMIT_PROOF)', () => {
      let state = createInitialCouncilState({ minQuorum: 2 });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's1', harness: 'codex', model: 'gpt-6-codex', soul: 'pragmatist' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's2', harness: 'cursor', model: 'claude-3-7-sonnet', soul: 'auditor' }
      });
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      assert.equal(state.phase, 'reviewing');

      // Attempt submit bare opinion (no source)
      const bareOpinion = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's1',
        scope: 'Production',
        kind: 'citation',
        source: '  \u3000  ',
        statement: 'Opinions are not proofs'
      });
      assert.equal(bareOpinion.lastTransition.ok, false);
      assert.ok(bareOpinion.lastTransition.message.includes('verifiable "source" is required; bare opinions are forbidden'));

      // Attempt submit invalid kind
      const invalidKind = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's1',
        scope: 'Production',
        kind: 'opinion',
        source: 'my-head.txt',
        statement: 'I feel this is good'
      });
      assert.equal(invalidKind.lastTransition.ok, false);
      assert.ok(invalidKind.lastTransition.message.includes('"kind" must be check, citation, benchmark, or derivation'));
    });
  });

  // ==========================================================================
  // MISSION 2: STRESS-TEST QUORUM BOUNDARIES
  // ==========================================================================
  describe('Mission 2: Stress-test Quorum Boundaries', () => {
    it('terminates immediately in "Dissent Report (Below Quorum)" when excusing 1 seat drops 2-seat council below minQuorum=2', () => {
      let state = createInitialCouncilState({ minQuorum: 2, maxRounds: 3 });

      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 'seat_a', harness: 'codex', model: 'gpt-6-codex', soul: 'builder' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 'seat_b', harness: 'cursor', model: 'claude-3-7-sonnet', soul: 'critic' }
      });

      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      assert.equal(state.phase, 'reviewing');
      assert.equal(state.round, 1);

      // Fault seat_a
      state = transitionCouncil(state, {
        type: 'SEAT_FAULT',
        seatId: 'seat_a',
        reason: 'Token quota exhausted mid-deliberation'
      });
      assert.equal(state.phase, 'seat_fault');
      assert.equal(state.canonicalPhase, 'RECOVERY');

      // dropsBelowQuorumOnExcusal should predict quorum drop
      assert.equal(dropsBelowQuorumOnExcusal(state, 'seat_a'), true);

      // Excuse seat_a -> Active seats drop to 1, minQuorum is 2
      state = transitionCouncil(state, {
        type: 'EXCUSE_SEAT',
        seatId: 'seat_a',
        reason: 'Permanent quota exhaustion'
      });

      // Assert immediate termination in Dissent Report (Below Quorum)
      assert.equal(state.phase, 'completed');
      assert.equal(state.canonicalPhase, 'DISSENT_REPORT');
      assert.ok(state.verdict, 'Verdict must be recorded');
      assert.equal(state.verdict.kind, 'Dissent Report (Below Quorum)');
      assert.equal(state.verdict.activeSeatCount, 1);
      assert.equal(state.verdict.excusedSeatCount, 1);
      assert.ok(state.verdict.note.includes('dropped below minimum quorum (2). Consensus forbidden.'));
      assert.equal(state.lastTransition.ok, true);
      assert.ok(state.lastTransition.message.includes('Active seats fell below quorum → Dissent Report'));
    });

    it('rejects BEGIN_ROUND when council has 1 seat and minQuorum = 2', () => {
      let state = createInitialCouncilState({ minQuorum: 2, maxRounds: 3 });

      // Add only 1 seat
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 'lonely_seat', harness: 'codex', model: 'gpt-6-codex', soul: 'soloist' }
      });

      // Check checkQuorum helper
      const q = checkQuorum(state, 2);
      assert.equal(q.hasQuorum, false);
      assert.equal(q.activeCount, 1);
      assert.equal(q.minQuorum, 2);

      // Check guardBeginRound directly
      const guardRes = guardBeginRound(state);
      assert.equal(guardRes.ok, false);
      assert.equal(guardRes.message, 'Active Seats (1) below minimum quorum (2).');

      // Attempt BEGIN_ROUND transition
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });

      // Assert rejection
      assert.equal(state.lastTransition.ok, false);
      assert.equal(
        state.lastTransition.message,
        'Guard rejected BEGIN_ROUND: Active Seats (1) below minimum quorum (2).'
      );
      assert.equal(state.phase, 'preflight');
      assert.equal(state.round, 0);
    });

    it('double-gates in EVALUATE_ROUND when unexpected quorum drop occurs, strictly rejecting consensus', () => {
      // Set up council with 3 seats, minQuorum = 3
      let state = createInitialCouncilState({ minQuorum: 3, maxRounds: 3 });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's1', harness: 'codex', model: 'gpt-6-codex', soul: 'alpha' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's2', harness: 'cursor', model: 'claude-3-7-sonnet', soul: 'beta' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's3', harness: 'antigravity', model: 'gemini-2.5-pro', soul: 'gamma' }
      });

      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });

      // Submit proofs
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's1',
        scope: 'Kernel',
        kind: 'benchmark',
        source: 'benchmarks.log',
        statement: 'Throughput 10k req/s'
      });
      state = transitionCouncil(state, { type: 'START_JUDGING' });
      state = transitionCouncil(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        proofDecisions: { P1: { status: 'admitted', note: 'Verified benchmark.' } },
        summary: 'Candidate Consensus',
        clauses: [{ context: 'Throughput', conclusion: '10k req/s verified', citedProofIds: ['P1'] }]
      });

      assert.equal(state.phase, 'confirming');

      // All 3 seats vote accept
      state = transitionCouncil(state, { type: 'CAST_VOTE', seatId: 's1', vote: 'accept' });
      state = transitionCouncil(state, { type: 'CAST_VOTE', seatId: 's2', vote: 'accept' });
      state = transitionCouncil(state, { type: 'CAST_VOTE', seatId: 's3', vote: 'accept' });

      // Simulate unexpected quorum increase or seat drop right before evaluate:
      // Suppose state.minQuorum is increased to 4 (e.g. dynamic threshold)
      // or s3 was excused right before evaluate without triggering completed
      const stateWithQuorumMismatch = {
        ...state,
        minQuorum: 4 // Requires 4, but only 3 active seats exist
      };

      const evalResult = transitionCouncil(stateWithQuorumMismatch, { type: 'EVALUATE_ROUND' });

      // Assert that consensus is NOT reached; instead Dissent Report (Below Quorum) is emitted
      assert.equal(evalResult.phase, 'completed');
      assert.equal(evalResult.canonicalPhase, 'DISSENT_REPORT');
      assert.equal(evalResult.verdict.kind, 'Dissent Report (Below Quorum)');
      assert.equal(evalResult.verdict.activeSeatCount, 3);
      assert.ok(evalResult.verdict.note.includes('dropped below minimum quorum (4). Consensus forbidden.'));
    });

    it('handles excusal of seat when remaining seats meet minQuorum without premature termination', () => {
      let state = createInitialCouncilState({ minQuorum: 2, maxRounds: 3 });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's1', harness: 'codex', model: 'gpt-6-codex', soul: 's1' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's2', harness: 'cursor', model: 'claude-3-7-sonnet', soul: 's2' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's3', harness: 'antigravity', model: 'gemini-2.5-pro', soul: 's3' }
      });
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });

      // Excuse s1 from 3 seats down to 2 seats (minQuorum=2)
      assert.equal(dropsBelowQuorumOnExcusal(state, 's1'), false);

      state = transitionCouncil(state, {
        type: 'EXCUSE_SEAT',
        seatId: 's1',
        reason: 'Hardware fault'
      });

      // Should NOT terminate; should remain in reviewing with 2 active seats
      assert.equal(state.phase, 'reviewing');
      assert.equal(state.verdict, null);
      assert.equal(state.lastTransition.ok, true);
    });
  });

  // ==========================================================================
  // MISSION 3: STRESS-TEST RETRY CAPS
  // ==========================================================================
  describe('Mission 3: Stress-test Retry Caps', () => {
    it('enforces maxRetriesPerSeat = 1: 1 retry succeeds, 2nd retry is strictly rejected with guard message', () => {
      let state = createInitialCouncilState({
        minQuorum: 2,
        maxRetriesPerSeat: 1
      });

      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 'seat_faulty', harness: 'codex', model: 'gpt-6-codex', soul: 'flaky' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 'seat_steady', harness: 'cursor', model: 'claude-3-7-sonnet', soul: 'steady' }
      });

      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      assert.equal(state.phase, 'reviewing');

      // 1. First Fault
      state = transitionCouncil(state, {
        type: 'SEAT_FAULT',
        seatId: 'seat_faulty',
        reason: 'Rate limit 429'
      });
      assert.equal(state.phase, 'seat_fault');
      const faultySeatAfterFault1 = state.seats.find((s) => s.id === 'seat_faulty');
      assert.equal(faultySeatAfterFault1.retries, 0);

      // Check canRetrySeat directly
      const canRetry1 = canRetrySeat(faultySeatAfterFault1, 1);
      assert.equal(canRetry1.allowed, true);

      // 2. First Retry (succeeds)
      state = transitionCouncil(state, {
        type: 'RETRY_SEAT',
        seatId: 'seat_faulty'
      });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.phase, 'reviewing');
      const faultySeatAfterRetry1 = state.seats.find((s) => s.id === 'seat_faulty');
      assert.equal(faultySeatAfterRetry1.retries, 1);

      // 3. Second Fault
      state = transitionCouncil(state, {
        type: 'SEAT_FAULT',
        seatId: 'seat_faulty',
        reason: 'Rate limit 429 again'
      });
      assert.equal(state.phase, 'seat_fault');
      const faultySeatAfterFault2 = state.seats.find((s) => s.id === 'seat_faulty');
      assert.equal(faultySeatAfterFault2.retries, 1);

      // Check canRetrySeat directly: must be forbidden
      const canRetry2 = canRetrySeat(faultySeatAfterFault2, 1);
      assert.equal(canRetry2.allowed, false);
      assert.equal(
        canRetry2.reason,
        'Retry Cap Guard: Seat "seat_faulty" reached 1/1 retries. Excuse Seat instead.'
      );

      // Check guardRetrySeat directly
      const guardRes = guardRetrySeat(state, { seatId: 'seat_faulty' });
      assert.equal(guardRes.ok, false);
      assert.equal(
        guardRes.message,
        'Retry Cap Guard: Seat "seat_faulty" reached 1/1 retries. Excuse Seat instead.'
      );

      // 4. Second Retry (must be rejected by transitionCouncil)
      const rejectedState = transitionCouncil(state, {
        type: 'RETRY_SEAT',
        seatId: 'seat_faulty'
      });

      assert.equal(rejectedState.lastTransition.ok, false);
      assert.equal(
        rejectedState.lastTransition.message,
        'Guard rejected RETRY_SEAT: Retry Cap Guard: Seat "seat_faulty" reached 1/1 retries. Excuse Seat instead.'
      );
      assert.equal(rejectedState.phase, 'seat_fault');

      // The seat retry count must NOT increment on rejection
      const seatStillCapped = rejectedState.seats.find((s) => s.id === 'seat_faulty');
      assert.equal(seatStillCapped.retries, 1);

      // 5. Must be able to excuse the capped seat instead
      const excusedState = transitionCouncil(rejectedState, {
        type: 'EXCUSE_SEAT',
        seatId: 'seat_faulty',
        reason: 'Max retries exhausted'
      });
      // Since minQuorum=2 and 1 seat remains, it terminates with Dissent Report
      assert.equal(excusedState.phase, 'completed');
      assert.equal(excusedState.verdict.kind, 'Dissent Report (Below Quorum)');
    });

    it('enforces maxRetriesPerSeat = 0: immediate rejection on first retry attempt', () => {
      let state = createInitialCouncilState({
        minQuorum: 2,
        maxRetriesPerSeat: 0
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 'zero_tolerance_seat', harness: 'codex', model: 'gpt-6-codex', soul: 'fragile' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 'other_seat', harness: 'cursor', model: 'claude-3-7-sonnet', soul: 'robust' }
      });
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });

      state = transitionCouncil(state, {
        type: 'SEAT_FAULT',
        seatId: 'zero_tolerance_seat'
      });
      assert.equal(state.phase, 'seat_fault');

      // Immediate retry attempt
      const retryResult = transitionCouncil(state, {
        type: 'RETRY_SEAT',
        seatId: 'zero_tolerance_seat'
      });

      assert.equal(retryResult.lastTransition.ok, false);
      assert.equal(
        retryResult.lastTransition.message,
        'Guard rejected RETRY_SEAT: Retry Cap Guard: Seat "zero_tolerance_seat" reached 0/0 retries. Excuse Seat instead.'
      );
    });

    it('enforces maxRetriesPerSeat = 3: allows exactly 3 retries and rejects the 4th', () => {
      let state = createInitialCouncilState({
        minQuorum: 2,
        maxRetriesPerSeat: 3
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's1', harness: 'codex', model: 'gpt-6-codex', soul: 's1' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's2', harness: 'cursor', model: 'claude-3-7-sonnet', soul: 's2' }
      });
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });

      for (let i = 1; i <= 3; i++) {
        state = transitionCouncil(state, { type: 'SEAT_FAULT', seatId: 's1' });
        assert.equal(state.phase, 'seat_fault');
        state = transitionCouncil(state, { type: 'RETRY_SEAT', seatId: 's1' });
        assert.equal(state.lastTransition.ok, true, `Retry ${i} should succeed`);
        assert.equal(state.phase, 'reviewing');
        assert.equal(state.seats.find((s) => s.id === 's1').retries, i);
      }

      // 4th fault
      state = transitionCouncil(state, { type: 'SEAT_FAULT', seatId: 's1' });
      assert.equal(state.phase, 'seat_fault');

      // 4th retry must fail
      const fourthRetry = transitionCouncil(state, { type: 'RETRY_SEAT', seatId: 's1' });
      assert.equal(fourthRetry.lastTransition.ok, false);
      assert.equal(
        fourthRetry.lastTransition.message,
        'Guard rejected RETRY_SEAT: Retry Cap Guard: Seat "s1" reached 3/3 retries. Excuse Seat instead.'
      );
    });
  });

  // ==========================================================================
  // ADDITIONAL ADVERSARIAL STRESS VECTORS
  // ==========================================================================
  describe('Additional Adversarial Stress Vectors', () => {
    it('rejects RETRY_SEAT when not in seat_fault phase', () => {
      let state = createInitialCouncilState({ minQuorum: 2 });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's1', harness: 'codex', model: 'gpt-6-codex', soul: 's1' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's2', harness: 'cursor', model: 'claude-3-7-sonnet', soul: 's2' }
      });

      // Try retry from preflight
      const res = transitionCouncil(state, { type: 'RETRY_SEAT', seatId: 's1' });
      assert.equal(res.lastTransition.ok, false);
      assert.equal(res.lastTransition.message, 'Guard rejected RETRY_SEAT: Can only retry a Seat from seat_fault.');
    });

    it('rejects RETRY_SEAT for nonexistent seat ID', () => {
      let state = createInitialCouncilState({ minQuorum: 2 });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's1', harness: 'codex', model: 'gpt-6-codex', soul: 's1' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's2', harness: 'cursor', model: 'claude-3-7-sonnet', soul: 's2' }
      });
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });
      state = transitionCouncil(state, { type: 'SEAT_FAULT', seatId: 's1' });

      const res = transitionCouncil(state, { type: 'RETRY_SEAT', seatId: 'nonexistent_seat' });
      assert.equal(res.lastTransition.ok, false);
      assert.equal(res.lastTransition.message, 'Guard rejected RETRY_SEAT: Faulted Seat not found.');
    });

    it('rejects SUBMIT_PROOF from an excused seat', () => {
      let state = createInitialCouncilState({ minQuorum: 2 });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's1', harness: 'codex', model: 'gpt-6-codex', soul: 's1' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's2', harness: 'cursor', model: 'claude-3-7-sonnet', soul: 's2' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's3', harness: 'antigravity', model: 'gemini-2.5-pro', soul: 's3' }
      });
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });

      // Excuse s1
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 's1' });

      // s1 attempts to submit proof
      const res = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's1',
        scope: 'Kernel',
        kind: 'check',
        source: 'check.log',
        statement: 'check stmt'
      });
      assert.equal(res.lastTransition.ok, false);
      assert.equal(res.lastTransition.message, 'Guard rejected SUBMIT_PROOF: Seat "s1" is not an active Seat.');
    });

    it('rejects CAST_VOTE from an excused seat', () => {
      let state = createInitialCouncilState({ minQuorum: 2 });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's1', harness: 'codex', model: 'gpt-6-codex', soul: 's1' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's2', harness: 'cursor', model: 'claude-3-7-sonnet', soul: 's2' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's3', harness: 'antigravity', model: 'gemini-2.5-pro', soul: 's3' }
      });
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });

      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's2',
        scope: 'Kernel',
        kind: 'citation',
        source: 'docs.md',
        statement: 'Architecture specs'
      });
      state = transitionCouncil(state, { type: 'START_JUDGING' });
      state = transitionCouncil(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        summary: 'Candidate',
        clauses: [{ context: 'Spec', conclusion: 'Valid', citedProofIds: ['P1'] }]
      });

      // Excuse s1
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 's1' });

      // Excused seat attempts to vote
      const voteRes = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 's1',
        vote: 'accept'
      });
      assert.equal(voteRes.lastTransition.ok, false);
      assert.equal(voteRes.lastTransition.message, 'Guard rejected CAST_VOTE: Seat "s1" is not an active voting Seat.');
    });

    it('rejects WITHDRAW_OBJECTION on preserved_excused objection even if active seat tries to withdraw it', () => {
      let state = createInitialCouncilState({ minQuorum: 2 });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's1', harness: 'codex', model: 'gpt-6-codex', soul: 's1' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's2', harness: 'cursor', model: 'claude-3-7-sonnet', soul: 's2' }
      });
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's3', harness: 'antigravity', model: 'gemini-2.5-pro', soul: 's3' }
      });
      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });

      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        seatId: 's1',
        scope: 'Kernel',
        kind: 'citation',
        source: 'docs.md',
        statement: 'Architecture specs'
      });
      state = transitionCouncil(state, { type: 'START_JUDGING' });
      state = transitionCouncil(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        summary: 'Candidate',
        clauses: [{ context: 'Spec', conclusion: 'Valid', citedProofIds: ['P1'] }]
      });

      // s1 raises objection
      state = transitionCouncil(state, {
        type: 'CAST_VOTE',
        seatId: 's1',
        vote: 'object',
        proofId: 'P1',
        reason: 'Unresolved flaw'
      });

      // Excuse s1 -> locks objection as preserved_excused
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 's1' });
      const obj = state.objections.find((o) => o.id === 'O1');
      assert.equal(obj.status, 'preserved_excused');

      // Active seat s2 attempts to withdraw s1's locked objection
      const withdrawAttempt = transitionCouncil(state, {
        type: 'WITHDRAW_OBJECTION',
        seatId: 's2',
        objectionId: 'O1'
      });

      assert.equal(withdrawAttempt.lastTransition.ok, false);
      assert.equal(
        withdrawAttempt.lastTransition.message,
        'Guard rejected WITHDRAW_OBJECTION: Objection Immutability Guard: Objection "O1" is locked as preserved_excused and cannot be withdrawn.'
      );
    });
  });
});
