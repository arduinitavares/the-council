import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { JsonValue, ModelSelection, ProfileSnapshot, RunScope, WorkerPhase, WorkerRole } from '../domain/contracts.js';
import { canonicalJson, hashArtifact } from '../domain/hash.js';
import { INPUT_LIMIT_BYTES, canonicalPathSchema, hashSchema, idSchema, modelSelectionSchema, profileSnapshotSchema, runScopeSchema, workerPhaseSchema, workerRoleSchema } from '../domain/schemas.js';
import { configSchema, isExactModelId } from '../config/schema.js';
import { profileInputSchema } from '../input/profiles.js';
import { artifactRefSchema } from '../domain/schemas.js';
import { readArtifact } from '../store/artifacts.js';
import { actionClassSchema, pathWithin, qualificationReceiptSchema, qualifySelection, versionsSchema } from './qualification.js';

export type ScopeDecision = { kind: 'ready' | 'blocked'; reason: string; receiptRefs: readonly string[] };
export interface ScopeEnvironment { protectedPaths?: readonly string[]; controls?: readonly { path: string; receiptId: string; qualificationId: string }[] }
const protectedName = /^(?:AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.env(?:\..*)?|\.envrc|\.git|\.codex|\.council|\.superpowers|\.ssh|\.agents|\.aws|\.npmrc|\.netrc|credentials(?:\.json)?|settings\.json|model-policy\.md)$/i;
const scopeFail = (reason: string): ScopeDecision => ({ kind: 'blocked', reason, receiptRefs: [] });
const scopeReady = (): ScopeDecision => ({ kind: 'ready', reason: 'READY', receiptRefs: [] });
function canonicalFuture(path: string): string {
  if (lstatSync(path, { throwIfNoEntry: false })) return realpathSync(path);
  const parent = dirname(path);
  if (parent === path) throw new Error('SCOPE_PATH_INVALID');
  return join(canonicalFuture(parent), path.slice(parent.length + (parent.endsWith('/') ? 0 : 1)));
}
function protectedTarget(path: string, roots: readonly string[], environment: ScopeEnvironment): boolean {
  const sensitive = (part: string) => protectedName.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part);
  return roots.some(root => pathWithin(path, root) && (sensitive(root.split('/').at(-1)!) || relative(root, path).split('/').some(sensitive))) || (environment.protectedPaths ?? []).some(protectedPath => pathWithin(path, protectedPath));
}
function validSourceRoots(roots: readonly string[]): boolean {
  return new Set(roots).size === roots.length && roots.every(root => root !== '/' && realpathSync(root) === root && lstatSync(root).isDirectory());
}
function sourcePathDecision(path: string, scope: RunScope, environment: ScopeEnvironment, future: boolean): ScopeDecision {
  try {
    canonicalPathSchema.parse(path);
    if (!scope.sourceRoots.some(root => pathWithin(path, root))) return scopeFail('SOURCE_ADDRESS_DENIED');
    const actual = future ? canonicalFuture(path) : realpathSync(path);
    if (!scope.sourceRoots.some(root => pathWithin(actual, root))) return scopeFail('SCOPE_SYMLINK_ESCAPE');
    if (protectedTarget(path, scope.sourceRoots, environment) || protectedTarget(actual, scope.sourceRoots, environment)) return scopeFail('SCOPE_PROTECTED_PATH');
    return scopeReady();
  } catch { return scopeFail('SCOPE_PATH_INVALID'); }
}

/** Task6 must call this on every requested source, immediately before retrieval.
 * Local paths use source roots. Remote addresses require an exact allowlist entry.
 * A source scope is not a worker filesystem grant, and controls do not allow reads
 * of protected targets. No directories or persistent permissions are created.
 */
export function validateSourceAddress(address: string, scope: RunScope, environment: ScopeEnvironment = {}): ScopeDecision {
  try {
    runScopeSchema.parse(scope);
    if (!validSourceRoots(scope.sourceRoots)) return scopeFail('SCOPE_PATH_INVALID');
    if (isAbsolute(address)) return sourcePathDecision(address, scope, environment, false);
    const url = new URL(address);
    if (url.username || url.password) return scopeFail('SOURCE_ADDRESS_DENIED');
    if (url.protocol === 'file:') return sourcePathDecision(fileURLToPath(url), scope, environment, false);
    return url.protocol === 'https:' && scope.allowedSourceAddresses.includes(address) ? scopeReady() : scopeFail('SOURCE_ADDRESS_DENIED');
  } catch { return scopeFail('SOURCE_ADDRESS_DENIED'); }
}

/** Validates coordinator evidence scope and declared checks without scanning a checkout. */
export function validateScope(scope: RunScope, environment: ScopeEnvironment = {}): ScopeDecision {
  try {
    const parsed = runScopeSchema.parse(scope);
    if (!validSourceRoots(parsed.sourceRoots)) return scopeFail('SCOPE_PATH_INVALID');
    const checks = new Set<string>();
    for (const check of parsed.checks) {
      const cwd = sourcePathDecision(check.cwd, parsed, environment, false);
      if (checks.has(check.id) || cwd.kind !== 'ready' || !lstatSync(realpathSync(check.cwd)).isDirectory() || check.argv.some(arg => arg.includes('\0'))) return scopeFail(cwd.reason === 'SCOPE_SYMLINK_ESCAPE' ? cwd.reason : 'SCOPE_CHECK_DENIED');
      checks.add(check.id);
      for (const path of check.outputTargets) {
        const output = sourcePathDecision(path, parsed, environment, true);
        if (output.kind !== 'ready') return scopeFail(output.reason === 'SCOPE_SYMLINK_ESCAPE' ? output.reason : 'SCOPE_OUTPUT_DENIED');
      }
    }
    for (const address of parsed.allowedSourceAddresses) {
      const decision = validateSourceAddress(address, parsed, environment);
      if (decision.kind !== 'ready') return decision;
    }
    return scopeReady();
  } catch { return scopeFail('SCOPE_PATH_INVALID'); }
}

/** Only actual worker grants are inspected recursively. Qualified controls must
 * already exist and are verified by runPreflight before this function is used.
 */
function validateWorkerRoots(roots: readonly string[], environment: ScopeEnvironment): ScopeDecision {
  try {
    const controls = environment.controls ?? [], visited = new Set<string>();
    let count = 0;
    const inspect = (path: string): string | null => {
      if (++count > 20000) return 'SCOPE_SCAN_LIMIT';
      const actual = realpathSync(path);
      if (!roots.some(root => pathWithin(actual, root))) return 'SCOPE_SYMLINK_ESCAPE';
      if (controls.some(control => control.path === path)) return null;
      if (protectedTarget(path, roots, environment) || protectedTarget(actual, roots, environment)) return 'SCOPE_PROTECTED_PATH';
      if (visited.has(actual)) return null; visited.add(actual);
      if (lstatSync(actual).isDirectory()) for (const entry of readdirSync(actual)) { const reason = inspect(join(actual, entry)); if (reason) return reason; }
      return null;
    };
    for (const root of roots) { const reason = inspect(root); if (reason) return scopeFail(reason); }
    return { kind: 'ready', reason: 'READY', receiptRefs: controls.map(control => control.receiptId) };
  } catch { return scopeFail('SCOPE_PATH_INVALID'); }
}

const roleSelectionSchema = modelSelectionSchema.extend({ role: workerRoleSchema });
// Omit models only for evidence that the provider exposes as route-wide allowance.
const allowanceSchema = z.strictObject({ route: z.enum(['codex', 'antigravity']), group: idSchema, state: z.enum(['available', 'unknown', 'exhausted', 'denied', 'authentication_failed']), receiptId: idSchema, models: z.array(idSchema).min(1).optional() });
export const preflightInputSchema = z.strictObject({
  runId: idSchema, now: z.number().finite(), host: idSchema, versions: versionsSchema, config: configSchema, configHash: hashSchema,
  profile: profileSnapshotSchema, artifactRoot: canonicalPathSchema,
  handoff: z.strictObject({ path: canonicalPathSchema, hash: hashSchema }),
  sourceManifest: z.array(z.strictObject({ address: idSchema, hash: hashSchema, receiptId: idSchema, artifact: artifactRefSchema.nullable() })),
  policy: z.strictObject({ path: canonicalPathSchema, bytes: z.instanceof(Uint8Array), hash: hashSchema, readReceipt: idSchema, admitted: z.array(roleSelectionSchema), maxVisibleWorkstreams: z.number().int().min(1).max(4), maxAstra: z.number().int().min(1).max(1), astraModels: z.array(idSchema).min(1) }),
  authorization: z.strictObject({ id: idSchema, runId: idSchema, policyHash: hashSchema, configHash: hashSchema, profileHash: hashSchema, selections: z.array(roleSelectionSchema), expiresAt: z.number().finite(), maxWorkerCalls: z.number().int().positive(), maxActiveMs: z.number().int().positive(), extraAstraSlots: z.number().int().nonnegative(), purpose: idSchema }),
  bounds: z.strictObject({ maxWorkerCalls: z.number().int().positive(), activeMs: z.number().int().positive() }),
  caller: z.strictObject({ model: idSchema.nullable(), receiptId: idSchema }),
  activeWorkers: z.array(z.strictObject({ id: idSchema, model: idSchema.nullable(), receiptId: idSchema, assignment: z.strictObject({ runId: idSchema, phase: workerPhaseSchema, role: workerRoleSchema, logicalTaskKey: idSchema }).optional() })),
  pendingAssignment: z.strictObject({ phase: workerPhaseSchema, roles: z.array(workerRoleSchema).min(1).max(3), receiptId: idSchema }).optional(),
  scope: runScopeSchema,
  scopeControls: z.array(z.strictObject({ path: canonicalPathSchema, receiptId: idSchema, qualificationId: idSchema })).optional(),
  protectedPaths: z.array(canonicalPathSchema).optional(),
  catalog: z.array(modelSelectionSchema.extend({ family: z.enum(['openai', 'gemini', 'claude']), efforts: z.array(idSchema), receiptId: idSchema, expiresAt: z.number().finite() })),
  qualifications: z.array(qualificationReceiptSchema),
  access: z.strictObject({ actionClass: actionClassSchema, requiredRoots: z.array(canonicalPathSchema), grantedRoots: z.array(canonicalPathSchema), receiptId: idSchema }),
  allowance: z.array(allowanceSchema),
});
export type PreflightInput = Omit<z.infer<typeof preflightInputSchema>, 'profile'> & { profile: ProfileSnapshot };
/** Persist with the preflight receipt. A concrete launch needs kind=phase, an
 * exact role/selection/set binding, and Task7's authoritative unissued-task fence.
 * Complete-run readiness is conservative planning evidence, not a call permit.
 */
export interface AdmissionEvidence {
  kind: 'complete-run' | 'phase'; runId: string; host: string; versions: PreflightInput['versions']; observedAt: number;
  configHash: string; profileHash: string; policyHash: string; scopeHash: string; accessHash: string;
  phase: WorkerPhase | null; assignments: readonly { role: WorkerRole; selection: ModelSelection }[];
  assignmentReceiptId: string | null; callerReceiptId: string; observationReceiptRefs: readonly string[];
  activeObservations: PreflightInput['activeWorkers']; authorizationReceiptId: string; bounds: PreflightInput['bounds']; setHash: string;
}
export type PreflightDecision =
  | { kind: 'ready'; reason: 'READY'; receiptRefs: readonly string[]; admission: AdmissionEvidence }
  | { kind: 'needs_context' | 'blocked'; reason: string; receiptRefs: readonly string[] };
const profileManifestSchema = z.strictObject({
  version: z.literal(1), revision: idSchema, selection: z.literal('independent-per-seat'), automaticDiscovery: z.literal(false), automaticInstallation: z.literal(false),
  methods: profileInputSchema.shape.methods,
  bundles: z.array(z.strictObject({ source: profileSnapshotSchema.shape.sources.element, artifact: artifactRefSchema })), restrictions: z.array(idSchema),
});

function readBoundedFile(path: string): Uint8Array {
  if (realpathSync(path) !== path) throw new Error('NONCANONICAL_PATH');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > INPUT_LIMIT_BYTES) throw new Error('INPUT_INVALID');
    const buffer = Buffer.alloc(INPUT_LIMIT_BYTES + 1);
    let size = 0;
    while (size < buffer.length) { const count = readSync(fd, buffer, size, buffer.length - size, null); if (!count) break; size += count; }
    if (size > INPUT_LIMIT_BYTES) throw new Error('INPUT_TOO_LARGE');
    return buffer.subarray(0, size);
  } finally { closeSync(fd); }
}

/** Gates new inference only. Observation, stop and lifecycle reconciliation do
 * not require a ready verdict. Human policy interpretation is an attestation.
 * activeWorkers contains every other active model entry, owned or foreign;
 * the caller is counted separately. Never omit owned workers on recovery.
 */
export function runPreflight(input: PreflightInput): PreflightDecision {
  const fail = (reason: string, receiptRefs: readonly string[] = [], kind: 'blocked' | 'needs_context' = 'blocked'): PreflightDecision => ({ kind, reason, receiptRefs });
  const decoded = preflightInputSchema.safeParse(input);
  if (!decoded.success) return fail('PREFLIGHT_INVALID');
  const x = decoded.data;
  if (createHash('sha256').update(x.policy.bytes).digest('hex') !== x.policy.hash) return fail('POLICY_HASH_MISMATCH', [x.policy.readReceipt]);
  try {
    if (createHash('sha256').update(readBoundedFile(x.policy.path)).digest('hex') !== x.policy.hash) return fail('POLICY_HASH_MISMATCH', [x.policy.readReceipt]);
  } catch { return fail('POLICY_UNAVAILABLE', [x.policy.readReceipt], 'needs_context'); }
  if (hashArtifact('council-config', x.config as unknown as JsonValue) !== x.configHash) return fail('CONFIG_HASH_MISMATCH');
  try {
    if (![process.env.TMPDIR || '/tmp', '/tmp'].some(root => pathWithin(x.handoff.path, realpathSync(root)))) return fail('HANDOFF_NOT_TEMPORARY');
    if (createHash('sha256').update(readBoundedFile(x.handoff.path)).digest('hex') !== x.handoff.hash) return fail('HANDOFF_HASH_MISMATCH', [], 'needs_context');
  } catch { return fail('HANDOFF_MISSING', [], 'needs_context'); }
  for (const source of x.sourceManifest) {
    if (validateSourceAddress(source.address, x.scope, { protectedPaths: [x.policy.path, x.artifactRoot, ...(x.protectedPaths ?? [])] }).kind !== 'ready') return fail('SOURCE_MANIFEST_DENIED', [source.receiptId]);
    if (source.artifact) {
      try { if (createHash('sha256').update(readArtifact(source.artifact, x.artifactRoot)).digest('hex') !== source.hash) return fail('SOURCE_MANIFEST_HASH_MISMATCH', [source.receiptId]); }
      catch { return fail('SOURCE_MANIFEST_UNAVAILABLE', [source.receiptId], 'needs_context'); }
    }
  }
  try {
    const manifest = profileManifestSchema.parse(JSON.parse(Buffer.from(readArtifact(x.profile.manifest, x.artifactRoot)).toString('utf8')));
    if (hashArtifact('council-profile', manifest as unknown as JsonValue) !== x.profile.profileHash || canonicalJson(manifest.methods.map(method => method.id)) !== canonicalJson(x.profile.admittedMethodIds) || canonicalJson(manifest.bundles.map(bundle => bundle.source)) !== canonicalJson(x.profile.sources) || canonicalJson(manifest.methods.map(method => ({ methodId: method.id, retained: method.retained, replaced: method.replaced, excluded: method.excluded }))) !== canonicalJson(x.profile.adaptations)) return fail('PROFILE_HASH_MISMATCH');
    for (const bundle of manifest.bundles) if (createHash('sha256').update(readArtifact(bundle.artifact, x.artifactRoot)).digest('hex') !== bundle.source.sha256) return fail('PROFILE_HASH_MISMATCH');
    if (new Set(manifest.methods.map(method => method.id)).size !== manifest.methods.length || new Set(manifest.bundles.map(bundle => bundle.source.id)).size !== manifest.bundles.length) return fail('PROFILE_HASH_MISMATCH');
    for (const method of manifest.methods) {
      if (method.restriction !== 'none') return fail('PROFILE_RESTRICTED_SOURCE');
      if (!method.bundleComplete || method.unavailableDependencies.some(dependency => !method.excludedDependencies.includes(dependency))) return fail('PROFILE_BUNDLE_INCOMPLETE');
      if (method.permissions.some(permission => permission !== 'supplied-text')) return fail('PROFILE_UNSAFE_METHOD');
      if (method.sources.some(source => !manifest.bundles.some(bundle => canonicalJson(bundle.source) === canonicalJson(source)))) return fail('PROFILE_HASH_MISMATCH');
    }
  } catch { return fail('PROFILE_UNAVAILABLE', [], 'needs_context'); }
  const approval = x.authorization;
  if (approval.runId !== x.runId || approval.policyHash !== x.policy.hash || approval.configHash !== x.configHash || approval.profileHash !== x.profile.profileHash || approval.expiresAt <= x.now || approval.maxWorkerCalls < x.bounds.maxWorkerCalls || approval.maxActiveMs < x.bounds.activeMs) return fail('AUTHORIZATION_INVALID', [approval.id]);
  if (!x.caller.model || !isExactModelId(x.caller.model)) return fail('CALLER_MODEL_UNKNOWN', [x.caller.receiptId]);
  if (x.activeWorkers.some(worker => !worker.model || !isExactModelId(worker.model))) return fail('ACTIVE_MODEL_UNKNOWN', x.activeWorkers.map(worker => worker.receiptId));
  const roster: readonly [WorkerRole, ModelSelection][] = [['openai', x.config.reviewers.openai], ['gemini', x.config.reviewers.gemini], ['claude', x.config.reviewers.claude], ['judge', x.config.judge]];
  const validRole = (phase: WorkerPhase, role: WorkerRole) => (phase === 'judge') === (role === 'judge');
  if (new Set(x.activeWorkers.map(worker => worker.id)).size !== x.activeWorkers.length || x.activeWorkers.some(worker => worker.assignment && (!validRole(worker.assignment.phase, worker.assignment.role) || worker.assignment.runId === x.runId && worker.model !== roster.find(([role]) => role === worker.assignment!.role)![1].model))) return fail('ACTIVE_OBSERVATION_INVALID', x.activeWorkers.map(worker => worker.receiptId));
  const pending = x.pendingAssignment;
  if (pending && (new Set(pending.roles).size !== pending.roles.length || pending.roles.some(role => !validRole(pending.phase, role)))) return fail('ASSIGNMENT_INVALID', [pending.receiptId]);
  if (pending && x.activeWorkers.some(worker => worker.assignment?.runId === x.runId && worker.assignment.phase === pending.phase && pending.roles.includes(worker.assignment.role))) return fail('ASSIGNMENT_ALREADY_ACTIVE', [pending.receiptId, ...x.activeWorkers.map(worker => worker.receiptId)]);
  const assignments = roster.filter(([role]) => !pending || pending.roles.includes(role)).map(([role, selection]) => ({ role, selection }));
  // Complete-run admission reserves the peak wave. Phase admission counts only
  // genuinely pending assignments; Task7 must still prove each journal fence.
  if (1 + x.activeWorkers.length + (pending ? assignments.length : 3) > x.policy.maxVisibleWorkstreams) return fail('WORKSTREAM_LIMIT', x.activeWorkers.map(worker => worker.receiptId));
  const isAstra = (model: string | null) => model !== null && x.policy.astraModels.includes(model);
  const reviewerAstra = Object.values(x.config.reviewers).filter(selection => isAstra(selection.model)).length;
  const scheduledAstra = pending ? assignments.filter(assignment => isAstra(assignment.selection.model)).length : Math.max(reviewerAstra, isAstra(x.config.judge.model) ? 1 : 0);
  const existingAstra = Number(isAstra(x.caller.model)) + x.activeWorkers.filter(worker => isAstra(worker.model)).length;
  if (scheduledAstra + existingAstra > x.policy.maxAstra + approval.extraAstraSlots) return fail(isAstra(x.caller.model) && scheduledAstra ? 'ASTRA_CALLER_CONFLICT' : 'ASTRA_SLOT_CONFLICT', [approval.id, x.caller.receiptId, ...x.activeWorkers.map(worker => worker.receiptId)]);
  const receipts = [x.policy.readReceipt, approval.id, x.caller.receiptId, x.access.receiptId];
  for (const [role, selection] of roster) {
    const catalog = x.catalog.find(entry => entry.route === selection.route && entry.model === selection.model && entry.expiresAt > x.now);
    if (!catalog) return fail('MODEL_UNAVAILABLE');
    if (role !== 'judge' && catalog.family !== role || catalog.family === 'openai' && selection.route !== 'codex' || catalog.family !== 'openai' && selection.route !== 'antigravity') return fail('MODEL_FAMILY_MISMATCH', [catalog.receiptId]);
    if (!catalog.efforts.includes(selection.effort)) return fail('EFFORT_UNSUPPORTED', [catalog.receiptId]);
    const admits = (entry: z.infer<typeof roleSelectionSchema>) => entry.role === role && entry.route === selection.route && entry.model === selection.model && entry.effort === selection.effort;
    if (!x.policy.admitted.some(admits)) return fail('POLICY_NOT_ADMITTED', [x.policy.readReceipt]);
    if (!approval.selections.some(admits)) return fail('AUTHORIZATION_INVALID', [approval.id]);
    const qualification = qualifySelection({ selection, host: x.host, versions: x.versions, actionClass: x.access.actionClass, roots: x.access.requiredRoots, now: x.now }, x.qualifications);
    if (qualification.kind !== 'ready') return fail(qualification.reason, qualification.receiptRefs);
    receipts.push(catalog.receiptId, ...qualification.receiptRefs);
    const quota = x.allowance.filter(allowance => allowance.route === selection.route && (!allowance.models || allowance.models.includes(selection.model)));
    if (!quota.length) return fail('ALLOWANCE_UNKNOWN');
    for (const allowance of quota) {
      const reason = { exhausted: 'QUOTA_EXHAUSTED', denied: 'PERMISSION_DENIED', authentication_failed: 'AUTHENTICATION_FAILED' }[allowance.state as 'exhausted' | 'denied' | 'authentication_failed'];
      if (reason) return fail(reason, [allowance.receiptId]); receipts.push(allowance.receiptId);
    }
  }
  try {
    if (x.access.actionClass === 'supplied-packet-read-only' && (x.access.requiredRoots.length || x.access.grantedRoots.length)) return fail('ACCESS_ROOT_DENIED', [x.access.receiptId]);
    if (x.access.grantedRoots.some(root => realpathSync(root) !== root || !x.scope.sourceRoots.some(allowed => pathWithin(root, allowed)))) return fail('ACCESS_ROOT_DENIED', [x.access.receiptId]);
    if (x.access.requiredRoots.some(root => realpathSync(root) !== root || !x.access.grantedRoots.some(allowed => pathWithin(root, allowed)))) return fail('ACCESS_ROOT_DENIED', [x.access.receiptId]);
  } catch { return fail('ACCESS_ROOT_DENIED', [x.access.receiptId]); }
  for (const control of x.scopeControls ?? []) {
    const receipt = x.qualifications.find(receipt => receipt.id === control.qualificationId && receipt.protectedPaths?.includes(control.path));
    if (!receipt || qualifySelection({ selection: receipt.requested, host: x.host, versions: x.versions, actionClass: x.access.actionClass, roots: x.access.requiredRoots, now: x.now }, [receipt]).kind !== 'ready') return fail('ACCESS_CONTROL_UNQUALIFIED', [control.receiptId]);
  }
  // A path exemption applies to every worker receiving these grants. Prove the
  // control for each exact roster selection, including roles outside a pending wave.
  for (const path of new Set((x.scopeControls ?? []).map(control => control.path))) {
    if (!x.access.grantedRoots.some(root => pathWithin(path, root))) continue;
    const controls = x.scopeControls!.filter(control => control.path === path);
    const qualifications = x.qualifications.filter(receipt => receipt.protectedPaths?.includes(path) && controls.some(control => control.qualificationId === receipt.id));
    for (const [, selection] of roster) {
      const qualification = qualifySelection({ selection, host: x.host, versions: x.versions, actionClass: x.access.actionClass, roots: x.access.grantedRoots, now: x.now }, qualifications);
      if (qualification.kind !== 'ready') return fail('ACCESS_CONTROL_UNQUALIFIED', controls.map(control => control.receiptId));
      receipts.push(...qualification.receiptRefs);
    }
  }
  for (const protectedPath of [x.policy.path, x.artifactRoot]) if (x.access.grantedRoots.some(root => pathWithin(protectedPath, root)) && !x.scopeControls?.some(control => control.path === protectedPath)) return fail('SCOPE_PROTECTED_PATH');
  const workerAccess = validateWorkerRoots(x.access.grantedRoots, { controls: x.scopeControls ?? [], protectedPaths: [x.policy.path, x.artifactRoot, ...(x.protectedPaths ?? [])] });
  if (workerAccess.kind !== 'ready') return fail(workerAccess.reason, [x.access.receiptId, ...workerAccess.receiptRefs]);
  const scope = validateScope(x.scope, { protectedPaths: [x.policy.path, x.artifactRoot, ...(x.protectedPaths ?? [])] });
  if (scope.kind !== 'ready') return fail(scope.reason, [x.access.receiptId, ...scope.receiptRefs]);
  const admission: Omit<AdmissionEvidence, 'setHash'> = {
    kind: pending ? 'phase' : 'complete-run', runId: x.runId, host: x.host, versions: x.versions, observedAt: x.now,
    configHash: x.configHash, profileHash: x.profile.profileHash, policyHash: x.policy.hash,
    scopeHash: hashArtifact('run-scope', x.scope as unknown as JsonValue), accessHash: hashArtifact('access-facts', x.access as unknown as JsonValue),
    phase: pending?.phase ?? null, assignments, assignmentReceiptId: pending?.receiptId ?? null, callerReceiptId: x.caller.receiptId,
    observationReceiptRefs: x.activeWorkers.map(worker => worker.receiptId), activeObservations: x.activeWorkers.map(worker => ({ id: worker.id, model: worker.model, receiptId: worker.receiptId, ...(worker.assignment ? { assignment: worker.assignment } : {}) })), authorizationReceiptId: approval.id, bounds: x.bounds,
  };
  return { kind: 'ready', reason: 'READY', receiptRefs: [...new Set([...receipts, ...workerAccess.receiptRefs, ...scope.receiptRefs, ...(pending ? [pending.receiptId] : [])])], admission: { ...admission, setHash: hashArtifact('launch-admission', admission as unknown as JsonValue) } };
}
