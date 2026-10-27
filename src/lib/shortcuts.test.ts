import { describe, expect, it } from "vitest";
import { comboFromEvent, keyToken, type ComboKeys } from "./shortcuts";

const press = (key: string, code: string, mods: Partial<ComboKeys> = {}): ComboKeys => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("keyToken", () => {
  it("reads letters, digits and F1–F24 by their physical key", () => {
    expect(keyToken("KeyN")).toBe("n");
    expect(keyToken("Digit7")).toBe("7");
    expect(keyToken("F1")).toBe("f1");
    expect(keyToken("F24")).toBe("f24");
  });

  it("names the navigation and editing keys", () => {
    expect(keyToken("Space")).toBe("space");
    expect(keyToken("ArrowLeft")).toBe("left");
    expect(keyToken("PageDown")).toBe("pagedown");
  });

  it("rejects keys the backend can't register", () => {
    expect(keyToken("F25")).toBeNull();
    expect(keyToken("Semicolon")).toBeNull();
    expect(keyToken("Numpad1")).toBeNull();
  });
});

describe("comboFromEvent", () => {
  it("waits while only modifiers are down", () => {
    expect(comboFromEvent(press("Control", "ControlLeft", { ctrlKey: true }))).toEqual({});
    expect(comboFromEvent(press("Shift", "ShiftLeft", { shiftKey: true }))).toEqual({});
  });

  it("joins the modifiers in a fixed order with the key", () => {
    const all = { ctrlKey: true, altKey: true, shiftKey: true, metaKey: true };
    expect(comboFromEvent(press("N", "KeyN", all))).toEqual({ combo: "ctrl+alt+shift+super+n" });
    expect(comboFromEvent(press("F5", "F5", { altKey: true }))).toEqual({ combo: "alt+f5" });
  });

  it("needs a modifier", () => {
    expect(comboFromEvent(press("n", "KeyN")).reason).toMatch(/modifier/);
  });

  it("explains an unsupported key", () => {
    expect(comboFromEvent(press(";", "Semicolon", { ctrlKey: true })).reason).toMatch(/Unsupported key/);
  });
});
