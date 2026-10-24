import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ArtifactRef, RunSnapshot } from '../domain/contracts.js';
import { openRunReader as openProjectionReader, type RunStore } from '../store/run-store.js';
import { canonicalJson, hashArtifact } from '../domain/hash.js';
import type { PreparedWorkerInput } from '../orca/transport.js';
import { readBoundedJson, publishAtomic } from './inbox.js';

const ownerSchema = z.strictObject({ host: z.string().min(1), pid: z.number().int().positive(), processStart: z.string().min(1), processEpoch: z.string().min(1) });
export interface PriorOwnerEvidence { exited: boolean; receipt: ArtifactRef }
export function controllerIdentity(processEpoch: string) {
  const processStart = execFileSync('ps', ['-p', String(process.pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 5000 }).trim();
  return ownerSchema.parse({ host: hostname(), pid: process.pid, processStart, processEpoch });
}
export function recordOwner(root: string, identity: ReturnType<typeof controllerIdentity>): void {
  // Epoch files are append-only. The journal clock identifies the authoritative owner.
  publishAtomic(join(root, 'controllers', `${hashArtifact('controller-epoch', identity.processEpoch)}.json`), identity);
}
export function observePriorOwner(root: string, snapshot: RunSnapshot, store: RunStore): PriorOwnerEvidence {
  const epoch = snapshot.context.activeBudget.lastReceipt.processEpoch;
  const file = join(root, 'controllers', `${hashArtifact('controller-epoch', epoch)}.json`);
  let exited = false, reason = 'OWNER_IDENTITY_UNAVAILABLE';
  if (existsSync(file)) {
    const owner = ownerSchema.parse(readBoundedJson(file));
    if (owner.host === hostname()) {
      try { process.kill(owner.pid, 0); reason = 'OWNER_STILL_LIVE'; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') { exited = true; reason = 'POSITIVE_ESRCH'; } }
    } else reason = 'OWNER_HOST_UNAVAILABLE';
  }
  return { exited, receipt: store.artifacts.putArtifact(Buffer.from(canonicalJson({ epoch, exited, reason })), 'controller-observation') };
}
export function preparedPath(root: string, logicalTaskKey: string, admission: ArtifactRef): string {
  return join(root, 'prepared', hashArtifact('logical-task', logicalTaskKey), `${admission.sha256}.json`);
}
export function persistPrepared(root: string, prepared: PreparedWorkerInput, store: RunStore): void {
  const ref = store.artifacts.putArtifact(Buffer.from(canonicalJson(prepared)), 'prepared-worker');
  const file = preparedPath(root, prepared.reservation.logicalTaskKey, prepared.admissionReceipt);
  if (!publishAtomic(file, ref) && canonicalJson(readBoundedJson(file)) !== canonicalJson(ref)) throw new Error('PREPARED_INPUT_CONFLICT');
}
export function originalPrepared(root: string, logicalTaskKey: string, store: RunStore, runId: string): PreparedWorkerInput {
  const journal = store.readJournal(runId);
  const fence = journal.findIndex(row => row.event.body.kind === 'LAUNCH_DISPATCHED' && row.event.body.data.logicalTaskKey === logicalTaskKey);
  if (fence < 0) throw new Error('MISSING_ORIGINAL_FENCE');
  const attestation = journal.slice(0, fence).reverse().find(row => row.event.body.kind === 'PREFLIGHT' && row.event.body.data.status === 'pass')?.event.body;
  if (attestation?.kind !== 'PREFLIGHT' || !attestation.data.attestation) throw new Error('MISSING_ORIGINAL_ADMISSION');
  const ref = readBoundedJson(preparedPath(root, logicalTaskKey, attestation.data.attestation)) as ArtifactRef;
  return JSON.parse(Buffer.from(store.artifacts.readArtifact(ref)).toString('utf8')) as PreparedWorkerInput;
}
export function resourcesSettled(snapshot: RunSnapshot): boolean {
  return Object.entries(snapshot.context.issuedLogicalTasks).every(([key, task]) => task.stage === 'pending_execution' ? task.binding === null && key === task.reservation.logicalTaskKey && !Object.hasOwn(snapshot.context.control.workerDeadlines, key) : task.binding !== null && task.settlement === 'settled' && snapshot.context.control.settledResourceTasks.includes(task.reservation.logicalTaskKey));
}

import { readdirSync } from 'node:fs';
import type { CheckSpec, ClockReceipt, EffectIntent, EvidenceRecord, EvidenceRequest } from '../domain/contracts.js';
import { artifactRefSchema, checkSpecSchema, clockReceiptSchema, evidenceRecordSchema, evidenceRequestSchema, hashSchema, localIdSchema } from '../domain/schemas.js';
import { sourceManifestSchema, type SourceManifest } from '../evidence/scope.js';
import { readEvidenceReceipt } from '../evidence/adapter.js';

const evidenceProtocolSchema = z.strictObject({
  version: z.literal(1), identity: z.enum(['council-foreground/evidence-before-execution/v1', 'council-foreground/effects-before-execution/v1']), runId: localIdSchema,
  configHash: hashSchema, profileHash: hashSchema, scopeHash: hashSchema, root: z.string().min(1), manifest: sourceManifestSchema,
});
const evidenceMarkerSchema = z.strictObject({
  version: z.literal(1), protocol: artifactRefSchema, runId: localIdSchema, effectKey: z.string().min(1), intentHash: hashSchema,
  request: evidenceRequestSchema, check: checkSpecSchema.nullable(), scopeHash: hashSchema, contextHash: hashSchema,
  round: z.number().int().nonnegative(), clock: clockReceiptSchema,
});
const completionSchema = z.strictObject({ marker: artifactRefSchema, record: evidenceRecordSchema });
export interface EvidenceExecutionMarker {
  ref: ArtifactRef; runId: string; effectKey: string; intentHash: string; request: EvidenceRequest;
  check: CheckSpec | null; scopeHash: string; contextHash: string; round: number; clock: ClockReceipt;
}
export interface RecoveredEvidence { marker: ArtifactRef; record: EvidenceRecord }
export type RecoverEvidence = (intent: EffectIntent, snapshot: RunSnapshot, marker: EvidenceExecutionMarker) => Promise<RecoveredEvidence | null>;
/** Durable markers own lifecycle uncertainty even if no machine event was accepted. */
export class EvidenceExecutionJournal {
  private readonly protocol: ArtifactRef | null;
  private readonly manifest: SourceManifest;
  constructor(private readonly root: string, private readonly store: RunStore, snapshot: RunSnapshot, initialize: boolean, manifest: SourceManifest = []) {
    const file = join(root, 'runtime-protocol.json');
    if (initialize) {
      const value = evidenceProtocolSchema.parse({ version: 1, identity: 'council-foreground/effects-before-execution/v1', runId: snapshot.context.request.runId, configHash: snapshot.context.config.configHash, profileHash: snapshot.context.profile.profileHash, scopeHash: hashArtifact('evidence-scope', snapshot.context.request.scope as unknown as import('../domain/contracts.js').JsonValue), root, manifest });
      const ref = store.artifacts.putArtifact(Buffer.from(canonicalJson(value)), 'runtime-protocol');
      if (!publishAtomic(file, ref) && canonicalJson(readBoundedJson(file)) !== canonicalJson(ref)) throw new Error('EVIDENCE_PROTOCOL_CONFLICT');
    }
    if (!existsSync(file)) { this.protocol = null; this.manifest = []; return; }
    const ref = artifactRefSchema.parse(readBoundedJson(file));
    const protocol = evidenceProtocolSchema.parse(JSON.parse(Buffer.from(store.artifacts.readArtifact(ref)).toString('utf8')));
    if (protocol.root !== root || protocol.runId !== snapshot.context.request.runId || protocol.configHash !== snapshot.context.config.configHash || protocol.profileHash !== snapshot.context.profile.profileHash || protocol.scopeHash !== hashArtifact('evidence-scope', snapshot.context.request.scope as unknown as import('../domain/contracts.js').JsonValue)) throw new Error('EVIDENCE_PROTOCOL_MISMATCH');
    this.protocol = ref; this.manifest = protocol.manifest;
  }
  private filename(key: string) { return `${hashArtifact('evidence-effect-key', key)}.json`; }
  private decode(ref: ArtifactRef): EvidenceExecutionMarker {
    const marker = evidenceMarkerSchema.parse(JSON.parse(Buffer.from(this.store.artifacts.readArtifact(ref)).toString('utf8')));
    if (!this.protocol || canonicalJson(marker.protocol) !== canonicalJson(this.protocol)) throw new Error('EVIDENCE_PROTOCOL_UNVERIFIABLE');
    const protocol = evidenceProtocolSchema.parse(JSON.parse(Buffer.from(this.store.artifacts.readArtifact(this.protocol)).toString('utf8')));
    if (marker.runId !== protocol.runId || marker.scopeHash !== protocol.scopeHash) throw new Error('EVIDENCE_MARKER_CONFLICT');
    return { ...marker, ref };
  }
  markers(): EvidenceExecutionMarker[] {
    const directory = join(this.root, 'evidence-started');
    if (!existsSync(directory)) return [];
    if (realpathSync(directory) !== directory) throw new Error('EVIDENCE_MARKER_PATH_INVALID');
    return readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort().map(name => {
      const marker = this.decode(artifactRefSchema.parse(readBoundedJson(join(directory, name))));
      if (this.filename(marker.effectKey) !== name) throw new Error('EVIDENCE_MARKER_CONFLICT');
      const effect = this.store.effectRecord(marker.effectKey);
      if (effect.intent.kind !== 'evidence' || hashArtifact('effect', effect.intent) !== marker.intentHash || canonicalJson(effect.intent.input) !== canonicalJson(marker.request)) throw new Error('EVIDENCE_MARKER_CONFLICT');
      return marker;
    });
  }
  marker(intent: EffectIntent, snapshot: RunSnapshot, clock: ClockReceipt): EvidenceExecutionMarker {
    if (!this.protocol) throw new Error('EVIDENCE_PROTOCOL_UNVERIFIABLE');
    if (intent.kind !== 'evidence') throw new Error('EVIDENCE_INTENT_REQUIRED');
    const file = join(this.root, 'evidence-started', this.filename(intent.key));
    if (existsSync(file)) return this.decode(artifactRefSchema.parse(readBoundedJson(file)));
    const request = evidenceRequestSchema.parse(intent.input), entry = this.manifest.find(item => item.address === request.source);
    if (!entry) throw new Error('EVIDENCE_DECLARATION_REQUIRED');
    const check = entry.kind === 'check' ? snapshot.context.request.scope.checks.find(check => check.id === entry.checkId) : null;
    if (entry.kind === 'check' && !check) throw new Error('EVIDENCE_CHECK_BINDING_MISSING');
    const value = evidenceMarkerSchema.parse({ version: 1, protocol: this.protocol, runId: snapshot.context.request.runId, effectKey: intent.key, intentHash: hashArtifact('effect', intent), request, check: check ?? null, scopeHash: hashArtifact('evidence-scope', snapshot.context.request.scope as unknown as import('../domain/contracts.js').JsonValue), contextHash: snapshot.context.sharedContext.contextHash, round: snapshot.context.roundsUsed, clock });
    const ref = this.store.artifacts.putArtifact(Buffer.from(canonicalJson(value)), 'evidence-execution-marker');
    if (!publishAtomic(file, ref) && canonicalJson(readBoundedJson(file)) !== canonicalJson(ref)) throw new Error('EVIDENCE_MARKER_CONFLICT');
    return this.decode(ref);
  }
  private validate(marker: EvidenceExecutionMarker, recovered: RecoveredEvidence): EvidenceRecord {
    if (canonicalJson(marker.ref) !== canonicalJson(recovered.marker)) throw new Error('EVIDENCE_RECOVERY_MARKER_MISMATCH');
    const record = evidenceRecordSchema.parse(recovered.record), receipt = readEvidenceReceipt(record, this.store.artifacts);
    if (canonicalJson(receipt.request) !== canonicalJson(marker.request) || receipt.scopeHash !== marker.scopeHash || canonicalJson(receipt.command) !== canonicalJson(marker.check) || receipt.executed && canonicalJson(receipt.executed) !== canonicalJson(marker.check)) throw new Error('EVIDENCE_RECOVERY_BINDING_MISMATCH');
    return record;
  }
  result(marker: EvidenceExecutionMarker): EvidenceRecord | null {
    const file = join(this.root, 'evidence-results', this.filename(marker.effectKey));
    if (!existsSync(file)) return null;
    const ref = artifactRefSchema.parse(readBoundedJson(file));
    let record = this.validate(marker, completionSchema.parse(JSON.parse(Buffer.from(this.store.artifacts.readArtifact(ref)).toString('utf8'))) as RecoveredEvidence);
    const directory = join(this.root, 'evidence-recoveries', hashArtifact('evidence-effect-key', marker.effectKey));
    if (!existsSync(directory)) return record;
    if (realpathSync(directory) !== directory) throw new Error('EVIDENCE_RECOVERY_PATH_INVALID');
    const children = new Map<string, EvidenceRecord>();
    for (const name of readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
      const ref = artifactRefSchema.parse(readBoundedJson(join(directory, name)));
      const child = this.validate(marker, completionSchema.parse(JSON.parse(Buffer.from(this.store.artifacts.readArtifact(ref)).toString('utf8'))) as RecoveredEvidence);
      const receipt = readEvidenceReceipt(child, this.store.artifacts), prior = receipt.priorObservationReceipt;
      if (!prior || children.has(prior)) throw new Error('EVIDENCE_RECOVERY_RECEIPT_CONFLICT');
      children.set(prior, child);
    }
    const seen = new Set<string>();
    for (;;) {
      if (seen.has(record.observationReceipt)) throw new Error('EVIDENCE_RECOVERY_CYCLE');
      seen.add(record.observationReceipt);
      const child = children.get(record.observationReceipt);
      if (!child) break;
      this.validateSuccessor(record, child); children.delete(record.observationReceipt); record = child;
    }
    if (children.size) throw new Error('EVIDENCE_RECOVERY_CHAIN_INVALID');
    return record;
  }
  private validateSuccessor(before: EvidenceRecord, after: EvidenceRecord): void {
    const prior = readEvidenceReceipt(before, this.store.artifacts), next = readEvidenceReceipt(after, this.store.artifacts);
    if (prior.checkResourceState !== 'unverifiable' || next.priorObservationReceipt !== before.observationReceipt ||
      prior.denied && !next.denied || prior.stdout && canonicalJson(prior.stdout) !== canonicalJson(next.stdout) ||
      prior.stderr && canonicalJson(prior.stderr) !== canonicalJson(next.stderr) ||
      prior.checkResource && (!next.checkResource || ['id', 'pid', 'processGroupId', 'startedAtMs'].some(key => prior.checkResource![key as keyof typeof prior.checkResource] !== next.checkResource![key as keyof typeof next.checkResource]))) throw new Error('EVIDENCE_RECOVERY_RESOURCE_MISMATCH');
  }
  save(marker: EvidenceExecutionMarker, recovered: RecoveredEvidence): EvidenceRecord {
    const record = this.validate(marker, recovered), value = { marker: marker.ref, record };
    const ref = this.store.artifacts.putArtifact(Buffer.from(canonicalJson(value)), 'evidence-execution-result'), file = join(this.root, 'evidence-results', this.filename(marker.effectKey));
    if (!publishAtomic(file, ref) && canonicalJson(readBoundedJson(file)) !== canonicalJson(ref)) {
      const prior = this.result(marker)!;
      if (canonicalJson(prior) === canonicalJson(record)) return record;
      this.validateSuccessor(prior, record);
      const update = join(this.root, 'evidence-recoveries', hashArtifact('evidence-effect-key', marker.effectKey), `${ref.sha256}.json`);
      if (!publishAtomic(update, ref) && canonicalJson(readBoundedJson(update)) !== canonicalJson(ref)) throw new Error('EVIDENCE_RECOVERY_RECEIPT_CONFLICT');
    }
    return record;
  }
  async reconcile(snapshot: RunSnapshot, recover?: RecoverEvidence): Promise<boolean> {
    const pending = this.store.pendingEffects(snapshot.context.request.runId).filter(intent => intent.kind === 'evidence');
    if (!this.protocol && pending.length) return false;
    for (const marker of this.markers()) {
      let record = this.result(marker);
      if ((!record || readEvidenceReceipt(record, this.store.artifacts).checkResourceState === 'unverifiable') && recover) {
        const recovered = await recover(this.store.effectRecord(marker.effectKey).intent, snapshot, marker);
        if (recovered) record = this.save(marker, recovered);
      }
      if (!record || readEvidenceReceipt(record, this.store.artifacts).checkResourceState === 'unverifiable') return false;
    }
    return true;
  }
}

import Database from 'better-sqlite3';
import type { JsonValue } from '../domain/contracts.js';
import { idSchema, jsonValueSchema, runSnapshotSchema } from '../domain/schemas.js';
import { readArtifact } from '../store/artifacts.js';
import type { ArtifactStore } from '../store/artifacts.js';
import type { TransitionResult, ValidatedEvent } from '../domain/contracts.js';
const projectedKinds = new Set<EffectIntent['kind']>(['evidence', 'question-batch-request', 'candidate-request', 'evaluate-round']);
export function effectOriginPath(root: string, key: string, eventId: string): string {
  return join(root, 'effect-origins', hashArtifact('effect-key', key), `${hashArtifact('event-id', eventId)}.json`);
}
export function retainEffectOrigins(root: string, store: RunStore, event: ValidatedEvent, result: TransitionResult): void {
  const intents = result.intents.filter(intent => projectedKinds.has(intent.kind));
  if (!intents.length) return;
  const snapshot = store.artifacts.putArtifact(Buffer.from(canonicalJson(result.snapshot)), 'effect-origin');
  for (const intent of intents) publishAtomic(effectOriginPath(root, intent.key, event.id), { intentHash: hashArtifact('effect', intent), eventId: event.id, snapshot });
}
export function markSemanticStarted(root: string, intent: EffectIntent): void {
  publishAtomic(join(root, 'semantic-started', `${hashArtifact('effect-key', intent.key)}.json`), { key: intent.key, intentHash: hashArtifact('effect', intent) });
}
const projectionIntentSchema = z.strictObject({ key: idSchema, kind: z.enum(['launch', 'observe', 'stop', 'release', 'evidence', 'question-batch-request', 'candidate-request', 'publish-context', 'evaluate-round', 'report', 'deadline']), input: jsonValueSchema });
/** Read-only projection. Raw SQL status is never changed or called completed. */
export function readExecutionProjection(root: string, runId: string) {
  const reader = openProjectionReader(root);
  try {
    const snapshot = reader.load(runId), journal = reader.readJournal(runId), c = snapshot.context;
    const db = new Database(join(root, 'journal.sqlite'), { readonly: true, fileMustExist: true });
    let rows: { intent: string; intent_hash: string; status: string }[], revision: number;
    try {
      ({ rows, revision } = db.transaction(() => ({ rows: db.prepare("SELECT intent, intent_hash, status FROM outbox WHERE run_id = ? AND status = 'pending_execution' ORDER BY created_revision, rowid").all(runId) as typeof rows,
        revision: (db.prepare('SELECT revision FROM checkpoints WHERE run_id = ?').get(runId) as { revision: number }).revision })).deferred());
    } finally { db.close(); }
    const consistent = revision === snapshot.revision && (!journal.length || journal.at(-1)!.checkpointHash === hashArtifact('checkpoint', JSON.parse(canonicalJson(snapshot)) as JsonValue));
    const artifactRoot = join(root, 'artifacts');
    const protocolFile = join(root, 'runtime-protocol.json');
    let qualifiedProtocol = false;
    if (existsSync(protocolFile)) {
      const ref = artifactRefSchema.parse(readBoundedJson(protocolFile));
      const protocol = evidenceProtocolSchema.parse(JSON.parse(Buffer.from(readArtifact(ref, artifactRoot)).toString('utf8')));
      qualifiedProtocol = protocol.identity === 'council-foreground/effects-before-execution/v1' && protocol.root === root && protocol.runId === runId && protocol.scopeHash === hashArtifact('evidence-scope', c.request.scope as unknown as JsonValue);
    }
    return { revision: snapshot.revision, consistent, rawPendingCount: rows.length, effects: rows.map(row => {
      const intent = projectionIntentSchema.parse(JSON.parse(row.intent)) as EffectIntent, intentHash = hashArtifact('effect', intent);
      if (row.intent_hash !== intentHash) throw new Error('OUTBOX_CORRUPT');
      const base = { key: intent.key, kind: intent.kind, intentHash, rawStatus: row.status };
      if (!consistent) return { ...base, derived: 'held', reason: 'SNAPSHOT_ADVANCED_RETRY' };
      if (!projectedKinds.has(intent.kind)) return { ...base, derived: 'retained', reason: 'NO_SUPERSESSION_AUTHORITY' };
      const originRow = journal.find(entry => entry.intents.some(created => created.key === intent.key && hashArtifact('effect', created) === intentHash));
      if (!originRow) return { ...base, derived: 'held', reason: 'ORIGIN_UNKNOWN' };
      const file = effectOriginPath(root, intent.key, originRow.event.id);
      if (!existsSync(file)) return { ...base, derived: 'held', reason: 'ORIGIN_CHECKPOINT_UNAVAILABLE' };
      const proof = z.strictObject({ intentHash: hashSchema, eventId: idSchema, snapshot: artifactRefSchema }).parse(readBoundedJson(file));
      const origin = runSnapshotSchema.parse(JSON.parse(Buffer.from(readArtifact(proof.snapshot, artifactRoot)).toString('utf8'))) as RunSnapshot;
      if (proof.intentHash !== intentHash || proof.eventId !== originRow.event.id || hashArtifact('checkpoint', JSON.parse(canonicalJson(origin)) as JsonValue) !== originRow.checkpointHash || origin.context.request.runId !== runId) throw new Error('EFFECT_ORIGIN_CONFLICT');
      const binding = { contextHash: origin.context.sharedContext.contextHash, round: origin.context.roundsUsed, clarificationBatch: origin.context.clarificationBatchesUsed, originEventId: originRow.event.id };
      const evidenceMarker = existsSync(join(root, 'evidence-started', `${hashArtifact('evidence-effect-key', intent.key)}.json`));
      const startedFile = join(root, 'semantic-started', `${hashArtifact('effect-key', intent.key)}.json`);
      let started = evidenceMarker;
      if (existsSync(startedFile)) {
        const marker = z.strictObject({ key: idSchema, intentHash: hashSchema }).parse(readBoundedJson(startedFile));
        if (marker.key !== intent.key || marker.intentHash !== intentHash) throw new Error('SEMANTIC_MARKER_CONFLICT');
        started = true;
      }
      if (started) return { ...base, binding, derived: 'held_may_have_executed', reason: 'ORIGINAL_IDENTITY_AND_RECEIPTS_REQUIRED' };
      const invalidated = binding.contextHash !== c.sharedContext.contextHash || binding.round < c.roundsUsed || binding.round === 0 && binding.clarificationBatch < c.clarificationBatchesUsed;
      if (invalidated && qualifiedProtocol) return { ...base, binding, derived: 'superseded_unexecuted', reason: 'ACCEPTED_CONTEXT_OR_WAVE_INVALIDATION', currentContextHash: c.sharedContext.contextHash, currentRound: c.roundsUsed };
      if (invalidated) return { ...base, binding, derived: 'held', reason: 'UNSENT_PROTOCOL_UNPROVEN' };
      if (['reconciling', 'preflight'].includes(snapshot.state) || c.pendingContextUpdate) return { ...base, binding, derived: 'held', reason: 'TRANSIENT_BOUNDARY' };
      const phase = { evidence: 'prepare_candidate', 'question-batch-request': 'collecting_questions', 'candidate-request': 'prepare_candidate', 'evaluate-round': 'evaluate_round' }[intent.kind as 'evidence'];
      return { ...base, binding, derived: snapshot.state === phase ? 'eligible' : 'held', reason: snapshot.state === phase ? 'CURRENT_CORRELATION' : 'WAITING_BARRIER' };
    }) };
  } finally { reader.close(); }
}

/** The controller and read-only inspect require the same check-resource proof. */
export function evidenceResourcesSettled(root: string, snapshot: RunSnapshot, execution?: ReturnType<typeof readExecutionProjection>): boolean {
  const artifactRoot = join(root, 'artifacts');
  const artifacts: ArtifactStore = {
    root: artifactRoot,
    readArtifact: ref => readArtifact(ref, artifactRoot),
    putArtifact: () => { throw new Error('EVIDENCE_SETTLEMENT_READ_ONLY'); },
  };
  if (!snapshot.context.control.evidence.every(record => readEvidenceReceipt(record, artifacts).checkResourceState !== 'unverifiable')) return false;
  if (!execution && !existsSync(join(root, 'evidence-started'))) return true;
  const projection = execution ?? readExecutionProjection(root, snapshot.context.request.runId);
  return projection.consistent && projection.revision === snapshot.revision &&
    !projection.effects.some(effect => effect.kind === 'evidence' && effect.derived === 'held_may_have_executed');
}
