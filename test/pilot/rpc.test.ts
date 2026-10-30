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
