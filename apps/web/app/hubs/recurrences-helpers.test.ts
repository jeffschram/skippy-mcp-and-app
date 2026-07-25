import { describe, expect, it } from "vitest";
import {
  CADENCE_PRESETS,
  bucketRecurrences,
  describeAnchor,
  describeRule,
  type RecurrenceRow,
} from "./recurrences-helpers";

const NOW = Date.parse("2026-07-25T12:00:00.000Z");
const DAY = 86_400_000;

function recurrence(overrides: Partial<RecurrenceRow> = {}): RecurrenceRow {
  return {
    _id: "rec_1",
    title: "Furnace filter",
    rule: { kind: "interval", everyDays: 90 },
    anchor: "completion",
    nextDueAt: NOW + 30 * DAY,
    status: "active",
    spawnTask: true,
    ...overrides,
  };
}

describe("describeRule", () => {
  it("describes intervals in plain language", () => {
    expect(describeRule({ kind: "interval", everyDays: 90 })).toBe("Every 90 days");
    expect(describeRule({ kind: "interval", everyDays: 1 })).toBe("Every day");
    expect(describeRule({ kind: "interval", everyDays: 7 })).toBe("Every week");
  });

  it("describes monthly rules with a correct ordinal", () => {
    expect(describeRule({ kind: "calendar", rrule: "FREQ=MONTHLY;BYMONTHDAY=1" })).toBe(
      "The 1st of each month",
    );
    expect(describeRule({ kind: "calendar", rrule: "FREQ=MONTHLY;BYMONTHDAY=2" })).toBe(
      "The 2nd of each month",
    );
    expect(describeRule({ kind: "calendar", rrule: "FREQ=MONTHLY;BYMONTHDAY=3" })).toBe(
      "The 3rd of each month",
    );
    expect(describeRule({ kind: "calendar", rrule: "FREQ=MONTHLY;BYMONTHDAY=15" })).toBe(
      "The 15th of each month",
    );
  });

  // 11th/12th/13th are the classic ordinal trap.
  it("handles the teens correctly", () => {
    expect(describeRule({ kind: "calendar", rrule: "FREQ=MONTHLY;BYMONTHDAY=11" })).toBe(
      "The 11th of each month",
    );
    expect(describeRule({ kind: "calendar", rrule: "FREQ=MONTHLY;BYMONTHDAY=13" })).toBe(
      "The 13th of each month",
    );
  });

  it("describes weekly rules", () => {
    expect(describeRule({ kind: "calendar", rrule: "FREQ=WEEKLY;BYDAY=TU" })).toBe("Every Tuesday");
    expect(describeRule({ kind: "calendar", rrule: "FREQ=WEEKLY;BYDAY=TU,FR" })).toBe(
      "Every Tuesday and Friday",
    );
    expect(describeRule({ kind: "calendar", rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU" })).toBe(
      "Every 2 weeks on Tuesday",
    );
  });

  it("describes quarterly and yearly rules", () => {
    expect(describeRule({ kind: "calendar", rrule: "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15" })).toBe(
      "Every 3 months on the 15th",
    );
    expect(describeRule({ kind: "calendar", rrule: "FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=10" })).toBe(
      "Every year on June 10th",
    );
  });

  it("falls back to the raw rule rather than rendering nothing", () => {
    expect(describeRule({ kind: "calendar", rrule: "FREQ=SECONDLY" })).toBe("FREQ=SECONDLY");
  });
});

describe("describeAnchor", () => {
  // The whole reason the anchor exists is that these behave differently.
  it("distinguishes the two behaviors without naming the field", () => {
    expect(describeAnchor("completion")).toContain("finish it");
    expect(describeAnchor("schedule")).toContain("fixed date");
    expect(describeAnchor("completion")).not.toBe(describeAnchor("schedule"));
  });
});

describe("CADENCE_PRESETS", () => {
  it("pairs each preset with the anchor its wording implies", () => {
    const byKey = Object.fromEntries(CADENCE_PRESETS.map((preset) => [preset.key, preset]));

    expect(byKey["every-n-days"]?.anchor).toBe("completion");
    expect(byKey["monthly-on-day"]?.anchor).toBe("schedule");
    expect(byKey["weekly-on-day"]?.anchor).toBe("schedule");
    expect(byKey["yearly"]?.anchor).toBe("schedule");
  });

  it("builds rules the shared parser will accept", () => {
    expect(CADENCE_PRESETS[0].build(90)).toEqual({ kind: "interval", everyDays: 90 });
    expect(CADENCE_PRESETS[1].build(15)).toEqual({
      kind: "calendar",
      rrule: "FREQ=MONTHLY;BYMONTHDAY=15",
    });
    expect(CADENCE_PRESETS[2].build(2)).toEqual({
      kind: "calendar",
      rrule: "FREQ=WEEKLY;BYDAY=TU",
    });
  });
});

describe("bucketRecurrences", () => {
  it("splits due from upcoming", () => {
    const buckets = bucketRecurrences(
      [
        recurrence({ _id: "due", nextDueAt: NOW - DAY }),
        recurrence({ _id: "later", nextDueAt: NOW + 10 * DAY }),
      ],
      NOW,
    );

    expect(buckets.due.map((r) => r._id)).toEqual(["due"]);
    expect(buckets.upcoming.map((r) => r._id)).toEqual(["later"]);
  });

  it("brings an item forward by its lead time", () => {
    const buckets = bucketRecurrences(
      [recurrence({ _id: "renewal", nextDueAt: NOW + 5 * DAY, leadTimeDays: 14 })],
      NOW,
    );

    expect(buckets.due.map((r) => r._id)).toEqual(["renewal"]);
  });

  it("prefers a server-computed surfacesAt when present", () => {
    const buckets = bucketRecurrences(
      [recurrence({ _id: "x", nextDueAt: NOW + 30 * DAY, surfacesAt: NOW - 1 })],
      NOW,
    );

    expect(buckets.due.map((r) => r._id)).toEqual(["x"]);
  });

  it("separates paused items and never marks them due", () => {
    const buckets = bucketRecurrences(
      [recurrence({ _id: "p", status: "paused", nextDueAt: NOW - 100 * DAY })],
      NOW,
    );

    expect(buckets.due).toHaveLength(0);
    expect(buckets.paused.map((r) => r._id)).toEqual(["p"]);
  });

  // Retired means lazily gone, not something to be groomed out of a list.
  it("omits retired recurrences entirely", () => {
    const buckets = bucketRecurrences([recurrence({ _id: "r", status: "retired" })], NOW);

    expect(buckets.due).toHaveLength(0);
    expect(buckets.upcoming).toHaveLength(0);
    expect(buckets.paused).toHaveLength(0);
  });

  it("orders each bucket soonest first", () => {
    const buckets = bucketRecurrences(
      [
        recurrence({ _id: "b", nextDueAt: NOW + 20 * DAY }),
        recurrence({ _id: "a", nextDueAt: NOW + 2 * DAY }),
      ],
      NOW,
    );

    expect(buckets.upcoming.map((r) => r._id)).toEqual(["a", "b"]);
  });

  it("handles an absent list", () => {
    expect(bucketRecurrences(undefined, NOW)).toEqual({ due: [], upcoming: [], paused: [] });
  });
});
