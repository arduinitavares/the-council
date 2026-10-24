import { describe, expect, it } from 'vitest';

describe('strict Council command line', () => {
  it('accepts start config and rejects config on resume', async () => {
    const api = await import('../../src/cli/parse.js').catch(() => null);
    expect(api, 'Task7 CLI parser is missing').not.toBeNull();
    expect(api!.parseArgs(['start', '--input', 'request.json', '--workspace', '/tmp', '--config', 'custom.yaml', '--json'])).toMatchObject({ command: 'start', config: 'custom.yaml' });
    expect(() => api!.parseArgs(['resume', '--run', 'one', '--workspace', '/tmp', '--config', 'changed.yaml', '--json'])).toThrow();
  });
  it('returns usage 4 with JSON stdout and bounded diagnostics', async () => {
    const api = await import('../../src/cli/index.js').catch(() => null);
    expect(api, 'Task7 CLI runner is missing').not.toBeNull();
    const stdout: string[] = [], stderr: string[] = [];
    expect(await api!.runCli(['bogus'], { stdout: s => stdout.push(s), stderr: s => stderr.push(s) })).toBe(4);
    expect(JSON.parse(stdout.join(''))).toMatchObject({ error: 'USAGE' });
    expect(stderr.join('').length).toBeLessThan(4097);
  });
});

import { mkdtempSync, mkdirSync, readdirSync, symlinkSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectRun, runCli, runRoot } from '../../src/cli/index.js';
import { openRunReader } from '../../src/store/run-store.js';
import { testProfileInput } from '../policy/profile-fixture.js';
function cliFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'council-cli-'))), workspace = join(root, 'workspace'); mkdirSync(workspace);
  const input = join(root, 'input.json');
  const request = { runId: 'cli-one', topic: 'Bounded fake decision', scope: { sourceRoots: [workspace], allowedSourceAddresses: [], checks: [] },
    handoff: { decision: 'Choose an approach', outcome: 'A decision', requirements: [], priorities: [], constraints: [], excludedActions: [], priorDecisions: [], references: [], uncertainties: [], candidates: [], suggestedSkills: ['verify-evidence'], sensitiveExclusions: [], permittedSources: [], permittedCommands: [], permittedEffects: [], workerAccess: 'Supplied packet only' } };
  writeFileSync(input, JSON.stringify(request));
  const stdout: string[] = [], stderr: string[] = [];
  const io = { cwd: root, stdout: (text: string) => stdout.push(text), stderr: (text: string) => stderr.push(text),
    profileInput: (artifactRoot: string) => ({ ...testProfileInput(root), artifactRoot }), wait: async () => {} };
  return { root, workspace, input, request, stdout, stderr, io };
}
it('resolves the default configuration from the package root from another cwd and prints ID before the outcome', async () => {
  const f = cliFixture();
  writeFileSync(join(f.workspace, 'council.yaml'), 'invalid competing defaults');
  expect(await runCli(['start', '--workspace', f.workspace, '--input', 'input.json', '--json'], f.io)).toBe(3);
  const lines = f.stdout.map(line => JSON.parse(line));
  expect(lines[0]).toEqual({ runId: 'cli-one', status: 'starting' });
  expect(lines[1]).toMatchObject({ runId: 'cli-one', state: 'blocked', settlement: 'settled' });
  const reader = openRunReader(runRoot(f.workspace, 'cli-one'));
  expect(reader.load('cli-one').context.config.sourcePath).toBe(realpathSync(fileURLToPath(new URL('../../council.yaml', import.meta.url))));
  expect(reader.readJournal('cli-one')[0]!.event.body.kind).toBe('CLOCK_CHECKPOINT'); reader.close();
});
it('adopts edits only in a new run and resolves explicit config paths relative to invocation cwd', async () => {
  const f = cliFixture(), yaml = join(f.root, 'selected.yaml');
  writeFileSync(yaml, readFileSync(new URL('../../council.yaml', import.meta.url)));
  expect(await runCli(['start', '--workspace', f.workspace, '--input', 'input.json', '--config', 'selected.yaml', '--json'], f.io)).toBe(3);
  const first = inspectRun(runRoot(f.workspace, 'cli-one'), 'cli-one');
  const edited = readFileSync(yaml, 'utf8').replaceAll('gpt-6-astra', 'gpt-6.1-sol').replaceAll('ultra', 'max'); writeFileSync(yaml, edited);
  writeFileSync(f.input, JSON.stringify({ ...f.request, runId: 'cli-two' }));
  expect(await runCli(['start', '--workspace', f.workspace, '--input', 'input.json', '--config', 'selected.yaml', '--json'], f.io)).toBe(3);
  expect(inspectRun(runRoot(f.workspace, 'cli-one'), 'cli-one').configHash).toBe(first.configHash);
  expect(inspectRun(runRoot(f.workspace, 'cli-two'), 'cli-two').configHash).not.toBe(first.configHash);
});
it('fails explicitly for a missing selected file instead of falling back to package defaults', async () => {
  const f = cliFixture();
  expect(await runCli(['start', '--workspace', f.workspace, '--input', 'input.json', '--config', 'missing.yaml', '--json'], f.io)).toBe(4);
  expect(f.stdout.map(line => JSON.parse(line)).at(-1)).toMatchObject({ error: 'INPUT_INVALID', detail: 'CONFIG_NOT_FOUND' });
});
it('rejects competing run-input models and only accepts an explicitly disposable qualification', async () => {
  const f = cliFixture(); writeFileSync(f.input, JSON.stringify({ ...f.request, reviewers: {} }));
  expect(await runCli(['start', '--workspace', f.workspace, '--input', 'input.json', '--json'], f.io)).toBe(4);
  const profile = join(f.root, 'profile.json'); writeFileSync(profile, JSON.stringify({ disposable: false, request: {} }));
  expect(await runCli(['qualify', '--workspace', f.workspace, '--profile', 'profile.json', '--json'], f.io)).toBe(4);
});

it('rejects a symlinked control directory before writing outside the selected workspace', async () => {
  const f = cliFixture(), outside = join(f.root, 'outside'); mkdirSync(outside);
  symlinkSync(outside, join(f.workspace, '.council'), 'dir');
  expect(await runCli(['start', '--workspace', f.workspace, '--input', 'input.json', '--json'], f.io)).toBe(4);
  expect(readdirSync(outside)).toEqual([]);
});
