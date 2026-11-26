import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_T3_MCP_URL, T3McpClient } from '../../src/harness/t3-mcp-client.js';
import { loadStoredT3Credential, isT3CredentialExpired } from '../../src/harness/t3-oauth.js';
import { T3HarnessAdapter } from '../../src/harness/t3.js';

const TARGET_URL = process.env.T3_MCP_URL || DEFAULT_T3_MCP_URL;
const STORED_CREDENTIAL = loadStoredT3Credential(TARGET_URL);
const HAS_STORED_CREDENTIAL = Boolean(
  STORED_CREDENTIAL?.accessToken && (!isT3CredentialExpired(STORED_CREDENTIAL) || STORED_CREDENTIAL.refreshToken)
);
const LIVE_ENABLED =
  process.env.LIVE_T3_SMOKE === '1' && (Boolean(process.env.T3_MCP_TOKEN) || HAS_STORED_CREDENTIAL);

describe('Opt-in Live T3 MCP Qualification Smoke (LIVE_T3_SMOKE=1)', { skip: !LIVE_ENABLED }, () => {
  it('verifies live T3 MCP healthCheck and a single scratch tools:none vote turn', async () => {
    const client = new T3McpClient({
      url: process.env.T3_MCP_URL,
      ...(process.env.T3_MCP_TOKEN ? { token: process.env.T3_MCP_TOKEN } : {})
    });
    const provider = process.env.LIVE_T3_PROVIDER || 'codex';
    const model = process.env.LIVE_T3_MODEL || 'gpt-6.2-sol (xhigh)';
    const adapter = new T3HarnessAdapter({ provider, mcpClient: client, archiveThreads: true });
    try {
      const health = await adapter.healthCheck();
      assert.equal(health.ok, true, `Live T3 healthCheck failed: ${health.error}`);
      const vote = await adapter.executeSeatVote({
        seat: { id: 'smoke-seat', harness: provider, model, tools: 'none' },
        soul: 'Concise smoke voter: reply strictly with JSON {"vote":"accept"}.',
        round: 1,
        state: {
          topic: 'Smoke verification: return accept vote.',
          candidate: { summary: 'Smoke test candidate', clauses: [{ id: 'C1', context: 'Smoke', conclusion: 'Pass', citedProofIds: ['P1'] }] },
          proofs: [{ id: 'P1', status: 'admitted', scope: 'Smoke', kind: 'check', source: 'smoke', statement: 'Smoke check' }]
        }
      });
      assert.ok(vote.vote === 'accept' || vote.vote === 'object');
    } finally {
      await adapter.shutdown();
      await client.close();
    }
  });
});
