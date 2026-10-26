import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { emit } from "@tauri-apps/api/event";
import { argsOf, installIpc, type IpcCall } from "./test/ipc";
import { createDatabase, sqlHandlers } from "./test/sqlite";
import { freezeAt } from "./test/clock";
import { TEST_SETTINGS } from "./test/settings";
import { addTodos, markDone, openTodos, type NewTodo } from "./lib/db";
import type { ViewState } from "./lib/filters";
import List from "./List.svelte";

/** Sun 11 Oct 2026 13:02:05, Europe/Berlin. */
const NOW = new Date(2026, 9, 11, 13, 2, 5);
const at = (d: number, h: number) => new Date(2026, 9, d, h).toISOString();

let calls: IpcCall[];
/** What `list_state` hands over (the popup's view and filters). */
let handOver: ViewState | null;
let visible: boolean;

const todo = (text: string, extra: Partial<NewTodo> = {}): NewTodo => ({
  text,
  category: null,
  dueAt: null,
  notes: null,
  ...extra,
});

beforeEach(async () => {
  freezeAt(NOW);
  handOver = null;
  visible = true;
  calls = installIpc(
    {
      ...sqlHandlers(createDatabase()),
      get_settings: () => TEST_SETTINGS,
      list_state: () => handOver,
      "plugin:window|is_visible": () => visible,
    },
    "list"
  );
  await addTodos([
    todo("pay rent", { category: "Home", dueAt: at(10, 9) }),
    todo("call bob", { category: "Work", dueAt: at(11, 18), notes: "see https://example.com/ticket now" }),
    todo("standup notes", { category: "Work", dueAt: at(12, 9) }),
    todo("plan trip", { dueAt: at(20, 9) }),
    todo("old one"),
  ]);
  await markDone((await openTodos()).find((t) => t.text === "old one")!.id);
});

async function renderList() {
  const result = render(List);
  await screen.findByText("pay rent");
  return result;
}

const title = () => document.querySelector(".print-head h1")!.textContent;
const texts = () => [...document.querySelectorAll(".todo .text")].map((e) => e.textContent);
const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...init });

describe("List", () => {
  it("shows the open todos by category with their urgency spelled out", async () => {
    await renderList();
    expect(title()).toBe("Purser — Open");
    expect([...document.querySelectorAll("h2")].map((h) => h.textContent!.trim())).toEqual(["Home", "Work", "No category"]);
    expect(texts()).toEqual(["pay rent", "call bob", "standup notes", "plan trip"]);
    expect([...document.querySelectorAll(".due-flag")].map((e) => e.textContent)).toEqual([
      "(overdue)",
      "(due soon)",
      "(due soon)",
    ]);
  });

  it("opens links in the notes in the browser", async () => {
    await renderList();
    expect(document.querySelector(".notes")!.textContent).toBe("see https://example.com/ticket now");
    await fireEvent.click(screen.getByText("https://example.com/ticket"));
    expect(argsOf(calls, "plugin:opener|open_url")).toEqual([
      expect.objectContaining({ url: "https://example.com/ticket" }),
    ]);
  });

  it("takes over the popup's view and filters", async () => {
    const work = (await openTodos()).find((t) => t.text === "call bob")!.category_id;
    handOver = { view: "open", catFilter: work, dueFilter: "soon" };
    render(List);
    await waitFor(() => expect(title()).toBe("Purser — Open · #Work · Soon or overdue"));
    expect(texts()).toEqual(["call bob", "standup notes"]);

    handOver = { view: "open", catFilter: -1, dueFilter: "all" };
    await emit("purser://list-state");
    await waitFor(() => expect(title()).toBe("Purser — Open · No category"));
    expect(texts()).toEqual(["plan trip"]);

    handOver = { view: "done", catFilter: null, dueFilter: "all" };
    await emit("purser://list-state");
    await waitFor(() => expect(title()).toBe("Purser — Done"));
    expect(texts()).toEqual(["old one"]);
  });

  it("drops a category filter without open todos left", async () => {
    handOver = { view: "open", catFilter: 999, dueFilter: "all" };
    render(List);
    await waitFor(() => expect(texts()).toHaveLength(4));
    expect(title()).toBe("Purser — Open");
  });

  it("says when nothing matches the filters", async () => {
    handOver = { view: "open", catFilter: null, dueFilter: "nodate" };
    render(List);
    expect(await screen.findByText("No todos match the filters.")).toBeTruthy();
  });

  it("switches views with Tab and the tabs, and two quick Tabs cancel out", async () => {
    await renderList();
    await key("Tab");
    await waitFor(() => expect(title()).toBe("Purser — Done"));
    expect(document.querySelector(".check")!.textContent!.trim()).toBe("✓");

    await fireEvent.click(screen.getByText("Open"));
    await waitFor(() => expect(title()).toBe("Purser — Open"));
    await fireEvent.click(screen.getByText("Open")); // already there

    key("Tab");
    key("Tab");
    await new Promise((r) => setTimeout(r, 20));
    expect(title()).toBe("Purser — Open");
  });

  it("cycles the filters with T and F in Open only", async () => {
    await renderList();
    await key("t");
    expect(title()).toBe("Purser — Open · #Home");
    await key("f");
    expect(title()).toBe("Purser — Open · #Home · Today");
    expect(await screen.findByText("No todos match the filters.")).toBeTruthy();

    await key("Tab");
    await waitFor(() => expect(title()).toBe("Purser — Done"));
    await key("t");
    expect(title()).toBe("Purser — Done");
  });

  it("closes an open filter dropdown with any key; Esc only closes it", async () => {
    await renderList();
    await fireEvent.click(screen.getByTitle("Category filter (T cycles)"));
    expect(document.querySelector(".fmenu")).not.toBeNull();
    await key("Escape");
    expect(document.querySelector(".fmenu")).toBeNull();
    expect(argsOf(calls, "close_list")).toEqual([]);

    await fireEvent.click(screen.getByTitle("Category filter (T cycles)"));
    await key("t");
    expect(document.querySelector(".fmenu")).toBeNull();
    expect(title()).toBe("Purser — Open · #Home");
  });

  it("goes back to the popup with L, Esc or the view-only badge, handing over view and filters", async () => {
    await renderList();
    await key("f");
    await key("l");
    await key("Escape");
    await fireEvent.click(screen.getByTitle(/Nothing can be changed here/));
    expect(argsOf(calls, "close_list")).toEqual(
      Array(3).fill({ state: { view: "open", catFilter: null, dueFilter: "today" } })
    );
  });

  it("explains that it is view only instead of editing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await renderList();
    const writes = argsOf(calls, "plugin:sql|execute").length;
    for (const k of ["Enter", "e", "F2", "d", "c", "n", "Delete"]) {
      expect(await key(k)).toBe(false);
    }
    expect(screen.getByRole("status").textContent).toMatch(/View only/);
    await vi.advanceTimersByTimeAsync(2000);
    expect(screen.queryByRole("status")).toBeNull();
    await fireEvent.click(document.querySelector(".check")!);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(argsOf(calls, "plugin:sql|execute")).toHaveLength(writes);
  });

  it("prints with Ctrl+P and the Print button, keeping the window shown meanwhile", async () => {
    const print = vi.spyOn(window, "print");
    await renderList();
    await key("p", { ctrlKey: true });
    await fireEvent.click(screen.getByText("Print"));
    await waitFor(() => expect(argsOf(calls, "end_print")).toHaveLength(2));
    expect(argsOf(calls, "begin_print")).toHaveLength(2);
    expect(print).toHaveBeenCalledTimes(2);
    expect(calls.map((c) => c.cmd).filter((c) => c.endsWith("_print"))).toEqual([
      "begin_print",
      "end_print",
      "begin_print",
      "end_print",
    ]);
  });

  it("scrolls by row, page and to both ends", async () => {
    await renderList();
    const list = document.querySelector<HTMLElement>(".list")!;
    // jsdom has no layout
    Object.defineProperty(list, "clientHeight", { value: 500 });
    const scrollBy = vi.spyOn(list, "scrollBy");
    const scrollTo = vi.spyOn(list, "scrollTo");
    for (const k of ["ArrowDown", "j", "ArrowUp", "k", "PageDown", "PageUp", " "]) await key(k);
    await key(" ", { shiftKey: true });
    // a page is the visible height minus one row
    expect(scrollBy.mock.calls.map(([o]) => (o as ScrollToOptions).top)).toEqual([40, 40, -40, -40, 460, -460, 460, -460]);
    await key("Home");
    await key("End");
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("leaves modifier combos to the webview", async () => {
    await renderList();
    expect(await key("c", { ctrlKey: true })).toBe(true);
    expect(await key("l", { altKey: true })).toBe(true);
    expect(argsOf(calls, "close_list")).toEqual([]);
  });

  it("opens the help with ?, F1 and the ? button", async () => {
    await renderList();
    await key("?");
    await key("F1");
    await fireEvent.click(screen.getByTitle("Keyboard shortcuts (? / F1)"));
    await key("x");
    expect(argsOf(calls, "open_help")).toHaveLength(3);
  });

  it("reloads on changes while shown and when focused", async () => {
    await renderList();
    await addTodos([todo("new from popup")]);
    await waitFor(() => expect(texts()).toContain("new from popup"));

    visible = false;
    await addTodos([todo("while hidden")]);
    await new Promise((r) => setTimeout(r, 20));
    expect(texts()).not.toContain("while hidden");

    await emit("tauri://blur");
    await emit("tauri://focus");
    await waitFor(() => expect(texts()).toContain("while hidden"));
  });
});
