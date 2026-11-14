/**
 * @fileoverview Centralized recovery policy, tool-free evidence readiness checks,
 * dependency extraction, and retry model/effort capability validation.
 * ESM Module (Node >= 22).
 */

import {
  ALLOWED_EFFORTS,
  extractCanonicalBaseModel,
  downshiftEffort,
  downshiftModel
} from '../harness/cli-runner.js';

export const VALID_SELF_CONTAINED_PHASES = Object.freeze([
  'DELIBERATION',
  'JUDGE_AUDIT_SYNTHESIS',
  'VOTING'
]);

const VALID_PHASE_SET = new Set(VALID_SELF_CONTAINED_PHASES);
const EFFORT_SET = new Set(ALLOWED_EFFORTS);
const URL_REGEX = /https?:\/\/[^\s"'`<>()[\]]+/gi;
const GLOB_REGEX = /(?:^|[\s"'`(\[,;])((?:\.\.?\/)?(?:[^\s"'`)\],;*]*\*[^\s"'`)\],;]*)|(?:(?:[A-Za-z0-9_.-]+\/)+))(?=$|[\s"'`)\],;!?])/g;
const FILE_REGEX = /(?:^|[\s"'`(\[,;])(\.?\.?\/?(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:[cm]?[jt]sx?|json|md|ya?ml|toml|py|go|rs|sh|css|html|sql|txt|lock))(?::(\d+)(?:-(\d+))?)?(?=$|[\s"'`)\],;!?]|(?:\.(?:\s|$)))/g;

const IGNORED_SINGLE_SEGMENT_JS_NOUNS = new Set([
  'node.js',
  'next.js',
  'vue.js',
  'nuxt.js',
  'three.js',
  'react.js',
  'd3.js',
  'p5.js',
  'express.js',
  'nest.js',
  'chart.js',
  'alpine.js',
  'solid.js',
  'angular.js',
  'backbone.js',
  'ember.js',
  'meteor.js',
  'require.js'
]);

/**
 * Static adapter capability catalog for verified effort-capable models.
 * Note: Date-stamped Antigravity selectors (e.g. `claude-opus-5-5-20260501`) are
 * intentionally omitted so they fail `UNSUPPORTED_MODEL_EFFORT` unless confirmed
 * by `live_cli_catalog`.
 */
const STATIC_CAPABILITY_CATALOG = Object.freeze({
  codex: Object.freeze({
    'gpt-6-astra': Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']),
    'gpt-6.1-sol': Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])
  }),
  antigravity: Object.freeze({
    'gemini-4-argon': Object.freeze(['low', 'medium', 'high']),
    'gemini-4-carbon': Object.freeze(['low', 'medium', 'high']),
    'claude-sonnet-5-5': Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']),
    'claude-opus-5-5': Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])
  }),
  cursor: Object.freeze({
    'grok-4.7': Object.freeze(['low', 'medium', 'high', 'xhigh']),
    'composer-2.5': null
  })
});

function collectStrings(value, out) {
  if (typeof value === 'string') {
    if (value.trim()) {
      out.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out);
    }
  }
}

function normalizeWorkspacePath(rawPath) {
  return String(rawPath || '').trim().replace(/^\.\//, '');
}

function mergeFileDependency(list, dep) {
  const existingForSource = list.filter((item) => item.source === dep.source);
  if (existingForSource.some((item) => item.unbounded)) {
    return;
  }
  if (dep.unbounded) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].source === dep.source) {
        list.splice(i, 1);
      }
    }
    list.push({ source: dep.source, unbounded: true });
    return;
  }
  const duplicate = existingForSource.some(
    (item) => item.startLine === dep.startLine && item.endLine === dep.endLine
  );
  if (!duplicate) {
    list.push({
      source: dep.source,
      startLine: dep.startLine,
      endLine: dep.endLine
    });
  }
}

/**
 * Extract workspace file references, broad directory/glob exploration patterns,
 * and external URLs from prompt/topic/candidate/proof text inputs.
 *
 * @param {string|string[]} inputs
 * @returns {{
 *   workspaceFileDeps: Array<{ source: string, startLine?: number, endLine?: number, unbounded?: boolean }>,
 *   workspaceBroadDeps: string[],
 *   externalDeps: string[]
 * }}
 */
export function extractVerificationDependencies(inputs) {
  const strings = [];
  collectStrings(inputs, strings);

  const workspaceFileDeps = [];
  const workspaceBroadDeps = [];
  const seenBroad = new Set();
  const externalDeps = [];
  const seenExternal = new Set();

  for (const text of strings) {
    // 1. Extract external HTTP/HTTPS URLs first and mask them so URL paths
    //    are not misclassified as workspace directory or file dependencies.
    let masked = text.replace(URL_REGEX, (rawUrl) => {
      const cleaned = rawUrl.replace(/[.,;:!?)]+$/, '');
      if (cleaned && !seenExternal.has(cleaned)) {
        seenExternal.add(cleaned);
        externalDeps.push(cleaned);
      }
      return ' '.repeat(rawUrl.length);
    });

    // 2. Mask ellipses (`...`, `..`) and semantic versions (`v22.1.0`, `1.2.3`)
    masked = masked
      .replace(/\.{2,}/g, (m) => ' '.repeat(m.length))
      .replace(/\bv?\d+(?:\.\d+){1,}\b/gi, (m) => ' '.repeat(m.length));

    // 3. Extract broad workspace globs and directory references (`src/**`, `**/*.js`, `src/engine/`).
    masked = masked.replace(GLOB_REGEX, (full, candidate) => {
      const trimmed = candidate.replace(/^\.\//, '');
      const looksBroad = trimmed.includes('*')
        ? (trimmed.includes('/') || trimmed.includes('.'))
        : (trimmed.endsWith('/') && trimmed.length > 1 && /[A-Za-z0-9_-]/.test(trimmed));
      if (!looksBroad) {
        return full;
      }
      if (!seenBroad.has(trimmed)) {
        seenBroad.add(trimmed);
        workspaceBroadDeps.push(trimmed);
      }
      const idx = full.indexOf(candidate);
      return `${full.slice(0, idx)}${' '.repeat(candidate.length)}${full.slice(idx + candidate.length)}`;
    });

    // 4. Extract concrete file references with optional `:startLine(-endLine)` bounds.
    FILE_REGEX.lastIndex = 0;
    let match;
    while ((match = FILE_REGEX.exec(masked)) !== null) {
      const rawToken = match[1];
      const startRaw = match[2];
      const endRaw = match[3];
      const hasExplicitPathPrefix = rawToken.includes('/') || rawToken.startsWith('./');
      const source = normalizeWorkspacePath(rawToken);
      if (!source || source.includes('..')) {
        continue;
      }
      if (
        !hasExplicitPathPrefix &&
        startRaw === undefined &&
        IGNORED_SINGLE_SEGMENT_JS_NOUNS.has(source.toLowerCase())
      ) {
        continue;
      }
      if (startRaw !== undefined) {
        const startLine = Number.parseInt(startRaw, 10);
        const endLine = endRaw !== undefined ? Number.parseInt(endRaw, 10) : startLine;
        mergeFileDependency(workspaceFileDeps, {
          source,
          startLine: Math.min(startLine, endLine),
          endLine: Math.max(startLine, endLine)
        });
      } else {
        mergeFileDependency(workspaceFileDeps, { source, unbounded: true });
      }
    }
  }

  return {
    workspaceFileDeps,
    workspaceBroadDeps,
    externalDeps
  };
}

function formatEvidenceFailure(detail, missingDependencies = []) {
  return {
    ready: false,
    reasonCode: 'evidence_access_failure',
    reason: `Tool-free recovery refused (insufficient self-contained evidence: ${detail}).`,
    missingDependencies
  };
}

function checkPhasePrerequisites({ phase, round, topic, proofs, candidate, previousCandidate, openObjections }) {
  if (phase === 'DELIBERATION') {
    if (round > 1) {
      if (!previousCandidate || !Array.isArray(openObjections) || openObjections.length === 0) {
        return formatEvidenceFailure(
          'Round > 1 deliberation requires previousCandidate and openObjections',
          ['previousCandidate/openObjections']
        );
      }
    }
    return null;
  }
  if (phase === 'JUDGE_AUDIT_SYNTHESIS') {
    if (!Array.isArray(proofs) || proofs.length === 0) {
      return formatEvidenceFailure(
        'JUDGE_AUDIT_SYNTHESIS requires submitted proofs',
        ['proofs']
      );
    }
    return null;
  }
  if (phase === 'VOTING') {
    if (!candidate || typeof candidate !== 'object') {
      return formatEvidenceFailure(
        'VOTING requires an active candidate',
        ['candidate']
      );
    }
    return null;
  }
  return formatEvidenceFailure(`unsupported recovery phase "${String(phase)}"`, [String(phase)]);
}

function collectPhasePromptTexts({ phase, topic, proofs, candidate, previousCandidate, openObjections }) {
  const texts = [];
  if (typeof topic === 'string' && topic.trim()) {
    texts.push(topic);
  }
  if (phase === 'DELIBERATION' && previousCandidate && typeof previousCandidate === 'object') {
    if (typeof previousCandidate.summary === 'string') {
      texts.push(previousCandidate.summary);
    }
    if (Array.isArray(previousCandidate.clauses)) {
      for (const clause of previousCandidate.clauses) {
        if (clause?.context) texts.push(String(clause.context));
        if (clause?.conclusion) texts.push(String(clause.conclusion));
      }
    }
  }
  if (Array.isArray(openObjections)) {
    for (const obj of openObjections) {
      if (obj?.reason) texts.push(String(obj.reason));
    }
  }
  if ((phase === 'JUDGE_AUDIT_SYNTHESIS' || phase === 'VOTING') && candidate && typeof candidate === 'object') {
    if (typeof candidate.summary === 'string') {
      texts.push(candidate.summary);
    }
    if (Array.isArray(candidate.clauses)) {
      for (const clause of candidate.clauses) {
        if (clause?.context) texts.push(String(clause.context));
        if (clause?.conclusion) texts.push(String(clause.conclusion));
      }
    }
  }
  if (Array.isArray(proofs)) {
    for (const proof of proofs) {
      if (proof?.scope) texts.push(String(proof.scope));
      if (proof?.statement) texts.push(String(proof.statement));
      if (proof?.source) texts.push(String(proof.source));
    }
  }
  return texts;
}

function isValidEvidenceItem(item) {
  return Boolean(item && typeof item === 'object' && typeof item.text === 'string' && item.text.trim().length > 0);
}

function doesCoveredArtifactSatisfyFileDep(dep, artifact, evidenceById) {
  if (!artifact || typeof artifact !== 'object') {
    return false;
  }
  const ev = evidenceById.get(artifact.evidenceId);
  if (!isValidEvidenceItem(ev)) {
    return false;
  }
  const artifactSource = normalizeWorkspacePath(artifact.source);
  if (!artifactSource || artifactSource !== dep.source) {
    return false;
  }
  if (ev.source !== undefined && normalizeWorkspacePath(ev.source) !== artifactSource) {
    return false;
  }
  if (artifact.coverage === 'complete_artifact') {
    return true;
  }
  if (dep.unbounded) {
    return false;
  }
  const cov = artifact.coverage;
  if (!cov || typeof cov !== 'object') {
    return false;
  }
  if (
    !Number.isInteger(cov.startLine) ||
    !Number.isInteger(cov.endLine) ||
    cov.startLine < 1 ||
    cov.endLine < cov.startLine
  ) {
    return false;
  }
  const depEnd = Number.isInteger(dep.endLine) ? dep.endLine : dep.startLine;
  return cov.startLine <= dep.startLine && cov.endLine >= depEnd;
}

function doesCoveredArtifactSatisfyExternalDep(extSource, artifact, evidenceById) {
  if (!artifact || typeof artifact !== 'object') {
    return false;
  }
  const ev = evidenceById.get(artifact.evidenceId);
  if (!isValidEvidenceItem(ev)) {
    return false;
  }
  if (String(artifact.source || '').trim() !== extSource) {
    return false;
  }
  if (ev.source !== undefined && String(ev.source).trim() !== extSource) {
    return false;
  }
  return artifact.coverage === 'complete_artifact';
}

/**
 * Evaluate whether a participant may safely retry without tools (`tools: 'none'`).
 * Enforces Spec §1 evidence-coverage, roundScope, conceptualNoExternalVerification,
 * and open-ended `effectiveCwd` exploration guards.
 *
 * @param {object} params
 * @returns {{ ready: boolean, reasonCode: string|null, reason: string|null, missingDependencies: string[] }}
 */
export function evaluateToolFreeEvidenceReadiness(params = {}) {
  const {
    phase = 'DELIBERATION',
    round = 1,
    errorClass = 'TimeoutError',
    topic = '',
    evidence = [],
    proofs = [],
    candidate = null,
    previousCandidate = null,
    openObjections = [],
    selfContainedInput = null,
    originalInvocationMeta = {}
  } = params;

  const effectiveTools = originalInvocationMeta?.effectiveTools ?? 'read-only';
  const effectiveCwd = originalInvocationMeta?.effectiveCwd;
  const removesTools = effectiveTools !== 'none';

  // Spec §1: never retry HeadlessToolDeniedError when attempt already ran with tools: 'none'.
  if (!removesTools) {
    if (errorClass === 'HeadlessToolDeniedError') {
      return formatEvidenceFailure(
        'headless tool permission was denied even with tools: "none"',
        ['headless tool permission']
      );
    }
    const prereqError = checkPhasePrerequisites({
      phase,
      round,
      topic,
      proofs,
      candidate,
      previousCandidate,
      openObjections
    });
    if (prereqError) {
      return prereqError;
    }
    return { ready: true, reasonCode: null, reason: null, missingDependencies: [] };
  }

  // Tool removal requested (`read-only` / `full` -> `none`).
  const prereqError = checkPhasePrerequisites({
    phase,
    round,
    topic,
    proofs,
    candidate,
    previousCandidate,
    openObjections
  });
  if (prereqError) {
    return prereqError;
  }

  if (!selfContainedInput || typeof selfContainedInput !== 'object' || Array.isArray(selfContainedInput)) {
    return formatEvidenceFailure(
      'selfContainedInput contract is required when removing tools',
      ['selfContainedInput']
    );
  }

  if (!Array.isArray(selfContainedInput.phases) || !selfContainedInput.phases.includes(phase)) {
    return formatEvidenceFailure(
      `selfContainedInput.phases does not authorize phase "${phase}"`,
      [`selfContainedInput.phases:${phase}`]
    );
  }

  if (round > 1 && selfContainedInput.roundScope !== 'all_rounds') {
    return formatEvidenceFailure(
      'round > 1 requires selfContainedInput.roundScope === "all_rounds"',
      ['selfContainedInput.roundScope:all_rounds']
    );
  }

  const texts = collectPhasePromptTexts({
    phase,
    topic,
    proofs,
    candidate,
    previousCandidate,
    openObjections
  });
  const deps = extractVerificationDependencies(texts);

  // Spec §7 item 2: external `kind: 'benchmark'` sources in proofs must also be treated as
  // external dependencies unless already listed as workspace/URL deps.
  if (Array.isArray(proofs)) {
    for (const proof of proofs) {
      if (proof?.kind === 'benchmark' && typeof proof.source === 'string' && proof.source.trim()) {
        const rawSource = proof.source.trim();
        const norm = normalizeWorkspacePath(rawSource);
        const alreadyFile = deps.workspaceFileDeps.some((f) => f.source === norm);
        const alreadyExternal = deps.externalDeps.includes(rawSource);
        if (!alreadyFile && !alreadyExternal) {
          deps.externalDeps.push(rawSource);
        }
      }
    }
  }

  // Spec §1 line 119: When `effectiveCwd` is attached in Round 1 DELIBERATION and
  // no concrete workspace file dependencies are cited, refuse open-ended exploration
  // even if unrelated coveredArtifacts or conceptual flags were provided.
  if (
    effectiveCwd !== undefined &&
    effectiveCwd !== null &&
    phase === 'DELIBERATION' &&
    round === 1 &&
    deps.workspaceFileDeps.length === 0
  ) {
    return formatEvidenceFailure(
      'open-ended DELIBERATION round 1 with attached cwd requires concrete workspace file citations',
      ['concrete workspace file citations']
    );
  }

  if (deps.workspaceBroadDeps.length > 0) {
    return formatEvidenceFailure(
      `broad workspace exploration dependencies cannot be verified tool-free (${deps.workspaceBroadDeps.join(', ')})`,
      deps.workspaceBroadDeps
    );
  }

  const hasAnyDeps = deps.workspaceFileDeps.length > 0 || deps.externalDeps.length > 0;
  const isUnattachedCwd = effectiveCwd === undefined || effectiveCwd === null;
  const conceptualAllowed =
    selfContainedInput.conceptualNoExternalVerification === true &&
    isUnattachedCwd &&
    errorClass === 'TimeoutError' &&
    !hasAnyDeps;

  if (conceptualAllowed) {
    return { ready: true, reasonCode: null, reason: null, missingDependencies: [] };
  }

  const evidenceById = new Map();
  if (Array.isArray(evidence)) {
    for (const item of evidence) {
      if (item && typeof item === 'object' && typeof item.id === 'string' && item.id.trim()) {
        evidenceById.set(item.id.trim(), item);
      }
    }
  }

  const coveredArtifacts = Array.isArray(selfContainedInput.coveredArtifacts)
    ? selfContainedInput.coveredArtifacts
    : [];

  if (!hasAnyDeps) {
    const hasValidAttestation = coveredArtifacts.some((ca) => {
      const ev = ca && typeof ca === 'object' ? evidenceById.get(ca.evidenceId) : null;
      return Boolean(ca?.source && ca?.coverage && isValidEvidenceItem(ev));
    });
    if (!hasValidAttestation) {
      return formatEvidenceFailure(
        'no qualifying [E#]-backed coveredArtifacts or conceptual contract satisfies tool-free execution',
        ['coveredArtifacts']
      );
    }
    return { ready: true, reasonCode: null, reason: null, missingDependencies: [] };
  }

  const missingDependencies = [];
  for (const fileDep of deps.workspaceFileDeps) {
    const matched = coveredArtifacts.some((ca) =>
      doesCoveredArtifactSatisfyFileDep(fileDep, ca, evidenceById)
    );
    if (!matched) {
      const label = fileDep.unbounded
        ? fileDep.source
        : `${fileDep.source}:${fileDep.startLine}-${fileDep.endLine}`;
      missingDependencies.push(label);
    }
  }

  for (const extDep of deps.externalDeps) {
    const matched = coveredArtifacts.some((ca) =>
      doesCoveredArtifactSatisfyExternalDep(extDep, ca, evidenceById)
    );
    if (!matched) {
      missingDependencies.push(extDep);
    }
  }

  if (missingDependencies.length > 0) {
    return formatEvidenceFailure(
      `uncovered verification dependencies: ${missingDependencies.join(', ')}`,
      missingDependencies
    );
  }

  return { ready: true, reasonCode: null, reason: null, missingDependencies: [] };
}

/**
 * Inspect a raw model string directly for an inline effort annotation
 * (either `model (effort)` or `model-(low|medium|high|xhigh|max)`), since
 * `parseModelAndEffort` does not expose `hasExplicitEffort`.
 *
 * @param {string} modelString
 * @returns {{
 *   hasInlineEffort: boolean,
 *   rawInlineEffort: string|null,
 *   strippedBase: string,
 *   syntax: 'paren'|'hyphen'|null,
 *   invalidEffort: string|null
 * }}
 */
function detectInlineEffort(modelString) {
  const trimmed = String(modelString || '').trim();
  const parenMatch = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const rawEffort = parenMatch[2].trim().toLowerCase();
    return {
      hasInlineEffort: true,
      rawInlineEffort: rawEffort,
      strippedBase: parenMatch[1].trim(),
      syntax: 'paren',
      invalidEffort: EFFORT_SET.has(rawEffort) ? null : rawEffort
    };
  }

  const suffixMatch = trimmed.match(/^(.+?)-(low|medium|high|xhigh|max)$/i);
  if (suffixMatch) {
    const rawEffort = suffixMatch[2].toLowerCase();
    return {
      hasInlineEffort: true,
      rawInlineEffort: rawEffort,
      strippedBase: suffixMatch[1].trim(),
      syntax: 'hyphen',
      invalidEffort: null
    };
  }

  return {
    hasInlineEffort: false,
    rawInlineEffort: null,
    strippedBase: trimmed,
    syntax: null,
    invalidEffort: null
  };
}

function extractLiveCatalogSelectors(capabilityCatalog) {
  if (!capabilityCatalog || capabilityCatalog.ok === false) {
    return null;
  }
  let rawSelectors = null;
  if (Array.isArray(capabilityCatalog)) {
    rawSelectors = capabilityCatalog;
  } else if (capabilityCatalog instanceof Set) {
    rawSelectors = [...capabilityCatalog];
  } else if (Array.isArray(capabilityCatalog.selectors)) {
    rawSelectors = capabilityCatalog.selectors;
  }
  if (!rawSelectors || rawSelectors.length === 0) {
    return null;
  }
  const normalized = rawSelectors
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
  return normalized.length > 0 ? new Set(normalized) : null;
}

function formatEffectiveModelForHarness({
  harness,
  originalTrimmed,
  canonicalBase,
  targetEffort,
  fallbackApplied,
  hasInlineEffort
}) {
  if (!fallbackApplied && hasInlineEffort) {
    return originalTrimmed;
  }
  if (!fallbackApplied && originalTrimmed) {
    return originalTrimmed;
  }
  if (harness === 'codex') {
    return `${canonicalBase} (${targetEffort})`;
  }
  if (harness === 'antigravity' || harness === 'cursor') {
    return `${canonicalBase}-${targetEffort}`;
  }
  if (hasInlineEffort) {
    return downshiftModel(originalTrimmed, targetEffort);
  }
  return `${originalTrimmed} (${targetEffort})`;
}

/**
 * Resolve retry model and reasoning effort across harness static policies and
 * optional live CLI model catalogs, enforcing `CONFLICTING_MODEL_EFFORT` (when
 * `retryEffortFallback` is enabled), `UNSUPPORTED_MODEL_EFFORT`, `composer-2.5`
 * null-effort rules, and the `medium` retry cap (without raising `low`).
 *
 * @param {object} params
 * @returns {{
 *   supported: boolean,
 *   requestedModel: string|null,
 *   requestedEffort: string|null,
 *   effectiveModel: string|null,
 *   effectiveEffort: string|null,
 *   fallbackApplied: boolean,
 *   provenance: 'live_cli_catalog'|'adapter_static_policy'|null,
 *   errorCode: string|null,
 *   error: string|null
 * }}
 */
export function resolveRetryModelAndEffort(params = {}) {
  const {
    harness = '',
    model = '',
    explicitReasoningEffort,
    reasoningEffort,
    hasExplicitReasoningEffort = false,
    defaultEffort = 'high',
    retryEffortFallback = false,
    capabilityCatalog = null
  } = params;

  const normalizedHarness = String(harness || '').trim().toLowerCase();
  const originalTrimmed = typeof model === 'string' ? model.trim() : '';

  if (!originalTrimmed) {
    return {
      supported: false,
      requestedModel: null,
      requestedEffort: null,
      effectiveModel: null,
      effectiveEffort: null,
      fallbackApplied: false,
      provenance: null,
      errorCode: 'UNSUPPORTED_MODEL_EFFORT',
      error: 'UNSUPPORTED_MODEL_EFFORT: Model identifier must be a non-empty string.'
    };
  }

  const inline = detectInlineEffort(originalTrimmed);
  if (inline.invalidEffort !== null) {
    return {
      supported: false,
      requestedModel: originalTrimmed,
      requestedEffort: null,
      effectiveModel: null,
      effectiveEffort: null,
      fallbackApplied: false,
      provenance: null,
      errorCode: 'UNSUPPORTED_MODEL_EFFORT',
      error: `UNSUPPORTED_MODEL_EFFORT: Unsupported inline reasoning effort "${inline.invalidEffort}" on model "${originalTrimmed}".`
    };
  }

  const rawConfiguredEffort =
    explicitReasoningEffort !== undefined ? explicitReasoningEffort : reasoningEffort;
  let normalizedConfiguredEffort = null;
  if (rawConfiguredEffort !== undefined && rawConfiguredEffort !== null && String(rawConfiguredEffort).trim() !== '') {
    normalizedConfiguredEffort = String(rawConfiguredEffort).trim().toLowerCase();
    if (!EFFORT_SET.has(normalizedConfiguredEffort)) {
      return {
        supported: false,
        requestedModel: originalTrimmed,
        requestedEffort: null,
        effectiveModel: null,
        effectiveEffort: null,
        fallbackApplied: false,
        provenance: null,
        errorCode: 'UNSUPPORTED_MODEL_EFFORT',
        error: `UNSUPPORTED_MODEL_EFFORT: Unsupported reasoningEffort "${rawConfiguredEffort}".`
      };
    }
  }

  const isExplicitSeatEffort = Boolean(hasExplicitReasoningEffort);

  // Enforce CONFLICTING_MODEL_EFFORT ONLY when retryEffortFallback === true.
  if (
    retryEffortFallback === true &&
    inline.hasInlineEffort &&
    isExplicitSeatEffort &&
    normalizedConfiguredEffort &&
    inline.rawInlineEffort !== normalizedConfiguredEffort
  ) {
    return {
      supported: false,
      requestedModel: originalTrimmed,
      requestedEffort: inline.rawInlineEffort,
      effectiveModel: null,
      effectiveEffort: null,
      fallbackApplied: false,
      provenance: null,
      errorCode: 'CONFLICTING_MODEL_EFFORT',
      error: `CONFLICTING_MODEL_EFFORT: Model "${originalTrimmed}" declares inline effort "${inline.rawInlineEffort}" which conflicts with explicit reasoningEffort "${normalizedConfiguredEffort}".`
    };
  }

  const normalizedDefault =
    typeof defaultEffort === 'string' && EFFORT_SET.has(defaultEffort.trim().toLowerCase())
      ? defaultEffort.trim().toLowerCase()
      : 'high';

  const canonicalBase = extractCanonicalBaseModel(inline.strippedBase, normalizedDefault);

  // Cursor / Composer special case: `composer-2.5` has NO effort levels (requested/effective = null).
  if (canonicalBase === 'composer-2.5') {
    if (normalizedHarness && normalizedHarness !== 'cursor' && normalizedHarness !== 'mock') {
      return {
        supported: false,
        requestedModel: originalTrimmed,
        requestedEffort: null,
        effectiveModel: null,
        effectiveEffort: null,
        fallbackApplied: false,
        provenance: null,
        errorCode: 'UNSUPPORTED_MODEL_EFFORT',
        error: `UNSUPPORTED_MODEL_EFFORT: Model "composer-2.5" is not supported on harness "${normalizedHarness}".`
      };
    }
    if (inline.hasInlineEffort || originalTrimmed.toLowerCase() !== 'composer-2.5') {
      return {
        supported: false,
        requestedModel: originalTrimmed,
        requestedEffort: null,
        effectiveModel: null,
        effectiveEffort: null,
        fallbackApplied: false,
        provenance: null,
        errorCode: 'UNSUPPORTED_MODEL_EFFORT',
        error: `UNSUPPORTED_MODEL_EFFORT: Model "composer-2.5" does not accept inline reasoning effort ("${originalTrimmed}").`
      };
    }
    if (retryEffortFallback === true && isExplicitSeatEffort && normalizedConfiguredEffort) {
      return {
        supported: false,
        requestedModel: originalTrimmed,
        requestedEffort: null,
        effectiveModel: null,
        effectiveEffort: null,
        fallbackApplied: false,
        provenance: null,
        errorCode: 'UNSUPPORTED_MODEL_EFFORT',
        error: `UNSUPPORTED_MODEL_EFFORT: Model "composer-2.5" does not support explicit reasoningEffort "${normalizedConfiguredEffort}".`
      };
    }
    return {
      supported: true,
      requestedModel: originalTrimmed,
      requestedEffort: null,
      effectiveModel: 'composer-2.5',
      effectiveEffort: null,
      fallbackApplied: false,
      provenance: retryEffortFallback ? 'adapter_static_policy' : null,
      errorCode: null,
      error: null
    };
  }

  const requestedEffort = inline.hasInlineEffort
    ? inline.rawInlineEffort
    : (normalizedConfiguredEffort || normalizedDefault);

  if (!retryEffortFallback) {
    return {
      supported: true,
      requestedModel: originalTrimmed,
      requestedEffort,
      effectiveModel: originalTrimmed,
      effectiveEffort: requestedEffort,
      fallbackApplied: false,
      provenance: null,
      errorCode: null,
      error: null
    };
  }

  // retryEffortFallback === true: cap at 'medium', never raise 'low'.
  const targetEffort = downshiftEffort(requestedEffort, 'medium');
  const fallbackApplied = targetEffort !== requestedEffort;
  const liveSelectors = extractLiveCatalogSelectors(capabilityCatalog);

  let provenance = null;

  if (liveSelectors) {
    const candidateHyphen = `${canonicalBase}-${targetEffort}`.toLowerCase();
    const candidateParen = `${canonicalBase} (${targetEffort})`.toLowerCase();
    const matchedLive =
      liveSelectors.has(candidateHyphen) ||
      liveSelectors.has(candidateParen) ||
      (normalizedHarness === 'mock' && liveSelectors.has(originalTrimmed.toLowerCase()));
    if (matchedLive) {
      provenance = 'live_cli_catalog';
    } else if (normalizedHarness === 'antigravity') {
      return {
        supported: false,
        requestedModel: originalTrimmed,
        requestedEffort,
        effectiveModel: null,
        effectiveEffort: null,
        fallbackApplied: false,
        provenance: null,
        errorCode: 'UNSUPPORTED_MODEL_EFFORT',
        error: `UNSUPPORTED_MODEL_EFFORT: Target fallback selector "${candidateHyphen}" for model "${originalTrimmed}" was not found in live CLI catalog.`
      };
    }
  }

  if (!provenance) {
    if (normalizedHarness === 'mock') {
      provenance = 'adapter_static_policy';
    } else {
      const harnessCatalog = STATIC_CAPABILITY_CATALOG[normalizedHarness];
      const allowedEfforts = harnessCatalog?.[canonicalBase];
      if (!Array.isArray(allowedEfforts)) {
        return {
          supported: false,
          requestedModel: originalTrimmed,
          requestedEffort,
          effectiveModel: null,
          effectiveEffort: null,
          fallbackApplied: false,
          provenance: null,
          errorCode: 'UNSUPPORTED_MODEL_EFFORT',
          error: `UNSUPPORTED_MODEL_EFFORT: Model "${originalTrimmed}" on harness "${normalizedHarness || 'unknown'}" has no verified effort capability without a live CLI catalog.`
        };
      }
      if (!allowedEfforts.includes(targetEffort)) {
        return {
          supported: false,
          requestedModel: originalTrimmed,
          requestedEffort,
          effectiveModel: null,
          effectiveEffort: null,
          fallbackApplied: false,
          provenance: null,
          errorCode: 'UNSUPPORTED_MODEL_EFFORT',
          error: `UNSUPPORTED_MODEL_EFFORT: Target effort "${targetEffort}" is not supported for "${canonicalBase}" on harness "${normalizedHarness}".`
        };
      }
      if (normalizedHarness === 'cursor' && !allowedEfforts.includes(requestedEffort)) {
        return {
          supported: false,
          requestedModel: originalTrimmed,
          requestedEffort,
          effectiveModel: null,
          effectiveEffort: null,
          fallbackApplied: false,
          provenance: null,
          errorCode: 'UNSUPPORTED_MODEL_EFFORT',
          error: `UNSUPPORTED_MODEL_EFFORT: Effort "${requestedEffort}" is not supported for "${canonicalBase}" on Cursor.`
        };
      }
      provenance = 'adapter_static_policy';
    }
  }

  const effectiveModel = formatEffectiveModelForHarness({
    harness: normalizedHarness,
    originalTrimmed,
    canonicalBase,
    targetEffort,
    fallbackApplied,
    hasInlineEffort: inline.hasInlineEffort
  });

  return {
    supported: true,
    requestedModel: originalTrimmed,
    requestedEffort,
    effectiveModel,
    effectiveEffort: targetEffort,
    fallbackApplied,
    provenance,
    errorCode: null,
    error: null
  };
}

/**
 * Validate retry-effort-fallback capability and inline-vs-explicit effort conflicts
 * across configured judge and seats (used by CLI preflight and unit tests).
 *
 * @param {object} params
 * @param {object} params.config
 * @param {Record<string, object|string[]>} [params.catalogByHarness]
 * @returns {{ valid: boolean, errors: string[], results: Record<string, object> }}
 */
export function validateRetryFallbackCapability({ config = {}, catalogByHarness = {} } = {}) {
  const errors = [];
  const results = {};

  const globalEffort =
    config?.reasoningEffort !== undefined ? config.reasoningEffort : config?.['reasoning-effort'];

  const participants = [];
  if (config?.judge && typeof config.judge === 'object') {
    participants.push({ label: 'judge', id: config.judge.id || 'judge', participant: config.judge });
  }
  if (Array.isArray(config?.seats)) {
    for (let i = 0; i < config.seats.length; i += 1) {
      const seat = config.seats[i];
      if (seat && typeof seat === 'object') {
        participants.push({
          label: `seat "${seat.id || i}"`,
          id: seat.id || `seat-${i}`,
          participant: seat
        });
      }
    }
  }

  for (const entry of participants) {
    const p = entry.participant;
    const harnessKey = String(p.harness || '').trim().toLowerCase();
    const hasExplicitReasoningEffort =
      typeof p._explicitReasoningEffort === 'boolean'
        ? p._explicitReasoningEffort
        : (typeof p.hasExplicitReasoningEffort === 'boolean'
            ? p.hasExplicitReasoningEffort
            : (p.reasoningEffort !== undefined || p['reasoning-effort'] !== undefined));

    const explicitReasoningEffort =
      p.reasoningEffort !== undefined
        ? p.reasoningEffort
        : (p['reasoning-effort'] !== undefined ? p['reasoning-effort'] : globalEffort);

    const resolution = resolveRetryModelAndEffort({
      harness: p.harness,
      model: p.model,
      explicitReasoningEffort,
      hasExplicitReasoningEffort,
      retryEffortFallback: true,
      capabilityCatalog: catalogByHarness?.[harnessKey] ?? catalogByHarness?.[p.harness] ?? null
    });

    results[entry.id] = resolution;
    if (!resolution.supported) {
      errors.push(`${entry.label}: ${resolution.error}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    results
  };
}

/**
 * Pure recovery planner enforcing Spec §2 7-step precedence:
 *   1. `!isRetryable` -> `non_retryable`
 *   2. `retries >= maxRetries` -> `retries_exhausted`
 *   3. `toolFreeRecoveryUsed === true` -> `tool_free_already_used`
 *   4. `remainingBudget <= 0 || remainingBudget < minViable` -> `budget_exhausted`
 *   5. `TimeoutError` / `HeadlessToolDeniedError` -> `evaluateToolFreeEvidenceReadiness` -> `evidence_access_failure`
 *   6. `retryEffortFallback && (TimeoutError | HeadlessToolDeniedError)` -> `resolveRetryModelAndEffort` -> `unsupported_fallback`
 *   7. `canRetry: true` with `setsToolFreeRecoveryUsed: removesTools` and complete `retryDiagnostics`
 *
 * @param {object} params
 * @returns {object}
 */
export function planParticipantRecovery(params = {}) {
  const {
    participantId = null,
    role = 'seat',
    error = null,
    errorClass: providedErrorClass = null,
    isRetryable = true,
    retries = 0,
    maxRetries = 0,
    remainingBudget = Infinity,
    minViable = 0,
    toolFreeRecoveryUsed = false,
    originalAttemptTools,
    phase = 'DELIBERATION',
    round = 1,
    topic = '',
    evidence = [],
    proofs = [],
    candidate = null,
    previousCandidate = null,
    openObjections = [],
    selfContainedInput = null,
    originalInvocationMeta = {},
    harness,
    model,
    reasoningEffort,
    hasExplicitReasoningEffort = false,
    retryEffortFallback = false,
    capabilityCatalog = null
  } = params;

  const resolvedErrorClass =
    providedErrorClass ||
    (error?.code === 'HEADLESS_TOOL_DENIED' || error?.name === 'HeadlessToolDeniedError'
      ? 'HeadlessToolDeniedError'
      : error?.name || 'Error');

  // Step 1: non-retryable
  if (!isRetryable) {
    return {
      canRetry: false,
      terminationKind: 'non_retryable',
      reason: error?.message || `Non-retryable ${resolvedErrorClass}`,
      errorCode: null,
      setsToolFreeRecoveryUsed: false,
      retryDiagnostics: null
    };
  }

  // Step 2: retries exhausted
  if (retries >= maxRetries) {
    return {
      canRetry: false,
      terminationKind: 'retries_exhausted',
      reason: `Retry limit exhausted (${retries}/${maxRetries})`,
      errorCode: null,
      setsToolFreeRecoveryUsed: false,
      retryDiagnostics: null
    };
  }

  // Step 3: single tool-free recovery limit across ALL error classes
  if (toolFreeRecoveryUsed === true) {
    return {
      canRetry: false,
      terminationKind: 'tool_free_already_used',
      reason: 'Tool-free recovery already used once; refusing additional retry',
      errorCode: null,
      setsToolFreeRecoveryUsed: false,
      retryDiagnostics: null
    };
  }

  // Step 4: budget exhausted
  if (remainingBudget <= 0 || remainingBudget < minViable) {
    return {
      canRetry: false,
      terminationKind: 'budget_exhausted',
      reason: `Insufficient remaining budget (${remainingBudget}ms < ${minViable}ms minimum viable)`,
      errorCode: null,
      setsToolFreeRecoveryUsed: false,
      retryDiagnostics: null
    };
  }

  const origTools = originalAttemptTools ?? originalInvocationMeta?.effectiveTools ?? 'read-only';
  const isTimeoutOrToolDenied =
    resolvedErrorClass === 'TimeoutError' || resolvedErrorClass === 'HeadlessToolDeniedError';
  const removesTools = isTimeoutOrToolDenied && origTools !== 'none';

  // Step 5: tool-free readiness check for TimeoutError / HeadlessToolDeniedError
  if (isTimeoutOrToolDenied) {
    const readiness = evaluateToolFreeEvidenceReadiness({
      phase,
      round,
      errorClass: resolvedErrorClass,
      topic,
      evidence,
      proofs,
      candidate,
      previousCandidate,
      openObjections,
      selfContainedInput,
      originalInvocationMeta: {
        ...originalInvocationMeta,
        effectiveTools: origTools
      }
    });
    if (!readiness.ready) {
      return {
        canRetry: false,
        terminationKind: 'evidence_access_failure',
        reason: readiness.reason,
        missingDependencies: readiness.missingDependencies,
        errorCode: null,
        setsToolFreeRecoveryUsed: false,
        retryDiagnostics: null
      };
    }
  }

  const nextTools = isTimeoutOrToolDenied ? 'none' : origTools;
  const nextCwd =
    nextTools === 'none'
      ? undefined
      : (originalInvocationMeta?.configuredWorkspaceCwd ?? originalInvocationMeta?.effectiveCwd);

  // Step 6: effort fallback only for TimeoutError / HeadlessToolDeniedError when retryEffortFallback === true
  const shouldApplyEffortFallback = Boolean(retryEffortFallback && isTimeoutOrToolDenied);
  let modelResolution = null;

  if (model !== undefined && model !== null && String(model).trim() !== '') {
    modelResolution = resolveRetryModelAndEffort({
      harness,
      model,
      explicitReasoningEffort: reasoningEffort,
      hasExplicitReasoningEffort,
      retryEffortFallback: shouldApplyEffortFallback,
      capabilityCatalog
    });

    if (shouldApplyEffortFallback && !modelResolution.supported) {
      return {
        canRetry: false,
        terminationKind: 'unsupported_fallback',
        reason: modelResolution.error,
        errorCode: modelResolution.errorCode,
        setsToolFreeRecoveryUsed: false,
        retryDiagnostics: null
      };
    }
  }

  const nextModel = modelResolution ? modelResolution.effectiveModel : model;
  const nextReasoningEffort = modelResolution
    ? modelResolution.effectiveEffort
    : (reasoningEffort ?? null);
  const fallbackApplied = Boolean(shouldApplyEffortFallback && modelResolution?.fallbackApplied);
  const fallbackReason = fallbackApplied ? resolvedErrorClass : null;
  const capabilityProvenance = shouldApplyEffortFallback
    ? (modelResolution?.provenance ?? null)
    : null;

  // Step 7: approved retry plan
  return {
    canRetry: true,
    terminationKind: null,
    reason: null,
    errorCode: null,
    nextTools,
    nextCwd,
    nextModel,
    nextReasoningEffort,
    setsToolFreeRecoveryUsed: removesTools,
    retryDiagnostics: {
      participantId,
      role,
      phase,
      round,
      attempt: retries + 1,
      requestedModel: modelResolution?.requestedModel ?? model ?? null,
      requestedEffort: modelResolution?.requestedEffort ?? (reasoningEffort ?? null),
      effectiveModel: nextModel ?? null,
      effectiveEffort: nextReasoningEffort ?? null,
      capabilityProvenance,
      fallbackEnabled: Boolean(retryEffortFallback),
      fallbackApplied,
      fallbackReason,
      tools: nextTools
    }
  };
}
