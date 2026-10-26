import { describe, expect, it } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { argsOf, installIpc } from "../test/ipc";
import {
  canStartInstall,
  checkForUpdate,
  installPhase,
  installUpdate,
  isInstalling,
  shouldCheckOnShow,
  UPDATE_SHOW_CHECK_MIN_MS,
} from "./updater";

describe("checkForUpdate", () => {
  it("returns the update the backend found, or null", async () => {
    let found: { version: string } | null = { version: "9.9.9" };
    installIpc({ check_update: () => found });
    expect(await checkForUpdate()).toEqual({ version: "9.9.9" });
    found = null;
    expect(await checkForUpdate()).toBeNull();
  });

  it("throws when the check itself failed", async () => {
    installIpc({
      check_update: () => {
        throw new Error("offline");
      },
    });
    await expect(checkForUpdate()).rejects.toThrow("offline");
  });
});

describe("installUpdate", () => {
  it("reports the download progress until the install returns", async () => {
    const progress: (number | null)[] = [];
    const calls = installIpc({
      install_update: async () => {
        await emit("purser://update-progress", null);
        await emit("purser://update-progress", 40);
        await emit("purser://update-progress", 100);
      },
    });
    await installUpdate((p) => progress.push(p));
    expect(argsOf(calls, "install_update")).toHaveLength(1);
    expect(progress).toEqual([null, 40, 100]);
    // no longer listening afterwards
    await emit("purser://update-progress", 7);
    expect(progress).toEqual([null, 40, 100]);
  });

  it("stops listening when the install fails", async () => {
    const progress: (number | null)[] = [];
    installIpc({
      install_update: () => {
        throw new Error("bad signature");
      },
    });
    await expect(installUpdate((p) => progress.push(p))).rejects.toThrow("bad signature");
    await emit("purser://update-progress", 7);
    expect(progress).toEqual([]);
  });
});

describe("update phases", () => {
  it("knows when an install is running", () => {
    expect(isInstalling("downloading")).toBe(true);
    expect(isInstalling("installing")).toBe(true);
    expect(isInstalling("offer")).toBe(false);
    expect(isInstalling(null)).toBe(false);
  });

  it("offers an install for a found update or a failed one", () => {
    expect(canStartInstall("offer")).toBe(true);
    expect(canStartInstall("error")).toBe(true);
    expect(canStartInstall("downloading")).toBe(false);
    expect(canStartInstall(null)).toBe(false);
  });

  it("switches to installing once the download is complete", () => {
    expect(installPhase(null)).toBe("downloading");
    expect(installPhase(99)).toBe("downloading");
    expect(installPhase(100)).toBe("installing");
  });

  it("checks on show only without a banner and after an hour", () => {
    const now = 10 * UPDATE_SHOW_CHECK_MIN_MS;
    expect(shouldCheckOnShow(null, now - UPDATE_SHOW_CHECK_MIN_MS - 1, now)).toBe(true);
    expect(shouldCheckOnShow(null, now - UPDATE_SHOW_CHECK_MIN_MS, now)).toBe(false);
    expect(shouldCheckOnShow("offer", 0, now)).toBe(false);
  });
});
