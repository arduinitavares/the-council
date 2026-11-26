import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  discoverT3OAuthMetadata,
  registerT3OAuthClient,
  loginT3OAuth,
  logoutT3OAuth,
  getT3AuthStatus,
  loadStoredT3Credential,
  saveStoredT3Credential
} from '../../src/harness/t3-oauth.js';
import { T3McpClient } from '../../src/harness/t3-mcp-client.js';
import { AuthenticationError } from '../../src/harness/adapter.js';
import { runCli } from '../../src/cli/index.js';

function startHttpServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function readRequestBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function createTempStorePath(dirs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-t3-oauth-'));
  dirs.push(dir);
  return path.join(dir, 't3-oauth.json');
}

describe('T3 MCP OAuth 2.1 + PKCE & CLI integration', () => {
  const servers = [];
  const tempDirs = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const s = servers.pop();
      await new Promise((resolve) => {
        s.close(() => resolve());
        s.closeAllConnections?.();
      });
    }
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('completes full RFC 9728 / RFC 8414 discovery, dynamic registration, PKCE S256 login, and 0600 credential storage', async () => {
    const storePath = createTempStorePath(tempDirs);
    const issuedToken = 't3_oauth_secret_token_alpha_999';
    const seen = { registerBody: null, tokenForm: null, revokedBody: null };
    let expectedChallenge = null;

    const { server, url: baseUrl } = await startHttpServer(async (req, res) => {
      const reqUrl = new URL(req.url, baseUrl);
      if (reqUrl.pathname === '/.well-known/oauth-protected-resource/mcp') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            resource: `${baseUrl}/mcp`,
            authorization_servers: [baseUrl],
            scopes_supported: ['orchestration:read', 'orchestration:operate']
          })
        );
        return;
      }
      if (reqUrl.pathname === '/.well-known/oauth-authorization-server') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/oauth/mcp/authorize`,
            token_endpoint: `${baseUrl}/oauth/mcp/token`,
            registration_endpoint: `${baseUrl}/oauth/mcp/register`,
            revocation_endpoint: `${baseUrl}/oauth/mcp/revoke`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code'],
            code_challenge_methods_supported: ['S256'],
            scopes_supported: ['orchestration:read', 'orchestration:operate'],
            authorization_response_iss_parameter_supported: true
          })
        );
        return;
      }
      if (reqUrl.pathname === '/oauth/mcp/register' && req.method === 'POST') {
        const body = JSON.parse(await readRequestBody(req));
        seen.registerBody = body;
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ client_id: 'dyn-client-123' }));
        return;
      }
      if (reqUrl.pathname === '/oauth/mcp/token' && req.method === 'POST') {
        const form = new URLSearchParams(await readRequestBody(req));
        seen.tokenForm = Object.fromEntries(form.entries());
        const computedChallenge = crypto
          .createHash('sha256')
          .update(form.get('code_verifier') || '')
          .digest('base64url');
        assert.equal(computedChallenge, expectedChallenge, 'Token exchange code_verifier must match PKCE S256 challenge');
        assert.equal(form.get('resource'), `${baseUrl}/mcp`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: issuedToken,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'orchestration:read orchestration:operate'
          })
        );
        return;
      }
      if (reqUrl.pathname === '/oauth/mcp/revoke' && req.method === 'POST') {
        seen.revokedBody = Object.fromEntries(new URLSearchParams(await readRequestBody(req)).entries());
        res.writeHead(200);
        res.end();
        return;
      }
      if (reqUrl.pathname === '/mcp' && req.method === 'POST') {
        const auth = req.headers.authorization;
        if (auth !== `Bearer ${issuedToken}`) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_mcp_credential', message: 'Missing Bearer token' }));
          return;
        }
        const payload = JSON.parse(await readRequestBody(req));
        if (payload.method === 'initialize') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-oauth-1' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: { protocolVersion: '2025-06-18' } }));
          return;
        }
        if (payload.method === 'notifications/initialized') {
          res.writeHead(202);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: { structuredContent: { ok: true, providers: [] } }
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    servers.push(server);

    const mcpUrl = `${baseUrl}/mcp`;
    let browserCallbackResult = null;
    const summary = await loginT3OAuth({
      url: mcpUrl,
      storePath,
      openBrowser: async (authUrlStr) => {
        const authUrl = new URL(authUrlStr);
        assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
        expectedChallenge = authUrl.searchParams.get('code_challenge');
        const cb = new URL(authUrl.searchParams.get('redirect_uri'));
        cb.searchParams.set('code', 'auth-code-xyz');
        cb.searchParams.set('state', authUrl.searchParams.get('state'));
        cb.searchParams.set('iss', baseUrl);
        const cbRes = await fetch(cb.toString());
        browserCallbackResult = { status: cbRes.status, body: await cbRes.text() };
      }
    });

    assert.equal(browserCallbackResult.status, 200);
    assert.deepEqual(seen.registerBody.grant_types, ['authorization_code']);
    assert.equal('accessToken' in summary, false, 'Summary must not expose raw accessToken');
    assert.equal(summary.scope, 'orchestration:read orchestration:operate');
    const mode = fs.statSync(storePath).mode & 0o777;
    assert.equal(mode, 0o600);

    // T3McpClient picks up stored token automatically without options.token or T3_MCP_TOKEN
    const client = new T3McpClient({ url: mcpUrl, tokenStorePath: storePath });
    const res = await client.callTool('orchestrator_capabilities', {});
    assert.deepEqual(res, { ok: true, providers: [] });
    await client.close();

    const status = getT3AuthStatus({ url: mcpUrl, storePath });
    assert.equal(status.authenticated, true);
    assert.equal(status.source, 'oauth-store');

    const logoutRes = await logoutT3OAuth({ url: mcpUrl, storePath });
    assert.equal(logoutRes.removed, true);
    assert.equal(logoutRes.revoked, true);
    assert.equal(seen.revokedBody.token, issuedToken);
    assert.equal(loadStoredT3Credential(mcpUrl, { storePath }), null);
  });

  it('includes refresh_token in dynamic registration only when advertised, refreshes expired/401 tokens, and respects token: ""', async () => {
    const storePath = createTempStorePath(tempDirs);
    let currentAccess = 'expired-access-111';
    let refreshCalls = 0;

    const { server, url: baseUrl } = await startHttpServer(async (req, res) => {
      const reqUrl = new URL(req.url, baseUrl);
      if (reqUrl.pathname === '/oauth/token' && req.method === 'POST') {
        refreshCalls += 1;
        const form = new URLSearchParams(await readRequestBody(req));
        assert.equal(form.get('grant_type'), 'refresh_token');
        assert.equal(form.get('refresh_token'), 'rt-valid-222');
        currentAccess = 'fresh-access-333';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: currentAccess, refresh_token: 'rt-rotated-444', expires_in: 3600 }));
        return;
      }
      if (reqUrl.pathname === '/mcp' && req.method === 'POST') {
        if (req.headers.authorization !== 'Bearer fresh-access-333') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_mcp_credential', message: `Denied ${req.headers.authorization || 'none'}` }));
          return;
        }
        const payload = JSON.parse(await readRequestBody(req));
        if (payload.method === 'initialize') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-ref' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: { protocolVersion: '2025-06-18' } }));
          return;
        }
        if (payload.method === 'notifications/initialized') {
          res.writeHead(202);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: { structuredContent: { refreshed: true } } }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    servers.push(server);

    const mcpUrl = `${baseUrl}/mcp`;
    let regGrantTypes = null;
    await registerT3OAuthClient(
      {
        registrationEndpoint: `${baseUrl}/reg`,
        grantTypesSupported: ['authorization_code', 'refresh_token']
      },
      'http://127.0.0.1:9999/oauth/callback',
      {
        fetchImpl: async (_url, init) => {
          regGrantTypes = JSON.parse(init.body).grant_types;
          return new Response(JSON.stringify({ client_id: 'cid-rt' }), { status: 201 });
        }
      }
    );
    assert.deepEqual(regGrantTypes, ['authorization_code', 'refresh_token']);

    saveStoredT3Credential(
      mcpUrl,
      {
        accessToken: currentAccess,
        refreshToken: 'rt-valid-222',
        clientId: 'cid-rt',
        tokenEndpoint: `${baseUrl}/oauth/token`,
        resource: mcpUrl,
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      },
      { storePath }
    );

    // Explicitly passing token: '' must NOT touch stored OAuth tokens and should surface the login hint on 401
    const unauthClient = new T3McpClient({ url: mcpUrl, token: '', tokenStorePath: storePath });
    await assert.rejects(
      () => unauthClient.initialize(),
      (err) => err instanceof AuthenticationError && err.message.includes('council login t3')
    );

    // Omitting token uses stored OAuth token, sees 401 on stale access token, refreshes once, and succeeds
    const authClient = new T3McpClient({ url: mcpUrl, tokenStorePath: storePath });
    const out = await authClient.callTool('orchestrator_capabilities', {});
    assert.deepEqual(out, { refreshed: true });
    assert.equal(refreshCalls, 1);
    assert.equal(loadStoredT3Credential(mcpUrl, { storePath }).accessToken, 'fresh-access-333');
    assert.equal(loadStoredT3Credential(mcpUrl, { storePath }).refreshToken, 'rt-rotated-444');
  });

  it('rejects OAuth state mismatch, issuer mismatch, error callbacks with XSS escaping, and non-loopback HTTP metadata URLs', async () => {
    const storePath = createTempStorePath(tempDirs);
    await assert.rejects(
      () => discoverT3OAuthMetadata('http://192.0.2.50:3773/mcp'),
      /cleartext non-loopback/i
    );

    const { server, url: baseUrl } = await startHttpServer((req, res) => {
      const reqUrl = new URL(req.url, baseUrl);
      if (reqUrl.pathname === '/.well-known/oauth-protected-resource/mcp') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ resource: `${baseUrl}/mcp`, authorization_servers: [baseUrl] }));
        return;
      }
      if (reqUrl.pathname === '/.well-known/oauth-authorization-server') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/auth`,
            token_endpoint: `${baseUrl}/token`,
            registration_endpoint: `${baseUrl}/reg`,
            code_challenge_methods_supported: ['S256'],
            authorization_response_iss_parameter_supported: true
          })
        );
        return;
      }
      if (reqUrl.pathname === '/reg' && req.method === 'POST') {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ client_id: 'cid-sec' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    servers.push(server);

    // State mismatch
    await assert.rejects(
      () =>
        loginT3OAuth({
          url: `${baseUrl}/mcp`,
          storePath,
          openBrowser: async (authUrlStr) => {
            const cb = new URL(new URL(authUrlStr).searchParams.get('redirect_uri'));
            cb.searchParams.set('code', 'c1');
            cb.searchParams.set('state', 'wrong-state');
            await fetch(cb.toString());
          }
        }),
      /state validation/i
    );

    // RFC 9207 issuer mismatch
    await assert.rejects(
      () =>
        loginT3OAuth({
          url: `${baseUrl}/mcp`,
          storePath,
          openBrowser: async (authUrlStr) => {
            const authUrl = new URL(authUrlStr);
            const cb = new URL(authUrl.searchParams.get('redirect_uri'));
            cb.searchParams.set('code', 'c1');
            cb.searchParams.set('state', authUrl.searchParams.get('state'));
            cb.searchParams.set('iss', 'https://evil.example');
            await fetch(cb.toString());
          }
        }),
      /issuer mismatch/i
    );

    // Escaped error page
    let errorHtml = '';
    await assert.rejects(
      () =>
        loginT3OAuth({
          url: `${baseUrl}/mcp`,
          storePath,
          openBrowser: async (authUrlStr) => {
            const authUrl = new URL(authUrlStr);
            const cb = new URL(authUrl.searchParams.get('redirect_uri'));
            cb.searchParams.set('state', authUrl.searchParams.get('state'));
            cb.searchParams.set('error', 'access_denied');
            cb.searchParams.set('error_description', '<script>alert(1)</script>');
            const res = await fetch(cb.toString());
            errorHtml = await res.text();
          }
        }),
      /access_denied/i
    );
    assert.equal(errorHtml.includes('<script>'), false);
    assert.equal(errorHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
  });

  it('wires council login t3, --status, council logout t3, and rejects unknown login providers', async () => {
    const storePath = createTempStorePath(tempDirs);
    const runCaptured = async (args, extraIo = {}) => {
      let out = '';
      let err = '';
      let exitCode = null;
      await runCli(args, {
        stdout: { write: (s) => { out += s; return true; } },
        stderr: { write: (s) => { err += s; return true; } },
        exit: (c) => { exitCode = c; return c; },
        tokenStorePath: storePath,
        ...extraIo
      });
      return { out, err, exitCode };
    };

    const bad = await runCaptured(['login', 'bogus']);
    assert.equal(bad.exitCode, 1);
    assert.match(bad.err, /Unknown login provider/);

    const statusBefore = await runCaptured(['login', 't3', '--status', '--json']);
    assert.equal(statusBefore.exitCode, 0);
    assert.equal(JSON.parse(statusBefore.out).authenticated, false);

    const loggedIn = await runCaptured(['login', 't3', '--no-browser', '--json'], {
      loginT3OAuth: async (opts) => {
        assert.equal(opts.noBrowser, true);
        return {
          url: 'http://127.0.0.1:3773/mcp',
          scope: 'orchestration:read orchestration:operate',
          expiresAt: '2026-12-01T00:00:00.000Z',
          hasRefreshToken: false,
          storePath
        };
      },
      verifyT3Auth: async () => ({ ok: true, latencyMs: 12 })
    });
    assert.equal(loggedIn.exitCode, 0);
    assert.equal(JSON.parse(loggedIn.out).verified, true);

    const loggedOut = await runCaptured(['logout', 't3', '--json'], {
      logoutT3OAuth: async () => ({ url: 'http://127.0.0.1:3773/mcp', removed: true, revoked: true, storePath })
    });
    assert.equal(loggedOut.exitCode, 0);
    assert.equal(JSON.parse(loggedOut.out).removed, true);
  });
});
