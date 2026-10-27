import { describe, expect, it } from "vitest";
import { COMMAND_SIGNATURES, contractViolation, PLUGINS, REGISTERED_COMMANDS } from "./commands";

describe("the backend contract read from lib.rs", () => {
  it("has a parsed signature for every registered command", () => {
    expect(REGISTERED_COMMANDS.size).toBeGreaterThan(10);
    for (const cmd of REGISTERED_COMMANDS) expect(COMMAND_SIGNATURES.has(cmd), cmd).toBe(true);
  });

  it("names the arguments as JS passes them, leaving out injected ones", () => {
    expect(COMMAND_SIGNATURES.get("open_about")).toEqual({ required: [], optional: [] });
    expect(COMMAND_SIGNATURES.get("confirm_import")).toEqual({ required: ["fileName", "count"], optional: [] });
    expect(COMMAND_SIGNATURES.get("import_finished")).toEqual({
      required: ["fileName", "imported", "skipped", "duplicates", "cancelled"],
      optional: ["error"],
    });
  });

  it("knows the registered plugins next to the built-in ones", () => {
    for (const plugin of ["sql", "opener", "dialog", "updater", "global-shortcut", "window", "event"]) {
      expect(PLUGINS.has(plugin), plugin).toBe(true);
    }
  });

  it("flags calls the backend would refuse or misread", () => {
    const finished = { fileName: "a", imported: 0, skipped: 0, duplicates: 0, cancelled: false };
    expect(contractViolation("confirm_import", { fileName: "a.txt", count: 1 })).toBeNull();
    expect(contractViolation("import_finished", finished)).toBeNull(); // error is optional
    expect(contractViolation("open_halp", {})).toMatch(/not a backend command/);
    expect(contractViolation("confirm_import", { file_name: "a.txt", count: 1 })).toMatch(/missing fileName/);
    expect(contractViolation("open_list", { state: {}, view: "open" })).toMatch(/takes no view/);
    expect(contractViolation("plugin:sql|select", { anything: 1 })).toBeNull();
    expect(contractViolation("plugin:fs|read_file", {})).toMatch(/registered plugin/);
  });
});
