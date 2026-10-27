import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findDate } from "./dates";
import { settings } from "./settings.svelte";
import {
  dueStatus,
  formatDue,
  isPastOnEntry,
  isThisWeek,
  isToday,
  isValidCategoryName,
  linkify,
  parseDueDate,
  parseDueEntry,
  parseTodo,
  splitNote,
} from "./parse";

/** Sun 11 Oct 2026 13:02:05, Europe/Berlin (TZ is pinned in vitest.config.ts). */
const NOW = new Date(2026, 9, 11, 13, 2, 5);

/** ISO string of a local wall-clock time, the form parse.ts stores. */
const local = (y: number, m: number, d: number, h = 0, mi = 0, s = 0) =>
  new Date(y, m - 1, d, h, mi, s).toISOString();

function freezeAt(date: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(date);
}

beforeEach(() => {
  freezeAt(NOW);
  // "auto" would follow the machine's language; these cases are English
  settings.dateLanguage = "en";
});
afterEach(() => vi.useRealTimers());

describe("test environment", () => {
  it("runs in Europe/Berlin with the clock frozen", () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-60);
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-120);
    expect(new Date().toISOString()).toBe("2026-10-11T11:02:05.000Z");
  });
});

describe("parseTodo", () => {
  it("splits text, #category, due date and note", () => {
    expect(parseTodo("pay rent friday 5pm #finance // wire from the joint account")).toEqual({
      text: "pay rent",
      category: "finance",
      dueAt: local(2026, 10, 16, 17),
      notes: "wire from the joint account",
      duePast: false,
    });
  });

  it("leaves a line without date or tag alone", () => {
    expect(parseTodo("water plants")).toEqual({
      text: "water plants",
      category: null,
      dueAt: null,
      notes: null,
      duePast: false,
    });
  });

  it("accepts unicode letters, digits, _ and - in a tag", () => {
    expect(parseTodo("Übersicht prüfen #Büro").category).toBe("Büro");
    expect(parseTodo("x #ops-team_2").category).toBe("ops-team_2");
    expect(parseTodo("x #a.b").category).toBe("a");
  });

  it("flags a due date that is already over when typed", () => {
    expect(parseTodo("call bob today 9am")).toMatchObject({ dueAt: local(2026, 10, 11, 9), duePast: true });
    expect(parseTodo("call bob yesterday").duePast).toBe(true);
    expect(parseTodo("call bob 23.12.2025").duePast).toBe(true);
    expect(parseTodo("call bob today").duePast).toBe(false);
    expect(parseTodo("call bob friday").duePast).toBe(false);
  });

  it("keeps a date without a year that just passed in the past, rolls older ones forward", () => {
    expect(parseTodo("sdfj 10 Oct")).toMatchObject({ text: "sdfj", dueAt: "2026-10-10", duePast: true });
    expect(parseTodo("x jan 1").dueAt).toBe("2027-01-01");
    expect(parseTodo("x 1 Sep").dueAt).toBe("2027-09-01");
  });

  it("reads dotted dates in the date language's order", () => {
    expect(parseTodo("x 11.10.2026").dueAt).toBe("2026-11-10");
    settings.dateLanguage = "de";
    expect(parseTodo("x 11.10.2026").dueAt).toBe("2026-10-11");
    expect(parseTodo("x 1.2.2026").dueAt).toBe("2026-02-01");
  });

  it("stores a date without a time as the day alone", () => {
    expect(parseTodo("x friday").dueAt).toBe("2026-10-16");
    expect(parseTodo("x today").dueAt).toBe("2026-10-11");
    expect(parseTodo("x in 2 weeks").dueAt).toBe("2026-10-25");
    expect(parseTodo("x friday 5pm").dueAt).toBe(local(2026, 10, 16, 17));
    expect(parseTodo("x in 2 hours").dueAt).toBe(local(2026, 10, 11, 15, 2, 5));
  });

  it("never puts last friday in the future", () => {
    expect(parseTodo("x last friday")).toMatchObject({ dueAt: "2026-10-09", duePast: true });
  });
});

describe("splitNote", () => {
  it.each([
    ["call bob //agenda", "call bob", "agenda"],
    ["call bob // agenda", "call bob", "agenda"],
    ["see https://example.org/x", "see https://example.org/x", null],
    ["call bob //", "call bob", null],
    ["//only a note", "", "only a note"],
  ])("%j", (input, text, notes) => {
    expect(splitNote(input)).toEqual({ text, notes });
  });
});

describe("isPastOnEntry", () => {
  const result = (s: string) => findDate(s, "en", NOW)!;

  it("compares the clock only when a time was typed", () => {
    expect(isPastOnEntry(result("today 9am"), NOW)).toBe(true);
    expect(isPastOnEntry(result("today"), NOW)).toBe(false);
    expect(isPastOnEntry(result("now"), NOW)).toBe(false);
    expect(isPastOnEntry(result("yesterday"), NOW)).toBe(true);
    expect(isPastOnEntry(result("friday"), NOW)).toBe(false);
  });
});

describe("parseDueEntry / parseDueDate", () => {
  it("returns null for text chrono cannot read", () => {
    expect(parseDueEntry("someday maybe")).toBeNull();
    expect(parseDueDate("someday maybe")).toBeNull();
  });

  it("returns the date and the typo nudge", () => {
    expect(parseDueEntry("tomorrow 10am")).toEqual({ dueAt: local(2026, 10, 12, 10), past: false });
    expect(parseDueEntry("today 9am")).toEqual({ dueAt: local(2026, 10, 11, 9), past: true });
    expect(parseDueDate("tomorrow 10am")).toBe(local(2026, 10, 12, 10));
  });
});

describe("formatDue", () => {
  // locale-independent assertions: the runner's ICU locale is not pinned
  afterEach(() => {
    settings.hour24 = true;
  });

  it("is empty without a date", () => {
    expect(formatDue(null)).toBe("");
  });

  it("shows a day without a time, and the year only for other years", () => {
    const s = formatDue("2026-10-16");
    expect(s).not.toMatch(/\d:\d\d/);
    expect(s).not.toContain("2026");
    expect(formatDue("2027-01-01")).toContain("2027");
  });

  it("omits the time of an instant at midnight (older imported days)", () => {
    expect(formatDue(local(2026, 10, 16))).not.toMatch(/\d:\d\d/);
  });

  it("shows the date in the date input language", () => {
    expect(formatDue("2026-10-16")).toMatch(/^Fri,? 16 Oct$/);
    settings.dateLanguage = "de";
    expect(formatDue("2026-10-16")).toMatch(/^Fr\., 16\. Okt\.$/);
  });

  it("follows the hour24 setting", () => {
    expect(formatDue(local(2026, 10, 16, 17))).toMatch(/17:00$/);
    settings.hour24 = false;
    expect(formatDue(local(2026, 10, 16, 17))).toMatch(/5:00\s?pm$/i);
  });
});

describe("linkify", () => {
  it("separates http(s) links from text", () => {
    expect(linkify("see https://example.org/a and http://b.org.")).toEqual([
      { link: false, value: "see " },
      { link: true, value: "https://example.org/a" },
      { link: false, value: " and " },
      { link: true, value: "http://b.org." },
    ]);
  });
});

describe("isValidCategoryName", () => {
  it.each([
    ["work", true],
    ["Büro", true],
    ["ops-team_2", true],
    ["two words", false],
    ["", false],
    ["#x", false],
  ])("%j -> %s", (name, ok) => {
    expect(isValidCategoryName(name)).toBe(ok);
  });
});

describe("dueStatus (now is Sunday 13:02)", () => {
  it.each([
    [null, null],
    [local(2026, 10, 11, 12), "overdue"],
    [local(2026, 10, 11, 18), "soon"],
    [local(2026, 10, 12, 9), "soon"], // next working day, before noon
    [local(2026, 10, 12, 12), null],
    [local(2026, 10, 13, 9), null],
  ])("%s -> %s", (iso, status) => {
    expect(dueStatus(iso)).toBe(status);
  });

  it("skips the weekend from a Friday", () => {
    freezeAt(new Date(2026, 9, 16, 15, 0, 0));
    expect(dueStatus(local(2026, 10, 17, 9))).toBeNull(); // Saturday
    expect(dueStatus(local(2026, 10, 19, 9))).toBe("soon"); // Monday
  });

  it("makes a day without a time overdue only once it has ended", () => {
    expect(dueStatus("2026-10-11")).toBe("soon"); // today, although past noon
    expect(dueStatus("2026-10-10")).toBe("overdue");
    expect(dueStatus("2026-10-12")).toBeNull(); // next working day, but no time before noon
    freezeAt(new Date(2026, 9, 11, 23, 59, 59));
    expect(dueStatus("2026-10-11")).toBe("soon");
    freezeAt(new Date(2026, 9, 12, 0, 0, 1));
    expect(dueStatus("2026-10-11")).toBe("overdue");
  });
});

describe("isToday / isThisWeek (Mon 5 Oct – Sun 11 Oct)", () => {
  it("compares calendar days in local time", () => {
    expect(isToday(local(2026, 10, 11, 0, 0, 1))).toBe(true);
    expect(isToday(local(2026, 10, 12))).toBe(false);
    expect(isToday("2026-10-11")).toBe(true);
    expect(isToday("2026-10-12")).toBe(false);
  });

  it("starts the week on Monday", () => {
    expect(isThisWeek(local(2026, 10, 5))).toBe(true);
    expect(isThisWeek(local(2026, 10, 4, 23, 59))).toBe(false);
    expect(isThisWeek(local(2026, 10, 11, 23, 59))).toBe(true);
    expect(isThisWeek(local(2026, 10, 12))).toBe(false);
    expect(isThisWeek("2026-10-05")).toBe(true);
    expect(isThisWeek("2026-10-11")).toBe(true);
    expect(isThisWeek("2026-10-12")).toBe(false);
  });
});
