import type { Category } from "./db";
import { TAG_CHARS } from "./parse";

// `#tag` completion in the quick-add input.

/** The `#tag` being typed: where its `#` is and the text after it. */
export interface TagFragment {
  start: number;
  partial: string;
}

const PARTIAL_TAG = new RegExp(`^${TAG_CHARS}*$`, "u");

/** Max. suggestions offered for a tag. */
const SUGGESTION_LIMIT = 6;

/** The `#tag` fragment that ends at the caret, or null when the caret
 *  isn't inside one. */
export function tagAtCaret(value: string, caret: number): TagFragment | null {
  const before = value.slice(0, caret);
  const hash = before.lastIndexOf("#");
  if (hash === -1) return null;
  const partial = before.slice(hash + 1);
  if (!PARTIAL_TAG.test(partial)) return null;
  return { start: hash, partial };
}

/** Categories that `partial` is the start of (case-insensitive). An exact
 *  match needs no completion: offering it would make the completion keys
 *  intercept navigation while nothing visible is suggested. */
export function tagSuggestions(categories: Category[], partial: string): Category[] {
  if (!partial) return [];
  const p = partial.toLowerCase();
  return categories
    .filter((c) => c.name.toLowerCase().startsWith(p) && c.name.toLowerCase() !== p)
    .slice(0, SUGGESTION_LIMIT);
}

/** The grayed-out rest of `pick` shown after the caret; only while the
 *  caret sits at the end of the text. */
export function tagGhost(value: string, caret: number, tag: TagFragment | null, pick: Category | undefined): string {
  if (!tag?.partial || !pick) return "";
  if (value.slice(caret).trim() !== "") return "";
  return pick.name.slice(tag.partial.length);
}

/** `value` with the tag at the caret replaced by `name` (the `#` stays), and
 *  the caret right after it. */
export function completeTag(value: string, caret: number, tag: TagFragment, name: string): { value: string; caret: number } {
  const end = tag.start + 1 + name.length;
  return { value: value.slice(0, tag.start + 1) + name + value.slice(caret), caret: end };
}
