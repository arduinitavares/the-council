import { OrcaPilotDriver, type Command } from "./orca-driver.js";
import { ContextWrapperTransport } from "./context-driver.js";
import type { HostInspector } from "./types.js";
import type { ScopedRpc } from "./rpc.js";
/** Production and credential-free boundary tests share this exact composition. */
export function createNativePilotDriver(input: { command: Command; inspector: HostInspector; rpc: (runtimeId: string) => ScopedRpc; orca: string; record: (event: unknown) => void; now?: () => number }) {
  const now = input.now ?? Date.now;
  return new OrcaPilotDriver(input.command, input.inspector, now, new ContextWrapperTransport(input.command, input.rpc, input.orca, input.record, now));
}
