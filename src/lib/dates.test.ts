import { describe, expect, it } from "vitest";
import * as chrono from "chrono-node";
import { findDate, type DateLanguage } from "./dates";

/** Sun 27 Sep 2026 10:00, the reference date of issue #26 (TZ is pinned in vitest.config.ts). */
const REF = new Date(2026, 8, 27, 10, 0);

/** The date found in `input` as "YYYY-MM-DD HH:MM" local time, or null. */
function found(input: string, language: DateLanguage): string | null {
  const result = findDate(input, language, REF);
  if (!result) return null;
  const d = result.date;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The part of `input` that was read as the date. */
const matchedText = (input: string, language: DateLanguage) => findDate(input, language, REF)?.text;

const samples = import.meta.glob<string>("../../samples/import/*.{txt,csv}", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("German (issue #26 table)", () => {
  it.each([
    ["Mo", "2026-09-28 12:00"],
    ["Di", "2026-09-29 12:00"],
    ["Mi", "2026-09-30 12:00"],
    ["Do", "2026-10-01 12:00"],
    ["Fr", "2026-10-02 12:00"],
    ["Sa", "2026-10-03 12:00"],
    ["So", "2026-09-27 12:00"], // like English "sunday" on a Sunday: today
    ["Fr 15", "2026-10-02 15:00"],
    ["Fr 15 Uhr", "2026-10-02 15:00"],
    ["Freitag 15:00", "2026-10-02 15:00"],
    ["Freitag 1500", "2026-10-02 15:00"],
    ["heute", "2026-09-27 10:00"],
    ["morgen", "2026-09-28 10:00"],
    ["übermorgen", "2026-09-29 10:00"],
    ["nächsten Montag", "2026-09-28 12:00"],
    ["kommenden Montag", "2026-09-28 12:00"],
    ["Anfang Oktober", "2026-10-01 12:00"],
    ["Mitte Oktober", "2026-10-15 12:00"],
    ["Ende Oktober", "2026-10-31 12:00"],
    ["KW 44", "2026-10-26 12:00"],
    ["In 2 Monaten", "2026-11-27 09:00"],
    ["23.12.2026", "2026-12-23 12:00"],
    ["23.12.26", "2026-12-23 12:00"],
    ["23.12.", "2026-12-23 12:00"],
    ["20261223", "2026-12-23 12:00"],
  ])("%s -> %s", (input, expected) => {
    expect(found(input, "de")).toBe(expected);
  });

  it("takes the whole expression out of the text", () => {
    expect(matchedText("Termin kommenden Montag", "de")).toBe("kommenden Montag");
    expect(matchedText("Abgabe Freitag 1500", "de")).toBe("Freitag 1500");
    expect(matchedText("Zahnarzt am Fr", "de")).toBe("am Fr");
  });

  it("reads the German sample's due dates", () => {
    expect(found("in 2 Wochen", "de")).toBe("2026-10-11 10:00");
    expect(found("nächsten Samstag", "de")).toBe("2026-10-03 12:00");
  });
});

describe("year-less dates (inNextYearThatFits)", () => {
  it.each([
    ["23.12.", "2026-12-23 12:00"],
    ["27.09.", "2026-09-27 12:00"], // today still counts
    ["01.09.", "2027-09-01 12:00"], // passed this year
    ["Ende September", "2026-09-30 12:00"],
    ["Mitte September", "2027-09-15 12:00"],
    ["Ende Februar 2028", "2028-02-29 12:00"], // explicit year, leap day
    ["KW 39", "2026-09-21 12:00"], // the current week, until its Sunday
    ["KW 38", "2027-09-20 12:00"],
    ["KW 1", "2027-01-04 12:00"],
    ["KW44", "2026-10-26 12:00"],
    ["KW 53", "2026-12-28 12:00"],
  ])("%s -> %s", (input, expected) => {
    expect(found(input, "de")).toBe(expected);
  });

  it("finds nothing for dates that don't exist", () => {
    expect(found("29.02.", "de")).toBeNull(); // no leap year in 2026 or 2027
    expect(found("31.02.", "de")).toBeNull();
    expect(found("KW 53 2027", "de")).toBeNull();
  });
});

describe("false positives", () => {
  it.each([
    "Wir treffen uns so bald wie möglich", // lowercase "so"
    "So schnell wie möglich", // first word of a longer line
    "Mo Meeting",
    "Do the laundry",
    "Ticket 12345678", // not a valid YYYYMMDD
    "Ticket 20261340",
  ])("%s -> no date (German)", (input) => {
    expect(found(input, "de")).toBeNull();
  });

  it("keeps an abbreviation with a time or after other words", () => {
    expect(found("Fr 15 Uhr Zahnarzt", "de")).toBe("2026-10-02 15:00");
    expect(found("Zahnarzt Fr", "de")).toBe("2026-10-02 12:00");
  });

  it("doesn't read a ticket number as a compact date in English either", () => {
    expect(found("Ticket 12345678", "en")).toBeNull();
  });
});

describe("one language at a time", () => {
  it("German ignores English, including chrono-de's 5pm", () => {
    expect(found("friday 5pm", "de")).toBeNull();
  });

  it("English ignores German-only formats", () => {
    expect(found("Fr 15", "en")).toBeNull();
    expect(found("23.12.", "en")).toBeNull();
    expect(found("KW 44", "en")).toBeNull();
    // English writes 3pm; a four-digit time is not read
    expect(found("friday 1500", "en")).toBe("2026-10-02 12:00");
    expect(matchedText("friday 1500", "en")).toBe("friday");
  });

  it("both read compact ISO dates, with the language's own time", () => {
    expect(found("20261223", "en")).toBe("2026-12-23 12:00");
    expect(found("report 20261223 3pm", "en")).toBe("2026-12-23 15:00");
    expect(found("Abgabe 20261223 1500", "de")).toBe("2026-12-23 15:00");
  });
});

describe("English", () => {
  it.each([
    ["end of October", "2026-10-31 12:00"],
    ["end October", "2026-10-31 12:00"],
    ["mid October", "2026-10-15 12:00"],
    ["early October", "2026-10-01 12:00"],
    ["beginning of October", "2026-10-01 12:00"],
    ["coming Monday", "2026-09-28 12:00"],
    ["friday 5pm", "2026-10-02 17:00"],
    ["tomorrow 9am", "2026-09-28 09:00"],
    ["in 2 weeks", "2026-10-11 10:00"],
    ["next monday", "2026-09-28 12:00"],
  ])("%s -> %s", (input, expected) => {
    expect(found(input, "en")).toBe(expected);
  });

  it("reads every sample line exactly like plain chrono did before", () => {
    expect(Object.keys(samples).length).toBeGreaterThan(5);
    for (const content of Object.values(samples)) {
      for (const line of content.split(/\r?\n/).filter(Boolean)) {
        const before = chrono.en.parse(line, REF, { forwardDate: true })[0];
        const now = findDate(line, "en", REF);
        expect({ line, text: now?.text, time: now?.date.getTime() }).toEqual({
          line,
          text: before?.text,
          time: before?.date().getTime(),
        });
      }
    }
  });
});
