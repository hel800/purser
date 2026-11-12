import { beforeEach, describe, expect, it } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { DatabaseSync } from "node:sqlite";
import { freezeAt } from "../test/clock";
import { argsOf, installIpc, type IpcCall } from "../test/ipc";
import { createDatabase, sqlHandlers } from "../test/sqlite";
import {
  addTodo,
  addTodos,
  deleteTodo,
  doneTodos,
  existingTodoKeys,
  listCategories,
  markDone,
  markOpen,
  openTodos,
  todoKey,
  updateCategory,
  updateDue,
  updateNotes,
  updateText,
  updateTodoCategory,
  type NewTodo,
} from "./db";

const NOW = new Date(2026, 9, 11, 13, 2, 5);

let db: DatabaseSync;
let calls: IpcCall[];
/** How many `purser://todos-changed` events were emitted so far. */
let changes: number;

beforeEach(async () => {
  freezeAt(NOW);
  db = createDatabase();
  calls = installIpc(sqlHandlers(db));
  changes = 0;
  await listen("purser://todos-changed", () => changes++);
});

const todo = (text: string, extra: Partial<NewTodo> = {}): NewTodo => ({
  text,
  category: null,
  dueAt: null,
  notes: null,
  ...extra,
});

/** The id of the only open todo with `text`. */
async function idOf(text: string): Promise<number> {
  const found = (await openTodos()).filter((t) => t.text === text);
  expect(found).toHaveLength(1);
  return found[0].id;
}

const todoInserts = () =>
  argsOf(calls, "plugin:sql|execute").filter((a) => String(a.query).startsWith("INSERT INTO todos"));

describe("categories", () => {
  it("creates a category once and reuses it case-insensitively", async () => {
    await addTodo("a", "Work", null);
    await addTodo("b", "work", null);
    await addTodo("c", " WORK ", null);
    expect(await listCategories()).toEqual([{ id: 1, name: "Work", color: "#6ea8fe" }]);
    expect(new Set((await openTodos()).map((t) => t.category_id))).toEqual(new Set([1]));
  });

  it("gives each new category the next palette color, wrapping around", async () => {
    const names = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"];
    for (const name of names) await addTodo("x", name, null);
    const colors = (await listCategories()).map((c) => c.color);
    expect(colors).toHaveLength(9);
    expect(new Set(colors.slice(0, 8)).size).toBe(8);
    expect(colors[8]).toBe(colors[0]);
  });

  it("stores a blank category as none", async () => {
    await addTodo("a", "  ", null);
    expect((await openTodos())[0].category_id).toBeNull();
    expect(await listCategories()).toEqual([]);
  });

  it("lists categories by name, ignoring case", async () => {
    await addTodos([todo("x", { category: "beta" }), todo("y", { category: "Alpha" })]);
    expect((await listCategories()).map((c) => c.name)).toEqual(["Alpha", "beta"]);
  });

  it("renames and recolors a category", async () => {
    await addTodo("a", "Work", null);
    await updateCategory(1, " Job ", "#000000");
    expect(await listCategories()).toEqual([{ id: 1, name: "Job", color: "#000000" }]);
    expect(changes).toBe(2);
  });

  it("ignores a rename onto another category or to an invalid name", async () => {
    await addTodos([todo("a", { category: "Work" }), todo("b", { category: "Home" })]);
    const before = await listCategories();
    await updateCategory(1, "home", "#000000");
    await updateCategory(1, "two words", "#000000");
    await updateCategory(1, "  ", "#000000");
    expect(await listCategories()).toEqual(before);
    expect(changes).toBe(1);
  });

  it("allows a rename that only changes the case", async () => {
    await addTodo("a", "work", null);
    await updateCategory(1, "Work", "#6ea8fe");
    expect((await listCategories())[0].name).toBe("Work");
  });
});

describe("addTodos", () => {
  it("does nothing for an empty list", async () => {
    await addTodos([]);
    expect(calls).toEqual([]);
    expect(changes).toBe(0);
  });

  it("stores every field and the creation time", async () => {
    const due = new Date(2026, 9, 12, 9).toISOString();
    await addTodo("call Bob", "Work", due, "re: invoice");
    expect(await openTodos()).toEqual([
      {
        id: 1,
        text: "call Bob",
        notes: "re: invoice",
        category_id: 1,
        category_name: "Work",
        category_color: "#6ea8fe",
        due_at: due,
        created_at: NOW.toISOString(),
        done_at: null,
      },
    ]);
    expect(changes).toBe(1);
  });

  it("inserts in chunks of 500 rows and reports the running total", async () => {
    const many = Array.from({ length: 1201 }, (_, i) => todo(`todo ${i}`, { category: i % 2 ? "Odd" : null }));
    const progress: number[] = [];
    await addTodos(many, (n) => progress.push(n));
    expect(progress).toEqual([500, 1000, 1201]);
    expect(todoInserts()).toHaveLength(3);
    expect(await openTodos()).toHaveLength(1201);
    // one lookup per distinct category, not per row
    expect(await listCategories()).toHaveLength(1);
    expect(changes).toBe(1);
  });

  it("keeps the chunks stored before a failed one and still notifies", async () => {
    const handlers = sqlHandlers(db);
    let inserts = 0;
    calls = installIpc({
      ...handlers,
      "plugin:sql|execute": (args) => {
        if (String(args.query).startsWith("INSERT INTO todos") && ++inserts === 2) {
          throw new Error("disk full");
        }
        return handlers["plugin:sql|execute"](args);
      },
    });
    await listen("purser://todos-changed", () => changes++);
    const progress: number[] = [];
    const many = Array.from({ length: 700 }, (_, i) => todo(`todo ${i}`));
    await expect(addTodos(many, (n) => progress.push(n))).rejects.toThrow("disk full");
    expect(progress).toEqual([500]);
    expect(await openTodos()).toHaveLength(500);
    expect(changes).toBe(1);
  });

  it("survives a failed change notification", async () => {
    // installIpc delivers events itself; a plain mock lets emit fail
    const handlers = sqlHandlers(db);
    mockIPC((cmd, args) => {
      if (cmd === "plugin:event|emit") throw new Error("no window");
      return handlers[cmd]?.((args ?? {}) as Record<string, unknown>);
    });
    await expect(addTodo("a", null, null)).resolves.toBeUndefined();
    expect(await openTodos()).toHaveLength(1);
  });
});

describe("open and done", () => {
  it("sorts open todos by category (none last), then due date (none last)", async () => {
    const at = (d: number) => new Date(2026, 9, d).toISOString();
    await addTodos([
      todo("none-late", { dueAt: at(20) }),
      todo("b-undated", { category: "Beta" }),
      todo("b-late", { category: "Beta", dueAt: at(20) }),
      todo("a-soon", { category: "alpha", dueAt: at(12) }),
      todo("b-soon", { category: "Beta", dueAt: at(12) }),
      todo("none-undated"),
    ]);
    expect((await openTodos()).map((t) => t.text)).toEqual([
      "a-soon",
      "b-soon",
      "b-late",
      "b-undated",
      "none-late",
      "none-undated",
    ]);
  });

  it("moves a todo to done and back", async () => {
    await addTodos([todo("a"), todo("b")]);
    const id = await idOf("a");
    await markDone(id);
    expect((await openTodos()).map((t) => t.text)).toEqual(["b"]);
    expect(await doneTodos()).toMatchObject([{ id, done_at: NOW.toISOString() }]);
    await markOpen(id);
    expect(await doneTodos()).toEqual([]);
    expect((await openTodos()).map((t) => t.text).sort()).toEqual(["a", "b"]);
    expect(changes).toBe(3);
  });

  it("lists the most recently done first, at most 200", async () => {
    await addTodos(Array.from({ length: 205 }, (_, i) => todo(`t${i}`)));
    for (let id = 1; id <= 205; id++) {
      freezeAt(new Date(NOW.getTime() + id * 1000));
      await markDone(id);
    }
    const done = await doneTodos();
    expect(done).toHaveLength(200);
    expect(done[0].id).toBe(205);
    expect(done[199].id).toBe(6);
  });

  it("deletes a todo", async () => {
    await addTodos([todo("a"), todo("b")]);
    await deleteTodo(await idOf("a"));
    expect((await openTodos()).map((t) => t.text)).toEqual(["b"]);
    expect(changes).toBe(2);
  });
});

describe("updates", () => {
  let id: number;
  beforeEach(async () => {
    await addTodo("a", "Work", null, "old note");
    id = await idOf("a");
    changes = 0;
  });

  it("changes the text", async () => {
    await updateText(id, "b");
    expect((await openTodos())[0].text).toBe("b");
    expect(changes).toBe(1);
  });

  it("changes and clears the notes", async () => {
    await updateNotes(id, "new note");
    expect((await openTodos())[0].notes).toBe("new note");
    await updateNotes(id, "");
    expect((await openTodos())[0].notes).toBeNull();
    expect(changes).toBe(2);
  });

  it("changes and clears the due date", async () => {
    const due = new Date(2026, 9, 12, 9).toISOString();
    await updateDue(id, due);
    expect((await openTodos())[0].due_at).toBe(due);
    await updateDue(id, null);
    expect((await openTodos())[0].due_at).toBeNull();
    expect(changes).toBe(2);
  });

  it("moves a todo to an existing or a new category", async () => {
    await updateTodoCategory(id, " work ");
    expect((await openTodos())[0].category_name).toBe("Work");
    await updateTodoCategory(id, "Home");
    expect((await openTodos())[0]).toMatchObject({ category_id: 2, category_name: "Home" });
    expect(changes).toBe(2);
  });

  it("removes the category for an empty name", async () => {
    await updateTodoCategory(id, null);
    expect((await openTodos())[0].category_id).toBeNull();
    await updateTodoCategory(id, "Work");
    await updateTodoCategory(id, "   ");
    expect((await openTodos())[0].category_id).toBeNull();
    expect(changes).toBe(3);
  });

  it("ignores a category name #tags can't reference", async () => {
    await updateTodoCategory(id, "two words");
    expect((await openTodos())[0].category_name).toBe("Work");
    expect(await listCategories()).toHaveLength(1);
    expect(changes).toBe(0);
  });
});

describe("existingTodoKeys", () => {
  it("collects the keys of open and done todos", async () => {
    const due = new Date(2026, 9, 12, 9).toISOString();
    await addTodos([todo("open", { category: "Work", dueAt: due, notes: "n" }), todo("done")]);
    await markDone(await idOf("done"));
    expect(await existingTodoKeys()).toEqual(
      new Set([todoKey("open", "work", due, "n"), todoKey("done", null, null, null)])
    );
  });
});
