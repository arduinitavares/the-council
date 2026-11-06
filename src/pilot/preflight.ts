import { canonicalJson, hashArtifact } from "../domain/hash.js";
import type {
  Blocker,
  NativeEvidence,
  PilotRequest,
  RouteEvidence,
} from "./types.js";
import type { Role } from "./config.js";
export function proofKey(e: NativeEvidence, r: RouteEvidence): string {
  return hashArtifact("pilot-proof", {
    host: e.host,
    runtimeId: e.runtimeId,
    orcaVersion: e.orcaVersion,
    versions: e.versions,
    roots: e.roots,
    workspace: e.workspace,
    workspaceId: e.workspaceId,
    action: e.action,
    policyHash: e.policyHash,
    controlsHash: e.controlsHash,
    ...(e.producerCodeHash ? { producerCodeHash: e.producerCodeHash } : {}),
    selection: canonicalJson(r.selection),
    version: r.version,
  });
}
export function classify(request: PilotRequest, e: NativeEvidence, stage: "bootstrap" | "effective" = "effective"): Blocker[] {
  const blockers: Blocker[] = [];
  const add = (
    role: Role | null,
    control: string,
    reason: string,
    source: string,
    observed: string,
  ) =>
    blockers.push({
      role,
      control,
      reason,
      source,
      observed,
      nextAction:
        "Inspect the named native source and establish this prerequisite within existing authority; do not substitute routes or change settings.",
    });
  if (e.workspace !== request.workspace)
    add(null, "workspace", "WORKSPACE_MISMATCH", "Orca workspace", e.workspace);
  for (const [role, selection] of [
    ...Object.entries(request.config.reviewers),
    ["judge", request.config.judge],
  ] as const) {
    const r = e.routes.find((x) => x.role === role);
    if (!r || canonicalJson(r.selection) !== canonicalJson(selection)) {
      add(
        role as Role,
        "selection",
        "EXACT_SELECTION_MISSING",
        "native catalog",
        "missing or mismatched",
      );
      continue;
    }
    for (const control of [
      "catalog",
      "controls",
      "allowance",
      "billing",
    ] as const) {
      const o = control === "controls" && stage === "bootstrap" ? r.bootstrap ?? r.controls : r[control];
      const allowed =
        o.state === "verified" ||
        (control === "allowance" && o.state === "unknown") ||
        (control === "billing" && r.selection.route !== "cursor" && o.state === "unknown");
      if (!allowed)
        add(
          r.role,
          control,
          `${control.toUpperCase()}_${o.state.toUpperCase()}`,
          o.source,
          o.detail,
        );
    }
  }
  return blockers;
}
