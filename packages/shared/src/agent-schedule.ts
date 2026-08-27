/**
 * Agent-pass schedules (docs/connectors.md). Deliberately NOT the life
 * recurrence engine: that one is day-granular and completion-anchored, while
 * agent schedules are minute-granular and schedule-anchored — a slow run must
 * not drift the cadence, and slots missed while the host was asleep collapse
 * into one catch-up pass because `nextAgentDueAt` only ever returns future
 * occurrences.
 */

import { zonedParts, zonedTimestamp } from "./recurrence";

export const DEFAULT_AGENT_SCHEDULE_TIME_ZONE = "UTC";

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

/** Wall-clock window ("HH:MM" to "HH:MM") an interval schedule must stay inside. */
export type AgentScheduleWindow = { start: string; end: string };

export type AgentSchedule =
  | {
      kind: "interval";
      everyMinutes: number;
      /** Quiet hours: slots outside the window advance to the window start. */
      window?: AgentScheduleWindow;
      timeZone?: string;
    }
  | { kind: "daily"; timesOfDay: string[]; timeZone?: string };

function parseTimeOfDay(value: string): { hour: number; minute: number } {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) {
    throw new Error(`invalid time of day '${value}': expected HH:MM (24h)`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function minutesOfDay(value: string): number {
  const { hour, minute } = parseTimeOfDay(value);
  return hour * 60 + minute;
}

/** Throws with a human-readable message when the schedule is malformed. */
export function validateAgentSchedule(schedule: AgentSchedule): void {
  if (schedule.kind === "interval") {
    if (!Number.isInteger(schedule.everyMinutes) || schedule.everyMinutes < 1) {
      throw new Error("interval schedule requires an integer everyMinutes >= 1");
    }
    if (schedule.everyMinutes > DAY_MINUTES) {
      throw new Error("interval schedules beyond 24h should be daily schedules");
    }
    if (schedule.window) {
      const start = minutesOfDay(schedule.window.start);
      const end = minutesOfDay(schedule.window.end);
      if (start >= end) {
        throw new Error("schedule window start must be before end (same-day window)");
      }
    }
    return;
  }
  if (schedule.kind === "daily") {
    if (!schedule.timesOfDay.length) {
      throw new Error("daily schedule requires at least one time of day");
    }
    for (const time of schedule.timesOfDay) {
      parseTimeOfDay(time);
    }
    return;
  }
  throw new Error(`unknown schedule kind '${(schedule as { kind: string }).kind}'`);
}

/**
 * The next due instant STRICTLY AFTER `after`. Schedule-anchored: callers pass
 * "now" at claim time, so missed slots collapse into the next future
 * occurrence instead of replaying.
 */
export function nextAgentDueAt(schedule: AgentSchedule, after: number): number {
  validateAgentSchedule(schedule);
  const timeZone = schedule.timeZone ?? DEFAULT_AGENT_SCHEDULE_TIME_ZONE;

  if (schedule.kind === "interval") {
    const candidate = after + schedule.everyMinutes * MINUTE_MS;
    if (!schedule.window) {
      return candidate;
    }
    const startMinutes = minutesOfDay(schedule.window.start);
    const endMinutes = minutesOfDay(schedule.window.end);
    const parts = zonedParts(candidate, timeZone);
    const candidateMinutes = parts.hour * 60 + parts.minute;
    if (candidateMinutes < startMinutes) {
      // Too early: first slot of today's window.
      return zonedTimestamp(
        { ...parts, hour: Math.floor(startMinutes / 60), minute: startMinutes % 60, second: 0 },
        timeZone,
      );
    }
    if (candidateMinutes >= endMinutes) {
      // Past the window: first slot of tomorrow's window.
      return zonedTimestamp(
        {
          ...parts,
          day: parts.day + 1,
          hour: Math.floor(startMinutes / 60),
          minute: startMinutes % 60,
          second: 0,
        },
        timeZone,
      );
    }
    return candidate;
  }

  // daily: earliest configured time strictly after `after`, today or tomorrow.
  const parts = zonedParts(after, timeZone);
  const slots = [...schedule.timesOfDay].map(minutesOfDay).sort((a, b) => a - b);
  for (const dayOffset of [0, 1]) {
    for (const slot of slots) {
      const occurrence = zonedTimestamp(
        {
          ...parts,
          day: parts.day + dayOffset,
          hour: Math.floor(slot / 60),
          minute: slot % 60,
          second: 0,
        },
        timeZone,
      );
      if (occurrence > after) {
        return occurrence;
      }
    }
  }
  // Unreachable: tomorrow always contains a slot after `after`.
  throw new Error("could not compute next daily occurrence");
}

/** Short human label for settings UI, e.g. "every 30 min, 07:00–22:00" or "daily at 23:30". */
export function describeAgentSchedule(schedule: AgentSchedule | undefined | null): string {
  if (!schedule) return "manual";
  if (schedule.kind === "interval") {
    const base =
      schedule.everyMinutes % 60 === 0 && schedule.everyMinutes >= 60
        ? `every ${schedule.everyMinutes / 60}h`
        : `every ${schedule.everyMinutes} min`;
    return schedule.window ? `${base}, ${schedule.window.start}–${schedule.window.end}` : base;
  }
  return `daily at ${[...schedule.timesOfDay].sort().join(", ")}`;
}
