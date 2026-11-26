import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  DEFAULT_T3_MCP_URL,
  MCP_PROTOCOL_VERSION,
  T3McpClient
} from '../../src/harness/t3-mcp-client.js';
import {
  AuthenticationError,
  AbortError,
  QuotaExhaustionError,
  HarnessExecutionError
} from '../../src/harness/adapter.js';

function startMockServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let json = null;
      if (rawBody) {
        try {
          json = JSON.parse(rawBody);
        } catch {
          json = null;
        }
      }
      await handler(req, res, json, rawBody);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/mcp` });
    });
  });
}

describe('Task 2: Zero-dependency Streamable HTTP T3McpClient', () => {
  const servers = [];
  afterEach(async () => {
    while (servers.length > 0) {
      const s = servers.pop();
      await new Promise((r) => s.close(r));
    }
  });

  it('serializes concurrent initialize calls, sends Accept + Mcp-Session-Id on notifications/initialized, and handles 202 empty body', async () => {
    let initCount = 0;
    let notifyCount = 0;
    let notifySessionHeader = null;
    let notifyAcceptHeader = null;

    const { server, url } = await startMockServer((req, res, body) => {
      assert.match(req.headers.accept || '', /application\/json/);
      assert.match(req.headers.accept || '', /text\/event-stream/);
      if (body?.method === 'initialize') {
        initCount += 1;
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': 'sess-001'
        });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: MCP_PROTOCOL_VERSION,
              capabilities: {},
              serverInfo: { name: 'mock-t3', version: '0.1.12' }
            }
          })
        );
        return;
      }
      if (body?.method === 'notifications/initialized') {
        notifyCount += 1;
        notifySessionHeader = req.headers['mcp-session-id'];
        notifyAcceptHeader = req.headers.accept;
        res.writeHead(202);
        res.end();
        return;
      }
      if (body?.method === 'tools/call') {
        assert.equal(req.headers['mcp-session-id'], 'sess-001');
        assert.equal(req.headers['mcp-protocol-version'], MCP_PROTOCOL_VERSION);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              content: [{ type: 'text', text: JSON.stringify({ echoed: body.params.arguments.value }) }]
            }
          })
        );
      }
    });
    servers.push(server);

    const client = new T3McpClient({ url, token: 'tok-abc' });
    const [r1, r2, r3] = await Promise.all([
      client.callTool('echo_tool', { value: 1 }),
      client.callTool('echo_tool', { value: 2 }),
      client.callTool('echo_tool', { value: 3 })
    ]);
    assert.equal(initCount, 1);
    assert.equal(notifyCount, 1);
    assert.equal(notifySessionHeader, 'sess-001');
    assert.equal(notifyAcceptHeader, 'application/json, text/event-stream');
    assert.deepEqual([r1.echoed, r2.echoed, r3.echoed], [1, 2, 3]);
    assert.equal(DEFAULT_T3_MCP_URL, 'http://127.0.0.1:3773/mcp');
  });

  it('parses chunk-split multi-byte UTF-8 text/event-stream SSE with CRLF, comments, multiline data, and id correlation', async () => {
    const { server, url } = await startMockServer((req, res, body) => {
      if (body?.method === 'initialize') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-sse' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: MCP_PROTOCOL_VERSION } }));
        return;
      }
      if (body?.method === 'notifications/initialized') {
        res.writeHead(202);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: { content: [{ type: 'text', text: JSON.stringify({ text: 'café 🚀 consensus' }) }] }
      });
      const notification = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { pct: 50 } });
      const splitJsonAt = payload.indexOf('"result"');
      const sseBuf = Buffer.from(
        `: keepalive comment\r\ndata: ${notification}\r\n\r\ndata: ${payload.slice(0, splitJsonAt)}\r\ndata: ${payload.slice(splitJsonAt)}\r\n\r\n`,
        'utf8'
      );
      // Split deliberately across multi-byte UTF-8 sequence
      const splitAt = sseBuf.indexOf(Buffer.from('🚀', 'utf8')) + 2;
      res.write(sseBuf.subarray(0, splitAt));
      setTimeout(() => {
        res.end(sseBuf.subarray(splitAt));
      }, 10);
    });
    servers.push(server);

    const client = new T3McpClient({ url });
    const res = await client.callTool('sse_tool', {});
    assert.equal(res.text, 'café 🚀 consensus');
  });

  it('maps HTTP 401 invalid_mcp_credential to non-retryable AuthenticationError and redacts token everywhere', async () => {
    const secret = 't3_live_super_secret_token_999';
    const { server, url } = await startMockServer((req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'invalid_mcp_credential',
          message: `Credential ${secret} rejected with Authorization: Bearer ${secret}`
        })
      );
    });
    servers.push(server);

    const client = new T3McpClient({ url, token: secret });
    await assert.rejects(
      () => client.callTool('orchestrator_capabilities', {}),
      (err) => {
        assert.ok(err instanceof AuthenticationError);
        assert.equal(err.isRetryable, false);
        assert.equal(err.code, 'INVALID_MCP_CREDENTIAL');
        assert.equal(err.message.includes(secret), false);
        assert.equal((err.envelopeError || '').includes(secret), false);
        return true;
      }
    );

    const health = await client.healthCheck();
    assert.equal(health.ok, false);
    assert.equal(health.errorClass, 'AuthenticationError');
    assert.equal((health.error || '').includes(secret), false);
  });

  it('re-initializes once on HTTP 404 stale session and retries tools/call cleanly', async () => {
    let initNum = 0;
    let callNum = 0;
    const { server, url } = await startMockServer((req, res, body) => {
      if (body?.method === 'initialize') {
        initNum += 1;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': `sess-${initNum}` });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: MCP_PROTOCOL_VERSION } }));
        return;
      }
      if (body?.method === 'notifications/initialized') {
        res.writeHead(202);
        res.end();
        return;
      }
      callNum += 1;
      if (req.headers['mcp-session-id'] === 'sess-1') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'session_not_found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { structuredContent: { ok: true, session: req.headers['mcp-session-id'] } }
        })
      );
    });
    servers.push(server);

    const client = new T3McpClient({ url });
    const result = await client.callTool('t3_project_list', {});
    assert.equal(initNum, 2);
    assert.equal(callNum, 2);
    assert.deepEqual(result, { ok: true, session: 'sess-2' });
  });

  it('distinguishes JSON-RPC errors and MCP result.isError === true (including 429 quota classification)', async () => {
    const { server, url } = await startMockServer((req, res, body) => {
      if (body?.method === 'initialize') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-err' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: MCP_PROTOCOL_VERSION } }));
        return;
      }
      if (body?.method === 'notifications/initialized') {
        res.writeHead(202);
        res.end();
        return;
      }
      if (body?.params?.name === 'rpc_err') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Invalid params' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { isError: true, content: [{ type: 'text', text: 'HTTP 429 Too Many Requests: quota exceeded' }] }
        })
      );
    });
    servers.push(server);

    const client = new T3McpClient({ url });
    await assert.rejects(
      () => client.callTool('rpc_err', {}),
      (err) => err instanceof HarnessExecutionError && err.code === 'MCP_JSONRPC_ERROR'
    );
    await assert.rejects(
      () => client.callTool('tool_err', {}),
      (err) => err instanceof QuotaExhaustionError && err.isQuotaFault === true
    );
  });

  it('rejects cleartext non-loopback HTTP URLs with tokens, blocks auth redirects, and propagates AbortSignal', async () => {
    const badClient = new T3McpClient({ url: 'http://remote.example.com:3773/mcp', token: 'tok-secret' });
    await assert.rejects(
      () => badClient.initialize(),
      (err) => err instanceof HarnessExecutionError && err.code === 'INSECURE_T3_MCP_URL' && err.isRetryable === false
    );

    const { server, url } = await startMockServer((req, res, body) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: 'http://127.0.0.1:9999/steal' });
        res.end();
        return;
      }
      if (body?.method === 'initialize') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-ab' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: MCP_PROTOCOL_VERSION } }));
        return;
      }
      if (body?.method === 'notifications/initialized') {
        res.writeHead(202);
        res.end();
        return;
      }
      // Stall so AbortController cancels
      const stallTimer = setTimeout(() => {
        if (!res.writableEnded && !res.destroyed) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{}');
        }
      }, 5000);
      stallTimer.unref();
      req.on('close', () => clearTimeout(stallTimer));
    });
    servers.push(server);

    const redirClient = new T3McpClient({ url: url.replace('/mcp', '/redirect'), token: 'tok-secret' });
    await assert.rejects(() => redirClient.initialize());

    const abortClient = new T3McpClient({ url });
    const ac = new AbortController();
    setTimeout(() => ac.abort(new Error('caller cancelled')), 30);
    await assert.rejects(
      () => abortClient.callTool('slow_tool', {}, { signal: ac.signal }),
      (err) => err instanceof AbortError && err.isRetryable === false
    );
  });
});
