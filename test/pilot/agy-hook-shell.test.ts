import { describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, writeFileSync, chmodSync, mkdirSync, readdirSync, rmSync, lstatSync, symlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { spawnSync } from "node:child_process";
import * as contracts from "../../src/pilot/wrapper-contract.js";
import { runProviderSession } from "../../src/pilot/provider-session.js";
import type { WrapperAssignment } from "../../src/pilot/wrapper-contract.js";

const selection = { route: "antigravity", model: "gemini-4-argon-high", effort: "high" };
const recipe = {
  protocol: "agy-stream", executable: "/fixture/agy", argv: [], cwd: "/fixture/packet", version: "1.4.12",
  selection, expectedPermission: "request-review", sources: [], facts: [],
};

it.each([
  'hash -p "$TARGET" inert; inert', 'command hash -p "$TARGET" inert',
  'builtin hash -p "$TARGET" inert', 'enable -n printf', 'enable -f "$LIB" inert',
  'builtin unknown_builtin', 'builtin printf -v TARGET "%s" value',
  'printf "$FORMAT" value', 'printf -- "$FORMAT" value', 'printf "%n" TARGET',
  'printf "%10n" TARGET', 'printf -- "%n" TARGET',
  'export TARGET=value', 'set -f', 'read TARGET',
  'unset TARGET', 'let "$EXPR"', 'eval "$CODE"', 'source file', '. file',
  '/bin/sh', '/bin/sh; :', '/bin/sh\nprintf ok', '/bin/sh | :',
  'if false; then /bin/sh; fi', 'f() { /bin/sh; }; :', '( /bin/sh )',
  '/bin/sh -s', '/bin/sh -', '/bin/sh +s', '/bin/sh /dev/stdin', '/bin/sh /dev/fd/0',
  '/bin/sh /dev/null', '/bin/sh </dev/null', '/bin/sh 0</dev/null', '/bin/sh -c \'/bin/sh\'',
  '/usr/bin/env /bin/sh', 'exec', 'builtin', 'command',
])("refuses unsupported shell program sources and builtin effects: %s", async command => {
  const { acquireAgyHookShellPolicy, agyHookShellApplicable, hookCommand } = await import("../../src/pilot/agy-hook-shell.js");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "shell-effects-")));
  try {
    const installed = join(realpathSync(homedir()), ".orca/agent-hooks/antigravity-hook.sh");
    const descriptors = ["PreInvocation", "PostInvocation", "Stop", "PreToolUse", "PostToolUse"].map(e => ({type: "command", command: hookCommand(installed, e), timeout: 10}));
    const extra = {type: "command", command, timeout: 10};
    expect(agyHookShellApplicable([extra], root)).toBe(true);
    const r = acquireAgyHookShellPolicy({workspace: root, executable: "/nonexistent-fixture", version: "1.4.12", basePath: "/bin", descriptors: [...descriptors, extra]});
    expect(r.policy).toBeUndefined(); expect(r.unavailable).toEqual(["AGY_HOOK_DESCRIPTOR_UNSUPPORTED"]);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

it.each([
  'command 2>/dev/null -p "$a$b$c"', 'exec >/dev/null -- "$a$b$c"',
  '/usr/bin/env A=1 -i "$a$b$c"', '/usr/bin/command "$a$b$c"',
  '/bin/sh -c 2>/dev/null "$a$b$c"', '/bin/sh -c 0</dev/null \'hash -p "$a$b$c" x; x\'',
  'command 2>/dev/null -p hash -p "$a$b$c" x; x',
  'command 2>/dev/null -p /bin/sh', '/bin/sh -c 2>/dev/null \'/bin/sh\'',
])("refuses pending prefix options and nested IO-number bodies: %s", async body => {
  const { acquireAgyHookShellPolicy, agyHookShellApplicable, hookCommand } = await import("../../src/pilot/agy-hook-shell.js");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "prefix-lookahead-")));
  try {
    mkdirSync(join(root, ".council/native-packets"), {recursive: true});
    const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
    const command = "/bin/sh -c " + quote(`a=${quote(homedir() + "/.or")}; b=ca/agent-hooks/antigravity; c=-hook.sh\nif false; then ${body}; fi\nprintf '%s' "$BENIGN_VALUE"`);
    const installed = join(realpathSync(homedir()), ".orca/agent-hooks/antigravity-hook.sh");
    const descriptors = ["PreInvocation", "PostInvocation", "Stop", "PreToolUse", "PostToolUse"].map(e => ({type: "command", command: hookCommand(installed, e), timeout: 10}));
    expect(agyHookShellApplicable([{command}], root)).toBe(true);
    const r = acquireAgyHookShellPolicy({workspace: root, executable: "/nonexistent-fixture", version: "1.4.12", basePath: "/bin", descriptors: [...descriptors, {type: "command", command, timeout: 10}]});
    expect(r.policy).toBeUndefined(); expect(r.unavailable).toEqual(["AGY_HOOK_DESCRIPTOR_UNSUPPORTED"]);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

it.each([
  'command 2>/dev/null printf "%s" "$BENIGN_VALUE"',
  'exec 2>/dev/null /usr/bin/printf "%s" "$BENIGN_VALUE"',
  '/usr/bin/env 2>/dev/null VALUE="$BENIGN_VALUE" /bin/sh -c \'printf "%s" "$VALUE"\'',
  '/usr/bin/env VALUE="$BENIGN_VALUE" 2>/dev/null /bin/sh -c \'printf "%s" "$VALUE"\'',
  '/usr/bin/command printf "%s" "$BENIGN_VALUE"',
  '/bin/sh -c \'printf "%s" "$BENIGN_VALUE"\' 2>/dev/null',
])("preserves no-option prefixes with redirections and literal nested programs: %s", async command => {
  const { agyHookShellApplicable } = await import("../../src/pilot/agy-hook-shell.js");
  expect(agyHookShellApplicable([{command}], tmpdir())).toBe(false);
});

it("distinguishes adjacent IO numbers from literal numeric shell file operands", async () => {
  const { agyHookShellApplicable } = await import("../../src/pilot/agy-hook-shell.js");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "io-number-")));
  try {
    const packetRoot = join(root, ".council/native-packets"); mkdirSync(packetRoot, {recursive: true});
    writeFileSync(join(packetRoot, "0"), "inert file bytes, never executed");
    for (const command of ["/bin/sh 0</dev/null", "printf 2>/dev/null '%n' TARGET"])
      expect(agyHookShellApplicable([{command}], root), command).toBe(true);
    for (const command of ["/bin/sh '0'</dev/null", "/bin/sh 0 </dev/null"])
      expect(agyHookShellApplicable([{command}], root), command).toBe(false);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

it.each([
  'if false; then "$a$b$c"; fi', 'false && "$a$b$c"', 'true || "$a$b$c"',
  'if false; then :; "$a$b$c"; fi', 'if false; then :\n"$a$b$c"; fi',
  'if false; then : | "$a$b$c"; fi', 'f() { "$a$b$c"; }; :',
  'if false; then ( "$a$b$c" ); fi', 'if false; then { "$a$b$c"; }; fi',
  'if false; then 2>/dev/null "$a$b$c"; fi', 'if false; then exec "$a$b$c"; fi',
  'if false; then 2>&1 "$a$b$c"; fi', 'alias invoke=\'"$a$b$c"\'; if false; then invoke; fi',
  'if false; then trap \'"$a$b$c"\' EXIT; fi',
  'if false; then command "$a$b$c"; fi', 'if false; then env "$a$b$c"; fi',
  'if false; then printf "%s" "$("$a$b$c")"; fi',
  'if false; then /bin/sh -o errexit -c \'"$a$b$c"\'; fi',
])("refuses computed command grammar without evaluating it: %s", async body => {
  const { acquireAgyHookShellPolicy, agyHookShellApplicable, hookCommand } = await import("../../src/pilot/agy-hook-shell.js");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "computed-reference-")));
  try {
    const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
    const command = "/bin/sh -c " + quote(`a=${quote(homedir() + "/.or")}; b=ca/agent-hooks/antigravity; c=-hook.sh\n${body}`);
    const extra = { type: "command", command, timeout: 10 };
    expect(agyHookShellApplicable([extra], root)).toBe(true);
    const installed = join(realpathSync(homedir()), ".orca/agent-hooks/antigravity-hook.sh");
    const descriptors = ["PreInvocation", "PostInvocation", "Stop", "PreToolUse", "PostToolUse"].map(e => ({type: "command", command: hookCommand(installed, e), timeout: 10}));
    const r = acquireAgyHookShellPolicy({workspace: root, executable: "/nonexistent-fixture", version: "1.4.12", basePath: "/bin", descriptors: [...descriptors, extra]});
    expect(r.policy).toBeUndefined(); expect(r.unavailable).toEqual(["AGY_HOOK_DESCRIPTOR_UNSUPPORTED"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.each([false, true])("resolves acquisition against provider cwd, existing=%s, without creating it", async present => {
  const { acquireAgyHookShellPolicy, agyHookShellApplicable, hookCommand } = await import("../../src/pilot/agy-hook-shell.js");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "provider-cwd-")));
  try {
    const installed = join(realpathSync(homedir()), ".orca/agent-hooks/antigravity-hook.sh");
    symlinkSync(installed, join(root, "ordinary-alias"));
    if (present) mkdirSync(join(root, ".council/native-packets"), {recursive: true});
    const before = readdirSync(root);
    const extra = {type: "command", command: "/bin/sh ../../ordinary-alias", timeout: 10};
    expect(agyHookShellApplicable([extra], root)).toBe(true);
    const descriptors = ["PreInvocation", "PostInvocation", "Stop", "PreToolUse", "PostToolUse"].map(e => ({type: "command", command: hookCommand(installed, e), timeout: 10}));
    const r = acquireAgyHookShellPolicy({workspace: root, executable: "/nonexistent-fixture", version: "1.4.12", basePath: "/bin", descriptors: [...descriptors, extra]});
    expect(r.policy).toBeUndefined(); expect(r.unavailable).toEqual(["AGY_HOOK_DESCRIPTOR_UNSUPPORTED"]);
    expect(readdirSync(root)).toEqual(before);
    expect(agyHookShellApplicable([{command: '/bin/sh -c \'printf "%s" "$BENIGN_VALUE"\''}], root)).toBe(false);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

// The unsupported descriptor must be rejected before any binary/source pin is
// considered. No command (including the inert branch) is executed here.
it.each(["dot", "parent", "separators", "quoted", "home", "tilde", "symlink", "continuation"])("rejects the entire acquisition for an extra %s source reference", async spelling => {
  const { acquireAgyHookShellPolicy, hookCommand } = await import("../../src/pilot/agy-hook-shell.js");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "reference-case-")));
  const installed = join(realpathSync(homedir()), ".orca/agent-hooks/antigravity-hook.sh");
  const alias = join(root, "innocent-alias");
  try {
    symlinkSync(installed, alias);
    const forms: Record<string, string> = {
      dot: installed.replace("/antigravity", "/./antigravity"),
      parent: installed.replace("/agent-hooks/", "/agent-hooks/../agent-hooks/"),
      separators: installed.replace("/agent-hooks/", "//agent-hooks///"),
      quoted: '"' + installed.replace("/antigravity", "/./antigravity") + '"',
      home: '"$HOME/.orca/agent-hooks/antigravity-hook.sh"',
      tilde: "~/.orca/agent-hooks/antigravity-hook.sh", symlink: alias,
      continuation: installed.replace(".orca", ".or\\\nca").replace("antigravity-hook", "antigravity-ho\\\nok"),
    };
    const descriptors = ["PreInvocation", "PostInvocation", "Stop", "PreToolUse", "PostToolUse"].map(event => ({type: "command", command: hookCommand(installed, event), timeout: 10}));
    const result = acquireAgyHookShellPolicy({workspace: root, executable: "/nonexistent-fixture-agy", version: "1.4.12", basePath: "/usr/bin:/bin",
      descriptors: [...descriptors, {type: "command", command: `if false; then /bin/sh ${forms[spelling]}; fi`, timeout: 10}]});
    expect(result.policy).toBeUndefined();
    expect(result.unavailable).toEqual(["AGY_HOOK_DESCRIPTOR_UNSUPPORTED"]);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

// This checks the serialized environment contract only, never host qualification.
// An omitted selection lets Apple's Python shim follow a later global switch.
it("requires the pinned developer selection in the strict clean environment", () => {
  const environment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", PYTHONNOUSERSITE: "1",
    PYTHONDONTWRITEBYTECODE: "1", __CF_USER_TEXT_ENCODING: "0x1:0:0" };
  const schema = contracts.agyHookShellPolicySchema.shape.environment;
  expect(schema.safeParse(environment).success, "missing selection must refuse").toBe(false);
  expect(schema.safeParse({ ...environment, DEVELOPER_DIR: "/Library/Developer/CommandLineTools" }).success).toBe(true);
  expect(schema.safeParse({ ...environment, DEVELOPER_DIR: "/Applications/OtherXcode.app" }).success).toBe(false);
  expect(schema.safeParse({ ...environment, DEVELOPER_DIR: "/Library/Developer/CommandLineTools", EXTRA: "inherited" }).success).toBe(false);
});

describe("scoped hook materialization contract", () => {
  // Break caught: serialization drops/refuses executable or read-only modes,
  // leaving the wrapper unable to install the shell boundary with its required mode.
  it.each([0o400, 0o500, 0o600])("round-trips explicit mode %i", mode => {
    const material = { path: "/fixture/packet/sh", content: "fixture", sha256: contracts.sha256("fixture"), mode };
    const parsed = contracts.recipeSchema.parse({ ...recipe, materializations: [material] });
    expect(parsed.materializations?.[0]).toEqual(material);
  });

  // Break caught: accepting writable/executable or special-bit modes broadens
  // the immutable artifact contract beyond its three reviewed permissions.
  it.each([0, 0o200, 0o700, 0o755, 0o1500, 0o4500, "500", null])("rejects unsupported mode %s", mode => {
    expect(contracts.recipeSchema.safeParse({ ...recipe, materializations: [
      { path: "/fixture/packet/sh", content: "fixture", sha256: contracts.sha256("fixture"), mode },
    ] }).success).toBe(false);
  });

  it("preserves legacy materializations without injecting a mode", () => {
    const material = { path: "/fixture/packet/settings.json", content: "{}", sha256: contracts.sha256("{}") };
    expect(contracts.recipeSchema.parse({ ...recipe, materializations: [material] }).materializations).toEqual([material]);
  });
});

// These are staged tests for the reviewed new interface. Missing interface RED
// is separate from the private real-producer semantic RED. No fake binary is
// promoted to a supported identity and no qualification/reader override exists.
describe("scoped hook policy acquisition rejects unsupported identities", () => {
  it.each(["raw", "posix-quoted"])("does not acquire a policy for an unreviewed binary and %s custom descriptor", async spelling => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "hook's space $literal `text`-")));
    try {
      const workspace = join(root, "workspace"); mkdirSync(workspace);
      const executable = join(root, "agy");
      writeFileSync(executable, "#!/bin/sh\nexit 97\n", { mode: 0o700 }); chmodSync(executable, 0o700);
      const hook = join(root, "hook's script.sh");
      writeFileSync(hook, "#!/bin/sh\n# ORCA_ENDPOINT is deliberately inert fixture text\nexit 98\n", { mode: 0o500 });
      const quoted = "'" + hook.replaceAll("'", "'\\''") + "'";
      const command = (spelling === "raw" ? hook : quoted) + " unreviewed-extra-argument";
      const before = readdirSync(workspace);
      // Variable import lets the other contract tests run before this new module exists.
      const modulePath = "../../src/pilot/agy-hook-shell.js";
      const { acquireAgyHookShellPolicy } = await import(modulePath);
      const result = acquireAgyHookShellPolicy({ workspace, executable, version: "1.4.12",
        descriptors: [{ type: "command", command, timeout: 10 }], basePath: "/usr/bin:/bin" });
      expect(result.policy).toBeUndefined();
      expect(result.unavailable.length).toBeGreaterThan(0);
      expect(readdirSync(workspace)).toEqual(before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

// Break caught: accepting a caller-authored receipt or serializable reader as a
// source policy. The positive schema shape must come from the real producer.
it.each([{}, { qualified: true }, { reader: "trust-me", qualified: true }])("rejects incomplete or caller-qualified hook policy %j", value => {
  const schema = (contracts as unknown as Record<string, { safeParse(value: unknown): { success: boolean } }>).agyHookShellPolicySchema;
  expect(schema, "new strict source-bound policy interface").toBeDefined();
  expect(schema!.safeParse(value).success).toBe(false);
});

// Exercise the actual wrapper materializer without starting any child. Its next
// independent guard deliberately rejects the absent agent definition. This is
// a pre-spawn unit boundary, never evidence for an AGY executable identity.
async function withMaterialization(mode: 0o400 | 0o500 | 0o600 | undefined, check: (a: WrapperAssignment, file: string) => Promise<void>) {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "material's space $literal `text`-")));
  try {
    const packetRoot = join(workspace, ".council/native-packets");
    const directory = join(workspace, "attempt"); mkdirSync(directory);
    mkdirSync(packetRoot, { recursive: true });
    const file = join(packetRoot, "sh");
    const material = { path: file, content: "inert profile fixture\n", sha256: contracts.sha256("inert profile fixture\n"), ...(mode === undefined ? {} : { mode }) };
    const a: WrapperAssignment = {
      version: 1, runtimeId: "synthetic", workspace, workspaceId: "synthetic", directory,
      identity: { handle: "fixture", worktreeId: "fixture", ptyId: "fixture", incarnationId: "fixture", paneKey: "fixture" },
      binding: { runId: "fixture", taskId: "fixture", dispatchId: "fixture", handle: "fixture", attemptKey: "fixture" },
      dispatchIncarnation: "fixture", producerHash: "fixture", phase: "readiness", role: "gemini",
      selection: { route: "antigravity", model: "gemini-4-argon-high", effort: "high" },
      packetHash: contracts.sha256(""), packet: "", controlsHash: "fixture", policyHash: "fixture", deadline: Date.now() + 1000, orca: "/must-never-execute",
      recipe: { protocol: "agy-stream", executable: "/must-never-execute", argv: [], cwd: packetRoot, version: "1.4.12",
        selection: { route: "antigravity", model: "gemini-4-argon-high", effort: "high" }, expectedPermission: "request-review",
        sources: [], facts: [], agent: "deliberately-unbound", materializations: [material] },
    };
    await check(a, file);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
}

// Break caught: ignoring the explicit mode writes a non-executable adapter,
// permitting PATH lookup to skip it. The legacy default remains 0600.
it.each([0o400, 0o500, 0o600, undefined] as const)("materializes exact mode %s before provider initialization", async mode => {
  await withMaterialization(mode, async (a, file) => {
    await expect(runProviderSession(a, "fixture-assignment")).rejects.toThrow("PROVIDER_AGENT_DEFINITION_UNBOUND");
    expect(lstatSync(file).mode & 0o7777).toBe(mode ?? 0o600);
    expect(readFileSync(file, "utf8")).toBe("inert profile fixture\n");
  });
});

// Break caught: accepting same-byte preexisting adapters with the wrong mode,
// or silently chmodding bad state into acceptance, bypasses the launch guard.
it.each([0o400, 0o600, 0o700, 0o2500, 0o4500])("refuses existing adapter mode %i without repairing it", async badMode => {
  await withMaterialization(0o500, async (a, file) => {
    writeFileSync(file, "inert profile fixture\n", { mode: badMode }); chmodSync(file, badMode);
    const before = lstatSync(file);
    await expect(runProviderSession(a, "fixture-assignment")).rejects.toThrow(/PROVIDER_PROFILE_/);
    expect(lstatSync(file).mode & 0o7777).toBe(before.mode & 0o7777);
    expect(lstatSync(file).ino).toBe(before.ino);
  });
});

// Break caught: following an existing symlink because its target has matching
// bytes and mode permits an artifact outside the packet to impersonate it.
it("rejects a same-byte executable symlink without changing its target", async () => {
  await withMaterialization(0o500, async (a, file) => {
    const target = join(a.workspace, "outside-profile");
    writeFileSync(target, "inert profile fixture\n", { mode: 0o500 });
    symlinkSync(target, file);
    const before = lstatSync(target);
    await expect(runProviderSession(a, "fixture-assignment")).rejects.toThrow(/PROVIDER_PROFILE_/);
    expect(lstatSync(file).isSymbolicLink()).toBe(true);
    expect(lstatSync(target).ino).toBe(before.ino);
    expect(readFileSync(target, "utf8")).toBe("inert profile fixture\n");
  });
});

// A raw replacement inside nested shell quotes executes fragments of the path.
// This stand-in tests shell syntax only; it is never admitted as an AGY identity.
it("reconstructs all five commands with nested POSIX quoting", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "command's space $literal `text`-")));
  try {
    const hook = join(root, "hook's script $literal `text`.sh");
    writeFileSync(hook, '#!/bin/sh\ncat >/dev/null\nprintf "%s\\n" "$ORCA_ANTIGRAVITY_EVENT"\n', { mode: 0o500 });
    const modulePath = "../../src/pilot/agy-hook-shell.js";
    const { hookCommand } = await import(modulePath);
    for (const event of ["PreInvocation", "PostInvocation", "Stop", "PreToolUse", "PostToolUse"]) {
      const result = spawnSync("/bin/sh", ["-c", hookCommand(hook, event)], { input: "test input\n", encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe(event + "\n");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
