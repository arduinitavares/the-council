import { closeSync, mkdtempSync, openSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCouncilConfig, parseCouncilConfig, resolveConfigPath } from '../../src/config/load.js';

describe('bounded strict configuration decoding', () => {
  it('selects only an explicit path or real package root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'config-path-'));
    const link = join(root, 'linked'); symlinkSync(process.cwd(), link);
    expect(resolveConfigPath(undefined, '/unrelated/workspace', link)).toBe(join(process.cwd(), 'council.yaml'));
    expect(resolveConfigPath('other.yaml', root, process.cwd())).toBe(join(root, 'other.yaml'));
    await expect(loadCouncilConfig(join(root, 'missing.yaml'))).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' });
    await expect(loadCouncilConfig(root)).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' });
  });
  it('rejects ambiguous, executable, incomplete and oversized YAML before any launch', () => {
    const yaml = readFileSync(new URL('../../council.yaml', import.meta.url), 'utf8');
    for (const raw of [
      `${yaml}\njudge: {route: codex, model: gpt-6.1-sol, effort: max}`,
      yaml.replace('judge:', 'alias: &a {model: x}\ncopy: *a\njudge:'),
      yaml.replace('judge:', '<<: {model: x}\njudge:'),
      yaml.replace('version: 1', 'version: !custom 1'), `${yaml}\n---\nversion: 1`,
      yaml.replace('judge:', 'judeg:'), `%YAML 1.1\n---\n${yaml}`, `%YAML 1.3\n---\n${yaml}`,
      yaml.replace('gpt-6-astra', '" gpt-6-astra"'), yaml.replace('gpt-6-astra', 'astra'),
      yaml.replace('effort: ultra', 'effort: 2'), yaml.replace('version: 1', 'version: !!timestamp 2020-01-01'),
      yaml.replace('judge:', 'unused: &anchor 1\njudge:'), yaml.replace(/judge:[\s\S]*$/, ''),
      ' '.repeat(65537), Buffer.from([0xc3, 0x28]),
    ]) expect(() => parseCouncilConfig(typeof raw === 'string' ? Buffer.from(raw) : raw)).toThrow('CONFIG_INVALID');
    expect(() => parseCouncilConfig(Buffer.from(yaml.replace('version: 1', 'version: 2')))).toThrow('CONFIG_VERSION_UNSUPPORTED');
    expect(() => parseCouncilConfig(Buffer.from(yaml + ' '.repeat(65536 - Buffer.byteLength(yaml))))).not.toThrow();
  });
  it('keeps raw bytes distinct from normalized content', async () => {
    const root = mkdtempSync(join(tmpdir(), 'config-hash-')), path = join(root, 'config.yaml');
    const raw = readFileSync(new URL('../../council.yaml', import.meta.url)); writeFileSync(path, raw);
    const first = await loadCouncilConfig(path); writeFileSync(path, Buffer.concat([raw, Buffer.from('\n# comment\n')]));
    const second = await loadCouncilConfig(path);
    expect(first.rawSha256).not.toBe(second.rawSha256); expect(first.configHash).toBe(second.configHash);
    expect(Buffer.from(first.sourceBytes)).toEqual(raw);
  });
  it('rejects a FIFO without waiting for a writer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'config-fifo-')), path = join(root, 'roster.yaml'); execFileSync('/usr/bin/mkfifo', [path]);
    const loading = loadCouncilConfig(path).then(() => 'accepted', error => error.code as string);
    let timer: ReturnType<typeof setTimeout>;
    const result = await Promise.race([loading, new Promise<string>(resolve => { timer = setTimeout(() => resolve('blocked-on-open'), 500); })]);
    clearTimeout(timer!);
    if (result === 'blocked-on-open') { const writer = openSync(path, 'w'); closeSync(writer); await loading; }
    expect(result).toBe('CONFIG_NOT_FOUND');
  });
});
