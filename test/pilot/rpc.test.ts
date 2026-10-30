import { expect, it } from "vitest";
import { LocalReadRpc } from "../../src/pilot/rpc.js";
import { nativeHostFixture } from "./native-host-fixture.js";
import { writeFileSync, mkdirSync, renameSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readFailure } from "../../src/pilot/allowance.js";
it("preserves sanitized structured RPC diagnostics through the official read boundary", async () => {
  for (const [code, diagnosticClass, state] of [["runtime_timeout", "timeout", "missing"], ["permission_denied", "denial", "denied"]]) {
    const rpc = new LocalReadRpc("runtime", "/test/orca", { call: async () => ({ ok: false, error: { code, message: "private account" }, _meta: { runtimeId: "runtime" } }) });
    try { await rpc.call("accounts.list", { refreshUsage: true }); throw Error("expected RPC failure"); }
    catch (error) {
      const observed = readFailure("official native source", error);
      expect(observed.state).toBe(state);
      expect(JSON.parse(observed.detail).diagnostic).toEqual({ class: diagnosticClass, code });
      expect(JSON.stringify(observed)).not.toContain("private account");
    }
  }
});
it("uses a bounded longer timeout only for the supported accounts refresh read", async () => {
  const seen: unknown[] = [];
  const rpc = new LocalReadRpc("runtime", "/test/orca", {
    call: async (_method, _params, options) => {
      seen.push(options);
      return { ok: true, result: {}, _meta: { runtimeId: "runtime" } };
    },
  });
  await rpc.call("accounts.list", { refreshUsage: true });
  await rpc.call("settings.getAgentLaunch", {});
  expect(seen).toEqual([{ timeoutMs: 30000 }, undefined]);
});
it("uses an official-client read boundary and rejects another runtime without handling authentication", async () => {
  let foreign = false;
  const seen: string[] = [];
  const rpc = new LocalReadRpc("runtime", "/test/orca", {
    call: async (method, params) => {
      seen.push(method);
      expect(params).toEqual({ agent: "cursor", worktree: "path:/B" });
      return {
        ok: true,
        result: { models: [] },
        _meta: { runtimeId: foreign ? "foreign" : "runtime" },
      };
    },
  });
  expect(
    await rpc.call("agentSession.modelCatalog", {
      agent: "cursor",
      worktree: "path:/B",
    }),
  ).toEqual({ models: [] });
  foreign = true;
  await expect(
    rpc.call("agentSession.modelCatalog", {
      agent: "cursor",
      worktree: "path:/B",
    }),
  ).rejects.toThrow("RPC_READ_BINDING_MISMATCH");
  expect(seen).toEqual([
    "agentSession.modelCatalog",
    "agentSession.modelCatalog",
  ]);
});

it.each(["1.4.245", "0.9.0", "2.0.0-dev+local"])("loads the installed client regardless of Orca version %s", async (version) => {
  const host = nativeHostFixture(version);
  try {
    const rpc = new LocalReadRpc("synthetic-runtime", host.orca);
    expect(await rpc.call("settings.getAgentLaunch", {})).toEqual({settings:{agentPermission:{default:"full-access"},agentDefaultArgs:{}}});
    await expect(new LocalReadRpc("foreign-runtime", host.orca).call("settings.getAgentLaunch", {})).rejects.toThrow("RPC_READ_BINDING_MISMATCH");
  } finally { host.close(); }
});

it("loads the installed client without executing the Orca binary", async () => {
  const host = nativeHostFixture();
  try {
    writeFileSync(host.orca, `#!${process.execPath}\nprocess.exit(99);\n`);
    const rpc = new LocalReadRpc("synthetic-runtime", host.orca);
    expect(await rpc.call("agentSession.createSupport", {agent:"cursor"})).toEqual({agent:"cursor",supported:false,reason:"agent"});
  } finally { host.close(); }
});

it.each(["1.4.245", "0.9.0", "2.0.0-dev+local"])("fails closed without a RuntimeClient export on Orca %s", (version) => {
  const host = nativeHostFixture(version);
  try {
    writeFileSync(host.rpc, "module.exports = {};");
    expect(() => new LocalReadRpc("synthetic-runtime", host.orca)).toThrow("ORCA_EXPORTED_CLIENT_UNAVAILABLE");
  } finally { host.close(); }
});

it("reads an explicit AGY effort mapping independently of empty model-catalog efforts", async () => {
  const host = nativeHostFixture();
  try {
    const source = resolve(dirname(host.rpc), "../shared/agent-session-option-catalog-antigravity.js");
    mkdirSync(dirname(source), {recursive:true});
    // Synthetic source shape from Orca 1.4.244's installed option catalog.
    writeFileSync(source, `const ANTIGRAVITY_EFFORT = {
      kind: {type:'select', choices:[{value:'low'},{value:'medium'},{value:'high'}]},
      apply: { launchArgs: (value) => ['--effort', String(value)] }
    };
    exports.ANTIGRAVITY_SESSION_OPTION_CATALOG = {
      supportsWorkerLaunchPreferences: true, unknownModelOptions: [ANTIGRAVITY_EFFORT]
    };`);
    const rpc = new LocalReadRpc("synthetic-runtime", host.orca);
    expect(typeof (rpc as any).effortSupport).toBe("function");
    const contract = await (rpc as any).effortSupport("antigravity");
    expect(contract).toMatchObject({efforts:["low","medium","high"]});
    expect(contract.source).toContain("sha256=");
    writeFileSync(source, "// no explicit mapping");
    expect((await (rpc as any).effortSupport("antigravity")).efforts).toEqual([]);
  } finally { host.close(); }
});

it("rejects a symlinked runtime-client export before importing it",()=>{
  const host=nativeHostFixture();
  try{
    const linked=host.rpc+".original";renameSync(host.rpc,linked);symlinkSync(linked,host.rpc);
    expect(()=>new LocalReadRpc("synthetic-runtime",host.orca)).toThrow("ORCA_EXPORTED_CLIENT_PATH_UNVERIFIED");
  }finally{host.close();}
});

// Audited installed Orca 1.4.245 contracts, kept as data; never imported.
const helperCatalog = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANTIGRAVITY_SESSION_OPTION_CATALOG = void 0;
const agent_choice_cli_apply_1 = require("./agent-choice-cli-apply");
const ANTIGRAVITY_EFFORT = {
    id: 'effort',
    label: 'Reasoning effort',
    category: 'thought_level',
    kind: {
        type: 'select',
        choices: [
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' }
        ],
        defaultValue: 'high'
    },
    apply: {
        ...(0, agent_choice_cli_apply_1.agentChoiceCliApply)('antigravity', [
            {
                kind: 'value',
                names: ['--effort'],
                lift: 'separate-and-long-equals'
            }
        ], '--effort'),
        midSession: { kind: 'command', build: (value) => \`/effort \${String(value)}\` }
    }
};
exports.ANTIGRAVITY_SESSION_OPTION_CATALOG = {
    supportsWorkerLaunchPreferences: true,
    // Model availability is account-scoped; worker-start accepts the slug reported by \`agy models\`.
    models: [],
    modelApply: {
        ...(0, agent_choice_cli_apply_1.agentChoiceCliApply)('antigravity', [
            {
                kind: 'value',
                names: ['--model'],
                lift: 'separate-and-long-equals'
            }
        ], '--model'),
        midSession: { kind: 'agent-picker', command: '/model' }
    },
    unknownModelOptions: [ANTIGRAVITY_EFFORT]
};
`;
const choiceHelper = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentChoiceConfigValue = agentChoiceConfigValue;
exports.agentChoiceCliApply = agentChoiceCliApply;
const agent_session_option_agent_args_1 = require("./agent-session-option-agent-args");
function agentChoiceConfigValue(value, key) {
    const separator = value.indexOf('=');
    return separator !== -1 && value.slice(0, separator).trim() === key
        ? value.slice(separator + 1)
        : undefined;
}
/** The declared grammar owns both forward spelling and conflicting argument removal. */
function agentChoiceCliApply(agent, forms, emitted) {
    const encoder = forms.find((form) => form.names.includes(emitted)) ?? forms[0];
    return {
        cli: forms,
        launchArgs: (value) => encoder.kind === 'config'
            ? [emitted, \`\${encoder.key}=\${String(value)}\`]
            : [emitted, String(value)],
        removeAgentArgs: (tokens) => forms.reduce((kept, form) => (0, agent_session_option_agent_args_1.removeAgentArgOption)(agent, kept, form.names, form.kind === 'config'
            ? (value) => agentChoiceConfigValue(value ?? '', form.key) !== undefined
            : undefined), [...tokens])
    };
}
`;
it("recognizes the explicit helper-backed prelaunch AGY effort contract", async () => {
  const host = nativeHostFixture();
  try {
    const shared = resolve(dirname(host.rpc), "../shared");
    mkdirSync(shared, {recursive:true});
    writeFileSync(resolve(shared, "agent-session-option-catalog-antigravity.js"), helperCatalog);
    writeFileSync(resolve(shared, "agent-choice-cli-apply.js"), choiceHelper);
    const contract = await new LocalReadRpc("synthetic-runtime", host.orca).effortSupport("antigravity");
    expect(contract.efforts).toEqual(["low", "medium", "high"]);
    expect(contract.source).toContain("agent-choice-cli-apply.js sha256=");
  } finally { host.close(); }
});

it.each([
  ["missing helper", helperCatalog, undefined],
  ["empty helper", helperCatalog, ""],
  ["mapping only in a comment", "/* " + helperCatalog + " */", choiceHelper],
  ["unrelated declaration", helperCatalog.replace("const ANTIGRAVITY_EFFORT", "const OTHER_EFFORT"), choiceHelper],
  ["unreferenced effort", helperCatalog.replace("unknownModelOptions: [ANTIGRAVITY_EFFORT]", "unknownModelOptions: []"), choiceHelper],
  ["worker launch disabled", helperCatalog.replace("supportsWorkerLaunchPreferences: true", "supportsWorkerLaunchPreferences: false"), choiceHelper],
  ["unsupported choice", helperCatalog.replace("value: 'high'", "value: 'ultra'"), choiceHelper],
  ["missing choice", helperCatalog.replace("{ value: 'high', label: 'High' }", ""), choiceHelper],
  ["duplicate choice", helperCatalog.replace("value: 'high'", "value: 'low'"), choiceHelper],
  ["wrong emitted flag", helperCatalog.replace("], '--effort')", "], '--model')"), choiceHelper],
  ["unmapped effort form", helperCatalog.replace("names: ['--effort']", "names: ['--other']"), choiceHelper],
  ["config form", helperCatalog.replace("kind: 'value'", "kind: 'config'"), choiceHelper],
  ["wrong lift", helperCatalog.replace("lift: 'separate-and-long-equals'", "lift: 'other'"), choiceHelper],
  ["wrong agent", helperCatalog.replace("('antigravity', [", "('other', ["), choiceHelper],
  ["wrong helper import", helperCatalog.replace("require(\"./agent-choice-cli-apply\")", "require(\"./other\")"), choiceHelper],
  ["overridden launch mapping", helperCatalog.replace("midSession: { kind: 'command'", "launchArgs: () => [], midSession: { kind: 'command'"), choiceHelper],
  ["later reassignment", helperCatalog + "ANTIGRAVITY_EFFORT.apply.launchArgs = () => [];", choiceHelper],
  ["helper mapping mismatch", helperCatalog, choiceHelper.replace("[emitted, String(value)]", "['--model', String(value)]")],
  ["helper encoder mismatch", helperCatalog, choiceHelper.replace("const encoder = forms.find((form) => form.names.includes(emitted)) ?? forms[0];", "const encoder = {kind:'config'};")],
  ["helper only in a comment", helperCatalog, "/* " + choiceHelper + " */"],
  ["helper export mismatch", helperCatalog, choiceHelper.replace("exports.agentChoiceCliApply = agentChoiceCliApply;", "exports.agentChoiceCliApply = other;")],
  ["helper automatic semicolon", helperCatalog, choiceHelper.replace("return {", "return\n{")],
  ["helper comment automatic semicolon", helperCatalog, choiceHelper.replace("return {", "return /*\n*/ {")],
  ["helper invalid arrow newline", helperCatalog, choiceHelper.replace("(value) =>", "(value)\n=>")],
  ["catalog property override", helperCatalog.replace("supportsWorkerLaunchPreferences: true,", "supportsWorkerLaunchPreferences: true, supportsWorkerLaunchPreferences: false,"), choiceHelper],
  ["dynamic catalog metadata", helperCatalog.replace("models: []", "models: mutateCatalog()"), choiceHelper],
  ["helper later replacement", helperCatalog, choiceHelper + "exports.agentChoiceCliApply = () => ({});"],
  ["helper binding mutation", helperCatalog, choiceHelper + "agentChoiceCliApply = () => ({});"],
  ["helper extra execution", helperCatalog, choiceHelper.replace("const encoder = forms.find", "mutateEncoder(); const encoder = forms.find")],
  ["helper duplicate mapping", helperCatalog, choiceHelper.replace("cli: forms,", "launchArgs: () => [], cli: forms,")],
  ["spread CLI override", helperCatalog.replace("midSession: { kind: 'command'", "cli: [], midSession: { kind: 'command'"), choiceHelper],
  ["extra effort spread", helperCatalog.replace("midSession: { kind: 'command'", "...otherApply, midSession: { kind: 'command'"), choiceHelper],
  ["oversized helper", helperCatalog, choiceHelper + " ".repeat(65536)],
  ["oversized catalog", helperCatalog + " ".repeat(65536), choiceHelper],
])("keeps %s unavailable", async (_name, catalog, helper) => {
  const host = nativeHostFixture();
  try {
    const shared = resolve(dirname(host.rpc), "../shared");
    mkdirSync(shared, {recursive:true});
    expect(catalog !== helperCatalog || helper !== choiceHelper).toBe(true);
    writeFileSync(resolve(shared, "agent-session-option-catalog-antigravity.js"), catalog!);
    if (helper !== undefined) writeFileSync(resolve(shared, "agent-choice-cli-apply.js"), helper);
    expect((await new LocalReadRpc("synthetic-runtime", host.orca).effortSupport("antigravity")).efforts).toEqual([]);
  } finally { host.close(); }
});

it("accepts harmless catalog/helper trivia and quote changes without a version gate", async () => {
  const host = nativeHostFixture("2.0.0-dev+local");
  try {
    const shared = resolve(dirname(host.rpc), "../shared");
    mkdirSync(shared, {recursive:true});
    writeFileSync(resolve(shared, "agent-session-option-catalog-antigravity.js"), "// audited shape\n" + helperCatalog.replace("'--effort'", '\"--effort\"'));
    writeFileSync(resolve(shared, "agent-choice-cli-apply.js"), choiceHelper.replace("return {", "return /* grammar */ {"));
    expect((await new LocalReadRpc("synthetic-runtime", host.orca).effortSupport("antigravity")).efforts).toEqual(["low", "medium", "high"]);
  } finally { host.close(); }
});

it.each(["agent-session-option-catalog-antigravity.js", "agent-choice-cli-apply.js"])("rejects a symlinked effort dependency %s", async (filename) => {
  const host = nativeHostFixture();
  try {
    const shared = resolve(dirname(host.rpc), "../shared");
    mkdirSync(shared, {recursive:true});
    writeFileSync(resolve(shared, "agent-session-option-catalog-antigravity.js"), helperCatalog);
    writeFileSync(resolve(shared, "agent-choice-cli-apply.js"), choiceHelper);
    const source = resolve(shared, filename);
    renameSync(source, source + ".original"); symlinkSync(source + ".original", source);
    expect((await new LocalReadRpc("synthetic-runtime", host.orca).effortSupport("antigravity")).efforts).toEqual([]);
  } finally { host.close(); }
});

it("recognizes required effort structure across unrelated catalog and helper changes", async () => {
  const host = nativeHostFixture();
  try {
    const shared = resolve(dirname(host.rpc), "../shared");
    mkdirSync(shared, {recursive:true});
    const catalog = helperCatalog.replace("label: 'Reasoning effort'", "label: 'Effort'")
      .replace("defaultValue: 'high'", "defaultValue: 'medium'")
      .replace("command: '/model'", "command: '/pick-model'")
      .replace("label: 'High'", "label: 'Deep'")
      .replace("kind: 'value',\n                names: ['--effort'],\n                lift: 'separate-and-long-equals'", "lift: 'separate-and-long-equals', names: ['--effort'], kind: 'value'");
    const helper = choiceHelper.replace("const separator = value.indexOf('=');", "const separator = value.lastIndexOf('=');")
      .replace("removeAgentArgs: (tokens) => forms.reduce", "removeAgentArgs: (args) => forms.reduce")
      .replace("[...tokens]", "[...args]")
      .replace('`${encoder.key}=${String(value)}`', "'unused-config-value'");
    writeFileSync(resolve(shared, "agent-session-option-catalog-antigravity.js"), catalog);
    writeFileSync(resolve(shared, "agent-choice-cli-apply.js"), helper);
    expect((await new LocalReadRpc("synthetic-runtime", host.orca).effortSupport("antigravity")).efforts).toEqual(["low", "medium", "high"]);
  } finally { host.close(); }
});
