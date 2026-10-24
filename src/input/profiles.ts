import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { z } from 'zod';
import type { JsonValue, ProfileSnapshot } from '../domain/contracts.js';
import { canonicalJson, hashArtifact } from '../domain/hash.js';
import { INPUT_LIMIT_BYTES, canonicalPathSchema, hashSchema, idSchema } from '../domain/schemas.js';
import { openArtifactStore } from '../store/artifacts.js';

const sourceSchema = z.strictObject({ id: idSchema, path: canonicalPathSchema, revision: idSchema, sha256: hashSchema });
const methodSchema = z.strictObject({
  id: idSchema, sources: z.array(sourceSchema).min(1).max(32), bundleComplete: z.boolean(), restriction: z.enum(['none', 'explicit-only', 'disabled']),
  permissions: z.array(idSchema), unavailableDependencies: z.array(idSchema), excludedDependencies: z.array(idSchema), retained: z.array(idSchema).min(1), replaced: z.array(idSchema).min(1), excluded: z.array(idSchema).min(1),
});
export const profileInputSchema = z.strictObject({ artifactRoot: canonicalPathSchema, revision: idSchema, methods: z.array(methodSchema).min(1).max(5) });
export type ProfileInput = z.infer<typeof profileInputSchema>;
function readSource(path: string): Buffer {
  if (realpathSync(path) !== path) throw new Error('PROFILE_SOURCE_MISMATCH');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('PROFILE_SOURCE_MISMATCH');
    if (stat.size > INPUT_LIMIT_BYTES) throw new Error('PROFILE_SOURCE_TOO_LARGE');
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) { const count = readSync(fd, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
    if (length !== stat.size) throw new Error('PROFILE_SOURCE_MISMATCH');
    return buffer.subarray(0, length);
  } finally { closeSync(fd); }
}
export function freezeProfile(input: ProfileInput): ProfileSnapshot {
  const parsed = profileInputSchema.parse(input), ids = new Set<string>(), sources = new Map<string, z.infer<typeof sourceSchema>>();
  const sourceBytes = new Map<string, Buffer>();
  let totalBytes = 0;
  // Validate every source before creating any artifacts.
  for (const method of parsed.methods) {
    if (ids.has(method.id)) throw new Error('PROFILE_DUPLICATE_METHOD'); ids.add(method.id);
    if (method.restriction !== 'none') throw new Error('PROFILE_RESTRICTED_SOURCE');
    if (!method.bundleComplete || method.unavailableDependencies.some(dependency => !method.excludedDependencies.includes(dependency))) throw new Error('PROFILE_BUNDLE_INCOMPLETE');
    if (method.permissions.some(permission => permission !== 'supplied-text')) throw new Error('PROFILE_UNSAFE_METHOD');
    for (const source of method.sources) {
      let bytes: Buffer;
      try { bytes = readSource(source.path); }
      catch (error) { if (error instanceof Error && error.message === 'PROFILE_SOURCE_TOO_LARGE') throw error; throw new Error('PROFILE_SOURCE_MISMATCH'); }
      if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error('PROFILE_SOURCE_MISMATCH');
      const previous = sources.get(source.id);
      if (previous && canonicalJson(previous) !== canonicalJson(source)) throw new Error('PROFILE_SOURCE_MISMATCH');
      sources.set(source.id, source);
      sourceBytes.set(source.id, bytes); totalBytes += bytes.length;
      if (totalBytes > INPUT_LIMIT_BYTES) throw new Error('PROFILE_SOURCE_TOO_LARGE');
    }
  }
  const artifacts = openArtifactStore(parsed.artifactRoot);
  const manifestValue = {
    version: 1, revision: parsed.revision, selection: 'independent-per-seat', automaticDiscovery: false, automaticInstallation: false,
    methods: parsed.methods,
    bundles: [...sources.values()].map(source => ({ source, artifact: artifacts.putArtifact(sourceBytes.get(source.id)!, 'method-source') })),
    restrictions: ['Original explicit-only and disabled sources are excluded.', 'No private interviews, helpers, installs, unsolicited writes or output-contract overrides.'],
  };
  const manifest = artifacts.putArtifact(Buffer.from(canonicalJson(manifestValue)), 'council-profile');
  return {
    manifest, profileHash: hashArtifact('council-profile', manifestValue as unknown as JsonValue), admittedMethodIds: parsed.methods.map(method => method.id), sources: [...sources.values()],
    adaptations: parsed.methods.map(method => ({ methodId: method.id, retained: method.retained, replaced: method.replaced, excluded: method.excluded })),
  };
}

/** Reviewed local sources, pinned on 2026-10-24. Drift requires a new profile revision. */
export function initialProfileInput(artifactRoot: string): ProfileInput {
  const superpowers = '/Users/aaat/.codex/plugins/cache/openai-curated-remote/superpowers/7.0.1/skills';
  const ste = '/Users/aaat/.agents/skills/simplified-technical-english';
  const source = (id: string, path: string, sha256: string) => ({ id, path, sha256, revision: `${path.startsWith(superpowers) ? 'superpowers-7.0.1' : 'simplified-technical-english-1.0.0-source-untracked'}/sha256-${sha256}` });
  const base = { bundleComplete: true, restriction: 'none' as const, permissions: ['supplied-text'], unavailableDependencies: [], excludedDependencies: [] };
  return { artifactRoot, revision: 'council-hybrid-v1', methods: [
    { ...base, id: 'verify-evidence', sources: [source('verification', `${superpowers}/verification-before-completion/SKILL.md`, '2befe7fc55bcadaa3d97dd9e8efeb633d2561c0ebe74c5a8b17c4d9e7e4520b3')],
      retained: ['Require fresh inspected evidence before a completion claim.', 'Separate observed checks from proposed checks. Preserve exact commands, revisions and uncertainty.'],
      replaced: ['Coordinator and approved evidence adapters perform checks and record their receipts.'], excluded: ['Reviewer execution, edits, commits, launches and approval requests.'] },
    { ...base, id: 'challenge-claims', sources: [source('feedback', `${superpowers}/receiving-code-review/SKILL.md`, '091df1629510af1b92fc4abd6f96732ebedb4cb2c0f3457e8f2740b0504a2438')],
      retained: ['Read, understand, verify and evaluate each material claim before assent.', 'Stop an unsupported decision when a material input is unclear.'],
      replaced: ['Use shared question IDs and evidence requests for unclear inputs. The coordinator owns user contact.'], excluded: ['Automatic fixes, private interviews, GitHub replies and replacing unanimous reviewer acceptance.'] },
    { ...base, id: 'explain-uncertainty', unavailableDependencies: ['Official Issue 9 dictionary', 'Governed project terminology'], excludedDependencies: ['Official Issue 9 dictionary', 'Governed project terminology'], sources: [
      source('ste-entry', `${ste}/SKILL.md`, '42dd19481ffeeede508917869d3e24df14283943c6ba87e06a4c033ffe9a78ba'),
      source('ste-terms', `${ste}/references/terminology-and-verification.md`, '3f3e8e7f6686dc9aca7bd6cacff41ef658139daeb3882bdab10efce8829cfa93'),
      source('ste-description', `${ste}/references/descriptive-writing.md`, '0dd594ede69fdad3de6e34b4179721dad52803bfb634ef2875e1f77432526e3a'),
      source('ste-procedure', `${ste}/references/procedures-and-safety.md`, 'f8e27d95a76251ae4598f0bc3b612e381f61c671c6a50227186ae53199185730'),
      source('ste-reporting', `${ste}/references/review-and-reporting.md`, 'cf58345b92f7f1d83893cc2fc467cb02aff284b941dffb9944b63d7a8e1328fa'),
      source('ste-gotchas', `${ste}/references/gotchas.md`, '5c0ba98b676f04ebcb0294e3ab32bd3e6c87633bd714a71143f100aa63eb5a1f'),
    ], retained: ['Use Issue 9-oriented descriptions. Preserve facts, uncertainty, negation and protected literals.', 'State that dictionary and governed terminology checks remain unverified. Never claim certification.'],
      replaced: ['Council structured output replaces the optional rewrite-report template. The coordinator renders reports.'],
      excluded: ['Official standard redistribution, strict conformance claims, source research, optional scanner scripts and document writes.'] },
  ] };
}
