import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { emit } from "@tauri-apps/api/event";
import { argsOf, installIpc, type IpcCall, type IpcHandler } from "./test/ipc";
import { TEST_SETTINGS } from "./test/settings";
import { settings } from "./lib/settings.svelte";
import Help from "./Help.svelte";

let calls: IpcCall[];

async function renderHelp(handlers: Record<string, IpcHandler> = {}, stored = TEST_SETTINGS) {
  calls = installIpc({ get_settings: () => stored, ...handlers }, "help");
  render(Help);
  await screen.findByText(stored.quickAddPretty);
}

const pens = () => screen.getAllByTitle("Change shortcut");
const errorText = () => document.querySelector(".error")?.textContent ?? null;

beforeEach(() => {
  settings.dateLanguage = "en";
});

describe("Help", () => {
  it("shows the stored shortcuts and the English date examples", async () => {
    await renderHelp();
    expect(screen.getByText("Ctrl+Alt+L")).toBeTruthy();
    expect(screen.getByText("friday 5pm")).toBeTruthy();
    expect(screen.queryByText("KW 44")).toBeNull();
  });

  it("shows the German date examples for German date input", async () => {
    await renderHelp({}, { ...TEST_SETTINGS, dateLanguage: "de" });
    expect(screen.getByText("KW 44")).toBeTruthy();
    expect(screen.getByText(/Miete zahlen/)).toBeTruthy();
  });

  it("closes with Esc and the ✕", async () => {
    await renderHelp();
    await fireEvent.keyDown(window, { key: "Escape" });
    await fireEvent.click(screen.getByTitle("Close (Esc)"));
    expect(argsOf(calls, "close_help")).toHaveLength(2);
    expect(argsOf(calls, "end_capture")).toHaveLength(0);
  });

  it("records a new shortcut", async () => {
    await renderHelp();
    await fireEvent.click(pens()[0]);
    expect(argsOf(calls, "begin_capture")).toHaveLength(1);
    expect(screen.getByText("Press a shortcut…")).toBeTruthy();

    // modifiers alone wait for the key; repeats are ignored
    await fireEvent.keyDown(window, { key: "Control", code: "ControlLeft", ctrlKey: true });
    await fireEvent.keyDown(window, { key: "a", code: "KeyA", ctrlKey: true, repeat: true });
    expect(argsOf(calls, "set_shortcut")).toEqual([]);

    await fireEvent.keyDown(window, { key: "A", code: "KeyA", ctrlKey: true, shiftKey: true });
    expect(argsOf(calls, "set_shortcut")).toEqual([{ id: "quick_add", shortcut: "ctrl+shift+a" }]);
    expect(screen.queryByText("Press a shortcut…")).toBeNull();
    expect(errorText()).toBeNull();
  });

  it("keeps recording after an unusable combo or a rejected one", async () => {
    await renderHelp({
      set_shortcut: () => {
        throw "already in use";
      },
    });
    await fireEvent.click(pens()[1]);

    await fireEvent.keyDown(window, { key: "x", code: "KeyX" });
    expect(errorText()).toMatch(/Hold down a modifier/);

    await fireEvent.keyDown(window, { key: "x", code: "KeyX", altKey: true });
    expect(argsOf(calls, "set_shortcut")).toEqual([{ id: "list", shortcut: "alt+x" }]);
    expect(errorText()).toBe("already in use");
    expect(screen.getByText("Press a shortcut…")).toBeTruthy();

    // Esc cancels the recording, not the sheet
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(argsOf(calls, "end_capture")).toHaveLength(1);
    expect(argsOf(calls, "close_help")).toHaveLength(0);
    expect(errorText()).toBeNull();
  });

  it("cancels with the ✕ next to the recording, and when closed while recording", async () => {
    await renderHelp();
    await fireEvent.click(pens()[0]);
    await fireEvent.click(screen.getByTitle("Cancel recording (Esc)"));
    expect(argsOf(calls, "end_capture")).toHaveLength(1);

    await fireEvent.click(pens()[1]);
    await fireEvent.click(screen.getByTitle("Close (Esc)"));
    expect(argsOf(calls, "end_capture")).toHaveLength(2);
    expect(argsOf(calls, "close_help")).toHaveLength(1);
  });

  it("stops recording when the window loses focus", async () => {
    await renderHelp();
    // not recording: losing focus changes nothing
    await emit("tauri://blur");
    expect(argsOf(calls, "end_capture")).toHaveLength(0);

    await fireEvent.click(pens()[0]);
    await emit("tauri://blur");
    expect(argsOf(calls, "end_capture")).toHaveLength(1);
    expect(await screen.findByText(/in use by another application/)).toBeTruthy();
  });

  it("shows an error the backend reports", async () => {
    await renderHelp();
    await emit("purser://shortcut-error", "could not register Ctrl+Alt+N");
    expect(await screen.findByText("could not register Ctrl+Alt+N")).toBeTruthy();
  });

  it("keeps Tab inside the sheet", async () => {
    await renderHelp();
    const buttons = [...document.querySelectorAll<HTMLElement>("button")];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];

    last.focus();
    await fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    await fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    // in the middle, Tab is left to the browser
    buttons[1].focus();
    await fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[1]);
  });
});
