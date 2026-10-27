import { afterEach, vi } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";
import { takeViolations } from "./ipc";

// @tauri-apps/api and its mocks reach the backend through
// window.__TAURI_INTERNALS__; the node project has no window of its own
globalThis.window ??= globalThis as Window & typeof globalThis;

afterEach(() => {
  clearMocks();
  vi.useRealTimers();
  const violations = takeViolations();
  if (violations.length) {
    throw new Error(`calls the backend would refuse:\n${[...new Set(violations)].join("\n")}`);
  }
});
