import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  ActiveDeadline,
  ArtifactRef,
  AttemptBinding,
  JsonValue,
} from "../domain/contracts.js";
import { canonicalJson, hashArtifact } from "../domain/hash.js";
import {
  resourceProofSchema,
  type ResourceProof,
} from "../orca/observations.js";
import { inheritedEnvironment } from "../orca/client.js";
import type { ArtifactStore } from "../store/artifacts.js";
export interface WatchdogDescriptor {
  key: string;
  attemptId: string;
  deadlineMs: number;
  authority: "stop-only";
}
export function watchdogDescriptor(
  binding: AttemptBinding,
  workerDeadline: number,
  runDeadline: number,
): WatchdogDescriptor {
  if (
    ![workerDeadline, runDeadline].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error("INVALID_WATCHDOG_DEADLINE");
  const deadlineMs = Math.min(workerDeadline, runDeadline);
  return {
    key: hashArtifact("watchdog-resource", {
      attemptId: binding.attemptId,
      authority: binding.authority,
      deadlineMs,
    } as unknown as JsonValue),
    attemptId: binding.attemptId,
    deadlineMs,
    authority: "stop-only",
  };
}
export interface WatchdogArmingProof {
  kind: "watchdog-armed";
  key: string;
  intentHash: string;
  logicalTaskKey: string;
  attemptId: string;
  deadline: ActiveDeadline;
  resourceKey: string;
  pid: number;
  processStart: string;
  launchReceipt: ArtifactRef;
}
export interface WatchdogRegistration {
  descriptor: WatchdogDescriptor;
  directory: string;
  pid: number | null;
  proof: ArtifactRef | null;
  status: "armed" | "unverifiable";
}
// Static code only. Model text cannot enter this executable program or its argv.
export const watchdogProgram = String.raw`
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const dir=process.argv[1],request=JSON.parse(fs.readFileSync(path.join(dir,'request.json'),'utf8'));
const save=(name,value)=>{const file=path.join(dir,name);fs.writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(file+'.tmp',file);};
save('identity.json',{pid:process.pid,processStart:String(Date.now()-Math.floor(process.uptime()*1000)),resourceKey:request.descriptor.key});
const startedMonotonic=process.hrtime.bigint(),remainingMs=Math.max(0,request.descriptor.deadlineMs-Date.now());
let stopped=false,stopProcess=null,stopClosed=true;
const tick=()=>{
 let settled=false;try{const receipt=JSON.parse(fs.readFileSync(path.join(dir,'settled.json'),'utf8'));settled=receipt.attemptId===request.descriptor.attemptId&&receipt.resourceKey===request.descriptor.key&&receipt.settled===true&&Array.isArray(receipt.receiptRefs)&&receipt.receiptRefs.length>0;}catch{}
 if(settled&&stopClosed){save('exit.json',{resourceKey:request.descriptor.key,pid:process.pid,exitCode:0,stopClosed:true});process.exit(0);}
 if(!stopped&&(Date.now()>=request.descriptor.deadlineMs||Number(process.hrtime.bigint()-startedMonotonic)/1e6>=remainingMs)){stopped=true;stopClosed=false;save('stop-intent.json',{attemptId:request.descriptor.attemptId,deadlineMs:request.descriptor.deadlineMs});
  stopProcess=cp.spawn(request.executable,request.argv,{cwd:request.cwd,env:request.environment,shell:false,stdio:'ignore'});
  stopProcess.on('spawn',()=>save('stop-launch.json',{pid:stopProcess.pid,attemptId:request.descriptor.attemptId}));
  stopProcess.on('error',error=>{save('stop-error.json',{code:error.code||'UNKNOWN'});});
  stopProcess.on('close',(exitCode,signal)=>{stopClosed=true;save('stop-exit.json',{pid:stopProcess.pid,exitCode,signal});});
 }
};setInterval(tick,25);tick();`;
/** Synthetic-only durable watchdog. Registration is exclusive before spawn, so
 * uncertain starts reconcile the original resource and can never duplicate it.
 * Live arming remains unqualified until stop/group controls are proven. */
export async function armSyntheticWatchdog(input: {
  root: string;
  binding: AttemptBinding;
  deadline: ActiveDeadline;
  key: string;
  intentHash: string;
  executable: string;
  prefix?: readonly string[];
  cwd: string;
  artifacts: ArtifactStore;
}): Promise<WatchdogRegistration> {
  const descriptor = watchdogDescriptor(
    input.binding,
    input.deadline.wallMs,
    input.deadline.wallMs,
  );
  if (
    realpathSync(input.root) !== input.root ||
    realpathSync(input.cwd) !== input.cwd
  )
    throw new Error("NONCANONICAL_WATCHDOG_ROOT");
  const directory = join(input.root, descriptor.key),
    argv = [
      ...(input.prefix ?? []),
      "orchestration",
      "worker-stop",
      "--dispatch",
      input.binding.authority.kind === "supervised"
        ? input.binding.authority.dispatchId
        : "",
      "--json",
    ];
  if (
    input.binding.authority.kind !== "supervised" ||
    !argv.every((arg) => !arg.includes("\0"))
  )
    throw new Error("WATCHDOG_AUTHORITY_REQUIRED");
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (!existsSync(directory)) throw error;
    return reconcileWatchdog(directory, descriptor);
  }
  const request = {
    descriptor,
    executable: realpathSync(input.executable),
    argv,
    cwd: input.cwd,
    environment: inheritedEnvironment(process.env),
  };
  writeFileSync(join(directory, "request.json"), JSON.stringify(request), {
    flag: "wx",
    mode: 0o600,
  });
  const child = spawn(process.execPath, ["-e", watchdogProgram, directory], {
    cwd: input.cwd,
    env: inheritedEnvironment(process.env),
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {});
  child.unref();
  // Bounded handshake: an unknown start is retained rather than relaunched.
  for (
    let count = 0;
    count < 100 && !existsSync(join(directory, "identity.json"));
    count++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  if (!existsSync(join(directory, "identity.json")))
    return {
      descriptor,
      directory,
      pid: child.pid ?? null,
      proof: null,
      status: "unverifiable",
    };
  const identity = JSON.parse(
    readFileSync(join(directory, "identity.json"), "utf8"),
  ) as { pid: number; processStart: string; resourceKey: string };
  if (identity.pid !== child.pid || identity.resourceKey !== descriptor.key)
    throw new Error("WATCHDOG_IDENTITY_MISMATCH");
  const launchReceipt = input.artifacts.putArtifact(
    Buffer.from(JSON.stringify(identity)),
    "watchdog-launch",
  );
  const proof: WatchdogArmingProof = {
    kind: "watchdog-armed",
    key: input.key,
    intentHash: input.intentHash,
    logicalTaskKey: input.binding.logicalTaskKey,
    attemptId: input.binding.attemptId,
    deadline: input.deadline,
    resourceKey: descriptor.key,
    pid: identity.pid,
    processStart: identity.processStart,
    launchReceipt,
  };
  const ref = input.artifacts.putArtifact(
    Buffer.from(JSON.stringify(proof)),
    "watchdog-armed",
  );
  writeFileSync(join(directory, "arming.json"), JSON.stringify(ref), {
    flag: "wx",
    mode: 0o600,
  });
  return {
    descriptor,
    directory,
    pid: identity.pid,
    proof: ref,
    status: "armed",
  };
}
export function reconcileWatchdog(
  directory: string,
  descriptor: WatchdogDescriptor,
): WatchdogRegistration {
  try {
    const identity = JSON.parse(
      readFileSync(join(directory, "identity.json"), "utf8"),
    ) as { pid: number; resourceKey: string };
    if (identity.resourceKey !== descriptor.key)
      throw new Error("WATCHDOG_IDENTITY_MISMATCH");
    const proof = JSON.parse(
      readFileSync(join(directory, "arming.json"), "utf8"),
    ) as ArtifactRef;
    return { descriptor, directory, pid: identity.pid, proof, status: "armed" };
  } catch {
    return {
      descriptor,
      directory,
      pid: null,
      proof: null,
      status: "unverifiable",
    };
  }
}

/** The adapter must first prove worker/child exit. Watchdog exit is inspected
 * separately afterwards; this marker is never aggregate SETTLED authority. */
export function markSyntheticWatchdogSettled(
  registration: WatchdogRegistration,
  binding: AttemptBinding,
  input: ResourceProof,
): void {
  const parsed = resourceProofSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.attemptId !== binding.attemptId ||
    canonicalJson(parsed.data.authority) !== canonicalJson(binding.authority) ||
    !parsed.data.complete ||
    parsed.data.worker.status !== "exited" ||
    parsed.data.children.some((child) => child.status !== "exited") ||
    !parsed.data.receiptRefs.length ||
    registration.descriptor.attemptId !== binding.attemptId ||
    realpathSync(registration.directory) !== registration.directory
  )
    throw new Error("WORKER_RESOURCE_SETTLEMENT_REQUIRED");
  const file = join(registration.directory, "settled.json"),
    text = canonicalJson({
      attemptId: binding.attemptId,
      resourceKey: registration.descriptor.key,
      settled: true,
      receiptRefs: parsed.data.receiptRefs,
    });
  try {
    writeFileSync(file, text, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== text)
      throw new Error("WATCHDOG_SETTLEMENT_CONFLICT");
  }
}
