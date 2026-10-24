import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { qualifySelection } from '../../src/policy/qualification.js';

it('binds qualification to the host, exact versions, action class, roots and explicit Orca controls', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'qualification-')));
  const selection = { route: 'codex' as const, model: 'gpt-6-astra', effort: 'ultra' }, versions = { orca: '1', codex: '2', antigravity: '3' };
  const receipt = { id: 'q', host: 'mac', versions, actionClass: 'source-read-only' as const, requested: selection, exposed: selection, expiresAt: 5000, throughOrca: true, helpersDisabled: true, terminalSandbox: true, accessControlled: true, roots: [root], receiptRefs: ['receipt'] };
  const requirement = { selection, host: 'mac', versions, actionClass: 'source-read-only' as const, roots: [root], now: 1000 };
  expect(qualifySelection(requirement, [receipt]).kind).toBe('ready');
  for (const changed of [{ host: 'other' }, { versions: { ...versions, codex: 'new' } }, { helpersDisabled: false }, { accessControlled: false }, { actionClass: 'supplied-packet-read-only' as const }, { roots: [] }, { expiresAt: 1 }]) expect(qualifySelection(requirement, [{ ...receipt, ...changed }]).kind).toBe('blocked');
  expect(qualifySelection({ ...requirement, roots: ['/not/a/real/root'] }, [{ ...receipt, roots: ['/'] }]).kind).toBe('blocked');
});
