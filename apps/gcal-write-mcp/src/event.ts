// Pure translation from Skippy's staged-event shape to a Google Calendar
// `events.insert` request body.
//
// The input shape is deliberately identical to the JSON stored in a
// `calendar_event_create` pendingAction body (convex/calendar.ts
// draftCalendarEvent). Keeping them the same means the runner executor can
// `JSON.parse(action.body)` and hand it straight to this server with no
// translation layer in between — one shape, one place it can drift.

import { isValidGoogleEventId } from "@skippy/shared";

const DAY_MS = 86_400_000;

export type CreateEventInput = {
  /** Google calendar id; "primary" is the owner's own calendar. */
  calendarId?: string | undefined;
  /** Skippy-minted base32hex id. Omitted means "let Google allocate one". */
  eventId?: string | undefined;
  summary: string;
  description?: string | undefined;
  location?: string | undefined;
  /** Epoch ms. */
  start: number;
  /** Epoch ms. */
  end: number;
  isAllDay?: boolean | undefined;
  /** IANA zone, e.g. "America/Chicago". */
  timeZone?: string | undefined;
};

export type GoogleEventTime =
  | { date: string }
  | { dateTime: string; timeZone?: string | undefined };

export type GoogleEventResource = {
  id?: string | undefined;
  summary: string;
  description?: string | undefined;
  location?: string | undefined;
  start: GoogleEventTime;
  end: GoogleEventTime;
};

export class EventValidationError extends Error {}

function fail(message: string): never {
  throw new EventValidationError(message);
}

function requireFiniteMs(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${field} must be an epoch-milliseconds number`);
  }
  return value as number;
}

/**
 * All-day events are floating dates, and the mirror anchors them at UTC
 * midnight (packages/shared normalizeGoogleEvent). Formatting in UTC here is
 * what makes an event round-trip to the same day it was staged for.
 */
export function formatUtcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Validates and converts a staged event. Throws EventValidationError with a
 * message meant for a human reading /review, because that is where a rejected
 * insert surfaces.
 */
export function buildEventResource(input: CreateEventInput): GoogleEventResource {
  const summary = optionalText(input.summary);
  if (!summary) fail("summary is required");

  const start = requireFiniteMs(input.start, "start");
  const end = requireFiniteMs(input.end, "end");
  if (end < start) fail("end cannot precede start");

  if (input.eventId !== undefined && !isValidGoogleEventId(input.eventId)) {
    // Google rejects anything outside base32hex at insert time; failing here
    // turns a confusing 400 into a clear local message.
    fail(`invalid Google event id: ${String(input.eventId)}`);
  }

  const timeZone = optionalText(input.timeZone);

  let startTime: GoogleEventTime;
  let endTime: GoogleEventTime;

  if (input.isAllDay === true) {
    const startDate = formatUtcDate(start);
    // Google's all-day `end.date` is EXCLUSIVE, so a single-day event ends on
    // the following day. Callers routinely stage start === end meaning "one
    // day"; normalizing is friendlier than rejecting, and the alternative
    // (passing it through) is a guaranteed 400.
    const endDate = formatUtcDate(Math.max(end, start + DAY_MS));
    startTime = { date: startDate };
    endTime = { date: endDate === startDate ? formatUtcDate(start + DAY_MS) : endDate };
  } else {
    if (end === start) fail("end must be after start for a timed event");
    // An RFC3339 instant with a Z offset is unambiguous on its own; the
    // timeZone field rides along only so Google labels the event correctly.
    startTime = timeZone
      ? { dateTime: new Date(start).toISOString(), timeZone }
      : { dateTime: new Date(start).toISOString() };
    endTime = timeZone
      ? { dateTime: new Date(end).toISOString(), timeZone }
      : { dateTime: new Date(end).toISOString() };
  }

  const resource: GoogleEventResource = {
    summary,
    start: startTime,
    end: endTime,
  };
  const id = optionalText(input.eventId);
  if (id) resource.id = id;
  const description = optionalText(input.description);
  if (description) resource.description = description;
  const location = optionalText(input.location);
  if (location) resource.location = location;
  return resource;
}

/** "primary" is the owner's own calendar — the only target this server writes to by default. */
export function resolveCalendarId(calendarId?: string | undefined): string {
  return optionalText(calendarId) ?? "primary";
}
