import { describe, expect, it } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { argsOf, installIpc } from "../test/ipc";
import { checkForUpdate, installUpdate } from "./updater";

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
