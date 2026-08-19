import * as chrono from "chrono-node";
import { settings } from "./settings.svelte";

export interface ParsedTodo {
  text: string;
  topic: string | null;
  dueAt: string | null; // ISO string
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
 * the joint account" into text, topic (#tag), due date (natural language
 * via chrono) and an optional note after a " // " separator.
 */
export function parseTodo(input: string): ParsedTodo {
  let text = input.trim();

  // "//" starts the note when preceded by whitespace (or at the start of
  // the line) — inside "https://…" it follows a ":", so URLs never match.
  // No space needed after it: "call bob //agenda" works.
  let notes: string | null = null;
  const sep = text.match(/(^|\s)\/\//);
  if (sep && sep.index !== undefined) {
    notes = text.slice(sep.index + sep[0].length).trim() || null;
    text = text.slice(0, sep.index).trim();
  }

  let topic: string | null = null;
  const tagMatch = text.match(new RegExp(`#(${TAG_CHARS}+)`, "u"));
  if (tagMatch) {
    topic = tagMatch[1];
    text = (text.slice(0, tagMatch.index) + text.slice(tagMatch.index! + tagMatch[0].length)).trim();
  }

  let dueAt: string | null = null;
  const results = chrono.parse(text, new Date(), { forwardDate: true });
  if (results.length > 0) {
    const r = results[0];
    dueAt = r.date().toISOString();
    text = (text.slice(0, r.index) + text.slice(r.index + r.text.length))
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  return { text, topic, dueAt, notes };
}

export function parseDueDate(input: string): string | null {
  const results = chrono.parse(input, new Date(), { forwardDate: true });
  return results.length ? results[0].date().toISOString() : null;
}

export function formatDue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
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

export function isOverdue(iso: string | null): boolean {
  return iso !== null && new Date(iso).getTime() < Date.now();
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/**
 * Urgency of a due date:
 * - "overdue" — the moment has passed (red)
 * - "soon" — later today, or on the next working day (Mon–Fri) before 12:00 (yellow)
 * - null — anything further out
 */
export function dueStatus(iso: string | null): "overdue" | "soon" | null {
  if (!iso) return null;
  const due = new Date(iso);
  const now = new Date();
  if (due.getTime() < now.getTime()) return "overdue";
  if (sameDay(due, now)) return "soon";
  const nextWorkday = new Date(now);
  do {
    nextWorkday.setDate(nextWorkday.getDate() + 1);
  } while (nextWorkday.getDay() === 0 || nextWorkday.getDay() === 6);
  if (sameDay(due, nextWorkday) && due.getHours() < 12) return "soon";
  return null;
}
