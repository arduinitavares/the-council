import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import {
  COUNCIL_EVENTS,
  CouncilEngine,
  MockAdapter,
  TimeoutError,
  VERDICT_KINDS,
  createContinuationCouncilState,
  loadContinuationParent,
  loadTelemetrySummary,
  runCli,
  runContinuation,
  transitionCouncil,
  validateContinuationEligibility
} from '../../src/index.js';
import { formatVotingPrompt } from '../../src/seats/soul.js';
import { parseRunBundleJs } from '../../src/visualizer/live-watcher.js';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function makeProof(idSuffix = '1') {
  return {
    scope: `Invariant ${idSuffix}`,
    kind: 'check',
    source: `src/spec-${idSuffix}.js:10`,
    statement: `Deterministic verification check ${idSuffix} passed.`
  };
}

function makeSeat(id, overrides = {}) {
  return {
    id,
    harness: 'codex',
    model: 'gpt-6.2-sol',
    soul: `Reviewer ${id}: Enforce empirical proof grounding.`,
    reasoningEffort: 'xhigh',
    tools: 'read-only',
    cwd: '/tmp/workspace-a',
    ...overrides
  };
}

function makeParentState(overrides = {}) {
  return {
    runId: 'run-parent-1',
    topic: 'Should we ship Continuation ratification for preserved excused objections?',
    phase: 'completed',
    canonicalPhase: 'COMPLETED',
    round: 1,
    maxRounds: 2,
    minQuorum: 2,
    maxRetriesPerSeat: 1,
    timeoutMs: 120000,
    totalSeatBudgetMs: 300000,
    tools: 'read-only',
    cwd: '/tmp/workspace-a',
    seats: [
      { ...makeSeat('seat-a'), status: 'accepted' },
      { ...makeSeat('seat-b'), status: 'accepted' },
      {
        ...makeSeat('seat-c', { harness: 'antigravity', model: 'gemini-3.5-pro' }),
        status: 'excused',
        excusedReason: 'Timed out waiting for response after retries'
      }
    ],
    judge: {
      id: 'judge-1',
      harness: 'codex',
      model: 'gpt-6.2-sol',
      reasoningEffort: 'xhigh',
      tools: 'none'
    },
    proofs: [
      {
        id: 'P1',
        round: 1,
        seatId: 'seat-a',
        ...makeProof('1'),
        status: 'admitted',
        note: 'Admitted.'
      },
      {
        id: 'P2',
        round: 1,
        seatId: 'seat-c',
        ...makeProof('2'),
        status: 'partially_admitted',
        note: 'Partial evidence.'
      }
    ],
    objections: [
      {
        id: 'OBJ-1',
        seatId: 'seat-c',
        round: 1,
        reason: 'Needs runtime verification against concurrent snapshot writes.',
        proofId: 'P2',
        status: 'preserved_excused'
      }
    ],
    candidate: {
      round: 1,
      summary: 'Allow explicit Continuation runs targeting only excused objecting seats.',
      clauses: [
        {
          id: 'C1',
          context: 'Immutability and lineage',
          conclusion: 'Continuation creates a distinct run linked via parentRunId and rootRunId.',
          citedProofIds: ['P1', 'P2']
        }
      ],
      proofDecisions: {
        P1: { status: 'admitted', note: 'Admitted.' },
        P2: { status: 'partially_admitted', note: 'Partial evidence.' }
      }
    },
    verdict: {
      kind: VERDICT_KINDS.DISSENT_PRESERVED_OBJECTION,
      summary: 'Active seats accepted candidate, but seat-c timed out with preserved objection OBJ-1.',
      round: 1,
      minQuorum: 2,
      activeSeatCount: 2,
      excusedSeats: [
        { id: 'seat-c', reason: 'Timed out waiting for response after retries' }
      ],
      preservedObjections: [
        {
          id: 'OBJ-1',
          seatId: 'seat-c',
          reason: 'Needs runtime verification against concurrent snapshot writes.',
          proofId: 'P2',
          round: 1
        }
      ],
      candidate: {
        round: 1,
        summary: 'Allow explicit Continuation runs targeting only excused objecting seats.',
        clauses: [
          {
            id: 'C1',
            context: 'Immutability and lineage',
            conclusion: 'Continuation creates a distinct run linked via parentRunId and rootRunId.',
            citedProofIds: ['P1', 'P2']
          }
        ]
      }
    },
    history: ['[ROUND 1] Completed with preserved objection OBJ-1.'],
    ...overrides
  };
}

async function runCliBuffered(args, extraIo = {}) {
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  let stdoutText = '';
  let stderrText = '';
  stdoutStream.on('data', (chunk) => {
    stdoutText += chunk.toString('utf8');
  });
  stderrStream.on('data', (chunk) => {
    stderrText += chunk.toString('utf8');
  });

  const returnedExit = await runCli(args, {
    stdout: stdoutStream,
    stderr: stderrStream,
    exit: (code) => code,
    registerSignalHandlers: false,
    ...extraIo
  });

  return { exitCode: returnedExit, stdoutText, stderrText };
}

describe('Issue #108 Continuation for Preserved Excused-Seat Objections (ADR-0006)', () => {
  it('validates strict parent eligibility and rejects every ineligible state before provider calls', async () => {
    const valid = validateContinuationEligibility(makeParentState());
    assert.equal(valid.valid, true);
    assert.equal(valid.targetSeats.length, 1);
    assert.equal(valid.targetSeats[0].id, 'seat-c');
    assert.equal(valid.preservedObjections.length, 1);
    assert.equal(valid.priorAcceptedSeats.length, 2);

    const ineligibleCases = [
      ['null state', null],
      ['incomplete phase', makeParentState({ phase: 'confirming' })],
      [
        'Unanimous Consensus verdict',
        makeParentState({ verdict: { kind: VERDICT_KINDS.UNANIMOUS_CONSENSUS, round: 1 } })
      ],
      [
        'Below Quorum verdict',
        makeParentState({ verdict: { kind: VERDICT_KINDS.BELOW_QUORUM, round: 1 } })
      ],
      [
        'Round Limit Reached verdict',
        makeParentState({ verdict: { kind: VERDICT_KINDS.ROUND_LIMIT_REACHED, round: 2 } })
      ],
      [
        'Judge Fault verdict',
        makeParentState({ verdict: { kind: VERDICT_KINDS.JUDGE_FAULT, round: 1 } })
      ],
      [
        'Continuation Objection Reaffirmed verdict',
        makeParentState({ verdict: { kind: VERDICT_KINDS.DISSENT_CONTINUATION_REAFFIRMED, round: 1 } })
      ],
      ['missing candidate', makeParentState({ candidate: null, verdict: { kind: VERDICT_KINDS.DISSENT_PRESERVED_OBJECTION, candidate: null } })],
      ['empty candidate clauses', makeParentState({ candidate: { summary: 'Test', clauses: [] } })],
      [
        'zero preserved_excused objections',
        makeParentState({
          objections: [{ id: 'OBJ-1', seatId: 'seat-c', reason: 'Withdrawn', proofId: 'P1', status: 'withdrawn' }]
        })
      ],
      [
        'active open objection present',
        makeParentState({
          objections: [
            { id: 'OBJ-1', seatId: 'seat-c', reason: 'Preserved', proofId: 'P1', status: 'preserved_excused' },
            { id: 'OBJ-2', seatId: 'seat-a', reason: 'Open', proofId: 'P1', status: 'open' }
          ]
        })
      ],
      [
        'active seats below minQuorum',
        makeParentState({
          minQuorum: 3,
          seats: [
            { ...makeSeat('seat-a'), status: 'accepted' },
            { ...makeSeat('seat-b'), status: 'accepted' },
            { ...makeSeat('seat-c'), status: 'excused' }
          ]
        })
      ],
      [
        'non-accepted active seat',
        makeParentState({
          seats: [
            { ...makeSeat('seat-a'), status: 'accepted' },
            { ...makeSeat('seat-b'), status: 'thinking' },
            { ...makeSeat('seat-c'), status: 'excused' }
          ]
        })
      ],
      [
        'preserved objection referencing unknown seat',
        makeParentState({
          objections: [
            { id: 'OBJ-1', seatId: 'seat-missing', reason: 'Lost', proofId: 'P1', status: 'preserved_excused' }
          ]
        })
      ],
      [
        'preserved objection referencing accepted seat',
        makeParentState({
          objections: [
            { id: 'OBJ-1', seatId: 'seat-a', reason: 'Not excused', proofId: 'P1', status: 'preserved_excused' }
          ]
        })
      ],
      [
        'zero admitted proofs',
        makeParentState({
          proofs: [{ id: 'P1', round: 1, seatId: 'seat-a', ...makeProof('1'), status: 'rejected', note: 'Rejected' }]
        })
      ]
    ];

    for (const [label, candidateState] of ineligibleCases) {
      const check = validateContinuationEligibility(candidateState);
      assert.equal(check.valid, false, `Expected "${label}" to fail eligibility`);
      assert.ok(check.errors.length >= 1, `Expected diagnostic error for "${label}"`);
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-108-inelig-'));
    try {
      const outputDir = path.join(tmpDir, 'out');
      const telemetryDir = path.join(tmpDir, 'tel');
      fs.mkdirSync(outputDir, { recursive: true });
      const ineligibleSnap = path.join(tmpDir, 'unanimous.json');
      fs.writeFileSync(
        ineligibleSnap,
        JSON.stringify(
          makeParentState({
            verdict: { kind: VERDICT_KINDS.UNANIMOUS_CONSENSUS, round: 1 }
          }),
          null,
          2
        )
      );
      const corruptSnap = path.join(tmpDir, 'corrupt.json');
      fs.writeFileSync(corruptSnap, '{ invalid json');

      let resolverCalled = 0;
      const harnessResolver = () => {
        resolverCalled += 1;
        return new MockAdapter();
      };

      const badSnapRes = await runCliBuffered(['continue', ineligibleSnap, '--mock'], {
        outputDir,
        telemetryDir,
        harnessResolver
      });
      assert.equal(badSnapRes.exitCode, 1);
      assert.match(badSnapRes.stderrText, /Continuation error: Continuation requires Verdict/);
      assert.equal(resolverCalled, 0);

      const corruptRes = await runCliBuffered(['continue', corruptSnap, '--mock'], {
        outputDir,
        telemetryDir,
        harnessResolver
      });
      assert.equal(corruptRes.exitCode, 1);
      assert.equal(resolverCalled, 0);

      const missingRunRes = await runCliBuffered(['continue', 'does-not-exist-999', '--mock'], {
        outputDir,
        telemetryDir,
        harnessResolver
      });
      assert.equal(missingRunRes.exitCode, 1);
      assert.match(missingRunRes.stderrText, /Parent run or snapshot not found/);
      assert.equal(resolverCalled, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('ratifies a single preserved objection to Unanimous Consensus while preserving identity, tools, and immutability', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-108-single-'));
    try {
      const outputDir = path.join(tmpDir, 'runs');
      const telemetryDir = path.join(tmpDir, 'telemetry');
      fs.mkdirSync(outputDir, { recursive: true });

      const parentState = makeParentState({
        seats: [
          { ...makeSeat('seat-a'), status: 'accepted' },
          { ...makeSeat('seat-b'), status: 'accepted' },
          {
            ...makeSeat('seat-c', {
              harness: 'antigravity',
              model: 'gemini-3.5-pro',
              reasoningEffort: 'xhigh',
              tools: 'read-only',
              cwd: tmpDir
            }),
            status: 'excused',
            excusedReason: 'Timed out waiting for response after retries'
          },
          {
            ...makeSeat('seat-d-no-obj', {
              harness: 'cursor',
              model: 'opus-4.6',
              tools: 'read-only',
              cwd: tmpDir
            }),
            status: 'excused',
            excusedReason: 'Excused without any preserved objection'
          }
        ]
      });
      const parentSnapshotPath = path.join(tmpDir, 'parent-snapshot.json');
      fs.writeFileSync(parentSnapshotPath, JSON.stringify(parentState, null, 2));
      const parentHashBefore = sha256File(parentSnapshotPath);

      // Refuse self-overwrite when --snapshot points to the parent snapshot path
      let selfOverwriteCalls = 0;
      const selfOverwriteRes = await runCliBuffered(
        ['continue', parentSnapshotPath, '--mock', '--snapshot', parentSnapshotPath],
        {
          outputDir,
          telemetryDir,
          harnessResolver: () => {
            selfOverwriteCalls += 1;
            return new MockAdapter();
          }
        }
      );
      assert.equal(selfOverwriteRes.exitCode, 1);
      assert.match(selfOverwriteRes.stderrText, /Refusing to overwrite parent snapshot/i);
      assert.equal(selfOverwriteCalls, 0);
      assert.equal(sha256File(parentSnapshotPath), parentHashBefore);

      // Continuation prompt explicitly includes Continuation header + preserved objection
      const contDraftState = createContinuationCouncilState(parentState, {
        parentRunId: parentState.runId,
        rootRunId: parentState.runId
      });
      const renderedPrompt = formatVotingPrompt({
        soul: contDraftState.seats[2].soul,
        seat: contDraftState.seats[2],
        topic: contDraftState.topic,
        candidate: contDraftState.candidate,
        admittedProofs: contDraftState.proofs,
        myOpenObjections: [],
        state: contDraftState,
        tools: 'read-only',
        cwd: tmpDir
      });
      assert.match(renderedPrompt, /Continuation Ratification Vote/);
      assert.match(renderedPrompt, /Your Preserved Objection\(s\) from the Parent Run/);
      assert.match(renderedPrompt, /\[OBJ-1\] \(Round 1, backed by Proof P2\)/);

      const capturedCalls = [];
      const mockAdapter = new MockAdapter();
      for (const sid of ['seat-a', 'seat-b', 'seat-c', 'seat-d-no-obj']) {
        mockAdapter.scriptSeatResponse({
          seatId: sid,
          phase: 'VOTING',
          response: async (ctx) => {
            capturedCalls.push({
              id: ctx.seat.id,
              harness: ctx.seat.harness,
              model: ctx.seat.model,
              soul: ctx.seat.soul,
              reasoningEffort: ctx.seat.reasoningEffort,
              tools: ctx.tools,
              cwd: ctx.cwd,
              seatTools: ctx.seat.tools,
              preservedCount: (ctx.state?.objections || []).filter((o) => o.status === 'preserved_excused').length
            });
            return {
              vote: 'accept',
              reason: 'Verified concurrent snapshot safety using workspace tools.',
              proofId: 'P2',
              telemetry: {
                toolCalls: [{ tool: 'read_file', path: 'src/engine/continuation.js' }],
                providerCalls: [
                  {
                    model: ctx.seat.model,
                    reasoningEffort: ctx.seat.reasoningEffort,
                    inputTokens: 420,
                    outputTokens: 95
                  }
                ],
                inputTokens: 420,
                outputTokens: 95,
                totalTokens: 515
              }
            };
          }
        });
      }

      const outSnapshotPath = path.join(tmpDir, 'cont-out-snapshot.json');
      const cliRes = await runCliBuffered(
        [
          'continue',
          parentSnapshotPath,
          '--mock',
          '--output-dir',
          outputDir,
          '--telemetry-dir',
          telemetryDir,
          '--snapshot',
          outSnapshotPath,
          '--json'
        ],
        {
          persistMockTelemetry: true,
          harnessResolver: () => mockAdapter
        }
      );

      assert.equal(cliRes.exitCode, 0, cliRes.stderrText);
      assert.equal(mockAdapter.callCount.judge, 0, 'Judge must not be invoked during Continuation');
      assert.equal(capturedCalls.length, 1, 'Only the excused objecting seat may be invoked');
      assert.equal(capturedCalls[0].id, 'seat-c');
      assert.equal(capturedCalls[0].harness, 'antigravity');
      assert.equal(capturedCalls[0].model, 'gemini-3.5-pro');
      assert.match(capturedCalls[0].soul, /Reviewer seat-c/);
      assert.equal(capturedCalls[0].reasoningEffort, 'xhigh', 'Must not downshift reasoningEffort in Continuation');
      assert.equal(capturedCalls[0].tools, 'read-only', 'Must preserve read-only tool access');
      assert.equal(capturedCalls[0].seatTools, 'read-only');
      assert.equal(capturedCalls[0].cwd, tmpDir);
      assert.equal(capturedCalls[0].preservedCount, 1);

      // Parent snapshot strictly untouched
      assert.equal(sha256File(parentSnapshotPath), parentHashBefore);

      // CLI JSON payload & artifacts
      const parsedCli = JSON.parse(cliRes.stdoutText);
      assert.equal(parsedCli.ok, true);
      assert.ok(typeof parsedCli.runId === 'string' && parsedCli.runId.length > 0);
      assert.notEqual(parsedCli.runId, 'run-parent-1');
      assert.equal(parsedCli.state.runId, parsedCli.runId);
      assert.equal(parsedCli.verdict.kind, VERDICT_KINDS.UNANIMOUS_CONSENSUS);
      assert.equal(parsedCli.parentRunId, 'run-parent-1');
      assert.equal(parsedCli.rootRunId, 'run-parent-1');
      assert.equal(parsedCli.verdict.parentRunId, 'run-parent-1');
      assert.equal(parsedCli.verdict.rootRunId, 'run-parent-1');
      assert.deepEqual(parsedCli.verdict.continuation.ratifiedSeatIds, ['seat-c']);
      assert.deepEqual(parsedCli.verdict.continuation.priorAcceptedSeatIds, ['seat-a', 'seat-b']);

      assert.ok(Array.isArray(parsedCli.providerCalls));

      // Snapshot written atomically with final state & withdrawn preserved objection
      const outSnap = JSON.parse(fs.readFileSync(outSnapshotPath, 'utf8'));
      assert.equal(outSnap.runId, parsedCli.runId);
      assert.equal(outSnap.parentRunId, 'run-parent-1');
      assert.equal(outSnap.rootRunId, 'run-parent-1');
      assert.equal(outSnap.state.runId, parsedCli.runId);
      assert.equal(outSnap.state.objections.find((o) => o.id === 'OBJ-1').status, 'withdrawn');

      // Visualizer bundle, meta.json, and telemetry ledger persisted with lineage
      const bundleJsPath = path.join(outputDir, `${parsedCli.runId}.js`);
      const metaJsonPath = path.join(outputDir, `${parsedCli.runId}.meta.json`);
      assert.ok(fs.existsSync(bundleJsPath));
      assert.ok(fs.existsSync(metaJsonPath));
      const meta = JSON.parse(fs.readFileSync(metaJsonPath, 'utf8'));
      assert.equal(meta.parentRunId, 'run-parent-1');
      assert.equal(meta.rootRunId, 'run-parent-1');
      assert.equal(meta.runKind, 'continuation');

      const bundle = parseRunBundleJs(fs.readFileSync(bundleJsPath, 'utf8'));
      assert.equal(bundle.parsedRun.runId, parsedCli.runId);
      assert.equal(bundle.parsedRun.parentRunId, 'run-parent-1');
      assert.equal(bundle.parsedRun.rootRunId, 'run-parent-1');
      assert.equal(bundle.parsedRun.runKind, 'continuation');
      assert.ok(Array.isArray(bundle.parsedRun.steps) && bundle.parsedRun.steps.length >= 2);
      assert.equal(bundle.parsedRun.currentState.verdict.kind, VERDICT_KINDS.UNANIMOUS_CONSENSUS);

      const telemetrySummary = loadTelemetrySummary({ telemetryDir, outputDir, includeMock: true });
      const recordedRun = telemetrySummary.runs.find((r) => r.runId === parsedCli.runId);
      assert.ok(recordedRun);
      assert.equal(recordedRun.parentRunId, 'run-parent-1');
      assert.equal(recordedRun.rootRunId, 'run-parent-1');
      assert.equal(recordedRun.verdictKind, VERDICT_KINDS.UNANIMOUS_CONSENSUS);
      assert.equal(recordedRun.seats.find((s) => s.seatId === 'seat-c')?.status, 'accepted');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles multiple excused objecting seats: consensus, dissent reaffirmation, and repeated timeout fault', async () => {
    const multiParent = makeParentState({
      runId: 'run-multi-parent',
      seats: [
        { ...makeSeat('seat-a'), status: 'accepted' },
        { ...makeSeat('seat-b'), status: 'accepted' },
        { ...makeSeat('seat-c', { harness: 'antigravity', model: 'gemini-3.5-pro' }), status: 'excused', excusedReason: 'Timed out' },
        { ...makeSeat('seat-d', { harness: 'cursor', model: 'opus-4.6' }), status: 'excused', excusedReason: 'Timed out' }
      ],
      objections: [
        { id: 'OBJ-1', seatId: 'seat-c', round: 1, reason: 'Check concurrency lock.', proofId: 'P1', status: 'preserved_excused' },
        { id: 'OBJ-2', seatId: 'seat-d', round: 1, reason: 'Check schema validation.', proofId: 'P2', status: 'preserved_excused' }
      ]
    });

    // Case A: Both accept -> Unanimous Consensus
    {
      const seen = [];
      const adapter = new MockAdapter();
      for (const sid of ['seat-c', 'seat-d']) {
        adapter.scriptSeatResponse({
          seatId: sid,
          phase: 'VOTING',
          response: async (ctx) => {
            seen.push(ctx.seat.id);
            return { vote: 'accept', reason: 'Verified.', proofId: 'P1' };
          }
        });
      }
      const registry = new Map([
        ['antigravity', adapter],
        ['cursor', adapter],
        ['codex', adapter]
      ]);
      const res = await CouncilEngine.runContinuation(multiParent, {
        runId: 'cont-multi-accept',
        harnessRegistry: registry
      });
      assert.equal(res.ok, true);
      assert.equal(res.state.runId, 'cont-multi-accept');
      assert.notEqual(res.state.runId, multiParent.runId);
      assert.equal(res.verdict.kind, VERDICT_KINDS.UNANIMOUS_CONSENSUS);
      assert.deepEqual(seen.sort(), ['seat-c', 'seat-d']);
      assert.ok(res.state.objections.every((o) => o.status === 'withdrawn'));
    }

    // Case B: One accepts, one reaffirms dissent -> Dissent Report (Continuation Objection Reaffirmed)
    {
      const adapter = new MockAdapter();
      adapter.scriptSeatResponse({
        seatId: 'seat-c',
        phase: 'VOTING',
        response: () => ({ vote: 'accept', reason: 'Lock check passes.', proofId: 'P1' })
      });
      adapter.scriptSeatResponse({
        seatId: 'seat-d',
        phase: 'VOTING',
        response: () => ({
          vote: 'object',
          reason: 'Schema validation gap confirmed in parser fallback.',
          proofId: 'P2'
        })
      });
      const res = await runContinuation(multiParent, {
        runId: 'cont-multi-reaffirm',
        harnessRegistry: new Map([
          ['antigravity', adapter],
          ['cursor', adapter],
          ['codex', adapter]
        ])
      });
      assert.equal(res.ok, false);
      assert.equal(adapter.callCount.judge, 0);
      assert.equal(res.verdict.kind, VERDICT_KINDS.DISSENT_CONTINUATION_REAFFIRMED);
      assert.equal(res.verdict.parentRunId, 'run-multi-parent');
      assert.equal(res.verdict.rootRunId, 'run-multi-parent');
      assert.equal(res.state.objections.find((o) => o.id === 'OBJ-1').status, 'withdrawn');
      assert.equal(res.state.objections.find((o) => o.id === 'OBJ-2').status, 'preserved_excused');
      const reaffirmed = res.state.objections.find((o) => o.seatId === 'seat-d' && o.status === 'open');
      assert.ok(reaffirmed, 'Reaffirmed objection should be recorded as open alongside original preserved objection');
      assert.match(reaffirmed.reason, /Schema validation gap confirmed/);
      assert.equal(res.state.round, 1, 'Must never re-open deliberation rounds');
      assert.equal(validateContinuationEligibility(res.state).valid, false);
    }

    // Case C: One accepts, one times out -> retries without stripping tools or downshifting effort, then re-excuses cleanly
    {
      let seatDAttempts = 0;
      const seenAttempts = [];
      const adapter = new MockAdapter();
      adapter.scriptSeatResponse({
        seatId: 'seat-c',
        phase: 'VOTING',
        response: () => ({ vote: 'accept', reason: 'Verified.', proofId: 'P1' })
      });
      adapter.scriptSeatResponse({
        seatId: 'seat-d',
        phase: 'VOTING',
        response: (ctx) => {
          seatDAttempts += 1;
          seenAttempts.push({
            tools: ctx.tools,
            cwd: ctx.cwd,
            model: ctx.seat.model,
            reasoningEffort: ctx.seat.reasoningEffort
          });
          throw new TimeoutError('Seat timed out during continuation confirmation', 5000);
        }
      });
      const res = await runContinuation(
        { ...multiParent, selfContainedInput: 'Self-contained candidate text' },
        {
          runId: 'cont-multi-fault',
          maxRetriesPerSeat: 1,
          retryEffortFallback: true,
          harnessRegistry: new Map([
            ['antigravity', adapter],
            ['cursor', adapter],
            ['codex', adapter]
          ])
        }
      );
      assert.equal(res.ok, false);
      assert.equal(seatDAttempts, 2, 'Continuation TimeoutError retries with read-only tools and original effort');
      assert.deepEqual(seenAttempts, [
        { tools: 'read-only', cwd: '/tmp/workspace-a', model: 'opus-4.6', reasoningEffort: 'xhigh' },
        { tools: 'read-only', cwd: '/tmp/workspace-a', model: 'opus-4.6', reasoningEffort: 'xhigh' }
      ]);
      assert.equal(res.verdict.kind, VERDICT_KINDS.DISSENT_PRESERVED_OBJECTION);
      assert.equal(res.state.objections.find((o) => o.id === 'OBJ-1').status, 'withdrawn');
      assert.equal(res.state.objections.find((o) => o.id === 'OBJ-2').status, 'preserved_excused');
      assert.equal(res.state.seats.find((s) => s.id === 'seat-d').status, 'excused');
    }

    // Case D: Transient retryable vote fault retries up to maxRetriesPerSeat without dropping tools, then preserves objection
    {
      let seatDAttempts = 0;
      const seenTools = [];
      const adapter = new MockAdapter();
      adapter.scriptSeatResponse({
        seatId: 'seat-c',
        phase: 'VOTING',
        response: () => ({ vote: 'accept', reason: 'Verified.', proofId: 'P1' })
      });
      adapter.scriptSeatResponse({
        seatId: 'seat-d',
        phase: 'VOTING',
        response: (ctx) => {
          seatDAttempts += 1;
          seenTools.push(ctx.tools);
          return { invalidPayload: true }; // InvalidResponseError from missing valid vote schema
        }
      });
      const res = await runContinuation(multiParent, {
        runId: 'cont-multi-retry-exhausted',
        maxRetriesPerSeat: 1,
        harnessRegistry: new Map([
          ['antigravity', adapter],
          ['cursor', adapter],
          ['codex', adapter]
        ])
      });
      assert.equal(res.ok, false);
      assert.equal(seatDAttempts, 2, 'Initial attempt + 1 retry for malformed Continuation response');
      assert.deepEqual(seenTools, ['read-only', 'read-only']);
      assert.equal(res.verdict.kind, VERDICT_KINDS.DISSENT_PRESERVED_OBJECTION);
      assert.equal(res.state.objections.find((o) => o.id === 'OBJ-2').status, 'preserved_excused');
    }
  });

  it('supports chained Continuation from an end-to-end parent run via runId and --snapshot preserving parentRunId and rootRunId', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-108-chain-'));
    try {
      const outputDir = path.join(tmpDir, 'out');
      const telemetryDir = path.join(tmpDir, 'tel');
      fs.mkdirSync(outputDir, { recursive: true });

      const configPath = path.join(tmpDir, 'council.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          {
            topic: 'Verify Continuation lineage across chained timeouts and consensus',
            minQuorum: 2,
            maxRounds: 2,
            maxRetriesPerSeat: 0,
            timeoutMs: 120000,
            totalSeatBudgetMs: 300000,
            tools: 'read-only',
            cwd: tmpDir,
            seats: [
              makeSeat('seat-a', { cwd: tmpDir }),
              makeSeat('seat-b', { cwd: tmpDir }),
              makeSeat('seat-c', { harness: 'antigravity', model: 'gemini-3.5-pro', cwd: tmpDir })
            ],
            judge: {
              id: 'judge-1',
              harness: 'codex',
              model: 'gpt-6.2-sol',
              reasoningEffort: 'xhigh',
              tools: 'none'
            }
          },
          null,
          2
        )
      );

      // Run A (`council run`): round 1 seat-c objects; round 2 seat-c times out -> preserved objection
      const runAAdapter = new MockAdapter();
      runAAdapter.scriptSeatResponse({
        seatId: 'seat-c',
        round: 1,
        phase: 'VOTING',
        response: () => ({
          vote: 'object',
          reason: 'Require verification pass in round 2.',
          proofId: 'P3'
        })
      });
      runAAdapter.injectSeatFault('seat-c', {
        round: 2,
        phase: 'VOTING',
        error: new TimeoutError('Seat timed out during round 2 confirmation', 120000)
      });

      const runASnapshot = path.join(tmpDir, 'run-A-snapshot.json');
      const runACli = await runCliBuffered(
        [
          'run',
          '--config',
          configPath,
          '--mock',
          '--output-dir',
          outputDir,
          '--telemetry-dir',
          telemetryDir,
          '--snapshot',
          runASnapshot,
          '--json'
        ],
        {
          persistMockTelemetry: true,
          harnessResolver: () => runAAdapter
        }
      );
      assert.equal(runACli.exitCode, 2, runACli.stderrText);
      const parsedA = JSON.parse(runACli.stdoutText);
      const snapA = JSON.parse(fs.readFileSync(runASnapshot, 'utf8'));
      const runAId = parsedA.runId || snapA.runId;
      assert.ok(runAId);
      assert.equal(parsedA.verdict.kind, VERDICT_KINDS.DISSENT_PRESERVED_OBJECTION);

      const runASnapHashBefore = sha256File(runASnapshot);

      // Verify invalid --backend fails cleanly before provider calls
      const badBackendRes = await runCliBuffered(
        ['continue', runASnapshot, '--mock', '--backend', 'invalid-backend'],
        {
          outputDir,
          telemetryDir,
          harnessResolver: () => {
            throw new Error('Should not resolve adapter on invalid --backend');
          }
        }
      );
      assert.equal(badBackendRes.exitCode, 1);
      assert.match(badBackendRes.stderrText, /Configuration error:/);

      // Run B (`council continue runASnapshot`): seat-c times out again -> preserved objection
      const timeoutAdapter = new MockAdapter();
      timeoutAdapter.scriptSeatResponse({
        seatId: 'seat-c',
        phase: 'VOTING',
        response: () => {
          throw new TimeoutError('Gemini timeout in continuation pass 1', 120000);
        }
      });
      const runBCli = await runCliBuffered(
        [
          'continue',
          runASnapshot,
          '--mock',
          '--output-dir',
          outputDir,
          '--telemetry-dir',
          telemetryDir,
          '--timeout',
          '600000',
          '--seat-budget',
          '1200000',
          '--backend',
          't3',
          '--json'
        ],
        {
          persistMockTelemetry: true,
          harnessResolver: () => timeoutAdapter
        }
      );
      assert.equal(runBCli.exitCode, 2, runBCli.stderrText);
      const parsedB = JSON.parse(runBCli.stdoutText);
      const runBId = parsedB.runId;
      assert.ok(runBId && runBId !== runAId);
      assert.equal(parsedB.verdict.kind, VERDICT_KINDS.DISSENT_PRESERVED_OBJECTION);
      assert.equal(parsedB.parentRunId, runAId);
      assert.equal(parsedB.rootRunId, runAId);

      // Run A snapshot strictly immutable
      assert.equal(sha256File(runASnapshot), runASnapHashBefore);

      // Run C (`council continue runBId`): operational overrides applied & seat-c accepts -> consensus
      const runBJsPath = path.join(outputDir, `${runBId}.js`);
      const runBMetaPath = path.join(outputDir, `${runBId}.meta.json`);
      const runBJsHashBefore = sha256File(runBJsPath);
      const runBMetaHashBefore = sha256File(runBMetaPath);
      const observedC = [];
      const acceptAdapter = new MockAdapter();
      acceptAdapter.scriptSeatResponse({
        seatId: 'seat-c',
        phase: 'VOTING',
        response: async (ctx) => {
          observedC.push({
            id: ctx.seat.id,
            harness: ctx.seat.harness,
            model: ctx.seat.model,
            tools: ctx.tools,
            timeoutMs: ctx.timeoutMs,
            totalSeatBudgetMs: ctx.state.totalSeatBudgetMs
          });
          return {
            vote: 'accept',
            reason: 'Completed verification within extended 600s timeout.',
            proofId: 'P3'
          };
        }
      });

      const runCSnapshot = path.join(tmpDir, 'run-C-snapshot.json');
      const runCCli = await runCliBuffered(
        [
          'continue',
          runBId,
          '--mock',
          '--output-dir',
          outputDir,
          '--telemetry-dir',
          telemetryDir,
          '--timeout',
          '600000',
          '--seat-budget',
          '1200000',
          '--backend',
          't3',
          '--snapshot',
          runCSnapshot,
          '--json'
        ],
        {
          persistMockTelemetry: true,
          harnessResolver: () => acceptAdapter
        }
      );
      assert.equal(runCCli.exitCode, 0, runCCli.stderrText);
      const parsedC = JSON.parse(runCCli.stdoutText);
      assert.equal(parsedC.ok, true);
      assert.equal(parsedC.verdict.kind, VERDICT_KINDS.UNANIMOUS_CONSENSUS);
      assert.equal(parsedC.parentRunId, runBId);
      assert.equal(parsedC.rootRunId, runAId);
      assert.equal(parsedC.verdict.parentRunId, runBId);
      assert.equal(parsedC.verdict.rootRunId, runAId);

      assert.equal(observedC.length, 1);
      assert.equal(observedC[0].id, 'seat-c');
      assert.equal(observedC[0].harness, 'antigravity');
      assert.equal(observedC[0].model, 'gemini-3.5-pro');
      assert.equal(observedC[0].tools, 'read-only');
      assert.equal(observedC[0].timeoutMs, 600000);
      assert.equal(observedC[0].totalSeatBudgetMs, 1200000);

      // Run B artifacts strictly immutable after Run C
      assert.equal(sha256File(runBJsPath), runBJsHashBefore);
      assert.equal(sha256File(runBMetaPath), runBMetaHashBefore);
      assert.equal(sha256File(runASnapshot), runASnapHashBefore);

      // Loader verifies chained parentRunId & rootRunId on run-B
      const loadedB = loadContinuationParent(runBId, { outputDir, cwd: tmpDir });
      assert.equal(loadedB.parentRunId, runBId);
      assert.equal(loadedB.rootRunId, runAId);
      assert.equal(loadedB.state.verdict.kind, VERDICT_KINDS.DISSENT_PRESERVED_OBJECTION);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('keeps ADR-0003 normal-run preserved_excused guards intact and enforces Continuation vote restrictions', () => {
    const parent = makeParentState();
    const contState = createContinuationCouncilState(parent, {
      parentRunId: 'run-parent-1',
      rootRunId: 'run-parent-1'
    });

    // Normal run: WITHDRAW_OBJECTION still rejects preserved_excused
    const normalWithdraw = transitionCouncil(parent, {
      type: COUNCIL_EVENTS.WITHDRAW_OBJECTION,
      seatId: 'seat-c',
      objectionId: 'OBJ-1'
    });
    assert.equal(normalWithdraw.lastTransition.ok, false);
    assert.match(normalWithdraw.lastTransition.message, /locked as preserved_excused/i);

    // Continuation run: non-target seat-a cannot cast a vote
    const strayVote = transitionCouncil(contState, {
      type: COUNCIL_EVENTS.CAST_VOTE,
      seatId: 'seat-a',
      vote: 'accept'
    });
    assert.equal(strayVote.lastTransition.ok, false);
    assert.match(strayVote.lastTransition.message, /not a Continuation ratification target/);

    // Continuation run: target seat-c accepting withdraws OBJ-1 and evaluates to Unanimous Consensus
    const voteAccept = transitionCouncil(contState, {
      type: COUNCIL_EVENTS.CAST_VOTE,
      seatId: 'seat-c',
      vote: 'accept'
    });
    assert.equal(voteAccept.lastTransition.ok, true);
    assert.equal(voteAccept.objections.find((o) => o.id === 'OBJ-1').status, 'withdrawn');

    const evaluated = transitionCouncil(voteAccept, {
      type: COUNCIL_EVENTS.EVALUATE_ROUND
    });
    assert.equal(evaluated.canonicalPhase, 'CONSENSUS_REACHED');
    assert.equal(evaluated.phase, 'completed');
    assert.equal(evaluated.verdict.kind, VERDICT_KINDS.UNANIMOUS_CONSENSUS);
    assert.equal(evaluated.verdict.parentRunId, 'run-parent-1');
    assert.equal(evaluated.verdict.rootRunId, 'run-parent-1');
  });

  it('covers round-1 review regressions: latest.js immutability, exported reasoningEffort, --output-dir without io hook, programmatic chaining without runId, and verdict.candidate fallback', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-108-r1reg-'));
    try {
      const outputDir = path.join(tmpDir, 'runs');
      const telemetryDir = path.join(tmpDir, 'tel');
      fs.mkdirSync(outputDir, { recursive: true });

      // 1. Continuing from latest.js leaves latest.js byte-for-byte intact and writes child run separately
      const parentLatestPath = path.join(outputDir, 'latest.js');
      const parentForLatest = makeParentState({ runId: 'run-latest-parent' });
      const bundleScript = `window.CouncilRuns = window.CouncilRuns || {};\nconst data = ${JSON.stringify({
        id: 'wt-live-latest',
        runId: 'run-latest-parent',
        isRunning: false,
        verdictKind: VERDICT_KINDS.DISSENT_PRESERVED_OBJECTION,
        initialConfig: {
          topic: parentForLatest.topic,
          maxRounds: parentForLatest.maxRounds,
          minQuorum: parentForLatest.minQuorum,
          seats: parentForLatest.seats,
          judge: parentForLatest.judge
        },
        currentState: parentForLatest,
        steps: []
      }, null, 2)};\nwindow.CouncilRuns['run-latest-parent'] = data;\n`;
      fs.writeFileSync(parentLatestPath, bundleScript, 'utf8');
      const latestHashBefore = sha256File(parentLatestPath);

      const latestAdapter = new MockAdapter();
      latestAdapter.scriptSeatResponse({
        seatId: 'seat-c',
        phase: 'VOTING',
        response: () => ({ vote: 'accept', reason: 'Verified.', proofId: 'P2' })
      });

      // Also verifies CLI `--output-dir` + `--telemetry-dir` persist without io.persistMockTelemetry hook
      const fromLatestRes = await runCliBuffered(
        ['continue', parentLatestPath, '--mock', '--output-dir', outputDir, '--telemetry-dir', telemetryDir, '--json'],
        { harnessResolver: () => latestAdapter }
      );
      assert.equal(fromLatestRes.exitCode, 0, fromLatestRes.stderrText);
      const parsedFromLatest = JSON.parse(fromLatestRes.stdoutText);
      assert.equal(sha256File(parentLatestPath), latestHashBefore, 'latest.js must remain untouched when passed as parent');
      assert.ok(fs.existsSync(path.join(outputDir, `${parsedFromLatest.runId}.js`)));
      assert.ok(fs.existsSync(path.join(outputDir, `${parsedFromLatest.runId}.meta.json`)));
      assert.ok(fs.existsSync(path.join(telemetryDir, 'runs', `${parsedFromLatest.runId}.json`)));

      // 1b. Continuing from a symlinked directory alias (runs-alias/latest.js) also leaves latest.js intact
      // and refuses --snapshot targeting the same canonical file via symlink alias
      const aliasDir = path.join(tmpDir, 'runs-alias');
      fs.symlinkSync(outputDir, aliasDir);
      const aliasedLatestPath = path.join(aliasDir, 'latest.js');
      const aliasSnapRefusal = await runCliBuffered(
        ['continue', aliasedLatestPath, '--mock', '--output-dir', outputDir, '--snapshot', parentLatestPath],
        { harnessResolver: () => latestAdapter }
      );
      assert.equal(aliasSnapRefusal.exitCode, 1);
      assert.match(aliasSnapRefusal.stderrText, /Refusing to overwrite parent snapshot/i);
      assert.equal(sha256File(parentLatestPath), latestHashBefore);

      const fromAliasRes = await runCliBuffered(
        ['continue', aliasedLatestPath, '--mock', '--output-dir', outputDir, '--telemetry-dir', telemetryDir, '--json'],
        { harnessResolver: () => latestAdapter }
      );
      assert.equal(fromAliasRes.exitCode, 0, fromAliasRes.stderrText);
      const parsedFromAlias = JSON.parse(fromAliasRes.stdoutText);
      assert.equal(sha256File(parentLatestPath), latestHashBefore, 'symlinked runs-alias/latest.js must not overwrite latest.js');
      assert.ok(fs.existsSync(path.join(outputDir, `${parsedFromAlias.runId}.js`)));

      // 1c. Symlink target with different capitalization on case-insensitive macOS FS (`Runs` -> `runs`)
      const caseAliasDir = path.join(tmpDir, 'runs-case-alias');
      const capitalizedRunsTarget = path.join(path.dirname(outputDir), 'Runs');
      fs.symlinkSync(capitalizedRunsTarget, caseAliasDir);
      const caseAliasedLatestPath = path.join(caseAliasDir, 'latest.js');
      if (fs.existsSync(caseAliasedLatestPath)) {
        const caseSnapRefusal = await runCliBuffered(
          ['continue', caseAliasedLatestPath, '--mock', '--output-dir', outputDir, '--snapshot', parentLatestPath],
          { harnessResolver: () => latestAdapter }
        );
        assert.equal(caseSnapRefusal.exitCode, 1);
        assert.match(caseSnapRefusal.stderrText, /Refusing to overwrite parent snapshot/i);
        assert.equal(sha256File(parentLatestPath), latestHashBefore);

        const fromCaseAliasRes = await runCliBuffered(
          ['continue', caseAliasedLatestPath, '--mock', '--output-dir', outputDir, '--telemetry-dir', telemetryDir, '--json'],
          { harnessResolver: () => latestAdapter }
        );
        assert.equal(fromCaseAliasRes.exitCode, 0, fromCaseAliasRes.stderrText);
        const parsedFromCaseAlias = JSON.parse(fromCaseAliasRes.stdoutText);
        assert.equal(sha256File(parentLatestPath), latestHashBefore, 'case-mismatched symlink target must not overwrite latest.js');
        assert.ok(fs.existsSync(path.join(outputDir, `${parsedFromCaseAlias.runId}.js`)));
      }

      // 2. Normal `council run --snapshot` preserves configured reasoningEffort across continuation
      const cfgPath = path.join(tmpDir, 'effort-cfg.json');
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({
          topic: 'Preserve reasoningEffort across parent snapshot export',
          minQuorum: 2,
          maxRounds: 2,
          maxRetriesPerSeat: 0,
          tools: 'read-only',
          cwd: tmpDir,
          seats: [
            makeSeat('seat-a', { cwd: tmpDir }),
            makeSeat('seat-b', { cwd: tmpDir }),
            makeSeat('seat-c', { harness: 'antigravity', model: 'gemini-3.5-pro', reasoningEffort: 'xhigh', cwd: tmpDir })
          ],
          judge: { id: 'judge-1', harness: 'codex', model: 'gpt-6.2-sol', reasoningEffort: 'xhigh', tools: 'none' }
        })
      );
      const runAdapter = new MockAdapter();
      runAdapter.scriptSeatResponse({
        seatId: 'seat-c',
        round: 1,
        phase: 'VOTING',
        response: () => ({ vote: 'object', reason: 'Need check in round 2.', proofId: 'P3' })
      });
      runAdapter.injectSeatFault('seat-c', {
        round: 2,
        phase: 'VOTING',
        error: new TimeoutError('Timeout after round 2 review', 120000)
      });
      const exportedParentSnap = path.join(tmpDir, 'exported-parent.json');
      const runRes = await runCliBuffered(
        ['run', '--config', cfgPath, '--mock', '--snapshot', exportedParentSnap, '--json'],
        { harnessResolver: () => runAdapter }
      );
      assert.equal(runRes.exitCode, 2, runRes.stderrText);

      const seenEffort = [];
      const contFromExportAdapter = new MockAdapter();
      contFromExportAdapter.scriptSeatResponse({
        seatId: 'seat-c',
        phase: 'VOTING',
        response: (ctx) => {
          seenEffort.push(ctx.seat.reasoningEffort);
          return { vote: 'accept', reason: 'Confirmed.', proofId: 'P3' };
        }
      });
      const contExportRes = await runCliBuffered(
        ['continue', exportedParentSnap, '--mock', '--json'],
        { harnessResolver: () => contFromExportAdapter }
      );
      assert.equal(contExportRes.exitCode, 0, contExportRes.stderrText);
      assert.deepEqual(seenEffort, ['xhigh'], 'Exported snapshot must preserve seat reasoningEffort');

      // 3. Programmatic runContinuation without explicit runId can be chained cleanly
      const faultAdapter = new MockAdapter();
      faultAdapter.scriptSeatResponse({
        seatId: 'seat-c',
        phase: 'VOTING',
        response: () => {
          throw new TimeoutError('Timed out in pass 1', 10000);
        }
      });
      const chain1 = await runContinuation(makeParentState({ runId: 'prog-root' }), {
        maxRetriesPerSeat: 0,
        harnessResolver: () => faultAdapter
      });
      assert.equal(chain1.ok, false);
      assert.ok(typeof chain1.runId === 'string' && chain1.runId.length > 0);
      assert.equal(chain1.state.runId, chain1.runId);
      assert.notEqual(chain1.runId, 'prog-root');

      const acceptChainAdapter = new MockAdapter();
      acceptChainAdapter.scriptSeatResponse({
        seatId: 'seat-c',
        phase: 'VOTING',
        response: () => ({ vote: 'accept', reason: 'Resolved.', proofId: 'P2' })
      });
      const chain2 = await runContinuation(chain1.state, {
        harnessResolver: () => acceptChainAdapter
      });
      assert.equal(chain2.ok, true);
      assert.equal(chain2.parentRunId, chain1.runId);
      assert.equal(chain2.rootRunId, 'prog-root');

      // 4. Parent with state.candidate: null and valid verdict.candidate populates continuation candidate
      const verdictCandidateOnly = makeParentState({
        runId: 'verdict-cand-only',
        candidate: null
      });
      const seenCandidateSummaries = [];
      const candAdapter = new MockAdapter();
      candAdapter.scriptSeatResponse({
        seatId: 'seat-c',
        phase: 'VOTING',
        response: (ctx) => {
          seenCandidateSummaries.push(ctx.state?.candidate?.summary ?? null);
          return { vote: 'accept', reason: 'Accepted verdict candidate.', proofId: 'P2' };
        }
      });
      const candRes = await runContinuation(verdictCandidateOnly, {
        harnessResolver: () => candAdapter
      });
      assert.equal(candRes.ok, true);
      assert.equal(seenCandidateSummaries[0], verdictCandidateOnly.verdict.candidate.summary);
      assert.equal(candRes.verdict.candidate.summary, verdictCandidateOnly.verdict.candidate.summary);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
