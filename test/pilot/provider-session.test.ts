import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { codexKernel } from "../../src/pilot/codex-controls.js";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { incidentRoster } from "./fixtures.js";
import { contextFixture } from "./context-fixture.js";
import { runProviderSession } from "../../src/pilot/provider-session.js";
import { sha256 } from "../../src/pilot/wrapper-contract.js";
import type { WrapperAssignment } from "../../src/pilot/wrapper-contract.js";

for (const behavior of ["normal", "normal-judge", "normal-instructions", "duplicate-instructions", "object-instructions", "missing-instructions", "drift-instructions", "higher-hook", "typed-model", "typed-effort", "missing-layers", "managed-hooks", "managed-permissions", "wrong-profile", "wrong-provider", "missing-provider", "wrong-thread-provider", "missing-thread-provider", "typed-provider", "provider-endpoint", "selected-profile", "managed-instructions", "managed-provider", "managed-unknown", "wrong-instructions"] as const) {
  it(`checks schema-shaped Codex pre-input controls with ${behavior} and settles the owned process`, async () => {
    const h=await contextFixture(behavior);
    try {
      const directory=join(h.root,"session");mkdirSync(directory);
      const role=behavior==="normal-judge"?"judge":"openai";
      const recipe=h.evidence.routes.find(r=>r.role===role)!.recipe!;
      if(["normal-instructions","duplicate-instructions","object-instructions","missing-instructions","drift-instructions"].includes(behavior)) {
        mkdirSync(recipe.cwd,{recursive:true});const instruction=join(recipe.cwd,"AGENTS.md");writeFileSync(instruction,"source-bound instruction fixture");
        const digest=sha256(readFileSync(instruction));recipe.instructionSources=[{path:instruction,sha256:digest}];recipe.sources=[{path:instruction,kind:"file",sha256:digest}];
      }
      const trace=join(h.root,"requests.txt");writeFileSync(trace,"");recipe.argv[4]=trace;
      const assignmentHash="assignment-hash";
      writeFileSync(join(directory,"input.json"),JSON.stringify({assignmentHash,requestId:"request"}));
      const assignment: WrapperAssignment={version:1,runtimeId:"synthetic-runtime",workspace:h.workspace,workspaceId:"synthetic-repo::B",directory,
        identity:{handle:"fixture",worktreeId:"synthetic-repo::B",ptyId:"fixture-pty",incarnationId:"fixture-incarnation",paneKey:"fixture:pane"},
        binding:{runId:"fixture-run",taskId:"fixture-task",dispatchId:"fixture-dispatch",handle:"fixture",attemptKey:"fixture-attempt"},
        dispatchIncarnation:"fixture-incarnation",producerHash:"fixture-producer",phase:"normal-probe",role,selection:recipe.selection,
        packetHash:"packet-hash",packet:"immutable fixture",controlsHash:"fixture-controls",policyHash:"fixture-policy",deadline:Date.now()+10000,orca:h.orca,recipe};
      const result=await runProviderSession(assignment,assignmentHash);
      const requests=readFileSync(trace,"utf8").trim().split("\n");
      expect(result.process.closed).toBe(true);expect(result.process.groupSettled).toBe(true);expect(result.process.trackedDescendantsSettled).toBe(true);
      expect(result.process.timersSettled).toBe(true);
      if(behavior==="normal"||behavior==="normal-judge"||behavior==="normal-instructions") {
        expect(result.init.modelProvider).toBe("openai");
        expect(result.error).toBeNull();expect(result.status).toBe("completed");expect(result.calls).toBe(1);
        if(behavior==="normal-instructions")expect(result.init.instructionSources).toEqual([join(recipe.cwd,"AGENTS.md")]);
        expect(requests).toEqual(["initialize","initialized","config/read","includeLayers:true","configRequirements/read","permissionProfile/list","thread/start","turn/start"]);
      } else {
        expect(result.status).toBe("failed");expect(result.calls).toBe(0);expect(result.process.inputDelivered).toBe(false);
        expect(requests).not.toContain("turn/start");
        if(!["wrong-profile","wrong-provider","missing-provider","wrong-thread-provider","missing-thread-provider"].includes(behavior)&&!["duplicate-instructions","object-instructions","missing-instructions","drift-instructions","wrong-instructions"].includes(behavior))expect(requests).not.toContain("thread/start");
        expect(result.error).toMatch(/CODEX_(EFFECTIVE_CONFIG_UNVERIFIED|REQUIREMENTS_DENIED|THREAD_SELECTION_UNVERIFIED)/);
      }
    } finally {await h.close();}
  },15000);
}

for (const role of ["openai", "judge"] as const) it(`withholds all ${role} model input during startup-only cancellation with inherited MCP/plugins`, async()=>{
  const h=await contextFixture("configured-startup");let timer:ReturnType<typeof setInterval>|undefined;
  try {
    const directory=join(h.root,"startup-only");mkdirSync(directory);
    const recipe=h.evidence.routes.find(r=>r.role===role)!.recipe!;
    const trace=join(h.root,"requests.txt");writeFileSync(trace,"");recipe.argv[4]=trace;
    const binding={runId:"fixture-run",taskId:"fixture-task",dispatchId:"fixture-dispatch",handle:"fixture",attemptKey:"fixture-attempt"};
    const assignment:WrapperAssignment={version:1,runtimeId:"synthetic-runtime",workspace:h.workspace,workspaceId:"synthetic-repo::B",directory,
      identity:{handle:"fixture",worktreeId:"synthetic-repo::B",ptyId:"fixture-pty",incarnationId:"fixture-incarnation",paneKey:"fixture:pane"},binding,
      dispatchIncarnation:"fixture-incarnation",producerHash:"fixture-producer",phase:"cancel-probe",role,selection:recipe.selection,
      packetHash:sha256(""),packet:"",controlsHash:"fixture-controls",policyHash:"fixture-policy",deadline:Date.now()+10000,orca:h.orca,recipe};
    timer=setInterval(()=>{
      const prepared=join(directory,"prepared.json");
      if(existsSync(prepared)&&JSON.parse(readFileSync(prepared,"utf8")).ready&&!existsSync(join(directory,"cancel.json")))
        writeFileSync(join(directory,"cancel.json"),JSON.stringify({binding,deadline:Date.now()+5000}));
    },10);
    const result=await runProviderSession(assignment,"assignment-hash");
    expect(JSON.parse(readFileSync(join(directory,"prepared.json"),"utf8")).ready).toBe(true);
    expect(result.status).toBe("failed");expect(result.error).toBe("PROVIDER_INITIALIZATION_CANCELLED");
    expect(result.calls).toBe(0);expect(result.process.inputDelivered).toBe(false);
    expect(result.process.closed&&result.process.groupSettled&&result.process.trackedDescendantsSettled&&result.process.timersSettled).toBe(true);
    expect(existsSync(join(directory,"input.json"))).toBe(false);expect(existsSync(join(directory,"inference-started.json"))).toBe(false);
    expect(readFileSync(trace,"utf8")).not.toContain("turn/start");
  } finally {if(timer)clearInterval(timer);await h.close();}
},15000);

it.each([true,false,undefined])("stand-in exposes layers only for includeLayers=true (requested %s)",includeLayers=>{
  const kernel=codexKernel([],process.cwd(),"gpt-6.1-sol","max");
  const result=spawnSync(process.execPath,[resolve("test/pilot/fixtures/context-provider.cjs"),"codex-app-server","gpt-6.1-sol","normal","",...kernel.argv],
    {cwd:process.cwd(),encoding:"utf8",input:JSON.stringify({id:2,method:"config/read",params:{includeLayers}})+"\n",timeout:5000});
  expect(result.status).toBe(0);expect(result.stderr).toBe("");
  const response=JSON.parse(result.stdout.trim());
  expect(Array.isArray(response.result.layers)).toBe(includeLayers===true);
});

const disabledRemoteControl = {
  method: "remoteControl/status/changed",
  params: { installationId: "synthetic-installation", serverName: "synthetic-server", status: "disabled", environmentId: null },
};

async function notificationSession(role: "openai" | "judge", notifications: Record<string, unknown>, withInput: boolean | "after-ready-event" = false) {
  const h = await contextFixture(`codex-notification:${JSON.stringify(notifications)}`);
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const directory = join(h.root, "notification-session"); mkdirSync(directory);
    const recipe = h.evidence.routes.find(route => route.role === role)!.recipe!;
    const trace = join(h.root, "requests.txt"); writeFileSync(trace, ""); recipe.argv[4] = trace;
    const packet = notifications.inflightEvents || notifications.inflightThreadStarted ? "x".repeat(1024*1024) : "";
    const binding = { runId: "fixture-run", taskId: "fixture-task", dispatchId: "fixture-dispatch", handle: "fixture", attemptKey: "fixture-attempt" };
    const assignment: WrapperAssignment = {
      version: 1, runtimeId: "synthetic-runtime", workspace: h.workspace, workspaceId: "synthetic-repo::B", directory,
      identity: { handle: "fixture", worktreeId: "synthetic-repo::B", ptyId: "fixture-pty", incarnationId: "fixture-incarnation", paneKey: "fixture:pane" }, binding,
      dispatchIncarnation: "fixture-incarnation", producerHash: "fixture-producer", phase: "normal-probe", role, selection: recipe.selection,
      packetHash: sha256(packet), packet, controlsHash: "fixture-controls", policyHash: "fixture-policy", deadline: Date.now()+10000, orca: h.orca, recipe,
    };
    const assignmentHash = sha256(JSON.stringify(assignment));
    if (withInput === true) writeFileSync(join(directory, "input.json"), JSON.stringify({ assignmentHash, requestId: "request" }));
    else timer = setInterval(() => {
      const prepared = join(directory, "prepared.json");
      if (withInput === "after-ready-event") {
        if (readFileSync(trace, "utf8").includes("after-ready-event") && !existsSync(join(directory, "input.json")))
          writeFileSync(join(directory, "input.json"), JSON.stringify({ assignmentHash, requestId: "request" }));
        return;
      }
      if (existsSync(prepared) && JSON.parse(readFileSync(prepared, "utf8")).ready && !existsSync(join(directory, "cancel.json")))
        writeFileSync(join(directory, "cancel.json"), JSON.stringify({ binding, deadline: Date.now()+5000 }));
    }, 10);
    const result = await runProviderSession(assignment, assignmentHash);
    expect(result.process).toMatchObject({ closed: true, groupSettled: true, trackedDescendantsSettled: true, timersSettled: true });
    return {
      result, assignmentHash, selection: recipe.selection, cwd: recipe.cwd,
      prepared: JSON.parse(readFileSync(join(directory, "prepared.json"), "utf8")),
      requests: readFileSync(trace, "utf8").trim().split("\n"),
      inputExists: existsSync(join(directory, "input.json")), inferenceExists: existsSync(join(directory, "inference-started.json")),
    };
  } finally { if (timer) clearInterval(timer); await h.close(); }
}

function expectStartupReady(session: Awaited<ReturnType<typeof notificationSession>>) {
  expect(session.result).toMatchObject({ status: "failed", error: "PROVIDER_INITIALIZATION_CANCELLED", calls: 0, process: { inputDelivered: false } });
  expect(session.prepared).toMatchObject({
    assignmentHash: session.assignmentHash, ready: true, initializations: 1,
    init: { model: session.selection.model, modelProvider: "openai", reasoningEffort: "max", cwd: session.cwd, activePermissionProfile: { id: "council_packet", extends: null }, instructionSources: [] },
  });
  expect(session.requests).toEqual(["initialize", "initialized", "config/read", "includeLayers:true", "configRequirements/read", "permissionProfile/list", "thread/start"]);
  expect(session.inputExists || session.inferenceExists).toBe(false);
}

for (const role of ["openai", "judge"] as const) it(`admits disabled remote-control startup metadata for ${role} before input`, async () => {
  expectStartupReady(await notificationSession(role, { startupEvents: [disabledRemoteControl] }));
}, 15000);

for (const role of ["openai", "judge"] as const) it(`admits the bound initial thread/started notification for ${role} before input`, async () => {
  expectStartupReady(await notificationSession(role, { threadStarted: true }));
}, 15000);

it.each([
  ["omitted environment", { installationId: "synthetic-installation", serverName: "synthetic-server", status: "disabled" }],
  ["string environment", { ...disabledRemoteControl.params, environmentId: "synthetic-environment" }],
  ["schema-valid empty identities", { installationId: "", serverName: "", status: "disabled", environmentId: "" }],
])("admits disabled remote-control metadata with %s and the initial thread notification", async (_label, params) => {
  expectStartupReady(await notificationSession("openai", { startupEvents: [{ method: disabledRemoteControl.method, params }], threadStarted: true }));
}, 15000);

const rejectedRemoteEvents: [string, unknown][] = [
  ...["connecting", "connected", "errored", "future-status", "DISABLED", null, false, 0, {}].map(status =>
    [`status ${JSON.stringify(status)}`, { ...disabledRemoteControl, params: { ...disabledRemoteControl.params, status } }] as [string, unknown]),
  ...["status", "installationId", "serverName"].map(field =>
    [`missing ${field}`, { ...disabledRemoteControl, params: Object.fromEntries(Object.entries(disabledRemoteControl.params).filter(([key]) => key !== field)) }] as [string, unknown]),
  ...["installationId", "serverName"].flatMap(field => [null, false, 7, [], {}].map(value =>
    [`wrong ${field} ${JSON.stringify(value)}`, { ...disabledRemoteControl, params: { ...disabledRemoteControl.params, [field]: value } }] as [string, unknown])),
  ...[false, 7, [], {}].map(environmentId =>
    [`wrong environment ${JSON.stringify(environmentId)}`, { ...disabledRemoteControl, params: { ...disabledRemoteControl.params, environmentId } }] as [string, unknown]),
  ...[null, [], "disabled", false, 7].map(params => [`malformed params ${JSON.stringify(params)}`, { ...disabledRemoteControl, params }] as [string, unknown]),
  ["missing params", { method: disabledRemoteControl.method }],
  ...[1, 2, 3, 4, 5, 6, "request", null, false].map(id => [`request id ${JSON.stringify(id)}`, { ...disabledRemoteControl, id }] as [string, unknown]),
  ["reply field", { ...disabledRemoteControl, result: null }],
  ["error field", { ...disabledRemoteControl, error: null }],
  ["unrelated notification", { ...disabledRemoteControl, method: "remoteControl/status/read" }],
  ["unknown notification", { method: "unrelated/startup", params: {} }],
];

it.each(rejectedRemoteEvents)("stops remote-control startup with %s before input", async (_label, event) => {
  const session = await notificationSession("openai", { startupEvents: [event] }, true);
  expect(session.result).toMatchObject({ status: "failed", error: "PROVIDER_STREAM_EVENT_UNSUPPORTED", calls: 0, process: { inputDelivered: false } });
  expect(session.prepared).toMatchObject({ assignmentHash: session.assignmentHash, ready: false });
  expect(session.requests).not.toContain("thread/start");
  expect(session.requests).not.toContain("turn/start");
  expect(session.inferenceExists).toBe(false);
}, 15000);

it("does not let disabled remote-control metadata authorize a subsequent active status", async () => {
  const session = await notificationSession("judge", { startupEvents: [disabledRemoteControl, { ...disabledRemoteControl, params: { ...disabledRemoteControl.params, status: "connected" } }] }, true);
  expect(session.result).toMatchObject({ status: "failed", error: "PROVIDER_STREAM_EVENT_UNSUPPORTED", calls: 0, process: { inputDelivered: false } });
  expect(session.prepared.ready).toBe(false);
  expect(session.inferenceExists).toBe(false);
}, 15000);

const rejectedThreadNotifications: [string, Record<string, unknown>][] = [
  ["before its response", { threadStartedBeforeResponse: true }],
  ["duplicate initial notification", { threadStarted: true, repeatThreadStarted: true }],
  ["foreign id", { threadStarted: true, threadPatch: { id: "foreign-thread" } }],
  ["foreign cwd", { threadStarted: true, threadPatch: { cwd: "/foreign" } }],
  ["foreign provider", { threadStarted: true, threadPatch: { modelProvider: "foreign" } }],
  ["foreign session", { threadStarted: true, threadPatch: { sessionId: "foreign-session" } }],
  ["changed snapshot", { threadStarted: true, threadPatch: { updatedAt: 1 } }],
  ["malformed timestamp", { threadStarted: true, threadPatch: { createdAt: "0" } }],
  ["non-ephemeral thread", { threadStarted: true, threadPatch: { ephemeral: false } }],
  ["active thread", { threadStarted: true, threadPatch: { status: { type: "active", activeFlags: [] } } }],
  ["nonempty turns", { threadStarted: true, threadPatch: { turns: [{}] } }],
  ["missing thread fields", { threadStarted: { params: { thread: { id: "synthetic-session" } } } }],
  ["null thread", { threadStarted: { params: { thread: null } } }],
  ["array thread", { threadStarted: { params: { thread: [] } } }],
  ["null params", { threadStarted: { params: null } }],
  ["legacy threadId shape", { threadStarted: { params: { threadId: "synthetic-session" } } }],
  ...[1, 2, 3, 4, 5, 6, "request", null].map(id => [`request id ${JSON.stringify(id)}`, { threadStarted: { id } }] as [string, Record<string, unknown>]),
  ["reply field", { threadStarted: { result: null } }],
  ["error field", { threadStarted: { error: null } }],
];

it.each(rejectedThreadNotifications)("stops initial thread/started with %s before input", async (_label, notifications) => {
  const session = await notificationSession("openai", notifications, true);
  expect(session.result).toMatchObject({ status: "failed", error: "PROVIDER_STREAM_EVENT_UNSUPPORTED", calls: 0, process: { inputDelivered: false } });
  expect(session.prepared).toMatchObject({ assignmentHash: session.assignmentHash, ready: false });
  expect(session.requests).not.toContain("turn/start");
  expect(session.inferenceExists).toBe(false);
}, 15000);

for (const role of ["openai", "judge"] as const) it.each([
  ["disabled remote-control", { inputEvents: [disabledRemoteControl] }],
  ["schema-shaped thread/started", { inputThreadStarted: true }],
])(`retains post-input rejection of %s for ${role}`, async (_label, notifications) => {
  const session = await notificationSession(role, notifications as Record<string, unknown>, true);
  expect(session.prepared).toMatchObject({ assignmentHash: session.assignmentHash, ready: true });
  expect(session.result).toMatchObject({ status: "failed", error: "PROVIDER_STREAM_EVENT_UNSUPPORTED", calls: 1, process: { inputDelivered: true } });
  expect(session.requests.filter(method => method === "turn/start")).toHaveLength(1);
}, 15000);

it.each(["typed-model", "managed-hooks", "wrong-profile", "wrong-instructions"])("disabled startup metadata does not bypass %s admission", async controlBehavior => {
  const session = await notificationSession("openai", { controlBehavior, startupEvents: [disabledRemoteControl] }, true);
  expect(session.result).toMatchObject({ status: "failed", calls: 0, process: { inputDelivered: false } });
  expect(session.result.error).toMatch(/^CODEX_(EFFECTIVE_CONFIG_UNVERIFIED|REQUIREMENTS_DENIED|THREAD_SELECTION_UNVERIFIED)$/);
  expect(session.prepared.ready).toBe(false);
  expect(session.requests).not.toContain("turn/start");
}, 15000);

it("stops active remote-control metadata received after ready but before input", async () => {
  const session = await notificationSession("openai", { afterReadyEvents: [{ ...disabledRemoteControl, params: { ...disabledRemoteControl.params, status: "connected" } }] }, "after-ready-event");
  expect(session.prepared.ready).toBe(true);
  expect(session.result).toMatchObject({ status: "failed", error: "PROVIDER_STREAM_EVENT_UNSUPPORTED", calls: 0, process: { inputDelivered: false } });
  expect(session.requests).not.toContain("turn/start");
  expect(session.inferenceExists).toBe(false);
}, 15000);

it.each([
  ["disabled remote-control", { inflightEvents: [disabledRemoteControl] }],
  ["initial thread/started", { inflightThreadStarted: true }],
])("rejects %s after reserving the input call while delivery is in flight", async (_label, notifications) => {
  const session = await notificationSession("openai", notifications as Record<string, unknown>, true);
  expect(session.prepared.ready).toBe(true);
  expect(session.result).toMatchObject({ status: "failed", error: "PROVIDER_STREAM_EVENT_UNSUPPORTED", calls: 1 });
}, 15000);

async function agyStartupSession(behavior: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "agy-startup-")));
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const workspace = join(root, "project"); mkdirSync(workspace);
    const directory = join(root, "session"); mkdirSync(directory);
    const trace = join(root, "input-trace.txt"); writeFileSync(trace, "");
    const packetRoot = join(workspace, ".council/native-packets");
    const agentPath = join(packetRoot, ".agents/agents/council-packet/agent.md");
    const agent = "---\nname: council-packet\ntools: []\nmainAgent: true\n---\nFixture reader\n";
    const assignment: WrapperAssignment = {
      version: 1, runtimeId: "synthetic-runtime", workspace, workspaceId: "synthetic-workspace", directory,
      identity: { handle: "fixture", worktreeId: "synthetic-workspace", ptyId: "fixture-pty", incarnationId: "fixture-incarnation", paneKey: "fixture:pane" },
      binding: { runId: "fixture-run", taskId: "fixture-task", dispatchId: "fixture-dispatch", handle: "fixture", attemptKey: "fixture-attempt" },
      dispatchIncarnation: "fixture-incarnation", producerHash: "fixture-producer", phase: "normal-probe", role: "gemini", selection: incidentRoster.reviewers.gemini,
      packetHash: sha256("immutable fixture"), packet: "immutable fixture", controlsHash: "fixture-controls", policyHash: "fixture-policy", deadline: Date.now()+5000, orca: "unused-fixture-orca",
      recipe: {
        protocol: "agy-stream", executable: process.execPath,
        argv: [resolve("test/pilot/fixtures/agy-startup-provider.cjs"), behavior, directory, trace, "--agent", "council-packet"],
        cwd: packetRoot, version: "synthetic", selection: incidentRoster.reviewers.gemini, expectedPermission: "request-review", sources: [],
        facts: [{ name: "effective-input-gate", stage: "effective", observation: { state: "unknown", source: "fixture init", detail: "not qualification" }, enforcement: "real wrapper checks", observedAt: Date.now(), digest: "fixture" }],
        agent: "council-packet", agentDefinition: { path: agentPath, sha256: sha256(agent) }, materializations: [{ path: agentPath, content: agent, sha256: sha256(agent) }],
      },
    };
    const assignmentHash = sha256(JSON.stringify(assignment));
    const input = () => writeFileSync(join(directory, "input.json"), JSON.stringify({ assignmentHash, requestId: "fixture-request" }));
    if (behavior !== "post-ready-error") input();
    else timer = setInterval(() => {
      if (readFileSync(trace, "utf8").includes("startup-stop") && !existsSync(join(directory, "input.json"))) input();
    }, 5);
    const result = await runProviderSession(assignment, assignmentHash);
    expect(result.process).toMatchObject({ closed: true, groupSettled: true, trackedDescendantsSettled: true, timersSettled: true });
    return { result, trace: readFileSync(trace, "utf8"), prepared: JSON.parse(readFileSync(join(directory, "prepared.json"), "utf8")), inferenceExists: existsSync(join(directory, "inference-started.json")) };
  } finally { if (timer) clearInterval(timer); rmSync(root, { recursive: true, force: true }); }
}

it.each(["missing-agent", "null-agent"])("rejects AGY %s identity before reserving or delivering input", async behavior => {
  const session = await agyStartupSession(behavior);
  expect(session.result).toMatchObject({ status: "failed", error: "PROVIDER_EFFECTIVE_CONTROLS_UNVERIFIED", calls: 0, process: { inputDelivered: false } });
  expect(session.prepared.ready).toBe(false);
  expect(session.trace).not.toContain("user-input");
  expect(session.inferenceExists).toBe(false);
}, 10000);

it("accepts the exact AGY recipe agent with otherwise verified effective controls", async () => {
  const session = await agyStartupSession("normal");
  expect(session.result).toMatchObject({ status: "completed", calls: 1, error: null, process: { inputDelivered: true }, selectedAgent: { requested: "council-packet", observed: "council-packet" } });
}, 10000);

it.each(["wrong-agent", "captured-tools"])("keeps AGY %s initialization rejected with zero input", async behavior => {
  const session = await agyStartupSession(behavior);
  expect(session.result).toMatchObject({ status: "failed", error: "PROVIDER_EFFECTIVE_CONTROLS_UNVERIFIED", calls: 0, process: { inputDelivered: false } });
  expect(session.trace).not.toContain("user-input");
  expect(session.inferenceExists).toBe(false);
}, 10000);

it("blocks AGY input after a post-ready stream error was parsed and termination requested", async () => {
  const session = await agyStartupSession("post-ready-error");
  expect(session.prepared.ready).toBe(true);
  expect(session.trace).toContain("post-ready-error\nstartup-stop");
  expect(session.result).toMatchObject({ status: "failed", error: "PROVIDER_STREAM_EVENT_UNSUPPORTED", calls: 0, process: { inputDelivered: false } });
  expect(session.trace).not.toContain("user-input");
  expect(session.inferenceExists).toBe(false);
}, 10000);
