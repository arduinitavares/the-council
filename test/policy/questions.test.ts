import { describe, expect, it } from 'vitest';
import type { Answer, AnswerBatch, BoundQuestion, QuestionLedger, WorkerResult } from '../../src/domain/contracts.js';
import { bindWorkerPayload } from '../../src/domain/schemas.js';
import { canonicalJson } from '../../src/domain/hash.js';
import { buildQuestionBatch, validateAnswerBatch, validateAnswerRevision } from '../../src/input/questions.js';
import { H, OTHER, makeBinding, makeQuestion, rawQuestion } from '../fixtures/builders.js';
import { Flow, request } from '../machine/helpers.js';

const origin = { kind: 'clarification' as const, batchIndex: 1 };
const empty: QuestionLedger = { contextHash: H, questions: [], answers: [] };
function result(seat: 'openai' | 'gemini' | 'claude', questions: readonly ReturnType<typeof rawQuestion>[] = [], batch = 1, contextHash = H, inputQuestionIds: readonly string[] = []): WorkerResult {
  const binding = makeBinding(seat, { phase: 'clarify', round: 0, clarificationBatch: batch, logicalTaskKey: `clarify-${seat}`, contextHash, inputQuestionIds });
  return { status: 'valid', binding, payload: bindWorkerPayload({ kind: 'clarification', ready: !questions.length, questions, methodIds: [] }, binding) };
}
const wave = (questions: readonly ReturnType<typeof rawQuestion>[] = [], batch = 1, contextHash = H, ids: readonly string[] = []) => [result('claude', [], batch, contextHash, ids), result('openai', questions, batch, contextHash, ids), result('gemini', [], batch, contextHash, ids)];
function answer(questionId: string, id = 'a1', status: Answer['status'] = 'answered'): Answer { return { id, questionId, status, value: status === 'answered' ? 'Fact' : null, source: { author: 'user', receiptId: 'receipt' }, evidenceIds: [] }; }
function reply(batch: ReturnType<typeof buildQuestionBatch>, answers: readonly Answer[], finalized = true): AnswerBatch { return { requestId: 'request', batchId: batch.id, origin: batch.origin, baseContextHash: batch.baseContextHash, answers, finalized }; }

describe('common question compilation and publication decisions', () => {
  it('preserves IDs, wording, blocking flags and explicit answers despite grouping', () => {
    const batch = buildQuestionBatch(empty, origin, wave([rawQuestion(), rawQuestion({ id: 'q2', blocking: false })]), { id: 'batch1', groups: [{ id: 'group', questionIds: ['run1/clarify/c1/openai/question/q1', 'run1/clarify/c1/openai/question/q2'] }] }, []);
    expect(batch.questions.map(q => q.text)).toEqual(['  Exact original question?\n', '  Exact original question?\n']);
    expect(batch.questions[0]!.blocking).toBe(true);
    expect(validateAnswerBatch(batch, reply(batch, [answer(batch.questions[0]!.id)], false)).kind).toBe('draft');
    expect(validateAnswerBatch(batch, reply(batch, [answer(batch.questions[0]!.id)])).kind).toBe('invalid');
    expect(validateAnswerBatch(batch, reply(batch, batch.questions.map((q, i) => answer(q.id, `a${i}`)))).kind).toBe('ready-for-publication');
    expect(() => buildQuestionBatch(empty, origin, wave([rawQuestion()]), { id: 'bad', groups: [{ id: 'x', questionIds: ['run1/clarify/c1/openai/question/q1'] }, { id: 'y', questionIds: ['run1/clarify/c1/openai/question/q1'] }] }, [])).toThrow('GROUPING_INVALID');
  });
  it('rejects dependency cycles, missing edges, forged origins and partial waves', () => {
    for (const questions of [[rawQuestion({ dependencies: [{ kind: 'local', id: 'missing' }] })], [rawQuestion({ dependencies: [{ kind: 'local', id: 'q2' }] }), rawQuestion({ id: 'q2', dependencies: [{ kind: 'local', id: 'q1' }] })]]) {
      expect(() => buildQuestionBatch(empty, origin, wave(questions), { id: 'bad', groups: [] }, [])).toThrow();
    }
    const forged = wave([rawQuestion()]); const payload = forged[1]!; if (payload.status === 'valid' && payload.payload.kind === 'clarification') (payload.payload.questions[0] as BoundQuestion).origin.attemptId = 'forged';
    expect(() => buildQuestionBatch(empty, origin, forged, { id: 'bad', groups: [] }, [])).toThrow('QUESTION_ORIGIN_INVALID');
    expect(() => buildQuestionBatch(empty, origin, wave().slice(1), { id: 'bad', groups: [] }, [])).toThrow('QUESTION_WAVE_INCOMPLETE');
    const wrongPhase = wave(), wrong = wrongPhase[0]!;
    if (wrong.status === 'valid') wrong.payload = { kind: 'review', binding: wrong.binding, proposals: [], newObjections: [], evidenceRequests: [], missingInputQuestions: [], methodIds: [] };
    expect(() => buildQuestionBatch(empty, origin, wrongPhase, { id: 'wrong-phase', groups: [] }, [])).toThrow('QUESTION_ORIGIN_INVALID');
  });
  it('defers same-wave dependencies and promotes them from the prior ledger on an all-ready wave', () => {
    const first = buildQuestionBatch(empty, origin, wave([rawQuestion(), rawQuestion({ id: 'q2', dependencies: [{ kind: 'local', id: 'q1' }] })]), { id: 'b1', groups: [] }, []);
    expect(first.presentedQuestionIds).toHaveLength(1); expect(first.questions[1]!.disposition).toBe('deferred');
    const prior = { contextHash: OTHER, questions: first.questions, answers: [answer(first.questions[0]!.id)] };
    const second = buildQuestionBatch(prior, { kind: 'clarification', batchIndex: 2 }, wave([], 2, OTHER, prior.questions.map(q => q.id)), { id: 'b2', groups: [] }, []);
    expect(second.presentedQuestionIds).toEqual([first.questions[1]!.id]);
    expect(second.questions.map(q => q.id)).toEqual([first.questions[1]!.id]);
    expect(validateAnswerBatch(second, reply(second, [answer(first.questions[1]!.id, 'a2', 'unknown')]), prior)).toMatchObject({ kind: 'unresolved-blocking', reason: 'CLARIFICATION_LIMIT', questionIds: [first.questions[1]!.id] });
    expect(validateAnswerBatch(second, reply(second, []))).toMatchObject({ kind: 'invalid', reason: 'QUESTION_LEDGER_REQUIRED' });
    expect(validateAnswerBatch(second, reply(second, []), { ...prior, contextHash: H })).toMatchObject({ kind: 'invalid', reason: 'STALE_CONTEXT' });
  });
  it('retains earlier unknown blockers omitted by current ballots and rejects stale old batches', () => {
    const question = makeQuestion({ disposition: 'presented' }), prior = { ...empty, questions: [question], answers: [answer(question.id, 'old', 'unknown')] };
    const second = buildQuestionBatch(prior, { kind: 'clarification', batchIndex: 2 }, wave([], 2, H, [question.id]), { id: 'b2', groups: [] }, []);
    expect(second.questions).toEqual([]);
    expect(validateAnswerBatch(second, reply(second, []), prior)).toMatchObject({ kind: 'unresolved-blocking', questionIds: [question.id] });
    expect(validateAnswerBatch(second, { ...reply(second, []), baseContextHash: OTHER })).toMatchObject({ kind: 'invalid', reason: 'STALE_CONTEXT' });
    const revision = { requestId: 'correct', runId: 'run1', baseContextHash: H, unresolvedQuestionIds: [question.id], answers: [{ ...answer(question.id, 'new'), supersededAnswerId: 'old' }] };
    expect(validateAnswerRevision(request().sharedContext, prior, revision).kind).toBe('ready-for-publication');
    expect(validateAnswerRevision(request().sharedContext, prior, { ...revision, baseContextHash: OTHER }).kind).toBe('invalid');
  });
  it('requires prior-published dependencies for a deferred first revision answer', () => {
    const q1 = makeQuestion({ disposition: 'presented' }), q2 = makeQuestion({ id: 'run1/clarify/c1/openai/question/q2', dependencyIds: [q1.id] });
    const prior = { ...empty, questions: [q1, q2], answers: [answer(q1.id)] };
    const revision = { requestId: 'deferred', runId: 'run1', baseContextHash: H, unresolvedQuestionIds: [q2.id], answers: [{ ...answer(q2.id, 'a2'), supersededAnswerId: null }] };
    expect(validateAnswerRevision(request().sharedContext, prior, revision).kind).toBe('ready-for-publication');
    expect(validateAnswerRevision(request().sharedContext, { ...prior, answers: [] }, revision).kind).toBe('invalid');
    const unknown = answer(q1.id, 'unknown', 'unknown');
    expect(validateAnswerRevision(request().sharedContext, { ...prior, answers: [unknown] }, { ...revision, unresolvedQuestionIds: [q1.id, q2.id], answers: [{ ...answer(q1.id, 'corrected'), supersededAnswerId: unknown.id }, ...revision.answers] })).toMatchObject({ kind: 'invalid', questionIds: [q1.id, q2.id] });
  });
  it('requires each actual adapter binding to contain the complete prior ledger IDs', () => {
    const question = makeQuestion(), prior = { ...empty, questions: [question] };
    expect(() => buildQuestionBatch(prior, { kind: 'clarification', batchIndex: 2 }, wave([], 2), { id: 'missing-ledger-binding', groups: [] }, [])).toThrow('QUESTION_ORIGIN_INVALID');
    const extra = wave(); Object.assign(extra[0]!, { authoritative: true });
    expect(() => buildQuestionBatch(empty, origin, extra, { id: 'extra-fields', groups: [] }, [])).toThrow();
  });
  it('rejects conflicting request IDs and preserves exact source answers', () => {
    const results = wave([rawQuestion()]), id = 'run1/clarify/c1/openai/question/q1';
    const source = answer(id), batch = buildQuestionBatch(empty, origin, results, { id: 'sources', groups: [] }, [source]);
    const valid = reply(batch, [source]);
    expect(validateAnswerBatch(batch, valid, empty).kind).toBe('ready-for-publication');
    expect(validateAnswerBatch(batch, reply(batch, [{ ...source, value: 'Changed' }]), empty).reason).toBe('SOURCE_ANSWER_MISSING');
    expect(validateAnswerBatch(batch, valid, empty, { ...valid, finalized: false }).reason).toBe('REQUEST_ID_CONFLICT');
    expect(validateAnswerBatch(batch, valid, empty, valid).kind).toBe('ready-for-publication');
  });
  it('returns exact IDs for invalid forms and rejects altered presentation', () => {
    const batch = buildQuestionBatch(empty, origin, wave([rawQuestion()]), { id: 'forms', groups: [] }, []), id = batch.questions[0]!.id;
    expect(validateAnswerBatch(batch, reply(batch, [{ ...answer(id), value: false }]), empty)).toMatchObject({ kind: 'invalid', questionIds: [id] });
    expect(validateAnswerBatch({ ...batch, presentedQuestionIds: [] }, reply(batch, []), empty)).toMatchObject({ kind: 'invalid', reason: 'QUESTION_PRESENTATION_INVALID', questionIds: [id] });
    expect(validateAnswerBatch(batch, reply(batch, [answer(id, 'declined', 'declined')]), empty)).toMatchObject({ kind: 'unresolved-blocking', questionIds: [id] });
    expect(validateAnswerBatch(batch, reply(batch, [], false), empty)).toMatchObject({ kind: 'draft', questionIds: [id] });
  });
  it('feeds the real reducer and binds the ordered finalized ledger to all three next attempts', () => {
    const f = new Flow(); f.pass(); f.clarify([rawQuestion(), rawQuestion({ id: 'followup', dependencies: [{ kind: 'local', id: 'q1' }] })]);
    const compile = (id: string) => {
      const results: WorkerResult[] = Object.values(f.s.context.control.phasePayloads).map(payload => ({ status: 'valid', payload, binding: payload.binding }));
      return buildQuestionBatch(f.s.context.questionLedger, { kind: 'clarification', batchIndex: f.s.context.clarificationBatchesUsed }, results, { id, groups: [] }, []);
    };
    const first = compile('flow-first'); f.send('COLLECT_QUESTIONS', { batch: first }); f.settle();
    const firstReply = reply(first, [answer(first.presentedQuestionIds[0]!)]);
    expect(validateAnswerBatch(first, firstReply, f.s.context.questionLedger).kind).toBe('unresolved-blocking');
    f.send('ANSWER_BATCH', { batch: firstReply }); f.resume(); f.publish(); f.clarify();
    const second = compile('flow-second'); expect(second.presentedQuestionIds).toEqual(['run1/clarify/c1/openai/question/followup']);
    f.send('COLLECT_QUESTIONS', { batch: second }); f.settle();
    const finalReply = { ...reply(second, [answer(second.presentedQuestionIds[0]!, 'a2')]), requestId: 'second-reply' };
    expect(validateAnswerBatch(second, finalReply, f.s.context.questionLedger).kind).toBe('ready-for-publication');
    f.send('ANSWER_BATCH', { batch: finalReply }); f.resume(); f.publish(); f.send('ADMIT_ROUND');
    const bindings = (['openai', 'gemini', 'claude'] as const).map(seat => f.launch('review', seat));
    for (const binding of bindings) {
      expect(binding.inputQuestionIds).toEqual(['run1/clarify/c1/openai/question/q1', 'run1/clarify/c1/openai/question/followup']);
      expect(binding.contextHash).toBe(f.s.context.sharedContext.contextHash);
    }
    expect(f.s.context.questionLedger.answers.map(a => a.id)).toEqual(['a1', 'a2']);
  });
});
