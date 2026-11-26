/**
 * @fileoverview T3 MCP Harness Adapter for The Council (ADR-0005).
 * Dispatches one fresh T3 thread per Seat or Judge attempt via Streamable HTTP MCP.
 * Node >= 22 ESM. Zero external dependencies.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  HarnessAdapter,
  AbortError,
  QuotaExhaustionError,
  HarnessExecutionError,
  HeadlessToolDeniedError,
  PROVIDER_HTTP_429_REGEX,
  resolveAttemptExecutionWorkspace,
  captureAttemptInvocationMeta,
  registerAttemptPrompt,
  isReservedClassificationError
} from './adapter.js';
import { parseModelAndEffort, extractCanonicalBaseModel } from './model-utils.js';
import {
  getActiveAttemptTelemetryGate,
  detectBasicForbiddenCouncilAccess,
  sliceUtf8Bytes
} from './telemetry-utils.js';
import { T3McpClient, redactSecrets } from './t3-mcp-client.js';
import {
  formatClarificationPrompt,
  formatDeliberationPrompt,
  formatVotingPrompt,
  formatJudgePrompt as formatJudgeSoulPrompt,
  resolvePriorAdmittedProofs
} from '../seats/soul.js';

export const MAX_T3_PROMPT_CHARS = 120_000;
const DEFAULT_WAIT_SLICE_MS = 45_000;
const DEFAULT_INTERRUPT_TIMEOUT_MS = 1_500;
const DEFAULT_READ_MAX_CHARS_PER_ITEM = 20_000;
const DEFAULT_MAX_READ_PAGES = 20;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

const TERMINAL_FAILED_STATUSES = new Set([
  'failed',
  'error',
  'errored',
  'cancelled',
  'canceled',
  'interrupted',
  'stopped',
  'aborted'
]);

/**
 * Static T3 capability fallback table used for synchronous pre-healthCheck validateModel()
 * and option-key translation across codex, antigravity, and cursor.
 */
export const STATIC_T3_CAPABILITIES = Object.freeze({
  codex: Object.freeze({
    'gpt-6.2-sol': Object.freeze({ optionKey: 'reasoningEffort', efforts: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']) }),
    'gpt-6.2-astra': Object.freeze({ optionKey: 'reasoningEffort', efforts: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']) }),
    'gpt-6.1-terra': Object.freeze({ optionKey: 'reasoningEffort', efforts: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']) }),
    'gpt-6.1-sol': Object.freeze({ optionKey: 'reasoningEffort', efforts: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']) }),
    'gpt-6-astra': Object.freeze({ optionKey: 'reasoningEffort', efforts: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']) }),
    'gpt-6-luna': Object.freeze({ optionKey: 'reasoningEffort', efforts: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']) })
  }),
  antigravity: Object.freeze({
    'gemini-4-neon': Object.freeze({ optionKey: 'thought_level', efforts: Object.freeze(['low', 'medium', 'high', 'xhigh']) }),
    'gemini-4-hydrogen': Object.freeze({ optionKey: 'thought_level', efforts: Object.freeze(['low', 'medium', 'high', 'xhigh']) }),
    'gemini-pro-orchestrator-neon': Object.freeze({ optionKey: null, efforts: null }),
    'claude-opus-5-5': Object.freeze({ optionKey: 'thought_level', efforts: Object.freeze(['low', 'medium', 'high']) }),
    'claude-sonnet-5-5': Object.freeze({ optionKey: 'thought_level', efforts: Object.freeze(['low', 'medium', 'high']) }),
    'gemini-4-argon': Object.freeze({ optionKey: 'thought_level', efforts: Object.freeze(['low', 'medium', 'high']) }),
    'gemini-4-carbon': Object.freeze({ optionKey: 'thought_level', efforts: Object.freeze(['low', 'medium', 'high']) })
  }),
  cursor: Object.freeze({
    'grok-4.7': Object.freeze({ optionKey: 'reasoning_effort', efforts: Object.freeze(['low', 'medium', 'high', 'xhigh']) }),
    'grok-4.6': Object.freeze({ optionKey: 'effort', efforts: Object.freeze(['low', 'medium', 'high']) }),
    'composer-2.5': Object.freeze({ optionKey: null, efforts: null }),
    'gemini-4-neon': Object.freeze({ optionKey: 'reasoning_effort', efforts: Object.freeze(['low', 'medium', 'high', 'xhigh']) }),
    'gemini-4-hydrogen': Object.freeze({ optionKey: 'reasoning_effort', efforts: Object.freeze(['low', 'medium', 'high', 'xhigh']) }),
    'muse-wonder-1.0': Object.freeze({ optionKey: null, efforts: null })
  })
});

function defaultOptionKeyForProvider(provider, baseModel) {
  if (baseModel === 'composer-2.5' || baseModel === 'gemini-pro-orchestrator-neon' || baseModel === 'muse-wonder-1.0') {
    return null;
  }
  if (provider === 'codex') return 'reasoningEffort';
  if (provider === 'antigravity') return 'thought_level';
  if (provider === 'cursor') return baseModel === 'grok-4.6' ? 'effort' : 'reasoning_effort';
  return 'reasoningEffort';
}

function normalizePathSafe(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return '';
  const resolved = path.resolve(rawPath.trim());
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

const KNOWN_EFFORT_OPTION_KEYS = Object.freeze([
  'reasoningEffort',
  'thought_level',
  'reasoning_effort',
  'effort'
]);

const ACTIVITY_OUTPUT_SECTION_REGEX =
  /\r?\n\s*(?:output|stdout|stderr|result|response|aggregated_output)\s*:/i;
const ACTIVITY_LEADING_OUTPUT_REGEX =
  /^(?:output|stdout|stderr|result|response|aggregated_output)\s*:/i;
const MAX_ACTIVITY_INPUT_SUMMARY_BYTES = 512;
const ALLOWED_ACTIVITY_METADATA_KEYS = Object.freeze([
  'id',
  'type',
  'kind',
  'toolName',
  'tool',
  'command',
  'arguments',
  'input'
]);

function normalizeOptionValues(rawValues) {
  if (!Array.isArray(rawValues)) return undefined;
  return rawValues
    .map((v) =>
      String(typeof v === 'object' && v !== null ? (v.value ?? v.id ?? '') : v)
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);
}

function normalizeModelDescriptor(provider, entry) {
  if (typeof entry === 'string') {
    const id = entry.trim().toLowerCase();
    const staticEntry = STATIC_T3_CAPABILITIES[provider]?.[id];
    return id
      ? [
          id,
          {
            optionKey: staticEntry ? staticEntry.optionKey : defaultOptionKeyForProvider(provider, id),
            efforts: staticEntry ? (staticEntry.efforts ? [...staticEntry.efforts] : null) : null
          }
        ]
      : null;
  }
  if (!entry || typeof entry !== 'object') return null;
  const id = String(entry.model || entry.id || entry.slug || '').trim().toLowerCase();
  if (!id) return null;

  let optionKey =
    entry.optionKey !== undefined
      ? entry.optionKey
      : (entry.effortOptionKey !== undefined ? entry.effortOptionKey : undefined);
  let efforts = Array.isArray(entry.efforts)
    ? entry.efforts.map((e) => String(e).trim().toLowerCase())
    : (entry.efforts === null ? null : undefined);

  if (Array.isArray(entry.options)) {
    let matchedKey = null;
    let matchedEfforts = undefined;
    for (const k of KNOWN_EFFORT_OPTION_KEYS) {
      const opt = entry.options.find(
        (item) => item && typeof item === 'object' && (item.id === k || item.key === k || item.name === k)
      );
      if (opt) {
        matchedKey = k;
        matchedEfforts = normalizeOptionValues(opt.values ?? opt.enum ?? opt.options);
        break;
      }
    }
    if (matchedKey !== null) {
      optionKey = matchedKey;
      if (matchedEfforts !== undefined) {
        efforts = matchedEfforts;
      }
    } else {
      if (optionKey === undefined) optionKey = null;
      if (efforts === undefined) efforts = null;
    }
  } else if (entry.options && typeof entry.options === 'object') {
    for (const k of KNOWN_EFFORT_OPTION_KEYS) {
      if (Object.prototype.hasOwnProperty.call(entry.options, k)) {
        optionKey = k;
        const optDef = entry.options[k];
        const vals = normalizeOptionValues(
          Array.isArray(optDef) ? optDef : (optDef?.values ?? optDef?.enum ?? optDef?.options)
        );
        if (vals !== undefined) {
          efforts = vals;
        }
        break;
      }
    }
  }

  const staticEntry = STATIC_T3_CAPABILITIES[provider]?.[id];
  if (optionKey === undefined) {
    optionKey = staticEntry ? staticEntry.optionKey : defaultOptionKeyForProvider(provider, id);
  }
  if (efforts === undefined) {
    efforts = optionKey === null ? null : (staticEntry?.efforts ? [...staticEntry.efforts] : ['low', 'medium', 'high', 'xhigh']);
  }
  return [id, { optionKey, efforts }];
}

function normalizeCapabilitiesPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const byProvider = {};
  const list = Array.isArray(raw.providers)
    ? raw.providers
    : (Array.isArray(raw) ? raw : null);

  if (list) {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const prov = String(
        item.providerInstanceId || item.driverKind || item.provider || item.id || item.name || ''
      )
        .trim()
        .toLowerCase();
      if (!prov) continue;
      const models = {};
      for (const m of Array.isArray(item.models) ? item.models : []) {
        const norm = normalizeModelDescriptor(prov, m);
        if (norm) models[norm[0]] = norm[1];
      }
      byProvider[prov] = {
        canRunChildTask: item.canRunChildTask !== false,
        models
      };
    }
    return byProvider;
  }

  const sourceMap =
    raw.providers && typeof raw.providers === 'object' && !Array.isArray(raw.providers)
      ? raw.providers
      : raw;

  for (const [k, v] of Object.entries(sourceMap)) {
    const prov = k.trim().toLowerCase();
    if (!v || typeof v !== 'object') continue;
    const models = {};
    if (Array.isArray(v.models)) {
      for (const m of v.models) {
        const norm = normalizeModelDescriptor(prov, m);
        if (norm) models[norm[0]] = norm[1];
      }
    } else if (v.models && typeof v.models === 'object') {
      for (const [mid, mval] of Object.entries(v.models)) {
        const norm = normalizeModelDescriptor(prov, { model: mid, ...(typeof mval === 'object' ? mval : {}) });
        if (norm) models[norm[0]] = norm[1];
      }
    }
    byProvider[prov] = { canRunChildTask: v.canRunChildTask !== false, models };
  }
  return Object.keys(byProvider).length > 0 ? byProvider : null;
}

function hasInlineEffortSyntax(modelString) {
  const trimmed = String(modelString || '').trim();
  return /\([^)]*\)\s*$/.test(trimmed) || /-(?:low|medium|high|xhigh|max)$/i.test(trimmed);
}

function extractActivityTextInput(text) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  const match = ACTIVITY_OUTPUT_SECTION_REGEX.exec(trimmed);
  const inputPart = match ? trimmed.slice(0, match.index).trim() : trimmed;
  if (!inputPart || ACTIVITY_LEADING_OUTPUT_REGEX.test(inputPart)) {
    return '';
  }
  return inputPart;
}

function isActivityToolItem(item) {
  if (!item || typeof item !== 'object') return false;
  const kind = String(item.kind || item.type || '').toLowerCase();
  if (kind === 'user' || kind === 'user_message' || kind === 'assistant' || kind === 'assistant_message') {
    return false;
  }
  return Boolean(
    kind.includes('tool') ||
      kind.includes('command') ||
      kind.includes('exec') ||
      kind.includes('file') ||
      kind.includes('shell') ||
      kind.includes('bash') ||
      kind.includes('mcp') ||
      item.toolName ||
      item.tool ||
      item.command ||
      item.arguments !== undefined ||
      item.input !== undefined
  );
}

function extractActivityToolCalls(items) {
  const toolCalls = [];
  const forbiddenScanEntries = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!isActivityToolItem(item)) continue;
    const sanitized = {};
    for (const key of ALLOWED_ACTIVITY_METADATA_KEYS) {
      if (item[key] !== undefined) {
        sanitized[key] = item[key];
      }
    }
    const textInput = extractActivityTextInput(item.text);
    if (textInput) {
      sanitized.inputSummary = sliceUtf8Bytes(
        redactSecrets(textInput),
        MAX_ACTIVITY_INPUT_SUMMARY_BYTES
      );
    }
    toolCalls.push(sanitized);

    const scanEntry = {};
    if (item.command !== undefined) scanEntry.command = item.command;
    if (item.arguments !== undefined) scanEntry.arguments = item.arguments;
    if (item.input !== undefined) scanEntry.input = item.input;
    if (textInput) scanEntry.inputSummary = textInput;
    if (Object.keys(scanEntry).length > 0) {
      forbiddenScanEntries.push(scanEntry);
    }
  }
  return { toolCalls, forbiddenScanEntries };
}

export class T3HarnessAdapter extends HarnessAdapter {
  constructor(config = {}) {
    const provider = String(config.provider || config.name || 'codex').trim().toLowerCase();
    super({ ...config, name: provider });
    this.provider = provider;
    this.mcpClient =
      config.mcpClient ||
      new T3McpClient({
        url: config.url,
        token: config.token,
        headers: config.headers,
        fetchImpl: config.fetchImpl,
        callTool: config.callTool
      });
    this._ownsMcpClient = !config.mcpClient;
    this.projectId = config.projectId || null;
    this.environmentId = config.environmentId || undefined;
    this.archiveThreads = config.archiveThreads !== undefined ? Boolean(config.archiveThreads) : true;
    this.waitSliceMs = config.waitSliceMs || DEFAULT_WAIT_SLICE_MS;
    this.interruptTimeoutMs = config.interruptTimeoutMs ?? DEFAULT_INTERRUPT_TIMEOUT_MS;
    this.maxReadPages = config.maxReadPages || DEFAULT_MAX_READ_PAGES;
    this.maxResponseBytes = config.maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES;
    this._capabilitiesByProvider = config.capabilities ? normalizeCapabilitiesPayload(config.capabilities) : null;
    this._projectsCache = Array.isArray(config.projects) ? config.projects : null;
  }

  setCapabilities(rawCapabilities) {
    this._capabilitiesByProvider = normalizeCapabilitiesPayload(rawCapabilities);
    return this._capabilitiesByProvider;
  }

  setProjects(projects) {
    this._projectsCache = Array.isArray(projects) ? projects : null;
    return this._projectsCache;
  }

  isProviderAvailable() {
    if (this._capabilitiesByProvider === null) return true;
    const provCap = this._capabilitiesByProvider[this.provider];
    return Boolean(provCap && provCap.canRunChildTask !== false);
  }

  getVerifiedCapabilities() {
    const providerCap = this._capabilitiesByProvider?.[this.provider];
    if (!providerCap || providerCap.canRunChildTask === false || !providerCap.models) return null;
    const models = {};
    const selectors = [];
    for (const [modelId, desc] of Object.entries(providerCap.models)) {
      models[modelId] = { efforts: Array.isArray(desc.efforts) ? [...desc.efforts] : null };
      if (Array.isArray(desc.efforts)) {
        for (const eff of desc.efforts) {
          selectors.push(this.provider === 'codex' ? `${modelId} (${eff})` : `${modelId}-${eff}`);
        }
      } else {
        selectors.push(modelId);
      }
    }
    return { source: 'live_cli_catalog', models, selectors };
  }

  _canonicalBaseModel(model, defaultEffort = 'high') {
    let baseModel = extractCanonicalBaseModel(model, defaultEffort);
    if (this.provider === 'antigravity' && /^claude-(sonnet|opus)-5-5-\d{8}$/.test(baseModel)) {
      baseModel = baseModel.slice(0, -9);
    }
    return baseModel;
  }

  _getModelDescriptor(baseModel) {
    if (this._capabilitiesByProvider !== null) {
      const provCap = this._capabilitiesByProvider[this.provider];
      if (!provCap || provCap.canRunChildTask === false || !provCap.models) {
        return null;
      }
      return provCap.models[baseModel] || null;
    }
    return STATIC_T3_CAPABILITIES[this.provider]?.[baseModel] || null;
  }

  validateModel(model) {
    let parsed;
    let baseModel;
    try {
      parsed = parseModelAndEffort(model, 'high');
      baseModel = this._canonicalBaseModel(model, 'high');
    } catch (err) {
      throw new HarnessExecutionError(err.message, { harness: this.name, model, cause: err, exitCode: null, signal: null });
    }

    const descriptor = this._getModelDescriptor(baseModel);
    if (!descriptor) {
      const allowedModels =
        this._capabilitiesByProvider !== null
          ? (this._capabilitiesByProvider[this.provider]?.canRunChildTask !== false
              ? this._capabilitiesByProvider[this.provider]?.models || {}
              : {})
          : (STATIC_T3_CAPABILITIES[this.provider] || {});
      const allowedList = Object.keys(allowedModels).join(', ');
      throw new HarnessExecutionError(
        `Model "${model}" is not permitted under ${this.provider} T3 route. Allowed: ${allowedList || 'none'}.`,
        { harness: this.name, model, exitCode: null, signal: null }
      );
    }

    const inlineEffort = hasInlineEffortSyntax(model);
    if (descriptor.optionKey === null || descriptor.efforts === null) {
      if (inlineEffort) {
        throw new HarnessExecutionError(
          `Model "${model}" is not permitted under ${this.provider} route: "${baseModel}" does not accept reasoning effort tiers.`,
          { harness: this.name, model, exitCode: null, signal: null }
        );
      }
      return;
    }

    if (Array.isArray(descriptor.efforts) && inlineEffort && parsed.effort && !descriptor.efforts.includes(parsed.effort)) {
      throw new HarnessExecutionError(
        `Model "${model}" is not permitted under ${this.provider} route: effort "${parsed.effort}" not in [${descriptor.efforts.join(', ')}].`,
        { harness: this.name, model, exitCode: null, signal: null }
      );
    }
  }

  translateModelSelection(model, context = {}) {
    this.validateModel(model);
    const defaultEffort = context?.reasoningEffort || 'high';
    const parsed = parseModelAndEffort(model, defaultEffort);
    const baseModel = this._canonicalBaseModel(model, defaultEffort);
    const descriptor = this._getModelDescriptor(baseModel);
    if (!descriptor || descriptor.optionKey === null || descriptor.efforts === null) {
      return { provider: this.provider, model: baseModel };
    }
    const inlineEffort = hasInlineEffortSyntax(model);
    if (baseModel === 'gemini-pro-orchestrator-neon' && !inlineEffort && !context?.reasoningEffort) {
      return { provider: this.provider, model: baseModel };
    }
    const desiredEffort = inlineEffort ? parsed.effort : (context?.reasoningEffort || parsed.effort || 'high');
    const normEffort = String(desiredEffort || '').trim().toLowerCase();
    if (Array.isArray(descriptor.efforts) && normEffort && !descriptor.efforts.includes(normEffort)) {
      throw new HarnessExecutionError(
        `Reasoning effort "${normEffort}" is not supported for "${baseModel}" on ${this.provider} (allowed: ${descriptor.efforts.join(', ')}).`,
        { harness: this.name, model, exitCode: null, signal: null }
      );
    }
    return {
      provider: this.provider,
      model: baseModel,
      ...(normEffort ? { options: { [descriptor.optionKey]: normEffort } } : {})
    };
  }

  async _loadProjects({ signal } = {}) {
    const projects = [];
    let cursor = 0;
    for (let page = 0; page < 10; page += 1) {
      const res = await this.mcpClient.callTool(
        't3_project_list',
        { limit: 100, ...(cursor > 0 ? { cursor } : {}), ...(this.environmentId ? { environmentId: this.environmentId } : {}) },
        { signal }
      );
      const batch = Array.isArray(res?.projects) ? res.projects : (Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []));
      projects.push(...batch);
      if (res?.hasMore === false) {
        break;
      }
      if (res?.hasMore !== true && (res?.nextCursor === undefined || res?.nextCursor === null || batch.length < 100)) {
        break;
      }
      const nextCursor = typeof res?.nextCursor === 'number' ? res.nextCursor : cursor + batch.length;
      if (nextCursor <= cursor) {
        break;
      }
      cursor = nextCursor;
    }
    this._projectsCache = projects;
    return projects;
  }

  async resolveProjectId(cwd, { signal } = {}) {
    if (this.projectId) return this.projectId;
    const normTarget = normalizePathSafe(cwd);
    if (!normTarget) {
      throw new HarnessExecutionError('Cannot resolve T3 projectId without a valid cwd', {
        harness: this.name,
        code: 'T3_PROJECT_NOT_FOUND',
        isRetryable: false,
        exitCode: null,
        signal: null
      });
    }
    const projects = this._projectsCache || (await this._loadProjects({ signal }));
    for (const proj of projects) {
      const root = proj?.workspaceRoot || proj?.path || proj?.rootPath || proj?.cwd;
      if (root && normalizePathSafe(root) === normTarget) {
        return proj.id || proj.projectId;
      }
    }
    throw new HarnessExecutionError(
      `No registered T3 project matches cwd "${cwd}". Register the project in T3 or run with --tools none.`,
      { harness: this.name, code: 'T3_PROJECT_NOT_FOUND', isRetryable: false, exitCode: null, signal: null }
    );
  }

  async healthCheck({ signal } = {}) {
    const check = await this.mcpClient.healthCheck({ signal });
    if (!check.ok) {
      return check;
    }
    const caps = this.setCapabilities(check.capabilities);
    const provCap = caps?.[this.provider];
    if (caps && (!provCap || provCap.canRunChildTask === false)) {
      return {
        ok: false,
        latencyMs: check.latencyMs,
        error: `T3 provider "${this.provider}" is unavailable or cannot run child tasks`,
        errorClass: 'HarnessExecutionError',
        code: 'T3_PROVIDER_UNAVAILABLE'
      };
    }
    let projects = this._projectsCache;
    try {
      projects = await this._loadProjects({ signal });
    } catch {
      projects = this._projectsCache || [];
    }
    this.initialized = true;
    return {
      ok: true,
      latencyMs: check.latencyMs,
      provider: this.provider,
      capabilities: check.capabilities,
      projects
    };
  }

  async shutdown() {
    this.initialized = false;
    if (this._ownsMcpClient && typeof this.mcpClient?.close === 'function') {
      await this.mcpClient.close();
    }
  }

  classifyError(error, context = {}) {
    if (isReservedClassificationError(error)) {
      return super.classifyError(error, context);
    }
    const baseOptions = this._buildClassifiedErrorOptions(error, context);
    const raw = [error?.message, baseOptions.stderr, baseOptions.envelopeError].filter(Boolean).join(' ');
    if (
      PROVIDER_HTTP_429_REGEX.test(raw) ||
      /insufficient_quota|rate_limit|resource_exhausted|overloaded_error|weekly\s+included\s+pool\s+exhausted|quota\s+exceeded/i.test(raw)
    ) {
      return new QuotaExhaustionError(error?.message || `Quota exhausted on T3 ${this.provider} harness`, baseOptions);
    }
    return super.classifyError(error, context);
  }

  formatSeatPrompt({ seat, soul, round, phase, state, tools, cwd, rebuttalMode, mode, context: callerContext }) {
    const isClarification = phase === 'CLARIFICATION' || phase === 'clarifying';
    const isVoting = phase === 'VOTING' || phase === 'confirming';
    const isRebuttal =
      !isVoting &&
      !isClarification &&
      Boolean(
        rebuttalMode ||
          mode === 'rebuttal' ||
          callerContext?.rebuttalMode ||
          callerContext?.mode === 'rebuttal' ||
          seat?.rebuttalMode ||
          seat?.mode === 'rebuttal'
      );
    const { effectiveTools, effectiveCwd } = resolveAttemptExecutionWorkspace({
      role: 'seat',
      phase,
      participant: seat,
      state,
      tools,
      cwd,
      callerContext,
      adapter: this
    });
    const effectiveSeat = seat
      ? { ...seat, tools: effectiveTools, ...(effectiveTools === 'none' ? { cwd: undefined } : {}) }
      : seat;
    if (isClarification) {
      return formatClarificationPrompt({
        soul,
        seat: effectiveSeat,
        topic: state?.topic || '',
        batch: round || state?.clarificationBatch || 1,
        maxBatches: state?.maxClarificationBatches || 1
      });
    }
    if (isVoting) {
      const admittedProofs = (state?.proofs || []).filter(
        (p) => p && (p.status === 'admitted' || p.status === 'partially_admitted')
      );
      const myOpenObjections = seat?.id
        ? (state?.objections || []).filter((o) => o && o.seatId === seat.id && o.status === 'open')
        : [];
      return formatVotingPrompt({
        soul,
        seat: effectiveSeat,
        topic: state?.topic || '',
        candidate: state?.candidate,
        admittedProofs,
        myOpenObjections,
        state,
        tools: effectiveTools,
        cwd: effectiveCwd
      });
    }
    const openObjections = (state?.objections || []).filter((o) => o && o.status === 'open');
    const resolvedRound = round || state?.round || 1;
    const priorAdmittedProofs = resolvedRound > 1 ? resolvePriorAdmittedProofs([], state, resolvedRound) : [];
    return formatDeliberationPrompt({
      soul,
      seat: effectiveSeat,
      topic: state?.topic,
      round,
      maxRounds: state?.maxRounds,
      clarifications: state?.clarifications,
      previousCandidate: state?.candidate,
      openObjections,
      priorAdmittedProofs,
      state,
      tools: effectiveTools,
      cwd: effectiveCwd,
      ...(isRebuttal ? { rebuttalMode: true, mode: 'rebuttal' } : {})
    });
  }

  formatJudgePrompt({ judge, round, phase, proofs, state, tools, cwd, context: callerContext }) {
    const { effectiveTools, effectiveCwd } = resolveAttemptExecutionWorkspace({
      role: 'judge',
      phase,
      participant: judge,
      state,
      tools,
      cwd,
      callerContext,
      adapter: this
    });
    const effectiveJudge = judge
      ? { ...judge, tools: effectiveTools, ...(effectiveTools === 'none' ? { cwd: undefined } : {}) }
      : judge;
    return formatJudgeSoulPrompt({
      judge: effectiveJudge,
      topic: state?.topic,
      round,
      maxRounds: state?.maxRounds,
      proofs,
      state,
      tools: effectiveTools,
      cwd: effectiveCwd
    });
  }

  async _interruptRun(threadId, runId, reason) {
    if (!threadId || !runId) return;
    try {
      await this.mcpClient.callTool(
        't3_thread_interrupt',
        {
          threadId,
          runId,
          reason: String(reason || 'Council turn interrupted').slice(0, 2000),
          clientRequestId: randomUUID(),
          ...(this.environmentId ? { environmentId: this.environmentId } : {})
        },
        { signal: AbortSignal.timeout(this.interruptTimeoutMs) }
      );
    } catch {
      // Best-effort bounded cancellation; never mask primary TimeoutError/AbortError
    }
  }

  async _archiveConfirmedThread(threadId) {
    if (!this.archiveThreads || !threadId) return;
    try {
      await this.mcpClient.callTool(
        't3_thread_organize',
        {
          threadId,
          action: 'archive',
          ...(this.environmentId ? { environmentId: this.environmentId } : {})
        },
        { signal: AbortSignal.timeout(this.interruptTimeoutMs) }
      );
    } catch {
      // Best-effort archive cleanup
    }
  }

  async _readRunAssistantText(threadId, runId, { signal }) {
    const messages = [];
    let afterPosition = -1;
    let pages = 0;

    while (true) {
      pages += 1;
      if (pages > this.maxReadPages) {
        throw new HarnessExecutionError(
          `T3 t3_thread_read exceeded maxReadPages (${this.maxReadPages}) before hasMore became false`,
          { harness: this.name, code: 'T3_READ_TRUNCATED', exitCode: null, signal: null }
        );
      }
      const page = await this.mcpClient.callTool(
        't3_thread_read',
        {
          threadId,
          view: 'messages',
          afterPosition,
          limit: 100,
          maxCharsPerItem: DEFAULT_READ_MAX_CHARS_PER_ITEM,
          ...(this.environmentId ? { environmentId: this.environmentId } : {})
        },
        { signal }
      );
      const batch = Array.isArray(page?.items) ? page.items : (Array.isArray(page?.messages) ? page.messages : []);
      messages.push(...batch);
      if (page?.hasMore !== true) {
        break;
      }
      if (typeof page.nextPosition !== 'number' || page.nextPosition <= afterPosition) {
        throw new HarnessExecutionError(
          'T3 t3_thread_read reported hasMore: true without advancing nextPosition',
          { harness: this.name, code: 'T3_READ_TRUNCATED', exitCode: null, signal: null }
        );
      }
      afterPosition = page.nextPosition;
    }

    const assistantMessages = messages.filter((item) => {
      if (!item || typeof item !== 'object') return false;
      const role = String(item.role || item.kind || item.type || '').toLowerCase();
      const isAssistant = role === 'assistant' || role === 'assistant_message';
      if (!isAssistant) return false;
      if (runId && item.runId && item.runId !== runId) return false;
      return true;
    });

    if (assistantMessages.length === 0) {
      throw new HarnessExecutionError(`T3 thread "${threadId}" completed without an assistant_message for run "${runId}"`, {
        harness: this.name,
        code: 'T3_EMPTY_RESPONSE',
        exitCode: null,
        signal: null
      });
    }

    const target = assistantMessages[assistantMessages.length - 1];
    let text = typeof target.text === 'string' ? target.text : (typeof target.content === 'string' ? target.content : '');
    let totalBytes = Buffer.byteLength(text, 'utf8');
    let truncated = target.textTruncated === true;
    let nextOffset = target.nextTextOffset;
    let prevOffset = -1;
    const itemId = target.id || target.itemId;
    let chunkPages = 0;

    while (truncated) {
      chunkPages += 1;
      if (
        !itemId ||
        typeof nextOffset !== 'number' ||
        !Number.isFinite(nextOffset) ||
        nextOffset <= prevOffset ||
        chunkPages > this.maxReadPages
      ) {
        throw new HarnessExecutionError('T3 assistant_message text remained truncated beyond pagination budget', {
          harness: this.name,
          code: 'T3_READ_TRUNCATED',
          exitCode: null,
          signal: null
        });
      }
      prevOffset = nextOffset;
      const cont = await this.mcpClient.callTool(
        't3_thread_read',
        {
          threadId,
          view: 'messages',
          itemId,
          textOffset: nextOffset,
          maxCharsPerItem: DEFAULT_READ_MAX_CHARS_PER_ITEM,
          ...(this.environmentId ? { environmentId: this.environmentId } : {})
        },
        { signal }
      );
      const contItems = Array.isArray(cont?.items)
        ? cont.items
        : Array.isArray(cont?.messages)
          ? cont.messages
          : cont && typeof cont === 'object' && (cont.id === itemId || cont.itemId === itemId)
            ? [cont]
            : [];
      const contItem = contItems.find((i) => i && (i.id === itemId || i.itemId === itemId)) || contItems[0];
      if (!contItem || typeof contItem.text !== 'string') {
        throw new HarnessExecutionError(
          `T3 assistant_message continuation for item "${itemId}" returned missing or empty item`,
          {
            harness: this.name,
            code: 'T3_READ_TRUNCATED',
            exitCode: null,
            signal: null
          }
        );
      }
      if (contItem.text.length === 0 && contItem.textTruncated === true) {
        throw new HarnessExecutionError(
          `T3 assistant_message continuation for item "${itemId}" made no progress while truncated`,
          {
            harness: this.name,
            code: 'T3_READ_TRUNCATED',
            exitCode: null,
            signal: null
          }
        );
      }
      const chunkText = contItem.text;
      totalBytes += Buffer.byteLength(chunkText, 'utf8');
      if (totalBytes > this.maxResponseBytes) {
        throw new HarnessExecutionError(`T3 assistant_message exceeded maxResponseBytes (${this.maxResponseBytes})`, {
          harness: this.name,
          code: 'T3_READ_TRUNCATED',
          exitCode: null,
          signal: null
        });
      }
      text += chunkText;
      truncated = contItem.textTruncated === true;
      nextOffset = contItem.nextTextOffset;
    }

    if (totalBytes > this.maxResponseBytes) {
      throw new HarnessExecutionError(`T3 assistant_message exceeded maxResponseBytes (${this.maxResponseBytes})`, {
        harness: this.name,
        code: 'T3_READ_TRUNCATED',
        exitCode: null,
        signal: null
      });
    }
    return text;
  }

  async _readActivityTrace(threadId, durationMs, { signal }) {
    try {
      const act = await this.mcpClient.callTool(
        't3_thread_read',
        {
          threadId,
          view: 'activity',
          afterPosition: -1,
          limit: 100,
          ...(this.environmentId ? { environmentId: this.environmentId } : {})
        },
        { signal }
      );
      const items = Array.isArray(act?.items) ? act.items : [];
      const { toolCalls, forbiddenScanEntries } = extractActivityToolCalls(items);
      const forbidden = detectBasicForbiddenCouncilAccess(forbiddenScanEntries);
      return {
        traceCoverage: act?.hasMore === true ? 'partial' : 'full',
        toolCalls,
        skillsRead: [],
        forbiddenStateAccess: forbidden.forbiddenStateAccess,
        forbiddenAccessDetails: forbidden.forbiddenAccessDetails,
        durationMs,
        outcome: forbidden.forbiddenStateAccess ? 'error' : 'success'
      };
    } catch {
      return {
        traceCoverage: 'unavailable',
        toolCalls: [],
        skillsRead: [],
        forbiddenStateAccess: false,
        forbiddenAccessDetails: [],
        durationMs,
        outcome: 'success'
      };
    }
  }

  async _executeTurn({ role, participant, prompt, schemaType, signal, timeoutMs, context, onCallRecord, effectiveTools, effectiveCwd }) {
    if (prompt.length > MAX_T3_PROMPT_CHARS) {
      throw new HarnessExecutionError(
        `Formatted prompt (${prompt.length} chars) exceeds T3 launch limit of ${MAX_T3_PROMPT_CHARS} chars`,
        {
          harness: this.name,
          seatId: context.seatId,
          model: participant.model,
          code: 'T3_PROMPT_TOO_LARGE',
          isRetryable: false,
          exitCode: null,
          signal: null
        }
      );
    }

    const startedAt = Date.now();
    const effectiveDeadlineMs = this.resolveTimeoutMs(participant.model, timeoutMs);
    const clientRequestId = randomUUID();
    const modelSelection = this.translateModelSelection(participant.model, context);

    const workspaceParams =
      effectiveTools === 'none' || !effectiveCwd
        ? { scratch: true }
        : {
            projectId: await this.resolveProjectId(effectiveCwd, { signal }),
            workspaceStrategy: { type: 'root' }
          };

    const rawTitle = `Council ${context.phase || role} R${context.round ?? 1}: ${context.seatId || role}`;
    const title = rawTitle.trim().slice(0, 120) || 'Council Turn';

    let threadId = null;
    let runId = null;
    let confirmedTerminal = false;
    let readCompleted = false;
    let interrupted = false;
    let callRecorded = false;

    try {
      const launchRes = await this.mcpClient.callTool(
        't3_thread_launch',
        {
          title,
          ...workspaceParams,
          interactionMode: 'plan',
          runtimeMode: 'auto',
          modelSelection,
          message: prompt,
          clientRequestId,
          ...(this.environmentId ? { environmentId: this.environmentId } : {})
        },
        { signal }
      );

      threadId = launchRes?.threadId || launchRes?.thread?.id || null;
      runId = launchRes?.runId || launchRes?.latestRunId || launchRes?.run?.id || null;

      if (!threadId) {
        throw new HarnessExecutionError('T3 t3_thread_launch did not return a threadId', {
          harness: this.name,
          seatId: context.seatId,
          model: participant.model,
          code: 'T3_LAUNCH_MISSING_THREAD',
          exitCode: null,
          signal: null
        });
      }

      if (!runId) {
        const probe = await this.mcpClient.callTool(
          't3_thread_read',
          { threadId, view: 'messages', limit: 1, ...(this.environmentId ? { environmentId: this.environmentId } : {}) },
          { signal }
        );
        runId =
          probe?.latestRunId ||
          probe?.thread?.latestRunId ||
          probe?.latestRun?.id ||
          probe?.thread?.latestRun?.id ||
          probe?.runs?.[0]?.id ||
          null;
        if (!runId) {
          throw new HarnessExecutionError(`T3 t3_thread_launch for thread "${threadId}" omitted runId`, {
            harness: this.name,
            seatId: context.seatId,
            model: participant.model,
            code: 'T3_LAUNCH_MISSING_RUN',
            exitCode: null,
            signal: null
          });
        }
      }

      // Bounded wait loop
      while (!signal?.aborted) {
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(100, effectiveDeadlineMs - elapsed);
        const sliceMs = Math.min(this.waitSliceMs, remaining);

        const waitRes = await this.mcpClient.callTool(
          't3_thread_wait',
          {
            threadId,
            runId,
            timeoutMs: sliceMs,
            ...(this.environmentId ? { environmentId: this.environmentId } : {})
          },
          { signal }
        );

        let pendingCount = Number(waitRes?.thread?.pendingRequestCount ?? waitRes?.pendingRequestCount ?? 0) || 0;
        let status = String(waitRes?.status || waitRes?.run?.status || '').toLowerCase();
        const isUnfinishedOrPending =
          waitRes?.timedOut === true ||
          status === 'waiting' ||
          status === 'waiting_for_input' ||
          status === 'pending_approval' ||
          status === 'running';

        let probeStatus = '';
        let probeRunId = null;
        let probeError = null;
        if (isUnfinishedOrPending && pendingCount === 0 && !signal?.aborted) {
          const probe = await this.mcpClient.callTool(
            't3_thread_read',
            {
              threadId,
              view: 'messages',
              limit: 1,
              ...(this.environmentId ? { environmentId: this.environmentId } : {})
            },
            { signal }
          );
          pendingCount = Number(probe?.thread?.pendingRequestCount ?? probe?.pendingRequestCount ?? 0) || 0;
          probeStatus = String(
            probe?.latestRun?.status || probe?.thread?.latestRun?.status || probe?.thread?.status || ''
          ).toLowerCase();
          probeRunId =
            probe?.latestRun?.id ||
            probe?.latestRunId ||
            probe?.thread?.latestRun?.id ||
            probe?.thread?.latestRunId ||
            null;
          probeError =
            probe?.latestRun?.error ||
            probe?.thread?.latestRun?.error ||
            probe?.thread?.error ||
            null;
        }

        const stalledOnPending =
          pendingCount > 0 ||
          status === 'waiting_for_input' ||
          status === 'pending_approval' ||
          probeStatus === 'waiting_for_input' ||
          probeStatus === 'pending_approval';

        if (stalledOnPending) {
          interrupted = true;
          await this._interruptRun(threadId, runId, 'Headless T3 thread stalled on pending request');
          const durationMs = Math.max(0, Date.now() - startedAt);
          const deniedActions = [{ reason: 'pending_request', count: pendingCount || 1 }];
          const envelopeError = `pendingRequestCount=${pendingCount || 1}`;
          throw new HeadlessToolDeniedError(
            `Headless T3 thread "${threadId}" stalled on ${pendingCount || 1} pending request(s)`,
            {
              harness: this.name,
              seatId: context.seatId,
              model: participant.model,
              code: 'HEADLESS_TOOL_DENIED',
              finishedReason: 'pending_request',
              deniedActions,
              envelopeError,
              trace: {
                traceCoverage: 'unavailable',
                toolCalls: [],
                skillsRead: [],
                forbiddenStateAccess: false,
                forbiddenAccessDetails: [],
                durationMs,
                outcome: 'error',
                deniedActions,
                finishedReason: 'pending_request',
                envelopeError
              },
              exitCode: null,
              signal: null
            }
          );
        }

        const probeTerminalFailure =
          TERMINAL_FAILED_STATUSES.has(probeStatus) && (!probeRunId || probeRunId === runId);
        if (probeTerminalFailure) {
          status = probeStatus;
        } else if (waitRes?.timedOut === true) {
          continue;
        }

        const returnedRunId = waitRes?.runId || waitRes?.run?.id || null;
        if (returnedRunId && returnedRunId !== runId) {
          throw new HarnessExecutionError(
            `T3 t3_thread_wait returned mismatched runId "${returnedRunId}" (expected "${runId}")`,
            { harness: this.name, seatId: context.seatId, model: participant.model, code: 'T3_RUN_MISMATCH', exitCode: null, signal: null }
          );
        }

        if (waitRes?.timedOut === false && status === 'completed') {
          if (returnedRunId !== runId) {
            throw new HarnessExecutionError(
              `T3 t3_thread_wait completed with missing or mismatched runId "${returnedRunId ?? 'null'}" (expected "${runId}")`,
              { harness: this.name, seatId: context.seatId, model: participant.model, code: 'T3_RUN_MISMATCH', exitCode: null, signal: null }
            );
          }
          confirmedTerminal = true;
          break;
        }

        confirmedTerminal = TERMINAL_FAILED_STATUSES.has(status);
        const durationMs = Math.max(0, Date.now() - startedAt);
        const failStatus = status || 'unknown';
        const failMsg = String(
          waitRes?.error ||
            waitRes?.message ||
            waitRes?.run?.error ||
            probeError ||
            `T3 run ended with status "${failStatus}"`
        );
        const failErr = new Error(failMsg);
        failErr.code = `T3_RUN_${failStatus.toUpperCase()}`;
        failErr.envelopeError = failMsg;
        failErr.exitCode = null;
        failErr.signal = null;
        failErr.trace = {
          traceCoverage: 'unavailable',
          toolCalls: [],
          skillsRead: [],
          forbiddenStateAccess: false,
          forbiddenAccessDetails: [],
          durationMs,
          outcome: 'error',
          envelopeError: failMsg
        };
        throw failErr;
      }

      if (!confirmedTerminal) {
        if (signal?.aborted) {
          throw new AbortError('T3 wait aborted before run completed', {
            harness: this.name,
            seatId: context.seatId,
            model: participant.model,
            exitCode: null,
            signal: null
          });
        }
        throw new HarnessExecutionError('T3 wait loop exited before run completed', {
          harness: this.name,
          seatId: context.seatId,
          model: participant.model,
          exitCode: null,
          signal: null
        });
      }

      const rawText = await this._readRunAssistantText(threadId, runId, { signal });
      readCompleted = true;
      const durationMs = Math.max(0, Date.now() - startedAt);
      const trace = await this._readActivityTrace(threadId, durationMs, { signal });

      const activeGate = getActiveAttemptTelemetryGate();
      if (!(activeGate?.cancelled || activeGate?.finalized || activeGate?.recorded)) {
        callRecorded = this.recordProviderCall({
          context,
          onCallRecord,
          attemptGate: activeGate,
          record: {
            participantId: context.seatId || context.participantId || role,
            provider: this.name,
            transport: 't3-mcp',
            threadId,
            runId,
            model: participant.model,
            prompt,
            tools: effectiveTools,
            exitCode: null,
            signal: null,
            durationMs,
            trace
          }
        });
      }

      return this.parseStructuredOutput({ text: rawText, trace }, schemaType);
    } catch (err) {
      if (threadId && runId && !confirmedTerminal && !interrupted) {
        interrupted = true;
        await this._interruptRun(threadId, runId, signal?.aborted ? 'Council timeout or abort' : (err?.message || 'Turn failed'));
      }
      const activeGate = getActiveAttemptTelemetryGate();
      if (
        !callRecorded &&
        !(activeGate?.cancelled || activeGate?.finalized || activeGate?.recorded) &&
        !err?._providerCallRecorded
      ) {
        const durationMs = Math.max(0, Date.now() - startedAt);
        const failureTrace =
          err?.trace && typeof err.trace === 'object'
            ? { ...err.trace, outcome: 'error' }
            : {
                traceCoverage: 'unavailable',
                toolCalls: [],
                skillsRead: [],
                forbiddenStateAccess: false,
                forbiddenAccessDetails: [],
                durationMs,
                outcome: 'error',
                envelopeError: String(err?.message || 'T3 turn failed')
              };
        const recorded = this.recordProviderCall({
          context,
          onCallRecord,
          attemptGate: activeGate,
          record: {
            participantId: context.seatId || context.participantId || role,
            provider: this.name,
            transport: 't3-mcp',
            ...(threadId ? { threadId } : {}),
            ...(runId ? { runId } : {}),
            model: participant.model,
            prompt,
            tools: effectiveTools,
            exitCode: null,
            signal: null,
            durationMs,
            trace: failureTrace
          }
        });
        if (recorded) {
          callRecorded = true;
          if (err && typeof err === 'object' && Object.isExtensible(err)) {
            try {
              err._providerCallRecorded = true;
            } catch {
              // Non-writable property; activeGate.recorded still prevents duplicate receipts
            }
          }
        }
      }
      throw err;
    } finally {
      if (this.archiveThreads && confirmedTerminal && readCompleted && threadId) {
        await this._archiveConfirmedThread(threadId);
      }
    }
  }

  async executeSeat({
    seat,
    soul,
    round,
    phase,
    state,
    timeoutMs,
    tools,
    telemetry,
    onCallRecord,
    cwd,
    rebuttalMode,
    mode,
    reasoningEffort,
    signal: callerSignal,
    abortDrainMs,
    context: callerContext
  }) {
    this.validateModel(seat.model);
    const isClarification = phase === 'CLARIFICATION' || phase === 'clarifying';
    const isVoting = phase === 'VOTING' || phase === 'confirming';
    const isRebuttal =
      !isVoting &&
      !isClarification &&
      Boolean(
        rebuttalMode ||
          mode === 'rebuttal' ||
          callerContext?.rebuttalMode ||
          callerContext?.mode === 'rebuttal' ||
          seat?.rebuttalMode ||
          seat?.mode === 'rebuttal'
      );
    const baseModel = this._canonicalBaseModel(seat.model, 'high');
    const descriptor = this._getModelDescriptor(baseModel);
    const effectiveReasoningEffort =
      descriptor?.optionKey === null
        ? undefined
        : (reasoningEffort ?? callerContext?.reasoningEffort ?? seat?.reasoningEffort);
    const { effectiveTools, effectiveCwd, invocationMeta, retryDiagnostics } =
      captureAttemptInvocationMeta({
        role: 'seat',
        phase,
        participant: seat,
        state,
        tools,
        cwd,
        callerContext,
        adapter: this
      });
    const effectiveSeat = {
      ...seat,
      tools: effectiveTools,
      ...(effectiveTools === 'none' ? { cwd: undefined } : {})
    };
    const externalSignal = callerSignal ?? callerContext?.signal;
    const effectiveAbortDrainMs = abortDrainMs ?? callerContext?.abortDrainMs;
    const context = {
      seatId: seat.id,
      model: seat.model,
      tools: effectiveTools,
      ...(phase !== undefined ? { phase } : {}),
      ...(round !== undefined ? { round } : {}),
      _invocationMeta: invocationMeta,
      retryDiagnostics,
      ...(effectiveReasoningEffort ? { reasoningEffort: effectiveReasoningEffort } : {}),
      ...(isRebuttal ? { rebuttalMode: true, mode: 'rebuttal' } : {}),
      ...(telemetry ? { telemetry } : {}),
      ...(onCallRecord ? { onCallRecord } : {}),
      ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
      ...(externalSignal ? { signal: externalSignal } : {}),
      ...(effectiveAbortDrainMs !== undefined ? { abortDrainMs: effectiveAbortDrainMs } : {})
    };

    return this.executeWithTimeout(
      async (signal) => {
        try {
          const prompt = this.formatSeatPrompt({
            seat: effectiveSeat,
            soul,
            round,
            phase,
            state,
            tools: effectiveTools,
            cwd: effectiveCwd,
            rebuttalMode: isRebuttal,
            mode: isRebuttal ? 'rebuttal' : mode,
            context
          });
          const effectivePrompt = this._withRetryFeedback(prompt, callerContext?.retryFeedback);
          registerAttemptPrompt(context, effectivePrompt);
          const schemaType = isClarification ? 'clarification' : (isVoting ? 'vote' : 'proof');
          return await this._executeTurn({
            role: 'seat',
            participant: effectiveSeat,
            prompt: effectivePrompt,
            schemaType,
            signal,
            timeoutMs,
            context,
            onCallRecord,
            effectiveTools,
            effectiveCwd
          });
        } catch (err) {
          this._handleAttemptError(err, {
            provider: this.name,
            context,
            onCallRecord,
            tools: effectiveTools
          });
        }
      },
      timeoutMs,
      context
    );
  }

  async executeJudge({
    judge,
    round,
    phase,
    proofs,
    state,
    timeoutMs,
    tools,
    telemetry,
    onCallRecord,
    cwd,
    reasoningEffort,
    signal: callerSignal,
    abortDrainMs,
    context: callerContext
  }) {
    this.validateModel(judge.model);
    const baseModel = this._canonicalBaseModel(judge.model, 'high');
    const descriptor = this._getModelDescriptor(baseModel);
    const effectiveReasoningEffort =
      descriptor?.optionKey === null
        ? undefined
        : (reasoningEffort ?? callerContext?.reasoningEffort ?? judge?.reasoningEffort);
    const { effectiveTools, effectiveCwd, invocationMeta, retryDiagnostics } =
      captureAttemptInvocationMeta({
        role: 'judge',
        phase,
        participant: judge,
        state,
        tools,
        cwd,
        callerContext,
        adapter: this
      });
    const effectiveJudge = {
      ...judge,
      tools: effectiveTools,
      ...(effectiveTools === 'none' ? { cwd: undefined } : {})
    };
    const externalSignal = callerSignal ?? callerContext?.signal;
    const effectiveAbortDrainMs = abortDrainMs ?? callerContext?.abortDrainMs;
    const context = {
      seatId: judge.id,
      model: judge.model,
      tools: effectiveTools,
      ...(phase !== undefined ? { phase } : {}),
      ...(round !== undefined ? { round } : {}),
      _invocationMeta: invocationMeta,
      retryDiagnostics,
      ...(effectiveReasoningEffort ? { reasoningEffort: effectiveReasoningEffort } : {}),
      ...(telemetry ? { telemetry } : {}),
      ...(onCallRecord ? { onCallRecord } : {}),
      ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
      ...(externalSignal ? { signal: externalSignal } : {}),
      ...(effectiveAbortDrainMs !== undefined ? { abortDrainMs: effectiveAbortDrainMs } : {})
    };

    return this.executeWithTimeout(
      async (signal) => {
        try {
          const prompt = this.formatJudgePrompt({
            judge: effectiveJudge,
            round,
            phase,
            proofs,
            state,
            tools: effectiveTools,
            cwd: effectiveCwd,
            context
          });
          const effectivePrompt = this._withRetryFeedback(prompt, callerContext?.retryFeedback);
          registerAttemptPrompt(context, effectivePrompt);
          return await this._executeTurn({
            role: 'judge',
            participant: effectiveJudge,
            prompt: effectivePrompt,
            schemaType: 'judge_synthesis',
            signal,
            timeoutMs,
            context,
            onCallRecord,
            effectiveTools,
            effectiveCwd
          });
        } catch (err) {
          this._handleAttemptError(err, {
            provider: this.name,
            context,
            onCallRecord,
            tools: effectiveTools
          });
        }
      },
      timeoutMs,
      context
    );
  }
}
