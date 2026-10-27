import type { AppSettings } from "../lib/settings.svelte";

/** What the backend's `get_settings` answers in component tests. */
export const TEST_SETTINGS: AppSettings = {
  hour24: true,
  autoUpdateCheck: true,
  quickAddShortcut: "ctrl+alt+n",
  listShortcut: "ctrl+alt+l",
  quickAddPretty: "Ctrl+Alt+N",
  listPretty: "Ctrl+Alt+L",
  dateLanguage: "en",
};
