import * as chrono from "chrono-node";
import { settings } from "./settings.svelte";

export interface ParsedTodo {
  text: string;
  topic: string | null;
  dueAt: string | null; // ISO string
}

/** Characters allowed in a `#tag` — the single source of truth, shared by
 *  the quick-add parser/autocomplete and category rename validation. */
export const TAG_CHARS = "[\\p{L}\\p{N}_-]";

/** True when a category name can round-trip through quick-add's `#tag` syntax. */
export function isValidCategoryName(name: string): boolean {
  return new RegExp(`^${TAG_CHARS}+$`, "u").test(name);
}

/**
 * Parse a quick-add line like "pay rent friday 5pm #finance" into
 * text, topic (#tag) and due date (natural language via chrono).
 */
export function parseTodo(input: string): ParsedTodo {
  let text = input.trim();

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

  return { text, topic, dueAt };
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
