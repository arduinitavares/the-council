import { expect, it } from "vitest";
import { selectAgySourceRules } from "../../src/pilot/agy-loader-contract.js";

// Break caught: an unreviewed executable inherits the pinned source subset.
it("selects only the pinned executable source subset", () => {
  const executable = { path: "/fixture/agy", sha256: "34423fc9b0af3841e7646aa72a2d40ffeab8218b22d1cb99eac7355f9eba31e3" };
  expect(selectAgySourceRules(executable)).toEqual({ state: "pinned-subset", ruleSet: "agy-34423fc9-source-subset-v1", executable });
  expect(selectAgySourceRules({ path: "/fixture/agy", sha256: "0".repeat(64) })).toEqual({
    state: "unknown", problem: { code: "AGY_SOURCE_CONTRACT_UNREVIEWED", path: "/fixture/agy", edge: null },
  });
});
