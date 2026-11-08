import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDeliberationPrompt,
  formatVotingPrompt,
  formatJudgePrompt,
  formatGroundingSection
} from '../../src/seats/soul.js';

describe('Unit: Seat & Judge Evidence and Clarification Prompt Grounding (#23)', () => {
  it('exports formatGroundingSection with clear data delimiters and injects state.evidence and state.clarifications into deliberation, voting, and judge prompts', () => {
    assert.equal(typeof formatGroundingSection, 'function');
    assert.equal(formatGroundingSection([], []), '');

    const state = {
      topic: 'Database Sharding vs Read Replicas',
      round: 1,
      maxRounds: 3,
      evidence: [
        {
          id: 'E1',
          label: 'PgStatStatements Dump',
          source: 'psql://127.0.0.1:5432/metrics',
          text: 'SELECT Ratio=94%, INSERT/UPDATE Ratio=6%'
        },
        {
          id: 'E2',
          label: 'Replica Lag Benchmark',
          source: 'benchmarks/replica-lag.json',
          text: 'p99 replication lag is 12ms under 10k RPS'
        }
      ],
      clarifications: [
        { batch: 1, answer: 'Read-after-write consistency is only required for session auth tokens.' }
      ],
      candidate: {
        round: 1,
        summary: 'Use read replicas with primary routing for session auth tokens.',
        clauses: [
          {
            id: 'C1',
            context: 'Read-heavy workload (94% SELECT)',
            conclusion: 'Route general reads to replicas and auth token reads to primary.',
            citedProofIds: ['P1']
          }
        ]
      },
      proofs: [
        {
          id: 'P1',
          round: 1,
          seatId: 'seat-db',
          kind: 'benchmark',
          scope: 'Read scaling',
          source: 'psql://127.0.0.1:5432/metrics',
          statement: '94% of workload is SELECT queries with 12ms p99 replica lag.',
          status: 'admitted'
        }
      ],
      objections: []
    };

    const grounding = formatGroundingSection(state.evidence, state.clarifications);
    assert.match(grounding, /--- BEGIN EVIDENCE \[E1\] PgStatStatements Dump \(Source: psql:\/\/127\.0\.0\.1:5432\/metrics\) ---/);
    assert.match(grounding, /--- END EVIDENCE \[E1\] ---/);
    assert.match(grounding, /--- BEGIN EVIDENCE \[E2\] Replica Lag Benchmark \(Source: benchmarks\/replica-lag\.json\) ---/);
    assert.match(grounding, /--- END EVIDENCE \[E2\] ---/);

    const seat = { id: 'seat-db', harness: 'codex', model: 'gpt-6-astra (max)' };
    const delib = formatDeliberationPrompt({ soul: 'DB Architect', seat, state });
    const voting = formatVotingPrompt({ soul: 'DB Architect', seat, state });
    const judge = formatJudgePrompt({
      judge: { id: 'judge-opus', model: 'claude-opus-5-5-high', soul: 'Impartial Auditor' },
      round: 1,
      proofs: state.proofs,
      state
    });

    for (const prompt of [delib, voting, judge]) {
      assert.match(prompt, /--- BEGIN EVIDENCE \[E1\] PgStatStatements Dump \(Source: psql:\/\/127\.0\.0\.1:5432\/metrics\) ---/);
      assert.match(prompt, /\[E1\] PgStatStatements Dump \(Source: psql:\/\/127\.0\.0\.1:5432\/metrics\): SELECT Ratio=94%, INSERT\/UPDATE Ratio=6%/);
      assert.match(prompt, /--- END EVIDENCE \[E1\] ---/);
      assert.match(prompt, /--- BEGIN EVIDENCE \[E2\] Replica Lag Benchmark \(Source: benchmarks\/replica-lag\.json\) ---/);
      assert.match(prompt, /\[E2\] Replica Lag Benchmark \(Source: benchmarks\/replica-lag\.json\): p99 replication lag is 12ms under 10k RPS/);
      assert.match(prompt, /--- END EVIDENCE \[E2\] ---/);
      assert.match(prompt, /Read-after-write consistency is only required for session auth tokens\./);
    }
  });
});

