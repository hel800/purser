import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

export type IpcArgs = Record<string, unknown>;
export type IpcHandler = (args: IpcArgs) => unknown;

export interface IpcCall {
  cmd: string;
  args: IpcArgs;
}

/**
 * Stands in for the backend: `invoke` goes to the handler of the same command
 * name and every call is recorded in the returned list. Commands without a
 * handler resolve to undefined, like the backend's fire-and-forget commands
 * and the window calls. `emit`/`listen` are delivered in memory and not
 * recorded; listen for an event to assert on it.
 */
export function installIpc(handlers: Record<string, IpcHandler> = {}, windowLabel = "main"): IpcCall[] {
  const calls: IpcCall[] = [];
  mockWindows(windowLabel);
  mockIPC(
    (cmd, args) => {
      const callArgs = (args ?? {}) as IpcArgs;
      calls.push({ cmd, args: callArgs });
      return handlers[cmd]?.(callArgs);
    },
    { shouldMockEvents: true }
  );
  return calls;
}

/** The arguments of every recorded call of `cmd`, in order. */
export function argsOf(calls: IpcCall[], cmd: string): IpcArgs[] {
  return calls.filter((c) => c.cmd === cmd).map((c) => c.args);
}
