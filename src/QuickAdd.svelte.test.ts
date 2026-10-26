import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { emit, listen } from "@tauri-apps/api/event";
import { argsOf, installIpc, type IpcCall } from "./test/ipc";
import { createDatabase, sqlHandlers } from "./test/sqlite";
import { freezeAt } from "./test/clock";
import { TEST_SETTINGS } from "./test/settings";
import { addTodo, openTodos } from "./lib/db";
import QuickAdd from "./QuickAdd.svelte";

/** Sun 11 Oct 2026 13:02:05, Europe/Berlin. */
const NOW = new Date(2026, 9, 11, 13, 2, 5);

let calls: IpcCall[];
let input: HTMLTextAreaElement;

beforeEach(async () => {
  freezeAt(NOW);
  calls = installIpc(
    {
      ...sqlHandlers(createDatabase()),
      get_settings: () => TEST_SETTINGS,
    },
    "quickadd"
  );
  await addTodo("seed", "Work", null);
  await addTodo("seed", "Workshop", null);
  render(QuickAdd);
  input = screen.getByPlaceholderText("pay rent friday 5pm #finance") as HTMLTextAreaElement;
  // categories load on mount
  await waitFor(() => expect(argsOf(calls, "plugin:sql|select").length).toBeGreaterThan(0));
});

/** Types `text` as the whole input, caret at the end. */
const type = (text: string) => fireEvent.input(input, { target: { value: text } });
const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...init });
const ghost = () => document.querySelector(".ghost-suffix")?.textContent ?? "";

describe("QuickAdd", () => {
  it("previews date, category and note, and saves the todo with Enter", async () => {
    let refreshed = 0;
    await listen("purser://refresh", () => refreshed++);
    await type("pay rent tomorrow 5pm #finance //IBAN on the letter");
    expect(document.querySelector(".chip.due")!.textContent).toMatch(/📅/);
    expect(document.querySelector(".chip.category")!.textContent).toBe("#finance");
    expect(document.querySelector(".chip.note")).not.toBeNull();

    await key("Enter");
    await waitFor(() => expect(argsOf(calls, "plugin:window|hide")).toHaveLength(1));
    expect((await openTodos()).find((t) => t.text === "pay rent")).toMatchObject({
      category_name: "finance",
      notes: "IBAN on the letter",
      due_at: new Date(2026, 9, 12, 17).toISOString(),
    });
    expect(refreshed).toBe(1);
    expect(input.value).toBe("");
  });

  it("warns about a date that is already over", async () => {
    await type("call bob yesterday");
    expect(document.querySelector(".chip.due.past")!.textContent).toMatch(/in the past/);
  });

  it("saves nothing without text", async () => {
    await type("   ");
    await key("Enter");
    expect(argsOf(calls, "plugin:window|hide")).toEqual([]);
    expect(await openTodos()).toHaveLength(2);
  });

  it("completes a category with Tab, picking with the arrow keys", async () => {
    await type("call #wo");
    expect(ghost()).toBe("rk");
    await key("ArrowDown");
    expect(ghost()).toBe("rkshop");
    await key("ArrowDown"); // stays on the last suggestion
    expect(ghost()).toBe("rkshop");
    await key("ArrowUp");
    await key("ArrowUp");
    expect(ghost()).toBe("rk");

    await key("Tab");
    expect(input.value).toBe("call #Work");
    expect(ghost()).toBe("");
  });

  it("completes with →, and typing on suggests again", async () => {
    await type("#W");
    await key("ArrowRight");
    expect(input.value).toBe("#Work");
    await type("#Works");
    expect(ghost()).toBe("hop");
  });

  it("follows the caret when it moves without typing", async () => {
    await type("#wo later");
    expect(ghost()).toBe("");
    input.setSelectionRange(3, 3);
    document.dispatchEvent(new Event("selectionchange"));
    // the caret is inside the tag, but text follows it: no inline ghost
    await waitFor(() => expect(ghost()).toBe(""));
    await key("Tab");
    expect(input.value).toBe("#wo later");
  });

  it("keeps Tab in the window without a completion", async () => {
    await type("call bob");
    expect(await key("Tab")).toBe(false); // default prevented
  });

  it("clears with Ctrl+Backspace, hides with Esc and opens the help", async () => {
    await type("call bob");
    await key("Backspace");
    expect(input.value).toBe("call bob");
    await key("Backspace", { ctrlKey: true });
    expect(input.value).toBe("");

    await key("Escape");
    expect(argsOf(calls, "plugin:window|hide")).toHaveLength(1);

    await key("F1");
    await fireEvent.click(screen.getByTitle("Keyboard shortcuts (? / F1)"));
    expect(argsOf(calls, "open_help")).toHaveLength(2);
  });

  it("keeps a half-typed todo and reloads the categories when shown again", async () => {
    await type("call #ho");
    expect(ghost()).toBe("");
    await addTodo("seed", "home", null);
    await emit("purser://focus");
    await waitFor(() => expect(ghost()).toBe("me"));
    expect(input.value).toBe("call #ho");
    expect(document.activeElement).toBe(input);
  });

  it("fits the window to its content", async () => {
    await waitFor(() => expect(argsOf(calls, "plugin:window|set_size")).not.toEqual([]));
  });
});
