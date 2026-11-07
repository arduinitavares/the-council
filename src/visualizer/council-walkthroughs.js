/**
 * Guided Walkthrough Scenarios for The Council Prototype
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CouncilWalkthroughs = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WALKTHROUGHS = [
    {
      id: 'wt-better-os',
      title: 'Walkthrough 1: "What is the better OS?" (Context-Partitioned Consensus)',
      description: 'Four Seats across Codex and Antigravity (including two gpt-6-astra seats with contrasting Souls) debate operating systems. Watch the animated dependency arrows connect each Seat to its Proof, the Judge to each Proof-bound Candidate clause, and Seat 4\'s Round 1 Objection before Round 2 achieves Unanimous Consensus.',
      initialConfig: {
        topic: 'What is the better operating system? Provide a Proof-backed answer.',
        maxRounds: 3,
        minQuorum: 2,
        judge: {
          id: 'judge-astra-max',
          harness: 'codex',
          model: 'gpt-6-astra (max)',
          soul: 'Evidence-First Judge: rejects unqualified claims and synthesizes context-partitioned candidates citing admitted Proofs.'
        },
        seats: [
          { id: 'astra-kernel', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Systems & Kernel Purist: focuses on container density, cgroups v2, and headless uptime.' },
          { id: 'astra-gamer', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Desktop Gaming Enthusiast: focuses on DirectX 12, kernel anti-cheat, and frame pacing.' },
          { id: 'argon-unix', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Staff Mobile & Full-Stack Dev: focuses on POSIX shell, Xcode/iOS SDKs, and ARM efficiency.' },
          { id: 'opus-secops', harness: 'antigravity', model: 'claude-opus-5-5-high', soul: 'Enterprise SecOps Auditor: demands reproducible immutable builds and fleet compliance.' }
        ]
      },
      steps: [
        {
          label: '1. Start Clarification Batch 1',
          event: { type: 'START_CLARIFYING' }
        },
        {
          label: '2. Broadcast Shared Answer (Server / Gaming / Dev Workstations)',
          event: { type: 'PUBLISH_CLARIFICATION', answer: 'Evaluate across three target workloads: Production Servers, Desktop Gaming, and Developer Workstations.' }
        },
        {
          label: '3. Begin Deliberation Round 1',
          event: { type: 'BEGIN_ROUND' }
        },
        {
          label: '4. Seat 1 (astra-kernel) Submits Proof P1 (Server)',
          event: {
            type: 'SUBMIT_PROOF',
            id: 'P1',
            seatId: 'astra-kernel',
            scope: 'Production Cloud & Container Servers',
            kind: 'citation',
            source: 'Linux kernel namespaces/cgroups v2 spec',
            statement: 'Linux is superior for servers because OCI containers natively require Linux kernel namespaces and cgroups without hypervisor overhead.'
          }
        },
        {
          label: '5. Seat 2 (astra-gamer — same model, different Soul) Submits Proof P2 (Gaming)',
          event: {
            type: 'SUBMIT_PROOF',
            id: 'P2',
            seatId: 'astra-gamer',
            scope: 'AAA Desktop PC Gaming',
            kind: 'benchmark',
            source: 'Steam Hardware Survey (96%+ Windows) & anti-cheat matrix',
            statement: 'Windows 11 leads AAA PC gaming due to native DirectX 12 Ultimate and mandatory kernel-mode anti-cheat support.'
          }
        },
        {
          label: '6. Seat 3 (argon-unix) Submits Proof P3 (Workstation)',
          event: {
            type: 'SUBMIT_PROOF',
            id: 'P3',
            seatId: 'argon-unix',
            scope: 'Cross-Platform & Mobile Dev Workstations',
            kind: 'check',
            source: 'UNIX single-spec certification + iOS/macOS toolchain check',
            statement: 'macOS on Apple Silicon uniquely compiles native iOS/macOS targets while running a certified UNIX userland.'
          }
        },
        {
          label: '7. Send Round 1 Proofs to Judge',
          event: { type: 'START_JUDGING' }
        },
        {
          label: '8. Judge Audits P1–P3 & Synthesizes Partitioned Candidate (Clauses C1–C3)',
          event: {
            type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
            summary: 'No single OS wins universally; the proven choice depends on workload:',
            proofDecisions: {
              P1: { status: 'admitted', note: 'Verified OCI kernel dependency.' },
              P2: { status: 'admitted', note: 'Verified DX12 and anti-cheat requirement.' },
              P3: { status: 'admitted', note: 'Verified UNIX + iOS build constraint.' }
            },
            clauses: [
              { context: 'Production Cloud & Container Servers', conclusion: 'Linux wins due to native namespaces and cgroups.', citedProofIds: ['P1'] },
              { context: 'AAA Desktop PC Gaming', conclusion: 'Windows wins due to DirectX 12 and kernel anti-cheat compatibility.', citedProofIds: ['P2'] },
              { context: 'Mobile & UNIX Dev Workstations', conclusion: 'macOS wins when combined UNIX and iOS/macOS SDKs are required.', citedProofIds: ['P3'] }
            ]
          }
        },
        {
          label: '9. Seats 1–3 Accept, Seat 4 (opus-secops) Submits P4 & Raises Objection O1',
          multiEvents: [
            { type: 'CAST_VOTE', seatId: 'astra-kernel', vote: 'accept' },
            { type: 'CAST_VOTE', seatId: 'astra-gamer', vote: 'accept' },
            { type: 'CAST_VOTE', seatId: 'argon-unix', vote: 'accept' },
            {
              type: 'SUBMIT_PROOF',
              id: 'P4',
              seatId: 'opus-secops',
              scope: 'High-Assurance Reproducible Servers',
              kind: 'derivation',
              source: 'Declarative immutable OS derivation (NixOS / Flatcar)',
              statement: 'Mutable Linux distros suffer configuration drift; high-assurance servers require declarative/immutable Linux.'
            },
            {
              type: 'CAST_VOTE',
              seatId: 'opus-secops',
              vote: 'object',
              proofId: 'P4',
              reason: 'Clause C1 must distinguish mutable Linux distributions from declarative/immutable server Linux.'
            }
          ]
        },
        {
          label: '10. Evaluate Round 1 → Advances to Round 2 (O1 Blocks Consensus)',
          event: { type: 'EVALUATE_ROUND' }
        },
        {
          label: '11. Judge Synthesizes Round 2 Candidate Citing P1 + P4 on Clause C1',
          multiEvents: [
            { type: 'START_JUDGING' },
            {
              type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
              summary: 'Workload-partitioned OS recommendation incorporating immutable server Linux:',
              proofDecisions: {
                P4: { status: 'admitted', note: 'Admitted declarative server distinction.' }
              },
              clauses: [
                { context: 'Production Servers (General & High-Assurance)', conclusion: 'Linux wins for servers (P1), using declarative/immutable Linux where zero drift is required (P4).', citedProofIds: ['P1', 'P4'] },
                { context: 'AAA Desktop PC Gaming', conclusion: 'Windows wins for native DirectX 12 and kernel anti-cheat support (P2).', citedProofIds: ['P2'] },
                { context: 'Mobile & UNIX Dev Workstations', conclusion: 'macOS wins when combined UNIX + Apple SDKs are required (P3).', citedProofIds: ['P3'] }
              ]
            }
          ]
        },
        {
          label: '12. All 4 Seats Vote Accept (O1 Withdrawn) → Unanimous Consensus!',
          multiEvents: [
            { type: 'CAST_VOTE', seatId: 'astra-kernel', vote: 'accept' },
            { type: 'CAST_VOTE', seatId: 'astra-gamer', vote: 'accept' },
            { type: 'CAST_VOTE', seatId: 'argon-unix', vote: 'accept' },
            { type: 'CAST_VOTE', seatId: 'opus-secops', vote: 'accept' },
            { type: 'EVALUATE_ROUND' }
          ]
        }
      ]
    },
    {
      id: 'wt-10-seats-quota',
      title: 'Walkthrough 2: 10-Seat Multi-Harness Roster + Quota Fault ("Dude is Off")',
      description: 'Ten dynamic Seats across Codex (5), Antigravity (2), and Cursor (3). Seat #8 (grok-4.7-contrarian on Cursor) hits its weekly quota limit, retries once, hits quota again, and is Excused without losing the other 9 Seats\' completed turns.',
      initialConfig: {
        topic: 'Should our local Council runner persist state in SQLite WAL or PostgreSQL?',
        maxRounds: 3,
        minQuorum: 2,
        maxRetriesPerSeat: 1,
        judge: {
          id: 'judge-argon-high',
          harness: 'antigravity',
          model: 'gemini-4-argon-high',
          soul: 'Strict Systems Judge: demands concrete storage and concurrency proofs.'
        },
        seats: [
          { id: 'sol-arch', harness: 'codex', model: 'gpt-6.1-sol (max)', soul: 'Pragmatic Architect: favors zero-daemon local simplicity.' },
          { id: 'sol-conc', harness: 'codex', model: 'gpt-6.1-sol (max)', soul: 'Concurrency Specialist: checks write-lock contention.' },
          { id: 'astra-sre', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Production SRE: checks crash recovery and fsync.' },
          { id: 'astra-min', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Minimalist: rejects external daemon dependencies.' },
          { id: 'astra-sec', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'Security Auditor: checks local file permissions.' },
          { id: 'argon-perf', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Latency Analyst: checks local IPC vs socket overhead.' },
          { id: 'opus-domain', harness: 'antigravity', model: 'claude-opus-5-5-high', soul: 'Domain Modeler: checks transactional event-log invariants.' },
          { id: 'grok-contrarian', harness: 'cursor', model: 'grok-4.7-high', soul: 'Contrarian Stress-Tester: tries to break SQLite concurrency.' },
          { id: 'grok-dx', harness: 'cursor', model: 'grok-4.7-xhigh', soul: 'DX Advocate: demands zero-setup clone-and-run.' },
          { id: 'composer-bench', harness: 'cursor', model: 'composer-2.5', soul: 'Benchmark Engineer: measures round-trip transaction times.' }
        ]
      },
      steps: [
        {
          label: '1. Begin Round 1 Across All 10 Seats',
          event: { type: 'BEGIN_ROUND' }
        },
        {
          label: '2. 9 Seats Submit Proofs for SQLite WAL',
          multiEvents: [
            { type: 'SUBMIT_PROOF', id: 'P1', seatId: 'sol-arch', scope: 'Single-machine CLI runner', kind: 'check', source: 'node:sqlite zero-daemon startup check', statement: 'SQLite WAL requires zero background server installation.' },
            { type: 'SUBMIT_PROOF', id: 'P2', seatId: 'sol-conc', scope: 'Up to 20 parallel Seats', kind: 'benchmark', source: 'SQLite WAL busy_timeout=5000ms + serialized writer queue', statement: 'Serialized coordinator writes sustain >5,000 tx/sec without SQLITE_BUSY.' },
            { type: 'SEAT_TELEMETRY', seatId: 'astra-sre', status: 'proof_submitted' },
            { type: 'SEAT_TELEMETRY', seatId: 'astra-min', status: 'proof_submitted' },
            { type: 'SEAT_TELEMETRY', seatId: 'astra-sec', status: 'proof_submitted' },
            { type: 'SEAT_TELEMETRY', seatId: 'argon-perf', status: 'proof_submitted' },
            { type: 'SEAT_TELEMETRY', seatId: 'opus-domain', status: 'proof_submitted' },
            { type: 'SEAT_TELEMETRY', seatId: 'grok-dx', status: 'proof_submitted' },
            { type: 'SEAT_TELEMETRY', seatId: 'composer-bench', status: 'proof_submitted' }
          ]
        },
        {
          label: '3. Seat #8 (grok-contrarian on Cursor) Hits Weekly Quota → SEAT_FAULT',
          event: { type: 'SEAT_FAULT', seatId: 'grok-contrarian', reason: 'Cursor weekly included pool exhausted (HTTP 429)' }
        },
        {
          label: '4. Retry Seat #8 Once (1/1 Retry Allowed)',
          event: { type: 'RETRY_SEAT', seatId: 'grok-contrarian' }
        },
        {
          label: '5. Seat #8 Hits Quota Again → Second Retry Blocked by Guard',
          multiEvents: [
            { type: 'SEAT_FAULT', seatId: 'grok-contrarian', reason: 'Cursor weekly pool still exhausted' },
            { type: 'RETRY_SEAT', seatId: 'grok-contrarian' }
          ]
        },
        {
          label: '6. Excuse Seat #8 ("Quota is reached, dude is off")',
          event: { type: 'EXCUSE_SEAT', seatId: 'grok-contrarian', reason: 'Quota exhausted after 1 retry; excused.' }
        },
        {
          label: '7. Judge Synthesizes Candidate & Remaining 9 Active Seats Vote Accept → Consensus!',
          multiEvents: [
            { type: 'START_JUDGING' },
            {
              type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
              summary: 'Use SQLite in WAL mode with a coordinator-serialized writer.',
              clauses: [
                { context: 'Local-first single-machine Council runs', conclusion: 'SQLite WAL provides zero-daemon setup (P1) and lock-free serialized writes (P2).', citedProofIds: ['P1', 'P2'] }
              ]
            },
            { type: 'CAST_VOTE', seatId: 'sol-arch', vote: 'accept' },
            { type: 'CAST_VOTE', seatId: 'sol-conc', vote: 'accept' },
            { type: 'CAST_VOTE', seatId: 'astra-sre', vote: 'accept' },
            { type: 'CAST_VOTE', seatId: 'astra-min', vote: 'accept' },
            { type: 'CAST_VOTE', seatId: 'astra-sec', vote: 'accept' },
            { type: 'CAST_VOTE', seatId: 'argon-perf', vote: 'accept' },
            { type: 'CAST_VOTE', seatId: 'opus-domain', vote: 'accept' },
            { type: 'CAST_VOTE', seatId: 'grok-dx', vote: 'accept' },
            { type: 'CAST_VOTE', seatId: 'composer-bench', vote: 'accept' },
            { type: 'EVALUATE_ROUND' }
          ]
        }
      ]
    },
    {
      id: 'wt-opus-guardrails',
      title: 'Walkthrough 3: Opus 5.5 Guardrails & Excused-Seat Objection Loophole',
      description: 'Verifies that (1) bare opinions without a source are blocked, (2) a Judge cannot smuggle unverified claims into the Candidate, (3) Seat A cannot withdraw Seat B\'s Objection, and (4) excusing a Seat that holds an open Objection locks that Objection so token exhaustion never manufactures fake Consensus.',
      initialConfig: {
        topic: 'Can we auto-merge PRs without running the integration suite?',
        maxRounds: 3,
        minQuorum: 2,
        judge: {
          id: 'judge-opus-5-5',
          harness: 'antigravity',
          model: 'claude-opus-5-5-high',
          soul: 'Strict Verification Judge'
        },
        seats: [
          { id: 'sol-speed', harness: 'codex', model: 'gpt-6.1-sol (max)', soul: 'Velocity Builder: wants fast merges.' },
          { id: 'argon-safety', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Release Engineer: checks CI gates.' },
          { id: 'opus-auditor', harness: 'antigravity', model: 'claude-opus-5-5-high', soul: 'Invariant Auditor: checks regression history.' }
        ]
      },
      steps: [
        {
          label: '1. Begin Round 1',
          event: { type: 'BEGIN_ROUND' }
        },
        {
          label: '2. [ILLEGAL] Bare Opinion Without Source → Blocked by Structural Guard',
          event: {
            type: 'SUBMIT_PROOF',
            id: 'P_BAD',
            seatId: 'sol-speed',
            scope: 'All PRs',
            kind: 'citation',
            source: '',
            statement: 'Unit tests feel fast and sufficient.'
          }
        },
        {
          label: '3. Submit Valid Proofs P1 & P2 and Enter Judging',
          multiEvents: [
            {
              type: 'SUBMIT_PROOF',
              id: 'P1',
              seatId: 'sol-speed',
              scope: 'Docs-only PRs (*.md)',
              kind: 'check',
              source: 'git diff --name-only *.md check',
              statement: 'Markdown-only changes cannot alter runtime code paths.'
            },
            {
              type: 'SUBMIT_PROOF',
              id: 'P2',
              seatId: 'opus-auditor',
              scope: 'Code & Schema PRs',
              kind: 'citation',
              source: 'Incident Postmortem #14',
              statement: 'Unit mocks missed 3 schema regressions caught only by integration tests.'
            },
            { type: 'START_JUDGING' }
          ]
        },
        {
          label: '4. [ILLEGAL] Judge Tries to Cite Non-Admitted Proof → Blocked by Proof-Binding Guard',
          event: {
            type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
            summary: 'Smuggled Judge opinion:',
            clauses: [
              { context: 'All PRs', conclusion: 'Skip all tests on Fridays.', citedProofIds: ['P_FAKE'] }
            ]
          }
        },
        {
          label: '5. Judge Synthesizes Valid Candidate; opus-auditor Raises Objection O1 (Backed by P2)',
          multiEvents: [
            {
              type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
              summary: 'Skip integration tests for docs PRs; run subset for code PRs.',
              clauses: [
                { context: 'Docs-only PRs', conclusion: 'Merge after markdown lint (P1).', citedProofIds: ['P1'] },
                { context: 'Code PRs', conclusion: 'Run integration subset before merge (P2).', citedProofIds: ['P2'] }
              ]
            },
            { type: 'CAST_VOTE', seatId: 'sol-speed', vote: 'accept' },
            { type: 'CAST_VOTE', seatId: 'argon-safety', vote: 'accept' },
            {
              type: 'CAST_VOTE',
              seatId: 'opus-auditor',
              vote: 'object',
              proofId: 'P2',
              reason: 'Summary still permits a "subset" for code PRs; P2 proves full migration integration suite is required.'
            }
          ]
        },
        {
          label: '6. [ILLEGAL] sol-speed Tries to Withdraw opus-auditor\'s Objection O1 → Blocked',
          event: { type: 'WITHDRAW_OBJECTION', objectionId: 'O1', seatId: 'sol-speed' }
        },
        {
          label: '7. opus-auditor Hits Quota & Is Excused → O1 Locked as preserved_excused',
          multiEvents: [
            { type: 'SEAT_FAULT', seatId: 'opus-auditor', reason: 'Claude quota window exhausted' },
            { type: 'EXCUSE_SEAT', seatId: 'opus-auditor', reason: 'Quota exhausted while holding open Objection O1' }
          ]
        },
        {
          label: '8. Evaluate Round → Blocks Fake Consensus & Emits Dissent Report Preserving O1!',
          event: { type: 'EVALUATE_ROUND' }
        }
      ]
    }
  ];

  return { WALKTHROUGHS: WALKTHROUGHS };
});
