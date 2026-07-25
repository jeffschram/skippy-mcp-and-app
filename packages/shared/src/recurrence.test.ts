import { describe, expect, it } from "vitest";
import {
  RECURRENCE_HISTORY_LIMIT,
  addCalendarDays,
  appendCompletion,
  computeNextDue,
  isDueNow,
  nextCalendarOccurrence,
  parseRRule,
  surfacesAt,
  zonedParts,
  zonedTimestamp,
  zonedWeekday,
  type RecurrenceLike,
} from "./recurrence";

const LA = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Wall-clock time in a zone, as an instant. */
function at(timeZone: string, iso: string): number {
  const [date = "", time = "00:00:00"] = iso.split("T");
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  const [hour = 0, minute = 0, second = 0] = time.split(":").map(Number);
  return zonedTimestamp({ year, month, day, hour, minute, second }, timeZone);
}

/** Renders an instant back to wall-clock, for readable assertions. */
function wall(timestamp: number, timeZone: string): string {
  const p = zonedParts(timestamp, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

describe("zoned calendar arithmetic", () => {
  it("round-trips wall-clock time through an instant", () => {
    const instant = at(LA, "2026-03-15T09:30:00");
    expect(wall(instant, LA)).toBe("2026-03-15T09:30");
  });

  it("reads the weekday in the target zone, not UTC", () => {
    // 5pm Pacific on a Saturday is already Sunday in UTC.
    const saturdayEvening = at(LA, "2026-07-25T17:00:00");
    expect(zonedWeekday(saturdayEvening, LA)).toBe(6);
    expect(zonedWeekday(saturdayEvening, "UTC")).toBe(0);
  });

  it("preserves wall-clock time across a spring-forward transition", () => {
    // US DST begins 2026-03-08. A daily 8am obligation must stay 8am.
    const before = at(LA, "2026-03-07T08:00:00");
    const after = addCalendarDays(before, 1, LA);

    expect(wall(after, LA)).toBe("2026-03-08T08:00");
    // Proof it is not naive ms arithmetic: that day is only 23 hours long.
    expect(after - before).toBe(23 * 60 * 60 * 1000);
  });

  it("preserves wall-clock time across a fall-back transition", () => {
    // US DST ends 2026-11-01.
    const before = at(LA, "2026-10-31T08:00:00");
    const after = addCalendarDays(before, 2, LA);

    expect(wall(after, LA)).toBe("2026-11-02T08:00");
    expect(after - before).toBe(49 * 60 * 60 * 1000);
  });

  it("rolls overflowed day numbers into the next month", () => {
    expect(wall(zonedTimestamp({ year: 2026, month: 1, day: 35, hour: 9, minute: 0, second: 0 }, LA), LA))
      .toBe("2026-02-04T09:00");
  });
});

describe("parseRRule", () => {
  it("parses the supported subset", () => {
    expect(parseRRule("FREQ=MONTHLY;BYMONTHDAY=1")).toMatchObject({
      freq: "MONTHLY",
      interval: 1,
      byMonthDay: 1,
    });
    expect(parseRRule("RRULE:FREQ=WEEKLY;BYDAY=TU,FR")).toMatchObject({
      freq: "WEEKLY",
      byDay: [2, 5],
    });
    expect(parseRRule("FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15")).toMatchObject({
      freq: "MONTHLY",
      interval: 3,
      byMonthDay: 15,
    });
  });

  // Silently ignoring a clause would schedule the obligation on the wrong day,
  // which is worse than refusing it.
  it("rejects rather than ignores what it cannot honor", () => {
    expect(() => parseRRule("FREQ=HOURLY")).toThrow(/unsupported RRULE FREQ/);
    expect(() => parseRRule("FREQ=MONTHLY;BYSETPOS=-1")).toThrow(/unsupported RRULE clause/);
    expect(() => parseRRule("BYMONTHDAY=1")).toThrow(/requires FREQ/);
    expect(() => parseRRule("FREQ=WEEKLY")).toThrow(/requires BYDAY/);
    expect(() => parseRRule("FREQ=WEEKLY;BYDAY=XX")).toThrow(/invalid RRULE BYDAY/);
    expect(() => parseRRule("FREQ=MONTHLY;BYMONTHDAY=41")).toThrow(/invalid RRULE BYMONTHDAY/);
  });
});

describe("nextCalendarOccurrence", () => {
  it("finds the next monthly occurrence", () => {
    const from = at(LA, "2026-07-25T09:00:00");
    const next = nextCalendarOccurrence("FREQ=MONTHLY;BYMONTHDAY=1", from, LA);
    expect(wall(next, LA)).toBe("2026-08-01T09:00");
  });

  // Rolling into the next month would silently skip a period.
  it("clamps month-end rules instead of rolling them forward", () => {
    const from = at(LA, "2026-01-31T09:00:00");
    const next = nextCalendarOccurrence("FREQ=MONTHLY;BYMONTHDAY=31", from, LA);
    expect(wall(next, LA)).toBe("2026-02-28T09:00");

    const afterFeb = nextCalendarOccurrence("FREQ=MONTHLY;BYMONTHDAY=31", next, LA);
    expect(wall(afterFeb, LA)).toBe("2026-03-31T09:00");
  });

  it("handles February 29 in a leap year", () => {
    const from = at(LA, "2028-01-30T09:00:00");
    const next = nextCalendarOccurrence("FREQ=MONTHLY;BYMONTHDAY=30", from, LA);
    expect(wall(next, LA)).toBe("2028-02-29T09:00");
  });

  it("finds the next weekday occurrence", () => {
    // 2026-07-25 is a Saturday; the next Tuesday is the 28th.
    const from = at(LA, "2026-07-25T20:00:00");
    const next = nextCalendarOccurrence("FREQ=WEEKLY;BYDAY=TU", from, LA);
    expect(wall(next, LA)).toBe("2026-07-28T20:00");
  });

  it("honors multiple weekdays in order", () => {
    const from = at(LA, "2026-07-27T08:00:00"); // Monday
    const next = nextCalendarOccurrence("FREQ=WEEKLY;BYDAY=TU,FR", from, LA);
    expect(wall(next, LA)).toBe("2026-07-28T08:00");

    const following = nextCalendarOccurrence("FREQ=WEEKLY;BYDAY=TU,FR", next, LA);
    expect(wall(following, LA)).toBe("2026-07-31T08:00");
  });

  // The fortnight must not depend on when the question was asked.
  it("anchors a two-week interval to the recurrence, not the query time", () => {
    const anchor = at(LA, "2026-07-28T08:00:00"); // Tuesday
    const rule = "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU";

    const fromAnchor = nextCalendarOccurrence(rule, anchor, LA, anchor);
    expect(wall(fromAnchor, LA)).toBe("2026-08-11T08:00");

    // Asking a week later must still yield the same fortnight.
    const askedLater = nextCalendarOccurrence(rule, at(LA, "2026-08-04T12:00:00"), LA, anchor);
    expect(wall(askedLater, LA)).toBe("2026-08-11T08:00");
  });

  it("finds the next yearly occurrence", () => {
    const from = at(LA, "2026-07-25T09:00:00");
    const next = nextCalendarOccurrence("FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=10", from, LA);
    expect(wall(next, LA)).toBe("2027-06-10T09:00");
  });

  it("returns an occurrence strictly after the reference instant", () => {
    const exactlyDue = at(LA, "2026-08-01T09:00:00");
    const next = nextCalendarOccurrence("FREQ=MONTHLY;BYMONTHDAY=1", exactlyDue, LA);
    expect(wall(next, LA)).toBe("2026-09-01T09:00");
  });
});

describe("computeNextDue — completion anchored", () => {
  const filter: RecurrenceLike = {
    rule: { kind: "interval", everyDays: 90 },
    anchor: "completion",
    nextDueAt: at(LA, "2026-07-01T09:00:00"),
    timeZone: LA,
  };

  it("measures from when the work was actually done", () => {
    const completedLate = at(LA, "2026-08-05T09:00:00");
    const next = computeNextDue(filter, completedLate);
    expect(wall(next, LA)).toBe("2026-11-03T09:00");
  });

  // Completing early genuinely pulls the next one earlier. That is the point of
  // completion anchoring, not a bug to correct.
  it("pulls the next due earlier when completed early", () => {
    const early = computeNextDue(filter, at(LA, "2026-06-01T09:00:00"));
    const onTime = computeNextDue(filter, at(LA, "2026-07-01T09:00:00"));

    expect(wall(early, LA)).toBe("2026-08-30T09:00");
    expect(early).toBeLessThan(onTime);
  });

  it("keeps the wall-clock hour across a DST boundary", () => {
    const daily: RecurrenceLike = {
      rule: { kind: "interval", everyDays: 1 },
      anchor: "completion",
      nextDueAt: at(LA, "2026-03-07T08:00:00"),
      timeZone: LA,
    };
    expect(wall(computeNextDue(daily, at(LA, "2026-03-07T08:00:00")), LA)).toBe("2026-03-08T08:00");
  });
});

describe("computeNextDue — schedule anchored", () => {
  const rent: RecurrenceLike = {
    rule: { kind: "calendar", rrule: "FREQ=MONTHLY;BYMONTHDAY=1" },
    anchor: "schedule",
    nextDueAt: at(LA, "2026-08-01T09:00:00"),
    timeZone: LA,
  };

  it("ignores when the work was actually done", () => {
    const paidLate = at(LA, "2026-08-09T14:00:00");
    const next = computeNextDue(rent, paidLate, paidLate);
    expect(wall(next, LA)).toBe("2026-09-01T09:00");
  });

  // The regression that makes a neglected recurrence unusable: it fires once
  // for every period it slept through.
  it("skips forward once when missed for several periods", () => {
    const muchLater = at(LA, "2026-12-20T10:00:00");
    const next = computeNextDue(rent, muchLater, muchLater);
    expect(wall(next, LA)).toBe("2027-01-01T09:00");
  });

  it("advances interval rules without drifting into the past", () => {
    const everyTenDays: RecurrenceLike = {
      rule: { kind: "interval", everyDays: 10 },
      anchor: "schedule",
      nextDueAt: at(LA, "2026-07-01T09:00:00"),
      timeZone: LA,
    };
    const now = at(LA, "2026-08-15T09:00:00");
    const next = computeNextDue(everyTenDays, now, now);

    // Cadence from Jul 1: Jul 11, 21, 31, Aug 10, Aug 20. It stays on the
    // original grid rather than restarting ten days from "now".
    expect(next).toBeGreaterThan(now);
    expect(wall(next, LA)).toBe("2026-08-20T09:00");
  });
});

describe("isDueNow", () => {
  const base: RecurrenceLike = {
    rule: { kind: "interval", everyDays: 30 },
    anchor: "completion",
    nextDueAt: at(LA, "2026-08-01T09:00:00"),
    status: "active",
    timeZone: LA,
  };

  it("is not due before its surfacing moment", () => {
    expect(isDueNow(base, base.nextDueAt - 1)).toBe(false);
  });

  it("is due at and after its surfacing moment", () => {
    expect(isDueNow(base, base.nextDueAt)).toBe(true);
    expect(isDueNow(base, base.nextDueAt + DAY_MS)).toBe(true);
  });

  it("surfaces early by the lead time", () => {
    const withLead: RecurrenceLike = { ...base, leadTimeDays: 7 };
    expect(surfacesAt(withLead)).toBe(base.nextDueAt - 7 * DAY_MS);
    expect(isDueNow(withLead, base.nextDueAt - 3 * DAY_MS)).toBe(true);
  });

  it("never fires while paused or retired", () => {
    const late = base.nextDueAt + 365 * DAY_MS;
    expect(isDueNow({ ...base, status: "paused" }, late)).toBe(false);
    expect(isDueNow({ ...base, status: "retired" }, late)).toBe(false);
  });
});

describe("appendCompletion", () => {
  it("appends to an empty history", () => {
    expect(appendCompletion(undefined, { completedAt: 100 })).toEqual([{ completedAt: 100 }]);
  });

  it("keeps completions in chronological order when backdated", () => {
    const history = appendCompletion([{ completedAt: 200 }], { completedAt: 100 });
    expect(history.map((entry) => entry.completedAt)).toEqual([100, 200]);
  });

  it("caps growth by dropping the oldest entries", () => {
    let history = appendCompletion(undefined, { completedAt: 0 });
    for (let index = 1; index < RECURRENCE_HISTORY_LIMIT + 10; index += 1) {
      history = appendCompletion(history, { completedAt: index });
    }

    expect(history).toHaveLength(RECURRENCE_HISTORY_LIMIT);
    expect(history[history.length - 1]?.completedAt).toBe(RECURRENCE_HISTORY_LIMIT + 9);
    expect(history[0]?.completedAt).toBe(10);
  });
});
