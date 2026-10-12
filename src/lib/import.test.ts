import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportError, parseImport, parseImportLine } from "./import";
import { todoKey } from "./db";
import { settings } from "./settings.svelte";

/** Sun 11 Oct 2026 13:02:05, Europe/Berlin (TZ is pinned in vitest.config.ts). */
const NOW = new Date(2026, 9, 11, 13, 2, 5);
const local = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(y, m - 1, d, h, mi).toISOString();

// The samples ship as text (LF in git, CRLF on Windows checkouts): assert on
// parsed todos only, never on raw line endings.
const files = import.meta.glob<string>("../../samples/import/**/*.{txt,csv}", {
  query: "?raw",
  import: "default",
  eager: true,
});
function sample(name: string): string {
  const content = files[`../../samples/import/${name}`];
  if (content === undefined) throw new Error(`missing sample ${name}`);
  return content;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // "auto" would follow the machine's language; the samples are English
  settings.dateLanguage = "en";
});
afterEach(() => vi.useRealTimers());

describe("parseImportLine", () => {
  it("strips bullets, moves URLs to the note, takes a trailing note #tag as category", () => {
    expect(parseImportLine("• Review TICKET-839 Monday #Project1 //https://example.org/TICKET-839")).toEqual({
      text: "Review TICKET-839",
      category: "Project1",
      dueAt: local(2026, 10, 12, 12),
      notes: "https://example.org/TICKET-839",
    });
    expect(parseImportLine("call bob //https://example.org/x #work")).toEqual({
      text: "call bob",
      category: "work",
      dueAt: null,
      notes: "https://example.org/x",
    });
    expect(parseImportLine("Claude tutorial https://example.org/courses/claude-101/383392 #claude")).toEqual({
      text: "Claude tutorial",
      category: "claude",
      dueAt: null,
      notes: "https://example.org/courses/claude-101/383392",
    });
  });

  it("keeps a note #tag when the title already has one", () => {
    expect(parseImportLine("renew passport in 2 weeks #private //bring the old one #documents")).toMatchObject({
      category: "private",
      notes: "bring the old one #documents",
    });
  });

  it("returns null for a line that is only a URL", () => {
    expect(parseImportLine("https://example.org/only-a-link")).toBeNull();
  });
});

describe("parseImport with the sample files", () => {
  it.each([
    ["new-todos.txt", false, 3, 0],
    ["quick-add-syntax.txt", false, 10, 1],
    ["many-todos.txt", false, 120, 0],
    ["todos-header.csv", true, 5, 1],
    ["todos-excel-de.csv", true, 4, 0],
    ["jira-export.csv", true, 6, 2],
    ["jira-export-description.csv", true, 3, 1],
    ["only-urls.txt", false, 0, 2],
  ])("%s -> %d items, %d skipped", (name, csv, items, skipped) => {
    const result = parseImport(sample(name), csv);
    expect(result.items).toHaveLength(items);
    expect(result.skipped).toBe(skipped);
  });

  it("reads a header CSV: the other columns win over the quick-add text", () => {
    const { items } = parseImport(sample("todos-header.csv"), true);
    expect(items[0]).toEqual({
      text: "Book flights",
      category: "travel",
      dueAt: local(2026, 10, 16, 12),
      notes: "Window seat, if possible",
    });
    expect(items[1]).toMatchObject({
      text: "Call Bob about the offer, then Alice",
      category: null,
      dueAt: local(2026, 10, 12, 10),
    });
    expect(items[2]).toMatchObject({
      text: "Write quarterly report",
      category: "work",
      notes: "Sections:\n- summary\n- numbers",
    });
    expect(items[3]).toMatchObject({ category: "team", notes: "https://example.org/team-event" });
    expect(items[3].dueAt).toMatch(/^2026-11-01T/); // "in 3 weeks"
    expect(items[4]).toMatchObject({ text: "Water plants", category: "home" });
  });

  it("reads a Jira export literally and skips done issues", () => {
    const { items } = parseImport(sample("jira-export.csv"), true);
    expect(items.map((t) => t.text.split(" ")[0])).toEqual([
      "DEMO-2388",
      "DEMO-2522",
      "DEMO-2668",
      "DEMO-1450",
      "DEMO-2328",
      "DEMO-2339",
    ]);
    expect(items[1].dueAt).toBe(local(2026, 12, 17));
    expect(items[4].text).toBe('DEMO-2328 integrate "update of clinical evaluation" into SDLC');
    expect(items[5]).toMatchObject({
      text: "DEMO-2339 Effectiveness check for translation training, part #2",
      category: null,
      dueAt: local(2026, 9, 28, 14, 30),
    });
  });

  it("takes the Jira description as note and reads the dd/Mon/yy format", () => {
    const { items } = parseImport(sample("jira-export-description.csv"), true);
    expect(items[0]).toMatchObject({
      dueAt: local(2026, 10, 12),
      notes: "Add the new VPN steps.\nSee https://example.org/wiki/onboarding",
    });
    expect(items[2]).toMatchObject({ text: "DEMO-104 Prepare sprint review", dueAt: local(2026, 10, 2, 15) });
  });

  it("reads a semicolon CSV without header as quick-add lines", () => {
    const { items } = parseImport(sample("todos-excel-de.csv"), true);
    expect(items[2]).toMatchObject({ text: "Geschenk für Oma; Blumen", category: "privat", dueAt: null });
  });

  it("parses the text the backend produces for Excel's Windows-1252 export", () => {
    // decoded form of samples/import/todos-excel-ansi.csv (the decoding itself
    // is covered by the Rust tests for decode_text / read_import_file)
    const decoded = [
      "text;due;category;notes",
      "Budget 5 € – Q3 „final“ prüfen;next monday;finance;Zahlen aus dem Controlling…",
      "Café-Termin mit Müller ‚kurz‘;tomorrow;work;",
      "Angebot „Premium“ – 20 % Rabatt;;sales;siehe Mail vom 1.10.",
    ].join("\r\n");
    const { items, skipped } = parseImport(decoded, true);
    expect(skipped).toBe(0);
    expect(items.map((t) => t.text)).toEqual([
      "Budget 5 € – Q3 „final“ prüfen",
      "Café-Termin mit Müller ‚kurz‘",
      "Angebot „Premium“ – 20 % Rabatt",
    ]);
    expect(items[0].notes).toBe("Zahlen aus dem Controlling…");
  });

  it("rejects a CSV with an unclosed quote, naming the line", () => {
    expect(() => parseImport(sample("invalid/broken-quote.csv"), true)).toThrow(ImportError);
    expect(() => parseImport(sample("invalid/broken-quote.csv"), true)).toThrow(/quote opened in line 2/);
  });

  it("rejects content without any todo", () => {
    expect(() => parseImport("", false)).toThrow("no todos found in the file.");
    expect(() => parseImport(";;\n;;\n", true)).toThrow("no todos found in the file.");
  });
});

describe("todoKey", () => {
  it("ignores category case and treats an empty note as none", () => {
    expect(todoKey("a", "Work", null, "")).toBe(todoKey("a", "work", null, null));
    expect(todoKey("a", null, null, null)).not.toBe(todoKey("a", "work", null, null));
    expect(todoKey("a", null, "2026-10-12T10:00:00.000Z", null)).not.toBe(todoKey("a", null, null, null));
  });
});
