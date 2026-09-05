import type { AgendaItem } from "@skippy/shared";

/* ------------------------------------------------------------------ */
/* Agenda time-group sections                                          */
/*                                                                     */
/* Turns the per-day groups from groupAgendaByDay into the four        */
/* sections the Agenda list renders: Overdue (pinned), Today,          */
/* Tomorrow, and This week (all remaining days merged). Pure so it can */
/* be tested with timezone-pinned fixtures, without React or Convex.   */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

export type AgendaSectionKey = "overdue" | "today" | "tomorrow" | "thisWeek";

export type AgendaSectionRow = {
  item: AgendaItem;
  /** Short weekday marker ("Wed") for rows in the merged This-week group. */
  dayPrefix?: string;
};

export type AgendaTimeSection = {
  key: AgendaSectionKey;
  label: string;
  items: AgendaSectionRow[];
};

function localDayKey(at: number, timeZone: string): string {
  // en-CA gives YYYY-MM-DD, matching groupAgendaByDay's dayKey format.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

function weekdayShort(dayKey: string): string {
  // dayKey is a plain calendar date; format it at UTC noon so it cannot
  // drift a day in either direction (same trick as the day headers).
  const [year = 0, month = 1, day = 1] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

/**
 * Splits day groups into pinned time sections.
 *
 * - Overdue items are pulled OUT of their day groups and pinned first,
 *   oldest first, so a missed obligation can never hide mid-list.
 * - Today and Tomorrow keep their own sections.
 * - Every other day collapses into one "This week" section; each row keeps
 *   a short weekday prefix so ordering stays legible after the merge.
 * - Empty sections are omitted entirely (no orphan headers).
 */
export function sectionAgendaDays(
  days: Array<{ dayKey: string; items: AgendaItem[] }>,
  timeZone: string,
  now: number = Date.now(),
): AgendaTimeSection[] {
  const todayKey = localDayKey(now, timeZone);
  const tomorrowKey = localDayKey(now + DAY_MS, timeZone);

  const overdue: AgendaItem[] = [];
  const today: AgendaSectionRow[] = [];
  const tomorrow: AgendaSectionRow[] = [];
  const thisWeek: AgendaSectionRow[] = [];

  // days arrive sorted by dayKey with each day's items already ordered, so
  // pushing in iteration order preserves chronology inside every section.
  for (const day of days) {
    for (const item of day.items) {
      if (item.isOverdue) {
        overdue.push(item);
      } else if (day.dayKey === todayKey) {
        today.push({ item });
      } else if (day.dayKey === tomorrowKey) {
        tomorrow.push({ item });
      } else {
        thisWeek.push({ item, dayPrefix: weekdayShort(day.dayKey) });
      }
    }
  }

  // Oldest debt first: the longest-overdue item is the most urgent.
  overdue.sort((a, b) => a.at - b.at);

  const sections: AgendaTimeSection[] = [];
  if (overdue.length > 0)
    sections.push({ key: "overdue", label: "Overdue", items: overdue.map((item) => ({ item })) });
  if (today.length > 0) sections.push({ key: "today", label: "Today", items: today });
  if (tomorrow.length > 0) sections.push({ key: "tomorrow", label: "Tomorrow", items: tomorrow });
  if (thisWeek.length > 0) sections.push({ key: "thisWeek", label: "This week", items: thisWeek });
  return sections;
}
