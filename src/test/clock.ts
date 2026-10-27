import { vi } from "vitest";

/** Stops the clock at `date`; timers keep running (setup.ts restores it). */
export function freezeAt(date: Date): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(date);
}
