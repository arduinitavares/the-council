/**
 * @fileoverview Council Engine Configuration Loader and Validator.
 * ESM Module (Node >= 22). Zero external dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, VALID_TOOL_POLICIES } from '../types.js';
import { ALLOWED_EFFORTS } from '../harness/cli-runner.js';

export const MAX_EVIDENCE_ITEMS = 20;
export const MAX_EVIDENCE_ID_CHARS = 64;
export const MAX_EVIDENCE_ITEM_CHARS = 32768;
export const MAX_TOTAL_EVIDENCE_CHARS = 131072;

/**
 * Validates that a value is an integer > 0.
 * If errors array is provided, pushes an error message if invalid.
 *
 * @param {unknown} val
 * @param {string} fieldName
 * @param {string[]} [errors]
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePositiveInteger(val, fieldName, errors) {
  if (val === undefined) {
    return { valid: true };
  }
  if (typeof val !== 'number' || !Number.isInteger(val) || val <= 0 || !Number.isFinite(val)) {
    const error = `${fieldName} must be a positive integer.`;
    if (Array.isArray(errors)) {
      errors.push(error);
    }
    return { valid: false, error };
  }
  return { valid: true };
}

/**
 * Validates a Council configuration object.
 * @param {Object} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Configuration must be a non-null object.'] };
  }

  if (typeof config.topic !== 'string' || !config.topic.trim()) {
    errors.push('Topic must be a non-empty string.');
  }

  if (typeof config.maxRounds !== 'number' || config.maxRounds < 1 || !Number.isInteger(config.maxRounds)) {
    errors.push('maxRounds must be an integer >= 1.');
  }

  if (typeof config.minQuorum !== 'number' || config.minQuorum < 1 || !Number.isInteger(config.minQuorum)) {
    errors.push('minQuorum must be an integer >= 1.');
  }

  if (typeof config.maxClarificationBatches !== 'number' || config.maxClarificationBatches < 0) {
    errors.push('maxClarificationBatches must be an integer >= 0.');
  }

  if (typeof config.maxRetriesPerSeat !== 'number' || config.maxRetriesPerSeat < 0) {
    errors.push('maxRetriesPerSeat must be an integer >= 0.');
  }

  if (config.timeoutMs !== undefined) {
    if (typeof config.timeoutMs !== 'number' || config.timeoutMs <= 0 || !Number.isFinite(config.timeoutMs)) {
      errors.push('timeoutMs must be a positive number.');
    }
  }

  validatePositiveInteger(config.timeout, 'timeout', errors);
  validatePositiveInteger(config.seatBudget, 'seatBudget', errors);
  validatePositiveInteger(config.totalSeatBudgetMs, 'totalSeatBudgetMs', errors);
  validatePositiveInteger(config.votingTimeoutMs, 'votingTimeoutMs', errors);

  if (config.votingReasoningEffort !== undefined) {
    if (
      typeof config.votingReasoningEffort !== 'string' ||
      !ALLOWED_EFFORTS.includes(config.votingReasoningEffort.toLowerCase())
    ) {
      errors.push(`votingReasoningEffort must be one of: ${ALLOWED_EFFORTS.join(', ')}.`);
    }
  }

  if (config.preserveVotingEffort !== undefined && typeof config.preserveVotingEffort !== 'boolean') {
    errors.push('preserveVotingEffort must be a boolean.');
  }

  if (config.votingTools !== undefined) {
    if (typeof config.votingTools !== 'string' || !VALID_TOOL_POLICIES.includes(config.votingTools)) {
      errors.push(
        `"votingTools" policy must be 'none' or 'read-only' (got "${config.votingTools}").`
      );
    }
  }

  if (config.maxConcurrentSeats !== undefined) {
    if (
      typeof config.maxConcurrentSeats !== 'number' ||
      config.maxConcurrentSeats < 1 ||
      !Number.isInteger(config.maxConcurrentSeats)
    ) {
      errors.push('maxConcurrentSeats must be an integer >= 1.');
    }
  }

  if (config.tools !== undefined) {
    if (typeof config.tools !== 'string' || !VALID_TOOL_POLICIES.includes(config.tools)) {
      errors.push(
        `"tools" policy must be 'none' or 'read-only' (got "${config.tools}"). Write tools are strictly forbidden.`
      );
    }
  }

  if (config.disableHooks !== undefined && typeof config.disableHooks !== 'boolean') {
    errors.push('disableHooks must be a boolean.');
  }

  if (config.ignoreUserConfig !== undefined && typeof config.ignoreUserConfig !== 'boolean') {
    errors.push('ignoreUserConfig must be a boolean.');
  }

  if (config.cwd !== undefined && (typeof config.cwd !== 'string' || !config.cwd.trim())) {
    errors.push('cwd must be a non-empty string.');
  }

  if (config.evidence !== undefined) {
    if (!Array.isArray(config.evidence)) {
      errors.push('evidence must be an array of { label, source, text } objects.');
    } else {
      if (config.evidence.length > MAX_EVIDENCE_ITEMS) {
        errors.push(`evidence exceeds maximum of ${MAX_EVIDENCE_ITEMS} items (got ${config.evidence.length}).`);
      }
      let totalEvidenceChars = 0;
      const seenEvidenceIds = new Set();
      config.evidence.forEach((item, idx) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          errors.push(`evidence[${idx}] must be a non-null object with label, source, and text.`);
          return;
        }
        let resolvedId = `E${idx + 1}`;
        if (item.id !== undefined) {
          if (typeof item.id !== 'string' || !item.id.trim()) {
            errors.push(`evidence[${idx}].id must be a non-empty string when provided.`);
            resolvedId = null;
          } else {
            resolvedId = item.id.trim();
            if (resolvedId.length > MAX_EVIDENCE_ID_CHARS) {
              errors.push(
                `evidence[${idx}].id (${resolvedId.length} chars) exceeds maximum id length of ${MAX_EVIDENCE_ID_CHARS} characters.`
              );
            }
          }
        }
        if (resolvedId !== null) {
          if (seenEvidenceIds.has(resolvedId)) {
            errors.push(`Duplicate evidence id "${resolvedId}" at evidence[${idx}].`);
          } else {
            seenEvidenceIds.add(resolvedId);
          }
        }
        if (typeof item.label !== 'string' || !item.label.trim()) {
          errors.push(`evidence[${idx}] requires a non-empty string "label".`);
        }
        if (typeof item.source !== 'string' || !item.source.trim()) {
          errors.push(`evidence[${idx}] requires a non-empty string "source".`);
        }
        if (typeof item.text !== 'string' || !item.text.trim()) {
          errors.push(`evidence[${idx}] requires a non-empty string "text".`);
        }
        const idChars = typeof item.id === 'string' && item.id.trim() ? item.id.trim().length : `E${idx + 1}`.length;
        const itemChars =
          idChars +
          (typeof item.label === 'string' ? item.label.length : 0) +
          (typeof item.source === 'string' ? item.source.length : 0) +
          (typeof item.text === 'string' ? item.text.length : 0);
        if (itemChars > MAX_EVIDENCE_ITEM_CHARS) {
          errors.push(
            `evidence[${idx}] (${itemChars} chars) exceeds maximum item size of ${MAX_EVIDENCE_ITEM_CHARS} characters.`
          );
        }
        totalEvidenceChars += itemChars;
      });
      if (totalEvidenceChars > MAX_TOTAL_EVIDENCE_CHARS) {
        errors.push(
          `evidence total size (${totalEvidenceChars} chars) exceeds maximum of ${MAX_TOTAL_EVIDENCE_CHARS} characters.`
        );
      }
    }
  }

  if (config.clarifications !== undefined) {
    if (!Array.isArray(config.clarifications)) {
      errors.push('clarifications must be an array of clarification objects.');
    } else {
      if (config.clarifications.length > MAX_EVIDENCE_ITEMS) {
        errors.push(
          `clarifications exceeds maximum of ${MAX_EVIDENCE_ITEMS} items (got ${config.clarifications.length}).`
        );
      }
      let totalClarificationChars = 0;
      config.clarifications.forEach((item, idx) => {
        if (typeof item === 'string') {
          if (!item.trim()) {
            errors.push(`clarifications[${idx}] string cannot be empty.`);
          }
          if (item.length > MAX_EVIDENCE_ITEM_CHARS) {
            errors.push(
              `clarifications[${idx}] (${item.length} chars) exceeds maximum item size of ${MAX_EVIDENCE_ITEM_CHARS} characters.`
            );
          }
          totalClarificationChars += item.length;
          return;
        }
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          errors.push(`clarifications[${idx}] must be a non-null object with "answer" or { label, source, text }.`);
          return;
        }
        if (item.answer !== undefined && (typeof item.answer !== 'string' || !item.answer.trim())) {
          errors.push(`clarifications[${idx}].answer must be a non-empty string when provided.`);
        }
        const hasAnswer = typeof item.answer === 'string' && item.answer.trim().length > 0;
        const hasAnyEvidenceField = item.label !== undefined || item.source !== undefined || item.text !== undefined;
        const hasEvidenceShape =
          typeof item.label === 'string' &&
          item.label.trim().length > 0 &&
          typeof item.source === 'string' &&
          item.source.trim().length > 0 &&
          typeof item.text === 'string' &&
          item.text.trim().length > 0;
        if (!hasAnswer && !hasEvidenceShape) {
          errors.push(
            `clarifications[${idx}] requires a non-empty string "answer" or non-empty "label", "source", and "text".`
          );
        } else if (hasAnyEvidenceField && !hasEvidenceShape) {
          errors.push(
            `clarifications[${idx}] with "label", "source", or "text" requires all three ("label", "source", and "text") to be non-empty strings.`
          );
        }
        if (item.batch !== undefined && (!Number.isInteger(item.batch) || item.batch < 1)) {
          errors.push(`clarifications[${idx}].batch must be an integer >= 1.`);
        }
        if (item.question !== undefined && typeof item.question !== 'string') {
          errors.push(`clarifications[${idx}].question must be a string.`);
        }
        const itemChars =
          (typeof item.answer === 'string' ? item.answer.length : 0) +
          (typeof item.question === 'string' ? item.question.length : 0) +
          (typeof item.label === 'string' ? item.label.length : 0) +
          (typeof item.source === 'string' ? item.source.length : 0) +
          (typeof item.text === 'string' ? item.text.length : 0);
        if (itemChars > MAX_EVIDENCE_ITEM_CHARS) {
          errors.push(
            `clarifications[${idx}] (${itemChars} chars) exceeds maximum item size of ${MAX_EVIDENCE_ITEM_CHARS} characters.`
          );
        }
        totalClarificationChars += itemChars;
      });
      if (totalClarificationChars > MAX_TOTAL_EVIDENCE_CHARS) {
        errors.push(
          `clarifications total size (${totalClarificationChars} chars) exceeds maximum of ${MAX_TOTAL_EVIDENCE_CHARS} characters.`
        );
      }
    }
  }

  if (config.judge) {
    if (!config.judge.id || typeof config.judge.id !== 'string') {
      errors.push('Judge requires a valid "id" string.');
    }
    if (!config.judge.harness || typeof config.judge.harness !== 'string') {
      errors.push('Judge requires a valid "harness" string.');
    }
    if (config.judge.timeoutMs !== undefined) {
      if (
        typeof config.judge.timeoutMs !== 'number' ||
        config.judge.timeoutMs <= 0 ||
        !Number.isFinite(config.judge.timeoutMs)
      ) {
        errors.push('Judge requires "timeoutMs" to be a positive number.');
      }
    }
    if (config.judge.tools !== undefined) {
      if (typeof config.judge.tools !== 'string' || !VALID_TOOL_POLICIES.includes(config.judge.tools)) {
        errors.push(
          `Judge "tools" policy must be 'none' or 'read-only' (got "${config.judge.tools}"). Write tools are strictly forbidden.`
        );
      }
    }
    if (config.judge.timeout !== undefined) {
      validatePositiveInteger(config.judge.timeout, 'Judge timeout', errors);
    }
    if (config.judge.disableHooks !== undefined && typeof config.judge.disableHooks !== 'boolean') {
      errors.push('Judge requires "disableHooks" to be a boolean.');
    }
    if (config.judge.ignoreUserConfig !== undefined && typeof config.judge.ignoreUserConfig !== 'boolean') {
      errors.push('Judge requires "ignoreUserConfig" to be a boolean.');
    }
    if (config.judge.cwd !== undefined && (typeof config.judge.cwd !== 'string' || !config.judge.cwd.trim())) {
      errors.push('Judge requires "cwd" to be a non-empty string.');
    }
  }

  if (config.seats) {
    if (!Array.isArray(config.seats)) {
      errors.push('Seats must be an array of Seat definitions.');
    } else {
      if (config.seats.length < (config.minQuorum || 2)) {
        errors.push(`Configured seats (${config.seats.length}) below minQuorum (${config.minQuorum || 2}).`);
      }
      const seenIds = new Set();
      config.seats.forEach((s, idx) => {
        if (!s || typeof s !== 'object') {
          errors.push(`Seat at index ${idx} is not an object.`);
          return;
        }
        if (!s.id || typeof s.id !== 'string' || !s.id.trim()) {
          errors.push(`Seat at index ${idx} missing valid "id".`);
        } else if (seenIds.has(s.id)) {
          errors.push(`Duplicate seat ID "${s.id}" detected.`);
        } else {
          seenIds.add(s.id);
        }
        if (!s.harness || typeof s.harness !== 'string') {
          errors.push(`Seat "${s.id || idx}" missing valid "harness".`);
        }
        if (!s.model || typeof s.model !== 'string') {
          errors.push(`Seat "${s.id || idx}" missing valid "model".`);
        }
        if (!s.soul || (typeof s.soul !== 'string' && typeof s.soul !== 'object')) {
          errors.push(`Seat "${s.id || idx}" missing valid "soul".`);
        }
        if (s.timeoutMs !== undefined) {
          if (typeof s.timeoutMs !== 'number' || s.timeoutMs <= 0 || !Number.isFinite(s.timeoutMs)) {
            errors.push(`Seat "${s.id || idx}" requires "timeoutMs" to be a positive number.`);
          }
        }
        if (s.timeout !== undefined) {
          validatePositiveInteger(s.timeout, `Seat "${s.id || idx}" timeout`, errors);
        }
        if (s.seatBudget !== undefined) {
          validatePositiveInteger(s.seatBudget, `Seat "${s.id || idx}" seatBudget`, errors);
        }
        if (s.totalSeatBudgetMs !== undefined) {
          validatePositiveInteger(s.totalSeatBudgetMs, `Seat "${s.id || idx}" totalSeatBudgetMs`, errors);
        }
        if (s.votingTimeoutMs !== undefined) {
          validatePositiveInteger(s.votingTimeoutMs, `Seat "${s.id || idx}" votingTimeoutMs`, errors);
        }
        if (s.votingTools !== undefined) {
          if (typeof s.votingTools !== 'string' || !VALID_TOOL_POLICIES.includes(s.votingTools)) {
            errors.push(
              `Seat "${s.id || idx}" "votingTools" policy must be 'none' or 'read-only' (got "${s.votingTools}").`
            );
          }
        }
        if (s.preserveVotingEffort !== undefined && typeof s.preserveVotingEffort !== 'boolean') {
          errors.push(`Seat "${s.id || idx}" requires "preserveVotingEffort" to be a boolean.`);
        }
        if (s.votingReasoningEffort !== undefined) {
          if (
            typeof s.votingReasoningEffort !== 'string' ||
            !ALLOWED_EFFORTS.includes(s.votingReasoningEffort.toLowerCase())
          ) {
            errors.push(
              `Seat "${s.id || idx}" requires "votingReasoningEffort" to be one of: ${ALLOWED_EFFORTS.join(', ')}.`
            );
          }
        }
        if (s.votingModel !== undefined) {
          if (typeof s.votingModel !== 'string' || !s.votingModel.trim()) {
            errors.push(`Seat "${s.id || idx}" requires "votingModel" to be a non-empty string.`);
          }
        }
        if (s.tools !== undefined) {
          if (typeof s.tools !== 'string' || !VALID_TOOL_POLICIES.includes(s.tools)) {
            errors.push(
              `Seat "${s.id || idx}" "tools" policy must be 'none' or 'read-only' (got "${s.tools}"). Write tools are strictly forbidden.`
            );
          }
        }
        if (s.disableHooks !== undefined && typeof s.disableHooks !== 'boolean') {
          errors.push(`Seat "${s.id || idx}" requires "disableHooks" to be a boolean.`);
        }
        if (s.ignoreUserConfig !== undefined && typeof s.ignoreUserConfig !== 'boolean') {
          errors.push(`Seat "${s.id || idx}" requires "ignoreUserConfig" to be a boolean.`);
        }
        if (s.cwd !== undefined && (typeof s.cwd !== 'string' || !s.cwd.trim())) {
          errors.push(`Seat "${s.id || idx}" requires "cwd" to be a non-empty string.`);
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Canonical Built-In Council Presets.
 */
export const COUNCIL_PRESETS = Object.freeze({
  architecture: Object.freeze({
    judge: Object.freeze({
      id: 'judge-opus',
      harness: 'antigravity',
      model: 'claude-opus-5-5-high',
      soul: 'Impartial Architecture Judge: admits only scoped, sourced proofs and synthesizes context-partitioned candidate clauses citing admitted proofs.'
    }),
    seats: Object.freeze([
      Object.freeze({
        id: 'astra-systems',
        harness: 'codex',
        model: 'gpt-6-astra (max)',
        soul: 'Systems & Architecture Purist: prioritizes clean seams, deep modules, high cohesion, and strict boundary isolation.'
      }),
      Object.freeze({
        id: 'sol-pragmatic',
        harness: 'codex',
        model: 'gpt-6.1-sol (high)',
        soul: 'Pragmatic Systems Engineer: prioritizes operability, standard tooling, and minimal moving parts.'
      }),
      Object.freeze({
        id: 'argon-staff',
        harness: 'antigravity',
        model: 'gemini-4-argon-high',
        soul: 'Staff Distributed Systems Engineer: evaluates concurrency, failure domains, and operational blast radius.'
      }),
      Object.freeze({
        id: 'opus-domain',
        harness: 'antigravity',
        model: 'claude-opus-5-5-high',
        soul: 'Enterprise Domain Architect: focuses on domain modeling, API contracts, and backward compatibility.'
      })
    ])
  }),
  'product-comparison': Object.freeze({
    judge: Object.freeze({
      id: 'judge-opus',
      harness: 'antigravity',
      model: 'claude-opus-5-5-high',
      soul: 'Impartial Product Judge: admits verified benchmarks and synthesizes balanced comparative candidates citing proof IDs.'
    }),
    seats: Object.freeze([
      Object.freeze({
        id: 'astra-specs',
        harness: 'codex',
        model: 'gpt-6-astra (max)',
        soul: 'Technical Specifications Auditor: cites official hardware, performance, and benchmark specifications.'
      }),
      Object.freeze({
        id: 'astra-ux',
        harness: 'codex',
        model: 'gpt-6-astra (max)',
        soul: 'User Experience & Ergonomics Reviewer: evaluates daily workflows, ecosystem cohesion, and developer friction.'
      }),
      Object.freeze({
        id: 'argon-value',
        harness: 'antigravity',
        model: 'gemini-4-argon-high',
        soul: 'Price-to-Performance & Longevity Analyst: evaluates total cost of ownership, durability, and value.'
      }),
      Object.freeze({
        id: 'grok-skeptic',
        harness: 'cursor',
        model: 'grok-4.7-high',
        soul: 'Independent Skeptic & Edge-Case Prober: challenges marketing claims, vendor lock-in, and real-world failure modes.'
      })
    ])
  }),
  'security-audit': Object.freeze({
    judge: Object.freeze({
      id: 'judge-astra',
      harness: 'codex',
      model: 'gpt-6-astra (max)',
      soul: 'Impartial Security Judge: admits verified vulnerability proofs and synthesizes defensive candidate requirements.'
    }),
    seats: Object.freeze([
      Object.freeze({
        id: 'astra-secops',
        harness: 'codex',
        model: 'gpt-6-astra (max)',
        soul: 'Application Security Engineer: inspects injection vectors, privilege escalation, and auth flows.'
      }),
      Object.freeze({
        id: 'opus-threat',
        harness: 'antigravity',
        model: 'claude-opus-5-5-high',
        soul: 'Threat Modeling Architect: analyzes STRIDE categories, trust boundaries, and credential boundaries.'
      }),
      Object.freeze({
        id: 'argon-supplychain',
        harness: 'antigravity',
        model: 'gemini-4-argon-high',
        soul: 'Supply Chain & Dependency Auditor: reviews transitive dependencies, package provenance, and SBOM risks.'
      })
    ])
  }),
  'argon-only': Object.freeze({
    judge: Object.freeze({
      id: 'judge-argon',
      harness: 'antigravity',
      model: 'gemini-4-argon-high',
      soul: 'Impartial Consensus Judge: audits proofs and drafts context-partitioned candidate clauses.'
    }),
    seats: Object.freeze([
      Object.freeze({
        id: 'argon-systems',
        harness: 'antigravity',
        model: 'gemini-4-argon-high',
        soul: 'Argon Systems Specialist: analyzes low-level resource utilization and performance.'
      }),
      Object.freeze({
        id: 'argon-pragmatic',
        harness: 'antigravity',
        model: 'gemini-4-argon-high',
        soul: 'Argon Pragmatic Engineer: focuses on rapid delivery, standard libraries, and simplicity.'
      }),
      Object.freeze({
        id: 'argon-skeptic',
        harness: 'antigravity',
        model: 'gemini-4-argon-high',
        soul: 'Argon Adversarial Critic: stress-tests assumptions, edge cases, and failure modes.'
      })
    ])
  })
});

export const PACKAGE_ROOT = path.resolve(import.meta.dirname, '../..');

function normalizeEvidenceList(evidence) {
  if (!Array.isArray(evidence)) return Object.freeze([]);
  const seenIds = new Set();
  return Object.freeze(
    evidence.map((item, idx) => {
      const id = typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `E${idx + 1}`;
      if (id.length > MAX_EVIDENCE_ID_CHARS) {
        throw new Error(
          `evidence[${idx}].id (${id.length} chars) exceeds maximum id length of ${MAX_EVIDENCE_ID_CHARS} characters.`
        );
      }
      if (seenIds.has(id)) {
        throw new Error(`Duplicate evidence id "${id}" at evidence[${idx}].`);
      }
      seenIds.add(id);
      return Object.freeze({
        id,
        label: String(item.label).trim(),
        source: String(item.source).trim(),
        text: String(item.text).trim()
      });
    })
  );
}

function normalizeClarificationsList(clarifications) {
  if (!Array.isArray(clarifications)) return undefined;
  return clarifications.map((item, idx) => {
    if (typeof item === 'string') {
      return {
        batch: idx + 1,
        answer: item.trim()
      };
    }
    const labelStr = typeof item?.label === 'string' ? item.label.trim() : '';
    const sourceStr = typeof item?.source === 'string' ? item.source.trim() : '';
    const textStr = typeof item?.text === 'string' ? item.text.trim() : '';
    const hasAnswer = typeof item?.answer === 'string' && item.answer.trim().length > 0;
    const answer = hasAnswer ? item.answer.trim() : `[${labelStr}] (Source: ${sourceStr}): ${textStr}`;
    return {
      batch: Number.isInteger(item?.batch) && item.batch >= 1 ? item.batch : idx + 1,
      answer,
      ...(typeof item?.question === 'string' && item.question.trim() ? { question: item.question.trim() } : {}),
      ...(labelStr ? { label: labelStr } : {}),
      ...(sourceStr ? { source: sourceStr } : {}),
      ...(textStr ? { text: textStr } : {})
    };
  });
}

/**
 * Merges partial config with default values and normalizes options.
 * @param {Object} [userConfig={}]
 * @returns {Object} Normalized CouncilConfig
 */
export function resolveConfig(userConfig = {}) {
  let presetDefinition = null;
  if (userConfig.preset !== undefined && userConfig.preset !== null) {
    if (typeof userConfig.preset === 'string' && Object.hasOwn(COUNCIL_PRESETS, userConfig.preset)) {
      presetDefinition = COUNCIL_PRESETS[userConfig.preset];
    } else if (typeof userConfig.preset === 'string' && /^[a-z0-9][a-z0-9-_]*$/i.test(userConfig.preset)) {
      const configPresetPath = path.resolve(PACKAGE_ROOT, 'configs', `${userConfig.preset}.json`);
      if (fs.existsSync(configPresetPath) && fs.statSync(configPresetPath).isFile()) {
        presetDefinition = JSON.parse(fs.readFileSync(configPresetPath, 'utf8'));
      }
    }
    if (!presetDefinition) {
      const available = Object.keys(COUNCIL_PRESETS).join(', ');
      throw new Error(`Unknown preset "${String(userConfig.preset)}". Available presets: ${available}`);
    }
  }

  const defaultTools = userConfig.tools !== undefined ? userConfig.tools : 'read-only';
  const defaultJudge = presetDefinition
    ? { ...presetDefinition.judge, tools: presetDefinition.judge.tools || defaultTools }
    : {
        id: 'judge-astra',
        harness: 'codex',
        model: 'gpt-6-astra (max)',
        soul: 'Impartial Proof Auditor: admits only scoped, sourced proofs and synthesizes context-partitioned candidates without adding personal claims.',
        tools: defaultTools
      };

  const defaultSeats = presetDefinition
    ? presetDefinition.seats.map((s) => ({ ...s, tools: s.tools || defaultTools }))
    : [
        { id: 'astra-kernel', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Systems & Kernel Purist: focuses on container density, cgroups v2, and headless uptime.', tools: defaultTools },
        { id: 'astra-gamer', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Desktop Gaming Enthusiast: focuses on DirectX 12, kernel anti-cheat, and frame pacing.', tools: defaultTools },
        { id: 'argon-unix', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Staff Mobile & Full-Stack Dev: focuses on POSIX shell, Xcode/iOS SDKs, and ARM efficiency.', tools: defaultTools }
      ];

  const rawSeats = userConfig.seats ? [...userConfig.seats] : defaultSeats;
  const resolvedMaxConcurrentSeats = userConfig.maxConcurrentSeats !== undefined
    ? userConfig.maxConcurrentSeats
    : (userConfig.seats ? userConfig.seats.length : (presetDefinition ? presetDefinition.seats.length : 10));

  const presetScalarDefaults = {};
  if (presetDefinition) {
    if (presetDefinition.maxRounds !== undefined) presetScalarDefaults.maxRounds = presetDefinition.maxRounds;
    if (presetDefinition.minQuorum !== undefined) presetScalarDefaults.minQuorum = presetDefinition.minQuorum;
  }

  const resolvedTimeoutMs =
    userConfig.timeoutMs !== undefined
      ? userConfig.timeoutMs
      : (userConfig.timeout !== undefined ? userConfig.timeout : undefined);

  const hasExplicitGlobalSeatBudget =
    typeof userConfig._explicitGlobalSeatBudget === 'boolean'
      ? userConfig._explicitGlobalSeatBudget
      : (userConfig.totalSeatBudgetMs !== undefined ||
          userConfig.seatBudget !== undefined ||
          userConfig['seat-budget'] !== undefined);

  const resolvedSeatBudget =
    userConfig.totalSeatBudgetMs !== undefined
      ? userConfig.totalSeatBudgetMs
      : (userConfig.seatBudget !== undefined
          ? userConfig.seatBudget
          : (userConfig['seat-budget'] !== undefined ? userConfig['seat-budget'] : undefined));

  const resolvedVotingTimeoutMs =
    userConfig.votingTimeoutMs !== undefined
      ? userConfig.votingTimeoutMs
      : (userConfig.votingTimeout !== undefined
          ? userConfig.votingTimeout
          : (userConfig['voting-timeout'] !== undefined ? userConfig['voting-timeout'] : 90000));

  const resolvedPreserveVotingEffort =
    typeof userConfig.preserveVotingEffort === 'boolean' ? userConfig.preserveVotingEffort : false;

  const resolvedVotingTools =
    userConfig.votingTools !== undefined
      ? userConfig.votingTools
      : (userConfig['voting-tools'] !== undefined ? userConfig['voting-tools'] : undefined);

  const resolvedVotingReasoningEffort =
    userConfig.votingReasoningEffort !== undefined
      ? userConfig.votingReasoningEffort
      : (userConfig['voting-reasoning-effort'] !== undefined ? userConfig['voting-reasoning-effort'] : 'low');

  const defaultTotalBudget = resolvedTimeoutMs !== undefined ? resolvedTimeoutMs * 2 : 480000;
  const resolvedTotalSeatBudgetMs = resolvedSeatBudget !== undefined ? resolvedSeatBudget : defaultTotalBudget;

  const merged = {
    ...DEFAULT_CONFIG,
    ...presetScalarDefaults,
    ...userConfig,
    ...(resolvedTimeoutMs !== undefined ? { timeoutMs: resolvedTimeoutMs, timeout: resolvedTimeoutMs } : {}),
    totalSeatBudgetMs: resolvedTotalSeatBudgetMs,
    seatBudget: resolvedTotalSeatBudgetMs,
    votingTimeoutMs: resolvedVotingTimeoutMs,
    preserveVotingEffort: resolvedPreserveVotingEffort,
    ...(resolvedVotingTools !== undefined ? { votingTools: resolvedVotingTools } : {}),
    votingReasoningEffort: resolvedVotingReasoningEffort,
    maxConcurrentSeats: resolvedMaxConcurrentSeats,
    judge: {
      ...defaultJudge,
      ...(userConfig.judge || {}),
      tools: userConfig.judge?.tools !== undefined
        ? userConfig.judge.tools
        : (defaultJudge.tools || defaultTools),
      ...(userConfig.judge?.timeoutMs !== undefined || userConfig.judge?.timeout !== undefined
        ? {
            timeoutMs: userConfig.judge.timeoutMs ?? userConfig.judge.timeout,
            timeout: userConfig.judge.timeoutMs ?? userConfig.judge.timeout
          }
        : {}),
      ...(userConfig.judge?.totalSeatBudgetMs !== undefined ||
      userConfig.judge?.seatBudget !== undefined ||
      userConfig.judge?.['seat-budget'] !== undefined
        ? {
            totalSeatBudgetMs:
              userConfig.judge.totalSeatBudgetMs ??
              userConfig.judge.seatBudget ??
              userConfig.judge['seat-budget'],
            seatBudget:
              userConfig.judge.totalSeatBudgetMs ??
              userConfig.judge.seatBudget ??
              userConfig.judge['seat-budget']
          }
        : {}),
      ...(userConfig.judge?.disableHooks !== undefined
        ? { disableHooks: userConfig.judge.disableHooks }
        : (userConfig.disableHooks !== undefined ? { disableHooks: userConfig.disableHooks } : {})),
      ...(userConfig.judge?.ignoreUserConfig !== undefined
        ? { ignoreUserConfig: userConfig.judge.ignoreUserConfig }
        : (userConfig.ignoreUserConfig !== undefined ? { ignoreUserConfig: userConfig.ignoreUserConfig } : {})),
      ...(userConfig.judge?.cwd !== undefined
        ? { cwd: userConfig.judge.cwd }
        : (userConfig.cwd !== undefined ? { cwd: userConfig.cwd } : {}))
    },
    seats: rawSeats.map((s) => {
      if (!s || typeof s !== 'object') return s;
      const explicitSeatTimeout =
        s.timeoutMs !== undefined ? s.timeoutMs : (s.timeout !== undefined ? s.timeout : undefined);
      const seatTimeout =
        explicitSeatTimeout !== undefined ? explicitSeatTimeout : resolvedTimeoutMs;
      const explicitSeatBudget =
        s.totalSeatBudgetMs !== undefined
          ? s.totalSeatBudgetMs
          : (s.seatBudget !== undefined
              ? s.seatBudget
              : (s['seat-budget'] !== undefined ? s['seat-budget'] : undefined));
      const seatBudget =
        explicitSeatBudget !== undefined
          ? explicitSeatBudget
          : (explicitSeatTimeout !== undefined
              ? explicitSeatTimeout * 2
              : (hasExplicitGlobalSeatBudget
                  ? resolvedSeatBudget
                  : (seatTimeout !== undefined ? seatTimeout * 2 : resolvedTotalSeatBudgetMs)));
      const seatVotingTimeout =
        s.votingTimeoutMs !== undefined
          ? s.votingTimeoutMs
          : (s.votingTimeout !== undefined
              ? s.votingTimeout
              : (s['voting-timeout'] !== undefined ? s['voting-timeout'] : resolvedVotingTimeoutMs));
      const seatPreserveVotingEffort =
        typeof s.preserveVotingEffort === 'boolean' ? s.preserveVotingEffort : resolvedPreserveVotingEffort;
      const seatVotingTools =
        s.votingTools !== undefined
          ? s.votingTools
          : (s['voting-tools'] !== undefined ? s['voting-tools'] : resolvedVotingTools);
      const seatVotingReasoningEffort =
        s.votingReasoningEffort !== undefined
          ? s.votingReasoningEffort
          : (s['voting-reasoning-effort'] !== undefined ? s['voting-reasoning-effort'] : resolvedVotingReasoningEffort);
      const seatVotingModel =
        s.votingModel !== undefined ? s.votingModel : (s['voting-model'] !== undefined ? s['voting-model'] : undefined);

      return {
        ...s,
        tools: s.tools !== undefined ? s.tools : defaultTools,
        ...(seatTimeout !== undefined ? { timeoutMs: seatTimeout, timeout: seatTimeout } : {}),
        ...(seatBudget !== undefined ? { totalSeatBudgetMs: seatBudget, seatBudget } : {}),
        ...(seatVotingTimeout !== undefined ? { votingTimeoutMs: seatVotingTimeout } : {}),
        ...(seatPreserveVotingEffort ? { preserveVotingEffort: true } : {}),
        ...(seatVotingTools !== undefined ? { votingTools: seatVotingTools } : {}),
        ...(seatVotingReasoningEffort !== undefined ? { votingReasoningEffort: seatVotingReasoningEffort } : {}),
        ...(seatVotingModel !== undefined ? { votingModel: seatVotingModel } : {}),
        ...(s.disableHooks !== undefined
          ? { disableHooks: s.disableHooks }
          : (userConfig.disableHooks !== undefined ? { disableHooks: userConfig.disableHooks } : {})),
        ...(s.ignoreUserConfig !== undefined
          ? { ignoreUserConfig: s.ignoreUserConfig }
          : (userConfig.ignoreUserConfig !== undefined ? { ignoreUserConfig: userConfig.ignoreUserConfig } : {})),
        ...(s.cwd !== undefined
          ? { cwd: s.cwd }
          : (userConfig.cwd !== undefined ? { cwd: userConfig.cwd } : {}))
      };
    })
  };

  const validation = validateConfig(merged);
  if (!validation.valid) {
    throw new Error(`Invalid Council configuration: ${validation.errors.join('; ')}`);
  }

  const normalizedEvidence = normalizeEvidenceList(merged.evidence);
  const normalizedClarifications = normalizeClarificationsList(merged.clarifications);
  const resolvedMaxClarificationBatches = Array.isArray(normalizedClarifications)
    ? Math.max(merged.maxClarificationBatches, normalizedClarifications.length)
    : merged.maxClarificationBatches;

  const normalizedJudge =
    merged.judge && typeof merged.judge === 'object'
      ? {
          ...merged.judge,
          ...(typeof merged.judge.cwd === 'string' ? { cwd: merged.judge.cwd.trim() } : {})
        }
      : merged.judge;
  const normalizedSeats = Array.isArray(merged.seats)
    ? merged.seats.map((s) =>
        s && typeof s === 'object'
          ? {
              ...s,
              ...(typeof s.cwd === 'string' ? { cwd: s.cwd.trim() } : {})
            }
          : s
      )
    : merged.seats;

  const finalConfig = {
    ...merged,
    judge: normalizedJudge,
    seats: normalizedSeats,
    ...(typeof merged.cwd === 'string' ? { cwd: merged.cwd.trim() } : {}),
    maxClarificationBatches: resolvedMaxClarificationBatches,
    evidence: normalizedEvidence,
    ...(normalizedClarifications !== undefined ? { clarifications: normalizedClarifications } : {})
  };
  Object.defineProperty(finalConfig, '_explicitGlobalSeatBudget', {
    value: hasExplicitGlobalSeatBudget,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return Object.freeze(finalConfig);
}

export const normalizeCouncilConfig = resolveConfig;

/**
 * Loads and resolves configuration from a JSON file.
 * @param {string} filePath
 * @param {Object} [overrides={}]
 * @returns {Object} Normalized CouncilConfig
 */
export function loadConfigFile(filePath, overrides = {}) {
  let resolvedPath = path.resolve(process.cwd(), filePath);
  if (!(fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) && !path.isAbsolute(filePath)) {
    const fallbackCandidates = [
      path.resolve(PACKAGE_ROOT, filePath),
      path.resolve(PACKAGE_ROOT, 'configs', filePath),
      ...(!filePath.endsWith('.json') ? [path.resolve(PACKAGE_ROOT, 'configs', `${filePath}.json`)] : [])
    ];
    for (const candidate of fallbackCandidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        resolvedPath = candidate;
        break;
      }
    }
  }
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Configuration file not found: "${resolvedPath}"`);
  }
  const content = fs.readFileSync(resolvedPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Malformed JSON in configuration file "${resolvedPath}": ${err.message}`);
  }
  const mergedInput = { ...parsed, ...overrides };
  if (Array.isArray(parsed?.evidence) && Array.isArray(overrides?.evidence)) {
    mergedInput.evidence = [...parsed.evidence, ...overrides.evidence];
  }
  return resolveConfig(mergedInput);
}
