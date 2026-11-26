/**
 * @fileoverview Pure Model & Reasoning Effort Parsing/Downshifting Utilities.
 * Zero external dependencies. Acyclic leaf module shared by Harnesses, Engine, Recovery, and Ledger.
 * Node >= 22 ESM.
 */

export const CODEX_EFFORT_MAP = Object.freeze({
  max: 'max',
  xhigh: 'xhigh',
  high: 'high',
  medium: 'medium',
  low: 'low'
});

export const ALLOWED_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

const RECOGNIZED_EFFORT_SUFFIXES = Object.freeze(['-max', '-xhigh', '-high', '-medium', '-low']);

const EFFORT_RANK = Object.freeze({
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5
});

/**
 * Parses model name and reasoning effort level.
 * Handles parenthesis format "gpt-6-astra (max)" and hyphenated suffixes "gemini-4-argon-high".
 * Preserves 'max' for Codex reasoning effort.
 * Throws a configuration error on unsupported efforts naming allowed values.
 *
 * @param {string} modelString
 * @param {'high'|'medium'|'low'|'max'|'xhigh'|string} [defaultEffort]
 * @param {'high'|'medium'|'low'|'max'|'xhigh'|string} [fallbackReasoningEffort='high']
 * @returns {{ model: string, effort: string, codexEffort: string }}
 */
export function parseModelAndEffort(modelString, defaultEffort, fallbackReasoningEffort = 'high') {
  if (typeof modelString !== 'string' || !modelString.trim()) {
    throw new Error('modelString must be a non-empty string');
  }

  const resolvedDefault = defaultEffort ?? fallbackReasoningEffort ?? 'high';
  const trimmed = modelString.trim();

  // 1. Parenthesized effort format: e.g. "gpt-6-astra (max)"
  const parenMatch = trimmed.match(/^([^(]+)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    const model = parenMatch[1].trim();
    const rawEffort = parenMatch[2].trim();
    if (!rawEffort) {
      const defaultEff = (resolvedDefault || 'high').toLowerCase();
      const codexEffort = CODEX_EFFORT_MAP[defaultEff] || 'high';
      return { model, effort: '', codexEffort };
    }
    const effort = rawEffort.toLowerCase();
    if (!CODEX_EFFORT_MAP[effort]) {
      throw new Error(
        `Configuration error: Unsupported reasoning effort "${rawEffort}". Allowed: ${ALLOWED_EFFORTS.join(', ')}.`
      );
    }
    return { model, effort, codexEffort: CODEX_EFFORT_MAP[effort] };
  }

  // 2. Suffix effort format: e.g. "gemini-4-argon-high", "grok-4.7-xhigh", "model-max"
  for (const suffix of RECOGNIZED_EFFORT_SUFFIXES) {
    if (trimmed.toLowerCase().endsWith(suffix)) {
      const effort = suffix.slice(1);
      const codexEffort = CODEX_EFFORT_MAP[effort] || 'high';
      return { model: trimmed, effort, codexEffort };
    }
  }

  // 3. Fallback to default effort
  const defaultEff = (resolvedDefault || 'high').toLowerCase();
  if (!CODEX_EFFORT_MAP[defaultEff]) {
    throw new Error(
      `Configuration error: Unsupported reasoning effort "${resolvedDefault}". Allowed: ${ALLOWED_EFFORTS.join(', ')}.`
    );
  }
  const codexEffort = CODEX_EFFORT_MAP[defaultEff];
  return { model: trimmed, effort: defaultEff, codexEffort };
}

/**
 * Extracts the canonical lowercase base model name after validating effort via parseModelAndEffort.
 * Enforces the no-double-effort (!hasParens) and single-suffix (break) rules.
 *
 * @param {string} modelString
 * @param {'high'|'medium'|'low'|'max'|'xhigh'|string} [defaultEffort='high']
 * @returns {string}
 */
export function extractCanonicalBaseModel(modelString, defaultEffort = 'high') {
  const parsed = parseModelAndEffort(modelString, defaultEffort);
  const hasParens = /\([^)]*\)\s*$/.test(String(modelString || '').trim());
  let baseModel = parsed.model.trim().toLowerCase();
  if (!hasParens) {
    for (const suffix of RECOGNIZED_EFFORT_SUFFIXES) {
      if (baseModel.endsWith(suffix)) {
        baseModel = baseModel.slice(0, -suffix.length);
        break;
      }
    }
  }
  return baseModel;
}

/**
 * Downshifts an effort level to a target level if current effort exceeds target.
 * Never upshifts an effort that is already at or below target.
 *
 * @param {string} effort
 * @param {string} [target='low']
 * @returns {string}
 */
export function downshiftEffort(effort, target = 'low') {
  const cur = String(effort || '').toLowerCase().trim();
  const tgt = String(target || 'low').toLowerCase().trim();
  if (EFFORT_RANK[tgt] === undefined) {
    return cur || 'low';
  }
  if (EFFORT_RANK[cur] === undefined) {
    return tgt;
  }
  return EFFORT_RANK[cur] > EFFORT_RANK[tgt] ? tgt : cur;
}

/**
 * Downshifts model reasoning effort for voting or lightweight tasks.
 * Handles parenthesized models (e.g. "gpt-6-astra (max)" -> "gpt-6-astra (low)")
 * and hyphenated suffix models (e.g. "grok-4.7-xhigh" -> "grok-4.7-low").
 * Preserves models without recognized effort tiers (e.g. "composer-2.5").
 *
 * @param {string} model
 * @param {string} [target='low']
 * @returns {string}
 */
export function downshiftModel(model, target = 'low') {
  if (typeof model !== 'string' || !model.trim()) {
    return model;
  }
  const trimmed = model.trim();
  const parenMatch = trimmed.match(/^([^(]+)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    const baseModel = parenMatch[1].trim();
    const rawEffort = parenMatch[2].trim();
    const newEffort = downshiftEffort(rawEffort, target);
    return `${baseModel} (${newEffort})`;
  }

  for (const suffix of RECOGNIZED_EFFORT_SUFFIXES) {
    if (trimmed.toLowerCase().endsWith(suffix)) {
      const rawEffort = suffix.slice(1);
      const newEffort = downshiftEffort(rawEffort, target);
      return `${trimmed.slice(0, -suffix.length)}-${newEffort}`;
    }
  }

  return trimmed;
}
