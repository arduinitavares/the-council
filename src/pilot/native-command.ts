import { OrcaClient } from "../orca/client.js";
import { decodeStrictJson } from "../workers/strict-json.js";
import type { Command } from "./orca-driver.js";
/** The official CLI/client owns transport credentials and native caller fencing. */
export async function nativeCommand(executable: string, cwd: string, runtimeId?: string): Promise<Command> {
  const client = await OrcaClient.connect({ executable, cwd });
  return commandFromClient(client, runtimeId);
}
export function commandFromClient(client: Pick<OrcaClient, "run">, runtimeId?: string): Command {
  let bound = runtimeId;
  return async (argv, directory, timeoutMs) => {
    const result = await client.run(argv, { cwd: directory, timeoutMs });
    if (result.timedOut || result.overflow || !result.closed) {
      const code = result.timedOut ? "runtime_timeout" : "invalid_runtime_response";
      throw Object.assign(Error(`ORCA_${code}`), { code });
    }
    let envelope: any;
    try { envelope = decodeStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(result.stdout)); }
    catch { throw Object.assign(Error("ORCA_INVALID_ENVELOPE"), { code: "invalid_runtime_response" }); }
    if (envelope?._meta?.runtimeId && bound && envelope._meta.runtimeId !== bound) throw Error("ORCA_RUNTIME_BINDING_MISMATCH");
    if (result.exitCode !== 0 || envelope?.ok === false) {
      const exposed = envelope?.error?.code;
      const code = typeof exposed === "string" && /^(permission_denied|unauthorized|forbidden|runtime_timeout|runtime_unavailable|invalid_runtime_response|unsupported|method_not_found|operation_unknown|stable_pane_required|run_required|terminal_handle_stale|incompatible_runtime|quota_exceeded)$/.test(exposed) ? exposed : "invalid_runtime_response";
      throw Object.assign(Error(`ORCA_${code}`), { code });
    }
    if (result.stderr.length) throw Object.assign(Error("ORCA_CLI_DIAGNOSTICS_PRESENT"), { code: "invalid_runtime_response" });
    if (argv[0] === "agent-context") {
      if (envelope?.schemaVersion !== 1 || !Number.isSafeInteger(envelope.commandCount) || !Array.isArray(envelope.commands) || envelope.commandCount !== envelope.commands.length || !envelope.commands.every((e: any) => typeof e?.command === "string")) throw Error("ORCA_COMMAND_REGISTRY_INVALID");
      return envelope;
    }
    if (envelope?.ok !== true || typeof envelope._meta?.runtimeId !== "string")
      throw Object.assign(Error(`ORCA_${envelope?.error?.code ?? "INVALID_ENVELOPE"}`), { code: envelope?.error?.code });
    bound ??= envelope._meta.runtimeId;
    if (envelope._meta.runtimeId !== bound) throw Error("ORCA_RUNTIME_BINDING_MISMATCH");
    return envelope.result;
  };
}
