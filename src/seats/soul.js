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
  'STRICT ANTI-CHEATING RULE: Never read, grep, or inspect ".council/" (including ".council/runs/", ".council/telemetry/", ".council/runs/latest.js", "latest.js", "*.meta.json", "*.events.jsonl", "telemetry-summary.*", run snapshots, or telemetry files). Accessing ".council/" violates blind deliberation independence and immediately invalidates your turn.';

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
 * @returns {string}
 */
export function formatClarificationPrompt({ soul, seat, topic, batch, maxBatches }) {
  const s = createSoul(soul);
  return `### Pre-Deliberation Discovery: Clarification Batch ${batch}/${maxBatches}
Topic Handoff:
"${topic}"

As Seat "${seat.id}" with Soul "${s.name}" (${s.lens}), inspect this topic handoff.
Are there missing constraints, workload ambiguities, or unstated assumptions that must be clarified before deliberation begins?

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
 * @param {Object|null} [params.state=null]
 * @param {'none' | 'read-only'} [params.tools]
 * @param {string} [params.cwd]
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
  state = null,
  tools,
  cwd
}) {
  const s = createSoul(soul);
  const resolvedTools = tools !== undefined ? tools : (seat?.tools || 'read-only');
  const hasWorkspaceCwd = Boolean(
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
    : (state?.objections || []).filter((o) => o.status === 'open');

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

  const evidenceGuidance = resolvedEvidence.length > 0
    ? (hasWorkspaceCwd
        ? `\nPre-Gathered Baseline Evidence (Attributed & Challengeable) is provided above in [E1]–[E${resolvedEvidence.length}]: Use these items as shared baseline evidence so you do not need to re-fetch or re-read facts already excerpted here. Do NOT re-read or duplicate inspection of files already excerpted in [E#]. Cap any local file reads to targeted verification of claims not already covered by [E1]–[E${resolvedEvidence.length}] (at most 3–5 targeted reads), reserving tool exploration for disputed or unverified claims. [E#] items are auditable: if you can prove from a primary source or exact line citation that an [E#] summary is incomplete or imprecise, explicitly state the qualification, and avoid speculative local filesystem grepping unless the topic explicitly names local repository files.`
        : `\nPre-Gathered Baseline Evidence (Attributed & Challengeable) is provided above in [E1]–[E${resolvedEvidence.length}]: Use these items as shared baseline evidence so you do not need to re-fetch or re-read facts already excerpted here. [E#] items are auditable: if you can prove from a primary source or exact line citation that an [E#] summary is incomplete or imprecise, explicitly state the qualification, and avoid speculative local filesystem grepping unless the topic explicitly names local repository files.`)
    : '';

  const deliberationToolDirective = hasWorkspaceCwd
    ? `You have read-only inspection tools enabled. Before submitting your proof, verify claims against sources (specifications, benchmarks, codebase, or documentation) and cite the exact inspected sources in your proof "source" and "statement".${evidenceGuidance}
Local filesystem tools are only for topics that explicitly concern files in the target workspace—never for searching The Council's own engine source code on general/external topics.`
    : `You have read-only inspection tools enabled. No local code workspace is attached (running in an isolated sandbox directory); do NOT run local filesystem search/grep/find commands (rg, grep, find, ls) to search a codebase. Furthermore, do NOT run local filesystem tools (cat, readToolCall, view_file) and do NOT read or probe absolute host file paths mentioned in the topic or evidence packet. Before submitting your proof, verify claims against sources (Pre-Gathered Baseline Evidence packet, authoritative specifications, benchmarks, web search (if needed for external facts), or analytical/mathematical derivation) and cite the exact sources in your proof "source" and "statement".${evidenceGuidance}
Local filesystem tools are only for topics that explicitly concern files in the target workspace—never for searching The Council's own engine source code on general/external topics.`;

  const verificationBlock = resolvedTools === 'read-only'
    ? `\nTOOL USAGE & VERIFICATION DIRECTIVE:
${deliberationToolDirective}
${ANTI_CHEATING_RULE}\n`
    : `\n${ANTI_CHEATING_RULE}\n`;

  return `### Deliberation Round ${resolvedRound}/${resolvedMaxRounds} — Proof Submission
${contextBlock}
As Seat "${seat?.id || 'seat'}" embodying "${s.name}" (${s.lens}), submit a structured Proof substantiating your position.
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
  const hasWorkspaceCwd = Boolean(
    (typeof cwd === 'string' && cwd.trim()) ||
    (typeof seat?.cwd === 'string' && seat.cwd.trim()) ||
    (typeof state?.cwd === 'string' && state.cwd.trim())
  );
  const cand = candidate || state?.candidate;
  const proofs = admittedProofs || (state?.proofs || []).filter(
    (p) => p.status === 'admitted' || p.status === 'partially_admitted'
  );
  const resolvedEvidence = (evidence && evidence.length > 0)
    ? evidence
    : (state?.evidence || []);
  const resolvedClarifications = (clarifications && clarifications.length > 0)
    ? clarifications
    : (state?.clarifications || []);

  const proofList = (proofs && proofs.length > 0)
    ? proofs.map((p, idx) => {
        const pid = p.id || `P${idx + 1}`;
        const kind = p.kind || 'check';
        const scope = p.scope || 'general';
        const stmt = p.judgeAdmittedStatement || p.statement || '';
        const src = p.source || 'unspecified';
        let line = `- [${pid}] (${kind}) [${scope}]: ${stmt}`;
        if (p.status === 'partially_admitted') {
          const noteStr = p.judgeNote ? `: ${p.judgeNote}` : '';
          line += ` [PARTIALLY ADMITTED${noteStr}]`;
          if (p.judgeAdmittedStatement) {
            line += ` (Admitted Core: ${p.judgeAdmittedStatement})`;
          }
        }
        line += ` (source: ${src})`;
        return line;
      }).join('\n')
    : 'No admitted proofs for this round.';

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
    ? `You have read-only inspection tools enabled. Verify disputed candidate clauses or cited proof sources using your read-only tools before casting your vote. If objecting, cite the specific discrepancies observed during your inspection.${votingEvidenceGuidance}
Local filesystem tools are only for topics that explicitly concern files in the target workspace—never for searching The Council's own engine source code on general/external topics.`
    : `You have read-only inspection tools enabled. No local code workspace is attached (running in an isolated sandbox directory); do NOT run local filesystem search/grep/find commands (rg, grep, find, ls) to search a codebase. Furthermore, do NOT run local filesystem tools (cat, readToolCall, view_file) and do NOT read or probe absolute host file paths mentioned in the topic or evidence packet. Verify disputed candidate clauses or cited proof sources against the Pre-Gathered Baseline Evidence packet, authoritative specifications, web search (if needed for external facts), or analytical/mathematical derivations before casting your vote. If objecting, cite the specific discrepancies observed.${votingEvidenceGuidance}
Local filesystem tools are only for topics that explicitly concern files in the target workspace—never for searching The Council's own engine source code on general/external topics.`;

  const toolFreeVotingDirective =
    'Do not invoke any tools during confirmation voting. Evaluate the Candidate Clauses strictly against the audited Proofs provided above and return your JSON vote immediately.';

  const votingVerificationBlock = resolvedTools === 'read-only'
    ? `\nTOOL USAGE & VERIFICATION DIRECTIVE:
${votingToolDirective}
${ANTI_CHEATING_RULE}\n`
    : `\n${toolFreeVotingDirective}
${ANTI_CHEATING_RULE}\n`;

  return `### Voting on Round ${cand?.round || 1} Candidate
Candidate Summary: "${cand?.summary || ''}"
${groundingSection}
Candidate Clauses:
${clauseList}

Admitted Proofs this Round:
${proofList}

As Seat "${seat?.id || 'seat'}" embodying "${s.name}" (${s.lens}), evaluate if this Candidate satisfies your criteria.
- If you accept: voting "accept" will automatically withdraw any open objections you previously raised.
- If you object: you MUST provide a concrete "reason" and cite an admitted "proofId" substantiating your dissent.
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
  state = null,
  tools,
  cwd
}) {
  const judgeSoul = typeof judge?.soul === 'object' && judge?.soul
    ? judge.soul
    : createSoul(judge?.soul || 'Impartial Proof Auditor');
  const resolvedTools = tools !== undefined ? tools : (judge?.tools || 'read-only');
  const hasWorkspaceCwd = Boolean(
    (typeof cwd === 'string' && cwd.trim()) ||
    (typeof judge?.cwd === 'string' && judge.cwd.trim()) ||
    (typeof state?.cwd === 'string' && state.cwd.trim())
  );
  const resolvedTopic = topic || state?.topic || '';
  const resolvedMaxRounds = maxRounds || state?.maxRounds || 3;
  const resolvedEvidence = (evidence && evidence.length > 0)
    ? evidence
    : (state?.evidence || []);
  const resolvedClarifications = (clarifications && clarifications.length > 0)
    ? clarifications
    : (state?.clarifications || []);

  const groundingSection = formatGroundingSection(resolvedEvidence, resolvedClarifications);

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

  const judgeDirectives = [
    '1. Audit each submitted proof: record status in "proofDecisions" as "admitted" or "rejected" (or "partially_admitted" / "admitted_with_caveat") with a concrete "note". If "partially_admitted", provide "admittedStatement" (the verified citable core statement) and "note" stating the caveat. When a seat relies on a supplied [E#] baseline item that turns out to have a minor secondary imprecision, prefer partially_admitted, excising or qualifying the imprecise phrase via admittedStatement / note, rather than binary rejected if the proof\'s core argument remains valid.',
    '2. Synthesize context-partitioned consensus clauses: every clause in "clauses" MUST cite at least one admitted Proof ID (e.g. ["P1"]). Proofs with status "partially_admitted" are valid to cite for their verified core statement.',
    '3. Bare opinions or conclusions ungrounded in admitted proofs are strictly forbidden.'
  ];

  if (resolvedTools === 'read-only') {
    const judgeEvidenceGuidance = resolvedEvidence.length > 0
      ? (hasWorkspaceCwd
          ? ` Pre-Gathered Baseline Evidence (Attributed & Challengeable) is provided above in [E1]–[E${resolvedEvidence.length}]: audit and cite baseline evidence first; avoid re-reading excerpted files, and cap local file spot-checks to at most 3–5 targeted reads so you finish well within your turn timeout, and avoid speculative local filesystem grepping unless the topic explicitly names local repository files.`
          : ` Pre-Gathered Baseline Evidence (Attributed & Challengeable) is provided above in [E1]–[E${resolvedEvidence.length}]: audit and cite baseline evidence first. When a seat relies on a supplied [E#] baseline item that turns out to have a minor secondary imprecision, prefer partially_admitted (excising or qualifying the imprecise phrase via admittedStatement / note) rather than binary rejected if the proof's core argument remains valid, and avoid speculative local filesystem grepping unless the topic explicitly names local repository files.`)
      : '';
    const judgeToolGuidance = hasWorkspaceCwd
      ? `4. Spot-check proof sources: You have read-only inspection tools enabled. Spot-check submitted proof sources and citations using your read-only tools to verify that cited documents and specifications substantiate the submitted assertions before admitting them.${judgeEvidenceGuidance} Local filesystem tools are only for topics that explicitly concern files in the target workspace—never for searching The Council's own engine source code on general/external topics.`
      : `4. Spot-check proof sources: You have read-only inspection tools enabled. No local code workspace is attached (running in an isolated sandbox directory); do NOT run local filesystem search/grep/find commands (rg, grep, find, ls) to search a codebase. Furthermore, do NOT run local filesystem tools (cat, readToolCall, view_file) and do NOT read or probe absolute host file paths mentioned in the topic or evidence packet. Spot-check submitted proof sources and citations against the Pre-Gathered Baseline Evidence packet, authoritative specifications, web search (if needed for external facts), or analytical/mathematical derivations to verify that cited sources substantiate the submitted assertions before admitting them.${judgeEvidenceGuidance} Local filesystem tools are only for topics that explicitly concern files in the target workspace—never for searching The Council's own engine source code on general/external topics.`;
    judgeDirectives.push(judgeToolGuidance);
  }

  const answerFirstDirective = `${judgeDirectives.length + 1}. Standalone Answer-First Summary: candidate.summary ("summary") MUST be a standalone, direct, user-facing executive synthesis that directly answers the user's topic in clear prose. It MUST NOT contain internal proof IDs (e.g. P1, P2, [P1]) or audit process commentary (e.g. "P1 was admitted...", "P2-P4 require corrections..."). All proof audit commentary belongs strictly in proofDecisions, and proof citations belong strictly in "clauses[].citedProofIds".`;
  judgeDirectives.push(answerFirstDirective);
  judgeDirectives.push(`${judgeDirectives.length + 1}. ${ANTI_CHEATING_RULE}`);

  return `### THE COUNCIL — JUDGE AUDIT AND SYNTHESIS ROUND ${round}/${resolvedMaxRounds}
Topic: "${resolvedTopic}"
Judge: ${judge?.id || 'judge'} (${judge?.model || 'model'})
Soul: ${judgeSoul.name || 'Impartial Proof Auditor'}: ${judgeSoul.lens || ''}
${groundingSection}
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

