import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { freezeProfile, initialProfileInput } from '../../src/input/profiles.js';
import { createHash } from 'node:crypto';

it('freezes a small supplied-text hybrid catalogue with exact bundles and explicit adaptations', () => {
  const root = mkdtempSync(join(tmpdir(), 'profile-test-')), input = initialProfileInput(join(root, 'artifacts'));
  const profile = freezeProfile(input);
  expect(profile.admittedMethodIds).toEqual(['verify-evidence', 'challenge-claims', 'explain-uncertainty']);
  expect(profile.sources.length).toBeGreaterThan(3); expect(profile.adaptations.every(a => a.retained.length && a.replaced.length && a.excluded.length)).toBe(true);
  expect(freezeProfile(input).profileHash).toBe(profile.profileHash);
  for (const permission of ['private-interview', 'hidden-helper', 'write', 'install', 'conflicting-output']) {
    const unsafe = structuredClone(input); unsafe.methods[0]!.permissions = [permission];
    expect(() => freezeProfile(unsafe)).toThrow('PROFILE_UNSAFE_METHOD');
  }
  for (const restriction of ['explicit-only', 'disabled'] as const) {
    const disabled = structuredClone(input); disabled.methods[0]!.restriction = restriction;
    expect(() => freezeProfile(disabled)).toThrow('PROFILE_RESTRICTED_SOURCE');
  }
  const changed = structuredClone(input); const file = join(root, 'changed.md'); writeFileSync(file, 'changed'); changed.methods[0]!.sources[0]!.path = file;
  expect(() => freezeProfile(changed)).toThrow('PROFILE_SOURCE_MISMATCH');
  const incomplete = structuredClone(input); incomplete.methods[0]!.bundleComplete = false;
  expect(() => freezeProfile(incomplete)).toThrow('PROFILE_BUNDLE_INCOMPLETE');
  const manifest = JSON.parse(readFileSync(profile.manifest.path, 'utf8'));
  expect(manifest.methods.find((method: {id: string}) => method.id === 'explain-uncertainty').unavailableDependencies).toContain('Official Issue 9 dictionary');
});

it('bounds source reads before any profile artifacts are written', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'large-profile-'))), input = initialProfileInput(join(root, 'artifacts'));
  const path = join(root, 'large.md'), bytes = Buffer.alloc(8 * 1024 * 1024 + 1, 32); writeFileSync(path, bytes);
  input.methods[0]!.sources = [{ id: 'oversized', path, sha256: createHash('sha256').update(bytes).digest('hex'), revision: 'fixture' }];
  expect(() => freezeProfile(input)).toThrow('PROFILE_SOURCE_TOO_LARGE');
});
