import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import type { Todo } from "./db";
import FilterBar from "./FilterBar.svelte";

const todo = (id: number, category: { id: number; name: string } | null): Todo => ({
  id,
  text: `todo ${id}`,
  notes: null,
  category_id: category?.id ?? null,
  category_name: category?.name ?? null,
  category_color: category ? "#81c995" : null,
  due_at: null,
  created_at: "2026-10-01T00:00:00.000Z",
  done_at: null,
});

const TODOS = [todo(1, { id: 7, name: "Work" }), todo(2, null)];
const menuItems = () => [...document.querySelectorAll(".fmenu-item")].map((b) => b.textContent!.trim());

describe("FilterBar", () => {
  it("picks a category from the dropdown and clears it with ✕", async () => {
    const onchange = vi.fn();
    render(FilterBar, { todos: TODOS, catFilter: null, dueFilter: "all", menu: null, onchange });
    const pill = screen.getByTitle("Category filter (T cycles)");
    expect(pill.textContent).toContain("All categories");

    await fireEvent.click(pill);
    expect(menuItems()).toEqual(["All categories", "Work", "No category"]);
    await fireEvent.click(screen.getByText("Work", { selector: ".fmenu-item" }));
    expect(menuItems()).toEqual([]);
    expect(pill.textContent).toContain("Work");
    expect(pill.classList.contains("active")).toBe(true);

    await fireEvent.click(screen.getByTitle("Show all categories"));
    expect(pill.textContent).toContain("All categories");
    expect(onchange).toHaveBeenCalledTimes(2);
  });

  it("picks a due-date stage and clears it with ✕", async () => {
    const onchange = vi.fn();
    render(FilterBar, { todos: TODOS, catFilter: null, dueFilter: "all", menu: null, onchange });
    const pill = screen.getByTitle("Due-date filter (F cycles)");

    await fireEvent.click(pill);
    expect(menuItems()).toContain("Overdue");
    await fireEvent.click(screen.getByText("Overdue"));
    expect(pill.textContent).toContain("Overdue");

    await fireEvent.click(screen.getByTitle("Show all due dates"));
    expect(pill.textContent).toContain("Any due date");
    expect(onchange).toHaveBeenCalledTimes(2);
  });

  it("closes a dropdown by clicking its pill again or the backdrop", async () => {
    render(FilterBar, { todos: TODOS, catFilter: -1, dueFilter: "all", menu: "due" });
    expect(menuItems()).toHaveLength(6);
    await fireEvent.click(screen.getByTitle("Due-date filter (F cycles)"));
    expect(menuItems()).toEqual([]);

    await fireEvent.click(screen.getByTitle("Category filter (T cycles)"));
    expect(document.querySelector(".fmenu-item.sel")!.textContent).toContain("No category");
    await fireEvent.click(document.querySelector(".fmenu-backdrop")!);
    expect(menuItems()).toEqual([]);
  });
});
