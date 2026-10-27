// What each key does in the popup, the full-size list and quick-add — the
// decisions only; the components carry the actions out. A README shortcut
// table change belongs here.

/** The action a key triggers (null: none) and whether the webview's own
 *  handling of the key (focus moves, button activation, scrolling) must be
 *  blocked. */
export interface KeyResult<A> {
  action: A | null;
  preventDefault: boolean;
}

const IGNORED: KeyResult<never> = { action: null, preventDefault: false };
/** No action, but the webview must not handle the key either. */
const BLOCKED: KeyResult<never> = { action: null, preventDefault: true };

function act<A>(action: A, preventDefault = true): KeyResult<A> {
  return { action, preventDefault };
}

/** Ctrl+P. Bound explicitly: the webview's own is not reliable everywhere. */
export function isPrintKey(e: Pick<KeyboardEvent, "ctrlKey" | "key">): boolean {
  return e.ctrlKey && e.key.toLowerCase() === "p";
}

export type View = "open" | "done";

export type PopupAction =
  | "hide"
  | "down"
  | "up"
  | "toggleDone"
  | "editDue"
  | "editText"
  | "editCategory"
  | "cycleCategory"
  | "cycleDue"
  | "toggleNotes"
  | "editNotes"
  | "delete"
  | "switchView"
  | "fullView"
  | "installUpdate"
  | "help";

export interface PopupKeyState {
  view: View;
  /** a todo is selected (the list isn't empty) */
  hasSelection: boolean;
  /** the update banner offers an install (or a retry) */
  canInstallUpdate: boolean;
}

/** The popup's list keys, while no editor or menu is open. */
export function popupKeyAction(key: string, state: PopupKeyState): KeyResult<PopupAction> {
  const open = state.view === "open";
  // editing keys only act on a selected open todo; otherwise they type nothing
  const edit = (action: PopupAction) => (open && state.hasSelection ? act(action) : IGNORED);
  switch (key) {
    case "Escape":
      return act("hide", false);
    case "ArrowDown":
    case "j":
      return act("down");
    case "ArrowUp":
    case "k":
      return act("up");
    case "Enter":
      // a previously clicked button (tab, pen, wordmark…) may still hold
      // focus — block its default Enter activation, only toggle the todo
      return act("toggleDone");
    case "d":
      return edit("editDue");
    case "e":
    case "F2":
      return edit("editText");
    case "c":
      return edit("editCategory");
    case "n":
      return edit("editNotes");
    case "t":
      return open ? act("cycleCategory") : IGNORED;
    case "f":
      return open ? act("cycleDue") : IGNORED;
    case " ":
      // also blocks a focused button from being space-activated
      return act("toggleNotes");
    case "Delete":
      return !open && state.hasSelection ? act("delete", false) : IGNORED;
    case "Tab":
      return act("switchView");
    case "l":
      return act("fullView");
    case "u":
      // Esc stays the window's, so the banner survives hiding the popup
      return state.canInstallUpdate ? act("installUpdate") : IGNORED;
    case "?":
    case "F1":
      return act("help");
    default:
      return IGNORED;
  }
}

export type ListAction =
  | "back"
  | "rowDown"
  | "rowUp"
  | "pageDown"
  | "pageUp"
  | "top"
  | "bottom"
  | "switchView"
  | "cycleCategory"
  | "cycleDue"
  | "viewOnly"
  | "help";

/** The full-size view's keys without modifiers (Ctrl+P: `isPrintKey`). */
export function listKeyAction(key: string, shiftKey: boolean, view: View): KeyResult<ListAction> {
  switch (key) {
    case "Escape":
    case "l":
      return act("back");
    case "ArrowDown":
    case "j":
      return act("rowDown");
    case "ArrowUp":
    case "k":
      return act("rowUp");
    case "PageDown":
      return act("pageDown");
    case "PageUp":
      return act("pageUp");
    case " ":
      // also blocks a focused button from being space-activated
      return act(shiftKey ? "pageUp" : "pageDown");
    case "Home":
      return act("top");
    case "End":
      return act("bottom");
    case "Tab":
      return act("switchView");
    case "t":
      return view === "open" ? act("cycleCategory") : IGNORED;
    case "f":
      return view === "open" ? act("cycleDue") : IGNORED;
    // the popup's edit keys: say why nothing happens instead of ignoring them
    // (blocking Enter also keeps a clicked button from being re-clicked)
    case "Enter":
    case "e":
    case "F2":
    case "d":
    case "c":
    case "n":
    case "Delete":
      return act("viewOnly");
    case "?":
    case "F1":
      return act("help");
    default:
      return IGNORED;
  }
}

export type QuickAddAction = "help" | "complete" | "nextSuggestion" | "previousSuggestion" | "hide" | "clear" | "save";

/** Quick-add's keys; `completing` while a category completion is shown. */
export function quickAddKeyAction(key: string, ctrlKey: boolean, completing: boolean): KeyResult<QuickAddAction> {
  if (key === "F1") return act("help");
  // only intercept keys while a completion is actually visible
  if (completing) {
    if (key === "Tab" || key === "ArrowRight") return act("complete");
    if (key === "ArrowDown") return act("nextSuggestion");
    if (key === "ArrowUp") return act("previousSuggestion");
  }
  switch (key) {
    case "Tab":
      // without a completion Tab would move focus out of the input and
      // eventually out of the window, hiding the widget — so it's a no-op
      return BLOCKED;
    case "Escape":
      return act("hide", false);
    case "Backspace":
      // default Ctrl+Backspace only deletes a word; clear everything
      return ctrlKey ? act("clear") : IGNORED;
    case "Enter":
      // the textarea wraps visually only — Enter never inserts a newline
      return act("save");
    default:
      return IGNORED;
  }
}
