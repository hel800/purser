import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface AppSettings {
  hour24: boolean;
  quickAddShortcut: string;
  listShortcut: string;
}

export const settings: AppSettings = $state({
  hour24: true,
  quickAddShortcut: "ctrl+alt+n",
  listShortcut: "ctrl+alt+l",
});

export async function initSettings(): Promise<void> {
  try {
    const s = await invoke<AppSettings>("get_settings");
    settings.hour24 = s.hour24;
    settings.quickAddShortcut = s.quickAddShortcut;
    settings.listShortcut = s.listShortcut;
  } catch {
    // keep defaults if the backend is unavailable (e.g. plain browser)
  }
  await listen<AppSettings>("purser://settings-changed", (e) => {
    settings.hour24 = e.payload.hour24;
    settings.quickAddShortcut = e.payload.quickAddShortcut;
    settings.listShortcut = e.payload.listShortcut;
  });
}

/** "ctrl+alt+n" → "Ctrl+Alt+N" */
export function prettyShortcut(combo: string): string {
  return combo
    .split("+")
    .map((token) => {
      const t = token.toLowerCase();
      if (t === "ctrl" || t === "control") return "Ctrl";
      if (t === "alt" || t === "option") return "Alt";
      if (t === "shift") return "Shift";
      if (t === "super" || t === "cmd" || t === "command" || t === "win")
        return "Win";
      if (t.length === 1) return t.toUpperCase();
      return t.charAt(0).toUpperCase() + t.slice(1);
    })
    .join("+");
}