import { mkdtempSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { writeHandoff } from '../../src/input/handoff.js';

it('writes a private OS temporary handoff with references, suggested skills and visible exclusions', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'handoff-test-')));
  const input = { decision: 'Choose an interface', outcome: 'A bounded decision', requirements: ['Read only'], priorities: ['Correctness'], constraints: ['No installs'], excludedActions: ['No push'], priorDecisions: ['Keep the API'], references: [{ address: '/spec.md', description: 'Authoritative specification' }], uncertainties: ['Cost unknown'], candidates: ['A: proposed'], suggestedSkills: ['orchestration', 'simplified-technical-english'], sensitiveExclusions: ['Customer identity omitted'], permittedSources: ['/spec.md'], permittedCommands: [], permittedEffects: [], workerAccess: 'Supplied packet only' };
  const ref = writeHandoff(input, root), text = readFileSync(ref.path, 'utf8');
  expect(ref.path.startsWith(root + '/')).toBe(true); expect(statSync(ref.path).mode & 0o777).toBe(0o600);
  expect(text).toContain('Suggested skills'); expect(text).toContain('/spec.md'); expect(text).toContain('Customer identity omitted');
  expect(() => writeHandoff({ ...input, apiKey: 'secret' } as never, root)).toThrow('HANDOFF_SENSITIVE_FIELD');
  expect(() => writeHandoff({ ...input, decision: 'token=sk-1234567890123456789012345678' }, root)).toThrow('HANDOFF_SENSITIVE_CONTENT');
  expect(() => writeHandoff(input, process.cwd())).toThrow('HANDOFF_NOT_TEMPORARY');
});
