import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mutationRequestId } from "./mutation-id.js";
import { canonicalJson } from "../domain/hash.js";
import { readFailure } from "./allowance.js";
import type { Attempt, PilotDriver, PilotRequest, Phase } from "./types.js";
import type { Role } from "./config.js";

/** Exclusive write-ahead journal. Restart never silently retries a reserved native attempt. */
export class PilotJournal {
  readonly path: string;
  private readonly fd: number;
  constructor(workspace: string, id: string, bounds: unknown) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw Error("INVALID_NATIVE_RUN_ID");
    let root = realpathSync(workspace);
    for (const part of [".council", "native"]) {
      root = join(root, part);
      if (existsSync(root)) {
        if (lstatSync(root).isSymbolicLink() || realpathSync(root) !== root)
          throw Error("NATIVE_JOURNAL_SYMLINK");
      } else mkdirSync(root, { mode: 0o700 });
    }
    this.path = join(root, id);
    if (existsSync(this.path))
      throw Error(
        "NATIVE_RUN_EXISTS_INSPECT_REQUIRED: no automatic resume or duplicate calls",
      );
    mkdirSync(this.path, { mode: 0o700 });
    this.fd = openSync(
      join(this.path, "events.jsonl"),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    this.append({
      event: "bounds-recorded-before-inference",
      bounds,
      owned: [],
    });
  }
  append(event: unknown) {
    writeSync(this.fd, canonicalJson({ at: Date.now(), event }) + "\n");
    fsyncSync(this.fd);
  }
  close() {
    closeSync(this.fd);
  }
  wrap(driver: PilotDriver): PilotDriver {
    const owned = new Set<string>();
    const check = (a: Attempt) => {
      if (!owned.has(a.binding.dispatchId))
        throw Error("NATIVE_RESOURCE_NOT_JOURNAL_OWNED");
    };
    return {
      ...(driver.proof ? { proof: (a: Attempt) => { check(a); return driver.proof!(a); } } : {}),
      inspect: (r) => driver.inspect(r),
      begin: async (r) => {
        const mutationRequestId=randomUUID();
        this.append({ event: "run-reserved", mutationRequestId });
        let id:string;
        try { id = await driver.begin(r,mutationRequestId); }
        catch(error) {
          this.append({event:"run-creation-unknown",mutationRequestId,diagnostic:readFailure("native run-create",error)});
          throw Error(`NATIVE_RUN_CREATION_OUTCOME_UNKNOWN:${mutationRequestId}`,{cause:error});
        }
        this.append({ event: "native-run-bound", runId: id });
        return id;
      },
      launch: async (
        runId: string,
        r: PilotRequest,
        role: Role,
        phase: Phase,
        packet: string,
        key: string,
      ) => {
        this.append({
          event: "attempt-reserved",
          runId,
          role,
          phase,
          key,
          mutationRequestId: mutationRequestId(key),
        });
        let a:Attempt;
        try { a = await driver.launch(runId, r, role, phase, packet, key); }
        catch(error) {
          const beforeMutation = error instanceof Error && error.message === "NATIVE_PACKET_ARGUMENT_TOO_LARGE";
          this.append({event:beforeMutation ? "launch-rejected-before-mutation" : "launch-unknown",runId,role,phase,key,mutationRequestId:mutationRequestId(key)});
          throw error;
        }
        owned.add(a.binding.dispatchId);
        this.append({ event: "attempt-bound", attempt: a });
        return a;
      },
      observe: async (a, d) => {
        check(a);
        try {
          const result = await driver.observe(a, d);
          this.append({
            event: "result-bound",
            binding: a.binding,
            packetHash: result.packetHash,
            phase: result.phase,
            role: result.role,
            source: result.source,
          });
          return result;
        } catch (error) {
          this.append({ event: "observation-unknown", binding: a.binding });
          throw error;
        }
      },
      cancel: async (a, deadline, mode) => {
        check(a);
        this.append({ event: "cancel-reserved", binding: a.binding, mutationRequestId: mutationRequestId(`${a.context ? "wrapper-stop" : "stop"}:${canonicalJson(a.binding)}`) });
        const result = await driver.cancel(a, deadline, mode);
        this.append({ event: "cancel-observed", binding: a.binding, result });
        return result;
      },
      release: async (a, deadline) => {
        check(a);
        this.append({ event: "release-reserved", binding: a.binding });
        const released = await driver.release(a, deadline);
        this.append({
          event: "release-observed",
          binding: a.binding,
          released,
        });
        return released;
      },
    };
  }
}
