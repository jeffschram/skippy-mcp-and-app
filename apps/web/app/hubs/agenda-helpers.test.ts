import { describe, expect, it } from "vitest";
import { groupAgendaByDay, type AgendaItem } from "@skippy/shared";
import { sectionAgendaDays } from "./agenda-helpers";

// All fixtures pin timeZone so results don't depend on the machine running
// the tests. "Now" is Thu Sep 10 2026, noon America/New_York (16:00 UTC, EDT).
const TZ = "America/New_York";
const NOW = Date.UTC(2026, 8, 10, 16);

function task(id: string, at: number, extra: Partial<AgendaItem> = {}): AgendaItem {
  return { source: "task", id, title: `Task ${id}`, at, ...extra };
}

function sections(items: AgendaItem[]) {
  return sectionAgendaDays(groupAgendaByDay(items, TZ), TZ, NOW);
}

describe("sectionAgendaDays", () => {
  it("pins overdue items first, pulled out of their day groups, oldest first", () => {
    const result = sections([
      task("morning", Date.UTC(2026, 8, 10, 12), { isOverdue: true }), // 8:00 AM EDT today
      task("earlier", Date.UTC(2026, 8, 10, 10), { isOverdue: true }), // 6:00 AM EDT today
      task("tonight", Date.UTC(2026, 8, 10, 23)), // 7:00 PM EDT today, not overdue
    ]);

    expect(result.map((s) => s.key)).toEqual(["overdue", "today"]);
    expect(result[0]!.label).toBe("Overdue");
    expect(result[0]!.items.map((r) => r.item.id)).toEqual(["earlier", "morning"]);
    // Overdue rows never carry a day prefix — they are all recent debt.
    expect(result[0]!.items.every((r) => r.dayPrefix === undefined)).toBe(true);
    expect(result[1]!.items.map((r) => r.item.id)).toEqual(["tonight"]);
  });

  it("splits today and tomorrow across the local (not UTC) day boundary", () => {
    const result = sections([
      // 11 PM EDT Sep 10 is already Sep 11 in UTC — still Today locally.
      task("late-today", Date.UTC(2026, 8, 11, 3)),
      task("tomorrow", Date.UTC(2026, 8, 11, 16)), // noon EDT Sep 11
    ]);

    expect(result.map((s) => s.key)).toEqual(["today", "tomorrow"]);
    expect(result[0]!.items.map((r) => r.item.id)).toEqual(["late-today"]);
    expect(result[1]!.label).toBe("Tomorrow");
    expect(result[1]!.items.map((r) => r.item.id)).toEqual(["tomorrow"]);
  });

  it("merges days beyond tomorrow into This week, keeping day order and weekday prefixes", () => {
    const result = sections([
      task("sun", Date.UTC(2026, 8, 13, 16)), // Sun Sep 13
      task("sat", Date.UTC(2026, 8, 12, 16)), // Sat Sep 12
    ]);

    expect(result.map((s) => s.key)).toEqual(["thisWeek"]);
    expect(result[0]!.label).toBe("This week");
    expect(result[0]!.items.map((r) => [r.item.id, r.dayPrefix])).toEqual([
      ["sat", "Sat"],
      ["sun", "Sun"],
    ]);
  });

  it("omits empty sections entirely rather than rendering orphan headers", () => {
    expect(sections([])).toEqual([]);
    const onlyTomorrow = sections([task("t", Date.UTC(2026, 8, 11, 16))]);
    expect(onlyTomorrow.map((s) => s.key)).toEqual(["tomorrow"]);
  });

  it("keeps all-day items on their stored UTC calendar date", () => {
    const result = sections([
      {
        source: "event",
        id: "allday",
        title: "Conference",
        at: Date.UTC(2026, 8, 12), // all-day Sat Sep 12 (UTC-anchored)
        isAllDay: true,
      },
    ]);

    expect(result.map((s) => s.key)).toEqual(["thisWeek"]);
    expect(result[0]!.items[0]!.dayPrefix).toBe("Sat");
  });
});
