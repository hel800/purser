// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { disableContextMenu } from "./contextmenu";

describe("disableContextMenu", () => {
  it("swallows the webview's right-click menu", () => {
    const menu = () => new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const before = menu();
    document.body.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);

    disableContextMenu();
    const after = menu();
    document.body.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(true);
  });
});
