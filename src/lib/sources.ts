import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { removeOtherSources, syncSourceItems, type SourceItem } from "./db";
import { isValidCategoryName } from "./parse";

/** A configured data source, as `list_sources` returns it (defaults filled in). */
export interface Source {
  id: string;
  category: string;
  refreshMinutes: number;
}

export interface ParsedOutput {
  items: SourceItem[];
  /** Entries skipped for a missing id or text, or a duplicate id. */
  invalid: number;
}

/**
 * Validates a source's stdout: `{ "items": [...] }` (or the bare array),
 * each item with a string `id` and `text`, and optionally `url`, `due` and
 * `notes`. Broken items are skipped and counted rather than failing the whole
 * refresh. Output that isn't JSON at all throws, so the last good items stay.
 */
export function parseSourceOutput(raw: string): ParsedOutput {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("output is not valid JSON");
  }
  const list = Array.isArray(data) ? data : (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) throw new Error('output has no "items" list');

  const items: SourceItem[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  for (const entry of list) {
    const item = toItem(entry);
    if (!item || seen.has(item.id)) {
      invalid++;
      continue;
    }
    seen.add(item.id);
    items.push(item);
  }
  return { items, invalid };
}

function toItem(entry: unknown): SourceItem | null {
  if (typeof entry !== "object" || entry === null) return null;
  const e = entry as Record<string, unknown>;
  // numeric ids (GitHub issue numbers) are fine too
  const id = typeof e.id === "number" ? String(e.id) : textField(e.id);
  const text = textField(e.text);
  if (!id || !text) return null;
  return {
    id,
    text,
    url: linkField(e.url),
    dueAt: dueField(e.due),
    notes: textField(e.notes),
  };
}

function textField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Only web links: the url is opened with the system's default handler. */
function linkField(value: unknown): string | null {
  const url = textField(value);
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** An ISO date-time, or a plain date (Jira's due dates), read as local midnight
 *  like a due date typed without a time. Anything else means no due date. */
function dueField(value: unknown): string | null {
  const text = textField(value);
  if (!text) return null;
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]).toISOString();
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Runs one source and mirrors its items. Throws with a short message on failure. */
async function refreshSource(source: Source): Promise<void> {
  if (!isValidCategoryName(source.category)) {
    throw new Error(`category "${source.category}" is not a valid #tag name`);
  }
  const raw = await invoke<string>("run_source", { id: source.id });
  const { items, invalid } = parseSourceOutput(raw);
  if (invalid > 0) console.warn(`source ${source.id}: skipped ${invalid} items without id or text, or with a duplicate id`);
  await syncSourceItems(source.id, source.category, items);
}

export interface SourceEvents {
  /** A source refreshed successfully; its earlier error, if any, is over. */
  onSynced: (sourceId: string) => void;
  /** A source (or `sources.json` itself, as id "sources.json") failed. */
  onError: (sourceId: string, message: string) => void;
}

/**
 * Refreshes every configured source now and then every `refreshMinutes`.
 * The tray's "Refresh now" re-reads `sources.json`, so edits to it apply
 * without a restart. Returns a function that stops everything.
 */
export function startSourceRefresh(events: SourceEvents): () => void {
  let timers: ReturnType<typeof setInterval>[] = [];
  // a slow source must not run twice at once when its interval comes round
  const running = new Set<string>();

  async function run(source: Source) {
    if (running.has(source.id)) return;
    running.add(source.id);
    try {
      await refreshSource(source);
      events.onSynced(source.id);
    } catch (e) {
      events.onError(source.id, e instanceof Error ? e.message : String(e));
    } finally {
      running.delete(source.id);
    }
  }

  async function reloadSources() {
    timers.forEach(clearInterval);
    timers = [];
    let sources: Source[];
    try {
      sources = await invoke<Source[]>("list_sources");
    } catch (e) {
      // keep the mirrored items: a typo in the file shouldn't empty the list
      events.onError("sources.json", String(e));
      return;
    }
    events.onSynced("sources.json");
    await removeOtherSources(sources.map((s) => s.id));
    for (const source of sources) {
      run(source);
      timers.push(setInterval(() => run(source), source.refreshMinutes * 60_000));
    }
  }

  reloadSources();
  const unlisten = listen("purser://refresh-sources", reloadSources);
  return () => {
    timers.forEach(clearInterval);
    unlisten.then((f) => f());
  };
}
