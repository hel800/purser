import { beforeEach, describe, expect, it, vi } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { argsOf, installIpc, type IpcCall } from "../test/ipc";
import { initSettings, settings, SETTINGS_TIMEOUT_MS, type AppSettings } from "./settings.svelte";

const STORED: AppSettings = {
  hour24: false,
  autoUpdateCheck: false,
  quickAddShortcut: "ctrl+shift+a",
  listShortcut: "ctrl+shift+l",
  quickAddPretty: "Ctrl+Shift+A",
  listPretty: "Ctrl+Shift+L",
  dateLanguage: "de",
};

/** Backend whose `get_settings` fails `failures` times before answering. */
function backend(failures: number): IpcCall[] {
  let attempts = 0;
  return installIpc({
    get_settings: () => {
      if (attempts++ < failures) throw "state not managed";
      return STORED;
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  settings.hour24 = true;
  settings.dateLanguage = "auto";
});

describe("initSettings", () => {
  it("asks again while the backend is still starting", async () => {
    const calls = backend(2);
    const done = initSettings();
    await vi.runAllTimersAsync();
    await done;
    expect(argsOf(calls, "get_settings")).toHaveLength(3);
    expect(settings.hour24).toBe(false);
    expect(settings.dateLanguage).toBe("de");
  });

  it("gives up and keeps the defaults without a backend", async () => {
    const calls = backend(Infinity);
    const done = initSettings();
    await vi.advanceTimersByTimeAsync(SETTINGS_TIMEOUT_MS + 100);
    await done;
    expect(settings.hour24).toBe(true);
    expect(settings.dateLanguage).toBe("auto");
    const asked = argsOf(calls, "get_settings").length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(argsOf(calls, "get_settings")).toHaveLength(asked);
  });

  it("follows settings changed in another window", async () => {
    backend(0);
    await initSettings();
    await emit("purser://settings-changed", { ...STORED, hour24: true, listPretty: "Ctrl+L" });
    expect(settings.hour24).toBe(true);
    expect(settings.listPretty).toBe("Ctrl+L");
    expect(settings.quickAddShortcut).toBe("ctrl+shift+a");
  });
});
