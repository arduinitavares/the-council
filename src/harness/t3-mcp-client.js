/**
 * @fileoverview Zero-Dependency Streamable HTTP MCP (2025-06-18) Client for T3 Code.
 * Uses Node >= 22 built-in global fetch(). Zero npm dependencies.
 */

import {
  HarnessError,
  AuthenticationError,
  AbortError,
  QuotaExhaustionError,
  TimeoutError,
  HarnessExecutionError,
  PROVIDER_HTTP_429_REGEX,
  PROVIDER_HTTP_AUTH_REGEX
} from './adapter.js';
import { sliceUtf8Bytes, MAX_CLI_ERROR_MESSAGE_BYTES } from './telemetry-utils.js';
import {
  DEFAULT_T3_MCP_URL,
  isT3CredentialExpired,
  loadStoredT3Credential,
  refreshStoredT3Credential
} from './t3-oauth.js';

export { DEFAULT_T3_MCP_URL };
export const MCP_PROTOCOL_VERSION = '2025-06-18';
const MCP_ACCEPT_HEADER = 'application/json, text/event-stream';
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const NON_AUTH_STANDARD_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'content-type',
  'host',
  'mcp-protocol-version',
  'mcp-session-id',
  'origin',
  'pragma',
  'referer',
  'user-agent'
]);

function isPotentiallyCredentialHeader(name) {
  const norm = typeof name === 'string' ? name.trim().toLowerCase() : '';
  return Boolean(norm) && !NON_AUTH_STANDARD_HEADERS.has(norm);
}

/**
 * Returns true if hostname resolves strictly to local loopback.
 * @param {string} hostname
 * @returns {boolean}
 */
export function isLoopbackHostname(hostname) {
  const norm = String(hostname || '').trim().toLowerCase();
  return norm === '127.0.0.1' || norm === 'localhost' || norm === '::1' || norm === '[::1]';
}

/**
 * Redacts explicit tokens and Authorization/Bearer patterns from error/diagnostic strings.
 * @param {string} text
 * @param {string[]} [secrets=[]]
 * @returns {string}
 */
export function redactSecrets(text, secrets = []) {
  if (typeof text !== 'string' || !text) return '';
  let out = text.replace(/\b(Bearer\s+)[^\s"',;]+/gi, '$1[REDACTED]');
  out = out.replace(/(authorization\s*[:=]\s*)[^\r\n"',;]+/gi, '$1[REDACTED]');
  const orderedSecrets = [...secrets]
    .filter((s) => typeof s === 'string' && s.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const secret of orderedSecrets) {
    out = out.split(secret).join('[REDACTED]');
  }
  return sliceUtf8Bytes(out, MAX_CLI_ERROR_MESSAGE_BYTES);
}

function isAbortLike(err) {
  return Boolean(
    err &&
      typeof err === 'object' &&
      (err.name === 'AbortError' || err.code === 'ABORT_ERR' || err instanceof AbortError)
  );
}

async function readBoundedText(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new HarnessExecutionError(`T3 MCP response exceeded ${maxBytes} byte cap`, {
        harness: 't3',
        code: 'T3_RESPONSE_TOO_LARGE',
        isRetryable: false,
        exitCode: null,
        signal: null
      });
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let totalBytes = 0;
  let out = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new HarnessExecutionError(`T3 MCP response exceeded ${maxBytes} byte cap`, {
          harness: 't3',
          code: 'T3_RESPONSE_TOO_LARGE',
          isRetryable: false,
          exitCode: null,
          signal: null
        });
      }
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return out;
  } finally {
    reader.releaseLock?.();
  }
}

async function parseSseJsonRpcStream(response, expectedId, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new HarnessExecutionError('T3 MCP SSE response has no readable body', {
      harness: 't3',
      code: 'T3_SSE_EMPTY',
      exitCode: null,
      signal: null
    });
  }
  const decoder = new TextDecoder('utf-8');
  let totalBytes = 0;
  let buffer = '';
  let dataLines = [];

  const flushEvent = () => {
    if (dataLines.length === 0) return null;
    const raw = dataLines.join('\n').trim();
    dataLines = [];
    if (!raw || raw === '[DONE]') return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      Object.prototype.hasOwnProperty.call(parsed, 'id') &&
      parsed.id === expectedId
    ) {
      return parsed;
    }
    return null;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new HarnessExecutionError(`T3 MCP SSE stream exceeded ${maxBytes} byte cap`, {
          harness: 't3',
          code: 'T3_RESPONSE_TOO_LARGE',
          isRetryable: false,
          exitCode: null,
          signal: null
        });
      }
      buffer += decoder.decode(value, { stream: true });
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line === '') {
          const match = flushEvent();
          if (match) {
            await reader.cancel().catch(() => {});
            return match;
          }
          continue;
        }
        if (line.startsWith(':')) continue;
        if (line.startsWith('data:')) {
          const val = line.slice(5);
          dataLines.push(val.startsWith(' ') ? val.slice(1) : val);
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) {
      const tail = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
      if (tail.startsWith('data:')) {
        const val = tail.slice(5);
        dataLines.push(val.startsWith(' ') ? val.slice(1) : val);
      }
    }
    const finalMatch = flushEvent();
    if (finalMatch) return finalMatch;
    throw new HarnessExecutionError(`T3 MCP SSE stream ended without JSON-RPC response for id ${expectedId}`, {
      harness: 't3',
      code: 'T3_SSE_MISSING_RESPONSE',
      exitCode: null,
      signal: null
    });
  } finally {
    reader.releaseLock?.();
  }
}

function extractToolPayload(result) {
  if (!result || typeof result !== 'object') return result;
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }
  if (Array.isArray(result.content)) {
    const textChunks = result.content
      .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text);
    const joined = textChunks.join('\n').trim();
    if (!joined) return {};
    try {
      return JSON.parse(joined);
    } catch {
      return { text: joined, content: result.content };
    }
  }
  return result;
}

function extractToolErrorText(result) {
  if (!result || typeof result !== 'object') return 'T3 MCP tool returned an error';
  if (Array.isArray(result.content)) {
    const text = result.content
      .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join(' ');
    if (text) return text;
  }
  if (typeof result.message === 'string' && result.message.trim()) return result.message.trim();
  return 'T3 MCP tool returned isError: true';
}

export class T3McpClient {
  constructor(options = {}) {
    this.url = String(options.url || process.env.T3_MCP_URL || DEFAULT_T3_MCP_URL).trim();
    this._explicitTokenProvided = options.token !== undefined;
    this._token =
      options.token !== undefined ? String(options.token || '').trim() : String(process.env.T3_MCP_TOKEN || '').trim();
    this._tokenStorePath = options.tokenStorePath;
    this._useTokenStore = options.useTokenStore !== undefined ? Boolean(options.useTokenStore) : true;
    this._headersProvider = options.headers || null;
    this._clientInfo = options.clientInfo || { name: 'the-council', version: '0.1.0' };
    this.protocolVersion = options.protocolVersion || MCP_PROTOCOL_VERSION;
    this.negotiatedProtocolVersion = null;
    this._fetch = options.fetchImpl || globalThis.fetch;
    this._injectedCallTool = typeof options.callTool === 'function' ? options.callTool : null;
    this._maxResponseBytes = options.maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES;
    this._requestTimeoutMs = options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    this.sessionId = null;
    this._initialized = false;
    this._initInfo = null;
    this._initPromise = null;
    this._refreshPromise = null;
    this._nextId = 1;
  }

  async _resolveStoredToken({ forceRefresh = false } = {}) {
    if (this._explicitTokenProvided || this._token || !this._useTokenStore) {
      return '';
    }
    const entry = loadStoredT3Credential(this.url, { storePath: this._tokenStorePath });
    if (!entry?.accessToken) {
      return '';
    }
    const expired = isT3CredentialExpired(entry);
    if ((forceRefresh || expired) && entry.refreshToken) {
      if (!this._refreshPromise) {
        this._refreshPromise = refreshStoredT3Credential(this.url, {
          storePath: this._tokenStorePath,
          fetchImpl: this._fetch
        }).finally(() => {
          this._refreshPromise = null;
        });
      }
      const refreshed = await this._refreshPromise;
      if (refreshed?.accessToken) {
        return refreshed.accessToken;
      }
      if (forceRefresh || expired) {
        return '';
      }
    }
    if (expired) {
      return '';
    }
    return entry.accessToken;
  }

  _collectSecrets(extraHeaders = {}) {
    const secrets = [];
    if (this._token) secrets.push(this._token);
    for (const [k, v] of Object.entries(extraHeaders || {})) {
      if (isPotentiallyCredentialHeader(k) && typeof v === 'string' && v.trim()) {
        const trimmed = v.trim();
        secrets.push(trimmed);
        const bearerMatch = /^Bearer\s+(.+)$/i.exec(trimmed);
        if (bearerMatch?.[1]) secrets.push(bearerMatch[1].trim());
      }
    }
    return secrets;
  }

  async _resolveAuthHeaders({ forceRefresh = false } = {}) {
    const custom =
      typeof this._headersProvider === 'function'
        ? await this._headersProvider()
        : this._headersProvider && typeof this._headersProvider === 'object'
          ? { ...this._headersProvider }
          : {};
    const headers = {};
    let hasAuth = false;
    let hasAuthorizationHeader = false;
    let usedStoredToken = false;
    for (const [k, v] of Object.entries(custom || {})) {
      if (k.trim().toLowerCase() === 'authorization') {
        hasAuthorizationHeader = true;
      }
      if (v === undefined || v === null) continue;
      const strVal = String(v);
      if (strVal.trim() === '') continue;
      headers[k] = strVal;
      if (isPotentiallyCredentialHeader(k)) {
        hasAuth = true;
      }
    }
    if (!hasAuthorizationHeader) {
      if (this._token) {
        headers.Authorization = `Bearer ${this._token}`;
        hasAuth = true;
      } else {
        const storedToken = await this._resolveStoredToken({ forceRefresh });
        if (storedToken) {
          headers.Authorization = `Bearer ${storedToken}`;
          hasAuth = true;
          usedStoredToken = true;
        }
      }
    }
    return { headers, hasAuth, usedStoredToken };
  }

  _assertSafeUrl(hasAuth, authHeaders = {}) {
    let parsed;
    try {
      parsed = new URL(this.url);
    } catch {
      throw new HarnessExecutionError(`Invalid T3 MCP URL "${redactSecrets(this.url, this._collectSecrets(authHeaders))}"`, {
        harness: 't3',
        code: 'INVALID_T3_MCP_URL',
        isRetryable: false,
        exitCode: null,
        signal: null
      });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new HarnessExecutionError(`Unsupported T3 MCP URL scheme "${parsed.protocol}"`, {
        harness: 't3',
        code: 'INVALID_T3_MCP_URL',
        isRetryable: false,
        exitCode: null,
        signal: null
      });
    }
    if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname) && hasAuth) {
      throw new HarnessExecutionError(
        `Refusing to send T3 MCP credentials over cleartext non-loopback URL "${parsed.origin}"`,
        {
          harness: 't3',
          code: 'INSECURE_T3_MCP_URL',
          isRetryable: false,
          exitCode: null,
          signal: null
        }
      );
    }
  }

  _classifyTransportError(err, { signal, timeoutSig, secrets = [] } = {}) {
    if (signal?.aborted) {
      return new AbortError('T3 MCP HTTP request aborted', {
        harness: 't3',
        exitCode: null,
        signal: null
      });
    }
    if (timeoutSig?.aborted || err?.name === 'TimeoutError') {
      return new TimeoutError(`T3 MCP HTTP request timed out after ${this._requestTimeoutMs}ms`, {
        harness: 't3',
        timeoutMs: this._requestTimeoutMs,
        exitCode: null,
        signal: null
      });
    }
    if (isAbortLike(err)) {
      return new AbortError(redactSecrets(err.message || 'T3 MCP request aborted', secrets), {
        harness: 't3',
        exitCode: null,
        signal: null
      });
    }
    return new HarnessExecutionError(
      redactSecrets(`T3 MCP request failed: ${err?.message || String(err)}`, secrets),
      { harness: 't3', code: 'MCP_NETWORK_ERROR', isRetryable: false, exitCode: null, signal: null }
    );
  }

  _classifyProtocolError(message, { code, status, secrets = [], isToolError = false } = {}) {
    const clean = redactSecrets(String(message || 'T3 MCP error'), secrets);
    if (
      status === 401 ||
      status === 403 ||
      code === 'INVALID_MCP_CREDENTIAL' ||
      PROVIDER_HTTP_AUTH_REGEX.test(clean) ||
      /\binvalid_mcp_credential|unauthorized|unauthenticated|permission_denied\b/i.test(clean)
    ) {
      return new AuthenticationError(clean, {
        harness: 't3',
        code: code || 'INVALID_MCP_CREDENTIAL',
        envelopeError: clean,
        exitCode: null,
        signal: null
      });
    }
    if (
      status === 429 ||
      PROVIDER_HTTP_429_REGEX.test(clean) ||
      /\bquota\b|rate[\s_-]*limit|resource_exhausted|overloaded_error/i.test(clean)
    ) {
      return new QuotaExhaustionError(clean, {
        harness: 't3',
        code: code || (isToolError ? 'MCP_TOOL_QUOTA' : 'MCP_HTTP_429'),
        envelopeError: clean,
        exitCode: null,
        signal: null
      });
    }
    return new HarnessExecutionError(clean, {
      harness: 't3',
      code: code || (isToolError ? 'MCP_TOOL_ERROR' : 'MCP_TRANSPORT_ERROR'),
      envelopeError: clean,
      isRetryable: status === 502 || status === 503 || status === 504,
      exitCode: null,
      signal: null
    });
  }

  async _postJsonRpc(payload, { signal, includeSession = true, isNotification = false, retriedAuth = false } = {}) {
    const { headers: authHeaders, hasAuth, usedStoredToken } = await this._resolveAuthHeaders();
    this._assertSafeUrl(hasAuth, authHeaders);
    const secrets = this._collectSecrets(authHeaders);

    const reqHeaders = {
      ...authHeaders,
      'Content-Type': 'application/json',
      Accept: MCP_ACCEPT_HEADER
    };
    if (includeSession && this.sessionId) {
      reqHeaders['Mcp-Session-Id'] = this.sessionId;
    }
    if (this.negotiatedProtocolVersion || includeSession) {
      reqHeaders['MCP-Protocol-Version'] = this.negotiatedProtocolVersion || this.protocolVersion;
    }

    const timeoutSig = AbortSignal.timeout(this._requestTimeoutMs);
    const fetchSignal = signal ? AbortSignal.any([signal, timeoutSig]) : timeoutSig;
    const fetchFn = this._fetch;

    let res;
    try {
      res = await fetchFn(this.url, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(payload),
        signal: fetchSignal,
        ...(hasAuth ? { redirect: 'error' } : {})
      });
    } catch (err) {
      throw this._classifyTransportError(err, { signal, timeoutSig, secrets });
    }

    const returnedSessionId = res.headers?.get?.('mcp-session-id');
    if (res.status === 401 || res.status === 403) {
      if (res.status === 401 && usedStoredToken && !retriedAuth) {
        await res.body?.cancel?.().catch(() => {});
        const refreshed = await this._resolveStoredToken({ forceRefresh: true });
        if (refreshed) {
          return await this._postJsonRpc(payload, {
            signal,
            includeSession,
            isNotification,
            retriedAuth: true
          });
        }
      }
      const errText = await readBoundedText(res, Math.min(this._maxResponseBytes, 16_384)).catch(() => '');
      let parsedErr = null;
      try {
        parsedErr = errText ? JSON.parse(errText) : null;
      } catch {
        parsedErr = null;
      }
      const code = parsedErr?.error === 'invalid_mcp_credential' ? 'INVALID_MCP_CREDENTIAL' : `HTTP_${res.status}`;
      const detail = parsedErr?.message || errText || `HTTP ${res.status} authentication failed`;
      const hint = res.status === 401
        ? ' Run "council login t3" (or set T3_MCP_TOKEN) to authenticate with T3 Code.'
        : '';
      throw this._classifyProtocolError(`HTTP ${res.status} (${code}): ${detail}${hint}`, {
        code,
        status: res.status,
        secrets
      });
    }

    if (res.status === 404) {
      const errText = await readBoundedText(res, Math.min(this._maxResponseBytes, 8192)).catch(() => '');
      const err = new HarnessExecutionError(
        redactSecrets(`T3 MCP HTTP 404 session not found: ${errText}`.trim(), secrets),
        { harness: 't3', code: 'MCP_SESSION_NOT_FOUND', exitCode: null, signal: null }
      );
      err.httpStatus = 404;
      throw err;
    }

    if (isNotification && (res.status === 202 || res.status === 204 || res.status === 200)) {
      await res.body?.cancel?.().catch(() => {});
      return { sessionId: returnedSessionId, message: null, secrets };
    }

    if (!res.ok) {
      const errText = await readBoundedText(res, Math.min(this._maxResponseBytes, 16_384)).catch(() => '');
      throw this._classifyProtocolError(`T3 MCP HTTP ${res.status}: ${errText || res.statusText}`, {
        code: `HTTP_${res.status}`,
        status: res.status,
        secrets
      });
    }

    const contentType = String(res.headers?.get?.('content-type') || '').toLowerCase();
    let message;
    try {
      if (contentType.includes('text/event-stream')) {
        message = await parseSseJsonRpcStream(res, payload.id, this._maxResponseBytes);
      } else {
        const rawText = await readBoundedText(res, this._maxResponseBytes);
        if (!rawText.trim()) {
          message = null;
        } else {
          try {
            message = JSON.parse(rawText);
          } catch (parseErr) {
            throw new HarnessExecutionError(
              redactSecrets(`Invalid JSON from T3 MCP server: ${parseErr.message}`, secrets),
              { harness: 't3', code: 'MCP_INVALID_JSON', exitCode: null, signal: null }
            );
          }
        }
      }
    } catch (err) {
      if (err instanceof HarnessError) throw err;
      throw this._classifyTransportError(err, { signal, timeoutSig, secrets });
    }

    if (message?.error) {
      const rpcMsg = message.error.message || JSON.stringify(message.error);
      throw this._classifyProtocolError(`T3 MCP JSON-RPC error (${message.error.code ?? 'unknown'}): ${rpcMsg}`, {
        code: 'MCP_JSONRPC_ERROR',
        secrets
      });
    }

    return { sessionId: returnedSessionId, message, secrets };
  }

  async initialize({ signal } = {}) {
    if (this._injectedCallTool) {
      this._initialized = true;
      return { protocolVersion: this.protocolVersion, sessionId: null, injected: true };
    }
    if (this._initialized) {
      return this._initInfo;
    }
    if (signal?.aborted) {
      throw new AbortError('T3 MCP initialize aborted', { harness: 't3', exitCode: null, signal: null });
    }
    if (!this._initPromise) {
      this._initPromise = (async () => {
        try {
          const id = this._nextId++;
          const { sessionId, message } = await this._postJsonRpc(
            {
              jsonrpc: '2.0',
              id,
              method: 'initialize',
              params: {
                protocolVersion: this.protocolVersion,
                capabilities: {},
                clientInfo: this._clientInfo
              }
            },
            { includeSession: false }
          );
          this.sessionId = sessionId || null;
          this.negotiatedProtocolVersion = message?.result?.protocolVersion || this.protocolVersion;

          await this._postJsonRpc(
            {
              jsonrpc: '2.0',
              method: 'notifications/initialized'
            },
            { includeSession: true, isNotification: true }
          );

          this._initInfo = {
            protocolVersion: this.negotiatedProtocolVersion,
            sessionId: this.sessionId,
            serverInfo: message?.result?.serverInfo || null
          };
          this._initialized = true;
          return this._initInfo;
        } catch (err) {
          this.sessionId = null;
          this.negotiatedProtocolVersion = null;
          this._initialized = false;
          this._initInfo = null;
          throw err;
        }
      })().finally(() => {
        this._initPromise = null;
      });
    }

    if (!signal) {
      return this._initPromise;
    }
    return new Promise((resolve, reject) => {
      const onAbort = () =>
        reject(new AbortError('T3 MCP initialize aborted', { harness: 't3', exitCode: null, signal: null }));
      signal.addEventListener('abort', onAbort, { once: true });
      this._initPromise.then(
        (val) => {
          signal.removeEventListener('abort', onAbort);
          resolve(val);
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        }
      );
    });
  }

  async callTool(name, args = {}, { signal } = {}) {
    if (signal?.aborted) {
      throw new AbortError(`T3 MCP tool "${name}" aborted`, { harness: 't3', exitCode: null, signal: null });
    }
    if (this._injectedCallTool) {
      const raw = await this._injectedCallTool(name, args, { signal });
      if (raw && typeof raw === 'object' && raw.isError === true) {
        let authHeaders = {};
        try {
          ({ headers: authHeaders } = await this._resolveAuthHeaders());
        } catch {
          authHeaders = {};
        }
        throw this._classifyProtocolError(extractToolErrorText(raw), {
          secrets: this._collectSecrets(authHeaders),
          isToolError: true
        });
      }
      return raw && typeof raw === 'object' && (Array.isArray(raw.content) || raw.structuredContent !== undefined)
        ? extractToolPayload(raw)
        : raw;
    }

    await this.initialize({ signal });
    const attemptedSessionId = this.sessionId;

    const invokeOnce = async () => {
      const id = this._nextId++;
      const { message, secrets } = await this._postJsonRpc(
        {
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name, arguments: args }
        },
        { signal, includeSession: true }
      );
      const result = message?.result;
      if (result?.isError === true) {
        throw this._classifyProtocolError(extractToolErrorText(result), {
          secrets,
          isToolError: true
        });
      }
      return extractToolPayload(result);
    };

    try {
      return await invokeOnce();
    } catch (err) {
      if (err?.httpStatus === 404 || err?.code === 'MCP_SESSION_NOT_FOUND') {
        if (this.sessionId === attemptedSessionId) {
          this.sessionId = null;
          this.negotiatedProtocolVersion = null;
          this._initialized = false;
          this._initInfo = null;
        }
        await this.initialize({ signal });
        return await invokeOnce();
      }
      throw err;
    }
  }

  async healthCheck({ signal } = {}) {
    const t0 = Date.now();
    try {
      await this.initialize({ signal });
      const capabilities = await this.callTool('orchestrator_capabilities', {}, { signal });
      return {
        ok: true,
        latencyMs: Math.max(0, Date.now() - t0),
        capabilities
      };
    } catch (err) {
      let authHeaders = {};
      try {
        ({ headers: authHeaders } = await this._resolveAuthHeaders());
      } catch {
        authHeaders = {};
      }
      const secrets = this._collectSecrets(authHeaders);
      return {
        ok: false,
        latencyMs: Math.max(0, Date.now() - t0),
        error: redactSecrets(err?.message || String(err), secrets),
        errorClass: err?.name || 'HarnessExecutionError',
        ...(err?.code ? { code: err.code } : {})
      };
    }
  }

  async close() {
    this.sessionId = null;
    this.negotiatedProtocolVersion = null;
    this._initialized = false;
    this._initInfo = null;
    this._initPromise = null;
  }
}
