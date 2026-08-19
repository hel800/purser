import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface AppSettings {
  hour24: boolean;
  quickAddShortcut: string;
  listShortcut: string;
  /** display-ready combo strings, formatted by the backend so the tray
   *  accelerator text and the help sheet can never disagree */
  quickAddPretty: string;
  listPretty: string;
}

export const settings: AppSettings = $state({
  hour24: true,
  quickAddShortcut: "ctrl+alt+n",
  listShortcut: "ctrl+alt+l",
  quickAddPretty: "Ctrl+Alt+N",
  listPretty: "Ctrl+Alt+L",
});

function apply(s: AppSettings) {
  settings.hour24 = s.hour24;
  settings.quickAddShortcut = s.quickAddShortcut;
  settings.listShortcut = s.listShortcut;
  settings.quickAddPretty = s.quickAddPretty;
  settings.listPretty = s.listPretty;
}

export async function initSettings(): Promise<void> {
  try {
    apply(await invoke<AppSettings>("get_settings"));
  } catch {
    // keep defaults if the backend is unavailable (e.g. plain browser)
  }
  await listen<AppSettings>("purser://settings-changed", (e) => apply(e.payload));
}
