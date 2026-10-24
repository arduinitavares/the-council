import { describe, expect, it } from 'vitest';
import { H, makeConfirmation, rawQuestion } from '../fixtures/builders.js';
import { Flow, artifact } from './helpers.js';
describe('round barriers and limits', () => {
  it('all three phase barriers settle before the next phase launches', () => {
    const f = new Flow();
    f.ready();
    f.send('ADMIT_ROUND');
    expect(f.s.context.roundsUsed).toBe(1);
    expect(f.s.context.callsReserved).toBe(6);
    f.reviews();
    expect(f.s.state).toBe('prepare_candidate');
    f.candidate();
    expect(f.s.state).toBe('judging');
    f.judge();
    expect(f.s.state).toBe('confirming');
    f.ballots();
    expect(f.s.state).toBe('evaluate_round');
    expect(f.results.at(-1)?.intents.some((i) => i.kind === 'evaluate-round')).toBe(true);
    f.send('EVALUATE_ROUND');
    expect(f.s.context.pendingOutcome).toBe('completed');
    expect(f.s.context.callsReserved).toBe(10);
    f.settle();
    expect(f.s.state).toBe('completed');
  });
  it('round three with one reject still enters evaluate_round, then needs_user', () => {
    const f = new Flow();
    f.ready();
    for (let n = 1; n < 3; n++) {
      f.round(true);
      expect(f.s.state).toBe('prepare_round');
    }
    f.send('ADMIT_ROUND');
    f.reviews();
    f.candidate();
    f.judge();
    f.ballots(true);
    const roundThreeWithOneReject = f.s;
    expect(roundThreeWithOneReject.state).toBe('evaluate_round');
    const roundThreeEvaluation = f.send('EVALUATE_ROUND');
    expect(roundThreeEvaluation.snapshot.state).toBe('settling');
    expect(roundThreeEvaluation.snapshot.context.pendingOutcome).toBe('needs_user');
    expect(roundThreeEvaluation.snapshot.context.resumeTarget).toBe('prepare_round');
    f.settle();
    expect(f.s.context.resumeTarget).toBe('prepare_round');
    const calls = f.s.context.callsReserved;
    f.send('EXTEND', {
      extension: {
        id: 'extra-round',
        baseRevision: f.s.revision,
        authorizationReceipt: 'user-auth',
        expiresAt: 100000,
        additionalClarificationBatches: 0,
        additionalRounds: 1,
        additionalActiveBudgetMs: 0,
      },
    });
    f.resume();
    expect(f.s.state).toBe('prepare_round');
    f.round();
    expect(f.s.context.roundsUsed).toBe(4);
    expect(f.s.context.callsReserved).toBe(calls + 7);
  });
  for (const blocking of [true, false])
    for (const at of ['review', 'ballot'] as const)
      it(`${at} missing input diverts its consumed round when blocking=${blocking}`, () => {
        const f = new Flow();
        f.ready();
        f.send('ADMIT_ROUND');
        if (at === 'review') f.reviews([rawQuestion({ blocking })]);
        else {
          f.reviews();
          f.candidate();
          f.judge();
          f.ballots(false, [rawQuestion({ blocking })]);
        }
        expect(f.s.state).toBe('collecting_questions');
        f.collect('answered');
        f.publish();
        expect(f.s.state).toBe('prepare_round');
        expect(f.s.context.roundsUsed).toBe(1);
        f.send('ADMIT_ROUND');
        expect(f.s.context.roundsUsed).toBe(2);
        expect(f.s.context.clarificationBatchesUsed).toBe(1);
      });
  it('a pending context update wins at the evaluate-round barrier', () => {
    const f = new Flow();
    f.ready();
    f.send('ADMIT_ROUND');
    f.reviews();
    f.candidate();
    f.judge();
    f.ballots();
    f.send('CONTEXT_UPDATE', {
      update: {
        requestId: 'update',
        runId: 'run1',
        baseContextHash: f.s.context.sharedContext.contextHash,
        userDirections: [artifact],
      },
    });
    expect(f.s.state).toBe('preflight');
    f.pass();
    expect(f.s.state).toBe('prepare_round');
    expect(f.s.context.sharedContext.contextRevision).toBe(1);
    expect(f.s.context.roundsUsed).toBe(1);
  });
  it('candidate evidence is an explicit barrier', () => {
    const f = new Flow();
    f.ready();
    f.send('ADMIT_ROUND');
    f.finish('review', () => ({
      kind: 'review',
      proposals: [],
      newObjections: [],
      missingInputQuestions: [],
      methodIds: [],
      evidenceRequests: [
        { id: `e${f.tick}`, claimId: 'claim', source: 'https://example.org', reason: 'check' },
      ],
    }));
    expect(f.s.context.pendingEvidenceIds).toHaveLength(3);
    expect(() => f.send('REQUEST_CANDIDATE')).toThrow();
    for (const id of [...f.s.context.pendingEvidenceIds])
      f.send('EVIDENCE_RECORDED', {
        record: {
          requestId: id,
          status: 'verified',
          sourceLocation: 'https://example.org',
          contentHash: H,
          observationReceipt: 'receipt',
        },
      });
    f.send('REQUEST_CANDIDATE');
    f.candidate();
    expect(f.s.state).toBe('judging');
  });
});
it('round-three question answers publish before the limit guard', () => {
  const f = new Flow();
  f.ready();
  f.round(true);
  f.round(true);
  f.send('ADMIT_ROUND');
  f.reviews([rawQuestion({ blocking: false })]);
  f.collect('answered');
  expect(f.s.state).toBe('publishing_answers');
  f.publish();
  expect(f.s.state).toBe('settling');
  expect(f.s.context.pauseReason).toBe('ROUND_LIMIT');
  expect(f.s.context.resumeTarget).toBe('prepare_round');
  expect(f.s.context.control.publications.at(-1)?.origin).toEqual({
    kind: 'deliberation',
    round: 3,
  });
});
it('staged questions at round three outrank exhausted next-round routing', () => {
  const f = new Flow();
  f.ready();
  f.round(true);
  f.round(true);
  f.send('ADMIT_ROUND');
  f.reviews([rawQuestion({ blocking: false })]);
  f.send('REQUIRE_INPUT', { reason: 'MISSING_HANDOFF', outcome: 'needs_context' });
  f.settle();
  f.resume();
  expect(f.s.state).toBe('collecting_questions');
  expect(f.s.context.roundsUsed).toBe(3);
});
it('a queued update at an open question batch is rejected explicitly if publication makes it stale', () => {
  const f = new Flow();
  f.pass();
  f.clarify([rawQuestion()]);
  f.collect('answered');
  f.send('CONTEXT_UPDATE', {
    update: {
      requestId: 'queued',
      runId: 'run1',
      baseContextHash: f.s.context.sharedContext.contextHash,
      userDirections: [artifact],
    },
  });
  const r = f.publish();
  expect(f.s.context.pendingContextUpdate).toBeNull();
  expect(
    r.intents.some(
      (i) => i.kind === 'report' && JSON.stringify(i.input).includes('STALE_CONTEXT_UPDATE'),
    ),
  ).toBe(true);
  expect(f.s.state).toBe('clarifying');
});
it('deadline and resource boundaries are retained in replayable control fields', () => {
  const f = new Flow();
  f.ready();
  f.send('ADMIT_ROUND');
  const key = Object.keys(f.s.context.issuedLogicalTasks).find((k) => k.includes('/review/'))!;
  f.send('LAUNCH_DISPATCHED', { logicalTaskKey: key });
  expect(f.s.context.deadlines.length).toBeGreaterThan(1);
  const d = f.s.context.deadlines[1]!;
  expect(d.monotonicMs).toBeLessThanOrEqual(
    f.events.at(-1)!.clockReceipt.monotonicMs + f.s.context.request.workerTimeoutMs,
  );
});
it('matches every normative state edge and keeps all states stable', async () => {
  const { readFileSync } = await import('node:fs');
  const { controlEdges, councilMachine } = await import('../../src/machine/council-machine.js');
  const doc = JSON.parse(
    readFileSync(
      new URL('../../docs/superpowers/diagrams/the-council.json', import.meta.url),
      'utf8',
    ),
  );
  const graph = doc.diagrams.find((d: { id: string }) => d.id === 'states').data;
  expect(Object.keys(controlEdges).sort()).toEqual(
    graph.states.map((s: { id: string }) => s.id).sort(),
  );
  for (const edge of graph.transitions)
    expect(controlEdges[edge.from as keyof typeof controlEdges]).toContain(edge.to);
  for (const node of Object.values(councilMachine.config.states!)) {
    expect(node.always).toBeUndefined();
    expect(node.entry).toBeUndefined();
    expect(node.invoke).toBeUndefined();
  }
});
it('queued round-three human answers outrank the round limit on resume', () => {
  const f = new Flow();
  f.ready();
  f.round(true);
  f.round(true);
  f.send('ADMIT_ROUND');
  f.reviews([rawQuestion({ blocking: false })]);
  f.collect();
  f.settle();
  const batch = f.s.context.control.questionBatch!;
  f.send('ANSWER_BATCH', {
    batch: {
      requestId: 'round-three-answer',
      batchId: batch.id,
      origin: batch.origin,
      baseContextHash: batch.baseContextHash,
      answers: batch.presentedQuestionIds.map((id) => ({
        id: `answer-${id}`,
        questionId: id,
        status: 'answered',
        value: 'new fact',
        source: { author: 'user', receiptId: 'receipt' },
        evidenceIds: [],
      })),
      finalized: true,
    },
  });
  const r = f.resume();
  expect(f.s.state).toBe('publishing_answers');
  expect(r.intents.some((i) => i.kind === 'publish-context')).toBe(true);
  f.publish();
  expect(f.s.state).toBe('settling');
  expect(f.s.context.pauseReason).toBe('ROUND_LIMIT');
  expect(f.s.context.resumeTarget).toBe('prepare_round');
  expect(f.s.context.roundsUsed).toBe(3);
});
it('coordinator-required evidence joins the frozen required set and blocks candidate freeze', () => {
  const f = new Flow();
  f.ready();
  f.send('ADMIT_ROUND');
  f.reviews();
  f.send('EVIDENCE_REQUESTED', {
    request: {
      id: 'coordinator-check',
      claimId: 'claim',
      source: 'https://example.org',
      reason: 'Required check',
    },
  });
  expect(f.s.context.requiredEvidenceIds).toContain('coordinator-check');
  expect(() => f.candidate()).toThrow();
  f.send('EVIDENCE_RECORDED', {
    record: {
      requestId: 'coordinator-check',
      status: 'verified',
      sourceLocation: 'https://example.org',
      contentHash: H,
      observationReceipt: 'receipt',
    },
  });
  f.candidate();
  expect(f.s.state).toBe('judging');
});
it('admits the complete evidence set only on an explicit candidate request', () => {
  const f = new Flow();
  f.ready();
  f.send('ADMIT_ROUND');
  const barrier = f.reviews();
  expect(f.s.context.control.candidateRequested).toBe(false);
  expect(barrier.intents.some((i) => i.kind === 'candidate-request')).toBe(false);
  expect(() =>
    f.send('CANDIDATE_FROZEN', { candidate: makeConfirmation().candidate, evidenceHash: H }),
  ).toThrow(/Candidate boundary unavailable/);
  f.send('EVIDENCE_REQUESTED', {
    request: {
      id: 'coordinator-final-check',
      claimId: 'claim',
      source: 'https://example.org',
      reason: 'Check',
    },
  });
  expect(() => f.send('REQUEST_CANDIDATE')).toThrow(/Evidence pending/);
  expect(f.s.context.control.candidateRequested).toBe(false);
  f.send('EVIDENCE_RECORDED', {
    record: {
      requestId: 'coordinator-final-check',
      status: 'verified',
      sourceLocation: 'https://example.org',
      contentHash: H,
      observationReceipt: 'receipt',
    },
  });
  const requested = f.send('REQUEST_CANDIDATE');
  expect(requested.intents.filter((i) => i.kind === 'candidate-request')).toHaveLength(1);
  const frozen = f.s;
  expect(() =>
    f.send('EVIDENCE_REQUESTED', {
      request: {
        id: 'too-late',
        claimId: 'claim',
        source: 'https://example.org',
        reason: 'Late',
      },
    }),
  ).toThrow(/Unexpected or duplicate evidence request/);
  expect(f.s).toBe(frozen);
  expect(f.s.context.requiredEvidenceIds).toEqual(['coordinator-final-check']);
  f.candidate();
  expect(f.s.state).toBe('judging');
});
it('preserves an already registered review objection on prepare_candidate context diversion', () => {
  const f = new Flow();
  f.ready();
  f.send('ADMIT_ROUND');
  f.finish('review', (role) => ({
    kind: 'review',
    proposals: [],
    methodIds: [],
    evidenceRequests: [],
    missingInputQuestions: [],
    newObjections:
      role === 'openai'
        ? [{
            id: 'objection',
            claimId: 'claim',
            claim: 'Needs evidence',
            evidenceIds: [],
            resolution: 'Supply evidence',
            status: 'open',
          }]
        : [],
  }));
  const objections = f.s.context.objections;
  expect(objections).toHaveLength(1);
  f.send('CONTEXT_UPDATE', {
    update: {
      requestId: 'candidate-objection-update',
      runId: 'run1',
      baseContextHash: f.s.context.sharedContext.contextHash,
      userDirections: [artifact],
    },
  });
  expect(() => f.send('PHASE_READY')).not.toThrow();
  expect(f.s.state).toBe('preflight');
  expect(f.s.context.objections).toEqual(objections);
});
it('an unchanged empty publication carries a queued ContextUpdate to prepare_round for explicit application', () => {
  const f = new Flow();
  f.pass();
  f.clarify();
  f.send('CONTEXT_UPDATE', {
    update: {
      requestId: 'after-clarification',
      runId: 'run1',
      baseContextHash: f.s.context.sharedContext.contextHash,
      userDirections: [artifact],
    },
  });
  f.collect();
  f.publish();
  expect(f.s.state).toBe('prepare_round');
  expect(f.s.context.pendingContextUpdate?.requestId).toBe('after-clarification');
  expect(() => f.send('ADMIT_ROUND')).toThrow('PENDING_CONTEXT_UPDATE');
  expect(f.s.context.roundsUsed).toBe(0);
  f.send('APPLY_CONTEXT_UPDATE');
  expect(f.s.context.sharedContext.contextRevision).toBe(1);
  f.send('ADMIT_ROUND');
  expect(f.s.state).toBe('reviewing');
  expect(f.s.context.roundsUsed).toBe(1);
});
it('cancellation reaches the stable cancelled outcome only after settlement', () => {
  const f = new Flow();
  f.ready();
  f.send('CANCEL');
  expect(f.s.state).toBe('settling');
  expect(f.s.context.pendingOutcome).toBe('cancelled');
  f.settle();
  expect(f.s.state).toBe('cancelled');
  expect(f.s.context.activeBudget.status).toBe('settled');
  expect(() => f.send('CLOCK_CHECKPOINT')).toThrow('RUN_SETTLED');
});
