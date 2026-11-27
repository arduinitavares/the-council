/**
 * @fileoverview Pure digest-binding validator for The Council.
 * Validates opt-in expected policy/evidence SHA-256 digests and enforces
 * single-pair binding placement in Judge synthesis summaries while forbidding
 * binding-field repetition in substantive clauses.
 */

export const EXPECTED_DIGEST_HEX_REGEX = /^[0-9a-f]{64}$/i;
export const BINDING_FIELDS = Object.freeze(['policy_sha256', 'frozen_packet_sha256']);

const BINDING_FIELD_REGEX = /(?<![A-Za-z0-9_])(policy_sha256|frozen_packet_sha256)(?![A-Za-z0-9_])/gi;
const LABEL_CLOSE_SEP_REGEX = /^([`"'*_]{0,2})[ \t]*[:=]/;
const QUOTED_VALUE_REGEX = /^([`"'])([^`"'\r\n]*)\1/;
const EMPHASIS_VALUE_REGEX = /^(\*{1,2}|_{1,2})([^*_\s\r\n]*)\1/;
const VALUE_TOKEN_REGEX = /^([^\s,;)\]}"'`*]+)/;
const VALID_PLAIN_BOUNDARY_REGEX = /^(?:$|[\s,;)\]}!?]|\.(?=$|[\s,;)\]}]))/;

/**
 * Checks whether a value is a strict 64-character hexadecimal string.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidSha256Hex(value) {
  return typeof value === 'string' && EXPECTED_DIGEST_HEX_REGEX.test(value);
}

/**
 * Validates optional `expectedDigests` configuration / CLI values.
 * Returns `{ valid: true, errors: [], normalized: null }` when omitted/null.
 * When provided, requires both `policy` and `evidence` to be valid 64-char hex strings.
 *
 * @param {unknown} expectedDigests
 * @returns {{ valid: boolean, errors: string[], normalized: Readonly<{ policy: string, evidence: string }> | null }}
 */
export function validateExpectedDigestsConfig(expectedDigests) {
  if (expectedDigests === undefined || expectedDigests === null) {
    return { valid: true, errors: [], normalized: null };
  }
  if (typeof expectedDigests !== 'object' || Array.isArray(expectedDigests)) {
    return {
      valid: false,
      errors: [
        'expectedDigests must be a plain object with "policy" and "evidence" 64-character hexadecimal strings.'
      ],
      normalized: null
    };
  }

  const errors = [];
  for (const key of ['policy', 'evidence']) {
    const val = expectedDigests[key];
    if (val === undefined || val === null || val === '') {
      errors.push(
        `expectedDigests.${key} is required when expectedDigests is provided (must be a 64-character hexadecimal string).`
      );
    } else if (!isValidSha256Hex(val)) {
      errors.push(`expectedDigests.${key} must be a valid 64-character hexadecimal string.`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, normalized: null };
  }

  return {
    valid: true,
    errors: [],
    normalized: Object.freeze({
      policy: expectedDigests.policy.toLowerCase(),
      evidence: expectedDigests.evidence.toLowerCase()
    })
  };
}

function findBindingMatches(text) {
  if (typeof text !== 'string' || !text) return [];
  const matches = [];
  const regex = new RegExp(BINDING_FIELD_REGEX.source, 'gi');
  let m;
  while ((m = regex.exec(text)) !== null) {
    matches.push({
      rawLabel: m[1],
      field: m[1].toLowerCase(),
      index: m.index,
      endIndex: m.index + m[1].length
    });
  }
  return matches;
}

/**
 * Validates Judge synthesis digest binding against expected policy & evidence digests.
 * - Requires exactly one `policy_sha256` and one `frozen_packet_sha256` in `judge.summary`
 *   matching `expectedDigests.policy` and `expectedDigests.evidence` (case-insensitive hex).
 * - Parses each binding as a local `field: value` pair (supporting optional local quotes,
 *   backticks, or emphasis immediately wrapping the label or value, without lexing multi-field
 *   Markdown emphasis spans across surrounding prose).
 * - Rejects missing, mismatched, swapped, malformed, or duplicate bindings in `judge.summary`.
 * - Rejects either binding field appearing in substantive clauses (even if malformed).
 * - Allows unrelated hexadecimal hashes used as evidence references.
 *
 * @param {Object | null | undefined} judgeResult
 * @param {{ policy: string, evidence: string } | null | undefined} expectedDigests
 * @returns {{ valid: boolean, errors: string[], diagnostics: Array<{ location: string, field: string, kind: string, message: string }> }}
 */
export function validateJudgeDigestBinding(judgeResult, expectedDigests) {
  if (!expectedDigests) {
    return { valid: true, errors: [], diagnostics: [] };
  }

  const expectedPolicy = String(expectedDigests.policy || '').toLowerCase();
  const expectedEvidence = String(expectedDigests.evidence || '').toLowerCase();
  const expectedByField = {
    policy_sha256: {
      expected: expectedPolicy,
      otherField: 'frozen_packet_sha256',
      otherExpected: expectedEvidence
    },
    frozen_packet_sha256: {
      expected: expectedEvidence,
      otherField: 'policy_sha256',
      otherExpected: expectedPolicy
    }
  };

  const errors = [];
  const diagnostics = [];
  const recordIssue = (location, field, kind, message) => {
    errors.push(message);
    diagnostics.push({ location, field, kind, message });
  };

  const rawSummary = judgeResult?.summary ?? judgeResult?.candidate?.summary;
  const summaryText = typeof rawSummary === 'string' ? rawSummary : '';
  const summaryMatches = findBindingMatches(summaryText);

  for (const field of BINDING_FIELDS) {
    const { expected, otherField, otherExpected } = expectedByField[field];
    const matches = summaryMatches.filter((item) => item.field === field);

    if (matches.length === 0) {
      recordIssue('judge.summary', field, 'missing', `judge.summary is missing required ${field} binding.`);
      continue;
    }
    if (matches.length > 1) {
      recordIssue(
        'judge.summary',
        field,
        'duplicate',
        `judge.summary contains duplicate ${field} bindings (${matches.length} found; expected exactly 1).`
      );
      continue;
    }

    const match = matches[0];
    if (match.rawLabel !== field) {
      recordIssue(
        'judge.summary',
        field,
        'malformed',
        `judge.summary has malformed ${field} label casing (must be lowercase "${field}").`
      );
      continue;
    }

    const tail = summaryText.slice(match.endIndex);
    const sepMatch = LABEL_CLOSE_SEP_REGEX.exec(tail);
    if (!sepMatch) {
      recordIssue(
        'judge.summary',
        field,
        'malformed',
        `judge.summary has malformed ${field} binding (missing ": <64-hex>" value).`
      );
      continue;
    }

    let pos = sepMatch[0].length;
    const beforeLabel = summaryText.slice(Math.max(0, match.index - 3), match.index);
    const openedEmphasis = /(?:^|[\s([{"'`])(\*{1,2}|_{1,2})$/.exec(beforeLabel)?.[1] || '';
    let labelClosedEmphasis = Boolean(sepMatch[1]);
    if (
      !labelClosedEmphasis &&
      openedEmphasis &&
      tail.slice(pos).startsWith(openedEmphasis) &&
      tail[pos + openedEmphasis.length] !== openedEmphasis[0]
    ) {
      pos += openedEmphasis.length;
      labelClosedEmphasis = true;
    }

    const wsMatch = /^[ \t]*(?:\r?\n[ \t]*)?/.exec(tail.slice(pos));
    pos += wsMatch[0].length;
    const afterSep = tail.slice(pos);
    const hasValidTrailingBoundary = (remainder) => {
      if (VALID_PLAIN_BOUNDARY_REGEX.test(remainder)) {
        return true;
      }
      if (!labelClosedEmphasis && openedEmphasis && remainder.startsWith(openedEmphasis)) {
        const afterEmph = remainder.slice(openedEmphasis.length);
        if (afterEmph[0] !== openedEmphasis[0] && VALID_PLAIN_BOUNDARY_REGEX.test(afterEmph)) {
          return true;
        }
      }
      return false;
    };

    let value = null;
    let malformedMessage = null;

    if (afterSep && /^([`"'])/.test(afterSep)) {
      const quoted = QUOTED_VALUE_REGEX.exec(afterSep);
      if (!quoted) {
        malformedMessage = `judge.summary has malformed ${field} value (unclosed quote or backtick delimiter).`;
      } else if (!hasValidTrailingBoundary(afterSep.slice(quoted[0].length))) {
        malformedMessage = `judge.summary has malformed ${field} value (unexpected trailing characters after digest).`;
      } else {
        value = quoted[2];
      }
    } else if (afterSep && /^(?:\*{1,2}|_{1,2})/.test(afterSep)) {
      const md = EMPHASIS_VALUE_REGEX.exec(afterSep);
      if (!md) {
        malformedMessage = `judge.summary has malformed ${field} value (unclosed emphasis delimiter).`;
      } else if (!hasValidTrailingBoundary(afterSep.slice(md[0].length))) {
        malformedMessage = `judge.summary has malformed ${field} value (unexpected trailing characters after digest).`;
      } else {
        value = md[2];
      }
    } else {
      const tokenMatch = VALUE_TOKEN_REGEX.exec(afterSep);
      if (!tokenMatch) {
        malformedMessage = `judge.summary has malformed ${field} value (expected 64-character hex digest, got 0 chars).`;
      } else {
        const rawToken = tokenMatch[1];
        const remainder = afterSep.slice(rawToken.length);
        if (!hasValidTrailingBoundary(remainder)) {
          malformedMessage = `judge.summary has malformed ${field} value (unexpected trailing characters after digest).`;
        } else {
          value = rawToken.replace(/(?<!\.)\.$/, '');
        }
      }
    }

    if (malformedMessage) {
      recordIssue('judge.summary', field, 'malformed', malformedMessage);
      continue;
    }

    if (!value || !EXPECTED_DIGEST_HEX_REGEX.test(value)) {
      recordIssue(
        'judge.summary',
        field,
        'malformed',
        `judge.summary has malformed ${field} value (expected 64-character hex digest, got ${value.length} chars).`
      );
      continue;
    }

    const lowerValue = value.toLowerCase();
    if (lowerValue === expected) {
      continue;
    }
    if (lowerValue === otherExpected) {
      recordIssue(
        'judge.summary',
        field,
        'swapped',
        `judge.summary has swapped ${field} value (matches ${otherField} instead of expected ${field}).`
      );
    } else {
      recordIssue(
        'judge.summary',
        field,
        'mismatch',
        `judge.summary has mismatched ${field} value (does not match expected ${field} digest).`
      );
    }
  }

  const clauses = Array.isArray(judgeResult?.clauses)
    ? judgeResult.clauses
    : Array.isArray(judgeResult?.candidate?.clauses)
      ? judgeResult.candidate.clauses
      : [];

  const scanClauseNode = (location, node, seen) => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      if (!node.trim()) return;
      for (const match of findBindingMatches(node)) {
        const key = `${location}:${match.field}`;
        if (seen.has(key)) continue;
        seen.add(key);
        recordIssue(
          location,
          match.field,
          'clause_repetition',
          `${location} must not repeat binding field ${match.field}; place bindings only in judge.summary and cite proof IDs in clauses.`
        );
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        scanClauseNode(location, item, seen);
      }
      return;
    }
    if (typeof node === 'object') {
      for (const [propKey, propVal] of Object.entries(node)) {
        const propLoc = `${location}.${propKey}`;
        for (const match of findBindingMatches(propKey)) {
          const dedupKey = `${propLoc}:${match.field}`;
          if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            recordIssue(
              propLoc,
              match.field,
              'clause_repetition',
              `${propLoc} must not repeat binding field ${match.field}; place bindings only in judge.summary and cite proof IDs in clauses.`
            );
          }
        }
        scanClauseNode(propLoc, propVal, seen);
      }
    }
  };

  clauses.forEach((clause, idx) => {
    if (!clause || typeof clause !== 'object') return;
    scanClauseNode(`judge.clauses[${idx}]`, clause, new Set());
  });

  return {
    valid: errors.length === 0,
    errors,
    diagnostics
  };
}
