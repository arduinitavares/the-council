import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { AnswerBatch, ControlEventBody, RunSnapshot } from '../domain/contracts.js';
import { answerBatchSchema, answerRevisionSchema, boundedExtensionSchema, contextUpdateSchema, hashSchema, idSchema, INPUT_LIMIT_BYTES, localIdSchema } from '../domain/schemas.js';
import { canonicalJson } from '../domain/hash.js';
import { validateAnswerBatch, validateAnswerRevision } from '../input/questions.js';
import { openRunReader } from '../store/run-store.js';
import { decodeStrictJson } from '../workers/strict-json.js';

const envelope = { requestId: idSchema, runId: localIdSchema };
export const candidateInputSchema = z.strictObject({ text: z.string().min(1), assumptions: z.array(z.string()), tradeoffs: z.array(z.string()), unresolvedUncertainty: z.array(z.string()), acknowledgedUnverifiedEvidenceIds: z.array(idSchema) });
export const controlRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...envelope, kind: z.literal('cancel') }),
  z.strictObject({ ...envelope, kind: z.literal('answers'), batch: answerBatchSchema }),
  z.strictObject({ ...envelope, kind: z.literal('answer_revision'), revision: answerRevisionSchema }),
  z.strictObject({ ...envelope, kind: z.literal('context_update'), update: contextUpdateSchema }),
  z.strictObject({ ...envelope, kind: z.literal('extend'), extension: boundedExtensionSchema }),
  z.strictObject({ ...envelope, kind: z.literal('candidate'), baseContextHash: hashSchema, round: z.number().int().positive(), evidenceHash: hashSchema, candidate: candidateInputSchema }),
]);
type DecodedControl = z.infer<typeof controlRequestSchema>;
export type ControlRequest = Exclude<DecodedControl, { kind: 'answers' }> | { kind: 'answers'; requestId: string; runId: string; batch: AnswerBatch };
export interface ControlReceipt { requestId: string; runId: string; status: 'queued'; applied: false; duplicate: boolean }
export interface InboxEntry { request: ControlRequest; path: string; hash: string }
export interface ControlDisposition { requestId: string; runId: string; status: 'applied' | 'rejected'; code: string | null; revision: number; payloadHash: string }
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export function readBoundedJson(file: string, limit = INPUT_LIMIT_BYTES): unknown {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error('INPUT_TOO_LARGE_OR_NOT_FILE');
    const bytes = Buffer.alloc(limit + 1); let length = 0;
    while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    if (length > limit) throw new Error('INPUT_TOO_LARGE');
    return decodeStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
  } finally { closeSync(fd); }
}
export function syncDir(root: string): void { const fd = openSync(root, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
/** Link publishes a fully fsynced file without replacing a competing request. */
export function publishAtomic(path: string, value: unknown): boolean {
  const parent = dirname(path); mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (realpathSync(parent) !== parent) throw new Error('INBOX_PATH_INVALID');
  const temporary = join(parent, `.tmp-${randomUUID()}`), fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, canonicalJson(value)); fsyncSync(fd); } finally { closeSync(fd); }
  let created = true;
  try { linkSync(temporary, path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; created = false; }
  finally { unlinkSync(temporary); }
  syncDir(parent);
  return created;
}
export function controlEventBody(request: ControlRequest): ControlEventBody | null {
  switch (request.kind) {
    case 'cancel': return { kind: 'CANCEL', data: {} };
    case 'answers': return { kind: 'ANSWER_BATCH', data: { batch: request.batch } };
    case 'answer_revision': return { kind: 'ANSWER_REVISION', data: { revision: request.revision } };
    case 'context_update': return { kind: 'CONTEXT_UPDATE', data: { update: request.update } };
    case 'extend': return { kind: 'EXTEND', data: { extension: request.extension } };
    case 'candidate': return null;
  }
}
export function validateControl(request: ControlRequest, snapshot: RunSnapshot): void {
  const c = snapshot.context;
  if (request.runId !== c.request.runId) throw new Error('CONTROL_RUN_MISMATCH');
  if (snapshot.state === 'completed' || snapshot.state === 'cancelled') throw new Error('RUN_SETTLED');
  if (request.kind === 'answers') {
    if (request.requestId !== request.batch.requestId || !c.control.questionBatch) throw new Error('ANSWER_BATCH_MISMATCH');
    const decision = validateAnswerBatch(c.control.questionBatch, request.batch, c.questionLedger, c.control.pendingAnswerBatch ?? undefined);
    if (decision.kind === 'invalid') throw new Error(decision.reason);
  }
  if (request.kind === 'answer_revision') {
    if (request.requestId !== request.revision.requestId || request.runId !== request.revision.runId || snapshot.state !== 'needs_user' || c.control.questionBatch || !['CLARIFICATION_LIMIT', 'ROUND_LIMIT', 'UNRESOLVED_QUESTIONS'].includes(c.pauseReason ?? '')) throw new Error('ANSWER_REVISION_BOUNDARY');
    const decision = validateAnswerRevision(c.sharedContext, c.questionLedger, request.revision);
    if (decision.kind === 'invalid') throw new Error(decision.reason);
  }
  if (request.kind === 'context_update') {
    if (snapshot.state === 'clarifying') throw new Error('CONTEXT_UPDATE_DURING_CLARIFICATION');
    if (request.requestId !== request.update.requestId || request.runId !== request.update.runId || request.update.baseContextHash !== c.sharedContext.contextHash || c.pendingContextUpdate) throw new Error('STALE_CONTEXT_UPDATE');
  }
  if (request.kind === 'extend' && c.inferenceBlock) throw new Error('TERMINAL_INFERENCE_BLOCK');
  if (request.kind === 'extend' && (request.extension.id !== request.requestId || request.extension.baseRevision !== snapshot.revision)) throw new Error('STALE_EXTENSION');
  if (request.kind === 'candidate' && (snapshot.state !== 'prepare_candidate' || !c.control.candidateRequested || c.pendingEvidenceIds.length || c.pendingContextUpdate || request.round !== c.roundsUsed || request.baseContextHash !== c.sharedContext.contextHash)) throw new Error('STALE_CANDIDATE');
}
export async function submitControl(root: string, raw: ControlRequest): Promise<ControlReceipt> {
  const request = controlRequestSchema.parse(raw) as ControlRequest, text = canonicalJson(request);
  if (Buffer.byteLength(text) > INPUT_LIMIT_BYTES) throw new Error('INPUT_TOO_LARGE');
  const canonicalRoot = realpathSync(root), file = join(canonicalRoot, 'inbox', 'requests', `${digest(request.requestId)}.json`);
  // Existing IDs are checked first so applied requests remain idempotent after advancement.
  if (existsSync(file)) {
    if (canonicalJson(readBoundedJson(file)) !== text) throw new Error('CONTROL_ID_CONFLICT');
    return { requestId: request.requestId, runId: request.runId, status: 'queued', applied: false, duplicate: true };
  }
  const reader = openRunReader(canonicalRoot);
  try {
    const snapshot = reader.load(request.runId);
    try { validateControl(request, snapshot); }
    catch (error) {
      if (request.kind === 'context_update' && error instanceof Error && error.message === 'CONTEXT_UPDATE_DURING_CLARIFICATION') {
        const rejected = join(canonicalRoot, 'inbox', 'rejected', `${digest(request.requestId)}.json`);
        const retained = { request, code: error.message, correlation: { runId: request.runId, state: snapshot.state, revision: snapshot.revision, contextHash: snapshot.context.sharedContext.contextHash } };
        if (!publishAtomic(rejected, retained) && canonicalJson((readBoundedJson(rejected) as { request: unknown }).request) !== canonicalJson(request)) throw new Error('CONTROL_ID_CONFLICT');
      }
      throw error;
    }
  } finally { reader.close(); }
  const created = publishAtomic(file, request);
  if (!created && canonicalJson(readBoundedJson(file)) !== text) throw new Error('CONTROL_ID_CONFLICT');
  return { requestId: request.requestId, runId: request.runId, status: 'queued', applied: false, duplicate: !created };
}
export function readInbox(root: string): InboxEntry[] {
  const directory = join(root, 'inbox', 'requests');
  if (!existsSync(directory)) return [];
  if (realpathSync(directory) !== directory) throw new Error('INBOX_PATH_INVALID');
  return readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort().flatMap(name => {
    if (existsSync(join(root, 'inbox', 'receipts', name))) return [];
    const path = join(directory, name), request = controlRequestSchema.parse(readBoundedJson(path)) as ControlRequest;
    if (name !== `${digest(request.requestId)}.json`) throw new Error('INBOX_ID_MISMATCH');
    return [{ path, request, hash: digest(canonicalJson(request)) }];
  });
}
export function acknowledgeControl(root: string, disposition: ControlDisposition): void {
  const file = join(root, 'inbox', 'receipts', `${digest(disposition.requestId)}.json`);
  if (!publishAtomic(file, disposition) && canonicalJson(readBoundedJson(file)) !== canonicalJson(disposition)) throw new Error('CONTROL_RECEIPT_CONFLICT');
}
