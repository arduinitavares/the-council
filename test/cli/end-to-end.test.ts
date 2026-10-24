import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temp = realpathSync(mkdtempSync(join(tmpdir(), 'council-packed-')));
afterAll(() => { rmSync(temp, { recursive: true }); });
let files: string[] = [], packed = '';
function writeInput(input: string, workspace: string, runId: string): void {
  writeFileSync(input, JSON.stringify({ runId, topic: 'Disposable packaging qualification', scope: { sourceRoots: [workspace], allowedSourceAddresses: [], checks: [] }, handoff: { decision: 'Package smoke check', outcome: 'No model launches', requirements: [], priorities: [], constraints: [], excludedActions: ['Live inference'], priorDecisions: [], references: [], uncertainties: [], candidates: [], suggestedSkills: ['verify-evidence'], sensitiveExclusions: [], permittedSources: [], permittedCommands: [], permittedEffects: [], workerAccess: 'Supplied packet only' } }));
}
beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });
  const receipt = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], { cwd: root, encoding: 'utf8' }))[0];
  files = receipt.files.map((file: { path: string }) => file.path);
  execFileSync('tar', ['-xzf', join(temp, receipt.filename), '-C', temp]);
  packed = join(temp, 'package');
  symlinkSync(join(root, 'node_modules'), join(packed, 'node_modules'), 'dir');
}, 60000);

it('ships the exact default roster, built store asset and skill while excluding runtime and development data', () => {
  expect(files).toEqual(expect.arrayContaining(['dist/cli/index.js', 'dist/store/schema.sql', 'council.yaml', 'skills/the-council/SKILL.md', 'skills/the-council/scripts/run-council.mjs', 'skills/the-council/agents/openai.yaml', 'skills/the-council/references/communication.md', 'docs/runbook.md']));
  expect(files.filter(path => /(^|\/)(?:node_modules|\.superpowers|\.council|test|src|coverage)(?:\/|$)|(^|\/)\.env(?:[./]|$)|\.(?:sqlite3?|db|jsonl|pem|key)$/.test(path))).toEqual([]);
  expect(parse(readFileSync(join(packed, 'council.yaml'), 'utf8'))).toEqual({ version: 1, reviewers: { openai: { route: 'codex', model: 'gpt-6-astra', effort: 'ultra' }, gemini: { route: 'antigravity', model: 'gemini-4-argon-high', effort: 'high' }, claude: { route: 'antigravity', model: 'claude-opus-5-5-high', effort: 'high' } }, judge: { route: 'codex', model: 'gpt-6-astra', effort: 'ultra' } });
});

it('initializes a disposable store from the actual packed CLI and preserves the live admission block', () => {
  const workspace = join(temp, 'workspace'); mkdirSync(workspace);
  const input = join(temp, 'request with spaces.json');
  writeInput(input, workspace, 'packed-smoke');
  const launcher = join(packed, 'skills/the-council/scripts/run-council.mjs');
  const result = spawnSync(process.execPath, [launcher, 'start', '--input', input, '--workspace', workspace, '--json'], { cwd: temp, encoding: 'utf8', timeout: 20000 });
  expect(result.status, result.stderr).toBe(3);
  const output = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  expect(output[0]).toEqual({ runId: 'packed-smoke', status: 'starting' });
  expect(output.at(-1)).toMatchObject({ decision: 'blocked', state: 'blocked', settlement: 'settled', blockers: expect.arrayContaining(['CURRENT_ADMISSION_REQUIRED']) });
  const inspect = spawnSync(process.execPath, [launcher, 'inspect', '--workspace', workspace, '--run', 'packed-smoke', '--json'], { cwd: temp, encoding: 'utf8' });
  expect(inspect.status, inspect.stderr).toBe(0);
  expect(JSON.parse(inspect.stdout)).toMatchObject({ runId: 'packed-smoke', state: 'blocked', callsReserved: 0, settlement: 'settled' });
  expect(existsSync(join(workspace, '.council/runs/packed-smoke'))).toBe(true);
});

it('forwards an explicit start configuration literally through argv without shell expansion', () => {
  const workspace = join(temp, 'config-workspace'); mkdirSync(workspace);
  const input = join(temp, 'config-input.json');
  writeInput(input, workspace, 'config-smoke');
  const config = join(temp, 'config $(touch NOT_EXECUTED).yaml');
  writeFileSync(config, readFileSync(join(packed, 'council.yaml'), 'utf8').replaceAll('gpt-6-astra', 'gpt-6.1-sol').replaceAll('ultra', 'max'));
  const launcher = join(packed, 'skills/the-council/scripts/run-council.mjs');
  const result = spawnSync(process.execPath, [launcher, 'start', '--input', input, '--config', config, '--workspace', workspace, '--json'], { cwd: temp, encoding: 'utf8', timeout: 20000 });
  expect(result.status, result.stderr).toBe(3);
  expect(existsSync(join(temp, 'NOT_EXECUTED'))).toBe(false);
  // Inspect the committed configuration through the real packed store reader.
  const script = `import { openRunReader } from ${JSON.stringify(pathToFileURL(join(packed, 'dist/store/run-store.js')).href)}; const r = openRunReader(process.argv[1]); console.log(JSON.stringify(r.load('config-smoke').context.config)); r.close();`;
  const saved = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, join(workspace, '.council/runs/config-smoke')], { encoding: 'utf8' }));
  expect(saved.sourcePath).toBe(config);
  expect(saved.resolved.reviewers.openai).toEqual({ route: 'codex', model: 'gpt-6.1-sol', effort: 'max' });
  expect(saved.resolved.judge).toEqual({ route: 'codex', model: 'gpt-6.1-sol', effort: 'max' });
});
