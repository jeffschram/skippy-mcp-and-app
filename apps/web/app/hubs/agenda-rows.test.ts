import { describe, expect, it } from "vitest";
import {
  agendaAreas,
  buildAgendaRows,
  compareAgendaRows,
  filterAgendaRows,
  type AgendaRow,
  type CalendarEventRow,
  type RecurrenceRowInput,
} from "./agenda-rows";
import type { LifeTask } from "./life-tasks-helpers";

const NOW = Date.parse("2026-07-30T12:00:00.000Z");
const DAY = 86_400_000;

const task = (o: Partial<LifeTask> = {}): LifeTask => ({
  _id: "t1",
  title: "A task",
  status: "todo",
  commitment: "must",
  ...o,
});

const event = (o: Partial<CalendarEventRow> = {}): CalendarEventRow => ({
  _id: "e1",
  title: "An event",
  startAt: NOW + DAY,
  ...o,
});

const recurrence = (o: Partial<RecurrenceRowInput> = {}): RecurrenceRowInput => ({
  _id: "r1",
  title: "A recurrence",
  status: "active",
  nextDueAt: NOW + 2 * DAY,
  ...o,
});

describe("buildAgendaRows", () => {
  it("merges all three sources into one list", () => {
    const rows = buildAgendaRows([task()], [event()], [recurrence()], NOW);
    expect(rows.map((r) => r.kind).sort()).toEqual(["event", "recurrence", "task"]);
  });

  it("orders dated rows soonest first", () => {
    const rows = buildAgendaRows(
      [task({ _id: "late", dueAt: NOW + 10 * DAY })],
      [event({ _id: "soon", startAt: NOW + DAY })],
      [],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(["soon", "late"]);
  });

  it("places undated obligations after dated ones", () => {
    const rows = buildAgendaRows(
      [task({ _id: "undated" }), task({ _id: "dated", dueAt: NOW + 5 * DAY })],
      [],
      [],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(["dated", "undated"]);
  });

  it("drops done and cancelled tasks", () => {
    const rows = buildAgendaRows(
      [task({ _id: "a", status: "done" }), task({ _id: "b", status: "cancelled" })],
      [],
      [],
      NOW,
    );
    expect(rows).toHaveLength(0);
  });

  it("drops cancelled events but keeps confirmed ones", () => {
    const rows = buildAgendaRows(
      [],
      [event({ _id: "gone", status: "cancelled" }), event({ _id: "live" })],
      [],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(["live"]);
  });

  it("ignores paused and retired recurrences", () => {
    const rows = buildAgendaRows(
      [],
      [],
      [recurrence({ _id: "p", status: "paused" }), recurrence({ _id: "r", status: "retired" })],
      NOW,
    );
    expect(rows).toHaveLength(0);
  });

  /* --- the de-duplication rule --- */

  it("shows a spawned recurrence once, as its task", () => {
    const rows = buildAgendaRows(
      [task({ _id: "spawned", title: "Furnace filter", recurrenceId: "r1", dueAt: NOW })],
      [],
      [recurrence({ _id: "r1", currentTaskId: "spawned" })],
      NOW,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "task", id: "spawned", fromRecurrence: true });
  });

  it("suppresses a recurrence holding a live task even without the back-reference", () => {
    const rows = buildAgendaRows([], [], [recurrence({ currentTaskId: "some_task" })], NOW);
    expect(rows).toHaveLength(0);
  });

  /* --- wants keep their no-pressure treatment inside the shared table --- */

  it("sorts wants last, even against undated obligations", () => {
    const rows = buildAgendaRows(
      [
        task({ _id: "want", commitment: "want" }),
        task({ _id: "undated" }),
        task({ _id: "dated", dueAt: NOW + DAY }),
      ],
      [],
      [],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(["dated", "undated", "want"]);
  });

  it("strips any date from a want and never marks it overdue", () => {
    const rows = buildAgendaRows(
      [task({ _id: "want", commitment: "want", dueAt: NOW - 30 * DAY })],
      [],
      [],
      NOW,
    );
    expect(rows[0]?.at).toBeUndefined();
    expect(rows[0]?.isOverdue).toBe(false);
  });

  it("sorts a dated want last regardless of how early its date is", () => {
    const rows = buildAgendaRows(
      [task({ _id: "want", commitment: "want", dueAt: NOW - 90 * DAY }), task({ _id: "dated", dueAt: NOW + DAY })],
      [],
      [],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(["dated", "want"]);
  });

  /* --- overdue --- */

  it("marks overdue tasks and recurrences", () => {
    const rows = buildAgendaRows(
      [task({ _id: "t", dueAt: NOW - DAY })],
      [],
      [recurrence({ _id: "r", nextDueAt: NOW - DAY })],
      NOW,
    );
    expect(rows.every((r) => r.isOverdue)).toBe(true);
  });

  // An event in the past simply happened; calling it overdue is meaningless.
  it("never marks an event overdue", () => {
    const rows = buildAgendaRows([], [event({ startAt: NOW - 5 * DAY })], [], NOW);
    expect(rows[0]?.isOverdue).toBeUndefined();
  });

  it("carries event detail through", () => {
    const rows = buildAgendaRows(
      [],
      [event({ isAllDay: true, location: "Santa Fe, NM", htmlLink: "https://cal" })],
      [],
      NOW,
    );
    expect(rows[0]).toMatchObject({ isAllDay: true, location: "Santa Fe, NM", href: "https://cal" });
  });

  it("flags waiting tasks and keeps their provenance", () => {
    const rows = buildAgendaRows(
      [task({ status: "waiting", waitingSince: NOW - 9 * DAY, lastNudgedAt: NOW - DAY })],
      [],
      [],
      NOW,
    );
    expect(rows[0]).toMatchObject({ isWaiting: true, waitingSince: NOW - 9 * DAY });
  });

  it("handles all sources being absent", () => {
    expect(buildAgendaRows(undefined, undefined, undefined, NOW)).toEqual([]);
  });
});

describe("compareAgendaRows", () => {
  it("breaks ties by title so ordering is stable", () => {
    const a = { kind: "task", id: "a", title: "Beta", at: NOW } as AgendaRow;
    const b = { kind: "task", id: "b", title: "Alpha", at: NOW } as AgendaRow;
    expect([a, b].sort(compareAgendaRows).map((r) => r.title)).toEqual(["Alpha", "Beta"]);
  });
});

describe("area filtering", () => {
  it("lists areas present, treating absent as unsorted", () => {
    const rows = buildAgendaRows(
      [task({ _id: "a", area: "health" }), task({ _id: "b" })],
      [],
      [],
      NOW,
    );
    expect(agendaAreas(rows).sort()).toEqual(["health", "unsorted"]);
  });

  it("filters tasks by area", () => {
    const rows = buildAgendaRows(
      [task({ _id: "a", area: "health" }), task({ _id: "b", area: "errand" })],
      [],
      [],
      NOW,
    );
    expect(filterAgendaRows(rows, "health").map((r) => r.id)).toEqual(["a"]);
  });

  // Events carry no area; hiding them behind a filter would conceal a
  // commitment the owner cannot simply reschedule.
  it("keeps events visible under every area filter", () => {
    const rows = buildAgendaRows([task({ _id: "a", area: "health" })], [event({ _id: "e" })], [], NOW);
    expect(filterAgendaRows(rows, "errand").map((r) => r.id)).toEqual(["e"]);
  });

  it("returns everything when no filter is active", () => {
    const rows = buildAgendaRows([task()], [event()], [], NOW);
    expect(filterAgendaRows(rows, null)).toHaveLength(2);
  });
});
