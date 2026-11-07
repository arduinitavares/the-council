// Task 2.0 smoke custody only. No Task 2.1 behavioral assertions are implemented.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import dgram from 'node:dgram';
import dns from 'node:dns';
import workerThreads from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = '/Users/aaat/.codex/worktrees/council-first-use/the-council';
const source = join(repo, 'src');
const caseDirectory = join(repo, '.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue5-task2-witness-fixture-20261104');
const scratch = join(caseDirectory, 'scratch');
const entry = fileURLToPath(import.meta.url);
const cliUrl = pathToFileURL(join(source, 'pilot/cli.ts')).href;
const stubUrl = pathToFileURL(join(caseDirectory, 'stubs.mjs')).href;
const savedEnvironment = { ...process.env };
const savedClock = Date.now;
const savedExit = process.exitCode;
const savedLog = console.log;
const originals = Object.fromEntries(['existsSync', 'lstatSync', 'statSync', 'realpathSync', 'readFileSync', 'readdirSync',
  'openSync', 'readSync', 'fstatSync', 'closeSync', 'mkdirSync', 'writeFileSync', 'writeSync', 'renameSync', 'unlinkSync', 'rmdirSync', 'fsyncSync']
  .map(name => [name, fs[name]]));
const restoredProperties = [];
const owned = new Map();
const descriptors = new Map();
const descriptorReceipts = [];
const effects = [];
const cases = [];
const imports = new Set();
const substitutionsSeen = new Set();
const denied = [];
const reads = [];
let activeCase;
let externalCalls = 0, providerCalls = 0, markerReads = 0;
let hooks, stubs, result, problem;
let validatedDarwinEncoding;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (target, root) => target === root || target.startsWith(root + sep);
const short = target => relative(scratch, target);
const identity = stat => ({ dev: String(stat.dev), ino: String(stat.ino), mode: Number(stat.mode) & 0o777 });
const sameObject = (left, right) => left.dev === right.dev && left.ino === right.ino;
function replace(object, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  restoredProperties.push([object, key, descriptor]);
  Object.defineProperty(object, key, { value, enumerable: descriptor?.enumerable ?? false, configurable: true, writable: true });
}
function forbidden(name, provider = false) {
  if (provider) providerCalls++;
  else externalCalls++;
  throw Error('FIXTURE_FORBIDDEN_EXTERNAL_CALL:' + name);
}
function pathOf(value) {
  if (typeof value === 'number') {
    const record = descriptors.get(value); assert(record, 'untracked descriptor'); return record.path;
  }
  return resolve(value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString() : value);
}
function checkPath(value, write = false) {
  const target = pathOf(value);
  if (target.endsWith('/.workspace-trusted')) { markerReads++; throw Error('FIXTURE_TRUST_READ_FORBIDDEN'); }
  if (write) assert(within(target, scratch) && target !== scratch, 'write outside owned scratch');
  else assert([source, join(repo, 'node_modules'), caseDirectory].some(root => within(target, root)) ||
    target === join(repo, 'package.json') || target === entry, 'read outside declared roots');
  return target;
}
function call(name, args) {
  try { return originals[name](...args); }
  catch (error) {
    if (['EACCES', 'EPERM', 'ERR_ACCESS_DENIED'].includes(error?.code)) denied.push({ operation: name, code: error.code, target: String(args[0]) });
    throw error;
  }
}
function remember(target, kind) {
  const stat = originals.lstatSync(target, { bigint: true });
  assert.equal(stat.isSymbolicLink(), false);
  if (owned.has(target)) assert(sameObject(owned.get(target), identity(stat)), 'owned object replaced unexpectedly');
  else owned.set(target, { ...identity(stat), kind });
}
function assertOwned(target) {
  assert(owned.has(target), 'mutation of an undeclared object');
  assert(sameObject(owned.get(target), identity(originals.lstatSync(target, { bigint: true }))), 'owned inode drift');
}
function installControls() {
  for (const name of ['exec', 'execFile', 'spawn', 'fork', 'execSync', 'execFileSync', 'spawnSync'])
    replace(childProcess, name, () => forbidden('child_process.' + name));
  for (const [module, names] of [[net, ['connect', 'createConnection', 'createServer']], [tls, ['connect', 'createServer']],
    [http, ['get', 'request', 'createServer']], [https, ['get', 'request', 'createServer']],
    [http2, ['connect', 'createServer', 'createSecureServer']], [dgram, ['createSocket']]])
    for (const name of names) replace(module, name, () => forbidden('network.' + name));
  replace(net.Socket.prototype, 'connect', () => forbidden('Socket.connect'));
  replace(net.Server.prototype, 'listen', () => forbidden('Server.listen'));
  for (const name of Object.keys(dns).filter(name => name === 'lookup' || name.startsWith('resolve') && typeof dns[name] === 'function'))
    replace(dns, name, () => forbidden('dns.' + name));
  for (const name of Object.keys(dns.promises).filter(name => typeof dns.promises[name] === 'function'))
    replace(dns.promises, name, () => forbidden('dns.promises.' + name));
  replace(globalThis, 'fetch', () => forbidden('fetch'));
  replace(globalThis, 'WebSocket', class { constructor() { forbidden('WebSocket'); } });
  replace(workerThreads, 'Worker', class { constructor() { forbidden('Worker'); } });
  for (const name of ['existsSync', 'lstatSync', 'statSync', 'realpathSync', 'readFileSync', 'readdirSync']) {
    fs[name] = (value, ...args) => {
      const target = checkPath(value);
      const answer = call(name, [value, ...args]);
      if (activeCase && name === 'readFileSync') reads.push({ case: activeCase, operation: name, path: short(target), bytes: Buffer.byteLength(answer) });
      if (activeCase && name === 'realpathSync' && target.endsWith('/synthetic-policy.md')) reads.push({ case: activeCase, operation: 'policy-resolved', path: short(target) });
      return answer;
    };
  }
  fs.realpathSync.native = (...args) => { checkPath(args[0]); return originals.realpathSync.native(...args); };
  fs.openSync = (value, flags, ...args) => {
    const writing = typeof flags === 'number' ? !!(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) : /[wa+]/.test(flags);
    const target = checkPath(value, writing);
    if (writing && originals.existsSync(target)) assertOwned(target);
    const fd = call('openSync', [value, flags, ...args]);
    const stat = identity(originals.fstatSync(fd, { bigint: true }));
    if (writing) remember(target, 'file');
    assert.equal(descriptors.has(fd), false);
    descriptors.set(fd, { path: target, flags, ...stat, readBytes: 0, writtenBytes: 0 });
    return fd;
  };
  fs.fstatSync = (fd, ...args) => { assert(descriptors.has(fd)); return call('fstatSync', [fd, ...args]); };
  fs.readSync = (fd, ...args) => {
    const record = descriptors.get(fd); assert(record);
    const count = call('readSync', [fd, ...args]); record.readBytes += count; return count;
  };
  fs.writeSync = (fd, ...args) => {
    const record = descriptors.get(fd); assert(record); checkPath(fd, true);
    const count = call('writeSync', [fd, ...args]); record.writtenBytes += count; return count;
  };
  fs.closeSync = fd => {
    const record = descriptors.get(fd); assert(record, 'close of untracked descriptor');
    assert(sameObject(record, identity(originals.fstatSync(fd, { bigint: true }))));
    call('closeSync', [fd]);
    assert.throws(() => originals.fstatSync(fd), error => error.code === 'EBADF');
    descriptorReceipts.push({ path: short(record.path), dev: record.dev, ino: record.ino, mode: record.mode,
      readBytes: record.readBytes, writtenBytes: record.writtenBytes, closed: true, postClose: 'EBADF' });
    descriptors.delete(fd);
  };
  fs.fsyncSync = fd => { assert(descriptors.has(fd)); return call('fsyncSync', [fd]); };
  fs.mkdirSync = (value, ...args) => {
    const target = checkPath(value, true); assert.equal(args[0]?.recursive, undefined);
    const answer = call('mkdirSync', [value, ...args]); remember(target, 'directory'); return answer;
  };
  fs.writeFileSync = (value, bytes, ...args) => {
    const target = checkPath(value, true);
    if (originals.existsSync(target)) assertOwned(target);
    const answer = call('writeFileSync', [value, bytes, ...args]); remember(target, 'file');
    if (typeof value === 'number') descriptors.get(value).writtenBytes += Buffer.byteLength(bytes);
    effects.push({ operation: 'writeFileSync', path: short(target), descriptor: typeof value === 'number', bytes: Buffer.byteLength(bytes), sha256: digest(bytes) });
    return answer;
  };
  fs.renameSync = (from, to) => {
    const sourcePath = checkPath(from, true), target = checkPath(to, true); assertOwned(sourcePath);
    if (originals.existsSync(target)) assertOwned(target);
    const answer = call('renameSync', [from, to]); owned.delete(sourcePath); owned.delete(target); remember(target, 'file');
    effects.push({ operation: 'rename', from: short(sourcePath), to: short(target) }); return answer;
  };
  fs.unlinkSync = value => {
    const target = checkPath(value, true); assertOwned(target);
    const answer = call('unlinkSync', [value]); owned.delete(target); effects.push({ operation: 'unlink', path: short(target) }); return answer;
  };
  // Async I/O is not used by this synchronous storage/CLI boundary. Refuse any
  // newly introduced async open rather than silently lose descriptor custody.
  replace(fs, 'open', () => forbidden('untracked fs.open'));
  replace(fs.promises, 'open', () => forbidden('untracked fs.promises.open'));
  syncBuiltinESMExports();
}
function cleanup() {
  assert.equal(descriptors.size, 0, 'owned descriptor still open');
  const found = [];
  const walk = directory => {
    for (const name of originals.readdirSync(directory)) {
      const target = join(directory, name); assertOwned(target); found.push(target);
      const stat = originals.lstatSync(target); assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) walk(target);
      else assert(stat.isFile(), 'unexpected object preserved');
    }
  };
  walk(scratch); assert.equal(found.length, owned.size);
  const deleted = [];
  for (const target of found.sort((left, right) => right.length - left.length)) {
    assertOwned(target);
    const record = owned.get(target);
    if (record.kind === 'directory') originals.rmdirSync(target);
    else originals.unlinkSync(target);
    deleted.push(short(target)); owned.delete(target);
  }
  assert.deepEqual(originals.readdirSync(scratch), []);
  return deleted;
}
const config = {
  version: 1,
  reviewers: {
    openai: { route: 'codex', model: 'gpt-6.1-sol', effort: 'max' },
    gemini: { route: 'antigravity', model: 'gemini-4-argon-high', effort: 'high' },
    xai: { route: 'cursor', model: 'grok-4.7-xhigh', effort: 'xhigh', effortEncoding: 'model' },
  },
  judge: { route: 'codex', model: 'gpt-6.1-sol', effort: 'max' },
};
const yaml = 'version: 1\nreviewers:\n  openai:\n    route: codex\n    model: gpt-6.1-sol\n    effort: max\n  gemini:\n    route: antigravity\n    model: gemini-4-argon-high\n    effort: high\n  xai:\n    route: cursor\n    model: grok-4.7-xhigh\n    effort: xhigh\n    effortEncoding: model\njudge:\n  route: codex\n  model: gpt-6.1-sol\n  effort: max\n';
function setup(name) {
  const root = join(scratch, name), workspace = join(root, 'workspace');
  fs.mkdirSync(root, { mode: 0o700 }); fs.mkdirSync(workspace, { mode: 0o700 });
  const configFile = join(workspace, 'roster.yaml'), inputFile = join(workspace, 'request.json'), policyFile = join(workspace, 'synthetic-policy.md');
  const input = { runId: name, candidate: 'Synthetic bounded candidate.', suppliedText: 'Synthetic supplied packet.',
    maxProbeCalls: 0, maxTopicCalls: 10, deadline: 5000, workerTimeoutMs: 1000, proofTtlMs: 4000 };
  for (const [target, bytes] of [[configFile, yaml], [inputFile, JSON.stringify(input)], [policyFile, 'Synthetic fixture policy; no production authority.\n']])
    fs.writeFileSync(target, bytes, { mode: 0o600, flag: 'wx' });
  return { name, workspace, configFile, inputFile, policyFile, config: structuredClone(config), input,
    nativeArgv: ['--workspace', workspace, '--config', configFile, '--input', inputFile, '--policy', policyFile, '--orca', join(workspace, 'never-executed-orca')],
    auditArgv: ['audit', 'prepare', '--workspace', workspace, '--config', configFile, '--role', 'xai'],
    forbidden: name => forbidden(name, true) };
}
async function runCase(name, test) {
  assert.deepEqual(originals.readdirSync(scratch), []);
  const beforeClock = Date.now, beforeExit = process.exitCode, beforeLog = console.log;
  const logs = [], descriptorStart = descriptorReceipts.length, effectStart = effects.length, readStart = reads.length;
  let context;
  try {
    context = setup(name); activeCase = name; Date.now = () => 2000; process.exitCode = undefined;
    console.log = (...args) => { assert.equal(args.length, 1); assert.equal(typeof args[0], 'string'); assert(Buffer.byteLength(args[0]) <= 8192); logs.push(args[0]); };
    await test(context, logs);
    assert.equal(descriptors.size, 0); assert.equal(Date.now(), 2000);
  } finally {
    stubs?.disarm(); activeCase = undefined; Date.now = beforeClock; process.exitCode = beforeExit; console.log = beforeLog;
  }
  const deleted = cleanup();
  cases.push({ name, descriptors: descriptorReceipts.slice(descriptorStart),
    inputSha256: { yaml: digest(yaml), request: digest(JSON.stringify(context.input)), policy: digest('Synthetic fixture policy; no production authority.\n') },
    reads: reads.slice(readStart), effects: effects.slice(effectStart), cleanup: deleted,
    stdoutCaptured: logs.length, cliExitRestored: process.exitCode === beforeExit, clockRestored: Date.now === beforeClock, scratchEmpty: true });
}

try {
  assert.equal(process.cwd(), repo);
  assert.equal(process.versions.node, '22.23.4'); assert.equal(entry, join(repo, 'test/pilot/cursor-trust-witness.source.mjs'));
  if (process.platform === 'darwin' && Object.hasOwn(process.env, '__CF_USER_TEXT_ENCODING')) {
    const encoding = process.env.__CF_USER_TEXT_ENCODING;
    const match = encoding.match(/^0x([0-9A-Fa-f]+):0x0:0x0$/);
    assert(match && match[0] === encoding, 'invalid Darwin startup encoding');
    assert.equal(BigInt('0x' + match[1]), BigInt(process.getuid()), 'Darwin startup encoding uid mismatch');
    validatedDarwinEncoding = encoding;
    delete process.env.__CF_USER_TEXT_ENCODING;
  }
  assert.deepEqual(Object.keys(process.env).sort(), ['COUNCIL_TEST_PHASE', 'COUNCIL_TEST_SCRATCH', 'HOME', 'LANG', 'PATH']);
  assert.equal(process.env.COUNCIL_TEST_SCRATCH, scratch); assert.equal(process.env.HOME, join(scratch, 'home'));
  assert.equal(process.env.PATH, '/usr/bin:/bin'); assert.equal(process.env.LANG, 'en_US.UTF-8');
  assert.equal(process.env.COUNCIL_TEST_PHASE, 'smoke', 'Task 2.1 is outside this fixture assignment');
  for (const scope of ['child', 'worker', 'addons', 'wasi']) assert.equal(process.permission.has(scope), false);
  assert.equal(process.permission.has('fs.read', '/Users/aaat/.agents/policies/model-policy.md'), false);
  assert.equal(process.permission.has('fs.read', join(repo, 'skills/the-council/references/first-use-roster.yaml')), false);
  assert.deepEqual(originals.readdirSync(scratch), []);
  const text = originals.readFileSync(entry, 'utf8');
  assert.equal(/(?:from\s*|import\s*\()\s*['"][^'"]*(?:\/dist\/|vitest|node:test)/.test(text), false);
  assert.equal(/\b(?:spawnSync|execFileSync|execFile|spawn|execSync|exec)\s*\(/.test(text), false);
  assert.equal(/\b(?:npm|npx)\s+|\bwhich\s*\(|\bfindExecutable\s*\(/.test(text), false);
  installControls();
  const stubModules = new Set(['../orca/client.js', './native-command.js', './discovery.js', './rpc.js', './composition.js', './workflow.js', './provider-read.js', './provider-controls.js']);
  hooks = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL === cliUrl && stubModules.has(specifier)) {
        substitutionsSeen.add(specifier); return next(stubUrl, context);
      }
      if (context.parentURL?.startsWith(pathToFileURL(source + sep).href) && specifier.startsWith('.') && specifier.endsWith('.js')) {
        const target = fileURLToPath(new URL(specifier.slice(0, -3) + '.ts', context.parentURL));
        assert(within(target, source)); return next(pathToFileURL(target).href, context);
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.startsWith('file:')) {
        const target = fileURLToPath(url);
        if (within(target, repo) && !within(target, join(repo, 'node_modules'))) {
          assert(within(target, source) || target === entry || target === fileURLToPath(stubUrl), 'undeclared non-source import');
          if (within(target, source)) { assert(target.endsWith('.ts')); imports.add(relative(repo, target)); }
        }
      }
      return next(url, context);
    },
  });
  const module = name => import(pathToFileURL(join(source, name)).href);
  const { canonicalJson } = await module('domain/hash.ts');
  const wrapper = await module('pilot/wrapper-contract.ts');
  const audit = await module('pilot/control-audit.ts');
  const { QualificationCache, proofSchema } = await module('pilot/qualification-cache.ts');
  const { classify, proofKey } = await module('pilot/preflight.ts');
  const workflow = await module('pilot/workflow.ts');
  const providerControls = await module('pilot/provider-controls.ts');
  const originalConfig = await module('pilot/config.ts');
  const { runNativeCli } = await module('pilot/cli.ts');
  stubs = await import(stubUrl);
  assert.notEqual(workflow.runPilot, stubs.runPilot);
  assert.notEqual(providerControls.prepareProviderAudit, stubs.prepareProviderAudit);
  assert.notEqual(providerControls.adoptProviderAudit, stubs.adoptProviderAudit);
  assert.deepEqual([...substitutionsSeen].sort(), [...stubModules].sort());
  const snapshot = workspace => ({ version: 1, workspace, route: 'cursor', providerVersion: '2026.10.22-27dcf5f',
    contract: 'synthetic-unqualified', executable: join(workspace, 'never-executed-provider'), sources: [], ordering: [],
    effects: ['synthetic effect'], unavailable: ['synthetic unavailable'], recipeHash: wrapper.sha256('synthetic recipe') });
  const proofFor = workspace => {
    const observation = { state: 'verified', source: 'synthetic', detail: 'fixture only' };
    const fact = wrapper.controlFactSchema.parse({ name: 'synthetic-control', stage: 'bootstrap', observation, enforcement: 'synthetic only', observedAt: 2000, digest: wrapper.sha256('synthetic fact') });
    assert.equal(wrapper.factsObservation([fact], 'bootstrap').state, 'verified');
    const selection = config.reviewers.openai;
    const recipe = wrapper.recipeSchema.parse({ protocol: 'codex-app-server', executable: join(workspace, 'never-executed-provider'), argv: [], cwd: workspace,
      version: 'synthetic-v1', selection, expectedPermission: 'synthetic', sources: [], facts: [fact] });
    const scope = { host: 'synthetic-host', runtimeId: 'synthetic-runtime', orcaVersion: 'synthetic-orca-v1', versions: { orca: 'synthetic-orca-v1' },
      roots: [workspace], workspace, workspaceId: 'synthetic-workspace', action: 'supplied-packet-read-only', policyHash: wrapper.sha256('synthetic policy'),
      controlsHash: wrapper.sha256('synthetic controls'), routes: [{ role: 'openai', selection, version: 'synthetic-v1', catalog: observation,
        controls: observation, allowance: observation, billing: observation, optionalTelemetry: observation, recipe }] };
    const key = proofKey(scope, scope.routes[0]);
    return proofSchema.parse({ schemaVersion: 1, id: key, key, scope, issuedAt: 1000, expiresAt: 5000,
      normal: { dispatchId: 'synthetic-normal', outcome: 'completed', settled: true }, cancellation: { dispatchId: 'synthetic-cancel', outcome: 'cancelled', settled: true }, settled: true });
  };
  await runCase('cache-storage', async context => {
    const cache = new QualificationCache(context.workspace);
    try {
      assert.deepEqual(cache.read(), []);
      const proof = proofFor(context.workspace); cache.write([proof]);
      assert.deepEqual(cache.read(), [proof]);
      let callbacks = 0;
      assert.deepEqual(await cache.matching(proof.scope, 2000, async value => { callbacks++; assert.deepEqual(value, proof); return true; }), [proof]);
      assert.equal(callbacks, 1);
      assert.equal(originals.lstatSync(join(context.workspace, '.council/native-qualifications/receipts.json')).mode & 0o777, 0o600);
    } finally { cache.close(); }
    assert.equal(originals.existsSync(join(context.workspace, '.council/native-qualifications/writer.lock')), false);
  });
  await runCase('audit-storage', async context => {
    const value = audit.auditSnapshotSchema.parse(snapshot(context.workspace));
    const saved = audit.saveAuditSnapshot(value);
    assert.deepEqual(JSON.parse(fs.readFileSync(saved.path, 'utf8')), value);
    assert.equal(saved.hash, audit.auditHash(value));
    assert.equal(originals.lstatSync(saved.path).mode & 0o777, 0o600);
  });
  await runCase('native-cli', async (context, logs) => {
    const proof = proofFor(context.workspace);
    context.outcome = { version: 2, status: 'prerequisites_not_verified', calls: { probes: 0, topic: 0 }, initializations: 0,
      initializationsUnknown: false, pendingMutations: [], evidence: proof.scope, blockers: [], proofs: [proof], results: [], unresolved: [] };
    const request = { workspace: context.workspace, config: context.config, policyPath: context.policyFile, ...context.input, proofs: [] };
    assert(classify(request, proof.scope, 'bootstrap').some(blocker => blocker.reason === 'EXACT_SELECTION_MISSING'));
    stubs.arm(context); await runNativeCli(context.nativeArgv); stubs.disarm();
    assert.equal(process.exitCode, 3); assert.equal(logs.length, 1);
    const output = JSON.parse(logs[0]);
    const record = join(context.workspace, '.council/native/native-cli/outcome.json');
    assert.equal(output.record, record); assert.equal(output.status, 'prerequisites_not_verified');
    const { record: _record, ...serialized } = output;
    assert.deepEqual(serialized, context.outcome);
    assert.equal(fs.readFileSync(record, 'utf8'), canonicalJson(context.outcome) + '\n');
    assert.equal(originals.lstatSync(record).mode & 0o777, 0o600);
    const journal = fs.readFileSync(join(dirname(record), 'events.jsonl'), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(journal.map(value => value.event.event), ['bounds-recorded-before-inference', 'outcome-recorded']);
    assert(journal.every(value => value.at === 2000));
    assert.equal(journal[0].event.bounds.configHash, originalConfig.freezeConfig(context.config).hash);
    assert.deepEqual(JSON.parse(fs.readFileSync(join(context.workspace, '.council/native-qualifications/receipts.json'), 'utf8')).proofs, [proof]);
    assert(reads.some(read => read.path === short(context.inputFile)));
    assert(reads.some(read => read.operation === 'policy-resolved' && read.path === short(context.policyFile)));
    assert(descriptorReceipts.some(read => read.path === short(context.configFile) && read.readBytes === Buffer.byteLength(yaml) && read.postClose === 'EBADF'));
    assert.equal(originals.existsSync(join(context.workspace, 'never-executed-orca')), false);
  });
  await runCase('audit-cli', async (context, logs) => {
    context.snapshot = snapshot(context.workspace);
    stubs.arm(context); await runNativeCli(context.auditArgv); stubs.disarm();
    assert.equal(process.exitCode, undefined); assert.equal(logs.length, 1);
    const output = JSON.parse(logs[0]);
    assert.equal(output.status, 'audit_prepared'); assert.equal(output.providerQualification, 'separate-required');
    assert.deepEqual(JSON.parse(fs.readFileSync(output.path, 'utf8')), context.snapshot);
    assert.equal(output.hash, audit.auditHash(context.snapshot));
    assert.equal(originals.lstatSync(output.path).mode & 0o777, 0o600);
    assert(descriptorReceipts.some(read => read.path === short(context.configFile) && read.readBytes === Buffer.byteLength(yaml) && read.postClose === 'EBADF'));
  });
  assert.deepEqual(stubs.counters, { 'OrcaClient.connect': 1, commandFromClient: 1, NativeHostInspector: 1, LocalReadRpc: 0,
    LocalScopedRpc: 0, createNativePilotDriver: 1, runPilot: 1, readProvider: 1, prepareProviderAudit: 1, adoptProviderAudit: 0 });
  assert.equal(providerCalls, 0); assert.equal(externalCalls, 0); assert.equal(markerReads, 0); assert.deepEqual(denied, []);
  result = { status: 'smoke-qualified', phase: 'smoke', node: process.versions.node, sourceOnly: true,
    childPermission: process.permission.has('child'), workerPermission: process.permission.has('worker'),
    addonPermission: process.permission.has('addons'), wasiPermission: process.permission.has('wasi'),
    providerCalls, externalCalls, markerReads, imports: [...imports].sort(),
    substitutions: stubs.substitutions, stubCounters: stubs.counters, stubEffects: stubs.effects, cases,
    descriptorsClosed: descriptors.size === 0, scratchEmpty: originals.readdirSync(scratch).length === 0,
    descriptorScope: 'explicit synchronous Council/fixture opens; OS closure checked with EBADF',
    cleanupCustody: 'every enumerated inode checked before individual unlink/rmdir; unknown objects preserved',
    task21Implemented: false, denied };
} catch (error) {
  problem = error;
} finally {
  try {
    stubs?.disarm();
    assert.equal(descriptors.size, 0);
    if (owned.size) cleanup();
    assert.deepEqual(originals.readdirSync(scratch), []);
  } catch (error) { problem ??= error; }
  hooks?.deregister();
  Object.assign(fs, originals);
  for (const [object, key, descriptor] of restoredProperties.reverse()) {
    if (descriptor) Object.defineProperty(object, key, descriptor); else delete object[key];
  }
  syncBuiltinESMExports();
  Date.now = savedClock; process.exitCode = savedExit; console.log = savedLog;
  if (validatedDarwinEncoding !== undefined) process.env.__CF_USER_TEXT_ENCODING = validatedDarwinEncoding;
  try {
    assert.deepEqual({ ...process.env }, savedEnvironment);
    for (const [name, original] of Object.entries(originals)) assert.equal(fs[name], original);
    for (const [object, key, descriptor] of restoredProperties) assert.deepEqual(Object.getOwnPropertyDescriptor(object, key), descriptor);
    assert.equal(Date.now, savedClock); assert.equal(process.exitCode, savedExit); assert.equal(console.log, savedLog);
    assert.equal(stubs?.isDisarmed() ?? true, true);
    if (result) result.restored = true;
  } catch (error) { problem ??= error; }
}
if (problem) {
  result = { status: 'fixture-failed', phase: process.env.COUNCIL_TEST_PHASE, node: process.versions.node,
    failure: { name: problem.name, code: problem.code ?? null, message: String(problem.message).slice(0, 1500), stack: String(problem.stack).slice(0, 2000) },
    providerCalls, externalCalls, markerReads, denied, openDescriptors: [...descriptors.values()],
    remainingOwned: [...owned.keys()].map(short), scratchEmpty: originals.readdirSync(scratch).length === 0 };
  process.exitCode = 1;
}
const receipt = JSON.stringify(result) + '\n';
assert(Buffer.byteLength(receipt) <= 16384, 'fixture receipt exceeds stdout bound');
process.stdout.write(receipt);
