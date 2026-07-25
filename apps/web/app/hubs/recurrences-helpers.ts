/* ------------------------------------------------------------------ */
/* Display helpers for the recurrences surface                         */
/*                                                                     */
/* The scheduling math lives in @skippy/shared; this is only about how  */
/* repeating obligations are presented and described.                  */
/* ------------------------------------------------------------------ */

export type RecurrenceRow = {
  _id: string;
  title: string;
  description?: string;
  area?: string;
  rule: { kind: "interval"; everyDays: number } | { kind: "calendar"; rrule: string };
  anchor: "completion" | "schedule";
  lastCompletedAt?: number;
  nextDueAt: number;
  leadTimeDays?: number;
  status: "active" | "paused" | "retired";
  spawnTask: boolean;
  currentTaskId?: string;
  isDue?: boolean;
  surfacesAt?: number;
};

/**
 * Plain-language presets, because `anchor` is the field most likely to be set
 * wrong and the raw enum means nothing to anyone reading it.
 *
 * The distinction only earns its place if it can be picked correctly without
 * knowing the model, so these are phrased as behavior rather than terminology.
 */
export const CADENCE_PRESETS = [
  {
    key: "every-n-days",
    label: "Every N days, counted from when I finish it",
    hint: "Maintenance: furnace filter, oil change, watering the plants.",
    anchor: "completion" as const,
    build: (everyDays: number) => ({ kind: "interval" as const, everyDays }),
    needsDays: true,
  },
  {
    key: "monthly-on-day",
    label: "On a set day each month, whatever I do",
    hint: "Bills and dues: rent on the 1st, card payment on the 15th.",
    anchor: "schedule" as const,
    build: (day: number) => ({ kind: "calendar" as const, rrule: `FREQ=MONTHLY;BYMONTHDAY=${day}` }),
    needsDays: true,
  },
  {
    key: "weekly-on-day",
    label: "On a set weekday, whatever I do",
    hint: "Rhythms: trash night, weekly review.",
    anchor: "schedule" as const,
    build: (weekday: number) => ({
      kind: "calendar" as const,
      rrule: `FREQ=WEEKLY;BYDAY=${["SU", "MO", "TU", "WE", "TH", "FR", "SA"][weekday] ?? "MO"}`,
    }),
    needsDays: true,
  },
  {
    key: "yearly",
    label: "Once a year on the same date",
    hint: "Renewals: registration, physical, domain.",
    anchor: "schedule" as const,
    build: (_: number, at?: Date) => ({
      kind: "calendar" as const,
      rrule: `FREQ=YEARLY;BYMONTH=${(at?.getMonth() ?? 0) + 1};BYMONTHDAY=${at?.getDate() ?? 1}`,
    }),
    needsDays: false,
  },
] as const;

export type CadencePresetKey = (typeof CADENCE_PRESETS)[number]["key"];

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ordinal(day: number): string {
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/** Human sentence for a rule, e.g. "Every 90 days" or "The 1st of each month". */
export function describeRule(rule: RecurrenceRow["rule"]): string {
  if (rule.kind === "interval") {
    if (rule.everyDays === 1) return "Every day";
    if (rule.everyDays === 7) return "Every week";
    return `Every ${rule.everyDays} days`;
  }

  const clauses = new Map<string, string>();
  for (const clause of rule.rrule.replace(/^RRULE:/i, "").split(";")) {
    const [name = "", value = ""] = clause.split("=");
    clauses.set(name.trim().toUpperCase(), value.trim().toUpperCase());
  }

  const freq = clauses.get("FREQ");
  const interval = Number(clauses.get("INTERVAL") ?? 1);

  if (freq === "WEEKLY") {
    const days = (clauses.get("BYDAY") ?? "")
      .split(",")
      .map((token) => WEEKDAY_NAMES[["SU", "MO", "TU", "WE", "TH", "FR", "SA"].indexOf(token)])
      .filter(Boolean);
    const label = days.length ? days.join(" and ") : "week";
    return interval > 1 ? `Every ${interval} weeks on ${label}` : `Every ${label}`;
  }

  if (freq === "MONTHLY") {
    const day = Number(clauses.get("BYMONTHDAY") ?? 1);
    const base = `the ${ordinal(day)}`;
    return interval > 1 ? `Every ${interval} months on ${base}` : `The ${ordinal(day)} of each month`;
  }

  if (freq === "YEARLY") {
    const month = Number(clauses.get("BYMONTH") ?? 1);
    const day = Number(clauses.get("BYMONTHDAY") ?? 1);
    const monthName = new Date(Date.UTC(2000, month - 1, 1)).toLocaleString("en-US", {
      month: "long",
      timeZone: "UTC",
    });
    return `Every year on ${monthName} ${ordinal(day)}`;
  }

  if (freq === "DAILY") {
    return interval > 1 ? `Every ${interval} days` : "Every day";
  }

  return rule.rrule;
}

/**
 * How the schedule responds to completion, in the owner's terms rather than
 * the field name.
 */
export function describeAnchor(anchor: RecurrenceRow["anchor"]): string {
  return anchor === "completion"
    ? "counted from when you finish it"
    : "on a fixed date, however late you are";
}

export type RecurrenceBuckets = {
  due: RecurrenceRow[];
  upcoming: RecurrenceRow[];
  paused: RecurrenceRow[];
};

/**
 * Splits recurrences for display. Retired ones are omitted entirely rather than
 * given a section: they are lazily gone, not something to clean up.
 */
export function bucketRecurrences(
  rows: RecurrenceRow[] | undefined,
  now: number,
): RecurrenceBuckets {
  const buckets: RecurrenceBuckets = { due: [], upcoming: [], paused: [] };

  for (const row of rows ?? []) {
    if (row.status === "retired") continue;
    if (row.status === "paused") {
      buckets.paused.push(row);
      continue;
    }

    const surfaces = row.surfacesAt ?? row.nextDueAt - (row.leadTimeDays ?? 0) * 86_400_000;
    if (now >= surfaces) buckets.due.push(row);
    else buckets.upcoming.push(row);
  }

  buckets.due.sort((a, b) => a.nextDueAt - b.nextDueAt);
  buckets.upcoming.sort((a, b) => a.nextDueAt - b.nextDueAt);
  buckets.paused.sort((a, b) => a.title.localeCompare(b.title));

  return buckets;
}
