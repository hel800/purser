import Database from "@tauri-apps/plugin-sql";
import { emit } from "@tauri-apps/api/event";
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
  /** Data source the todo is mirrored from; `null` for the user's own todos.
   *  Mirrored todos are read-only: see `isReadOnly`. */
  source_id: string | null;
  /** The item's id within its source. */
  external_id: string | null;
  /** Where the item lives, opened by `O` (see `todoLink`). */
  url: string | null;
}

/** Whether a todo comes from an external data source and can't be edited here. */
export function isReadOnly(todo: Pick<Todo, "source_id">): boolean {
  return todo.source_id !== null;
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

/**
 * Tells every window (e.g. the full list) that todos or categories changed.
 * Fire-and-forget: the write has already succeeded, so a failed emit must not
 * make the caller's await throw, and the UI shouldn't wait on the round-trip.
 */
function notifyChanged(): void {
  emit("purser://todos-changed").catch(() => {});
}

const COLUMNS = `t.id, t.text, t.notes, t.category_id, c.name AS category_name, c.color AS category_color,
  t.due_at, t.created_at, t.done_at, t.source_id, t.external_id, t.url`;

/**
 * Appended to user edits of what a data source owns (text, due date, notes,
 * done state): those are only changed by the source's sync. The UI already
 * blocks these edits; this keeps a stray call from changing what the next
 * refresh would silently undo. The category is the user's: sync never
 * overwrites it, so it stays editable on mirrored todos too.
 */
const OWN_TODO = "AND source_id IS NULL";

const FROM = `FROM todos t LEFT JOIN categories c ON c.id = t.category_id`;

/// Resolves a category name, creating it (with a color) if needed.
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
  category: string | null;
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
  const categoryKey = (t: NewTodo) => (t.category ?? "").trim().toLowerCase();
  for (const t of todos) {
    const key = categoryKey(t);
    if (!categoryIds.has(key)) categoryIds.set(key, await getOrCreateCategory(d, t.category ?? ""));
  }
  const createdAt = new Date().toISOString();
  try {
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
  } finally {
    // also after a failed chunk: the chunks before it are already stored
    notifyChanged();
  }
}

export function addTodo(
  text: string,
  category: string | null,
  dueAt: string | null,
  notes: string | null = null
): Promise<void> {
  return addTodos([{ text, category, dueAt, notes }]);
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

/** Keys of the user's own stored todos, open and done. Mirrored source
 *  items don't count: an import must not be skipped because the same text
 *  happens to be in Jira. */
export async function existingTodoKeys(): Promise<Set<string>> {
  const d = await getDb();
  const rows = await d.select<Todo[]>(`SELECT ${COLUMNS} ${FROM} WHERE t.source_id IS NULL`);
  return new Set(rows.map((t) => todoKey(t.text, t.category_name, t.due_at, t.notes)));
}

/**
 * Sort key of `due_at`: an instant as stored, a day without a time
 * ("2026-10-16") as the end of that local day in the same UTC form, so it
 * comes after the timed todos of its day.
 */
const DUE_SORT = `CASE WHEN length(t.due_at) = 10
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', t.due_at || ' 23:59:59.999', 'utc')
      ELSE t.due_at END`;

export async function openTodos(): Promise<Todo[]> {
  const d = await getDb();
  return d.select<Todo[]>(
    `SELECT ${COLUMNS} ${FROM}
      WHERE t.done_at IS NULL
      ORDER BY c.name IS NULL, c.name COLLATE NOCASE, t.due_at IS NULL, ${DUE_SORT}`
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
  await d.execute(`UPDATE todos SET done_at = $1 WHERE id = $2 ${OWN_TODO}`, [new Date().toISOString(), id]);
  notifyChanged();
}

export async function markOpen(id: number): Promise<void> {
  const d = await getDb();
  await d.execute(`UPDATE todos SET done_at = NULL WHERE id = $1 ${OWN_TODO}`, [id]);
  notifyChanged();
}

export async function updateText(id: number, text: string): Promise<void> {
  const d = await getDb();
  await d.execute(`UPDATE todos SET text = $1 WHERE id = $2 ${OWN_TODO}`, [text, id]);
  notifyChanged();
}

export async function updateTodoCategory(id: number, categoryName: string | null): Promise<void> {
  const d = await getDb();
  const clean = categoryName?.trim() ?? "";
  if (!clean) {
    await d.execute("UPDATE todos SET category_id = NULL WHERE id = $1", [id]);
    notifyChanged();
    return;
  }
  // reject names quick-add's #tag syntax couldn't reference (e.g. with spaces)
  if (!isValidCategoryName(clean)) return;
  const categoryId = await getOrCreateCategory(d, clean);
  await d.execute("UPDATE todos SET category_id = $1 WHERE id = $2", [categoryId, id]);
  notifyChanged();
}

export async function updateNotes(id: number, notes: string | null): Promise<void> {
  const d = await getDb();
  await d.execute(`UPDATE todos SET notes = $1 WHERE id = $2 ${OWN_TODO}`, [notes || null, id]);
  notifyChanged();
}

export async function updateDue(id: number, dueAt: string | null): Promise<void> {
  const d = await getDb();
  await d.execute(`UPDATE todos SET due_at = $1 WHERE id = $2 ${OWN_TODO}`, [dueAt, id]);
  notifyChanged();
}

export async function deleteTodo(id: number): Promise<void> {
  const d = await getDb();
  await d.execute(`DELETE FROM todos WHERE id = $1 ${OWN_TODO}`, [id]);
  notifyChanged();
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
  notifyChanged();
}

/** One item of a data source, already validated (see `parseSourceOutput`). */
export interface SourceItem {
  id: string;
  text: string;
  url: string | null;
  dueAt: string | null;
  notes: string | null;
}

/** Rows per upsert: 8 parameters each, well below SQLite's limit. */
const SYNC_CHUNK = 500;

/**
 * Makes the stored todos of `sourceId` match `items`: new items are added
 * in `category`, known ones (same id) updated, and items the source no
 * longer returns are removed, which is how they get "done": the source
 * closed them. A known item keeps the category the user gave it. Only
 * called with a complete, successful result, so a failed refresh keeps the
 * last good items. Returns whether this was the source's first sync ever.
 */
export async function syncSourceItems(
  sourceId: string,
  category: string | null,
  items: SourceItem[]
): Promise<{ firstSync: boolean }> {
  const d = await getDb();
  const before = await d.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM source_syncs WHERE source_id = $1",
    [sourceId]
  );
  const categoryId = category ? await getOrCreateCategory(d, category) : null;
  const createdAt = new Date().toISOString();
  try {
    for (let i = 0; i < items.length; i += SYNC_CHUNK) {
      const chunk = items.slice(i, i + SYNC_CHUNK);
      const params: unknown[] = [];
      const rows = chunk.map((item) => {
        const n = params.length;
        params.push(item.text, item.notes, categoryId, item.dueAt, createdAt, sourceId, item.id, item.url);
        const placeholders = Array.from({ length: 8 }, (_, k) => `$${n + k + 1}`);
        return `(${placeholders.join(", ")})`;
      });
      await d.execute(
        `INSERT INTO todos (text, notes, category_id, due_at, created_at, source_id, external_id, url)
           VALUES ${rows.join(", ")}
           ON CONFLICT (source_id, external_id) DO UPDATE SET
             text = excluded.text, notes = excluded.notes,
             due_at = excluded.due_at, url = excluded.url, done_at = NULL`,
        params
      );
    }
    // the ids go in as one JSON array: a NOT IN list with a parameter per id
    // could exceed SQLite's parameter limit for a large source
    await d.execute(
      `DELETE FROM todos WHERE source_id = $1
         AND external_id NOT IN (SELECT value FROM json_each($2))`,
      [sourceId, JSON.stringify(items.map((item) => item.id))]
    );
    await d.execute(
      `INSERT INTO source_syncs (source_id, synced_at) VALUES ($1, $2)
         ON CONFLICT (source_id) DO UPDATE SET synced_at = excluded.synced_at`,
      [sourceId, new Date().toISOString()]
    );
  } finally {
    notifyChanged();
  }
  return { firstSync: before[0].n === 0 };
}

/** When each source last synced successfully (ISO time by source id). */
export async function sourceSyncTimes(): Promise<Record<string, string>> {
  const d = await getDb();
  const rows = await d.select<{ source_id: string; synced_at: string }[]>(
    "SELECT source_id, synced_at FROM source_syncs"
  );
  return Object.fromEntries(rows.map((r) => [r.source_id, r.synced_at]));
}

/** Removes the mirrored todos of sources that are no longer configured. */
export async function removeOtherSources(configuredIds: string[]): Promise<void> {
  const d = await getDb();
  const ids = JSON.stringify(configuredIds);
  // forgetting the sync too: adding the source again confirms it again
  await d.execute("DELETE FROM source_syncs WHERE source_id NOT IN (SELECT value FROM json_each($1))", [ids]);
  const res = await d.execute(
    `DELETE FROM todos WHERE source_id IS NOT NULL
       AND source_id NOT IN (SELECT value FROM json_each($1))`,
    [ids]
  );
  if (res.rowsAffected > 0) notifyChanged();
}
