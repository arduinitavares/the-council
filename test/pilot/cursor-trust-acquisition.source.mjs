import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = process.cwd();
const source = join(repo, 'src');
const scratch = process.env.COUNCIL_TEST_SCRATCH;
assert.equal(scratch, join(repo, '.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue5-direct-source-fixture-20261103/scratch'));
assert.equal(process.permission.has('child'), false);
assert.equal(process.permission.has('worker'), false);
assert.deepEqual(fs.readdirSync(scratch), []);
const environment = { ...process.env };
const loaded = new Set();
const originals = {};
const owned = [];
const descriptors = new Map();
const directories = new Set();
const passed = [];
const caseReceipts = [];
let currentReceipt;
const sentinel = 'PRIVATE_TRUST_SENTINEL';
const key = value => value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const digest = value => createHash('sha256').update(value).digest('hex');
let faults = {}, metrics, active = false, projection = false, markerTouches = 0;
const actual = target => {
  if (target === '/') return scratch;
  assert(target === '/synthetic' || target.startsWith('/synthetic/'), 'undeclared synthetic filesystem target');
  const suffix = relative('/synthetic', target);
  assert(!suffix.startsWith('..'));
  return join(scratch, 'model', suffix);
};
const virtual = target => {
  if (target === originals.realpathSync(scratch)) return '/';
  const root = originals.realpathSync(join(scratch, 'model'));
  assert(target === root || target.startsWith(root + sep), 'synthetic root escaped');
  return join('/synthetic', relative(root, target));
};
const isVirtual = target => typeof target === 'string' && (target === '/' || target === '/synthetic' || target.startsWith('/synthetic/'));
const failure = code => Object.assign(new Error(sentinel), { code });
const statWith = (stat, values) => new Proxy(stat, { get: (object, name) => name in values ? values[name] : Reflect.get(object, name) });
const freshMetrics = () => ({ calls: [], forbidden: [], opens: [], reads: 0, bytes: 0, allocations: [], dirReads: 0, dirCloses: 0, closes: 0, stats: new Map() });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(pathToFileURL(source + sep).href) &&
        specifier.startsWith('.') && specifier.endsWith('.js')) {
      const target = fileURLToPath(new URL(specifier.slice(0, -3) + '.ts', context.parentURL));
      assert(target.startsWith(source + sep));
      loaded.add(target);
      return next(pathToFileURL(target).href, context);
    }
    const result = next(specifier, context);
    if (result.url.startsWith(pathToFileURL(repo + sep).href) && !result.url.includes('/node_modules/')) {
      assert(result.url.startsWith(pathToFileURL(source + sep).href));
      loaded.add(fileURLToPath(result.url));
    }
    return result;
  },
});
for (const name of ['existsSync', 'lstatSync', 'statSync', 'realpathSync', 'readFileSync', 'openSync', 'fstatSync', 'readSync', 'closeSync', 'opendirSync', 'readdirSync', 'mkdirSync', 'writeFileSync', 'unlinkSync', 'rmdirSync', 'chmodSync', 'linkSync', 'symlinkSync']) {
  originals[name] = fs[name];
}
for (const name of ['existsSync', 'lstatSync', 'statSync', 'realpathSync', 'readFileSync', 'readdirSync']) {
  fs[name] = (target, ...args) => {
    if (projection && typeof target === 'string' && target.endsWith('/.workspace-trusted')) markerTouches++;
    if (target === '/Library/Application Support/Cursor/hooks.json') target = join(scratch, 'inert-no-system-hook.json');
    if (!isVirtual(target)) {
      if (active) { metrics.forbidden.push([name, String(target)]); throw failure('UNDECLARED_FIXTURE_TARGET'); }
      return originals[name](target, ...args);
    }
    assert(active, 'synthetic call outside acquisition');
    metrics.calls.push([name, target]);
    if (faults.error?.(name, target)) throw failure(faults.error(name, target));
    assert.notEqual(name, 'readFileSync', 'marker content must use its descriptor');
    assert.notEqual(name, 'readdirSync', 'ancestor selection must stream directory entries');
    if (name === 'lstatSync' || name === 'statSync') assert.equal(args[0]?.bigint, true);
    const injected = name === 'lstatSync' || name === 'statSync' ? faults.beforeStat?.(name, target) : undefined;
    const value = injected ?? originals[name](actual(target), ...args);
    if (name === 'realpathSync') return faults.realpath?.(target) ?? virtual(value);
    if (name === 'lstatSync' || name === 'statSync') {
      const count = (metrics.stats.get(target) ?? 0) + 1;
      metrics.stats.set(target, count);
      return faults.stat?.(name, target, value, count) ?? value;
    }
    return value;
  };
}
fs.realpathSync.native = fs.realpathSync;
fs.openSync = (target, flags, ...args) => {
  if (projection && typeof target === 'string' && target.endsWith('/.workspace-trusted')) markerTouches++;
  if (!isVirtual(target)) {
    if (active) { metrics.forbidden.push(['openSync', String(target)]); throw failure('UNDECLARED_FIXTURE_TARGET'); }
    return originals.openSync(target, flags, ...args);
  }
  assert(active);
  metrics.calls.push(['openSync', target]);
  assert.equal(flags & fs.constants.O_NONBLOCK, fs.constants.O_NONBLOCK);
  assert.equal(flags & fs.constants.O_NOFOLLOW, fs.constants.O_NOFOLLOW);
  assert.equal(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC), 0);
  if (faults.error?.('openSync', target)) throw failure(faults.error('openSync', target));
  const fd = originals.openSync(actual(target), flags, ...args);
  descriptors.set(fd, { target, stats: 0 });
  metrics.opens.push(target);
  return fd;
};
fs.fstatSync = (fd, options) => {
  if (!active && !descriptors.has(fd)) return originals.fstatSync(fd, options);
  assert(active && descriptors.has(fd), 'unknown fixture descriptor');
  assert.equal(options?.bigint, true);
  const record = descriptors.get(fd);
  record.stats++;
  if (faults.error?.('fstatSync', record.target)) throw failure(faults.error('fstatSync', record.target));
  const value = originals.fstatSync(fd, options);
  return faults.stat?.('fstatSync', record.target, value, record.stats) ?? value;
};
fs.readSync = (fd, buffer, offset, length, position) => {
  if (!active && !descriptors.has(fd)) return originals.readSync(fd, buffer, offset, length, position);
  const record = descriptors.get(fd);
  assert(active && record?.stats > 0, 'read before descriptor inspection');
  assert.equal(buffer.length, 16385);
  assert(length > 0 && length <= 16385 - metrics.bytes);
  assert.equal(offset, metrics.bytes);
  if (faults.error?.('readSync', record.target)) throw failure(faults.error('readSync', record.target));
  metrics.reads++;
  const bytes = faults.earlyEof ? 0 : originals.readSync(fd, buffer, offset, Math.min(length, faults.shortRead ?? length), position);
  metrics.bytes += bytes;
  assert(metrics.bytes <= 16385);
  return bytes;
};
fs.closeSync = fd => {
  if (!active && !descriptors.has(fd)) return originals.closeSync(fd);
  assert(descriptors.has(fd), 'closing unknown descriptor');
  originals.closeSync(fd);
  descriptors.delete(fd);
  metrics.closes++;
};
fs.opendirSync = target => {
  assert(active && isVirtual(target));
  metrics.calls.push(['opendirSync', target]);
  if (faults.error?.('opendirSync', target)) throw failure(faults.error('opendirSync', target));
  const dir = originals.opendirSync(actual(target));
  directories.add(dir);
  const read = dir.readSync.bind(dir), close = dir.closeSync.bind(dir);
  let index = 0;
  return {
    readSync() {
      metrics.dirReads++;
      if (faults.error?.('dir.readSync', target)) throw failure(faults.error('dir.readSync', target));
      return faults.entries ? faults.entries(index++) : read();
    },
    closeSync() { close(); directories.delete(dir); metrics.dirCloses++; },
  };
};
const bufferOriginals = { alloc: Buffer.alloc, allocUnsafe: Buffer.allocUnsafe };
for (const name of Object.keys(bufferOriginals)) Buffer[name] = (...args) => {
  if (active) metrics.allocations.push(args[0]);
  return bufferOriginals[name](...args);
};
syncBuiltinESMExports();
const mkdir = target => {
  const destination = actual(target);
  if (originals.existsSync(destination)) return;
  if (target !== '/synthetic') mkdir(dirname(target));
  originals.mkdirSync(destination, { mode: 0o700 });
  owned.push([destination, 'directory']);
};
const put = (target, body) => {
  mkdir(dirname(target));
  const destination = actual(target);
  if (!originals.existsSync(destination)) owned.push([destination, 'file']);
  originals.writeFileSync(destination, body, { mode: 0o600 });
  return target;
};
const cleanup = () => {
  assert.equal(descriptors.size, 0);
  assert.equal(directories.size, 0);
  for (const [destination, kind] of owned.reverse()) {
    // Only remove individually declared fixture objects; preserve unexpected contents.
    if (kind === 'directory') originals.rmdirSync(destination);
    else originals.unlinkSync(destination);
  }
  owned.length = 0;
  assert.deepEqual(originals.readdirSync(scratch), []);
};
const setup = () => {
  cleanup(); faults = {};
  const context = { workspace: '/synthetic/work/team/project', packetCwd: '/synthetic/work/team/project/.council/native-packets', home: '/synthetic/home', dataRoot: '/synthetic/data' };
  for (const target of [context.packetCwd, context.home, join(context.dataRoot, 'projects')]) mkdir(target);
  return context;
};
const marker = (context, candidate = context.packetCwd) => join(context.dataRoot?.trim() ? context.dataRoot : join(context.home, '.cursor'), 'projects', key(candidate), '.workspace-trusted');
const body = (workspacePath, extra = {}) => JSON.stringify({ workspacePath, trustedAt: '2026-11-03T00:00:00.000Z', ...extra });
const snapshot = () => owned.map(([destination, kind]) => {
  const stat = originals.lstatSync(destination, { bigint: true });
  return [destination, ...['dev', 'ino', 'uid', 'gid', 'mode', 'size', 'mtimeNs', 'ctimeNs'].map(field => stat[field].toString()),
    kind === 'file' && stat.isFile() ? digest(originals.readFileSync(destination)) : null];
});
let acquire;
const check = context => {
  const before = snapshot();
  metrics = freshMetrics(); active = true;
  let value;
  try { value = acquire(context); }
  finally { active = false; }
  assert.deepEqual(snapshot(), before, 'acquisition changed fixture objects');
  assert.equal(descriptors.size, 0, 'descriptor leaked');
  assert.equal(directories.size, 0, 'directory handle leaked');
  assert(metrics.allocations.length <= 1);
  assert(metrics.allocations.every(size => size <= 16385));
  assert(metrics.bytes <= 16385);
  assert(metrics.dirReads <= 4097);
  assert.deepEqual(metrics.forbidden, [], 'acquisition probed a foreign path');
  assert(!JSON.stringify(value).includes(sentinel), 'private payload escaped');
  assert(!JSON.stringify(value).includes('2026-11-03T00:00:00.000Z'), 'stored timestamp escaped');
  assert(value.reason === null || ['CURSOR_TRUST_ABSENT', 'CURSOR_TRUST_UNREADABLE', 'CURSOR_TRUST_NOT_REGULAR', 'CURSOR_TRUST_TOO_LARGE', 'CURSOR_TRUST_MALFORMED', 'CURSOR_TRUST_CONTRACT_UNSUPPORTED', 'CURSOR_TRUST_PATH_MISMATCH', 'CURSOR_TRUST_PATH_UNVERIFIED', 'CURSOR_TRUST_SOURCE_DRIFT'].includes(value.reason));
  for (const observation of [value.nativeAdmission, value.exactIdentity]) assert(observation.detail.length < 512);
  currentReceipt.acquisitions++;
  currentReceipt.descriptorOpens += metrics.opens.length;
  currentReceipt.descriptorCloses += metrics.closes;
  currentReceipt.directoryCloses += metrics.dirCloses;
  currentReceipt.maxBytesRead = Math.max(currentReceipt.maxBytesRead, metrics.bytes);
  currentReceipt.maxAllocation = Math.max(currentReceipt.maxAllocation, ...metrics.allocations);
  currentReceipt.maxDirectoryReads = Math.max(currentReceipt.maxDirectoryReads, metrics.dirReads);
  return value;
};
const expect = (value, native, exact, reason) => {
  assert.equal(value.nativeAdmission.state, native);
  assert.equal(value.exactIdentity.state, exact);
  if (reason !== undefined) assert.equal(value.reason, reason);
  if (exact !== 'verified') assert.equal(value.evidence, null);
};
const run = async (name, test) => {
  currentReceipt = { name, acquisitions: 0, descriptorOpens: 0, descriptorCloses: 0, directoryCloses: 0, maxBytesRead: 0, maxAllocation: 0, maxDirectoryReads: 0 };
  await test(); cleanup(); passed.push(name);
  caseReceipts.push({ ...currentReceipt, scratchEmpty: true, objectsUnchanged: true, foreignProbes: 0, descriptorsClosed: true });
};
let result;
try {
  const module = await import(pathToFileURL(join(source, 'pilot/provider-controls.ts')).href);
  assert.equal(typeof module.inspectProviderControls, 'function');
  assert(loaded.size > 0);
  if (process.env.COUNCIL_TEST_PHASE !== 'smoke') {
    assert.equal(process.env.COUNCIL_TEST_PHASE, 'green');
    ({ acquireCursorTrust: acquire } = await import(pathToFileURL(join(source, 'pilot/cursor-trust.ts')).href));
    // Each case catches an acceptance branch that must fail if comparison, custody,
    // bounds, winner precedence, refusal classification or privacy is removed.
    await run('direct-exact', () => {
      const c = setup(), text = body(c.packetCwd, { trustMethod: 'cli-flag' });
      const leaf = put(marker(c), text);
      faults.stat = (method, target, stat) => target === leaf ? statWith(stat, { ino: 9007199254740993123n }) : stat;
      const value = check(c);
      expect(value, 'verified', 'verified', null);
      assert.equal(value.evidence.candidateOrdinal, 0);
      assert.equal(value.evidence.relation, 'direct');
      assert.deepEqual(value.evidence.earlierAbsences, []);
      assert.equal(value.evidence.contentSha256, digest(text));
      assert.equal(value.evidence.byteCount, Buffer.byteLength(text));
      assert.equal(value.evidence.marker.ino, '9007199254740993123');
      assert.match(value.evidence.contextSha256, /^[a-f0-9]{64}$/);
      for (const directory of value.evidence.directories) {
        assert.deepEqual(Object.keys(directory).sort(), ['dev', 'gid', 'ino', 'mode', 'ordinal', 'uid']);
        for (const field of ['dev', 'ino', 'uid', 'gid', 'mode']) assert.match(directory[field], /^\d+$/);
      }
      for (const field of ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']) assert.match(value.evidence.marker[field], /^\d+$/);
      assert.equal(metrics.closes, 1);
    });
    await run('interactive-shape', () => { const c = setup(); put(marker(c), body(c.packetCwd)); expect(check(c), 'verified', 'verified'); });
    await run('inherited-target', () => {
      const c = setup(); put(marker(c), body(c.packetCwd, { trustMethod: 'inherited', sourceWorkspacePath: '/' + sentinel }));
      expect(check(c), 'verified', 'verified');
      assert(!metrics.calls.some(([, target]) => target.includes(sentinel)));
    });
    await run('colliding-paths-both-directions', () => {
      const c = setup();
      const a = { ...c, workspace: '/synthetic/work/team/project-a', packetCwd: '/synthetic/work/team/project-a/.council/native-packets' };
      const b = { ...c, workspace: '/synthetic/work/team/project/a', packetCwd: '/synthetic/work/team/project/a/.council/native-packets' };
      mkdir(a.packetCwd); mkdir(b.packetCwd);
      assert.notEqual(originals.realpathSync(actual(a.packetCwd)), originals.realpathSync(actual(b.packetCwd)));
      assert.equal(key(a.packetCwd), 'synthetic-work-team-project-a-council-native-packets');
      assert.equal(key(a.packetCwd), key(b.packetCwd));
      for (const [sourceContext, targetContext] of [[a, b], [b, a]]) {
        put(marker(sourceContext), body(sourceContext.packetCwd));
        expect(check(sourceContext), 'verified', 'verified');
        expect(check(targetContext), 'verified', 'unknown', 'CURSOR_TRUST_PATH_MISMATCH');
      }
    });
    await run('noncolliding-foreign', () => {
      const c = setup(); put(marker(c, '/synthetic/foreign/unrelated'), body('/synthetic/foreign/unrelated'));
      expect(check(c), 'missing', 'missing', 'CURSOR_TRUST_ABSENT'); assert.deepEqual(metrics.opens, []);
    });
    await run('ancestor-selection', () => {
      let c = setup(); put(marker(c, c.workspace), body(c.workspace));
      let value = check(c); expect(value, 'verified', 'verified');
      assert.equal(value.evidence.relation, 'ancestor'); assert.equal(value.evidence.candidateOrdinal, 2);
      assert.deepEqual(value.evidence.earlierAbsences, [0, 1]); assert.equal(metrics.dirCloses, 1);
      for (const candidate of [dirname(c.packetCwd), c.workspace, dirname(c.workspace)]) {
        c = setup();
        put(join(c.dataRoot, 'projects', key(candidate).toUpperCase(), '.workspace-trusted'), body(candidate));
        expect(check(c), 'missing', 'missing'); assert.deepEqual(metrics.opens, []);
      }
      for (const candidate of ['/synthetic/work', '/synthetic/home', '/synthetic']) {
        c = setup(); put(marker(c, candidate), body(candidate)); expect(check(c), 'missing', 'missing');
      }
      c = setup(); c.home = c.workspace; put(marker(c, c.workspace), body(c.workspace));
      expect(check(c), 'missing', 'missing');
      put(marker(c), body(c.packetCwd)); expect(check(c), 'verified', 'verified');
      c = setup(); c.home = c.workspace;
      const homeAncestor = dirname(c.workspace);
      assert.equal(homeAncestor, '/synthetic/work/team');
      put(marker(c, homeAncestor), body(homeAncestor));
      expect(check(c), 'missing', 'missing', 'CURSOR_TRUST_ABSENT');
      assert.deepEqual(metrics.opens, []);
    });
    await run('winning-invalid-marker', () => {
      for (const ancestor of [false, true]) {
        for (const kind of ['malformed', 'directory', 'unreadable']) {
          const c = setup(), winner = marker(c, ancestor ? dirname(c.packetCwd) : c.packetCwd);
          put(marker(c, c.workspace), body(c.workspace));
          if (kind === 'directory') mkdir(winner); else put(winner, '{');
          if (kind === 'unreadable') faults.error = (method, target) => method === 'openSync' && target === winner ? 'EACCES' : undefined;
          expect(check(c), 'verified', kind === 'unreadable' ? 'denied' : 'unknown');
          assert(metrics.opens.every(target => target === winner));
        }
      }
      const c = setup(), nearer = dirname(c.packetCwd);
      put(marker(c, nearer), '{'); put(marker(c, c.workspace), body(c.workspace));
      expect(check(c), 'verified', 'unknown', 'CURSOR_TRUST_MALFORMED');
      assert.deepEqual(metrics.opens, [marker(c, nearer)]);
    });
    await run('complete-absence', () => { const c = setup(); expect(check(c), 'missing', 'missing', 'CURSOR_TRUST_ABSENT'); });
    await run('incomplete-search', () => {
      for (const method of ['opendirSync', 'dir.readSync']) {
        const c = setup(); faults.error = operation => operation === method ? 'EIO' : undefined;
        expect(check(c), 'unknown', 'unknown');
        if (method === 'dir.readSync') assert.equal(metrics.dirCloses, 1);
      }
      for (const bytes of [false, true]) {
        const c = setup();
        faults.entries = index => index < 4097 ? { name: bytes ? 'é'.repeat(200) + index : 'unrelated-' + index } : null;
        expect(check(c), 'unknown', 'unknown'); assert.equal(metrics.dirCloses, 1); assert.deepEqual(metrics.opens, []);
        if (bytes) assert(metrics.dirReads < 4097); else assert.equal(metrics.dirReads, 4097);
      }
      const c = setup();
      faults.entries = index => index < 4096 ? { name: 'unrelated-' + index } : null;
      expect(check(c), 'missing', 'missing'); assert.equal(metrics.dirReads, 4097);
    });
    await run('content-refusal', () => {
      for (const [method, code, native] of [['lstatSync', 'EACCES', 'denied'], ['openSync', 'EACCES', 'verified'], ['readSync', 'EPERM', 'verified'], ['fstatSync', 'ERR_ACCESS_DENIED', 'verified']]) {
        const c = setup(), leaf = put(marker(c), body(c.packetCwd));
        faults.error = (operation, target) => operation === method && target === leaf ? code : undefined;
        expect(check(c), native, 'denied', 'CURSOR_TRUST_UNREADABLE');
      }
      let c = setup(); faults.error = operation => operation === 'opendirSync' ? 'EPERM' : undefined;
      expect(check(c), 'denied', 'denied', 'CURSOR_TRUST_UNREADABLE');
      for (const stage of ['open', 'final', 'directory-recheck']) {
        c = setup(); const leaf = put(marker(c), body(c.packetCwd));
        faults.error = (operation, target) =>
          (stage === 'open' && operation === 'openSync' && target === leaf) ||
          (stage === 'final' && operation === 'lstatSync' && target === leaf && metrics.reads > 0) ||
          (stage === 'directory-recheck' && operation === 'lstatSync' && target === c.dataRoot && metrics.reads > 0) ? 'ENOENT' : undefined;
        const value = check(c);
        assert.equal(value.nativeAdmission.state, 'unknown', `${stage}: selected source disappearance must invalidate native admission`);
        expect(value, 'unknown', 'unknown', 'CURSOR_TRUST_SOURCE_DRIFT');
        assert.equal(metrics.opens.length, stage === 'open' ? 0 : 1);
        assert.equal(metrics.closes, stage === 'open' ? 0 : 1);
        if (stage !== 'open') assert(metrics.reads > 0);
      }
    });
    await run('missing-packet', () => {
      const c = setup(), destination = actual(c.packetCwd);
      originals.rmdirSync(destination); owned.splice(owned.findIndex(([target]) => target === destination), 1);
      expect(check(c), 'unknown', 'unknown', 'CURSOR_TRUST_PATH_UNVERIFIED'); assert(!originals.existsSync(destination));
    });
    await run('path-shapes', () => {
      const c = setup();
      for (const bad of ['', 'relative', '/synthetic/../escape', '/synthetic/./work', '/synthetic/\0bad', '/' + 'a'.repeat(4096), '/' + Array(130).fill('a').join('/')]) {
        expect(check({ ...c, workspace: bad }), 'unknown', 'unknown'); assert.equal(metrics.calls.length, 0);
      }
      for (const stored of ['', 'relative', c.packetCwd + '/..', '/synthetic/\0bad', '/' + 'a'.repeat(4096), c.packetCwd + '-sibling', c.workspace, '/synthetic/unknown-alias']) {
        put(marker(c), body(stored)); const value = check(c);
        assert.notEqual(value.exactIdentity.state, 'verified'); assert.equal(value.evidence, null);
        assert(!metrics.calls.some(([, target]) => target === stored && stored !== c.workspace));
      }
    });
    await run('root-context', () => {
      let c = setup(); c.dataRoot = '/synthetic/data '; mkdir(join(c.dataRoot, 'projects'));
      put(marker(c), body(c.packetCwd)); const spaced = check(c); expect(spaced, 'verified', 'verified');
      c = { ...c, dataRoot: '/synthetic/data' }; expect(check(c), 'missing', 'missing');
      c = setup(); c.dataRoot = '   '; mkdir(join(c.home, '.cursor/projects')); put(marker(c), body(c.packetCwd));
      process.env.CURSOR_CONFIG_DIR = '/synthetic/unused-config';
      const blank = check(c); expect(blank, 'verified', 'verified');
      expect(check({ ...c, dataRoot: undefined }), 'verified', 'verified');
      assert.equal(blank.evidence.contextSha256, check({ ...c, dataRoot: undefined }).evidence.contextSha256);
      expect(check({ ...c, dataRoot: 'relative-root' }), 'unsupported', 'unsupported'); assert.equal(metrics.calls.length, 0);
    });
    await run('strict-shapes', () => {
      const c = setup();
      const duplicate = `{"workspacePath":${JSON.stringify(c.packetCwd)},"workspacePath":${JSON.stringify(c.packetCwd)},"trustedAt":"2026-11-03T00:00:00.000Z"}`;
      const invalidUtf8 = Buffer.concat([Buffer.from(body(c.packetCwd).slice(0, -1) + ',"sourceWorkspacePath":"'), Buffer.from([0xff]), Buffer.from('"}')]);
      // Permissive parsing/decoding leaves otherwise valid matching markers.
      assert.equal(JSON.parse(duplicate).workspacePath, c.packetCwd);
      assert.equal(JSON.parse(invalidUtf8.toString('utf8')).workspacePath, c.packetCwd);
      for (const text of [duplicate, invalidUtf8]) {
        put(marker(c), text); expect(check(c), 'verified', 'unknown', 'CURSOR_TRUST_MALFORMED');
        assert.equal(metrics.opens.length, 1); assert.equal(metrics.closes, 1);
      }
      const malformed = [Buffer.from([0xff, 0xfe]), Buffer.from([0xe2, 0x82]), '\ufeff' + body(c.packetCwd), '{', body(c.packetCwd) + ' true', 'null', '[]', '{}',
        body(c.packetCwd, { trustedAt: 1 }), body(c.packetCwd, { trustedAt: '2026-11-03' }), body(c.packetCwd, { trustedAt: '2026-02-30T00:00:00.000Z' }),
        body(7), body(c.packetCwd, { sourceWorkspacePath: 1 }), body(c.packetCwd, { sourceWorkspacePath: 'x'.repeat(4097) })];
      for (const text of malformed) { put(marker(c), text); expect(check(c), 'verified', 'unknown', 'CURSOR_TRUST_MALFORMED'); }
      for (const extra of [{ unknown: sentinel }, { trustMethod: 'unknown' }]) {
        put(marker(c), body(c.packetCwd, extra)); expect(check(c), 'verified', 'unsupported', 'CURSOR_TRUST_CONTRACT_UNSUPPORTED');
      }
      put(marker(c), body(c.packetCwd, { trustedAt: '1970-01-01T00:00:00.000Z' })); expect(check(c), 'verified', 'verified');
    });
    await run('bounded-file', () => {
      const c = setup(), text = body(c.packetCwd);
      put(marker(c), text + ' '.repeat(16384 - Buffer.byteLength(text))); expect(check(c), 'verified', 'verified'); assert.equal(metrics.bytes, 16384);
      put(marker(c), text + ' '.repeat(16385 - Buffer.byteLength(text))); expect(check(c), 'verified', 'unknown', 'CURSOR_TRUST_TOO_LARGE'); assert.equal(metrics.reads, 0);
      faults.stat = (method, target, stat) => target === marker(c) ? statWith(stat, { size: 16384n }) : stat;
      expect(check(c), 'verified', 'unknown', 'CURSOR_TRUST_TOO_LARGE'); assert.equal(metrics.bytes, 16385);
      put(marker(c), text);
      faults.stat = (method, target, stat) => target === marker(c) ? statWith(stat, { size: 17000n }) : stat;
      expect(check(c), 'verified', 'unknown', 'CURSOR_TRUST_TOO_LARGE'); assert.equal(metrics.reads, 0);
      faults = { shortRead: 1 }; expect(check(c), 'verified', 'verified'); assert(metrics.reads > 2);
      faults = { earlyEof: true }; expect(check(c), 'unknown', 'unknown', 'CURSOR_TRUST_SOURCE_DRIFT');
      faults = { stat: (method, target, stat, count) => method === 'fstatSync' && count > 1 ? statWith(stat, { size: stat.size + 1n }) : stat };
      expect(check(c), 'unknown', 'unknown', 'CURSOR_TRUST_SOURCE_DRIFT');
      faults = { stat: (method, target, stat) => target === marker(c) ? statWith(stat, { size: 1n }) : stat };
      expect(check(c), 'unknown', 'unknown', 'CURSOR_TRUST_SOURCE_DRIFT');
    });
    await run('object-custody', () => {
      for (const kind of ['FIFO', 'Socket', 'CharacterDevice', 'BlockDevice', 'Directory']) {
        const c = setup(), leaf = put(marker(c), body(c.packetCwd));
        faults.stat = (method, target, stat) => target === leaf ? statWith(stat, { isFile: () => false, ['is' + kind]: () => true }) : stat;
        expect(check(c), 'verified', 'unknown', 'CURSOR_TRUST_NOT_REGULAR'); assert.equal(metrics.reads, 0); assert.equal(metrics.opens.length, 0);
      }
      let c = setup(), leaf = put(marker(c), body(c.packetCwd));
      // The restricted child disallows real symlink creation. Simulate the
      // inspected object only; no denied filesystem operation is retried.
      faults.stat = (method, target, stat) => target === leaf ? statWith(stat, { isSymbolicLink: () => true, isFile: () => false }) : stat;
      expect(check(c), 'unknown', 'unknown', 'CURSOR_TRUST_NOT_REGULAR'); assert.equal(metrics.opens.length, 0); assert.equal(metrics.closes, 0);
      c = setup(); leaf = put(marker(c), body(c.packetCwd));
      faults.stat = (method, target, stat) => target === leaf ? statWith(stat, { nlink: 2n }) : stat;
      expect(check(c), 'verified', 'unsupported', 'CURSOR_TRUST_CONTRACT_UNSUPPORTED'); assert.equal(metrics.reads, 0); assert.equal(metrics.closes, 0);
      c = setup(); leaf = put(marker(c), body(c.packetCwd));
      faults.stat = (method, target, stat) => method === 'fstatSync' ? statWith(stat, { isFile: () => false, isFIFO: () => true }) : stat;
      expect(check(c), 'unknown', 'unknown', 'CURSOR_TRUST_SOURCE_DRIFT'); assert.equal(metrics.reads, 0); assert.equal(metrics.closes, 1);
      c = setup(); leaf = put(marker(c), body(c.packetCwd));
      const keyDir = dirname(leaf);
      faults.stat = (method, target, stat) => target === keyDir ? statWith(stat, { isSymbolicLink: () => true }) : stat;
      expect(check(c), 'unknown', 'unknown', 'CURSOR_TRUST_PATH_UNVERIFIED'); assert.equal(metrics.opens.length, 0); assert.equal(metrics.closes, 0);
      for (const drift of ['descriptor', 'leaf', 'directory', 'root-escape']) {
        c = setup(); leaf = put(marker(c), body(c.packetCwd));
        faults.stat = (method, pathname, stat, count) =>
          (drift === 'descriptor' && method === 'fstatSync') ||
          (drift === 'leaf' && pathname === leaf && metrics.reads > 0) ||
          (drift === 'directory' && pathname === c.dataRoot && metrics.reads > 0)
            ? statWith(stat, { ino: stat.ino + 1n }) : stat;
        if (drift === 'root-escape') faults.realpath = pathname => pathname === c.dataRoot && metrics.reads > 0 ? '/outside-' + sentinel : undefined;
        expect(check(c), 'unknown', 'unknown', 'CURSOR_TRUST_SOURCE_DRIFT');
        assert.equal(metrics.closes, 1);
        if (drift === 'descriptor') assert.equal(metrics.reads, 0);
        else assert(metrics.reads > 0);
      }
      for (const stage of ['open-symlink', 'final-symlink', 'directory-refusal']) {
        c = setup(); leaf = put(marker(c), body(c.packetCwd));
        if (stage === 'final-symlink') faults.stat = (method, target, stat) => target === leaf && metrics.reads > 0 ? statWith(stat, { isSymbolicLink: () => true, isFile: () => false }) : stat;
        else faults.error = (method, target) =>
          (stage === 'open-symlink' && method === 'openSync' && target === leaf) ? 'ELOOP' :
          (stage === 'directory-refusal' && method === 'lstatSync' && target === c.dataRoot && metrics.reads > 0) ? 'EACCES' : undefined;
        expect(check(c), stage === 'directory-refusal' ? 'denied' : 'unknown', stage === 'directory-refusal' ? 'denied' : 'unknown',
          stage === 'directory-refusal' ? 'CURSOR_TRUST_UNREADABLE' : stage === 'open-symlink' ? 'CURSOR_TRUST_NOT_REGULAR' : 'CURSOR_TRUST_SOURCE_DRIFT');
        assert.equal(metrics.closes, stage === 'open-symlink' ? 0 : 1);
      }
      c = setup(); leaf = put(marker(c, c.workspace), body(c.workspace));
      const newlyPresent = dirname(marker(c)), replacement = originals.lstatSync(actual(dirname(leaf)), { bigint: true });
      faults.beforeStat = (method, target) => target === newlyPresent && metrics.reads > 0 ? replacement : undefined;
      expect(check(c), 'unknown', 'unknown', 'CURSOR_TRUST_SOURCE_DRIFT');
      assert.deepEqual(metrics.opens, [leaf]); assert.equal(metrics.closes, 1); assert.equal(metrics.dirCloses, 1);
    });
    await run('namespace-unqualified', async () => {
      const c = setup(), leaf = put(marker(c), body(c.packetCwd));
      faults.stat = (method, target, stat) => target === c.dataRoot ? statWith(stat, { mode: stat.mode | 0o022n }) : stat;
      expect(check(c), 'unsupported', 'unsupported');
      faults.stat = (method, target, stat) => target === c.dataRoot ? statWith(stat, { uid: stat.uid + 1n }) : stat;
      expect(check(c), 'unsupported', 'unsupported'); faults = {};
      // Discovery sees only owned synthetic host paths; no installed command can resolve.
      mkdir(join(c.workspace, '.git'));
      process.env.HOME = actual(c.home); process.env.PATH = scratch; process.env.CURSOR_DATA_DIR = actual(c.dataRoot);
      process.env.CURSOR_CONFIG_DIR = actual('/synthetic/config');
      for (const text of [body(c.packetCwd), body('/' + sentinel), body(c.packetCwd, { sourceWorkspacePath: '/' + sentinel }), body(c.packetCwd, { trustedAt: sentinel }), '{' + sentinel, body(c.packetCwd, { [sentinel]: sentinel })]) {
        put(leaf, text);
        markerTouches = 0; projection = true;
        let evidence;
        try { evidence = await module.inspectProviderControls({ route: 'cursor', model: 'grok-4.7-xhigh', effort: 'xhigh' }, '2026.10.22-27dcf5f', actual(c.workspace), { state: 'unknown', source: 'synthetic', detail: 'fixture' }); }
        finally { projection = false; }
        for (const name of ['cursor-native-trust-admission', 'workspace-trust']) assert.equal(evidence.facts.find(fact => fact.name === name).observation.state, 'unsupported');
        assert.equal(evidence.facts.find(fact => fact.name === 'installed-command-contract').observation.state, 'missing');
        assert.equal(markerTouches, 0, 'unqualified production discovery touched trust storage');
        assert(!evidence.audit.sources.some(source => source.path.endsWith('/.workspace-trusted')));
        assert.notEqual(evidence.bootstrap.state, 'verified');
        assert(!JSON.stringify(evidence).includes(sentinel));
      }
      assert(originals.existsSync(actual(leaf)));
    });
    await run('privacy-sentinels', () => {
      let c = setup();
      c = { ...c, workspace: '/synthetic/work/team/' + sentinel, packetCwd: '/synthetic/work/team/' + sentinel + '/.council/native-packets' };
      mkdir(c.packetCwd); put(marker(c), body(c.packetCwd)); expect(check(c), 'verified', 'verified');
      c = setup();
      for (const text of [body('/' + sentinel), body(c.packetCwd, { sourceWorkspacePath: '/' + sentinel }), body(c.packetCwd, { trustedAt: sentinel }), '{' + sentinel, body(c.packetCwd, { [sentinel]: sentinel })]) {
        put(marker(c), text); check(c);
      }
      put(marker(c), body(c.packetCwd)); faults.error = method => method === 'readSync' ? 'EIO' : undefined;
      expect(check(c), 'verified', 'unknown', 'CURSOR_TRUST_UNREADABLE');
    });
  }
  result = { sourceOnly: true, childPermission: false, workerPermission: false, scratchEmpty: true, passed, caseReceipts };
} finally {
  try {
    assert.equal(descriptors.size, 0);
    assert.equal(directories.size, 0);
    cleanup();
  } finally {
    hooks.deregister();
    Object.assign(fs, originals);
    Object.assign(Buffer, bufferOriginals);
    syncBuiltinESMExports();
    for (const name of Object.keys(process.env)) if (!(name in environment)) delete process.env[name];
    Object.assign(process.env, environment);
    assert.deepEqual(fs.readdirSync(scratch), []);
    for (const [name, original] of Object.entries(originals)) assert.equal(fs[name], original);
    assert.deepEqual({ ...process.env }, environment);
  }
}
console.log(JSON.stringify(result));
