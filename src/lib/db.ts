import Database from "@tauri-apps/plugin-sql";
import { isValidCategoryName } from "./parse";

export interface Todo {
  id: number;
  text: string;
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

const COLUMNS = `t.id, t.text, t.category_id, c.name AS category_name, c.color AS category_color,
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

export async function addTodo(
  text: string,
  topic: string | null,
  dueAt: string | null
): Promise<void> {
  const d = await getDb();
  const categoryId = await getOrCreateCategory(d, topic ?? "");
  await d.execute(
    "INSERT INTO todos (text, category_id, due_at, created_at) VALUES ($1, $2, $3, $4)",
    [text, categoryId, dueAt, new Date().toISOString()]
  );
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
