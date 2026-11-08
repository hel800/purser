import { describe, expect, it } from "vitest";
import { parseSourceOutput } from "./sources";

describe("parseSourceOutput", () => {
  it("reads the items list with all fields", () => {
    const raw = JSON.stringify({
      items: [
        {
          id: "ML-1",
          text: " ML-1 Fix login ",
          url: "https://jira.example.com/browse/ML-1",
          due: "2026-11-10T15:00:00Z",
          notes: "details",
        },
      ],
    });
    expect(parseSourceOutput(raw)).toEqual({
      items: [
        {
          id: "ML-1",
          text: "ML-1 Fix login",
          url: "https://jira.example.com/browse/ML-1",
          dueAt: "2026-11-10T15:00:00.000Z",
          notes: "details",
        },
      ],
      invalid: 0,
    });
  });

  it("accepts a bare array and numeric ids", () => {
    const { items } = parseSourceOutput('[{ "id": 42, "text": "repo#42 Title" }]');
    expect(items).toEqual([{ id: "42", text: "repo#42 Title", url: null, dueAt: null, notes: null }]);
  });

  it("reads a plain date as local midnight", () => {
    const { items } = parseSourceOutput('[{ "id": "a", "text": "x", "due": "2026-11-10" }]');
    // TZ=Europe/Berlin in vitest.config.ts
    expect(items[0].dueAt).toBe("2026-11-09T23:00:00.000Z");
  });

  it("drops unusable optional fields instead of the item", () => {
    const { items } = parseSourceOutput(
      '[{ "id": "a", "text": "x", "due": "someday", "url": "javascript:alert(1)", "notes": 3 }]'
    );
    expect(items[0]).toEqual({ id: "a", text: "x", url: null, dueAt: null, notes: null });
  });

  it("skips and counts items without id or text, and duplicate ids", () => {
    const raw = JSON.stringify({
      items: [{ id: "a", text: "first" }, { id: "a", text: "again" }, { text: "no id" }, { id: "b", text: " " }, null],
    });
    const { items, invalid } = parseSourceOutput(raw);
    expect(items.map((i) => i.text)).toEqual(["first"]);
    expect(invalid).toBe(4);
  });

  it("treats an empty list as a valid, empty result", () => {
    expect(parseSourceOutput('{ "items": [] }')).toEqual({ items: [], invalid: 0 });
  });

  it("throws on output that isn't a list of items", () => {
    expect(() => parseSourceOutput("Error: 401")).toThrow("not valid JSON");
    expect(() => parseSourceOutput('{ "issues": [] }')).toThrow('no "items"');
    expect(() => parseSourceOutput("null")).toThrow('no "items"');
  });
});
