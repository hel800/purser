import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  addTodo,
  deleteTodo,
  doneTodos,
  existingTodoKeys,
  isReadOnly,
  markDone,
  openTodos,
  removeOtherSources,
  sourceSyncTimes,
  syncSourceItems,
  updateDue,
  updateNotes,
  updateText,
  updateTodoCategory,
  type SourceItem,
} from "./db";

// The app's own migrations, read from lib.rs so the schema under test can't
// drift from the one the app ships.
const lib = Object.values(
  import.meta.glob<string>("../../src-tauri/src/lib.rs", { query: "?raw", import: "default", eager: true })
)[0];
const migrations = [...lib.matchAll(/version:\s*(\d+),\s*description:\s*"[^"]*",\s*sql:\s*"([^"]*)"/g)]
  .map(([, version, sql]) => ({ version: Number(version), sql }))
  .sort((a, b) => a.version - b.version);

let sqlite: DatabaseSync;

// @tauri-apps/api reaches the backend through window.__TAURI_INTERNALS__; the
// node test project has no window of its own
globalThis.window ??= globalThis as Window & typeof globalThis;

// plugin-sql binds `$1, $2, …`; node:sqlite reads those as named parameters,
// while SQLite's `?1, ?2, …` bind positionally like the plugin does.
const positional = (query: string) => query.replace(/\$(\d+)/g, "?$1");
const values = (args: Record<string, unknown>) =>
  ((args.values as unknown[]) ?? []).map((value) => value ?? null) as never[];

/** Answers @tauri-apps/plugin-sql from the real SQLite database. */
function handle(cmd: string, payload?: unknown): unknown {
  const args = (payload ?? {}) as Record<string, unknown>;
  switch (cmd) {
    case "plugin:sql|load":
      return args.db;
    case "plugin:sql|execute": {
      const result = sqlite.prepare(positional(args.query as string)).run(...values(args));
      return [Number(result.changes), Number(result.lastInsertRowid)];
    }
    case "plugin:sql|select":
      return sqlite.prepare(positional(args.query as string)).all(...values(args));
    case "plugin:sql|close":
      return true;
    default:
      throw new Error(`unexpected IPC command ${cmd}`);
  }
}

const item = (id: string, text = `item ${id}`, extra: Partial<SourceItem> = {}): SourceItem => ({
  id,
  text,
  url: null,
  dueAt: null,
  notes: null,
  ...extra,
});

beforeAll(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const migration of migrations) sqlite.exec(migration.sql);
});

beforeEach(() => {
  sqlite.exec("DELETE FROM todos; DELETE FROM source_syncs; DELETE FROM categories;");
  mockIPC(handle, { shouldMockEvents: true });
});

afterEach(() => clearMocks());

describe("syncSourceItems", () => {
  it("adds the items with the source's category and reports a first sync", async () => {
    const { firstSync } = await syncSourceItems("jira", "jira", [
      item("XY-1", "XY-1 Fix login", { url: "https://x/browse/XY-1", dueAt: "2026-11-10", notes: "details" }),
    ]);
    expect(firstSync).toBe(true);
    const todos = await openTodos();
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({
      text: "XY-1 Fix login",
      category_name: "jira",
      due_at: "2026-11-10",
      notes: "details",
      url: "https://x/browse/XY-1",
      source_id: "jira",
      external_id: "XY-1",
    });
    expect(isReadOnly(todos[0])).toBe(true);

    const again = await syncSourceItems("jira", "jira", [item("XY-1")]);
    expect(again.firstSync).toBe(false);
  });

  it("updates known items but keeps the category the user gave them", async () => {
    await syncSourceItems("jira", "jira", [item("XY-1", "first", { notes: "old" })]);
    const [todo] = await openTodos();
    await updateTodoCategory(todo.id, "work");

    await syncSourceItems("jira", "jira", [
      item("XY-1", "second", { notes: "new", url: "https://x/2", dueAt: "2026-11-10" }),
    ]);

    const todos = await openTodos();
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({
      text: "second",
      notes: "new",
      url: "https://x/2",
      due_at: "2026-11-10",
      category_name: "work",
    });
  });

  it("removes the items the source no longer returns", async () => {
    await syncSourceItems("jira", "jira", [item("1"), item("2"), item("3")]);
    await syncSourceItems("jira", "jira", [item("1"), item("3")]);
    expect((await openTodos()).map((t) => t.external_id).sort()).toEqual(["1", "3"]);
  });

  it("keeps the user's own todos when the source returns nothing", async () => {
    await addTodo("mine", null, null);
    await syncSourceItems("jira", "jira", [item("1")]);
    await syncSourceItems("jira", "jira", []);
    expect((await openTodos()).map((t) => t.text)).toEqual(["mine"]);
  });

  it("keeps two sources apart even when they use the same external id", async () => {
    await syncSourceItems("jira", "jira", [item("1", "from jira")]);
    await syncSourceItems("gh", "gh", [item("1", "from github")]);
    const todos = await openTodos();
    expect(todos.map((t) => `${t.source_id}:${t.text}`).sort()).toEqual([
      "gh:from github",
      "jira:from jira",
    ]);
  });

  it("syncs more items than one statement's parameters hold", async () => {
    const many = Array.from({ length: 501 }, (_, i) => item(`i${i}`));
    await syncSourceItems("big", "big", many);
    expect(await openTodos()).toHaveLength(501);

    await syncSourceItems("big", "big", many.slice(1));
    expect(await openTodos()).toHaveLength(500);
  });
});

describe("removeOtherSources", () => {
  it("drops the todos and sync times of sources that are no longer configured", async () => {
    await syncSourceItems("jira", "jira", [item("1")]);
    await syncSourceItems("gh", "gh", [item("1")]);
    expect(await openTodos()).toHaveLength(2);

    await removeOtherSources(["jira"]);

    expect((await openTodos()).map((t) => t.source_id)).toEqual(["jira"]);
    expect(Object.keys(await sourceSyncTimes())).toEqual(["jira"]);
  });

  it("makes a source that comes back a first sync again", async () => {
    await syncSourceItems("jira", "jira", [item("1")]);
    await removeOtherSources([]);
    expect(await openTodos()).toHaveLength(0);

    const { firstSync } = await syncSourceItems("jira", "jira", [item("1")]);
    expect(firstSync).toBe(true);
  });
});

describe("mirrored todos are read-only", () => {
  it("ignores text, due date, notes, done state and deletion but allows the category", async () => {
    await syncSourceItems("jira", "jira", [item("XY-1", "original", { notes: "note", dueAt: "2026-11-10" })]);
    const [todo] = await openTodos();

    await markDone(todo.id);
    await updateText(todo.id, "changed");
    await updateDue(todo.id, "2027-01-01");
    await updateNotes(todo.id, "changed");
    await deleteTodo(todo.id);

    const [unchanged] = await openTodos();
    expect(unchanged).toMatchObject({
      text: "original",
      due_at: "2026-11-10",
      notes: "note",
      done_at: null,
    });
    expect(await doneTodos()).toHaveLength(0);

    await updateTodoCategory(unchanged.id, "work");
    expect((await openTodos())[0].category_name).toBe("work");
  });

  it("keeps mirrored items out of import duplicate detection", async () => {
    await syncSourceItems("jira", "jira", [item("1", "same text")]);
    expect(await existingTodoKeys()).toEqual(new Set());

    await addTodo("same text", null, null);
    expect((await existingTodoKeys()).size).toBe(1);
  });
});
