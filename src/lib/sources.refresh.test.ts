import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The refresher talks to the backend (`invoke`) and the database; both are
// replaced so only its scheduling and error handling are under test.
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
const syncSourceItems = vi.fn();
const removeOtherSources = vi.fn();
vi.mock("./db", () => ({
  syncSourceItems: (...args: unknown[]) => syncSourceItems(...args),
  removeOtherSources: (...args: unknown[]) => removeOtherSources(...args),
}));

const { CONFIG_ERROR_ID, formatSyncTime, lockTooltip, startSourceRefresh } = await import("./sources");
const { settings } = await import("./settings.svelte");

const JIRA = { id: "jira", category: "jira", refreshMinutes: 15 };
const ITEMS = '{"items":[{"id":"XY-1","text":"XY-1 Fix login"}]}';

/** Backend answering `list_sources` with `sources` and `run_source` with `output`. */
function backend(sources: unknown[], output: () => Promise<string> | string = () => ITEMS) {
  invoke.mockImplementation(async (cmd: string) => (cmd === "list_sources" ? sources : output()));
}

const runs = () => invoke.mock.calls.filter(([cmd]) => cmd === "run_source").length;

function events() {
  return { onSynced: vi.fn(), onError: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(2026, 9, 11, 13, 0, 0));
  invoke.mockReset();
  syncSourceItems.mockReset().mockResolvedValue({ firstSync: true });
  removeOtherSources.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("startSourceRefresh", () => {
  it("runs every source at start, mirrors its items and reports the result", async () => {
    backend([JIRA]);
    const ev = events();
    const refresher = startSourceRefresh(ev);
    await vi.waitFor(() => expect(ev.onSynced).toHaveBeenCalledWith("jira", { count: 1, firstSync: true }));
    expect(removeOtherSources).toHaveBeenCalledWith(["jira"]);
    expect(syncSourceItems).toHaveBeenCalledWith("jira", "jira", [
      { id: "XY-1", text: "XY-1 Fix login", url: null, dueAt: null, notes: null },
    ]);
    refresher.stop();
  });

  it("skips sources that ran more recently than maxAgeMs", async () => {
    backend([JIRA]);
    const ev = events();
    const refresher = startSourceRefresh(ev);
    await vi.waitFor(() => expect(ev.onSynced).toHaveBeenCalledWith("jira", expect.anything()));

    vi.setSystemTime(Date.now() + 30_000);
    await refresher.refresh(60_000);
    expect(runs()).toBe(1);

    vi.setSystemTime(Date.now() + 31_000);
    await refresher.refresh(60_000);
    expect(runs()).toBe(2);

    await refresher.refresh(); // F5: always
    expect(runs()).toBe(3);
    refresher.stop();
  });

  it("runs again every refreshMinutes", async () => {
    backend([JIRA]);
    const ev = events();
    const refresher = startSourceRefresh(ev);
    await vi.waitFor(() => expect(runs()).toBe(1));
    vi.advanceTimersByTime(15 * 60_000);
    await vi.waitFor(() => expect(runs()).toBe(2));
    refresher.stop();
    vi.advanceTimersByTime(15 * 60_000);
    expect(runs()).toBe(2);
  });

  it("doesn't start a source again while it is still running", async () => {
    let finish!: (out: string) => void;
    backend([JIRA], () => new Promise<string>((resolve) => (finish = resolve)));
    const ev = events();
    const refresher = startSourceRefresh(ev);
    await vi.waitFor(() => expect(runs()).toBe(1));
    await refresher.refresh();
    expect(runs()).toBe(1);
    finish(ITEMS);
    await vi.waitFor(() => expect(ev.onSynced).toHaveBeenCalledWith("jira", expect.anything()));
    refresher.stop();
  });

  it("reports a failing source and keeps its items", async () => {
    backend([JIRA], () => Promise.reject("401 Unauthorized - check the token"));
    const ev = events();
    const refresher = startSourceRefresh(ev);
    await vi.waitFor(() => expect(ev.onError).toHaveBeenCalledWith("jira", "401 Unauthorized - check the token"));
    expect(syncSourceItems).not.toHaveBeenCalled();
    refresher.stop();
  });

  it("rejects output that isn't JSON without touching the items", async () => {
    backend([JIRA], () => "Warning: something\n{}");
    const ev = events();
    const refresher = startSourceRefresh(ev);
    await vi.waitFor(() => expect(ev.onError).toHaveBeenCalledWith("jira", "output is not valid JSON"));
    expect(syncSourceItems).not.toHaveBeenCalled();
    refresher.stop();
  });

  it("rejects a category that isn't a valid #tag before running the command", async () => {
    backend([{ ...JIRA, category: "two words" }]);
    const ev = events();
    const refresher = startSourceRefresh(ev);
    await vi.waitFor(() => expect(ev.onError).toHaveBeenCalledWith("jira", expect.stringContaining("not a valid #tag")));
    expect(runs()).toBe(0);
    refresher.stop();
  });

  it("keeps all mirrored items when sources.json can't be read", async () => {
    invoke.mockRejectedValue("sources.json: expected `,` at line 3");
    const ev = events();
    const refresher = startSourceRefresh(ev);
    await vi.waitFor(() =>
      expect(ev.onError).toHaveBeenCalledWith(CONFIG_ERROR_ID, "sources.json: expected `,` at line 3")
    );
    expect(removeOtherSources).not.toHaveBeenCalled();
    refresher.stop();
  });
});

describe("lockTooltip / formatSyncTime", () => {
  afterEach(() => {
    settings.hour24 = true;
  });

  it("names the source, the sync time and the action if there is a link", () => {
    const synced = new Date(2026, 9, 11, 12, 4).toISOString();
    expect(lockTooltip({ source_id: "jira", url: "https://x" }, synced, "open (O)")).toBe(
      "Read-only, from jira · synced 12:04 · open (O)"
    );
    expect(lockTooltip({ source_id: "jira", url: null }, undefined, "open (O)")).toBe("Read-only, from jira");
  });

  it("adds the date to a sync from another day and follows the 24-hour setting", () => {
    const now = new Date(2026, 9, 11, 13, 0);
    expect(formatSyncTime(new Date(2026, 9, 11, 17, 5).toISOString(), now)).toBe("17:05");
    expect(formatSyncTime(new Date(2026, 9, 10, 17, 5).toISOString(), now)).toMatch(/10.*17:05$/);
    settings.hour24 = false;
    expect(formatSyncTime(new Date(2026, 9, 11, 17, 5).toISOString(), now)).toMatch(/5:05\s?pm$/i);
  });
});
