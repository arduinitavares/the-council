import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PilotJournal } from "../../src/pilot/journal.js";
it("persists bounds before dispatch and fences an interrupted run against a restart", () => {
  const w = mkdtempSync(join(tmpdir(), "pilot-journal-"));
  try {
    const j = new PilotJournal(w, "smoke", {
      maxProbeCalls: 8,
      maxTopicCalls: 10,
      deadline: 1800000000000,
    });
    j.append({ event: "attempt-reserved", key: "reserved-mutation" });
    j.close();
    expect(readFileSync(join(j.path, "events.jsonl"), "utf8")).toContain(
      "reserved-mutation",
    );
    expect(() => new PilotJournal(w, "smoke", {})).toThrow(
      "NATIVE_RUN_EXISTS_INSPECT_REQUIRED",
    );
  } finally {
    rmSync(w, { recursive: true, force: true });
  }
});
