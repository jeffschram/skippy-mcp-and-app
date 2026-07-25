/* ------------------------------------------------------------------ */
/* Calendar mirror                                                     */
/*                                                                     */
/* Google stays the source of truth; Skippy keeps a mirror so it has a  */
/* persisted sense of time. All the identity and merge rules live here  */
/* as pure functions so the echo-loop behavior is testable without a    */
/* database or a Google client.                                         */
/* ------------------------------------------------------------------ */

/** Google Calendar ids are base32hex: digits plus a–v. Note 'w'–'z' are NOT legal. */
export const GOOGLE_EVENT_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuv";

/**
 * Prefix marking an id as Skippy-minted. Every character must be inside the
 * base32hex alphabet, which is why this is not "skippy" — 'y' is out of range
 * and Google would reject the insert at runtime.
 */
export const SKIPPY_EVENT_ID_PREFIX = "skp";

/** Google accepts 5–1024 characters. */
export const GOOGLE_EVENT_ID_MIN_LENGTH = 5;
export const GOOGLE_EVENT_ID_MAX_LENGTH = 1024;

/**
 * Descriptions are truncated before storage. Full calendar descriptions are
 * explicitly out of bounds for the brain (see skills/skippy-harness/SKILL.md).
 */
export const CALENDAR_DESCRIPTION_LIMIT = 500;

/**
 * Above this, attendee lists are dropped rather than stored. A 200-person
 * all-hands is not relationship signal and bloats every row it touches.
 */
export const CALENDAR_MAX_ATTENDEES = 20;

export const GOOGLE_CALENDAR_SOURCE_SYSTEM = "google_calendar";

export type CalendarEventStatus = "confirmed" | "tentative" | "cancelled";
export type CalendarEventOrigin = "google" | "skippy";
export type CalendarRemoteState = "synced" | "pending_remote" | "remote_failed";

export type CalendarAttendee = {
  email: string;
  displayName?: string | undefined;
  responseStatus?: string | undefined;
  organizer?: boolean | undefined;
  self?: boolean | undefined;
};

export type NormalizedCalendarEvent = {
  sourceSystem: string;
  calendarId: string;
  externalId: string;
  iCalUID?: string | undefined;
  etag?: string | undefined;
  recurringEventId?: string | undefined;
  originalStartAt?: number | undefined;
  recurrence?: string[] | undefined;
  isMaster?: boolean | undefined;
  title: string;
  description?: string | undefined;
  location?: string | undefined;
  startAt: number;
  endAt: number;
  isAllDay?: boolean | undefined;
  timeZone?: string | undefined;
  status: CalendarEventStatus;
  attendees?: CalendarAttendee[] | undefined;
  conferenceUrl?: string | undefined;
  htmlLink?: string | undefined;
};

/* ------------------------------------------------------------------ */
/* Event ids                                                           */
/* ------------------------------------------------------------------ */

export function isValidGoogleEventId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  if (id.length < GOOGLE_EVENT_ID_MIN_LENGTH || id.length > GOOGLE_EVENT_ID_MAX_LENGTH) return false;
  for (const character of id) {
    if (!GOOGLE_EVENT_ID_ALPHABET.includes(character)) return false;
  }
  return true;
}

export function isSkippyMintedEventId(id: unknown): boolean {
  return isValidGoogleEventId(id) && (id as string).startsWith(SKIPPY_EVENT_ID_PREFIX);
}

/**
 * Mints a Google event id client-side.
 *
 * This is the whole echo-loop defense. Because Skippy chooses the id before
 * writing, it can persist the local mirror row first: a crash between the local
 * write and the remote insert leaves a row the next ingest matches on, instead
 * of an orphan it duplicates. It also makes retries safe — re-inserting a known
 * id returns 409 Conflict, which means "already created", not "create another".
 *
 * `random` is injectable so tests are deterministic.
 */
export function mintGoogleEventId(random: () => number = Math.random, length = 24): string {
  let id = SKIPPY_EVENT_ID_PREFIX;
  for (let index = 0; index < length; index += 1) {
    const position = Math.floor(random() * GOOGLE_EVENT_ID_ALPHABET.length);
    const clamped = Math.min(Math.max(position, 0), GOOGLE_EVENT_ID_ALPHABET.length - 1);
    id += GOOGLE_EVENT_ID_ALPHABET[clamped];
  }
  return id;
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

export function truncateDescription(
  value: unknown,
  limit: number = CALENDAR_DESCRIPTION_LIMIT,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`;
}

/**
 * Reads a Google start/end object. All-day events carry `date` (YYYY-MM-DD)
 * rather than `dateTime`; those are floating, so they are anchored at UTC
 * midnight and flagged. Readers place them by day using `isAllDay` rather than
 * treating the instant as a real wall-clock time.
 */
function readEventTime(value: any): { at: number; isAllDay: boolean } | null {
  if (!value || typeof value !== "object") return null;

  if (typeof value.dateTime === "string") {
    const parsed = Date.parse(value.dateTime);
    return Number.isFinite(parsed) ? { at: parsed, isAllDay: false } : null;
  }

  if (typeof value.date === "string") {
    const parsed = Date.parse(`${value.date}T00:00:00Z`);
    return Number.isFinite(parsed) ? { at: parsed, isAllDay: true } : null;
  }

  return null;
}

function normalizeStatus(value: unknown): CalendarEventStatus {
  return value === "cancelled" || value === "tentative" ? value : "confirmed";
}

function normalizeAttendees(value: unknown): CalendarAttendee[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (value.length > CALENDAR_MAX_ATTENDEES) return undefined;

  const attendees: CalendarAttendee[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || typeof raw.email !== "string") continue;
    attendees.push({
      email: raw.email,
      displayName: typeof raw.displayName === "string" ? raw.displayName : undefined,
      responseStatus: typeof raw.responseStatus === "string" ? raw.responseStatus : undefined,
      organizer: raw.organizer === true ? true : undefined,
      self: raw.self === true ? true : undefined,
    });
  }

  return attendees.length ? attendees : undefined;
}

function conferenceUrlOf(raw: any): string | undefined {
  if (typeof raw?.hangoutLink === "string") return raw.hangoutLink;
  const entryPoints = raw?.conferenceData?.entryPoints;
  if (!Array.isArray(entryPoints)) return undefined;
  for (const entry of entryPoints) {
    if (entry?.entryPointType === "video" && typeof entry.uri === "string") return entry.uri;
  }
  return undefined;
}

/**
 * Converts a Google events.list item into the mirror shape.
 *
 * Returns null for anything unusable (no id, no resolvable times) rather than
 * throwing, so one malformed event cannot fail an entire sync batch.
 */
export function normalizeGoogleEvent(
  raw: any,
  calendarId: string,
  sourceSystem: string = GOOGLE_CALENDAR_SOURCE_SYSTEM,
): NormalizedCalendarEvent | null {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) return null;

  const start = readEventTime(raw.start);
  const end = readEventTime(raw.end);
  const status = normalizeStatus(raw.status);

  // Cancelled events in an incremental sync often arrive as bare tombstones
  // with no times at all. They still matter — they remove something from the
  // agenda — so they are kept with whatever times are available.
  if (!start && status !== "cancelled") return null;

  const startAt = start?.at ?? 0;
  const endAt = end?.at ?? startAt;

  const originalStart = readEventTime(raw.originalStartTime);
  const recurrence = Array.isArray(raw.recurrence)
    ? raw.recurrence.filter((line: unknown): line is string => typeof line === "string")
    : undefined;

  return {
    sourceSystem,
    calendarId,
    externalId: raw.id,
    iCalUID: typeof raw.iCalUID === "string" ? raw.iCalUID : undefined,
    etag: typeof raw.etag === "string" ? raw.etag : undefined,
    recurringEventId: typeof raw.recurringEventId === "string" ? raw.recurringEventId : undefined,
    originalStartAt: originalStart?.at,
    recurrence: recurrence && recurrence.length ? recurrence : undefined,
    isMaster: recurrence && recurrence.length ? true : undefined,
    title: typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim() : "(no title)",
    description: truncateDescription(raw.description),
    location: typeof raw.location === "string" ? raw.location : undefined,
    startAt,
    endAt: endAt >= startAt ? endAt : startAt,
    isAllDay: start?.isAllDay ? true : undefined,
    timeZone: typeof raw.start?.timeZone === "string" ? raw.start.timeZone : undefined,
    status,
    attendees: normalizeAttendees(raw.attendees),
    conferenceUrl: conferenceUrlOf(raw),
    htmlLink: typeof raw.htmlLink === "string" ? raw.htmlLink : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Merge                                                               */
/* ------------------------------------------------------------------ */

export type ExistingCalendarEvent = {
  origin?: CalendarEventOrigin | undefined;
  remoteState?: CalendarRemoteState | undefined;
  relatedEntityRefs?: unknown;
  focusSnoozedUntil?: number | undefined;
  etag?: string | undefined;
};

export type CalendarWritePlan =
  | { action: "insert"; doc: Record<string, unknown> }
  | { action: "patch"; patch: Record<string, unknown>; isEcho: boolean };

/**
 * Decides what an incoming Google event should do to the mirror.
 *
 * Two rules carry the weight:
 *
 * 1. Matching is by identity — the caller looks the row up by
 *    (sourceSystem, externalId) — never by title similarity. The generic
 *    ingest path dedupes tasks on fuzzy titles, which for calendar would
 *    collapse a weekly 1:1 into a single row.
 *
 * 2. A row Skippy wrote and is still waiting on (origin "skippy",
 *    remoteState "pending_remote") is an ECHO of Skippy's own insert. It gets
 *    marked synced and reported as such, so callers know not to raise it as
 *    new information, notify, or run the rubric over it.
 *
 * Owner-authored local state — relatedEntityRefs, focusSnoozedUntil — is never
 * clobbered by a sync, and `origin` is preserved for the life of the row.
 */
export function planCalendarEventWrite(
  existing: ExistingCalendarEvent | null | undefined,
  incoming: NormalizedCalendarEvent,
  now: number,
): CalendarWritePlan {
  if (!existing) {
    return {
      action: "insert",
      doc: {
        ...incoming,
        origin: "google" as const,
        remoteState: "synced" as const,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  const isEcho = existing.origin === "skippy" && existing.remoteState === "pending_remote";

  return {
    action: "patch",
    isEcho,
    patch: {
      ...incoming,
      // Origin is a property of who created the event, not of the last sync.
      origin: existing.origin ?? "google",
      remoteState: "synced" as const,
      remoteError: undefined,
      lastSyncedAt: now,
      updatedAt: now,
    },
  };
}
