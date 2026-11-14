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
import { InvalidResponseError, TimeoutError } from '../../src/harness/adapter.js';

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

    for (const bareSource of ['README', 'LICENSE', '"README"', 'NOTICE', 'CONTRIBUTING', 'CODE_OF_CONDUCT', '`README`', '``LICENSE``']) {
      const pJudgeBareRoot = formatJudgePrompt({
        judge: { id: 'j', cwd: '/Users/secret/repo' },
        topic: 'Topic',
        round: 1,
        proofs: [{ id: 'P1', statement: 'Root file claim', source: bareSource }],
        tools: 'read-only'
      });
      assert.match(pJudgeBareRoot, /3[–-]5 targeted reads/i, `Expected 3–5 targeted reads for bare source ${bareSource}`);
      assert.doesNotMatch(pJudgeBareRoot, /0 local workspace reads/i, `Did not expect 0 local workspace reads for bare source ${bareSource}`);
    }
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
        judge: { id: 'judge-astra', harness: 'codex', model: 'gpt-6-astra (high)', maxRetries: 2 },
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S1', tools: 'read-only', cwd: forbiddenRoot },
          { id: 's2', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'S2', tools: 'none' }
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

  it('preserves in-place _invocationMeta mutations across Delib Retry, Judge, Vote Wave 0, and Vote Retry without mutating originalInvocationMeta', async () => {
    const baseWorkspace = '/tmp/live-workspace-inplace-102';
    const delibRetryTrustedRoot = path.join(os.tmpdir(), 'council-inplace-delib-retry');
    const judgeForbiddenRoot = '/Users/private/inplace-judge-forbidden';
    const judgeTrustedRoot = path.join(os.tmpdir(), 'council-inplace-judge');
    const vote0ForbiddenRoot = '/Users/private/inplace-vote0-forbidden';
    const voteRetryTrustedRoot = path.join(os.tmpdir(), 'council-inplace-vote-retry');

    const mock = new MockAdapter();
    let delibCalls = 0;
    let judgeCalls = 0;
    let voteCalls = 0;
    let s3TimeoutCalls = 0;

    const origProof = mock.executeSeatProof.bind(mock);
    mock.executeSeatProof = async (ctx) => {
      if (ctx.seat.id === 's1') {
        assert.equal(ctx._invocationMeta, ctx.context._invocationMeta, 'Delib attempt args._invocationMeta and context._invocationMeta must share one live object');
        delibCalls += 1;
        if (ctx.round === 1 && delibCalls === 1) {
          throw new InvalidResponseError('Transient parse failure before Delib Retry', {
            harness: 'codex',
            seatId: 's1'
          });
        }
        // Mutate IN PLACE without replacing ctx._invocationMeta reference
        ctx._invocationMeta.trustedEphemeralRoots.push(delibRetryTrustedRoot);
        return {
          scope: 'auth-middleware',
          kind: 'check',
          statement: `Delib retry verified ${path.join(delibRetryTrustedRoot, 'src/auth.js:15')}`,
          source: 'direct tool observation'
        };
      }
      if (ctx.seat.id === 's3-timeout') {
        assert.equal(ctx._invocationMeta, ctx.context._invocationMeta);
        s3TimeoutCalls += 1;
        // Mutate effectiveTools IN PLACE before TimeoutError — must not corrupt originalInvocationMeta
        ctx._invocationMeta.effectiveTools = 'none';
        if (s3TimeoutCalls === 1) {
          throw new TimeoutError('Seat timed out after read-only loop', {
            harness: 'codex',
            seatId: 's3-timeout',
            timeoutMs: 1000
          });
        }
        return origProof(ctx);
      }
      return origProof(ctx);
    };

    const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
    mock.executeJudgeAuditAndSynthesis = async (ctx) => {
      assert.equal(ctx._invocationMeta, ctx.context._invocationMeta, 'Judge args._invocationMeta and context._invocationMeta must share one live object');
      judgeCalls += 1;
      const base = await origJudge(ctx);
      if (judgeCalls === 1) {
        // Push custom forbidden root IN PLACE without reassigning ctx._invocationMeta
        ctx._invocationMeta.forbiddenWorkspaceRoots.push(judgeForbiddenRoot);
        return {
          ...base,
          summary: `Judge leaked ${judgeForbiddenRoot}/secret.md`,
          clauses: [{ id: 'C1', context: 'ctx', conclusion: 'ok' }],
          proofDecisions: base.proofDecisions
        };
      }
      ctx._invocationMeta.trustedEphemeralRoots.push(judgeTrustedRoot);
      return {
        ...base,
        summary: `Judge normalized ${path.join(judgeTrustedRoot, 'src/auth.js:20')}`,
        clauses: (base.clauses || []).map((c, idx) =>
          idx === 0
            ? { ...c, context: 'Auth', conclusion: `Clean ${path.join(judgeTrustedRoot, 'src/auth.js:20')}` }
            : c
        )
      };
    };

    const origVote = mock.executeSeatVote.bind(mock);
    mock.executeSeatVote = async (ctx) => {
      if (ctx.seat.id === 's1') {
        assert.equal(ctx._invocationMeta, ctx.context._invocationMeta, 'Vote args._invocationMeta and context._invocationMeta must share one live object');
        voteCalls += 1;
        if (ctx.round === 1 && voteCalls === 1) {
          // Vote Wave 0: push custom forbidden root IN PLACE
          ctx._invocationMeta.forbiddenWorkspaceRoots.push(vote0ForbiddenRoot);
          return {
            vote: 'accept',
            reason: `Saw ${vote0ForbiddenRoot}/private.js`,
            note: 'leaked in vote wave 0'
          };
        }
        if (ctx.round === 1 && voteCalls === 2) {
          // Vote Retry: push trusted ephemeral root IN PLACE
          ctx._invocationMeta.trustedEphemeralRoots.push(voteRetryTrustedRoot);
          const s1Proof = (ctx.state?.proofs || []).find((p) => p.seatId === 's1' && p.round === 1);
          return {
            vote: 'object',
            proofId: s1Proof?.id || 'P1',
            reason: `Verified via ${path.join(voteRetryTrustedRoot, 'src/auth.js:33')}`,
            note: 'in-place trusted root normalized'
          };
        }
        return { vote: 'accept' };
      }
      return origVote(ctx);
    };

    const engine = new CouncilEngine(
      {
        topic: 'Audit src/auth.js in-place _invocationMeta propagation across all phases',
        evidence: [
          {
            id: 'E1',
            label: 'src/auth.js snapshot',
            source: 'src/auth.js',
            text: '[E1] Complete snapshot of src/auth.js'
          }
        ],
        minQuorum: 2,
        maxRounds: 2,
        maxRetriesPerSeat: 2,
        cwd: baseWorkspace,
        selfContainedInput: {
          kind: 'full_context',
          label: 'Complete workspace snapshot',
          phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
          roundScope: 'all_rounds',
          coveredArtifacts: [{ source: 'src/auth.js', evidenceId: 'E1', coverage: 'complete_artifact' }]
        },
        judge: { id: 'judge-astra', harness: 'codex', model: 'gpt-6-astra (high)', maxRetries: 2 },
        seats: [
          {
            id: 's1',
            harness: 'codex',
            model: 'gpt-6-astra (high)',
            soul: 'S1',
            tools: 'read-only',
            votingTools: 'read-only',
            cwd: baseWorkspace
          },
          { id: 's2', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'S2', tools: 'none' },
          { id: 's3-timeout', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S3', tools: 'read-only' }
        ]
      },
      { harnessResolver: () => mock }
    );

    const result = await engine.run();
    assert.equal(result.ok, true, `Expected consensus after in-place metadata propagation; got ${JSON.stringify(result.verdict)}`);
    assert.equal(delibCalls, 3, 's1 Delib Wave 0 failure + Delib Retry + Round 2');
    assert.equal(judgeCalls, 3, 'Judge Attempt 0 blocked by in-place forbiddenRoot + Retry 1 succeeded + Round 2');
    assert.equal(voteCalls, 3, 's1 Vote Wave 0 blocked by in-place forbiddenRoot + Vote Retry succeeded + Round 2');

    const p1 = engine.state.proofs.find((p) => p.seatId === 's1' && p.round === 1);
    assert.ok(p1);
    assert.ok(!p1.statement.includes(delibRetryTrustedRoot), 'Delib Retry in-place trustedEphemeralRoot must be normalized');
    assert.match(p1.statement, /src\/auth\.js:15/);

    assert.ok(!engine.state.candidate.summary.includes(judgeTrustedRoot), 'Judge in-place trustedEphemeralRoot must be normalized');
    assert.match(engine.state.candidate.summary, /src\/auth\.js:20/);

    const s1Objection = (engine.state.objections || []).find((o) => o.seatId === 's1' && o.round === 1);
    assert.ok(s1Objection);
    assert.ok(!s1Objection.reason.includes(voteRetryTrustedRoot), 'Vote Retry in-place trustedEphemeralRoot must be normalized');
    assert.match(s1Objection.reason, /src\/auth\.js:33/);

    // s3-timeout mutated ctx._invocationMeta.effectiveTools = 'none' in place before throwing TimeoutError,
    // yet originalInvocationMeta snapshot remained 'read-only' so Round 1 retry marked tool-free recovery used
    const s3 = engine.state.seats.find((s) => s.id === 's3-timeout');
    assert.equal(s3TimeoutCalls, 3);
    assert.equal(s3.status, 'accepted');
    assert.equal(s3.retryDiagnosticsHistory[0].tools, 'none');
    assert.equal(engine._seatToolFreeUsed.get('1:DELIBERATION:s3-timeout'), true);
  });

  it('Important 2: validates and normalizes dec.admittedStatement, dec.reason, and dec.caveat in Judge proofDecisions', () => {
    const trustedRoot = path.join(os.tmpdir(), 'council-safe-cwd-judge-dec');
    const engine = new CouncilEngine(
      {
        topic: 'Validate judge proofDecisions fields',
        selfContainedInput: {
          kind: 'full_context',
          phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
          roundScope: 'all_rounds',
          conceptualNoExternalVerification: true
        },
        seats: [
          { id: 's1', harness: 'mock', model: 'mock-a', soul: 'S1' },
          { id: 's2', harness: 'mock', model: 'mock-b', soul: 'S2' }
        ],
        judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra' }
      },
      { harnessResolver: () => new MockAdapter() }
    );

    const badAdmittedStmt = engine._normalizeAndValidateJudge(
      {
        summary: 'Summary OK',
        clauses: [{ id: 'C1', statement: 'Clause OK', supportingProofs: ['P1'] }],
        proofDecisions: {
          P1: {
            status: 'partially_admitted',
            admittedStatement: 'Core verified at ../outside.js:12',
            note: 'Bounded caveat'
          }
        }
      },
      { trustedEphemeralRoots: [], forbiddenWorkspaceRoots: [] }
    );
    assert.equal(badAdmittedStmt.valid, false);
    assert.ok(badAdmittedStmt.errors.some((e) => /admittedStatement/.test(e)));

    const badCombinedAdmittedStmt = engine._normalizeAndValidateJudge(
      {
        summary: 'Summary OK',
        clauses: [{ id: 'C1', context: 'Auth', conclusion: 'Clause OK', citedProofIds: ['P1'] }],
        proofDecisions: {
          P1: {
            status: 'partially_admitted',
            admittedStatement: 'Verified .council/state.json:1 and ../outside.js:3',
            note: 'Bounded caveat'
          }
        }
      },
      { trustedEphemeralRoots: [], forbiddenWorkspaceRoots: [] }
    );
    assert.equal(badCombinedAdmittedStmt.valid, false);
    assert.ok(badCombinedAdmittedStmt.errors.some((e) => /admittedStatement/.test(e)));

    const badReason = engine._normalizeAndValidateJudge(
      {
        summary: 'Summary OK',
        clauses: [{ id: 'C1', statement: 'Clause OK', supportingProofs: ['P1'] }],
        proofDecisions: {
          P1: {
            status: 'rejected',
            reason: 'Read .council/state.json instead',
            note: 'Note OK'
          }
        }
      },
      { trustedEphemeralRoots: [], forbiddenWorkspaceRoots: [] }
    );
    assert.equal(badReason.valid, false);
    assert.ok(badReason.errors.some((e) => /reason/.test(e)));

    const badCaveat = engine._normalizeAndValidateJudge(
      {
        summary: 'Summary OK',
        clauses: [{ id: 'C1', statement: 'Clause OK', supportingProofs: ['P1'] }],
        proofDecisions: {
          P1: {
            status: 'partially_admitted',
            admittedStatement: 'Safe statement',
            caveat: 'Verified /private-host/repo/src/auth.js:10 outside isolated root'
          }
        }
      },
      { trustedEphemeralRoots: [], forbiddenWorkspaceRoots: ['/private-host/repo'] }
    );
    assert.equal(badCaveat.valid, false);
    assert.ok(badCaveat.errors.some((e) => /caveat/.test(e)));

    const goodNormalized = engine._normalizeAndValidateJudge(
      {
        summary: 'Summary OK',
        clauses: [{ id: 'C1', statement: 'Clause OK', supportingProofs: ['P1'] }],
        proofDecisions: {
          P1: {
            status: 'partially_admitted',
            admittedStatement: `Verified core via ${path.join(trustedRoot, 'src/auth.js:18')}`,
            reason: `Scoped check at ${path.join(trustedRoot, 'src/session.js:5')}`,
            caveat: `Excluded ${path.join(trustedRoot, 'src/legacy.js:9')}`
          }
        }
      },
      { trustedEphemeralRoots: [trustedRoot], forbiddenWorkspaceRoots: [] }
    );
    assert.equal(goodNormalized.valid, true, `Unexpected validation errors: ${JSON.stringify(goodNormalized.errors)}`);
    assert.equal(goodNormalized.judgeResult.proofDecisions.P1.admittedStatement, 'Verified core via src/auth.js:18');
    assert.equal(goodNormalized.judgeResult.proofDecisions.P1.reason, 'Scoped check at src/session.js:5');
    assert.equal(goodNormalized.judgeResult.proofDecisions.P1.caveat, 'Excluded src/legacy.js:9');
  });
});
