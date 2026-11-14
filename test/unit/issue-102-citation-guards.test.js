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
import { CouncilEngine } from '../../src/engine/council-engine.js';
import { MockAdapter } from '../../src/harness/mock.js';

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

  it('CouncilEngine rejects leaked forbidden/temp/.council citations in Deliberation, Vote, and Judge via retryable InvalidResponseError and normalizes trusted ephemeral subpaths cleanly', async () => {
    const trustedRoot = path.join(os.tmpdir(), 'council-trusted-cwd-integration');
    const forbiddenRoot = '/Users/private/secret-workspace';
    const untrustedTmp = path.join(os.tmpdir(), 'untrusted-sandbox-leak');
    const mock = new MockAdapter();
    let delibCalls = 0;
    let judgeCalls = 0;
    let voteCalls = 0;

    const origProof = mock.executeSeatProof.bind(mock);
    mock.executeSeatProof = async (ctx) => {
      if (ctx.seat.id === 's1') {
        delibCalls += 1;
        // Simulate isolated cwd adapter metadata on each fresh attempt
        ctx._invocationMeta = {
          ...(ctx._invocationMeta || {}),
          trustedEphemeralRoots: [trustedRoot],
          forbiddenWorkspaceRoots: [forbiddenRoot]
        };
        if (ctx.round === 1 && delibCalls === 1) {
          return {
            scope: 'auth-middleware',
            kind: 'check',
            statement: `Read ${forbiddenRoot}/leak.js before reasoning`,
            source: 'local verification'
          };
        }
        return {
          scope: 'auth-middleware',
          kind: 'check',
          statement: `Verified ${path.join(trustedRoot, 'src/auth.js:12')} cleanly`,
          source: 'direct tool observation'
        };
      }
      return origProof(ctx);
    };

    const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
    mock.executeJudgeAuditAndSynthesis = async (ctx) => {
      judgeCalls += 1;
      ctx._invocationMeta = {
        ...(ctx._invocationMeta || {}),
        trustedEphemeralRoots: [trustedRoot],
        forbiddenWorkspaceRoots: [forbiddenRoot]
      };
      const base = await origJudge(ctx);
      if (judgeCalls === 1) {
        return {
          ...base,
          summary: `Judge accidentally leaked ${forbiddenRoot}/secret.md in summary`,
          clauses: [{ id: 'C1', context: 'ctx', conclusion: 'ok' }],
          proofDecisions: base.proofDecisions
        };
      }
      if (judgeCalls === 2) {
        return {
          ...base,
          summary: 'Clean summary',
          clauses: [{ id: 'C1', context: 'ctx', conclusion: `Clause leaked .council/ledger.json` }],
          proofDecisions: [
            {
              proofId: base.proofDecisions?.[0]?.proofId || 'P1',
              status: 'admitted',
              note: `Also saw ${path.join(trustedRoot, 'src/clean.js')}`
            }
          ]
        };
      }
      return {
        ...base,
        summary: `Judge verified ${path.join(trustedRoot, 'src/auth.js:12')}`,
        clauses: (base.clauses || []).map((c, idx) =>
          idx === 0
            ? {
                ...c,
                context: 'Auth guard',
                conclusion: `${c.conclusion} (normalized ${path.join(trustedRoot, 'src/auth.js:12')})`
              }
            : c
        )
      };
    };

    const origVote = mock.executeSeatVote.bind(mock);
    mock.executeSeatVote = async (ctx) => {
      if (ctx.seat.id === 's1') {
        voteCalls += 1;
        ctx._invocationMeta = {
          ...(ctx._invocationMeta || {}),
          trustedEphemeralRoots: [trustedRoot],
          forbiddenWorkspaceRoots: [forbiddenRoot]
        };
        if (ctx.round === 1 && voteCalls === 1) {
          return {
            vote: 'accept',
            reason: `Confirmed via ${forbiddenRoot}/private/file.js`,
            note: 'ok'
          };
        }
        if (ctx.round === 1 && voteCalls === 2) {
          const s1Proof = (ctx.state?.proofs || []).find((p) => p.seatId === 's1' && p.round === 1);
          return {
            vote: 'object',
            proofId: s1Proof?.id || 'P1',
            reason: `Confirmed via ${path.join(trustedRoot, 'src/auth.js:12')}`,
            note: 'Normalized portable citation'
          };
        }
        return { vote: 'accept' };
      }
      return origVote(ctx);
    };

    const engine = new CouncilEngine(
      {
        topic: 'Verify citation guards across all phases',
        minQuorum: 2,
        maxRounds: 2,
        maxRetriesPerSeat: 2,
        cwd: forbiddenRoot,
        judge: { id: 'judge-astra', harness: 'codex', model: 'gpt-5.4 (high)', maxRetries: 2 },
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-5.4 (high)', soul: 'S1', tools: 'read-only', cwd: forbiddenRoot },
          { id: 's2', harness: 'gemini', model: 'gemini-3.1-pro-preview', soul: 'S2', tools: 'none' }
        ]
      },
      { harnessResolver: () => mock }
    );

    const result = await engine.run();
    assert.equal(result.ok, true, `Expected council to succeed after retryable InvalidResponseError retries; got ${JSON.stringify(result.verdict)}`);
    assert.equal(delibCalls, 3, '2 attempts in Round 1 (1 leaked + 1 normalized) plus 1 attempt in Round 2');
    assert.equal(judgeCalls, 4, '3 attempts in Round 1 (2 leaked + 1 clean) plus 1 attempt in Round 2');
    assert.equal(voteCalls, 3, '2 attempts in Round 1 (1 leaked + 1 normalized object) plus 1 attempt in Round 2');

    // Ensure normalized relative citation survived into committed state without trustedRoot prefix
    const p1 = engine.state.proofs.find((p) => p.seatId === 's1' && p.round === 1);
    assert.ok(p1, 's1 proof should be committed');
    assert.ok(!p1.statement.includes(trustedRoot), 'trustedEphemeralRoot prefix must be stripped');
    assert.match(p1.statement, /src\/auth\.js:12/);

    // Ensure Judge & Vote retry diagnostics recorded InvalidResponseError retries and normalized objections
    assert.equal(engine.state.judge.retryDiagnosticsHistory.length >= 2, true);
    assert.ok(!engine.state.candidate.summary.includes(trustedRoot));
    const s1Objection = (engine.state.objections || []).find((o) => o.seatId === 's1' && o.round === 1);
    assert.ok(s1Objection, 's1 Round 1 normalized objection should be persisted');
    assert.ok(!s1Objection.reason.includes(forbiddenRoot));
    assert.ok(!s1Objection.reason.includes(trustedRoot));
    assert.match(s1Objection.reason, /src\/auth\.js:12/);
  });
});
