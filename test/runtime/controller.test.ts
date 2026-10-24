import { expect, it } from 'vitest';
import { openRunStore } from '../../src/store/run-store.js';
import { fixture } from '../orca/fixtures.js';

it('exports the foreground controller and fails closed without current admission', async () => {
  const api = await import('../../src/runtime/controller.js').catch(() => null);
  expect(api, 'Task7 foreground controller is missing').not.toBeNull();
  const f = fixture();
  const root = f.store.artifacts.root.replace(/\/artifacts$/, '');
  const receipt = f.store.artifacts.putArtifact(Buffer.from('Fixture positive prior exit'), 'fixture-owner');
  f.store.close();
  const store = openRunStore(root);
  const outcome = await api!.runController({ mode: 'resume', runId: 'run1', root, store,
    clock: { wallNow: () => 20000, monotonicNow: () => 200 }, processEpoch: 'epoch1',
    transport: new (await import('../../src/orca/transport.js')).OrcaTransport(store),
    preflight: async () => null, priorOwner: async () => ({ exited: true, receipt }),
  });
  expect(outcome).toMatchObject({ decision: 'blocked', blockers: expect.arrayContaining(['CURRENT_ADMISSION_REQUIRED']) });
  expect(f.counts().launches).toBe(0);
  store.close();
}, 60000);

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArtifactRef, AttemptBinding, ControlEventBody, JsonValue, RunRequest, RunSnapshot, ValidatedEvent, WorkerPayload, WorkerPhase, WorkerRole } from '../../src/domain/contracts.js';
import { canonicalJson, hashArtifact } from '../../src/domain/hash.js';
import { freezeProfile } from '../../src/input/profiles.js';
import { testProfileInput } from '../policy/profile-fixture.js';
import { request as baseRequest } from '../machine/helpers.js';
import { createPrivateWorkerCwd } from '../../src/orca/client.js';
import { OrcaTransport, type LaunchReceipt, type PreparedWorkerInput, type SyntheticDriver, type WorkerSpec } from '../../src/orca/transport.js';
import { reduceRun, restoreForReconciliation } from '../../src/machine/reduce.js';
import type { AdmissionEvidence, PreflightInput } from '../../src/policy/preflight.js';
import { runController, type CandidateAction, type ControllerOptions } from '../../src/runtime/controller.js';
import { submitControl } from '../../src/runtime/inbox.js';
import { captureClock } from '../../src/runtime/clocks.js';
import { inspectRun } from '../../src/cli/index.js';

function scenario(settings: { disagree?: boolean; questionWaves?: number; childLive?: boolean; invalidOutput?: boolean; workerLive?: boolean; lookupMissing?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'council-controller-'))), workspace = join(root, 'workspace'); mkdirSync(workspace);
  const runRoot = join(workspace, '.council', 'runs', 'run1');
  let store = openRunStore(runRoot), ticks = 100, wall = 10000, epoch = 'fake-controller-1';
  const clock = { wallNow: () => wall + ticks, monotonicNow: () => ticks++ };
  const put = (kind: string, value: unknown) => store.artifacts.putArtifact(Buffer.from(canonicalJson(value)), kind);
  const r = baseRequest(); r.workspace = workspace; r.scope = { sourceRoots: [workspace], allowedSourceAddresses: [], checks: [] };
  r.config.resolved = { version: 1, reviewers: { openai: { route: 'codex', model: 'gpt-6.1-sol', effort: 'max' }, gemini: { route: 'antigravity', model: 'gemini-4-argon-high', effort: 'high' }, claude: { route: 'antigravity', model: 'claude-sonnet-5-5-high', effort: 'high' } }, judge: { route: 'codex', model: 'gpt-6.1-sol', effort: 'max' } };
  const raw = Buffer.from(canonicalJson(r.config.resolved));
  r.config.sourcePath = join(root, 'selected.yaml'); writeFileSync(r.config.sourcePath, raw);
  r.config.rawSha256 = createHash('sha256').update(raw).digest('hex'); r.config.rawArtifact = store.artifacts.putArtifact(raw, 'raw-config'); r.config.configArtifact = put('config', r.config.resolved); r.config.configHash = hashArtifact('council-config', r.config.resolved as unknown as JsonValue);
  const profile = testProfileInput(root); profile.artifactRoot = store.artifacts.root; r.profile = freezeProfile(profile);
  r.handoffPath = join(root, 'handoff.md'); writeFileSync(r.handoffPath, 'Synthetic decision context'); r.handoffHash = createHash('sha256').update('Synthetic decision context').digest('hex');
  r.sharedContext = { contextRevision: 0, contextHash: 'a'.repeat(64), topic: store.artifacts.putArtifact(Buffer.from('Topic'), 'topic'), handoff: store.artifacts.putArtifact(Buffer.from('Synthetic decision context'), 'handoff'), questionLedgerRefs: [], answerLedgerRefs: [], userDirections: [] };
  const policy = Buffer.from('Synthetic test-only policy interpretation; no production qualification.'), policyPath = join(root, 'policy.md'); writeFileSync(policyPath, policy);
  const policyHash = createHash('sha256').update(policy).digest('hex'), receipts = new Map<string, LaunchReceipt>();
  const stopped = new Set<string>();
  const calls: WorkerSpec[] = [], actions: CandidateAction[] = [], admissions: AdmissionEvidence[] = [];
  let releases = 0, waits = 0, resultHook: ((binding: AttemptBinding) => Promise<void>) | null = null, actionHook: ((action: CandidateAction) => Promise<void>) | null = null;
  const driver: SyntheticDriver = { kind: 'synthetic', packetBoundBytes: 1000000,
    async launch(spec) {
      calls.push(spec); const q = spec.reservation;
      const binding: AttemptBinding = { ...q.bindings, attemptId: `fake-${q.clientAttemptKey}`, role: q.role, phase: q.phase, requested: q.requested, configured: q.requested,
        authority: { kind: 'supervised', runId: 'run1', taskId: `task-${q.clientAttemptKey}`, dispatchId: `dispatch-${q.clientAttemptKey}`, receiptId: 'synthetic-authority' },
        admittedMethodIds: spec.packet.admittedMethodIds, inputQuestionIds: spec.packet.inputQuestionIds, inputObjectionIds: spec.packet.inputObjectionIds, inputEvidenceIds: spec.packet.inputEvidenceIds,
        ...(spec.packet.candidateHash ? { candidateHash: spec.packet.candidateHash } : {}), ...(spec.packet.evidenceHash ? { evidenceHash: spec.packet.evidenceHash } : {}), ...(spec.packet.judgeHash ? { judgeHash: spec.packet.judgeHash } : {}) };
      const envelope = { clientAttemptKey: q.clientAttemptKey, binding, synthetic: true,
        exposed: { selection: q.requested, workspace: spec.workspace, cwd: spec.cwd, roots: spec.access.grantedRoots, mode: 'supplied-packet-read-only' as const, helpersDisabled: true, hooks: [], tools: [], actions: [], children: [], delivery: { renderedHash: spec.packet.renderedHash, bytes: Buffer.byteLength(spec.packet.text), verified: true } } };
      const receipt = { ...envelope, receipt: put('launch', envelope) }; receipts.set(q.clientAttemptKey, receipt); return receipt;
    },
    async lookup(key) { return settings.lookupMissing ? null : receipts.get(key) ?? null; },
    async observe(binding) {
      const s = store.load('run1'), deadline = s.context.control.workerDeadlines[binding.logicalTaskKey]!;
      const ref = put('synthetic-observation', { attemptId: binding.attemptId, exited: true });
      const live = !!settings.workerLive && !stopped.has(binding.attemptId);
      const observation = { status: live ? 'live' as const : 'exited' as const, exitCode: live ? null : 0, rawReceipts: [ref] };
      return { observation, resources: { attemptId: binding.attemptId, authority: binding.authority, worker: { status: observation.status, exitCode: observation.exitCode }, children: settings.childLive ? [{ id: 'still-live-child', status: 'live', exitCode: null }] : [], watchdog: { id: hashArtifact('watchdog-resource', { attemptId: binding.attemptId, authority: binding.authority, deadlineMs: deadline.wallMs } as unknown as JsonValue), status: observation.status, exitCode: observation.exitCode }, complete: true, receiptRefs: [ref] } };
    },
    async stop(binding, reason) { stopped.add(binding.attemptId); return { attemptId: binding.attemptId, requested: true, receipt: put('synthetic-stop', { reason }), reason }; },
    async release(binding) { releases++; return { attemptId: binding.attemptId, released: true, receipt: put('synthetic-release', { attemptId: binding.attemptId }), reason: 'fixture settled' }; },
  };
  const preflight = async (s: RunSnapshot, pending: { phase: WorkerPhase; roles: readonly WorkerRole[] } | null): Promise<PreflightInput> => {
    const config = s.context.config.resolved, selections = [...Object.entries(config.reviewers), ['judge', config.judge]] as [WorkerRole, typeof config.judge][];
    const now = clock.wallNow();
    return { runId: 'run1', now, host: 'synthetic-test-host', versions: { orca: 'fake', codex: 'fake', antigravity: 'fake' }, config, configHash: s.context.config.configHash, profile: s.context.profile, artifactRoot: store.artifacts.root,
      handoff: { path: r.handoffPath, hash: r.handoffHash }, sourceManifest: [],
      policy: { path: policyPath, bytes: policy, hash: policyHash, readReceipt: 'fake-policy', admitted: selections.map(([role, selection]) => ({ role, ...selection })), maxVisibleWorkstreams: 4, maxAstra: 1, astraModels: ['gpt-6-astra'] },
      authorization: { id: 'synthetic-only-authorization', runId: 'run1', policyHash, configHash: s.context.config.configHash, profileHash: s.context.profile.profileHash, selections: selections.map(([role, selection]) => ({ role, ...selection })), expiresAt: now + 1000000, maxWorkerCalls: s.context.effectiveLimits.maxWorkerCalls, maxActiveMs: s.context.effectiveLimits.activeBudgetMs, extraAstraSlots: 0, purpose: 'Fake workflow only' },
      bounds: { maxWorkerCalls: s.context.effectiveLimits.maxWorkerCalls, activeMs: s.context.effectiveLimits.activeBudgetMs }, caller: { model: 'gpt-6.1-sol', receiptId: 'fake-caller' }, activeWorkers: Object.values(s.context.issuedLogicalTasks).filter(task => task.binding && task.stage !== 'pending_execution' && (task.settlement !== 'settled' || !s.context.control.settledResourceTasks.includes(task.reservation.logicalTaskKey))).map(task => ({ id: task.binding!.attemptId, model: task.binding!.requested.model, receiptId: task.binding!.authority.receiptId, assignment: { runId: 'run1', phase: task.reservation.phase, role: task.reservation.role, logicalTaskKey: task.reservation.logicalTaskKey } })), ...(pending ? { pendingAssignment: { ...pending, roles: [...pending.roles], receiptId: 'fake-pending' } } : {}), scope: JSON.parse(JSON.stringify(r.scope)),
      catalog: selections.map(([role, selection]) => ({ ...selection, family: role === 'judge' ? 'openai' : role, efforts: [selection.effort], receiptId: 'fake-catalog', expiresAt: now + 1000000 })),
      qualifications: selections.map(([, selection]) => ({ id: `synthetic-${selection.model}`, host: 'synthetic-test-host', versions: { orca: 'fake', codex: 'fake', antigravity: 'fake' }, actionClass: 'supplied-packet-read-only', requested: selection, exposed: selection, expiresAt: now + 1000000, throughOrca: true, helpersDisabled: true, terminalSandbox: true, accessControlled: true, roots: [], receiptRefs: ['synthetic-code-behavior-only'] })),
      access: { actionClass: 'supplied-packet-read-only', requiredRoots: [], grantedRoots: [], receiptId: 'fake-access' }, allowance: [{ route: 'codex', group: 'fake', state: 'available', receiptId: 'fake-quota' }, { route: 'antigravity', group: 'fake', state: 'available', receiptId: 'fake-quota' }] };
  };
  const prepare: NonNullable<ControllerOptions['prepare']> = async (reservation, s, admission, admissionReceipt, input) => {
    admissions.push(admission);
    const text = canonicalJson({ reservation, context: s.context.sharedContext, ledger: s.context.questionLedger, profile: s.context.profile, config: s.context.config, candidate: s.context.control.candidate, evidence: s.context.control.evidence, judge: s.context.control.judge });
    const role = reservation.role, selection = reservation.requested;
    return { reservation, config: s.context.config, admission, admissionReceipt, scope: s.context.request.scope, access: input.access, workspace: { id: 'fake-workspace', path: workspace }, cwd: createPrivateWorkerCwd(reservation),
      routeEvidence: { admission, role, now: input.now, catalog: input.catalog.find(entry => entry.model === selection.model)!, qualification: input.qualifications.find(entry => entry.requested.model === selection.model)! },
      packet: { text, renderedHash: hashArtifact('rendered-worker-packet', text), admittedMethodIds: s.context.profile.admittedMethodIds, inputQuestionIds: s.context.questionLedger.questions.map(q => q.id), inputObjectionIds: s.context.objections.map(o => o.id), inputEvidenceIds: s.context.control.evidence.map(e => e.requestId),
        ...(reservation.phase === 'judge' || reservation.phase === 'ballot' ? { candidateHash: s.context.control.candidate!.hash, evidenceHash: s.context.control.evidenceHash! } : {}), ...(reservation.phase === 'ballot' ? { judgeHash: s.context.control.judgeHash! } : {}) } };
  };
  const options = (mode: 'start' | 'resume'): ControllerOptions => ({ mode, root: runRoot, runId: 'run1', ...(mode === 'start' ? { request: r } : {}), store, transport: new OrcaTransport(store, driver), clock, processEpoch: epoch, preflight, prepare,
    priorOwner: async () => ({ exited: true, receipt: put('fixture-prior-exit', { explicitlySynthetic: true }) }),
    armDeadline: async (intent, binding) => {
      const deadline = store.load('run1').context.control.workerDeadlines[binding.logicalTaskKey]!;
      const resourceKey = hashArtifact('watchdog-resource', { attemptId: binding.attemptId, authority: binding.authority, deadlineMs: deadline.wallMs } as unknown as JsonValue), launchReceipt = put('watchdog-launch', { pid: 12345, processStart: 'synthetic-never-executed', resourceKey });
      const proof = { kind: 'watchdog-armed', key: intent.key, intentHash: hashArtifact('effect', intent), logicalTaskKey: binding.logicalTaskKey, attemptId: binding.attemptId, deadline, resourceKey, pid: 12345, processStart: 'synthetic-never-executed', launchReceipt };
      const body: ControlEventBody = { kind: 'WATCHDOG_ARMED', data: { key: intent.key, intentHash: hashArtifact('effect', intent), logicalTaskKey: binding.logicalTaskKey, attemptId: binding.attemptId, deadline, receipt: put('watchdog-armed', proof) } };
      const s = store.load('run1'), event: ValidatedEvent = { id: `${intent.key}/armed`, runId: 'run1', schemaVersion: 1, actor: { kind: 'adapter', receiptId: 'synthetic-watchdog' }, round: s.context.roundsUsed, phase: binding.phase, clockReceipt: captureClock(clock, epoch), body };
      store.commitTransition('run1', s.revision, event, reduceRun(s, event));
    },
    readResult: async binding => {
      await resultHook?.(binding);
      const methodIds = r.profile.admittedMethodIds;
      let payload: WorkerPayload;
      if (binding.phase === 'clarify') { const question = binding.role === 'openai' && (binding.clarificationBatch ?? 0) <= (settings.questionWaves ?? 0); payload = { kind: 'clarification', ready: !question, questions: question ? [{ id: 'scope', text: `Question wave ${binding.clarificationBatch}`, reason: 'Scope needed', blocking: true, answerForm: { kind: 'text' }, dependencies: [] }] : [], methodIds }; }
      else if (binding.phase === 'review') payload = { kind: 'review', proposals: [`Proposal from ${binding.role}`], newObjections: [], evidenceRequests: [], missingInputQuestions: [], methodIds };
      else {
        const common = { runId: binding.runId, configHash: binding.configHash, profileHash: binding.profileHash, contextHash: binding.contextHash, round: binding.round, candidateHash: binding.candidateHash!, evidenceHash: binding.evidenceHash! };
        payload = binding.phase === 'judge' ? { kind: 'judge', bindings: common, assessments: [], challenges: [], methodIds } : { kind: 'ballot', bindings: { ...common, judgeHash: binding.judgeHash! }, decision: settings.disagree ? 'reject' : 'accept', conditional: false, newObjections: [], missingInputQuestions: [], dispositions: [], challengeResponses: [], reason: 'Synthetic verdict', methodIds };
      }
      return Buffer.from(settings.invalidOutput ? '' : JSON.stringify(payload));
    },
    onAction: async action => { actions.push(action); if (actionHook) await actionHook(action); else await submitControl(runRoot, { kind: 'candidate', requestId: `candidate-${action.round}`, runId: 'run1', baseContextHash: action.contextHash, round: action.round, evidenceHash: action.evidenceHash, candidate: { text: 'Fixture candidate', assumptions: [], tradeoffs: [], unresolvedUncertainty: [], acknowledgedUnverifiedEvidenceIds: [] } }); },
    wait: async ms => { ticks += ms; if (++waits > 10) throw new Error('TEST_POLL_LIMIT'); }, pollMs: 1,
  });
  return { root: runRoot, request: r, calls, actions, admissions, options, store: () => store, inspect: () => inspectRun(runRoot, 'run1'), hook: (fn: typeof resultHook) => { resultHook = fn; }, actionHook: (fn: typeof actionHook) => { actionHook = fn; },
    resume: async (elapsed = 0, overrides: Partial<ControllerOptions> = {}) => { store.close(); store = openRunStore(runRoot); wall += ticks + elapsed; ticks = 100; epoch += '-next'; waits = 0; return runController({ ...options('resume'), ...overrides }); },
    advance: (ms: number) => { ticks += ms; }, close: () => store.close(), releases: () => releases };
}

it('runs unanimous fake providers through the caller candidate callback with one review round', async () => {
  const f = scenario();
  const result = await runController(f.options('start'));
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed', decision: 'unanimous', settlement: 'settled' });
  expect(f.inspect()).toMatchObject({ roundsUsed: 1, clarificationBatchesUsed: 1, callsReserved: 10 });
  expect(f.actions).toHaveLength(1);
  expect(f.releases()).toBe(10);
  const rendered = JSON.parse(readFileSync(result.reports.find(ref => ref.kind === 'report-json')!.path, 'utf8'));
  expect(rendered.mapping.every((role: { observations: unknown[] }) => role.observations.length > 0)).toBe(true);
  expect(f.calls.filter(call => call.reservation.phase === 'review').map(call => call.reservation.role)).toEqual(['openai', 'gemini', 'claude']);
  f.close();
}, 60000);
it('stops three disagreements at round three without exceeding the 27-call bound', async () => {
  const f = scenario({ disagree: true, questionWaves: 1 }), options = f.options('start');
  options.sourceAnswers = async snapshot => snapshot.context.control.stagedQuestions.map((question, index) => ({ id: `bound-source-${index}`, questionId: question.id, status: 'answered', value: 'Verified fixture source', source: { author: 'source-adapter', receiptId: 'fixture-source-receipt' }, evidenceIds: [] }));
  const result = await runController(options);
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'needs_user', settlement: 'settled' });
  expect(f.inspect()).toMatchObject({ roundsUsed: 3, clarificationBatchesUsed: 2, callsReserved: 27 });
  expect(f.calls).toHaveLength(27);
  const before = f.store().load('run1');
  await submitControl(f.root, { kind: 'extend', requestId: 'budget-only-at-limit', runId: 'run1', extension: { id: 'budget-only-at-limit', baseRevision: before.revision, authorizationReceipt: 'explicit-budget-only-user-receipt', expiresAt: Date.now() + 100000, additionalClarificationBatches: 0, additionalRounds: 0, additionalActiveBudgetMs: 1000 } });
  expect(await f.resume()).toMatchObject({ state: 'needs_user' }); expect(f.calls).toHaveLength(27); f.close();
}, 60000);
it('keeps a partial answer paused and charges zero for a 24-hour settled human wait', async () => {
  const f = scenario({ questionWaves: 1 });
  expect(await runController(f.options('start'))).toMatchObject({ state: 'needs_user', settlement: 'settled' });
  const before = f.store().load('run1'), batch = before.context.control.questionBatch!;
  await submitControl(f.root, { kind: 'answers', requestId: 'draft', runId: 'run1', batch: { requestId: 'draft', batchId: batch.id, origin: batch.origin, baseContextHash: batch.baseContextHash, answers: [], finalized: false } });
  expect(await f.resume(86400000)).toMatchObject({ state: 'needs_user' });
  expect(f.calls).toHaveLength(3);
  expect(f.store().load('run1').context.activeBudget.remainingMs).toBe(before.context.activeBudget.remainingMs);
  await submitControl(f.root, { kind: 'answers', requestId: 'final', runId: 'run1', batch: { requestId: 'final', batchId: batch.id, origin: batch.origin, baseContextHash: batch.baseContextHash, answers: [{ id: 'answer-one', questionId: batch.presentedQuestionIds[0]!, status: 'answered', value: 'Confirmed', source: { author: 'user', receiptId: 'fixture-user' }, evidenceIds: [] }], finalized: true } });
  const result = await f.resume();
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed' });
  expect(f.inspect()).toMatchObject({ clarificationBatchesUsed: 2, roundsUsed: 1, callsReserved: 13 });
  const reviews = f.calls.filter(call => call.reservation.phase === 'review');
  expect(new Set(reviews.map(call => call.reservation.bindings.contextHash)).size).toBe(1);
  expect(JSON.parse(reviews[0]!.packet.text).ledger.answers).toHaveLength(1); f.close();
}, 60000);
it('does not close a human pause when a provider exits but a child remains live', async () => {
  const f = scenario({ childLive: true });
  const result = await runController(f.options('start'));
  expect(result).toMatchObject({ settlement: 'unverifiable' });
  expect(f.store().load('run1').context.activeBudget.status).toBe('active');
  expect(f.releases()).toBe(0); f.close();
}, 60000);
it('makes empty issued output a terminal inference block and cannot relaunch on resume', async () => {
  const f = scenario({ invalidOutput: true });
  const result = await runController(f.options('start'));
  expect(result).toMatchObject({ state: 'blocked', settlement: 'settled' });
  const count = f.calls.length;
  expect(await f.resume()).toMatchObject({ state: 'blocked' });
  expect(f.calls).toHaveLength(count); f.close();
}, 60000);

it('consumes a context update arriving during preparation before dispatching the old packet', async () => {
  const f = scenario(), options = f.options('start'), prepare = options.prepare!, preflight = options.preflight; let sent = false, admissions = 0;
  options.preflight = async (...args) => { if (++admissions > 20) throw new Error('TEST_ADMISSION_POLL_LIMIT'); return preflight(...args); };
  options.prepare = async (...args) => {
    const prepared = await prepare(...args);
    if (!sent && prepared.reservation.phase === 'review') {
      sent = true;
      await submitControl(f.root, { kind: 'context_update', requestId: 'prepare-direction', runId: 'run1', update: { requestId: 'prepare-direction', runId: 'run1', baseContextHash: args[1].context.sharedContext.contextHash, userDirections: [f.store().artifacts.putArtifact(Buffer.from('Revised priority'), 'user-direction')] } });
    }
    return prepared;
  };
  const result = await runController(options);
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed' });
  expect(f.calls.filter(call => call.reservation.phase === 'review' && call.reservation.bindings.round === 1)).toHaveLength(0);
  expect(f.inspect()).toMatchObject({ roundsUsed: 2, callsReserved: 13 });
  const report = JSON.parse(readFileSync(result.reports.find(ref => ref.kind === 'report-json')!.path, 'utf8'));
  expect(report).toMatchObject({ outcome: 'completed', settlement: 'settled', counts: { callsReserved: 13 } });
  expect(report.resources.accepted.filter((resource: { physicalState: string }) => resource.physicalState === 'reserved_unissued')).toHaveLength(3); f.close();
}, 60000);
it('prioritizes a context update over three old-context accept ballots', async () => {
  const f = scenario(); let sent = false;
  f.hook(async binding => {
    if (!sent && binding.phase === 'ballot' && binding.role === 'claude') {
      sent = true;
      await submitControl(f.root, { kind: 'context_update', requestId: 'ballot-direction', runId: 'run1', update: { requestId: 'ballot-direction', runId: 'run1', baseContextHash: binding.contextHash, userDirections: [f.store().artifacts.putArtifact(Buffer.from('New fact'), 'user-direction')] } });
    }
  });
  const result = await runController(f.options('start'));
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed' });
  expect(f.inspect()).toMatchObject({ roundsUsed: 2 });
  expect(f.actions).toHaveLength(2); f.close();
}, 60000);

it('binds the worker packet to the complete saved shared ledger even if preparation supplies incomplete text', async () => {
  const f = scenario(), options = f.options('start'), prepare = options.prepare!;
  options.prepare = async (...args) => { const original = await prepare(...args), text = 'incomplete supplied packet'; return { ...original, packet: { ...original.packet, text, renderedHash: hashArtifact('rendered-worker-packet', text) } }; };
  const result = await runController(options);
  expect(result).toMatchObject({ state: 'completed' });
  const packet = JSON.parse(f.calls[0]!.packet.text);
  expect(packet).toMatchObject({ handoff: 'Synthetic decision context', ledger: { questions: [], answers: [] }, config: f.request.config.resolved });
  expect(packet.profileMethods).toHaveLength(4); f.close();
}, 60000);
it('accepts a paused extension at its saved revision before resume changes that revision', async () => {
  const f = scenario({ questionWaves: 1 });
  expect(await runController(f.options('start'))).toMatchObject({ state: 'needs_user' });
  const before = f.store().load('run1');
  await submitControl(f.root, { kind: 'extend', requestId: 'extension-one', runId: 'run1', extension: { id: 'extension-one', baseRevision: before.revision, authorizationReceipt: 'explicit-fixture-user-authorization', expiresAt: Date.now() + 86400000, additionalClarificationBatches: 0, additionalRounds: 0, additionalActiveBudgetMs: 1000 } });
  expect(await f.resume()).toMatchObject({ state: 'needs_user' });
  const after = f.store().load('run1');
  expect(after.context.extensions).toHaveLength(1);
  expect(after.context.extensions[0]!.baseRevision).toBe(before.revision);
  expect(after.context.activeBudget.remainingMs).toBe(before.context.activeBudget.remainingMs + 1000);
  expect(f.calls).toHaveLength(3); f.close();
}, 60000);

it('adopts all valid worker exits after controller loss, charges active downtime and never launches twice', async () => {
  const f = scenario(); let crash = true;
  f.hook(async () => { if (crash) { crash = false; throw new Error('SIMULATED_CONTROLLER_LOSS'); } });
  const interrupted = await runController(f.options('start'));
  expect(interrupted).toMatchObject({ state: 'clarifying', settlement: 'unverifiable' });
  expect(f.calls).toHaveLength(3);
  writeFileSync(f.request.config.sourcePath, 'Changed YAML is not saved configuration');
  const result = await f.resume(10000);
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed' });
  expect(f.calls).toHaveLength(10);
  expect(new Set(f.calls.map(call => call.reservation.clientAttemptKey)).size).toBe(10);
  expect(f.store().load('run1').context.activeBudget.accruedMs).toBeGreaterThanOrEqual(10000);
  expect(f.store().load('run1').context.config.configHash).toBe(f.request.config.configHash); f.close();
}, 60000);
it('continues genuinely pending peers after a preparation crash without reissuing the fenced peer', async () => {
  const f = scenario(), options = f.options('start'), prepare = options.prepare!; let count = 0;
  options.prepare = async (...args) => { if (++count === 2) throw new Error('SIMULATED_PREPARATION_LOSS'); return prepare(...args); };
  const interrupted = await runController(options);
  expect(interrupted).toMatchObject({ state: 'clarifying', settlement: 'unverifiable' });
  expect(f.calls).toHaveLength(1);
  expect(f.store().effectRecord(`${f.calls[0]!.reservation.logicalTaskKey}/deadline`).status).toBe('receipt_recorded');
  const result = await f.resume(100);
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed' });
  expect(f.calls).toHaveLength(10);
  expect(new Set(f.calls.map(call => call.reservation.clientAttemptKey)).size).toBe(10);
  const packets = f.calls.filter(call => call.reservation.phase === 'clarify').map(call => JSON.parse(call.packet.text));
  expect(new Set(packets.map(packet => canonicalJson(packet.priorResults))).size).toBe(1); f.close();
}, 60000);

import { createEvidenceCollector } from '../../src/evidence/adapter.js';

function checkOptions(f: ReturnType<typeof scenario>) {
  const address = 'https://checks.example.test/exact', check = { id: 'fixture-check', argv: ['/usr/bin/true'], cwd: f.request.workspace, declaredEffects: [], outputTargets: [] };
  f.request.scope = { ...f.request.scope, allowedSourceAddresses: [address], checks: [check] };
  const evidenceManifest = [{ kind: 'check' as const, address, revision: 'fixture-check-v1', checkId: check.id }];
  const requested = { id: 'check-evidence', claimId: 'claim', source: address, reason: 'Test only exact qualified fake runner' };
  const collector = createEvidenceCollector({ sourceManifest: evidenceManifest, environment: {}, artifacts: f.store().artifacts,
    retrieve: async () => { throw new Error('UNEXPECTED_RETRIEVAL'); },
    executeCheck: async ({ check }) => ({ kind: 'completed', executed: check, stdout: Buffer.from('synthetic pass'), stderr: Buffer.alloc(0), exitCode: 0, receiptId: 'fixture-original-runner-receipt', resource: { id: 'fixture-original-resource', pid: 12345, processGroupId: 12345, startedAtMs: 100, parentExitCode: 0, parentSignal: null, settlement: 'settled', stopRequested: false, settlementReceiptId: 'fixture-positive-original-exit' } }),
  });
  return { evidenceManifest, requested, collector };
}
it('keeps an evidence marker uncertain after a crash before execution and blocks new inference on resume', async () => {
  const f = scenario(), declared = checkOptions(f), options = f.options('start'); let executions = 0;
  options.evidenceManifest = declared.evidenceManifest;
  options.coordinatorEvidence = async () => [declared.requested];
  options.collectEvidence = async () => { executions++; throw new Error('CRASH_AFTER_MARKER_BEFORE_EXECUTION'); };
  expect(await runController(options)).toMatchObject({ state: 'prepare_candidate' });
  const result = await f.resume();
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'reconciling', settlement: 'unverifiable', blockers: expect.arrayContaining(['EVIDENCE_EXECUTION_UNVERIFIABLE']) });
  expect(executions).toBe(1);
  expect(f.calls).toHaveLength(6);
  expect(f.store().load('run1').context.activeBudget.status).toBe('active');
  expect(f.releases()).toBe(0); f.close();
}, 60000);
it('recovers a lost evidence completion from the same immutable receipt exactly once without another check', async () => {
  const f = scenario(), declared = checkOptions(f), options = f.options('start'); let record: import('../../src/domain/contracts.js').EvidenceRecord | null = null, executions = 0;
  options.evidenceManifest = declared.evidenceManifest;
  options.coordinatorEvidence = async () => [declared.requested];
  options.collectEvidence = async (request, snapshot) => { executions++; record = await declared.collector.collectEvidence(request, snapshot.context.request.scope); throw new Error('CRASH_AFTER_EXECUTION_BEFORE_EVENT'); };
  expect(await runController(options)).toMatchObject({ state: 'prepare_candidate' });
  const result = await f.resume(0, { recoverEvidence: async (_intent, _snapshot, marker) => ({ marker: marker.ref, record: record! }) });
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed' });
  expect(executions).toBe(1);
  expect(f.store().load('run1').context.control.evidence).toHaveLength(1);
  expect(f.store().readJournal('run1').filter(row => row.event.body.kind === 'EVIDENCE_RECORDED')).toHaveLength(1); f.close();
}, 60000);

async function answerPending(f: ReturnType<typeof scenario>, requestId: string, status: 'answered' | 'unknown' = 'answered') {
  const snapshot = f.store().load('run1'), batch = snapshot.context.control.questionBatch!;
  const answers = [...batch.sourceAnswers, ...batch.presentedQuestionIds.filter(id => !batch.sourceAnswers.some(answer => answer.questionId === id)).map((questionId, index) => ({ id: `${requestId}-${index}`, questionId, status, value: status === 'answered' ? 'User answer' : null, source: { author: 'user', receiptId: `${requestId}-receipt` }, evidenceIds: [] }))];
  await submitControl(f.root, { kind: 'answers', requestId, runId: 'run1', batch: { requestId, batchId: batch.id, origin: batch.origin, baseContextHash: batch.baseContextHash, answers, finalized: true } });
  return answers;
}
it('corrects a batch-one unknown after batch two is exhausted with zero extra clarification calls', async () => {
  const f = scenario({ questionWaves: 2 });
  expect(await runController(f.options('start'))).toMatchObject({ state: 'needs_user' });
  const first = await answerPending(f, 'first-unknown', 'unknown');
  expect(await f.resume()).toMatchObject({ state: 'needs_user' });
  expect(f.inspect()).toMatchObject({ clarificationBatchesUsed: 2, roundsUsed: 0 });
  await answerPending(f, 'second-final');
  expect(await f.resume()).toMatchObject({ state: 'needs_user' });
  const c = f.store().load('run1').context;
  expect(c.control.questionBatch).toBeNull(); expect(c.pauseReason).toBe('CLARIFICATION_LIMIT');
  await submitControl(f.root, { kind: 'answer_revision', requestId: 'correct-first', runId: 'run1', revision: { requestId: 'correct-first', runId: 'run1', baseContextHash: c.sharedContext.contextHash, unresolvedQuestionIds: [first[0]!.questionId], answers: [{ id: 'corrected-first-answer', questionId: first[0]!.questionId, supersededAnswerId: first[0]!.id, status: 'answered', value: 'Corrected', source: { author: 'user', receiptId: 'correction-receipt' }, evidenceIds: [] }] } });
  expect(await f.resume()).toMatchObject({ state: 'completed' });
  expect(f.calls.filter(call => call.reservation.phase === 'clarify')).toHaveLength(6);
  expect(f.store().load('run1').context.questionLedger.answers).toHaveLength(3); f.close();
}, 60000);
it('admits an explicitly extended third clarification wave with its independent counter', async () => {
  const f = scenario({ questionWaves: 3 });
  await runController(f.options('start')); await answerPending(f, 'wave-one'); await f.resume();
  const before = f.store().load('run1');
  await submitControl(f.root, { kind: 'extend', requestId: 'third-wave', runId: 'run1', extension: { id: 'third-wave', baseRevision: before.revision, authorizationReceipt: 'explicit-test-user-extension', expiresAt: Date.now() + 100000, additionalClarificationBatches: 1, additionalRounds: 0, additionalActiveBudgetMs: 0 } });
  await answerPending(f, 'wave-two');
  expect(await f.resume()).toMatchObject({ state: 'needs_user' });
  expect(f.inspect()).toMatchObject({ clarificationBatchesUsed: 3, roundsUsed: 0, callsReserved: 9 });
  await answerPending(f, 'wave-three');
  expect(await f.resume()).toMatchObject({ state: 'completed' });
  expect(f.inspect()).toMatchObject({ clarificationBatchesUsed: 3, roundsUsed: 1, callsReserved: 16 }); f.close();
}, 60000);
it('source-answered questions still admit a second independent clarification wave', async () => {
  const f = scenario({ questionWaves: 1 }), options = f.options('start');
  options.sourceAnswers = async snapshot => snapshot.context.control.stagedQuestions.map((question, index) => ({ id: `source-${index}`, questionId: question.id, status: 'answered', value: 'Source-established answer', source: { author: 'source-adapter', receiptId: 'fixture-source-check' }, evidenceIds: [] }));
  const result = await runController(options);
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed' });
  expect(f.inspect()).toMatchObject({ clarificationBatchesUsed: 2, roundsUsed: 1, callsReserved: 13 });
  expect(f.store().load('run1').context.questionLedger.answers).toHaveLength(1); f.close();
}, 60000);
it('publishes a late round-one answer before round two without returning to clarification', async () => {
  const f = scenario(), options = f.options('start'), read = options.readResult!;
  options.readResult = async binding => {
    const raw = await read(binding);
    if (binding.phase !== 'review' || binding.round !== 1 || binding.role !== 'openai') return raw;
    const payload = JSON.parse(Buffer.from(raw!).toString('utf8'));
    payload.missingInputQuestions = [{ id: 'late', text: 'Late round question', reason: 'New missing information', blocking: true, answerForm: { kind: 'text' }, dependencies: [] }]; return Buffer.from(JSON.stringify(payload));
  };
  expect(await runController(options)).toMatchObject({ state: 'needs_user' });
  expect(f.store().load('run1').context.control.questionBatch!.origin).toEqual({ kind: 'deliberation', round: 1 });
  await answerPending(f, 'late-round-answer');
  const result = await f.resume();
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed' });
  expect(f.inspect()).toMatchObject({ clarificationBatchesUsed: 1, roundsUsed: 2 });
  expect(f.calls.filter(call => call.reservation.phase === 'clarify')).toHaveLength(3); f.close();
}, 60000);

it('blocks an issued timeout without a valid result permanently after positive worker shutdown', async () => {
  const f = scenario({ workerLive: true }), options = f.options('start');
  f.request.workerTimeoutMs = 1000;
  options.readResult = async () => null;
  options.wait = async () => { f.advance(2000); };
  const result = await runController(options);
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'blocked', settlement: 'settled' });
  expect(f.store().load('run1').context.inferenceBlock).toBe('MISSING_REQUIRED_RESULT');
  const count = f.calls.length; expect(await f.resume()).toMatchObject({ state: 'blocked' }); expect(f.calls).toHaveLength(count); f.close();
}, 60000);
it('cancels live workers only after positive shutdown and repeated resume cannot launch them again', async () => {
  const f = scenario({ workerLive: true }), options = f.options('start'), signal = new AbortController();
  options.signal = signal.signal;
  options.readResult = async () => { signal.abort(); return null; };
  const result = await runController(options);
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'cancelled', settlement: 'settled' });
  expect(f.store().pendingEffects('run1').filter(intent => ['observe', 'stop'].includes(intent.kind))).toHaveLength(0);
  const count = f.calls.length; expect(await f.resume()).toMatchObject({ state: 'cancelled', settlement: 'settled' }); expect(f.calls).toHaveLength(count); f.close();
}, 60000);
it('allows no launch with zero remaining active allowance', async () => {
  const f = scenario(); f.request.activeBudgetMs = 1;
  const result = await runController(f.options('start'));
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'needs_user', settlement: 'settled' });
  expect(f.calls).toHaveLength(0); expect(f.inspect().remainingBudgetMs).toBe(0); f.close();
}, 60000);
it('blocks backward wall observations after an active-process crash without extending time', async () => {
  const f = scenario(); f.hook(async () => { throw new Error('SIMULATED_CRASH'); });
  await runController(f.options('start')); const before = f.store().load('run1');
  const result = await f.resume(-10000);
  expect(result).toMatchObject({ settlement: 'unverifiable', blockers: expect.arrayContaining(['WALL_CLOCK_REGRESSION']) });
  expect(f.calls).toHaveLength(3); expect(f.store().load('run1').context.activeBudget.remainingMs).toBe(before.context.activeBudget.remainingMs); f.close();
}, 60000);

it('exposes the identical immutable candidate action to inspect and survives candidate delivery during owner exit', async () => {
  const f = scenario(), options = f.options('start'); let observed: unknown, delivered: CandidateAction | undefined;
  options.onAction = async action => {
    observed = (f.inspect() as unknown as { pendingCandidate: unknown }).pendingCandidate; delivered = action;
    await submitControl(f.root, { kind: 'candidate', requestId: 'candidate-1', runId: 'run1', baseContextHash: action.contextHash, round: action.round, evidenceHash: action.evidenceHash, candidate: { text: 'Fixture candidate', assumptions: [], tradeoffs: [], unresolvedUncertainty: [], acknowledgedUnverifiedEvidenceIds: [] } });
    throw new Error('OWNER_EXIT_AFTER_CANDIDATE_ENQUEUE');
  };
  expect(await runController(options)).toMatchObject({ state: 'prepare_candidate' });
  expect(f.calls).toHaveLength(6);
  expect(observed).toEqual(delivered);
  const result = await f.resume();
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed' });
  expect(f.calls).toHaveLength(10);
  expect(f.store().readJournal('run1').filter(row => row.event.body.kind === 'CANDIDATE_FROZEN')).toHaveLength(1); f.close();
}, 60000);

import { renameSync } from 'node:fs';
import { readEvidenceReceipt } from '../../src/evidence/adapter.js';
it('does not infer an unsent check from a missing saved execution protocol', async () => {
  const f = scenario(), declared = checkOptions(f), options = f.options('start'); let executions = 0;
  options.evidenceManifest = declared.evidenceManifest; options.coordinatorEvidence = async () => [declared.requested];
  options.collectEvidence = async () => { executions++; throw new Error('SIMULATED_PRE_EXECUTION_CRASH'); };
  await runController(options);
  renameSync(join(f.root, 'runtime-protocol.json'), join(f.root, 'retained-original-protocol.json'));
  const result = await f.resume();
  expect(result).toMatchObject({ state: 'reconciling', settlement: 'unverifiable', blockers: expect.arrayContaining(['EVIDENCE_EXECUTION_UNVERIFIABLE']) });
  expect(executions).toBe(1); expect(f.calls).toHaveLength(6); f.close();
}, 60000);
it('rejects recovery bound to another marker before recording any evidence completion', async () => {
  const f = scenario(), declared = checkOptions(f), options = f.options('start'); let record: import('../../src/domain/contracts.js').EvidenceRecord | null = null;
  options.evidenceManifest = declared.evidenceManifest; options.coordinatorEvidence = async () => [declared.requested];
  options.collectEvidence = async (request, snapshot) => { record = await declared.collector.collectEvidence(request, snapshot.context.request.scope); throw new Error('SIMULATED_LOST_COMPLETION'); };
  await runController(options);
  const result = await f.resume(0, { recoverEvidence: async () => ({ marker: f.request.sharedContext.handoff, record: record! }) });
  expect(result).toMatchObject({ state: 'reconciling', settlement: 'unverifiable', blockers: expect.arrayContaining(['EVIDENCE_RECOVERY_MARKER_MISMATCH']) });
  expect(f.store().load('run1').context.control.evidence).toHaveLength(0); expect(f.calls).toHaveLength(6); f.close();
}, 60000);
it('retains an unknown original check resource across restart and accepts only linked positive original settlement', async () => {
  const f = scenario(), declared = checkOptions(f), options = f.options('start'); let executions = 0;
  const collector = createEvidenceCollector({ sourceManifest: declared.evidenceManifest, environment: {}, artifacts: f.store().artifacts,
    retrieve: async () => { throw new Error('UNEXPECTED_RETRIEVAL'); },
    executeCheck: async ({ check }) => { executions++; return { kind: 'completed', executed: check, stdout: Buffer.from('original output'), stderr: Buffer.alloc(0), exitCode: 0, receiptId: 'original-fake-check-receipt', resource: { id: 'original-check', pid: 12345, processGroupId: 12345, startedAtMs: 100, parentExitCode: 0, parentSignal: null, settlement: 'unverifiable', stopRequested: true, settlementReceiptId: null } }; },
  });
  let original: import('../../src/domain/contracts.js').EvidenceRecord | null = null;
  options.evidenceManifest = declared.evidenceManifest; options.coordinatorEvidence = async () => [declared.requested];
  options.collectEvidence = async (request, snapshot) => original = await collector.collectEvidence(request, snapshot.context.request.scope);
  expect(await runController(options)).toMatchObject({ state: 'reconciling', settlement: 'unverifiable' });
  expect(f.store().load('run1').context.activeBudget.status).toBe('active'); expect(f.releases()).toBe(0);
  const result = await f.resume(0, { recoverEvidence: async (_intent, _snapshot, marker) => {
    const receipt = readEvidenceReceipt(original!, f.store().artifacts);
    const next = { ...receipt, status: 'verified' as const, checkPassed: true, checkResourceState: 'settled' as const, checkResource: { ...receipt.checkResource!, settlement: 'settled' as const, settlementReceiptId: 'fixture-positive-same-resource' }, priorObservationReceipt: original!.observationReceipt };
    const ref = f.store().artifacts.putArtifact(Buffer.from(canonicalJson(next)), 'evidence-receipt');
    return { marker: marker.ref, record: { ...original!, status: 'verified', observationReceipt: canonicalJson(ref) } };
  } });
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed', settlement: 'settled' });
  expect(executions).toBe(1); expect(f.calls).toHaveLength(10); f.close();
}, 60000);

it('uses only the frozen configuration when the original YAML is deleted before resume', async () => {
  const f = scenario({ questionWaves: 1 });
  await runController(f.options('start')); await answerPending(f, 'delete-original-answer');
  renameSync(f.request.config.sourcePath, `${f.request.config.sourcePath}.retained`);
  const result = await f.resume();
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed' });
  expect(f.store().load('run1').context.config.configHash).toBe(f.request.config.configHash); f.close();
}, 60000);
it('blocks a corrupt saved configuration without repairing it from current defaults', async () => {
  const f = scenario({ questionWaves: 1 }); await runController(f.options('start'));
  writeFileSync(f.request.config.rawArtifact.path, 'Corrupt immutable saved config');
  const result = await f.resume();
  expect(result).toMatchObject({ decision: 'blocked', settlement: 'unverifiable', blockers: expect.arrayContaining(['CONFIG_SNAPSHOT_INVALID']) });
  expect(f.calls).toHaveLength(3); expect(readFileSync(f.request.config.rawArtifact.path, 'utf8')).toBe('Corrupt immutable saved config'); f.close();
}, 60000);
it('retains valid work across temporary handoff loss and rechecks current policy on resume', async () => {
  const f = scenario(); let crash = true;
  f.hook(async () => { if (crash) { crash = false; throw new Error('SIMULATED_LOSS'); } });
  await runController(f.options('start')); renameSync(f.request.handoffPath, `${f.request.handoffPath}.retained`);
  expect(await f.resume()).toMatchObject({ state: 'needs_context', settlement: 'settled' });
  expect(f.calls).toHaveLength(3);
  renameSync(`${f.request.handoffPath}.retained`, f.request.handoffPath);
  const saved = f.options('resume'), input = await saved.preflight(f.store().load('run1'), null);
  writeFileSync(input!.policy.path, 'Changed current host policy');
  expect(await f.resume()).toMatchObject({ state: 'blocked', settlement: 'settled', blockers: expect.arrayContaining(['POLICY_HASH_MISMATCH']) });
  expect(f.calls).toHaveLength(3); f.close();
}, 60000);

it('acknowledges an already committed evaluation after a crash without generating another evaluation clock or inference', async () => {
  const f = scenario(), options = f.options('start'), original = f.store(); let fail = true;
  options.store = new Proxy(original, { get(target, property) {
    if (property === 'recordEffectReceipt') return (key: string, receipt: import('../../src/store/run-store.js').EffectReceipt, revision: number) => {
      if (fail && target.effectRecord(key).intent.kind === 'evaluate-round') { fail = false; throw new Error('SIMULATED_EVALUATION_ACK_LOSS'); }
      return target.recordEffectReceipt(key, receipt, revision);
    };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } });
  expect(await runController(options)).toMatchObject({ state: 'settling' });
  const evaluations = f.store().readJournal('run1').filter(row => row.event.body.kind === 'EVALUATE_ROUND'); expect(evaluations).toHaveLength(1);
  const result = await f.resume();
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed' });
  const replayed = f.store().readJournal('run1').filter(row => row.event.body.kind === 'EVALUATE_ROUND');
  expect(replayed).toEqual(evaluations); expect(f.calls).toHaveLength(10); f.close();
}, 60000);

it('leaves controls arriving after the pause commit queued until a positive successor resumes', async () => {
  const f = scenario({ questionWaves: 1 }), options = f.options('start'), target = f.store(); let queued: Promise<unknown> | null = null;
  options.store = new Proxy(target, { get(store, property) {
    if (property === 'commitTransition') return (...args: Parameters<typeof target.commitTransition>) => {
      const result = store.commitTransition(...args);
      if (!queued && args[2].body.kind === 'SETTLED' && args[3].snapshot.state === 'needs_user') {
        const batch = store.load('run1').context.control.questionBatch!;
        queued = submitControl(f.root, { kind: 'answers', requestId: 'after-pause-draft', runId: 'run1', batch: { requestId: 'after-pause-draft', batchId: batch.id, origin: batch.origin, baseContextHash: batch.baseContextHash, answers: [], finalized: false } });
      }
      return result;
    };
    const value = Reflect.get(store, property); return typeof value === 'function' ? value.bind(store) : value;
  } });
  expect(await runController(options)).toMatchObject({ state: 'needs_user', settlement: 'settled' }); await queued;
  expect(f.store().load('run1').context.control.pendingAnswerBatch).toBeNull();
  expect(await f.resume()).toMatchObject({ state: 'needs_user' });
  expect(f.store().load('run1').context.control.pendingAnswerBatch).toMatchObject({ requestId: 'after-pause-draft', finalized: false });
  expect(f.calls).toHaveLength(3); f.close();
}, 60000);
it('settles inbox cancellation received during result collection without adopting later votes', async () => {
  const f = scenario(), options = f.options('start'); let sent = false;
  f.hook(async binding => { if (!sent) { sent = true; await submitControl(f.root, { kind: 'cancel', requestId: 'live-cancel', runId: binding.runId }); } });
  const result = await runController(options);
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'cancelled', settlement: 'settled' });
  expect(f.calls).toHaveLength(3); f.close();
}, 60000);

it('does not execute an old evaluation intent after a context update invalidates its round', async () => {
  const f = scenario(), options = f.options('start'), target = f.store(); let queued = false;
  options.store = new Proxy(target, { get(store, property) {
    if (property === 'commitTransition') return (...args: Parameters<typeof target.commitTransition>) => {
      const receipt = store.commitTransition(...args);
      if (!queued && args[3].snapshot.state === 'evaluate_round') {
        queued = true;
        const snapshot = store.load('run1');
        void submitControl(f.root, { kind: 'context_update', requestId: 'evaluation-update', runId: 'run1', update: { requestId: 'evaluation-update', runId: 'run1', baseContextHash: snapshot.context.sharedContext.contextHash, userDirections: [store.artifacts.putArtifact(Buffer.from('Updated evaluation context'), 'user-direction')] } });
      }
      return receipt;
    };
    const value = Reflect.get(store, property); return typeof value === 'function' ? value.bind(store) : value;
  } });
  const result = await runController(options);
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed' });
  expect(f.inspect().roundsUsed).toBe(2);
  const evaluations = f.store().readJournal('run1').filter(row => row.event.body.kind === 'EVALUATE_ROUND');
  expect(evaluations).toHaveLength(1); expect(evaluations[0]!.event.id).toContain('/r2/evaluate_round/');
  const projection = readExecutionProjection(f.root, 'run1');
  expect(projection.effects.find(effect => effect.key.includes('/r1/evaluate_round/'))).toMatchObject({ rawStatus: 'pending_execution', derived: 'superseded_unexecuted' });
  expect(readExecutionProjection(f.root, 'run1')).toEqual(projection); f.close();
}, 60000);

import { readExecutionProjection } from '../../src/runtime/reconcile.js';
it('holds a legitimate unexecuted candidate through a transient reconciliation wrapper', async () => {
  const f = scenario(), options = f.options('start'), target = f.store();
  options.store = new Proxy(target, { get(store, key) {
    if (key === 'commitTransition') return (...args: Parameters<typeof target.commitTransition>) => { const result = store.commitTransition(...args); if (args[2].body.kind === 'REQUEST_CANDIDATE') throw new Error('INTENT_CRASH'); return result; };
    const value = Reflect.get(store, key); return typeof value === 'function' ? value.bind(store) : value;
  } });
  await runController(options); const before = f.store().load('run1'); f.close();
  const next = openRunStore(f.root), event: ValidatedEvent = { id: 'fixture-wrapper', runId: 'run1', schemaVersion: 1, actor: { kind: 'controller', receiptId: 'fixture' }, round: before.context.roundsUsed, phase: null, clockReceipt: captureClock(options.clock, options.processEpoch), body: { kind: 'CLOCK_CHECKPOINT', data: {} } };
  next.commitTransition('run1', before.revision, event, reduceRun(restoreForReconciliation(before), event), { restoreForReconciliation: true });
  expect(readExecutionProjection(f.root, 'run1').effects.find(effect => effect.kind === 'candidate-request')).toMatchObject({ rawStatus: 'pending_execution', derived: 'held', reason: 'TRANSIENT_BOUNDARY' }); next.close();
  expect(await f.resume()).toMatchObject({ state: 'completed' }); expect(f.calls).toHaveLength(10); f.close();
}, 60000);
it('retains an invalidated evidence intent and uncertain original marker across reopen without another action', async () => {
  const f = scenario(), declared = checkOptions(f), options = f.options('start'); let executions = 0;
  options.evidenceManifest = declared.evidenceManifest; options.coordinatorEvidence = async () => [declared.requested]; options.collectEvidence = async () => { executions++; throw new Error('MARKED_CRASH'); };
  await runController(options);
  const commit = (body: ControlEventBody) => { const snapshot = f.store().load('run1'), event: ValidatedEvent = { id: `fixture-${snapshot.revision}`, runId: 'run1', schemaVersion: 1, actor: { kind: body.kind === 'CONTEXT_UPDATE' ? 'user' : body.kind === 'PREFLIGHT' ? 'adapter' : 'controller', receiptId: 'negative-projection-fixture' }, round: snapshot.context.roundsUsed, phase: null, clockReceipt: captureClock(options.clock, options.processEpoch), body }; f.store().commitTransition('run1', snapshot.revision, event, reduceRun(snapshot, event)); };
  const before = f.store().load('run1');
  // Deliberately bypass the runtime gate in this negative fixture; no external action occurs.
  commit({ kind: 'CONTEXT_UPDATE', data: { update: { requestId: 'fixture-context', runId: 'run1', baseContextHash: before.context.sharedContext.contextHash, userDirections: [f.store().artifacts.putArtifact(Buffer.from('Changed context'), 'user-direction')] } } });
  commit({ kind: 'PHASE_READY', data: {} }); commit({ kind: 'PREFLIGHT', data: { status: 'pass', attestation: before.context.preflightAttestation, code: null, resourcesSettled: true } });
  expect(readExecutionProjection(f.root, 'run1').effects.find(effect => effect.kind === 'evidence')).toMatchObject({ rawStatus: 'pending_execution', derived: 'held_may_have_executed' });
  expect(await f.resume()).toMatchObject({ state: 'reconciling', settlement: 'unverifiable' });
  expect(readExecutionProjection(f.root, 'run1').effects.find(effect => effect.kind === 'evidence')).toMatchObject({ rawStatus: 'pending_execution', derived: 'held_may_have_executed' });
  expect(executions).toBe(1); expect(f.calls).toHaveLength(6); expect(f.store().load('run1').context.activeBudget.status).toBe('active'); f.close();
}, 60000);

for (const phase of ['review', 'judge', 'ballot'] as const) it(`fix1 adopts recovered ${phase} payloads before a queued ContextUpdate barrier`, async () => {
  const f = scenario(), options = f.options('start'), originalRead = options.readResult!;
  let crashed = false;
  const readResult: NonNullable<ControllerOptions['readResult']> = async binding => {
    const payload = JSON.parse(Buffer.from((await originalRead(binding))!).toString('utf8')) as WorkerPayload;
    if (payload.kind === 'review') payload.newObjections = [{ id: 'original', claimId: 'claim', claim: 'Retain this review objection', evidenceIds: [], resolution: 'Resolve it explicitly', status: 'open' }];
    if (payload.kind === 'ballot') {
      payload.newObjections = [{ id: 'late', claimId: 'late-claim', claim: 'Retain this ballot objection', evidenceIds: [], resolution: 'Resolve it explicitly', status: 'open' }];
      payload.dispositions = [{ objectionId: `run1/review/r1/${binding.role}/objection/original`, status: 'closed', reason: 'Resolved by this owner', evidenceIds: [] }];
      payload.missingInputQuestions = [{ id: 'late-question', text: 'What changed?', reason: 'Required context', blocking: true, answerForm: { kind: 'text' }, dependencies: [] }];
    }
    if (!crashed && binding.phase === phase) { crashed = true; throw new Error('FIX1_PHASE_CRASH'); }
    return Buffer.from(JSON.stringify(payload));
  };
  options.readResult = readResult;
  await runController(options);
  const before = f.store().load('run1'), callsBefore = f.calls.length;
  expect(before.state).toBe({ review: 'reviewing', judge: 'judging', ballot: 'confirming' }[phase]);
  await submitControl(f.root, { kind: 'context_update', requestId: 'fix1-recovered-update', runId: 'run1', update: { requestId: 'fix1-recovered-update', runId: 'run1', baseContextHash: before.context.sharedContext.contextHash, userDirections: [f.store().artifacts.putArtifact(Buffer.from('New user direction'), 'user-direction')] } });
  const result = await f.resume(0, { readResult, preflight: async snapshot => {
    if (snapshot.state === 'preflight' && snapshot.context.pendingContextUpdate) throw new Error('FIX1_BARRIER_OBSERVED');
    throw new Error('FIX1_OLD_CONTEXT_ADMISSION');
  } });
  expect(result.blockers).toContain('FIX1_BARRIER_OBSERVED');
  const journal = f.store().readJournal('run1').filter(row => row.revision > before.revision);
  const barrier = journal.findIndex(row => row.event.body.kind === 'PHASE_READY');
  const adopted = journal.slice(0, barrier).filter(row => row.event.body.kind === 'WORKER_RESULT' && row.event.phase === phase);
  expect(adopted).toHaveLength(phase === 'judge' ? 1 : 3);
  const after = f.store().load('run1');
  expect(after.context.objections.filter(item => item.id.includes('/review/r1/'))).toHaveLength(3);
  if (phase === 'ballot') {
    expect(after.context.objections.filter(item => item.id.includes('/review/r1/')).every(item => item.status === 'closed' && item.history.length === 1)).toBe(true);
    expect(after.context.objections.filter(item => item.id.includes('/ballot/r1/'))).toHaveLength(3);
    expect(after.context.control.stagedQuestions).toHaveLength(3);
  }
  expect(f.calls).toHaveLength(callsBefore); f.close();
}, 60000);

it('fix1 persists the start owner before the first accepted epoch event and a crash', async () => {
  const f = scenario(), options = f.options('start'), target = f.store(); let ownerBeforeCommit = false;
  options.store = new Proxy(target, { get(store, property) {
    if (property === 'commitTransition') return (...args: Parameters<typeof target.commitTransition>) => {
      ownerBeforeCommit = existsSync(join(f.root, 'controllers', `${hashArtifact('controller-epoch', args[2].clockReceipt.processEpoch)}.json`));
      store.commitTransition(...args); throw new Error('FIX1_FIRST_EVENT_CRASH');
    };
    const value = Reflect.get(store, property); return typeof value === 'function' ? value.bind(store) : value;
  } });
  await runController(options);
  expect(f.store().load('run1').context.activeBudget.lastReceipt.processEpoch).toBe(options.processEpoch);
  expect(ownerBeforeCommit).toBe(true);
  expect(await f.resume()).toMatchObject({ state: 'completed', settlement: 'settled' }); f.close();
}, 60000);

it('fix1 persists an active successor owner before its first accepted recovery event', async () => {
  const f = scenario(); let lost = false;
  f.hook(async () => { if (!lost) { lost = true; throw new Error('FIX1_ACTIVE_OWNER_LOSS'); } });
  await runController(f.options('start'));
  const target = f.store(), options = { ...f.options('resume'), processEpoch: 'fix1-active-successor' }; let ownerBeforeCommit = false;
  options.store = new Proxy(target, { get(store, property) {
    if (property === 'commitTransition') return (...args: Parameters<typeof target.commitTransition>) => {
      ownerBeforeCommit = existsSync(join(f.root, 'controllers', `${hashArtifact('controller-epoch', args[2].clockReceipt.processEpoch)}.json`));
      store.commitTransition(...args); throw new Error('FIX1_RECOVERY_EVENT_CRASH');
    };
    const value = Reflect.get(store, property); return typeof value === 'function' ? value.bind(store) : value;
  } });
  await runController(options);
  expect(f.store().load('run1').context.activeBudget.lastReceipt.processEpoch).toBe('fix1-active-successor');
  expect(ownerBeforeCommit).toBe(true);
  expect(await f.resume()).toMatchObject({ state: 'completed', settlement: 'settled' }); expect(f.calls).toHaveLength(10); f.close();
}, 60000);

for (const kind of ['answers', 'extend'] as const) it(`fix1 records the paused ${kind} owner's epoch before its early return`, async () => {
  const f = scenario({ questionWaves: 1 });
  await runController(f.options('start'));
  const before = f.store().load('run1'), batch = before.context.control.questionBatch!;
  if (kind === 'answers') await submitControl(f.root, { kind, requestId: 'fix1-draft', runId: 'run1', batch: { requestId: 'fix1-draft', batchId: batch.id, origin: batch.origin, baseContextHash: batch.baseContextHash, answers: [], finalized: false } });
  else await submitControl(f.root, { kind, requestId: 'fix1-extension', runId: 'run1', extension: { id: 'fix1-extension', baseRevision: before.revision, authorizationReceipt: 'fixture-user-authorization', expiresAt: Date.now() + 100000, additionalClarificationBatches: 0, additionalRounds: 0, additionalActiveBudgetMs: 1000 } });
  expect(await f.resume()).toMatchObject({ state: 'needs_user', settlement: 'settled' });
  const after = f.store().load('run1');
  // Paused accounting retains its closed interval receipt; the accepted event
  // itself still belongs to the new owner and needs a durable identity first.
  expect(after.context.activeBudget.lastReceipt).toEqual(before.context.activeBudget.lastReceipt);
  const event = f.store().readJournal('run1').filter(row => row.event.body.kind === (kind === 'answers' ? 'ANSWER_BATCH' : 'EXTEND')).at(-1)!.event;
  expect(event.clockReceipt.processEpoch).not.toBe(before.context.activeBudget.lastReceipt.processEpoch);
  expect(existsSync(join(f.root, 'controllers', `${hashArtifact('controller-epoch', event.clockReceipt.processEpoch)}.json`))).toBe(true);
  expect(f.calls).toHaveLength(3); f.close();
}, 60000);

function latestReport(f: ReturnType<typeof scenario>, outcome: import('../../src/domain/contracts.js').RunOutcome) {
  const ref = outcome.reports.filter(item => item.kind === 'report-json').at(-1)!;
  expect(ref).toBeDefined();
  const report = JSON.parse(Buffer.from(f.store().artifacts.readArtifact(ref)).toString('utf8'));
  return { ...report, settings: report.mapping.flatMap((entry: { observations: unknown[] }) => entry.observations) };
}
it('fix1 retains receipt-backed settings when settling recovers a physically launched attempt', async () => {
  const f = scenario(), options = f.options('start'), target = f.store(); let failed = false;
  options.store = new Proxy(target, { get(store, property) {
    if (property === 'commitTransition') return (...args: Parameters<typeof target.commitTransition>) => {
      if (!failed && args[2].body.kind === 'LAUNCH_RECEIPT_RECORDED') { failed = true; throw new Error('FIX1_PRE_RECEIPT_CRASH'); }
      return store.commitTransition(...args);
    };
    const value = Reflect.get(store, property); return typeof value === 'function' ? value.bind(store) : value;
  } });
  const result = await runController(options);
  expect(result).toMatchObject({ state: 'blocked', settlement: 'settled' });
  expect(f.calls).toHaveLength(1);
  expect(latestReport(f, result).settings).toEqual([expect.objectContaining({ role: 'openai', exposed: { route: 'codex', model: 'gpt-6.1-sol', effort: 'max' } })]); f.close();
}, 60000);
it('fix1 recovers immutable settings after a post-commit crash before the launch sidecar', async () => {
  const f = scenario(), options = f.options('start'), target = f.store(); let crashed = false;
  options.store = new Proxy(target, { get(store, property) {
    if (property === 'load' && crashed) return () => { throw new Error('FIX1_DEAD_PROCESS'); };
    if (property === 'commitTransition') return (...args: Parameters<typeof target.commitTransition>) => {
      const result = store.commitTransition(...args);
      if (args[2].body.kind === 'LAUNCH_RECEIPT_RECORDED') { crashed = true; throw new Error('FIX1_POST_RECEIPT_CRASH'); }
      return result;
    };
    const value = Reflect.get(store, property); return typeof value === 'function' ? value.bind(store) : value;
  } });
  await runController(options);
  const first = Object.values(f.store().load('run1').context.issuedLogicalTasks).find(task => task.binding)!;
  expect(first.stage).toBe('receipt_recorded');
  expect(existsSync(join(f.root, 'launch-receipts', `${hashArtifact('logical-task', first.reservation.logicalTaskKey)}.json`))).toBe(false);
  const result = await f.resume();
  expect(result).toMatchObject({ state: 'completed', settlement: 'settled' });
  expect(latestReport(f, result).settings).toHaveLength(10);
  expect(f.calls).toHaveLength(10); expect(new Set(f.calls.map(call => call.reservation.clientAttemptKey)).size).toBe(10); f.close();
}, 60000);
it('fix1 restores a lost launch sidecar from the same original immutable receipt', async () => {
  const f = scenario(); let crashed = false;
  f.hook(async () => { if (!crashed) { crashed = true; throw new Error('FIX1_RESULT_CRASH'); } });
  await runController(f.options('start'));
  const key = f.calls[0]!.reservation.logicalTaskKey, file = join(f.root, 'launch-receipts', `${hashArtifact('logical-task', key)}.json`), original = readFileSync(file, 'utf8');
  unlinkSync(file); // Deliberate loss of one task-owned temporary fixture sidecar.
  const result = await f.resume();
  expect(result).toMatchObject({ state: 'completed', settlement: 'settled' });
  expect(readFileSync(file, 'utf8')).toBe(original);
  expect(latestReport(f, result).settings).toHaveLength(10); expect(f.calls).toHaveLength(10); f.close();
}, 60000);

it('fix1 reports unavailable original launch proof without fabricating exposed settings or a successful exit', async () => {
  const settings = { lookupMissing: false }, f = scenario(settings); let crashed = false;
  f.hook(async () => { if (!crashed) { crashed = true; throw new Error('FIX1_RESULT_CRASH'); } });
  await runController(f.options('start'));
  const key = f.calls[0]!.reservation.logicalTaskKey;
  unlinkSync(join(f.root, 'launch-receipts', `${hashArtifact('logical-task', key)}.json`));
  settings.lookupMissing = true;
  const result = await f.resume();
  expect(result).toMatchObject({ state: 'completed', decision: 'blocked', settlement: 'settled', blockers: expect.arrayContaining(['LAUNCH_PROOF_UNAVAILABLE']) });
  const report = latestReport(f, result);
  expect(report.settings).toHaveLength(10);
  expect(report.settings.filter((setting: { exposed: unknown }) => setting.exposed === null)).toHaveLength(1);
  expect(report.outcome).toBe('blocked');
  expect((await import('../../src/cli/index.js')).outcomeExitCode(result)).toBe(3);
  expect(f.calls).toHaveLength(10); f.close();
}, 60000);

for (const recorded of [false, true]) it(`fix1 inspect rejects a settled model-only recovery with ${recorded ? 'an unknown check receipt' : 'an unrecovered check marker'}`, async () => {
  const f = scenario(), declared = checkOptions(f), options = f.options('start'); let record: import('../../src/domain/contracts.js').EvidenceRecord | null = null;
  options.evidenceManifest = declared.evidenceManifest; options.coordinatorEvidence = async () => [declared.requested];
  const collector = createEvidenceCollector({ sourceManifest: declared.evidenceManifest, environment: {}, artifacts: f.store().artifacts,
    retrieve: async () => { throw new Error('UNEXPECTED_RETRIEVAL'); },
    executeCheck: async ({ check }) => ({ kind: 'completed', executed: check, stdout: Buffer.from('fixture output'), stderr: Buffer.alloc(0), exitCode: 0, receiptId: 'fixture-check', resource: { id: 'fixture-unknown', pid: 12345, processGroupId: 12345, startedAtMs: 100, parentExitCode: 0, parentSignal: null, settlement: 'unverifiable', stopRequested: true, settlementReceiptId: null } }),
  });
  options.collectEvidence = async (request, snapshot) => { record = await collector.collectEvidence(request, snapshot.context.request.scope); throw new Error('FIX1_CHECK_RECEIPT_LOSS'); };
  await runController(options);
  const commit = (body: ControlEventBody, id?: string) => {
    const snapshot = f.store().load('run1'), event: ValidatedEvent = { id: id ?? `fix1-recovery-${snapshot.revision}`, runId: 'run1', schemaVersion: 1, actor: { kind: body.kind === 'CANCEL' ? 'user' : 'adapter', receiptId: 'fixture-model-only-recovery' }, round: snapshot.context.roundsUsed, phase: null, clockReceipt: captureClock(options.clock, options.processEpoch), body };
    f.store().commitTransition('run1', snapshot.revision, event, reduceRun(snapshot, event)); return event;
  };
  // Negative recovery fixture: the reducer accepts model-only settlement, while
  // Task7 owns the additional evidence-marker/resource guard. No snapshot rewrite.
  if (recorded) {
    const intent = f.store().pendingEffects('run1').find(intent => intent.kind === 'evidence')!;
    const event = commit({ kind: 'EVIDENCE_RECORDED', data: { record: record! } }, intent.key);
    f.store().recordEffectReceipt(intent.key, { eventId: event.id, value: JSON.parse(canonicalJson(record)) as JsonValue }, f.store().load('run1').revision);
  }
  commit({ kind: 'CANCEL', data: {} });
  commit({ kind: 'SETTLED', data: { receipt: f.store().artifacts.putArtifact(Buffer.from('Fixture model-only exit; no check settlement'), 'fixture-model-settlement') } });
  expect(f.store().load('run1').state).toBe('cancelled');
  const inspected = f.inspect();
  expect(inspected.settlement).toBe('unverifiable');
  expect(await f.resume()).toMatchObject({ state: 'cancelled', settlement: 'unverifiable' });
  const stdout: string[] = [];
  expect(await (await import('../../src/cli/index.js')).runCli(['cancel', '--workspace', f.request.workspace, '--run', 'run1', '--json'], { stdout: text => stdout.push(text), stderr: () => {}, wait: async () => {} })).not.toBe(130);
  expect(f.calls).toHaveLength(6); f.close();
}, 60000);
