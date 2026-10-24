import { createHash, randomUUID } from 'node:crypto';
import { realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { z } from 'zod';
import { INPUT_LIMIT_BYTES } from '../domain/schemas.js';

const text = z.string().min(1), list = z.array(text);
export const handoffInputSchema = z.strictObject({
  decision: text, outcome: text, requirements: list, priorities: list, constraints: list, excludedActions: list,
  priorDecisions: list, references: z.array(z.strictObject({ address: text, description: text })), uncertainties: list, candidates: list,
  suggestedSkills: list.min(1), sensitiveExclusions: list, permittedSources: list, permittedCommands: list, permittedEffects: list, workerAccess: text,
});
export type HandoffInput = z.infer<typeof handoffInputSchema>;
export interface HandoffRef { path: string; hash: string; bytes: number; sensitiveExclusions: readonly string[] }
function within(path: string, root: string): boolean { const part = relative(root, path); return !isAbsolute(part) && part !== '..' && !part.startsWith('../'); }
export function writeHandoff(input: HandoffInput, tempRoot: string): HandoffRef {
  const inspect = (value: unknown): void => {
    if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
      if (/^(?:api[_-]?key|password|secret|token|credentials?|private[_-]?key|ssn)$/i.test(key)) throw new Error('HANDOFF_SENSITIVE_FIELD');
      inspect(item);
    }
    if (typeof value === 'string' && /(?:\bsk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----|\b(?:password|api[_-]?key|token)\s*[:=]\s*\S+)/i.test(value)) throw new Error('HANDOFF_SENSITIVE_CONTENT');
  };
  inspect(input);
  const parsed = handoffInputSchema.parse(input), root = realpathSync(tempRoot), osRoot = realpathSync(process.env.TMPDIR || '/tmp');
  if (!within(root, osRoot) && !within(root, realpathSync('/tmp'))) throw new Error('HANDOFF_NOT_TEMPORARY');
  const sections: [string, readonly string[]][] = [
    ['Decision', [parsed.decision]], ['Desired outcome', [parsed.outcome]], ['Requirements', parsed.requirements], ['Priorities', parsed.priorities],
    ['Constraints', parsed.constraints], ['Excluded actions', parsed.excludedActions], ['Prior decisions', parsed.priorDecisions],
    ['References', parsed.references.map(ref => `${ref.address}: ${ref.description}`)], ['Uncertainty', parsed.uncertainties], ['Candidates and status', parsed.candidates],
    ['Permitted sources', parsed.permittedSources], ['Permitted commands', parsed.permittedCommands], ['Permitted effects', parsed.permittedEffects],
    ['Worker access', [parsed.workerAccess]], ['Suggested skills', parsed.suggestedSkills], ['Sensitive exclusions', parsed.sensitiveExclusions],
  ];
  const content = sections.map(([title, items]) => `## ${title}\n\n${items.length ? items.map(item => `- ${item}`).join('\n') : '- None recorded.'}\n`).join('\n');
  if (Buffer.byteLength(content) > INPUT_LIMIT_BYTES) throw new Error('HANDOFF_TOO_LARGE');
  const path = join(root, `council-handoff-${randomUUID()}.md`); writeFileSync(path, content, { flag: 'wx', mode: 0o600 });
  return { path, hash: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content), sensitiveExclusions: parsed.sensitiveExclusions };
}
