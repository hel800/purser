import type { Category } from "./db";
import { isValidCategoryName } from "./parse";

// The popup's category menu (C): a "new category" input (row 0), then one
// row per category and a final "No category" row.

export interface CatMenuItem {
  kind: "cat" | "none";
  name?: string;
  color?: string;
  key: string;
}

/** The pick list below the input: every category, then "No category". */
export function buildCatMenuItems(categories: Category[]): CatMenuItem[] {
  const items: CatMenuItem[] = categories.map((c) => ({
    kind: "cat",
    name: c.name,
    color: c.color,
    key: `c${c.id}`,
  }));
  items.push({ kind: "none", key: "none" });
  return items;
}

/** A new category name needs text and must round-trip through #tag syntax. */
export function isNewCategoryValid(value: string): boolean {
  const name = value.trim();
  return name.length > 0 && isValidCategoryName(name);
}

/** Whether category `id` may be renamed to `name`: tag-compatible and not
 *  taken by another category (case-insensitive). */
export function isRenameValid(name: string, id: number, categories: Category[]): boolean {
  const clean = name.trim();
  if (!isValidCategoryName(clean)) return false;
  const lower = clean.toLowerCase();
  return !categories.some((c) => c.id !== id && c.name.toLowerCase() === lower);
}

/** The grayed-out rest of the one existing category `typed` is the start
 *  of; empty when nothing (or an exact name) matches. */
export function categoryGhost(typed: string, categories: Category[]): string {
  if (!typed || !isValidCategoryName(typed)) return "";
  const lower = typed.toLowerCase();
  if (categories.some((c) => c.name.toLowerCase() === lower)) return ""; // already complete
  const match = categories.find((c) => c.name.toLowerCase().startsWith(lower));
  return match ? match.name.slice(typed.length) : "";
}

/** The menu row after moving by `dir`: 0 is the input, `itemCount` the last
 *  row; the cursor stops at both ends instead of wrapping. */
export function moveCatMenuCursor(active: number, dir: 1 | -1, itemCount: number): number {
  return Math.min(Math.max(active + dir, 0), itemCount);
}

/**
 * The category the row at `active` assigns: the typed name for the input
 * row, null for "No category", undefined when there is nothing to assign
 * (an invalid typed name, or no such row).
 */
export function catMenuChoice(active: number, items: CatMenuItem[], typed: string): string | null | undefined {
  if (active === 0) return isNewCategoryValid(typed) ? typed.trim() : undefined;
  const item = items[active - 1];
  if (!item) return undefined;
  return item.kind === "none" ? null : (item.name ?? null);
}

export type CatMenuAction =
  | { type: "close" }
  | { type: "move"; dir: 1 | -1 }
  | { type: "choose"; row: number }
  | { type: "acceptGhost" };

export interface CatMenuState {
  /** the highlighted row, 0 = the input */
  active: number;
  /** the input has focus and holds a valid new name */
  typing: boolean;
  /** the grayed-out completion currently shown */
  ghost: string;
}

/** What a key does while the category menu is open; null leaves the key
 *  alone (it types into the input). */
export function catMenuKeyAction(key: string, state: CatMenuState): CatMenuAction | null {
  switch (key) {
    case "Escape":
      return { type: "close" };
    case "ArrowDown":
      return { type: "move", dir: 1 };
    case "ArrowUp":
      return { type: "move", dir: -1 };
    case "j":
    case "k":
      // only navigate while the list is active — inside the input these
      // must type normally
      return state.active !== 0 ? { type: "move", dir: key === "j" ? 1 : -1 } : null;
    case "Enter":
      // a typed valid name wins over a row the mouse merely hovers, but not
      // over one the user moved to on purpose: arrow keys and j/k give the
      // row focus, hovering leaves the input focused
      return { type: "choose", row: state.typing ? 0 : state.active };
    case "Tab":
      // accept the grayed-out completion instead of tabbing away
      return { type: "acceptGhost" };
    case "ArrowRight":
      return state.active === 0 && state.ghost ? { type: "acceptGhost" } : null;
    default:
      return null;
  }
}
