import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PilotJournal } from "../../src/pilot/journal.js";
import type { PilotDriver, PilotRequest } from "../../src/pilot/types.js";
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

it("records a durable native Run mutation identity before submission and preserves unknown launches", async () => {
  const w=mkdtempSync(join(tmpdir(),"pilot-journal-mutation-"));
  const journal=new PilotJournal(w,"mutation",{});
  try {
    const driver=journal.wrap({
      begin:async (_request:unknown, requestId?:string) => {
        expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
        expect(readFileSync(join(journal.path,"events.jsonl"),"utf8")).toContain(requestId!);
        return "native-run";
      },
      launch:async()=>{throw Error("unknown native mutation result");},
      inspect:async()=>{throw Error("not used");},
      observe:async()=>{throw Error("not used");},
      cancel:async()=>{throw Error("not used");},
      release:async()=>{throw Error("not used");},
    });
    expect(await driver.begin({} as PilotRequest)).toBe("native-run");
    await expect(driver.launch("native-run",{} as PilotRequest,"openai","normal-probe","packet","key")).rejects.toThrow("unknown native mutation result");
    const events=readFileSync(join(journal.path,"events.jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line).event);
    expect(events.at(-1)).toMatchObject({event:"launch-unknown",runId:"native-run",key:"key"});
    expect(events.at(-1).mutationRequestId).toMatch(/^[a-f0-9-]{36}$/);
  } finally { journal.close(); rmSync(w,{recursive:true,force:true}); }
});
