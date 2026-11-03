const fs = require("node:fs");
const path = require("node:path");
const [mode, protocol, directory, model] = process.argv.slice(2);
const options = JSON.parse(fs.readFileSync(path.join(directory, "fixture-options.json"), "utf8"));
const owner = JSON.parse(fs.readFileSync(path.join(directory, "fixture-owner.json"), "utf8"));
fs.writeFileSync(path.join(directory, "fixture-manifest.json"), JSON.stringify({
  ...owner, providerPid: process.pid, descendantPid: null, group: process.pid,
}));
const emit = value => new Promise(resolve => process.stdout.write(JSON.stringify(value)+"\n", resolve));
const init = {
  model: mode === "invalid-init" ? "unverified-model" : model, cwd: process.cwd(), tools: [], permission_mode: "request-review", agent: "council-packet",
  ...(options.extras ? { extra: "diag-init-extra-10", nested: { unchecked: "diag-init-extra-10" } } : {}),
};
if (protocol === "agy-stream") void emit({ event: "init", init });
process.on("SIGTERM", () => {
  // Both stderr writes are acknowledged before this fixture allows exit.
  if (mode !== "stderr") process.exit(0);
});
const hold = () => setInterval(() => {}, 1000);
const respond = async text => {
  const request = JSON.parse(text.slice(text.indexOf("\n")+1));
  const result = {
    binding: request.binding, selection: request.selection, phase: request.phase, role: request.role,
    packetHash: request.packetHash, payload: { assessment: options.assessment ?? "requested-result-10-秘密", objections: [] },
  };
  if (protocol === "agy-stream") {
    await emit({ event: "message", metadata: "diag-stdout-10" });
    await emit({ event: "step_update", step_update: { step_type: "user_input", state: "DONE", step_index: 0, conversation_id: "diagnostic-session" } });
  } else if (protocol === "cursor-stream") {
    await emit({ type: "system", subtype: "init", session_id: "diagnostic-session", ...init });
    await emit({ type: "user", message: { content: "original turn accepted" } });
    await emit({ type: "assistant", metadata: "diag-stdout-10" });
  } else {
    await emit({ id: 4, result: { turn: { id: "diagnostic-turn", status: "inProgress" } } });
    await emit({ method: "item/started", params: { item: { type: "agentMessage", metadata: "diag-stdout-10" } } });
  }
  if (mode === "cancel-active") {
    fs.writeFileSync(path.join(directory, "original-turn-acknowledged"), "ready");
    hold(); return;
  }
  if (mode === "stderr") {
    await new Promise(resolve => process.stderr.write("diag-stderr-a-10", resolve));
    await new Promise(resolve => setTimeout(resolve, 30));
    await new Promise(resolve => process.stderr.write("diag-stderr-b-10", resolve));
    process.exit(0); return;
  }
  if (protocol === "agy-stream") await emit({ event: "result", result: { status: "SUCCESS", conversation_id: "diagnostic-session", response: JSON.stringify(result) } });
  else if (protocol === "cursor-stream") await emit({ type: "result", subtype: "success", session_id: "diagnostic-session", result: JSON.stringify(result) });
  else {
    await emit({ method: "item/completed", params: { threadId: options.foreignThread ? "foreign-thread" : "diagnostic-session", item: { type: "agentMessage", text: JSON.stringify(result) } } });
    await emit({ method: "turn/completed", params: { threadId: "diagnostic-session", turn: { status: "completed" } } });
  }
  process.exit(0);
};
let pending = "";
process.stdin.on("data", bytes => {
  pending += bytes.toString("utf8");
  let end;
  while ((end = pending.indexOf("\n")) >= 0) {
    const line = pending.slice(0, end); pending = pending.slice(end+1);
    if (protocol === "cursor-stream") { pending = line+"\n"+pending; return; }
    const message = JSON.parse(line);
    if (protocol === "agy-stream") { void respond(message.message.content); continue; }
    if (message.id === 1) void emit({ id: 1, result: {} });
    if (message.id === 2) {
      const raw = require("./context-provider.cjs").codexCliLayer(process.argv.slice(6));
      void emit({ id: 2, result: { config: raw, origins: {}, layers: [{ name: { type: "sessionFlags" }, version: "fixture", config: raw }] } });
    }
    if (message.id === 5) void emit({ id: 5, result: { requirements: null } });
    if (message.id === 6) void emit({ id: 6, result: { data: [{ id: "council_packet", allowed: true }] } });
    if (message.id === 3) void emit({ id: 3, result: {
      thread: { id: "diagnostic-session", modelProvider: "openai" }, model: init.model, modelProvider: "openai",
      reasoningEffort: "max", cwd: process.cwd(), approvalPolicy: "never", instructionSources: [],
      activePermissionProfile: { id: "council_packet", extends: null, ...(options.extras ? { private: { nested: "diag-init-extra-10" } } : {}) },
      ...(options.extras ? { private: "diag-init-extra-10" } : {}),
    } });
    if (message.id === 4) void respond(message.params.input[0].text);
  }
});
process.stdin.on("end", () => { if (protocol === "cursor-stream") void respond(pending.trimEnd()); });
