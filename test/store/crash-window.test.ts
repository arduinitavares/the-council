import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import type { JsonValue } from '../../src/domain/contracts.js';
import { canonicalJson, hashArtifact } from '../../src/domain/hash.js';
import { Flow } from '../machine/helpers.js';
import { reduceRun } from '../../src/machine/reduce.js';

beforeAll(() => { execFileSync('npm', ['run', 'build'], { stdio: 'pipe' }); }, 30000);

for (const window of ['unsent', 'before-launch', 'after-launch', 'before-receipt-commit']) {
  it(`reconciles a killed child at ${window} without rearming a fenced launch`, async () => {
    const { openArtifactStore } = await import('../../src/store/artifacts.js');
    const { openRunStore } = await import('../../src/store/run-store.js');
    const root = mkdtempSync(join(tmpdir(), 'council-crash-'));
    const artifacts = openArtifactStore(join(root, 'artifacts'));
    const flow = new Flow(), raw = Buffer.from('version: 1\n'), config = flow.s.context.config;
    config.rawArtifact = artifacts.putArtifact(raw, 'raw-config');
    config.configArtifact = artifacts.putArtifact(Buffer.from(canonicalJson(config.resolved)), 'config');
    config.rawSha256 = createHash('sha256').update(raw).digest('hex');
    config.configHash = hashArtifact('council-config', config.resolved as unknown as JsonValue);
    flow.s.context.request.config = structuredClone(config);
    writeFileSync(join(root, 'initial.json'), canonicalJson(flow.s));
    const moduleUrl = new URL('../../dist/store/run-store.js', import.meta.url).href;
    const reducerUrl = new URL('../../dist/machine/reduce.js', import.meta.url).href;
    const script = `
      import { readFileSync, appendFileSync } from 'node:fs';
      import { openRunStore } from ${JSON.stringify(moduleUrl)};
      import { reduceRun } from ${JSON.stringify(reducerUrl)};
      const root = process.argv[1], window = process.argv[2], store = openRunStore(root);
      let s = JSON.parse(readFileSync(root + '/initial.json', 'utf8'));
      store.createRun(s);
      let tick = 0;
      function send(kind, data = {}, actor = 'controller', phase = null, commit = true) {
        const e = { id: 'child-event-' + (++tick), runId: 'run1', schemaVersion: 1,
          actor: { kind: actor, receiptId: 'receipt' }, round: 0, phase,
          clockReceipt: { id: 'clock-' + tick, wallMs: 10000 + tick, monotonicMs: 100 + tick, processEpoch: 'epoch1' },
          body: { kind, data } };
        const result = reduceRun(s, e);
        if (commit) store.commitTransition('run1', s.revision, e, result);
        s = result.snapshot;
      }
      send('PREFLIGHT', { status: 'pass', attestation: { kind: 'receipt', path: '/tmp/receipt', bytes: 1, sha256: 'a'.repeat(64) }, code: null, resourcesSettled: true });
      const t = Object.values(s.context.issuedLogicalTasks).find(t => t.reservation.role === 'openai'), r = t.reservation;
      if (window !== 'unsent') send('LAUNCH_DISPATCHED', { logicalTaskKey: r.logicalTaskKey });
      if (window === 'after-launch' || window === 'before-receipt-commit') appendFileSync(root + '/launches', r.clientAttemptKey + '\\n');
      if (window === 'before-receipt-commit') {
        const binding = { ...r.bindings, attemptId: 'real-attempt', role: r.role, phase: r.phase,
          requested: r.requested, configured: r.requested,
          authority: { kind: 'supervised', runId: 'run1', taskId: 'real-task', dispatchId: 'real-dispatch', receiptId: 'real-receipt' },
          admittedMethodIds: ['test-method'], inputQuestionIds: [], inputObjectionIds: [], inputEvidenceIds: [] };
        send('LAUNCH_RECEIPT_RECORDED', { binding }, 'adapter', 'clarify', false);
      }
      process.send({ ready: true });
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, root, window], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = '';
    child.stderr!.on('data', chunk => { stderr += String(chunk); });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('message', () => resolve());
        child.once('exit', code => reject(new Error(`Child exited ${code}: ${stderr}`)));
        child.once('error', reject);
      });
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
      const store = openRunStore(root), snapshot = store.load('run1');
      const task = Object.values(snapshot.context.issuedLogicalTasks).find(t => t.reservation.role === 'openai')!;
      expect(task.stage).toBe(window === 'unsent' ? 'pending_execution' : 'dispatched');
      expect(task.binding).toBeNull();
      expect(snapshot.context.callsReserved).toBe(3);
      expect(store.effectRecord(task.reservation.effectKey).status).toBe(task.stage);
      expect(store.pendingEffects('run1').some(i => i.key === task.reservation.effectKey)).toBe(window === 'unsent');
      const event = { id: 'recovered-clock', runId: 'run1', schemaVersion: 1 as const,
        actor: { kind: 'controller' as const, receiptId: 'recovery' }, round: 0, phase: null,
        clockReceipt: { id: 'clock-recovery', wallMs: 10010, monotonicMs: 110, processEpoch: 'epoch1' },
        body: { kind: 'CLOCK_CHECKPOINT' as const, data: {} } };
      store.commitTransition('run1', snapshot.revision, event, reduceRun(snapshot, event));
      expect(store.load('run1').context.issuedLogicalTasks[task.reservation.logicalTaskKey]!.stage).toBe(task.stage);
      expect(existsSync(join(root, 'launches')) ? readFileSync(join(root, 'launches'), 'utf8').trim().split('\n').length : 0).toBe(window === 'after-launch' || window === 'before-receipt-commit' ? 1 : 0);
      store.close();
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
    }
  }, 10000);
}
