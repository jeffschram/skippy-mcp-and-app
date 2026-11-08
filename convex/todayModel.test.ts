import { describe, expect, it } from "vitest";
import type { AgendaItem } from "@skippy/shared";
import { buildTodaySummary } from "./todayModel";

const event = (at: number, endAt = at + 1): AgendaItem => ({
  id: String(at), source: "event", title: `Private meeting ${at}`, at, endAt,
});

describe("Today summary", () => {
  it("gives crowded-day context in at most two short sentences without titles", () => {
    const items = [event(1, 4), event(2, 3), event(5), event(7)];
    const summary = buildTodaySummary(items)!;
    expect(summary).toBe("Today's schedule has 4 timed events. Some of today's timed events overlap.");
    expect(summary.split(/[.!?]/).filter(Boolean)).toHaveLength(2);
    expect(summary.length).toBeLessThan(160);
    for (const item of items) expect(summary).not.toContain(item.title);
  });

  it("hides on quiet and empty days, including days with only task cards", () => {
    expect(buildTodaySummary([])).toBeNull();
    expect(buildTodaySummary([event(1), event(2)])).toBeNull();
    const tasks = Array.from({ length: 10 }, (_, at) => ({ ...event(at), source: "task" as const }));
    expect(buildTodaySummary(tasks)).toBeNull();
  });

  it("reports a meaningful exception even on a quiet day", () => {
    expect(buildTodaySummary([event(3, 5), event(1, 4)])).toBe("Some of today's timed events overlap.");
  });

  it("does not infer conflicts from all-day entries, recurrences or missing durations", () => {
    expect(buildTodaySummary([
      { ...event(1, 10), isAllDay: true },
      { ...event(2, 10), source: "recurrence" },
      { ...event(3), endAt: undefined },
      event(4), event(5, 5),
    ])).toBeNull();
  });

  it("updates directly with the card projection after removal or rescheduling", () => {
    const items = [event(1, 4), event(2, 3), event(5), event(7)];
    expect(buildTodaySummary(items.filter((item) => item.at !== 2))).toBeNull();
    expect(buildTodaySummary(items.map((item) => item.at === 2 ? event(4, 5) : item)))
      .toBe("Today's schedule has 4 timed events.");
    expect(items.map((item) => item.at)).toEqual([1, 2, 5, 7]);
  });
});
