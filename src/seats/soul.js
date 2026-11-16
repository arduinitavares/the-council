/**
 * @fileoverview Soul Prompt Formatting, Temperament Injection & Catalog for The Council.
 * ESM Module (Node >= 22)
 *
 * Implements:
 * - Soul configuration, temperament, and domain lens definitions
 * - Catalog of standard domain postures (Adversarial, Formal Verifier, Pragmatic, Security, Systems, etc.)
 * - Prompt injection across deliberation phases (Clarification, Deliberation, Voting)
 * - Structured Proof and Voting schema constraints
 */

import { VALID_PROOF_KINDS } from '../types.js';
import { extractVerificationDependencies } from '../engine/recovery.js';

/**
 * Catalog of standard pre-configured Souls for diverse model temperaments.
 * @readonly
 */
export const STANDARD_SOULS = Object.freeze({
  ADVERSARIAL_CHALLENGER: Object.freeze({
    name: 'Adversarial Challenger',
    temperament: 'adversarial',
    lens: 'Edge cases, race conditions, Byzantine failure modes, and unstated assumptions.',
    rules: Object.freeze([
      'Actively search for counter-examples, failure modes, and scalability limits.',
      'Reject consensus if subtle edge-case risks or race conditions remain unaddressed.',
      'Demand empirical benchmark or citation proofs before conceding correctness.'
    ])
  }),

  FORMAL_VERIFIER: Object.freeze({
    name: 'Formal Verifier',
    temperament: 'rigorous',
    lens: 'Mathematical soundness, axiomatic derivations, state machine invariants, and formal logic.',
    rules: Object.freeze([
      'Every assertion must be derived from first principles or authoritative specifications.',
      'Reject hand-waving or probabilistic arguments lacking formal bounds.',
      'Enforce unambiguous terminology and state transition correctness.'
    ])
  }),

  PRAGMATIC_ENGINEER: Object.freeze({
    name: 'Pragmatic Engineer',
    temperament: 'pragmatic',
    lens: 'Operational simplicity, developer ergonomics, maintenance overhead, and zero-daemon footprint.',
    rules: Object.freeze([
      'Favor zero-daemon, self-contained architectures over complex distributed dependencies.',
      'Evaluate failure modes through the lens of day-2 operations and debugging ergonomics.',
      'Prioritize working, verifiable simplicity over theoretical architectural purity.'
    ])
  }),

  SECURITY_AUDITOR: Object.freeze({
    name: 'Security Auditor',
    temperament: 'skeptical',
    lens: 'Attack surface, threat modeling, least privilege, supply chain integrity, and CVE risks.',
    rules: Object.freeze([
      'Scrutinize trust boundaries, network exposure, and privilege escalation vectors.',
      'Demand immutable builds, verified sources, and cryptographic provenance.',
      'Object to unauthenticated interfaces or broad file access permissions.'
    ])
  }),

  SYSTEMS_PURIST: Object.freeze({
    name: 'Systems & Kernel Purist',
    temperament: 'purist',
    lens: 'Kernel architecture, container namespaces, cgroups v2, CPU/memory layout, and IPC latency.',
    rules: Object.freeze([
      'Inspect kernel overhead, context switching costs, and OS resource isolation.',
      'Verify OCI, POSIX, or OS-native compliance at the syscall layer.',
      'Demand concrete empirical measurements for throughput and p99 latency.'
    ])
  }),

  PERFORMANCE_BENCHMARKER: Object.freeze({
    name: 'Performance Benchmarker',
    temperament: 'empirical',
    lens: 'Throughput measurements, p99 latency distributions, hardware specs, and reproducible benchmarks.',
    rules: Object.freeze([
      'Require verifiable benchmark methodology, sample sizes, and hardware specs.',
      'Reject claims of superiority without reproducible performance data.',
      'Distinguish steady-state performance from cold-start anomalies.'
    ])
  }),

  DOMAIN_MODELER: Object.freeze({
    name: 'Domain Modeler',
    temperament: 'structured',
    lens: 'Domain-driven design, bounded contexts, ubiquitous language, and transactional integrity.',
    rules: Object.freeze([
      'Enforce strict domain boundaries and unambiguous terminology matching GLOSSARY.md.',
      'Preserve state transition invariants and audit trails.',
      'Reject ambiguous concepts or leaky domain abstractions.'
    ])
  }),

  IMPARTIAL_JUDGE: Object.freeze({
    name: 'Impartial Proof Auditor',
    temperament: 'impartial',
    lens: 'Objective proof verification, context-partitioned synthesis, and proof-bound resolution.',
    rules: Object.freeze([
      'Admit only scoped, sourced, falsifiable proofs; reject bare opinions or unsubstantiated claims.',
      'Synthesize candidate clauses strictly citing admitted proof IDs.',
      'Never inject personal opinions or introduce claims unbacked by admitted proofs.'
    ])
  })
});

/**
 * Validates a Soul configuration.
 * @param {any} config
 * @returns {{ valid: boolean; errors: string[] }}
 */
export function validateSoulConfig(config) {
  const errors = [];
  if (!config) {
    return { valid: false, errors: ['Soul configuration cannot be null or undefined.'] };
  }

  if (typeof config === 'string') {
    if (!config.trim()) {
      return { valid: false, errors: ['Soul string description cannot be empty or whitespace.'] };
    }
    return { valid: true, errors: [] };
  }

  if (typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, errors: ['Soul configuration must be a string or an object.'] };
  }

  if (!config.name || typeof config.name !== 'string' || !config.name.trim()) {
    errors.push('Soul requires a non-empty string "name".');
  }

  if (!config.lens || typeof config.lens !== 'string' || !config.lens.trim()) {
    errors.push('Soul requires a non-empty string "lens".');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Soul representation encapsulating temperament, reasoning posture, and domain lens.
 */
export class Soul {
  /**
   * @param {Object|string} input
   */
  constructor(input) {
    if (typeof input === 'string') {
      this._name = input.split(':')[0]?.trim() || 'Custom Soul';
      this._temperament = 'custom';
      this._lens = input.includes(':') ? input.split(':').slice(1).join(':').trim() : input.trim();
      this._rules = [];
      this._customPrompt = input.trim();
    } else {
      const check = validateSoulConfig(input);
      if (!check.valid) {
        throw new Error(`Invalid Soul configuration: ${check.errors.join('; ')}`);
      }
      this._name = input.name.trim();
      this._temperament = input.temperament ? input.temperament.trim() : 'custom';
      this._lens = input.lens.trim();
      this._rules = Array.isArray(input.rules) ? [...input.rules] : [];
      this._customPrompt = input.customPrompt ? input.customPrompt.trim() : '';
    }
  }

  get name() { return this._name; }
  get temperament() { return this._temperament; }
  get lens() { return this._lens; }
  get rules() { return [...this._rules]; }
  get customPrompt() { return this._customPrompt; }

  /**
   * Returns a plain string summary for backward compatibility with prototype strings.
   * @returns {string}
   */
  toString() {
    return `${this._name}: ${this._lens}`;
  }

  /**
   * Serializes soul definition.
   * @returns {string}
   */
  toJSON() {
    return this.toString();
  }
}

/**
 * Factory creating a Soul instance. Accepts string, Soul instance, or Soul config object.
 * @param {string | Object | Soul} input
 * @returns {Soul}
 */
export function createSoul(input) {
  if (input instanceof Soul) return input;
  return new Soul(input);
}

export const ANTI_CHEATING_RULE =
  'STRICT ANTI-CHEATING RULE: Never read, grep, or inspect ".council/" (including ".council/runs/", ".council/telemetry/", ".council/runs/latest.js", "latest.js", "*.meta.json", "*.events.jsonl", "telemetry-summary.*", run snapshots, or telemetry files). Isolated workspace copies already omit ".council/" physically, so NEVER pass ".council", "latest.js", "*.meta.json", "*.events.jsonl", or "telemetry-summary.*" in CLI flags, negative globs or exclude pathspecs, or tool/MCP search queries. Accessing ".council/" or passing those patterns violates blind deliberation independence and immediately invalidates your turn.';

const ISOLATED_WORKSPACE_PATH_DIRECTIVE =
  'Inspect workspace files via relative paths rooted at "." (your current working directory is already the attached workspace, materialized as an isolated .council-free workspace copy (and .codegraph-free) when ".council" or ".codegraph" exists on the host). Prefer native read/search tools (Read/read_file, Glob, Grep, LS) over headless Bash or codegraph CLI invocations whenever native tools suffice; if a native read/search tool schema strictly requires an absolute path, pass only a path strictly inside your current isolated workspace directory. NEVER read, "cd" into, traverse via "..", or pass "git -C" or absolute host filesystem/repository paths to shell, file, or search tools—even when an absolute host path appears verbatim in the Topic Handoff, Clarifications, or [E#] baseline evidence—because accessing host workspace roots triggers FORBIDDEN_STATE_ACCESS. In all final citations (proof "source"/"statement", vote "reason", Judge "summary"/"clauses"/"proofDecisions"), cite portable repository-relative paths only—NEVER cite temporary copy directory names, raw temp filesystem paths, or host repository paths.';

const CLARIFICATION_WORKSPACE_DIRECTIVE =
  'TOOL USAGE & WORKSPACE DIRECTIVE: If a workspace is attached, inspect workspace files via relative paths rooted at "." (your current working directory is already an isolated .council-free workspace copy (and .codegraph-free) when ".council" or ".codegraph" exists on the host); prefer native read/search tools (Read/read_file, Glob, Grep, LS) over headless Bash or codegraph CLI invocations whenever native tools suffice, passing only "."-relative paths (or an absolute path strictly inside your current isolated workspace directory if a native tool schema requires one). If no workspace is attached, do not run local filesystem tools (do not infer that no workspace is attached merely because seat.cwd is absent). NEVER read, "cd" into, traverse via "..", or pass "git -C" or absolute host filesystem/repository paths mentioned in the Topic Handoff to shell, file, or search tools—probing host workspace roots triggers FORBIDDEN_STATE_ACCESS. Keep any referenced paths portable and repository-relative only (never echo temporary copy directory names, raw temp paths, or host repository paths).';

const DEFAULT_ADMITTED_JUDGE_NOTE = 'Admitted by Judge.';

/**
 * Extracts a substantive Judge note from a proof decision/record.
 * Always preserves non-empty trimmed notes on `partially_admitted` proofs,
 * and excludes the reducer's `default_admitted` boilerplate on `admitted` proofs.
 *
 * @param {Object|null|undefined} proof
 * @returns {string}
 */
export function getSubstantiveJudgeNote(proof) {
  if (!proof || typeof proof !== 'object') return '';
  const noteText = typeof proof.judgeNote === 'string' ? proof.judgeNote.trim() : '';
  if (!noteText) return '';
  if (proof.status === 'partially_admitted') {
    return noteText;
  }
  if (noteText === DEFAULT_ADMITTED_JUDGE_NOTE) {
    return '';
  }
  return noteText;
}

/**
 * Resolves prior-round admitted and partially_admitted proofs strictly earlier than `resolvedRound`.
 *
 * @param {Array<Object>} priorAdmittedProofs
 * @param {Object|null} state
 * @param {number} resolvedRound
 * @param {Set<string>|null} [excludeIds=null]
 * @returns {Array<Object>}
 */
export function resolvePriorAdmittedProofs(priorAdmittedProofs, state, resolvedRound, excludeIds = null) {
  if (Array.isArray(priorAdmittedProofs) && priorAdmittedProofs.length > 0) {
    return priorAdmittedProofs;
  }
  return (state?.proofs || []).filter(
    (p) =>
      p &&
      (!excludeIds || !excludeIds.has(p.id)) &&
      (typeof p.round === 'number' ? p.round < resolvedRound : true) &&
      (p.status === 'admitted' || p.status === 'partially_admitted')
  );
}

const VOTING_CONSISTENCY_DIRECTIVE =
  'Audit both Candidate Summary and Candidate Clauses for mutual consistency with Topic, cited proofs and their caveats (Judge Note and Admitted Core), and Your Open Objections from Prior Rounds; object if Candidate Summary contradicts Candidate Clauses or Topic, drops decisive conditions/scope bounds/quantities/caveats, or presents unavailable upstream verification as verified fact instead of explicitly labeling it as a limitation or abstention.';

function judgeItemsCiteWorkspacePath(proofs, openObjections) {
  const texts = [];
  const structuredSources = [];
  if (Array.isArray(proofs)) {
    for (const p of proofs) {
      if (!p || typeof p !== 'object') continue;
      if (typeof p.source === 'string' && p.source.trim()) structuredSources.push(p.source);
      if (typeof p.statement === 'string' && p.statement.trim()) texts.push(p.statement);
      if (typeof p.scope === 'string' && p.scope.trim()) texts.push(p.scope);
    }
  }
  if (Array.isArray(openObjections)) {
    for (const o of openObjections) {
      if (!o || typeof o !== 'object') continue;
      if (typeof o.reason === 'string' && o.reason.trim()) texts.push(o.reason);
    }
  }
  if (texts.length === 0 && structuredSources.length === 0) {
    return false;
  }
  if ([...structuredSources, ...texts].some((s) => /\bfile:\/\/\S+/i.test(s))) {
    return true;
  }
  const deps = extractVerificationDependencies(texts, { structuredSources });
  if (deps.workspaceFileDeps.length > 0) {
    return true;
  }
  return deps.workspaceBroadDeps.some(
    (dep) =>
      typeof dep === 'string' &&
      dep.length > 0 &&
      !/\s/.test(dep) &&
      !/^(?:\d*[<>]|&>|\$\(|`)/.test(dep) &&
      (dep.endsWith('/') || /[*?[\]{}]/.test(dep))
  );
}

const CLARIFICATION_TOOL_FREE_DIRECTIVE =
  'Do not invoke any tools (no shell, file reads, or web searches) on this clarification turn. Inspect only the provided Topic Handoff.';

/**
 * Formats the system prompt preamble establishing the Seat's identity and Soul temperament.
 * @param {Soul | string} soulInput
 * @param {Object} seatContext
 * @param {string} seatContext.id
 * @param {string} seatContext.harness
 * @param {string} seatContext.model
 * @returns {string}
 */
export function formatSoulSystemPrompt(soulInput, seatContext) {
  const soul = createSoul(soulInput);
  const rulesList = soul.rules.length > 0
    ? `\n### Reasoning Directives:\n${soul.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
    : '';

  return `You are Seat "${seatContext.id}" (${seatContext.model} on harness "${seatContext.harness}") in The Council consensus engine.

## Your Configured Soul & Perspective:
- Archetype: ${soul.name}
- Domain Lens: ${soul.lens}${rulesList}

## Deliberation Invariants:
1. Intellectual Rigor: Argue strictly through your domain lens while adhering to empirical truth.
2. Structured Proofs: Bare opinions or intuition are strictly forbidden. All claims must cite verifiable sources. Supported kinds: ${VALID_PROOF_KINDS.join(', ')}.
3. Voting Principle: You may vote to ACCEPT the Candidate only when it satisfies your domain standards. If it fails, you MUST vote to OBJECT, stating a clear reason and citing a valid, non-rejected Proof ID.
4. ${ANTI_CHEATING_RULE}`;
}

/**
 * Formats a pre-deliberation Clarification prompt for a Seat.
 * @param {Object} params
 * @param {Soul | string} params.soul
 * @param {Object} params.seat
 * @param {string} params.topic
 * @param {number} params.batch
 * @param {number} params.maxBatches
 * @param {'none' | 'read-only'} [params.tools]
 * @returns {string}
 */
export function formatClarificationPrompt({ soul, seat, topic, batch, maxBatches, tools }) {
  const s = createSoul(soul);
  const resolvedTools = tools !== undefined ? tools : (seat?.tools || 'read-only');
  const directive = resolvedTools === 'none'
    ? CLARIFICATION_TOOL_FREE_DIRECTIVE
    : CLARIFICATION_WORKSPACE_DIRECTIVE;
  return `### Pre-Deliberation Discovery: Clarification Batch ${batch}/${maxBatches}
Topic Handoff:
"${topic}"

As Seat "${seat?.id || 'seat'}" with Soul "${s.name}" (${s.lens}), inspect this topic handoff.
Are there missing constraints, workload ambiguities, or unstated assumptions that must be clarified before deliberation begins?

${directive}
${ANTI_CHEATING_RULE}

Respond with:
- If clarification is needed: "QUESTION: <specific technical question>"
- If the topic is sufficiently clear: "CLEAR: No clarifications needed."`;
}

/**
 * Formats pre-gathered grounding evidence and broadcast clarifications with clear data delimiters.
 * @param {Array<Object>} [evidence=[]]
 * @param {Array<Object>} [clarifications=[]]
 * @returns {string}
 */
export function formatGroundingSection(evidence = [], clarifications = []) {
  let section = '';

  if (Array.isArray(evidence) && evidence.length > 0) {
    section += `\nPre-Gathered Baseline Evidence (Attributed & Challengeable):\n` +
      evidence.map((e, i) => {
        const eid = e.id || `E${i + 1}`;
        return `--- BEGIN EVIDENCE [${eid}] ${e.label} (Source: ${e.source}) ---\n[${eid}] ${e.label} (Source: ${e.source}): ${e.text}\n--- END EVIDENCE [${eid}] ---`;
      }).join('\n') + '\n';
  }

  if (Array.isArray(clarifications) && clarifications.length > 0) {
    section += `\nBroadcast Clarifications:\n` +
      clarifications.map((c, i) => `Batch ${c.batch || i + 1}: ${c.answer}`).join('\n') + '\n';
  }

  return section;
}

/**
 * Formats a Deliberation Proof Submission prompt for a Seat.
 * @param {Object} params
 * @param {Soul | string} params.soul
 * @param {Object} params.seat
 * @param {string} params.topic
 * @param {number} params.round
 * @param {number} params.maxRounds
 * @param {Array<Object>} [params.clarifications=[]]
 * @param {Object|null} [params.previousCandidate=null]
 * @param {Array<Object>} [params.openObjections=[]]
 * @param {Array<Object>} [params.priorAdmittedProofs=[]]
 * @param {Object|null} [params.state=null]
 * @param {'none' | 'read-only'} [params.tools]
 * @param {string} [params.cwd]
 * @param {boolean} [params.rebuttalMode=false]
 * @param {'rebuttal' | 'deliberation' | string} [params.mode]
 * @returns {string}
 */
export function formatDeliberationPrompt({
  soul,
  seat,
  topic,
  round,
  maxRounds,
  evidence = [],
  clarifications = [],
  previousCandidate = null,
  openObjections = [],
  priorAdmittedProofs = [],
  state = null,
  tools,
  cwd,
  rebuttalMode = false,
  mode
}) {
  const s = createSoul(soul);
  const resolvedTools = tools !== undefined ? tools : (seat?.tools || 'read-only');
  const isRebuttal = Boolean(
    rebuttalMode ||
      mode === 'rebuttal' ||
      seat?.rebuttalMode ||
      seat?.mode === 'rebuttal'
  );
  const hasWorkspaceCwd = resolvedTools !== 'none' && Boolean(
    (typeof cwd === 'string' && cwd.trim()) ||
    (typeof seat?.cwd === 'string' && seat.cwd.trim()) ||
    (typeof state?.cwd === 'string' && state.cwd.trim())
  );

  const resolvedTopic = topic || state?.topic || '';
  const resolvedRound = round || state?.round || 1;
  const resolvedMaxRounds = maxRounds || state?.maxRounds || 3;
  const resolvedEvidence = (evidence && evidence.length > 0)
    ? evidence
    : (state?.evidence || []);
  const resolvedClarifications = (clarifications && clarifications.length > 0)
    ? clarifications
    : (state?.clarifications || []);
  const resolvedPrevCandidate = previousCandidate || state?.candidate || null;
  const resolvedObjections = (openObjections && openObjections.length > 0)
    ? openObjections
    : (state?.objections || []).filter((o) => o && o.status === 'open');
  const resolvedPriorAdmittedProofs = resolvedRound > 1
    ? resolvePriorAdmittedProofs(priorAdmittedProofs, state, resolvedRound)
    : [];

  let contextBlock = `Topic: "${resolvedTopic}"\n`;
  contextBlock += formatGroundingSection(resolvedEvidence, resolvedClarifications);

  if (resolvedPrevCandidate) {
    contextBlock += `\nPrevious Candidate from Round ${resolvedPrevCandidate.round}:\n` +
      `Summary: ${resolvedPrevCandidate.summary || ''}\n` +
      (resolvedPrevCandidate.clauses || []).map((c) => `- [${c.context}]: ${c.conclusion} (cites: ${(c.citedProofIds || []).join(', ')})`).join('\n') + '\n';
  }

  if (resolvedObjections.length > 0) {
    contextBlock += `\nUnresolved Objections to Address:\n` +
      resolvedObjections.map((o) => `- Objection ${o.id} (by ${o.seatId}, backed by ${o.proofId}): ${o.reason}`).join('\n') + '\n';
  }

  if (resolvedRound > 1 && resolvedPriorAdmittedProofs.length > 0) {
    const priorProofLines = resolvedPriorAdmittedProofs
      .map((p, idx) => {
        const pid = p.id || `P${idx + 1}`;
        const kind = p.kind || 'check';
        const scope = p.scope || 'general';
        const stmt = p.statement || p.judgeAdmittedStatement || '';
        const src = p.source || 'unspecified';
        const noteText = getSubstantiveJudgeNote(p);

        if (p.status === 'partially_admitted') {
          const statusTag = noteText ? ` [PARTIALLY ADMITTED: ${noteText}]` : ' [PARTIALLY ADMITTED]';
          const admittedCore = typeof p.judgeAdmittedStatement === 'string' ? p.judgeAdmittedStatement.trim() : '';
          const coreSuffix = admittedCore && admittedCore !== stmt.trim()
            ? ` (Admitted Core: ${admittedCore})`
            : '';
          return `- [${pid}]${statusTag} (Round ${p.round || 1}, ${kind}) [${scope}]: ${stmt}${coreSuffix} (source: ${src})`;
        }

        const noteSuffix = noteText ? ` [Judge Note: ${noteText}]` : '';
        return `- [${pid}] [ADMITTED] (Round ${p.round || 1}, ${kind}) [${scope}]: ${stmt}${noteSuffix} (source: ${src})`;
      })
      .join('\n');
    contextBlock += `\nPrior-Round Admitted Proofs:\n${priorProofLines}\n`;
  }

  const evidenceGuidance = resolvedEvidence.length > 0
    ? (hasWorkspaceCwd
        ? `\nPre-Gathered Baseline Evidence (Attributed & Challengeable) is provided above in [E1]–[E${resolvedEvidence.length}]: Use these items as shared baseline evidence so you do not need to re-fetch or re-read facts already excerpted here. Do NOT re-read or duplicate inspection of files already excerpted in [E#]. Cap any local file reads to targeted verification of claims not already covered by [E1]–[E${resolvedEvidence.length}] (at most 3–5 targeted reads), reserving tool exploration for disputed or unverified claims. [E#] items are auditable: if you can prove from a primary source or exact line citation that an [E#] summary is incomplete or imprecise, explicitly state the qualification, and avoid speculative local filesystem grepping unless the topic explicitly names local repository files.`
        : `\nPre-Gathered Baseline Evidence (Attributed & Challengeable) is provided above in [E1]–[E${resolvedEvidence.length}]: Use these items as shared baseline evidence so you do not need to re-fetch or re-read facts already excerpted here. [E#] items are auditable: if you can prove from a primary source or exact line citation that an [E#] summary is incomplete or imprecise, explicitly state the qualification, and avoid speculative local filesystem grepping unless the topic explicitly names local repository files.`)
    : '';

  const isRoundTwoPlusOrRebuttal = isRebuttal || resolvedRound > 1;
  const delibReadCapDirective = isRoundTwoPlusOrRebuttal
    ? 'Cap local workspace reads to at most 3–5 targeted reads focused strictly on Unresolved Objections without re-inspecting settled clauses.'
    : (resolvedEvidence.length > 0
        ? 'Cap local workspace reads to at most 5–8 targeted reads overall (and at most 3–5 additional targeted reads for claims not already covered by [E#]).'
        : 'Cap local workspace reads to at most 5–8 targeted reads.');

  const deliberationToolDirective = hasWorkspaceCwd
    ? `You have read-only inspection tools enabled. ${ISOLATED_WORKSPACE_PATH_DIRECTIVE} Before submitting your proof, verify claims against sources (specifications, benchmarks, codebase, or documentation) and cite the exact inspected sources in your proof "source" and "statement". ${delibReadCapDirective}${evidenceGuidance}
Local filesystem tools are only for topics that explicitly concern files in the target workspace—never for searching The Council's own engine source code on general/external topics.`
    : `You have read-only inspection tools enabled. No local code workspace is attached (running in an isolated sandbox directory); do NOT run local filesystem search/grep/find commands (rg, grep, find, ls) to search a codebase. Furthermore, do NOT run local filesystem tools (cat, readToolCall, view_file) and do NOT read or probe absolute host file paths mentioned in the topic or evidence packet. Before submitting your proof, verify claims against sources (Pre-Gathered Baseline Evidence packet, authoritative specifications, benchmarks, web search (if needed for external facts), or analytical/mathematical derivation) and cite the exact sources in your proof "source" and "statement".${evidenceGuidance}
Local filesystem tools are only for topics that explicitly concern files in the target workspace—never for searching The Council's own engine source code on general/external topics.`;

  const toolFreeDeliberationDirective =
    'Do not invoke any tools (no shell, file reads, or web searches) on this turn. Synthesize and return your strict JSON proof immediately from the provided context and baseline evidence.';

  const verificationBlock = resolvedTools === 'read-only'
    ? `\nTOOL USAGE & VERIFICATION DIRECTIVE:
${deliberationToolDirective}
${ANTI_CHEATING_RULE}\n`
    : `\n${toolFreeDeliberationDirective}
${ANTI_CHEATING_RULE}\n`;

  const priorRound = resolvedPrevCandidate?.round ?? Math.max(1, resolvedRound - 1);
  const rebuttalBlock = isRebuttal
    ? `\nTARGETED REBUTTAL & INVARIANT GUARD:
- You already voted ACCEPT on the Round ${priorRound} Candidate.
- Do NOT re-litigate settled clauses from scratch. Evaluate the listed Unresolved Objections strictly through your "${s.name}" (${s.lens}) Soul lens—substantiating whether each objection is valid, overstated, or requires an explicit scope boundary—and state the falsifiable invariant that Round ${resolvedRound} synthesis must preserve so resolving the objection does not regress accepted Round ${priorRound} clauses.
- Still return 1 strict JSON Proof ("scope", "kind", "source", "statement") below to preserve proof-bound synthesis and voting invariants.\n`
    : '';

  return `### Deliberation Round ${resolvedRound}/${resolvedMaxRounds} — Proof Submission
${contextBlock}
As Seat "${seat?.id || 'seat'}" embodying "${s.name}" (${s.lens}), submit a structured Proof substantiating your position.${rebuttalBlock}
${verificationBlock}
OUTPUT CONTRACT (strict JSON):
{
  "scope": "<context boundary, e.g. Production Cloud & Container Servers>",
  "kind": "check" | "citation" | "benchmark" | "derivation",
  "source": "<verifiable specification, benchmark suite, standard, or test check>",
  "statement": "<falsifiable assertion of fact directly substantiated by the source>"
}`;
}

/**
 * Formats a Voting prompt for a Seat to evaluate the Judge's Candidate.
 * @param {Object} params
 * @param {Soul | string} params.soul
 * @param {Object} params.seat
 * @param {string} [params.topic='']
 * @param {Object} [params.candidate]
 * @param {Array<Object>} [params.admittedProofs]
 * @param {Array<Object>} [params.evidence=[]]
 * @param {Array<Object>} [params.clarifications=[]]
 * @param {Array<Object>} [params.myOpenObjections=[]]
 * @param {Object|null} [params.state=null]
 * @param {'none' | 'read-only'} [params.tools]
 * @param {string} [params.cwd]
 * @returns {string}
 */
export function formatVotingPrompt({
  soul,
  seat,
  topic = '',
  candidate,
  admittedProofs,
  evidence = [],
  clarifications = [],
  myOpenObjections = [],
  state = null,
  tools,
  cwd
}) {
  const s = createSoul(soul);
  const resolvedTools =
    tools !== undefined
      ? tools
      : (seat?.votingTools !== undefined ? seat.votingTools : (seat?.tools || 'read-only'));
  const hasWorkspaceCwd = resolvedTools !== 'none' && Boolean(
    (typeof cwd === 'string' && cwd.trim()) ||
    (typeof seat?.cwd === 'string' && seat.cwd.trim()) ||
    (typeof state?.cwd === 'string' && state.cwd.trim())
  );
  const rawTopic = topic || state?.topic || '';
  const resolvedTopic = typeof rawTopic === 'string' && rawTopic.trim() ? rawTopic : '';
  const topicLine = resolvedTopic ? `Topic: "${resolvedTopic}"\n` : '';
  const cand = candidate || state?.candidate;
  const proofs = admittedProofs || (state?.proofs || []).filter(
    (p) => p && (p.status === 'admitted' || p.status === 'partially_admitted')
  );
  const resolvedEvidence = (evidence && evidence.length > 0)
    ? evidence
    : (state?.evidence || []);
  const resolvedClarifications = (clarifications && clarifications.length > 0)
    ? clarifications
    : (state?.clarifications || []);
  const resolvedMyOpenObjections = (Array.isArray(myOpenObjections) && myOpenObjections.length > 0)
    ? myOpenObjections
    : (seat?.id
        ? (state?.objections || []).filter((o) => o && o.seatId === seat.id && o.status === 'open')
        : []);

  const proofList = (proofs && proofs.length > 0)
    ? proofs.map((p, idx) => {
        const pid = p.id || `P${idx + 1}`;
        const kind = p.kind || 'check';
        const scope = p.scope || 'general';
        const stmt = p.statement || p.judgeAdmittedStatement || '';
        const src = p.source || 'unspecified';
        let line = `- [${pid}] (${kind}) [${scope}]: ${stmt}`;
        if (p.status === 'partially_admitted') {
          const noteText = getSubstantiveJudgeNote(p);
          const noteStr = noteText ? `: ${noteText}` : '';
          line += ` [PARTIALLY ADMITTED${noteStr}]`;
          const admittedCore = typeof p.judgeAdmittedStatement === 'string' ? p.judgeAdmittedStatement.trim() : '';
          if (admittedCore && admittedCore !== stmt.trim()) {
            line += ` (Admitted Core: ${admittedCore})`;
          }
        } else {
          const substantiveNote = getSubstantiveJudgeNote(p);
          if (substantiveNote) {
            line += ` [Judge Note: ${substantiveNote}]`;
          }
        }
        line += ` (source: ${src})`;
        return line;
      }).join('\n')
    : 'No admitted proofs for this round.';

  const myOpenObjectionsSection = resolvedMyOpenObjections.length > 0
    ? `\nYour Open Objections from Prior Rounds:\n` +
      `Note: Voting "accept" withdraws your open objections listed below.\n` +
      resolvedMyOpenObjections
        .map((o) => `- [${o.id}] (Round ${o.round || 1}, backed by Proof ${o.proofId}): ${o.reason}`)
        .join('\n') +
      '\n'
    : '';

  const clauseList = (cand?.clauses && cand.clauses.length > 0)
    ? cand.clauses.map((c, idx) =>
        `Clause C${idx + 1} [${c.context || 'General'}]: ${c.conclusion || ''} (cites: ${(c.citedProofIds || []).join(', ')})`
      ).join('\n')
    : 'No candidate clauses provided.';

  const groundingSection = formatGroundingSection(resolvedEvidence, resolvedClarifications);

  const votingEvidenceGuidance = resolvedEvidence.length > 0
    ? (hasWorkspaceCwd
        ? `\nPre-Gathered Baseline Evidence (Attributed & Challengeable) is provided above in [E1]–[E${resolvedEvidence.length}]: Do NOT re-read or duplicate inspection of files already excerpted in [E#]. Cap any local file reads to targeted verification of claims not already covered by [E1]–[E${resolvedEvidence.length}] (at most 3–5 targeted reads), reserving tool exploration for disputed or unverified claims, and avoid speculative local filesystem grepping unless the topic explicitly names local repository files.`
        : `\nPre-Gathered Baseline Evidence (Attributed & Challengeable) is provided above in [E1]–[E${resolvedEvidence.length}]: Rely on the baseline evidence packet and web search, and avoid speculative local filesystem grepping unless the topic explicitly names local repository files.`)
    : '';

  const votingToolDirective = hasWorkspaceCwd
    ? `You have read-only inspection tools enabled. ${ISOLATED_WORKSPACE_PATH_DIRECTIVE} Verify disputed candidate clauses or cited proof sources using your read-only tools before casting your vote. Cap local file reads to at most 3–5 targeted spot-check reads within ".". ${VOTING_CONSISTENCY_DIRECTIVE} If objecting, cite the specific discrepancies observed during your inspection.${votingEvidenceGuidance}
Local filesystem tools are only for topics that explicitly concern files in the target workspace—never for searching The Council's own engine source code on general/external topics.`
    : `You have read-only inspection tools enabled. No local code workspace is attached (running in an isolated sandbox directory); do NOT run local filesystem search/grep/find commands (rg, grep, find, ls) to search a codebase. Furthermore, do NOT run local filesystem tools (cat, readToolCall, view_file) and do NOT read or probe absolute host file paths mentioned in the topic or evidence packet. Verify disputed candidate clauses or cited proof sources against the Pre-Gathered Baseline Evidence packet, authoritative specifications, web search (if needed for external facts), or analytical/mathematical derivations before casting your vote. ${VOTING_CONSISTENCY_DIRECTIVE} If objecting, cite the specific discrepancies observed.${votingEvidenceGuidance}
Local filesystem tools are only for topics that explicitly concern files in the target workspace—never for searching The Council's own engine source code on general/external topics.`;

  const toolFreeVotingDirective =
    `Do not invoke any tools during confirmation voting. Evaluate the Candidate Clauses strictly against the audited Proofs provided above and return your JSON vote immediately. No local file reads are permitted. ${VOTING_CONSISTENCY_DIRECTIVE}`;

  const votingVerificationBlock = resolvedTools === 'read-only'
    ? `\nTOOL USAGE & VERIFICATION DIRECTIVE:
${votingToolDirective}
${ANTI_CHEATING_RULE}\n`
    : `\n${toolFreeVotingDirective}
${ANTI_CHEATING_RULE}\n`;

  return `### Voting on Round ${cand?.round || 1} Candidate
${topicLine}Candidate Summary: "${cand?.summary || ''}"
${groundingSection}
Candidate Clauses:
${clauseList}

Admitted Proofs this Round:
${proofList}
${myOpenObjectionsSection}
As Seat "${seat?.id || 'seat'}" embodying "${s.name}" (${s.lens}), evaluate if this Candidate satisfies your criteria.
- If you accept: voting "accept" will automatically withdraw any open objections you previously raised.
- If you object: you MUST provide a concrete "reason" and cite an admitted "proofId" substantiating your dissent. Proofs with status "partially_admitted" are valid citations for their narrowed Admitted Core and may be cited in "proofId" if that narrowed core refutes a Candidate Clause.
- Consistency & verification audit: Verify both Candidate Summary and Candidate Clauses against Topic, cited proofs and caveats (Judge Note and Admitted Core), and Your Open Objections from Prior Rounds; explicitly require unavailable upstream verification to be labeled as a limitation or abstention rather than presented as verified fact.
${votingVerificationBlock}
OUTPUT CONTRACT (strict JSON):
If accepting:
{ "vote": "accept" }

If objecting:
{ "vote": "object", "proofId": "<Admitted Proof ID>", "reason": "<Concrete reason why candidate is defective>" }`;
}

/**
 * Formats a Judge Audit and Synthesis prompt.
 *
 * @param {Object} params
 * @param {Object} params.judge
 * @param {string} [params.topic]
 * @param {number} params.round
 * @param {number} [params.maxRounds]
 * @param {Array<Object>} [params.proofs=[]]
 * @param {Array<Object>} [params.evidence=[]]
 * @param {Array<Object>} [params.clarifications=[]]
 * @param {Object|null} [params.state=null]
 * @param {'none' | 'read-only'} [params.tools]
 * @param {string} [params.cwd]
 * @returns {string}
 */
export function formatJudgePrompt({
  judge,
  topic = '',
  round = 1,
  maxRounds,
  proofs = [],
  evidence = [],
  clarifications = [],
  previousCandidate = null,
  openObjections = [],
  priorAdmittedProofs = [],
  state = null,
  tools,
  cwd
}) {
  const judgeSoul = typeof judge?.soul === 'object' && judge?.soul
    ? judge.soul
    : createSoul(judge?.soul || 'Impartial Proof Auditor');
  const resolvedTools = tools !== undefined ? tools : (judge?.tools || 'read-only');
  const hasWorkspaceCwd = resolvedTools !== 'none' && Boolean(
    (typeof cwd === 'string' && cwd.trim()) ||
    (typeof judge?.cwd === 'string' && judge.cwd.trim()) ||
    (typeof state?.cwd === 'string' && state.cwd.trim())
  );
  const resolvedTopic = topic || state?.topic || '';
  const resolvedRound = round || state?.round || 1;
  const resolvedMaxRounds = maxRounds || state?.maxRounds || 3;
  const resolvedEvidence = (evidence && evidence.length > 0)
    ? evidence
    : (state?.evidence || []);
  const resolvedClarifications = (clarifications && clarifications.length > 0)
    ? clarifications
    : (state?.clarifications || []);

  const groundingSection = formatGroundingSection(resolvedEvidence, resolvedClarifications);

  const currentProofIds = new Set((proofs || []).map((p) => p?.id).filter(Boolean));
  const resolvedPrevCandidate = previousCandidate || state?.candidate || null;
  const resolvedOpenObjections = (Array.isArray(openObjections) && openObjections.length > 0)
    ? openObjections
    : (state?.objections || []).filter(
        (o) => o && (o.status === 'open' || o.status === 'preserved_excused')
      );
  const resolvedPriorAdmittedProofs = resolvePriorAdmittedProofs(
    priorAdmittedProofs,
    state,
    resolvedRound,
    currentProofIds
  );

  let priorContextSection = '';
  if (resolvedPrevCandidate) {
    const prevCandRound = resolvedPrevCandidate.round ?? Math.max(1, resolvedRound - 1);
    const prevClauses = (resolvedPrevCandidate.clauses || [])
      .map((c, idx) => {
        const cid = c.id || `C${idx + 1}`;
        return `- [${cid}] [${c.context || 'General'}]: ${c.conclusion || ''} (cites: ${(c.citedProofIds || []).join(', ')})`;
      })
      .join('\n');
    priorContextSection +=
      `\nPrevious Candidate (Round ${prevCandRound}):\n` +
      `Summary: ${resolvedPrevCandidate.summary || ''}\n` +
      (prevClauses ? `${prevClauses}\n` : '');
  }

  if (resolvedOpenObjections.length > 0) {
    const objLines = resolvedOpenObjections
      .map((o) => {
        const lockTag = o.status === 'preserved_excused' ? ' [LOCKED / preserved_excused — Excused Seat]' : '';
        return `- [${o.id}]${lockTag} (Round ${o.round || 1}, Seat "${o.seatId}", backed by Proof ${o.proofId}): ${o.reason}`;
      })
      .join('\n');
    priorContextSection += `\nUnresolved Open Objections:\n${objLines}\n`;
  }

  if (resolvedPriorAdmittedProofs.length > 0) {
    const priorProofLines = resolvedPriorAdmittedProofs
      .map((p, idx) => {
        const pid = p.id || `P${idx + 1}`;
        const kind = p.kind || 'check';
        const scope = p.scope || 'general';
        const src = p.source || 'unspecified';
        const noteText = getSubstantiveJudgeNote(p);

        if (p.status === 'partially_admitted') {
          const admittedCore = typeof p.judgeAdmittedStatement === 'string' ? p.judgeAdmittedStatement.trim() : '';
          const statusTag = noteText ? ` [PARTIALLY ADMITTED: ${noteText}]` : ' [PARTIALLY ADMITTED]';
          const stmt = admittedCore
            ? admittedCore
            : `${p.statement || ''} (Caveat — narrowed by Judge Note: ${noteText || 'partially admitted'})`;
          return `- [${pid}]${statusTag} (Round ${p.round || 1}, Seat "${p.seatId || 'seat'}", ${kind}) [${scope}]: ${stmt} (source: ${src})`;
        }

        const stmt = p.statement || '';
        const noteSuffix = noteText ? ` [Judge Note: ${noteText}]` : '';
        return `- [${pid}] [ADMITTED] (Round ${p.round || 1}, Seat "${p.seatId || 'seat'}", ${kind}) [${scope}]: ${stmt}${noteSuffix} (source: ${src})`;
      })
      .join('\n');
    priorContextSection +=
      `\nPrior-Round Admitted Proofs (Already Admitted — Do NOT Re-Audit or Reject in "proofDecisions"; Valid for Citation in "clauses[].citedProofIds"):\n` +
      `${priorProofLines}\n`;
  }

  const proofList = (proofs && proofs.length > 0)
    ? proofs.map((p, idx) => {
        const pid = p.id || `P${idx + 1}`;
        const kind = p.kind || 'check';
        const scope = p.scope || 'general';
        const stmt = p.statement || '';
        const src = p.source || 'unspecified';
        return `- [${pid}] (${kind}) [${scope}]: ${stmt} (source: ${src})`;
      }).join('\n')
    : 'No proofs submitted for auditing.';

  const hasPriorRoundContext = Boolean(
    resolvedPrevCandidate || resolvedOpenObjections.length > 0 || resolvedPriorAdmittedProofs.length > 0
  );

  const judgeDirectives = [
    '1. Audit each submitted proof: record status in "proofDecisions" as "admitted" or "rejected" (or "partially_admitted" / "admitted_with_caveat") with a concrete "note". If "partially_admitted", provide "admittedStatement" (the verified citable core statement) and "note" stating the caveat. When a seat relies on a supplied [E#] baseline item that turns out to have a minor secondary imprecision, prefer partially_admitted, excising or qualifying the imprecise phrase via admittedStatement / note, rather than binary rejected if the proof\'s core argument remains valid.' +
      (hasPriorRoundContext
        ? ' Emit "proofDecisions" ONLY for current-round Submitted Proofs for Auditing; do not re-audit or reject prior-round admitted proofs (their settled admission status cannot be re-audited).'
        : ''),
    '2. Synthesize context-partitioned consensus clauses: every clause in "clauses" MUST cite at least one admitted Proof ID (e.g. ["P1"]). Proofs with status "partially_admitted" are valid to cite for their verified core statement.' +
      (hasPriorRoundContext
        ? ' Refine the Previous Candidate to address all Unresolved Open Objections while preserving settled clauses, citing both Prior-Round Admitted Proof IDs and newly admitted current-round Proof IDs in "clauses[].citedProofIds".'
        : ''),
    '3. Bare opinions or conclusions ungrounded in admitted proofs are strictly forbidden.'
  ];

  if (resolvedTools === 'read-only') {
    const hasCitedWorkspacePaths = judgeItemsCiteWorkspacePath(proofs, resolvedOpenObjections);
    const shouldAllowSpotCheckReads = hasCitedWorkspacePaths;

    const judgeEvidenceGuidance = resolvedEvidence.length > 0
      ? (hasWorkspaceCwd
          ? (shouldAllowSpotCheckReads
              ? ` Pre-Gathered Baseline Evidence (Attributed & Challengeable) is provided above in [E1]–[E${resolvedEvidence.length}]: audit and cite baseline evidence first; avoid re-reading excerpted files, and cap local file spot-checks to at most 3–5 targeted reads so you finish well within your turn timeout, and avoid speculative local filesystem grepping unless the topic explicitly names local repository files.`
              : ` Pre-Gathered Baseline Evidence (Attributed & Challengeable) is provided above in [E1]–[E${resolvedEvidence.length}]: audit and cite baseline evidence first, and avoid speculative local filesystem grepping unless the topic explicitly names local repository files.`)
          : ` Pre-Gathered Baseline Evidence (Attributed & Challengeable) is provided above in [E1]–[E${resolvedEvidence.length}]: audit and cite baseline evidence first. When a seat relies on a supplied [E#] baseline item that turns out to have a minor secondary imprecision, prefer partially_admitted (excising or qualifying the imprecise phrase via admittedStatement / note) rather than binary rejected if the proof's core argument remains valid, and avoid speculative local filesystem grepping unless the topic explicitly names local repository files.`)
      : '';
    const judgeSpotCheckBudget = shouldAllowSpotCheckReads
      ? ' Cap local workspace spot-check reads to at most 3–5 targeted reads covering concrete workspace paths cited in current-round Submitted Proofs for Auditing or Unresolved Open Objections (do NOT reopen or re-audit Prior-Round Admitted Proofs).'
      : ' Neither current-round Submitted Proofs for Auditing nor Unresolved Open Objections cite workspace files, so use 0 local workspace reads (do NOT reopen or re-audit Prior-Round Admitted Proofs).';
    const judgeToolGuidance = hasWorkspaceCwd
      ? `4. Spot-check proof sources: You have read-only inspection tools enabled. ${ISOLATED_WORKSPACE_PATH_DIRECTIVE} Spot-check submitted proof sources and citations using your read-only tools to verify that cited documents and specifications substantiate the submitted assertions before admitting them.${judgeSpotCheckBudget}${judgeEvidenceGuidance} Local filesystem tools are only for topics that explicitly concern files in the target workspace—never for searching The Council's own engine source code on general/external topics.`
      : `4. Spot-check proof sources: You have read-only inspection tools enabled. No local code workspace is attached (running in an isolated sandbox directory); do NOT run local filesystem search/grep/find commands (rg, grep, find, ls) to search a codebase. Furthermore, do NOT run local filesystem tools (cat, readToolCall, view_file) and do NOT read or probe absolute host file paths mentioned in the topic or evidence packet. Spot-check submitted proof sources and citations against the Pre-Gathered Baseline Evidence packet, authoritative specifications, web search (if needed for external facts), or analytical/mathematical derivations to verify that cited sources substantiate the submitted assertions before admitting them.${judgeEvidenceGuidance} Local filesystem tools are only for topics that explicitly concern files in the target workspace—never for searching The Council's own engine source code on general/external topics.`;
    judgeDirectives.push(judgeToolGuidance);
  } else {
    judgeDirectives.push(
      '4. Tool-free audit & synthesis: Do not invoke any tools on this turn. Audit the submitted proofs strictly against the in-prompt evidence and return your strict JSON synthesis immediately.'
    );
  }

  const answerFirstDirective = `${judgeDirectives.length + 1}. Standalone Answer-First Summary: candidate.summary ("summary") MUST be a standalone, direct, user-facing executive synthesis that directly answers the user's topic in clear prose. It MUST NOT contain internal proof IDs (e.g. P1, P2, [P1]) or audit process commentary (e.g. "P1 was admitted...", "P2-P4 require corrections..."). All proof audit commentary belongs strictly in proofDecisions, and proof citations belong strictly in "clauses[].citedProofIds".`;
  judgeDirectives.push(answerFirstDirective);
  const synthesisConsistencyDirective = `${judgeDirectives.length + 1}. Summary, Clause & Caveat Consistency: Keep "summary" (Candidate Summary) and "clauses" (Candidate Clauses) mutually consistent with Topic and preserve all decisive conditions, scope bounds, quantities, and caveats from cited "admitted" and "partially_admitted" proofs (including "admittedStatement" and "judgeNote"). Where upstream verification is unavailable, explicitly label unavailable verification as a limitation or abstention rather than presenting it as a verified fact.`;
  judgeDirectives.push(synthesisConsistencyDirective);
  judgeDirectives.push(`${judgeDirectives.length + 1}. ${ANTI_CHEATING_RULE}`);

  return `### THE COUNCIL — JUDGE AUDIT AND SYNTHESIS ROUND ${round}/${resolvedMaxRounds}
Topic: "${resolvedTopic}"
Judge: ${judge?.id || 'judge'} (${judge?.model || 'model'})
Soul: ${judgeSoul.name || 'Impartial Proof Auditor'}: ${judgeSoul.lens || ''}
${groundingSection}${priorContextSection}
Submitted Proofs for Auditing:
${proofList}

Judge Directives & Invariants:
${judgeDirectives.join('\n')}

OUTPUT CONTRACT (strict JSON):
{
  "summary": "<Direct, standalone, user-facing executive answer to the user's topic in clear prose — MUST NOT contain internal proof IDs like P1, P2 or audit process commentary>",
  "proofDecisions": {
    "P1": { "status": "admitted", "note": "Verified source" },
    "P2": { "status": "partially_admitted", "admittedStatement": "<Narrowed verified core claim>", "note": "<Caveat or qualification>" }
  },
  "clauses": [
    {
      "context": "<context boundary, e.g. Production Cloud & Container Servers>",
      "conclusion": "<falsifiable recommendation>",
      "citedProofIds": ["P1"]
    }
  ]
}`;
}

