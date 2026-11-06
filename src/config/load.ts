import { createHash } from 'node:crypto';
import { constants, realpathSync } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isAlias, isNode, isScalar, parseDocument, visit } from 'yaml';
import type { CouncilConfig, JsonValue } from '../domain/contracts.js';
import { hashArtifact } from '../domain/hash.js';
import { ConfigError, configSchema } from './schema.js';

export interface LoadedCouncilConfig { sourcePath: string; sourceBytes: Uint8Array; rawSha256: string; resolved: CouncilConfig; configHash: string }
export const CONFIG_LIMIT_BYTES = 65536;
export function resolveConfigPath(override: string | undefined, invocationCwd: string, packageRoot: string): string {
  if (override !== undefined) {
    if (!override || override.includes('\0')) throw new ConfigError('CONFIG_INVALID');
    return resolve(invocationCwd, override);
  }
  try { return resolve(realpathSync(packageRoot), 'council.yaml'); }
  catch { throw new ConfigError('CONFIG_NOT_FOUND'); }
}
/** Shared strict YAML syntax; roster compatibility is checked by each entry. */
export function decodeConfigYaml(raw: Uint8Array): unknown {
  try {
    if (raw.byteLength > CONFIG_LIMIT_BYTES) throw new ConfigError('CONFIG_INVALID');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    const doc = parseDocument(text, { version: '1.2', schema: 'core', strict: true, uniqueKeys: true, merge: false, resolveKnownTags: false });
    if (doc.errors.length || doc.warnings.length || doc.directives.yaml.version !== '1.2') throw new ConfigError('CONFIG_INVALID');
    const coreTags = new Set(['str', 'int', 'float', 'bool', 'null', 'map', 'seq'].map(tag => `tag:yaml.org,2002:${tag}`));
    visit(doc, (_, node) => {
      if (isAlias(node) || isNode(node) && (node.anchor || node.tag && !coreTags.has(node.tag)) || isScalar(node) && node.value === '<<') throw new ConfigError('CONFIG_INVALID');
    });
    const value: unknown = doc.toJS({ maxAliasCount: 0 });
    if (typeof value === 'object' && value !== null && 'version' in value && typeof value.version === 'number' && value.version !== 1) throw new ConfigError('CONFIG_VERSION_UNSUPPORTED');
    return value;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError('CONFIG_INVALID');
  }
}
export function parseCouncilConfig(raw: Uint8Array): CouncilConfig {
  try {
    const value = decodeConfigYaml(raw);
    if (typeof value === 'object' && value !== null && 'reviewers' in value && typeof value.reviewers === 'object' && value.reviewers !== null && 'xai' in value.reviewers) throw new ConfigError('CONFIG_NATIVE_ONLY_USE_NATIVE_COMMAND');
    return configSchema.parse(value);
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError('CONFIG_INVALID');
  }
}
export async function loadCouncilConfig(path: string): Promise<LoadedCouncilConfig> {
  let sourcePath: string, sourceBytes: Uint8Array;
  try {
    sourcePath = await realpath(path);
    const file = await open(sourcePath, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new ConfigError('CONFIG_NOT_FOUND');
      if (stat.size > CONFIG_LIMIT_BYTES) throw new ConfigError('CONFIG_INVALID');
      const bytes = Buffer.alloc(CONFIG_LIMIT_BYTES + 1);
      let size = 0;
      while (size < bytes.length) {
        const read = await file.read(bytes, size, bytes.length - size, null);
        if (!read.bytesRead) break;
        size += read.bytesRead;
      }
      if (size > CONFIG_LIMIT_BYTES) throw new ConfigError('CONFIG_INVALID');
      sourceBytes = Uint8Array.from(bytes.subarray(0, size));
    } finally { await file.close(); }
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError('CONFIG_NOT_FOUND');
  }
  const resolved = parseCouncilConfig(sourceBytes);
  return { sourcePath, sourceBytes, rawSha256: createHash('sha256').update(sourceBytes).digest('hex'), resolved, configHash: hashArtifact('council-config', resolved as unknown as JsonValue) };
}
