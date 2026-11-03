const fs = require("node:fs");
const path = require("node:path");
const [behavior, directory, trace] = process.argv.slice(2);
const record = value => fs.appendFileSync(trace, value+"\n");
const emit = value => process.stdout.write(JSON.stringify(value)+"\n");
// Sanitized advertised tool names from the coordinator's zero-input AGY 1.4.12
// init capture on 2026-10-30. This is a protective fixture, not qualification.
const capturedTools = [
  "ask_custom_permission", "ask_permission", "ask_question", "browser_click_element",
  "browser_drag_pixel_to_pixel", "browser_get_dom", "browser_get_network_request",
  "browser_input", "browser_list_network_requests", "browser_mouse_down", "browser_mouse_up",
  "browser_move_mouse", "browser_press_key", "browser_refresh_page", "browser_resize_window",
  "browser_scroll", "browser_scroll_dom", "browser_select_option", "browser_subagent",
  "call_mcp_tool", "capture_browser_console_logs", "capture_browser_screenshot",
  "click_browser_pixel", "command_status", "define_subagent", "delete_knowledge",
  "execute_browser_javascript", "find_by_name", "finish", "generate_image", "grep_search",
  "invoke_subagent", "list_browser_pages", "list_dir", "list_permissions",
  "list_plugin_accounts", "list_resources", "manage_inbox", "manage_subagents", "manage_task",
  "multi_replace_file_content", "notebook_edit", "notebook_execution", "open_browser_url",
  "read_browser_page", "read_resource", "read_url_content", "replace_file_content",
  "run_command", "run_workflow", "schedule", "search_marketplace", "search_web", "sed_file",
  "send_command_input", "send_message", "view_file", "wait", "wait_5_seconds", "write_to_file",
];
const init = {
  model: "gemini-4-argon-high", cwd: process.cwd(), permission_mode: "request-review",
  tools: behavior === "captured-tools" ? capturedTools : [],
  ...(behavior === "missing-agent" ? {} : { agent: behavior === "null-agent" ? null : behavior === "wrong-agent" ? "foreign" : "council-packet" }),
};
const resistant = behavior.startsWith("resistant-");
process.on("SIGTERM", () => {
  record("startup-stop");
  // Keep the pipe open long enough to expose input after a known parser failure.
  if (!resistant) setTimeout(() => process.exit(0), 200);
});
if (resistant || behavior === "close-before-input") {
  const owner = JSON.parse(fs.readFileSync(path.join(directory, "fixture-owner.json"), "utf8"));
  let descendant;
  if (resistant) {
    descendant = require("node:child_process").spawn(process.execPath, ["-e", `
      const fs = require('node:fs');
      process.on('SIGTERM', () => fs.appendFileSync(${JSON.stringify(trace)}, 'descendant-stop\\n'));
      fs.writeFileSync(${JSON.stringify(path.join(directory, "descendant-ready"))}, String(process.pid));
      setInterval(() => {}, 1000);
    `], { stdio: ["ignore", "inherit", "inherit"] });
  }
  fs.writeFileSync(path.join(directory, "fixture-manifest.json"), JSON.stringify({
    assignmentHash: owner.assignmentHash, nonce: owner.nonce, parentPid: owner.parentPid,
    providerPid: process.pid, descendantPid: descendant?.pid ?? null, group: process.pid,
  }));
  let started = false, prepared = false;
  const commands = new Set();
  setInterval(() => {
    if (!started && (!resistant || fs.existsSync(path.join(directory, "descendant-ready")))) {
      started = true;
      emit({ event: "init", conversation_id: "synthetic-agy-session", init });
    }
    if (!prepared && fs.existsSync(path.join(directory, "prepared.json"))) {
      prepared = true;
      if (behavior === "close-before-input") process.exit(0);
      if (behavior === "resistant-post-ready-error") emit({ event: "unexpected-startup-event" });
    }
    for (const command of ["error", "stderr", "overflow", "invalid-utf8"]) {
      if (commands.has(command) || !fs.existsSync(path.join(directory, "command-"+command))) continue;
      commands.add(command);
      if (command === "error") emit({ event: "unexpected-startup-event" });
      if (command === "stderr") process.stderr.write("synthetic stderr failure\n");
      if (command === "overflow") process.stdout.write(Buffer.alloc(1_048_577, 120));
      if (command === "invalid-utf8") process.stdout.write(Buffer.from([0xff]));
      record("command-"+command);
    }
  }, 5);
} else emit({ event: "init", conversation_id: "synthetic-agy-session", init });
if (behavior === "post-ready-error") {
  const timer = setInterval(() => {
    const prepared = path.join(directory, "prepared.json");
    if (!fs.existsSync(prepared) || !JSON.parse(fs.readFileSync(prepared, "utf8")).ready) return;
    clearInterval(timer);
    record("post-ready-error");
    emit({ event: "unexpected-startup-event" });
  }, 5);
}
let pending = "";
process.stdin.on("data", bytes => {
  record("user-input");
  pending += bytes.toString("utf8");
  if (!pending.includes("\n")) return;
  const user = JSON.parse(pending.trim());
  const request = JSON.parse(user.message.content.slice(user.message.content.indexOf("\n")+1));
  const result = { binding: request.binding, selection: request.selection, phase: request.phase, role: request.role, packetHash: request.packetHash, payload: { ready: true } };
  emit({ event: "step_update", step_update: { step_type: "user_input", state: "DONE", step_index: 0, conversation_id: "synthetic-agy-session" } });
  process.stdout.write(JSON.stringify({ event: "result", result: { status: "SUCCESS", conversation_id: "synthetic-agy-session", response: JSON.stringify(result) } })+"\n", () => process.exit(0));
});
