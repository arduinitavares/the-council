/**
 * @fileoverview Pure structural proof validator for The Council.
 * Enforces verifiable proof criteria: non-empty scope, valid kind, non-empty source,
 * and falsifiable statement. Bare opinions without a source are strictly forbidden.
 */

import { VALID_PROOF_KINDS } from '../types.js';
export {
  EXPECTED_DIGEST_HEX_REGEX,
  BINDING_FIELDS,
  isValidSha256Hex,
  validateExpectedDigestsConfig,
  validateJudgeDigestBinding
} from './digest-binding.js';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Match parent-directory ".." on path-segment or standalone boundaries while allowing prose "..." ellipses and numeric ranges like "1..5".
const PARENT_TRAVERSAL_REGEX =
  /(?:^|[\\/\s"'`(=,\[{:;|])\.\.(?:$|[\\/\s"'`),\]}:;?!])/;

const FORBIDDEN_ARTIFACT_REGEX =
  /(?:^|[\\/\s"'`(=,\[{:])\.council(?:$|[\\/\s"'`),.:;\]}?!])|(?:^|[\\/\s"'`(=,\[{:])latest\.js(?=$|[:\s"'`),.\]}?!])|\*\.meta\.json(?=$|[:\s"'`),.\]}?!])|\*\.events\.jsonl(?=$|[:\s"'`),.\]}?!])|(?:^|[\\/\s"'`(=,\[{:])[a-z0-9._-]+\.(?:meta\.json|events\.jsonl)(?=$|[:\s"'`),.\]}?!])|(?:^|[\\/\s"'`(=,\[{:])telemetry-summary(?:\.\*|(?:\.[a-z0-9]+))?(?=$|[:\s"'`),.\]}?!])/i;

// These negative access disclosures name a category, not a concrete source.
// Concrete subpaths and other references in the same field remain checked.
function citationReferences(text) {
  return text
    .replace(/\bNo\s+\.council\/?\s+(?:telemetry|files)(?:,\s*(?:or\s+)?(?:run snapshots|skill-source files))*\s+were used\./gi, '')
    .replace(/\bI did not inspect (?:any engine source or )?\.council\/?\s+files(?:, and I did not run a benchmark)?\./gi, '');
}

const UNSTRIPPED_TEMP_ROOT_REGEX =
  /(?:(?:\/|\\|[a-z]:\\)[^\s"'`<>]*?council-(?:safe|seat)-cwd-[a-z0-9_-]+|(?:^|[\s"'`(=,\[{:])council-(?:safe|seat)-cwd-[a-z0-9_-]+(?:[\\/]|$))/i;

const TRAVERSAL_OR_DOT_SEGMENT_RE = PARENT_TRAVERSAL_REGEX;
const COUNCIL_SUBPATH_RE = /(?:^|[\\/])\.council(?:$|[\\/:,.;\]}])/i;

/**
 * Strips ONLY exact path prefixes in `invocationMeta.trustedEphemeralRoots`
 * (`<trustedRoot>/<relPath>` -> POSIX `<relPath>`, preserving `:line` / `:start-end`
 * suffixes) when `<relPath>` is non-empty, contains zero `..` segments, and does
 * not target `.council`. Walks strings, arrays, and plain objects immutably.
 *
 * @param {any} payload
 * @param {{ trustedEphemeralRoots?: string[] } | null | undefined} invocationMeta
 * @returns {any}
 */
export function normalizeTrustedInvocationCitations(payload, invocationMeta) {
  const roots = Array.isArray(invocationMeta?.trustedEphemeralRoots)
    ? invocationMeta.trustedEphemeralRoots
        .filter((r) => typeof r === 'string')
        .map((r) => r.trim().replace(/[\\/]+$/, ''))
        .filter((r) => r.length > 0)
    : [];
  if (roots.length === 0 || payload == null) return payload;
  const sorted = [...new Set(roots)].sort((a, b) => b.length - a.length);

  const rewriteText = (str) => {
    let out = str;
    for (const normalized of sorted) {
      const prefixRe = new RegExp(
        `(?<![A-Za-z0-9_.-\\\\/])${escapeRegex(normalized)}[\\\\/]+([^\\s"'` + '`' + `<>)]+)`,
        'g'
      );
      out = out.replace(prefixRe, (fullMatch, relPath) => {
        if (
          !relPath ||
          relPath === '.' ||
          /^\.[\\/]*$/.test(relPath) ||
          TRAVERSAL_OR_DOT_SEGMENT_RE.test(relPath) ||
          COUNCIL_SUBPATH_RE.test(relPath)
        ) {
          return fullMatch;
        }
        return relPath.replace(/\\/g, '/');
      });
    }
    return out;
  };

  const walk = (node) => {
    if (typeof node === 'string') return rewriteText(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const proto = Object.getPrototypeOf(node);
      if (proto !== Object.prototype && proto !== null) {
        return node;
      }
      const copy = proto === null ? Object.create(null) : {};
      for (const [k, v] of Object.entries(node)) {
        Object.defineProperty(copy, k, {
          value: walk(v),
          enumerable: true,
          writable: true,
          configurable: true
        });
      }
      return copy;
    }
    return node;
  };

  return walk(payload);
}

/**
 * Validates citation/path text fields against forbidden parent traversal (`..`),
 * `.council` / telemetry artifacts, unstripped temporary workspace roots, and
 * host workspace roots.
 *
 * @param {Array<{ label?: string; text?: string }>} [fields=[]]
 * @param {{ forbiddenWorkspaceRoots?: string[] }} [options={}]
 * @returns {import('../types.js').ProofValidationResult}
 */
export function validateCitationFields(fields = [], options = {}) {
  const errors = [];
  if (!Array.isArray(fields)) {
    return { valid: true, errors };
  }

  const forbiddenRoots = Array.isArray(options?.forbiddenWorkspaceRoots)
    ? [
        ...new Set(
          options.forbiddenWorkspaceRoots
            .filter((r) => typeof r === 'string')
            .map((r) => r.trim().replace(/[\\/]+$/, ''))
            .filter((r) => r.length > 0 && r !== '/')
        )
      ]
    : [];

  for (const entry of fields) {
    if (!entry || typeof entry.text !== 'string' || !entry.text) continue;
    const { label = 'field', text } = entry;

    if (PARENT_TRAVERSAL_REGEX.test(text)) {
      errors.push(`${label} must not contain parent directory traversal ("..")`);
    }
    if (FORBIDDEN_ARTIFACT_REGEX.test(citationReferences(text))) {
      errors.push(`${label} must not cite internal .council or telemetry artifacts`);
    }
    if (UNSTRIPPED_TEMP_ROOT_REGEX.test(text)) {
      errors.push(`${label} must not cite unstripped temporary workspace directory paths`);
    }
    for (const root of forbiddenRoots) {
      const rootRe = new RegExp(
        `(?<![A-Za-z0-9_.-])${escapeRegex(root)}(?=$|[\\\\/\\s"'` + '`' + `),.:;\\]}?!])`
      );
      if (rootRe.test(text)) {
        errors.push(`${label} must not cite host workspace root path (${root})`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates a structured proof input against the Council's proof rules:
 * - scope: non-empty trimmed string defining context boundary.
 * - kind: one of 'check', 'citation', 'benchmark', 'derivation'.
 * - source: non-empty trimmed string citing verifiable evidence (bare opinions forbidden).
 * - statement: non-empty trimmed string stating a falsifiable assertion.
 * - citation hygiene: no parent traversal, .council/telemetry artifacts, temp roots, or host workspace roots.
 *
 * @param {import('../types.js').ProofInput} input - Proof data to validate.
 * @param {{ forbiddenWorkspaceRoots?: string[] }} [options={}]
 * @returns {import('../types.js').ProofValidationResult} Result with valid flag and error messages.
 */
export function validateProof(input, options = {}) {
  const errors = [];

  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      errors: ['Structural Proof Guard: proof input must be an object.']
    };
  }

  // 1. Scope condition check
  if (typeof input.scope !== 'string' || !input.scope.trim()) {
    errors.push('Structural Proof Guard: "scope" condition is required.');
  }

  // 2. Kind check
  if (typeof input.kind !== 'string' || !VALID_PROOF_KINDS.includes(input.kind)) {
    errors.push('Structural Proof Guard: "kind" must be check, citation, benchmark, or derivation.');
  }

  // 3. Source check (verifiable evidence required; bare opinions forbidden)
  if (typeof input.source !== 'string' || !input.source.trim()) {
    errors.push('Structural Proof Guard: verifiable "source" is required; bare opinions are forbidden.');
  }

  // 4. Statement check (falsifiable assertion required)
  if (typeof input.statement !== 'string' || !input.statement.trim()) {
    errors.push('Structural Proof Guard: falsifiable "statement" is required.');
  }

  // 5. Citation & path safety check
  const citationCheck = validateCitationFields(
    [
      { label: 'proof.scope', text: input.scope },
      { label: 'proof.source', text: input.source },
      { label: 'proof.statement', text: input.statement }
    ],
    options
  );
  if (!citationCheck.valid) {
    errors.push(...citationCheck.errors);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Checks if a given string is an admitted ProofKind.
 * @param {string} kind
 * @returns {boolean}
 */
export function isValidProofKind(kind) {
  return typeof kind === 'string' && VALID_PROOF_KINDS.includes(kind);
}

/**
 * Sanitizes proof input fields by trimming whitespace.
 * @param {import('../types.js').ProofInput} input
 * @returns {import('../types.js').ProofInput}
 */
export function sanitizeProofInput(input) {
  if (!input || typeof input !== 'object') return input;
  return {
    ...input,
    scope: typeof input.scope === 'string' ? input.scope.trim() : '',
    kind: input.kind,
    source: typeof input.source === 'string' ? input.source.trim() : '',
    statement: typeof input.statement === 'string' ? input.statement.trim() : ''
  };
}

/**
 * Formats a valid proof input into a full Proof record.
 * @param {import('../types.js').ProofInput} input
 * @param {{ round: number; seatId: string; idIndex: number }} meta
 * @returns {import('../types.js').Proof}
 */
export function formatProofRecord(input, meta) {
  const clean = sanitizeProofInput(input);
  return {
    id: clean.id || ('P' + meta.idIndex),
    round: typeof clean.round === 'number' ? clean.round : meta.round,
    seatId: clean.seatId || meta.seatId,
    scope: clean.scope,
    kind: clean.kind,
    source: clean.source,
    statement: clean.statement,
    status: 'pending',
    judgeNote: null
  };
}
