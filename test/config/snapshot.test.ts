import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadCouncilConfig } from '../../src/config/load.js';
import { canonicalJson } from '../../src/domain/hash.js';
import type { ConfigSnapshot } from '../../src/domain/contracts.js';
import { createInitialSnapshot } from '../../src/machine/reduce.js';
import { openRunReader, openRunStore } from '../../src/store/run-store.js';
import { request } from '../machine/helpers.js';

it('recovers a loader-produced snapshot after the original YAML is deleted and rejects saved corruption', async () => {
  const root = mkdtempSync(join(tmpdir(), 'loader-store-')), path = join(root, 'roster.yaml');
  writeFileSync(path, readFileSync(new URL('../../council.yaml', import.meta.url)));
  const loaded = await loadCouncilConfig(path), store = openRunStore(join(root, 'state'));
  const config: ConfigSnapshot = {
    sourcePath: loaded.sourcePath, rawSha256: loaded.rawSha256, resolved: loaded.resolved, configHash: loaded.configHash,
    rawArtifact: store.artifacts.putArtifact(loaded.sourceBytes, 'raw-config'),
    configArtifact: store.artifacts.putArtifact(Buffer.from(canonicalJson(loaded.resolved)), 'council-config'),
  };
  expect(config.rawSha256).toBe(createHash('sha256').update(loaded.sourceBytes).digest('hex'));
  expect(config.rawSha256).not.toBe(config.rawArtifact.sha256);
  const initial = createInitialSnapshot({ ...request(), config }); store.createRun(initial); store.close(); unlinkSync(path);
  const reader = openRunReader(join(root, 'state'));
  expect(reader.load('run1').context.config).toEqual(config);
  writeFileSync(config.configArtifact.path, 'corrupt'); expect(() => reader.load('run1')).toThrow('ARTIFACT_CORRUPT'); reader.close();
});
