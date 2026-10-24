import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCouncilConfig } from '../../src/config/load.js';

describe('complete model-only roster', () => {
  it('preserves the shipped four selections and supports complete replacements', () => {
    const raw = readFileSync(new URL('../../council.yaml', import.meta.url));
    const config = parseCouncilConfig(raw);
    expect(config.reviewers.openai.model).toBe('gpt-6-astra');
    expect(config.judge.effort).toBe('ultra');
    const alternate = raw.toString().replaceAll('gpt-6-astra', 'gpt-6.1-sol').replaceAll('ultra', 'max').replaceAll('claude-opus-5-5-high', 'claude-sonnet-5-5-high');
    expect(parseCouncilConfig(Buffer.from(alternate)).reviewers.claude.model).toBe('claude-sonnet-5-5-high');
    expect(parseCouncilConfig(Buffer.from(alternate.replace(/judge:[\s\S]*$/, 'judge:\n  route: antigravity\n  model: claude-sonnet-5-5-high\n  effort: high\n'))).judge.route).toBe('antigravity');
    expect(parseCouncilConfig(Buffer.from(alternate.replaceAll('gpt-6.1-sol', 'model9'))).reviewers.openai.model).toBe('model9');
  });
});
