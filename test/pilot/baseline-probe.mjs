// Run against built selected-baseline bytes, not the submitted native pilot.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const root = process.argv[2];
const { parseCouncilConfig } = await import(
  pathToFileURL(resolve(root, "dist/config/load.js"))
);
const { qualifyRoute } = await import(
  pathToFileURL(resolve(root, "dist/orca/transport.js"))
);
const config = {
  version: 1,
  reviewers: {
    openai: { route: "codex", model: "gpt-6.1-sol", effort: "max" },
    gemini: {
      route: "antigravity",
      model: "gemini-4-argon-high",
      effort: "high",
    },
    xai: {
      route: "cursor",
      model: "grok-4.7-xhigh",
      effort: "xhigh",
      effortEncoding: "model",
    },
  },
  judge: { route: "codex", model: "gpt-6-astra", effort: "max" },
};
let failed = 0;
try {
  let result;
  try {
    result = parseCouncilConfig(Buffer.from(JSON.stringify(config)));
  } catch (error) {
    result = { error: error.message };
  }
  assert.deepEqual(result, config);
  console.log("E2 schema accepted");
} catch (error) {
  console.log(
    "RED E2 schema: expected exact roster acceptance, baseline returned CONFIG_INVALID",
  );
  failed++;
}
try {
  const result = await qualifyRoute({});
  assert.equal(result.kind, "ready");
} catch (error) {
  console.log(
    "RED native qualification: expected ready, baseline returns UNQUALIFIED_ROUTE",
  );
  failed++;
}
assert.equal(failed, 0, "selected baseline lacks E2/native qualification path");
