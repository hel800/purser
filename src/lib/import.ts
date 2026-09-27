import { invoke } from "@tauri-apps/api/core";
import { addTodo, existingTodoKeys, todoKey } from "./db";
import { TAG_CHARS, isValidCategoryName, parseDueDate, parseTodo, splitNote, type ParsedTodo } from "./parse";

/** Payload of the backend's `purser://import` event. */
export interface ImportRequest {
  fileName: string;
  csv: boolean;
  content: string;
}

export interface ImportResult {
  items: ParsedTodo[];
  /** entries that were read but not imported (no text, bad due date, done) */
  skipped: number;
}

/** Imports above this count need an explicit confirmation. */
const CONFIRM_ABOVE = 50;

/** A problem with the file itself — nothing gets imported. */
export class ImportError extends Error {}

const URL_RE = /https?:\/\/\S+/g;
const HAS_TAG = new RegExp(`#${TAG_CHARS}+`, "u");
const TRAILING_TAG = new RegExp(`(?:^|\\s)#(${TAG_CHARS}+)$`, "u");

function joinNotes(...parts: (string | null | undefined)[]): string | null {
  return parts.map((p) => p?.trim()).filter(Boolean).join("\n") || null;
}

/**
 * One todo in quick-add syntax ("title #category next monday //a note"),
 * with two import-specific extras:
 * - URLs in the title move to the notes (links belong in notes, and chrono
 *   would otherwise read digits inside a URL as a date)
 * - a `#tag` ending the note becomes the category when the title has none,
 *   so "call bob //https://… #work" files the todo under #work
 * Returns null when no todo text remains (e.g. a line that is only a URL).
 */
export function parseImportLine(raw: string): ParsedTodo | null {
  // bullets survive copy & paste from Confluence, Word or Outlook lists
  const split = splitNote(raw.replace(/^\s*[•·]\s*/, ""));
  const urls = split.text.match(URL_RE) ?? [];
  const title = split.text.replace(URL_RE, " ").replace(/\s{2,}/g, " ").trim();

  let notes = split.notes;
  let noteTag: string | null = null;
  const trailing = notes?.match(TRAILING_TAG);
  if (notes && trailing && !HAS_TAG.test(title)) {
    noteTag = trailing[1];
    notes = notes.slice(0, trailing.index).trim();
  }

  const parsed = parseTodo(title);
  if (!parsed.text) return null;
  return {
    text: parsed.text,
    topic: parsed.topic ?? noteTag,
    dueAt: parsed.dueAt,
    notes: joinNotes(notes, ...urls),
  };
}

function parseTxt(content: string): ImportResult {
  const items: ParsedTodo[] = [];
  let skipped = 0;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const todo = parseImportLine(line);
    if (todo) items.push(todo);
    else skipped++;
  }
  return { items, skipped };
}

/** The delimiter used most often in the first line (outside quotes). */
function detectDelimiter(content: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of content) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

/** RFC 4180: quoted fields may contain the delimiter, `""` and newlines. */
function readCsv(content: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let quoteLine = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === "\n") line++;
    if (quoted) {
      if (ch === '"' && content[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      quoteLine = line;
      cell = "";
    } else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && content[i + 1] === "\n") continue;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (quoted) {
    throw new ImportError(`invalid CSV — the quote opened in line ${quoteLine} is never closed.`);
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, mär: 2, mrz: 2, apr: 3, may: 4, mai: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11, dez: 11,
};

/** Jira's export formats: "2026-Dec-17 00:00" and "17/Dec/26 12:00 AM". */
function parseJiraDate(value: string): string | null {
  let m = value.match(/^(\d{4})-(\p{L}{3})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/u);
  let year: number, month: string, day: number, hour = 0, minute = 0;
  if (m) {
    [year, month, day] = [+m[1], m[2], +m[3]];
    if (m[4]) [hour, minute] = [+m[4], +m[5]];
  } else {
    m = value.match(/^(\d{1,2})\/(\p{L}{3})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?)?/iu);
    if (!m) return parseDueDate(value);
    [day, month, year] = [+m[1], m[2], m[3].length === 2 ? 2000 + +m[3] : +m[3]];
    if (m[4]) {
      [hour, minute] = [+m[4] % (m[6] ? 12 : 24), +m[5]];
      if (m[6]?.toUpperCase() === "PM") hour += 12;
    }
  }
  const monthIndex = MONTHS[month.toLowerCase()];
  if (monthIndex === undefined) return parseDueDate(value);
  return new Date(year, monthIndex, day, hour, minute).toISOString();
}

const JIRA_DONE = new Set([
  "done", "closed", "resolved", "cancelled", "canceled", "rejected", "won't do", "completed",
]);

/** Jira export: "KEY Summary" taken literally (no date/#tag parsing), the
 *  Description (if exported) as note, done issues skipped. */
function parseJiraRows(header: string[], rows: string[][]): ImportResult {
  const col = (name: string) => header.indexOf(name);
  const [key, summary, status, due, description] = [
    col("issue key"), col("summary"), col("status"), col("due date"), col("description"),
  ];
  const items: ParsedTodo[] = [];
  let skipped = 0;
  for (const row of rows) {
    const cell = (i: number) => (i >= 0 ? row[i] ?? "" : "");
    const text = `${cell(key)} ${cell(summary)}`.trim();
    const dueAt = cell(due) ? parseJiraDate(cell(due)) : null;
    if (!cell(summary) || JIRA_DONE.has(cell(status).toLowerCase()) || (cell(due) && !dueAt)) {
      skipped++;
      continue;
    }
    items.push({ text, topic: null, dueAt, notes: cell(description) || null });
  }
  return { items, skipped };
}

/** Header row with a text column and optional due/category/notes columns;
 *  the text cell may use the full quick-add syntax, the other columns win. */
function parseHeaderRows(header: string[], rows: string[][], textCol: number): ImportResult {
  const find = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const [due, category, notes] = [
    find("due", "date", "due date"),
    find("category", "tag", "topic"),
    find("notes", "note"),
  ];
  const items: ParsedTodo[] = [];
  let skipped = 0;
  for (const row of rows) {
    const cell = (i: number) => (i >= 0 ? row[i] ?? "" : "");
    const todo = parseImportLine(cell(textCol));
    const dueAt = cell(due) ? parseDueDate(cell(due)) : undefined;
    if (!todo || dueAt === null) {
      skipped++;
      continue;
    }
    const cat = cell(category).replace(/^#/, "");
    items.push({
      text: todo.text,
      topic: cat && isValidCategoryName(cat) ? cat : todo.topic,
      dueAt: dueAt ?? todo.dueAt,
      notes: joinNotes(todo.notes, cell(notes)),
    });
  }
  return { items, skipped };
}

function parseCsv(content: string): ImportResult {
  const rows = readCsv(content, detectDelimiter(content));
  const header = rows[0].map((h) => h.toLowerCase());
  if (header.includes("issue key") && header.includes("summary")) {
    return parseJiraRows(header, rows.slice(1));
  }
  const textCol = header.findIndex((h) => ["text", "todo", "task", "title"].includes(h));
  if (textCol >= 0) return parseHeaderRows(header, rows.slice(1), textCol);
  // no header: every row is one quick-add line spread over its cells
  return parseTxt(rows.map((r) => r.filter(Boolean).join(" ")).join("\n"));
}

/** Parses the whole file up front, so a broken file imports nothing. */
export function parseImport(content: string, csv: boolean): ImportResult {
  const result = csv ? parseCsv(content) : parseTxt(content);
  if (result.items.length === 0) {
    throw new ImportError("no todos found in the file.");
  }
  return result;
}

/**
 * Handles a `purser://import` request: parse, confirm large imports, insert
 * and report back to the backend (which shows the summary). Import only
 * ever adds todos — existing todos and categories are never modified.
 */
export async function runImport({ fileName, csv, content }: ImportRequest): Promise<void> {
  let imported = 0;
  let skipped = 0;
  let duplicates = 0;
  const finish = (cancelled: boolean, error: string | null) =>
    invoke("import_finished", { fileName, imported, skipped, duplicates, cancelled, error });
  try {
    const result = parseImport(content, csv);
    skipped = result.skipped;
    // exact copies of stored todos (open or done) — or of an earlier line
    // of the same file — are left out
    const seen = await existingTodoKeys();
    const fresh = result.items.filter((t) => {
      const key = todoKey(t.text, t.topic, t.dueAt, t.notes);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    duplicates = result.items.length - fresh.length;
    if (
      fresh.length > CONFIRM_ABOVE &&
      !(await invoke<boolean>("confirm_import", { fileName, count: fresh.length }))
    ) {
      await finish(true, null);
      return;
    }
    for (const todo of fresh) {
      await addTodo(todo.text, todo.topic, todo.dueAt, todo.notes);
      imported++;
    }
    await finish(false, null);
  } catch (e) {
    await finish(false, e instanceof Error ? e.message : String(e));
  }
}
