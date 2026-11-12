import { invoke } from "@tauri-apps/api/core";
import { removeOtherSources, syncSourceItems, type SourceItem } from "./db";
import { isValidCategoryName } from "./parse";
import { settings } from "./settings.svelte";

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
    // a UTF-8 byte order mark (PowerShell may write one) isn't valid JSON
    data = JSON.parse(raw.replace(/^﻿/, ""));
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

/** An ISO date-time, or a plain date (Jira's due dates), read as local noon:
 *  the time a due date typed without a time gets ("friday"), so both show and
 *  turn "soon"/"overdue" the same way. Anything else means no due date. */
function dueField(value: unknown): string | null {
  const text = textField(value);
  if (!text) return null;
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3], 12).toISOString();
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Runs one source and mirrors its items. Throws with a short message on failure. */
async function refreshSource(source: Source): Promise<SyncResult> {
  if (!isValidCategoryName(source.category)) {
    throw new Error(`category "${source.category}" is not a valid #tag name`);
  }
  const raw = await invoke<string>("run_source", { id: source.id });
  const { items, invalid } = parseSourceOutput(raw);
  if (invalid > 0) console.warn(`source ${source.id}: skipped ${invalid} items without id or text, or with a duplicate id`);
  const { firstSync } = await syncSourceItems(source.id, source.category, items);
  return { count: items.length, firstSync };
}

export interface SyncResult {
  /** Items the source returned. */
  count: number;
  /** The source never synced before: worth a one-time confirmation. */
  firstSync: boolean;
}

/** Id under which problems with `sources.json` itself are reported. */
export const CONFIG_ERROR_ID = "sources.json";

export interface SourceEvents {
  /** A source refreshed successfully; its earlier error, if any, is over. */
  onSynced: (sourceId: string, result: SyncResult) => void;
  /** A source (or `sources.json` itself, as `CONFIG_ERROR_ID`) failed. */
  onError: (sourceId: string, message: string) => void;
}

export interface SourceRefresher {
  /**
   * Re-reads `sources.json`, so edits apply without a restart, and runs
   * every source whose last run started more than `maxAgeMs` ago (0: all).
   */
  refresh: (maxAgeMs?: number) => Promise<void>;
  stop: () => void;
}

/**
 * Runs every configured source now and then every `refreshMinutes`. Opening
 * the popup and F5 call `refresh` on top of that.
 */
export function startSourceRefresh(events: SourceEvents): SourceRefresher {
  let timers: ReturnType<typeof setInterval>[] = [];
  let configKey = "";
  // when each source's last run started, successful or not, so a failing
  // source isn't retried on every popup open
  const lastRun = new Map<string, number>();
  // a slow source must not run twice at once
  const running = new Set<string>();

  async function run(source: Source) {
    if (running.has(source.id)) return;
    running.add(source.id);
    lastRun.set(source.id, Date.now());
    try {
      const result = await refreshSource(source);
      events.onSynced(source.id, result);
    } catch (e) {
      events.onError(source.id, e instanceof Error ? e.message : String(e));
    } finally {
      running.delete(source.id);
    }
  }

  /** (Re)starts the interval timers when the configuration changed. */
  function schedule(sources: Source[]) {
    const key = JSON.stringify(sources);
    if (key === configKey) return;
    configKey = key;
    timers.forEach(clearInterval);
    timers = sources.map((source) => setInterval(() => run(source), source.refreshMinutes * 60_000));
  }

  async function refresh(maxAgeMs = 0) {
    let sources: Source[];
    try {
      sources = await invoke<Source[]>("list_sources");
    } catch (e) {
      // keep the mirrored items: a typo in the file shouldn't empty the list
      events.onError(CONFIG_ERROR_ID, String(e));
      return;
    }
    events.onSynced(CONFIG_ERROR_ID, { count: 0, firstSync: false });
    schedule(sources);
    await removeOtherSources(sources.map((s) => s.id));
    const now = Date.now();
    const due = sources.filter((s) => now - (lastRun.get(s.id) ?? 0) >= maxAgeMs);
    await Promise.all(due.map(run));
  }

  refresh();
  return {
    refresh,
    stop: () => timers.forEach(clearInterval),
  };
}

/** Tooltip of a read-only todo's lock: where it's from, when that source
 *  last synced, and what clicking does (`action`, if the todo has a link). */
export function lockTooltip(
  todo: { source_id: string | null; url: string | null },
  syncedAt: string | undefined,
  action: string
): string {
  const parts = [`Read-only, from ${todo.source_id}`];
  if (syncedAt) parts.push(`synced ${formatSyncTime(syncedAt)}`);
  if (todo.url) parts.push(action);
  return parts.join(" · ");
}

/** When a source last synced: the time today ("12:04"), with the date
 *  before ("Mon, 3 Nov 12:04"). Follows the 24-hour setting like due dates. */
export function formatSyncTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString(undefined, {
    hour: settings.hour24 ? "2-digit" : "numeric",
    minute: "2-digit",
    hour12: !settings.hour24,
  });
  if (at.toDateString() === now.toDateString()) return time;
  const date = at.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return `${date} ${time}`;
}
