import { describe, expect, it } from 'vitest';
import { applyOwnedDispositions, registerObjections } from '../../src/domain/objections.js';
import { makeConfirmation, makeBallot, makeObjection, makeBinding, OTHER } from '../fixtures/builders.js';

describe('objection ownership', () => {
  it('applies only owner closure of a frozen input and appends history', () => {
    const o = makeObjection(); const d = { objectionId: o.id, status: 'closed' as const, reason: 'Resolved by frozen candidate', evidenceIds: [] };
    const a = makeBallot('openai', { binding: makeBinding('openai', { inputObjectionIds: [o.id] }), dispositions: [d] });
    const c = makeConfirmation({ objections: [o], inputObjectionIds: [o.id], ballots: [a, makeBallot('gemini'), makeBallot('claude')], expectedAttempts: { openai: a.binding, gemini: makeBinding('gemini'), claude: makeBinding('claude') } });
    expect(applyOwnedDispositions(c)[0]).toMatchObject({ status: 'closed', history: [{ ...d, seat: 'openai', attemptId: 'attempt-openai' }] });
    expect(o.status).toBe('open'); expect(o.history).toEqual([]);
  });
  it('rejects another seat closing an objection and missing frozen IDs', () => {
    const o = makeObjection(); const d = { objectionId: o.id, status: 'closed' as const, reason: 'Resolved', evidenceIds: [] };
    expect(() => applyOwnedDispositions(makeConfirmation({ objections: [o], inputObjectionIds: [o.id], ballots: [makeBallot('gemini', { dispositions: [d] })] }))).toThrow();
    expect(() => applyOwnedDispositions(makeConfirmation({ objections: [o], ballots: [makeBallot('openai', { dispositions: [d] })] }))).toThrow();
  });
  it('registers open owned objections idempotently but rejects conflicting reuse and pre-closure', () => {
    const o = makeObjection();
    expect(registerObjections([o], [o], 'openai')).toEqual([o]);
    expect(() => registerObjections([o], [{ ...o, claim: 'Different' }], 'openai')).toThrow();
    expect(() => registerObjections([], [o], 'gemini')).toThrow();
    expect(() => registerObjections([], [{ ...o, status: 'closed' }], 'openai')).toThrow();
    expect(() => registerObjections([], [{ ...o, id: 'run1/review/r1/gemini/objection/o1' }], 'openai')).toThrow();
  });
  it('rejects a ledger closure without an owned disposition history', () => {
    expect(() => applyOwnedDispositions(makeConfirmation({ objections: [makeObjection({ status: 'closed' })] }))).toThrow(/history/i);
    const o = makeObjection({ status: 'closed', history: [{ objectionId: 'run1/review/r1/openai/objection/o1', status: 'closed', reason: 'Closed', evidenceIds: [], seat: 'gemini', attemptId: 'attempt-gemini' }] });
    expect(() => applyOwnedDispositions(makeConfirmation({ objections: [o] }))).toThrow(/owner/i);
  });
  it('keeps duplicate delivery of an already applied owner disposition idempotent', () => {
    const o = makeObjection(); const d = { objectionId: o.id, status: 'closed' as const, reason: 'Resolved', evidenceIds: [] };
    const binding = makeBinding('openai', { inputObjectionIds: [o.id] });
    const c = makeConfirmation({ objections: [o], inputObjectionIds: [o.id], ballots: [makeBallot('openai', { binding, dispositions: [d] })], expectedAttempts: { openai: binding, gemini: makeBinding('gemini'), claude: makeBinding('claude') } });
    const first = applyOwnedDispositions(c);
    expect(applyOwnedDispositions({ ...c, objections: first })).toEqual(first);
  });
  it('rejects stale target bindings at the ledger barrier before consensus evaluation', () => {
    const o = makeObjection(); const binding = makeBinding('openai', { inputObjectionIds: [o.id] });
    const c = makeConfirmation();
    const a = makeBallot('openai', { binding, bindings: { ...c.expected, contextHash: OTHER }, dispositions: [{ objectionId: o.id, status: 'closed', reason: 'Resolved', evidenceIds: [] }] });
    expect(() => applyOwnedDispositions({ ...c, objections: [o], inputObjectionIds: [o.id], expectedAttempts: { ...c.expectedAttempts, openai: binding }, ballots: [a] })).toThrow(/target|context/i);
  });
  it('rejects duplicate ballot seats before applying dispositions', () => {
    const a = makeBallot('openai');
    expect(() => applyOwnedDispositions(makeConfirmation({ ballots: [a, a] }))).toThrow(/duplicate/i);
  });
  it('rejects conflicting existing objection IDs even at an empty barrier', () => {
    const o = makeObjection();
    expect(() => applyOwnedDispositions(makeConfirmation({ ballots: [], objections: [o, { ...o, claim: 'Conflicting claim' }] }))).toThrow(/duplicate|conflict/i);
  });
});
