import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { EffectIntent, JsonValue, RunSnapshot, TransitionResult, ValidatedEvent } from '../domain/contracts.js';
import { canonicalJson, hashArtifact } from '../domain/hash.js';
import { hashSchema, idSchema, jsonValueSchema, runSnapshotSchema, validatedEventSchema, watchdogArmingProofSchema, watchdogLaunchProofSchema } from '../domain/schemas.js';
import { createInitialSnapshot, reduceRun, restoreForReconciliation } from '../machine/reduce.js';
import { decodeStrictJson } from '../workers/strict-json.js';
import { openArtifactStore, readArtifact, verifyConfiguration, type ArtifactStore } from './artifacts.js';

export interface CommitReceipt { runId: string; eventId: string; revision: number; duplicate: boolean }
/** A mirror of a value in an accepted event, never transport authorization. */
export interface EffectReceipt { eventId: string; value: JsonValue }
export type EffectStatus = 'pending_execution' | 'dispatched' | 'receipt_recorded' | 'superseded';
export interface EffectRecord { intent: EffectIntent; status: EffectStatus; receipt: EffectReceipt | null }
export interface CommitOptions { restoreForReconciliation?: boolean }
export interface JournalEntry {
  runId: string; revision: number; event: ValidatedEvent; intents: readonly EffectIntent[];
  restoration: 'none' | 'reconcile'; inputCheckpointHash: string; checkpointHash: string;
}
export interface RunReader { load(runId: string): RunSnapshot; readJournal(runId: string): JournalEntry[]; close(): void }
export interface RunStore extends RunReader {
  readonly artifacts: ArtifactStore;
  createRun(snapshot: RunSnapshot): void;
  commitTransition(runId: string, expectedRevision: number, event: ValidatedEvent, result: TransitionResult, options?: CommitOptions): CommitReceipt;
  pendingEffects(runId: string): EffectIntent[];
  effectRecord(key: string): EffectRecord;
  recordEffectReceipt(key: string, receipt: EffectReceipt, expectedRevision: number): void;
  releaseRun(runId: string, expectedRevision: number): void;
}

const receiptSchema = z.strictObject({ eventId: idSchema, value: jsonValueSchema });
const optionsSchema = z.strictObject({ restoreForReconciliation: z.boolean().optional() });
const genericReceiptKinds = new Set<EffectIntent['kind']>(['publish-context', 'report', 'release']);
const intentSchema = z.strictObject({
  key: idSchema,
  kind: z.enum(['launch', 'observe', 'stop', 'release', 'evidence', 'question-batch-request', 'candidate-request', 'publish-context', 'evaluate-round', 'report', 'deadline']),
  input: jsonValueSchema,
});
interface CheckpointRow { revision: number; snapshot: string; snapshot_hash: string }
interface JournalRow { revision: number; event: string; event_hash: string; intents: string; restoration: 'none' | 'reconcile'; input_checkpoint_hash: string; checkpoint_hash: string }
interface OutboxRow { run_id: string; created_revision: number; intent: string; intent_hash: string; status: EffectStatus; receipt: string | null }
interface LeaseRow { run_id: string; generation: number; owner_id: string; host: string; pid: number; process_start: string; active: number }
interface Identity { ownerId: string; host: string; pid: number; processStart: string }
interface LeaseObservation { row: LeaseRow | undefined; exitEvidence: string | null }
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const hash = (kind: string, value: unknown) => hashArtifact(kind, jsonValueSchema.parse(value));
function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function revision(value: number): void {
  requireThat(Number.isSafeInteger(value) && value >= 0, 'INVALID_EXPECTED_REVISION');
}
function checkpoint(db: Database.Database, runId: string): CheckpointRow {
  idSchema.parse(runId);
  const row = db.prepare('SELECT revision, snapshot, snapshot_hash FROM checkpoints WHERE run_id = ?').get(runId) as CheckpointRow | undefined;
  requireThat(row, 'RUN_NOT_FOUND');
  return row;
}
function decodeCheckpoint(row: CheckpointRow, runId: string, artifactRoot: string): RunSnapshot {
  const raw: unknown = JSON.parse(row.snapshot);
  requireThat(raw && typeof raw === 'object' && 'machineVersion' in raw && 'schemaVersion' in raw && raw.machineVersion === 1 && raw.schemaVersion === 1, 'INCOMPATIBLE_CHECKPOINT');
  const snapshot = runSnapshotSchema.parse(raw) as RunSnapshot;
  requireThat(snapshot.context.request.runId === runId && snapshot.revision === row.revision, 'CHECKPOINT_CORRUPT');
  requireThat(hash('checkpoint', snapshot) === row.snapshot_hash, 'CHECKPOINT_CORRUPT');
  requireThat(same(snapshot.context.config, snapshot.context.request.config), 'CONFIG_SNAPSHOT_MISMATCH');
  verifyConfiguration(snapshot.context.config, artifactRoot);
  return snapshot;
}
function decodeEffect(row: OutboxRow): EffectRecord {
  const intent = intentSchema.parse(JSON.parse(row.intent)) as EffectIntent;
  requireThat(hash('effect', intent) === row.intent_hash, 'OUTBOX_CORRUPT');
  return { intent, status: row.status, receipt: row.receipt === null ? null : receiptSchema.parse(JSON.parse(row.receipt)) };
}
function readJournal(db: Database.Database, runId: string, artifactRoot: string): JournalEntry[] {
  // Capture both tables in one read transaction, then release it before artifact
  // I/O and replay. A concurrent writer cannot produce a mixed history view.
  const { saved, rows } = db.transaction(() => ({
    saved: checkpoint(db, runId),
    rows: db.prepare('SELECT * FROM journal WHERE run_id = ? ORDER BY revision').all(runId) as JournalRow[],
  })).deferred();
  const committed = decodeCheckpoint(saved, runId, artifactRoot);
  requireThat(rows.length === committed.revision, 'JOURNAL_CORRUPT');
  let replay = createInitialSnapshot(committed.context.request);
  const entries = rows.map((row, index) => {
    const event = validatedEventSchema.parse(JSON.parse(row.event)) as ValidatedEvent;
    const intents = z.array(intentSchema).parse(JSON.parse(row.intents)) as EffectIntent[];
    requireThat(row.revision === index + 1 && event.runId === runId && hash('event', event) === row.event_hash, 'JOURNAL_CORRUPT');
    requireThat(row.restoration === 'none' || (row.restoration === 'reconcile' && ['CLOCK_CHECKPOINT', 'RECONCILED'].includes(event.body.kind)), 'JOURNAL_RESTORATION_CORRUPT');
    requireThat(hash('checkpoint', replay) === row.input_checkpoint_hash, 'JOURNAL_CORRUPT');
    const result = reduceRun(row.restoration === 'reconcile' ? restoreForReconciliation(replay) : replay, event);
    requireThat(result.snapshot.revision === row.revision && same(result.intents, intents) && hash('checkpoint', result.snapshot) === row.checkpoint_hash, 'JOURNAL_CORRUPT');
    replay = result.snapshot;
    return { runId, revision: row.revision, event, intents, restoration: row.restoration, inputCheckpointHash: hashSchema.parse(row.input_checkpoint_hash), checkpointHash: hashSchema.parse(row.checkpoint_hash) };
  });
  requireThat(same(replay, committed), 'JOURNAL_CORRUPT');
  return entries;
}
function currentIdentity(): Identity {
  let processStart: string;
  try { processStart = execFileSync('ps', ['-p', String(process.pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 5000 }).trim(); }
  catch { throw new Error('OWNER_PROCESS_IDENTITY_UNAVAILABLE'); }
  requireThat(processStart.length > 0, 'OWNER_PROCESS_IDENTITY_UNAVAILABLE');
  return { ownerId: randomUUID(), host: hostname(), pid: process.pid, processStart };
}
function leaseRow(db: Database.Database, runId: string): LeaseRow | undefined {
  return db.prepare('SELECT * FROM writer_leases WHERE run_id = ?').get(runId) as LeaseRow | undefined;
}
/** Observe outside the database transaction. A live/reused PID or unknown host blocks. */
function observeLease(db: Database.Database, runId: string, identity: Identity): LeaseObservation {
  const row = leaseRow(db, runId);
  let exitEvidence: string | null = null;
  if (row?.active && row.owner_id !== identity.ownerId && row.host === identity.host && row.process_start && Number.isSafeInteger(row.pid) && row.pid > 0) {
    try { process.kill(row.pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') exitEvidence = canonicalJson({ host: row.host, pid: row.pid, processStart: row.process_start, observation: 'ESRCH', observedAt: Date.now() });
    }
  }
  return { row, exitEvidence };
}
function acceptedReceiptValue(intent: EffectIntent, event: ValidatedEvent): unknown {
  const input = intent.input && typeof intent.input === 'object' && !Array.isArray(intent.input) ? intent.input : {};
  const taskKey = 'logicalTaskKey' in input ? input.logicalTaskKey : undefined;
  const body = event.body;
  if (body.kind === 'EFFECT_RECEIPT_RECORDED')
    return genericReceiptKinds.has(intent.kind) && body.data.key === intent.key && body.data.intentHash === hash('effect', intent) ? body.data.receipt : undefined;
  switch (intent.kind) {
    case 'launch':
      return body.kind === 'LAUNCH_RECEIPT_RECORDED' && body.data.binding.logicalTaskKey === taskKey ? body.data.binding : undefined;
    case 'observe':
    case 'stop': {
      const observation = body.kind === 'WORKER_OBSERVED' && body.data.logicalTaskKey === taskKey
        ? body.data.observation
        : body.kind === 'RECONCILED' ? body.data.observations.find(o => o.logicalTaskKey === taskKey)?.observation : undefined;
      return intent.kind === 'stop' && observation?.status !== 'exited' ? undefined : observation;
    }
    case 'release':
      return body.kind === 'RESOURCES_SETTLED' && typeof taskKey === 'string' && body.data.logicalTaskKeys.includes(taskKey) ? body.data.receipt : undefined;
    case 'evidence':
      return body.kind === 'EVIDENCE_RECORDED' && 'id' in input && body.data.record.requestId === input.id ? body.data.record : undefined;
    case 'question-batch-request':
      return body.kind === 'COLLECT_QUESTIONS' && 'origin' in input && same(input.origin, body.data.batch.origin) ? body.data.batch : undefined;
    case 'candidate-request':
      return body.kind === 'CANDIDATE_FROZEN' ? body.data.candidate : undefined;
    case 'evaluate-round':
      return body.kind === 'EVALUATE_ROUND' && event.id === intent.key ? body.data : undefined;
    case 'deadline':
      return body.kind === 'WATCHDOG_ARMED' && body.data.key === intent.key && body.data.intentHash === hash('effect', intent) && taskKey === body.data.logicalTaskKey && 'deadline' in input && same(input.deadline, body.data.deadline) ? body.data.receipt : undefined;
    // These effects use the adapter-owned generic completion event above.
    case 'publish-context':
    case 'report': return undefined;
  }
}

class SQLiteRunStore implements RunStore {
  readonly artifacts: ArtifactStore;
  private readonly db: Database.Database;
  private readonly identity: Identity;
  private readonly owned = new Map<string, { generation: number; revision: number }>();
  constructor(root: string) {
    this.identity = currentIdentity();
    mkdirSync(root, { recursive: true });
    const canonicalRoot = realpathSync(root);
    this.artifacts = openArtifactStore(join(canonicalRoot, 'artifacts'));
    const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
    this.db = new Database(join(canonicalRoot, 'journal.sqlite'), { timeout: 5000 });
    try {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = FULL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('busy_timeout = 5000');
      this.db.transaction(() => {
        const version = this.db.pragma('user_version', { simple: true });
        requireThat(version === 0 || version === 1, 'INCOMPATIBLE_STORE_SCHEMA');
        if (version === 0) {
          requireThat((this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n === 0, 'INCOMPATIBLE_STORE_SCHEMA');
          this.db.exec(schema);
        }
      }).immediate();
    } catch (error) { this.db.close(); throw error; }
  }
  load(runId: string): RunSnapshot {
    return decodeCheckpoint(checkpoint(this.db, runId), runId, this.artifacts.root);
  }
  readJournal(runId: string): JournalEntry[] { return readJournal(this.db, runId, this.artifacts.root); }
  private checkRevision(runId: string, expectedRevision: number): CheckpointRow {
    revision(expectedRevision);
    const row = checkpoint(this.db, runId);
    requireThat(row.revision === expectedRevision, 'REVISION_CONFLICT');
    return row;
  }
  private claim(runId: string, observed: LeaseObservation): number {
    const row = leaseRow(this.db, runId);
    requireThat(same(row ?? null, observed.row ?? null), 'WRITER_LEASE_CHANGED');
    if (row?.active && row.owner_id === this.identity.ownerId) return row.generation;
    requireThat(!row?.active || observed.exitEvidence, 'WRITER_LEASE_HELD');
    const generation = (row?.generation ?? 0) + 1, i = this.identity;
    this.db.prepare(`INSERT INTO writer_leases (run_id, generation, owner_id, host, pid, process_start, active) VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(run_id) DO UPDATE SET generation = excluded.generation, owner_id = excluded.owner_id, host = excluded.host, pid = excluded.pid, process_start = excluded.process_start, active = 1`).run(runId, generation, i.ownerId, i.host, i.pid, i.processStart);
    this.db.prepare('INSERT INTO writer_history (run_id, generation, owner_id, host, pid, process_start, acquisition) VALUES (?, ?, ?, ?, ?, ?, ?)').run(runId, generation, i.ownerId, i.host, i.pid, i.processStart, observed.exitEvidence ?? (row ? 'prior-owner-released' : 'new-run'));
    return generation;
  }
  createRun(input: RunSnapshot): void {
    const snapshot = runSnapshotSchema.parse(input) as RunSnapshot;
    requireThat(same(snapshot, createInitialSnapshot(snapshot.context.request)), 'INVALID_INITIAL_CHECKPOINT');
    requireThat(same(snapshot.context.config, snapshot.context.request.config), 'CONFIG_SNAPSHOT_MISMATCH');
    verifyConfiguration(snapshot.context.config, this.artifacts.root);
    const runId = snapshot.context.request.runId;
    const generation = this.db.transaction(() => {
      requireThat(!this.db.prepare('SELECT 1 FROM checkpoints WHERE run_id = ?').get(runId), 'RUN_ALREADY_EXISTS');
      this.db.prepare('INSERT INTO checkpoints (run_id, revision, snapshot, snapshot_hash) VALUES (?, 0, ?, ?)').run(runId, canonicalJson(snapshot), hash('checkpoint', snapshot));
      return this.claim(runId, { row: undefined, exitEvidence: null });
    }).immediate();
    this.owned.set(runId, { generation, revision: 0 });
  }
  commitTransition(runId: string, expectedRevision: number, input: ValidatedEvent, result: TransitionResult, inputOptions: CommitOptions = {}): CommitReceipt {
    const options = optionsSchema.parse(inputOptions);
    const restoration = options.restoreForReconciliation ? 'reconcile' : 'none';
    const event = validatedEventSchema.parse(input) as ValidatedEvent;
    requireThat(restoration === 'none' || ['CLOCK_CHECKPOINT', 'RECONCILED'].includes(event.body.kind), 'INVALID_RESTORATION_EVENT');
    requireThat(event.runId === runId, 'EVENT_RUN_MISMATCH');
    const before = this.checkRevision(runId, expectedRevision);
    const prior = this.db.prepare('SELECT * FROM journal WHERE run_id = ? AND event_id = ?').get(runId, event.id) as JournalRow | undefined;
    const eventHash = hash('event', event);
    if (prior) {
      requireThat(prior.event_hash === eventHash && prior.event === canonicalJson(event), 'EVENT_ID_CONFLICT');
      requireThat(prior.restoration === restoration, 'EVENT_RESTORATION_CONFLICT');
      return { runId, eventId: event.id, revision: prior.revision, duplicate: true };
    }
    const snapshot = decodeCheckpoint(before, runId, this.artifacts.root);
    const observed = observeLease(this.db, runId, this.identity);
    if (restoration === 'reconcile') {
      requireThat(!observed.row?.active || observed.row.owner_id !== this.identity.ownerId, 'RESTORATION_REQUIRES_NEW_OWNER');
      requireThat(!['completed', 'cancelled'].includes(snapshot.state) && !(snapshot.state === 'blocked' && snapshot.context.inferenceBlock), 'TERMINAL_RECOVERY_FORBIDDEN');
    }
    const reductionInput = restoration === 'reconcile' ? restoreForReconciliation(snapshot) : snapshot;
    const expected = reduceRun(reductionInput, event);
    requireThat(same(result, expected) && expected.snapshot.revision === expectedRevision + 1, 'TRANSITION_MISMATCH');
    const next = expected.snapshot;
    let completedEffect: OutboxRow | undefined;
    if (event.body.kind === 'EFFECT_RECEIPT_RECORDED' || event.body.kind === 'WATCHDOG_ARMED') {
      const data = event.body.data;
      completedEffect = this.db.prepare('SELECT * FROM outbox WHERE key = ? AND run_id = ?').get(data.key, runId) as OutboxRow | undefined;
      requireThat(completedEffect, 'EFFECT_NOT_FOUND');
      const effect = decodeEffect(completedEffect);
      requireThat(completedEffect.intent_hash === data.intentHash, 'EFFECT_INTENT_HASH_MISMATCH');
      requireThat(effect.intent.kind !== 'launch', 'GENERIC_LAUNCH_RECEIPT_FORBIDDEN');
      if (event.body.kind === 'WATCHDOG_ARMED') {
        requireThat(effect.intent.kind === 'deadline' && acceptedReceiptValue(effect.intent, event) !== undefined, 'WATCHDOG_INTENT_MISMATCH');
        requireThat(data.receipt.kind === 'watchdog-armed', 'WATCHDOG_PROOF_REQUIRED');
        const proof = watchdogArmingProofSchema.parse(decodeStrictJson(Buffer.from(readArtifact(data.receipt, this.artifacts.root)).toString('utf8')));
        const { receipt: _receipt, ...binding } = data;
        requireThat(Object.entries(binding).every(([key, value]) => same(proof[key as keyof typeof proof], value)), 'WATCHDOG_PROOF_MISMATCH');
        const task = snapshot.context.issuedLogicalTasks[proof.logicalTaskKey];
        requireThat(task?.binding && proof.resourceKey === hash('watchdog-resource', { attemptId: proof.attemptId, authority: task.binding.authority, deadlineMs: proof.deadline.wallMs }), 'WATCHDOG_RESOURCE_MISMATCH');
        requireThat(proof.launchReceipt.kind === 'watchdog-launch', 'WATCHDOG_LAUNCH_PROOF_REQUIRED');
        const launch = watchdogLaunchProofSchema.parse(decodeStrictJson(Buffer.from(readArtifact(proof.launchReceipt, this.artifacts.root)).toString('utf8')));
        requireThat(launch.pid === proof.pid && launch.processStart === proof.processStart && launch.resourceKey === proof.resourceKey, 'WATCHDOG_LAUNCH_PROOF_MISMATCH');
      } else requireThat(genericReceiptKinds.has(effect.intent.kind), 'GENERIC_EFFECT_RECEIPT_FORBIDDEN');
      requireThat(completedEffect.created_revision < next.revision && completedEffect.status !== 'superseded', 'EFFECT_RECEIPT_NOT_ELIGIBLE');
      readArtifact(data.receipt, this.artifacts.root);
      if (effect.receipt) requireThat(same(effect.receipt.value, data.receipt), 'EFFECT_RECEIPT_CONFLICT');
    }
    const nextHash = hash('checkpoint', next);
    const generation = this.db.transaction(() => {
      const current = this.checkRevision(runId, expectedRevision);
      requireThat(current.snapshot_hash === before.snapshot_hash, 'CHECKPOINT_CHANGED');
      const generation = this.claim(runId, observed);
      this.db.prepare('INSERT INTO journal (run_id, event_id, revision, event_hash, event, intents, restoration, input_checkpoint_hash, checkpoint_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(runId, event.id, next.revision, eventHash, canonicalJson(event), canonicalJson(expected.intents), restoration, before.snapshot_hash, nextHash);
      this.db.prepare('UPDATE checkpoints SET revision = ?, snapshot = ?, snapshot_hash = ? WHERE run_id = ? AND revision = ?').run(next.revision, canonicalJson(next), nextHash, runId, expectedRevision);
      for (const intent of expected.intents) {
        intentSchema.parse(intent);
        const existing = this.db.prepare('SELECT * FROM outbox WHERE key = ?').get(intent.key) as OutboxRow | undefined;
        if (existing) {
          requireThat(existing.run_id === runId && existing.intent_hash === hash('effect', intent) && existing.intent === canonicalJson(intent), 'EFFECT_KEY_CONFLICT');
        } else this.db.prepare("INSERT INTO outbox (key, run_id, created_revision, intent, intent_hash, status) VALUES (?, ?, ?, ?, ?, 'pending_execution')").run(intent.key, runId, next.revision, canonicalJson(intent), hash('effect', intent));
      }
      for (const [key, task] of Object.entries(next.context.issuedLogicalTasks)) {
        const priorTask = snapshot.context.issuedLogicalTasks[key];
        if (task.stage === 'dispatched' && priorTask?.stage === 'pending_execution') {
          const updated = this.db.prepare("UPDATE outbox SET status = 'dispatched' WHERE key = ? AND run_id = ? AND status = 'pending_execution'").run(task.reservation.effectKey, runId);
          requireThat(updated.changes === 1, 'OUTBOX_FENCE_MISMATCH');
        }
        if (task.stage === 'receipt_recorded' && priorTask?.stage === 'dispatched') {
          requireThat(event.body.kind === 'LAUNCH_RECEIPT_RECORDED' && same(task.binding, event.body.data.binding), 'OUTBOX_RECEIPT_MISMATCH');
          const receipt = { eventId: event.id, value: task.binding };
          const updated = this.db.prepare("UPDATE outbox SET status = 'receipt_recorded', receipt = ?, receipt_event_id = ? WHERE key = ? AND run_id = ? AND status = 'dispatched'").run(canonicalJson(receipt), event.id, task.reservation.effectKey, runId);
          requireThat(updated.changes === 1, 'OUTBOX_RECEIPT_MISMATCH');
        }
        if (task.stage === 'pending_execution' && next.context.control.supersededTaskKeys.includes(key))
          this.db.prepare("UPDATE outbox SET status = 'superseded' WHERE key = ? AND run_id = ? AND status = 'pending_execution'").run(task.reservation.effectKey, runId);
      }
      if (completedEffect && (event.body.kind === 'EFFECT_RECEIPT_RECORDED' || event.body.kind === 'WATCHDOG_ARMED')) {
        const current = this.db.prepare('SELECT * FROM outbox WHERE key = ?').get(event.body.data.key) as OutboxRow;
        requireThat(same(current, completedEffect), 'OUTBOX_CHANGED');
        if (!current.receipt) this.db.prepare("UPDATE outbox SET status = 'receipt_recorded', receipt = ?, receipt_event_id = ? WHERE key = ?").run(canonicalJson({ eventId: event.id, value: event.body.data.receipt }), event.id, event.body.data.key);
      }
      return generation;
    }).immediate();
    this.owned.set(runId, { generation, revision: next.revision });
    return { runId, eventId: event.id, revision: next.revision, duplicate: false };
  }
  pendingEffects(runId: string): EffectIntent[] {
    this.load(runId);
    const rows = this.db.prepare("SELECT * FROM outbox WHERE run_id = ? AND status = 'pending_execution' ORDER BY created_revision, rowid").all(runId) as OutboxRow[];
    return rows.map(row => decodeEffect(row).intent);
  }
  effectRecord(key: string): EffectRecord {
    idSchema.parse(key);
    const row = this.db.prepare('SELECT * FROM outbox WHERE key = ?').get(key) as OutboxRow | undefined;
    requireThat(row, 'EFFECT_NOT_FOUND');
    return decodeEffect(row);
  }
  recordEffectReceipt(key: string, input: EffectReceipt, expectedRevision: number): void {
    const receipt = receiptSchema.parse(input);
    const row = this.db.prepare('SELECT * FROM outbox WHERE key = ?').get(key) as OutboxRow | undefined;
    requireThat(row, 'EFFECT_NOT_FOUND');
    this.checkRevision(row.run_id, expectedRevision);
    this.load(row.run_id);
    const effect = decodeEffect(row);
    const accepted = this.db.prepare('SELECT * FROM journal WHERE run_id = ? AND event_id = ?').get(row.run_id, receipt.eventId) as JournalRow | undefined;
    requireThat(accepted && accepted.revision > row.created_revision, 'UNACCEPTED_EFFECT_RECEIPT');
    const event = validatedEventSchema.parse(JSON.parse(accepted.event)) as ValidatedEvent;
    requireThat(hash('event', event) === accepted.event_hash, 'JOURNAL_CORRUPT');
    const value = acceptedReceiptValue(effect.intent, event);
    requireThat(value !== undefined && same(value, receipt.value), 'UNACCEPTED_EFFECT_RECEIPT');
    requireThat(effect.status !== 'superseded', 'EFFECT_SUPERSEDED');
    if (effect.receipt) requireThat(same(effect.receipt, receipt), 'EFFECT_RECEIPT_CONFLICT');
    const observed = observeLease(this.db, row.run_id, this.identity);
    const generation = this.db.transaction(() => {
      this.checkRevision(row.run_id, expectedRevision);
      const generation = this.claim(row.run_id, observed);
      const current = this.db.prepare('SELECT * FROM outbox WHERE key = ?').get(key) as OutboxRow;
      requireThat(same(current, row), 'OUTBOX_CHANGED');
      if (effect.intent.kind === 'launch' || event.body.kind === 'EFFECT_RECEIPT_RECORDED' || event.body.kind === 'WATCHDOG_ARMED') {
        // The accepted reducer event already wrote this receipt and stage in its
        // commit. This API can only verify that mirror, never fence a launch.
        requireThat(current.status === 'receipt_recorded' && current.receipt === canonicalJson(receipt), 'UNACCEPTED_EFFECT_RECEIPT');
      } else if (!effect.receipt) {
        this.db.prepare("UPDATE outbox SET status = 'receipt_recorded', receipt = ?, receipt_event_id = ? WHERE key = ?").run(canonicalJson(receipt), receipt.eventId, key);
      }
      return generation;
    }).immediate();
    this.owned.set(row.run_id, { generation, revision: expectedRevision });
  }
  releaseRun(runId: string, expectedRevision: number): void {
    this.db.transaction(() => {
      this.checkRevision(runId, expectedRevision);
      const row = leaseRow(this.db, runId), owned = this.owned.get(runId);
      requireThat(row?.active && row.owner_id === this.identity.ownerId && row.generation === owned?.generation, 'WRITER_LEASE_NOT_OWNED');
      this.db.prepare('UPDATE writer_leases SET active = 0 WHERE run_id = ? AND generation = ? AND owner_id = ?').run(runId, row.generation, this.identity.ownerId);
    }).immediate();
    this.owned.delete(runId);
  }
  close(): void {
    if (!this.db.open) return;
    try { for (const [runId, owned] of this.owned) this.releaseRun(runId, owned.revision); }
    finally { this.db.close(); }
  }
}

export function openRunStore(root: string): RunStore { return new SQLiteRunStore(root); }
export function openRunReader(root: string): RunReader {
  const canonicalRoot = realpathSync(root);
  const db = new Database(join(canonicalRoot, 'journal.sqlite'), { readonly: true, fileMustExist: true, timeout: 5000 });
  try {
    db.pragma('query_only = ON');
    requireThat(db.pragma('user_version', { simple: true }) === 1, 'INCOMPATIBLE_STORE_SCHEMA');
  } catch (error) { db.close(); throw error; }
  return {
    load(runId) { return decodeCheckpoint(checkpoint(db, runId), runId, join(canonicalRoot, 'artifacts')); },
    readJournal(runId) { return readJournal(db, runId, join(canonicalRoot, 'artifacts')); },
    close() { if (db.open) db.close(); },
  };
}
