import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  STANDARD_SOULS,
  validateSoulConfig,
  Soul,
  createSoul,
  formatSoulSystemPrompt,
  formatClarificationPrompt,
  formatDeliberationPrompt,
  formatVotingPrompt,
  formatJudgePrompt,
  formatGroundingSection
} from '../../src/seats/soul.js';

describe('Unit: Soul Temperaments & Prompt Injections (src/seats/soul.js)', () => {
  describe('STANDARD_SOULS Catalog', () => {
    const requiredSouls = [
      'ADVERSARIAL_CHALLENGER',
      'FORMAL_VERIFIER',
      'PRAGMATIC_ENGINEER',
      'SECURITY_AUDITOR',
      'SYSTEMS_PURIST',
      'PERFORMANCE_BENCHMARKER',
      'DOMAIN_MODELER',
      'IMPARTIAL_JUDGE'
    ];

    it('contains all required standard temperament archetypes', () => {
      for (const key of requiredSouls) {
        assert.ok(STANDARD_SOULS[key], `STANDARD_SOULS missing archetype: ${key}`);
        const soul = STANDARD_SOULS[key];
        assert.ok(typeof soul.name === 'string' && soul.name.trim().length > 0);
        assert.ok(typeof soul.temperament === 'string' && soul.temperament.trim().length > 0);
        assert.ok(typeof soul.lens === 'string' && soul.lens.trim().length > 0);
        assert.ok(Array.isArray(soul.rules) && soul.rules.length > 0);
      }
    });

    it('ensures standard souls are deeply frozen and immutable', () => {
      assert.ok(Object.isFrozen(STANDARD_SOULS));
      assert.ok(Object.isFrozen(STANDARD_SOULS.ADVERSARIAL_CHALLENGER));
      assert.ok(Object.isFrozen(STANDARD_SOULS.ADVERSARIAL_CHALLENGER.rules));
    });
  });

  describe('validateSoulConfig', () => {
    it('accepts valid string and object configurations', () => {
      assert.equal(validateSoulConfig('Systems Purist: kernel focus').valid, true);
      assert.equal(validateSoulConfig({ name: 'Auditor', lens: 'Compliance' }).valid, true);
      assert.equal(validateSoulConfig({ name: 'Auditor', lens: 'Compliance', rules: ['rule 1'] }).valid, true);
    });

    it('rejects null, undefined, and non-string/non-objects', () => {
      assert.equal(validateSoulConfig(null).valid, false);
      assert.equal(validateSoulConfig(undefined).valid, false);
      assert.equal(validateSoulConfig(123).valid, false);
      assert.equal(validateSoulConfig([]).valid, false);
    });

    it('rejects empty string and incomplete objects', () => {
      assert.equal(validateSoulConfig('').valid, false);
      assert.equal(validateSoulConfig('   ').valid, false);
      assert.equal(validateSoulConfig({ name: 'Auditor' }).valid, false);
      assert.equal(validateSoulConfig({ lens: 'Compliance' }).valid, false);
      assert.equal(validateSoulConfig({ name: '', lens: 'Compliance' }).valid, false);
      assert.equal(validateSoulConfig({ name: 'Auditor', lens: '   ' }).valid, false);
    });
  });

  describe('Soul Class & Factory', () => {
    it('creates a Soul instance from string format', () => {
      const soul = createSoul('Systems & Kernel Purist: focuses on container density and uptime');
      assert.equal(soul.name, 'Systems & Kernel Purist');
      assert.equal(soul.lens, 'focuses on container density and uptime');
      assert.equal(soul.temperament, 'custom');
      assert.equal(soul.toString(), 'Systems & Kernel Purist: focuses on container density and uptime');
      assert.equal(soul.toJSON(), soul.toString());
    });

    it('creates a Soul instance from structured object', () => {
      const soul = createSoul({
        name: 'SecOps Auditor',
        temperament: 'skeptical',
        lens: 'Threat modeling and supply chain integrity',
        rules: ['Verify cryptographic signatures', 'Reject unverified binary blobs']
      });

      assert.equal(soul.name, 'SecOps Auditor');
      assert.equal(soul.temperament, 'skeptical');
      assert.equal(soul.lens, 'Threat modeling and supply chain integrity');
      assert.deepEqual(soul.rules, ['Verify cryptographic signatures', 'Reject unverified binary blobs']);
    });

    it('returns the same instance if already a Soul', () => {
      const s1 = new Soul('Architect: Scalability');
      const s2 = createSoul(s1);
      assert.equal(s1, s2);
    });

    it('throws if creating Soul with invalid config', () => {
      assert.throws(() => new Soul({}), /Invalid Soul configuration/);
    });
  });

  describe('Prompt Injections Across Deliberation Phases', () => {
    const seatContext = {
      id: 'astra-kernel',
      harness: 'codex',
      model: 'gpt-6-astra (max)'
    };
    const soul = STANDARD_SOULS.SYSTEMS_PURIST;

    it('formatSoulSystemPrompt injects identity, temperament, and invariants', () => {
      const prompt = formatSoulSystemPrompt(soul, seatContext);
      assert.match(prompt, /Seat "astra-kernel"/);
      assert.match(prompt, /gpt-6-astra \(max\)/);
      assert.match(prompt, /Systems & Kernel Purist/);
      assert.match(prompt, /Kernel architecture, container namespaces/);
      assert.match(prompt, /Inspect kernel overhead/);
      assert.match(prompt, /Structured Proofs/);
      assert.match(prompt, /check, citation, benchmark, derivation/);
    });

    it('formatClarificationPrompt formats pre-deliberation discovery request', () => {
      const prompt = formatClarificationPrompt({
        soul,
        seat: seatContext,
        topic: 'Which database engine should be used for the audit ledger?',
        batch: 1,
        maxBatches: 2
      });

      assert.match(prompt, /Pre-Deliberation Discovery: Clarification Batch 1\/2/);
      assert.match(prompt, /Which database engine should be used for the audit ledger\?/);
      assert.match(prompt, /Seat "astra-kernel"/);
      assert.match(prompt, /QUESTION: <specific technical question>/);
      assert.match(prompt, /CLEAR: No clarifications needed/);
    });

    it('formatDeliberationPrompt injects context, prior candidate, objections, and schema contract', () => {
      const prompt = formatDeliberationPrompt({
        soul,
        seat: seatContext,
        topic: 'Evaluate SQLite WAL vs Postgres',
        round: 2,
        maxRounds: 3,
        clarifications: [{ batch: 1, answer: 'Workload is single-machine local runner.' }],
        previousCandidate: {
          round: 1,
          summary: 'Tentative recommendation for Postgres',
          clauses: [{ context: 'Single-node', conclusion: 'Postgres handles concurrency well', citedProofIds: ['P1'] }]
        },
        openObjections: [
          { id: 'O1', seatId: 'sol-speed', proofId: 'P2', reason: 'Postgres daemon violates zero-daemon requirement' }
        ]
      });

      assert.match(prompt, /Deliberation Round 2\/3 — Proof Submission/);
      assert.match(prompt, /Evaluate SQLite WAL vs Postgres/);
      assert.match(prompt, /Workload is single-machine local runner/);
      assert.match(prompt, /Tentative recommendation for Postgres/);
      assert.match(prompt, /Postgres daemon violates zero-daemon requirement/);
      assert.match(prompt, /OUTPUT CONTRACT \(strict JSON\):/);
      assert.match(prompt, /"kind": "check" \| "citation" \| "benchmark" \| "derivation"/);
    });

    it('formatVotingPrompt injects candidate clauses, admitted proofs, and voting choices', () => {
      const candidate = {
        round: 1,
        summary: 'Adopt SQLite in WAL mode',
        clauses: [
          { context: 'Single machine execution', conclusion: 'Zero background daemon setup', citedProofIds: ['P1', 'P2'] }
        ]
      };
      const admittedProofs = [
        { id: 'P1', kind: 'check', scope: 'Single-node CLI', statement: 'SQLite needs no server process', source: 'sqlite.org docs' },
        { id: 'P2', kind: 'benchmark', scope: 'Concurrency', statement: 'WAL sustains >5k tx/s', source: 'wal-bench check' }
      ];

      const prompt = formatVotingPrompt({
        soul,
        seat: seatContext,
        candidate,
        admittedProofs
      });

      assert.match(prompt, /Voting on Round 1 Candidate/);
      assert.match(prompt, /Adopt SQLite in WAL mode/);
      assert.match(prompt, /Clause C1 \[Single machine execution\]/);
      assert.match(prompt, /\[P1\] \(check\) \[Single-node CLI\]/);
      assert.match(prompt, /\[P2\] \(benchmark\) \[Concurrency\]/);
      assert.match(prompt, /\{ "vote": "accept" \}/);
      assert.match(prompt, /\{ "vote": "object", "proofId": "<Admitted Proof ID>", "reason": "<Concrete reason why candidate is defective>" \}/);
    });

    it('formatJudgePrompt formats structured prompt with all round proof IDs', () => {
      const prompt = formatJudgePrompt({
        judge: { id: 'judge-1', soul: 'Audit' },
        topic: 'Test Topic',
        round: 1,
        proofs: [{ id: 'P1', scope: 'Cloud', statement: 'Statement', source: 'Source' }]
      });
      assert.match(prompt, /P1/);
      assert.match(prompt, /proofDecisions/);
      assert.match(prompt, /citedProofIds/);
    });

    it('formatJudgePrompt handles empty proofs gracefully', () => {
      const prompt = formatJudgePrompt({
        judge: { id: 'judge-1', soul: 'Audit' },
        topic: 'Test Topic',
        round: 1,
        proofs: []
      });
      assert.match(prompt, /No proofs submitted for auditing/);
      assert.match(prompt, /proofDecisions/);
    });

    it('formatVotingPrompt handles candidate clauses with empty summary', () => {
      const prompt = formatVotingPrompt({
        soul: 'Tester',
        seat: seatContext,
        candidate: { round: 1, summary: '', clauses: [{ context: 'C', conclusion: 'V', citedProofIds: ['P1'] }] },
        admittedProofs: [{ id: 'P1', kind: 'check', scope: 'S', source: 'Src', statement: 'Stmt' }]
      });
      assert.match(prompt, /Candidate Summary: ""/);
      assert.match(prompt, /Clause C1 \[C\]: V/);
      assert.match(prompt, /P1/);
    });

    it('renders state.evidence ([E1] <label> (Source: <source>): <text>) and state.clarifications in formatDeliberationPrompt, formatVotingPrompt, and formatJudgePrompt (Issue #23)', () => {
      const stateWithEvidence = {
        topic: 'Local Service Architecture',
        round: 1,
        maxRounds: 3,
        evidence: [
          {
            id: 'E1',
            label: 'Local Endpoint Snapshot',
            source: 'http://127.0.0.1:8790/status',
            text: 'healthy=true active_workers=8'
          }
        ],
        clarifications: [
          { batch: 1, answer: 'Must run offline without external cloud dependencies.' }
        ],
        candidate: {
          round: 1,
          summary: 'Candidate summary',
          clauses: [{ id: 'C1', context: 'Local', conclusion: 'Use worker pool', citedProofIds: ['P1'] }]
        },
        proofs: [
          { id: 'P1', round: 1, seatId: 'astra-kernel', kind: 'check', scope: 'Local', source: 'http://127.0.0.1:8790/status', statement: '8 workers active', status: 'admitted' }
        ],
        objections: []
      };

      const delibPrompt = formatDeliberationPrompt({
        soul,
        seat: seatContext,
        state: stateWithEvidence
      });
      const votePrompt = formatVotingPrompt({
        soul,
        seat: seatContext,
        state: stateWithEvidence
      });
      const judgePrompt = formatJudgePrompt({
        judge: { id: 'judge-1', soul: 'Auditor' },
        round: 1,
        proofs: stateWithEvidence.proofs,
        state: stateWithEvidence
      });

      for (const p of [delibPrompt, votePrompt, judgePrompt]) {
        assert.match(p, /\[E1\] Local Endpoint Snapshot \(Source: http:\/\/127\.0\.0\.1:8790\/status\): healthy=true active_workers=8/);
        assert.match(p, /Must run offline without external cloud dependencies\./);
      }
    });

    it('enforces STRICT ANTI-CHEATING RULE and scopes TOOL USAGE & VERIFICATION DIRECTIVE with and without evidence (Issue #63)', async () => {
      const { ANTI_CHEATING_RULE } = await import('../../src/seats/soul.js');
      assert.match(ANTI_CHEATING_RULE, /STRICT ANTI-CHEATING RULE: Never read, grep, or inspect "\.council\/"/);

      const sysPrompt = formatSoulSystemPrompt(soul, seatContext);
      const delibNoEv = formatDeliberationPrompt({
        soul,
        seat: seatContext,
        topic: 'What is the best smartphone under R$ 1000 in Brazil?'
      });
      const voteNoEv = formatVotingPrompt({
        soul,
        seat: seatContext,
        candidate: { round: 1, summary: 'Candidate', clauses: [] },
        admittedProofs: []
      });
      const judgeNoEv = formatJudgePrompt({
        judge: { id: 'judge-1', soul: 'Auditor' },
        topic: 'What is the best smartphone under R$ 1000 in Brazil?',
        round: 1,
        proofs: []
      });

      for (const p of [sysPrompt, delibNoEv, voteNoEv, judgeNoEv]) {
        assert.ok(p.includes(ANTI_CHEATING_RULE), 'Every prompt must include ANTI_CHEATING_RULE');
      }

      for (const p of [delibNoEv, voteNoEv]) {
        assert.match(p, /TOOL USAGE & VERIFICATION DIRECTIVE:/);
      }
      assert.match(judgeNoEv, /4\. Spot-check proof sources:/);

      for (const p of [delibNoEv, voteNoEv, judgeNoEv]) {
        assert.match(
          p,
          /only for topics that explicitly concern files in the target workspace—never for searching The Council's own engine source code/
        );
      }

      const evidenceList = [
        {
          id: 'E1',
          label: 'Retail Prices',
          source: 'Anatel 2026',
          text: 'Moto G34 5G is R$ 899'
        }
      ];

      const delibWithEv = formatDeliberationPrompt({
        soul,
        seat: seatContext,
        topic: 'What is the best smartphone under R$ 1000 in Brazil?',
        evidence: evidenceList
      });
      const voteWithEv = formatVotingPrompt({
        soul,
        seat: seatContext,
        candidate: { round: 1, summary: 'Candidate', clauses: [] },
        admittedProofs: [],
        evidence: evidenceList
      });
      const judgeWithEv = formatJudgePrompt({
        judge: { id: 'judge-1', soul: 'Auditor' },
        topic: 'What is the best smartphone under R$ 1000 in Brazil?',
        round: 1,
        proofs: [],
        evidence: evidenceList
      });

      for (const p of [delibWithEv, voteWithEv, judgeWithEv]) {
        assert.ok(p.includes(ANTI_CHEATING_RULE));
        assert.match(p, /Pre-Gathered Baseline Evidence \(Attributed & Challengeable\) is provided above/);
        assert.match(p, /avoid speculative local filesystem grepping unless the topic explicitly names local repository files/);
      }

      // Even when tools='none', ANTI_CHEATING_RULE remains present while TOOL USAGE directive is omitted
      const delibToolsNone = formatDeliberationPrompt({
        soul,
        seat: { ...seatContext, tools: 'none' },
        topic: 'General topic'
      });
      assert.ok(delibToolsNone.includes(ANTI_CHEATING_RULE));
      assert.ok(!delibToolsNone.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));

      // Issue #63 follow-up: ANTI_CHEATING_RULE names all Council artifact patterns explicitly
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
          `Expected ANTI_CHEATING_RULE to explicitly mention ${token}`
        );
      }

      // Issue #63 follow-up: Without cwd (!hasWorkspaceCwd), prompts explicitly forbid local filesystem search/grep/find commands
      for (const p of [delibNoEv, voteNoEv, judgeNoEv]) {
        assert.match(
          p,
          /No local code workspace is attached \(running in an isolated sandbox directory\); do NOT run local filesystem search\/grep\/find commands \(rg, grep, find, ls\) to search a codebase\./
        );
      }

      // When workspace cwd IS attached (via seat.cwd, judge.cwd, state.cwd, or cwd), emit workspace verification directive
      const delibWithCwd = formatDeliberationPrompt({
        soul,
        seat: { ...seatContext, cwd: '/Users/aaat/projects/target-repo' },
        topic: 'Audit target-repo'
      });
      const voteWithCwd = formatVotingPrompt({
        soul,
        seat: seatContext,
        candidate: { round: 1, summary: 'Candidate', clauses: [] },
        admittedProofs: [],
        state: { cwd: '/Users/aaat/projects/target-repo' }
      });
      const judgeWithCwd = formatJudgePrompt({
        judge: { id: 'judge-1', soul: 'Auditor', cwd: '/Users/aaat/projects/target-repo' },
        topic: 'Audit target-repo',
        round: 1,
        proofs: []
      });

      for (const p of [delibWithCwd, voteWithCwd, judgeWithCwd]) {
        assert.ok(
          !p.includes('No local code workspace is attached'),
          'Workspace-attached prompts must not claim no local workspace is attached'
        );
      }
      assert.match(delibWithCwd, /verify claims against sources \(specifications, benchmarks, codebase, or documentation\)/);
      assert.match(voteWithCwd, /Verify disputed candidate clauses or cited proof sources using your read-only tools/);
      assert.match(judgeWithCwd, /Spot-check submitted proof sources and citations using your read-only tools/);
    });
  });

  describe('Milestone M6 / Issue #70 & #73: Evidence Reframing, Host Path Probing Guard & Answer-First Synthesis', () => {
    const seatContext = {
      id: 'astra-systems',
      harness: 'codex',
      model: 'gpt-6-astra (max)'
    };
    const soul = STANDARD_SOULS.SYSTEMS_PURIST;
    const testEvidence = [
      {
        id: 'E1',
        label: 'Aviation Commission Record',
        source: 'Aéro-Club de France 1906 Report',
        text: '14-bis completed official 220-meter flight under commission observation.'
      }
    ];

    it('M6-SOUL-1: formatGroundingSection reframes evidence header to Pre-Gathered Baseline Evidence (Attributed & Challengeable)', () => {
      const section = formatGroundingSection(testEvidence, []);
      assert.match(section, /Pre-Gathered Baseline Evidence \(Attributed & Challengeable\):/);
      assert.doesNotMatch(section, /Pre-Gathered Grounding Evidence/);
      assert.doesNotMatch(section, /immutable ground-truth/i);
    });

    it('M6-SOUL-2: formatDeliberationPrompt instructs voters that baseline evidence is challengeable against primary sources', () => {
      const prompt = formatDeliberationPrompt({
        soul,
        seat: seatContext,
        topic: 'Who flew the first airplane?',
        evidence: testEvidence
      });
      assert.match(prompt, /Pre-Gathered Baseline Evidence \(Attributed & Challengeable\) is provided above/);
      assert.match(prompt, /shared baseline evidence so you do not need to re-fetch or re-read facts already excerpted/);
      assert.match(prompt, /items are auditable: if you can prove from a primary source or exact line citation that an \[E#\] summary is incomplete or imprecise/);
    });

    it('M6-SOUL-3: formatDeliberationPrompt strictly forbids host filesystem probing when !hasWorkspaceCwd', () => {
      const prompt = formatDeliberationPrompt({
        soul,
        seat: seatContext,
        topic: 'Examine /Users/aaat/projects/target/file.js for bugs'
        // cwd is intentionally omitted
      });
      assert.match(prompt, /No local code workspace is attached \(running in an isolated sandbox directory\); do NOT run local filesystem search\/grep\/find commands \(rg, grep, find, ls\) to search a codebase\./);
      assert.match(prompt, /do NOT run local filesystem tools \(cat, readToolCall, view_file\)/);
      assert.match(prompt, /do NOT read or probe absolute host file paths mentioned in the topic or evidence packet/);
      assert.match(prompt, /verify claims against sources \(Pre-Gathered Baseline Evidence packet, authoritative specifications, benchmarks, web search/);
    });

    it('M6-SOUL-4: formatDeliberationPrompt bounds repo reads to 3-5 targeted reads and forbids duplicate reads when hasWorkspaceCwd and evidence is present', () => {
      const prompt = formatDeliberationPrompt({
        soul,
        seat: seatContext,
        topic: 'Audit target repo',
        cwd: '/Users/aaat/projects/target-repo',
        evidence: testEvidence
      });
      assert.doesNotMatch(prompt, /No local code workspace is attached/);
      assert.match(prompt, /Do NOT re-read or duplicate inspection of files already excerpted in \[E#\]/);
      assert.match(prompt, /Cap any local file reads to targeted verification of claims not already covered by \[E1\]–\[E1\] \(at most 3–5 targeted reads\)/);
    });

    it('M6-SOUL-5: formatJudgePrompt enforces answer-first candidate.summary free of internal proof IDs or audit process commentary', () => {
      const prompt = formatJudgePrompt({
        judge: { id: 'judge-opus', model: 'claude-opus-5-5-high' },
        topic: 'Who invented the airplane?',
        round: 1,
        proofs: [{ id: 'P1', statement: 'Statement', source: 'Source' }]
      });
      assert.match(prompt, /candidate\.summary \("summary"\) MUST be a standalone, direct, user-facing executive synthesis/);
      assert.match(prompt, /MUST NOT contain internal proof IDs \(e\.g\. P1, P2, \[P1\]\) or audit process commentary/);
      assert.match(prompt, /All proof audit commentary belongs strictly in proofDecisions/);
      assert.match(prompt, /"summary": "<Direct, standalone, user-facing executive answer to the user's topic in clear prose — MUST NOT contain internal proof IDs like P1, P2 or audit process commentary>"/);
    });

    it('M6-SOUL-6: formatJudgePrompt instructs Judge to prefer partially_admitted over binary rejected for secondary baseline imprecisions', () => {
      const prompt = formatJudgePrompt({
        judge: { id: 'judge-opus', model: 'claude-opus-5-5-high' },
        topic: 'Who invented the airplane?',
        round: 1,
        proofs: [{ id: 'P1', statement: 'Statement', source: 'Source' }],
        evidence: testEvidence
      });
      assert.match(prompt, /When a seat relies on a supplied \[E#\] baseline item that turns out to have a minor secondary imprecision, prefer partially_admitted/);
      assert.match(prompt, /excising or qualifying the imprecise phrase via admittedStatement \/ note.*rather than binary rejected if the proof's core argument remains valid/);
    });

    it('M6-SOUL-7: formatVotingPrompt strictly forbids host filesystem probing when !hasWorkspaceCwd', () => {
      const prompt = formatVotingPrompt({
        soul,
        seat: { ...seatContext, votingTools: 'read-only' },
        candidate: { round: 1, summary: 'Summary', clauses: [] },
        admittedProofs: []
        // cwd omitted
      });
      assert.match(prompt, /No local code workspace is attached \(running in an isolated sandbox directory\); do NOT run local filesystem search\/grep\/find commands \(rg, grep, find, ls\) to search a codebase\./);
      assert.match(prompt, /do NOT run local filesystem tools \(cat, readToolCall, view_file\)/);
      assert.match(prompt, /do NOT read or probe absolute host file paths mentioned in the topic or evidence packet/);
    });

    it('M6-SOUL-8: formatVotingPrompt surfaces partially_admitted proofs with [PARTIALLY ADMITTED], Admitted Core, and caveat note', () => {
      const prompt = formatVotingPrompt({
        soul,
        seat: seatContext,
        candidate: { round: 1, summary: 'Summary', clauses: [{ context: 'Flight', conclusion: '14-bis verified', citedProofIds: ['P1'] }] },
        state: {
          proofs: [
            {
              id: 'P1',
              status: 'partially_admitted',
              kind: 'citation',
              scope: 'Aviation',
              source: 'FAI Log 1906',
              statement: '14-bis flew 220m in calm air with zero wind.',
              judgeAdmittedStatement: '14-bis flew 220m under official commission observation.',
              judgeNote: 'Excised calm air secondary claim due to anemometer readings.'
            }
          ]
        }
      });
      assert.match(prompt, /\[P1\] \(citation\) \[Aviation\]: 14-bis flew 220m in calm air with zero wind\./);
      assert.match(prompt, /\[PARTIALLY ADMITTED: Excised calm air secondary claim due to anemometer readings\.\]/);
      assert.match(prompt, /\(Admitted Core: 14-bis flew 220m under official commission observation\.\)/);
      assert.match(
        prompt,
        /Proofs with status "partially_admitted" are valid citations for their narrowed Admitted Core and may be cited in "proofId"/
      );
    });
  });
});

