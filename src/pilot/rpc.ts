import { createRequire } from "node:module";
import { realpathSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
/** Read-only subset of the official exported Orca 1.4.244 RuntimeClient. */
export type ReadMethod =
  | "settings.getAgentLaunch"
  | "agentSession.modelCatalog"
  | "agentSession.options"
  | "accounts.list"
  | "agentSession.createSupport";
export interface ReadRpc {
  call(method: ReadMethod, params: Record<string, unknown>): Promise<any>;
}
export interface OfficialClient {
  call(method: string, params: Record<string, unknown>): Promise<any>;
}
export class LocalReadRpc implements ReadRpc {
  private client: OfficialClient;
  constructor(
    private readonly runtimeId: string,
    executable = "/usr/local/bin/orca",
    client?: OfficialClient,
  ) {
    if (client) {
      this.client = client;
      return;
    }
    const real = realpathSync(executable);
    if (!real.endsWith("/Contents/Resources/bin/orca"))
      throw Error("ORCA_EXPORTED_CLIENT_INSTALLATION_UNSUPPORTED");
    const version = execFileSync(real, ["--version"], {
      encoding: "utf8", timeout: 5000, maxBuffer: 65536,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (version !== "1.4.244")
      throw Error("UNSUPPORTED_ORCA_API_VERSION: expected 1.4.244");
    const modulePath = resolve(
      dirname(real),
      "../app.asar.unpacked/out/cli/runtime-client.js",
    );
    if (!existsSync(modulePath))
      throw Error("ORCA_EXPORTED_CLIENT_UNAVAILABLE");
    const { RuntimeClient } = createRequire(import.meta.url)(modulePath);
    if (typeof RuntimeClient !== "function")
      throw Error("ORCA_EXPORTED_CLIENT_UNAVAILABLE");
    // The official client owns authentication, runtime-source fencing, framing and timeout.
    // Explicit null remote arguments retain the already-inspected local host.
    this.client = new RuntimeClient(undefined, 5000, null, null, executable);
  }
  async call(
    method: ReadMethod,
    params: Record<string, unknown>,
  ): Promise<any> {
    if (
      ![
        "settings.getAgentLaunch",
        "agentSession.modelCatalog",
        "agentSession.options",
        "accounts.list",
        "agentSession.createSupport",
      ].includes(method)
    )
      throw Error("READ_ONLY_RPC_METHOD_REQUIRED");
    const envelope = await this.client.call(method, params);
    if (envelope._meta?.runtimeId !== this.runtimeId)
      throw Error("RPC_READ_BINDING_MISMATCH");
    if (envelope.ok !== true)
      throw Error("RPC_READ_" + (envelope.error?.code ?? "FAILED"));
    return envelope.result;
  }
}
