/** The modifier and key fields of a keyboard event that a combo is built from. */
export type ComboKeys = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

const NAMED_KEYS: Record<string, string> = {
  Space: "space",
  Enter: "enter",
  Tab: "tab",
  Backspace: "backspace",
  Delete: "delete",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
};

/** Combo token for a non-modifier key (by `KeyboardEvent.code`, so the
 *  keyboard layout doesn't matter), or null for keys the backend's shortcut
 *  parser does not understand. */
export function keyToken(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code.toLowerCase();
  return NAMED_KEYS[code] ?? null;
}

/** The pressed combo ("ctrl+alt+n"), a reason it can't be used, or neither
 *  while only modifiers are down. */
export function comboFromEvent(e: ComboKeys): { combo?: string; reason?: string } {
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return {}; // wait for the main key
  const mods = [
    e.ctrlKey && "ctrl",
    e.altKey && "alt",
    e.shiftKey && "shift",
    e.metaKey && "super",
  ].filter(Boolean) as string[];
  if (mods.length === 0) {
    return { reason: "Hold down a modifier (Ctrl, Alt, Shift or Win) with a key." };
  }
  const token = keyToken(e.code);
  if (!token) return { reason: "Unsupported key — try a letter, number or F-key." };
  return { combo: [...mods, token].join("+") };
}
