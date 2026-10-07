import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** What the backend's `check_update` found (see `UpdateInfo` in lib.rs). */
export interface UpdateInfo {
  version: string;
  body: string | null;
  date: string | null;
}

/** Re-check interval while the tray app keeps running (once a day). */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Asks the backend whether a newer version exists. Any failure — offline, no
 * release with a manifest yet, a bad signature — is treated as "no update":
 * the check runs unattended at startup and must never bother the user with
 * a network error.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    return await invoke<UpdateInfo | null>("check_update");
  } catch (e) {
    console.warn("update check failed:", e);
    return null;
  }
}

/**
 * Downloads and installs the update found last, reporting download progress
 * as 0–100 (or null while the size is unknown). On Windows the installer
 * takes over and exits the app, so the promise never settles there.
 */
export async function installUpdate(onProgress: (percent: number | null) => void): Promise<void> {
  const unlisten = await listen<number | null>("purser://update-progress", (e) => onProgress(e.payload));
  try {
    await invoke("install_update");
  } finally {
    unlisten();
  }
}
