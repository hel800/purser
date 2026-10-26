import { describe, expect, it } from "vitest";
import { isPrintKey, listKeyAction, popupKeyAction, quickAddKeyAction, type PopupKeyState } from "./keys";

describe("isPrintKey", () => {
  it("is Ctrl+P in either case", () => {
    expect(isPrintKey({ ctrlKey: true, key: "p" })).toBe(true);
    expect(isPrintKey({ ctrlKey: true, key: "P" })).toBe(true);
    expect(isPrintKey({ ctrlKey: false, key: "p" })).toBe(false);
  });
});

describe("popupKeyAction", () => {
  const open: PopupKeyState = { view: "open", hasSelection: true, canInstallUpdate: false };
  const done: PopupKeyState = { ...open, view: "done" };
  const empty: PopupKeyState = { ...open, hasSelection: false };
  const action = (key: string, state = open) => popupKeyAction(key, state).action;

  it("navigates with the arrows and j/k, blocking scrolling", () => {
    expect(popupKeyAction("ArrowDown", empty)).toEqual({ action: "down", preventDefault: true });
    expect(action("j")).toBe("down");
    expect(action("ArrowUp")).toBe("up");
    expect(action("k")).toBe("up");
  });

  it("hides on Escape without blocking it", () => {
    expect(popupKeyAction("Escape", open)).toEqual({ action: "hide", preventDefault: false });
  });

  it("edits the selected open todo with d, e/F2, c and n", () => {
    expect(action("d")).toBe("editDue");
    expect(action("e")).toBe("editText");
    expect(action("F2")).toBe("editText");
    expect(action("c")).toBe("editCategory");
    expect(action("n")).toBe("editNotes");
  });

  it("ignores the edit keys in Done or without a selection, so they type nothing", () => {
    for (const key of ["d", "e", "F2", "c", "n"]) {
      expect(popupKeyAction(key, done)).toEqual({ action: null, preventDefault: false });
      expect(popupKeyAction(key, empty)).toEqual({ action: null, preventDefault: false });
    }
  });

  it("cycles the filters only in Open", () => {
    expect(action("t")).toBe("cycleCategory");
    expect(action("f")).toBe("cycleDue");
    expect(action("t", done)).toBeNull();
    expect(action("f", done)).toBeNull();
  });

  it("deletes only a selected done todo", () => {
    expect(popupKeyAction("Delete", done)).toEqual({ action: "delete", preventDefault: false });
    expect(action("Delete")).toBeNull();
    expect(action("Delete", { ...done, hasSelection: false })).toBeNull();
  });

  it("installs an offered update with u", () => {
    expect(action("u", { ...open, canInstallUpdate: true })).toBe("installUpdate");
    expect(action("u")).toBeNull();
  });

  it("maps the remaining keys", () => {
    expect(action("Enter")).toBe("toggleDone");
    expect(popupKeyAction(" ", empty)).toEqual({ action: "toggleNotes", preventDefault: true });
    expect(action("Tab")).toBe("switchView");
    expect(action("l")).toBe("fullView");
    expect(action("?")).toBe("help");
    expect(action("F1")).toBe("help");
    expect(popupKeyAction("x", open)).toEqual({ action: null, preventDefault: false });
  });
});

describe("listKeyAction", () => {
  const action = (key: string, shift = false, view: "open" | "done" = "open") =>
    listKeyAction(key, shift, view).action;

  it("goes back with Escape or l", () => {
    expect(listKeyAction("Escape", false, "open")).toEqual({ action: "back", preventDefault: true });
    expect(action("l")).toBe("back");
  });

  it("scrolls by row, page and to the ends", () => {
    expect(action("ArrowDown")).toBe("rowDown");
    expect(action("j")).toBe("rowDown");
    expect(action("ArrowUp")).toBe("rowUp");
    expect(action("k")).toBe("rowUp");
    expect(action("PageDown")).toBe("pageDown");
    expect(action("PageUp")).toBe("pageUp");
    expect(action(" ")).toBe("pageDown");
    expect(action(" ", true)).toBe("pageUp");
    expect(action("Home")).toBe("top");
    expect(action("End")).toBe("bottom");
  });

  it("switches the view and cycles the filters only in Open", () => {
    expect(action("Tab", false, "done")).toBe("switchView");
    expect(action("t")).toBe("cycleCategory");
    expect(action("f")).toBe("cycleDue");
    expect(listKeyAction("t", false, "done")).toEqual({ action: null, preventDefault: false });
    expect(action("f", false, "done")).toBeNull();
  });

  it("explains that the popup's edit keys do nothing here", () => {
    for (const key of ["Enter", "e", "F2", "d", "c", "n", "Delete"]) expect(action(key)).toBe("viewOnly");
  });

  it("opens the help and ignores other keys", () => {
    expect(action("?")).toBe("help");
    expect(action("F1")).toBe("help");
    expect(listKeyAction("x", false, "open")).toEqual({ action: null, preventDefault: false });
  });
});

describe("quickAddKeyAction", () => {
  it("opens the help on F1, also while completing", () => {
    expect(quickAddKeyAction("F1", false, true)).toEqual({ action: "help", preventDefault: true });
  });

  it("completes and picks suggestions only while one is shown", () => {
    expect(quickAddKeyAction("Tab", false, true).action).toBe("complete");
    expect(quickAddKeyAction("ArrowRight", false, true).action).toBe("complete");
    expect(quickAddKeyAction("ArrowDown", false, true).action).toBe("nextSuggestion");
    expect(quickAddKeyAction("ArrowUp", false, true).action).toBe("previousSuggestion");
    expect(quickAddKeyAction("ArrowRight", false, false)).toEqual({ action: null, preventDefault: false });
    expect(quickAddKeyAction("ArrowDown", false, false).action).toBeNull();
  });

  it("swallows Tab without a completion so focus stays in the window", () => {
    expect(quickAddKeyAction("Tab", false, false)).toEqual({ action: null, preventDefault: true });
  });

  it("hides, clears and saves", () => {
    expect(quickAddKeyAction("Escape", false, false)).toEqual({ action: "hide", preventDefault: false });
    expect(quickAddKeyAction("Backspace", true, false)).toEqual({ action: "clear", preventDefault: true });
    expect(quickAddKeyAction("Backspace", false, false).action).toBeNull();
    expect(quickAddKeyAction("Enter", false, true)).toEqual({ action: "save", preventDefault: true });
    expect(quickAddKeyAction("a", false, false).action).toBeNull();
  });
});
