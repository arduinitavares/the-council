import { describe, expect, it } from "vitest";
import { makeBinding, makeBallot } from "../fixtures/builders.js";

async function protocol() {
  const loaded = await import("../../src/workers/protocol.js").catch(
    () => null,
  );
  expect(loaded, "Task5 provider protocol must be implemented").not.toBeNull();
  return loaded!;
}
async function strict() {
  const loaded = await import("../../src/workers/strict-json.js").catch(
    () => null,
  );
  expect(loaded, "Task5 strict decoder must be implemented").not.toBeNull();
  return loaded!;
}
const raw = () => {
  const { binding, seat, ...body } = makeBallot("openai");
  return { ...body, kind: "ballot", methodIds: ["test-method"] };
};
describe("strict local worker protocol", () => {
  it("decodes a valid bound ballot without inference", async () => {
    expect(
      (await protocol()).decodeProviderOutput(
        Buffer.from(JSON.stringify(raw())),
        makeBinding(),
      ).status,
    ).toBe("valid");
  });
  it("rejects forged adapter provenance and foreign targets", async () => {
    const p = await protocol();
    expect(
      p.decodeProviderOutput(
        Buffer.from(JSON.stringify({ ...raw(), seat: "openai" })),
        makeBinding("gemini"),
      ).status,
    ).toBe("invalid");
    const body = raw();
    body.bindings.contextHash = "b".repeat(64);
    expect(
      p.decodeProviderOutput(Buffer.from(JSON.stringify(body)), makeBinding())
        .status,
    ).toBe("invalid");
  });
  it.each([
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"x":{"a":1,"a":2}}',
    "{} {}",
    '{"a":',
    "[1,,2]",
    "[1,]",
  ])("strict decoder rejects %s", async (text) => {
    expect(() => strict).not.toThrow();
    const s = await strict();
    expect(() => s.decodeStrictJson(text)).toThrow();
  });
  it("normalizes only one complete fence and trailing commas outside strings", async () => {
    const s = await strict();
    const text =
      '```json\n{"text":"a,} and \\\"quoted\\\"", "list":[1,],}\n```';
    const receipt = s.normalizeJsonSurface(text);
    expect(receipt.outcome).toBe("valid");
    expect(receipt.operations).toEqual([
      "whole-message-fence",
      "trailing-commas",
    ]);
    expect(receipt.value).toEqual({ text: 'a,} and "quoted"', list: [1] });
    expect(receipt.rawHash).not.toBe(receipt.normalizedHash);
    expect(s.normalizeJsonSurface("```json\n{}\n```\nprose").outcome).toBe(
      "invalid",
    );
    expect(s.normalizeJsonSurface('```json\n{"a":1,"a":2,}\n```').outcome).toBe(
      "invalid",
    );
  });
  it("rejects oversized results, invalid UTF8 and partial NDJSON", async () => {
    const p = await protocol();
    for (const bytes of [
      Buffer.alloc(1024 * 1024 + 1, 32),
      Buffer.from([0xff]),
      Buffer.from('{}\n{"kind":'),
    ])
      expect(p.decodeProviderOutput(bytes, makeBinding())).toEqual({
        status: "invalid",
        code: "INVALID_WORKER_RESULT",
      });
  });
});

it("keeps punctuation, Unicode, numeric values and quoted fence text exact through normalization", async () => {
  const s = await strict(),
    value = {
      text: "``` and ,} and café",
      n: -0.125e2,
      nested: { __proto__: "literal" },
      list: [true, null, "a\\b"],
    };
  const text =
    "```json\n" + JSON.stringify(value).replace(/}$/, ",}") + "\n```";
  const receipt = s.normalizeJsonSurface(text);
  expect(receipt.outcome).toBe("valid");
  expect(receipt.value).toEqual(value);
  expect(s.normalizeJsonSurface("[,]").outcome).toBe("invalid");
  expect(s.normalizeJsonSurface("[1,,]").outcome).toBe("invalid");
});

it("does not silently remove a UTF8 BOM outside the two permitted normalization operations", async () => {
  const p = await protocol();
  const bytes = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(JSON.stringify(raw())),
  ]);
  expect(p.decodeProviderOutput(bytes, makeBinding()).status).toBe("invalid");
});
