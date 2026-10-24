import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { validateScope, validateSourceAddress } from '../../src/policy/preflight.js';

it('rejects symlink escapes, protected files and unapproved command outputs without adding grants', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'scope-'))), outside = realpathSync(mkdtempSync(join(tmpdir(), 'outside-')));
  const safe = join(root, 'safe'); mkdirSync(safe);
  expect(validateScope({ sourceRoots: [safe], allowedSourceAddresses: [], checks: [] }).kind).toBe('ready');
  symlinkSync(outside, join(safe, 'escape'));
  expect(validateScope({ sourceRoots: [safe], allowedSourceAddresses: [], checks: [] }).kind).toBe('ready');
  expect(validateSourceAddress(join(safe, 'escape'), { sourceRoots: [safe], allowedSourceAddresses: [], checks: [] }).reason).toBe('SCOPE_SYMLINK_ESCAPE');
  writeFileSync(join(root, 'AGENTS.md'), 'protected');
  expect(validateScope({ sourceRoots: [root], allowedSourceAddresses: [], checks: [] }).kind).toBe('ready');
  expect(validateScope({ sourceRoots: [outside], allowedSourceAddresses: [], checks: [{ id: 'write', argv: ['tool'], cwd: outside, declaredEffects: ['write'], outputTargets: [join(root, 'output')] }] }).reason).toBe('SCOPE_OUTPUT_DENIED');
  expect(validateScope({ sourceRoots: [outside], allowedSourceAddresses: ['file:///etc/passwd'], checks: [] }).reason).toBe('SOURCE_ADDRESS_DENIED');
});

it('keeps protected output paths denied even when an existing control makes a parent root usable', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'controlled-scope-'))), protectedPath = join(root, '.superpowers'); mkdirSync(protectedPath);
  const controls = [{ path: protectedPath, receiptId: 'deny-receipt', qualificationId: 'qualified-control' }];
  const scope = { sourceRoots: [root], allowedSourceAddresses: [], checks: [] };
  expect(validateScope(scope, { controls }).kind).toBe('ready');
  expect(validateScope({ ...scope, checks: [{ id: 'write', argv: ['tool'], cwd: root, declaredEffects: ['write'], outputTargets: [join(protectedPath, 'state.json')] }] }, { controls }).reason).toBe('SCOPE_OUTPUT_DENIED');
  const credential = join(root, '.npmrc'); writeFileSync(credential, 'secret');
  expect(validateSourceAddress(credential, scope).reason).toBe('SCOPE_PROTECTED_PATH');
});

it('permits an ordinary repository as source scope while denying direct and aliased protected requests', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'repository-scope-')));
  for (const dir of ['.git', '.council']) mkdirSync(join(root, dir));
  for (const file of ['AGENTS.md', '.env']) writeFileSync(join(root, file), 'protected');
  writeFileSync(join(root, 'source.ts'), 'source'); symlinkSync(join(root, '.env'), join(root, 'ordinary.txt'));
  const scope = { sourceRoots: [root], allowedSourceAddresses: ['https://approved.example/source'], checks: [] };
  expect(validateScope(scope).kind).toBe('ready');
  expect(validateSourceAddress(join(root, 'source.ts'), scope).kind).toBe('ready');
  for (const path of ['AGENTS.md', '.env', 'ordinary.txt', '.git', '.council']) expect(validateSourceAddress(join(root, path), scope).reason, path).toBe('SCOPE_PROTECTED_PATH');
  expect(validateSourceAddress('https://unapproved.example/source', scope).reason).toBe('SOURCE_ADDRESS_DENIED');
  expect(validateSourceAddress('https://approved.example/source', scope).kind).toBe('ready');
});

it('rejects writes through a dangling symlink without treating it as a future directory', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dangling-scope-'))), outside = realpathSync(mkdtempSync(join(tmpdir(), 'dangling-outside-')));
  symlinkSync(join(outside, 'not-created'), join(root, 'escape'));
  expect(validateScope({ sourceRoots: [root], allowedSourceAddresses: [], checks: [{ id: 'write', argv: ['tool'], cwd: root, declaredEffects: ['write'], outputTargets: [join(root, 'escape', 'result.txt')] }] }).kind).toBe('blocked');
});

it('allows a checkout beneath a tool directory and requires an existing command cwd', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nested-checkout-'))), source = join(root, '.codex', 'worktrees', 'project', 'src'); mkdirSync(source, { recursive: true });
  const check = { id: 'read', argv: ['tool'], cwd: source, declaredEffects: [], outputTargets: [] };
  expect(validateScope({ sourceRoots: [source], allowedSourceAddresses: [], checks: [check] }).kind).toBe('ready');
  expect(validateScope({ sourceRoots: [source], allowedSourceAddresses: [], checks: [{ ...check, cwd: join(source, 'missing') }] }).reason).toBe('SCOPE_CHECK_DENIED');
});
