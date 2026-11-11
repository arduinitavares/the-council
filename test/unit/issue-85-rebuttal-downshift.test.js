import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateConfig, resolveConfig } from '../../src/engine/config.js';
import {
  resolveRebuttalSeatConfig,
  CouncilEngine
} from '../../src/engine/council-engine.js';
import { createInitialCouncilState } from '../../src/machine/state.js';
import { transitionCouncil } from '../../src/machine/reducer.js';
import { formatDeliberationPrompt } from '../../src/seats/soul.js';
import { CodexAdapter } from '../../src/harness/codex.js';
import { AntigravityAdapter } from '../../src/harness/antigravity.js';
import { CursorAdapter } from '../../src/harness/cursor.js';
import { MockAdapter } from '../../src/harness/mock.js';
import { TimeoutError, QuotaExhaustionError } from '../../src/harness/adapter.js';
import { runCodexCli, runAntigravityCli, runCursorCli } from '../../src/harness/cli-runner.js';

describe('Issue #85: Round 2+ Targeted Rebuttal Downshift for Prior-Round Accepting Seats', () => {
  describe('resolveRebuttalSeatConfig unit behavior', () => {
    const baseSeat = {
      id: 'seat-b',
      harness: 'codex',
      model: 'gpt-6-astra (max)',
      soul: 'Distributed Systems Engineer: verifies durability invariants.',
      tools: 'read-only',
      timeoutMs: 240000
    };

    it('downshifts effort to medium, caps rebuttalTimeoutMs to 90000, and defaults tools to none when cwd is unset', () => {
      const resolved = resolveRebuttalSeatConfig(baseSeat);
      assert.equal(resolved.model, 'gpt-6-astra (medium)');
      assert.equal(resolved.tools, 'none');
      assert.equal(resolved.rebuttalTimeoutMs, 90000);
      assert.equal(resolved.preserveRebuttalEffort, false);
      assert.equal(resolved.reasoningEffort, 'medium');
    });

    it('keeps tools as read-only when seat.cwd or engineConfig.cwd is set (unless overridden)', () => {
      const withSeatCwd = resolveRebuttalSeatConfig({ ...baseSeat, cwd: '/tmp/repo' });
      assert.equal(withSeatCwd.tools, 'read-only');
      assert.equal(withSeatCwd.cwd, '/tmp/repo');

      const withGlobalCwd = resolveRebuttalSeatConfig(baseSeat, { cwd: '/tmp/global-repo' });
      assert.equal(withGlobalCwd.tools, 'read-only');

      const explicitNoneWithCwd = resolveRebuttalSeatConfig(
        { ...baseSeat, cwd: '/tmp/repo', rebuttalTools: 'none' },
        { cwd: '/tmp/repo' }
      );
      assert.equal(explicitNoneWithCwd.tools, 'none');
      assert.equal(explicitNoneWithCwd.cwd, undefined);

      // Never escalates a seat configured with tools: 'none' to 'read-only' merely because cwd is set
      const baseNoneSeat = resolveRebuttalSeatConfig({ ...baseSeat, tools: 'none', cwd: '/tmp/repo' });
      assert.equal(baseNoneSeat.tools, 'none');
      assert.equal(baseNoneSeat.cwd, undefined);
    });

    it('downshifts hyphenated suffixes across Gemini, Claude, Grok, and leaves Composer/low models intact', () => {
      assert.equal(
        resolveRebuttalSeatConfig({ ...baseSeat, harness: 'antigravity', model: 'gemini-4-argon-high' }).model,
        'gemini-4-argon-medium'
      );
      assert.equal(
        resolveRebuttalSeatConfig({ ...baseSeat, harness: 'antigravity', model: 'gemini-4-carbon-high' }).model,
        'gemini-4-carbon-medium'
      );
      assert.equal(
        resolveRebuttalSeatConfig({ ...baseSeat, harness: 'antigravity', model: 'claude-opus-5-5-high' }).model,
        'claude-opus-5-5-medium'
      );
      assert.equal(
        resolveRebuttalSeatConfig({ ...baseSeat, harness: 'cursor', model: 'grok-4.7-xhigh' }).model,
        'grok-4.7-medium'
      );
      assert.equal(
        resolveRebuttalSeatConfig({ ...baseSeat, harness: 'cursor', model: 'composer-2.5' }).model,
        'composer-2.5'
      );
      // Never upshifts -low to -medium
      assert.equal(
        resolveRebuttalSeatConfig({ ...baseSeat, harness: 'antigravity', model: 'claude-sonnet-5-5-low' }).model,
        'claude-sonnet-5-5-low'
      );
    });

    it('supports rebuttalReasoningEffort and rebuttalModel overrides', () => {
      const lowRebuttal = resolveRebuttalSeatConfig(baseSeat, { rebuttalReasoningEffort: 'low' });
      assert.equal(lowRebuttal.model, 'gpt-6-astra (low)');
      assert.equal(lowRebuttal.reasoningEffort, 'low');

      const seatHighOverride = resolveRebuttalSeatConfig(
        { ...baseSeat, rebuttalReasoningEffort: 'high' },
        { rebuttalReasoningEffort: 'low' }
      );
      assert.equal(seatHighOverride.model, 'gpt-6-astra (high)');
      assert.equal(seatHighOverride.reasoningEffort, 'high');

      const seatXhighOverride = resolveRebuttalSeatConfig({
        ...baseSeat,
        rebuttalReasoningEffort: 'xhigh'
      });
      assert.equal(seatXhighOverride.model, 'gpt-6-astra (xhigh)');
      assert.equal(seatXhighOverride.reasoningEffort, 'xhigh');

      const lowBaseSeat = resolveRebuttalSeatConfig({
        ...baseSeat,
        harness: 'antigravity',
        model: 'claude-sonnet-5-5-low'
      });
      assert.equal(lowBaseSeat.model, 'claude-sonnet-5-5-low');
      assert.equal(lowBaseSeat.reasoningEffort, 'low');

      const swappedModel = resolveRebuttalSeatConfig({
        ...baseSeat,
        rebuttalModel: 'gpt-6.1-sol (low)'
      });
      assert.equal(swappedModel.model, 'gpt-6.1-sol (low)');

      const hyphenSwapped = resolveRebuttalSeatConfig({
        ...baseSeat,
        'rebuttal-model': 'gpt-6.1-sol (medium)'
      });
      assert.equal(hyphenSwapped.model, 'gpt-6.1-sol (medium)');
    });

    it('clamps rebuttalTimeoutMs by seat.timeoutMs and totalSeatBudgetMs', () => {
      const shorterSeatTimeout = resolveRebuttalSeatConfig({ ...baseSeat, timeoutMs: 45000 });
      assert.equal(shorterSeatTimeout.rebuttalTimeoutMs, 45000);

      const clampedByBudget = resolveRebuttalSeatConfig({
        ...baseSeat,
        totalSeatBudgetMs: 60000
      });
      assert.equal(clampedByBudget.rebuttalTimeoutMs, 60000);

      const customRebuttalTimeout = resolveRebuttalSeatConfig(baseSeat, { rebuttalTimeoutMs: 75000 });
      assert.equal(customRebuttalTimeout.rebuttalTimeoutMs, 75000);
    });

    it('preserves full effort, tools, and timeout when preserveRebuttalEffort is true while allowing explicit overrides', () => {
      const preservedGlobal = resolveRebuttalSeatConfig(baseSeat, { preserveRebuttalEffort: true });
      assert.equal(preservedGlobal.model, 'gpt-6-astra (max)');
      assert.equal(preservedGlobal.tools, 'read-only');
      assert.equal(preservedGlobal.rebuttalTimeoutMs, 240000);
      assert.equal(preservedGlobal.preserveRebuttalEffort, true);
      assert.equal(preservedGlobal.reasoningEffort, undefined);

      // Per-seat preserveRebuttalEffort: false overrides global true
      const seatOptBackIn = resolveRebuttalSeatConfig(
        { ...baseSeat, preserveRebuttalEffort: false },
        { preserveRebuttalEffort: true }
      );
      assert.equal(seatOptBackIn.model, 'gpt-6-astra (medium)');
      assert.equal(seatOptBackIn.tools, 'none');
      assert.equal(seatOptBackIn.rebuttalTimeoutMs, 90000);

      // Explicit rebuttalTimeoutMs and rebuttalTools still apply when preserveRebuttalEffort: true
      const preservedWithExplicitOverrides = resolveRebuttalSeatConfig({
        ...baseSeat,
        preserveRebuttalEffort: true,
        rebuttalTimeoutMs: 110000,
        rebuttalTools: 'none'
      });
      assert.equal(preservedWithExplicitOverrides.model, 'gpt-6-astra (max)');
      assert.equal(preservedWithExplicitOverrides.tools, 'none');
      assert.equal(preservedWithExplicitOverrides.rebuttalTimeoutMs, 110000);

      // Infers effort-scaled timeout when seat.timeoutMs is unset and preserveRebuttalEffort: true
      const preservedHighModel = resolveRebuttalSeatConfig({
        id: 'argon-seat',
        harness: 'antigravity',
        model: 'gemini-4-argon-high',
        soul: 'Reviewer',
        tools: 'read-only',
        preserveRebuttalEffort: true
      });
      assert.equal(preservedHighModel.rebuttalTimeoutMs, 120000);
    });
  });

  describe('validateConfig and resolveConfig rebuttal option validation', () => {
    const validBase = {
      topic: 'Validate rebuttal options',
      maxRounds: 2,
      minQuorum: 2,
      maxClarificationBatches: 0,
      maxRetriesPerSeat: 1,
      judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
      seats: [
        { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Seat 1' },
        { id: 's2', harness: 'mock', model: 'gemini-4-argon-high', soul: 'Seat 2' }
      ]
    };

    it('rejects invalid top-level rebuttal configuration fields in both validateConfig and resolveConfig', () => {
      const invalidCases = [
        [{ rebuttalTimeoutMs: 0 }, /rebuttalTimeoutMs must be a positive integer/],
        [{ rebuttalTimeoutMs: -50 }, /rebuttalTimeoutMs must be a positive integer/],
        [{ rebuttalTimeoutMs: 12.5 }, /rebuttalTimeoutMs must be a positive integer/],
        [{ rebuttalTimeoutMs: '90000' }, /rebuttalTimeoutMs must be a positive integer/],
        [{ preserveRebuttalEffort: 'yes' }, /preserveRebuttalEffort must be a boolean/],
        [{ preserveRebuttalEffort: 1 }, /preserveRebuttalEffort must be a boolean/],
        [{ rebuttalTools: 'write' }, /"rebuttalTools" policy must be 'none' or 'read-only'/],
        [{ rebuttalTools: 'read-write' }, /"rebuttalTools" policy must be 'none' or 'read-only'/],
        [{ rebuttalReasoningEffort: 'ultra' }, /rebuttalReasoningEffort must be one of/],
        [{ rebuttalReasoningEffort: '' }, /rebuttalReasoningEffort must be one of/],
        [{ rebuttalModel: '' }, /rebuttalModel must be a non-empty string/],
        [{ rebuttalModel: '   ' }, /rebuttalModel must be a non-empty string/]
      ];

      for (const [override, pattern] of invalidCases) {
        const res = validateConfig({ ...validBase, ...override });
        assert.equal(res.valid, false, `Expected validateConfig to reject ${JSON.stringify(override)}`);
        assert.match(res.errors.join('; '), pattern);

        assert.throws(
          () => resolveConfig({ ...validBase, ...override }),
          pattern,
          `Expected resolveConfig to reject ${JSON.stringify(override)}`
        );
      }
    });

    it('rejects invalid per-seat rebuttal configuration fields in both validateConfig and resolveConfig', () => {
      const invalidSeatCases = [
        [{ rebuttalTimeoutMs: -1 }, /Seat "s1" rebuttalTimeoutMs must be a positive integer/],
        [{ preserveRebuttalEffort: 'false' }, /Seat "s1" requires "preserveRebuttalEffort" to be a boolean/],
        [{ rebuttalTools: 'exec' }, /Seat "s1" "rebuttalTools" policy must be 'none' or 'read-only'/],
        [{ rebuttalReasoningEffort: 'turbo' }, /Seat "s1" requires "rebuttalReasoningEffort" to be one of/],
        [{ rebuttalModel: '' }, /Seat "s1" requires "rebuttalModel" to be a non-empty string/],
        [{ 'rebuttal-model': '  ' }, /Seat "s1" requires "rebuttal-model" to be a non-empty string/]
      ];

      for (const [seatOverride, pattern] of invalidSeatCases) {
        const cfg = {
          ...validBase,
          seats: [{ ...validBase.seats[0], ...seatOverride }, validBase.seats[1]]
        };
        const res = validateConfig(cfg);
        assert.equal(res.valid, false, `Expected validateConfig to reject seat ${JSON.stringify(seatOverride)}`);
        assert.match(res.errors.join('; '), pattern);

        assert.throws(() => resolveConfig(cfg), pattern);
      }
    });

    it('normalizes valid rebuttal config fields while preserving shallow-freeze semantics', () => {
      const resolved = resolveConfig({
        ...validBase,
        preserveRebuttalEffort: true,
        rebuttalReasoningEffort: 'LOW',
        seats: [
          {
            ...validBase.seats[0],
            preserveRebuttalEffort: false,
            rebuttalTimeoutMs: 60000,
            rebuttalTools: 'none',
            rebuttalModel: '  gpt-6.1-sol (medium)  '
          },
          validBase.seats[1]
        ]
      });

      assert.equal(Object.isFrozen(resolved), true);
      assert.equal(Object.isFrozen(resolved.judge), false);
      assert.equal(Object.isFrozen(resolved.seats), false);

      assert.equal(resolved.preserveRebuttalEffort, true);
      assert.equal(resolved.rebuttalReasoningEffort, 'low');
      assert.equal(resolved.rebuttalTimeoutMs, undefined);

      assert.equal(resolved.seats[0].preserveRebuttalEffort, false);
      assert.equal(resolved.seats[0].rebuttalTimeoutMs, 60000);
      assert.equal(resolved.seats[0].rebuttalTools, 'none');
      assert.equal(resolved.seats[0].rebuttalModel, 'gpt-6.1-sol (medium)');

      assert.equal(resolved.seats[1].preserveRebuttalEffort, true);
      assert.equal(resolved.seats[1].rebuttalReasoningEffort, 'low');
      assert.equal(resolved.seats[1].rebuttalTimeoutMs, undefined);
    });
  });

  describe('formatDeliberationPrompt targeted rebuttal directive', () => {
    const promptParams = {
      soul: 'Storage Engine Architect: guarantees WAL fsync durability.',
      seat: { id: 'seat-wal', model: 'gpt-6-astra (medium)', harness: 'codex' },
      topic: 'Design write-ahead log commit path',
      round: 2,
      maxRounds: 3,
      previousCandidate: {
        round: 1,
        summary: 'Group commit every 5ms with fsync before ACK.',
        clauses: [{ id: 'C1', context: 'Commit durability', conclusion: 'fsync before ACK', citedProofIds: ['P1'] }]
      },
      openObjections: [
        { id: 'O1', seatId: 'seat-latency', proofId: 'P2', reason: '5ms batch window violates p99 < 2ms SLA.' }
      ],
      tools: 'none'
    };

    it('keeps standard deliberation prompt byte-for-byte free of rebuttal directive when rebuttalMode is false', () => {
      const standardDefault = formatDeliberationPrompt(promptParams);
      const standardExplicitFalse = formatDeliberationPrompt({ ...promptParams, rebuttalMode: false });
      assert.equal(standardDefault, standardExplicitFalse);
      assert.ok(!standardDefault.includes('TARGETED REBUTTAL & INVARIANT GUARD:'));
    });

    it('injects TARGETED REBUTTAL & INVARIANT GUARD when rebuttalMode: true or mode: "rebuttal"', () => {
      const viaFlag = formatDeliberationPrompt({ ...promptParams, rebuttalMode: true });
      const viaMode = formatDeliberationPrompt({ ...promptParams, mode: 'rebuttal' });
      assert.equal(viaFlag, viaMode);

      assert.ok(viaFlag.includes('TARGETED REBUTTAL & INVARIANT GUARD:'));
      assert.ok(viaFlag.includes('You already voted ACCEPT on the Round 1 Candidate.'));
      assert.ok(viaFlag.includes('Do NOT re-litigate settled clauses from scratch.'));
      assert.ok(viaFlag.includes('Storage Engine Architect'));
      assert.ok(viaFlag.includes('guarantees WAL fsync durability.'));
      assert.ok(viaFlag.includes('falsifiable invariant that Round 2 synthesis must preserve'));
      assert.ok(viaFlag.includes('Still return 1 strict JSON Proof ("scope", "kind", "source", "statement")'));
      assert.ok(viaFlag.includes('OUTPUT CONTRACT (strict JSON):'));
    });
  });

  describe('Harness adapter rebuttalMode forwarding & persistent seat non-mutation', () => {
    const sampleState = {
      topic: 'Adapter forwarding check',
      round: 2,
      maxRounds: 3,
      candidate: {
        round: 1,
        summary: 'Round 1 candidate',
        clauses: [{ id: 'C1', context: 'Core', conclusion: 'Keep strict validation', citedProofIds: ['P1'] }]
      },
      objections: [{ id: 'O1', seatId: 'seat-a', proofId: 'P2', status: 'open', reason: 'Edge case unaddressed' }]
    };

    const validProofJson = JSON.stringify({
      scope: 'Core validation invariant',
      kind: 'check',
      source: 'Adapter unit test check',
      statement: 'Strict validation invariant must hold when edge case is added.'
    });

    it('CodexAdapter forwards rebuttalMode, medium effort CLI flag (including bare models), and never mutates persistent seat', async () => {
      const capturedExecs = [];
      const persistentSeat = {
        id: 'codex-seat',
        harness: 'codex',
        model: 'gpt-6.1-sol',
        soul: 'Security Auditor: enforces input bounds',
        tools: 'read-only',
        cwd: '/Users/aaat/projects/the-council',
        timeoutMs: 240000
      };
      const snapshotBefore = structuredClone(persistentSeat);
      const rebuttalSeat = resolveRebuttalSeatConfig(persistentSeat, { rebuttalTools: 'none' });

      const adapter = new CodexAdapter({
        spawnRunner: (opts) =>
          runCodexCli({
            ...opts,
            exec: async (executable, args, execOpts) => {
              capturedExecs.push({ executable, args, cwd: execOpts.cwd });
              return {
                exitCode: 0,
                stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: validProofJson } }),
                stderr: ''
              };
            }
          })
      });

      const proof = await adapter.executeSeatProof({
        seat: rebuttalSeat,
        soul: persistentSeat.soul,
        round: 2,
        state: sampleState,
        timeoutMs: rebuttalSeat.rebuttalTimeoutMs,
        tools: rebuttalSeat.tools,
        rebuttalMode: true,
        context: {
          rebuttalMode: true,
          tools: rebuttalSeat.tools,
          reasoningEffort: rebuttalSeat.reasoningEffort
        }
      });

      assert.equal(proof.kind, 'check');
      assert.deepEqual(persistentSeat, snapshotBefore, 'Persistent seat config must never be mutated');
      assert.equal(capturedExecs.length, 1);
      const { args, cwd } = capturedExecs[0];
      assert.ok(args.includes('gpt-6.1-sol'));
      assert.ok(args.includes('model_reasoning_effort="medium"'));
      assert.notEqual(cwd, persistentSeat.cwd, 'tools: none must isolate cwd away from persistent repo cwd');
      const promptArg = args[args.length - 1];
      assert.ok(promptArg.includes('TARGETED REBUTTAL & INVARIANT GUARD:'));
      assert.ok(promptArg.includes('Do not invoke any tools'));
    });

    it('AntigravityAdapter forwards rebuttalMode for both Gemini and Claude models without mutating persistent seat', async () => {
      const captured = [];
      const adapter = new AntigravityAdapter({
        spawnRunner: (opts) =>
          runAntigravityCli({
            ...opts,
            exec: async (executable, args, execOpts) => {
              captured.push({ executable, args, cwd: execOpts.cwd });
              return { exitCode: 0, stdout: JSON.stringify({ response: validProofJson }), stderr: '' };
            }
          })
      });

      for (const origModel of ['gemini-4-argon-high', 'claude-opus-5-5-high']) {
        const persistentSeat = {
          id: `agy-${origModel}`,
          harness: 'antigravity',
          model: origModel,
          soul: 'Architecture Reviewer: checks modularity',
          tools: 'read-only',
          timeoutMs: 120000
        };
        const snapshot = structuredClone(persistentSeat);
        const rebuttalSeat = resolveRebuttalSeatConfig(persistentSeat);

        await adapter.executeSeatProof({
          seat: rebuttalSeat,
          soul: persistentSeat.soul,
          round: 2,
          state: sampleState,
          timeoutMs: rebuttalSeat.rebuttalTimeoutMs,
          tools: rebuttalSeat.tools,
          rebuttalMode: true
        });

        assert.deepEqual(persistentSeat, snapshot);
      }

      assert.equal(captured.length, 2);
      assert.ok(captured[0].args.includes('gemini-4-argon-medium'));
      assert.ok(captured[0].args.includes('medium'));
      assert.ok(captured[0].args.some((a) => a.includes('TARGETED REBUTTAL & INVARIANT GUARD:')));
      assert.ok(captured[1].args.includes('claude-opus-5-5-medium'));
      assert.ok(captured[1].args.includes('medium'));
      assert.ok(captured[1].args.some((a) => a.includes('TARGETED REBUTTAL & INVARIANT GUARD:')));
    });

    it('CursorAdapter forwards rebuttalMode for Grok and Composer models without mutating persistent seat', async () => {
      const captured = [];
      const adapter = new CursorAdapter({
        spawnRunner: (opts) =>
          runCursorCli({
            ...opts,
            exec: async (executable, args, execOpts) => {
              captured.push({ executable, args, cwd: execOpts.cwd });
              return {
                exitCode: 0,
                stdout: JSON.stringify({ type: 'result', result: validProofJson }),
                stderr: ''
              };
            }
          })
      });

      for (const origModel of ['grok-4.7-xhigh', 'composer-2.5']) {
        const persistentSeat = {
          id: `cursor-${origModel}`,
          harness: 'cursor',
          model: origModel,
          soul: 'Skeptic: probes edge cases',
          tools: 'read-only',
          timeoutMs: 240000
        };
        const snapshot = structuredClone(persistentSeat);
        const rebuttalSeat = resolveRebuttalSeatConfig(persistentSeat);

        await adapter.executeSeatProof({
          seat: rebuttalSeat,
          soul: persistentSeat.soul,
          round: 2,
          state: sampleState,
          timeoutMs: rebuttalSeat.rebuttalTimeoutMs,
          tools: rebuttalSeat.tools,
          mode: 'rebuttal'
        });

        assert.deepEqual(persistentSeat, snapshot);
      }

      assert.equal(captured.length, 2);
      assert.ok(captured[0].args.includes('grok-4.7-medium'));
      assert.ok(captured[0].args[captured[0].args.length - 1].includes('TARGETED REBUTTAL & INVARIANT GUARD:'));
      assert.ok(captured[1].args.includes('composer-2.5'));
      assert.ok(captured[1].args[captured[1].args.length - 1].includes('TARGETED REBUTTAL & INVARIANT GUARD:'));
    });

    it('MockAdapter records rebuttalMode and renders targeted rebuttal directive', async () => {
      const mock = new MockAdapter();
      const seat = { id: 'mock-seat', harness: 'mock', model: 'gpt-6-astra (medium)', soul: 'Reviewer', tools: 'none' };
      await mock.executeSeatProof({
        seat,
        soul: seat.soul,
        round: 2,
        state: sampleState,
        timeoutMs: 90000,
        tools: 'none',
        rebuttalMode: true
      });

      const recorded = mock.getRecordedPrompts('mock-seat');
      assert.equal(recorded.length, 1);
      assert.equal(recorded[0].rebuttalMode, true);
      assert.equal(recorded[0].tools, 'none');
      assert.equal(recorded[0].timeoutMs, 90000);
      assert.ok(recorded[0].prompt.includes('TARGETED REBUTTAL & INVARIANT GUARD:'));
    });
  });

  describe('CouncilEngine multi-round role-partitioned deliberation & reducer invariants', () => {
    it('AC 1: Round 2 partitions objecting Seat A (full effort) vs prior-accepting Seats B & C (rebuttal downshift, cwd-aware tools, budget-clamped timeout)', async () => {
      const tmpRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-85-cwd-'));
      try {
        const mock = new MockAdapter();
        const delibCalls = [];
        const origExecuteSeat = mock.executeSeat.bind(mock);
        mock.executeSeat = async (params) => {
          if (params.phase === 'DELIBERATION') {
            delibCalls.push({
              round: params.round,
              seatId: params.seat.id,
              model: params.seat.model,
              tools: params.tools,
              timeoutMs: params.timeoutMs,
              rebuttalMode: Boolean(params.rebuttalMode)
            });
          }
          return origExecuteSeat(params);
        };

        // Round 1 voting: Seat A objects citing P1; Seats B & C accept
        mock.scriptSeatResponse({
          seatId: 'seat-a',
          round: 1,
          phase: 'VOTING',
          response: ({ state }) => {
            const pA = state.proofs.find((p) => p.seatId === 'seat-a' && p.round === 1);
            return { vote: 'object', reason: 'Missing backpressure queue cap', proofId: pA.id };
          }
        });
        mock.scriptSeatResponse({ seatId: 'seat-b', round: 1, phase: 'VOTING', response: { vote: 'accept' } });
        mock.scriptSeatResponse({ seatId: 'seat-c', round: 1, phase: 'VOTING', response: { vote: 'accept' } });

        // Round 2 voting: all accept
        mock.scriptSeatResponse({ seatId: 'seat-a', round: 2, phase: 'VOTING', response: { vote: 'accept' } });
        mock.scriptSeatResponse({ seatId: 'seat-b', round: 2, phase: 'VOTING', response: { vote: 'accept' } });
        mock.scriptSeatResponse({ seatId: 'seat-c', round: 2, phase: 'VOTING', response: { vote: 'accept' } });

        const engine = new CouncilEngine(
          {
            topic: 'Backpressure queue architecture',
            maxRounds: 3,
            minQuorum: 2,
            judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Impartial Judge' },
            seats: [
              {
                id: 'seat-a',
                harness: 'mock',
                model: 'gpt-6-astra (max)',
                soul: 'Queue Theorist: bounds memory under load',
                tools: 'read-only',
                timeoutMs: 180000
              },
              {
                id: 'seat-b',
                harness: 'mock',
                model: 'gemini-4-argon-high',
                soul: 'API Designer: preserves wire compatibility',
                tools: 'read-only',
                timeoutMs: 120000
                // No cwd -> tools should downshift to 'none' in Round 2 rebuttal, timeout 90000
              },
              {
                id: 'seat-c',
                harness: 'mock',
                model: 'claude-opus-5-5-high',
                soul: 'Codebase Auditor: verifies local implementation seams',
                tools: 'read-only',
                cwd: tmpRepoDir,
                timeoutMs: 120000,
                totalSeatBudgetMs: 70000
                // Has cwd -> tools stays 'read-only' in Round 2 rebuttal; timeout clamped by totalSeatBudgetMs (70000)
              }
            ]
          },
          { harnessResolver: () => mock }
        );

        const result = await engine.run();
        assert.equal(result.ok, true);
        assert.equal(result.verdict.kind, 'Unanimous Consensus');
        assert.equal(result.state.round, 2);

        // Verify all 3 seats submitted proofs in BOTH Round 1 and Round 2 (6 proofs total)
        const round1Proofs = result.state.proofs.filter((p) => p.round === 1);
        const round2Proofs = result.state.proofs.filter((p) => p.round === 2);
        assert.equal(round1Proofs.length, 3);
        assert.equal(round2Proofs.length, 3);

        // Round 1: all 3 seats execute full deliberation (rebuttalMode: false)
        const r1Calls = delibCalls.filter((c) => c.round === 1);
        assert.equal(r1Calls.length, 3);
        for (const c of r1Calls) {
          assert.equal(c.rebuttalMode, false);
          assert.equal(c.tools, 'read-only');
        }

        // Round 2: Seat A (objector) stays at full deliberation
        const r2A = delibCalls.find((c) => c.round === 2 && c.seatId === 'seat-a');
        assert.deepEqual(r2A, {
          round: 2,
          seatId: 'seat-a',
          model: 'gpt-6-astra (max)',
          tools: 'read-only',
          timeoutMs: 180000,
          rebuttalMode: false
        });
        const promptR2A = mock.getRecordedPrompts('seat-a').find((p) => p.round === 2 && p.phase === 'DELIBERATION');
        assert.ok(!promptR2A.prompt.includes('TARGETED REBUTTAL & INVARIANT GUARD:'));

        // Round 2: Seat B (prior-accepting, no cwd) downshifts to medium, tools: 'none', timeoutMs: 90000, rebuttalMode: true
        const r2B = delibCalls.find((c) => c.round === 2 && c.seatId === 'seat-b');
        assert.deepEqual(r2B, {
          round: 2,
          seatId: 'seat-b',
          model: 'gemini-4-argon-medium',
          tools: 'none',
          timeoutMs: 90000,
          rebuttalMode: true
        });
        const promptR2B = mock.getRecordedPrompts('seat-b').find((p) => p.round === 2 && p.phase === 'DELIBERATION');
        assert.ok(promptR2B.prompt.includes('TARGETED REBUTTAL & INVARIANT GUARD:'));
        assert.ok(promptR2B.prompt.includes('Do not invoke any tools'));

        // Round 2: Seat C (prior-accepting, has cwd, totalSeatBudgetMs: 70000) downshifts to medium, tools: 'read-only', timeoutMs: 70000
        const r2C = delibCalls.find((c) => c.round === 2 && c.seatId === 'seat-c');
        assert.deepEqual(r2C, {
          round: 2,
          seatId: 'seat-c',
          model: 'claude-opus-5-5-medium',
          tools: 'read-only',
          timeoutMs: 70000,
          rebuttalMode: true
        });
        const promptR2C = mock.getRecordedPrompts('seat-c').find((p) => p.round === 2 && p.phase === 'DELIBERATION');
        assert.ok(promptR2C.prompt.includes('TARGETED REBUTTAL & INVARIANT GUARD:'));
        assert.ok(promptR2C.prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
      } finally {
        fs.rmSync(tmpRepoDir, { recursive: true, force: true });
      }
    });

    it('AC 2: When sole objector Seat A faults out (EXCUSE_SEAT) in Round 2 DELIBERATION, Seats B & C rebuttal proofs satisfy START_JUDGING without deadlocking', async () => {
      const mock = new MockAdapter();
      const guardRejections = [];

      mock.scriptSeatResponse({
        seatId: 'seat-a',
        round: 1,
        phase: 'VOTING',
        response: ({ state }) => {
          const pA = state.proofs.find((p) => p.seatId === 'seat-a' && p.round === 1);
          return { vote: 'object', reason: 'Needs stricter retry cap', proofId: pA.id };
        }
      });
      mock.scriptSeatResponse({ seatId: 'seat-b', round: 1, phase: 'VOTING', response: { vote: 'accept' } });
      mock.scriptSeatResponse({ seatId: 'seat-c', round: 1, phase: 'VOTING', response: { vote: 'accept' } });

      // Inject unrecoverable fault on sole objector Seat A in Round 2 DELIBERATION
      mock.injectSeatFault('seat-a', {
        round: 2,
        phase: 'DELIBERATION',
        error: new QuotaExhaustionError('Seat A exhausted quota in Round 2', {
          harness: 'mock',
          seatId: 'seat-a'
        })
      });

      const engine = new CouncilEngine(
        {
          topic: 'Sole objector Round 2 excusal resilience',
          maxRounds: 3,
          minQuorum: 2,
          maxRetriesPerSeat: 0,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Impartial Judge' },
          seats: [
            { id: 'seat-a', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Seat A' },
            { id: 'seat-b', harness: 'mock', model: 'gemini-4-argon-high', soul: 'Seat B' },
            { id: 'seat-c', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'Seat C' }
          ]
        },
        { harnessResolver: () => mock }
      );

      engine.getTelemetry().on('guard_rejected', (evt) => {
        guardRejections.push(evt);
      });

      const result = await engine.run();

      // Zero guard rejections (START_JUDGING succeeded with Seats B & C's Round 2 rebuttal proofs!)
      assert.equal(guardRejections.length, 0);
      assert.equal(result.state.phase, 'completed');
      assert.equal(result.state.round, 2);
      assert.equal(result.verdict.kind, 'Dissent Report (Preserved Excused-Seat Objection)');

      const round2Proofs = result.state.proofs.filter((p) => p.round === 2);
      assert.equal(round2Proofs.length, 2);
      assert.deepEqual(
        round2Proofs.map((p) => p.seatId),
        ['seat-b', 'seat-c']
      );
      const seatAState = result.state.seats.find((s) => s.id === 'seat-a');
      assert.equal(seatAState.status, 'excused');
    });

    it('AC 3: preserveRebuttalEffort: true preserves full effort, tools, and timeout in Round 2+ while honoring explicit rebuttalTimeoutMs / rebuttalTools', async () => {
      const mock = new MockAdapter();
      const round2Calls = [];
      const origExecuteSeat = mock.executeSeat.bind(mock);
      mock.executeSeat = async (params) => {
        if (params.phase === 'DELIBERATION' && params.round === 2) {
          round2Calls.push({
            seatId: params.seat.id,
            model: params.seat.model,
            tools: params.tools,
            timeoutMs: params.timeoutMs,
            rebuttalMode: Boolean(params.rebuttalMode)
          });
        }
        return origExecuteSeat(params);
      };

      mock.scriptSeatResponse({
        seatId: 'seat-a',
        round: 1,
        phase: 'VOTING',
        response: ({ state }) => ({
          vote: 'object',
          reason: 'Objection from Seat A',
          proofId: state.proofs.find((p) => p.seatId === 'seat-a').id
        })
      });

      const engine = new CouncilEngine(
        {
          topic: 'preserveRebuttalEffort verification',
          maxRounds: 2,
          minQuorum: 2,
          preserveRebuttalEffort: true,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            { id: 'seat-a', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Objector', timeoutMs: 200000 },
            {
              id: 'seat-b',
              harness: 'mock',
              model: 'gpt-6.1-sol (max)',
              soul: 'Preserved Rebuttal Seat',
              tools: 'read-only',
              timeoutMs: 180000
            },
            {
              id: 'seat-c',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Preserved Effort with Explicit Rebuttal Overrides',
              tools: 'read-only',
              timeoutMs: 240000,
              rebuttalTimeoutMs: 65000,
              rebuttalTools: 'none'
            }
          ]
        },
        { harnessResolver: () => mock }
      );

      const result = await engine.run();
      assert.equal(result.ok, true);

      const callB = round2Calls.find((c) => c.seatId === 'seat-b');
      assert.deepEqual(callB, {
        seatId: 'seat-b',
        model: 'gpt-6.1-sol (max)',
        tools: 'read-only',
        timeoutMs: 180000,
        rebuttalMode: true
      });

      const callC = round2Calls.find((c) => c.seatId === 'seat-c');
      assert.deepEqual(callC, {
        seatId: 'seat-c',
        model: 'grok-4.7-xhigh',
        tools: 'none',
        timeoutMs: 65000,
        rebuttalMode: true
      });
    });

    it('AC 5: 3-round deliberation proves persistent seat config is never mutated when a Round 2 rebuttal seat objects to a regression and enters Round 3 as an objector', async () => {
      const mock = new MockAdapter();
      const delibCalls = [];
      const origExecuteSeat = mock.executeSeat.bind(mock);
      mock.executeSeat = async (params) => {
        if (params.phase === 'DELIBERATION') {
          delibCalls.push({
            round: params.round,
            seatId: params.seat.id,
            model: params.seat.model,
            tools: params.tools,
            timeoutMs: params.timeoutMs,
            rebuttalMode: Boolean(params.rebuttalMode)
          });
        }
        return origExecuteSeat(params);
      };

      // Round 1 voting: Seat A objects, Seat B accepts
      mock.scriptSeatResponse({
        seatId: 'seat-a',
        round: 1,
        phase: 'VOTING',
        response: ({ state }) => ({
          vote: 'object',
          reason: 'Round 1 objection by Seat A',
          proofId: state.proofs.find((p) => p.seatId === 'seat-a' && p.round === 1).id
        })
      });
      mock.scriptSeatResponse({ seatId: 'seat-b', round: 1, phase: 'VOTING', response: { vote: 'accept' } });

      // Round 2 voting: Seat A accepts, but Seat B objects to Candidate regression citing its Round 2 rebuttal proof!
      mock.scriptSeatResponse({ seatId: 'seat-a', round: 2, phase: 'VOTING', response: { vote: 'accept' } });
      mock.scriptSeatResponse({
        seatId: 'seat-b',
        round: 2,
        phase: 'VOTING',
        response: ({ state }) => {
          const r2ProofB = state.proofs.find((p) => p.seatId === 'seat-b' && p.round === 2);
          assert.ok(r2ProofB, 'Seat B must have a Round 2 rebuttal proof admitted to cite in CAST_VOTE');
          return {
            vote: 'object',
            reason: 'Round 2 synthesis regressed Seat B invariant',
            proofId: r2ProofB.id
          };
        }
      });

      // Round 3 voting: both accept
      mock.scriptSeatResponse({ seatId: 'seat-a', round: 3, phase: 'VOTING', response: { vote: 'accept' } });
      mock.scriptSeatResponse({ seatId: 'seat-b', round: 3, phase: 'VOTING', response: { vote: 'accept' } });

      const engine = new CouncilEngine(
        {
          topic: '3-round role swap non-mutation test',
          maxRounds: 3,
          minQuorum: 2,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'seat-a',
              harness: 'mock',
              model: 'gpt-6-astra (max)',
              soul: 'Seat A',
              tools: 'read-only',
              timeoutMs: 200000
            },
            {
              id: 'seat-b',
              harness: 'mock',
              model: 'gpt-6.1-sol (max)',
              soul: 'Seat B',
              tools: 'read-only',
              timeoutMs: 180000
            }
          ]
        },
        { harnessResolver: () => mock }
      );

      const result = await engine.run();
      assert.equal(result.ok, true);
      assert.equal(result.state.round, 3);

      // Check Seat B across Rounds 1 -> 2 -> 3:
      const bR1 = delibCalls.find((c) => c.round === 1 && c.seatId === 'seat-b');
      const bR2 = delibCalls.find((c) => c.round === 2 && c.seatId === 'seat-b');
      const bR3 = delibCalls.find((c) => c.round === 3 && c.seatId === 'seat-b');

      // Round 1: full deliberation
      assert.deepEqual(bR1, {
        round: 1,
        seatId: 'seat-b',
        model: 'gpt-6.1-sol (max)',
        tools: 'read-only',
        timeoutMs: 180000,
        rebuttalMode: false
      });

      // Round 2: downshifted rebuttal
      assert.deepEqual(bR2, {
        round: 2,
        seatId: 'seat-b',
        model: 'gpt-6.1-sol (medium)',
        tools: 'none',
        timeoutMs: 90000,
        rebuttalMode: true
      });

      // Round 3: restored to full unmutated deliberation as objector!
      assert.deepEqual(bR3, {
        round: 3,
        seatId: 'seat-b',
        model: 'gpt-6.1-sol (max)',
        tools: 'read-only',
        timeoutMs: 180000,
        rebuttalMode: false
      });

      // Meanwhile Seat A accepted Round 2 and downshifted to rebuttal in Round 3!
      const aR3 = delibCalls.find((c) => c.round === 3 && c.seatId === 'seat-a');
      assert.deepEqual(aR3, {
        round: 3,
        seatId: 'seat-a',
        model: 'gpt-6-astra (medium)',
        tools: 'none',
        timeoutMs: 90000,
        rebuttalMode: true
      });

      // Verify persistent state.seats models/tools were never mutated
      assert.equal(result.state.seats.find((s) => s.id === 'seat-a').model, 'gpt-6-astra (max)');
      assert.equal(result.state.seats.find((s) => s.id === 'seat-b').model, 'gpt-6.1-sol (max)');
      assert.equal(result.state.seats.find((s) => s.id === 'seat-b').tools, 'read-only');
    });

    it('preserves rebuttalMode and strips tools to "none" on TimeoutError retry in Round 2 rebuttal', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-85-retry-'));
      try {
        const mock = new MockAdapter();
        const r2Attempts = [];
        const origExecuteSeat = mock.executeSeat.bind(mock);
        mock.executeSeat = async (params) => {
          if (params.phase === 'DELIBERATION' && params.round === 2 && params.seat.id === 'seat-b') {
            r2Attempts.push({
              model: params.seat.model,
              tools: params.tools,
              timeoutMs: params.timeoutMs,
              rebuttalMode: Boolean(params.rebuttalMode),
              retries: params.seat.retries || 0
            });
          }
          return origExecuteSeat(params);
        };

        mock.scriptSeatResponse({
          seatId: 'seat-a',
          round: 1,
          phase: 'VOTING',
          response: ({ state }) => ({
            vote: 'object',
            reason: 'Round 1 objection',
            proofId: state.proofs.find((p) => p.seatId === 'seat-a').id
          })
        });

        mock.injectSeatFault('seat-b', {
          round: 2,
          phase: 'DELIBERATION',
          maxTriggers: 1,
          error: new TimeoutError('Rebuttal Attempt 0 timed out', {
            harness: 'mock',
            seatId: 'seat-b',
            timeoutMs: 90000
          })
        });

        const engine = new CouncilEngine(
          {
            topic: 'Rebuttal retry timeout strip test',
            maxRounds: 2,
            minQuorum: 2,
            maxRetriesPerSeat: 1,
            cwd: tmpDir,
            judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
            seats: [
              { id: 'seat-a', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Seat A' },
              {
                id: 'seat-b',
                harness: 'mock',
                model: 'gemini-4-argon-high',
                soul: 'Seat B',
                timeoutMs: 120000,
                totalSeatBudgetMs: 150000
              }
            ]
          },
          { harnessResolver: () => mock }
        );

        const result = await engine.run();
        assert.equal(result.ok, true);
        assert.equal(r2Attempts.length, 2);
        // Attempt 0 had tools: 'read-only' (because cwd was set) and timeoutMs: 90000
        assert.deepEqual(r2Attempts[0], {
          model: 'gemini-4-argon-medium',
          tools: 'read-only',
          timeoutMs: 90000,
          rebuttalMode: true,
          retries: 0
        });
        // Retry 1 strips tools to 'none', keeps rebuttalMode: true, and clamps timeout to remainingBudget (60000)
        assert.deepEqual(r2Attempts[1], {
          model: 'gemini-4-argon-medium',
          tools: 'none',
          timeoutMs: 60000,
          rebuttalMode: true,
          retries: 1
        });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('infers prior-round accepting seats from hydrated reducer state and does not misclassify withdrawn prior objectors', async () => {
      let s = createInitialCouncilState({
        topic: 'Hydrated state Round 2 rebuttal check',
        minQuorum: 2,
        maxRounds: 3,
        maxRetriesPerSeat: 0,
        judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
        seats: [
          { id: 'seat-a', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Seat A', tools: 'read-only' },
          { id: 'seat-b', harness: 'mock', model: 'gemini-4-argon-high', soul: 'Seat B', tools: 'read-only' },
          { id: 'seat-c', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'Seat C', tools: 'read-only' }
        ]
      });
      s = transitionCouncil(s, { type: 'BEGIN_ROUND' });
      s = transitionCouncil(s, {
        type: 'SUBMIT_PROOF',
        id: 'P1',
        seatId: 'seat-a',
        scope: 'Scope A',
        kind: 'check',
        source: 'Src A',
        statement: 'Stmt A'
      });
      s = transitionCouncil(s, {
        type: 'SUBMIT_PROOF',
        id: 'P2',
        seatId: 'seat-b',
        scope: 'Scope B',
        kind: 'check',
        source: 'Src B',
        statement: 'Stmt B'
      });
      s = transitionCouncil(s, {
        type: 'SUBMIT_PROOF',
        id: 'P3',
        seatId: 'seat-c',
        scope: 'Scope C',
        kind: 'check',
        source: 'Src C',
        statement: 'Stmt C'
      });
      s = transitionCouncil(s, { type: 'START_JUDGING' });
      s = transitionCouncil(s, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        summary: 'Round 1 synthesis',
        clauses: [{ id: 'C1', context: 'Ctx', conclusion: 'Conc', citedProofIds: ['P1', 'P2', 'P3'] }]
      });
      // Seat A and Seat C object in Round 1; Seat B accepts
      s = transitionCouncil(s, { type: 'CAST_VOTE', seatId: 'seat-a', vote: 'object', reason: 'Obj A', proofId: 'P1' });
      s = transitionCouncil(s, { type: 'CAST_VOTE', seatId: 'seat-b', vote: 'accept' });
      s = transitionCouncil(s, { type: 'CAST_VOTE', seatId: 'seat-c', vote: 'object', reason: 'Obj C', proofId: 'P3' });
      s = transitionCouncil(s, { type: 'EVALUATE_ROUND' });
      assert.equal(s.round, 2);
      assert.equal(s.phase, 'reviewing');

      // Seat C withdraws O2 before Round 2 runs — Seat C still did NOT vote ACCEPT in Round 1!
      s = transitionCouncil(s, { type: 'WITHDRAW_OBJECTION', seatId: 'seat-c', objectionId: 'O2' });

      const mock = new MockAdapter();
      const r2Calls = [];
      const origExec = mock.executeSeat.bind(mock);
      mock.executeSeat = async (params) => {
        if (params.phase === 'DELIBERATION') {
          r2Calls.push({
            seatId: params.seat.id,
            model: params.seat.model,
            tools: params.tools,
            rebuttalMode: Boolean(params.rebuttalMode)
          });
        }
        return origExec(params);
      };

      const engine = new CouncilEngine(
        {
          topic: 'Hydrated state Round 2 rebuttal check',
          minQuorum: 2,
          maxRounds: 3,
          maxRetriesPerSeat: 0,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            { id: 'seat-a', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Seat A', tools: 'read-only' },
            { id: 'seat-b', harness: 'mock', model: 'gemini-4-argon-high', soul: 'Seat B', tools: 'read-only' },
            { id: 'seat-c', harness: 'mock', model: 'claude-opus-5-5-high', soul: 'Seat C', tools: 'read-only' }
          ]
        },
        { harnessResolver: () => mock }
      );
      // Hydrate state directly (bypassing engine._step for Round 1)
      engine.state = s;

      await engine.runRound();

      // Seat A (open objector) and Seat C (did NOT vote accept in Round 1) run full deliberation; ONLY Seat B runs rebuttal!
      assert.deepEqual(r2Calls, [
        { seatId: 'seat-a', model: 'gpt-6-astra (max)', tools: 'read-only', rebuttalMode: false },
        { seatId: 'seat-b', model: 'gemini-4-argon-medium', tools: 'none', rebuttalMode: true },
        { seatId: 'seat-c', model: 'claude-opus-5-5-high', tools: 'read-only', rebuttalMode: false }
      ]);
    });
  });
});
