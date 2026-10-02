import type { Todo } from "./db";
import { dueStatus, isThisWeek, isToday } from "./parse";

/** Category filter: a category id, `null` for all, `-1` for uncategorized. */
export type CategoryFilter = number | null;

export type DueFilter = "all" | "today" | "week" | "soon" | "overdue" | "nodate";

export const DUE_CYCLE: DueFilter[] = ["all", "today", "week", "soon", "overdue", "nodate"];

export const DUE_LABELS: Record<DueFilter, string> = {
  all: "Any due date",
  today: "Today",
  week: "This week",
  soon: "Soon or overdue",
  overdue: "Overdue",
  nodate: "No date",
};

export interface Group {
  id: number | null;
  topic: string;
  color: string | null;
  todos: Todo[];
}

/** Category filter values present in the list, in list order, for the T cycle. */
export function categoryCycle(todos: Todo[]): CategoryFilter[] {
  const ids: CategoryFilter[] = [null];
  for (const t of todos) {
    const key = t.category_id ?? -1;
    if (!ids.includes(key)) ids.push(key);
  }
  return ids;
}

/** Label and dot color for a category filter value. */
export function categoryInfo(
  todos: Todo[],
  filter: CategoryFilter
): { label: string; color: string | null } {
  if (filter === null) return { label: "All categories", color: null };
  if (filter === -1) return { label: "No category", color: null };
  const t = todos.find((t) => t.category_id === filter);
  return { label: t?.category_name ?? "?", color: t?.category_color ?? null };
}

export function nextCategory(todos: Todo[], current: CategoryFilter): CategoryFilter {
  const cycle = categoryCycle(todos);
  const i = cycle.indexOf(current);
  return cycle[(i + 1) % cycle.length] ?? null;
}

export function nextDue(current: DueFilter): DueFilter {
  const i = DUE_CYCLE.indexOf(current);
  return DUE_CYCLE[(i + 1) % DUE_CYCLE.length];
}

export function matchesDue(t: Todo, filter: DueFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "today":
      return t.due_at !== null && isToday(t.due_at);
    case "week":
      return t.due_at !== null && isThisWeek(t.due_at);
    case "soon":
      return dueStatus(t.due_at) !== null;
    case "overdue":
      return dueStatus(t.due_at) === "overdue";
    case "nodate":
      return t.due_at === null;
  }
}

export function filterTodos(todos: Todo[], category: CategoryFilter, due: DueFilter): Todo[] {
  return todos.filter(
    (t) => (category === null || (t.category_id ?? -1) === category) && matchesDue(t, due)
  );
}

/** Groups todos by category, keeping the SQL order (topic, then due date). */
export function groupByCategory(todos: Todo[]): Group[] {
  const map = new Map<number, Group>();
  for (const t of todos) {
    const key = t.category_id ?? -1;
    if (!map.has(key)) {
      map.set(key, {
        id: t.category_id,
        topic: t.category_name || "No topic",
        color: t.category_color,
        todos: [],
      });
    }
    map.get(key)!.todos.push(t);
  }
  return [...map.values()];
}
