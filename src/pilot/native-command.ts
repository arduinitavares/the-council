import { OrcaClient } from "../orca/client.js";
import { decodeStrictJson } from "../workers/strict-json.js";
import { diagnosticError } from "./diagnostics.js";
import { nativeDiagnosticError } from "./allowance.js";
import type { Command } from "./orca-driver.js";
/** The official CLI/client owns transport credentials and native caller fencing. */
export async function nativeCommand(executable: string, cwd: string, runtimeId?: string): Promise<Command> {
  const client = await OrcaClient.connect({ executable, cwd });
  return commandFromClient(client, runtimeId);
}
export function commandFromClient(client: Pick<OrcaClient, "run">, runtimeId?: string): Command {
  let bound = runtimeId;
  return async (argv, directory, timeoutMs) => {
    try {
      const result = await client.run(argv, { cwd: directory, timeoutMs });
      if (result.timedOut || result.overflow || !result.closed) {
        throw Error(result.timedOut ? "runtime_timeout" : "invalid_runtime_response");
      }
      let envelope: any;
      try { envelope = decodeStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(result.stdout)); }
      catch { throw Object.assign(Error("ORCA_INVALID_ENVELOPE"), { code: "invalid_runtime_response" }); }
      if (envelope?._meta?.runtimeId && bound && envelope._meta.runtimeId !== bound) throw Error("ORCA_RUNTIME_BINDING_MISMATCH");
      if (result.exitCode !== 0 || envelope?.ok === false) {
        throw diagnosticError({ code: envelope?.error?.code }, { origin: "native-driver", phase: "native-read" });
      }
      if (result.stderr.length) throw Object.assign(Error("ORCA_CLI_DIAGNOSTICS_PRESENT"), { code: "invalid_runtime_response" });
      if (argv[0] === "agent-context") {
        if (envelope?.schemaVersion !== 1 || !Number.isSafeInteger(envelope.commandCount) || !Array.isArray(envelope.commands) || envelope.commandCount !== envelope.commands.length || !envelope.commands.every((e: any) => typeof e?.command === "string")) throw Error("ORCA_COMMAND_REGISTRY_INVALID");
        return envelope;
      }
      if (envelope?.ok !== true || typeof envelope._meta?.runtimeId !== "string")
        throw Object.assign(Error("ORCA_INVALID_ENVELOPE"), { code: envelope?.error?.code ?? "invalid_runtime_response" });
      bound ??= envelope._meta.runtimeId;
      if (envelope._meta.runtimeId !== bound) throw Error("ORCA_RUNTIME_BINDING_MISMATCH");
      return envelope.result;
    } catch (error) {
      throw nativeDiagnosticError(error);
    }
  };
}
