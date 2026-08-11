import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface AppSettings {
  hour24: boolean;
}

export const settings: AppSettings = $state({ hour24: true });

export async function initSettings(): Promise<void> {
  try {
    const s = await invoke<AppSettings>("get_settings");
    settings.hour24 = s.hour24;
  } catch {
    // keep defaults if the backend is unavailable (e.g. plain browser)
  }
  await listen<AppSettings>("purser://settings-changed", (e) => {
    settings.hour24 = e.payload.hour24;
  });
}
