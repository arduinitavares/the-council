import { execFile, type ChildProcess } from "node:child_process";

export type ProviderWorkKind = "parsing" | "scan";
export type ProviderWorkResult<T> = { state: "settled"; value: T } |
  { state: "rejected"; reason: unknown } | { state: "deadline" };

export async function waitForProviderWork<T>(_kind: ProviderWorkKind, work: Promise<T>,
  deadline: () => number, poll: () => void,
  timers: Set<ReturnType<typeof setTimeout>>): Promise<ProviderWorkResult<T>> {
  let result: ProviderWorkResult<T> | undefined;
  // Keep the rejection observer attached even if the caller reaches its bound.
  void work.then(value => { result = { state: "settled", value }; }, reason => { result = { state: "rejected", reason }; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    for (;;) {
      poll();
      const remaining = deadline()-Date.now();
      if (result) return result;
      if (remaining <= 0) return { state: "deadline" };
      await new Promise<void>(resolve => {
        timer = setTimeout(() => { timers.delete(timer!); timer = undefined; resolve(); }, Math.min(20, remaining));
        timers.add(timer);
      });
    }
  } finally {
    if (timer !== undefined) { clearTimeout(timer); timers.delete(timer); }
  }
}

export interface OwnedProviderScan {
  result: Promise<string>;
  settled(): boolean;
  stop(): void;
}

export function startProviderProcessScan(deadline: number): OwnedProviderScan {
  let child: ChildProcess | undefined, resultObserved = false, closeObserved = false, stopped = false;
  const onError = () => { /* execFile's callback owns the result; keep late child errors handled. */ };
  const clearListeners = () => {
    if (resultObserved && closeObserved && child) { child.off("close", onClose); child.off("error", onError); }
  };
  const onClose = () => { closeObserved = true; clearListeners(); };
  const result = new Promise<string>((resolve, reject) => {
    const remaining = deadline-Date.now();
    if (remaining <= 0) {
      resultObserved = closeObserved = true; reject(Error("PROVIDER_PROCESS_SCAN_DEADLINE")); return;
    }
    try {
      child = execFile("ps", ["-axo", "pid=,ppid=,pgid="], {
        timeout: Math.min(2000, remaining), killSignal: "SIGKILL", maxBuffer: 1_048_576,
      }, (error, stdout) => {
        resultObserved = true;
        if (error) reject(error); else resolve(stdout);
        clearListeners();
      });
      child.once("close", onClose); child.on("error", onError);
    } catch (reason) { resultObserved = closeObserved = true; reject(reason); }
  });
  void result.catch(() => {});
  return { result, settled: () => resultObserved && closeObserved,
    stop() {
      if (stopped || closeObserved || !child) return;
      stopped = true;
      try { child.kill("SIGKILL"); } catch { /* A requested stop is not close evidence. */ }
    } };
}
