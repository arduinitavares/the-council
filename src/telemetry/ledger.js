/**
 * @fileoverview Decoupled Cross-Run Telemetry Ledger & Browser Projection for The Council.
 * ESM Module (Node >= 22). Zero external dependencies.
 *
 * Persists immutable per-run records to `<telemetryDir>/runs/<runId>.json`
 * and projects aggregated summaries to `<outputDir>/telemetry-summary.json` and
 * `<outputDir>/telemetry-summary.js` (`window.CouncilTelemetrySummary`) without
 * bloating `.council/runs/index.js`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseModelAndEffort, extractCanonicalBaseModel } from '../harness/cli-runner.js';

export const TELEMETRY_SCHEMA_VERSION = 1;
export const DEFAULT_RUNS_DIR = path.resolve(import.meta.dirname, '../../.council/runs');
export const DEFAULT_TELEMETRY_DIR = path.resolve(import.meta.dirname, '../../.council/telemetry');

function roundPct(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.round(value * 10) / 10;
}

function roundRatio(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.round(value * 100) / 100;
}

/**
 * Computes proof admission metrics and rates for a given collection of proofs.
 *
 * @param {Array<Object>} [seatProofs=[]]
 * @returns {{
 *   proofsSubmitted: number,
 *   explicitlyAdmitted: number,
 *   partiallyAdmitted: number,
 *   defaultAdmitted: number,
 *   judgeRejected: number,
 *   explicitAdmissionRate: number,
 *   partialAdmissionRate: number,
 *   defaultAdmissionRate: number,
 *   judgeRejectionRate: number
 * }}
 */
export function getSeatProofMetrics(seatProofs = []) {
  const proofs = Array.isArray(seatProofs) ? seatProofs : [];
  let explicitlyAdmitted = 0;
  let partiallyAdmitted = 0;
  let defaultAdmitted = 0;
  let judgeRejected = 0;

  for (const p of proofs) {
    if (!p || typeof p !== 'object') continue;
    if (p.admissionKind === 'partially_admitted' || p.status === 'partially_admitted') {
      partiallyAdmitted += 1;
    } else if (p.admissionKind === 'explicitly_admitted') {
      explicitlyAdmitted += 1;
    } else if (p.admissionKind === 'default_admitted') {
      defaultAdmitted += 1;
    } else if (p.admissionKind === 'judge_rejected' || p.status === 'rejected') {
      judgeRejected += 1;
    } else if (p.status === 'admitted') {
      defaultAdmitted += 1;
    }
  }

  const proofsSubmitted = proofs.length;
  const explicitAdmissionRate = proofsSubmitted > 0 ? roundPct((explicitlyAdmitted / proofsSubmitted) * 100) : 0;
  const partialAdmissionRate = proofsSubmitted > 0 ? roundPct((partiallyAdmitted / proofsSubmitted) * 100) : 0;
  const defaultAdmissionRate = proofsSubmitted > 0 ? roundPct((defaultAdmitted / proofsSubmitted) * 100) : 0;
  const judgeRejectionRate = proofsSubmitted > 0 ? roundPct((judgeRejected / proofsSubmitted) * 100) : 0;

  return {
    proofsSubmitted,
    explicitlyAdmitted,
    partiallyAdmitted,
    defaultAdmitted,
    judgeRejected,
    explicitAdmissionRate,
    partialAdmissionRate,
    defaultAdmissionRate,
    judgeRejectionRate
  };
}

/**
 * Normalizes provider and model string into a canonical model key `provider/model (effort)`.
 * Ensures forms like `gemini-4-argon-high` and `gemini-4-argon (high)` map to the same key
 * `antigravity/gemini-4-argon (high)`.
 *
 * @param {string} provider
 * @param {string} modelString
 * @param {string} [defaultEffort='high']
 * @returns {{ key: string, provider: string, model: string, effort: string }}
 */
export function canonicalizeModelKey(provider, modelString, defaultEffort = 'high') {
  const normProvider = String(provider || 'unknown').trim().toLowerCase() || 'unknown';
  const rawModel = String(modelString || 'unknown').trim() || 'unknown';

  try {
    const parsed = parseModelAndEffort(rawModel, defaultEffort);
    const baseModel = extractCanonicalBaseModel(rawModel, defaultEffort);
    const effort = (parsed.effort || defaultEffort || 'high').toLowerCase();
    return {
      key: `${normProvider}/${baseModel} (${effort})`,
      provider: normProvider,
      model: baseModel,
      effort
    };
  } catch {
    const lowerModel = rawModel.toLowerCase();
    const fallbackEffort = String(defaultEffort || 'high').toLowerCase();
    return {
      key: `${normProvider}/${lowerModel} (${fallbackEffort})`,
      provider: normProvider,
      model: lowerModel,
      effort: fallbackEffort
    };
  }
}

/**
 * Resolves output and telemetry directory paths with safe test isolation.
 *
 * @param {Object} [options]
 * @param {string} [options.outputDir]
 * @param {string} [options.telemetryDir]
 * @returns {{ outputDir: string, telemetryDir: string, runsTelemetryDir: string, summaryJsonPath: string, summaryJsPath: string }}
 */
export function resolveTelemetryDirs({ outputDir, telemetryDir } = {}) {
  const resolvedOutputDir = outputDir ? path.resolve(outputDir) : DEFAULT_RUNS_DIR;
  let resolvedTelemetryDir;
  if (telemetryDir) {
    resolvedTelemetryDir = path.resolve(telemetryDir);
  } else if (
    path.dirname(resolvedOutputDir) === path.resolve(os.tmpdir()) &&
    path.basename(resolvedOutputDir) !== 'runs'
  ) {
    // Isolate direct os.tmpdir() test folders so concurrent tests do not share /tmp/telemetry
    resolvedTelemetryDir = path.join(resolvedOutputDir, 'telemetry');
  } else {
    resolvedTelemetryDir = path.resolve(resolvedOutputDir, '../telemetry');
  }

  return {
    outputDir: resolvedOutputDir,
    telemetryDir: resolvedTelemetryDir,
    runsTelemetryDir: path.join(resolvedTelemetryDir, 'runs'),
    summaryJsonPath: path.join(resolvedOutputDir, 'telemetry-summary.json'),
    summaryJsPath: path.join(resolvedOutputDir, 'telemetry-summary.js')
  };
}

/**
 * Atomically writes content to a target path via a temporary sibling file + rename.
 *
 * @param {string} targetPath
 * @param {string} content
 */
function atomicWriteFileSync(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}-${Math.random().toString(16).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

/**
 * Builds an immutable per-run telemetry record (`schemaVersion: 1`) from a completed Council run.
 *
 * @param {Object} params
 * @param {string} params.runId
 * @param {string} [params.mode='live']
 * @param {Object} params.state
 * @param {Array<Object>} [params.snapshots=[]]
 * @param {Array<Object>} [params.steps=[]]
 * @param {Array<Object>} [params.transitions=[]]
 * @param {Array<Object>} [params.providerCalls=[]]
 * @param {Array<Object>} [params.guardRejections=[]]
 * @param {string} [params.startedAt]
 * @param {string} [params.completedAt]
 * @returns {Readonly<Object>}
 */
export function buildRunTelemetryRecord({
  runId,
  mode = 'live',
  state,
  snapshots = [],
  steps = [],
  transitions = [],
  providerCalls = [],
  guardRejections = [],
  guardRejectedEvents = [],
  startedAt,
  completedAt
} = {}) {
  if (!state || typeof state !== 'object') {
    throw new Error('buildRunTelemetryRecord requires a valid CouncilState object.');
  }

  const effectiveRunId =
    typeof runId === 'string' && runId.trim()
      ? runId.trim()
      : `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const completedIso = completedAt || new Date().toISOString();
  const startedIso = startedAt || completedIso;

  // 1. Collect transition events from snapshots, steps, or transitions
  const transitionRecords =
    Array.isArray(snapshots) && snapshots.length > 0
      ? snapshots
      : Array.isArray(steps) && steps.length > 0
        ? steps
        : Array.isArray(transitions)
          ? transitions
          : [];

  const guardRejectedBySeat = new Map();
  const retryCountBySeat = new Map();
  const excusedBySeat = new Set();

  const seenRejectedProofEventObjects = new Set();
  const seenRejectedProofEventKeys = new Set();
  const seenRejectedProofIdKeys = new Set();

  const getRejectedProofFallbackKey = (seatId, ev) =>
    `${seatId}:${ev.id || ev.proof?.id || ''}:${ev.statement || ev.proof?.statement || ''}`;

  for (const item of transitionRecords) {
    if (!item || typeof item !== 'object') continue;
    const ev = item.event && typeof item.event === 'object' ? item.event : item;
    const lastTrans =
      item.stateDelta?.lastTransition ||
      item.stateSnapshot?.lastTransition ||
      item.state?.lastTransition ||
      item.lastTransition ||
      null;
    const isOk = lastTrans ? lastTrans.ok !== false : item.ok !== false;

    if (ev.type === 'SUBMIT_PROOF' && !isOk) {
      const seatId = ev.seatId || ev.proof?.seatId;
      if (seatId) {
        const proofId = ev.id || ev.proof?.id || '';
        const statement = ev.statement || ev.proof?.statement || '';
        seenRejectedProofEventObjects.add(ev);
        if (proofId || statement) {
          seenRejectedProofEventKeys.add(getRejectedProofFallbackKey(seatId, ev));
        }
        if (proofId) {
          seenRejectedProofIdKeys.add(`${seatId}:${proofId}`);
        }
        guardRejectedBySeat.set(seatId, (guardRejectedBySeat.get(seatId) || 0) + 1);
      }
    } else if (ev.type === 'RETRY_SEAT' && isOk) {
      const seatId = ev.seatId || ev.seat?.id;
      if (seatId) {
        retryCountBySeat.set(seatId, (retryCountBySeat.get(seatId) || 0) + 1);
      }
    } else if (ev.type === 'EXCUSE_SEAT' && isOk) {
      const seatId = ev.seatId || ev.seat?.id;
      if (seatId) {
        excusedBySeat.add(seatId);
      }
    }
  }

  const effectiveGuardRejections =
    Array.isArray(guardRejections) && guardRejections.length > 0
      ? guardRejections
      : (Array.isArray(guardRejectedEvents) ? guardRejectedEvents : []);

  if (effectiveGuardRejections.length > 0) {
    for (const gr of effectiveGuardRejections) {
      const ev = gr?.event || gr;
      if (ev?.type === 'SUBMIT_PROOF' && !seenRejectedProofEventObjects.has(ev)) {
        const seatId = ev.seatId || ev.proof?.seatId;
        if (seatId) {
          const proofId = ev.id || ev.proof?.id || '';
          const statement = ev.statement || ev.proof?.statement || '';
          const fallbackKey = getRejectedProofFallbackKey(seatId, ev);
          const idKey = proofId ? `${seatId}:${proofId}` : '';
          if (
            !seenRejectedProofEventKeys.has(fallbackKey) &&
            (!idKey || !seenRejectedProofIdKeys.has(idKey))
          ) {
            seenRejectedProofEventObjects.add(ev);
            if (proofId || statement) {
              seenRejectedProofEventKeys.add(fallbackKey);
            }
            if (idKey) {
              seenRejectedProofIdKeys.add(idKey);
            }
            guardRejectedBySeat.set(seatId, (guardRejectedBySeat.get(seatId) || 0) + 1);
          }
        }
      }
    }
  }

  // 2. Map committed proofs by ID and by seatId
  const allProofs = Array.isArray(state.proofs) ? state.proofs : [];
  const proofById = new Map();
  const proofsBySeat = new Map();

  for (const p of allProofs) {
    if (!p || typeof p !== 'object') continue;
    if (p.id) {
      proofById.set(p.id, p);
    }
    if (p.seatId) {
      if (!proofsBySeat.has(p.seatId)) {
        proofsBySeat.set(p.seatId, []);
      }
      proofsBySeat.get(p.seatId).push(p);
    }
  }

  // 3. Count final clause citations ONLY from terminal verdict.candidate.clauses
  const terminalClauses = Array.isArray(state.verdict?.candidate?.clauses)
    ? state.verdict.candidate.clauses
    : [];
  const citationCountBySeat = new Map();
  const citedProofIdsBySeat = new Map();

  for (const clause of terminalClauses) {
    if (!clause || !Array.isArray(clause.citedProofIds)) continue;
    for (const pid of clause.citedProofIds) {
      const proof = proofById.get(pid);
      if (!proof || !proof.seatId) continue;
      const sid = proof.seatId;
      citationCountBySeat.set(sid, (citationCountBySeat.get(sid) || 0) + 1);
      if (!citedProofIdsBySeat.has(sid)) {
        citedProofIdsBySeat.set(sid, new Set());
      }
      citedProofIdsBySeat.get(sid).add(pid);
    }
  }

  // 4. Map providerCalls by participantId / seatId
  const callsBySeat = new Map();
  for (const call of Array.isArray(providerCalls) ? providerCalls : []) {
    if (!call || typeof call !== 'object') continue;
    const sid = call.participantId || call.seatId;
    if (!sid) continue;
    if (!callsBySeat.has(sid)) {
      callsBySeat.set(sid, []);
    }
    callsBySeat.get(sid).push(call);
  }

  // 5. Build per-seat telemetry entries
  const seats = Array.isArray(state.seats) ? state.seats : [];
  const seatRecords = seats.map((seat) => {
    const seatId = seat.id;
    const canonical = canonicalizeModelKey(seat.harness, seat.model);
    const seatProofs = proofsBySeat.get(seatId) || [];
    const proofMetrics = getSeatProofMetrics(seatProofs);

    const proofsSubmitted = proofMetrics.proofsSubmitted;
    const explicitlyAdmitted = proofMetrics.explicitlyAdmitted;
    const partiallyAdmitted = proofMetrics.partiallyAdmitted;
    const defaultAdmitted = proofMetrics.defaultAdmitted;
    const judgeRejected = proofMetrics.judgeRejected;
    const guardRejectedProofs =
      (guardRejectedBySeat.get(seatId) || 0) +
      (typeof seat.guardRejectedProofs === 'number' ? seat.guardRejectedProofs : 0);
    const retries = Math.max(
      typeof seat.retries === 'number' ? seat.retries : 0,
      retryCountBySeat.get(seatId) || 0
    );
    const excused = seat.status === 'excused' || excusedBySeat.has(seatId);
    const finalClauseCitations = citationCountBySeat.get(seatId) || 0;
    const distinctProofsCited = citedProofIdsBySeat.get(seatId)?.size || 0;

    // Provider call trace aggregation for this seat
    const seatCalls = callsBySeat.get(seatId) || [];
    let traceCoverage = 'unavailable';
    let observedToolCalls = null;
    const skillsByName = new Map();
    let forbiddenStateAccess = Boolean(seat.forbiddenStateAccess);
    const forbiddenDetailsSet = new Set(
      Array.isArray(seat.forbiddenAccessDetails)
        ? seat.forbiddenAccessDetails
            .filter((d) => typeof d === 'string' && d.trim())
            .map((d) => d.trim())
        : []
    );

    if (seatCalls.length > 0) {
      for (const c of seatCalls) {
        if (c.trace?.forbiddenStateAccess === true || c.forbiddenStateAccess === true) {
          forbiddenStateAccess = true;
        }
        const callDetails = [
          ...(Array.isArray(c.trace?.forbiddenAccessDetails) ? c.trace.forbiddenAccessDetails : []),
          ...(Array.isArray(c.forbiddenAccessDetails) ? c.forbiddenAccessDetails : [])
        ];
        for (const d of callDetails) {
          if (typeof d === 'string' && d.trim()) {
            forbiddenDetailsSet.add(d.trim());
            forbiddenStateAccess = true;
          }
        }
      }

      const coverages = seatCalls.map((c) => {
        if (c.trace && typeof c.trace.traceCoverage === 'string') {
          return c.trace.traceCoverage;
        }
        return c.provider === 'antigravity' ? 'unavailable' : 'partial';
      });

      const allUnavailable = coverages.every((c) => c === 'unavailable');
      const allFull = coverages.every((c) => c === 'full');

      if (allUnavailable) {
        traceCoverage = 'unavailable';
        observedToolCalls = null;
      } else {
        traceCoverage = allFull ? 'full' : 'partial';
        let toolSum = 0;
        for (const c of seatCalls) {
          const cov = c.trace?.traceCoverage;
          if (cov === 'unavailable') continue;
          const tCalls = Array.isArray(c.trace?.toolCalls)
            ? c.trace.toolCalls.length
            : (typeof c.observedToolCalls === 'number' ? c.observedToolCalls : 0);
          toolSum += tCalls;

          const sRead = Array.isArray(c.trace?.skillsRead)
            ? c.trace.skillsRead
            : (Array.isArray(c.skillsRead) ? c.skillsRead : []);
          for (const sr of sRead) {
            const skillName = typeof sr === 'string' ? sr : sr?.skill;
            if (skillName && !skillsByName.has(skillName)) {
              skillsByName.set(skillName, {
                skill: skillName,
                evidence: 'skill_instructions_read'
              });
            }
          }
        }
        observedToolCalls = toolSum;
      }
    }

    if (forbiddenDetailsSet.size > 0) {
      forbiddenStateAccess = true;
    }

    return Object.freeze({
      seatId,
      provider: canonical.provider,
      model: canonical.model,
      effort: canonical.effort,
      modelKey: canonical.key,
      status: seat.status || 'idle',
      excused,
      excusedReason: excused ? (seat.excusedReason || 'Excused') : null,
      retries,
      proofsSubmitted,
      guardRejectedProofs,
      explicitlyAdmitted,
      partiallyAdmitted,
      partiallyAdmittedProofs: partiallyAdmitted,
      defaultAdmitted,
      judgeRejected,
      finalClauseCitations,
      distinctProofsCited,
      traceCoverage,
      observedToolCalls,
      skillsRead: Object.freeze([...skillsByName.values()].map((s) => Object.freeze({ ...s }))),
      forbiddenStateAccess,
      forbiddenAccessDetails: Object.freeze([...forbiddenDetailsSet])
    });
  });

  const judgeInfo = state.judge
    ? Object.freeze({
        id: state.judge.id,
        ...canonicalizeModelKey(state.judge.harness, state.judge.model)
      })
    : null;

  return Object.freeze({
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    runId: effectiveRunId,
    mode: String(mode || 'live'),
    topic: state.topic || '',
    startedAt: startedIso,
    completedAt: completedIso,
    rounds: state.round || 0,
    verdictKind: state.verdict?.kind || null,
    judge: judgeInfo,
    seats: Object.freeze(seatRecords)
  });
}

function createMutableBucket({ key, groupBy, provider, model, effort }) {
  return {
    key,
    groupBy,
    provider: provider || 'unknown',
    model: model || 'unknown',
    effort: effort || 'high',
    seatIdsSet: new Set(),
    modelsSet: new Set(),
    runs: 0,
    proofsSubmitted: 0,
    guardRejectedProofs: 0,
    explicitlyAdmitted: 0,
    partiallyAdmitted: 0,
    defaultAdmitted: 0,
    judgeRejected: 0,
    finalClauseCitations: 0,
    distinctProofsCited: 0,
    retries: 0,
    excusedRuns: 0,
    fullRuns: 0,
    partialRuns: 0,
    unavailableRuns: 0,
    tracedToolCallsSum: 0,
    tracedRunsCount: 0,
    skillCounts: new Map()
  };
}

function accumulateIntoBucket(bucket, seatEntry) {
  if (seatEntry.seatId) {
    bucket.seatIdsSet.add(seatEntry.seatId);
  }
  if (Array.isArray(seatEntry.seatIds)) {
    for (const sid of seatEntry.seatIds) {
      if (sid) bucket.seatIdsSet.add(sid);
    }
  }
  if (seatEntry.modelKey) {
    bucket.modelsSet.add(seatEntry.modelKey);
  }
  bucket.runs += 1;
  bucket.proofsSubmitted += seatEntry.proofsSubmitted || 0;
  bucket.guardRejectedProofs += seatEntry.guardRejectedProofs || 0;
  bucket.explicitlyAdmitted += seatEntry.explicitlyAdmitted || 0;
  bucket.partiallyAdmitted += seatEntry.partiallyAdmitted || seatEntry.partiallyAdmittedProofs || 0;
  bucket.defaultAdmitted += seatEntry.defaultAdmitted || 0;
  bucket.judgeRejected += seatEntry.judgeRejected || 0;
  bucket.finalClauseCitations += seatEntry.finalClauseCitations || 0;
  bucket.distinctProofsCited += seatEntry.distinctProofsCited || 0;
  bucket.retries += seatEntry.retries || 0;
  if (seatEntry.excused) {
    bucket.excusedRuns += 1;
  }

  const cov = seatEntry.traceCoverage || 'unavailable';
  if (cov === 'full') {
    bucket.fullRuns += 1;
  } else if (cov === 'partial') {
    bucket.partialRuns += 1;
  } else {
    bucket.unavailableRuns += 1;
  }

  if (cov !== 'unavailable' && typeof seatEntry.observedToolCalls === 'number') {
    bucket.tracedRunsCount += 1;
    bucket.tracedToolCallsSum += seatEntry.observedToolCalls;
  }

  if (Array.isArray(seatEntry.skillsRead)) {
    for (const sr of seatEntry.skillsRead) {
      const skillName = typeof sr === 'string' ? sr : sr?.skill;
      if (skillName) {
        bucket.skillCounts.set(skillName, (bucket.skillCounts.get(skillName) || 0) + 1);
      }
    }
  }
}

function mergeModelSeatsForRun(seatsForModel, canonicalKey) {
  if (seatsForModel.length === 1) {
    return {
      ...seatsForModel[0],
      modelKey: canonicalKey
    };
  }
  const seatIds = [];
  let proofsSubmitted = 0;
  let guardRejectedProofs = 0;
  let explicitlyAdmitted = 0;
  let partiallyAdmitted = 0;
  let defaultAdmitted = 0;
  let judgeRejected = 0;
  let finalClauseCitations = 0;
  let distinctProofsCited = 0;
  let retries = 0;
  let excused = false;
  let fullCount = 0;
  let partialCount = 0;
  let tracedToolCalls = 0;
  let hasTracedSeat = false;
  const skillsSet = new Set();
  let forbiddenStateAccess = false;
  const forbiddenDetailsSet = new Set();

  for (const s of seatsForModel) {
    if (s.seatId) seatIds.push(s.seatId);
    proofsSubmitted += s.proofsSubmitted || 0;
    guardRejectedProofs += s.guardRejectedProofs || 0;
    explicitlyAdmitted += s.explicitlyAdmitted || 0;
    partiallyAdmitted += s.partiallyAdmitted || s.partiallyAdmittedProofs || 0;
    defaultAdmitted += s.defaultAdmitted || 0;
    judgeRejected += s.judgeRejected || 0;
    finalClauseCitations += s.finalClauseCitations || 0;
    distinctProofsCited += s.distinctProofsCited || 0;
    retries += s.retries || 0;
    if (s.excused) excused = true;
    if (s.forbiddenStateAccess) forbiddenStateAccess = true;
    if (Array.isArray(s.forbiddenAccessDetails)) {
      for (const d of s.forbiddenAccessDetails) {
        if (typeof d === 'string' && d.trim()) {
          forbiddenDetailsSet.add(d.trim());
          forbiddenStateAccess = true;
        }
      }
    }

    const cov = s.traceCoverage || 'unavailable';
    if (cov === 'full') fullCount += 1;
    else if (cov === 'partial') partialCount += 1;

    if (cov !== 'unavailable' && typeof s.observedToolCalls === 'number') {
      hasTracedSeat = true;
      tracedToolCalls += s.observedToolCalls;
    }

    if (Array.isArray(s.skillsRead)) {
      for (const sr of s.skillsRead) {
        const skillName = typeof sr === 'string' ? sr : sr?.skill;
        if (skillName) skillsSet.add(skillName);
      }
    }
  }

  let traceCoverage = 'unavailable';
  if (fullCount === seatsForModel.length) {
    traceCoverage = 'full';
  } else if (fullCount > 0 || partialCount > 0) {
    traceCoverage = 'partial';
  }

  return {
    seatIds,
    modelKey: canonicalKey,
    proofsSubmitted,
    guardRejectedProofs,
    explicitlyAdmitted,
    partiallyAdmitted,
    partiallyAdmittedProofs: partiallyAdmitted,
    defaultAdmitted,
    judgeRejected,
    finalClauseCitations,
    distinctProofsCited,
    retries,
    excused,
    traceCoverage,
    observedToolCalls: hasTracedSeat ? tracedToolCalls : null,
    skillsRead: [...skillsSet].map((skill) => ({ skill, evidence: 'skill_instructions_read' })),
    forbiddenStateAccess,
    forbiddenAccessDetails: Object.freeze([...forbiddenDetailsSet])
  };
}

function finalizeBucket(bucket) {
  const submitted = bucket.proofsSubmitted;
  const runs = bucket.runs;
  const tracedRuns = bucket.fullRuns + bucket.partialRuns;

  const explicitAdmissionRate = submitted > 0 ? roundPct((bucket.explicitlyAdmitted / submitted) * 100) : 0;
  const partialAdmissionRate = submitted > 0 ? roundPct((bucket.partiallyAdmitted / submitted) * 100) : 0;
  const defaultAdmissionRate = submitted > 0 ? roundPct((bucket.defaultAdmitted / submitted) * 100) : 0;
  const judgeRejectionRate = submitted > 0 ? roundPct((bucket.judgeRejected / submitted) * 100) : 0;
  const finalClauseCitationRate =
    submitted > 0 ? roundPct((bucket.distinctProofsCited / submitted) * 100) : 0;
  const citationsPerProof =
    submitted > 0 ? roundRatio(bucket.finalClauseCitations / submitted) : 0;
  const excusedRate = runs > 0 ? roundPct((bucket.excusedRuns / runs) * 100) : 0;

  const observedToolCalls = tracedRuns > 0 ? bucket.tracedToolCallsSum : null;
  const skillsRead = [...bucket.skillCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([skill, count]) => ({
      skill,
      evidence: 'skill_instructions_read',
      count
    }));

  return {
    key: bucket.key,
    provider: bucket.provider,
    model: bucket.model,
    effort: bucket.effort,
    seatIds: [...bucket.seatIdsSet].sort(),
    models: [...bucket.modelsSet].sort(),
    runs,
    proofsSubmitted: submitted,
    guardRejectedProofs: bucket.guardRejectedProofs,
    explicitlyAdmitted: bucket.explicitlyAdmitted,
    partiallyAdmitted: bucket.partiallyAdmitted,
    partialAdmissionRate,
    defaultAdmitted: bucket.defaultAdmitted,
    judgeRejected: bucket.judgeRejected,
    explicitAdmissionRate,
    defaultAdmissionRate,
    judgeRejectionRate,
    finalClauseCitations: bucket.finalClauseCitations,
    distinctProofsCited: bucket.distinctProofsCited,
    finalClauseCitationRate,
    citationsPerProof,
    retries: bucket.retries,
    excusedRuns: bucket.excusedRuns,
    excusedRate,
    traceCoverage: {
      fullRuns: bucket.fullRuns,
      partialRuns: bucket.partialRuns,
      unavailableRuns: bucket.unavailableRuns
    },
    observedToolCalls,
    skillsRead
  };
}

function deduplicateRecordsByRunId(records = []) {
  const byRunId = new Map();
  for (const rec of Array.isArray(records) ? records : []) {
    if (!rec || typeof rec !== 'object' || !rec.runId) continue;
    byRunId.set(rec.runId, rec);
  }
  return [...byRunId.values()].sort((a, b) => {
    const timeA = String(a.completedAt || a.startedAt || '');
    const timeB = String(b.completedAt || b.startedAt || '');
    if (timeA !== timeB) return timeB.localeCompare(timeA);
    return String(a.runId).localeCompare(String(b.runId));
  });
}

/**
 * Aggregates per-run telemetry records into `byModel` and `bySeat` leaderboards
 * for an optional rolling window (`days`).
 *
 * @param {Array<Object>} records
 * @param {Object} [options]
 * @param {number|null} [options.days=null]
 * @param {Date|string|number} [options.now]
 * @returns {{ window: string, days: number|null, totalRuns: number, byModel: Array<Object>, bySeat: Array<Object> }}
 */
export function aggregateTelemetryWindow(
  records = [],
  { days = null, now = new Date(), includeMock = false } = {}
) {
  const deduped = deduplicateRecordsByRunId(records);
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const hasWindow = typeof days === 'number' && Number.isFinite(days) && days > 0;
  const cutoffMs = hasWindow ? nowMs - days * 24 * 60 * 60 * 1000 : null;

  const filtered = deduped.filter((rec) => {
    if (!includeMock && rec.mode === 'mock') return false;
    if (cutoffMs === null) return true;
    const ts = Date.parse(rec.completedAt || rec.startedAt || '');
    if (!Number.isFinite(ts)) return true;
    return ts >= cutoffMs && ts <= nowMs + 60 * 1000;
  });

  const modelBuckets = new Map();
  const seatBuckets = new Map();

  for (const rec of filtered) {
    const seats = Array.isArray(rec.seats) ? rec.seats : [];
    const perRunModelSeats = new Map();

    for (const s of seats) {
      if (!s || typeof s !== 'object') continue;
      const canonical = s.modelKey
        ? {
            key: s.modelKey,
            provider: s.provider || 'unknown',
            model: s.model || 'unknown',
            effort: s.effort || 'high'
          }
        : canonicalizeModelKey(s.provider, s.model, s.effort);

      if (!perRunModelSeats.has(canonical.key)) {
        perRunModelSeats.set(canonical.key, { canonical, seats: [] });
      }
      perRunModelSeats.get(canonical.key).seats.push(s);

      const seatKey = s.seatId || 'unknown';
      if (!seatBuckets.has(seatKey)) {
        seatBuckets.set(
          seatKey,
          createMutableBucket({
            key: seatKey,
            groupBy: 'seat',
            provider: canonical.provider,
            model: canonical.model,
            effort: canonical.effort
          })
        );
      }
      accumulateIntoBucket(seatBuckets.get(seatKey), {
        ...s,
        modelKey: canonical.key
      });
    }

    for (const [modelKey, { canonical, seats: seatsForModel }] of perRunModelSeats.entries()) {
      if (!modelBuckets.has(modelKey)) {
        modelBuckets.set(
          modelKey,
          createMutableBucket({
            key: canonical.key,
            groupBy: 'model',
            provider: canonical.provider,
            model: canonical.model,
            effort: canonical.effort
          })
        );
      }
      accumulateIntoBucket(
        modelBuckets.get(modelKey),
        mergeModelSeatsForRun(seatsForModel, canonical.key)
      );
    }
  }

  const sortBuckets = (list) =>
    list.sort((a, b) => {
      if (b.runs !== a.runs) return b.runs - a.runs;
      if (b.proofsSubmitted !== a.proofsSubmitted) return b.proofsSubmitted - a.proofsSubmitted;
      return String(a.key).localeCompare(String(b.key));
    });

  const byModel = sortBuckets([...modelBuckets.values()].map(finalizeBucket));
  const bySeat = sortBuckets([...seatBuckets.values()].map(finalizeBucket));

  return {
    window: hasWindow ? `${days}d` : 'all',
    days: hasWindow ? days : null,
    totalRuns: filtered.length,
    byModel,
    bySeat
  };
}

/**
 * Builds the cross-run telemetry summary payload (`7d`, `30d`, `all` windows + compact runs list).
 *
 * @param {Array<Object>} records
 * @param {Object} [options]
 * @param {Date|string|number} [options.now]
 * @param {boolean} [options.includeMock=false]
 * @returns {Object}
 */
export function buildTelemetrySummary(
  records = [],
  { now = new Date(), includeMock = false } = {}
) {
  const deduped = deduplicateRecordsByRunId(records).filter(
    (rec) => includeMock || rec.mode !== 'mock'
  );
  const nowDate = now instanceof Date ? now : new Date(now);
  const win7d = aggregateTelemetryWindow(deduped, { days: 7, now: nowDate, includeMock });
  const win30d = aggregateTelemetryWindow(deduped, { days: 30, now: nowDate, includeMock });
  const winAll = aggregateTelemetryWindow(deduped, { days: null, now: nowDate, includeMock });

  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    generatedAt: nowDate.toISOString(),
    totalRuns: deduped.length,
    windows: {
      '7d': win7d,
      '30d': win30d,
      all: winAll
    },
    byModel: winAll.byModel,
    bySeat: winAll.bySeat,
    runs: deduped
  };
}

/**
 * Builds the `file://`-safe browser bundle script for `telemetry-summary.js`.
 *
 * @param {Object} summary
 * @returns {string}
 */
export function buildTelemetrySummaryScript(summary) {
  const json = JSON.stringify(summary, null, 2);
  return `/**
 * Auto-generated Cross-Run Telemetry Summary by The Council.
 * Do not edit manually.
 */
(function (root) {
  'use strict';
  const summary = /* COUNCIL_TELEMETRY_SUMMARY_START */ ${json} /* COUNCIL_TELEMETRY_SUMMARY_END */;
  if (typeof window !== 'undefined') {
    window.CouncilTelemetrySummary = summary;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.CouncilTelemetrySummary = summary;
  }
  if (root) {
    root.CouncilTelemetrySummary = summary;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
`;
}

/**
 * Reads all persisted per-run telemetry records from `<telemetryDir>/runs/*.json`.
 *
 * @param {string} runsTelemetryDir
 * @returns {Array<Object>}
 */
export function readPersistedRunRecords(runsTelemetryDir) {
  if (!runsTelemetryDir || !fs.existsSync(runsTelemetryDir)) {
    return [];
  }
  const records = [];
  let files = [];
  try {
    files = fs.readdirSync(runsTelemetryDir);
  } catch {
    return [];
  }
  for (const name of files) {
    if (!name.endsWith('.json') || name.endsWith('.tmp')) continue;
    try {
      const raw = fs.readFileSync(path.join(runsTelemetryDir, name), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.runId && Array.isArray(parsed.seats)) {
        records.push(parsed);
      }
    } catch {
      // Ignore corrupt or partially written files
    }
  }
  return deduplicateRecordsByRunId(records);
}

/**
 * Persists a single run's telemetry record to `<telemetryDir>/runs/<runId>.json`
 * and atomically updates `<outputDir>/telemetry-summary.json` and `<outputDir>/telemetry-summary.js`.
 * Idempotent by `runId`.
 *
 * @param {Object} params
 * @returns {{ record: Object, summary: Object, paths: Object }}
 */
export function persistRunTelemetry(params = {}) {
  const paths = resolveTelemetryDirs({
    outputDir: params.outputDir,
    telemetryDir: params.telemetryDir
  });

  const record =
    params.record && typeof params.record === 'object' && params.record.runId
      ? params.record
      : buildRunTelemetryRecord(params);

  const runRecordPath = path.join(paths.runsTelemetryDir, `${record.runId}.json`);
  atomicWriteFileSync(runRecordPath, JSON.stringify(record, null, 2));

  const allRecords = readPersistedRunRecords(paths.runsTelemetryDir);
  if (!allRecords.some((r) => r.runId === record.runId)) {
    allRecords.push(record);
  }

  const summary = buildTelemetrySummary(allRecords, {
    now: params.now || new Date(),
    includeMock: Boolean(params.includeMock)
  });
  atomicWriteFileSync(paths.summaryJsonPath, JSON.stringify(summary, null, 2));
  atomicWriteFileSync(paths.summaryJsPath, buildTelemetrySummaryScript(summary));

  return {
    record,
    summary,
    paths: {
      ...paths,
      runRecordPath
    }
  };
}

/**
 * Loads cross-run telemetry summary from disk (recomputing for arbitrary `--days <N>` when requested).
 *
 * @param {Object} [options]
 * @param {string} [options.outputDir]
 * @param {string} [options.telemetryDir]
 * @param {number|null} [options.days=null]
 * @param {Date|string|number} [options.now]
 * @param {boolean} [options.includeMock=false]
 * @returns {Object}
 */
export function loadTelemetrySummary({
  outputDir,
  telemetryDir,
  days = null,
  now = new Date(),
  includeMock = false
} = {}) {
  const paths = resolveTelemetryDirs({ outputDir, telemetryDir });
  let records = readPersistedRunRecords(paths.runsTelemetryDir);

  if (records.length === 0 && fs.existsSync(paths.summaryJsonPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(paths.summaryJsonPath, 'utf8'));
      if (Array.isArray(existing?.runs)) {
        records = existing.runs;
      }
    } catch {
      // Fallback to empty records
    }
  }

  const summary = buildTelemetrySummary(records, { now, includeMock });
  const activeWindow =
    days === 7
      ? summary.windows['7d']
      : days === 30
        ? summary.windows['30d']
        : days === null || days === undefined
          ? summary.windows.all
          : aggregateTelemetryWindow(records, { days, now, includeMock });

  return {
    ...summary,
    activeWindow,
    customWindow: activeWindow
  };
}

/**
 * Formats a clean terminal leaderboard table for `council telemetry`.
 *
 * @param {Object} summary
 * @param {Object} [options]
 * @param {'model'|'seat'} [options.by='model']
 * @param {number|null} [options.days=null]
 * @param {string|null} [options.windowKey=null]
 * @param {Date|string|number} [options.now]
 * @param {boolean} [options.includeMock=false]
 * @returns {string}
 */
export function formatTelemetryTable(
  summary,
  { by = 'model', days = null, windowKey = null, now = new Date(), includeMock = false } = {}
) {
  const groupBy = String(by || 'model').toLowerCase() === 'seat' ? 'seat' : 'model';
  let win;
  if (windowKey && summary?.windows?.[windowKey]) {
    win = summary.windows[windowKey];
  } else if (summary?.activeWindow && (days === null || summary.activeWindow.days === days)) {
    win = summary.activeWindow;
  } else if (days === 7 && summary?.windows?.['7d']) {
    win = summary.windows['7d'];
  } else if (days === 30 && summary?.windows?.['30d']) {
    win = summary.windows['30d'];
  } else if ((days === null || days === undefined) && summary?.windows?.all) {
    win = summary.windows.all;
  } else {
    win = aggregateTelemetryWindow(summary?.runs || [], { days, now, includeMock });
  }

  const rows = groupBy === 'seat' ? win.bySeat || [] : win.byModel || [];
  const windowLabel = win.days ? `Last ${win.days}d` : 'All Time';
  const groupLabel = groupBy === 'seat' ? 'By Seat' : 'By Canonical Model';

  const lines = [];
  lines.push('====================================================================================================================');
  lines.push(`  THE COUNCIL — CROSS-RUN TELEMETRY LEADERBOARD (${groupLabel} · ${windowLabel} · ${win.totalRuns || 0} Run(s))`);
  lines.push('====================================================================================================================');

  if (rows.length === 0) {
    lines.push('  No completed deliberation telemetry records found for the selected window.');
    lines.push('====================================================================================================================');
    return lines.join('\n');
  }

  const headerName = groupBy === 'seat' ? 'Seat ID' : 'Canonical Model';
  const pad = (str, len) => String(str).padEnd(len, ' ');
  const padL = (str, len) => String(str).padStart(len, ' ');

  const nameWidth = Math.max(
    headerName.length,
    ...rows.map((r) => String(r.key || '').length),
    24
  );

  const header = [
    pad(headerName, nameWidth),
    padL('Runs', 5),
    padL('Proofs(Rej)', 12),
    padL('Expl.Admit%', 11),
    padL('Part.Admit%', 11),
    padL('Def.Admit', 9),
    padL('JudgeRej%', 9),
    padL('FinalCite%', 10),
    padL('Excused%', 8),
    pad('Tools / Verified Skills', 28)
  ].join(' | ');

  lines.push(header);
  lines.push('-'.repeat(header.length));

  for (const r of rows) {
    const proofsCell =
      r.guardRejectedProofs > 0
        ? `${r.proofsSubmitted} (+${r.guardRejectedProofs} guard)`
        : `${r.proofsSubmitted}`;
    const explAdmitCell = `${r.explicitAdmissionRate}% (${r.explicitlyAdmitted})`;
    const partAdmitCell = `${r.partialAdmissionRate}% (${r.partiallyAdmitted})`;
    const defAdmitCell = `${r.defaultAdmitted}`;
    const judgeRejCell = `${r.judgeRejectionRate}% (${r.judgeRejected})`;
    const citeCell = `${r.finalClauseCitationRate}% (${r.finalClauseCitations})`;
    const excusedCell = `${r.excusedRate}% (${r.excusedRuns})`;

    let toolsCell;
    if (r.observedToolCalls === null) {
      toolsCell = 'Trace N/A';
    } else {
      const skills = Array.isArray(r.skillsRead) && r.skillsRead.length > 0
        ? ` [${r.skillsRead.map((s) => `${s.skill}:skill_instructions_read`).join(', ')}]`
        : '';
      toolsCell = `${r.observedToolCalls} tools${skills}`;
    }

    lines.push(
      [
        pad(r.key, nameWidth),
        padL(r.runs, 5),
        padL(proofsCell, 12),
        padL(explAdmitCell, 11),
        padL(partAdmitCell, 11),
        padL(defAdmitCell, 9),
        padL(judgeRejCell, 9),
        padL(citeCell, 10),
        padL(excusedCell, 8),
        toolsCell
      ].join(' | ')
    );
  }

  lines.push('====================================================================================================================');
  return lines.join('\n');
}
