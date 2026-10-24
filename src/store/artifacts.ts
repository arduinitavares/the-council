import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ArtifactRef, ConfigSnapshot, JsonValue } from '../domain/contracts.js';
import { canonicalJson, hashArtifact } from '../domain/hash.js';
import { artifactRefSchema, configSnapshotSchema } from '../domain/schemas.js';

export interface ArtifactStore {
  readonly root: string;
  putArtifact(bytes: Uint8Array, kind?: string): ArtifactRef;
  readArtifact(ref: ArtifactRef): Uint8Array;
}

function digest(kind: string, bytes: Uint8Array): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(kind)) throw new Error('INVALID_ARTIFACT_KIND');
  return createHash('sha256').update(`council:v1:${kind}\n`).update(bytes).digest('hex');
}
function syncDirectory(path: string): void {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function artifactPath(root: string, kind: string, sha256: string): string {
  return join(root, kind, sha256, 'blob');
}

/** Reads only the bound immutable file, never its original source location. */
export function readArtifact(ref: ArtifactRef, root: string): Uint8Array {
  artifactRefSchema.parse(ref);
  const expected = artifactPath(resolve(root), ref.kind, ref.sha256);
  if (ref.path !== expected) throw new Error('ARTIFACT_PATH_MISMATCH');
  if (!existsSync(expected)) throw new Error('ARTIFACT_MISSING');
  if (realpathSync(expected) !== expected) throw new Error('ARTIFACT_PATH_MISMATCH');
  const bytes = readFileSync(expected);
  if (bytes.length !== ref.bytes || digest(ref.kind, bytes) !== ref.sha256) throw new Error('ARTIFACT_CORRUPT');
  return bytes;
}

export function openArtifactStore(root: string): ArtifactStore {
  mkdirSync(root, { recursive: true });
  const canonicalRoot = realpathSync(root);
  return {
    root: canonicalRoot,
    putArtifact(input, kind = 'blob') {
      const bytes = Buffer.from(input), sha256 = digest(kind, bytes);
      const directory = join(canonicalRoot, kind), destination = join(directory, sha256);
      const ref = { kind, sha256, path: artifactPath(canonicalRoot, kind, sha256), bytes: bytes.length };
      const checkExisting = () => {
        try {
          if (!Buffer.from(readArtifact(ref, canonicalRoot)).equals(bytes)) throw new Error('different bytes');
        } catch { throw new Error('ARTIFACT_HASH_CONFLICT'); }
        return ref;
      };
      if (existsSync(destination)) return checkExisting();
      mkdirSync(directory, { recursive: true });
      if (realpathSync(directory) !== directory) throw new Error('ARTIFACT_PATH_MISMATCH');
      const temporary = join(directory, `.tmp-${process.pid}-${randomUUID()}`);
      mkdirSync(temporary);
      const fd = openSync(join(temporary, 'blob'), 'wx', 0o600);
      try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
      syncDirectory(temporary);
      // Rename a nonempty directory: unlike renaming a file, a concurrent existing
      // content directory cannot be overwritten. Incomplete task-owned temps remain
      // as evidence; there is deliberately no automatic orphan collection.
      try { renameSync(temporary, destination); }
      catch (error) {
        if (existsSync(destination)) return checkExisting();
        throw error;
      }
      syncDirectory(directory);
      syncDirectory(canonicalRoot);
      syncDirectory(dirname(canonicalRoot));
      return ref;
    },
    readArtifact(ref) { return readArtifact(ref, canonicalRoot); },
  };
}

/** Both configuration refs are required. Current YAML/defaults never repair a run. */
export function verifyConfiguration(input: ConfigSnapshot, root: string): void {
  const config = configSnapshotSchema.parse(input);
  const raw = readArtifact(config.rawArtifact, root);
  if (createHash('sha256').update(raw).digest('hex') !== config.rawSha256) throw new Error('CONFIG_RAW_HASH_MISMATCH');
  const canonical = readArtifact(config.configArtifact, root);
  if (!Buffer.from(canonical).equals(Buffer.from(canonicalJson(config.resolved)))) throw new Error('CONFIG_CANONICAL_MISMATCH');
  if (config.configHash !== hashArtifact('config', config.resolved as unknown as JsonValue)) throw new Error('CONFIG_HASH_MISMATCH');
}
