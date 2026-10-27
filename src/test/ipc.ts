import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { contractViolation, isKnownCommand } from "./commands";

export type IpcArgs = Record<string, unknown>;
export type IpcHandler = (args: IpcArgs) => unknown;

export interface IpcCall {
  cmd: string;
  args: IpcArgs;
}

/** Calls the real backend would refuse; setup.ts fails the test on any. */
const violations: string[] = [];

/** Returns and forgets the contract violations recorded so far. */
export function takeViolations(): string[] {
  return violations.splice(0);
}

/**
 * Stands in for the backend: `invoke` goes to the handler of the same command
 * name and every call is recorded in the returned list. Commands without a
 * handler resolve to undefined, like the backend's fire-and-forget commands
 * and the window calls. `emit`/`listen` are delivered in memory and not
 * recorded; listen for an event to assert on it.
 *
 * Calls and handlers are checked against the commands and arguments lib.rs
 * declares. A bad call is recorded rather than thrown, since the code under
 * test may well swallow the rejection.
 */
export function installIpc(handlers: Record<string, IpcHandler> = {}, windowLabel = "main"): IpcCall[] {
  // a handler for a command that doesn't exist is a test gone stale
  for (const cmd of Object.keys(handlers)) {
    if (!isKnownCommand(cmd)) throw new Error(`installIpc: no backend command "${cmd}" to stand in for`);
  }
  const calls: IpcCall[] = [];
  mockWindows(windowLabel);
  mockIPC(
    (cmd, args) => {
      const callArgs = (args ?? {}) as IpcArgs;
      calls.push({ cmd, args: callArgs });
      const violation = contractViolation(cmd, callArgs);
      if (violation) violations.push(violation);
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
