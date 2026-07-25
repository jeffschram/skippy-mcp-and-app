/* ------------------------------------------------------------------ */
/* Recurring life obligations                                          */
/*                                                                     */
/* Pure scheduling math for the `recurrences` table, kept out of Convex */
/* so it is testable without a database.                               */
/*                                                                     */
/* Everything here is timezone-explicit rather than relying on the      */
/* host's local zone. Recurrences are wall-clock things — "trash night  */
/* Tuesday at 8pm", "the 1st of the month" — so the arithmetic has to   */
/* happen in the owner's zone or DST transitions silently drift the     */
/* time of day, and month-end rules land on the wrong date.            */
/* ------------------------------------------------------------------ */

/** Completions retained per recurrence. Older entries are dropped, not archived. */
export const RECURRENCE_HISTORY_LIMIT = 24;

/** Fallback zone when a recurrence carries none. */
export const DEFAULT_RECURRENCE_TIME_ZONE = "UTC";

/** How far ahead a calendar search will look before giving up. */
const MAX_PERIOD_SCAN = 400;

export type RecurrenceRule =
  | { kind: "interval"; everyDays: number }
  | { kind: "calendar"; rrule: string };

/**
 * completion — next due measured from when the work was actually done.
 *              "Change the filter every 3 months." Finish it five weeks late
 *              and the next one moves with you.
 * schedule   — next due is a fixed calendar date, indifferent to completion.
 *              "Rent is due the 1st."
 */
export type RecurrenceAnchor = "completion" | "schedule";

export type RecurrenceStatus = "active" | "paused" | "retired";

export type RecurrenceCompletion = {
  completedAt: number;
  note?: string | undefined;
};

export type RecurrenceLike = {
  rule: RecurrenceRule;
  anchor: RecurrenceAnchor;
  nextDueAt: number;
  lastCompletedAt?: number | undefined;
  leadTimeDays?: number | undefined;
  timeZone?: string | undefined;
  status?: RecurrenceStatus | undefined;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/* ------------------------------------------------------------------ */
/* Timezone-aware calendar arithmetic                                  */
/* ------------------------------------------------------------------ */

type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Decomposes an instant into wall-clock parts in the given zone. */
export function zonedParts(timestamp: number, timeZone: string): ZonedParts {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(timestamp));
  const lookup: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      lookup[part.type] = Number(part.value);
    }
  }

  return {
    year: lookup.year ?? 1970,
    month: lookup.month ?? 1,
    day: lookup.day ?? 1,
    // Some runtimes render midnight as hour 24 even under h23.
    hour: (lookup.hour ?? 0) % 24,
    minute: lookup.minute ?? 0,
    second: lookup.second ?? 0,
  };
}

/**
 * Day of week (0 = Sunday) as observed in the given zone. Reading getUTCDay()
 * off the raw instant is wrong near midnight, where the UTC date and the local
 * date disagree.
 */
export function zonedWeekday(timestamp: number, timeZone: string): number {
  const parts = zonedParts(timestamp, timeZone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

/** Midnight-anchored Sunday of the week containing `timestamp`, in the given zone. */
function startOfZonedWeek(timestamp: number, timeZone: string): number {
  const parts = zonedParts(timestamp, timeZone);
  const weekday = zonedWeekday(timestamp, timeZone);
  return zonedTimestamp(
    { ...parts, day: parts.day - weekday, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

/** Offset (ms) that must be subtracted from a naive UTC reading to get the real instant. */
function zoneOffset(timestamp: number, timeZone: string): number {
  const parts = zonedParts(timestamp, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - timestamp;
}

/**
 * Inverse of zonedParts: builds the instant at the given wall-clock time in the
 * given zone. Resolves the offset twice because the offset depends on the
 * instant we are still solving for — the second pass settles DST boundaries.
 *
 * Out-of-range fields are normalized by Date.UTC, so day 35 rolls into the next
 * month and month 13 into the next year. Callers rely on that.
 */
export function zonedTimestamp(parts: ZonedParts, timeZone: string): number {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const firstPass = naive - zoneOffset(naive, timeZone);
  const secondOffset = zoneOffset(firstPass, timeZone);
  return naive - secondOffset;
}

/**
 * Adds calendar days, preserving wall-clock time. Deliberately not
 * `timestamp + days * DAY_MS`: across a DST boundary that shifts an 8am
 * obligation to 7am or 9am and keeps drifting on every cycle.
 */
export function addCalendarDays(timestamp: number, days: number, timeZone: string): number {
  const parts = zonedParts(timestamp, timeZone);
  return zonedTimestamp({ ...parts, day: parts.day + days }, timeZone);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/* ------------------------------------------------------------------ */
/* RRULE subset                                                        */
/* ------------------------------------------------------------------ */

export type ParsedRRule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  byDay: number[]; // 0-6, Sunday first
  byMonthDay: number | undefined;
  byMonth: number | undefined;
};

/**
 * Parses the slice of RFC 5545 that real life needs: weekly chores, monthly
 * bills, quarterly filings, annual renewals. Kept as RRULE syntax rather than a
 * bespoke format so these stay interchangeable with Google Calendar's
 * `recurrence` field.
 *
 * Throws on anything unsupported — silently ignoring an unrecognized clause
 * would schedule the obligation on the wrong day, which is worse than failing.
 */
export function parseRRule(rrule: string): ParsedRRule {
  const cleaned = rrule.trim().replace(/^RRULE:/i, "");
  if (!cleaned) {
    throw new Error("rrule is required");
  }

  const parsed: ParsedRRule = {
    freq: "MONTHLY",
    interval: 1,
    byDay: [],
    byMonthDay: undefined,
    byMonth: undefined,
  };
  let sawFreq = false;

  for (const clause of cleaned.split(";")) {
    if (!clause.trim()) continue;
    const [rawName = "", rawValue = ""] = clause.split("=");
    const name = rawName.trim().toUpperCase();
    const value = rawValue.trim().toUpperCase();

    switch (name) {
      case "FREQ": {
        if (value !== "DAILY" && value !== "WEEKLY" && value !== "MONTHLY" && value !== "YEARLY") {
          throw new Error(`unsupported RRULE FREQ: ${value}`);
        }
        parsed.freq = value;
        sawFreq = true;
        break;
      }
      case "INTERVAL": {
        const interval = Number(value);
        if (!Number.isInteger(interval) || interval < 1) {
          throw new Error(`invalid RRULE INTERVAL: ${value}`);
        }
        parsed.interval = interval;
        break;
      }
      case "BYDAY": {
        for (const token of value.split(",")) {
          const index = WEEKDAYS.indexOf(token as (typeof WEEKDAYS)[number]);
          if (index < 0) {
            throw new Error(`invalid RRULE BYDAY: ${token}`);
          }
          parsed.byDay.push(index);
        }
        parsed.byDay.sort((a, b) => a - b);
        break;
      }
      case "BYMONTHDAY": {
        const day = Number(value);
        if (!Number.isInteger(day) || day < 1 || day > 31) {
          throw new Error(`invalid RRULE BYMONTHDAY: ${value}`);
        }
        parsed.byMonthDay = day;
        break;
      }
      case "BYMONTH": {
        const month = Number(value);
        if (!Number.isInteger(month) || month < 1 || month > 12) {
          throw new Error(`invalid RRULE BYMONTH: ${value}`);
        }
        parsed.byMonth = month;
        break;
      }
      default:
        throw new Error(`unsupported RRULE clause: ${name}`);
    }
  }

  if (!sawFreq) {
    throw new Error("rrule requires FREQ");
  }
  if (parsed.freq === "WEEKLY" && parsed.byDay.length === 0) {
    throw new Error("weekly rrule requires BYDAY");
  }

  return parsed;
}

/**
 * First occurrence strictly after `after`.
 *
 * Time of day is carried from `after`'s companion `wallClockFrom` rather than
 * stored separately, so a recurrence keeps the hour it was created with.
 *
 * Month-end is clamped, not rolled: BYMONTHDAY=31 in a 30-day month lands on
 * the 30th. Rolling into the next month would silently skip a period.
 */
export function nextCalendarOccurrence(
  rrule: string,
  after: number,
  timeZone: string,
  wallClockFrom: number = after,
): number {
  const rule = parseRRule(rrule);
  const time = zonedParts(wallClockFrom, timeZone);
  const cursor = zonedParts(after, timeZone);

  const at = (year: number, month: number, day: number): number =>
    zonedTimestamp(
      { year, month, day, hour: time.hour, minute: time.minute, second: time.second },
      timeZone,
    );

  if (rule.freq === "DAILY") {
    let candidate = at(cursor.year, cursor.month, cursor.day);
    for (let step = 0; step < MAX_PERIOD_SCAN; step += 1) {
      if (candidate > after) return candidate;
      candidate = addCalendarDays(candidate, rule.interval, timeZone);
    }
    throw new Error("could not resolve next daily occurrence");
  }

  if (rule.freq === "WEEKLY") {
    // INTERVAL is measured from the week the recurrence itself sits in, not the
    // week we happen to be searching from — otherwise "every other Tuesday"
    // would land on a different fortnight depending on when it was queried.
    const anchorWeek = startOfZonedWeek(wallClockFrom, timeZone);
    let candidate = at(cursor.year, cursor.month, cursor.day);

    for (let step = 0; step < MAX_PERIOD_SCAN * 7; step += 1) {
      if (candidate > after && rule.byDay.includes(zonedWeekday(candidate, timeZone))) {
        // Weeks are 7 days ± an hour across DST, so round rather than divide.
        const weeksFromAnchor = Math.round(
          (startOfZonedWeek(candidate, timeZone) - anchorWeek) / (7 * DAY_MS),
        );
        if ((((weeksFromAnchor % rule.interval) + rule.interval) % rule.interval) === 0) {
          return candidate;
        }
      }
      candidate = addCalendarDays(candidate, 1, timeZone);
    }
    throw new Error("could not resolve next weekly occurrence");
  }

  if (rule.freq === "MONTHLY") {
    const targetDay = rule.byMonthDay ?? cursor.day;
    for (let step = 0; step < MAX_PERIOD_SCAN; step += 1) {
      const monthIndex = cursor.month - 1 + step * rule.interval;
      const year = cursor.year + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      const candidate = at(year, month, Math.min(targetDay, daysInMonth(year, month)));
      if (candidate > after) return candidate;
    }
    throw new Error("could not resolve next monthly occurrence");
  }

  const targetMonth = rule.byMonth ?? cursor.month;
  const targetDay = rule.byMonthDay ?? cursor.day;
  for (let step = 0; step < MAX_PERIOD_SCAN; step += 1) {
    const year = cursor.year + step * rule.interval;
    const candidate = at(year, targetMonth, Math.min(targetDay, daysInMonth(year, targetMonth)));
    if (candidate > after) return candidate;
  }
  throw new Error("could not resolve next yearly occurrence");
}

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

/**
 * The next due date after a completion.
 *
 * Completion-anchored recurrences measure from `completedAt`, so completing
 * early genuinely pulls the next one earlier — that is the point, not a bug.
 *
 * Schedule-anchored recurrences ignore `completedAt` and advance to the next
 * occurrence in the future. A recurrence missed for months therefore skips
 * forward once rather than firing for every period it slept through.
 */
export function computeNextDue(
  recurrence: RecurrenceLike,
  completedAt: number,
  now: number = completedAt,
): number {
  const timeZone = recurrence.timeZone ?? DEFAULT_RECURRENCE_TIME_ZONE;

  if (recurrence.anchor === "completion") {
    if (recurrence.rule.kind === "interval") {
      return addCalendarDays(completedAt, recurrence.rule.everyDays, timeZone);
    }
    return nextCalendarOccurrence(recurrence.rule.rrule, completedAt, timeZone, recurrence.nextDueAt);
  }

  // Schedule-anchored: never land in the past, and never replay missed periods.
  const searchFrom = Math.max(now, recurrence.nextDueAt);

  if (recurrence.rule.kind === "interval") {
    const everyDays = recurrence.rule.everyDays;
    let candidate = recurrence.nextDueAt;
    for (let step = 0; step < MAX_PERIOD_SCAN && candidate <= searchFrom; step += 1) {
      candidate = addCalendarDays(candidate, everyDays, timeZone);
    }
    return candidate;
  }

  return nextCalendarOccurrence(recurrence.rule.rrule, searchFrom, timeZone, recurrence.nextDueAt);
}

/** The moment a recurrence starts surfacing, accounting for its lead time. */
export function surfacesAt(recurrence: RecurrenceLike): number {
  const leadTimeDays = recurrence.leadTimeDays ?? 0;
  return recurrence.nextDueAt - leadTimeDays * DAY_MS;
}

/** Whether an active recurrence should be showing right now. */
export function isDueNow(recurrence: RecurrenceLike, now: number): boolean {
  if (recurrence.status && recurrence.status !== "active") {
    return false;
  }
  return now >= surfacesAt(recurrence);
}

/**
 * Appends a completion, newest last, dropping the oldest beyond the cap so the
 * row cannot grow without bound.
 */
export function appendCompletion(
  history: RecurrenceCompletion[] | undefined,
  entry: RecurrenceCompletion,
  limit: number = RECURRENCE_HISTORY_LIMIT,
): RecurrenceCompletion[] {
  const next = [...(history ?? []), entry].sort((a, b) => a.completedAt - b.completedAt);
  return next.length > limit ? next.slice(next.length - limit) : next;
}
