import type { ConfirmationContext, Objection, ReviewerSeat } from './contracts.js';
import { canonicalJson } from './hash.js';
import { confirmationContextSchema, objectionSchema } from './schemas.js';

function content(objection: Objection): string {
  const { status: _status, history: _history, ...immutable } = objection;
  return canonicalJson(immutable);
}

function validateHistory(objection: Objection): void {
  objectionSchema.parse(objection);
  for (const record of objection.history) {
    if (record.seat !== objection.owner || record.objectionId !== objection.id) throw new Error('Disposition history owner mismatch');
  }
  if (objection.status !== (objection.history.at(-1)?.status ?? 'open')) throw new Error('Objection status does not match disposition history');
}

/** Repeated delivery may confirm content, but never reopens or overwrites history. */
export function registerObjections(ledger: readonly Objection[], additions: readonly Objection[], seat: ReviewerSeat): readonly Objection[] {
  const byId = new Map<string, Objection>();
  for (const objection of ledger) {
    validateHistory(objection);
    if (byId.has(objection.id)) throw new Error('Duplicate objection ledger ID');
    byId.set(objection.id, objection);
  }
  for (const objection of additions) {
    objectionSchema.parse(objection);
    if (objection.owner !== seat) throw new Error('Cannot create another seat\'s objection');
    if (objection.status !== 'open' || objection.history.length !== 0) throw new Error('New objection must start open with no disposition history');
    const previous = byId.get(objection.id);
    if (previous && content(previous) !== content(objection)) throw new Error('Conflicting objection ID');
    if (!previous) byId.set(objection.id, objection);
  }
  return [...byId.values()];
}

/** Register all new items before closure; only the frozen input can receive dispositions. */
export function applyOwnedDispositions(context: ConfirmationContext): readonly Objection[] {
  confirmationContextSchema.parse(context);
  if (new Set(context.ballots.map(ballot => ballot.seat)).size !== context.ballots.length) throw new Error('Duplicate ballot seat');
  if (new Set(context.objections.map(objection => objection.id)).size !== context.objections.length) throw new Error('Duplicate objection ledger ID');
  for (const objection of context.objections) validateHistory(objection);
  let ledger = context.objections;
  for (const ballot of context.ballots) {
    if (ballot.binding.role !== ballot.seat || ballot.binding.phase !== 'ballot') throw new Error('Disposition actor mismatch');
    if (canonicalJson(ballot.binding) !== canonicalJson(context.expectedAttempts[ballot.seat])) throw new Error('Stale disposition attempt');
    if (canonicalJson(ballot.bindings) !== canonicalJson(context.expected)) throw new Error('Stale disposition target/context');
    for (const [key, value] of Object.entries(context.expected)) if (ballot.binding[key as keyof typeof ballot.binding] !== value) throw new Error('Stale disposition attempt target');
    if (canonicalJson(ballot.binding.requested) !== canonicalJson(context.config.reviewers[ballot.seat])) throw new Error('Disposition model mapping mismatch');
    ledger = registerObjections(ledger, ballot.newObjections, ballot.seat);
  }
  const result = new Map(ledger.map(objection => [objection.id, objection]));
  for (const ballot of context.ballots) {
    const seen = new Set<string>();
    for (const disposition of ballot.dispositions) {
      if (seen.has(disposition.objectionId)) throw new Error('Duplicate objection disposition');
      seen.add(disposition.objectionId);
      if (!context.inputObjectionIds.includes(disposition.objectionId) || !ballot.binding.inputObjectionIds.includes(disposition.objectionId)) throw new Error('Disposition outside frozen input objections');
      if (ballot.newObjections.some(objection => objection.id === disposition.objectionId)) throw new Error('Cannot close a same-ballot new objection');
      if (disposition.evidenceIds.some(id => !ballot.binding.inputEvidenceIds.includes(id))) throw new Error('Disposition evidence outside frozen packet');
      const objection = result.get(disposition.objectionId);
      if (!objection || objection.owner !== ballot.seat) throw new Error('Only the objection owner can dispose it');
      const record = { ...disposition, seat: ballot.seat, attemptId: ballot.binding.attemptId };
      const prior = objection.history.find(item => item.attemptId === record.attemptId);
      if (prior) {
        if (canonicalJson(prior) !== canonicalJson(record)) throw new Error('Conflicting same-attempt disposition');
        continue;
      }
      result.set(objection.id, { ...objection, status: disposition.status, history: [...objection.history, record] });
    }
  }
  return [...result.values()];
}
