import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../domain/hash.js";
import type { AgyHookShellPolicy, ProviderRecipe } from "./wrapper-contract.js";
import type { AuditSource } from "./control-audit.js";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const requireThat = (ok: unknown, reason: string): void => { if (!ok) throw Error("AGY_HOOK_" + reason); };
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const events = ["PreInvocation", "PostInvocation", "Stop", "PreToolUse", "PostToolUse"] as const;
const HOOK = "b55f5e6331033826216d58416c8e7e99dca18914a18acc17de4bd5f9d153c2f8";
const AGY = "34423fc9b0af3841e7646aa72a2d40ffeab8218b22d1cb99eac7355f9eba31e3";
const NODE = "210bbbc13dee7ee3913eef05cc9d7eaee5b327a86dfe524bfb8cb3e5949e50dc";
const DEVELOPER_DIR = "/Library/Developer/CommandLineTools";
const PYTHON = path.join(DEVELOPER_DIR, "Library/Frameworks/Python3.framework/Versions/3.9");
const PTH = path.join(PYTHON, "lib/python3.9/site-packages/distutils-precedence.pth");
const PTH_HASH = "7ea7ffef3fe2a117ee12c68ed6553617f0d7fd2f0590257c25c484959a3b7373";

/** Reconstruct the reviewed command at both shell quoting levels. */
export function hookCommand(hook: string, event: string): string {
  requireThat(events.includes(event as typeof events[number]), "EVENT_UNSUPPORTED");
  const drain = "{ command -p cat 2>/dev/null || cat; } >/dev/null 2>&1 || :;";
  const fallback = event === "PreToolUse" ? "printf '%s\\n' '{\"decision\":\"ask\"}'; " + drain : drain;
  return "/bin/sh -c " + quote(`if [ -f ${quote(hook)} ] && [ -r ${quote(hook)} ] && [ -x ${quote(hook)} ]; then ORCA_ANTIGRAVITY_EVENT=${quote(event)} /bin/sh ${quote(hook)}; else ${fallback} fi`);
}
function ids() {
  const uid = process.getuid?.(), gid = process.getgid?.();
  requireThat(uid !== undefined && gid !== undefined && uid === process.geteuid?.() && gid === process.getegid?.(), "UNEQUAL_REAL_EFFECTIVE_IDS");
  return { uid: uid!, gid: gid! };
}
function metadata(file: string) {
  const s = fs.lstatSync(file);
  return { dev: s.dev, ino: s.ino, uid: s.uid, gid: s.gid, mode: s.mode & 0o7777,
    type: s.isFile() ? "file" as const : s.isDirectory() ? "directory" as const : s.isSymbolicLink() ? "symlink" as const : "other" as const };
}
function identity(file: string): AgyHookShellPolicy["identities"][number] {
  const realpath = fs.realpathSync(file), entry = metadata(file), target = metadata(realpath);
  requireThat(target.type === "file", "SOURCE_NOT_REGULAR:" + file);
  fs.accessSync(realpath, fs.constants.R_OK | (target.mode & 0o100 ? fs.constants.X_OK : 0));
  return { path: file, realpath, entry, target, sha256: sha(fs.readFileSync(realpath)) };
}
function normalizedPath(value: string) {
  return value.split(path.delimiter).map(part => {
    requireThat(part && path.isAbsolute(part), "PATH_SEGMENT_INVALID");
    return path.normalize(part);
  }).join(path.delimiter);
}
function rejectWritablePythonSource(p: string) {
  let writable = false;
  try { fs.accessSync(p, fs.constants.W_OK); writable = true; }
  catch (e) { if (!["EACCES", "EPERM"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e; }
  requireThat(!writable, "PYTHON_SOURCE_WRITABLE:" + p);
}
function auditSource(file: string, kind: "file" | "metadata" | "absent"): AuditSource {
  if (kind === "absent") return { path: file, kind, sha256: null };
  const s = fs.lstatSync(file);
  const digest = kind === "file" ? sha(fs.readFileSync(file)) : sha(canonicalJson({ mode: s.mode, dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, symbolicLink: s.isSymbolicLink() }));
  return { path: file, kind, sha256: digest };
}

/** Conservative recognition, never shell evaluation or evidence of integrity.
 * Literal paths use lexical AND filesystem identity (including aliases). Shell
 * quote removal is only a candidate finder; recognizable indirect Orca text is
 * unsupported even when its branch would never execute. Arbitrary programs are
 * still subject to the generic dynamic-closure audit, not analyzed here.
 */
function referencesOrcaHook(command: string, targets: string[], cwd: string): boolean {
  if (command.length > 65536) return true;
  // Closed effects for the pinned Bash 3.2 builtins (bash(1), SHELL BUILTIN
  // COMMANDS). Everything outside the argument-only subset or the explicit
  // execution prefixes refuses. External programs keep their generic audit.
  // Keep these dependencies inside this function: its source is embedded in
  // both generated programs, not imported from the producer at runtime.
  const consumers = new Set([":", "true", "false", "echo", "printf", "test", "[", "pwd"]);
  const unsupported = new Set((". alias bg bind break caller cd compgen complete continue declare dirs disown enable eval exit export fc fg getopts hash help history jobs kill let local logout popd pushd read readonly return set shift shopt source suspend times trap type typeset ulimit umask unalias unset wait").split(" "));
  const prefixes = new Set(["exec", "command", "builtin"]);
  const regularProgram = (file: string): boolean => {
    if (!file || /^[+-]/.test(file)) return false;
    const candidate = path.isAbsolute(file) ? file : cwd + "/" + file;
    // Inspect symlink components before realpath can erase a /dev/fd alias.
    // No script bytes or stdin are read, including when an FD is a regular file.
    let pending = candidate.split("/"), resolved: string[] = [], links = 0;
    try {
      while (pending.length) {
        const part = pending.shift()!;
        if (!part || part === ".") continue;
        if (part === "..") { resolved.pop(); continue; }
        const current = "/" + [...resolved, part].join("/");
        if (/^\/dev\/(stdin|stdout|stderr|fd)(\/|$)/.test(current)) return false;
        if (fs.lstatSync(current).isSymbolicLink()) {
          if (++links > 40) return false;
          const target = fs.readlinkSync(current);
          if (path.isAbsolute(target)) resolved = [];
          pending = [...target.split("/"), ...pending];
        } else resolved.push(part);
      }
      return fs.statSync(fs.realpathSync.native(candidate)).isFile();
    } catch { return false; }
  };
  const queue = [{ text: command, program: true }], seen = new Set<string>();
  const targetStats = targets.map(p => { try { return fs.statSync(p); } catch { return undefined; } });
  while (queue.length) {
    const { text, program } = queue.shift()!;
    const key = (program ? "code:" : "path:") + text;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > 8192) return true;
    if (targets.some(p => text.includes(p) || text.includes("'" + p.replaceAll("'", "'\\''") + "'"))) return true;
    // Includes split/escaped spellings and HOME/tilde/computed prefixes. These
    // names are deliberately conservative, not an allow-list of path variants.
    if (/antigravity-hook|\.orca|ORCA_/i.test(text.replace(/\\\n/g, "").replace(/[\\'"]/g, ""))) return true;
    // A bounded shell recognizer, not evaluation. Preserve operators and quote
    // provenance; only shell program operands are recursively parsed as code.
    // Active substitutions, here-documents and unsupported grammar fail closed.
    const tokens: { value: string; operator: boolean; dynamic: boolean; quoted: boolean; ioNumber?: boolean }[] = [];
    let word = "", quoted = "", escaped = false, dynamic = false, protectedWord = false, started = false;
    const flush = (ioNumber = false) => { if (started) tokens.push({ value: word, operator: false, dynamic, quoted: protectedWord, ioNumber }); word = ""; dynamic = false; protectedWord = false; started = false; };
    for (let n = 0; n < text.length; n++) {
      const ch = text[n]!;
      if (escaped) { if (ch !== "\n") { word += ch; started = true; } escaped = false; continue; }
      if (ch === "\\" && quoted !== "'") { escaped = true; protectedWord = true; continue; }
      if (ch === "'" || ch === '"') {
        if (!quoted) { quoted = ch; protectedWord = true; started = true; continue; }
        if (quoted === ch) { quoted = ""; continue; }
      }
      if (program && quoted !== "'" && (ch === "`" || (ch === "$" && text[n + 1] === "("))) return true;
      if (quoted !== "'" && ch === "$") dynamic = true;
      if (!quoted && /[~*?\[]/.test(ch)) dynamic = true;
      if (!quoted && ch === "#" && !started) { while (n < text.length && text[n] !== "\n") n++; flush(); tokens.push({ value: "\n", operator: true, dynamic: false, quoted: false }); continue; }
      if (!quoted && /[\s;|&()<>]/.test(ch)) {
        flush(/[<>]/.test(ch) && !protectedWord && /^\d+$/.test(word));
        if (!/[ \t\r]/.test(ch)) {
          const pair = ch + (text[n + 1] ?? "");
          const operator = ["&&", "||", ";;", "|&", "<<", ">>", "<&", ">&", "<>", ">|", "&>"].includes(pair) ? pair : ch;
          if (operator.length === 2) n++;
          tokens.push({ value: operator, operator: true, dynamic: false, quoted: false });
        }
      } else { word += ch; started = true; }
    }
    if (program && (quoted || escaped)) return true;
    flush();
    const words = tokens.filter(t => !t.operator).map(t => t.value);
    let commandPosition = true, redirect = false, executable = "", shellProgram = false, prefix = "", printfFormat = false;
    for (let i = 0; program && i < tokens.length; i++) {
      const token = tokens[i]!, value = token.value;
      if (token.operator) {
        if (value === "&>") return true;
        if (/^[<>]/.test(value)) {
          if (value === "<<") return true;
          redirect = true; continue;
        }
        // A bare shell reads a program from stdin. Never discard its pending
        // program source at a separator, closing construct, pipeline or EOF.
        if (shellProgram || prefix || redirect) return true;
        commandPosition = true; executable = ""; printfFormat = false; continue;
      }
      if (redirect) { redirect = false; continue; }
      if (token.ioNumber) continue;
      if (commandPosition) {
        // Redirections and env assignments can separate a prefix from options.
        // Refuse when the option is reached, not just in adjacent lookahead.
        if (prefix && value.startsWith("-")) return true;
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) { if (prefix && prefix !== "env") return true; continue; }
        if (!prefix && !token.quoted && /^(if|then|elif|else|while|until|do|done|fi|!|\{|\})$/.test(value)) continue;
        if (!token.quoted && /^(for|case|select|function|coproc|\[\[|time)$/.test(value)) return true;
        if ((token.dynamic && value !== "[") || !value) return true;
        executable = path.basename(value);
        if (prefix === "builtin" && !consumers.has(value) && !prefixes.has(value)) return true;
        // The inspected macOS /usr/bin/command is a shell wrapper for the builtin.
        // This known standard path does not classify arbitrary external tools.
        if (prefixes.has(value) || value === "/usr/bin/command" || executable === "env") {
          prefix = executable;
          continue;
        }
        if (unsupported.has(value)) return true;
        prefix = "";
        commandPosition = false;
        shellProgram = /^(sh|bash|zsh|dash|ksh)$/.test(executable);
        printfFormat = value === "printf";
      } else if (shellProgram) {
        if (token.dynamic) return true;
        // Only the literal -c program form and plain script operands are
        // recognized. Other option grammars (including options with operands)
        // are deliberately unsupported, never guessed or executed.
        if (value === "-c") {
          const body = tokens[++i];
          if (!body || body.operator || body.dynamic || body.ioNumber) return true;
          queue.push({ text: body.value, program: true });
        } else {
          if (!regularProgram(value)) return true;
        }
        shellProgram = false;
      } else if (printfFormat) {
        // Bash printf -v and %n mutate variables. Admit only literal formats
        // with argument-consuming conversions; unknown forms fail closed.
        if (token.dynamic) return true;
        if (value === "--") continue;
        if (value.startsWith("-") || value.replace(/%%|%[-+ #0]*(?:\d+|\*)?(?:\.(?:\d+|\*))?[diouxXfFeEgGaAcsbq]/g, "").includes("%")) return true;
        printfFormat = false;
      }
      // A cwd-changing command makes later relative resolution uncertain.
      if (executable === "cd" || executable === "pushd" || executable === "popd") return true;
    }
    if (program && (shellProgram || prefix || redirect)) return true;
    for (let i = 0; i < words.length; i++) {
      const value = words[i]!;
      if (value !== text) queue.push({ text: value, program: false });
      const candidate = path.isAbsolute(value) ? value : cwd + "/" + value;
      if (targets.some(p => path.resolve(candidate) === path.resolve(p))) return true;
      try {
        // Do not normalize away a symlink/.. pair before filesystem lookup.
        const real = fs.realpathSync.native(candidate);
        if (targets.includes(real)) return true;
        const s = fs.statSync(real);
        if (targetStats.some(t => t && t.dev === s.dev && t.ino === s.ino)) return true;
      } catch (e) {
        if (!["ENOENT", "ENOTDIR", "ENAMETOOLONG"].includes((e as NodeJS.ErrnoException).code ?? "")) return true;
        // Audit may precede packet-root creation. A relative filesystem lookup
        // through that absent cwd cannot establish that a candidate is unrelated.
        if (!path.isAbsolute(value) && value.includes("/") && !fs.existsSync(cwd)) return true;
      }
    }
  }
  return false;
}

type Core = {
  policy: AgyHookShellPolicy; policyHash: string; assignmentHash: string; producerHash: string;
  run: string; bin: string; empty: string; scratch: string; copy: string; adapter: string; verifier: string;
  commands: string[]; copiedCommands: string[]; launchPath: string;
  directories: { path: string; dev: number; ino: number; uid: number; gid: number }[];
};
// Both exec boundaries use this policy map. The explicit developer directory
// makes Apple's /usr/bin/python3 shim independent of the global selection.
function cleanEnvironment(c: Core, temporary = c.scratch) { return { ...c.policy.environment, HOME: c.empty, TMPDIR: temporary }; }
// Reconstruct literal argv, including the outer program source, for the same
// classifier used at acquisition. This exact helper is embedded in the verifier.
function shellInvocation(argv: string[]): string {
  return "/bin/sh " + argv.map(value => "'" + value.replaceAll("'", "'\\''") + "'").join(" ");
}
function adapterText(c: Core, verifierHash: string): string {
  const matches = c.commands.map((cmd, i) => `    ${quote(cmd)}) selected=${i} ;;`).join("\n");
  const classifier = "const fs=require('node:fs'),path=require('node:path');const invocation=" + shellInvocation.toString() + ";const references=" + referencesOrcaHook.toString()
    + ";try{const targets=JSON.parse(process.argv[1]);if(references(invocation(process.argv.slice(2)),targets,process.cwd()))process.exitCode=76;}catch{process.exitCode=76;}";
  const env = Object.entries(cleanEnvironment(c)).sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, v]) => k + "=" + quote(v)).join(" ");
  return `#!/bin/sh -p
if [ "$UID" != "$EUID" ]; then exit 76; fi
selected=
if [ "$#" = 2 ] && [ "$1" = '-c' ]; then
  case "$2" in
${matches}
  esac
fi
if [ -n "$selected" ]; then
  cd ${quote(c.empty)} || exit 76
  exec /usr/bin/env -i ${env} ${quote(c.policy.node)} ${quote(c.verifier)} --run ${quote(canonicalJson(c))} ${quote(verifierHash)} "$selected"
  exit 76
fi
if ! /usr/bin/env -i ${env} ${quote(c.policy.node)} -e ${quote(classifier)} ${quote(JSON.stringify([c.policy.installed, c.copy]))} "$@"; then
  printf '%s\\n' 'UNRECOGNIZED_ORCA_COMMAND' >&2; exit 76
fi
exec /bin/sh "$@"
`;
}

// Standalone builtin-only verifier. Its bytes, renderer and command templates
// are part of the static policy; the producer manifest binds this module too.
const verifierSource = String.raw`import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const sha = b => createHash('sha256').update(b).digest('hex');
const sort = v => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
const canonical = v => JSON.stringify(sort(v));
const need = (ok, why) => { if (!ok) throw Error(why); };
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
function metadata(p) { const s = fs.lstatSync(p); return {dev:s.dev,ino:s.ino,uid:s.uid,gid:s.gid,mode:s.mode & 0o7777,type:s.isFile()?'file':s.isDirectory()?'directory':s.isSymbolicLink()?'symlink':'other'}; }
function identity(p) { const realpath=fs.realpathSync(p); return {path:p,realpath,entry:metadata(p),target:metadata(realpath),sha256:sha(fs.readFileSync(realpath))}; }
function file(p, mode, hash) { const m=metadata(p); need(m.type==='file' && fs.realpathSync(p)===p && m.uid===process.geteuid() && m.mode===mode,'FILE_CUSTODY:'+p); fs.accessSync(p,fs.constants.R_OK | (mode & 0o100 ? fs.constants.X_OK : 0)); need(sha(fs.readFileSync(p))===hash,'FILE_BYTES:'+p); }
function cleanEnvironment(c, temporary=c.scratch) { return {...c.policy.environment,HOME:c.empty,TMPDIR:temporary}; }
const canonicalJson = canonical;
${referencesOrcaHook.toString()}
${shellInvocation.toString()}
${adapterText.toString()}
try {
  const c=JSON.parse(process.argv[3]), verifierHash=process.argv[4], index=Number(process.argv[5]), p=c.policy;
  need(process.argv[2]==='--run' && process.platform==='darwin' && process.versions.node.startsWith('22.'),'HOST');
  need(process.getuid()===process.geteuid() && process.getgid()===process.getegid() && process.getuid()===p.uid && process.getgid()===p.gid,'IDS');
  need(p.route==='antigravity' && p.environment.DEVELOPER_DIR==='/Library/Developer/CommandLineTools' && p.environment.__CF_USER_TEXT_ENCODING==='0x'+p.uid.toString(16).toUpperCase()+':0:0','POLICY');
  need(p.executionCwd===path.join(p.workspace,'.council/native-packets'),'EXECUTION_CWD');
  need(canonical(process.env)===canonical(cleanEnvironment(c)) && process.cwd()===c.empty,'VERIFIER_NOT_ALREADY_CLEAN');
  need(fileURLToPath(import.meta.url)===c.verifier && fs.realpathSync(process.execPath)===p.node,'NODE_OR_VERIFIER_PATH');
  need(sha(canonical(p))===c.policyHash && /^[a-f0-9]{64}$/.test(c.assignmentHash) && /^[a-f0-9]{64}$/.test(c.producerHash),'BINDING');
  need(c.empty!==c.scratch && path.dirname(c.empty)===c.run && path.dirname(c.scratch)===c.run && path.dirname(c.bin)===c.run,'ROOTS');
  need(c.launchPath===c.bin+':'+p.basePath && p.basePath.split(':').every(s=>s && path.isAbsolute(s) && path.normalize(s)===s),'PATH');
  for(const d of c.directories) { const m=metadata(d.path); need(m.type==='directory' && fs.realpathSync(d.path)===d.path && ['dev','ino','uid','gid'].every(k=>d[k]===m[k]) && !(m.mode & 0o022),'DIRECTORY_CUSTODY:'+d.path); }
  for(const [dir,mode] of [[c.run,0o700],[c.bin,0o500],[c.empty,0o500],[c.scratch,0o700]]) { const m=metadata(dir); need(m.type==='directory' && m.uid===p.uid && m.mode===mode,'DIRECTORY_MODE:'+dir); }
  need(fs.readdirSync(c.empty).length===0 && canonical(fs.readdirSync(c.bin).sort())===canonical(['hook.sh','sh','verify-hook.mjs']),'CONTENTS');
  for(const s of p.identities) need(canonical(identity(s.path))===canonical(s),'SOURCE_DRIFT:'+s.path);
  for(const d of p.startupDirectories) need(canonical(metadata(d.path))===canonical(d.metadata) && canonical(fs.readdirSync(d.path).sort())===canonical(d.entries),'STARTUP_DRIFT:'+d.path);
  for(const a of p.absences) { try { fs.lstatSync(a); throw Error('STARTUP_APPEARED:'+a); } catch(e) { if(e.code!=='ENOENT') throw e; } }
  file(p.installed,0o755,sha(p.hookContent)); file(c.copy,0o500,sha(p.hookContent)); file(c.verifier,0o400,verifierHash); file(c.adapter,0o500,sha(adapterText(c,verifierHash)));
  need(Number.isInteger(index) && index>=0 && index<c.copiedCommands.length,'COMMAND_INDEX');
  const temporary=fs.mkdtempSync(path.join(c.scratch,'invocation-'));
  need(metadata(temporary).mode===0o700,'TEMPORARY_MODE');
  const result=spawnSync('/bin/sh',['-c',c.copiedCommands[index]],{env:cleanEnvironment(c,temporary),cwd:c.empty,stdio:[0,1,2],timeout:10000,killSignal:'SIGKILL'});
  if(result.error || result.signal || result.status===null) throw Error('HOOK_PROCESS_UNSETTLED');
  process.exitCode=result.status;
} catch(e) { console.error('HOOK_PROFILE_REFUSED:'+e.message); process.exitCode=76; }
`;
const templateHash = () => sha(canonicalJson({ verifierSource, adapter: adapterText.toString(), command: hookCommand.toString() }));

/** Applicability is not acquisition or integrity approval. Ambiguity opts in to
 * the strict acquisition failure, never out of the generic source guards. */
export function agyHookShellApplicable(descriptors: readonly unknown[], workspace: string): boolean {
  const installed = path.join(homedir(), ".orca/agent-hooks/antigravity-hook.sh");
  let cwd: string;
  try { cwd = hookExecutionCwd(workspace); } catch { return true; }
  return descriptors.some(d => !!d && typeof d === "object" && typeof (d as { command?: unknown }).command === "string"
    && referencesOrcaHook((d as { command: string }).command, [installed], cwd));
}

function hookExecutionCwd(workspace: string): string {
  const root = fs.realpathSync(workspace);
  for (const p of [path.join(root, ".council"), path.join(root, ".council/native-packets")]) {
    try { requireThat(fs.lstatSync(p).isDirectory() && fs.realpathSync(p) === p, "EXECUTION_CWD_UNVERIFIED"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  return path.join(root, ".council/native-packets");
}

/** Read-only acquisition. No Python, profile writer, endpoint or provider runs. */
export function acquireAgyHookShellPolicy(input: { workspace: string; executable: string; version: string; descriptors: readonly unknown[]; basePath: string }): { policy?: AgyHookShellPolicy; sources: AuditSource[]; effects: string[]; unavailable: string[] } {
  const sources: AuditSource[] = [];
  try {
    const installed = path.join(fs.realpathSync(homedir()), ".orca/agent-hooks/antigravity-hook.sh");
    const executionCwd = hookExecutionCwd(input.workspace);
    const descriptors = input.descriptors.filter((d): d is AgyHookShellPolicy["descriptors"][number] => !!d && typeof d === "object" && typeof (d as { command?: unknown }).command === "string" && referencesOrcaHook((d as { command: string }).command, [installed], executionCwd));
    const { uid, gid } = ids();
    requireThat(process.platform === "darwin" && process.versions.node.startsWith("22."), "HOST_UNSUPPORTED");
    requireThat(/(?:^|\s)1\.4\.12(?:\s|$)/.test(input.version), "VERSION_UNSUPPORTED");
    const commands = events.map(event => hookCommand(installed, event));
    requireThat(descriptors.length >= 5 && commands.every(cmd => descriptors.some(d => d.command === cmd)), "DESCRIPTOR_SET_INCOMPLETE");
    requireThat(descriptors.every(d => canonicalJson(Object.keys(d).sort()) === canonicalJson(["command", "timeout", "type"]) && d.type === "command" && d.timeout === 10 && commands.includes(d.command)), "DESCRIPTOR_UNSUPPORTED");
    const executable = fs.realpathSync(input.executable), node = fs.realpathSync(process.execPath);
    const pinned: [string, string][] = [[installed, HOOK], [executable, AGY], [node, NODE],
      ["/bin/sh", "68c831f7c8468a09979fa812f3cab7b2043a42101160a526a20a09719db342fa"],
      ["/usr/bin/env", "879e3c28ef4de608a1e9b19254c558c4fa1e29889ff9bb63d87e0254baa6336d"],
      ["/usr/bin/python3", "5b1ddb7e9c11b87a034fc88b212e8ac243cfe2b4db696d767aa44c79595fc09a"],
      ["/bin/cat", "ac813098b70d6e2b4c5a3b9f47b99cc10244faf41da890744c9651c3c35d520a"],
      [path.join(PYTHON, "bin/python3.9"), "6e7ae61f68a3838094fc56590f84c52069a97d7816f6bb79e0e85995b340e464"],
      [PTH, PTH_HASH],
      [path.join(PYTHON, "lib/python3.9/codecs.py"), "8c88dc3fa4a2b85759c8c5394dce9c0a5248e99ea85fc57f42d7372da0e69256"],
      [path.join(PYTHON, "lib/python3.9/os.py"), "8dbe2d2e9f228747cacbbcc6758721e794b652e5c22b6224cb07e303ebbc620d"],
      [path.join(PYTHON, "lib/python3.9/site.py"), "6e0d45439151498e8d7901f4dc66a6d7c99054132340fe4492ea01be5ab95332"],
      [path.join(PYTHON, "lib/python3.9/json/__init__.py"), "332fabb72a4a1ed02c9207a7619ab339dac8f0b6862e16f6499147121b302a27"],
      [path.join(PYTHON, "lib/python3.9/lib-dynload/select.cpython-39-darwin.so"), "ccaf7008e6bd6f14219d986b5f3bfffb4034645d2f96a42d7b01f2a4bb11abdb"]];
    const identities = pinned.map(([p, hash]) => {
      const s = identity(p), expectedMode = p === node ? 0o555 : /\.(py|pth)$/.test(p) ? 0o644 : 0o755;
      const expectedOwner = [installed, executable, node].includes(p) ? uid : 0;
      requireThat(s.sha256 === hash && s.target.mode === expectedMode && s.target.uid === expectedOwner, "SOURCE_UNSUPPORTED:" + p);
      if (p.startsWith(PYTHON + "/")) rejectWritablePythonSource(s.realpath);
      sources.push(auditSource(s.realpath, "file"));
      sources.push(auditSource(s.realpath, "metadata"));
      if (p !== s.realpath) sources.push(auditSource(p, "metadata"));
      return s;
    });
    requireThat(identities[0]!.entry.type === "file" && identities[0]!.target.mode === 0o755 && identities[0]!.target.uid === uid, "ORIGINAL_CUSTODY");
    const roots = ["lib/python3.9", "lib/python3.9/lib-dynload", "lib/python3.9/site-packages"].map(p => path.join(PYTHON, p));
    const startupDirectories = roots.map(p => {
      const m = metadata(p); requireThat(m.type === "directory" && fs.realpathSync(p) === p && m.uid === 0 && !(m.mode & 0o022), "PYTHON_ROOT_CUSTODY:" + p);
      rejectWritablePythonSource(p);
      const entries = fs.readdirSync(p).sort();
      for (const name of entries) if (/\.pth$|^(sitecustomize|usercustomize)(\.|$)/.test(name)) requireThat(path.join(p, name) === PTH, "PYTHON_STARTUP_UNSUPPORTED:" + name);
      sources.push(auditSource(p, "metadata"));
      return { path: p, metadata: m, entries };
    });
    const absences = [path.join(PYTHON, "lib/python39.zip"), ...roots.flatMap(p => ["sitecustomize.py", "sitecustomize.pyc", "sitecustomize", "usercustomize.py", "usercustomize.pyc", "usercustomize"].map(n => path.join(p, n)))];
    for (const p of absences) { try { fs.lstatSync(p); throw Error("AGY_HOOK_STARTUP_APPEARED:" + p); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; } sources.push(auditSource(p, "absent")); }
    // Bind the CLT executable symlink as well as its pinned target.
    const launcher = identity(path.join(DEVELOPER_DIR, "usr/bin/python3"));
    requireThat(launcher.realpath === path.join(PYTHON, "bin/python3.9") && launcher.sha256 === pinned[7]![1], "PYTHON_LAUNCHER");
    identities.push(launcher); sources.push(auditSource(launcher.path, "metadata"));
    const policy: AgyHookShellPolicy = { version: 1, contract: "agy-orca-hook-v1", route: "antigravity", workspace: fs.realpathSync(input.workspace), executionCwd, executable, providerVersion: input.version,
      basePath: normalizedPath(input.basePath), uid, gid, node, installed, hookContent: fs.readFileSync(installed, "utf8"), templateHash: templateHash(),
      descriptors, identities, startupDirectories, absences, environment: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", DEVELOPER_DIR, PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1", __CF_USER_TEXT_ENCODING: "0x" + uid.toString(16).toUpperCase() + ":0:0" } };
    return { policy, sources, effects: ["agy-orca-hook-scoped-runtime:" + sha(canonicalJson(policy)), "agy-system-python-clt-runtime-and-cache-effects"], unavailable: [] };
  } catch (e) { return { sources, effects: [], unavailable: [e instanceof Error ? e.message : "AGY_HOOK_ACQUISITION_UNAVAILABLE"] }; }
}

function directory(p: string, mode: number) {
  const m = metadata(p);
  requireThat(m.type === "directory" && fs.realpathSync(p) === p && m.uid === ids().uid && m.mode === mode, "DIRECTORY_CUSTODY:" + p);
}
function ownedDirectory(p: string, mode: number): boolean {
  try { fs.mkdirSync(p, { mode }); directory(p, mode); return true; }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; directory(p, mode); return false; }
}
function file(p: string, mode: number, hash: string) {
  const m = metadata(p); requireThat(m.type === "file" && fs.realpathSync(p) === p && m.uid === ids().uid && m.mode === mode, "FILE_CUSTODY:" + p);
  fs.accessSync(p, fs.constants.R_OK | (mode & 0o100 ? fs.constants.X_OK : 0));
  requireThat(sha(fs.readFileSync(p)) === hash, "FILE_BYTES:" + p);
}
function custody(p: string): Core["directories"] {
  const result: Core["directories"] = [];
  for (let q = p; ; q = path.dirname(q)) {
    const m = metadata(q); requireThat(m.type === "directory" && fs.realpathSync(q) === q && !(m.mode & 0o022) && [0, ids().uid].includes(m.uid), "ANCESTOR_CUSTODY:" + q);
    result.push({ path: q, dev: m.dev, ino: m.ino, uid: m.uid, gid: m.gid }); if (q === path.dirname(q)) break;
  }
  return result;
}
export function instantiateAgyHookShellPolicy(policy: AgyHookShellPolicy, context: { packetRoot: string; directory: string; assignmentHash: string }, materialize: (files: NonNullable<ProviderRecipe["materializations"]>) => void): { launchPath: string; instanceHash: string; reportPath: string } {
  ids();
  requireThat(/^[a-f0-9]{64}$/.test(context.assignmentHash) && context.packetRoot === path.join(policy.workspace, ".council/native-packets") && context.packetRoot === policy.executionCwd && path.isAbsolute(context.directory), "ASSIGNMENT_SCOPE");
  const fresh = acquireAgyHookShellPolicy({ workspace: policy.workspace, executable: policy.executable, version: policy.providerVersion, descriptors: policy.descriptors, basePath: policy.basePath });
  requireThat(fresh.policy && canonicalJson(fresh.policy) === canonicalJson(policy), "POLICY_DRIFT:" + fresh.unavailable.join(","));
  custody(context.packetRoot);
  const parent = path.join(context.packetRoot, ".council-profiles"); ownedDirectory(parent, 0o700);
  const policyHash = sha(canonicalJson(policy));
  const run = path.join(parent, "agy-hook-" + sha(canonicalJson({ policyHash, assignmentHash: context.assignmentHash })));
  const newRun = ownedDirectory(run, 0o700);
  const bin = path.join(run, "bin"), empty = path.join(run, "empty"), scratch = path.join(run, "scratch");
  if (!newRun) { directory(bin, 0o500); directory(empty, 0o500); directory(scratch, 0o700); }
  let newBin = false;
  try { fs.mkdirSync(bin, { mode: 0o700 }); directory(bin, 0o700); newBin = true; }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; directory(bin, 0o500); }
  ownedDirectory(empty, 0o500); ownedDirectory(scratch, 0o700);
  requireThat(fs.readdirSync(empty).length === 0, "HOME_CWD_NOT_EMPTY");
  const copy = path.join(bin, "hook.sh"), adapter = path.join(bin, "sh"), verifier = path.join(bin, "verify-hook.mjs");
  // Capture actual inodes now. Final modes are checked separately after sealing;
  // no future inode or fabricated directory metadata enters the static policy.
  const directories = [...custody(run), ...[bin, empty, scratch].map(p => custody(p)[0]!)];
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  const producerFiles = fs.readdirSync(moduleDirectory).filter(n => n.endsWith(extension)).sort().map(n => path.join(moduleDirectory, n));
  for (const suffix of ["../orca/client", "../domain/hash", "../workers/strict-json"]) producerFiles.push(path.join(moduleDirectory, suffix + extension));
  const producerHash = sha(canonicalJson(producerFiles.map(p => ({ name: p.slice(moduleDirectory.length + 1), sha256: sha(fs.readFileSync(p)) }))));
  const c: Core = { policy, policyHash, assignmentHash: context.assignmentHash, producerHash, run, bin, empty, scratch, copy, adapter, verifier,
    commands: events.map(event => hookCommand(policy.installed, event)), copiedCommands: events.map(event => hookCommand(copy, event)), launchPath: bin + ":" + policy.basePath, directories };
  requireThat(normalizedPath(c.launchPath) === c.launchPath, "LAUNCH_PATH_UNBOUND");
  const verifierHash = sha(verifierSource), adapterContent = adapterText(c, verifierHash);
  const materials: NonNullable<ProviderRecipe["materializations"]> = [{ path: copy, content: policy.hookContent, sha256: HOOK, mode: 0o500 },
    { path: verifier, content: verifierSource, sha256: verifierHash, mode: 0o400 }, { path: adapter, content: adapterContent, sha256: sha(adapterContent), mode: 0o500 }];
  // An existing profile must already be complete; never repair missing entries.
  if (!newBin) for (const m of materials) file(m.path, m.mode!, m.sha256);
  materialize(materials);
  if (newBin) fs.chmodSync(bin, 0o500);
  directory(bin, 0o500); directory(empty, 0o500); directory(scratch, 0o700);
  requireThat(canonicalJson(fs.readdirSync(bin).sort()) === canonicalJson(["hook.sh", "sh", "verify-hook.mjs"]), "PROFILE_CONTENTS");
  for (const m of materials) file(m.path, m.mode!, m.sha256);
  custody(run);
  const binding = { assignmentHash: context.assignmentHash, directory: context.directory, policyHash, producerHash, launchPath: c.launchPath,
    directories: [...new Set(directories.map(d => d.path))].map(p => ({ path: p, ...metadata(p) })), materials: materials.map(({ path, mode, sha256 }) => ({ path, mode, sha256 })) };
  const instanceHash = sha(canonicalJson(binding)), reportPath = path.join(run, "instance-" + sha(context.directory) + ".json");
  fs.writeFileSync(reportPath, canonicalJson({ ...binding, instanceHash }) + "\n", { flag: "wx", mode: 0o400 });
  file(reportPath, 0o400, sha(canonicalJson({ ...binding, instanceHash }) + "\n"));
  return { launchPath: c.launchPath, instanceHash, reportPath };
}
