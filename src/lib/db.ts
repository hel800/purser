import Database from "@tauri-apps/plugin-sql";

export interface Todo {
  id: number;
  text: string;
  topic: string | null;
  due_at: string | null;
  created_at: string;
  done_at: string | null;
}

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:purser.db");
  }
  return db;
}

export async function addTodo(text: string, topic: string | null, dueAt: string | null): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT INTO todos (text, topic, due_at, created_at) VALUES ($1, $2, $3, $4)",
    [text, topic, dueAt, new Date().toISOString()]
  );
}

export async function openTodos(): Promise<Todo[]> {
  const d = await getDb();
  return d.select<Todo[]>(
    "SELECT * FROM todos WHERE done_at IS NULL ORDER BY topic IS NULL, topic COLLATE NOCASE, due_at IS NULL, due_at"
  );
}

export async function doneTodos(): Promise<Todo[]> {
  const d = await getDb();
  return d.select<Todo[]>(
    "SELECT * FROM todos WHERE done_at IS NOT NULL ORDER BY done_at DESC LIMIT 200"
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
