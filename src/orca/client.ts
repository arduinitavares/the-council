import { spawn } from "node:child_process";
import {
  accessSync,
  constants,
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import type { LaunchReservation } from "../domain/contracts.js";
import { canonicalJson } from "../domain/hash.js";
import { pathWithin } from "../policy/qualification.js";
import { decodeStrictJson } from "../workers/strict-json.js";

const inheritedKeys = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  "ORCA_CLI_COMMAND",
  "ORCA_SESSION_ID",
  "ORCA_SOCKET_PATH",
  "ORCA_TERMINAL_HANDLE",
  "ORCA_PANE_KEY",
  "ORCA_AGENT_SESSION_ID",
  "ORCA_AGENT_SESSION_SPAWN_TOKEN",
]);
export function inheritedEnvironment(
  input: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => inheritedKeys.has(key) && value !== undefined,
    ),
  );
}
export interface ProcessReceipt {
  stdout: Uint8Array;
  stderr: Uint8Array;
  exitCode: number | null;
  signal: string | null;
  overflow: boolean;
  timedOut: boolean;
  pid: number | null;
  closed: boolean;
}
export interface CommandOptions {
  cwd: string;
  timeoutMs: number;
  maxBytes?: number;
}
export interface ClientOptions {
  executable: string;
  prefix?: readonly string[];
  cwd: string;
  environment?: NodeJS.ProcessEnv;
}
export interface OrcaGuide {
  version: string;
  cli: unknown;
  orchestration: unknown;
}
function canonicalDirectory(path: string): string {
  if (
    !isAbsolute(path) ||
    realpathSync(path) !== path ||
    !statSync(path).isDirectory()
  )
    throw new Error("NONCANONICAL_CWD");
  return path;
}
export class OrcaClient {
  readonly executable: string;
  readonly prefix: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  guide!: OrcaGuide;
  private constructor(options: ClientOptions) {
    if (!isAbsolute(options.executable))
      throw new Error("ABSOLUTE_EXECUTABLE_REQUIRED");
    this.executable = realpathSync(options.executable);
    this.prefix = [...(options.prefix ?? [])];
    canonicalDirectory(options.cwd);
    this.environment = inheritedEnvironment(options.environment ?? process.env);
  }
  static async connect(options: ClientOptions): Promise<OrcaClient> {
    const client = new OrcaClient(options),
      run = async (argv: string[]) => {
        const result = await client.run(argv, {
          cwd: options.cwd,
          timeoutMs: 5000,
        });
        if (
          result.exitCode !== 0 ||
          result.timedOut ||
          result.overflow ||
          !result.closed
        )
          throw new Error("ORCA_GUIDE_UNAVAILABLE");
        return new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
      };
    const version = (await run(["--version"])).trim();
    if (!version) throw new Error("ORCA_VERSION_UNKNOWN");
    const cli = decodeStrictJson(
      await run(["skills", "get", "orca-cli", "--json"]),
    );
    const orchestration = decodeStrictJson(
      await run(["skills", "get", "orchestration", "--json"]),
    );
    client.guide = { version, cli, orchestration };
    return client;
  }
  async run(
    argv: readonly string[],
    options: CommandOptions,
  ): Promise<ProcessReceipt> {
    canonicalDirectory(options.cwd);
    if (
      ![...this.prefix, ...argv].every(
        (arg) => typeof arg === "string" && !arg.includes("\0"),
      )
    )
      throw new Error("INVALID_ARGV");
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
      throw new Error("INVALID_COMMAND_TIMEOUT");
    const max = options.maxBytes ?? 1024 * 1024;
    if (!Number.isSafeInteger(max) || max < 1)
      throw new Error("INVALID_OUTPUT_LIMIT");
    return new Promise((resolve) => {
      const child = spawn(this.executable, [...this.prefix, ...argv], {
        cwd: options.cwd,
        env: this.environment,
        shell: false,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [],
        stderr: Buffer[] = [];
      let size = 0,
        errorSize = 0,
        overflow = false,
        timedOut = false,
        exitCode: number | null = null,
        signal: string | null = null,
        done = false;
      const finish = (closed: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(grace);
        resolve({
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
          exitCode,
          signal,
          overflow,
          timedOut,
          pid: child.pid ?? null,
          closed,
        });
      };
      const terminate = () => {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            /* exit is still unknown until observed */
          }
        }
      };
      let grace: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        terminate();
        grace = setTimeout(() => {
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              /* preserve unknown */
            }
          }
          child.stdout.destroy();
          child.stderr.destroy();
          finish(false);
        }, 100);
      }, options.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        const room = Math.max(0, max - size);
        if (room) stdout.push(chunk.subarray(0, room));
        size += chunk.length;
        if (size > max) {
          overflow = true;
          terminate();
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const room = Math.max(0, max - errorSize);
        if (room) stderr.push(chunk.subarray(0, room));
        errorSize += chunk.length;
        if (errorSize > max) {
          overflow = true;
          terminate();
        }
      });
      child.on("exit", (code, sig) => {
        exitCode = code;
        signal = sig;
      });
      child.on("error", () => finish(false));
      child.on("close", () => finish(true));
    });
  }
}

const workerOwner = (r: LaunchReservation) => ({
  runId: r.bindings.runId,
  logicalTaskKey: r.logicalTaskKey,
  clientAttemptKey: r.clientAttemptKey,
});
export function createPrivateWorkerCwd(reservation: LaunchReservation): string {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "council-worker-")));
  chmodSync(cwd, 0o700);
  writeFileSync(
    join(cwd, ".worker-owner.json"),
    canonicalJson(workerOwner(reservation)),
    { flag: "wx", mode: 0o600 },
  );
  return cwd;
}
export function validatePrivateWorkerCwd(
  cwd: string,
  reservation: LaunchReservation,
): void {
  try {
    const stat = lstatSync(cwd),
      marker = join(cwd, ".worker-owner.json");
    if (
      realpathSync(cwd) !== cwd ||
      !pathWithin(cwd, realpathSync(tmpdir())) ||
      !stat.isDirectory() ||
      stat.mode & 0o077 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
      lstatSync(marker).isSymbolicLink() ||
      canonicalJson(decodeStrictJson(readFileSync(marker, "utf8"))) !==
        canonicalJson(workerOwner(reservation))
    )
      throw new Error();
  } catch {
    throw new Error("WORKER_CWD_NOT_OWNED");
  }
}

/** Resolve exactly one entry. A selected path failure never switches builds. */
export function resolveOrcaExecutable(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const selected =
    environment.ORCA_CLI_COMMAND ||
    (environment.ORCA_DEV_REPO_ROOT
      ? "orca-dev"
      : platform === "linux" && !environment.ORCA_SESSION_ID
        ? "orca-ide"
        : "orca");
  const candidates = isAbsolute(selected)
    ? [selected]
    : (environment.PATH ?? "")
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => join(directory, selected));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return realpathSync(candidate);
    } catch {
      /* PATH discovery only, no alternative command */
    }
  }
  throw new Error("ORCA_EXECUTABLE_UNAVAILABLE");
}
