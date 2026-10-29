import { expect, it } from "vitest";
import { LocalReadRpc } from "../../src/pilot/rpc.js";
import { nativeHostFixture } from "./native-host-fixture.js";
import { writeFileSync } from "node:fs";
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

it("refuses a different installed runtime version before importing its client", () => {
  const host = nativeHostFixture("1.4.245");
  try {
    writeFileSync(host.rpc, "throw Error('must not load unsupported export');");
    expect(() => new LocalReadRpc("synthetic-runtime", host.orca)).toThrow("UNSUPPORTED_ORCA_API_VERSION");
  } finally { host.close(); }
});

it("fails closed when the inspected installation has no RuntimeClient export", () => {
  const host = nativeHostFixture();
  try {
    writeFileSync(host.rpc, "module.exports = {};");
    expect(() => new LocalReadRpc("synthetic-runtime", host.orca)).toThrow("ORCA_EXPORTED_CLIENT_UNAVAILABLE");
  } finally { host.close(); }
});
