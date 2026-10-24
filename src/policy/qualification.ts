import { isAbsolute, relative } from 'node:path';
import { realpathSync } from 'node:fs';
import { z } from 'zod';
import { canonicalJson } from '../domain/hash.js';
import { canonicalPathSchema, idSchema, modelSelectionSchema } from '../domain/schemas.js';

export const versionsSchema = z.strictObject({ orca: idSchema, codex: idSchema, antigravity: idSchema });
export const actionClassSchema = z.enum(['supplied-packet-read-only', 'source-read-only', 'approved-check']);
export const qualificationReceiptSchema = z.strictObject({
  id: idSchema, host: idSchema, versions: versionsSchema, actionClass: actionClassSchema,
  requested: modelSelectionSchema, exposed: modelSelectionSchema.nullable(), expiresAt: z.number().finite(), throughOrca: z.boolean(),
  helpersDisabled: z.boolean(), terminalSandbox: z.boolean(), accessControlled: z.boolean(), roots: z.array(canonicalPathSchema), protectedPaths: z.array(canonicalPathSchema).optional(), receiptRefs: z.array(idSchema).min(1),
});
export type QualificationReceipt = z.infer<typeof qualificationReceiptSchema>;
export const qualificationRequirementSchema = z.strictObject({ selection: modelSelectionSchema, host: idSchema, versions: versionsSchema, actionClass: actionClassSchema, roots: z.array(canonicalPathSchema), now: z.number().finite() });
export type QualificationRequirement = z.infer<typeof qualificationRequirementSchema>;
export type QualificationDecision = { kind: 'ready' | 'blocked'; reason: string; receiptRefs: readonly string[] };
export function pathWithin(path: string, root: string): boolean { const part = relative(root, path); return !isAbsolute(part) && part !== '..' && !part.startsWith('../'); }
export function qualifySelection(input: QualificationRequirement, receipts: readonly QualificationReceipt[]): QualificationDecision {
  const parsed = qualificationRequirementSchema.safeParse(input), list = z.array(qualificationReceiptSchema).safeParse(receipts);
  const fail = (reason: string, receiptRefs: readonly string[] = []): QualificationDecision => ({ kind: 'blocked', reason, receiptRefs });
  if (!parsed.success || !list.success) return fail('UNQUALIFIED_ROUTE');
  const required = parsed.data;
  const canonicalRoot = (root: string): boolean => { try { return root !== '/' && realpathSync(root) === root; } catch { return false; } };
  if (!required.roots.every(canonicalRoot)) return fail('UNQUALIFIED_ROUTE');
  const matches = list.data.filter(receipt => receipt.roots.every(canonicalRoot) && receipt.host === required.host && canonicalJson(receipt.versions) === canonicalJson(required.versions) && canonicalJson(receipt.requested) === canonicalJson(required.selection) && receipt.actionClass === required.actionClass && receipt.expiresAt > required.now && receipt.throughOrca && receipt.helpersDisabled && receipt.terminalSandbox && receipt.accessControlled && required.roots.every(root => receipt.roots.some(allowed => pathWithin(root, allowed))));
  const matching = matches.find(receipt => receipt.exposed !== null && canonicalJson(receipt.exposed) === canonicalJson(required.selection));
  if (matching) return { kind: 'ready', reason: 'READY', receiptRefs: [matching.id, ...matching.receiptRefs] };
  const candidate = matches[0];
  if (!candidate) return fail('UNQUALIFIED_ROUTE');
  return fail(candidate.exposed === null ? 'EFFECTIVE_SETTINGS_UNKNOWN' : 'EFFECTIVE_SETTINGS_MISMATCH', [candidate.id, ...candidate.receiptRefs]);
}
