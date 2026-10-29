import { canonicalJson, hashArtifact } from "../domain/hash.js";
import type { Command } from "./orca-driver.js";
import { proofKey } from "./preflight.js";
import type { QualificationProof } from "./types.js";
/** Cache contents never certify themselves: rebind both probes to native archived inputs/results. */
export async function verifyNativeProof(
  proof: QualificationProof,
  command: Command,
): Promise<boolean> {
  try {
    const route = proof.scope.routes.find(
      (r) => proofKey(proof.scope, r) === proof.key,
    );
    if (!route) return false;
    for (const [phase, outcome] of [
      ["normal-probe", proof.normal],
      ["cancel-probe", proof.cancellation],
    ] as const) {
      const shown = await command(
        [
          "orchestration",
          "worker-show",
          "--dispatch",
          outcome.dispatchId,
          "--json",
        ],
        proof.scope.workspace,
        5000,
      );
      const d = shown.dispatch,
        worker = shown.worker,
        resource = shown.terminalResource;
      if (
        d?.id !== outcome.dispatchId ||
        worker?.worktreeId !== proof.scope.workspaceId ||
        resource?.originDispatchId !== outcome.dispatchId ||
        resource?.releaseState !== "released"
      )
        return false;
      if (phase === "normal-probe" && d.status !== "succeeded") return false;
      if (
        phase === "cancel-probe" &&
        (!["failed", "cancelled", "stopped"].includes(d.status) ||
          !String(d.terminationReason ?? "").includes("stop"))
      )
        return false;
      const launch = worker.startOptions?.launch;
      for (const exposed of [launch?.requested, launch?.effective])
        if (
          !exposed ||
          exposed.agent !== route.selection.route ||
          exposed.model !== route.selection.model ||
          (route.selection.effortEncoding === "model"
            ? exposed.effort != null
            : exposed.effort !== route.selection.effort)
        )
          return false;
      let cursor: string | undefined,
        sourceIdentity: string | undefined,
        packet: any;
      const assistant: any[] = [];
      for (let page = 0; page < 20; page++) {
        const read = await command(
          [
            "orchestration",
            "worker-read",
            "--dispatch",
            d.id,
            "--source",
            "transcript",
            "--limit",
            "200",
            ...(cursor ? ["--cursor", cursor] : []),
            "--json",
          ],
          proof.scope.workspace,
          5000,
        );
        if (
          read.dispatchId !== d.id ||
          read.source !== "transcript" ||
          read.provider !== route.selection.route ||
          typeof read.sourceIdentity !== "string" ||
          (sourceIdentity && sourceIdentity !== read.sourceIdentity) ||
          (read.warnings ?? []).some((w: unknown) =>
            /clipp|truncat/i.test(String(w)),
          )
        )
          return false;
        sourceIdentity = read.sourceIdentity;
        for (const m of read.transcript?.messages ?? [])
          for (const b of m.blocks ?? [])
            if (b.type === "text" && typeof b.text === "string") {
              if (m.role === "assistant") {
                try {
                  assistant.push(JSON.parse(b.text));
                } catch {}
              } else {
                const marker = "\nCOUNCIL_PACKET\n";
                const i = b.text.indexOf(marker);
                if (i >= 0) {
                  try {
                    packet = JSON.parse(b.text.slice(i + marker.length));
                  } catch {}
                }
              }
            }
        if (!read.transcript?.limited) break;
        if (
          typeof read.cursor !== "string" ||
          read.cursor === cursor ||
          page === 19
        )
          return false;
        cursor = read.cursor;
      }
      const instruction =
        phase === "normal-probe"
          ? "Reply with readiness only."
          : "Wait for cancellation.";
      const expected = canonicalJson({
        instruction,
        qualificationFingerprint: proof.key,
      });
      if (
        !packet ||
        packet.phase !== phase ||
        packet.role !== route.role ||
        packet.runId !== d.runId ||
        packet.packet !== expected ||
        canonicalJson(packet.selection) !== canonicalJson(route.selection)
      )
        return false;
      const packetHash = hashArtifact("pilot-packet", {
        runId: d.runId,
        role: route.role,
        phase,
        packet: expected,
        attemptKey: packet.attemptKey,
      });
      if (packet.packetHash !== packetHash) return false;
      if (
        phase === "normal-probe" &&
        !assistant.some(
          (v) =>
            v.packetHash === packetHash &&
            v.phase === phase &&
            v.role === route.role &&
            v.binding?.dispatchId === d.id &&
            v.binding?.taskId === d.taskId &&
            v.binding?.runId === d.runId &&
            v.binding?.attemptKey === packet.attemptKey &&
            v.payload?.ready === true &&
            canonicalJson(v.selection) === canonicalJson(route.selection),
        )
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
