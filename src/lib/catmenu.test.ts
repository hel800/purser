import { describe, expect, it } from "vitest";
import type { Category } from "./db";
import {
  buildCatMenuItems,
  catMenuChoice,
  catMenuKeyAction,
  categoryGhost,
  isNewCategoryValid,
  isRenameValid,
  moveCatMenuCursor,
  type CatMenuState,
} from "./catmenu";

const CATEGORIES: Category[] = [
  { id: 1, name: "Work", color: "#6ea8fe" },
  { id: 2, name: "Workshop", color: "#81c995" },
  { id: 3, name: "home", color: "#f6b26b" },
];

describe("buildCatMenuItems", () => {
  it("lists every category, then a No category row", () => {
    expect(buildCatMenuItems(CATEGORIES.slice(0, 1))).toEqual([
      { kind: "cat", name: "Work", color: "#6ea8fe", key: "c1" },
      { kind: "none", key: "none" },
    ]);
    expect(buildCatMenuItems([])).toEqual([{ kind: "none", key: "none" }]);
  });
});

describe("name checks", () => {
  it("accepts a new name only with text that #tags can reference", () => {
    expect(isNewCategoryValid(" errands ")).toBe(true);
    expect(isNewCategoryValid("   ")).toBe(false);
    expect(isNewCategoryValid("two words")).toBe(false);
  });

  it("rejects a rename onto another category, in any case", () => {
    expect(isRenameValid("HOME", 1, CATEGORIES)).toBe(false);
    expect(isRenameValid("work", 1, CATEGORIES)).toBe(true);
    expect(isRenameValid(" Job ", 1, CATEGORIES)).toBe(true);
    expect(isRenameValid("a b", 1, CATEGORIES)).toBe(false);
  });
});

describe("categoryGhost", () => {
  it("completes the first category the typed text starts", () => {
    expect(categoryGhost("wo", CATEGORIES)).toBe("rk");
    expect(categoryGhost("H", CATEGORIES)).toBe("ome");
  });

  it("shows nothing for an exact name, no match or invalid text", () => {
    expect(categoryGhost("work", CATEGORIES)).toBe("");
    expect(categoryGhost("x", CATEGORIES)).toBe("");
    expect(categoryGhost("", CATEGORIES)).toBe("");
    expect(categoryGhost("wo rk", CATEGORIES)).toBe("");
  });
});

describe("moveCatMenuCursor", () => {
  it("moves between the input (0) and the last row without wrapping", () => {
    expect(moveCatMenuCursor(0, 1, 4)).toBe(1);
    expect(moveCatMenuCursor(0, -1, 4)).toBe(0);
    expect(moveCatMenuCursor(4, 1, 4)).toBe(4);
    expect(moveCatMenuCursor(4, -1, 4)).toBe(3);
  });
});

describe("catMenuChoice", () => {
  const items = buildCatMenuItems(CATEGORIES);

  it("assigns the typed name from the input row", () => {
    expect(catMenuChoice(0, items, " errands ")).toBe("errands");
    expect(catMenuChoice(0, items, "")).toBeUndefined();
    expect(catMenuChoice(0, items, "a b")).toBeUndefined();
  });

  it("assigns a listed category, or removes it with No category", () => {
    expect(catMenuChoice(2, items, "ignored")).toBe("Workshop");
    expect(catMenuChoice(4, items, "")).toBeNull();
    expect(catMenuChoice(5, items, "")).toBeUndefined();
  });

  it("treats a category row without a name as no category", () => {
    expect(catMenuChoice(1, [{ kind: "cat", key: "c9" }], "")).toBeNull();
  });
});

describe("catMenuKeyAction", () => {
  const inInput: CatMenuState = { active: 0, typing: false, ghost: "" };
  const onRow: CatMenuState = { active: 2, typing: false, ghost: "" };

  it("closes on Escape and moves with the arrow keys", () => {
    expect(catMenuKeyAction("Escape", onRow)).toEqual({ type: "close" });
    expect(catMenuKeyAction("ArrowDown", inInput)).toEqual({ type: "move", dir: 1 });
    expect(catMenuKeyAction("ArrowUp", onRow)).toEqual({ type: "move", dir: -1 });
  });

  it("moves with j/k only on a row; in the input they type", () => {
    expect(catMenuKeyAction("j", onRow)).toEqual({ type: "move", dir: 1 });
    expect(catMenuKeyAction("k", onRow)).toEqual({ type: "move", dir: -1 });
    expect(catMenuKeyAction("j", inInput)).toBeNull();
  });

  it("chooses the typed name over a hovered row, else the active row", () => {
    expect(catMenuKeyAction("Enter", { ...onRow, typing: true })).toEqual({ type: "choose", row: 0 });
    expect(catMenuKeyAction("Enter", onRow)).toEqual({ type: "choose", row: 2 });
  });

  it("accepts the completion with Tab, and with → only on a shown ghost", () => {
    expect(catMenuKeyAction("Tab", onRow)).toEqual({ type: "acceptGhost" });
    expect(catMenuKeyAction("ArrowRight", { ...inInput, ghost: "rk" })).toEqual({ type: "acceptGhost" });
    expect(catMenuKeyAction("ArrowRight", inInput)).toBeNull();
    expect(catMenuKeyAction("ArrowRight", { ...onRow, ghost: "rk" })).toBeNull();
  });

  it("leaves other keys to the input", () => {
    expect(catMenuKeyAction("a", inInput)).toBeNull();
  });
});
