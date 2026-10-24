import { expect, it } from "vitest";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

async function client() {
  const m = await import("../../src/orca/client.js").catch(() => null);
  expect(m, "Task5 client must exist").not.toBeNull();
  return m!;
}
it("runs exact argv without a shell, allowlists env and loads the same executable guides", async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "council-cli-"))),
    script = fileURLToPath(
      new URL("./fixtures/fake-orca.mjs", import.meta.url),
    );
  const c = await (
    await client()
  ).OrcaClient.connect({
    executable: process.execPath,
    prefix: [script],
    cwd,
    environment: { PATH: process.env.PATH!, SHOULD_NOT_LEAK: "secret" },
  });
  const result = await c.run(
    ["echo-argv", "$(touch should-not-exist)", "with spaces", ";"],
    { cwd, timeoutMs: 2000 },
  );
  const decoded = JSON.parse(Buffer.from(result.stdout).toString());
  expect(decoded.argv).toEqual([
    "$(touch should-not-exist)",
    "with spaces",
    ";",
  ]);
  expect(decoded.cwd).toBe(cwd);
  expect(decoded.envKeys).not.toContain("SHOULD_NOT_LEAK");
  expect(c.guide.version).toBe("fixture-1");
});
it("bounds oversized output and preserves a nonzero exit", async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "council-cli-"))),
    script = fileURLToPath(
      new URL("./fixtures/fake-orca.mjs", import.meta.url),
    );
  const c = await (
    await client()
  ).OrcaClient.connect({ executable: process.execPath, prefix: [script], cwd });
  const large = await c.run(["oversize"], {
    cwd,
    timeoutMs: 2000,
    maxBytes: 1024,
  });
  expect(large.overflow).toBe(true);
  expect(large.stdout.byteLength).toBeLessThanOrEqual(1024);
  const failure = await c.run(["fail"], { cwd, timeoutMs: 2000 });
  expect(failure.exitCode).toBe(17);
});

it("does not treat parent exit as inherited-stdio child settlement and records a forced stop truthfully", async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "council-child-"))),
    script = fileURLToPath(
      new URL("./fixtures/fake-orca.mjs", import.meta.url),
    );
  const c = await (
    await client()
  ).OrcaClient.connect({ executable: process.execPath, prefix: [script], cwd });
  const r = await c.run(["child"], { cwd, timeoutMs: 30 });
  expect(r.timedOut).toBe(true);
  expect(r.exitCode).not.toBe(undefined);
  // The receipt is about this CLI, never proof of aggregate owned settlement.
  expect(r.exitCode === null || r.exitCode === 0).toBe(true);
});

it("resolves a single configured executable and never falls back after a missing selected path", async () => {
  const m = await client();
  expect(
    m.resolveOrcaExecutable({ ORCA_CLI_COMMAND: process.execPath }, "darwin"),
  ).toBe(realpathSync(process.execPath));
  expect(() =>
    m.resolveOrcaExecutable(
      { ORCA_CLI_COMMAND: "/missing/orca", PATH: process.env.PATH },
      "darwin",
    ),
  ).toThrow("ORCA_EXECUTABLE_UNAVAILABLE");
  expect(() => m.resolveOrcaExecutable({ PATH: "" }, "linux")).toThrow(
    "ORCA_EXECUTABLE_UNAVAILABLE",
  );
});
