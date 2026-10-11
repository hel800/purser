import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Todo } from "./db";
import {
  DUE_CYCLE,
  categoryCycle,
  categoryInfo,
  existingCategory,
  filterTodos,
  groupByCategory,
  nextCategory,
  nextDue,
} from "./filters";

/** Sun 11 Oct 2026 13:02:05, Europe/Berlin (TZ is pinned in vitest.config.ts). */
const NOW = new Date(2026, 9, 11, 13, 2, 5);
const local = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(y, m - 1, d, h, mi).toISOString();

function todo(id: number, patch: Partial<Todo> = {}): Todo {
  return {
    id,
    text: `todo ${id}`,
    notes: null,
    category_id: null,
    category_name: null,
    category_color: null,
    due_at: null,
    created_at: "2026-10-01T08:00:00.000Z",
    done_at: null,
    ...patch,
  };
}

const work = { category_id: 1, category_name: "work", category_color: "#6ea8fe" };
const home = { category_id: 2, category_name: "home", category_color: "#81c995" };

// in SQL order: category name, then due date
const todos = [
  todo(1, { ...work, due_at: local(2026, 10, 11, 18) }), // later today
  todo(3, { ...work }), // no date
  todo(2, { due_at: local(2026, 10, 9, 9) }), // overdue, uncategorized
  todo(4, { ...home, due_at: local(2026, 10, 20, 12) }), // next week
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("category filter", () => {
  it("cycles all -> categories in list order (-1 = none)", () => {
    expect(categoryCycle(todos)).toEqual([null, 1, -1, 2]);
    expect(nextCategory(todos, null)).toBe(1);
    expect(nextCategory(todos, 2)).toBe(null);
    expect(nextCategory(todos, 99)).toBe(null); // unknown -> wraps to all
  });

  it("drops a filter whose category has no todo left", () => {
    expect(existingCategory(todos, 1)).toBe(1);
    expect(existingCategory(todos, 5)).toBeNull();
    expect(existingCategory(todos, -1)).toBe(-1);
  });

  it("labels the filter", () => {
    expect(categoryInfo(todos, null)).toEqual({ label: "All categories", color: null });
    expect(categoryInfo(todos, -1)).toEqual({ label: "No category", color: null });
    expect(categoryInfo(todos, 2)).toEqual({ label: "home", color: "#81c995" });
    expect(categoryInfo(todos, 9)).toEqual({ label: "?", color: null });
  });
});

describe("due filter", () => {
  it("cycles through DUE_CYCLE and wraps", () => {
    expect(nextDue("all")).toBe("today");
    expect(nextDue(DUE_CYCLE[DUE_CYCLE.length - 1])).toBe("all");
  });

  it.each([
    ["all", [1, 3, 2, 4]],
    ["today", [1]],
    ["week", [1, 2]],
    ["soon", [1, 2]],
    ["overdue", [2]],
    ["nodate", [3]],
  ] as const)("%s", (due, ids) => {
    expect(filterTodos(todos, null, due).map((t) => t.id)).toEqual([...ids]);
  });

  it("combines with the category filter", () => {
    expect(filterTodos(todos, -1, "all").map((t) => t.id)).toEqual([2]);
    expect(filterTodos(todos, 1, "nodate").map((t) => t.id)).toEqual([3]);
  });
});

describe("groupByCategory", () => {
  it("keeps the list order and names the uncategorized group", () => {
    const groups = groupByCategory(todos);
    expect(groups.map((g) => [g.id, g.category, g.todos.map((t) => t.id)])).toEqual([
      [1, "work", [1, 3]],
      [null, "No category", [2]],
      [2, "home", [4]],
    ]);
    expect(groups[0].color).toBe("#6ea8fe");
    expect(groupByCategory([])).toEqual([]);
  });
});
