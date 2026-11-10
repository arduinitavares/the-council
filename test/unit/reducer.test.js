import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialCouncilState,
  transitionCouncil,
  getDependencyAndStateGraph,
  activeSeats,
  excusedSeats,
  isQuorumSatisfied,
  getOpenObjections,
  getPreservedObjections,
  getAdmittedProofs,
  COUNCIL_PHASES,
  COUNCIL_EVENTS
} from '../../src/index.js';

describe('Unit: Production State Machine Reducer (src/machine/reducer.js)', () => {
  it('creates clean initial CouncilState with default configuration', () => {
    const state = createInitialCouncilState();
    assert.equal(state.phase, 'preflight');
    assert.equal(state.canonicalPhase, 'ROSTER_CONFIGURATION');
    assert.equal(state.round, 0);
    assert.equal(state.minQuorum, 2);
    assert.equal(state.maxRounds, 3);
    assert.equal(state.maxClarificationBatches, 2);
    assert.equal(state.maxRetriesPerSeat, 1);
    assert.equal(state.seats.length, 0);
    assert.equal(state.proofs.length, 0);
    assert.equal(state.objections.length, 0);
    assert.equal(state.candidate, null);
    assert.equal(state.verdict, null);
    assert.equal(state.lastTransition.ok, true);
    assert.equal(state.history.length, 1);
  });

  it('preserves purity: transitionCouncil never mutates input state in-place', () => {
    const initial = createInitialCouncilState();
    const event = {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's1', harness: 'codex', model: 'gpt-6', soul: 'Architect' }
    };

    const next = transitionCouncil(initial, event);
    assert.notEqual(initial, next);
    assert.equal(initial.seats.length, 0);
    assert.equal(next.seats.length, 1);
  });

  it('rejects events with unknown or missing type property', () => {
    const state = createInitialCouncilState();
    const bad1 = transitionCouncil(state, null);
    assert.equal(bad1.lastTransition.ok, false);

    const bad2 = transitionCouncil(state, { type: 'NON_EXISTENT_EVENT' });
    assert.equal(bad2.lastTransition.ok, false);
    assert.match(bad2.lastTransition.message, /Unknown event type/);
  });

  it('transitions through full consensus lifecycle across all 9 canonical phases', () => {
    // 1. ROSTER_CONFIGURATION (preflight)
    let state = createInitialCouncilState({ minQuorum: 2 });
    assert.equal(state.phase, 'preflight');
    assert.equal(state.canonicalPhase, 'ROSTER_CONFIGURATION');

    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 'seat-a', harness: 'codex', model: 'gpt-6.1-sol', soul: 'Engineer' }
    });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 'seat-b', harness: 'antigravity', model: 'gemini-4-argon', soul: 'QA' }
    });
    assert.equal(state.seats.length, 2);
    assert.equal(activeSeats(state).length, 2);
    assert.equal(isQuorumSatisfied(state), true);

    // 2. SEAT_TELEMETRY (no phase disruption)
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.SEAT_TELEMETRY,
      seatId: 'seat-a',
      status: 'thinking'
    });
    assert.equal(state.phase, 'preflight');
    assert.equal(state.seats[0].status, 'thinking');

    // 3. DISCOVERY (clarifying)
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.START_CLARIFYING });
    assert.equal(state.phase, 'clarifying');
    assert.equal(state.canonicalPhase, 'DISCOVERY');
    assert.equal(state.clarificationBatch, 1);

    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.PUBLISH_CLARIFICATION,
      answer: 'Clarification answer for batch 1.'
    });
    assert.equal(state.clarifications.length, 1);

    // 4. DELIBERATION (reviewing)
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.BEGIN_ROUND });
    assert.equal(state.phase, 'reviewing');
    assert.equal(state.canonicalPhase, 'DELIBERATION');
    assert.equal(state.round, 1);

    // 5. SUBMIT_PROOF
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 'seat-a',
      scope: 'Performance',
      kind: 'benchmark',
      source: 'perf.log',
      statement: 'Latency p99 is 3ms.'
    });
    assert.equal(state.proofs.length, 1);

    // 6. JUDGE_AUDIT_SYNTHESIS (judging)
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.START_JUDGING });
    assert.equal(state.phase, 'judging');
    assert.equal(state.canonicalPhase, 'JUDGE_AUDIT_SYNTHESIS');

    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Round 1 Candidate',
      proofDecisions: { P1: { status: 'admitted', note: 'Valid benchmark' } },
      clauses: [{ context: 'Performance', conclusion: 'Fast', citedProofIds: ['P1'] }]
    });
    assert.equal(state.phase, 'confirming');
    assert.equal(state.canonicalPhase, 'VOTING');
    assert.ok(state.candidate);

    // 7. VOTING (confirming) with Objection & Withdrawal
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.CAST_VOTE,
      seatId: 'seat-b',
      vote: 'object',
      proofId: 'P1',
      reason: 'Need safety check.'
    });
    assert.equal(getOpenObjections(state).length, 1);

    // Withdraw objection
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.WITHDRAW_OBJECTION,
      objectionId: 'O1',
      seatId: 'seat-b'
    });
    assert.equal(getOpenObjections(state).length, 0);

    // Cast accept votes
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.CAST_VOTE,
      seatId: 'seat-a',
      vote: 'accept'
    });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.CAST_VOTE,
      seatId: 'seat-b',
      vote: 'accept'
    });

    // 8. EVALUATE_ROUND -> CONSENSUS_REACHED (completed)
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.EVALUATE_ROUND });
    assert.equal(state.phase, 'completed');
    assert.equal(state.canonicalPhase, 'CONSENSUS_REACHED');
    assert.equal(state.verdict?.kind, 'Unanimous Consensus');
  });

  it('handles RECOVERY phase: SEAT_FAULT, RETRY_SEAT, and EXCUSE_SEAT', () => {
    let state = createInitialCouncilState({ minQuorum: 2 });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' }
    });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
    });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's3', harness: 'cursor', model: 'm3', soul: 'soul3' }
    });
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.BEGIN_ROUND });
    assert.equal(state.phase, 'reviewing');

    // Seat 3 faults on quota
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.SEAT_FAULT,
      seatId: 's3',
      reason: 'Rate limit hit'
    });
    assert.equal(state.phase, 'seat_fault');
    assert.equal(state.canonicalPhase, 'RECOVERY');
    assert.equal(state.faultSeatId, 's3');

    // Retry seat 3
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.RETRY_SEAT, seatId: 's3' });
    assert.equal(state.phase, 'reviewing');
    assert.equal(state.seats[2].retries, 1);

    // Seat 3 faults again -> Retry cap exceeded -> Excused
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.SEAT_FAULT, seatId: 's3' });
    const retryFail = transitionCouncil(state, { type: COUNCIL_EVENTS.RETRY_SEAT, seatId: 's3' });
    assert.equal(retryFail.lastTransition.ok, false);
    assert.match(retryFail.lastTransition.message, /Retry Cap Guard/);

    // Excuse seat 3 with a specific timeout reason
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.EXCUSE_SEAT,
      seatId: 's3',
      reason: 'Harness "cursor" execution timed out after 240000ms'
    });
    assert.equal(state.phase, 'reviewing');
    assert.equal(state.seats[2].status, 'excused');
    assert.equal(state.seats[2].excusedReason, 'Harness "cursor" execution timed out after 240000ms');
    assert.match(state.lastTransition.message, /Harness "cursor" execution timed out after 240000ms/);
    assert.match(state.history[0], /Harness "cursor" execution timed out after 240000ms/);
    assert.doesNotMatch(state.lastTransition.message, /dude is off/);
    assert.doesNotMatch(state.history[0], /dude is off/);
    assert.equal(activeSeats(state).length, 2);
    assert.equal(excusedSeats(state).length, 1);
  });

  it('handles JUDGE_FAULT and RETRY_JUDGE', () => {
    let state = createInitialCouncilState({ minQuorum: 2 });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' }
    });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
    });
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.BEGIN_ROUND });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 's1',
      scope: 'sc',
      kind: 'check',
      source: 'src',
      statement: 'stmt'
    });
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.START_JUDGING });
    assert.equal(state.phase, 'judging');

    // Judge faults with reason and errorClass
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.JUDGE_FAULT,
      reason: '[QuotaExhaustionError] HTTP 429',
      errorClass: 'QuotaExhaustionError'
    });
    assert.equal(state.phase, 'judge_fault');
    assert.equal(state.canonicalPhase, 'RECOVERY');
    assert.equal(state.judge.status, 'fault_quota');
    assert.equal(state.judge.faultReason, '[QuotaExhaustionError] HTTP 429');
    assert.equal(state.judge.errorClass, 'QuotaExhaustionError');

    // Retry judge clears faultReason and errorClass
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.RETRY_JUDGE });
    assert.equal(state.phase, 'judging');
    assert.equal(state.judge.retries, 1);
    assert.equal(state.judge.faultReason, undefined);
    assert.equal(state.judge.errorClass, undefined);

    // Non-fault status passed to SEAT_FAULT / JUDGE_FAULT is sanitized to fault_quota
    const badSeatFault = transitionCouncil(state, {
      type: COUNCIL_EVENTS.SEAT_FAULT,
      seatId: 's1',
      status: 'excused'
    });
    assert.equal(badSeatFault.seats.find((s) => s.id === 's1').status, 'fault_quota');

    const badJudgeFault = transitionCouncil(state, {
      type: COUNCIL_EVENTS.JUDGE_FAULT,
      status: 'excused'
    });
    assert.equal(badJudgeFault.judge.status, 'fault_quota');

    // Terminal JUDGE_FAULT cannot overwrite a completed Verdict or fire in preflight
    const preflightState = createInitialCouncilState({ minQuorum: 2 });
    const rejectedPreflightFault = transitionCouncil(preflightState, {
      type: COUNCIL_EVENTS.JUDGE_FAULT,
      terminal: true,
      reason: 'Premature fault'
    });
    assert.equal(rejectedPreflightFault.lastTransition.ok, false);
    assert.equal(rejectedPreflightFault.phase, 'preflight');

    const termJudgeState = transitionCouncil(state, {
      type: COUNCIL_EVENTS.JUDGE_FAULT,
      terminal: true,
      status: 'fault_timeout',
      reason: 'Timed out'
    });
    assert.equal(termJudgeState.phase, 'completed');
    const overwriteAttempt = transitionCouncil(termJudgeState, {
      type: COUNCIL_EVENTS.JUDGE_FAULT,
      terminal: true,
      reason: 'Late fault'
    });
    assert.equal(overwriteAttempt.lastTransition.ok, false);
    assert.equal(overwriteAttempt.verdict.note, 'Judge candidate synthesis failed: Timed out');

    // RETRY_JUDGE is rejected when phase is seat_fault (even if judge previously faulted)
    const judgeThenSeatFault = transitionCouncil(badJudgeFault, {
      type: COUNCIL_EVENTS.SEAT_FAULT,
      seatId: 's1',
      status: 'fault_timeout'
    });
    assert.equal(judgeThenSeatFault.phase, 'seat_fault');
    const retryJudgeFromSeatFault = transitionCouncil(judgeThenSeatFault, {
      type: COUNCIL_EVENTS.RETRY_JUDGE
    });
    assert.equal(retryJudgeFromSeatFault.lastTransition.ok, false);
  });

  it('terminates with ROUND_TIMEOUT when round limit reached with open objections', () => {
    let state = createInitialCouncilState({ minQuorum: 2, maxRounds: 1 });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' }
    });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's2', harness: 'codex', model: 'm2', soul: 'soul2' }
    });
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.BEGIN_ROUND });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.SUBMIT_PROOF,
      id: 'P1',
      seatId: 's1',
      scope: 'sc',
      kind: 'check',
      source: 'src',
      statement: 'stmt'
    });
    state = transitionCouncil(state, { type: COUNCIL_EVENTS.START_JUDGING });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
      summary: 'Candidate',
      clauses: [{ context: 'sc', conclusion: 'conc', citedProofIds: ['P1'] }]
    });

    state = transitionCouncil(state, { type: COUNCIL_EVENTS.CAST_VOTE, seatId: 's1', vote: 'accept' });
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.CAST_VOTE,
      seatId: 's2',
      vote: 'object',
      proofId: 'P1',
      reason: 'Disagreement'
    });

    state = transitionCouncil(state, { type: COUNCIL_EVENTS.EVALUATE_ROUND });
    assert.equal(state.phase, 'completed');
    assert.equal(state.canonicalPhase, 'ROUND_TIMEOUT');
    assert.equal(state.verdict?.kind, 'Dissent Report (Round Limit Reached)');
  });

  it('resets state cleanly via RESET event', () => {
    let state = createInitialCouncilState();
    state = transitionCouncil(state, {
      type: COUNCIL_EVENTS.ADD_SEAT,
      seat: { id: 's1', harness: 'codex', model: 'm1', soul: 'soul1' }
    });
    assert.equal(state.seats.length, 1);

    const fresh = transitionCouncil(state, { type: COUNCIL_EVENTS.RESET });
    assert.equal(fresh.seats.length, 0);
    assert.equal(fresh.phase, 'preflight');
    assert.equal(fresh.canonicalPhase, 'ROSTER_CONFIGURATION');
  });

  it('computes graph topology via getDependencyAndStateGraph', () => {
    const state = createInitialCouncilState();
    const graph = getDependencyAndStateGraph(state);
    assert.ok(graph.nodes.length >= 8);
    assert.ok(graph.edges.length >= 10);
    assert.equal(graph.activeNodeId, 'preflight');
    assert.ok(Array.isArray(graph.causalLinks));
  });

  // ==========================================================================
  // ISSUE #71: PARTIAL PROOF ADMISSION & FAIL-CLOSED REDUCER
  // ==========================================================================
  describe('Issue #71: Partial Proof Admission & Fail-Closed Reducer (JUDGE_AUDIT_AND_SYNTHESIZE)', () => {
    function setupReviewingState() {
      let state = createInitialCouncilState({ minQuorum: 2 });
      state = transitionCouncil(state, {
        type: COUNCIL_EVENTS.ADD_SEAT,
        seat: { id: 's1', harness: 'codex', model: 'gpt-6', soul: 'Engineer' }
      });
      state = transitionCouncil(state, {
        type: COUNCIL_EVENTS.ADD_SEAT,
        seat: { id: 's2', harness: 'antigravity', model: 'gemini-4', soul: 'QA' }
      });
      state = transitionCouncil(state, { type: COUNCIL_EVENTS.BEGIN_ROUND });
      state = transitionCouncil(state, {
        type: COUNCIL_EVENTS.SUBMIT_PROOF,
        id: 'P1',
        seatId: 's1',
        scope: 'Flight',
        kind: 'citation',
        source: 'fai-record.pdf',
        statement: 'Wright flight reached 852 ft in calm air.'
      });
      return state;
    }

    function setupJudgingState() {
      const state = setupReviewingState();
      return transitionCouncil(state, { type: COUNCIL_EVENTS.START_JUDGING });
    }

    it('RED-1: supports partially_admitted proof with admittedStatement, judgeNote, and candidate citation', () => {
      const state = setupJudgingState();
      const synthesized = transitionCouncil(state, {
        type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
        summary: 'Partial admission synthesis',
        proofDecisions: {
          P1: {
            status: 'partially_admitted',
            admittedStatement: 'Wright flight reached 852 ft.',
            note: 'Excised "in calm air" claim due to recorded 21 mph headwind.'
          }
        },
        clauses: [{ context: 'Flight Distance', conclusion: 'Verified 852 ft', citedProofIds: ['P1'] }]
      });

      assert.equal(synthesized.lastTransition.ok, true);
      assert.equal(synthesized.phase, 'confirming');
      assert.equal(synthesized.canonicalPhase, 'VOTING');
      const p1 = synthesized.proofs.find((p) => p.id === 'P1');
      assert.equal(p1.status, 'partially_admitted');
      assert.equal(p1.judgeAdmittedStatement, 'Wright flight reached 852 ft.');
      assert.equal(p1.judgeNote, 'Excised "in calm air" claim due to recorded 21 mph headwind.');
      assert.ok(p1.admissionKind === 'partially_admitted' || p1.admissionKind === 'explicitly_admitted');
      assert.equal(synthesized.candidate.clauses.length, 1);
      assert.deepEqual(synthesized.candidate.clauses[0].citedProofIds, ['P1']);
    });

    it('RED-2: canonicalizes admitted_with_caveat alias to partially_admitted status', () => {
      const state = setupJudgingState();
      const synthesized = transitionCouncil(state, {
        type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
        summary: 'Caveat alias synthesis',
        proofDecisions: {
          P1: {
            status: 'admitted_with_caveat',
            note: 'Admitted subject to wind tunnel calibration.'
          }
        },
        clauses: [{ context: 'Aerodynamics', conclusion: 'Calibrated', citedProofIds: ['P1'] }]
      });

      assert.equal(synthesized.lastTransition.ok, true);
      const p1 = synthesized.proofs.find((p) => p.id === 'P1');
      assert.equal(p1.status, 'partially_admitted');
      assert.equal(p1.judgeNote, 'Admitted subject to wind tunnel calibration.');
      assert.equal(p1.judgeAdmittedStatement, null);
    });

    it('RED-4 & RED-5: handles mixed proof decisions (admitted, partially_admitted, rejected, default) and enforces citation boundaries', () => {
      let state = setupReviewingState();
      state = transitionCouncil(state, {
        type: COUNCIL_EVENTS.SUBMIT_PROOF,
        id: 'P2',
        seatId: 's1',
        scope: 'Engine',
        kind: 'benchmark',
        source: 'bench.log',
        statement: '12 hp output.'
      });
      state = transitionCouncil(state, {
        type: COUNCIL_EVENTS.SUBMIT_PROOF,
        id: 'P3',
        seatId: 's2',
        scope: 'Patent',
        kind: 'derivation',
        source: 'patent.pdf',
        statement: 'Flawed claim.'
      });
      state = transitionCouncil(state, {
        type: COUNCIL_EVENTS.SUBMIT_PROOF,
        id: 'P4',
        seatId: 's2',
        scope: 'Glider',
        kind: 'check',
        source: 'notes.txt',
        statement: '1902 glider trials.'
      });
      state = transitionCouncil(state, { type: COUNCIL_EVENTS.START_JUDGING });

      // Valid mixed synthesis: P1 admitted, P2 partially_admitted, P3 rejected, P4 omitted (default admitted)
      const validMixed = transitionCouncil(state, {
        type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
        summary: 'Mixed synthesis',
        proofDecisions: {
          P1: { status: 'admitted', note: 'Solid citation' },
          P2: { status: 'partially_admitted', admittedStatement: '12 hp', note: 'RPM variance ignored' },
          P3: { status: 'rejected', note: 'Derivation contains mathematical error' }
          // P4 omitted -> default_admitted
        },
        clauses: [
          { context: 'Power & Flight', conclusion: 'Proven', citedProofIds: ['P1', 'P2'] },
          { context: 'Glider Prior Art', conclusion: 'Solid', citedProofIds: ['P4'] }
        ]
      });

      assert.equal(validMixed.lastTransition.ok, true);
      assert.equal(validMixed.proofs.find((p) => p.id === 'P1').status, 'admitted');
      assert.equal(validMixed.proofs.find((p) => p.id === 'P2').status, 'partially_admitted');
      assert.equal(validMixed.proofs.find((p) => p.id === 'P3').status, 'rejected');
      assert.equal(validMixed.proofs.find((p) => p.id === 'P4').status, 'admitted');

      // Attempt to cite rejected P3 alongside P2 must be rejected by guard
      const badCitation = transitionCouncil(state, {
        type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
        summary: 'Invalid mixed synthesis citing rejected P3',
        proofDecisions: {
          P1: { status: 'admitted' },
          P2: { status: 'partially_admitted', note: 'Caveat' },
          P3: { status: 'rejected', note: 'Error' }
        },
        clauses: [{ context: 'Mixed', conclusion: 'Invalid', citedProofIds: ['P2', 'P3'] }]
      });

      assert.equal(badCitation.lastTransition.ok, false);
      assert.equal(badCitation.phase, 'judging');
      assert.match(badCitation.lastTransition.message, /cites unverified Proof "P3"/);
    });

    it('RED-6: fails closed when explicit decision contains an unrecognized status string', () => {
      const state = setupJudgingState();
      const invalidStatuses = ['unknown', 'pending', 'needs_work', 'invalid_decision', ''];

      for (const badStatus of invalidStatuses) {
        const res = transitionCouncil(state, {
          type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
          summary: 'Bad status synthesis',
          proofDecisions: {
            P1: { status: badStatus, note: 'Some note' }
          },
          clauses: [{ context: 'Context', conclusion: 'Conclusion', citedProofIds: ['P1'] }]
        });

        assert.equal(res.lastTransition.ok, false, `Expected failure for status: "${badStatus}"`);
        assert.equal(res.phase, 'judging');
        assert.equal(res.proofs[0].status, 'pending', 'Proof status must not be corrupted by failed transition');
        assert.match(res.lastTransition.message, /Unrecognized|invalid.*status/i);
      }
    });

    it('RED-7: fails closed when partially_admitted decision lacks both note and admittedStatement', () => {
      const state = setupJudgingState();
      const emptyCaveats = [
        { status: 'partially_admitted' },
        { status: 'partially_admitted', note: '' },
        { status: 'partially_admitted', note: '   ', admittedStatement: '  ' },
        { status: 'admitted_with_caveat' },
        { status: 'admitted_with_caveat', note: '' }
      ];

      for (const badCaveat of emptyCaveats) {
        const res = transitionCouncil(state, {
          type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
          summary: 'Empty caveat synthesis',
          proofDecisions: { P1: badCaveat },
          clauses: [{ context: 'Context', conclusion: 'Conclusion', citedProofIds: ['P1'] }]
        });

        assert.equal(res.lastTransition.ok, false);
        assert.equal(res.phase, 'judging');
        assert.equal(res.proofs[0].status, 'pending');
        assert.match(res.lastTransition.message, /requires a non-empty.*caveat|note|statement/i);
      }
    });
  });
});
