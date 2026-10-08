import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** What the backend's `check_update` found (see `UpdateInfo` in lib.rs). */
export interface UpdateInfo {
  version: string;
}

/** Re-check interval while the tray app keeps running (once a day). */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Retries after a startup check that found nothing (network not up yet at login). */
export const UPDATE_RETRY_DELAYS_MS = [60 * 1000, 10 * 60 * 1000];

/** Minimum age of the last check before opening the popup triggers another. */
export const UPDATE_SHOW_CHECK_MIN_MS = 60 * 60 * 1000;

/**
 * Asks the backend whether a newer version exists: the update, null when up
 * to date. Throws when the check itself failed (offline, no manifest yet, a
 * bad signature) — the caller decides whether that is worth showing.
 */
export function checkForUpdate(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>("check_update");
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
