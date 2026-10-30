import { expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QualificationCache } from "../../src/pilot/qualification-cache.js";
import type {
  NativeEvidence,
  QualificationProof,
} from "../../src/pilot/types.js";
import { proofKey } from "../../src/pilot/preflight.js";
import { incidentRoster } from "./fixtures.js";
const obs = {
  state: "verified" as const,
  source: "synthetic native API fixture",
  detail: "verified",
};
const e: NativeEvidence = {
  host: "mac",
  runtimeId: "runtime",
  orcaVersion: "1.4.244",
  versions: { orca: "1.4.244" },
  roots: ["/B"],
  workspace: "/B",
  workspaceId: "repo::/B",
  action: "supplied-packet-read-only",
  policyHash: "policy",
  controlsHash: "controls",
  routes: [
    {
      role: "openai",
      selection: incidentRoster.reviewers.openai,
      version: "1",
      catalog: obs,
      controls: obs,
      allowance: obs,
      billing: obs,
      optionalTelemetry: obs,
    },
  ],
};
const key = proofKey(e, e.routes[0]!);
const p: QualificationProof = {
  schemaVersion: 1,
  id: key,
  key,
  scope: e,
  issuedAt: 1000,
  expiresAt: 5000,
  normal: { dispatchId: "normal-owned", outcome: "completed", settled: true },
  cancellation: {
    dispatchId: "cancel-owned",
    outcome: "cancelled",
    settled: true,
  },
  settled: true,
};
it("loads its persisted exact-scope proof only after native evidence is rechecked and serializes writers", async () => {
  const w = realpathSync(mkdtempSync(join(tmpdir(), "pilot-cache-")));
  try {
    const cache = new QualificationCache(w);
    cache.write([p], 1000);
    expect(() => new QualificationCache(w)).toThrow(
      "QUALIFICATION_CACHE_BUSY_RECONCILE",
    );
    cache.close();
    const next = new QualificationCache(w);
    let verified = 0;
    expect(
      await next.matching(e, 2000, async (receipt) => {
        verified++;
        return receipt.normal.dispatchId === "normal-owned";
      }),
    ).toEqual([p]);
    expect(verified).toBe(1);
    expect(
      await next.matching(
        { ...e, controlsHash: "drifted" },
        2000,
        async () => false,
      ),
    ).toEqual([]);
    await expect(next.matching(e, 2000, async () => false)).rejects.toThrow(
      "QUALIFICATION_CACHE_NATIVE_EVIDENCE_UNVERIFIED",
    );
    next.close();
  } finally {
    rmSync(w, { recursive: true, force: true });
  }
});
it("merges another policy's proofs without losing unexpired receipts", () => {
  const w = realpathSync(mkdtempSync(join(tmpdir(), "pilot-cache-merge-")));
  try {
    const cache = new QualificationCache(w);
    cache.write([p], 1000);
    const otherScope = { ...e, policyHash: "other-policy" };
    const otherKey = proofKey(otherScope, otherScope.routes[0]!);
    const other = { ...p, id: otherKey, key: otherKey, scope: otherScope };
    cache.write([other], 2000);
    expect(cache.read()).toEqual(expect.arrayContaining([p, other]));
    expect(cache.read()).toHaveLength(2);
    cache.write([], 5000);
    expect(cache.read()).toEqual([]);
    cache.close();
  } finally { rmSync(w, { recursive: true, force: true }); }
});
it("reports corrupt cache explicitly rather than treating it as no proof", () => {
  const w = realpathSync(mkdtempSync(join(tmpdir(), "pilot-cache-")));
  try {
    const cache = new QualificationCache(w);
    writeFileSync(
      join(w, ".council/native-qualifications/receipts.json"),
      "broken",
    );
    expect(() => cache.read()).toThrow("QUALIFICATION_CACHE_CORRUPT");
    cache.close();
  } finally {
    rmSync(w, { recursive: true, force: true });
  }
});
