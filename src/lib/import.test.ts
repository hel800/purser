import { beforeEach, describe, expect, it } from "vitest";
import { freezeAt } from "../test/clock";
import { ImportError, parseImport, parseImportLine, runImport } from "./import";
import { addTodo, doneTodos, markDone, openTodos, todoKey } from "./db";
import { argsOf, installIpc, type IpcCall, type IpcHandler } from "../test/ipc";
import { createDatabase, sqlHandlers } from "../test/sqlite";
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
  freezeAt(NOW);
  // "auto" would follow the machine's language; the samples are English
  settings.dateLanguage = "en";
});

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

describe("runImport", () => {
  let calls: IpcCall[];
  let confirm: boolean;

  function backend(overrides: Record<string, IpcHandler> = {}) {
    calls = installIpc({
      ...sqlHandlers(createDatabase()),
      confirm_import: () => confirm,
      ...overrides,
    });
  }

  beforeEach(() => {
    confirm = true;
    backend();
  });

  const finished = () => argsOf(calls, "import_finished");
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `todo ${i + 1}`).join("\n");

  it("acknowledges the request, imports and reports the counts", async () => {
    await runImport({ fileName: "a.txt", csv: false, content: "call bob #work\nhttps://only.example\nbuy milk" });
    expect(calls[0].cmd).toBe("import_started");
    expect(argsOf(calls, "confirm_import")).toEqual([]);
    expect((await openTodos()).map((t) => t.text).sort()).toEqual(["buy milk", "call bob"]);
    expect(finished()).toEqual([
      { fileName: "a.txt", imported: 2, skipped: 1, duplicates: 0, cancelled: false, error: null },
    ]);
  });

  it("leaves out copies of stored todos, open or done, and of earlier lines", async () => {
    await addTodo("open one", "Work", null);
    await addTodo("done one", null, null);
    await markDone((await openTodos()).find((t) => t.text === "done one")!.id);
    await runImport({
      fileName: "a.txt",
      csv: false,
      content: "open one #WORK\ndone one\nnew one\nnew one\nopen one",
    });
    expect((await openTodos()).map((t) => t.text).sort()).toEqual(["new one", "open one", "open one"]);
    expect(await doneTodos()).toHaveLength(1);
    expect(finished()[0]).toMatchObject({ imported: 2, duplicates: 3 });
  });

  it("asks before importing more than 50 todos", async () => {
    await runImport({ fileName: "big.txt", csv: false, content: lines(51) });
    expect(argsOf(calls, "confirm_import")).toEqual([{ fileName: "big.txt", count: 51 }]);
    expect(await openTodos()).toHaveLength(51);
    expect(finished()[0]).toMatchObject({ imported: 51, cancelled: false });
  });

  it("doesn't ask for exactly 50", async () => {
    await runImport({ fileName: "a.txt", csv: false, content: lines(50) });
    expect(argsOf(calls, "confirm_import")).toEqual([]);
  });

  it("imports nothing when the large import is declined", async () => {
    confirm = false;
    await runImport({ fileName: "big.txt", csv: false, content: lines(51) });
    expect(await openTodos()).toEqual([]);
    expect(finished()).toEqual([
      { fileName: "big.txt", imported: 0, skipped: 0, duplicates: 0, cancelled: true, error: null },
    ]);
  });

  it("reports a broken file and imports nothing", async () => {
    await runImport({ fileName: "bad.csv", csv: true, content: sample("invalid/broken-quote.csv") });
    expect(await openTodos()).toEqual([]);
    expect(finished()).toEqual([
      expect.objectContaining({
        fileName: "bad.csv",
        imported: 0,
        cancelled: false,
        error: expect.stringMatching(/quote opened in line 2/),
      }),
    ]);
  });

  it("reports a non-Error failure as text", async () => {
    backend({
      import_started: () => {
        throw "backend gone";
      },
    });
    await runImport({ fileName: "a.txt", csv: false, content: "a" });
    expect(finished()[0]).toMatchObject({ error: "backend gone", imported: 0 });
  });

  it("reports how many landed before an insert failed", async () => {
    const sql = sqlHandlers(createDatabase());
    let inserts = 0;
    backend({
      ...sql,
      "plugin:sql|execute": (args) => {
        if (String(args.query).startsWith("INSERT INTO todos") && ++inserts === 2) throw new Error("disk full");
        return sql["plugin:sql|execute"](args);
      },
    });
    await runImport({ fileName: "huge.txt", csv: false, content: lines(600) });
    expect(finished()[0]).toMatchObject({ imported: 500, error: "disk full" });
  });

  it("doesn't throw when the result can't be reported", async () => {
    backend({
      import_finished: () => {
        throw new Error("gone");
      },
    });
    await expect(runImport({ fileName: "a.txt", csv: false, content: "a" })).resolves.toBeUndefined();
  });
});
