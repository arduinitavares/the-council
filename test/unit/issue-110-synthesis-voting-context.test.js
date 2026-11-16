import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANTI_CHEATING_RULE,
  STANDARD_SOULS,
  getSubstantiveJudgeNote,
  formatDeliberationPrompt,
  formatVotingPrompt,
  formatJudgePrompt
} from '../../src/seats/soul.js';
import { normalizeProofDecision } from '../../src/machine/guards.js';
import { createInitialCouncilState } from '../../src/machine/state.js';
import { transitionCouncil } from '../../src/machine/reducer.js';
import { CouncilEngine } from '../../src/engine/council-engine.js';
import { QuotaExhaustionError } from '../../src/harness/adapter.js';
import { AntigravityAdapter } from '../../src/harness/antigravity.js';
import { CodexAdapter } from '../../src/harness/codex.js';
import { CursorAdapter } from '../../src/harness/cursor.js';
import { MockAdapter } from '../../src/harness/mock.js';

describe('Issue #110: Synthesis, Deliberation & Voting Prompt Context Preservation', () => {
  describe('1. getSubstantiveJudgeNote helper', () => {
    it('excludes empty, whitespace, and default_admitted boilerplate on admitted proofs while preserving substantive notes', () => {
      assert.equal(getSubstantiveJudgeNote(null), '');
      assert.equal(getSubstantiveJudgeNote(undefined), '');
      assert.equal(getSubstantiveJudgeNote({ status: 'admitted', judgeNote: '' }), '');
      assert.equal(getSubstantiveJudgeNote({ status: 'admitted', judgeNote: '   \n\t  ' }), '');
      assert.equal(
        getSubstantiveJudgeNote({
          status: 'admitted',
          admissionKind: 'default_admitted',
          judgeNote: 'Admitted by Judge.'
        }),
        ''
      );
      assert.equal(
        getSubstantiveJudgeNote({
          status: 'admitted',
          judgeNote: '  Admitted by Judge.  '
        }),
        ''
      );
      assert.equal(
        getSubstantiveJudgeNote({
          status: 'admitted',
          admissionKind: 'explicitly_admitted',
          judgeNote: '  Verified only under Linux kernel >= 6.8 with cgroups v2.  '
        }),
        'Verified only under Linux kernel >= 6.8 with cgroups v2.'
      );
    });

    it('always preserves any non-empty trimmed judgeNote on partially_admitted proofs', () => {
      assert.equal(
        getSubstantiveJudgeNote({
          status: 'partially_admitted',
          judgeNote: '  Caveat: holds only for single-region deployments.  '
        }),
        'Caveat: holds only for single-region deployments.'
      );
      assert.equal(
        getSubstantiveJudgeNote({
          status: 'partially_admitted',
          judgeNote: 'Admitted by Judge.'
        }),
        'Admitted by Judge.'
      );
      assert.equal(
        getSubstantiveJudgeNote({
          status: 'partially_admitted',
          judgeNote: '   '
        }),
        ''
      );
    });
  });

  describe('2. Round 2+ formatJudgePrompt() prior proof caveats and synthesis consistency directives', () => {
    it('preserves judgeAdmittedStatement, note-only partial admission caveats, and substantive admitted judgeNotes while suppressing default boilerplate', () => {
      const noteOnlyDecision = normalizeProofDecision(
        {
          status: 'partially_admitted',
          note: 'Applies only when fsync is enabled on every commit'
        },
        { id: 'P2', status: 'pending' },
        'P2'
      );
      assert.equal(noteOnlyDecision.ok, true);
      assert.equal(noteOnlyDecision.status, 'partially_admitted');
      assert.equal(noteOnlyDecision.judgeAdmittedStatement, null);

      const state = {
        topic: 'Design durable WAL storage layout',
        round: 2,
        maxRounds: 3,
        candidate: {
          round: 1,
          summary: 'Round 1 candidate summary',
          clauses: [
            { id: 'C1', context: 'Storage', conclusion: 'Use sequential WAL', citedProofIds: ['P1', 'P2', 'P3'] }
          ]
        },
        objections: [
          {
            id: 'O1',
            round: 1,
            seatId: 'seat-1',
            proofId: 'P2',
            reason: 'fsync caveat missing from Candidate Summary',
            status: 'open'
          }
        ],
        proofs: [
          {
            id: 'P1',
            round: 1,
            seatId: 'seat-1',
            kind: 'benchmark',
            scope: 'NVMe Write Path',
            statement: 'Unbounded async writes achieve 100k ops/sec across all configs.',
            judgeAdmittedStatement: 'Async writes achieve 100k ops/sec only on NVMe RAID-0.',
            judgeNote: 'Narrowed to NVMe RAID-0; excludes durability guarantee.',
            status: 'partially_admitted',
            source: 'fio-bench.json'
          },
          {
            id: 'P2',
            round: 1,
            seatId: 'seat-2',
            kind: 'check',
            scope: 'Durability',
            statement: 'Sequential WAL prevents torn page writes.',
            judgeAdmittedStatement: noteOnlyDecision.judgeAdmittedStatement,
            judgeNote: noteOnlyDecision.judgeNote,
            status: noteOnlyDecision.status,
            source: 'wal-spec.md'
          },
          {
            id: 'P3',
            round: 1,
            seatId: 'seat-1',
            kind: 'citation',
            scope: 'POSIX',
            statement: 'O_DSYNC flushes dirty file data and required metadata.',
            judgeNote: 'Verified against POSIX.1-2017; metadata beyond file size may be deferred.',
            status: 'admitted',
            source: 'POSIX.1-2017'
          },
          {
            id: 'P4',
            round: 1,
            seatId: 'seat-2',
            kind: 'check',
            scope: 'General',
            statement: 'Default admitted baseline fact.',
            admissionKind: 'default_admitted',
            judgeNote: 'Admitted by Judge.',
            status: 'admitted',
            source: 'baseline-doc'
          }
        ]
      };

      const prompt = formatJudgePrompt({
        judge: { id: 'judge-1', model: 'claude-opus-5-5-high', soul: STANDARD_SOULS.IMPARTIAL_JUDGE },
        topic: state.topic,
        round: 2,
        maxRounds: 3,
        proofs: [
          {
            id: 'P5',
            round: 2,
            seatId: 'seat-1',
            kind: 'derivation',
            scope: 'Sync Policy',
            statement: 'Group commit with fsync bounds p99 latency.',
            source: 'commit-model'
          }
        ],
        state,
        tools: 'read-only'
      });

      assert.match(
        prompt,
        /- \[P1\] \[PARTIALLY ADMITTED: Narrowed to NVMe RAID-0; excludes durability guarantee\.\] \(Round 1, Seat "seat-1", benchmark\) \[NVMe Write Path\]: Async writes achieve 100k ops\/sec only on NVMe RAID-0\. \(source: fio-bench\.json\)/
      );
      assert.match(
        prompt,
        /- \[P2\] \[PARTIALLY ADMITTED: Applies only when fsync is enabled on every commit\] \(Round 1, Seat "seat-2", check\) \[Durability\]: Sequential WAL prevents torn page writes\. \(Caveat — narrowed by Judge Note: Applies only when fsync is enabled on every commit\) \(source: wal-spec\.md\)/
      );
      assert.match(
        prompt,
        /- \[P3\] \[ADMITTED\] \(Round 1, Seat "seat-1", citation\) \[POSIX\]: O_DSYNC flushes dirty file data and required metadata\. \[Judge Note: Verified against POSIX\.1-2017; metadata beyond file size may be deferred\.\] \(source: POSIX\.1-2017\)/
      );
      assert.match(
        prompt,
        /- \[P4\] \[ADMITTED\] \(Round 1, Seat "seat-2", check\) \[General\]: Default admitted baseline fact\. \(source: baseline-doc\)/
      );
      assert.ok(!prompt.includes('[Judge Note: Admitted by Judge.]'));
    });

    it('keeps directives 4 and 5 intact and adds directive 6 for summary/clause/topic consistency and unavailable-verification labeling', () => {
      for (const tools of ['read-only', 'none']) {
        const prompt = formatJudgePrompt({
          judge: { id: 'judge-1', model: 'claude-opus-5-5-high' },
          topic: 'Check summary consistency',
          round: 1,
          proofs: [{ id: 'P1', kind: 'check', scope: 'Core', statement: 'Stmt', source: 'Spec' }],
          tools
        });

        if (tools === 'read-only') {
          assert.match(prompt, /\n4\. Spot-check proof sources:/);
        } else {
          assert.ok(
            prompt.includes(
              '4. Tool-free audit & synthesis: Do not invoke any tools on this turn. Audit the submitted proofs strictly against the in-prompt evidence and return your strict JSON synthesis immediately.'
            )
          );
        }

        assert.ok(
          prompt.includes(
            '5. Standalone Answer-First Summary: candidate.summary ("summary") MUST be a standalone, direct, user-facing executive synthesis that directly answers the user\'s topic in clear prose.'
          )
        );
        assert.match(prompt, /\n6\. .*Candidate Summary.*Candidate Clauses.*Topic/s);
        assert.match(prompt, /\n6\. .*admittedStatement.*judgeNote/s);
        assert.match(prompt, /\n6\. .*unavailable verification.*limitation|abstention/is);
        assert.ok(prompt.includes(`7. ${ANTI_CHEATING_RULE}`));
        assert.ok(
          prompt.includes(
            '"summary": "<Direct, standalone, user-facing executive answer to the user\'s topic in clear prose — MUST NOT contain internal proof IDs like P1, P2 or audit process commentary>"'
          )
        );
      }
    });
  });

  describe('3. Round 2+ formatDeliberationPrompt() prior admitted proof preservation', () => {
    it('omits Prior-Round Admitted Proofs in Round 1 and renders prior caveats, Admitted Core, and substantive notes in Round 2+', () => {
      const noteOnly = normalizeProofDecision(
        { status: 'partially_admitted', note: 'Limited to Linux x86_64 hosts' },
        { id: 'P2', status: 'pending' },
        'P2'
      );

      const state = {
        topic: 'Container isolation design',
        round: 2,
        maxRounds: 3,
        candidate: {
          round: 1,
          summary: 'Adopt namespaces and seccomp',
          clauses: [{ id: 'C1', context: 'Runtime', conclusion: 'Use seccomp', citedProofIds: ['P1'] }]
        },
        objections: [
          { id: 'O1', round: 1, seatId: 'seat-2', proofId: 'P2', reason: 'Missing arch caveat', status: 'open' }
        ],
        proofs: [
          {
            id: 'P1',
            round: 1,
            seatId: 'seat-1',
            kind: 'benchmark',
            scope: 'Syscall Overhead',
            statement: 'Seccomp BPF adds zero latency across all workloads.',
            judgeAdmittedStatement: 'Seccomp BPF adds <3% overhead on syscall-heavy workloads.',
            judgeNote: 'Narrowed to syscall-heavy microbenchmarks.',
            status: 'partially_admitted',
            source: 'seccomp-bench'
          },
          {
            id: 'P2',
            round: 1,
            seatId: 'seat-2',
            kind: 'check',
            scope: 'ABI',
            statement: 'Seccomp filter rules match syscall numbers.',
            judgeAdmittedStatement: noteOnly.judgeAdmittedStatement,
            judgeNote: noteOnly.judgeNote,
            status: noteOnly.status,
            source: 'linux-seccomp.txt'
          },
          {
            id: 'P3',
            round: 1,
            seatId: 'seat-1',
            kind: 'citation',
            scope: 'Namespaces',
            statement: 'User namespaces map UID 0 inside container to unprivileged host UID.',
            judgeNote: 'Requires unprivileged_userns_clone=1 on older kernels.',
            status: 'admitted',
            source: 'user_namespaces(7)'
          },
          {
            id: 'P4',
            round: 1,
            seatId: 'seat-2',
            kind: 'check',
            scope: 'Default',
            statement: 'cgroups v2 uses unified hierarchy.',
            admissionKind: 'default_admitted',
            judgeNote: 'Admitted by Judge.',
            status: 'admitted',
            source: 'cgroups-v2'
          },
          {
            id: 'P5',
            round: 1,
            seatId: 'seat-2',
            kind: 'check',
            scope: 'Rejected',
            statement: 'Rejected proof must not appear.',
            status: 'rejected',
            source: 'none'
          },
          {
            id: 'P6',
            round: 2,
            seatId: 'seat-2',
            kind: 'check',
            scope: 'Current',
            statement: 'Current round proof must not appear in prior proofs.',
            status: 'admitted',
            source: 'r2-doc'
          }
        ]
      };

      const r1Prompt = formatDeliberationPrompt({
        soul: STANDARD_SOULS.SYSTEMS_PURIST,
        seat: { id: 'seat-1' },
        topic: state.topic,
        round: 1,
        maxRounds: 3,
        state,
        tools: 'none'
      });
      assert.ok(!r1Prompt.includes('Prior-Round Admitted Proofs:'));

      const r2Prompt = formatDeliberationPrompt({
        soul: STANDARD_SOULS.SYSTEMS_PURIST,
        seat: { id: 'seat-1' },
        topic: state.topic,
        round: 2,
        maxRounds: 3,
        state,
        tools: 'none'
      });

      assert.ok(r2Prompt.includes('Prior-Round Admitted Proofs:'));
      assert.match(
        r2Prompt,
        /- \[P1\] \[PARTIALLY ADMITTED: Narrowed to syscall-heavy microbenchmarks\.\] \(Round 1, benchmark\) \[Syscall Overhead\]: Seccomp BPF adds zero latency across all workloads\. \(Admitted Core: Seccomp BPF adds <3% overhead on syscall-heavy workloads\.\) \(source: seccomp-bench\)/
      );
      assert.match(
        r2Prompt,
        /- \[P2\] \[PARTIALLY ADMITTED: Limited to Linux x86_64 hosts\] \(Round 1, check\) \[ABI\]: Seccomp filter rules match syscall numbers\. \(source: linux-seccomp\.txt\)/
      );
      assert.match(
        r2Prompt,
        /- \[P3\] \[ADMITTED\] \(Round 1, citation\) \[Namespaces\]: User namespaces map UID 0 inside container to unprivileged host UID\. \[Judge Note: Requires unprivileged_userns_clone=1 on older kernels\.\] \(source: user_namespaces\(7\)\)/
      );
      assert.match(
        r2Prompt,
        /- \[P4\] \[ADMITTED\] \(Round 1, check\) \[Default\]: cgroups v2 uses unified hierarchy\. \(source: cgroups-v2\)/
      );
      assert.ok(!r2Prompt.includes('[Judge Note: Admitted by Judge.]'));
      assert.ok(!r2Prompt.includes('Rejected proof must not appear.'));
      assert.ok(!r2Prompt.includes('Current round proof must not appear in prior proofs.'));

      const explicitPriorPrompt = formatDeliberationPrompt({
        soul: STANDARD_SOULS.SYSTEMS_PURIST,
        seat: { id: 'seat-1' },
        topic: 'Explicit prior proofs check',
        round: 2,
        maxRounds: 3,
        priorAdmittedProofs: [state.proofs[0], state.proofs[2]],
        tools: 'none'
      });
      assert.ok(explicitPriorPrompt.includes('Prior-Round Admitted Proofs:'));
      assert.ok(explicitPriorPrompt.includes('[P1] [PARTIALLY ADMITTED: Narrowed to syscall-heavy microbenchmarks.]'));
      assert.ok(explicitPriorPrompt.includes('[P3] [ADMITTED]'));
    });
  });

  describe('4. formatVotingPrompt() topic, notes, open objections, and consistency directives', () => {
    const candidate = {
      round: 2,
      summary: 'Use SQLite WAL mode with bounded checkpointing.',
      clauses: [
        { context: 'Local CLI', conclusion: 'Enable WAL mode', citedProofIds: ['P1', 'P2'] }
      ]
    };

    const proofs = [
      {
        id: 'P1',
        kind: 'check',
        scope: 'Concurrency',
        statement: 'WAL supports concurrent readers and one writer.',
        judgeNote: 'Requires shared-memory shm-file support on local filesystem.',
        status: 'admitted',
        source: 'sqlite.org/wal'
      },
      {
        id: 'P2',
        kind: 'benchmark',
        scope: 'Throughput',
        statement: 'WAL sustains 20k writes/sec everywhere.',
        judgeAdmittedStatement: 'WAL sustains 20k batched writes/sec on local NVMe.',
        judgeNote: 'Does not hold over NFS.',
        status: 'partially_admitted',
        source: 'wal-bench'
      },
      {
        id: 'P3',
        kind: 'check',
        scope: 'Default',
        statement: 'Journal mode persists across reconnects.',
        admissionKind: 'default_admitted',
        judgeNote: 'Admitted by Judge.',
        status: 'admitted',
        source: 'sqlite-pragma'
      }
    ];

    it('renders Topic above Candidate Summary and preserves substantive judgeNotes and M6-SOUL-8 partially_admitted format', () => {
      const prompt = formatVotingPrompt({
        soul: STANDARD_SOULS.PRAGMATIC_ENGINEER,
        seat: { id: 'seat-1' },
        topic: 'Select local ledger storage engine',
        candidate,
        admittedProofs: proofs,
        tools: 'none'
      });

      const topicIdx = prompt.indexOf('Topic: "Select local ledger storage engine"');
      const summaryIdx = prompt.indexOf('Candidate Summary: "Use SQLite WAL mode with bounded checkpointing."');
      assert.ok(topicIdx > 0, 'Expected Topic line in voting prompt');
      assert.ok(summaryIdx > topicIdx, 'Expected Topic line above Candidate Summary');

      assert.ok(
        prompt.includes(
          '- [P1] (check) [Concurrency]: WAL supports concurrent readers and one writer. [Judge Note: Requires shared-memory shm-file support on local filesystem.] (source: sqlite.org/wal)'
        )
      );
      assert.ok(
        prompt.includes(
          '- [P2] (benchmark) [Throughput]: WAL sustains 20k writes/sec everywhere. [PARTIALLY ADMITTED: Does not hold over NFS.] (Admitted Core: WAL sustains 20k batched writes/sec on local NVMe.) (source: wal-bench)'
        )
      );
      assert.ok(
        prompt.includes(
          '- [P3] (check) [Default]: Journal mode persists across reconnects. (source: sqlite-pragma)'
        )
      );
      assert.ok(!prompt.includes('[Judge Note: Admitted by Judge.]'));
    });

    it('renders Your Open Objections from Prior Rounds via explicit param and state.objections fallback while filtering out other seats, withdrawn, and preserved_excused', () => {
      const objections = [
        { id: 'O1', round: 1, seatId: 'seat-1', proofId: 'P1', reason: 'NFS shm limitation omitted', status: 'open' },
        { id: 'O2', round: 1, seatId: 'seat-1', proofId: 'P2', reason: 'Old withdrawn concern', status: 'withdrawn' },
        { id: 'O3', round: 1, seatId: 'seat-2', proofId: 'P1', reason: 'Other seat open objection', status: 'open' },
        { id: 'O4', round: 1, seatId: 'seat-3', proofId: 'P2', reason: 'Excused seat locked objection', status: 'preserved_excused' }
      ];

      const fallbackPrompt = formatVotingPrompt({
        soul: STANDARD_SOULS.ADVERSARIAL_CHALLENGER,
        seat: { id: 'seat-1' },
        candidate,
        state: {
          topic: 'State fallback topic',
          proofs,
          objections
        },
        tools: 'none'
      });

      assert.ok(fallbackPrompt.includes('Topic: "State fallback topic"'));
      assert.ok(fallbackPrompt.includes('Your Open Objections from Prior Rounds:'));
      assert.match(fallbackPrompt, /Voting "accept" withdraws your open objections/i);
      assert.ok(fallbackPrompt.includes('- [O1] (Round 1, backed by Proof P1): NFS shm limitation omitted'));
      assert.ok(!fallbackPrompt.includes('Old withdrawn concern'));
      assert.ok(!fallbackPrompt.includes('Other seat open objection'));
      assert.ok(!fallbackPrompt.includes('Excused seat locked objection'));

      const explicitPrompt = formatVotingPrompt({
        soul: STANDARD_SOULS.ADVERSARIAL_CHALLENGER,
        seat: { id: 'seat-1' },
        topic: 'Explicit topic',
        candidate,
        admittedProofs: proofs,
        myOpenObjections: [objections[0]],
        tools: 'none'
      });
      assert.ok(explicitPrompt.includes('Your Open Objections from Prior Rounds:'));
      assert.ok(explicitPrompt.includes('- [O1] (Round 1, backed by Proof P1): NFS shm limitation omitted'));
    });

    it('preserves required tool-free / read-only regexes while enforcing Candidate Summary, Candidate Clauses, and unavailable-verification checks', () => {
      const promptNone = formatVotingPrompt({
        soul: STANDARD_SOULS.FORMAL_VERIFIER,
        seat: { id: 'seat-1', cwd: '/tmp/ws' },
        topic: 'Verify consistency directives',
        candidate,
        admittedProofs: proofs,
        tools: 'none'
      });

      assert.ok(
        promptNone.includes(
          'Do not invoke any tools during confirmation voting. Evaluate the Candidate Clauses strictly against the audited Proofs provided above and return your JSON vote immediately.'
        )
      );
      assert.ok(promptNone.includes('Candidate Summary'));
      assert.ok(promptNone.includes('Candidate Clauses'));
      assert.ok(promptNone.includes('Judge Note'));
      assert.ok(promptNone.includes('Admitted Core'));
      assert.ok(promptNone.includes('Your Open Objections from Prior Rounds'));
      assert.match(promptNone, /unavailable.*verification.*limitation|abstention/i);
      assert.ok(!promptNone.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));

      for (const cwdOpt of [undefined, '/tmp/ws']) {
        const promptReadOnly = formatVotingPrompt({
          soul: STANDARD_SOULS.FORMAL_VERIFIER,
          seat: { id: 'seat-1' },
          topic: 'Verify consistency directives',
          candidate,
          admittedProofs: proofs,
          tools: 'read-only',
          ...(cwdOpt ? { cwd: cwdOpt } : {})
        });

        assert.ok(promptReadOnly.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
        assert.ok(!promptReadOnly.includes('Do not invoke any tools during confirmation voting.'));
        assert.ok(promptReadOnly.includes('Candidate Summary'));
        assert.ok(promptReadOnly.includes('Candidate Clauses'));
        assert.ok(promptReadOnly.includes('Judge Note'));
        assert.ok(promptReadOnly.includes('Admitted Core'));
        assert.ok(promptReadOnly.includes('Your Open Objections from Prior Rounds'));
        assert.match(promptReadOnly, /unavailable.*verification.*limitation|abstention/i);
      }
    });
  });

  describe('5. Adapter parity across AntigravityAdapter, CodexAdapter, CursorAdapter, and MockAdapter', () => {
    it('delivers identical Topic, admittedProofs, judgeNotes, and seat-scoped myOpenObjections in voting and Round 2 deliberation prompts', async () => {
      const state = {
        topic: 'Evaluate gRPC vs REST internal RPC behind API Gateway',
        round: 2,
        maxRounds: 3,
        clarifications: [{ batch: 1, answer: 'Internal traffic is high-throughput microservice-to-microservice.' }],
        candidate: {
          round: 1,
          summary: 'Adopt gRPC internally with L7 load balancing.',
          clauses: [
            { id: 'C1', context: 'Internal RPC', conclusion: 'Use gRPC + L7 LB', citedProofIds: ['P1', 'P2', 'P3'] }
          ]
        },
        proofs: [
          {
            id: 'P1',
            round: 1,
            seatId: 'seat-1',
            kind: 'citation',
            scope: 'Load Balancing',
            statement: 'HTTP/2 multiplexing pins TCP connections unless L7 LB is used.',
            judgeNote: 'Applies to Envoy and client-side xDS.',
            status: 'admitted',
            source: 'envoy-grpc-rfc'
          },
          {
            id: 'P2',
            round: 1,
            seatId: 'seat-2',
            kind: 'benchmark',
            scope: 'Latency',
            statement: 'Protobuf cuts latency by 40% everywhere.',
            judgeAdmittedStatement: 'Protobuf cuts p99 latency by ~35% on 10KB payloads.',
            judgeNote: 'Measured on x86_64 Go services only.',
            status: 'partially_admitted',
            source: 'grpc-bench'
          },
          {
            id: 'P3',
            round: 1,
            seatId: 'seat-1',
            kind: 'check',
            scope: 'Public Edge',
            statement: 'Public edge keeps REST/OpenAPI 3.1.',
            judgeAdmittedStatement: null,
            judgeNote: 'Conditional on browser compatibility requirement.',
            status: 'partially_admitted',
            source: 'gateway-policy'
          },
          {
            id: 'P4',
            round: 1,
            seatId: 'seat-2',
            kind: 'check',
            scope: 'Default',
            statement: 'TLS 1.3 supported on internal mesh.',
            admissionKind: 'default_admitted',
            judgeNote: 'Admitted by Judge.',
            status: 'admitted',
            source: 'mesh-docs'
          },
          {
            id: 'P5',
            round: 1,
            seatId: 'seat-3',
            kind: 'check',
            scope: 'Rejected',
            statement: 'Rejected claim must stay hidden.',
            status: 'rejected',
            source: 'invalid'
          }
        ],
        objections: [
          {
            id: 'O1',
            round: 1,
            seatId: 'seat-1',
            proofId: 'P3',
            reason: 'Browser gRPC-Web proxy fallback is unaddressed.',
            status: 'open'
          },
          {
            id: 'O2',
            round: 1,
            seatId: 'seat-1',
            proofId: 'P1',
            reason: 'Withdrawn objection must not appear.',
            status: 'withdrawn'
          },
          {
            id: 'O3',
            round: 1,
            seatId: 'seat-2',
            proofId: 'P2',
            reason: 'Seat 2 objection must not appear for Seat 1.',
            status: 'open'
          },
          {
            id: 'O4',
            round: 1,
            seatId: 'seat-3',
            proofId: 'P1',
            reason: 'Excused seat objection must not appear under Your Open Objections.',
            status: 'preserved_excused'
          }
        ]
      };

      const soul = STANDARD_SOULS.ADVERSARIAL_CHALLENGER;
      const liveSeatConfigs = [
        { adapter: new AntigravityAdapter(), seat: { id: 'seat-1', model: 'gemini-4-carbon-high' } },
        { adapter: new CodexAdapter(), seat: { id: 'seat-1', model: 'gpt-6.1-sol (high)' } },
        { adapter: new CursorAdapter(), seat: { id: 'seat-1', model: 'grok-4.7-high' } }
      ];

      const mockAdapter = new MockAdapter();
      await mockAdapter.executeSeat({
        seat: { id: 'seat-1', model: 'gpt-6.1-sol (high)' },
        soul,
        round: 2,
        phase: 'VOTING',
        state,
        tools: 'none'
      });
      await mockAdapter.executeSeat({
        seat: { id: 'seat-1', model: 'gpt-6.1-sol (high)' },
        soul,
        round: 2,
        phase: 'DELIBERATION',
        state,
        tools: 'none'
      });

      const stripMockHeader = (recorded) => recorded.prompt.split('\n').slice(1).join('\n');
      const mockVotingPrompt = stripMockHeader(mockAdapter.recordedPrompts[0]);
      const mockDelibPrompt = stripMockHeader(mockAdapter.recordedPrompts[1]);

      for (const { adapter, seat } of liveSeatConfigs) {
        const liveVotingPrompt = adapter.formatSeatPrompt({
          seat,
          soul,
          round: 2,
          phase: 'VOTING',
          state,
          tools: 'none'
        });
        assert.equal(
          liveVotingPrompt,
          mockVotingPrompt,
          `Voting prompt parity mismatch for ${adapter.name}`
        );

        const liveDelibPrompt = adapter.formatSeatPrompt({
          seat,
          soul,
          round: 2,
          phase: 'DELIBERATION',
          state,
          tools: 'none'
        });
        assert.equal(
          liveDelibPrompt,
          mockDelibPrompt,
          `Round 2 deliberation prompt parity mismatch for ${adapter.name}`
        );
      }

      assert.ok(mockVotingPrompt.includes(`Topic: "${state.topic}"`));
      assert.ok(mockVotingPrompt.includes('[Judge Note: Applies to Envoy and client-side xDS.]'));
      assert.ok(mockVotingPrompt.includes('[PARTIALLY ADMITTED: Measured on x86_64 Go services only.]'));
      assert.ok(mockVotingPrompt.includes('(Admitted Core: Protobuf cuts p99 latency by ~35% on 10KB payloads.)'));
      assert.ok(mockVotingPrompt.includes('[PARTIALLY ADMITTED: Conditional on browser compatibility requirement.]'));
      assert.ok(!mockVotingPrompt.includes('[Judge Note: Admitted by Judge.]'));
      assert.ok(!mockVotingPrompt.includes('Rejected claim must stay hidden.'));
      assert.ok(mockVotingPrompt.includes('- [O1] (Round 1, backed by Proof P3): Browser gRPC-Web proxy fallback is unaddressed.'));
      assert.ok(!mockVotingPrompt.includes('Withdrawn objection must not appear.'));
      assert.ok(!mockVotingPrompt.includes('Seat 2 objection must not appear for Seat 1.'));
      assert.ok(!mockVotingPrompt.includes('Excused seat objection must not appear under Your Open Objections.'));
    });
  });

  describe('6. Multi-round CouncilEngine + MockAdapter integration', () => {
    it('6a. propagates Round 1 note-only partial admission, substantive judgeNote, and Seat 1 open objection O1 into Round 2 recordedPrompts and withdraws O1 on Seat 1 accept', async () => {
      const mock = new MockAdapter();

      mock.scriptSeatResponse({
        seatId: 'seat-1',
        round: 1,
        phase: 'DELIBERATION',
        response: {
          scope: 'Transport',
          kind: 'citation',
          source: 'transport-rfc',
          statement: 'HTTP/2 multiplexing shares one connection across all requests.'
        }
      });
      mock.scriptSeatResponse({
        seatId: 'seat-2',
        round: 1,
        phase: 'DELIBERATION',
        response: {
          scope: 'Serialization',
          kind: 'benchmark',
          source: 'proto-bench',
          statement: 'Protobuf binary framing lowers CPU usage vs JSON.'
        }
      });

      mock.scriptJudgeResponse({
        round: 1,
        response: {
          summary: 'Adopt HTTP/2 RPC internally.',
          proofDecisions: {
            P1: {
              status: 'partially_admitted',
              note: 'Requires L7 request-level load balancing to avoid hotspotting.'
            }
          },
          clauses: [
            { context: 'Internal RPC', conclusion: 'Use HTTP/2 RPC', citedProofIds: ['P1', 'P2'] }
          ]
        }
      });

      mock.scriptSeatResponse({
        seatId: 'seat-1',
        round: 1,
        phase: 'VOTING',
        response: {
          vote: 'object',
          proofId: 'P1',
          reason: 'Candidate dropped L7 request-level load balancing caveat from P1.'
        }
      });
      mock.scriptSeatResponse({
        seatId: 'seat-2',
        round: 1,
        phase: 'VOTING',
        response: { vote: 'accept' }
      });

      mock.scriptSeatResponse({
        seatId: 'seat-1',
        round: 2,
        phase: 'DELIBERATION',
        response: {
          scope: 'Load Balancing',
          kind: 'check',
          source: 'envoy-config',
          statement: 'L7 Envoy routing distributes gRPC requests per stream.'
        }
      });
      mock.scriptSeatResponse({
        seatId: 'seat-2',
        round: 2,
        phase: 'DELIBERATION',
        response: {
          scope: 'Client LB',
          kind: 'check',
          source: 'grpc-xds',
          statement: 'Client-side xDS also balances per-request.'
        }
      });

      mock.scriptJudgeResponse({
        round: 2,
        response: {
          summary: 'Adopt HTTP/2 gRPC with L7 request-level or client-side load balancing.',
          proofDecisions: {
            P3: { status: 'admitted', note: 'Verified Envoy L7 balancing' },
            P4: { status: 'admitted', note: 'Verified client-side xDS balancing' }
          },
          clauses: [
            {
              context: 'Internal RPC',
              conclusion: 'Use HTTP/2 gRPC with L7 or client-side LB',
              citedProofIds: ['P1', 'P3', 'P4']
            }
          ]
        }
      });

      mock.scriptSeatResponse({
        seatId: 'seat-1',
        round: 2,
        phase: 'VOTING',
        response: { vote: 'accept' }
      });
      mock.scriptSeatResponse({
        seatId: 'seat-2',
        round: 2,
        phase: 'VOTING',
        response: { vote: 'accept' }
      });

      const engine = new CouncilEngine(
        {
          topic: 'Internal RPC transport with L7 load balancing',
          maxRounds: 2,
          minQuorum: 2,
          judge: {
            id: 'judge-audit',
            harness: 'mock',
            model: 'claude-opus-5-5-high',
            soul: STANDARD_SOULS.IMPARTIAL_JUDGE,
            tools: 'none'
          },
          seats: [
            {
              id: 'seat-1',
              harness: 'mock',
              model: 'gpt-6.1-sol (high)',
              soul: STANDARD_SOULS.SYSTEMS_PURIST,
              tools: 'none',
              votingTools: 'none'
            },
            {
              id: 'seat-2',
              harness: 'mock',
              model: 'gpt-6-astra (max)',
              soul: STANDARD_SOULS.PERFORMANCE_BENCHMARKER,
              tools: 'none',
              votingTools: 'none'
            }
          ]
        },
        { harnessResolver: () => mock }
      );

      engine.initRoster();
      const result = await engine.run();

      assert.equal(result.ok, true);
      assert.equal(result.verdict.kind, 'Unanimous Consensus');
      assert.equal(result.state.proofs.find((p) => p.id === 'P1').judgeAdmittedStatement, null);
      assert.equal(result.state.proofs.find((p) => p.id === 'P2').admissionKind, 'default_admitted');
      assert.equal(result.state.objections.find((o) => o.id === 'O1').status, 'withdrawn');

      const r2DelibSeat1 = mock.recordedPrompts.find(
        (p) => p.seatId === 'seat-1' && p.round === 2 && p.phase === 'DELIBERATION'
      );
      const r2Judge = mock.recordedPrompts.find(
        (p) => p.role === 'judge' && p.round === 2
      );
      assert.ok(r2DelibSeat1.prompt.includes('Prior-Round Admitted Proofs:'));
      assert.ok(
        r2DelibSeat1.prompt.includes(
          '[P1] [PARTIALLY ADMITTED: Requires L7 request-level load balancing to avoid hotspotting.]'
        )
      );
      assert.ok(
        r2Judge.prompt.includes(
          '(Caveat — narrowed by Judge Note: Requires L7 request-level load balancing to avoid hotspotting.)'
        )
      );

      const r2VoteSeat1 = mock.recordedPrompts.find(
        (p) => p.seatId === 'seat-1' && p.round === 2 && p.phase === 'VOTING'
      );
      const r2VoteSeat2 = mock.recordedPrompts.find(
        (p) => p.seatId === 'seat-2' && p.round === 2 && p.phase === 'VOTING'
      );
      assert.ok(r2VoteSeat1.prompt.includes('Topic: "Internal RPC transport with L7 load balancing"'));
      assert.ok(r2VoteSeat1.prompt.includes('Your Open Objections from Prior Rounds:'));
      assert.ok(r2VoteSeat1.prompt.includes('- [O1] (Round 1, backed by Proof P1):'));
      assert.ok(!r2VoteSeat2.prompt.includes('Your Open Objections from Prior Rounds:'));
      assert.ok(!r2VoteSeat2.prompt.includes('- [O1]'));
      assert.ok(!r2VoteSeat2.prompt.includes('Candidate dropped L7 request-level load balancing caveat from P1.'));
    });

    it('6b. propagates note-only partial admission, substantive judgeNote, and seat-scoped open objections into Round 2 prompts while enforcing withdrawal and preserved_excused invariants', async () => {
      const mock = new MockAdapter();

      // Round 1 proofs
      mock.scriptSeatResponse({
        seatId: 'seat-1',
        round: 1,
        phase: 'DELIBERATION',
        response: {
          scope: 'Transport',
          kind: 'citation',
          source: 'transport-rfc',
          statement: 'HTTP/2 multiplexing shares one connection across all requests.'
        }
      });
      mock.scriptSeatResponse({
        seatId: 'seat-2',
        round: 1,
        phase: 'DELIBERATION',
        response: {
          scope: 'Serialization',
          kind: 'benchmark',
          source: 'proto-bench',
          statement: 'Protobuf binary framing lowers CPU usage vs JSON.'
        }
      });
      mock.scriptSeatResponse({
        seatId: 'seat-3',
        round: 1,
        phase: 'DELIBERATION',
        response: {
          scope: 'Baseline',
          kind: 'check',
          source: 'gateway-docs',
          statement: 'Public edge exposes OpenAPI 3.1 REST endpoints.'
        }
      });

      // Round 1 Judge: P1 note-only partially_admitted (admittedStatement: null), P2 substantive admitted note, P3 omitted (default_admitted boilerplate)
      mock.scriptJudgeResponse({
        round: 1,
        response: {
          summary: 'Adopt HTTP/2 RPC internally with REST edge.',
          proofDecisions: {
            P1: {
              status: 'partially_admitted',
              note: 'Requires L7 request-level load balancing to avoid hotspotting.'
            },
            P2: {
              status: 'admitted',
              note: 'Verified for payloads >= 1KB.'
            }
          },
          clauses: [
            { context: 'Internal RPC', conclusion: 'Use HTTP/2 RPC', citedProofIds: ['P1', 'P2'] },
            { context: 'Public Edge', conclusion: 'Retain REST OpenAPI 3.1', citedProofIds: ['P3'] }
          ]
        }
      });

      // Round 1 Voting: seat-1 raises O1 citing P1; seat-2 accepts; seat-3 raises O2 citing P2
      mock.scriptSeatResponse({
        seatId: 'seat-1',
        round: 1,
        phase: 'VOTING',
        response: {
          vote: 'object',
          proofId: 'P1',
          reason: 'Candidate dropped L7 request-level load balancing caveat from P1.'
        }
      });
      mock.scriptSeatResponse({
        seatId: 'seat-2',
        round: 1,
        phase: 'VOTING',
        response: { vote: 'accept' }
      });
      mock.scriptSeatResponse({
        seatId: 'seat-3',
        round: 1,
        phase: 'VOTING',
        response: {
          vote: 'object',
          proofId: 'P2',
          reason: 'Payload threshold caveat >= 1KB missing.'
        }
      });

      // Fault seat-3 in Round 2 deliberation so EXCUSE_SEAT locks O2 as preserved_excused
      mock.injectSeatFault('seat-3', {
        round: 2,
        phase: 'DELIBERATION',
        error: new QuotaExhaustionError('Seat 3 quota exhausted in Round 2', {
          harness: 'mock',
          seatId: 'seat-3'
        })
      });

      // Round 2 deliberation proofs for seat-1 & seat-2
      mock.scriptSeatResponse({
        seatId: 'seat-1',
        round: 2,
        phase: 'DELIBERATION',
        response: {
          scope: 'Load Balancing',
          kind: 'check',
          source: 'envoy-config',
          statement: 'L7 Envoy routing distributes gRPC requests per stream.'
        }
      });
      mock.scriptSeatResponse({
        seatId: 'seat-2',
        round: 2,
        phase: 'DELIBERATION',
        response: {
          scope: 'Payload Bound',
          kind: 'check',
          source: 'proto-bench',
          statement: 'Small payloads < 1KB have negligible framing savings.'
        }
      });

      // Round 2 Judge synthesis addressing O1 and O2
      mock.scriptJudgeResponse({
        round: 2,
        response: {
          summary: 'Adopt HTTP/2 gRPC with L7 request-level load balancing for payloads >= 1KB and REST OpenAPI 3.1 at the public edge.',
          proofDecisions: {
            P4: { status: 'admitted', note: 'Verified Envoy L7 stream balancing' },
            P5: { status: 'admitted', note: 'Verified payload floor' }
          },
          clauses: [
            { context: 'Internal RPC', conclusion: 'Use HTTP/2 gRPC with L7 request-level LB', citedProofIds: ['P1', 'P4'] },
            { context: 'Payload Threshold', conclusion: 'Apply Protobuf threshold >= 1KB', citedProofIds: ['P2', 'P5'] },
            { context: 'Public Edge', conclusion: 'Retain REST OpenAPI 3.1', citedProofIds: ['P3'] }
          ]
        }
      });

      // Round 2 Voting: seat-1 and seat-2 accept
      mock.scriptSeatResponse({
        seatId: 'seat-1',
        round: 2,
        phase: 'VOTING',
        response: { vote: 'accept' }
      });
      mock.scriptSeatResponse({
        seatId: 'seat-2',
        round: 2,
        phase: 'VOTING',
        response: { vote: 'accept' }
      });

      const engine = new CouncilEngine(
        {
          topic: 'Internal RPC transport selection behind API Gateway',
          maxRounds: 2,
          minQuorum: 2,
          maxRetriesPerSeat: 0,
          judge: {
            id: 'judge-audit',
            harness: 'mock',
            model: 'claude-opus-5-5-high',
            soul: STANDARD_SOULS.IMPARTIAL_JUDGE,
            tools: 'none'
          },
          seats: [
            {
              id: 'seat-1',
              harness: 'mock',
              model: 'gpt-6.1-sol (high)',
              soul: STANDARD_SOULS.SYSTEMS_PURIST,
              tools: 'none',
              votingTools: 'none'
            },
            {
              id: 'seat-2',
              harness: 'mock',
              model: 'gpt-6-astra (max)',
              soul: STANDARD_SOULS.PERFORMANCE_BENCHMARKER,
              tools: 'none',
              votingTools: 'none'
            },
            {
              id: 'seat-3',
              harness: 'mock',
              model: 'gemini-4-carbon-high',
              soul: STANDARD_SOULS.ADVERSARIAL_CHALLENGER,
              tools: 'none',
              votingTools: 'none'
            }
          ]
        },
        { harnessResolver: () => mock }
      );

      engine.initRoster();
      const result = await engine.run();

      assert.equal(result.ok, false);
      assert.equal(result.verdict.kind, 'Dissent Report (Preserved Excused-Seat Objection)');
      const p1 = result.state.proofs.find((p) => p.id === 'P1');
      assert.equal(p1.status, 'partially_admitted');
      assert.equal(p1.judgeAdmittedStatement, null);
      assert.equal(p1.judgeNote, 'Requires L7 request-level load balancing to avoid hotspotting.');

      const p3 = result.state.proofs.find((p) => p.id === 'P3');
      assert.equal(p3.status, 'admitted');
      assert.equal(p3.admissionKind, 'default_admitted');
      assert.equal(p3.judgeNote, 'Admitted by Judge.');

      // 1. Round 2 Deliberation prompts receive Prior-Round Admitted Proofs with caveats and substantive notes
      const r2DelibSeat1 = mock.recordedPrompts.find(
        (p) => p.seatId === 'seat-1' && p.round === 2 && p.phase === 'DELIBERATION'
      );
      assert.ok(r2DelibSeat1, 'Expected Round 2 deliberation prompt for seat-1');
      assert.ok(r2DelibSeat1.prompt.includes('Prior-Round Admitted Proofs:'));
      assert.ok(
        r2DelibSeat1.prompt.includes(
          '[P1] [PARTIALLY ADMITTED: Requires L7 request-level load balancing to avoid hotspotting.]'
        )
      );
      assert.ok(r2DelibSeat1.prompt.includes('[Judge Note: Verified for payloads >= 1KB.]'));
      assert.ok(!r2DelibSeat1.prompt.includes('[Judge Note: Admitted by Judge.]'));

      // 2. Round 2 Judge prompt preserves note-only P1 caveat (with judgeAdmittedStatement === null) + P2 substantive note + O1 + locked O2
      const r2JudgePrompt = mock.recordedPrompts.find(
        (p) => p.role === 'judge' && p.round === 2
      );
      assert.ok(r2JudgePrompt, 'Expected Round 2 Judge prompt');
      assert.ok(
        r2JudgePrompt.prompt.includes(
          '[P1] [PARTIALLY ADMITTED: Requires L7 request-level load balancing to avoid hotspotting.]'
        )
      );
      assert.ok(
        r2JudgePrompt.prompt.includes(
          '(Caveat — narrowed by Judge Note: Requires L7 request-level load balancing to avoid hotspotting.)'
        )
      );
      assert.ok(r2JudgePrompt.prompt.includes('[Judge Note: Verified for payloads >= 1KB.]'));
      assert.ok(!r2JudgePrompt.prompt.includes('[Judge Note: Admitted by Judge.]'));
      assert.ok(r2JudgePrompt.prompt.includes('[O1]'));
      assert.ok(r2JudgePrompt.prompt.includes('[O2] [LOCKED / preserved_excused — Excused Seat]'));

      // 3. Round 2 Voting prompts: seat-1 gets Topic, P1 caveat, P2 judgeNote, and O1; seat-2 does NOT get O1 under Your Open Objections
      const r2VoteSeat1 = mock.recordedPrompts.find(
        (p) => p.seatId === 'seat-1' && p.round === 2 && p.phase === 'VOTING'
      );
      const r2VoteSeat2 = mock.recordedPrompts.find(
        (p) => p.seatId === 'seat-2' && p.round === 2 && p.phase === 'VOTING'
      );
      assert.ok(r2VoteSeat1 && r2VoteSeat2);

      for (const vp of [r2VoteSeat1.prompt, r2VoteSeat2.prompt]) {
        assert.ok(vp.includes('Topic: "Internal RPC transport selection behind API Gateway"'));
        assert.ok(vp.includes('[PARTIALLY ADMITTED: Requires L7 request-level load balancing to avoid hotspotting.]'));
        assert.ok(vp.includes('[Judge Note: Verified for payloads >= 1KB.]'));
        assert.ok(!vp.includes('[Judge Note: Admitted by Judge.]'));
      }

      assert.ok(r2VoteSeat1.prompt.includes('Your Open Objections from Prior Rounds:'));
      assert.ok(
        r2VoteSeat1.prompt.includes(
          '- [O1] (Round 1, backed by Proof P1): Candidate dropped L7 request-level load balancing caveat from P1.'
        )
      );
      assert.ok(!r2VoteSeat2.prompt.includes('Your Open Objections from Prior Rounds:'));
      assert.ok(!r2VoteSeat2.prompt.includes('- [O1]'));
      assert.ok(!r2VoteSeat2.prompt.includes('Candidate dropped L7 request-level load balancing caveat from P1.'));

      // 4. Seat-1 voting "accept" withdrew ONLY its own O1; O2 remained preserved_excused
      const finalO1 = result.state.objections.find((o) => o.id === 'O1');
      const finalO2 = result.state.objections.find((o) => o.id === 'O2');
      assert.equal(finalO1.status, 'withdrawn');
      assert.equal(finalO2.status, 'preserved_excused');
      assert.equal(result.verdict.kind, 'Dissent Report (Preserved Excused-Seat Objection)');

      // 5. Verify reducer ownership and preserved_excused lock invariants remain intact
      const lockAttemptBySeat3 = transitionCouncil(result.state, {
        type: 'WITHDRAW_OBJECTION',
        objectionId: 'O2',
        seatId: 'seat-3'
      });
      assert.equal(lockAttemptBySeat3.lastTransition.ok, false);
      assert.match(lockAttemptBySeat3.lastTransition.message, /preserved_excused|Immutability/i);

      const lockAttemptBySeat1 = transitionCouncil(result.state, {
        type: 'WITHDRAW_OBJECTION',
        objectionId: 'O2',
        seatId: 'seat-1'
      });
      assert.equal(lockAttemptBySeat1.lastTransition.ok, false);
      assert.match(lockAttemptBySeat1.lastTransition.message, /preserved_excused|Immutability/i);

      // Direct ownership check on open objection before withdrawal
      let ownershipState = createInitialCouncilState({
        topic: 'Objection ownership invariant',
        minQuorum: 2,
        maxRounds: 2,
        judge: { id: 'j', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'Judge' },
        seats: [
          { id: 's1', harness: 'mock', model: 'gpt-6.1-sol (high)', soul: 'S1' },
          { id: 's2', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'S2' }
        ]
      });
      ownershipState = transitionCouncil(ownershipState, { type: 'BEGIN_ROUND' });
      ownershipState = transitionCouncil(ownershipState, {
        type: 'SUBMIT_PROOF',
        seatId: 's1',
        scope: 'Core',
        kind: 'check',
        source: 'spec',
        statement: 'Proof statement'
      });
      ownershipState = transitionCouncil(ownershipState, { type: 'START_JUDGING' });
      ownershipState = transitionCouncil(ownershipState, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        summary: 'Summary',
        proofDecisions: { P1: { status: 'admitted', note: 'OK' } },
        clauses: [{ context: 'Core', conclusion: 'Conc', citedProofIds: ['P1'] }]
      });
      ownershipState = transitionCouncil(ownershipState, {
        type: 'CAST_VOTE',
        seatId: 's1',
        vote: 'object',
        proofId: 'P1',
        reason: 'S1 concern'
      });

      const stealAttempt = transitionCouncil(ownershipState, {
        type: 'WITHDRAW_OBJECTION',
        objectionId: 'O1',
        seatId: 's2'
      });
      assert.equal(stealAttempt.lastTransition.ok, false);
      assert.match(stealAttempt.lastTransition.message, /Objection Ownership Guard/);
    });
  });
});
