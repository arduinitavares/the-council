import { decodeStrictJson } from "../workers/strict-json.js";
import type { BoundedFile } from "./inventory-io.js";

export type NativeHookEvent = "SessionStart" | "PreInvocation" | "PostInvocation" | "Stop" | "PreToolUse" | "PostToolUse";
export type NativeHookProblem = {
  code: "AGY_NATIVE_HOOK_VALIDATION_FAILED" | "AGY_NATIVE_HOOK_DECODER_UNAVAILABLE" | "AGY_NATIVE_HOOK_MODEL_UNAVAILABLE";
  path: string; pointer: string; detail: string;
};
export type NativeHookOccurrence = {
  specName: string; event: NativeHookEvent; matcher: string | null; specEnabled: boolean | null;
  descriptor: Readonly<Record<string, unknown>>; handlerType: "command" | "prompt"; timeoutSeconds: number;
};
export type NativeHookValidation =
  | { state: "valid"; basis: "reviewed-compiled-source"; occurrences: readonly NativeHookOccurrence[] }
  | { state: "invalid" | "unknown"; problems: readonly NativeHookProblem[] };

const events: readonly NativeHookEvent[] = ["SessionStart", "PreInvocation", "PostInvocation", "Stop", "PreToolUse", "PostToolUse"];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const child = (pointer: string, key: string | number) => pointer + "/" + String(key).replace(/~/g, "~0").replace(/\//g, "~1");

/** Index original numeric tokens by decoded pointer, after strict JSON validation.
 * Strings and member names are consumed structurally, never searched for numbers. */
function numberTokens(text: string): ReadonlyMap<string, string> {
  const tokens = new Map<string, string>(); let at = 0;
  const space = () => { while (/[\x20\t\r\n]/.test(text[at] ?? "")) at++; };
  const string = (): string => {
    const start = at++;
    while (at < text.length) {
      const value = text[at++];
      if (value === "\\") at++;
      else if (value === '"') return JSON.parse(text.slice(start, at)) as string;
    }
    throw Error("Incomplete guarded string");
  };
  const value = (pointer: string): void => {
    space(); const first = text[at];
    if (first === '"') { string(); return; }
    if (first === "{" || first === "[") {
      const map = first === "{"; at++; space(); let index = 0;
      if (text[at] === (map ? "}" : "]")) { at++; return; }
      for (;;) {
        space(); const key = map ? string() : index++;
        if (map) { space(); at++; }
        value(child(pointer, key)); space();
        if (text[at++] !== ",") return;
      }
    }
    const start = at;
    while (at < text.length && !/[\x20\t\r\n,}\]]/.test(text[at]!)) at++;
    if (first === "-" || (first !== undefined && first >= "0" && first <= "9")) tokens.set(pointer, text.slice(start, at));
  };
  value(""); return tokens;
}

/** Source conformance only. This function supplies no loader or runtime authority. */
export function validateAgyNativeHookSource(input: { path: string; file: Readonly<BoundedFile> }): NativeHookValidation {
  const problems: NativeHookProblem[] = [], occurrences: NativeHookOccurrence[] = [];
  const problem = (code: NativeHookProblem["code"], pointer: string, detail: string) => { problems.push({ code, path: input.path, pointer, detail }); };
  const invalid = (pointer: string, detail: string) => problem("AGY_NATIVE_HOOK_VALIDATION_FAILED", pointer, detail);
  const unknown = (pointer: string, detail: string) => problem("AGY_NATIVE_HOOK_DECODER_UNAVAILABLE", pointer, detail);
  let decoded: unknown, tokens: ReadonlyMap<string, string>;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(input.file.bytes);
    decoded = decodeStrictJson(text); tokens = numberTokens(text);
  } catch { unknown("", "Guarded strict JSON required"); return { state: "unknown", problems }; }
  // Go's non-ASCII folding/space cases are not supplied by JavaScript casing.
  const aliases = (record: Record<string, unknown>, fields: readonly string[], pointer: string): boolean => {
    let found = false;
    for (const key of Object.keys(record)) {
      if (fields.includes(key)) continue;
      const folded = key.replace(/[A-Z]/g, c => c.toLowerCase()).replace(/\u017f/g, "s").replace(/\u212a/g, "k");
      if (fields.some(field => field.toLowerCase() === folded)) { unknown(child(pointer, key), "Influential folded field alias is outside this subset"); found = true; }
    }
    return found;
  };
  const handler = (value: unknown, pointer: string, specName: string, event: NativeHookEvent, matcher: string | null, specEnabled: boolean | null) => {
    if (value !== null && !object(value)) { unknown(pointer, "Handler shape is outside this subset"); return; }
    const descriptor = value ?? {};
    if (aliases(descriptor, ["type", "command", "prompt", "model", "timeout"], pointer)) return;
    const fields: Record<string, string> = {};
    let unsupported = false;
    for (const key of ["type", "command", "prompt", "model"]) {
      const field = descriptor[key];
      if (field == null) fields[key] = "";
      else if (typeof field === "string") fields[key] = field;
      else { unknown(child(pointer, key), "String coercion is outside this subset"); unsupported = true; }
    }
    let timeoutSeconds = 30;
    if (descriptor.timeout != null) {
      const token = tokens.get(child(pointer, "timeout"));
      if (typeof descriptor.timeout !== "number" || token === undefined) { unknown(child(pointer, "timeout"), "Timeout coercion is outside this subset"); unsupported = true; }
      else if (!/^-?\d+$/.test(token) || BigInt(token) < -2147483648n || BigInt(token) > 2147483647n) invalid(child(pointer, "timeout"), "Timeout must be a decimal int32 token");
      else if (BigInt(token) > 0n) timeoutSeconds = Number(token);
    }
    if (unsupported) return;
    const type = fields.type || "command";
    if (/[^\x00-\x7f]/.test(type)) { unknown(child(pointer, "type"), "Unicode type semantics are outside this subset"); return; }
    if (type !== "command" && type !== "prompt") { invalid(pointer, "Unknown handler type"); return; }
    if (type === "command") {
      if (!fields.command || fields.prompt || fields.model) { invalid(pointer, "Command requires a payload and no prompt/model"); return; }
    } else {
      if (!fields.prompt || fields.command || event === "PostToolUse") { invalid(pointer, "Prompt requires a payload, no command, and a supported event"); return; }
      const model = fields.model || "inherit";
      if (/[^\x00-\x7f]/.test(model)) { unknown(child(pointer, "model"), "Unicode model semantics are outside this subset"); return; }
      if (!["inherit", "flash", "pro", "flash_lite"].includes(model.replace(/^[\x09-\x0d\x20]+|[\x09-\x0d\x20]+$/g, "").toLowerCase())) {
        problem("AGY_NATIVE_HOOK_MODEL_UNAVAILABLE", child(pointer, "model"), "Model spelling is outside reviewed controls"); return;
      }
    }
    occurrences.push({ specName, event, matcher, specEnabled, descriptor, handlerType: type, timeoutSeconds });
  };
  if (decoded === null) unknown("", "Root null interpretation is outside this subset");
  else if (!object(decoded)) invalid("", "Native source requires a named specification map");
  else for (const [specName, value] of Object.entries(decoded)) {
    const pointer = child("", specName);
    if (value === null) continue;
    if (!object(value)) { invalid(pointer, "Named specification must be an object or null"); continue; }
    if (aliases(value, ["enabled", ...events], pointer)) continue;
    if (value.enabled != null && typeof value.enabled !== "boolean") { unknown(child(pointer, "enabled"), "Enablement coercion is outside this subset"); continue; }
    const specEnabled = typeof value.enabled === "boolean" ? value.enabled : null;
    for (const event of events) {
      const list = value[event], eventPointer = child(pointer, event);
      if (list == null) continue;
      if (!Array.isArray(list)) { unknown(eventPointer, "Event shape is outside this subset"); continue; }
      list.forEach((entry: unknown, index: number) => {
        const entryPointer = child(eventPointer, index);
        if (event !== "PreToolUse" && event !== "PostToolUse") { handler(entry, entryPointer, specName, event, null, specEnabled); return; }
        if (!object(entry)) { unknown(entryPointer, "Matcher group shape is outside this subset"); return; }
        const group = entry;
        if (aliases(group, ["matcher", "hooks"], entryPointer)) return;
        if (group.matcher != null && typeof group.matcher !== "string") { unknown(child(entryPointer, "matcher"), "Matcher coercion is outside this subset"); return; }
        if (group.hooks == null) return;
        if (!Array.isArray(group.hooks)) { unknown(child(entryPointer, "hooks"), "Group hooks shape is outside this subset"); return; }
        group.hooks.forEach((hook: unknown, index: number) => handler(hook, child(child(entryPointer, "hooks"), index), specName, event, typeof group.matcher === "string" ? group.matcher : "", specEnabled));
      });
    }
  }
  if (problems.length) return { state: problems.some(p => p.code === "AGY_NATIVE_HOOK_VALIDATION_FAILED") ? "invalid" : "unknown", problems };
  return { state: "valid", basis: "reviewed-compiled-source", occurrences };
}
