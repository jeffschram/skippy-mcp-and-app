import { describe, expect, it } from "vitest";
import { agendaSortKey, buildAgenda, groupAgendaByDay } from "./agenda";

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-25T12:00:00.000Z");
const FROM = Date.parse("2026-07-20T00:00:00.000Z");
const TO = Date.parse("2026-08-05T00:00:00.000Z");
const LA = "America/Los_Angeles";

const event = (overrides: Record<string, any> = {}) => ({
  _id: "evt_1",
  title: "Dentist",
  startAt: Date.parse("2026-07-28T17:00:00.000Z"),
  endAt: Date.parse("2026-07-28T18:00:00.000Z"),
  status: "confirmed",
  ...overrides,
});

const task = (overrides: Record<string, any> = {}) => ({
  _id: "task_1",
  title: "Renew registration",
  status: "todo",
  dueAt: Date.parse("2026-07-27T17:00:00.000Z"),
  ...overrides,
});

const recurrence = (overrides: Record<string, any> = {}) => ({
  _id: "rec_1",
  title: "Furnace filter",
  status: "active",
  nextDueAt: Date.parse("2026-07-29T17:00:00.000Z"),
  ...overrides,
});

describe("buildAgenda", () => {
  it("merges all three streams in chronological order", () => {
    const items = buildAgenda(
      { events: [event()], tasks: [task()], recurrences: [recurrence()] },
      FROM,
      TO,
      NOW,
    );

    expect(items.map((i) => i.source)).toEqual(["task", "event", "recurrence"]);
  });

  it("excludes cancelled events", () => {
    const items = buildAgenda({ events: [event({ status: "cancelled" })] }, FROM, TO, NOW);
    expect(items).toHaveLength(0);
  });

  it("excludes events that have ended but keeps an event in progress", () => {
    const items = buildAgenda(
      {
        events: [
          event({ _id: "past", startAt: NOW - 2 * DAY, endAt: NOW - DAY }),
          event({ _id: "ongoing", startAt: NOW - DAY, endAt: NOW + DAY }),
        ],
      },
      FROM,
      TO,
      NOW,
    );

    expect(items.map((item) => item.id)).toEqual(["ongoing"]);
  });

  it("excludes done and cancelled tasks, and undated ones", () => {
    const items = buildAgenda(
      {
        tasks: [
          task({ _id: "a", status: "done" }),
          task({ _id: "b", status: "cancelled" }),
          task({ _id: "c", dueAt: undefined }),
        ],
      },
      FROM,
      TO,
      NOW,
    );

    expect(items).toHaveLength(0);
  });

  it("respects the range on every stream", () => {
    const items = buildAgenda(
      {
        events: [event({ startAt: TO + DAY })],
        tasks: [task({ dueAt: FROM - DAY })],
        recurrences: [recurrence({ nextDueAt: TO + DAY })],
      },
      FROM,
      TO,
      NOW,
    );

    expect(items).toHaveLength(0);
  });

  it("marks past-due tasks and recurrences as overdue", () => {
    const items = buildAgenda(
      {
        tasks: [task({ dueAt: NOW - DAY })],
        recurrences: [recurrence({ nextDueAt: NOW - DAY })],
      },
      FROM,
      TO,
      NOW,
    );

    expect(items.every((item) => item.isOverdue)).toBe(true);
  });

  // The failure mode most likely to be missed: each stream looks correct alone,
  // but together they show one obligation twice.
  it("shows a spawned recurrence once, as its task", () => {
    const items = buildAgenda(
      {
        tasks: [task({ _id: "spawned", title: "Furnace filter", recurrenceId: "rec_1" })],
        recurrences: [recurrence({ _id: "rec_1", currentTaskId: "spawned" })],
      },
      FROM,
      TO,
      NOW,
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "task", id: "spawned" });
  });

  it("still suppresses a claimed recurrence when its task falls outside the range", () => {
    const items = buildAgenda(
      {
        tasks: [task({ _id: "spawned", recurrenceId: "rec_1", dueAt: FROM - 5 * DAY })],
        recurrences: [recurrence({ _id: "rec_1" })],
      },
      FROM,
      TO,
      NOW,
    );

    expect(items).toHaveLength(0);
  });

  it("shows an unspawned recurrence on its own", () => {
    const items = buildAgenda({ recurrences: [recurrence()] }, FROM, TO, NOW);
    expect(items).toMatchObject([{ source: "recurrence", id: "rec_1" }]);
  });

  it("ignores paused and retired recurrences", () => {
    const items = buildAgenda(
      {
        recurrences: [
          recurrence({ _id: "p", status: "paused" }),
          recurrence({ _id: "r", status: "retired" }),
        ],
      },
      FROM,
      TO,
      NOW,
    );

    expect(items).toHaveLength(0);
  });

  it("returns nothing for an empty range", () => {
    expect(buildAgenda({}, FROM, TO, NOW)).toEqual([]);
  });
});

describe("all-day placement", () => {
  it("sorts all-day items to the top of their day rather than as midnight meetings", () => {
    const allDay = event({
      _id: "holiday",
      title: "Holiday",
      isAllDay: true,
      startAt: Date.parse("2026-07-28T00:00:00.000Z"),
    });
    const earlyMeeting = event({
      _id: "standup",
      title: "Standup",
      startAt: Date.parse("2026-07-28T01:00:00.000Z"),
    });

    const items = buildAgenda({ events: [earlyMeeting, allDay] }, FROM, TO, NOW);
    expect(items.map((i) => i.id)).toEqual(["holiday", "standup"]);
  });

  it("does not treat an all-day event as spanning the whole day", () => {
    const allDay = event({ isAllDay: true, startAt: Date.parse("2026-07-28T00:00:00.000Z") });
    const [item] = buildAgenda({ events: [allDay] }, FROM, TO, NOW);

    // The sort key collapses to the day, but the item keeps its own bounds so
    // free-time math is not told the day is fully booked.
    expect(agendaSortKey(item!)).toBe(Date.parse("2026-07-28T00:00:00.000Z"));
    expect(item!.endAt).toBe(allDay.endAt);
  });
});

describe("groupAgendaByDay", () => {
  // 11pm Pacific is already tomorrow in UTC; grouping in UTC would file it
  // under the wrong day.
  it("resolves day boundaries in the viewer's zone", () => {
    const lateEvening = event({ startAt: Date.parse("2026-07-29T06:00:00.000Z") }); // 11pm Jul 28 PT
    const items = buildAgenda({ events: [lateEvening] }, FROM, TO, NOW);
    const grouped = groupAgendaByDay(items, LA);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.dayKey).toBe("2026-07-28");
    expect(groupAgendaByDay(items, "UTC")[0]?.dayKey).toBe("2026-07-29");
  });

  it("keeps an all-day event on its own calendar date regardless of zone", () => {
    const allDay = event({ isAllDay: true, startAt: Date.parse("2026-07-28T00:00:00.000Z") });
    const items = buildAgenda({ events: [allDay] }, FROM, TO, NOW);

    expect(groupAgendaByDay(items, LA)[0]?.dayKey).toBe("2026-07-28");
    expect(groupAgendaByDay(items, "Asia/Tokyo")[0]?.dayKey).toBe("2026-07-28");
  });

  it("returns days in chronological order", () => {
    const items = buildAgenda(
      {
        events: [
          event({ _id: "late", startAt: Date.parse("2026-08-01T17:00:00.000Z") }),
          event({ _id: "early", startAt: Date.parse("2026-07-26T17:00:00.000Z") }),
        ],
      },
      FROM,
      TO,
      NOW,
    );

    expect(groupAgendaByDay(items, LA).map((day) => day.dayKey)).toEqual([
      "2026-07-26",
      "2026-08-01",
    ]);
  });
});
