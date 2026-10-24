#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { JsonValue, RunOutcome, RunRequest, RunSnapshot } from '../domain/contracts.js';
import { canonicalJson, hashArtifact } from '../domain/hash.js';
import { localIdSchema, runScopeSchema } from '../domain/schemas.js';
import { loadCouncilConfig, resolveConfigPath } from '../config/load.js';
import { freezeProfile, initialProfileInput, type ProfileInput } from '../input/profiles.js';
import { handoffInputSchema, writeHandoff } from '../input/handoff.js';
import { readArtifact } from '../store/artifacts.js';
import { openRunReader, openRunStore, type RunStore } from '../store/run-store.js';
import { candidateInputs, describeCandidate, runController, type CandidateAction, type ControllerOptions } from '../runtime/controller.js';
import { controlRequestSchema, readBoundedJson, submitControl, type ControlRequest } from '../runtime/inbox.js';
import { systemClock } from '../runtime/clocks.js';
import { readExecutionProjection, resourcesSettled } from '../runtime/reconcile.js';
import { OrcaTransport, qualifyRoute } from '../orca/transport.js';
import { qualificationRequirementSchema } from '../policy/qualification.js';
import { parseArgs } from './parse.js';

export interface CliIo {
  stdout(text: string): void; stderr(text: string): void;
  cwd?: string; packageRoot?: string;
  profileInput?(artifactRoot: string): ProfileInput;
  controller?(store: RunStore): Omit<ControllerOptions, 'mode' | 'root' | 'runId' | 'request' | 'store'>;
  wait?(milliseconds: number): Promise<void>;
}
export const runInputSchema = z.strictObject({
  runId: localIdSchema.optional(), topic: z.string().min(1), handoff: handoffInputSchema, scope: runScopeSchema,
  maxClarificationBatches: z.number().int().positive().default(2), maxRounds: z.number().int().positive().default(3),
  workerTimeoutMs: z.number().int().positive().max(1800000).default(1800000), activeBudgetMs: z.number().int().positive().default(10800000),
});
export function runRoot(workspace: string, runId: string): string {
  localIdSchema.parse(runId); let root = realpathSync(workspace);
  for (const component of ['.council', 'runs', runId]) {
    root = join(root, component); const entry = lstatSync(root, { throwIfNoEntry: false });
    if (entry && (entry.isSymbolicLink() || !entry.isDirectory() || realpathSync(root) !== root)) throw new Error('CONTROL_PATH_INVALID');
  }
  return root;
}
export function inspectRun(root: string, runId: string) {
  const reader = openRunReader(root);
  try {
    const s = reader.load(runId), c = s.context;
    let pendingCandidate: CandidateAction | null = null;
    if (s.state === 'prepare_candidate' && c.control.candidateRequested) {
      const value = candidateInputs(s), sha256 = hashArtifact('candidate-input', value), ref = { kind: 'candidate-input', sha256, bytes: Buffer.byteLength(canonicalJson(value)), path: join(root, 'artifacts', 'candidate-input', sha256, 'blob') };
      try { readArtifact(ref, join(root, 'artifacts')); pendingCandidate = describeCandidate(s, ref); } catch { /* The committed intent may still await its artifact publication. */ }
    }
    return { runId, revision: s.revision, state: s.state, pendingOutcome: c.pendingOutcome, pauseReason: c.pauseReason,
      configHash: c.config.configHash, profileHash: c.profile.profileHash, contextHash: c.sharedContext.contextHash,
      roundsUsed: c.roundsUsed, clarificationBatchesUsed: c.clarificationBatchesUsed, callsReserved: c.callsReserved,
      remainingBudgetMs: c.activeBudget.remainingMs, budgetStatus: c.activeBudget.status, effectiveLimits: c.effectiveLimits,
      pendingQuestion: c.control.questionBatch, answerDraft: c.control.pendingAnswerBatch, pendingContextUpdate: c.pendingContextUpdate,
      pendingCandidate, execution: readExecutionProjection(root, runId),
      action_required: s.state === 'prepare_candidate' && c.control.candidateRequested ? 'candidate' : null,
      candidateInputs: s.state === 'prepare_candidate' && c.control.candidateRequested ? { round: c.roundsUsed, config: c.config, profile: c.profile, context: c.sharedContext, ledger: c.questionLedger, reviews: c.phaseResults, objections: c.objections, evidence: c.control.evidence, requiredEvidenceIds: c.requiredEvidenceIds } : null,
      resources: Object.values(c.issuedLogicalTasks).map(task => ({ logicalTaskKey: task.reservation.logicalTaskKey, stage: task.stage, settlement: task.settlement, binding: task.binding })),
      settlement: resourcesSettled(s) && ['completed', 'cancelled', 'needs_user', 'needs_context', 'blocked'].includes(s.state) ? 'settled' : 'unverifiable', inferenceBlock: c.inferenceBlock };
  } finally { reader.close(); }
}
export function outcomeExitCode(outcome: RunOutcome): number {
  if (outcome.settlement !== 'settled') return 3;
  if (outcome.state === 'cancelled') return 130;
  if (outcome.state === 'completed' && outcome.decision === 'unanimous') return 0;
  return outcome.state === 'needs_user' || outcome.state === 'needs_context' ? 2 : 3;
}
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const output = (value: unknown) => io.stdout(`${JSON.stringify(value)}\n`);
  let store: RunStore | null = null;
  try {
    const args = parseArgs(argv), cwd = io.cwd ?? process.cwd(), workspace = realpathSync(resolve(cwd, args.workspace));
    if (args.command === 'inspect') { output(inspectRun(runRoot(workspace, args.run!), args.run!)); return 0; }
    if (args.command === 'respond') {
      const request = controlRequestSchema.parse(readBoundedJson(resolve(cwd, args.input!))) as ControlRequest;
      if (request.runId !== args.run) throw new Error('CONTROL_RUN_MISMATCH');
      output(await submitControl(runRoot(workspace, args.run!), request)); return 0;
    }
    if (args.command === 'qualify') {
      const declared = z.strictObject({ disposable: z.literal(true), request: qualificationRequirementSchema }).parse(readBoundedJson(resolve(cwd, args.profile!)));
      output(await qualifyRoute(declared.request)); return 3;
    }
    if (args.command === 'cancel') {
      const root = runRoot(workspace, args.run!), initial = inspectRun(root, args.run!);
      if (initial.state === 'cancelled' && initial.settlement === 'settled') { output(initial); return 130; }
      if (initial.state === 'completed') { output({ error: 'RUN_SETTLED', runId: args.run }); return 4; }
      const receipt = await submitControl(root, { kind: 'cancel', requestId: `cancel-${randomUUID()}`, runId: args.run! });
      const wait = io.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
      for (let i = 0; i < 5; i++) { const status = inspectRun(root, args.run!); if (status.state === 'cancelled' && status.settlement === 'settled') { output(status); return 130; } await wait(100); }
      output({ ...receipt, cancellation: 'pending', settlement: 'unverifiable' }); return 3;
    }
    let request: RunRequest | undefined, runId = args.run;
    if (args.command === 'start') {
      const raw = runInputSchema.parse(readBoundedJson(resolve(cwd, args.input!)));
      runId = raw.runId ?? `run-${randomUUID()}`;
      const packageRoot = realpathSync(io.packageRoot ?? fileURLToPath(new URL('../../', import.meta.url)));
      const config = await loadCouncilConfig(resolveConfigPath(args.config, cwd, packageRoot));
      store = openRunStore(runRoot(workspace, runId));
      const artifacts = store.artifacts, rawArtifact = artifacts.putArtifact(config.sourceBytes, 'raw-config');
      // The canonical artifact is authoritative; raw source bytes are separately retained.
      const canonicalConfig = artifacts.putArtifact(Buffer.from(canonicalJson(config.resolved)), 'config');
      const handoff = writeHandoff(raw.handoff, realpathSync(tmpdir())), topic = artifacts.putArtifact(Buffer.from(raw.topic), 'topic'), handoffArtifact = artifacts.putArtifact(readFileSync(handoff.path), 'handoff');
      const profile = freezeProfile(io.profileInput ? io.profileInput(artifacts.root) : initialProfileInput(artifacts.root));
      const shared = { contextRevision: 0, topic, handoff: handoffArtifact, questionLedgerRefs: [], answerLedgerRefs: [], userDirections: [] };
      request = { ...raw, runId, workspace, handoffPath: handoff.path, handoffHash: handoff.hash,
        config: { sourcePath: config.sourcePath, rawSha256: config.rawSha256, rawArtifact, configArtifact: canonicalConfig, configHash: config.configHash, resolved: config.resolved }, profile,
        sharedContext: { ...shared, contextHash: hashArtifact('shared-context', shared as unknown as JsonValue) } };
      // No run-input configuration/model fields survive this strict decoder.
      delete (request as unknown as Record<string, unknown>).handoff;
    } else store = openRunStore(runRoot(workspace, runId!));
    output({ runId, status: args.command === 'start' ? 'starting' : 'resuming' });
    const dependencies = io.controller ? io.controller(store) : { transport: new OrcaTransport(store), clock: systemClock, processEpoch: randomUUID(), preflight: async () => null };
    const outcome = await runController({ ...dependencies, store, root: runRoot(workspace, runId!), runId: runId!, mode: args.command === 'start' ? 'start' : 'resume', ...(request ? { request } : {}) });
    output({ runId, ...outcome }); return outcomeExitCode(outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INPUT_INVALID';
    io.stderr(`${message.slice(0, 4095)}\n`); output({ error: message === 'USAGE' ? 'USAGE' : 'INPUT_INVALID', detail: message.slice(0, 512) }); return 4;
  } finally { store?.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runCli(process.argv.slice(2), { stdout: text => process.stdout.write(text), stderr: text => process.stderr.write(text) });
}
