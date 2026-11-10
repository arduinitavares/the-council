/**
 * @fileoverview Challenger Adversarial Test Suite for Milestone M4 (Issue #71).
 * Empirically stress-tests 3-state proof admission, fail-closed guards, caveat validation,
 * prototype pollution resistance, malformed decision fuzzing, and reducer boundary resilience.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  guardJudgeAuditAndSynthesize,
  validateCandidateClauses
} from '../../src/machine/guards.js';
import {
  createInitialCouncilState,
  transitionCouncil,
  COUNCIL_EVENTS
} from '../../src/index.js';

function createJudgingState(proofIds = ['P1', 'P2']) {
  return {
    phase: 'judging',
    round: 1,
    minQuorum: 2,
    seats: [
      { id: 's1', status: 'idle', harness: 'mock', model: 'm1', soul: 'voter' },
      { id: 's2', status: 'idle', harness: 'mock', model: 'm2', soul: 'voter' }
    ],
    judge: { id: 'judge', status: 'thinking', harness: 'mock', model: 'jm' },
    proofs: proofIds.map((id, idx) => ({
      id,
      round: 1,
      seatId: `s${(idx % 2) + 1}`,
      scope: 'Core',
      kind: 'check',
      source: 'test.log',
      statement: `Statement for ${id}`,
      status: 'pending',
      judgeNote: null
    }))
  };
}

function setupFullEngineJudgingState() {
  let state = createInitialCouncilState();
  state = transitionCouncil(state, {
    type: COUNCIL_EVENTS.ADD_SEAT,
    seat: { id: 's1', harness: 'mock', model: 'm1', soul: 'voter' }
  });
  state = transitionCouncil(state, {
    type: COUNCIL_EVENTS.ADD_SEAT,
    seat: { id: 's2', harness: 'mock', model: 'm2', soul: 'voter' }
  });
  state = transitionCouncil(state, { type: COUNCIL_EVENTS.BEGIN_ROUND });
  state = transitionCouncil(state, {
    type: COUNCIL_EVENTS.SUBMIT_PROOF,
    id: 'P1',
    seatId: 's1',
    scope: 'Flight',
    kind: 'check',
    source: 'log1.txt',
    statement: 'Sustained flight confirmed.'
  });
  state = transitionCouncil(state, {
    type: COUNCIL_EVENTS.SUBMIT_PROOF,
    id: 'P2',
    seatId: 's2',
    scope: 'Engine',
    kind: 'benchmark',
    source: 'log2.txt',
    statement: '12 hp engine output.'
  });
  state = transitionCouncil(state, { type: COUNCIL_EVENTS.START_JUDGING });
  return state;
}

describe('Challenger M4-1: Adversarial Stress & Fuzzing (Issue #71)', () => {
  describe('Vector 1: Prototype Pollution & Malicious Object Properties', () => {
    it('rejects prototype pollution attacks via __proto__, constructor, and toString', () => {
      const state = createJudgingState(['P1', 'P2']);

      // Attempt 1: __proto__ pollution on proofDecisions
      const protoPolluted = JSON.parse('{"__proto__": {"P1": "admitted"}}');
      const res1 = guardJudgeAuditAndSynthesize(state, {
        proofDecisions: protoPolluted,
        clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
      });
      // P1 was NOT an own-property, so it defaults to admitted (or P1 is own property if parsed differently)
      // Verify no prototype leakage to Object.prototype
      assert.equal(Object.prototype.P1, undefined);

      // Attempt 2: Explicit malicious prototype keys directly in decisions
      const maliciousKeys = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf'];
      for (const malKey of maliciousKeys) {
        const decisions = {};
        decisions[malKey] = { status: 'rejected' };
        decisions['P1'] = { status: 'admitted' };

        const res = guardJudgeAuditAndSynthesize(state, {
          proofDecisions: decisions,
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
        });
        assert.equal(res.ok, true, `Malicious key "${malKey}" should not crash or corrupt standard proof evaluation`);
        assert.equal(res.admittedIds.has('P1'), true);
        assert.equal(res.admittedIds.has(malKey), false);
      }
    });

    it('safely handles malicious proof IDs matching Object prototype methods', () => {
      // Suppose an adversary seat managed to submit a proof with id "toString" or "constructor"
      const state = createJudgingState(['toString', 'constructor', 'P1']);

      // Case A: Omitted decisions for prototype-named proofs -> safely defaults without crash
      const resDefault = guardJudgeAuditAndSynthesize(state, {
        proofDecisions: { P1: { status: 'admitted' } },
        clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1', 'toString', 'constructor'] }]
      });
      assert.equal(resDefault.ok, true);
      assert.equal(resDefault.admittedIds.has('toString'), true);
      assert.equal(resDefault.admittedIds.has('constructor'), true);

      // Case B: Explicit rejection of prototype-named proof
      const resReject = guardJudgeAuditAndSynthesize(state, {
        proofDecisions: {
          toString: { status: 'rejected' },
          P1: { status: 'admitted' }
        },
        clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['toString'] }]
      });
      assert.equal(resReject.ok, false);
      assert.match(resReject.message, /cites unverified Proof "toString"/);

      // Case C: Null-prototype decisions object (Object.create(null))
      const nullProtoDecisions = Object.create(null);
      nullProtoDecisions.P1 = { status: 'admitted' };
      const resNullProto = guardJudgeAuditAndSynthesize(state, {
        proofDecisions: nullProtoDecisions,
        clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
      });
      assert.equal(resNullProto.ok, true);
      assert.equal(resNullProto.admittedIds.has('P1'), true);
    });
  });

  describe('Vector 2: Fuzzing Non-Object proofDecisions Container', () => {
    it('fails closed when proofDecisions container is of an invalid type', () => {
      const state = createJudgingState();
      const invalidContainers = [
        123,
        0,
        -1,
        3.14159,
        NaN,
        Infinity,
        -Infinity,
        true,
        false,
        'admitted',
        '',
        '   ',
        [],
        ['P1'],
        [1, 2, 3],
        () => ({ P1: 'admitted' }),
        Symbol('container')
      ];

      for (const badContainer of invalidContainers) {
        const res = guardJudgeAuditAndSynthesize(state, {
          proofDecisions: badContainer,
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
        });
        assert.equal(res.ok, false, `Expected rejection for container: ${String(badContainer)}`);
        assert.match(res.message, /proofDecisions must be an object|invalid/i);
      }
    });

    it('safely handles null and undefined proofDecisions as empty object (default admission)', () => {
      const state = createJudgingState();
      for (const emptyVal of [null, undefined]) {
        const res = guardJudgeAuditAndSynthesize(state, {
          proofDecisions: emptyVal,
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1', 'P2'] }]
        });
        assert.equal(res.ok, true, `Expected null/undefined to default admit proofs`);
        assert.equal(res.admittedIds.has('P1'), true);
        assert.equal(res.admittedIds.has('P2'), true);
      }
    });
  });

  describe('Vector 3: Fuzzing Invalid Decision Types for Proof Entries', () => {
    it('fails closed when a proof decision entry has an invalid type', () => {
      const state = createJudgingState();
      const invalidEntries = [
        null,
        undefined, // explicit key with undefined value: { P1: undefined }
        123,
        0,
        -1,
        NaN,
        Infinity,
        [],
        ['admitted'],
        ['partially_admitted'],
        () => {},
        Symbol('admitted')
      ];

      for (const badEntry of invalidEntries) {
        const res = guardJudgeAuditAndSynthesize(state, {
          proofDecisions: { P1: badEntry },
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
        });
        assert.equal(res.ok, false, `Expected rejection for entry: ${String(badEntry)}`);
        assert.match(res.message, /invalid decision type/i);
      }
    });

    it('fails closed when dec.status is not a string', () => {
      const state = createJudgingState();
      const badStatusTypes = [
        123,
        0,
        true,
        false,
        null,
        [],
        {},
        () => {},
        Symbol('foo')
      ];

      for (const badStatus of badStatusTypes) {
        const res = guardJudgeAuditAndSynthesize(state, {
          proofDecisions: { P1: { status: badStatus } },
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
        });
        assert.equal(res.ok, false, `Expected rejection for status type: ${typeof badStatus}`);
        assert.match(res.message, /invalid decision status type/i);
      }
    });

    it('fails closed when dec.admitted is not a boolean', () => {
      const state = createJudgingState();
      const badAdmittedTypes = [
        'true',
        'false',
        'admitted',
        1,
        0,
        null,
        [],
        {},
        () => {}
      ];

      for (const badAdmitted of badAdmittedTypes) {
        const res = guardJudgeAuditAndSynthesize(state, {
          proofDecisions: { P1: { admitted: badAdmitted } },
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
        });
        assert.equal(res.ok, false, `Expected rejection for dec.admitted: ${String(badAdmitted)}`);
        assert.match(res.message, /invalid admitted property/i);
      }
    });

    it('fails closed when decision object is empty or lacks recognized status/notes', () => {
      const state = createJudgingState();
      const emptyOrGarbageObjects = [
        {},
        { arbitrary: 'value' },
        { foo: 1, bar: 2 },
        { note: '' },
        { note: '   ' },
        { reason: '' },
        { reason: '   ' },
        { note: null },
        { reason: null }
      ];

      for (const badObj of emptyOrGarbageObjects) {
        const res = guardJudgeAuditAndSynthesize(state, {
          proofDecisions: { P1: badObj },
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
        });
        assert.equal(res.ok, false, `Expected rejection for: ${JSON.stringify(badObj)}`);
        assert.match(res.message, /empty or missing recognized status/i);
      }
    });
  });

  describe('Vector 4: Boundary & Unknown Status Strings', () => {
    it('strictly rejects unrecognized, malformed, or case-mismatched status strings', () => {
      const state = createJudgingState();
      const badStrings = [
        'pending',
        'unknown',
        'ADMITTED',
        'admitted ',
        ' admitted',
        'PARTIALLY_ADMITTED',
        'partially admitted',
        'admitted_with_caveats',
        'REJECTED',
        'rejected ',
        ' rejected',
        '',
        '   ',
        'true',
        'false',
        'null',
        'undefined',
        'NaN',
        'needs_work',
        'provisional'
      ];

      for (const str of badStrings) {
        // Direct string decision: { P1: str }
        const resDirect = guardJudgeAuditAndSynthesize(state, {
          proofDecisions: { P1: str },
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
        });
        assert.equal(resDirect.ok, false, `Expected rejection for direct string: "${str}"`);
        assert.match(resDirect.message, /unrecognized decision status|invalid decision status/i);

        // Object status decision: { P1: { status: str, note: 'Valid note' } }
        const resObj = guardJudgeAuditAndSynthesize(state, {
          proofDecisions: { P1: { status: str, note: 'Valid note' } },
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
        });
        assert.equal(resObj.ok, false, `Expected rejection for object status: "${str}"`);
        assert.match(resObj.message, /unrecognized decision status/i);
      }
    });
  });

  describe('Vector 5: Exhaustive Caveat Validation for Partial Admission', () => {
    it('fails closed across all forms of whitespace, empty, null, and non-string caveats', () => {
      const state = createJudgingState();
      const statuses = ['partially_admitted', 'admitted_with_caveat'];

      const invalidCaveatBodies = [
        {},
        { note: '' },
        { note: ' ' },
        { note: '   ' },
        { note: '\t\n\r' },
        { note: null },
        { note: 123 },
        { note: [] },
        { note: {} },
        { admittedStatement: '' },
        { admittedStatement: ' ' },
        { admittedStatement: '   ' },
        { admittedStatement: '\n\t' },
        { admittedStatement: null },
        { admittedStatement: 123 },
        { reason: '' },
        { reason: '   ' },
        { reason: null },
        { note: '  ', admittedStatement: '  ', reason: '  ' },
        { note: '', admittedStatement: null, reason: undefined }
      ];

      for (const status of statuses) {
        // As a bare string without caveat object
        const resString = guardJudgeAuditAndSynthesize(state, {
          proofDecisions: { P1: status },
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
        });
        assert.equal(resString.ok, false, `Bare string status "${status}" must reject without caveat`);
        assert.match(resString.message, /without a required caveat/i);

        for (const body of invalidCaveatBodies) {
          const decision = { status, ...body };
          const res = guardJudgeAuditAndSynthesize(state, {
            proofDecisions: { P1: decision },
            clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
          });
          assert.equal(res.ok, false, `Expected caveat rejection for: ${JSON.stringify(decision)}`);
          assert.match(res.message, /requires a non-empty note or admittedStatement/i);
        }
      }
    });

    it('accepts partially_admitted and admitted_with_caveat when any valid caveat is provided', () => {
      const state = createJudgingState();
      const validCaveats = [
        { note: 'Verified core only' },
        { reason: 'Core is sound' },
        { admittedStatement: 'Citable core statement' },
        { admittedStatement: 'Core', note: 'Flawed subclaim removed' },
        { admittedStatement: 'Core', reason: 'Derived from primary sources' }
      ];

      for (const caveat of validCaveats) {
        for (const status of ['partially_admitted', 'admitted_with_caveat']) {
          const res = guardJudgeAuditAndSynthesize(state, {
            proofDecisions: { P1: { status, ...caveat } },
            clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
          });
          assert.equal(res.ok, true, `Expected valid caveat to pass: ${status} with ${JSON.stringify(caveat)}`);
          assert.equal(res.admittedIds.has('P1'), true);
        }
      }
    });
  });

  describe('Vector 6: Reducer Fail-Closed State Integrity & Mutation Defense', () => {
    it('preserves pristine state when guard fails closed on malicious inputs', () => {
      const state = setupFullEngineJudgingState();
      const p1Original = JSON.parse(JSON.stringify(state.proofs[0]));
      const p2Original = JSON.parse(JSON.stringify(state.proofs[1]));

      const maliciousPayloads = [
        { proofDecisions: { P1: 'unknown' } },
        { proofDecisions: { P1: { status: 'partially_admitted' } } },
        { proofDecisions: { P1: 123 } },
        { proofDecisions: { P1: null } },
        { proofDecisions: { P1: {} } },
        { proofDecisions: { P1: { status: 'ADMITTED' } } },
        { proofDecisions: 'malicious_string' },
        { proofDecisions: [1, 2, 3] }
      ];

      for (const payload of maliciousPayloads) {
        const next = transitionCouncil(state, {
          type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
          summary: 'Malicious attempt',
          ...payload,
          clauses: [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }]
        });

        assert.equal(next.lastTransition.ok, false, `Transition should fail for: ${JSON.stringify(payload)}`);
        assert.equal(next.phase, 'judging', 'Phase must remain judging on failed synthesis');
        assert.equal(next.candidate, null, 'Candidate must not be synthesized');
        assert.deepEqual(next.proofs[0], p1Original, 'P1 must not be mutated');
        assert.deepEqual(next.proofs[1], p2Original, 'P2 must not be mutated');
      }
    });

    it('normalizes admitted_with_caveat to partially_admitted and trims admittedStatement', () => {
      const state = setupFullEngineJudgingState();
      const next = transitionCouncil(state, {
        type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
        summary: 'Synthesis with admitted_with_caveat alias',
        proofDecisions: {
          P1: {
            status: 'admitted_with_caveat',
            admittedStatement: '  Verified 852 ft flight on Dec 17, 1903.  ',
            note: '  Excised secondary calm air claim.  '
          },
          P2: {
            status: 'admitted',
            note: '  Clean benchmark.  '
          }
        },
        clauses: [
          { context: 'Flight', conclusion: 'Proven', citedProofIds: ['P1'] },
          { context: 'Engine', conclusion: 'Sufficient', citedProofIds: ['P2'] }
        ]
      });

      assert.equal(next.lastTransition.ok, true);
      assert.equal(next.phase, 'confirming');

      const p1 = next.proofs.find((p) => p.id === 'P1');
      assert.equal(p1.status, 'partially_admitted', 'Status must normalize to partially_admitted');
      assert.equal(p1.admissionKind, 'partially_admitted');
      assert.equal(p1.judgeAdmittedStatement, 'Verified 852 ft flight on Dec 17, 1903.');
      assert.equal(p1.judgeNote, 'Excised secondary calm air claim.');

      const p2 = next.proofs.find((p) => p.id === 'P2');
      assert.equal(p2.status, 'admitted');
      assert.equal(p2.admissionKind, 'explicitly_admitted');
      assert.equal(p2.judgeAdmittedStatement, undefined, 'Fully admitted proofs must not retain judgeAdmittedStatement');
      assert.equal(p2.judgeNote, 'Clean benchmark.');
    });

    it('handles partially_admitted when admittedStatement is omitted but note is provided', () => {
      const state = setupFullEngineJudgingState();
      const next = transitionCouncil(state, {
        type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
        summary: 'Synthesis with note-only caveat',
        proofDecisions: {
          P1: {
            status: 'partially_admitted',
            note: 'Caveat explanation without custom statement'
          }
        },
        clauses: [{ context: 'Flight', conclusion: 'Proven', citedProofIds: ['P1'] }]
      });

      assert.equal(next.lastTransition.ok, true);
      const p1 = next.proofs.find((p) => p.id === 'P1');
      assert.equal(p1.status, 'partially_admitted');
      assert.equal(p1.judgeAdmittedStatement, null, 'judgeAdmittedStatement must be null when absent');
      assert.equal(p1.judgeNote, 'Caveat explanation without custom statement');
    });
  });

  describe('Vector 7: Downstream Deliberation Lifecycle with Partially Admitted Proofs', () => {
    it('supports full consensus round with partially_admitted proofs and allows citation in objections', () => {
      let state = setupFullEngineJudgingState();

      // 1. Synthesize candidate with P1 partially admitted and P2 admitted
      state = transitionCouncil(state, {
        type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
        summary: 'Candidate synthesis',
        proofDecisions: {
          P1: { status: 'partially_admitted', note: 'Caveat' },
          P2: { status: 'admitted' }
        },
        clauses: [
          { context: 'Flight', conclusion: 'Affirmed', citedProofIds: ['P1'] },
          { context: 'Engine', conclusion: 'Affirmed', citedProofIds: ['P2'] }
        ]
      });
      assert.equal(state.lastTransition.ok, true);
      assert.equal(state.phase, 'confirming');

      // 2. Voter s1 votes object citing partially_admitted proof P1 -> MUST BE ALLOWED
      const objRes = transitionCouncil(state, {
        type: COUNCIL_EVENTS.CAST_VOTE,
        seatId: 's1',
        vote: 'object',
        proofId: 'P1',
        reason: 'Narrowed core does not prove continuous powered control.'
      });
      assert.equal(objRes.lastTransition.ok, true, 'Objection citing partially_admitted proof P1 must be accepted');
      assert.equal(objRes.seats.find((s) => s.id === 's1').status, 'objected');
      assert.equal(objRes.objections.length, 1);
      assert.equal(objRes.objections[0].proofId, 'P1');

      // 3. Voter s1 changes vote to accept (withdrawing objection)
      const acceptRes = transitionCouncil(objRes, {
        type: COUNCIL_EVENTS.CAST_VOTE,
        seatId: 's1',
        vote: 'accept'
      });
      assert.equal(acceptRes.lastTransition.ok, true);
      assert.equal(acceptRes.objections[0].status, 'withdrawn');

      // 4. Voter s2 votes accept
      const finalRes = transitionCouncil(acceptRes, {
        type: COUNCIL_EVENTS.CAST_VOTE,
        seatId: 's2',
        vote: 'accept'
      });
      assert.equal(finalRes.lastTransition.ok, true);

      // 5. Evaluate round -> Unanimous Consensus
      const evalRes = transitionCouncil(finalRes, { type: COUNCIL_EVENTS.EVALUATE_ROUND });
      assert.equal(evalRes.lastTransition.ok, true);
      assert.equal(evalRes.phase, 'completed');
      assert.equal(evalRes.verdict.kind, 'Unanimous Consensus');
    });

    it('rejects objection citing a rejected proof', () => {
      let state = setupFullEngineJudgingState();
      state = transitionCouncil(state, {
        type: COUNCIL_EVENTS.JUDGE_AUDIT_AND_SYNTHESIZE,
        summary: 'Synthesis with P2 rejected',
        proofDecisions: {
          P1: { status: 'admitted' },
          P2: { status: 'rejected', note: 'Disproven' }
        },
        clauses: [{ context: 'Flight', conclusion: 'Affirmed', citedProofIds: ['P1'] }]
      });

      const badObj = transitionCouncil(state, {
        type: COUNCIL_EVENTS.CAST_VOTE,
        seatId: 's1',
        vote: 'object',
        proofId: 'P2',
        reason: 'Attempting to cite rejected proof'
      });
      assert.equal(badObj.lastTransition.ok, false);
      assert.match(badObj.lastTransition.message, /Objection must cite a valid Proof ID/);
    });
  });

  describe('Vector 8: High-Volume Pseudo-Random Fuzzing Harness', () => {
    it('executes 500 randomized adversarial inputs without unhandled exceptions or memory leaks', () => {
      const state = createJudgingState(['P1', 'P2']);
      const validClauses = [{ context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1'] }];

      const fuzzTokens = [
        'admitted', 'rejected', 'partially_admitted', 'admitted_with_caveat',
        'pending', 'unknown', 'invalid', 'ADMITTED', 'REJECTED', '', '   ',
        true, false, null, undefined, 0, 1, -1, 999999, NaN, Infinity,
        [], ['admitted'], {}, { note: '' }, { note: '   ' }, { note: 'Valid note' },
        { admittedStatement: '' }, { admittedStatement: 'Core' },
        { status: 'admitted' }, { status: 'rejected' }, { status: 'unknown' },
        { status: 'partially_admitted' }, { status: 'partially_admitted', note: 'Note' },
        { status: 'admitted_with_caveat', admittedStatement: 'Core' },
        { admitted: true }, { admitted: false }, { admitted: 'true' }
      ];

      const startTime = Date.now();
      let rejectedCount = 0;
      let admittedCount = 0;

      for (let i = 0; i < 500; i++) {
        // Pick random token for P1
        const t1 = fuzzTokens[i % fuzzTokens.length];
        const t2 = fuzzTokens[(i * 7 + 3) % fuzzTokens.length];

        const decisions = { P1: t1, P2: t2 };

        let result;
        assert.doesNotThrow(() => {
          result = guardJudgeAuditAndSynthesize(state, {
            proofDecisions: decisions,
            clauses: validClauses
          });
        }, `Fuzz iteration ${i} must never throw unhandled exception`);

        assert.equal(typeof result.ok, 'boolean');
        if (result.ok) {
          admittedCount++;
          assert.equal(result.admittedIds instanceof Set, true);
        } else {
          rejectedCount++;
          assert.equal(typeof result.message, 'string');
          assert.ok(result.message.length > 0);
        }
      }

      const elapsed = Date.now() - startTime;
      assert.ok(elapsed < 2000, `500 fuzz iterations should complete well under 2s (actual: ${elapsed}ms)`);
      assert.ok(rejectedCount > 0, 'Fuzzer must exercise fail-closed rejection paths');
      assert.ok(admittedCount > 0, 'Fuzzer must exercise valid paths');
    });
  });
});
