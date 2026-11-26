/**
 * @fileoverview Zero-Dependency OAuth 2.1 + PKCE + Dynamic Client Registration for T3 Code MCP.
 * Node >= 22 ESM. Zero external dependencies.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const DEFAULT_T3_MCP_URL = 'http://127.0.0.1:3773/mcp';
export const DEFAULT_T3_OAUTH_SCOPES = Object.freeze(['orchestration:read', 'orchestration:operate']);
const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 120_000;
const MAX_OAUTH_RESPONSE_BYTES = 64 * 1024;

function isLoopbackHostname(hostname) {
  const norm = String(hostname || '').trim().toLowerCase();
  return norm === '127.0.0.1' || norm === 'localhost' || norm === '::1' || norm === '[::1]';
}

export function normalizeT3EndpointUrl(rawUrl, env = process.env) {
  const input = String(rawUrl || env?.T3_MCP_URL || DEFAULT_T3_MCP_URL).trim();
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`Invalid T3 MCP URL "${input}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported T3 MCP URL scheme "${parsed.protocol}"`);
  }
  const cleanPath = parsed.pathname.replace(/\/+$/, '') || '/';
  return cleanPath === '/' ? `${parsed.origin}/` : `${parsed.origin}${cleanPath}`;
}

export function assertSafeOAuthUrl(rawUrl, label = 'OAuth endpoint') {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error(`Invalid ${label} URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported ${label} URL scheme "${parsed.protocol}"`);
  }
  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
    throw new Error(`Refusing insecure cleartext non-loopback ${label} URL "${parsed.origin}"`);
  }
  return parsed;
}

export function getDefaultT3TokenStorePath(env = process.env) {
  const override = typeof env?.COUNCIL_T3_AUTH_PATH === 'string' ? env.COUNCIL_T3_AUTH_PATH.trim() : '';
  if (override) {
    return path.resolve(override);
  }
  const xdgConfig = typeof env?.XDG_CONFIG_HOME === 'string' && env.XDG_CONFIG_HOME.trim()
    ? path.resolve(env.XDG_CONFIG_HOME.trim())
    : path.join(os.homedir(), '.config');
  return path.join(xdgConfig, 'the-council', 't3-oauth.json');
}

function readTokenStoreFile(storePath) {
  try {
    if (!fs.existsSync(storePath)) {
      return { version: 1, endpoints: {} };
    }
    const raw = fs.readFileSync(storePath, 'utf8');
    if (!raw.trim()) {
      return { version: 1, endpoints: {} };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.endpoints || typeof parsed.endpoints !== 'object') {
      return { version: 1, endpoints: {} };
    }
    return {
      version: 1,
      endpoints: { ...parsed.endpoints }
    };
  } catch {
    return { version: 1, endpoints: {} };
  }
}

function writeTokenStoreFile(storePath, store) {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpPath = path.join(dir, `.${path.basename(storePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmpPath, storePath);
  try {
    fs.chmodSync(storePath, 0o600);
  } catch {
    // Best-effort POSIX permission hardening
  }
}

function withTokenStoreLockSync(storePath, fn) {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(dir, `.${path.basename(storePath)}.lock`);
  const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 2000;
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
    } catch (err) {
      if (err?.code !== 'EEXIST') {
        return fn();
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > 10_000) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        // Lock removed concurrently
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out acquiring T3 OAuth store lock "${lockPath}"`);
      }
      Atomics.wait(sleepBuf, 0, 0, 5);
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // Ignore close failure
    }
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {
      // Ignore unlink failure
    }
  }
}

export function loadStoredT3Credential(mcpUrl, { storePath } = {}) {
  const resolvedPath = storePath ? path.resolve(storePath) : getDefaultT3TokenStorePath();
  let key;
  try {
    key = normalizeT3EndpointUrl(mcpUrl);
  } catch {
    return null;
  }
  const store = readTokenStoreFile(resolvedPath);
  const entry = store.endpoints[key];
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  return entry;
}

export function saveStoredT3Credential(mcpUrl, record, { storePath } = {}) {
  const resolvedPath = storePath ? path.resolve(storePath) : getDefaultT3TokenStorePath();
  const key = normalizeT3EndpointUrl(mcpUrl);
  withTokenStoreLockSync(resolvedPath, () => {
    const store = readTokenStoreFile(resolvedPath);
    store.endpoints[key] = record;
    writeTokenStoreFile(resolvedPath, store);
  });
  return resolvedPath;
}

export function deleteStoredT3Credential(mcpUrl, { storePath } = {}) {
  const resolvedPath = storePath ? path.resolve(storePath) : getDefaultT3TokenStorePath();
  const key = normalizeT3EndpointUrl(mcpUrl);
  return withTokenStoreLockSync(resolvedPath, () => {
    if (!fs.existsSync(resolvedPath)) {
      return false;
    }
    const store = readTokenStoreFile(resolvedPath);
    if (!Object.prototype.hasOwnProperty.call(store.endpoints, key)) {
      return false;
    }
    delete store.endpoints[key];
    writeTokenStoreFile(resolvedPath, store);
    return true;
  });
}

export function isT3CredentialExpired(entry, skewMs = 60_000) {
  if (!entry || !entry.expiresAt) {
    return false;
  }
  const expiresMs = Date.parse(entry.expiresAt);
  if (!Number.isFinite(expiresMs)) {
    return false;
  }
  return Date.now() >= expiresMs - skewMs;
}

async function readBoundedText(response, maxBytes = MAX_OAUTH_RESPONSE_BYTES) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error(`OAuth HTTP response exceeded ${maxBytes} byte limit`);
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let total = 0;
  let out = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`OAuth HTTP response exceeded ${maxBytes} byte limit`);
      }
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return out;
  } finally {
    reader.releaseLock?.();
  }
}

function redactOAuthErrorText(text, secrets = []) {
  let out = String(text || '');
  const variants = new Set();
  for (const raw of secrets) {
    if (typeof raw !== 'string' || raw.length === 0) continue;
    variants.add(raw);
    try {
      variants.add(encodeURIComponent(raw));
    } catch {
      // Ignore encoding error
    }
    try {
      variants.add(new URLSearchParams([['v', raw]]).toString().slice(2));
    } catch {
      // Ignore encoding error
    }
  }
  const ordered = [...variants].sort((a, b) => b.length - a.length);
  for (const s of ordered) {
    out = out.split(s).join('[REDACTED]');
  }
  out = out.replace(/((?:code_verifier|code|state|client_secret|refresh_token|access_token)\s*[=:]\s*)[^\s&"',;]+/gi, '$1[REDACTED]');
  return out;
}

async function fetchJsonSafe(
  url,
  init,
  { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS, allow404 = false, secrets = [] } = {}
) {
  assertSafeOAuthUrl(url, 'OAuth HTTP request');
  const res = await fetchImpl(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (allow404 && res.status === 404) {
    await res.body?.cancel?.().catch(() => {});
    return null;
  }
  const raw = await readBoundedText(res);
  let parsed = null;
  if (raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    const detail = redactOAuthErrorText(
      parsed?.error_description || parsed?.message || parsed?.error || res.statusText || `HTTP ${res.status}`,
      secrets
    );
    throw new Error(`OAuth request to "${url}" failed (${res.status}): ${detail}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`OAuth endpoint "${url}" returned invalid JSON metadata`);
  }
  return parsed;
}

export async function discoverT3OAuthMetadata(mcpUrl, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS } = {}) {
  const normalizedUrl = normalizeT3EndpointUrl(mcpUrl);
  const parsedMcp = assertSafeOAuthUrl(normalizedUrl, 'T3 MCP');
  const pathSuffix = parsedMcp.pathname === '/' ? '' : parsedMcp.pathname;

  let prm = await fetchJsonSafe(
    `${parsedMcp.origin}/.well-known/oauth-protected-resource${pathSuffix}`,
    { method: 'GET', headers: { Accept: 'application/json' } },
    { fetchImpl, timeoutMs, allow404: true }
  );
  if (!prm && pathSuffix) {
    prm = await fetchJsonSafe(
      `${parsedMcp.origin}/.well-known/oauth-protected-resource`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      { fetchImpl, timeoutMs, allow404: true }
    );
  }

  const resource = typeof prm?.resource === 'string' && prm.resource.trim()
    ? normalizeT3EndpointUrl(prm.resource)
    : normalizedUrl;
  const authServer = Array.isArray(prm?.authorization_servers) && prm.authorization_servers.length > 0
    ? String(prm.authorization_servers[0]).trim()
    : parsedMcp.origin;
  const parsedAs = assertSafeOAuthUrl(authServer, 'authorization server');
  const asPath = parsedAs.pathname === '/' ? '' : parsedAs.pathname.replace(/\/+$/, '');

  let asMeta = await fetchJsonSafe(
    `${parsedAs.origin}/.well-known/oauth-authorization-server${asPath}`,
    { method: 'GET', headers: { Accept: 'application/json' } },
    { fetchImpl, timeoutMs, allow404: true }
  );
  if (!asMeta && asPath) {
    asMeta = await fetchJsonSafe(
      `${parsedAs.origin}/.well-known/oauth-authorization-server`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      { fetchImpl, timeoutMs, allow404: true }
    );
  }
  if (!asMeta) {
    throw new Error(`T3 OAuth authorization server metadata unavailable at "${parsedAs.origin}"`);
  }

  const authorizationEndpoint = String(asMeta.authorization_endpoint || '').trim();
  const tokenEndpoint = String(asMeta.token_endpoint || '').trim();
  if (!authorizationEndpoint || !tokenEndpoint) {
    throw new Error('T3 OAuth metadata is missing required authorization_endpoint or token_endpoint');
  }
  assertSafeOAuthUrl(authorizationEndpoint, 'authorization_endpoint');
  assertSafeOAuthUrl(tokenEndpoint, 'token_endpoint');

  const registrationEndpoint = typeof asMeta.registration_endpoint === 'string' && asMeta.registration_endpoint.trim()
    ? asMeta.registration_endpoint.trim()
    : null;
  if (registrationEndpoint) {
    assertSafeOAuthUrl(registrationEndpoint, 'registration_endpoint');
  }

  const revocationEndpoint = typeof asMeta.revocation_endpoint === 'string' && asMeta.revocation_endpoint.trim()
    ? asMeta.revocation_endpoint.trim()
    : null;
  if (revocationEndpoint) {
    assertSafeOAuthUrl(revocationEndpoint, 'revocation_endpoint');
  }

  const codeChallengeMethodsSupported = Array.isArray(asMeta.code_challenge_methods_supported)
    ? asMeta.code_challenge_methods_supported.map((v) => String(v))
    : [];
  if (codeChallengeMethodsSupported.length > 0 && !codeChallengeMethodsSupported.includes('S256')) {
    throw new Error('T3 OAuth server does not support required PKCE S256 challenge method');
  }

  return {
    url: normalizedUrl,
    resource,
    issuer: typeof asMeta.issuer === 'string' && asMeta.issuer.trim() ? asMeta.issuer.trim() : parsedAs.origin,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
    revocationEndpoint,
    grantTypesSupported: Array.isArray(asMeta.grant_types_supported) ? asMeta.grant_types_supported.map(String) : ['authorization_code'],
    scopesSupported: Array.isArray(asMeta.scopes_supported)
      ? asMeta.scopes_supported.map(String)
      : Array.isArray(prm?.scopes_supported)
        ? prm.scopes_supported.map(String)
        : [...DEFAULT_T3_OAUTH_SCOPES],
    codeChallengeMethodsSupported,
    authorizationResponseIssParameterSupported: asMeta.authorization_response_iss_parameter_supported === true
  };
}

export async function registerT3OAuthClient(
  metadata,
  redirectUri,
  { clientName = 'The Council CLI', fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS } = {}
) {
  if (!metadata?.registrationEndpoint) {
    throw new Error('T3 OAuth server does not advertise registration_endpoint for dynamic client registration');
  }
  const grantTypes = ['authorization_code'];
  if (Array.isArray(metadata.grantTypesSupported) && metadata.grantTypesSupported.includes('refresh_token')) {
    grantTypes.push('refresh_token');
  }
  const res = await fetchJsonSafe(
    metadata.registrationEndpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: [redirectUri],
        grant_types: grantTypes,
        response_types: ['code'],
        token_endpoint_auth_method: 'none'
      })
    },
    { fetchImpl, timeoutMs }
  );
  const clientId = typeof res.client_id === 'string' ? res.client_id.trim() : '';
  if (!clientId) {
    throw new Error('T3 OAuth dynamic client registration did not return client_id');
  }
  return {
    clientId,
    ...(typeof res.client_secret === 'string' && res.client_secret.trim() ? { clientSecret: res.client_secret.trim() } : {})
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length === 0 || bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function launchBrowserUrl(url) {
  try {
    let child;
    if (process.platform === 'darwin') {
      child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'win32') {
      child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
    child.on?.('error', () => {});
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}

function resolveScopes(requestedScopes, supportedScopes) {
  const base = Array.isArray(requestedScopes) && requestedScopes.length > 0
    ? requestedScopes.map((s) => String(s).trim()).filter(Boolean)
    : [...DEFAULT_T3_OAUTH_SCOPES];
  if (!Array.isArray(supportedScopes) || supportedScopes.length === 0) {
    return base;
  }
  const filtered = base.filter((s) => supportedScopes.includes(s));
  return filtered.length > 0 ? filtered : base;
}

function computeExpiresAt(expiresInSeconds) {
  if (typeof expiresInSeconds !== 'number' || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    return null;
  }
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

export async function refreshStoredT3Credential(
  mcpUrl,
  { storePath, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS } = {}
) {
  const normalizedUrl = normalizeT3EndpointUrl(mcpUrl);
  const entry = loadStoredT3Credential(normalizedUrl, { storePath });
  if (!entry || !entry.refreshToken || !entry.tokenEndpoint || !entry.clientId) {
    return null;
  }
  assertSafeOAuthUrl(entry.tokenEndpoint, 'token_endpoint');
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: entry.refreshToken,
    client_id: entry.clientId
  });
  if (entry.clientSecret) form.set('client_secret', entry.clientSecret);
  if (entry.resource) form.set('resource', entry.resource);

  let tokenRes;
  try {
    tokenRes = await fetchImpl(entry.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: form.toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return null;
  }

  if (!tokenRes.ok) {
    await tokenRes.body?.cancel?.().catch(() => {});
    return null;
  }
  let data;
  try {
    data = JSON.parse(await readBoundedText(tokenRes));
  } catch {
    return null;
  }
  const accessToken = typeof data?.access_token === 'string' ? data.access_token.trim() : '';
  if (!accessToken) {
    return null;
  }

  const resolvedStorePath = storePath ? path.resolve(storePath) : getDefaultT3TokenStorePath();
  return withTokenStoreLockSync(resolvedStorePath, () => {
    const store = readTokenStoreFile(resolvedStorePath);
    const current = store.endpoints[normalizedUrl];
    if (!current || !current.refreshToken) {
      return null;
    }
    if (current.clientId !== entry.clientId || current.obtainedAt !== entry.obtainedAt) {
      return current;
    }

    const updated = {
      ...entry,
      accessToken,
      refreshToken: typeof data.refresh_token === 'string' && data.refresh_token.trim()
        ? data.refresh_token.trim()
        : entry.refreshToken,
      scope: typeof data.scope === 'string' && data.scope.trim() ? data.scope.trim() : entry.scope,
      expiresAt: computeExpiresAt(data.expires_in) ?? entry.expiresAt ?? null,
      obtainedAt: new Date().toISOString()
    };
    store.endpoints[normalizedUrl] = updated;
    writeTokenStoreFile(resolvedStorePath, store);
    return updated;
  });
}

export async function loginT3OAuth(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_LOGIN_TIMEOUT_MS;
  const httpTimeoutMs = Math.min(timeoutMs, DEFAULT_HTTP_TIMEOUT_MS);
  const metadata = await discoverT3OAuthMetadata(options.url, {
    fetchImpl,
    timeoutMs: httpTimeoutMs
  });
  const scopes = resolveScopes(options.scopes, metadata.scopesSupported);

  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(24).toString('base64url');

  let server = null;
  let timer = null;
  let resolveAuth;
  let rejectAuth;
  const callbackPromise = new Promise((resolve, reject) => {
    resolveAuth = resolve;
    rejectAuth = reject;
  });
  callbackPromise.catch(() => {});

  let settled = false;
  const finishReject = (err) => {
    if (!settled) {
      settled = true;
      rejectAuth(err);
    }
  };
  const finishResolve = (val) => {
    if (!settled) {
      settled = true;
      resolveAuth(val);
    }
  };

  try {
    server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      if (reqUrl.pathname !== '/oauth/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      const returnedState = reqUrl.searchParams.get('state');
      const errorCode = reqUrl.searchParams.get('error');
      const errorDesc = reqUrl.searchParams.get('error_description');
      const code = reqUrl.searchParams.get('code');
      const issParam = reqUrl.searchParams.get('iss');

      if (!timingSafeEqualString(returnedState, state)) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body><h1>Authorization failed</h1><p>Invalid OAuth state.</p></body></html>');
        finishReject(new Error('T3 OAuth callback failed state validation'));
        return;
      }

      if (metadata.authorizationResponseIssParameterSupported && issParam !== metadata.issuer) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body><h1>Authorization failed</h1><p>Missing or mismatched issuer.</p></body></html>');
        finishReject(new Error(`T3 OAuth callback issuer validation failed (expected "${metadata.issuer}")`));
        return;
      }

      if (errorCode) {
        const detail = redactOAuthErrorText(
          errorDesc ? `${errorCode}: ${errorDesc}` : errorCode,
          [state, code]
        );
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body><h1>Authorization denied</h1><p>${escapeHtml(detail)}</p></body></html>`);
        finishReject(new Error(`T3 OAuth authorization error (${detail})`));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body><h1>Authorization failed</h1><p>Missing authorization code.</p></body></html>');
        finishReject(new Error('T3 OAuth callback did not include an authorization code'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1>The Council connected to T3 Code</h1><p>Authorization complete. You may close this tab and return to your terminal.</p></body></html>');
      finishResolve({ code });
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const registered = await registerT3OAuthClient(metadata, redirectUri, {
      clientName: options.clientName || 'The Council CLI',
      fetchImpl,
      timeoutMs: httpTimeoutMs
    });

    const authorizeUrl = new URL(metadata.authorizationEndpoint);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', registered.clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', scopes.join(' '));
    authorizeUrl.searchParams.set('resource', metadata.resource);

    if (typeof options.onAuthUrl === 'function') {
      options.onAuthUrl(authorizeUrl.toString());
    }
    if (options.noBrowser !== true) {
      if (typeof options.openBrowser === 'function') {
        await options.openBrowser(authorizeUrl.toString());
      } else {
        launchBrowserUrl(authorizeUrl.toString());
      }
    }

    timer = setTimeout(() => {
      finishReject(new Error(`T3 OAuth browser authorization timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    timer.unref?.();

    const { code } = await callbackPromise;

    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: registered.clientId,
      code_verifier: codeVerifier,
      resource: metadata.resource
    });
    if (registered.clientSecret) {
      form.set('client_secret', registered.clientSecret);
    }

    const tokenRes = await fetchJsonSafe(
      metadata.tokenEndpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json'
        },
        body: form.toString()
      },
      {
        fetchImpl,
        timeoutMs: httpTimeoutMs,
        secrets: [codeVerifier, code, state, registered.clientSecret]
      }
    );

    const accessToken = typeof tokenRes.access_token === 'string' ? tokenRes.access_token.trim() : '';
    if (!accessToken) {
      throw new Error('T3 OAuth token endpoint response did not include access_token');
    }

    const record = {
      accessToken,
      ...(typeof tokenRes.refresh_token === 'string' && tokenRes.refresh_token.trim()
        ? { refreshToken: tokenRes.refresh_token.trim() }
        : {}),
      tokenType: typeof tokenRes.token_type === 'string' ? tokenRes.token_type : 'Bearer',
      scope: typeof tokenRes.scope === 'string' && tokenRes.scope.trim() ? tokenRes.scope.trim() : scopes.join(' '),
      resource: metadata.resource,
      issuer: metadata.issuer,
      clientId: registered.clientId,
      ...(registered.clientSecret ? { clientSecret: registered.clientSecret } : {}),
      tokenEndpoint: metadata.tokenEndpoint,
      ...(metadata.revocationEndpoint ? { revocationEndpoint: metadata.revocationEndpoint } : {}),
      expiresAt: computeExpiresAt(tokenRes.expires_in),
      obtainedAt: new Date().toISOString()
    };

    const storePath = saveStoredT3Credential(metadata.url, record, { storePath: options.storePath });

    return {
      url: metadata.url,
      resource: record.resource,
      issuer: record.issuer,
      scope: record.scope,
      expiresAt: record.expiresAt,
      hasRefreshToken: Boolean(record.refreshToken),
      storePath
    };
  } finally {
    if (timer) clearTimeout(timer);
    if (server) {
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    }
  }
}

export async function logoutT3OAuth(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 10_000;
  const normalizedUrl = normalizeT3EndpointUrl(options.url);
  const storePath = options.storePath ? path.resolve(options.storePath) : getDefaultT3TokenStorePath();
  const entry = loadStoredT3Credential(normalizedUrl, { storePath });
  let revoked = false;

  if (entry?.revocationEndpoint && entry?.accessToken) {
    try {
      assertSafeOAuthUrl(entry.revocationEndpoint, 'revocation_endpoint');
      const form = new URLSearchParams({ token: entry.accessToken });
      if (entry.clientId) form.set('client_id', entry.clientId);
      const res = await fetchImpl(entry.revocationEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs)
      });
      await res.body?.cancel?.().catch(() => {});
      revoked = res.ok;
    } catch {
      revoked = false;
    }
  }

  const removed = deleteStoredT3Credential(normalizedUrl, { storePath });
  return {
    url: normalizedUrl,
    removed,
    revoked,
    storePath
  };
}

export function getT3AuthStatus({ url, storePath, env = process.env } = {}) {
  const normalizedUrl = normalizeT3EndpointUrl(url, env);
  const resolvedStorePath = storePath ? path.resolve(storePath) : getDefaultT3TokenStorePath(env);
  const envToken = typeof env?.T3_MCP_TOKEN === 'string' ? env.T3_MCP_TOKEN.trim() : '';
  if (envToken) {
    return {
      url: normalizedUrl,
      authenticated: true,
      source: 'env',
      scope: null,
      expiresAt: null,
      expired: false,
      hasRefreshToken: false,
      storePath: resolvedStorePath
    };
  }
  const entry = loadStoredT3Credential(normalizedUrl, { storePath: resolvedStorePath });
  if (!entry?.accessToken) {
    return {
      url: normalizedUrl,
      authenticated: false,
      source: 'none',
      scope: null,
      expiresAt: null,
      expired: false,
      hasRefreshToken: false,
      storePath: resolvedStorePath
    };
  }
  const expired = isT3CredentialExpired(entry, 0);
  return {
    url: normalizedUrl,
    authenticated: !expired || Boolean(entry.refreshToken),
    source: 'oauth-store',
    scope: entry.scope || null,
    expiresAt: entry.expiresAt || null,
    expired,
    hasRefreshToken: Boolean(entry.refreshToken),
    storePath: resolvedStorePath
  };
}
