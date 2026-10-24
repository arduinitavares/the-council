import { describe, expect, it } from 'vitest';
import { evaluateConsensus } from '../../src/domain/consensus.js';
import { bindWorkerPayload, parseWorkerPayload } from '../../src/domain/schemas.js';
import { makeConfirmation, makeBallot, makeQuestion, makeLedger, makeObjection, OTHER } from '../fixtures/builders.js';

describe('unanimous acceptance', () => {
  it('accepts current ballots through the actual parse and receipt-binding pipeline', () => {
    const context = makeConfirmation();
    const ballots = (['openai', 'gemini', 'claude'] as const).map(seat => {
      const raw = { kind: 'ballot', bindings: context.expected, decision: 'accept', conditional: false, newObjections: [], missingInputQuestions: [], dispositions: [], challengeResponses: [{ challengeId: 'challenge1', response: 'Addressed', evidenceIds: [] }], reason: 'Accept the frozen candidate', methodIds: ['test-method'] };
      const bound = bindWorkerPayload(parseWorkerPayload(JSON.stringify(raw)), context.expectedAttempts[seat]);
      if (bound.kind !== 'ballot') throw Error('wrong kind');
      return bound;
    });
    expect(evaluateConsensus({ ...context, ballots })).toEqual({ kind: 'unanimous' });
    const unexpectedBallot = { ...ballots[0]!, unexpected: true };
    expect(evaluateConsensus({ ...context, ballots: [unexpectedBallot, ...ballots.slice(1)] })).toEqual({ kind: 'unresolved', reasons: ['INVALID_CONFIRMATION_CONTEXT'] });
  });
  it('accepts precisely three current unconditional acceptances', () => {
    expect(evaluateConsensus(makeConfirmation())).toEqual({ kind: 'unanimous' });
  });
  it('rejects a majority', () => {
    expect(evaluateConsensus(makeConfirmation({ ballots: [makeBallot('openai'), makeBallot('gemini'), makeBallot('claude', { decision: 'reject' })] })).kind).toBe('unresolved');
  });
  it.each(['duplicate', 'missing', 'conditional', 'stale-attempt', 'missing-challenge', 'open-objection'])('rejects %s', reason => {
    const c = makeConfirmation(); const a = makeBallot('openai');
    const changed = reason === 'duplicate' ? { ...c, ballots: [a, a, makeBallot('gemini')] }
      : reason === 'missing' ? { ...c, ballots: [a] }
      : reason === 'conditional' ? { ...c, ballots: [makeBallot('openai', { conditional: true }), ...c.ballots.slice(1)] }
      : reason === 'stale-attempt' ? { ...c, ballots: [{ ...a, binding: { ...a.binding, attemptId: 'old-attempt' } }, ...c.ballots.slice(1)] }
      : reason === 'missing-challenge' ? { ...c, ballots: [makeBallot('openai', { challengeResponses: [] }), ...c.ballots.slice(1)] }
      : { ...c, objections: [makeObjection()] };
    expect(evaluateConsensus(changed).kind).toBe('unresolved');
  });
  it.each(['candidateHash', 'evidenceHash', 'judgeHash', 'configHash', 'profileHash', 'contextHash'] as const)('rejects changed %s', key => {
    const c = makeConfirmation(); const a = makeBallot('openai');
    expect(evaluateConsensus({ ...c, ballots: [{ ...a, bindings: { ...a.bindings, [key]: OTHER } }, ...c.ballots.slice(1)] }).kind).toBe('unresolved');
  });
  it('rejects earlier blocking ledger questions omitted from accepting ballots', () => {
    expect(evaluateConsensus(makeConfirmation({ questionLedger: makeLedger({ questions: [makeQuestion()] }) })).kind).toBe('unresolved');
    expect(evaluateConsensus(makeConfirmation({ questionLedger: makeLedger({ contextHash: OTHER }) })).kind).toBe('unresolved');
  });
  it('rejects configured mapping drift', () => {
    const c = makeConfirmation(); const a = makeBallot('openai');
    expect(evaluateConsensus({ ...c, ballots: [{ ...a, binding: { ...a.binding, requested: { ...a.binding.requested, model: 'different' } } }, ...c.ballots.slice(1)] }).kind).toBe('unresolved');
  });
  it('requires separate real attempts for all three seats', () => {
    const c = makeConfirmation(); const gemini = makeBallot('gemini');
    const binding = { ...gemini.binding, attemptId: 'attempt-openai', originAttemptId: 'attempt-openai' };
    expect(evaluateConsensus({ ...c, expectedAttempts: { ...c.expectedAttempts, gemini: binding }, ballots: [makeBallot('openai'), { ...gemini, binding }, makeBallot('claude')] }).kind).toBe('unresolved');
  });
  it('rejects other-seat closure even when every ballot accepts', () => {
    const o = makeObjection(); const c = makeConfirmation();
    const b = makeBallot('gemini', { binding: { ...makeBallot('gemini').binding, inputObjectionIds: [o.id] }, dispositions: [{ objectionId: o.id, status: 'closed', reason: 'I close it', evidenceIds: [] }] });
    expect(evaluateConsensus({ ...c, objections: [o], inputObjectionIds: [o.id], expectedAttempts: { ...c.expectedAttempts, gemini: b.binding }, ballots: [makeBallot('openai'), b, makeBallot('claude')] }).kind).toBe('unresolved');
  });
  it('accepts after a valid owner disposition resolves the last objection', () => {
    const o = makeObjection(); const c = makeConfirmation();
    const a = makeBallot('openai', { binding: { ...makeBallot('openai').binding, inputObjectionIds: [o.id] }, dispositions: [{ objectionId: o.id, status: 'closed', reason: 'Resolved by the frozen candidate', evidenceIds: [] }] });
    expect(evaluateConsensus({ ...c, objections: [o], inputObjectionIds: [o.id], expectedAttempts: { ...c.expectedAttempts, openai: a.binding }, ballots: [a, makeBallot('gemini'), makeBallot('claude')] })).toEqual({ kind: 'unanimous' });
  });
  it.each(['open', 'declared-closed', 'same-ballot-close'])('blocks new objections even with acceptance: %s', mode => {
    const o = makeObjection({ id: 'run1/ballot/r1/openai/objection/new', status: mode === 'declared-closed' ? 'closed' : 'open' });
    const a = makeBallot('openai', { newObjections: [o], dispositions: mode === 'same-ballot-close' ? [{ objectionId: o.id, status: 'closed', reason: 'Fixed', evidenceIds: [] }] : [] });
    expect(evaluateConsensus(makeConfirmation({ ballots: [a, makeBallot('gemini'), makeBallot('claude')] })).kind).toBe('unresolved');
  });
});
