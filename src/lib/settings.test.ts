import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const { initSettings, settings, SETTINGS_TIMEOUT_MS } = await import("./settings.svelte");

const STORED = {
  hour24: false,
  autoUpdateCheck: false,
  quickAddShortcut: "ctrl+shift+a",
  listShortcut: "ctrl+shift+l",
  quickAddPretty: "Ctrl+Shift+A",
  listPretty: "Ctrl+Shift+L",
  dateLanguage: "de",
};

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
  settings.hour24 = true;
  settings.dateLanguage = "auto";
});
afterEach(() => vi.useRealTimers());

describe("initSettings", () => {
  it("asks again while the backend is still starting", async () => {
    invoke
      .mockRejectedValueOnce("state not managed")
      .mockRejectedValueOnce("state not managed")
      .mockResolvedValue(STORED);
    const done = initSettings();
    await vi.runAllTimersAsync();
    await done;
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(settings.hour24).toBe(false);
    expect(settings.dateLanguage).toBe("de");
  });

  it("gives up and keeps the defaults without a backend", async () => {
    invoke.mockRejectedValue("no backend");
    const done = initSettings();
    await vi.advanceTimersByTimeAsync(SETTINGS_TIMEOUT_MS + 100);
    await done;
    expect(settings.hour24).toBe(true);
    expect(settings.dateLanguage).toBe("auto");
    const calls = invoke.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(invoke.mock.calls.length).toBe(calls);
  });
});
