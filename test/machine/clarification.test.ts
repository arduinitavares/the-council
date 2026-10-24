import { describe, expect, it } from 'vitest';
import { H, makeQuestion, rawQuestion } from '../fixtures/builders.js';
import { Flow, request } from './helpers.js';
describe('clarification protocol', () => {
  it('two question waves reserve six calls, zero rounds and publish complete answers', () => {
    const f = new Flow();
    f.pass();
    f.clarify([rawQuestion()]);
    f.collect('answered');
    f.publish();
    expect(f.s.state).toBe('clarifying');
    f.clarify([rawQuestion({ id: 'followup' })]);
    f.collect('answered');
    f.publish();
    expect(f.s.state).toBe('prepare_round');
    expect(f.s.context.callsReserved).toBe(6);
    expect(f.s.context.roundsUsed).toBe(0);
    expect(f.s.context.control.publications).toHaveLength(2);
  });
  it('all-ready publishes a finalized empty answer_batch and skips wave two without changing context', () => {
    const f = new Flow();
    f.ready();
    expect(f.s.context.clarificationBatchesUsed).toBe(1);
    expect(f.s.context.callsReserved).toBe(3);
    expect(f.s.context.sharedContext.contextRevision).toBe(0);
    expect(f.s.context.sharedContext.contextHash).toBe(H);
    expect(f.s.context.control.publications[0]?.input).toMatchObject({
      answers: [],
      finalized: true,
    });
  });
  for (const status of ['unknown', 'declined'] as const)
    it(`finalized ${status} blocks at allowance`, () => {
      const f = new Flow();
      f.pass();
      f.clarify([rawQuestion()]);
      f.collect(status);
      f.publish();
      f.clarify();
      f.collect();
      f.publish();
      expect(f.s.state).toBe('settling');
      expect(f.s.context.pauseReason).toBe('CLARIFICATION_LIMIT');
      expect(f.s.context.resumeTarget).toBe('prepare_round');
      expect(f.s.context.pendingOutcome).toBe('needs_user');
      f.settle();
      expect(f.s.state).toBe('needs_user');
      expect(f.s.context.resumeTarget).toBe('prepare_round');
    });
  it('partial human replies reserve no worker and preserve the open batch', () => {
    const f = new Flow();
    f.pass();
    f.clarify([rawQuestion()]);
    f.collect();
    f.settle();
    const c = f.s.context,
      b = c.control.questionBatch!;
    const r = f.send('ANSWER_BATCH', {
      batch: {
        requestId: 'partial',
        batchId: b.id,
        origin: b.origin,
        baseContextHash: b.baseContextHash,
        answers: [],
        finalized: false,
      },
    });
    expect(r.intents).toEqual([]);
    expect(f.s.state).toBe('needs_user');
    expect(f.s.context.callsReserved).toBe(3);
    f.resume();
    expect(f.s.state).toBe('settling');
    expect(f.s.context.resumeTarget).toBe('publishing_answers');
  });
  it('nonempty second wave can use an authorized allowance of three', () => {
    const r = request();
    r.maxClarificationBatches = 3;
    const f = new Flow(r);
    f.pass();
    for (let n = 1; n <= 2; n++) {
      f.clarify([rawQuestion({ id: `q${n}` })]);
      f.collect('answered');
      f.publish();
      expect(f.s.state).toBe('clarifying');
    }
    expect(f.s.context.clarificationBatchesUsed).toBe(3);
    f.clarify();
    f.collect();
    f.publish();
    expect(f.s.state).toBe('prepare_round');
    expect(f.s.context.callsReserved).toBe(9);
  });
  it('extended max three and an all-ready second wave cannot drop an earlier blocker', () => {
    const r = request();
    r.maxClarificationBatches = 3;
    const f = new Flow(r);
    f.pass();
    f.clarify([rawQuestion()]);
    f.collect('unknown');
    f.publish();
    f.clarify();
    f.collect();
    f.publish();
    expect(f.s.state).toBe('settling');
    expect(f.s.context.callsReserved).toBe(6);
  });
  it('a deferred blocking follow-up remains unresolved at batch two', () => {
    const g = new Flow();
    g.pass();
    g.clarify([rawQuestion()]);
    g.collect('answered');
    g.publish();
    g.clarify([
      rawQuestion({ id: 'a' }),
      rawQuestion({ id: 'b', dependencies: [{ kind: 'local', id: 'a' }] }),
    ]);
    g.collect('answered');
    g.publish();
    expect(g.s.state).toBe('settling');
    expect(
      g.s.context.questionLedger.questions.some((q) => q.disposition === 'deferred' && q.blocking),
    ).toBe(true);
  });
  it('synthetic prior deferred item is promoted during round-origin collection', () => {
    const f = new Flow();
    f.ready();
    const q = makeQuestion({ blocking: false });
    f.s = structuredClone(f.s); // Isolate the synthetic ledger from recorded transition snapshots.
    f.s.context.questionLedger.questions = [q];
    f.send('ADMIT_ROUND');
    f.reviews([rawQuestion({ blocking: false })]);
    const batch = f.batch('answered');
    expect(batch.questions[0]).toMatchObject({ id: q.id, disposition: 'presented' });
    f.send('COLLECT_QUESTIONS', { batch });
    f.publish();
    expect(f.s.state).toBe('prepare_round');
    expect(f.s.context.roundsUsed).toBe(1);
  });
  it('answers a limit-state unresolved item with AnswerRevision, without another clarification inference', () => {
    const f = new Flow();
    f.pass();
    f.clarify([rawQuestion()]);
    f.collect('unknown');
    f.publish();
    f.clarify();
    f.collect();
    f.publish();
    f.settle();
    const q = f.s.context.questionLedger.questions[0]!,
      previous = f.s.context.questionLedger.answers[0]!;
    f.send('ANSWER_REVISION', {
      revision: {
        requestId: 'revision1',
        runId: 'run1',
        baseContextHash: f.s.context.sharedContext.contextHash,
        unresolvedQuestionIds: [q.id],
        answers: [
          {
            id: 'corrected',
            questionId: q.id,
            supersededAnswerId: previous.id,
            status: 'answered',
            value: 'fact',
            source: { author: 'user', receiptId: 'receipt' },
            evidenceIds: [],
          },
        ],
      },
    });
    expect(f.s.context.resumeTarget).toBe('prepare_round');
    f.resume();
    expect(f.results.at(-2)?.snapshot.state).toBe('preflight');
    expect(f.results.at(-2)?.snapshot.context.resumeTarget).toBe('prepare_round');
    expect(f.s.state).toBe('publishing_answers');
    expect(f.s.context.resumeTarget).toBe('prepare_round');
    f.publish();
    expect(f.s.state).toBe('prepare_round');
    expect(f.s.context.resumeTarget).toBeNull();
    expect(f.s.context.callsReserved).toBe(6);
    expect(f.s.context.questionLedger.answers).toHaveLength(2);
  });
});
it('an all-ready second wave with a promoted unknown blocker does not launch an extended third wave', () => {
  const r = request();
  r.maxClarificationBatches = 3;
  const f = new Flow(r);
  f.pass();
  f.clarify([
    rawQuestion({ id: 'base' }),
    rawQuestion({ id: 'follow', dependencies: [{ kind: 'local', id: 'base' }] }),
  ]);
  f.collect('answered');
  f.publish();
  f.clarify();
  f.collect('unknown');
  f.publish();
  expect(f.s.state).toBe('settling');
  expect(f.s.context.pauseReason).toBe('CLARIFICATION_LIMIT');
  expect(f.s.context.callsReserved).toBe(6);
});
it('each clarification wave has a distinct question/publication effect assignment', () => {
  const f = new Flow();
  f.pass();
  for (let n = 1; n <= 2; n++) {
    f.clarify([rawQuestion({ id: `q${n}` })]);
    f.collect('answered');
    f.publish();
  }
  const effects = f.results
    .flatMap((r) => r.intents)
    .filter((i) => i.kind === 'question-batch-request' || i.kind === 'publish-context');
  expect(new Set(effects.map((i) => i.key)).size).toBe(effects.length);
  expect(effects.some((i) => i.key.includes('/c1/'))).toBe(true);
  expect(effects.some((i) => i.key.includes('/c2/'))).toBe(true);
});
for (const partial of [false, true])
  it(`rejects ContextUpdate during clarification without changing the wave after partial dispatch=${partial}`, () => {
    const f = new Flow();
    f.pass();
    if (partial)
      f.finish(
        'clarify',
        () => ({ kind: 'clarification', ready: true, questions: [], methodIds: [] }),
        ['openai'],
        false,
      );
    const before = structuredClone(f.s);
    expect(() =>
      f.send('CONTEXT_UPDATE', {
        update: {
          requestId: 'resubmit-later',
          runId: 'run1',
          baseContextHash: f.s.context.sharedContext.contextHash,
          userDirections: [{ kind: 'input', sha256: H, path: '/tmp/direction', bytes: 1 }],
        },
      }),
    ).toThrow('CONTEXT_UPDATE_DURING_CLARIFICATION');
    expect(f.s).toEqual(before);
    f.finish(
      'clarify',
      () => ({ kind: 'clarification', ready: true, questions: [], methodIds: [] }),
      partial ? ['gemini', 'claude'] : ['openai', 'gemini', 'claude'],
    );
    f.collect();
    f.publish();
    expect(f.s.state).toBe('prepare_round');
    expect(f.s.context.clarificationBatchesUsed).toBe(1);
    expect(f.s.context.callsReserved).toBe(3);
    expect(f.s.context.roundsUsed).toBe(0);
    expect(f.s.context.pendingContextUpdate).toBeNull();
  });
