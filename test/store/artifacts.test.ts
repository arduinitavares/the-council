import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, unlinkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson, hashArtifact } from '../../src/domain/hash.js';
import { request } from '../machine/helpers.js';

describe('immutable artifacts', () => {
  it('publishes exact bytes with kind/version hashes and reuses only identical content', async () => {
    const { openArtifactStore } = await import('../../src/store/artifacts.js');
    const root = mkdtempSync(join(tmpdir(), 'council-artifact-'));
    const store = openArtifactStore(root);
    const bytes = Buffer.from('  original YAML\n');
    const ref = store.putArtifact(bytes, 'raw-config');
    expect(ref.sha256).toBe(createHash('sha256').update('council:v1:raw-config\n').update(bytes).digest('hex'));
    expect(readFileSync(ref.path)).toEqual(bytes);
    expect(ref.bytes).toBe(bytes.length);
    expect(store.putArtifact(bytes, 'raw-config')).toEqual(ref);
    writeFileSync(ref.path, 'corrupt');
    expect(() => store.putArtifact(bytes, 'raw-config')).toThrow('ARTIFACT_HASH_CONFLICT');
    expect(readFileSync(ref.path, 'utf8')).toBe('corrupt');
  });

  it('verifies raw and canonical saved configuration without its original file', async () => {
    const { openArtifactStore, verifyConfiguration } = await import('../../src/store/artifacts.js');
    const store = openArtifactStore(mkdtempSync(join(tmpdir(), 'council-config-')));
    const resolved = request().config.resolved;
    const raw = Buffer.from('version: 1\n# preserve raw bytes\n');
    const config = {
      sourcePath: '/original/no-longer-exists.yaml', resolved,
      rawArtifact: store.putArtifact(raw, 'raw-config'),
      configArtifact: store.putArtifact(Buffer.from(canonicalJson(resolved)), 'config'),
      rawSha256: createHash('sha256').update(raw).digest('hex'),
      configHash: hashArtifact('config', resolved as unknown as import('../../src/domain/contracts.js').JsonValue),
    };
    expect(() => verifyConfiguration(config, store.root)).not.toThrow();
    expect(() => verifyConfiguration({ ...config, rawSha256: '0'.repeat(64) }, store.root)).toThrow('CONFIG_RAW_HASH_MISMATCH');
    writeFileSync(config.rawArtifact.path, 'changed raw');
    expect(() => verifyConfiguration(config, store.root)).toThrow('ARTIFACT_CORRUPT');
    writeFileSync(config.rawArtifact.path, raw);
    writeFileSync(config.configArtifact.path, '{}');
    expect(() => verifyConfiguration(config, store.root)).toThrow('ARTIFACT_CORRUPT');
    unlinkSync(config.configArtifact.path);
    expect(() => verifyConfiguration(config, store.root)).toThrow('ARTIFACT_MISSING');
    expect(readdirSync(store.root).length).toBeGreaterThan(0);
  });

  it('rejects a symlinked content directory before writing outside its root', async () => {
    const { openArtifactStore } = await import('../../src/store/artifacts.js');
    const store = openArtifactStore(mkdtempSync(join(tmpdir(), 'council-contained-')));
    const outside = mkdtempSync(join(tmpdir(), 'council-outside-'));
    symlinkSync(outside, join(store.root, 'blob'));
    expect(() => store.putArtifact(Buffer.from('must stay contained'))).toThrow('ARTIFACT_PATH_MISMATCH');
    expect(readdirSync(outside)).toEqual([]);
  });
});
