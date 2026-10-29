import { expect, it } from "vitest";
import { LocalReadRpc } from "../../src/pilot/rpc.js";
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
