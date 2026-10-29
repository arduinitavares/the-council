import { canonicalJson } from "../domain/hash.js";
import type { Observation } from "./types.js";

export function readFailure(source: string, error: unknown): Observation {
  const code = String((error as any)?.code ?? error).toLowerCase();
  const state = /authentication|unauthorized|not.authenticated|\b401\b/.test(code)
    ? "authentication_failed" : /denied|forbidden|\b403\b/.test(code) ? "denied"
    : /exhausted|quota.exceeded/.test(code) ? "exhausted"
    : /unsupported/.test(code) ? "unsupported" : "missing";
  return { state, source, detail: `Native source returned ${state}; raw account identities and diagnostics are not persisted.` };
}

/** Project only quota fields from the registered account snapshot. Never store
 * accounts, credentials, provenance identifiers or infer spending authority. */
export function accountAllowance(provider: "codex" | "cursor", value: any, now: number): Observation {
  const source = `Orca 1.4.244 accounts.list(refreshUsage=true) rateLimits.${provider}`;
  if (!value || value.provider !== provider)
    return { state: "missing", source, detail: "Provider usage observation absent" };
  if (value.error || value.status !== "ok") return readFailure(source, value.error ?? value.status);
  if (!Number.isFinite(value.updatedAt) || value.updatedAt > now + 60000 || now - value.updatedAt > 300000)
    return { state: "missing", source, detail: canonicalJson({ reason: "STALE_OR_UNDATED_ALLOWANCE", updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : null, observedAt: now }) };
  if (!["session","weekly","monthly","buckets"].some(key => Object.hasOwn(value,key) && value[key] !== undefined))
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
