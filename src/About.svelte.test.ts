import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { argsOf, installIpc } from "./test/ipc";
import About from "./About.svelte";

describe("About", () => {
  it("shows the version and links, and hides on Esc or ✕", async () => {
    const calls = installIpc({ "plugin:app|version": () => "1.2.3" }, "about");
    render(About);
    expect(await screen.findByText("Version 1.2.3")).toBeTruthy();
    expect(screen.getByText(/MIT License · Released \w+ \d{4}/)).toBeTruthy();

    await fireEvent.click(screen.getByText("github.com/hel800/purser"));
    expect(argsOf(calls, "plugin:opener|open_url")).toEqual([
      expect.objectContaining({ url: "https://github.com/hel800/purser" }),
    ]);
    await fireEvent.click(screen.getByText("Keyboard shortcuts"));
    expect(argsOf(calls, "open_help")).toHaveLength(1);

    await fireEvent.keyDown(window, { key: "Escape" });
    await fireEvent.keyDown(window, { key: "a" });
    await fireEvent.click(screen.getByTitle("Close (Esc)"));
    expect(argsOf(calls, "plugin:window|hide")).toHaveLength(2);
  });
});
