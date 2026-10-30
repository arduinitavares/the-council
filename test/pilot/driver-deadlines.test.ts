import { afterEach, expect, it, vi } from "vitest";
import { OrcaPilotDriver } from "../../src/pilot/orca-driver.js";
import type { Attempt } from "../../src/pilot/types.js";

const epoch = 1_800_000_000_000;
const attempt: Attempt = {
  binding: { runId: "run", taskId: "task", dispatchId: "dispatch", handle: "owned", attemptKey: "key" },
  role: "openai", phase: "normal-probe",
  selection: { route: "codex", model: "gpt-6.1-sol", effort: "max" },
  packetHash: "packet", launchVerified: true,
};
afterEach(() => vi.useRealTimers());
function fixture(completedAfter: number, lost = false) {
  vi.useFakeTimers();
  vi.setSystemTime(epoch);
  let shows = 0, stops = 0;
  const driver = new OrcaPilotDriver(async (argv) => {
    if (argv[1] === "worker-stop") { stops++; return { status: "stopping" }; }
    if (argv[1] === "worker-show") {
      shows++;
      const done = shows > completedAfter;
      return {
        dispatch: { id: "dispatch", runId: "run", taskId: "task", status: done ? "succeeded" : "dispatched" },
        observation: { status: lost ? "unverifiable" : done ? "exited" : "live", exactWorker: true },
      };
    }
    if (argv[1] === "worker-read") return {
      dispatchId: "dispatch", source: "transcript", sourceIdentity: "native-source", provider: "codex",
      transcript: { limited: false, messages: [{ role: "assistant", blocks: [{ type: "text", text: JSON.stringify({
        binding: attempt.binding, role: attempt.role, phase: attempt.phase, packetHash: attempt.packetHash,
        selection: attempt.selection, payload: { ready: true },
      }) }] }] },
    };
    throw Error("unexpected command");
  }, { inspect: async () => { throw Error("not used"); } });
  return { driver, counts: () => ({ shows, stops }) };
}

it("collects completion after 100 polls while the real inference deadline remains open", async () => {
  const h = fixture(110);
  const result = h.driver.observe(attempt, epoch + 120000).then(value => ({ value }), error => ({ error }));
  await vi.runAllTimersAsync();
  expect(await result).toMatchObject({ value: { payload: { ready: true }, settlement: "unknown" } });
  expect(h.counts().shows).toBe(111);
  expect(Date.now()).toBeLessThan(epoch + 120000);
});

it("sends cancellation once and waits for positive asynchronous exit", async () => {
  const h = fixture(3);
  const result = h.driver.cancel(attempt, epoch + 10000);
  await vi.runAllTimersAsync();
  expect(await result).toBe("settled");
  expect(h.counts()).toEqual({ shows: 4, stops: 1 });
});
it("gives a near-expiry stop a sane command window and observes exit after an ambiguous delivery", async () => {
  vi.useFakeTimers(); vi.setSystemTime(epoch);
  let stops = 0, shows = 0;
  const driver = new OrcaPilotDriver(async (argv, _cwd, timeout) => {
    if (argv[1] === "worker-stop") {
      stops++;
      expect(timeout).toBe(5000);
      throw Object.assign(new Error("ambiguous delivery"), { code: "ETIMEDOUT" });
    }
    if (argv[1] === "worker-show") {
      shows++;
      return { dispatch: { id: "dispatch", runId: "run", taskId: "task" }, observation: { exactWorker: true, status: shows > 1 ? "exited" : "live" } };
    }
    throw Error("unexpected mutation");
  }, { inspect: async () => { throw Error("unused"); } });
  const result = driver.cancel(attempt, epoch + 10);
  await vi.runAllTimersAsync();
  expect(await result).toBe("settled");
  expect({ stops, shows }).toEqual({ stops: 1, shows: 2 });
  expect(Date.now()).toBeGreaterThan(epoch + 10);
});

it("never renews a caller's expired absolute cleanup window", async () => {
  const h = fixture(Infinity);
  const result = h.driver.cancel(attempt, epoch - 1, "absolute-cleanup");
  await vi.runAllTimersAsync();
  expect(await result).toBe("unknown");
  expect(h.counts()).toEqual({ stops: 0, shows: 0 });
  expect(Date.now()).toBe(epoch);
});

it("keeps lost cancellation contact unknown without a repeated stop", async () => {
  const h = fixture(3, true);
  const result = h.driver.cancel(attempt, epoch + 10000);
  await vi.runAllTimersAsync();
  expect(await result).toBe("unknown");
  expect(h.counts().stops).toBe(1);
});

it("waits only to the absolute cancellation deadline for an owned live process", async () => {
  const h = fixture(Infinity);
  const result = h.driver.cancel(attempt, epoch + 2500, "absolute-cleanup");
  await vi.runAllTimersAsync();
  expect(await result).toBe("unknown");
  expect(Date.now()).toBe(epoch + 2500);
  expect(h.counts().stops).toBe(1);
});

it("settles an owned process when cancellation begins after the inference deadline", async () => {
  const h = fixture(2);
  vi.setSystemTime(epoch + 120001);
  const result = h.driver.cancel(attempt, epoch + 120000);
  await vi.runAllTimersAsync();
  expect(await result).toBe("settled");
  expect(h.counts()).toEqual({ shows: 3, stops: 1 });
  expect(Date.now()).toBeLessThanOrEqual(epoch + 150001);
});

it("does not reissue an already attempted stop after contact loss", async () => {
  const h = fixture(3, true);
  expect(await h.driver.cancel(attempt, epoch + 10000)).toBe("unknown");
  expect(await h.driver.cancel(attempt, epoch + 10000)).toBe("unknown");
  expect(h.counts().stops).toBe(1);
});

it("bounds an expired live cleanup to30seconds and a future cancellation to120seconds", async () => {
  const expired=fixture(Infinity);
  vi.setSystemTime(epoch+1);
  const first=expired.driver.cancel(attempt,epoch);
  await vi.runAllTimersAsync();
  expect(await first).toBe("unknown");
  expect(Date.now()).toBe(epoch+30001);
  const future=fixture(Infinity);
  const second=future.driver.cancel(attempt,epoch+1800000);
  await vi.runAllTimersAsync();
  expect(await second).toBe("unknown");
  expect(Date.now()).toBe(epoch+120000);
});
