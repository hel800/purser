import { beforeEach, describe, expect, it } from "vitest";
import { installIpc } from "../test/ipc";
import { createDatabase, sqlHandlers } from "../test/sqlite";
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

const item = (id: string, text = `item ${id}`, extra: Partial<SourceItem> = {}): SourceItem => ({
  id,
  text,
  url: null,
  dueAt: null,
  notes: null,
  ...extra,
});

beforeEach(() => {
  installIpc(sqlHandlers(createDatabase()));
});

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
