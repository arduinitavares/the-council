import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parse } from 'yaml';
import { controlRequestSchema } from '../../src/runtime/inbox.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const skill = join(root, 'skills/the-council');
const launcher = join(skill, 'scripts/run-council.mjs');
const ownedTemps: string[] = [];
function ownedTemp(prefix: string): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  ownedTemps.push(directory);
  return directory;
}
afterAll(() => { for (const directory of ownedTemps) rmSync(directory, { recursive: true }); });
const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : '';
beforeAll(() => { execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' }); }, 60000);

it('exposes an explicit-only skill to the client with the correct invocation prompt', () => {
  const metadata = parse(read(join(skill, 'agents/openai.yaml')));
  expect(metadata).toMatchObject({ policy: { allow_implicit_invocation: false }, interface: { display_name: 'The Council', default_prompt: expect.stringContaining('$the-council') } });
  const frontmatter = read(join(skill, 'SKILL.md')).split('---')[1] ?? '';
  expect(parse(frontmatter)).toMatchObject({ name: 'the-council' });
});

it('resolves the real built CLI from a symlinked skill even with an unrelated cwd', () => {
  const cwd = ownedTemp('council-skill-link-');
  symlinkSync(skill, join(cwd, 'installed'), 'dir');
  const result = spawnSync(process.execPath, [join(cwd, 'installed/scripts/run-council.mjs'), 'bogus'], { cwd, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(4);
  expect(JSON.parse(result.stdout)).toEqual({ error: 'USAGE', detail: 'USAGE' });
});

it('fails with an actionable build error and performs no implicit installation', () => {
  expect(existsSync(launcher), 'Task8 launcher is missing').toBe(true);
  const cwd = ownedTemp('council-no-build-');
  const copy = join(cwd, 'skills/the-council/scripts/run-council.mjs');
  mkdirSync(dirname(copy), { recursive: true }); copyFileSync(launcher, copy);
  const result = spawnSync(process.execPath, [copy, 'inspect'], { cwd, encoding: 'utf8' });
  expect(result.status).toBe(4);
  expect(result.stderr).toContain('npm run build');
  expect(result.stderr).toContain(cwd);
  expect(existsSync(join(cwd, 'node_modules'))).toBe(false);
});

it.each(['topic', 'handoff'])('rejects an otherwise complete request missing %s through the real CLI decoder', missing => {
  const cwd = ownedTemp('council-invalid-input-');
  const input: Record<string, unknown> = { topic: 'Decision', scope: { sourceRoots: [cwd], allowedSourceAddresses: [], checks: [] }, handoff: { decision: 'Choose an approach', outcome: 'A decision', requirements: [], priorities: [], constraints: [], excludedActions: [], priorDecisions: [], references: [], uncertainties: [], candidates: [], suggestedSkills: ['verify-evidence'], sensitiveExclusions: [], permittedSources: [], permittedCommands: [], permittedEffects: [], workerAccess: 'Supplied packet only' } };
  delete input[missing];
  const path = join(cwd, 'request.json'); writeFileSync(path, JSON.stringify(input));
  const result = spawnSync(process.execPath, [launcher, 'start', '--workspace', cwd, '--input', path, '--json'], { cwd, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(4);
  expect(JSON.parse(result.stdout)).toMatchObject({ error: 'INPUT_INVALID' });
  expect(existsSync(join(cwd, '.council'))).toBe(false);
});

it.each(['resume', 'inspect', 'respond', 'cancel'])('does not admit a new configuration on %s', command => {
  const result = spawnSync(process.execPath, [launcher, command, '--workspace', root, '--run', 'one', ...(command === 'respond' ? ['--input', 'control.json'] : []), '--config', 'changed.yaml', '--json'], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(4);
  expect(JSON.parse(result.stdout)).toEqual({ error: 'USAGE', detail: 'USAGE' });
});

it('admits only caller candidate and answer controls, never invented votes or private interviews', () => {
  const envelope = { requestId: 'caller-input', runId: 'one' };
  expect(controlRequestSchema.safeParse({ ...envelope, kind: 'candidate', baseContextHash: 'a'.repeat(64), round: 1, evidenceHash: 'b'.repeat(64), candidate: { text: 'Caller-authored proposal', assumptions: [], tradeoffs: [], unresolvedUncertainty: [], acknowledgedUnverifiedEvidenceIds: [] } }).success).toBe(true);
  expect(controlRequestSchema.safeParse({ ...envelope, kind: 'answers', batch: { requestId: envelope.requestId, batchId: 'batch', origin: { kind: 'clarification', batchIndex: 1 }, baseContextHash: 'a'.repeat(64), answers: [], finalized: false } }).success).toBe(true);
  for (const kind of ['ballot', 'vote', 'private_interview']) expect(controlRequestSchema.safeParse({ ...envelope, kind }).success).toBe(false);
});
