import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, lstatSync, accessSync, constants } from "node:fs";
import { join, relative, dirname, isAbsolute } from "node:path";
import { canonicalJson } from "../domain/hash.js";
import { decodeStrictJson } from "../workers/strict-json.js";
import { pilotPayloadSchemas, pilotResultEnvelopeSchema } from "./payload.js";
import { readStrictFile, sha256, writeExclusive, projectProviderInitialization, providerReportSchema, preparedReportSchema,
  type WrapperAssignment, type ProviderRecipe, type ProviderReport, type ProviderInitialization } from "./wrapper-contract.js";
import { instantiateAgyHookShellPolicy } from "./agy-hook-shell.js";
import { currentSourceDigest } from "./control-audit.js";
import { verifyCodexConfig, verifyCodexRequirements } from "./codex-controls.js";
import { startProviderProcessScan, waitForProviderWork, type OwnedProviderScan } from "./provider-cleanup.js";
import { addDiagnosticCount, DIAGNOSTIC_COUNTER_MAX, DIAGNOSTIC_SIGNALS, fitDiagnosticSummary, projectDiagnostic,
  type DiagnosticCode, type DiagnosticPhase, type DiagnosticSummary, type DiagnosticSignal } from "./diagnostics.js";

/** Only the host wrapper owns process signals and control files. Provider
 * children receive subscription authentication through their normal home, but
 * no Orca caller context, API-key route, or lifecycle executable capability. */
export async function runProviderSession(a: WrapperAssignment, assignmentHash: string): Promise<ProviderReport> {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const sleep = (ms: number) => new Promise<void>(resolve => { const timer = setTimeout(() => { timers.delete(timer); resolve(); }, ms); timers.add(timer); });
  const recipe = a.recipe;
  if (recipe.facts.some(f => f.stage === "bootstrap" && f.observation.state !== "verified")) throw Error("PROVIDER_BOOTSTRAP_UNVERIFIED");
  for (const source of recipe.sources) if (currentSourceDigest(source) !== source.sha256) throw Error("PROVIDER_CONTROL_SOURCE_DRIFT");
  const initializedFacts = new Set(recipe.protocol === "codex-app-server"
    ? ["pre-input-effective-config", "all-tool-effects-and-packet-read-boundary"] : recipe.protocol === "agy-stream" ? ["effective-input-gate"] : []);
  if (recipe.facts.some(f => f.stage === "effective" && f.observation.state !== "verified" &&
      !(f.observation.state === "unknown" && initializedFacts.has(f.name)))) throw Error("PROVIDER_PREINPUT_CONTROL_UNVERIFIED");
  const packetRoot = join(a.workspace, ".council/native-packets");
  if (recipe.cwd !== packetRoot) throw Error("PROVIDER_PACKET_ROOT_MISMATCH");
  for (const segment of [join(a.workspace, ".council"), packetRoot]) {
    if (existsSync(segment) && (lstatSync(segment).isSymbolicLink() || realpathSync(segment) !== segment)) throw Error("PROVIDER_PACKET_ROOT_UNVERIFIED");
    mkdirSync(segment, { recursive: true, mode: 0o700 });
  }
  const materialize = (files: NonNullable<ProviderRecipe["materializations"]>) => { for (const material of files) {
    const target = relative(packetRoot, material.path);
    if (!target || target.startsWith("..") || isAbsolute(target) || sha256(material.content) !== material.sha256) throw Error("PROVIDER_PROFILE_SCOPE_INVALID");
    mkdirSync(dirname(material.path), { recursive: true, mode: 0o700 });
    if (realpathSync(dirname(material.path)) !== dirname(material.path)) throw Error("PROVIDER_PROFILE_SYMLINK");
    if (!existsSync(material.path)) {
      try { writeFileSync(material.path, material.content, { mode: material.mode ?? 0o600, flag: "wx" }); }
      catch(cause) { if((cause as NodeJS.ErrnoException).code!=="EEXIST")throw cause; }
    }
    if (material.mode !== undefined) {
      const s = lstatSync(material.path);
      if (![0o400, 0o500, 0o600].includes(material.mode) || !s.isFile() || s.isSymbolicLink() || realpathSync(material.path) !== material.path || s.uid !== process.geteuid?.() || (s.mode & 0o7777) !== material.mode) throw Error("PROVIDER_PROFILE_CUSTODY_INVALID");
      accessSync(material.path, constants.R_OK | (material.mode & 0o100 ? constants.X_OK : 0));
    }
    if (sha256(readFileSync(material.path)) !== material.sha256) throw Error("PROVIDER_PROFILE_CONTENT_MISMATCH");
  } };
  materialize(recipe.materializations ?? []);
  if(recipe.agent && (!recipe.agentDefinition || sha256(readFileSync(recipe.agentDefinition.path)) !== recipe.agentDefinition.sha256 ||
      recipe.argv[recipe.argv.indexOf("--agent")+1]!==recipe.agent || !recipe.argv.includes("--agent"))) throw Error("PROVIDER_AGENT_DEFINITION_UNBOUND");
  const environmentKeys = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM", ...(a.selection.route === "codex" ? ["CODEX_HOME"] : a.selection.route === "cursor" ? ["CURSOR_CONFIG_DIR", "CURSOR_DATA_DIR", "XDG_CONFIG_HOME"] : [])];
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && environmentKeys.includes(key)));
  if (recipe.agyHookShell) {
    if (recipe.protocol !== "agy-stream" || a.selection.route !== "antigravity" || recipe.selection.route !== "antigravity" || recipe.executable !== recipe.agyHookShell.executable || a.workspace !== recipe.agyHookShell.workspace || recipe.cwd !== recipe.agyHookShell.executionCwd) throw Error("PROVIDER_PROFILE_ROUTE_MISMATCH");
    environment.PATH = instantiateAgyHookShellPolicy(recipe.agyHookShell, { packetRoot, directory: a.directory, assignmentHash }, materialize).launchPath;
  }
  environment.AGY_CLI_DISABLE_AUTO_UPDATE = "true";
  const child = spawn(recipe.executable, recipe.argv, { cwd: recipe.cwd, env: environment, detached: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  let closed = false, exitCode: number | null = null, signal: string | null = null;
  let inputDelivered = false, calls: 0 | 1 = 0, error: DiagnosticCode | undefined, initialized = false, final: any, turnFinal = false;
  let init: ProviderInitialization = projectProviderInitialization(undefined, a), configDigest: string | undefined;
  let size = 0, stderrSeen = false, pending = "", stopRequested = false;
  let activeTurn: NonNullable<ProviderReport["cancellation"]>["activeTurn"] | null = null;
  let cancellation: ProviderReport["cancellation"] = null, ready = false, nextConfig = false, threadId: string | undefined;
  let phase: DiagnosticPhase = "initialization", firstDiagnostic: DiagnosticSummary | undefined;
  const counters: DiagnosticSummary["counters"] = { stdoutBytes: 0, stdoutChunks: 0, stderrBytes: 0, stderrChunks: 0, exceptions: 0, unknownCodes: 0 };
  const omissions: DiagnosticSummary["omissions"] = { stdout: false, stderr: false, exceptionText: false, initializationExtras: false, details: 0, countersSaturated: false };
  const measure = (key: keyof typeof counters, amount: number) => {
    if (amount > DIAGNOSTIC_COUNTER_MAX-counters[key]) omissions.countersSaturated = true;
    counters[key] = addDiagnosticCount(counters[key], amount);
  };
  const inspectExtras = (value: unknown, allowed: readonly string[]) => {
    if (value && typeof value === "object" && Object.keys(value).some(key => !allowed.includes(key))) omissions.initializationExtras = true;
  };
  let inputRequestId: string | undefined;
  let configAccepted = false, requirementsAccepted = false, profileAllowed = false, threadRequested = false;
  let startupThread: string | undefined, startupThreadNotified = false;
  let callbacksSealed = false;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const markFinal = () => { if (callbacksSealed || error) return; turnFinal = true; writeExclusive(join(a.directory, "turn-final.json"), { assignmentHash, at: Date.now() }); };
  const seen = new Set<number>();
  let escaped = false, processScanKnown = true;
  let cleanupBound = a.deadline+30000;
  const observePreInputCancellation = () => {
    const file = join(a.directory, "cancel.json");
    if (!existsSync(file)) return;
    const request = readStrictFile(file);
    if (canonicalJson(request.binding) !== canonicalJson(a.binding) || !Number.isSafeInteger(request.deadline)) throw Error("PROVIDER_CANCEL_UNBOUND");
    cleanupBound = Math.min(cleanupBound, request.deadline);
    phase = "cancellation"; recordFailure("PROVIDER_INITIALIZATION_CANCELLED");
  };
  const groupState = () => {
    if (!child.pid) return "unknown";
    try { process.kill(-child.pid, 0); return "live"; } catch (cause) { return (cause as NodeJS.ErrnoException).code === "ESRCH" ? "exited" : "unknown"; }
  };
  const stop = () => { if (stopRequested) return; stopRequested = true; if (child.pid) try { process.kill(-child.pid, "SIGTERM"); } catch {} };
  const recordFailure = (cause: unknown) => {
    const observed = projectDiagnostic(cause, { origin: "provider", phase });
    measure("exceptions", observed.counters.exceptions); measure("unknownCodes", observed.counters.unknownCodes);
    omissions.exceptionText ||= observed.omissions.exceptionText;
    error ??= observed.code;
    if (!firstDiagnostic) firstDiagnostic = observed;
    else if (observed.code !== firstDiagnostic.code) {
      // The retained list never grows past one bounded summary. Once full,
      // later classifications contribute only to the saturated omission count.
      if (firstDiagnostic.truncated) {
        if (firstDiagnostic.omissions.details === DIAGNOSTIC_COUNTER_MAX) firstDiagnostic.omissions.countersSaturated = true;
        firstDiagnostic.omissions.details = addDiagnosticCount(firstDiagnostic.omissions.details, 1);
      }
      else firstDiagnostic = fitDiagnosticSummary({ ...firstDiagnostic,
        details: [...firstDiagnostic.details, { origin: observed.origin, phase: observed.phase, code: observed.code }] });
    }
    stop();
  };
  const projectCloseSignal = (observed: string | null): DiagnosticSignal | null =>
    (DIAGNOSTIC_SIGNALS as readonly unknown[]).includes(observed) ? observed as DiagnosticSignal : null;
  const summary = (): DiagnosticSummary => {
    const base = firstDiagnostic ?? projectDiagnostic("NONE", { origin: "provider", phase });
    const checkedSignal = projectCloseSignal(signal);
    return fitDiagnosticSummary({ ...base, inputDelivery: inputDelivered ? "acknowledged" : calls === 1 ? "attempted_unacknowledged" : "not_attempted",
      exit: { state: closed && (Number.isSafeInteger(exitCode) || checkedSignal !== null) ? "observed" : "unknown",
        code: Number.isSafeInteger(exitCode) ? exitCode : null, signal: checkedSignal,
        signalState: signal === null ? closed ? "none" : "unknown" : checkedSignal ? "observed" : "unknown" },
      counters: { ...counters }, omissions: { ...omissions, details: base.omissions.details, countersSaturated: omissions.countersSaturated || base.omissions.countersSaturated }, details: [...base.details] });
  };
  const assertPreInputOpen = () => {
    observePreInputCancellation();
    if (error) throw Error(error);
    if (closed) throw Error("PROVIDER_INPUT_AUTHORITY_UNVERIFIED");
    if (Date.now() >= a.deadline) throw Error("PROVIDER_INPUT_DEADLINE");
  };
  const send = async (value: unknown) => {
    const text = typeof value === "string" ? value : JSON.stringify(value)+"\n";
    await new Promise<void>((resolve, reject) => child.stdin.write(text, "utf8", cause => cause ? reject(cause) : resolve()));
  };
  const completeInit = (observed: any) => {
    inspectExtras(observed, recipe.protocol === "cursor-stream" ? ["model", "cwd", "tools", "permission_mode", "agent", "type", "subtype", "session_id"] : ["model", "cwd", "tools", "permission_mode", "agent"]);
    if (initialized) throw Error("PROVIDER_MULTIPLE_INIT");
    if (observed?.model !== a.selection.model || observed.cwd !== recipe.cwd || !Array.isArray(observed.tools) || observed.tools.length || (recipe.protocol !== "cursor-stream" && observed.permission_mode !== recipe.expectedPermission) || (recipe.agent && (recipe.protocol === "agy-stream" || observed.agent != null) && observed.agent !== recipe.agent))
      throw Error("PROVIDER_EFFECTIVE_CONTROLS_UNVERIFIED");
    init = projectProviderInitialization(observed, a); initialized = true; ready = true;
  };
  const line = async (text: string) => {
    if (callbacksSealed || error) return;
    const event: any = decodeStrictJson(text);
    if (recipe.protocol === "agy-stream") {
      if (event.event === "init") completeInit(event.init);
      else if (event.event === "result") {
        if (!initialized || !inputDelivered || final) throw Error("PROVIDER_FINAL_ORDER_INVALID");
        if (event.result?.status !== "SUCCESS" || typeof event.result.conversation_id !== "string" || !event.result.conversation_id || typeof event.result.response !== "string") throw Error("PROVIDER_FINAL_INVALID");
        if(activeTurn && activeTurn.identity!==event.result.conversation_id)throw Error("PROVIDER_CONVERSATION_UNBOUND");
        final = { text: event.result.response, conversationId: event.result.conversation_id };
        markFinal();
        child.stdin.end();
      } else if (event.event === "step_update") {
        if (initialized && inputDelivered && event.step_update?.step_type === "user_input" && event.step_update?.state === "DONE" && event.step_update?.step_index === 0 && typeof event.step_update?.conversation_id === "string" && event.step_update.conversation_id.length > 0) activeTurn={source:"AGY original user_input DONE",identity:event.step_update.conversation_id};
        if (event.step_update?.tool_name || !["user_input", "system_message", "agent_response", "thinking", "reasoning"].includes(event.step_update?.step_type)) throw Error("PROVIDER_UNCONTROLLED_TOOL");
      } else if (event.event === "tool" || event.event === "tool_call" || event.tool_calls) throw Error("PROVIDER_UNCONTROLLED_TOOL");
      else if (!["assistant", "message", "usage", "thought"].includes(event.event)) throw Error("PROVIDER_STREAM_EVENT_UNSUPPORTED");
    } else if (recipe.protocol === "cursor-stream") {
      if (event.type === "system" && event.subtype === "init") completeInit(event);
      else if (event.type === "result") {
        if (final || event.subtype !== "success" || typeof event.result !== "string" || typeof event.session_id !== "string" || !event.session_id) throw Error("PROVIDER_FINAL_INVALID");
        final = { text: event.result, conversationId: event.session_id };
        markFinal();
      } else if (event.type === "user" && initialized && inputDelivered && typeof inputRequestId === "string" && inputRequestId.length > 0) activeTurn={source:"Cursor initialized original user event",identity:inputRequestId};
      else if (event.type === "tool_call" || event.tool_calls) throw Error("PROVIDER_UNCONTROLLED_TOOL");
      else if (!["assistant", "user", "thinking"].includes(event.type)) throw Error("PROVIDER_STREAM_EVENT_UNSUPPORTED");
    } else {
      if (calls === 0 && !inputDelivered && event.method === "remoteControl/status/changed") {
        // Codex 0.164 ServerNotification: disabled metadata grants no controls.
        const status = event.params;
        if (Object.hasOwn(event, "id") || Object.hasOwn(event, "result") || Object.hasOwn(event, "error") ||
            !status || typeof status !== "object" || Array.isArray(status) || status.status !== "disabled" ||
            typeof status.installationId !== "string" || typeof status.serverName !== "string" ||
            (Object.hasOwn(status, "environmentId") && status.environmentId !== null && typeof status.environmentId !== "string"))
          throw Error("PROVIDER_STREAM_EVENT_UNSUPPORTED");
        return;
      }
      if (calls === 0 && !inputDelivered && event.method === "thread/started") {
        const thread = event.params?.thread;
        // 0.164 thread/start responds first, then notifies with the same
        // initial Thread snapshot and no turns. Bind it to that checked reply.
        if (Object.hasOwn(event, "id") || Object.hasOwn(event, "result") || Object.hasOwn(event, "error") ||
            !threadRequested || !initialized || !configAccepted || !requirementsAccepted || !profileAllowed || startupThreadNotified ||
            !thread || thread.id !== threadId || typeof thread.id !== "string" || thread.cwd !== recipe.cwd || thread.modelProvider !== "openai" ||
            thread.ephemeral !== true || typeof thread.cliVersion !== "string" || typeof thread.sessionId !== "string" ||
            typeof thread.preview !== "string" || (thread.projectId !== null && typeof thread.projectId !== "string") ||
            !Number.isSafeInteger(thread.createdAt) || !Number.isSafeInteger(thread.updatedAt) ||
            !["cli", "vscode", "exec", "appServer", "unknown"].includes(thread.source) || thread.status?.type !== "idle" ||
            !Array.isArray(thread.turns) || thread.turns.length !== 0 || canonicalJson(thread) !== startupThread)
          throw Error("PROVIDER_STREAM_EVENT_UNSUPPORTED");
        startupThreadNotified = true;
        return;
      }
      if (event.error) throw Error("CODEX_APP_SERVER_ERROR");
      if (event.id === 1) { nextConfig = true; }
      else if (event.id === 2) {
        if (!recipe.codexPolicy || !verifyCodexConfig(event.result, recipe.codexPolicy, a.selection.model, a.selection.effort)) throw Error("CODEX_EFFECTIVE_CONFIG_UNVERIFIED");
        configAccepted = true; configDigest = sha256(canonicalJson(event.result));
      } else if (event.id === 5) {
        if (!recipe.codexPolicy || !verifyCodexRequirements(event.result?.requirements, recipe.codexPolicy.name, a.selection.model, a.selection.effort)) throw Error("CODEX_REQUIREMENTS_DENIED");
        requirementsAccepted = true;
      } else if (event.id === 6) {
        if (!recipe.codexPolicy || !event.result?.data?.some((p: any) => p.id === recipe.codexPolicy!.name && p.allowed === true)) throw Error("CODEX_PROFILE_NOT_ALLOWED");
        profileAllowed = true;
      } else if (event.id === 3) {
        const selected = event.result;
        inspectExtras(selected, ["thread", "modelProvider", "model", "reasoningEffort", "cwd", "approvalPolicy", "activePermissionProfile", "instructionSources"]);
        inspectExtras(selected?.activePermissionProfile, ["id", "extends"]);
        const selectedThreadId = selected?.thread?.id;
        if (typeof selectedThreadId !== "string" || !selectedThreadId || selected.modelProvider !== "openai" || selected.thread.modelProvider !== "openai" || selected.model !== a.selection.model || selected.reasoningEffort !== a.selection.effort || selected.cwd !== recipe.cwd || selected.approvalPolicy !== "never" ||
            selected.activePermissionProfile?.id !== recipe.codexPolicy?.name || selected.activePermissionProfile?.extends != null ||
            !Array.isArray(selected.instructionSources) || canonicalJson(selected.instructionSources) !== canonicalJson((recipe.instructionSources??[]).map(source=>source.path)) ||
            (recipe.instructionSources??[]).some(source=>sha256(readFileSync(source.path))!==source.sha256)) throw Error("CODEX_THREAD_SELECTION_UNVERIFIED");
        init = projectProviderInitialization({ model: selected.model, cwd: selected.cwd, configDigest, modelProvider: selected.modelProvider,
          activePermissionProfile: selected.activePermissionProfile, reasoningEffort: selected.reasoningEffort, instructionSources: selected.instructionSources }, a);
        threadId = selectedThreadId; initialized = true; ready = true;
        if (calls === 0 && !inputDelivered) startupThread = canonicalJson(selected.thread);
      } else if (event.id === 4) {
        if (!inputDelivered || event.result?.turn?.status !== "inProgress" || typeof event.result.turn.id !== "string" || !event.result.turn.id) throw Error("CODEX_ACTIVE_TURN_UNVERIFIED");
        activeTurn={source:"Codex original turn/start response",identity:event.result.turn.id};
      } else if (event.method === "item/completed") {
        const item = event.params?.item;
        if (item?.type === "agentMessage") {
          if (final) throw Error("PROVIDER_MULTIPLE_FINAL");
          if (typeof event.params?.threadId !== "string" || event.params.threadId !== threadId) throw Error("PROVIDER_CONVERSATION_UNBOUND");
          final = { text: item.text, conversationId: event.params?.threadId };
        } else if (item && !["reasoning", "plan"].includes(item.type)) throw Error("PROVIDER_UNCONTROLLED_TOOL");
      } else if (event.method === "turn/completed") {
        if (event.params?.turn?.status !== "completed" || !final) throw Error("CODEX_TURN_FAILED");
        markFinal();
        child.stdin.end();
      } else if (event.method && /requestApproval|tool\/|mcp|commandExecution|fileChange/i.test(event.method)) throw Error("PROVIDER_UNCONTROLLED_TOOL");
      else if (event.method === "item/started" && ["agentMessage","reasoning","plan"].includes(event.params?.item?.type)) { /* Non-tool original-turn progress. */ }
      else if (["thread/started","thread/tokenUsage/updated","turn/started"].includes(event.method) && event.params?.threadId === threadId) { /* Selection already bound by thread/start. */ }
      else throw Error("PROVIDER_STREAM_EVENT_UNSUPPORTED");
    }
  };
  let parsing = Promise.resolve(), parsingPending = 0, parsingExpired = false;
  const observeParsing = async (deadline: () => number, poll: () => void) => {
    const outcome = await waitForProviderWork("parsing", parsing, deadline, poll, timers);
    if (outcome.state === "deadline") parsingExpired = true;
    if (outcome.state === "rejected") recordFailure(outcome.reason);
    return outcome.state === "settled";
  };
  const drainPreInputParsing = async () => {
    let tail: Promise<void>;
    do {
      tail = parsing;
      if (!await observeParsing(() => a.deadline, assertPreInputOpen)) throw Error("PROVIDER_INPUT_DEADLINE");
      assertPreInputOpen();
    } while (tail !== parsing);
  };
  const queueLine = (text: string) => {
    parsingPending++;
    parsing = parsing.then(() => line(text)).catch(cause => {
      if (!callbacksSealed) recordFailure(cause);
    }).then(() => { parsingPending--; });
  };
  const onStdout = (bytes: Buffer) => {
    if (callbacksSealed) return;
    measure("stdoutBytes", bytes.length); measure("stdoutChunks", 1); omissions.stdout ||= bytes.length > 0;
    size += bytes.length;
    if (size > 1024*1024) { recordFailure("PROVIDER_OUTPUT_OVERFLOW"); return; }
    try { pending += decoder.decode(bytes, { stream: true }); }
    catch { recordFailure("PROVIDER_INVALID_UTF8"); return; }
    let index: number;
    while ((index = pending.indexOf("\n")) >= 0) {
      const current = pending.slice(0, index); pending = pending.slice(index+1);
      if (current.trim()) queueLine(current);
    }
  };
  const onStderr = (bytes: Buffer) => {
    if (callbacksSealed) return;
    measure("stderrBytes", bytes.length); measure("stderrChunks", 1); omissions.stderr ||= bytes.length > 0;
    size += bytes.length; stderrSeen ||= bytes.toString("utf8").trim().length > 0;
    if (stderrSeen) recordFailure("PROVIDER_STDERR_UNCLASSIFIED");
    if (size > 1024*1024) recordFailure("PROVIDER_OUTPUT_OVERFLOW");
  };
  child.stdout.on("data", onStdout);
  child.stderr.on("data", onStderr);
  child.stdin.on("error", () => { recordFailure("PROVIDER_INPUT_CLOSED"); });
  child.on("error", () => { recordFailure("PROVIDER_PROCESS_START_FAILED"); });
  child.once("close", (code, why) => { closed = true; exitCode = code; signal = why; });
  let ownedScan: { handle: OwnedProviderScan; work: Promise<void> } | undefined;
  const scan = async (deadline: () => number, poll: () => void) => {
    poll();
    if (!child.pid) { processScanKnown = false; return false; }
    if (!ownedScan) {
      if (Date.now() >= deadline()) { processScanKnown = false; return false; }
      const handle = startProviderProcessScan(deadline());
      const work = handle.result.then(stdout => {
        if (!callbacksSealed) {
          const rows = stdout.trim().split("\n").map(row => row.trim().split(/\s+/).map(Number));
          const tree = new Set([child.pid!, ...seen]);
          for (let pass = 0; pass < 10; pass++) for (const [pid, ppid, pgid] of rows) if (pid && ppid && tree.has(ppid)) { tree.add(pid); seen.add(pid); if (pgid !== child.pid) escaped = true; }
        }
      }).catch(() => { processScanKnown = false; });
      ownedScan = { handle, work };
    }
    const current = ownedScan;
    const outcome = await waitForProviderWork("scan", current.work, deadline, poll, timers);
    // Callback completion and stdio closure are separate facts. Retain ownership
    // through both, without leaving a synthetic completion promise or poll behind.
    while (outcome.state === "settled" && !current.handle.settled()) {
      poll();
      const remaining = deadline()-Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(20, remaining));
    }
    const settled = outcome.state === "settled" && current.handle.settled();
    if (!settled) processScanKnown = false;
    if (settled) ownedScan = undefined;
    return settled;
  };
  try {
    writeExclusive(join(a.directory, "initialization-started.json"), { assignmentHash, pid: child.pid ?? null, initializations: 1 });
    if (recipe.protocol === "codex-app-server") await send({ id: 1, method: "initialize", params: { clientInfo: { name: "council", version: "0.1.0" }, capabilities: { experimentalApi: true } } });
    if (recipe.protocol === "cursor-stream") ready = true; // All effective facts must already be enforced before this one-way CLI starts.
    const initializationDeadline = Math.min(a.deadline, Date.now()+5000);
    while (!closed && !ready && !error && Date.now() < initializationDeadline) {
      observePreInputCancellation();
      if (error) throw Error(error);
      if (!await observeParsing(() => initializationDeadline, assertPreInputOpen)) throw Error("PROVIDER_PREINPUT_INIT_UNAVAILABLE");
      if (nextConfig) {
        nextConfig = false; await send({ method: "initialized", params: {} });
        await send({ id: 2, method: "config/read", params: { cwd: recipe.cwd, includeLayers: true } });
        await send({ id: 5, method: "configRequirements/read", params: {} });
        await send({ id: 6, method: "permissionProfile/list", params: { cwd: recipe.cwd } });
      }
      if (recipe.protocol === "codex-app-server" && configAccepted && requirementsAccepted && profileAllowed && !threadRequested) {
        threadRequested = true;
        await send({ id: 3, method: "thread/start", params: { model: a.selection.model, modelProvider: "openai", cwd: recipe.cwd, approvalPolicy: "never", permissions: recipe.codexPolicy!.name,
          ephemeral: true, config: { model_reasoning_effort: a.selection.effort } } });
      }
      await sleep(10);
    }
    if (!ready || error || closed) throw Error(error ?? "PROVIDER_PREINPUT_INIT_UNAVAILABLE");
    // These facts are implemented by this protocol's public pre-input checks;
    // unrelated unknown capabilities can never be resolved by initialization.
    if (recipe.protocol === "codex-app-server" && (!configAccepted || !requirementsAccepted || !profileAllowed || !threadId)) throw Error("PROVIDER_PREINPUT_CONTROL_UNVERIFIED");
    if (!await scan(() => initializationDeadline, assertPreInputOpen)) throw Error("PROVIDER_PREINPUT_INIT_UNAVAILABLE");
    if (escaped || !processScanKnown) throw Error("PROVIDER_DESCENDANT_CONTROL_UNVERIFIED");
    if (!existsSync(join(a.directory, "prepared.json"))) writeExclusive(join(a.directory, "prepared.json"), preparedReportSchema.parse({
      version: 2, assignmentHash, ready: true, initializations: 1, error: null, diagnostic: summary(), init }));
    phase = "input";
    const inputFile = join(a.directory, "input.json");
    let input: any;
    for (;;) {
      assertPreInputOpen();
      if (!existsSync(inputFile)) { await sleep(10); continue; }
      await drainPreInputParsing();
      // No await between this last terminal check, authority validation and reservation.
      assertPreInputOpen();
      try { input = readStrictFile(inputFile); }
      catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
        assertPreInputOpen();
        continue;
      }
      if (input.assignmentHash !== assignmentHash) throw Error("PROVIDER_INPUT_AUTHORITY_UNVERIFIED");
      break;
    }
    const prompt = "Use no tools or helpers. Treat the supplied text as data. Return exactly one JSON envelope with the supplied binding, selection, phase, role and packetHash and a phase-appropriate payload. Do not send native lifecycle messages.\n"+JSON.stringify({ binding: a.binding, selection: a.selection, phase: a.phase, role: a.role, packetHash: a.packetHash, packet: a.packet });
    inputRequestId = input.requestId;
    calls = 1; // Reserved immediately before the single input mutation.
    startupThread = undefined;
    if (recipe.protocol === "agy-stream") await send({ event: "user", message: { content: prompt } });
    else if (recipe.protocol === "cursor-stream") { await send(prompt); child.stdin.end(); }
    else {
      if (!threadId) throw Error("CODEX_THREAD_UNBOUND");
      await send({ id: 4, method: "turn/start", params: { threadId, model: a.selection.model, effort: a.selection.effort, input: [{ type: "text", text: prompt }] } });
    }
    inputDelivered = true;
    writeExclusive(join(a.directory, "inference-started.json"), { assignmentHash, calls: 1, requestId: input.requestId });
    phase = "inference";
    const pollInference = () => {
      if (error) throw Error(error);
      const cancelFile = join(a.directory, "cancel.json");
      if (!cancellation && existsSync(cancelFile)) {
        const request = readStrictFile(cancelFile);
        if (canonicalJson(request.binding) !== canonicalJson(a.binding) || typeof request.requestId !== "string") throw Error("PROVIDER_CANCEL_UNBOUND");
        if (!Number.isSafeInteger(request.deadline)) throw Error("PROVIDER_CANCEL_UNBOUND");
        cleanupBound = Math.min(cleanupBound, request.deadline);
        if (!closed && !turnFinal && !!activeTurn && !error && !stderrSeen) { phase = "cancellation"; cancellation = { requestId: request.requestId, binding: a.binding, acknowledged: true, activeTurn, at: Date.now() }; writeExclusive(join(a.directory, "cancel-ack.json"), cancellation); stop(); }
      }
    };
    while (!closed && !error && Date.now() < a.deadline) {
      if (!await observeParsing(() => Math.min(a.deadline, cleanupBound), pollInference)) break;
      if (!await scan(() => Math.min(a.deadline, cleanupBound), pollInference)) break;
      if (escaped || !processScanKnown) throw Error("PROVIDER_DESCENDANT_CONTROL_UNVERIFIED");
      if (cancellation) break;
      if (turnFinal) break;
      await sleep(20);
    }
    if (!closed && !cancellation && Date.now() >= a.deadline) throw Error("PROVIDER_INFERENCE_DEADLINE");
  } catch (cause) { recordFailure(cause); }
  // One finite cleanup interval; it starts no additional provider or input.
  phase = "cleanup";
  const cleanupStartedAt = Date.now();
  let cleanupDeadline = Math.min(cleanupBound, cleanupStartedAt+30000);
  let killed = false;
  const observeCleanupCancellation = () => {
    const file = join(a.directory, "cancel.json");
    if (!existsSync(file)) return;
    try {
      const request = readStrictFile(file);
      if (canonicalJson(request.binding) !== canonicalJson(a.binding) || !Number.isSafeInteger(request.deadline)) throw Error("PROVIDER_CANCEL_UNBOUND");
      cleanupBound = Math.min(cleanupBound, request.deadline);
      cleanupDeadline = Math.min(cleanupDeadline, cleanupBound);
    } catch { recordFailure("PROVIDER_CANCEL_UNBOUND"); }
  };
  const pollCleanup = () => {
    observeCleanupCancellation();
    const termEligibleAt = Math.max(cleanupStartedAt, cleanupDeadline-29_000);
    const killEligibleAt = Math.max(cleanupStartedAt, cleanupDeadline-28_000);
    if (!closed && Date.now() >= termEligibleAt) stop();
    if (stopRequested && !killed && Date.now() >= killEligibleAt) {
      killed = true; if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch {}
    }
  };
  pollCleanup();
  // Resume the same owned scan after an interrupted startup/inference wait.
  // Polling keeps stop eligibility and a later cancellation effective while it runs.
  while (Date.now() < cleanupDeadline) {
    if (!parsingExpired) await observeParsing(() => cleanupDeadline, pollCleanup);
    pollCleanup();
    if (Date.now() >= cleanupDeadline) break;
    if (!await scan(() => cleanupDeadline, pollCleanup)) break;
    if (closed && groupState() !== "live") break;
    await sleep(Math.min(20, Math.max(0, cleanupDeadline-Date.now())));
  }
  if (!error) {
    try {
      // A closed stream may have queued more lines since the last parser barrier.
      if (!await observeParsing(() => cleanupDeadline, pollCleanup)) recordFailure("PROVIDER_PROCESS_SETTLEMENT_UNVERIFIED");
      if (!error) {
        pending += decoder.decode();
        if (pending.trim()) { queueLine(pending); pending = ""; }
        if (!await observeParsing(() => cleanupDeadline, pollCleanup)) recordFailure("PROVIDER_PROCESS_SETTLEMENT_UNVERIFIED");
      }
    } catch (cause) { recordFailure(cause); }
  }
  // No queued or late callback may reopen input or persist a final receipt.
  callbacksSealed = true;
  child.stdout.off("data", onStdout); child.stderr.off("data", onStderr);
  const processScansSettled = !ownedScan || ownedScan.handle.settled();
  if (!processScansSettled) { processScanKnown = false; ownedScan!.handle.stop(); }
  const parsingSettled = !parsingExpired && parsingPending === 0;
  const trackedDescendantsSettled = processScanKnown && processScansSettled && [...seen].every(pid => { try { process.kill(pid, 0); return false; } catch (cause) { return (cause as NodeJS.ErrnoException).code === "ESRCH"; } });
  // Project only the persisted signal; the original close value still gates success.
  const processReceipt = { pid: child.pid ?? null, providerStarted: true, exitCode,
    signal: projectCloseSignal(signal),
    closed, groupSettled: groupState() === "exited", trackedDescendantsSettled, escapedDescendantObserved: escaped,
    parsingSettled, processScansSettled, timersSettled: timers.size === 0, inputDelivered, stopRequested, descendantEvidence: "observed process tree plus process group; prequalified no-escape controls required" };
  if (!closed) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref(); }
  if (!closed || !processReceipt.groupSettled || !trackedDescendantsSettled || !parsingSettled || !processScansSettled || escaped || timers.size) recordFailure("PROVIDER_PROCESS_SETTLEMENT_UNVERIFIED");
  if (stderrSeen) recordFailure("PROVIDER_STDERR_UNCLASSIFIED");
  let result: unknown;
  if (!cancellation && !error) {
    phase = "validation";
    try {
      if (stderrSeen || !final || !inputDelivered || !closed || exitCode !== 0 || signal !== null) throw Error("PROVIDER_FINAL_NOT_SUCCESSFUL");
      result = pilotResultEnvelopeSchema.parse(decodeStrictJson(final.text));
      const value = result as any;
      if (canonicalJson(value.binding) !== canonicalJson(a.binding) || value.packetHash !== a.packetHash || value.phase !== a.phase || value.role !== a.role || canonicalJson(value.selection) !== canonicalJson(a.selection) || !pilotPayloadSchemas[a.phase].safeParse(value.payload).success) throw Error("PROVIDER_RESULT_UNBOUND");
    } catch (cause) { result = undefined; recordFailure(cause); }
  }
  if (!existsSync(join(a.directory, "prepared.json"))) writeExclusive(join(a.directory, "prepared.json"), preparedReportSchema.parse({
    version: 2, assignmentHash, ready: false, initializations: 1, error: error ?? "PROVIDER_INITIALIZATION_FAILED", diagnostic: summary(), init }));
  processReceipt.stopRequested = stopRequested;
  const observedAgent = init.state === "verified" && init.protocol !== "codex-app-server" && init.agent.state === "verified" ? init.agent.value : null;
  const conversationId = !error && result ? final?.conversationId ?? null : null;
  pending = ""; final = undefined; startupThread = undefined;
  if (cancellation && !firstDiagnostic) phase = "cancellation";
  return providerReportSchema.parse({ version: 2, binding: a.binding, assignmentHash, packetHash: a.packetHash, controlsHash: a.controlsHash,
    status: error ? "failed" : cancellation ? "cancelled" : "completed", calls, initializations: 1, error: error ?? null,
    diagnostic: summary(),
    selectedAgent: { requested: recipe.agent ?? null, observed: observedAgent, source: observedAgent === null ? "Source-bound argv/definition; init agent identity not exposed" : "Provider init agent field" },
    result: result ?? null, conversationId, init, cancellation, process: processReceipt });
}
