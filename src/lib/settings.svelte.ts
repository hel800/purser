import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface AppSettings {
  hour24: boolean;
  /** automatic update checks (startup, daily, on popup open); the tray's
   *  manual check is unaffected */
  autoUpdateCheck: boolean;
  quickAddShortcut: string;
  listShortcut: string;
  /** display-ready combo strings, formatted by the backend so the tray
   *  accelerator text and the help sheet can never disagree */
  quickAddPretty: string;
  listPretty: string;
  /** language due dates are typed in; "auto" follows the Windows language */
  dateLanguage: "auto" | "en" | "de";
}

export const settings: AppSettings = $state({
  hour24: true,
  autoUpdateCheck: true,
  quickAddShortcut: "ctrl+alt+n",
  listShortcut: "ctrl+alt+l",
  quickAddPretty: "Ctrl+Alt+N",
  listPretty: "Ctrl+Alt+L",
  dateLanguage: "auto",
});

function apply(s: AppSettings) {
  settings.hour24 = s.hour24;
  settings.autoUpdateCheck = s.autoUpdateCheck;
  settings.quickAddShortcut = s.quickAddShortcut;
  settings.listShortcut = s.listShortcut;
  settings.quickAddPretty = s.quickAddPretty;
  settings.listPretty = s.listPretty;
  settings.dateLanguage = s.dateLanguage;
}

/** How long `initSettings` keeps asking a backend that is still starting. */
export const SETTINGS_RETRY_MS = 50;
export const SETTINGS_TIMEOUT_MS = 5000;

/**
 * Loads the settings from the backend and follows their changes. Tauri
 * creates the windows from tauri.conf.json right before the backend's
 * `setup()` manages the settings, and a release build serves its bundle from
 * memory, so the first `get_settings` usually arrives too early and fails.
 * It is asked again until `setup()` is done, so callers that wait for this
 * (the popup's startup update check) run with the real settings.
 */
export async function initSettings(): Promise<void> {
  const deadline = Date.now() + SETTINGS_TIMEOUT_MS;
  for (;;) {
    try {
      apply(await invoke<AppSettings>("get_settings"));
      break;
    } catch {
      // keep defaults if the backend is unavailable (e.g. plain browser)
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, SETTINGS_RETRY_MS));
    }
  }
  await listen<AppSettings>("purser://settings-changed", (e) => apply(e.payload));
}
