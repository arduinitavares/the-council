import { canonicalJson } from "../domain/hash.js";
import { projectDiagnostic } from "./diagnostics.js";
import type { Observation } from "./types.js";

const nativeSources = new Set([
  "Orca accounts.list(refreshUsage=true)", "accounts.list", "native boundary", "native run-create", "native source read",
  "Orca accounts.list(refreshUsage=true) rateLimits.codex", "Orca accounts.list(refreshUsage=true) rateLimits.cursor",
]);

export function readFailure(source: string, error: unknown): Observation {
  const diagnostic = projectDiagnostic(error, { origin: "native-read", phase: "native-read" });
  // Preserve source-state classification in memory, without coercing arbitrary
  // objects or copying their text into the persisted diagnostic.
  let code = "";
  try {
    const value = (error as any)?.code ?? (error as any)?.response?.error?.code ?? (error instanceof Error ? error.message : error);
    if (typeof value === "string") code = value.toLowerCase();
    else if (typeof value === "number") code = String(value);
  } catch { /* Unreadable native properties leave the observation missing. */ }
  const state = /authentication|unauthorized|not.authenticated|\b401\b|^http_401$/.test(code)
    ? "authentication_failed" : /denied|forbidden|\b403\b|^http_403$/.test(code) ? "denied"
    : /exhausted|quota.exceeded/.test(code) ? "exhausted"
    : /unsupported/.test(code) ? "unsupported" : "missing";
  return { state, source: nativeSources.has(source) ? source : "native source read", detail: canonicalJson(diagnostic) };
}

/** Project only quota fields from the registered account snapshot. Never store
 * accounts, credentials, provenance identifiers or infer spending authority. */
export function accountAllowance(provider: "codex" | "cursor", value: any, now: number): Observation {
  const source = `Orca accounts.list(refreshUsage=true) rateLimits.${provider}`;
  if (!value || value.provider !== provider)
    return { state: "missing", source, detail: "Provider usage observation absent" };
  if (value.error || value.status !== "ok") return readFailure(source, value.error ?? value.status);
  if (!Number.isFinite(value.updatedAt) || value.updatedAt > now + 60000 || now - value.updatedAt > 300000)
    return { state: "missing", source, detail: canonicalJson({ reason: "STALE_OR_UNDATED_ALLOWANCE", updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : null, observedAt: now }) };
  if (!["session","weekly","monthly"].some(key => Object.hasOwn(value,key) && value[key] !== undefined) &&
      !(Array.isArray(value.buckets) && value.buckets.length > 0))
    return {state:"missing",source,detail:"No usage windows exposed; absence is not an explicit unknown observation"};
  const project = (window: any) => window == null ? null : {
    usedPercent: typeof window.usedPercent === "number" && Number.isFinite(window.usedPercent) && window.usedPercent >= 0 && window.usedPercent <= 100 ? window.usedPercent : null,
    windowMinutes: Number.isFinite(window.windowMinutes) ? window.windowMinutes : null,
    resetsAt: Number.isFinite(window.resetsAt) ? window.resetsAt : null,
  };
  const windows = { session: project(value.session), weekly: project(value.weekly), monthly: project(value.monthly) };
  const buckets = Array.isArray(value.buckets) ? value.buckets.map((b: any) => ({
    name: ["Cursor Models", "Other Models"].includes(b.name) ? b.name : "provider bucket", ...project(b),
  })) : [];
  const percentages = [...Object.values(windows), ...buckets].filter(v => v != null).map(v => v!.usedPercent);
  const state = percentages.some(n => n !== null && n >= 100) ? "exhausted"
    : percentages.some(n => n !== null) ? "verified" : "unknown";
  return { state, source, detail: canonicalJson({
    provider, updatedAt: value.updatedAt, observedAt: now, windows, buckets,
    planType: value.planType === "premium" ? "premium" : "unexposed",
    usageSource: value.usageMetadata?.source === "cli" ? "cli" : "unexposed",
    extraUsage: { enabled: typeof value.extraUsage?.enabled === "boolean" ? value.extraUsage.enabled : null,
      unlimited: typeof value.extraUsage?.unlimited === "boolean" ? value.extraUsage.unlimited : null },
  }) };
}
