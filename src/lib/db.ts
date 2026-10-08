import Database from "@tauri-apps/plugin-sql";
import { isValidCategoryName } from "./parse";

export interface Todo {
  id: number;
  text: string;
  notes: string | null;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  due_at: string | null;
  created_at: string;
  done_at: string | null;
}

export interface Category {
  id: number;
  name: string;
  color: string;
}

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:purser.db");
  }
  return db;
}

const COLUMNS = `t.id, t.text, t.notes, t.category_id, c.name AS category_name, c.color AS category_color,
  t.due_at, t.created_at, t.done_at`;

const FROM = `FROM todos t LEFT JOIN categories c ON c.id = t.category_id`;

/// Resolves a topic name to a category, creating it (with a color) if needed.
async function getOrCreateCategory(d: Database, name: string): Promise<number | null> {
  const clean = name.trim();
  if (!clean) return null;
  const existing = await d.select<{ id: number }[]>(
    "SELECT id FROM categories WHERE name = $1 COLLATE NOCASE",
    [clean]
  );
  if (existing[0]) return existing[0].id;
  // pick the next unused palette color so freshly added categories differ
  const count = await d.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM categories");
  const palette = [
    "#6ea8fe",
    "#81c995",
    "#f6b26b",
    "#b48cf2",
    "#f28b82",
    "#4dd0e1",
    "#f48fb1",
    "#ffd54f",
  ];
  const color = palette[count[0].n % palette.length];
  const res = await d.execute(
    "INSERT INTO categories (name, color, created_at) VALUES ($1, $2, $3)",
    [clean, color, new Date().toISOString()]
  );
  return res.lastInsertId ?? null;
}

export async function listCategories(): Promise<Category[]> {
  const d = await getDb();
  return d.select<Category[]>(
    "SELECT id, name, color FROM categories ORDER BY name COLLATE NOCASE"
  );
}

export interface NewTodo {
  text: string;
  topic: string | null;
  dueAt: string | null;
  notes: string | null;
}

/** Rows per INSERT statement — well below SQLite's bound-parameter limit. */
const INSERT_CHUNK = 500;

/**
 * Inserts many todos at once. Categories are resolved first (few, mostly
 * repeated), then the rows go in with one INSERT per chunk of `INSERT_CHUNK`:
 * a 120-line import is a handful of round trips instead of several hundred,
 * and each statement lands completely or not at all. The plugin's connection
 * pool makes BEGIN/COMMIT across separate calls unreliable, so one statement
 * per chunk is the unit of atomicity. `onChunk` reports the running total.
 */
export async function addTodos(todos: NewTodo[], onChunk?: (inserted: number) => void): Promise<void> {
  if (todos.length === 0) return;
  const d = await getDb();
  const categoryIds = new Map<string, number | null>();
  const categoryKey = (t: NewTodo) => (t.topic ?? "").trim().toLowerCase();
  for (const t of todos) {
    const key = categoryKey(t);
    if (!categoryIds.has(key)) categoryIds.set(key, await getOrCreateCategory(d, t.topic ?? ""));
  }
  const createdAt = new Date().toISOString();
  for (let i = 0; i < todos.length; i += INSERT_CHUNK) {
    const chunk = todos.slice(i, i + INSERT_CHUNK);
    const params: unknown[] = [];
    const rows = chunk.map((t) => {
      const n = params.length;
      params.push(t.text, t.notes, categoryIds.get(categoryKey(t)) ?? null, t.dueAt, createdAt);
      return `($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5})`;
    });
    await d.execute(
      `INSERT INTO todos (text, notes, category_id, due_at, created_at) VALUES ${rows.join(", ")}`,
      params
    );
    onChunk?.(i + chunk.length);
  }
}

export function addTodo(
  text: string,
  topic: string | null,
  dueAt: string | null,
  notes: string | null = null
): Promise<void> {
  return addTodos([{ text, topic, dueAt, notes }]);
}

/** Identity of a todo for duplicate detection: text, category (case-
 *  insensitive like category names), due date and notes. */
export function todoKey(
  text: string,
  category: string | null,
  dueAt: string | null,
  notes: string | null
): string {
  return JSON.stringify([text, category?.toLowerCase() ?? null, dueAt, notes || null]);
}

/** Keys of all stored todos, open and done. */
export async function existingTodoKeys(): Promise<Set<string>> {
  const d = await getDb();
  const rows = await d.select<Todo[]>(`SELECT ${COLUMNS} ${FROM}`);
  return new Set(rows.map((t) => todoKey(t.text, t.category_name, t.due_at, t.notes)));
}

export async function openTodos(): Promise<Todo[]> {
  const d = await getDb();
  return d.select<Todo[]>(
    `SELECT ${COLUMNS} ${FROM}
      WHERE t.done_at IS NULL
      ORDER BY c.name IS NULL, c.name COLLATE NOCASE, t.due_at IS NULL, t.due_at`
  );
}

export async function doneTodos(): Promise<Todo[]> {
  const d = await getDb();
  return d.select<Todo[]>(
    `SELECT ${COLUMNS} ${FROM}
      WHERE t.done_at IS NOT NULL
      ORDER BY t.done_at DESC LIMIT 200`
  );
}

export async function markDone(id: number): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE todos SET done_at = $1 WHERE id = $2", [new Date().toISOString(), id]);
}

export async function markOpen(id: number): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE todos SET done_at = NULL WHERE id = $1", [id]);
}

export async function updateText(id: number, text: string): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE todos SET text = $1 WHERE id = $2", [text, id]);
}

export async function updateTodoCategory(id: number, categoryName: string | null): Promise<void> {
  const d = await getDb();
  const clean = categoryName?.trim() ?? "";
  if (!clean) {
    await d.execute("UPDATE todos SET category_id = NULL WHERE id = $1", [id]);
    return;
  }
  // reject names quick-add's #tag syntax couldn't reference (e.g. with spaces)
  if (!isValidCategoryName(clean)) return;
  const categoryId = await getOrCreateCategory(d, clean);
  await d.execute("UPDATE todos SET category_id = $1 WHERE id = $2", [categoryId, id]);
}

export async function updateNotes(id: number, notes: string | null): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE todos SET notes = $1 WHERE id = $2", [notes || null, id]);
}

export async function updateDue(id: number, dueAt: string | null): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE todos SET due_at = $1 WHERE id = $2", [dueAt, id]);
}

export async function deleteTodo(id: number): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM todos WHERE id = $1", [id]);
}

export async function updateCategory(id: number, name: string, color: string): Promise<void> {
  const d = await getDb();
  const clean = name.trim();
  // reject names quick-add's #tag syntax couldn't reference (e.g. with spaces)
  if (!clean || !isValidCategoryName(clean)) return;
  // renaming onto an existing case-insensitive collision is ignored
  const clash = await d.select<{ id: number }[]>(
    "SELECT id FROM categories WHERE name = $1 COLLATE NOCASE AND id != $2",
    [clean, id]
  );
  if (clash[0]) return;
  await d.execute("UPDATE categories SET name = $1, color = $2 WHERE id = $3", [
    clean,
    color,
    id,
  ]);
}
