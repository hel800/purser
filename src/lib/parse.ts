import { findDate, type DateLanguage, type FoundDate } from "./dates";
import { settings } from "./settings.svelte";

export interface ParsedTodo {
  text: string;
  category: string | null;
  dueAt: string | null; // an instant or a day, see `DAY_ONLY`
  notes: string | null;
}

/** Characters allowed in a `#tag` — the single source of truth, shared by
 *  the quick-add parser/autocomplete and category rename validation. */
export const TAG_CHARS = "[\\p{L}\\p{N}_-]";

/** True when a category name can round-trip through quick-add's `#tag` syntax. */
export function isValidCategoryName(name: string): boolean {
  return new RegExp(`^${TAG_CHARS}+$`, "u").test(name);
}

/**
 * Parse a quick-add line like "pay rent friday 5pm #finance // wire from
 * the joint account" into text, category (#tag), due date (natural language
 * in the date input language) and an optional note after a " // " separator.
 * `duePast` flags a due date that was already over when it was typed (see
 * `isPastOnEntry`), so the preview can warn about a likely typo.
 */
export function parseTodo(input: string): ParsedTodo & { duePast: boolean } {
  let { text, notes } = splitNote(input);

  let category: string | null = null;
  const tagMatch = text.match(new RegExp(`#(${TAG_CHARS}+)`, "u"));
  if (tagMatch) {
    category = tagMatch[1];
    text = (text.slice(0, tagMatch.index) + text.slice(tagMatch.index! + tagMatch[0].length)).trim();
  }

  let dueAt: string | null = null;
  let duePast = false;
  const now = new Date();
  const found = findDate(text, dateLanguage(), now);
  if (found) {
    dueAt = dueValue(found);
    duePast = isPastOnEntry(found, now);
    text = (text.slice(0, found.index) + text.slice(found.index + found.text.length))
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  return { text, category, dueAt, notes, duePast };
}

/** Split a quick-add line at its " //" note separator. */
export function splitNote(input: string): { text: string; notes: string | null } {
  const text = input.trim();
  // "//" starts the note when preceded by whitespace (or at the start of
  // the line) — inside "https://…" it follows a ":", so URLs never match.
  // No space needed after it: "call bob //agenda" works.
  const sep = text.match(/(^|\s)\/\//);
  if (!sep || sep.index === undefined) return { text, notes: null };
  return {
    text: text.slice(0, sep.index).trim(),
    notes: text.slice(sep.index + sep[0].length).trim() || null,
  };
}

/**
 * True when a due date was already over the moment it was typed — an
 * earlier day, or a time today that has passed ("today 9am" at 17:00).
 * Almost always a typo (wrong year or day in a full date), so the previews
 * warn; saving stays allowed. Decided from the parse result, not the ISO
 * string: without a typed time chrono fills in the current clock time for
 * "today" and "yesterday" and noon for other days, so only the calendar day
 * is compared then — a plain "today" is fine, "yesterday" is not.
 */
export function isPastOnEntry(found: FoundDate, now: Date): boolean {
  if (found.timeKnown) return found.date.getTime() < now.getTime();
  return new Date(found.date).setHours(0, 0, 0, 0) < new Date(now).setHours(0, 0, 0, 0);
}

/** A due date typed by hand (quick-add or the D editor), with the typo nudge. */
export function parseDueEntry(input: string): { dueAt: string; past: boolean } | null {
  const now = new Date();
  const found = findDate(input, dateLanguage(), now);
  if (!found) return null;
  return { dueAt: dueValue(found), past: isPastOnEntry(found, now) };
}

export function parseDueDate(input: string): string | null {
  return parseDueEntry(input)?.dueAt ?? null;
}

/** Language that due dates are typed in: the tray setting, or with
 *  "auto" German on a German Windows (WebView2 reports its display
 *  language) and English otherwise. */
export function dateLanguage(): DateLanguage {
  if (settings.dateLanguage === "en" || settings.dateLanguage === "de") return settings.dateLanguage;
  return navigator.language.toLowerCase().startsWith("de") ? "de" : "en";
}

/**
 * A stored due date (`due_at`) is either an instant, an ISO string like
 * "2026-10-16T15:00:00.000Z", when a time was typed, or a calendar day,
 * "2026-10-16", when none was. A day has no time: it is shown without one
 * and is overdue only once it has ended.
 */
const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The value to store for a parsed date, see `DAY_ONLY`. */
export function dueValue(found: FoundDate): string {
  return found.timeKnown ? found.date.toISOString() : localDay(found.date);
}

/** "2026-10-16" for the local calendar day of `date`. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isDayOnly(due: string): boolean {
  return DAY_ONLY.test(due);
}

/** When a due date begins: its instant, or 00:00 (local time) of its day. */
function dueStart(due: string): Date {
  const day = due.match(DAY_ONLY);
  return day ? new Date(+day[1], +day[2] - 1, +day[3]) : new Date(due);
}

/** When a due date is over: its instant, or the end of its day. */
function dueEnd(due: string): Date {
  const end = dueStart(due);
  if (isDayOnly(due)) end.setDate(end.getDate() + 1);
  return end;
}

export function formatDue(due: string | null): string {
  if (!due) return "";
  const d = dueStart(due);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  // instants at midnight are imported days from before days were stored
  // as such (Jira exports write 00:00)
  const hasTime = !isDayOnly(due) && (d.getHours() !== 0 || d.getMinutes() !== 0);
  const time = hasTime
    ? " " +
      d.toLocaleTimeString(undefined, {
        hour: settings.hour24 ? "2-digit" : "numeric",
        minute: "2-digit",
        hour12: !settings.hour24,
      })
    : "";
  return date + time;
}

/** Split note text into plain segments and clickable https?:// links. */
export function linkify(text: string): { link: boolean; value: string }[] {
  return text
    .split(/(https?:\/\/\S+)/g)
    .filter((part) => part !== "")
    .map((part) => ({ link: /^https?:\/\//.test(part), value: part }));
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export function isToday(due: string): boolean {
  return sameDay(dueStart(due), new Date());
}

/** Within the current calendar week, Monday 00:00 through Sunday 24:00. */
export function isThisWeek(due: string): boolean {
  const begins = dueStart(due).getTime();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  // getDay(): Sun=0 … Sat=6 — shift so the week starts on Monday
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = start.getTime() + 7 * 24 * 60 * 60 * 1000;
  return begins >= start.getTime() && begins < end;
}

/**
 * Urgency of a due date:
 * - "overdue" — the moment, or for a day without a time the whole day, has
 *   passed (red)
 * - "soon" — later today, or on the next working day (Mon–Fri) before 12:00;
 *   a day without a time there isn't (yellow)
 * - null — anything further out
 */
export function dueStatus(due: string | null): "overdue" | "soon" | null {
  if (!due) return null;
  const now = new Date();
  if (dueEnd(due).getTime() < now.getTime()) return "overdue";
  const begins = dueStart(due);
  if (sameDay(begins, now)) return "soon";
  const nextWorkday = new Date(now);
  do {
    nextWorkday.setDate(nextWorkday.getDate() + 1);
  } while (nextWorkday.getDay() === 0 || nextWorkday.getDay() === 6);
  if (sameDay(begins, nextWorkday) && !isDayOnly(due) && begins.getHours() < 12) return "soon";
  return null;
}
