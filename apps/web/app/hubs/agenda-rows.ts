import { areaLabel, type LifeTask } from "./life-tasks-helpers";

/* ------------------------------------------------------------------ */
/* One table for the Agenda page                                       */
/*                                                                     */
/* Tasks, calendar events, and recurring obligations merged into a      */
/* single ordered list. Type is carried by a badge rather than by which */
/* section a row sits in, so there is one place to look instead of      */
/* four.                                                               */
/*                                                                     */
/* Distinct from buildAgenda in @skippy/shared, which answers "what is  */
/* happening in this date range" for the Home summary and therefore     */
/* drops undated work. This view is the owner's whole plate, so undated */
/* obligations and wants belong in it too.                             */
/* ------------------------------------------------------------------ */

export type AgendaRowKind = "task" | "event" | "recurrence";

export type AgendaRow = {
  kind: AgendaRowKind;
  id: string;
  title: string;
  /** Sort/display date. Undated obligations and wants have none. */
  at?: number | undefined;
  isAllDay?: boolean | undefined;
  location?: string | undefined;
  area?: string | undefined;
  areaLabel?: string | undefined;
  /** Events cannot be overdue — they happen or they do not. */
  isOverdue?: boolean | undefined;
  isWant?: boolean | undefined;
  isWaiting?: boolean | undefined;
  waitingSince?: number | undefined;
  lastNudgedAt?: number | undefined;
  /** Present on recurrence rows so completing one advances its schedule. */
  recurrenceId?: string | undefined;
  /** Present on task rows spawned by a recurrence, for the badge. */
  fromRecurrence?: boolean | undefined;
  href?: string | undefined;
};

export type CalendarEventRow = {
  _id: string;
  title: string;
  startAt: number;
  endAt?: number;
  isAllDay?: boolean;
  location?: string;
  status?: string;
  htmlLink?: string;
};

export type RecurrenceRowInput = {
  _id: string;
  title: string;
  area?: string;
  status: string;
  nextDueAt: number;
  currentTaskId?: string;
  spawnTask?: boolean;
};

/**
 * Sort order for the single table.
 *
 * Dated rows come first, soonest first, so the next thing to deal with is at
 * the top. Undated obligations follow. Wants sort last unconditionally — even a
 * want that somehow carries a date must never outrank real work, which is what
 * keeps the list from reading as a backlog.
 */
export function agendaRowSortKey(row: AgendaRow): [number, number] {
  if (row.isWant) return [2, 0];
  if (typeof row.at !== "number") return [1, 0];
  return [0, row.at];
}

export function compareAgendaRows(a: AgendaRow, b: AgendaRow): number {
  const [groupA, timeA] = agendaRowSortKey(a);
  const [groupB, timeB] = agendaRowSortKey(b);
  if (groupA !== groupB) return groupA - groupB;
  if (timeA !== timeB) return timeA - timeB;
  return a.title.localeCompare(b.title);
}

/**
 * Merges the three sources into one ordered list.
 *
 * The de-duplication rule carried over from the Home agenda: a recurrence that
 * has already spawned a task is represented by that task, never by both. Each
 * source looks correct on its own, which is exactly why the double-count is
 * easy to miss.
 */
export function buildAgendaRows(
  tasks: LifeTask[] | undefined,
  events: CalendarEventRow[] | undefined,
  recurrences: RecurrenceRowInput[] | undefined,
  now: number,
): AgendaRow[] {
  const rows: AgendaRow[] = [];
  const claimedRecurrenceIds = new Set<string>();

  for (const task of tasks ?? []) {
    if (task.status === "done" || task.status === "cancelled") continue;
    if (task.recurrenceId) claimedRecurrenceIds.add(task.recurrenceId);

    const isWant = task.commitment === "want";
    rows.push({
      kind: "task",
      id: task._id,
      title: task.title,
      // Wants never carry a date, even if one was set on them somehow.
      at: isWant ? undefined : task.dueAt,
      area: task.area,
      areaLabel: task.area ? areaLabel(task.area) : undefined,
      isOverdue: !isWant && typeof task.dueAt === "number" && task.dueAt < now,
      isWant,
      isWaiting: task.status === "waiting",
      waitingSince: task.waitingSince,
      lastNudgedAt: task.lastNudgedAt,
      fromRecurrence: Boolean(task.recurrenceId),
      href: `#task-${task._id}`,
    });
  }

  for (const event of events ?? []) {
    if (event.status === "cancelled") continue;
    rows.push({
      kind: "event",
      id: event._id,
      title: event.title,
      at: event.startAt,
      isAllDay: event.isAllDay,
      location: event.location,
      href: event.htmlLink,
    });
  }

  for (const recurrence of recurrences ?? []) {
    if (recurrence.status !== "active") continue;
    // Already represented by the task it spawned.
    if (claimedRecurrenceIds.has(recurrence._id) || recurrence.currentTaskId) continue;

    rows.push({
      kind: "recurrence",
      id: recurrence._id,
      title: recurrence.title,
      at: recurrence.nextDueAt,
      area: recurrence.area,
      areaLabel: recurrence.area ? areaLabel(recurrence.area) : undefined,
      isOverdue: recurrence.nextDueAt < now,
      recurrenceId: recurrence._id,
      href: `#recurrence-${recurrence._id}`,
    });
  }

  return rows.sort(compareAgendaRows);
}

/** Areas present across the merged rows, for the filter chips. */
export function agendaAreas(rows: AgendaRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.kind === "event") continue; // events carry no area
    seen.add(row.area ?? "unsorted");
  }
  return [...seen].sort();
}

export function filterAgendaRows(rows: AgendaRow[], area: string | null): AgendaRow[] {
  if (!area) return rows;
  // Events have no area; keep them visible so filtering never hides a
  // commitment the owner cannot reschedule.
  return rows.filter((row) => row.kind === "event" || (row.area ?? "unsorted") === area);
}
