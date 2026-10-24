import { expect, it } from 'vitest';
import { freezeEvidenceBundle } from '../../src/evidence/adapter.js';
import { H, OTHER, makeBallot } from '../fixtures/builders.js';

it('creates a new bundle on source drift and invalidates dependent ballots without rewriting the old bundle', () => {
  const record = { requestId: 'e1', status: 'verified' as const, sourceLocation: '/source', contentHash: H, observationReceipt: 'receipt1' };
  const original = freezeEvidenceBundle([record], []), saved = JSON.stringify(original);
  const oldBallot = makeBallot('openai', { bindings: { ...makeBallot('openai').bindings, evidenceHash: original.hash } });
  const changed = freezeEvidenceBundle([{ ...record, contentHash: OTHER, observationReceipt: 'receipt2' }], [oldBallot]);
  expect(changed.hash).not.toBe(original.hash);
  expect(changed.invalidatedBallotAttemptIds).toEqual(['attempt-openai']);
  expect(JSON.stringify(original)).toBe(saved);
  expect(oldBallot.bindings.evidenceHash).toBe(original.hash);
  expect(Object.isFrozen(original.records[0])).toBe(true);
});

it('rejects duplicate evidence IDs instead of overwriting observations', () => {
  const record = { requestId: 'e1', status: 'unverified' as const, sourceLocation: '/source', contentHash: H, observationReceipt: 'receipt1' };
  expect(() => freezeEvidenceBundle([record, record], [])).toThrow('DUPLICATE_EVIDENCE_ID');
});
