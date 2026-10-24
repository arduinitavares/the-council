import { describe, expect, it } from 'vitest';
import { validateQuestionLedger, appendAnswerRevision, unresolvedBlockingQuestions } from '../../src/domain/questions.js';
import { makeLedger, makeQuestion, H, OTHER } from '../fixtures/builders.js';

const answer = (id: string, questionId: string, supersededAnswerId: string | null = null) => ({ id, questionId, supersededAnswerId, status: 'answered' as const, value: 'fact', source: { author: 'user', receiptId: 'human-receipt' }, evidenceIds: [] });
describe('append-only bound question ledger', () => {
  it('rejects missing dependencies, duplicate question IDs and cycles', () => {
    const a = makeQuestion(); const b = makeQuestion({ id: 'run1/clarify/c1/openai/question/q2', dependencyIds: [a.id] });
    expect(() => validateQuestionLedger(makeLedger({ questions: [{ ...a, dependencyIds: ['missing'] }] }))).toThrow();
    expect(() => validateQuestionLedger(makeLedger({ questions: [a, a] }))).toThrow();
    expect(() => validateQuestionLedger(makeLedger({ questions: [{ ...a, dependencyIds: [b.id] }, b] }))).toThrow(/cyc/i);
  });
  it('retains presented and deferred unanswered/unknown/declined blockers', () => {
    const a = makeQuestion();
    expect(unresolvedBlockingQuestions(makeLedger({ questions: [a] }))).toEqual([a]);
    expect(unresolvedBlockingQuestions(makeLedger({ questions: [a], answers: [{ ...answer('a1', a.id), status: 'unknown', value: null }] }))).toEqual([a]);
    expect(unresolvedBlockingQuestions(makeLedger({ questions: [{ ...a, disposition: 'presented' }], answers: [{ ...answer('a1', a.id), status: 'declined', value: null }] }))).toHaveLength(1);
  });
  it('requires answered values to match the declared answer form', () => {
    const q = makeQuestion({ answerForm: { kind: 'boolean' } });
    expect(() => validateQuestionLedger(makeLedger({ questions: [q], answers: [answer('a1', q.id)] }))).toThrow(/form/i);
    expect(() => validateQuestionLedger(makeLedger({ questions: [q], answers: [{ ...answer('a1', q.id), value: true }] }))).not.toThrow();
  });
  it('rejects a bound question whose namespace disagrees with adapter origin', () => {
    const q = makeQuestion();
    expect(() => validateQuestionLedger(makeLedger({ questions: [{ ...q, origin: { ...q.origin, seat: 'gemini' } }] }))).toThrow();
    expect(() => validateQuestionLedger(makeLedger({ questions: [{ ...q, id: 'unbound-local-q1' }] }))).toThrow();
  });
  it('accepts a first deferred answer with null predecessor and preserves original wording/history', () => {
    const q = makeQuestion(); const ledger = makeLedger({ questions: [q] });
    const next = appendAnswerRevision(ledger, { requestId: 'req1', runId: 'run1', baseContextHash: H, unresolvedQuestionIds: [q.id], answers: [answer('a1', q.id)] });
    expect(next.questions).toEqual([q]);
    expect(next.answers).toEqual([answer('a1', q.id)]);
    expect(ledger.answers).toEqual([]);
  });
  it('permits an omitted predecessor for an ordinary first answer but requires explicit null in revisions', () => {
    const q = makeQuestion(); const { supersededAnswerId: _predecessor, ...first } = answer('a1', q.id);
    expect(() => validateQuestionLedger(makeLedger({ questions: [q], answers: [first] }))).not.toThrow();
    expect(() => appendAnswerRevision(makeLedger({ questions: [q] }), { requestId: 'req1', runId: 'run1', baseContextHash: H, unresolvedQuestionIds: [q.id], answers: [first] } as never)).toThrow();
  });
  it('requires current predecessor and context when replacing an unresolved answer', () => {
    const q = makeQuestion(); const prior = { ...answer('a1', q.id), status: 'unknown' as const, value: null };
    const ledger = makeLedger({ questions: [q], answers: [prior] });
    const revision = { requestId: 'req1', runId: 'run1', baseContextHash: H, unresolvedQuestionIds: [q.id], answers: [answer('a2', q.id, 'a1')] };
    const next = appendAnswerRevision(ledger, revision);
    expect(next.answers).toEqual([prior, answer('a2', q.id, 'a1')]);
    expect(unresolvedBlockingQuestions(next)).toEqual([]);
    expect(() => appendAnswerRevision(ledger, { ...revision, baseContextHash: OTHER })).toThrow();
    expect(() => appendAnswerRevision(ledger, { ...revision, answers: [answer('a2', q.id)] })).toThrow();
  });
  it('requires dependencies already answered before the revision, not within it', () => {
    const q = makeQuestion(); const dependent = makeQuestion({ id: 'run1/clarify/c1/openai/question/dependent', dependencyIds: [q.id] });
    expect(() => appendAnswerRevision(makeLedger({ questions: [q, dependent] }), { requestId: 'req', runId: 'run1', baseContextHash: H, unresolvedQuestionIds: [q.id, dependent.id], answers: [answer('a1', q.id), answer('a2', dependent.id)] })).toThrow();
  });
  it('rejects answer-history forks, duplicate answer IDs and unknown question answers', () => {
    const q = makeQuestion();
    expect(() => validateQuestionLedger(makeLedger({ questions: [q], answers: [answer('a1', q.id), answer('a2', q.id)] }))).toThrow(/predecessor/i);
    expect(() => validateQuestionLedger(makeLedger({ questions: [q], answers: [answer('a1', q.id), answer('a1', q.id, 'a1')] }))).toThrow(/duplicate/i);
    expect(() => validateQuestionLedger(makeLedger({ answers: [answer('a1', q.id)] }))).toThrow(/unknown/i);
  });
});
