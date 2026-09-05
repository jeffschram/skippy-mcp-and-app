/* ------------------------------------------------------------------ */
/* Agenda                                                              */
/*                                                                     */
/* Merges the three things that can occupy a day — calendar events,     */
/* tasks with a due date, and recurrences about to fire — into one      */
/* ordered list.                                                       */
/*                                                                     */
/* This is what gives Skippy a sense of time. Before it, `dueAt` had    */
/* exactly one consumer (an overdue check) and focus summaries inferred */
/* a "calendar" category by regex over their own generated prose.       */
/* ------------------------------------------------------------------ */

export type AgendaSource = "event" | "task" | "recurrence";

export type AgendaItem = {
  source: AgendaSource;
  id: string;
  title: string;
  /** Sort key. For all-day items this is the start of their day. */
  at: number;
  endAt?: number | undefined;
  isAllDay?: boolean | undefined;
  location?: string | undefined;
  area?: string | undefined;
  status?: string | undefined;
  isOverdue?: boolean | undefined;
  conferenceUrl?: string | undefined;
  href?: string | undefined;
};

export type AgendaInputs = {
  events?: Array<Record<string, any>> | undefined;
  tasks?: Array<Record<string, any>> | undefined;
  recurrences?: Array<Record<string, any>> | undefined;
};

const DAY_MS = 86_400_000;

type AgendaDedupeCandidate = {
  source: AgendaSource;
  title: string;
  at: number;
};

function normalizedAgendaTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:calendar|event|task|reminder|attend|join|go to|the|a|an|to)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Display-only duplicate detection for agenda rows.
 *
 * Calendar ingestion intentionally preserves separate records by external id,
 * because two real events can overlap. At render time we can be narrower: two
 * event-shaped rows are the same item only when their times are identical and
 * their normalized titles are equal or one merely adds a little context. A
 * recurrence is never fuzzy-matched; its explicit task linkage remains the
 * authority for that pair.
 */
export function agendaItemsAreDuplicates(
  left: AgendaDedupeCandidate,
  right: AgendaDedupeCandidate,
): boolean {
  if (left.at !== right.at) return false;
  if (left.source === "recurrence" || right.source === "recurrence") return false;
  if (left.source !== "event" && right.source !== "event") return false;

  const a = normalizedAgendaTitle(left.title);
  const b = normalizedAgendaTitle(right.title);
  if (!a || !b) return false;
  if (a === b) return true;

  const aWords = new Set(a.split(" "));
  const bWords = new Set(b.split(" "));
  const aNumbers = [...aWords].filter((word) => /^\d+$/.test(word));
  const bNumbers = [...bWords].filter((word) => /^\d+$/.test(word));
  if (aNumbers.length && bNumbers.length && !aNumbers.some((word) => bWords.has(word))) {
    return false;
  }

  let overlap = 0;
  for (const word of aWords) if (bWords.has(word)) overlap += 1;
  // One shared word is too weak ("Dentist" and "Call dentist" can be two
  // separate obligations at the same time). Exact normalized matches were
  // handled above; fuzzy matches need at least two corroborating words.
  return overlap >= 2 && overlap / Math.min(aWords.size, bWords.size) >= 0.75;
}

/** Keep one display row per item, preferring the richer calendar event row. */
export function collapseAgendaDuplicates(items: AgendaItem[]): AgendaItem[] {
  const collapsed: AgendaItem[] = [];
  for (const item of items) {
    const duplicateIndex = collapsed.findIndex((candidate) =>
      agendaItemsAreDuplicates(candidate, item),
    );
    if (duplicateIndex < 0) {
      collapsed.push(item);
    } else if (item.source === "event" && collapsed[duplicateIndex]?.source !== "event") {
      collapsed[duplicateIndex] = item;
    }
  }
  return collapsed;
}

/**
 * Sort key that places all-day items at the top of their own day rather than
 * at midnight-local, and never lets them read as a 00:00 meeting.
 *
 * All-day events are stored anchored to UTC midnight (they are floating dates
 * in Google, not instants), so the day they belong to is read in UTC.
 */
export function agendaSortKey(item: { at: number; isAllDay?: boolean | undefined }): number {
  if (!item.isAllDay) return item.at;
  return Math.floor(item.at / DAY_MS) * DAY_MS;
}

function inRange(at: number, from: number, to: number): boolean {
  return at >= from && at <= to;
}

/**
 * Builds the merged agenda.
 *
 * The subtle rule: a recurrence that has already spawned a task is represented
 * by that task. Emitting both would show one obligation twice — as a due task
 * AND as a firing recurrence — which is the failure mode most likely to be
 * missed, because each stream looks correct on its own.
 */
export function buildAgenda(
  inputs: AgendaInputs,
  from: number,
  to: number,
  now: number,
): AgendaItem[] {
  const items: AgendaItem[] = [];

  for (const event of inputs.events ?? []) {
    if (event.status === "cancelled") continue;
    if (!inRange(event.startAt, from, to)) continue;
    // An event belongs on the Agenda until it finishes, not forever after its
    // start time. Falling back to startAt keeps older/malformed mirror rows
    // from lingering when they do not carry an explicit end.
    if ((typeof event.endAt === "number" ? event.endAt : event.startAt) < now) continue;

    items.push({
      source: "event",
      id: String(event._id ?? event.externalId),
      title: event.title ?? "(no title)",
      at: event.startAt,
      endAt: event.endAt,
      isAllDay: event.isAllDay ? true : undefined,
      location: event.location,
      status: event.status,
      conferenceUrl: event.conferenceUrl,
      href: event.htmlLink,
    });
  }

  // Tasks spawned by a recurrence claim that recurrence's slot.
  const claimedRecurrenceIds = new Set<string>();

  for (const task of inputs.tasks ?? []) {
    if (task.status === "done" || task.status === "cancelled") continue;
    if (typeof task.dueAt !== "number") continue;

    if (task.recurrenceId) claimedRecurrenceIds.add(String(task.recurrenceId));
    if (!inRange(task.dueAt, from, to)) continue;

    items.push({
      source: "task",
      id: String(task._id),
      title: task.title,
      at: task.dueAt,
      area: task.area,
      status: task.status,
      isOverdue: task.dueAt < now,
      href: `/tasks#task-${task._id}`,
    });
  }

  for (const recurrence of inputs.recurrences ?? []) {
    if (recurrence.status !== "active") continue;

    const id = String(recurrence._id);
    // Already on the agenda as a task — do not double-count it.
    if (claimedRecurrenceIds.has(id)) continue;
    if (recurrence.currentTaskId) continue;
    if (!inRange(recurrence.nextDueAt, from, to)) continue;

    items.push({
      source: "recurrence",
      id,
      title: recurrence.title,
      at: recurrence.nextDueAt,
      area: recurrence.area,
      isOverdue: recurrence.nextDueAt < now,
      href: `/tasks#recurrence-${id}`,
    });
  }

  return collapseAgendaDuplicates(items).sort((a, b) => {
    const keyDelta = agendaSortKey(a) - agendaSortKey(b);
    if (keyDelta !== 0) return keyDelta;
    // Within the same slot, all-day context comes before timed commitments.
    if (Boolean(a.isAllDay) !== Boolean(b.isAllDay)) return a.isAllDay ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Groups agenda items by local calendar day.
 *
 * Day boundaries are resolved in the given zone, not UTC: an event at 11pm
 * Pacific is still today, even though it is already tomorrow in UTC.
 */
export function groupAgendaByDay(
  items: AgendaItem[],
  timeZone: string,
): Array<{ dayKey: string; items: AgendaItem[] }> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const byDay = new Map<string, AgendaItem[]>();
  for (const item of items) {
    // All-day items are stored at UTC midnight and belong to that calendar
    // date regardless of the viewing zone; shifting them would move a
    // date-only event onto the wrong day for anyone west of UTC.
    const dayKey = item.isAllDay
      ? new Date(agendaSortKey(item)).toISOString().slice(0, 10)
      : formatter.format(new Date(item.at));

    const bucket = byDay.get(dayKey);
    if (bucket) bucket.push(item);
    else byDay.set(dayKey, [item]);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, dayItems]) => ({ dayKey, items: dayItems }));
}
