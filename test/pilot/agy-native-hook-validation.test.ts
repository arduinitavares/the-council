import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { validateAgyNativeHookSource } from "../../src/pilot/agy-native-hook-validation.js";

// These raw strings preserve the reviewed source spellings, including numbers.
const commands = `{
  "canonical": {
    "enabled": true,
    "SessionStart": [{"command": "printf canonical"}],
    "PreInvocation": [{"type": "command", "command": "printf canonical", "timeout": 1}],
    "PostInvocation": [{"type": "", "command": "printf canonical"}],
    "Stop": [{"command": "printf canonical", "timeout": -2147483648}],
    "PreToolUse": [{"matcher": "*", "hooks": [{"command": "printf canonical", "timeout": 2147483647}]}],
    "PostToolUse": [{"matcher": "", "hooks": [{"command": "printf canonical", "timeout": 0}]}]
  }
}`;
const prompts = `{
  "canonical": {
    "SessionStart": [{"type": "prompt", "prompt": "Review context", "model": "inherit"}],
    "PreInvocation": [{"type": "prompt", "prompt": "Review context", "model": "flash"}],
    "PostInvocation": [{"type": "prompt", "prompt": "Review context", "model": "pro"}],
    "Stop": [{"type": "prompt", "prompt": "Review context", "model": "flash_lite"}],
    "PreToolUse": [{"matcher": "*", "hooks": [{"type": "prompt", "prompt": "Review context"}]}],
    "PostToolUse": [{"matcher": "*", "hooks": [{"command": "printf canonical"}]}]
  }
}`;
function validate(bytes: string) {
  return validateAgyNativeHookSource({ path: "/fixture/hooks.json", file: { bytes: Buffer.from(bytes), sha256: createHash("sha256").update(bytes).digest("hex") } });
}
function refused(bytes: string, state: "invalid" | "unknown", code: string, pointer: string) {
  const result = validate(bytes);
  expect(result.state).toBe(state);
  expect(result).not.toHaveProperty("occurrences");
  if (result.state !== "valid") expect(result.problems).toContainEqual(expect.objectContaining({ code, path: "/fixture/hooks.json", pointer }));
}
// Break caught: one native event is omitted or defaults rewrite source descriptors.
it("validates all six canonical native event schemas", () => {
  const result = validate(commands); expect(result.state).toBe("valid");
  if (result.state !== "valid") throw Error("canonical source refused");
  expect(result.basis).toBe("reviewed-compiled-source");
  expect(result.occurrences.map(o => o.event)).toEqual(["SessionStart", "PreInvocation", "PostInvocation", "Stop", "PreToolUse", "PostToolUse"]);
  expect(result.occurrences.map(o => o.timeoutSeconds)).toEqual([30, 1, 30, 30, 2147483647, 30]);
  expect(result.occurrences.map(o => o.handlerType)).toEqual(Array(6).fill("command"));
  expect(result.occurrences[0]?.descriptor).toEqual({ command: "printf canonical" });
  expect(result.occurrences[4]?.matcher).toBe("*"); expect(result.occurrences[5]?.matcher).toBe("");
});
it("validates canonical known-model prompts", () => {
  const result = validate(prompts); expect(result.state).toBe("valid");
  if (result.state !== "valid") throw Error("canonical prompts refused");
  expect(result.occurrences.map(o => o.handlerType)).toEqual(["prompt", "prompt", "prompt", "prompt", "prompt", "command"]);
  expect(result.occurrences.map(o => o.descriptor.model)).toEqual(["inherit", "flash", "pro", "flash_lite", undefined, undefined]);
  expect(result.occurrences.map(o => o.timeoutSeconds)).toEqual(Array(6).fill(30));
});
// Break caught: Number conversion erases native lexical/range distinctions.
it("preserves native int32 lexical distinctions at acquisition", () => {
  for (const [token, timeout] of [["1", 1], ["-2147483648", 30], ["2147483647", 2147483647], ["0", 30], ["-1", 30]] as const) {
    const result = validate(`{"a/b~c":{"SessionStart":[{"command":"echo 1e0","timeout":${token},"ignored":1e0}]}}`);
    expect(result.state).toBe("valid");
    if (result.state === "valid") expect(result.occurrences[0]?.timeoutSeconds).toBe(timeout);
  }
  for (const token of ["1.0", "1e0", "2147483648", "-2147483649"]) refused(`{"a/b~c":{"SessionStart":[{"command":"echo 1e0","timeout":${token}}]}}`, "invalid", "AGY_NATIVE_HOOK_VALIDATION_FAILED", "/a~1b~0c/SessionStart/0/timeout");
  expect(validate('{"canonical":{"SessionStart":[{"command":"echo","time\\u006fut":1}]}}').state).toBe("valid");
});
it("validates disabled specs before applying spec enablement", () => {
  refused('{"off":{"enabled":false,"SessionStart":[{"command":""}]}}', "invalid", "AGY_NATIVE_HOOK_VALIDATION_FAILED", "/off/SessionStart/0");
});
it("rejects the whole source when a sibling native spec is invalid", () => {
  refused('{"good":{"SessionStart":[{"command":"printf good"}]},"bad":{"Stop":[{"command":""}]}}', "invalid", "AGY_NATIVE_HOOK_VALIDATION_FAILED", "/bad/Stop/0");
});
it("retains native payload whitespace and timeout defaults", () => {
  const result = validate('{"a":{"enabled":null,"SessionStart":[{"type":null,"command":" ","prompt":null,"model":null,"timeout":null},{"type":"prompt","prompt":" ","model":" FLASH "}]}}');
  expect(result.state).toBe("valid");
  if (result.state === "valid") {
    expect(result.occurrences.map(o => o.specEnabled)).toEqual([null, null]);
    expect(result.occurrences.map(o => o.timeoutSeconds)).toEqual([30, 30]);
    expect(result.occurrences[0]?.descriptor.command).toBe(" "); expect(result.occurrences[1]?.descriptor.model).toBe(" FLASH ");
  }
});
it("rejects prompt handlers in PostToolUse", () => {
  refused('{"bad":{"PostToolUse":[{"matcher":"*","hooks":[{"type":"prompt","prompt":"Review context","model":"inherit"}]}]}}', "invalid", "AGY_NATIVE_HOOK_VALIDATION_FAILED", "/bad/PostToolUse/0/hooks/0");
});
it.each([
 ['{"a":{"sessionstart":[{"command":""}]}}', "/a/sessionstart"],
 ['{"a":{"SessionStart":[{"COMMAND":""}]}}', "/a/SessionStart/0/COMMAND"],
 ['{"a":{"SessionStart":[{"command":"echo","timeout":"1"}]}}', "/a/SessionStart/0/timeout"],
 ['{"a":{"SessionStart":{}}}', "/a/SessionStart"],
 ['{"a":{"enabled":1}}', "/a/enabled"],
 ['{"a":{"PreToolUse":[{"hooks":true}]}}', "/a/PreToolUse/0/hooks"],
 ['{"a":{"SessionStart":[{"command":42}]}}', "/a/SessionStart/0/command"],
 ['{"a":{"SessionStart":[{"type":"prompt","prompt":"x","model":"\\u00a0flash"}]}}', "/a/SessionStart/0/model"],
] as const)("retains specific native decoder and model unknowns: %s", (bytes, pointer) => {
  refused(bytes, "unknown", "AGY_NATIVE_HOOK_DECODER_UNAVAILABLE", pointer);
});
it("retains specific native decoder and model unknowns", () => {
  refused('{"canonical":{"SessionStart":[{"type":"prompt","prompt":"Review context","model":"future_model"}]}}', "unknown", "AGY_NATIVE_HOOK_MODEL_UNAVAILABLE", "/canonical/SessionStart/0/model");
  refused('null', "unknown", "AGY_NATIVE_HOOK_DECODER_UNAVAILABLE", "");
  expect(validate('{"a":{"SessionStart":[{"command":"echo","timeout":1}]}}').state).toBe("valid");
});
it("does not validate matcher syntax with JavaScript regex", () => {
  expect(validate('{"a":{"PreToolUse":[{"matcher":"[","hooks":[{"command":"echo"}]}]}}').state).toBe("valid");
});
it.each(['{}', '{"a":{},"b":null}', '{"a":{"SessionStart":null,"PreToolUse":[{"hooks":null}]}}', '{"a":{"session_start":[null],"unknown":1e0,"雪":true}}'])('accepts native empty and ignored controls: %s', bytes => expect(validate(bytes).state).toBe("valid"));
it.each(['[]', '1', '"x"', 'false', '{"a":[]}', '{"a":1}', '{"a":"x"}', '{"a":false}', '{"a":{"SessionStart":[null]}}', '{"a":{"SessionStart":[{"type":"other","command":"echo"}]}}', '{"a":{"SessionStart":[{"command":"echo","prompt":"x"}]}}', '{"a":{"SessionStart":[{"type":"prompt","command":"echo","prompt":"x"}]}}'])('rejects ordinary native invalid controls: %s', bytes => { expect(validate(bytes).state).toBe("invalid"); expect(validate(bytes)).not.toHaveProperty("occurrences"); });
it("retains missing and false spec enablement without activating it", () => {
  const result = validate('{"a":{"SessionStart":[{"command":"a"}]},"b":{"enabled":false,"Stop":[{"command":"b"}]}}');
  expect(result.state).toBe("valid"); if (result.state === "valid") expect(result.occurrences.map(o => o.specEnabled)).toEqual([null, false]);
});
it("does not turn an influential folded alias into an empty-payload error", () => {
  refused('{"a":{"SessionStart":[{"COMMAND":"echo"}]}}', "unknown", "AGY_NATIVE_HOOK_DECODER_UNAVAILABLE", "/a/SessionStart/0/COMMAND");
});

// Break caught: an unqualified group shape silently becomes an empty valid source.
it("withholds unqualified null matcher groups", () => {
  refused('{"a":{"PreToolUse":[null]}}', "unknown", "AGY_NATIVE_HOOK_DECODER_UNAVAILABLE", "/a/PreToolUse/0");
});
it("withholds influential Unicode aliases while ignoring unrelated Unicode keys", () => {
  refused('{"a":{"PreToolUse":[{"hoo\\u212as":[{"command":"echo"}]}]}}', "unknown", "AGY_NATIVE_HOOK_DECODER_UNAVAILABLE", "/a/PreToolUse/0/hooKs");
  expect(validate('{"a":{"雪":true,"SessionStart":[{"command":"echo"}]}}').state).toBe("valid");
});
it("rejects an independent invalid sibling despite an unsupported model", () => {
  refused('{"unknown":{"SessionStart":[{"type":"prompt","prompt":"x","model":"future_model"}]},"bad":{"Stop":[{"command":""}]}}', "invalid", "AGY_NATIVE_HOOK_VALIDATION_FAILED", "/bad/Stop/0");
});
