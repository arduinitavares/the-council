import { z } from 'zod';
import type { CheckSpec, RunScope } from '../domain/contracts.js';
import { canonicalJson } from '../domain/hash.js';
import { idSchema, runScopeSchema } from '../domain/schemas.js';
import { validateScope, validateSourceAddress, type ScopeDecision, type ScopeEnvironment } from '../policy/preflight.js';

const text = z.string().min(1);
export const sourceManifestSchema = z.array(z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('source'), address: text, revision: text }),
  z.strictObject({ kind: z.literal('check'), address: text, checkId: idSchema, revision: text }),
])).refine(entries => new Set(entries.map(entry => entry.address)).size === entries.length, 'DUPLICATE_SOURCE_ADDRESS');
export type SourceManifest = z.infer<typeof sourceManifestSchema>;

/** No worker grants or recursive checkout inspection belong to this boundary. */
export function evidenceEnvironment(environment: ScopeEnvironment, artifactRoot: string): ScopeEnvironment {
  return { ...structuredClone(environment), protectedPaths: [...(environment.protectedPaths ?? []), artifactRoot] };
}

export function sourceDecision(address: string, scope: RunScope, environment: ScopeEnvironment): ScopeDecision {
  return validateSourceAddress(address, scope, environment);
}

export function declaredCheck(id: string, scope: RunScope, environment: ScopeEnvironment): CheckSpec | null {
  const parsed = runScopeSchema.parse(scope);
  if (validateScope(parsed, environment).kind !== 'ready') return null;
  return parsed.checks.find(check => check.id === id) ?? null;
}

export function sameCheck(left: CheckSpec, right: CheckSpec): boolean {
  return canonicalJson(left) === canonicalJson(right);
}
