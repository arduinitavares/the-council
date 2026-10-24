import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProfileInput } from '../../src/input/profiles.js';

/** Synthetic source bundles: never read the installed production method pins. */
export function testProfileInput(tempRoot: string): ProfileInput {
  const root = realpathSync(tempRoot), sourceRoot = join(root, 'profile-sources');
  mkdirSync(sourceRoot, { recursive: true });
  const source = (id: string) => {
    const path = join(sourceRoot, `${id}.md`), bytes = Buffer.from(`Synthetic Council test source: ${id}.\n`);
    writeFileSync(path, bytes);
    return { id, path, revision: 'synthetic-test-v1', sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const base = {
    bundleComplete: true, restriction: 'none' as const, permissions: ['supplied-text'],
    unavailableDependencies: [], excludedDependencies: [],
    retained: ['Retain supplied evidence.'], replaced: ['Use structured test output.'], excluded: ['No external actions.'],
  };
  return { artifactRoot: join(root, 'artifacts'), revision: 'synthetic-council-test-v1', methods: [
    { ...base, id: 'verify-evidence', sources: [source('verification')] },
    { ...base, id: 'challenge-claims', sources: [source('challenge')] },
    { ...base, id: 'explain-uncertainty', sources: [source('uncertainty-entry'), source('uncertainty-companion')],
      unavailableDependencies: ['Official Issue 9 dictionary'], excludedDependencies: ['Official Issue 9 dictionary'] },
  ] };
}
