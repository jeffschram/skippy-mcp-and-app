import { describe, expect, it } from "vitest";
import type { AgendaItem } from "@skippy/shared";
import { buildTodaySummary } from "./todayModel";

const context = { now: 10, start: 0 };
const event = (at: number, endAt = at + 1): AgendaItem => ({
  id: String(at), source: "event", title: `Private meeting ${at}`, at, endAt,
});

describe("Today summary", () => {
  it("preserves crowded-day and overlap context without titles", () => {
    const items = [event(1, 4), event(2, 3), event(5), event(7)];
    const summary = buildTodaySummary(items, context)!;
    expect(summary).toBe("Today's schedule has 4 timed events. Some of today's timed events overlap.");
    for (const item of items) expect(summary).not.toContain(item.title);
  });

  it("hides on empty days and when no clause is useful", () => {
    expect(buildTodaySummary([], context)).toBeNull();
    expect(buildTodaySummary([{ source: "task", at: null }, { source: "recurrence", at: 1 }], context)).toBeNull();
    expect(buildTodaySummary([{ ...event(1), isAllDay: true }], context)).toBeNull();
  });

  it("reports load and overlaps even on a quiet day", () => {
    expect(buildTodaySummary([event(3, 5), event(1, 4)], context)).toBe("Today's schedule has 2 timed events. Some of today's timed events overlap.");
    expect(buildTodaySummary([event(1)], context)).toBe("Today's schedule has 1 timed event.");
  });

  it("does not infer conflicts from all-day entries, recurrences or invalid durations", () => {
    expect(buildTodaySummary([
      { ...event(1, 10), isAllDay: true },
      { ...event(2, 10), source: "recurrence" },
      { ...event(3), endAt: undefined },
      event(4), event(5, 5), event(6, NaN),
    ], context)).toBe("Today's schedule has 4 timed events.");
  });

  it("updates directly with the card projection after removal or rescheduling", () => {
    const items = [event(1, 4), event(2, 3), event(5), event(7)];
    expect(buildTodaySummary(items.filter(item => item.at !== 2), context)).toBe("Today's schedule has 3 timed events.");
    expect(buildTodaySummary(items.map(item => item.at === 2 ? event(4, 5) : item), context))
      .toBe("Today's schedule has 4 timed events.");
    expect(items.map(item => item.at)).toEqual([1, 2, 5, 7]);
  });

  it("summarizes mixed row kinds in fixed clause order using the shared clock", () => {
    const at = new Date(2026, 10, 8, 14, 30).getTime();
    const rows = [
      { source: "task" as const, at: -1, reviewAt: 0 },
      { source: "recurrence" as const, at },
      event(at + 1000, at + 5000), event(at + 2000, at + 4000),
      { source: "task" as const, at: -1, isWant: true, reviewAt: at + 1 },
    ];
    expect(buildTodaySummary(rows, { now: at, start: 0 })).toBe(
      "1 overdue item. Next repeat at 2:30 PM. Today's schedule has 2 timed events. Some of today's timed events overlap. 1 review due.",
    );
  });

  it("supports overdue-only days, plural counts and partial pages", () => {
    const rows = [{ source: "task" as const, at: -1 }, { source: "recurrence" as const, at: -2 }];
    expect(buildTodaySummary(rows, context)).toBe("2 overdue items.");
    expect(buildTodaySummary(rows, { ...context, partial: true })).toBe("In shown items: 2 overdue items.");
    expect(buildTodaySummary([], { ...context, partial: true })).toBeNull();
  });

  it("supports next tasks/events, stable ties, and reviews without dates", () => {
    const at = new Date(2026, 10, 8, 9).getTime();
    const ctx = { now: at, start: at };
    expect(buildTodaySummary([{ source: "task", at }], ctx)).toBe("Next task at 9:00 AM.");
    const rows = [{ source: "task" as const, at }, event(at)];
    expect(buildTodaySummary(rows, ctx)).toBe(buildTodaySummary([...rows].reverse(), ctx));
    expect(buildTodaySummary(rows, ctx)).toContain("Next event at 9:00 AM.");
    expect(buildTodaySummary([{ source: "task", reviewAt: 0 }, { source: "task", reviewAt: at }], ctx)).toBe("2 reviews due.");
  });
});
