import * as chrono from "chrono-node";
import type { Parser, ParsingContext, ParsingResult, Refiner } from "chrono-node";

/** Language that due dates are typed in. Only one is active at a time, so
 *  German words never turn English text into a date and vice versa. */
export type DateLanguage = "en" | "de";

export interface FoundDate {
  /** position and text of the date expression within the input */
  index: number;
  text: string;
  date: Date;
}

/**
 * Finds the first date expression in `text`, e.g. "friday 5pm" (English) or
 * "Fr 15 Uhr" (German). Compact ISO dates like "20261223" work in both
 * languages. Dates lie in the future (`forwardDate`).
 */
export function findDate(text: string, language: DateLanguage, ref: Date = new Date()): FoundDate | null {
  const parser = language === "de" ? german : english;
  const [first] = parser.parse(text, ref, { forwardDate: true });
  return first ? { index: first.index, text: first.text, date: first.date() } : null;
}

// A date expression must not end inside a word or a number ("20261223x").
const NOT_BEFORE_WORD = "(?![\\p{L}\\p{N}])";

/**
 * Lets `parser` match only at the start of a word. A regex lookbehind is not
 * enough: after a failed match chrono retries on the text from the next
 * character on, where "1.02." in "31.02." would look like a fresh start.
 */
function atWordStart(parser: Parser): Parser {
  return {
    pattern: parser.pattern,
    extract: (context, match) => {
      const before = context.text.slice(0, match.index);
      return /[\p{L}\p{N}]$/u.test(before) ? null : parser.extract(context, match);
    },
  };
}

/** Tag of compact ISO results, see `keepCompactIso`. */
const COMPACT_ISO_TAG = "purser/compactIso";

/**
 * chrono's own filter drops results that are only digits, which would
 * remove a bare "20261223" again. This wrapper keeps our validated ones.
 */
function keepCompactIso(filter: Refiner): Refiner {
  return {
    refine: (context, results) => {
      const kept = filter.refine(context, results);
      return results.filter((result) => kept.includes(result) || result.tags().has(COMPACT_ISO_TAG));
    },
  };
}

/**
 * Wraps chrono's digits-only filter with `keepCompactIso`. It is found by
 * its `strictMode` field rather than its class name, which isn't exported
 * and doesn't survive minification.
 */
function letCompactIsoThrough(parser: chrono.Chrono): void {
  parser.refiners = parser.refiners.map((refiner) =>
    "strictMode" in refiner ? keepCompactIso(refiner) : refiner
  );
}

const ENGLISH_MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9,
  sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const GERMAN_MONTHS: Record<string, number> = {
  januar: 1, jan: 1, februar: 2, feb: 2, märz: 3, maerz: 3, mär: 3, april: 4, apr: 4,
  mai: 5, juni: 6, jun: 6, juli: 7, jul: 7, august: 8, aug: 8, september: 9,
  sept: 9, sep: 9, oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12,
};

// getDay() numbering: Sunday = 0 … Saturday = 6
const ENGLISH_WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const GERMAN_WEEKDAYS: Record<string, number> = {
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5,
  samstag: 6, sonnabend: 6,
};

/** Alternation of the keys, longest first so "sept" wins over "sep". */
function alternation(words: Record<string, unknown>): string {
  return Object.keys(words)
    .sort((a, b) => b.length - a.length)
    .join("|");
}

/** The date if day, month and year form a real calendar date. */
function validDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  const real = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return real ? date : null;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function components(date: Date) {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

/**
 * Compact ISO date "20261223" (both languages). Month and day are checked,
 * so ticket numbers like "12345678" stay plain text.
 */
const compactIsoParser: Parser = {
  pattern: () => new RegExp(`(\\d{4})(\\d{2})(\\d{2})${NOT_BEFORE_WORD}`, "u"),
  extract: (context, match) => {
    const date = validDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (!date) return null;
    return context.createParsingResult(match.index!, match[0], components(date)).addTag(COMPACT_ISO_TAG);
  },
};

/** German "23.12." without a year: the next 23 Dec, today included. */
const dayMonthParser: Parser = {
  // the year-less form only: "23.12.2026" and "23.12.26" are chrono's
  pattern: () => new RegExp(`(\\d{1,2})\\.(\\d{1,2})\\.(?![\\p{L}\\p{N}.])`, "u"),
  extract: (context, match) => {
    const today = startOfDay(context.refDate);
    const day = Number(match[1]);
    const month = Number(match[2]);
    for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
      const date = validDate(year, month, day);
      if (date && date >= today) return components(date);
    }
    return null;
  },
};

type MonthPart = "start" | "middle" | "end";

/**
 * "Anfang/Mitte/Ende Oktober" or "early/mid/end of October", optionally with
 * a year: the 1st, 15th or last day of the month. Without a year, the next
 * such day that isn't in the past.
 */
function monthPartParser(parts: Record<string, MonthPart>, months: Record<string, number>): Parser {
  // "end of" must be tried before "end", and may contain any whitespace
  const partWords = alternation(parts).replace(/ /g, "\\s+");
  return {
    pattern: () =>
      new RegExp(
        `(${partWords})\\s+(${alternation(months)})\\.?(?:\\s+(\\d{4}))?${NOT_BEFORE_WORD}`,
        "iu"
      ),
    extract: (context, match) => {
      const part = parts[match[1].toLowerCase().replace(/\s+/g, " ")];
      const month = months[match[2].toLowerCase()];
      const dayIn = (year: number) => {
        if (part === "start") return new Date(year, month - 1, 1);
        if (part === "middle") return new Date(year, month - 1, 15);
        return new Date(year, month, 0); // day 0 of the next month = last day
      };
      if (match[3]) return components(dayIn(Number(match[3])));
      const today = startOfDay(context.refDate);
      const thisYear = dayIn(today.getFullYear());
      return components(thisYear >= today ? thisYear : dayIn(today.getFullYear() + 1));
    },
  };
}

/**
 * "kommenden Montag" / "coming Monday": the next such weekday after today,
 * the same day "nächsten Montag" gives. Without this, chrono matches only
 * "Montag" and "kommenden" would stay in the todo text.
 */
function comingWeekdayParser(comingWords: string, weekdays: Record<string, number>): Parser {
  return {
    pattern: () =>
      new RegExp(`(?:${comingWords})\\s+(${alternation(weekdays)})${NOT_BEFORE_WORD}`, "iu"),
    extract: (context, match) => {
      const today = startOfDay(context.refDate);
      const weekday = weekdays[match[1].toLowerCase()];
      const daysAhead = (weekday - today.getDay() + 7) % 7 || 7;
      today.setDate(today.getDate() + daysAhead);
      return components(today);
    },
  };
}

/** Monday of ISO calendar week 1 — the week that contains 4 January. */
function mondayOfWeekOne(year: number): Date {
  const jan4 = new Date(year, 0, 4);
  return new Date(year, 0, 4 - ((jan4.getDay() + 6) % 7));
}

/** Monday of ISO calendar week `week`, or null if the year has no such week. */
function mondayOfIsoWeek(year: number, week: number): Date | null {
  if (week < 1) return null;
  const monday = mondayOfWeekOne(year);
  monday.setDate(monday.getDate() + (week - 1) * 7);
  // only some years have a week 53; otherwise it is already next year's week 1
  return monday < mondayOfWeekOne(year + 1) ? monday : null;
}

/**
 * German calendar week "KW 44" / "KW44", optionally with a year: its Monday.
 * Without a year, this year's week, or next year's once it has passed.
 */
const calendarWeekParser: Parser = {
  pattern: () => new RegExp(`KW\\s*(\\d{1,2})(?:\\s+(\\d{4}))?${NOT_BEFORE_WORD}`, "iu"),
  extract: (context, match) => {
    const week = Number(match[1]);
    if (match[2]) {
      const monday = mondayOfIsoWeek(Number(match[2]), week);
      return monday ? components(monday) : null;
    }
    const today = startOfDay(context.refDate);
    for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
      const monday = mondayOfIsoWeek(year, week);
      if (!monday) continue;
      const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
      if (sunday >= today) return components(monday);
    }
    return null;
  },
};

/**
 * German "Freitag 1500": a four-digit time right after a date without a
 * time. English writes "3pm", so this is German only.
 */
const compactTimeRefiner: Refiner = {
  refine: (context, results) => {
    for (const result of results) {
      if (result.start.isCertain("hour")) continue;
      const after = context.text.slice(result.index + result.text.length);
      const time = after.match(new RegExp(`^\\s+(\\d{2})(\\d{2})${NOT_BEFORE_WORD}`, "u"));
      if (!time) continue;
      const hour = Number(time[1]);
      const minute = Number(time[2]);
      if (hour > 23 || minute > 59) continue;
      result.start.assign("hour", hour);
      result.start.assign("minute", minute);
      result.text += time[0];
    }
    return results;
  },
};

/**
 * German weekday abbreviations are ordinary words too ("so bald wie
 * möglich", "So schnell es geht"). A bare one counts only when it is
 * capitalised, stands alone, and isn't the first word of a longer line.
 * With a time ("Fr 15 Uhr") it always counts.
 */
const weekdayAbbreviationFilter: Refiner = {
  refine: (context, results) => results.filter((result) => !isFalseWeekday(context, result)),
};

function isFalseWeekday(context: ParsingContext, result: ParsingResult): boolean {
  const bare = result.text.match(/^(?:am\s+)?(mo|di|mi|do|fr|sa|so)\.?$/i);
  if (!bare) return false;
  if (!/^[A-Z][a-z]$/.test(bare[1])) return true;
  const before = context.text.slice(0, result.index);
  const after = context.text.slice(result.index + result.text.length);
  if (/[\p{L}\p{N}]$/u.test(before) || /^[\p{L}\p{N}]/u.test(after)) return true;
  const startsLongerLine = before.trim() === "" && after.trim() !== "";
  return startsLongerLine;
}

/**
 * chrono's German parser also reads English "5pm". German mode understands
 * German only, so "friday 5pm" must not turn into "today 17:00".
 */
const englishMeridiemFilter: Refiner = {
  refine: (_context, results) =>
    results.filter((result) => !/\d\s*[ap]\.?m\.?(?![\p{L}\p{N}])/iu.test(result.text)),
};

function buildEnglish(): chrono.Chrono {
  const parser = chrono.en.casual.clone();
  parser.parsers.push(
    ...[
      compactIsoParser,
      monthPartParser(
        {
          early: "start",
          "beginning of": "start",
          "start of": "start",
          mid: "middle",
          "middle of": "middle",
          "end of": "end",
          end: "end",
        },
        ENGLISH_MONTHS
      ),
      comingWeekdayParser("coming", ENGLISH_WEEKDAYS),
    ].map(atWordStart)
  );
  letCompactIsoThrough(parser);
  return parser;
}

function buildGerman(): chrono.Chrono {
  const parser = chrono.de.casual.clone();
  parser.parsers.push(
    ...[
      compactIsoParser,
      dayMonthParser,
      calendarWeekParser,
      monthPartParser({ anfang: "start", mitte: "middle", ende: "end" }, GERMAN_MONTHS),
      comingWeekdayParser("kommende[nrs]?", GERMAN_WEEKDAYS),
    ].map(atWordStart)
  );
  letCompactIsoThrough(parser);
  parser.refiners.push(englishMeridiemFilter, compactTimeRefiner, weekdayAbbreviationFilter);
  return parser;
}

const english = buildEnglish();
const german = buildGerman();
