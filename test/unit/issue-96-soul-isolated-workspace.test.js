import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANTI_CHEATING_RULE,
  STANDARD_SOULS,
  formatClarificationPrompt,
  formatDeliberationPrompt,
  formatVotingPrompt,
  formatJudgePrompt
} from '../../src/seats/soul.js';
import { AntigravityAdapter } from '../../src/harness/antigravity.js';
import { CodexAdapter } from '../../src/harness/codex.js';
import { CursorAdapter } from '../../src/harness/cursor.js';

describe('Issue #96: Isolated Relative-"." Workspace Contract & Anti-Baiting Prompt Guards', () => {
  const soul = STANDARD_SOULS.ADVERSARIAL_CHALLENGER;
  const baseSeat = { id: 'seat-96', harness: 'codex', model: 'gpt-6-astra' };
  const secretHostPath = '/Users/aaat/private-host-checkout-96/target-repo';
  const topicHostFile = '/Users/aaat/host-mentioned/src/engine/debate.js';
  const evidence = [
    {
      id: 'E1',
      label: 'Host Excerpt',
      source: `${topicHostFile}:10-25`,
      text: 'Excerpted from host topic reference.'
    }
  ];

  describe('(a) Read-only workspace-attached prompts (hasWorkspaceCwd && tools === "read-only")', () => {
    it('deliberation, voting, and judge prompts require relative "." paths in isolated .council-free workspace copy and forbid cd, .., git -C, and host path probing', () => {
      const delibPrompt = formatDeliberationPrompt({
        soul,
        seat: { ...baseSeat, cwd: secretHostPath },
        topic: `Inspect ${topicHostFile} and verify invariants`,
        round: 1,
        maxRounds: 3,
        evidence,
        tools: 'read-only'
      });

      const votePrompt = formatVotingPrompt({
        soul,
        seat: { ...baseSeat, votingTools: 'read-only' },
        candidate: {
          round: 1,
          summary: 'Candidate summary',
          clauses: [{ context: 'Core', conclusion: 'Check module', citedProofIds: ['P1'] }]
        },
        admittedProofs: [
          { id: 'P1', kind: 'check', scope: 'Core', source: topicHostFile, statement: 'Verified behavior' }
        ],
        evidence,
        state: { cwd: secretHostPath },
        tools: 'read-only'
      });

      const judgePrompt = formatJudgePrompt({
        judge: { id: 'judge-96', model: 'gpt-6-astra', cwd: secretHostPath },
        topic: `Audit ${topicHostFile}`,
        round: 1,
        proofs: [
          { id: 'P1', kind: 'check', scope: 'Core', source: topicHostFile, statement: 'Verified behavior' }
        ],
        evidence,
        tools: 'read-only'
      });

      for (const [label, prompt] of [
        ['formatDeliberationPrompt', delibPrompt],
        ['formatVotingPrompt', votePrompt],
        ['formatJudgePrompt', judgePrompt]
      ]) {
        assert.match(
          prompt,
          /relative paths?\b.*\./i,
          `${label} must instruct inspecting via relative paths rooted at "."`
        );
        assert.ok(
          prompt.includes('isolated .council-free workspace copy'),
          `${label} must explain "." is an isolated .council-free workspace copy when .council exists on host`
        );
        assert.match(prompt, /\bcd\b/i, `${label} must forbid cd`);
        assert.ok(prompt.includes('..'), `${label} must forbid parent traversal (..)`);
        assert.ok(prompt.includes('git -C'), `${label} must forbid git -C`);
        assert.match(
          prompt,
          /absolute host\b/i,
          `${label} must forbid probing absolute host paths`
        );
        assert.ok(
          prompt.includes('FORBIDDEN_STATE_ACCESS'),
          `${label} must warn that probing host paths triggers FORBIDDEN_STATE_ACCESS`
        );
        assert.ok(
          !prompt.includes('No local code workspace is attached'),
          `${label} must NEVER emit "No local code workspace is attached" when workspace cwd is attached`
        );
        assert.ok(
          !prompt.includes('isolated sandbox directory'),
          `${label} must NEVER emit "isolated sandbox directory" when workspace cwd is attached`
        );
        assert.ok(
          !prompt.includes(secretHostPath),
          `${label} must NEVER interpolate configured cwd (${secretHostPath}) into generated prompt`
        );
      }
    });

    it('never leaks cwd passed via direct cwd arg, seat.cwd, judge.cwd, or state.cwd across all prompt formatters', () => {
      const cwdVariants = [
        { cwd: '/var/secret/cwd-direct' },
        { seat: { ...baseSeat, cwd: '/var/secret/cwd-seat' } },
        { state: { cwd: '/var/secret/cwd-state' } }
      ];

      for (const variant of cwdVariants) {
        const leaked = variant.cwd || variant.seat?.cwd || variant.state?.cwd;
        const pDelib = formatDeliberationPrompt({
          soul,
          seat: baseSeat,
          topic: 'Generic topic',
          tools: 'read-only',
          ...variant
        });
        const pVote = formatVotingPrompt({
          soul,
          seat: { ...baseSeat, votingTools: 'read-only' },
          candidate: { round: 1, summary: 'S', clauses: [] },
          admittedProofs: [],
          tools: 'read-only',
          ...variant
        });
        assert.ok(!pDelib.includes(leaked), `Deliberation prompt leaked ${leaked}`);
        assert.ok(!pVote.includes(leaked), `Voting prompt leaked ${leaked}`);
      }

      for (const judgeVariant of [
        { cwd: '/var/secret/judge-cwd-direct' },
        { judge: { id: 'j', model: 'm', cwd: '/var/secret/judge-cwd-obj' } },
        { state: { cwd: '/var/secret/judge-cwd-state' } }
      ]) {
        const leaked = judgeVariant.cwd || judgeVariant.judge?.cwd || judgeVariant.state?.cwd;
        const pJudge = formatJudgePrompt({
          judge: { id: 'j', model: 'm' },
          topic: 'Generic topic',
          round: 1,
          proofs: [],
          tools: 'read-only',
          ...judgeVariant
        });
        assert.ok(!pJudge.includes(leaked), `Judge prompt leaked ${leaked}`);
      }
    });
  });

  describe('(b) formatClarificationPrompt contract, read-only conditional relative-"." guidance, and tool-free mode', () => {
    it('retains QUESTION/CLEAR contract, includes ANTI_CHEATING_RULE, and emits conditional relative-"." + no-host-path guidance in read-only mode', () => {
      const prompt = formatClarificationPrompt({
        soul,
        seat: { id: 'seat-clarify', tools: 'read-only' },
        topic: `Clarify constraints for ${topicHostFile}`,
        batch: 1,
        maxBatches: 2,
        cwd: secretHostPath
      });

      assert.match(prompt, /QUESTION: <specific technical question>/);
      assert.match(prompt, /CLEAR: No clarifications needed\./);
      assert.ok(prompt.includes(ANTI_CHEATING_RULE), 'Clarification prompt must include ANTI_CHEATING_RULE');
      assert.match(prompt, /if a workspace is attached/i);
      assert.match(prompt, /relative paths?\b.*\./i);
      assert.ok(prompt.includes('isolated .council-free workspace copy'));
      assert.match(prompt, /if no workspace is attached/i);
      assert.match(prompt, /\bcd\b/i);
      assert.ok(prompt.includes('..'));
      assert.ok(prompt.includes('git -C'));
      assert.match(prompt, /absolute host\b/i);
      assert.ok(prompt.includes('FORBIDDEN_STATE_ACCESS'));
      assert.ok(!prompt.includes('No local code workspace is attached'));
      assert.ok(!prompt.includes('isolated sandbox directory'));
      assert.ok(!prompt.includes(secretHostPath), 'Clarification prompt must not interpolate cwd');
    });

    it('emits tool-free directive when clarification tools === "none" while preserving contract and ANTI_CHEATING_RULE', () => {
      const viaParam = formatClarificationPrompt({
        soul,
        seat: { id: 'seat-clarify', cwd: secretHostPath },
        topic: 'Clarify runtime limits',
        batch: 1,
        maxBatches: 1,
        tools: 'none'
      });
      const viaSeat = formatClarificationPrompt({
        soul,
        seat: { id: 'seat-clarify', tools: 'none', cwd: secretHostPath },
        topic: 'Clarify runtime limits',
        batch: 1,
        maxBatches: 1
      });

      for (const prompt of [viaParam, viaSeat]) {
        assert.match(prompt, /QUESTION: <specific technical question>/);
        assert.match(prompt, /CLEAR: No clarifications needed\./);
        assert.ok(prompt.includes(ANTI_CHEATING_RULE));
        assert.match(prompt, /do not invoke any tools/i);
        assert.ok(!prompt.includes('No local code workspace is attached'));
        assert.ok(!prompt.includes('isolated sandbox directory'));
        assert.ok(!prompt.includes(secretHostPath));
      }
    });

    it('emits conditional relative-"." + no-host-path guidance across AntigravityAdapter, CodexAdapter, and CursorAdapter executeSeatClarification when adapter cwd is set', async () => {
      const specs = [
        { AdapterClass: AntigravityAdapter, model: 'gemini-4-argon-high' },
        { AdapterClass: CodexAdapter, model: 'gpt-6.1-sol (high)' },
        { AdapterClass: CursorAdapter, model: 'grok-4.7-high' }
      ];

      for (const { AdapterClass, model } of specs) {
        let capturedPrompt = '';
        let capturedCwd = '';
        const adapter = new AdapterClass({
          cwd: secretHostPath,
          spawnRunner: async ({ prompt, cwd }) => {
            capturedPrompt = prompt;
            capturedCwd = cwd;
            return 'CLEAR: No clarifications needed.';
          }
        });

        // seat intentionally omits seat.cwd (mirrors real council runner behavior when cwd is adapter-level)
        const res = await adapter.executeSeatClarification({
          seat: { id: 'seat-adapter-clarify', model },
          soul,
          round: 1,
          state: {
            topic: `Inspect ${topicHostFile} for race conditions`,
            maxClarificationBatches: 2
          }
        });

        assert.equal(res.needsClarification, false);
        assert.equal(capturedCwd, secretHostPath);
        assert.ok(capturedPrompt.includes(ANTI_CHEATING_RULE), `${AdapterClass.name} missing ANTI_CHEATING_RULE`);
        assert.match(capturedPrompt, /QUESTION: <specific technical question>/);
        assert.match(capturedPrompt, /CLEAR: No clarifications needed\./);
        assert.match(capturedPrompt, /if a workspace is attached/i);
        assert.ok(capturedPrompt.includes('isolated .council-free workspace copy'));
        assert.ok(capturedPrompt.includes('git -C'));
        assert.ok(capturedPrompt.includes('..'));
        assert.ok(capturedPrompt.includes('FORBIDDEN_STATE_ACCESS'));
        assert.ok(!capturedPrompt.includes('No local code workspace is attached'));
        assert.ok(!capturedPrompt.includes('isolated sandbox directory'));
        assert.ok(
          !capturedPrompt.includes(secretHostPath),
          `${AdapterClass.name} clarification prompt must not interpolate adapter cwd`
        );
      }
    });
  });

  describe('(c) Tool-free mode with workspace cwd attached (hasWorkspaceCwd && tools === "none")', () => {
    it('omits workspace/sandbox directives and TOOL USAGE / Spot-check headings while retaining ANTI_CHEATING_RULE and tool-free directives', () => {
      const delibNone = formatDeliberationPrompt({
        soul,
        seat: { ...baseSeat, cwd: secretHostPath },
        topic: 'Tool-free deliberation with cwd present',
        evidence,
        tools: 'none',
        cwd: secretHostPath
      });
      const voteNone = formatVotingPrompt({
        soul,
        seat: { ...baseSeat, cwd: secretHostPath, votingTools: 'read-only' },
        candidate: { round: 1, summary: 'S', clauses: [] },
        admittedProofs: [],
        evidence,
        state: { cwd: secretHostPath },
        tools: 'none',
        cwd: secretHostPath
      });
      const judgeNone = formatJudgePrompt({
        judge: { id: 'judge-96', model: 'gpt-6-astra', cwd: secretHostPath },
        topic: 'Tool-free judge with cwd present',
        round: 1,
        proofs: [{ id: 'P1', statement: 'Stmt', source: 'Src' }],
        evidence,
        tools: 'none',
        cwd: secretHostPath
      });

      for (const [label, prompt] of [
        ['formatDeliberationPrompt', delibNone],
        ['formatVotingPrompt', voteNone],
        ['formatJudgePrompt', judgeNone]
      ]) {
        assert.ok(!prompt.includes('No local code workspace is attached'), `${label} must not say no workspace attached`);
        assert.ok(!prompt.includes('isolated sandbox directory'), `${label} must not say isolated sandbox directory`);
        assert.ok(prompt.includes(ANTI_CHEATING_RULE), `${label} must keep ANTI_CHEATING_RULE`);
        assert.ok(!prompt.includes(secretHostPath), `${label} must not leak cwd`);
      }

      assert.ok(!delibNone.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
      assert.ok(delibNone.includes('Do not invoke any tools (no shell, file reads, or web searches) on this turn.'));
      assert.ok(!voteNone.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
      assert.ok(voteNone.includes('Do not invoke any tools during confirmation voting.'));
      assert.ok(!judgeNone.includes('4. Spot-check proof sources:'));
      assert.ok(judgeNone.includes('4. Tool-free audit & synthesis: Do not invoke any tools on this turn.'));
    });
  });

  describe('(d) ANTI_CHEATING_RULE literal tokens and anti-baiting warnings', () => {
    it('retains opening phrase and all 8 literal tokens while forbidding CLI flags, negative globs/pathspecs, and tool/MCP queries', () => {
      assert.match(
        ANTI_CHEATING_RULE,
        /^STRICT ANTI-CHEATING RULE: Never read, grep, or inspect "\.council\/"/
      );

      for (const token of [
        '.council/',
        '.council/runs/',
        '.council/telemetry/',
        '.council/runs/latest.js',
        'latest.js',
        '*.meta.json',
        '*.events.jsonl',
        'telemetry-summary.*'
      ]) {
        assert.ok(
          ANTI_CHEATING_RULE.includes(token),
          `ANTI_CHEATING_RULE must retain literal token ${token}`
        );
      }

      assert.match(ANTI_CHEATING_RULE, /already omit|physically excluded|already excluded/i);
      assert.match(ANTI_CHEATING_RULE, /CLI flags?/i);
      assert.match(ANTI_CHEATING_RULE, /negative globs|exclude pathspecs/i);
      assert.match(ANTI_CHEATING_RULE, /tool\/MCP|MCP|search queries/i);
    });
  });

  describe('(e) Issue #102 .codegraph-free copy notice, native tool preference, anti-temp-path rules, and phase read caps', () => {
    it('explains .codegraph-free copy, prefers native read/search tools over headless Bash/codegraph, and forbids temp dir/host paths in final citations', () => {
      const clarifyPrompt = formatClarificationPrompt({
        soul,
        seat: { ...baseSeat, tools: 'read-only' },
        topic: 'Inspect src/index.js',
        batch: 1,
        maxBatches: 1,
        cwd: secretHostPath
      });
      const delibPrompt = formatDeliberationPrompt({
        soul,
        seat: { ...baseSeat, cwd: secretHostPath },
        topic: 'Inspect src/index.js',
        round: 1,
        maxRounds: 3,
        tools: 'read-only'
      });
      const votePrompt = formatVotingPrompt({
        soul,
        seat: { ...baseSeat, cwd: secretHostPath, votingTools: 'read-only' },
        candidate: { round: 1, summary: 'S', clauses: [] },
        admittedProofs: [],
        tools: 'read-only'
      });
      const judgePrompt = formatJudgePrompt({
        judge: { id: 'judge-96', model: 'gpt-6-astra', cwd: secretHostPath },
        topic: 'Audit src/index.js',
        round: 1,
        proofs: [{ id: 'P1', kind: 'citation', scope: 'Core', source: 'src/index.js:1', statement: 'Exported' }],
        tools: 'read-only'
      });

      for (const [label, prompt] of [
        ['formatClarificationPrompt', clarifyPrompt],
        ['formatDeliberationPrompt', delibPrompt],
        ['formatVotingPrompt', votePrompt],
        ['formatJudgePrompt', judgePrompt]
      ]) {
        assert.match(prompt, /\.codegraph-free/i, `${label} must note .codegraph-free workspace copy`);
        assert.match(prompt, /Read\/read_file.*Glob.*Grep.*LS/i, `${label} must allow native read/search tools`);
        assert.match(prompt, /Bash.*codegraph/i, `${label} must discourage headless Bash/codegraph CLI when native tools suffice`);
        assert.match(prompt, /repository-relative/i, `${label} must require portable repository-relative citations`);
        assert.match(prompt, /temporary copy directory names|raw temp/i, `${label} must forbid temp dir names/paths in citations`);
        assert.ok(!prompt.includes(secretHostPath), `${label} must not leak host cwd`);
      }
    });

    it('emits bounded phase read caps (5-8 R1, 3-5 R2+/Vote/Judge cited, 0 Judge uncited) without reopening prior-round proofs', () => {
      const delibR1 = formatDeliberationPrompt({
        soul,
        seat: { ...baseSeat, cwd: secretHostPath },
        topic: 'Inspect src/index.js',
        round: 1,
        maxRounds: 3,
        tools: 'read-only'
      });
      assert.match(delibR1, /5.?8 targeted reads/);

      const delibR2 = formatDeliberationPrompt({
        soul,
        seat: { ...baseSeat, cwd: secretHostPath },
        topic: 'Rebuttal',
        round: 2,
        maxRounds: 3,
        rebuttalMode: true,
        previousCandidate: { round: 1, summary: 'Prev', clauses: [] },
        openObjections: [{ id: 'O1', seatId: 's2', proofId: 'P1', reason: 'Dispute src/index.js:10' }],
        tools: 'read-only'
      });
      assert.match(delibR2, /3.?5 targeted reads/);
      assert.match(delibR2, /Unresolved Objections/);

      const voteReadOnly = formatVotingPrompt({
        soul,
        seat: { ...baseSeat, cwd: secretHostPath, votingTools: 'read-only' },
        candidate: { round: 1, summary: 'S', clauses: [] },
        admittedProofs: [],
        tools: 'read-only'
      });
      assert.match(voteReadOnly, /3.?5 targeted spot-check reads/);

      const voteNone = formatVotingPrompt({
        soul,
        seat: { ...baseSeat, cwd: secretHostPath, votingTools: 'none' },
        candidate: { round: 1, summary: 'S', clauses: [] },
        admittedProofs: [],
        tools: 'none'
      });
      assert.match(voteNone, /No local file reads are permitted/);

      const judgeCitedProof = formatJudgePrompt({
        judge: { id: 'judge-96', cwd: secretHostPath },
        topic: 'Audit',
        round: 1,
        proofs: [{ id: 'P1', kind: 'citation', scope: 'Core', source: 'src/index.js:5', statement: 'Verified' }],
        tools: 'read-only'
      });
      assert.match(judgeCitedProof, /3.?5 targeted reads/);

      const judgeCitedObjection = formatJudgePrompt({
        judge: { id: 'judge-96', cwd: secretHostPath },
        topic: 'Audit',
        round: 2,
        previousCandidate: { round: 1, summary: 'Prev', clauses: [] },
        openObjections: [{ id: 'O1', seatId: 's2', proofId: 'P0', reason: 'Dispute src/engine/council-engine.js:42' }],
        proofs: [{ id: 'P1', kind: 'derivation', scope: 'Logic', source: 'internal reasoning', statement: 'Concept' }],
        tools: 'read-only'
      });
      assert.match(judgeCitedObjection, /3.?5 targeted reads/);

      const judgeUncited = formatJudgePrompt({
        judge: { id: 'judge-96', cwd: secretHostPath },
        topic: 'Audit',
        round: 2,
        previousCandidate: { round: 1, summary: 'Prev', clauses: [] },
        priorAdmittedProofs: [{ id: 'P0', round: 1, source: 'src/old.js:1', statement: 'Old', status: 'admitted' }],
        openObjections: [{ id: 'O1', seatId: 's2', proofId: 'P0', reason: 'Scope disagreement' }],
        proofs: [{ id: 'P1', kind: 'derivation', scope: 'Logic', source: 'internal reasoning', statement: 'Concept' }],
        tools: 'read-only'
      });
      assert.match(judgeUncited, /0 local workspace reads/);
      assert.match(judgeUncited, /do NOT reopen or re-audit Prior-Round Admitted Proofs/i);
    });
  });
});
