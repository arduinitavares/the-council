import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PilotJournal } from "../../src/pilot/journal.js";
import type { PilotRequest } from "../../src/pilot/types.js";

const bounds = { runId: "smoke", maxProbeCalls: 8, maxTopicCalls: 10, deadline: 1800000000000,
  workerTimeoutMs: 1000, proofTtlMs: 10000, configHash: "a".repeat(64) };
async function withJournal(run: (journal: PilotJournal, workspace: string) => Promise<void>) {
  const workspace = mkdtempSync(join(tmpdir(), "pilot-journal-"));
  let journal: PilotJournal | undefined;
  let failed = false;
  let failure: unknown;
  try {
    journal = new PilotJournal(workspace, "smoke", bounds);
    await run(journal, workspace);
  } catch (error) { failed = true; failure = error; }
  finally {
    try { journal?.close(); } catch (error) { if (!failed) { failed = true; failure = error; } }
    try { rmSync(workspace, { recursive: true, force: true }); }
    catch (error) { if (!failed) { failed = true; failure = error; } }
  }
  if (failed) throw failure;
}
it("persists bounds before dispatch and fences an interrupted run against a restart", async () => {
  await withJournal(async (journal, workspace) => {
    journal.append({ event: "attempt-reserved", runId: "native-run", role: "openai", phase: "normal-probe", key: "reserved-mutation",
      mutationRequestId: "b8cfe79e-83aa-4ab7-98fe-ae67f518ff32" });
    expect(readFileSync(join(journal.path, "events.jsonl"), "utf8")).toContain("reserved-mutation");
    expect(() => new PilotJournal(workspace, "smoke", bounds)).toThrow("NATIVE_RUN_EXISTS_INSPECT_REQUIRED");
  });
});

it("records a durable native Run mutation identity before submission and preserves unknown launches", async () => {
  await withJournal(async journal => {
    const driver = journal.wrap({
      begin: async (_request: unknown, requestId?: string) => {
        expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
        expect(readFileSync(join(journal.path, "events.jsonl"), "utf8")).toContain(requestId!);
        return "native-run";
      },
      launch: async () => { throw Error("unknown native mutation result"); },
      inspect: async () => { throw Error("not used"); },
      observe: async () => { throw Error("not used"); },
      cancel: async () => { throw Error("not used"); },
      release: async () => { throw Error("not used"); },
    });
    expect(await driver.begin({} as PilotRequest)).toBe("native-run");
    await expect(driver.launch("native-run", {} as PilotRequest, "openai", "normal-probe", "packet", "key")).rejects.toThrow("DIAGNOSTIC_UNKNOWN");
    const events = readFileSync(join(journal.path, "events.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line).event);
    expect(events.at(-1)).toMatchObject({ event: "launch-unknown", runId: "native-run", key: "key" });
    expect(events.at(-1).mutationRequestId).toMatch(/^[a-f0-9-]{36}$/);
  });
});
