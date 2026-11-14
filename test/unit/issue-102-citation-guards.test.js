import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  validateProof,
  normalizeTrustedInvocationCitations,
  validateCitationFields
} from '../../src/proofs/validator.js';
import {
  formatDeliberationPrompt,
  formatVotingPrompt,
  formatJudgePrompt,
  STANDARD_SOULS
} from '../../src/seats/soul.js';

describe('Issue #102 Task 2: Portable citation normalization, forbidden path/artifact guards & read caps', () => {
  it('strips ONLY valid relative subpaths under trustedEphemeralRoots while leaving .. traversal, .council, and untrusted temp/host paths for rejection', () => {
    const trustedRoot = path.join(os.tmpdir(), 'council-safe-cwd-seat1');
    const otherSeatRoot = path.join(os.tmpdir(), 'council-safe-cwd-other');
    const rawProof = {
      scope: 'Harness',
      kind: 'citation',
      source: `${trustedRoot}/src/harness/cli-runner.js:4200-4221`,
      statement: `Verified ${trustedRoot}/src/engine/config.js and prose... with ellipsis.`,
      nested: [{ ref: `${trustedRoot}/src/types.js:12` }]
    };
    const snapshotBefore = JSON.stringify(rawProof);
    const normalized = normalizeTrustedInvocationCitations(rawProof, {
      trustedEphemeralRoots: [trustedRoot]
    });

    // Immutable walk leaves original payload untouched
    assert.equal(JSON.stringify(rawProof), snapshotBefore);
    assert.equal(normalized.source, 'src/harness/cli-runner.js:4200-4221');
    assert.equal(normalized.statement, 'Verified src/engine/config.js and prose... with ellipsis.');
    assert.equal(normalized.nested[0].ref, 'src/types.js:12');
    assert.equal(validateProof(normalized, { forbiddenWorkspaceRoots: ['/Users/aaat/repo'] }).valid, true);

    // Bare <trustedRoot>/ without non-empty relative path MUST stay unstripped and fail validation
    const bareRoot = normalizeTrustedInvocationCitations(
      {
        scope: 'Harness',
        kind: 'citation',
        source: `${trustedRoot}/`,
        statement: 'Bare root reference'
      },
      { trustedEphemeralRoots: [trustedRoot] }
    );
    assert.equal(bareRoot.source, `${trustedRoot}/`);
    assert.equal(validateProof(bareRoot, { forbiddenWorkspaceRoots: ['/Users/aaat/repo'] }).valid, false);

    // <trustedRoot>/../outside.js MUST remain unstripped and fail validation
    const traversal = normalizeTrustedInvocationCitations(
      {
        scope: 'Harness',
        kind: 'citation',
        source: `${trustedRoot}/../outside.js:3`,
        statement: 'Attempted escape'
      },
      { trustedEphemeralRoots: [trustedRoot] }
    );
    assert.ok(traversal.source.includes('..'));
    assert.ok(traversal.source.includes(trustedRoot));
    assert.equal(validateProof(traversal, { forbiddenWorkspaceRoots: ['/Users/aaat/repo'] }).valid, false);

    // <trustedRoot>/.council/state.json MUST remain unstripped and fail validation
    const councilTarget = normalizeTrustedInvocationCitations(
      {
        scope: 'Harness',
        kind: 'citation',
        source: `${trustedRoot}/.council/state.json:1`,
        statement: 'Attempted state leak'
      },
      { trustedEphemeralRoots: [trustedRoot] }
    );
    assert.ok(councilTarget.source.includes('.council'));
    assert.ok(councilTarget.source.includes(trustedRoot));
    assert.equal(validateProof(councilTarget, { forbiddenWorkspaceRoots: ['/Users/aaat/repo'] }).valid, false);

    // Foreign temp root MUST fail validation
    const tampered = normalizeTrustedInvocationCitations(
      {
        scope: 'Harness',
        kind: 'citation',
        source: `${otherSeatRoot}/src/harness/cli-runner.js`,
        statement: 'Should still fail'
      },
      { trustedEphemeralRoots: [trustedRoot] }
    );
    const badRes = validateProof(tampered, { forbiddenWorkspaceRoots: ['/Users/aaat/repo'] });
    assert.equal(badRes.valid, false);
    assert.match(badRes.errors.join(' '), /temporary|ephemeral/i);
  });

  it('rejects parent traversal (..), .council/telemetry artifacts, and forbiddenWorkspaceRoots while allowing prose ellipses (...)', () => {
    const allowedProse = validateCitationFields(
      [{ label: 'summary', text: 'First condition... then second condition. Also ranges 1..5 are fine.' }],
      { forbiddenWorkspaceRoots: ['/Users/aaat/private-repo'] }
    );
    assert.equal(allowedProse.valid, true);

    const badInputs = [
      [{ label: 'source', text: '../secret/file.js:10' }],
      [{ label: 'source', text: 'src/../../outside.js:3' }],
      [{ label: 'source', text: '..\\outside.js' }],
      [{ label: 'statement', text: 'Inspect .. for root' }],
      [{ label: 'source', text: '.council/runs/latest.js' }],
      [{ label: 'source', text: 'latest.js' }],
      [{ label: 'source', text: 'run-123.meta.json' }],
      [{ label: 'source', text: '*.meta.json' }],
      [{ label: 'source', text: 'run-123.events.jsonl' }],
      [{ label: 'source', text: '*.events.jsonl' }],
      [{ label: 'statement', text: 'Inspect telemetry-summary.json for answer' }],
      [{ label: 'statement', text: 'Inspect telemetry-summary.* for answer' }],
      [{ label: 'reason', text: 'Checked /Users/aaat/private-repo/src/index.js:12' }],
      [{ label: 'note', text: 'Found at /tmp/council-seat-cwd-xyz/src/index.js:5' }],
      [{ label: 'note', text: 'Found at /tmp/council-safe-cwd-xyz/src/index.js:5' }]
    ];
    for (const fields of badInputs) {
      const res = validateCitationFields(fields, {
        forbiddenWorkspaceRoots: ['/Users/aaat/private-repo']
      });
      assert.equal(res.valid, false, `Expected rejection for ${JSON.stringify(fields)}`);
    }

    // Sibling path prefix with extra suffix should NOT false-positive as forbiddenWorkspaceRoot
    const siblingRoot = validateCitationFields(
      [{ label: 'source', text: '/Users/aaat/private-repo-v2/src/index.js:12' }],
      { forbiddenWorkspaceRoots: ['/Users/aaat/private-repo'] }
    );
    assert.equal(siblingRoot.valid, true);

    // validateProof integrates citation checks on scope, source, and statement
    const badProof = validateProof(
      {
        scope: 'Scope',
        kind: 'citation',
        source: '/Users/aaat/private-repo/src/index.js:12',
        statement: 'Valid statement'
      },
      { forbiddenWorkspaceRoots: ['/Users/aaat/private-repo'] }
    );
    assert.equal(badProof.valid, false);
  });

  it('emits phase-specific read caps (5-8 R1, 3-5 R2+/Vote/Judge incl. Round 2+ objections, 0 uncited) without regressing #96', () => {
    const soul = STANDARD_SOULS.ADVERSARIAL_CHALLENGER;
    const pR1 = formatDeliberationPrompt({
      soul,
      seat: { id: 's1', cwd: '/Users/secret/repo' },
      topic: 'Inspect src/index.js',
      round: 1,
      maxRounds: 3,
      tools: 'read-only'
    });
    assert.match(pR1, /5.?8/);
    assert.match(pR1, /repository-relative/i);

    const pR2 = formatDeliberationPrompt({
      soul,
      seat: { id: 's1', cwd: '/Users/secret/repo' },
      topic: 'Rebuttal',
      round: 2,
      maxRounds: 3,
      rebuttalMode: true,
      previousCandidate: { round: 1, summary: 'Prev', clauses: [] },
      openObjections: [{ id: 'O1', seatId: 's2', proofId: 'P1', reason: 'Mismatch' }],
      tools: 'read-only'
    });
    assert.match(pR2, /3.?5/);
    assert.match(pR2, /Unresolved Objections/i);

    const pVote = formatVotingPrompt({
      soul,
      seat: { id: 's1', cwd: '/Users/secret/repo', votingTools: 'read-only' },
      candidate: { round: 1, summary: 'Cand', clauses: [] },
      admittedProofs: [],
      tools: 'read-only'
    });
    assert.match(pVote, /3.?5/);

    const pVoteNone = formatVotingPrompt({
      soul,
      seat: { id: 's1', cwd: '/Users/secret/repo', votingTools: 'none' },
      candidate: { round: 1, summary: 'Cand', clauses: [] },
      admittedProofs: [],
      tools: 'none'
    });
    assert.match(pVoteNone, /do not invoke any tools|no local file reads/i);

    // Judge with uncited conceptual proof MUST still get 3-5 spot-check budget when Round 2+ open objection cites a workspace file
    const pJudgeWithCitedObjection = formatJudgePrompt({
      judge: { id: 'j', cwd: '/Users/secret/repo' },
      topic: 'Topic',
      round: 2,
      previousCandidate: { round: 1, summary: 'Prev', clauses: [] },
      openObjections: [{ id: 'O1', seatId: 's2', proofId: 'P0', reason: 'Check src/engine/council-engine.js:42 mismatch' }],
      proofs: [{ id: 'P1', statement: 'Concept', source: 'internal reasoning' }],
      tools: 'read-only'
    });
    assert.match(pJudgeWithCitedObjection, /3.?5/);

    const pJudgeUncited = formatJudgePrompt({
      judge: { id: 'j', cwd: '/Users/secret/repo' },
      topic: 'Topic',
      round: 1,
      proofs: [{ id: 'P1', statement: 'Concept', source: 'internal reasoning' }],
      tools: 'read-only'
    });
    assert.match(pJudgeUncited, /0 local workspace reads|uncited/i);

    // Round 2 Judge with prior-round workspace-citing proof MUST still emit 0 local workspace reads when current proofs and open objections do not cite workspace files
    const pJudgePriorOnly = formatJudgePrompt({
      judge: { id: 'j', cwd: '/Users/secret/repo' },
      topic: 'Topic',
      round: 2,
      previousCandidate: { round: 1, summary: 'Prev', clauses: [] },
      priorAdmittedProofs: [{ id: 'P0', round: 1, statement: 'Old check', source: 'src/old.js:10', status: 'admitted' }],
      openObjections: [{ id: 'O1', seatId: 's2', proofId: 'P0', reason: 'Conceptual boundary ambiguity' }],
      proofs: [{ id: 'P1', statement: 'Concept', source: 'internal reasoning' }],
      tools: 'read-only'
    });
    assert.match(pJudgePriorOnly, /0 local workspace reads/i);
  });
});
