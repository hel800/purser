import { describe, expect, it } from "vitest";
import type { Category } from "./db";
import { completeTag, tagAtCaret, tagGhost, tagSuggestions } from "./quickadd";

const cat = (id: number, name: string): Category => ({ id, name, color: "#6ea8fe" });
const CATEGORIES = ["Work", "workshop", "Home", "w1", "w2", "w3", "w4", "w5"].map((n, i) => cat(i + 1, n));

describe("tagAtCaret", () => {
  it("finds the tag the caret is in", () => {
    expect(tagAtCaret("call bob #wo", 12)).toEqual({ start: 9, partial: "wo" });
    expect(tagAtCaret("call bob #", 10)).toEqual({ start: 9, partial: "" });
    expect(tagAtCaret("#wo later", 3)).toEqual({ start: 0, partial: "wo" });
  });

  it("is null outside a tag", () => {
    expect(tagAtCaret("call bob", 8)).toBeNull();
    expect(tagAtCaret("#work done", 10)).toBeNull();
  });
});

describe("tagSuggestions", () => {
  it("offers up to six categories the partial starts, ignoring case", () => {
    expect(tagSuggestions(CATEGORIES, "W").map((c) => c.name)).toEqual(["Work", "workshop", "w1", "w2", "w3", "w4"]);
    expect(tagSuggestions(CATEGORIES, "ho").map((c) => c.name)).toEqual(["Home"]);
  });

  it("offers nothing for an empty partial or an exact name", () => {
    expect(tagSuggestions(CATEGORIES, "")).toEqual([]);
    expect(tagSuggestions(CATEGORIES, "home")).toEqual([]);
  });
});

describe("tagGhost", () => {
  const tag = { start: 0, partial: "wo" };

  it("shows the rest of the pick at the end of the text", () => {
    expect(tagGhost("#wo", 3, tag, cat(1, "Work"))).toBe("rk");
    expect(tagGhost("#wo  ", 3, tag, cat(1, "Work"))).toBe("rk");
  });

  it("shows nothing mid-text, without a pick or for an empty tag", () => {
    expect(tagGhost("#wo bob", 3, tag, cat(1, "Work"))).toBe("");
    expect(tagGhost("#wo", 3, tag, undefined)).toBe("");
    expect(tagGhost("#", 1, { start: 0, partial: "" }, cat(1, "Work"))).toBe("");
    expect(tagGhost("wo", 2, null, cat(1, "Work"))).toBe("");
  });
});

describe("completeTag", () => {
  it("replaces the partial with the name and puts the caret after it", () => {
    expect(completeTag("call #wo", 8, { start: 5, partial: "wo" }, "Work")).toEqual({
      value: "call #Work",
      caret: 10,
    });
    expect(completeTag("#wo tomorrow", 3, { start: 0, partial: "wo" }, "Work")).toEqual({
      value: "#Work tomorrow",
      caret: 5,
    });
  });
});
