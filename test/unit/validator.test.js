import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProof,
  isValidProofKind,
  sanitizeProofInput,
  formatProofRecord
} from '../../src/proofs/validator.js';
import { VALID_PROOF_KINDS } from '../../src/types.js';

describe('Unit: Structural Proof Validator (src/proofs/validator.js)', () => {
  it('validates structured proofs for all 4 supported proof kinds', () => {
    for (const kind of VALID_PROOF_KINDS) {
      const proof = {
        scope: 'Linux Kernel v6.8',
        kind,
        source: 'phoronix.com/benchmarks/kernel-6-8',
        statement: 'Context switch latency decreased by 4.2% on AVX-512 systems.'
      };
      const result = validateProof(proof);
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
    }
  });

  it('rejects null, undefined, or non-object inputs', () => {
    assert.deepEqual(validateProof(null), {
      valid: false,
      errors: ['Structural Proof Guard: proof input must be an object.']
    });
    assert.deepEqual(validateProof(undefined), {
      valid: false,
      errors: ['Structural Proof Guard: proof input must be an object.']
    });
    assert.deepEqual(validateProof('bare string proof'), {
      valid: false,
      errors: ['Structural Proof Guard: proof input must be an object.']
    });
  });

  it('rejects proof with missing, non-string, or whitespace-only scope', () => {
    const missingScope = {
      kind: 'check',
      source: 'src',
      statement: 'stmt'
    };
    const resMissing = validateProof(missingScope);
    assert.equal(resMissing.valid, false);
    assert.ok(resMissing.errors.includes('Structural Proof Guard: "scope" condition is required.'));

    const emptyScope = {
      scope: '   \t  \n ',
      kind: 'check',
      source: 'src',
      statement: 'stmt'
    };
    const resEmpty = validateProof(emptyScope);
    assert.equal(resEmpty.valid, false);
    assert.ok(resEmpty.errors.includes('Structural Proof Guard: "scope" condition is required.'));
  });

  it('rejects proof with invalid or unrecognized proof kind', () => {
    const invalidKinds = ['opinion', 'guess', 'vibe', '', null, 123];
    for (const badKind of invalidKinds) {
      const res = validateProof({
        scope: 'Production Scope',
        kind: badKind,
        source: 'audit.log',
        statement: 'assertion'
      });
      assert.equal(res.valid, false);
      assert.ok(
        res.errors.includes(
          'Structural Proof Guard: "kind" must be check, citation, benchmark, or derivation.'
        )
      );
    }
  });

  it('rejects bare opinions (missing, empty, or whitespace-only source)', () => {
    const bareOpinion = {
      scope: 'Database Sharding',
      kind: 'derivation',
      source: '',
      statement: 'Postgres handles 100k writes/sec easily.'
    };
    const res = validateProof(bareOpinion);
    assert.equal(res.valid, false);
    assert.ok(
      res.errors.includes(
        'Structural Proof Guard: verifiable "source" is required; bare opinions are forbidden.'
      )
    );

    const whitespaceOpinion = {
      scope: 'Database Sharding',
      kind: 'derivation',
      source: '   ',
      statement: 'Postgres handles 100k writes/sec easily.'
    };
    const resWs = validateProof(whitespaceOpinion);
    assert.equal(resWs.valid, false);
    assert.ok(
      resWs.errors.includes(
        'Structural Proof Guard: verifiable "source" is required; bare opinions are forbidden.'
      )
    );
  });

  it('rejects missing, empty, or whitespace-only statement', () => {
    const missingStmt = {
      scope: 'Security',
      kind: 'check',
      source: 'CVE-2026-1024'
    };
    const res = validateProof(missingStmt);
    assert.equal(res.valid, false);
    assert.ok(
      res.errors.includes('Structural Proof Guard: falsifiable "statement" is required.')
    );

    const emptyStmt = {
      scope: 'Security',
      kind: 'check',
      source: 'CVE-2026-1024',
      statement: ' \n\t '
    };
    const resEmpty = validateProof(emptyStmt);
    assert.equal(resEmpty.valid, false);
    assert.ok(
      resEmpty.errors.includes('Structural Proof Guard: falsifiable "statement" is required.')
    );
  });

  it('accumulates multiple validation errors for completely invalid input', () => {
    const completelyInvalid = {
      scope: '',
      kind: 'invalid_kind',
      source: '',
      statement: ''
    };
    const res = validateProof(completelyInvalid);
    assert.equal(res.valid, false);
    assert.equal(res.errors.length, 4);
    assert.equal(res.errors[0], 'Structural Proof Guard: "scope" condition is required.');
    assert.equal(
      res.errors[1],
      'Structural Proof Guard: "kind" must be check, citation, benchmark, or derivation.'
    );
    assert.equal(
      res.errors[2],
      'Structural Proof Guard: verifiable "source" is required; bare opinions are forbidden.'
    );
    assert.equal(res.errors[3], 'Structural Proof Guard: falsifiable "statement" is required.');
  });

  it('isValidProofKind correctly checks valid and invalid kinds', () => {
    assert.equal(isValidProofKind('check'), true);
    assert.equal(isValidProofKind('citation'), true);
    assert.equal(isValidProofKind('benchmark'), true);
    assert.equal(isValidProofKind('derivation'), true);
    assert.equal(isValidProofKind('guess'), false);
    assert.equal(isValidProofKind(null), false);
    assert.equal(isValidProofKind(undefined), false);
  });

  it('sanitizeProofInput trims whitespace across all string fields', () => {
    const raw = {
      scope: '  Scope  ',
      kind: 'check',
      source: '  Audit Log  ',
      statement: '  Falsifiable Statement  '
    };
    const sanitized = sanitizeProofInput(raw);
    assert.equal(sanitized.scope, 'Scope');
    assert.equal(sanitized.source, 'Audit Log');
    assert.equal(sanitized.statement, 'Falsifiable Statement');
  });

  it('formatProofRecord generates a standard Proof structure with defaults', () => {
    const input = {
      scope: 'Telemetry',
      kind: 'check',
      source: 'OTel RFC',
      statement: 'Latency is p99 < 5ms'
    };
    const record = formatProofRecord(input, { round: 1, seatId: 'seat-test', idIndex: 7 });
    assert.equal(record.id, 'P7');
    assert.equal(record.round, 1);
    assert.equal(record.seatId, 'seat-test');
    assert.equal(record.status, 'pending');
    assert.equal(record.judgeNote, null);
  });
});
