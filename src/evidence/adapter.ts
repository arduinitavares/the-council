import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ArtifactRef, Ballot, CheckSpec, EvidenceRecord, EvidenceRequest, JsonValue, RunScope } from '../domain/contracts.js';
import { canonicalJson, hashArtifact } from '../domain/hash.js';
import { artifactRefSchema, checkSpecSchema, evidenceRecordSchema, evidenceRequestSchema, hashSchema, INPUT_LIMIT_BYTES, runScopeSchema } from '../domain/schemas.js';
import type { ScopeEnvironment } from '../policy/preflight.js';
import type { ArtifactStore } from '../store/artifacts.js';
import { declaredCheck, evidenceEnvironment, sameCheck, sourceDecision, sourceManifestSchema, type SourceManifest } from './scope.js';

const text = z.string().min(1), bytes = z.instanceof(Uint8Array);
const failure = { reason: text, receiptId: text };
export const checkResourceSchema = z.strictObject({
  id: text, pid: z.number().int().positive(), processGroupId: z.number().int().positive(), startedAtMs: z.number().finite().nonnegative(),
  parentExitCode: z.number().int().nullable(), parentSignal: text.nullable(),
  settlement: z.enum(['settled', 'unverifiable']), stopRequested: z.boolean(), settlementReceiptId: text.nullable(),
}).refine(resource => (resource.settlement === 'settled') === (resource.settlementReceiptId !== null), 'CHECK_SETTLEMENT_RECEIPT_REQUIRED');
export type CheckResource = z.infer<typeof checkResourceSchema>;
const checkDetails = { resource: checkResourceSchema.optional(), qualification: artifactRefSchema.optional(), notStarted: z.literal(true).optional(), executed: checkSpecSchema.optional(), stdout: bytes.optional(), stderr: bytes.optional() };
const sourceObservationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('observed'), bytes, revision: text.nullable(), receiptId: text }),
  z.strictObject({ kind: z.literal('redirect'), address: text, receiptId: text }),
  z.strictObject({ kind: z.literal('denied'), ...failure }),
  z.strictObject({ kind: z.literal('unverified'), ...failure }),
]);
const checkObservationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('completed'), executed: checkSpecSchema, stdout: bytes, stderr: bytes, exitCode: z.number().int().nullable(), receiptId: text, resource: checkResourceSchema.optional(), qualification: artifactRefSchema.optional() }),
  z.strictObject({ kind: z.literal('denied'), ...failure, ...checkDetails }),
  z.strictObject({ kind: z.literal('unverified'), ...failure, ...checkDetails }),
]);
export type SourceObservation = z.infer<typeof sourceObservationSchema>;
export type CheckObservation =
  | { kind: 'completed'; executed: CheckSpec; stdout: Uint8Array; stderr: Uint8Array; exitCode: number | null; receiptId: string; resource?: CheckResource; qualification?: ArtifactRef }
  | { kind: 'denied' | 'unverified'; reason: string; receiptId: string; resource?: CheckResource; notStarted?: true; executed?: CheckSpec; stdout?: Uint8Array; stderr?: Uint8Array; qualification?: ArtifactRef };
export interface SourceRead { address: string; expectedRevision: string; maxBytes: number; timeoutMs: number }
export interface CheckExecution { check: CheckSpec; maxBytes: number; timeoutMs: number }
/** I/O implementations must use one hop only and respect both limits. */
export interface EvidenceIO {
  retrieve(input: SourceRead): Promise<SourceObservation>;
  executeCheck(input: CheckExecution): Promise<CheckObservation>;
}
export interface EvidenceDependencies extends EvidenceIO {
  sourceManifest: SourceManifest;
  environment: ScopeEnvironment;
  artifacts: ArtifactStore;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}
export const evidenceReceiptSchema = z.strictObject({
  version: z.literal(1), request: evidenceRequestSchema, scopeHash: hashSchema,
  status: evidenceRecordSchema.shape.status, sourceLocation: text,
  expectedRevision: text.nullable(), observedRevision: text.nullable(),
  command: checkSpecSchema.nullable(), executed: checkSpecSchema.nullable(),
  content: artifactRefSchema.nullable(), stdout: artifactRefSchema.nullable(), stderr: artifactRefSchema.nullable(),
  contentHash: hashSchema, exitCode: z.number().int().nullable(), checkPassed: z.boolean().nullable(),
  checkResource: checkResourceSchema.nullable(), outputComplete: z.boolean().nullable(),
  checkResourceState: z.enum(['none', 'settled', 'unverifiable']),
  checkQualification: artifactRefSchema.nullable(),
  priorObservationReceipt: text.nullable(),
  hops: z.array(z.strictObject({ address: text, receiptId: text })),
  uncertainty: z.array(text), denied: z.boolean(),
});
export type EvidenceReceipt = Omit<z.infer<typeof evidenceReceiptSchema>, 'command' | 'executed'> & { command: CheckSpec | null; executed: CheckSpec | null };

function limits(maxBytes = INPUT_LIMIT_BYTES, timeoutMs = 10000) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > INPUT_LIMIT_BYTES || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1800000) throw new Error('INVALID_EVIDENCE_LIMITS');
  return { maxBytes, timeoutMs };
}
function code(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'IO_ERROR';
}
function denied(error: unknown): boolean { return ['EACCES', 'EPERM'].includes(code(error)); }

/** The bound two-argument API has no implicit I/O, grants, or artifact store. */
export function createEvidenceCollector(dependencies: EvidenceDependencies) {
  const manifest = sourceManifestSchema.parse(dependencies.sourceManifest);
  const environment = evidenceEnvironment(dependencies.environment, dependencies.artifacts.root);
  const bound = limits(dependencies.maxBytes, dependencies.timeoutMs), maxRedirects = dependencies.maxRedirects ?? 5;
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) throw new Error('INVALID_REDIRECT_LIMIT');
  const stopped = new Set<string>(), active = new Map<string, EvidenceReceipt>();
  const stoppedReceipts = new Map<string, { record: EvidenceRecord; receipt: EvidenceReceipt }>();
  return {
    async collectEvidence(input: EvidenceRequest, inputScope: RunScope): Promise<EvidenceRecord> {
      const request = evidenceRequestSchema.parse(input), scope = runScopeSchema.parse(inputScope);
      const entry = manifest.find(source => source.address === request.source);
      const receipt: EvidenceReceipt = {
        version: 1, request, scopeHash: hashArtifact('evidence-scope', scope), status: 'unverified', sourceLocation: request.source,
        expectedRevision: entry?.revision ?? null, observedRevision: null, command: null, executed: null,
        content: null, stdout: null, stderr: null, contentHash: hashArtifact('evidence-unobserved', { requestId: request.id, source: request.source }),
        exitCode: null, checkPassed: null, checkResource: null, outputComplete: null, checkResourceState: 'none', checkQualification: null, priorObservationReceipt: null, hops: [], uncertainty: [], denied: false,
      };
      const save = (): EvidenceRecord => {
        evidenceReceiptSchema.parse(receipt);
        const artifact = dependencies.artifacts.putArtifact(Buffer.from(canonicalJson(receipt)), 'evidence-receipt');
        const record = evidenceRecordSchema.parse({ requestId: request.id, status: receipt.status, sourceLocation: receipt.sourceLocation, contentHash: receipt.contentHash, observationReceipt: canonicalJson(artifact) });
        if (stopped.has(request.source) && !stoppedReceipts.has(request.source)) stoppedReceipts.set(request.source, { record, receipt: structuredClone(receipt) });
        return record;
      };
      const fail = (reason: string, actualDenial = false) => {
        receipt.uncertainty.push(reason); receipt.denied = actualDenial;
        if (actualDenial || receipt.checkResourceState === 'unverifiable') stopped.add(request.source);
        return save();
      };
      const retain = (prior: EvidenceReceipt) => Object.assign(receipt, {
        command: prior.command, executed: prior.executed, content: prior.content, stdout: prior.stdout, stderr: prior.stderr,
        contentHash: prior.contentHash, exitCode: prior.exitCode, checkResource: prior.checkResource,
        outputComplete: prior.outputComplete, checkResourceState: prior.checkResourceState, checkQualification: prior.checkQualification,
      });
      if (!entry) return fail('SOURCE_NOT_IN_MANIFEST');
      if (stopped.has(request.source)) {
        const prior = stoppedReceipts.get(request.source);
        if (prior) { retain(prior.receipt); receipt.priorObservationReceipt = prior.record.observationReceipt; }
        const actualDenial = prior?.receipt.denied ?? true;
        return fail(actualDenial ? 'AFFECTED_ACTION_DENIED' : 'AFFECTED_ACTION_STOPPED', actualDenial);
      }
      const priorActive = active.get(request.source);
      if (priorActive) { retain(priorActive); return fail('AFFECTED_ACTION_IN_FLIGHT'); }
      active.set(request.source, receipt);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const observe = async <T>(operation: () => Promise<T>): Promise<T> => {
        try {
          return await Promise.race([operation(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('IO_TIMEOUT_UNSETTLED')), bound.timeoutMs + 1500);
          })]);
        } finally { if (timer) clearTimeout(timer); }
      };
      try {
        if (entry.kind === 'check') {
          const check = declaredCheck(entry.checkId, scope, environment);
          if (!check) return fail('CHECK_NOT_DECLARED_OR_OUTSIDE_SCOPE');
          receipt.command = check; receipt.checkResourceState = 'unverifiable';
          const observation = checkObservationSchema.parse(await observe(() => dependencies.executeCheck({ check: structuredClone(check), ...bound })));
          receipt.hops.push({ address: request.source, receiptId: observation.receiptId });
          receipt.executed = observation.executed ?? null; receipt.checkResource = observation.resource ?? null;
          receipt.checkQualification = observation.qualification ?? null;
          receipt.checkResourceState = observation.resource?.settlement ?? (observation.kind !== 'completed' && observation.notStarted ? 'none' : 'unverifiable');
          if (observation.executed && !sameCheck(check, observation.executed)) { receipt.status = 'invalid'; stopped.add(request.source); return fail('CHECK_EXECUTION_MISMATCH'); }
          if ((observation.stdout?.byteLength ?? 0) + (observation.stderr?.byteLength ?? 0) > bound.maxBytes) return fail('CHECK_OUTPUT_LIMIT');
          if (observation.stdout) receipt.stdout = dependencies.artifacts.putArtifact(observation.stdout, 'check-stdout');
          if (observation.stderr) receipt.stderr = dependencies.artifacts.putArtifact(observation.stderr, 'check-stderr');
          receipt.exitCode = observation.kind === 'completed' ? observation.exitCode : observation.resource?.parentExitCode ?? null;
          receipt.outputComplete = observation.kind === 'completed';
          receipt.contentHash = hashArtifact('check-output', { stdout: receipt.stdout, stderr: receipt.stderr, exitCode: receipt.exitCode, complete: receipt.outputComplete } as unknown as JsonValue);
          if (observation.kind !== 'completed') {
            if (observation.resource?.settlement === 'unverifiable') stopped.add(request.source);
            return fail(observation.reason, observation.kind === 'denied');
          }
          if (!observation.resource || observation.resource.settlement !== 'settled') { stopped.add(request.source); return fail('CHECK_RESOURCE_UNVERIFIED'); }
          receipt.checkPassed = observation.exitCode === null ? null : observation.exitCode === 0;
          receipt.status = observation.exitCode === null ? 'unverified' : 'verified';
          // A manifest revision describes the declared check. It is not an observed source revision.
          if (observation.exitCode === null) receipt.uncertainty.push('CHECK_EXIT_UNVERIFIED');
        } else {
          let address = entry.address;
          const seen = new Set<string>();
          for (let hop = 0; ; hop++) {
            if (seen.has(address) || hop > maxRedirects) return fail('SOURCE_REDIRECT_LIMIT');
            seen.add(address);
            if (stopped.has(address)) {
              const prior = stoppedReceipts.get(address);
              if (prior) { retain(prior.receipt); receipt.priorObservationReceipt = prior.record.observationReceipt; }
              const actualDenial = prior?.receipt.denied ?? true;
              return fail(actualDenial ? 'AFFECTED_ACTION_DENIED' : 'AFFECTED_ACTION_STOPPED', actualDenial);
            }
            // This is the last operation before invoking the one-hop retrieval dependency.
            const decision = sourceDecision(address, scope, environment);
            if (decision.kind !== 'ready') return fail(decision.reason);
            const observation = sourceObservationSchema.parse(await observe(() => dependencies.retrieve({ address, expectedRevision: entry.revision, ...bound })));
            receipt.hops.push({ address, receiptId: observation.receiptId }); receipt.sourceLocation = address;
            if (observation.kind === 'redirect') { address = observation.address; continue; }
            if (observation.kind !== 'observed') {
              if (observation.kind === 'denied') stopped.add(address);
              return fail(observation.reason, observation.kind === 'denied');
            }
            if (observation.bytes.byteLength > bound.maxBytes) return fail('SOURCE_SIZE_LIMIT');
            receipt.content = dependencies.artifacts.putArtifact(observation.bytes, 'evidence-content');
            receipt.contentHash = receipt.content.sha256; receipt.observedRevision = observation.revision;
            if (observation.revision === null) return fail('SOURCE_REVISION_UNVERIFIED');
            receipt.status = observation.revision === entry.revision ? 'verified' : 'invalid';
            if (receipt.status === 'invalid') receipt.uncertainty.push('SOURCE_REVISION_MISMATCH');
            break;
          }
        }
        return save();
      } catch (error) {
        if (error instanceof Error && error.message === 'IO_TIMEOUT_UNSETTLED') { stopped.add(request.source); return fail('IO_TIMEOUT_UNSETTLED'); }
        return fail(denied(error) ? 'PERMISSION_DENIED' : 'EVIDENCE_IO_OR_RECEIPT_INVALID', denied(error));
      } finally { active.delete(request.source); }
    },
  };
}

export function readEvidenceReceipt(record: EvidenceRecord, artifacts: ArtifactStore): EvidenceReceipt {
  evidenceRecordSchema.parse(record);
  const ref = artifactRefSchema.parse(JSON.parse(record.observationReceipt));
  if (ref.kind !== 'evidence-receipt') throw new Error('EVIDENCE_RECEIPT_KIND_MISMATCH');
  const receipt = evidenceReceiptSchema.parse(JSON.parse(Buffer.from(artifacts.readArtifact(ref)).toString('utf8')));
  if (receipt.request.id !== record.requestId || receipt.status !== record.status || receipt.sourceLocation !== record.sourceLocation || receipt.contentHash !== record.contentHash) throw new Error('EVIDENCE_RECEIPT_MISMATCH');
  return receipt;
}

export function freezeEvidenceBundle(input: readonly EvidenceRecord[], ballots: readonly Ballot[]) {
  const records = input.map(record => evidenceRecordSchema.parse(record));
  if (new Set(records.map(record => record.requestId)).size !== records.length) throw new Error('DUPLICATE_EVIDENCE_ID');
  const hash = hashArtifact('evidence-bundle', records);
  return Object.freeze({ records: Object.freeze(records.map(record => Object.freeze(record))), hash, invalidatedBallotAttemptIds: Object.freeze(ballots.filter(ballot => ballot.bindings.evidenceHash !== hash).map(ballot => ballot.binding.attemptId)) });
}

const nodeCheckAdmissionSchema = z.strictObject({
  host: text,
  runner: z.strictObject({ id: z.literal('council-node-evidence-io/v1'), nodeVersion: text, executable: text, implementationHash: hashSchema }),
  check: checkSpecSchema, scopeHash: hashSchema, environmentScopeHash: hashSchema,
  environment: z.strictObject({ PATH: z.literal('/usr/bin:/bin'), LANG: z.literal('C') }),
  maxBytes: z.number().int().positive().max(INPUT_LIMIT_BYTES), timeoutMs: z.number().int().positive().max(1800000),
});
export const checkRunnerQualificationSchema = z.strictObject({
  version: z.literal(1), id: text, admission: nodeCheckAdmissionSchema,
  issuedAtMs: z.number().finite().nonnegative(), expiresAtMs: z.number().finite().positive(),
  authority: artifactRefSchema,
  containment: z.strictObject({ kind: z.enum(['no-detach', 'descendant-containment']), receipt: artifactRefSchema }),
  observationReceipts: z.array(artifactRefSchema).min(1),
});
export type CheckRunnerQualification = z.infer<typeof checkRunnerQualificationSchema>;
export interface CheckAdmissionRegistry {
  artifacts: ArtifactStore;
  /** Existing coordinator-owned admission receipt, never a source/model assertion. */
  authority: ArtifactRef;
  qualifications: readonly ArtifactRef[];
}
export interface NodeEvidenceOptions {
  scope: RunScope; environment: ScopeEnvironment; maxBytes: number; timeoutMs: number;
  checkAdmission?: CheckAdmissionRegistry;
}
const nodeCheckEnvironment = { PATH: '/usr/bin:/bin', LANG: 'C' } as const;
/** Describes bindings only. It neither creates nor qualifies any receipt or action. */
export function describeNodeCheckAdmission(options: NodeEvidenceOptions, check: CheckSpec, requested = limits(options.maxBytes, options.timeoutMs)): z.infer<typeof nodeCheckAdmissionSchema> {
  const implementationHash = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  const environment = options.checkAdmission ? evidenceEnvironment(options.environment, options.checkAdmission.artifacts.root) : options.environment;
  return nodeCheckAdmissionSchema.parse({
    host: hostname(), runner: { id: 'council-node-evidence-io/v1', nodeVersion: process.version, executable: realpathSync(process.execPath), implementationHash },
    check, scopeHash: hashArtifact('evidence-scope', runScopeSchema.parse(options.scope)), environmentScopeHash: hashArtifact('evidence-environment', environment as unknown as JsonValue),
    environment: nodeCheckEnvironment, ...limits(Math.min(requested.maxBytes, options.maxBytes), Math.min(requested.timeoutMs, options.timeoutMs)),
  });
}
/** Explicit local I/O. Exact declared commands are trusted caller input, never fetched text.
 * This admission boundary is not an OS sandbox. Effectful checks require a separately
 * qualified caller runner. Even no-output/no-effect checks require an existing
 * coordinator-admitted containment qualification; this adapter never creates one.
 */
export function createNodeEvidenceIO(options: NodeEvidenceOptions): EvidenceIO {
  const scope = runScopeSchema.parse(options.scope), suppliedEnvironment = structuredClone(options.environment), cap = limits(options.maxBytes, options.timeoutMs);
  const registry = options.checkAdmission ? { artifacts: options.checkAdmission.artifacts, authority: artifactRefSchema.parse(options.checkAdmission.authority), qualifications: options.checkAdmission.qualifications.map(ref => artifactRefSchema.parse(ref)) } : null;
  const environment = registry ? evidenceEnvironment(suppliedEnvironment, registry.artifacts.root) : suppliedEnvironment;
  const admissionOptions: NodeEvidenceOptions = { scope, environment: suppliedEnvironment, ...cap, ...(registry ? { checkAdmission: registry } : {}) };
  const stopped = new Set<string>();
  const unsettledChecks = new Map<string, CheckObservation>();
  const failureResult = (reason: string, isDenial = false): { kind: 'denied' | 'unverified'; reason: string; receiptId: string } => ({ kind: isDenial ? 'denied' : 'unverified', reason, receiptId: `node-io:${randomUUID()}` });
  const qualifiedCheck = (check: CheckSpec, bound: ReturnType<typeof limits>): ArtifactRef | null => {
    if (!registry) return null;
    try {
      registry.artifacts.readArtifact(registry.authority);
      const expected = describeNodeCheckAdmission(admissionOptions, check, bound), now = Date.now();
      for (const ref of registry.qualifications) {
        try {
          if (ref.kind !== 'check-runner-qualification') continue;
          const qualification = checkRunnerQualificationSchema.parse(JSON.parse(Buffer.from(registry.artifacts.readArtifact(ref)).toString('utf8')));
          if (qualification.issuedAtMs > now || qualification.expiresAtMs <= now + bound.timeoutMs + 1000 || canonicalJson(qualification.authority) !== canonicalJson(registry.authority) || canonicalJson(qualification.admission) !== canonicalJson(expected)) continue;
          registry.artifacts.readArtifact(qualification.containment.receipt);
          for (const observation of qualification.observationReceipts) registry.artifacts.readArtifact(observation);
          return ref;
        } catch { /* A stale/missing/corrupt record cannot admit an action. */ }
      }
    } catch { /* Unknown admission authority remains unqualified. */ }
    return null;
  };
  return {
    async retrieve(input) {
      const bound = limits(Math.min(input.maxBytes, cap.maxBytes), Math.min(input.timeoutMs, cap.timeoutMs));
      if (stopped.has(input.address)) return failureResult('AFFECTED_ACTION_DENIED', true);
      let fd: number | undefined;
      try {
        const decision = sourceDecision(input.address, scope, environment);
        if (decision.kind !== 'ready') return failureResult(decision.reason, true);
        if (!isAbsolute(input.address) && !input.address.startsWith('file:')) return failureResult('REMOTE_ADAPTER_REQUIRED');
        const target = realpathSync(isAbsolute(input.address) ? input.address : fileURLToPath(input.address));
        const actualDecision = sourceDecision(target, scope, environment);
        if (actualDecision.kind !== 'ready') return failureResult(actualDecision.reason, true);
        const start = performance.now();
        fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const before = fstatSync(fd);
        if (!before.isFile()) return failureResult('SOURCE_NOT_REGULAR_FILE');
        if (before.nlink !== 1) return failureResult('SOURCE_HARDLINK_UNQUALIFIED');
        if (before.size > bound.maxBytes) return failureResult('SOURCE_SIZE_LIMIT');
        const content = Buffer.alloc(Math.min(before.size + 1, bound.maxBytes + 1));
        let offset = 0;
        while (offset < content.length) {
          if (performance.now() - start > bound.timeoutMs) return failureResult('SOURCE_TIMEOUT');
          const count = readSync(fd, content, offset, content.length - offset, null);
          if (count === 0) break;
          offset += count;
        }
        if (offset > bound.maxBytes) return failureResult('SOURCE_SIZE_LIMIT');
        const after = fstatSync(fd);
        if (before.size !== offset || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || realpathSync(target) !== target) return failureResult('SOURCE_CHANGED_DURING_READ');
        const result = content.subarray(0, offset);
        return { kind: 'observed', bytes: result, revision: `sha256:${createHash('sha256').update(result).digest('hex')}`, receiptId: `node-source:${randomUUID()}` };
      } catch (error) {
        if (denied(error)) stopped.add(input.address);
        return failureResult(code(error), denied(error));
      } finally { if (fd !== undefined) closeSync(fd); }
    },
    async executeCheck(input) {
      const bound = limits(Math.min(input.maxBytes, cap.maxBytes), Math.min(input.timeoutMs, cap.timeoutMs));
      const prior = unsettledChecks.get(input.check.id);
      if (prior) return prior;
      const check = declaredCheck(input.check.id, scope, environment);
      if (!check || !sameCheck(check, input.check) || stopped.has(`check:${input.check.id}`)) return { ...failureResult('CHECK_SCOPE_DENIED', true), notStarted: true };
      if (check.declaredEffects.length || check.outputTargets.length) return { ...failureResult('UNQUALIFIED_CHECK_EFFECTS'), notStarted: true };
      if (!isAbsolute(check.argv[0]!) || process.platform === 'win32') return { ...failureResult('CHECK_EXECUTABLE_OR_PLATFORM_UNQUALIFIED'), notStarted: true };
      const qualification = qualifiedCheck(check, bound);
      if (!qualification) return { ...failureResult('CHECK_RUNNER_UNQUALIFIED'), notStarted: true };
      return new Promise<CheckObservation>(resolve => {
        const stdout: Buffer[] = [], stderr: Buffer[] = [], receiptId = `node-check:${randomUUID()}`, startedAtMs = Date.now();
        let total = 0, problem: string | null = null, killTimer: ReturnType<typeof setTimeout> | undefined, pollTimer: ReturnType<typeof setTimeout> | undefined;
        let finished = false, stopping = false, closed = false, exited = false, parentExitCode: number | null = null, parentSignal: string | null = null, cleanupDeadline = Infinity;
        // No shell, stdin, credentials, provider configuration, or inherited NODE_OPTIONS.
        const child = spawn(check.argv[0]!, check.argv.slice(1), { cwd: check.cwd, shell: false, detached: true, env: { ...nodeCheckEnvironment }, stdio: ['ignore', 'pipe', 'pipe'] });
        const groupState = (): 'absent' | 'present' | 'unverifiable' => {
          if (!child.pid) return 'absent';
          try { process.kill(-child.pid, 0); return 'present'; }
          catch (error) { return code(error) === 'ESRCH' ? 'absent' : 'unverifiable'; }
        };
        const kill = (signal: NodeJS.Signals) => { if (child.pid) { try { process.kill(-child.pid, signal); } catch (error) { if (code(error) !== 'ESRCH') problem ??= 'CHECK_STOP_UNVERIFIABLE'; } } };
        const finish = (settled: boolean) => {
          if (finished) return; finished = true;
          clearTimeout(timer); if (killTimer) clearTimeout(killTimer); if (pollTimer) clearTimeout(pollTimer);
          const resource: CheckResource | undefined = child.pid ? { id: receiptId, pid: child.pid, processGroupId: child.pid, startedAtMs, parentExitCode, parentSignal, settlement: settled ? 'settled' : 'unverifiable', stopRequested: stopping, settlementReceiptId: settled ? `node-group-absent:${randomUUID()}` : null } : undefined;
          const retained = { executed: check, qualification, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), ...(resource ? { resource } : {}) };
          if (!settled) { child.stdout.destroy(); child.stderr.destroy(); problem = 'CHECK_RESOURCES_UNVERIFIABLE'; stopped.add(`check:${check.id}`); }
          if (problem || parentSignal || parentExitCode === null) {
            const observation: CheckObservation = { kind: ['EACCES', 'EPERM'].includes(problem ?? '') ? 'denied' : 'unverified', reason: problem ?? 'CHECK_EXIT_UNVERIFIED', receiptId, ...retained, ...(!child.pid ? { notStarted: true as const } : {}) };
            if (!settled) unsettledChecks.set(check.id, observation);
            resolve(observation);
          } else resolve({ kind: 'completed', exitCode: parentExitCode, receiptId, ...retained });
        };
        const inspect = () => {
          if (finished) return;
          const group = groupState();
          if (closed && group === 'absent') { finish(true); return; }
          if (performance.now() >= cleanupDeadline) { kill('SIGKILL'); finish(false); return; }
          if (exited && group !== 'absent') stop('CHECK_DESCENDANTS_UNSETTLED');
          if (!pollTimer) pollTimer = setTimeout(() => { pollTimer = undefined; inspect(); }, 10);
        };
        const stop = (reason: string) => {
          problem ??= reason;
          if (stopping) return; stopping = true; cleanupDeadline = performance.now() + 1000; kill('SIGTERM');
          killTimer = setTimeout(() => kill('SIGKILL'), 100);
          inspect();
        };
        const timer = setTimeout(() => stop('CHECK_TIMEOUT'), bound.timeoutMs);
        const collect = (destination: Buffer[], chunk: Buffer) => {
          const remaining = Math.max(0, bound.maxBytes - total); total += chunk.length;
          if (remaining) destination.push(Buffer.from(chunk.subarray(0, remaining)));
          if (total > bound.maxBytes) stop('CHECK_OUTPUT_LIMIT');
        };
        child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk)); child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
        child.on('error', error => { problem = code(error); if (denied(error)) stopped.add(`check:${check.id}`); });
        child.on('exit', (exitCode, signal) => { exited = true; parentExitCode = exitCode; parentSignal = signal; inspect(); });
        child.on('close', (exitCode, signal) => {
          closed = true; parentExitCode = exitCode; parentSignal = signal; inspect();
        });
      });
    },
  };
}
