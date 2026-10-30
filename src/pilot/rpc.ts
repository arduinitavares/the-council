import { createRequire } from "node:module";
import { realpathSync, existsSync, readFileSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
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
  effortSupport?(agent: string): Promise<{efforts:string[];source:string;detail:string}>;
}
export interface OfficialClient {
  call(method: string, params: Record<string, unknown>, options?: { timeoutMs: number }): Promise<any>;
}
export type ScopedMethod="agent.launch"|"terminal.show"|"terminal.inspectProcess"|"terminal.close";
export interface ScopedRpc {callScoped(method:ScopedMethod,params:Record<string,unknown>):Promise<any>;}
export class LocalReadRpc implements ReadRpc {
  protected client: OfficialClient;
  private readonly executable: string;
  constructor(
    protected readonly runtimeId: string,
    executable = "/usr/local/bin/orca",
    client?: OfficialClient,
  ) {
    this.executable = executable;
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
    if(realpathSync(modulePath)!==modulePath||lstatSync(modulePath).isSymbolicLink())
      throw Error("ORCA_EXPORTED_CLIENT_PATH_UNVERIFIED");
    const { RuntimeClient } = createRequire(import.meta.url)(modulePath);
    if (typeof RuntimeClient !== "function")
      throw Error("ORCA_EXPORTED_CLIENT_UNAVAILABLE");
    // The official client owns authentication, runtime-source fencing, framing and timeout.
    // Explicit null remote arguments retain the already-inspected local host.
    this.client = new RuntimeClient(undefined, 5000, null, null, executable);
  }
  async effortSupport(agent: string): Promise<{efforts:string[];source:string;detail:string}> {
    const missing = {efforts:[],source:"installed Orca explicit launch-option contract",detail:"Explicit effort mapping unavailable"};
    if (agent !== "antigravity") return missing;
    try {
      const real = realpathSync(this.executable);
      if (!real.endsWith("/Contents/Resources/bin/orca")) return missing;
      const modulePath = resolve(dirname(real), "../app.asar.unpacked/out/shared/agent-session-option-catalog-antigravity.js");
      // Read supported contract source as data; never import private app modules.
      if (realpathSync(modulePath) !== modulePath || lstatSync(modulePath).isSymbolicLink()) return missing;
      const bytes = readFileSync(modulePath);
      if (bytes.length > 65536) return missing;
      const source = bytes.toString("utf8");
      const block = source.split("const ANTIGRAVITY_EFFORT =")[1]?.split("exports.ANTIGRAVITY_SESSION_OPTION_CATALOG")[0];
      if (!block || !/launchArgs:\s*\(value\)\s*=>\s*\['--effort',\s*String\(value\)\]/.test(block) ||
          !/supportsWorkerLaunchPreferences:\s*true/.test(source) ||
          !/unknownModelOptions:\s*\[ANTIGRAVITY_EFFORT\]/.test(source)) return missing;
      const choices = block.match(/choices:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
      const efforts = [...choices.matchAll(/value:\s*'([^']+)'/g)].map(match => match[1]!);
      if (!efforts.length || efforts.some(e => !["low","medium","high"].includes(e))) return missing;
      return {efforts,source:`Orca 1.4.244 shared/agent-session-option-catalog-antigravity.js sha256=${createHash("sha256").update(bytes).digest("hex")}`,
        detail:"Explicit unknownModelOptions effort choices map to --effort value; independent of the model ID suffix"};
    } catch { return missing; }
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
    return this.callNative(method,params);
  }
  protected async callNative(method:string,params:Record<string,unknown>):Promise<any>{
    // The inspected official call(method, params, options) supports a per-read
    // timeout. Usage refresh may perform network reads; other reads retain 5s.
    const envelope = await this.client.call(method, params,
      method === "accounts.list" && params.refreshUsage === true ? { timeoutMs: 30000 } : undefined);
    if (envelope._meta?.runtimeId !== this.runtimeId)
      throw Error("RPC_READ_BINDING_MISMATCH");
    if (envelope.ok !== true)
      throw Error("RPC_READ_" + (envelope.error?.code ?? "FAILED"));
    return envelope.result;
  }
}
/** Separate scoped mutation port; the read-only discovery API never admits these
 * methods. No settings, trust, billing or permission mutation is exposed. */
export class LocalScopedRpc extends LocalReadRpc implements ScopedRpc {
  async callScoped(method:ScopedMethod,params:Record<string,unknown>):Promise<any>{
    if(!["agent.launch","terminal.show","terminal.inspectProcess","terminal.close"].includes(method))throw Error("SCOPED_RPC_METHOD_REQUIRED");
    return this.callNative(method,params);
  }
}
