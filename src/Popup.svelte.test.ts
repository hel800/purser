import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { emit } from "@tauri-apps/api/event";
import { argsOf, installIpc, type IpcCall, type IpcHandler } from "./test/ipc";
import { createDatabase, sqlHandlers } from "./test/sqlite";
import { freezeAt } from "./test/clock";
import { TEST_SETTINGS } from "./test/settings";
import { addTodos, doneTodos, listCategories, markDone, openTodos, type NewTodo } from "./lib/db";
import type { AppSettings } from "./lib/settings.svelte";
import Popup from "./Popup.svelte";

/** Sun 11 Oct 2026 13:02:05, Europe/Berlin. */
const NOW = new Date(2026, 9, 11, 13, 2, 5);
const at = (d: number, h: number) => new Date(2026, 9, d, h).toISOString();

let calls: IpcCall[];
let stored: AppSettings;
/** What the backend's `check_update` does; null: up to date. */
let checkUpdate: IpcHandler;

const todo = (text: string, extra: Partial<NewTodo> = {}): NewTodo => ({
  text,
  category: null,
  dueAt: null,
  notes: null,
  ...extra,
});

function backend(extra: Record<string, IpcHandler> = {}) {
  calls = installIpc(
    {
      ...sqlHandlers(createDatabase()),
      get_settings: () => stored,
      check_update: (args) => checkUpdate(args),
      "plugin:app|version": () => "1.2.3",
      ...extra,
    },
    "main"
  );
}

beforeEach(async () => {
  freezeAt(NOW);
  stored = { ...TEST_SETTINGS, autoUpdateCheck: false };
  checkUpdate = () => null;
  backend();
  await addTodos([
    todo("pay rent", { category: "Home", dueAt: at(10, 9) }),
    todo("call bob", { category: "Work", dueAt: at(15, 9), notes: "ticket https://example.com/t/1" }),
    todo("write report", { category: "Work", dueAt: at(20, 9) }),
    todo("plan trip"),
  ]);
});

async function renderPopup() {
  const result = render(Popup);
  await screen.findByText("pay rent");
  return result;
}

const texts = () => [...document.querySelectorAll(".todo .text")].map((e) => e.textContent);
const selectedText = () => document.querySelector(".todo.selected .text")?.textContent;
const key = (k: string, init: KeyboardEventInit = {}, target: Element | Window = window) =>
  fireEvent.keyDown(target, { key: k, ...init });
const editor = () => document.querySelector<HTMLInputElement>("input.edit")!;
const todoNamed = async (text: string) => (await openTodos()).find((t) => t.text === text)!;
/** The SQL writes so far whose query starts with `prefix`. */
const writes = (prefix: string) =>
  argsOf(calls, "plugin:sql|execute").filter((a) => String(a.query).startsWith(prefix));

describe("list", () => {
  it("groups the open todos by category, uncategorized last", async () => {
    await renderPopup();
    expect([...document.querySelectorAll("h2")].map((h) => h.textContent!.replace("✎", "").trim())).toEqual([
      "Home",
      "Work",
      "No category",
    ]);
    expect(texts()).toEqual(["pay rent", "call bob", "write report", "plan trip"]);
    expect(document.querySelector(".due.overdue")!.textContent).toMatch(/\S/);
  });

  it("says when there is nothing to show", async () => {
    backend();
    render(Popup);
    expect(await screen.findByText("Nothing to do 🎉")).toBeTruthy();
    await key("Tab");
    expect(await screen.findByText("Nothing done yet.")).toBeTruthy();
  });

  it("moves the selection with the arrow keys and j/k, stopping at the ends", async () => {
    await renderPopup();
    expect(selectedText()).toBe("pay rent");
    await key("ArrowUp");
    expect(selectedText()).toBe("pay rent");
    await key("j");
    await key("ArrowDown");
    expect(selectedText()).toBe("write report");
    await key("j");
    await key("j");
    expect(selectedText()).toBe("plan trip");
    await key("k");
    expect(selectedText()).toBe("write report");
    await fireEvent.click(screen.getByText("call bob"));
    expect(selectedText()).toBe("call bob");
  });

  it("marks the selected todo done with Enter and restores it in Done", async () => {
    await renderPopup();
    // fake timers run the slide-out to its end; waitFor can't work under them
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await key("Enter");
    // a second toggle during the slide-out is ignored
    await key("Enter");
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    expect(texts()).toEqual(["call bob", "write report", "plan trip"]);
    expect((await doneTodos()).map((t) => t.text)).toEqual(["pay rent"]);
    expect(writes("UPDATE todos SET done_at")).toHaveLength(1);

    await key("Tab");
    await waitFor(() => expect(texts()).toEqual(["pay rent"]));
    await fireEvent.click(screen.getByTitle("Move back to open"));
    await waitFor(() => expect(texts()).toEqual([]));
    expect(await doneTodos()).toEqual([]);
  });

  it("ticks a todo with its check button", async () => {
    await renderPopup();
    await fireEvent.click(screen.getAllByTitle("Mark as done")[3]);
    await waitFor(() => expect(texts()).not.toContain("plan trip"));
    expect((await doneTodos()).map((t) => t.text)).toEqual(["plan trip"]);
  });

  it("switches views with Tab and the tabs", async () => {
    await markDone((await todoNamed("plan trip")).id);
    await renderPopup();
    await key("Tab");
    await waitFor(() => expect(texts()).toEqual(["plan trip"]));
    expect(document.querySelector("h2")).toBeNull();
    expect(screen.getByText("Del")).toBeTruthy();
    await fireEvent.click(screen.getByText("Done"));
    await fireEvent.click(screen.getByText("Open"));
    await waitFor(() => expect(texts()).toHaveLength(3));
  });

  it("deletes a done todo with Delete, and only in Done", async () => {
    await markDone((await todoNamed("plan trip")).id);
    await renderPopup();
    await key("Delete");
    await key("Tab");
    await waitFor(() => expect(texts()).toEqual(["plan trip"]));
    // checked after the view switch, so a delete from Open had time to land
    expect(writes("DELETE")).toEqual([]);
    expect(await openTodos()).toHaveLength(3);
    await key("Delete");
    await waitFor(() => expect(texts()).toEqual([]));
    expect(await doneTodos()).toEqual([]);
  });

  it("ignores the edit keys in Done", async () => {
    await markDone((await todoNamed("plan trip")).id);
    await renderPopup();
    await key("Tab");
    await waitFor(() => expect(texts()).toEqual(["plan trip"]));
    // one key per kind of editor; keys.test.ts covers the rest
    await key("e");
    expect(document.querySelector("input")).toBeNull();
    await key("c");
    expect(document.querySelector(".menu")).toBeNull();
  });
});

describe("editing", () => {
  it("edits the text with E, saving with Enter", async () => {
    await renderPopup();
    await key("e");
    expect(editor().value).toBe("pay rent");
    await fireEvent.input(editor(), { target: { value: "  " } });
    await key("Enter", {}, editor()); // a todo needs text
    expect(editor()).not.toBeNull();
    await fireEvent.input(editor(), { target: { value: "pay the rent" } });
    await key("Enter", {}, editor());
    await waitFor(() => expect(texts()).toContain("pay the rent"));
    expect(document.querySelector("input.edit")).toBeNull();
  });

  it("cancels an edit with Esc or by clicking away", async () => {
    await renderPopup();
    await key("F2");
    await fireEvent.input(editor(), { target: { value: "changed" } });
    await key("Escape", {}, editor());
    expect(document.querySelector("input.edit")).toBeNull();
    await fireEvent.click(screen.getAllByTitle("Edit todo (E)")[1]);
    expect(editor().value).toBe("call bob");
    // keys typed into the editor don't reach the list
    await key("j", {}, editor());
    await key("a", {}, editor());
    await fireEvent.focusOut(editor());
    expect(document.querySelector("input.edit")).toBeNull();
    expect(await todoNamed("pay rent")).toBeTruthy();
  });

  it("edits the due date with D, previewing what it reads", async () => {
    await renderPopup();
    await key("d");
    const preview = () => document.querySelector(".preview")!;
    expect(preview().textContent).toBe("no due date");
    await fireEvent.input(editor(), { target: { value: "blah" } });
    expect(preview().textContent).toBe("…");
    await key("Enter", {}, editor()); // not a date yet: keep typing
    expect(editor()).not.toBeNull();
    await fireEvent.input(editor(), { target: { value: "yesterday" } });
    expect(preview().textContent).toMatch(/in the past/);
    expect(preview().classList.contains("past")).toBe(true);
    await fireEvent.input(editor(), { target: { value: "tomorrow 5pm" } });
    expect(preview().classList.contains("past")).toBe(false);
    await key("Enter", {}, editor());
    await waitFor(async () => expect((await todoNamed("pay rent")).due_at).toBe(at(12, 17)));
  });

  it("removes the due date with an empty entry", async () => {
    await renderPopup();
    await fireEvent.click(screen.getAllByTitle("Edit due date (D)")[0]);
    await key("Enter", {}, editor());
    await waitFor(async () => expect((await todoNamed("pay rent")).due_at).toBeNull());
    await fireEvent.click(screen.getAllByTitle("Add due date (D)")[0]);
    expect(editor()).not.toBeNull();
  });

  it("ignores list keys while an editor is open", async () => {
    await renderPopup();
    await key("e");
    await key("j");
    await key("Tab");
    expect(selectedText()).toBeUndefined(); // the selected row shows the editor
    expect(editor()).not.toBeNull();
  });
});

describe("notes", () => {
  it("shows and hides notes with Space, opening links in the browser", async () => {
    await renderPopup();
    await key(" "); // no notes on the first todo
    expect(document.querySelector(".notes")).toBeNull();
    await key("j");
    await key(" ");
    expect(document.querySelector(".notes-text")!.textContent).toBe("ticket https://example.com/t/1");
    await fireEvent.click(screen.getByText("https://example.com/t/1"));
    expect(argsOf(calls, "plugin:opener|open_url")).toEqual([expect.objectContaining({ url: "https://example.com/t/1" })]);
    await key(" ");
    await waitFor(() => expect(document.querySelector(".notes")).toBeNull());
  });

  it("closes the notes when the selection moves on", async () => {
    await renderPopup();
    await fireEvent.click(screen.getByTitle("Show notes (Space)"));
    expect(document.querySelector(".notes")).not.toBeNull();
    await fireEvent.click(screen.getByTitle("Hide notes (Space)"));
    await fireEvent.click(screen.getByTitle("Show notes (Space)"));
    await key("j");
    await waitFor(() => expect(document.querySelector(".notes")).toBeNull());
  });

  it("edits notes with N, saving with Ctrl+Enter", async () => {
    await renderPopup();
    await key("j");
    await key("n");
    const input = document.querySelector<HTMLTextAreaElement>(".notes-input")!;
    expect(input.value).toBe("ticket https://example.com/t/1");
    await key("Enter", {}, input); // a plain Enter is a line break
    await fireEvent.input(input, { target: { value: "new note" } });
    await key("Enter", { ctrlKey: true }, input);
    await waitFor(async () => expect((await todoNamed("call bob")).notes).toBe("new note"));
    expect(document.querySelector(".notes-text")!.textContent).toBe("new note");

    // the pen in the panel edits again; emptying removes the note
    await fireEvent.click(screen.getByTitle("Edit notes (N)"));
    await fireEvent.input(document.querySelector(".notes-input")!, { target: { value: " " } });
    await key("Enter", { ctrlKey: true }, document.querySelector(".notes-input")!);
    await waitFor(async () => expect((await todoNamed("call bob")).notes).toBeNull());
    await waitFor(() => expect(document.querySelector(".notes")).toBeNull());
  });

  it("starts the first note from the indicator, and cancelling collapses it again", async () => {
    await renderPopup();
    await fireEvent.click(screen.getAllByTitle("Add note (N)")[0]);
    const input = document.querySelector<HTMLTextAreaElement>(".notes-input")!;
    expect(input.value).toBe("");
    // the indicator does nothing more while editing
    await fireEvent.click(screen.getAllByTitle("Add note (N)")[0]);
    await key("Escape", {}, input);
    await waitFor(() => expect(document.querySelector(".notes")).toBeNull());
  });

  it("keeps an existing note's panel open when its edit is cancelled by clicking away", async () => {
    await renderPopup();
    await key("j");
    await key("n");
    const wrap = document.querySelector(".notes-editor")!;
    // focus moving inside the editor keeps it
    await fireEvent.focusOut(wrap, { relatedTarget: document.querySelector(".notes-input") });
    expect(document.querySelector(".notes-input")).not.toBeNull();
    await fireEvent.focusOut(wrap, { relatedTarget: null });
    expect(document.querySelector(".notes-input")).toBeNull();
    expect(document.querySelector(".notes-text")).not.toBeNull();
  });
});

describe("category menu", () => {
  const menuRows = () => [...document.querySelectorAll(".menu-item:not(.create)")].map((e) => e.textContent!.trim());
  const menuInput = () => document.querySelector<HTMLInputElement>(".menu-create-input")!;
  const active = () => document.querySelector(".menu-item.active");

  async function openMenu() {
    await renderPopup();
    await key("c");
    await waitFor(() => expect(menuRows()).toEqual(["Home", "Work", "No category"]));
  }

  it("assigns a new category typed into the input", async () => {
    await openMenu();
    expect(document.activeElement).toBe(menuInput());
    await fireEvent.input(menuInput(), { target: { value: "two words" } });
    expect(document.querySelector(".menu-create-wrap.invalid")).not.toBeNull();
    await key("Enter", {}, menuInput()); // invalid: nothing happens
    expect(document.querySelector(".menu")).not.toBeNull();
    await fireEvent.input(menuInput(), { target: { value: "errands" } });
    await key("Enter", {}, menuInput());
    await waitFor(() => expect(document.querySelector(".menu")).toBeNull());
    expect((await todoNamed("pay rent")).category_name).toBe("errands");
  });

  it("completes a typed name with Tab or →", async () => {
    await openMenu();
    await fireEvent.input(menuInput(), { target: { value: "wo" } });
    expect(document.querySelector(".menu-ghost")!.textContent).toBe("work");
    await key("Tab", {}, menuInput());
    expect(menuInput().value).toBe("work");
    await fireEvent.input(menuInput(), { target: { value: "H" } });
    await key("ArrowRight", {}, menuInput());
    expect(menuInput().value).toBe("Home");
    await key("ArrowRight", {}, menuInput()); // nothing left to complete
    await key("Tab", {}, menuInput());
    expect(menuInput().value).toBe("Home");
    await key("Enter", {}, menuInput());
    await waitFor(() => expect(document.querySelector(".menu")).toBeNull());
  });

  it("picks a row with the arrow keys and j/k", async () => {
    await openMenu();
    await key("j", {}, menuInput()); // types in the input, doesn't move
    expect(active()!.classList.contains("create")).toBe(true);
    await key("ArrowDown", {}, menuInput());
    await key("ArrowDown");
    await key("j");
    await key("j"); // stops at the last row
    expect(active()!.textContent!.trim()).toBe("No category");
    await key("k");
    expect(active()!.textContent!.trim()).toBe("Work");
    await key("Enter");
    await waitFor(() => expect(document.querySelector(".menu")).toBeNull());
    expect((await todoNamed("pay rent")).category_name).toBe("Work");
  });

  it("goes back up into the input", async () => {
    await openMenu();
    await key("ArrowDown");
    await key("ArrowUp");
    expect(document.activeElement).toBe(menuInput());
    await key("ArrowUp");
    expect(active()!.classList.contains("create")).toBe(true);
  });

  it("removes the category with No category, and clicks pick a row", async () => {
    await openMenu();
    const none = document.querySelector<HTMLElement>(".menu-item.none")!;
    await fireEvent.mouseMove(none);
    expect(active()).toBe(none);
    await fireEvent.click(none);
    await waitFor(() => expect(document.querySelector(".menu")).toBeNull());
    expect((await todoNamed("pay rent")).category_id).toBeNull();
  });

  it("prefers a typed name over a hovered row", async () => {
    await openMenu();
    await fireEvent.input(menuInput(), { target: { value: "errands" } });
    await fireEvent.mouseMove(document.querySelector(".menu-item.none")!);
    await key("Enter", {}, menuInput());
    await waitFor(() => expect(document.querySelector(".menu")).toBeNull());
    expect((await todoNamed("pay rent")).category_name).toBe("errands");
  });

  it("closes with Esc and a click on the backdrop", async () => {
    await openMenu();
    await key("Escape", {}, menuInput());
    expect(document.querySelector(".menu")).toBeNull();
    await key("c");
    await fireEvent.click(document.querySelector(".menu")!); // inside: stays
    expect(document.querySelector(".menu")).not.toBeNull();
    await fireEvent.scroll(menuInput());
    await fireEvent.click(document.querySelector(".menu-backdrop")!);
    expect(document.querySelector(".menu")).toBeNull();
    expect(argsOf(calls, "plugin:window|hide")).toEqual([]);
  });
});

describe("category editor", () => {
  const nameInput = () => document.querySelector<HTMLInputElement>(".cat-edit")!;

  it("renames and recolors a category from its heading", async () => {
    await renderPopup();
    await fireEvent.click(screen.getAllByTitle("Edit category")[1]);
    expect(nameInput().value).toBe("Work");
    // another category's name is taken
    await fireEvent.input(nameInput(), { target: { value: "home" } });
    expect(screen.getByTitle<HTMLButtonElement>("Invalid or duplicate name").disabled).toBe(true);
    await key("Enter", {}, nameInput());
    expect(nameInput()).not.toBeNull();

    await fireEvent.input(nameInput(), { target: { value: "Job" } });
    const color = document.querySelector<HTMLInputElement>(".cat-color")!;
    await fireEvent.input(color, { target: { value: "#123456" } });
    await key("j", {}, color); // keys in the color picker stay there
    await fireEvent.click(screen.getByTitle("Save"));
    await waitFor(async () => expect(await listCategories()).toContainEqual({ id: 2, name: "Job", color: "#123456" }));
  });

  it("saves with Enter, cancels with Esc, ✕ or a click away", async () => {
    await renderPopup();
    const pen = () => screen.getAllByTitle("Edit category")[0];
    await fireEvent.click(pen());
    await fireEvent.click(pen()); // already editing
    await key("Escape", {}, nameInput());
    expect(document.querySelector(".cat-edit")).toBeNull();

    await fireEvent.click(pen());
    await fireEvent.click(screen.getByTitle("Cancel (Esc)"));
    expect(document.querySelector(".cat-edit")).toBeNull();

    await fireEvent.click(pen());
    await fireEvent.focusOut(document.querySelector(".cat-editor")!, { relatedTarget: null });
    expect(document.querySelector(".cat-edit")).toBeNull();

    await fireEvent.click(pen());
    await key("a", {}, nameInput());
    await fireEvent.input(nameInput(), { target: { value: "House" } });
    await key("Enter", {}, nameInput());
    await waitFor(async () => expect((await listCategories()).map((c) => c.name)).toContain("House"));
  });

  it("never lets an orphaned category edit lock the keyboard", async () => {
    await renderPopup();
    await fireEvent.click(screen.getAllByTitle("Edit category")[0]);
    await key("j");
    expect(selectedText()).toBe("pay rent");
    await key("Escape");
    expect(document.querySelector(".cat-edit")).toBeNull();
    expect(argsOf(calls, "plugin:window|hide")).toEqual([]);
  });
});

describe("filters and other keys", () => {
  it("cycles the filters with T and F, from the start of the list", async () => {
    await renderPopup();
    await key("j");
    await key("t");
    expect(texts()).toEqual(["pay rent"]);
    expect(selectedText()).toBe("pay rent");
    await key("t");
    await key("f");
    expect(screen.getByText("No todos match the filters.")).toBeTruthy();
  });

  it("closes a filter dropdown with any key, Esc only closing it", async () => {
    await renderPopup();
    await fireEvent.click(screen.getByTitle("Due-date filter (F cycles)"));
    await key("Escape");
    expect(document.querySelector(".fmenu")).toBeNull();
    expect(argsOf(calls, "plugin:window|hide")).toEqual([]);
    await fireEvent.click(screen.getByTitle("Category filter (T cycles)"));
    await fireEvent.click(screen.getByText("Work", { selector: ".fmenu-item" }));
    expect(texts()).toEqual(["call bob", "write report"]);
  });

  it("opens the full-size view with L, handing over view and filters", async () => {
    await renderPopup();
    await key("f");
    await key("l");
    expect(argsOf(calls, "open_list")).toEqual([{ state: { view: "open", catFilter: null, dueFilter: "today" } }]);
  });

  it("points Ctrl+P to the full-size view", async () => {
    await renderPopup();
    expect(await key("p")).toBe(true); // a plain P is no shortcut
    expect(screen.queryByRole("status")).toBeNull();
    expect(await key("p", { ctrlKey: true })).toBe(false);
    expect(screen.getByRole("status").textContent).toMatch(/To print, open the full-size view/);
  });

  it("points Ctrl+P to the full-size view from inside an editor too", async () => {
    await renderPopup();
    await key("e");
    expect(await key("p", { ctrlKey: true }, editor())).toBe(false);
    expect(screen.getByRole("status").textContent).toMatch(/To print, open the full-size view/);
  });

  it("hides with Esc and opens help, import and about", async () => {
    await renderPopup();
    await key("Escape");
    await key("?");
    await key("x");
    await fireEvent.click(screen.getByTitle("Keyboard shortcuts (? / F1)"));
    await fireEvent.click(screen.getByTitle("Import todos from a .txt or .csv file…"));
    await fireEvent.click(screen.getByTitle("About Purser"));
    expect(argsOf(calls, "plugin:window|hide")).toHaveLength(1);
    expect(argsOf(calls, "open_help")).toHaveLength(2);
    expect(argsOf(calls, "open_import")).toHaveLength(1);
    expect(argsOf(calls, "open_about")).toHaveLength(1);
  });
});

describe("backend events", () => {
  it("refreshes on show, taking over the full-size view's state", async () => {
    await markDone((await todoNamed("plan trip")).id);
    await renderPopup();
    await key("j");
    await addTodos([todo("from quick-add")]);
    await emit("purser://refresh", null);
    await waitFor(() => expect(texts()).toContain("from quick-add"));
    expect(selectedText()).toBe("pay rent");

    await emit("purser://refresh", { view: "done", catFilter: null, dueFilter: "all" });
    await waitFor(() => expect(texts()).toEqual(["plan trip"]));

    const work = (await todoNamed("call bob")).category_id;
    await emit("purser://refresh", { view: "open", catFilter: work, dueFilter: "all" });
    await waitFor(() => expect(texts()).toEqual(["call bob", "write report"]));
  });

  it("runs an import the backend hands over", async () => {
    await renderPopup();
    await emit("purser://import", { fileName: "a.txt", csv: false, content: "imported todo" });
    await waitFor(() => expect(argsOf(calls, "import_finished")).toHaveLength(1));
    expect(await todoNamed("imported todo")).toBeTruthy();
  });
});

describe("updates", () => {
  const banner = () => document.querySelector(".update")?.textContent?.replace(/\s+/g, " ").trim() ?? null;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
      now: NOW,
    });
    stored.autoUpdateCheck = true;
  });

  /** Mounts the popup and lets the startup check finish. */
  async function start() {
    render(Popup);
    await vi.advanceTimersByTimeAsync(0);
  }

  it("offers a found update and installs it with U, showing the progress", async () => {
    checkUpdate = () => ({ version: "9.9.9" });
    let finishInstall = () => {};
    backend({
      install_update: () =>
        new Promise<void>((resolve) => {
          finishInstall = resolve;
        }),
    });
    await start();
    expect(banner()).toMatch(/Purser 9.9.9 is available/);

    await key("u");
    expect(banner()).toBe("Downloading Purser 9.9.9…");
    await emit("purser://update-progress", 40);
    expect(banner()).toBe("Downloading Purser 9.9.9… 40 %");
    await emit("purser://update-progress", 100);
    expect(banner()).toMatch(/Installing Purser 9.9.9… it restarts in a moment/);

    // no check may replace the install banner
    await emit("purser://check-update");
    await vi.advanceTimersByTimeAsync(0);
    expect(argsOf(calls, "check_update")).toHaveLength(1);
    finishInstall();
  });

  it("reports a failed install, retries with U and hides with Later", async () => {
    checkUpdate = () => ({ version: "9.9.9" });
    let attempts = 0;
    backend({
      install_update: () => {
        attempts++;
        throw new Error("bad signature");
      },
    });
    await start();
    await fireEvent.click(screen.getByText("install", { exact: false }));
    await vi.advanceTimersByTimeAsync(0);
    expect(banner()).toMatch(/Update to 9.9.9 failed: bad signature/);
    expect(document.querySelector(".update.error")).not.toBeNull();

    await key("u");
    await vi.advanceTimersByTimeAsync(0);
    await fireEvent.click(screen.getByText("retry", { exact: false }));
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(3);

    await fireEvent.click(screen.getByTitle("Dismiss"));
    expect(banner()).toBeNull();
    // U does nothing without a banner
    await key("u");
    expect(attempts).toBe(3);
  });

  it("answers a manual check briefly, also when up to date or offline", async () => {
    await start();
    expect(banner()).toBeNull();

    await emit("purser://check-update");
    await vi.advanceTimersByTimeAsync(0);
    expect(banner()).toBe("Purser 1.2.3 is up to date");
    await vi.advanceTimersByTimeAsync(4000);
    expect(banner()).toBeNull();

    checkUpdate = () => {
      throw new Error("offline");
    };
    await emit("purser://check-update");
    await vi.advanceTimersByTimeAsync(0);
    expect(banner()).toMatch(/Could not check for updates: offline/);
    await fireEvent.click(screen.getByTitle("Dismiss"));
    expect(banner()).toBeNull();

    checkUpdate = () => {
      throw "no manifest";
    };
    await emit("purser://check-update");
    await vi.advanceTimersByTimeAsync(0);
    expect(banner()).toMatch(/no manifest/);
    await vi.advanceTimersByTimeAsync(8000);
    expect(banner()).toBeNull();
  });

  it("keeps automatic checks silent and retries them after a minute and ten", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    checkUpdate = () => {
      throw new Error("offline");
    };
    await start();
    expect(argsOf(calls, "check_update")).toHaveLength(1);
    expect(banner()).toBeNull();

    checkUpdate = () => null;
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(argsOf(calls, "check_update")).toHaveLength(2);

    checkUpdate = () => ({ version: "9.9.9" });
    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    expect(banner()).toMatch(/9.9.9 is available/);

    // the daily check doesn't stack another banner
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(argsOf(calls, "check_update")).toHaveLength(4);
  });

  it("skips the retries once an update was found", async () => {
    checkUpdate = () => ({ version: "9.9.9" });
    await start();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(argsOf(calls, "check_update")).toHaveLength(1);
  });

  it("checks again on show, at most once an hour", async () => {
    await start();
    await emit("purser://refresh", null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(argsOf(calls, "check_update")).toHaveLength(1);

    // the retries after a minute and ten count as checks too
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    await emit("purser://refresh", null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(argsOf(calls, "check_update")).toHaveLength(4);
  });

  it("doesn't check by itself when automatic checks are off", async () => {
    stored.autoUpdateCheck = false;
    await start();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(argsOf(calls, "check_update")).toEqual([]);
    await emit("purser://check-update");
    await vi.advanceTimersByTimeAsync(0);
    expect(argsOf(calls, "check_update")).toHaveLength(1);
  });
});
