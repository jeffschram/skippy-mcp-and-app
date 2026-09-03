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

/* ------------------------------------------------------------------ */
/* Duplicate / overlap detection                                       */
/*                                                                     */
/* Added 2026-09 after Skippy staged "Jury duty" on a day that already  */
/* had a Google-side "Jury duty", and a hand-built JetBlue flight on    */
/* top of Gmail's auto-created "Flight to Los Angeles (B6 1023)". The   */
/* 409/minted-id guard cannot see either: it only stops the SAME        */
/* proposal from executing twice. Catching a pre-existing Google event  */
/* needs the mirror, and the comparison itself lives here so it is      */
/* testable without a database.                                        */
/*                                                                     */
/* This warns; it never blocks. Double-booking is sometimes exactly     */
/* what the owner wants (a flight and a reminder about the flight), so  */
/* the decision stays with the human at /review.                       */
/* ------------------------------------------------------------------ */

/** How many conflicts are named before the warning switches to "and N more". */
export const CALENDAR_CONFLICT_NAME_LIMIT = 3;

/**
 * Display fallback when a proposal carries no timeZone. Matches the owner zone
 * in convex/agentConfigs.ts; duplicated rather than imported because this
 * module is pure and must not depend on Convex.
 */
export const DEFAULT_CALENDAR_TIME_ZONE = "America/New_York";

/** A mirror row, loosely typed so a Convex doc can be passed straight in. */
export type CalendarOverlapCandidate = {
  externalId?: string | undefined;
  title?: string | undefined;
  startAt: number;
  endAt: number;
  isAllDay?: boolean | undefined;
  status?: string | undefined;
  origin?: string | undefined;
  remoteState?: string | undefined;
};

export type CalendarOverlap = {
  externalId?: string | undefined;
  title: string;
  startAt: number;
  endAt: number;
  isAllDay: boolean;
  origin?: string | undefined;
  remoteState?: string | undefined;
};

/**
 * Whether a mirror row describes an event that actually exists on Google:
 * Google created it, or Skippy created it and the insert (or its echo) was
 * confirmed. A Skippy row still `pending_remote` is a staged proposal the
 * owner may never approve, and `remote_failed` means Google refused it —
 * neither is on the calendar.
 *
 * Added 2026-09-03: the overlap warning counted Skippy's own unapproved
 * drafts as existing events, so 13 stacked duplicates of one proposal read as
 * "Overlaps 13 existing events" when Google held zero.
 */
export function isMirroredFromGoogle(candidate: {
  origin?: string | undefined;
  remoteState?: string | undefined;
}): boolean {
  return candidate.origin === "google" || candidate.remoteState === "synced";
}

/**
 * Splits overlaps into events that are real on Google versus Skippy's own
 * staged-but-unconfirmed proposals, so the two can be reported as what they
 * are instead of blended into one inflated count.
 */
export function partitionCalendarOverlaps(overlaps: readonly CalendarOverlap[]): {
  real: CalendarOverlap[];
  stagedProposals: CalendarOverlap[];
} {
  const real: CalendarOverlap[] = [];
  const stagedProposals: CalendarOverlap[] = [];
  for (const overlap of overlaps) {
    (isMirroredFromGoogle(overlap) ? real : stagedProposals).push(overlap);
  }
  return { real, stagedProposals };
}

/**
 * Half-open interval end. A zero-length event (endAt === startAt, which
 * normalizeGoogleEvent produces for a tombstone or a malformed end) would never
 * overlap anything under strict inequality, so it is widened by a millisecond
 * — an instant on the calendar is still something worth warning about.
 */
function effectiveEnd(startAt: number, endAt: number): number {
  return endAt > startAt ? endAt : startAt + 1;
}

/**
 * Returns the mirrored events that overlap a proposed time range.
 *
 * Half-open comparison (`end > proposedStart && start < proposedEnd`) so
 * back-to-back events do not read as conflicts: a 2–3pm meeting followed by a
 * 3–4pm one is a normal day, not a double booking.
 *
 * Matching is purely temporal — no title similarity. Both live misfires were
 * near-duplicates with *different* titles ("JetBlue 1023 — JFK → LAX" vs
 * "Flight to Los Angeles (B6 1023)"), so a title comparison would have caught
 * neither, and it would collapse legitimately distinct events that happen to
 * share a name.
 */
export function findOverlappingEvents(
  candidates: readonly CalendarOverlapCandidate[],
  proposed: { startAt: number; endAt: number; excludeExternalId?: string | undefined },
): CalendarOverlap[] {
  const proposedStart = proposed.startAt;
  const proposedEnd = effectiveEnd(proposed.startAt, proposed.endAt);

  const overlaps: CalendarOverlap[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.startAt !== "number" || typeof candidate.endAt !== "number") continue;
    // A cancelled row is a tombstone Google sent so the mirror could forget the
    // event; warning about it would be warning about nothing.
    if (candidate.status === "cancelled") continue;
    // The proposal writes its own mirror row before this check runs, so it
    // would otherwise conflict with itself.
    if (proposed.excludeExternalId && candidate.externalId === proposed.excludeExternalId) continue;

    const end = effectiveEnd(candidate.startAt, candidate.endAt);
    if (end <= proposedStart) continue;
    if (candidate.startAt >= proposedEnd) continue;

    overlaps.push({
      externalId: candidate.externalId,
      title: candidate.title?.trim() ? candidate.title.trim() : "(no title)",
      startAt: candidate.startAt,
      endAt: candidate.endAt,
      isAllDay: candidate.isAllDay === true,
      origin: candidate.origin,
      remoteState: candidate.remoteState,
    });
  }

  overlaps.sort((a, b) => a.startAt - b.startAt || a.title.localeCompare(b.title));
  return overlaps;
}

/**
 * Formats a wall-clock label like "Jul 31, 4:16 PM".
 *
 * Assembled from formatToParts rather than a preset skeleton because ICU 72
 * changed en-US medium date-time output to "Jul 31 at 4:16 PM"; building the
 * string ourselves keeps it stable across Node/Convex ICU versions.
 */
export function formatCalendarConflictTime(
  at: number,
  options: { timeZone?: string | undefined; isAllDay?: boolean | undefined } = {},
): string {
  const timeZone = options.timeZone?.trim() || DEFAULT_CALENDAR_TIME_ZONE;
  // All-day events are anchored at UTC midnight and are floating, so rendering
  // them in a local zone would shift them to the previous evening.
  const zone = options.isAllDay ? "UTC" : timeZone;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    // An unknown IANA zone (a bad timeZone on a proposal) must not blow up a
    // staging mutation; fall back rather than throw.
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(at))) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }

  const date = `${parts["month"] ?? ""} ${parts["day"] ?? ""}`.trim();
  if (options.isAllDay) return `${date}, all day`;
  return `${date}, ${parts["hour"] ?? ""}:${parts["minute"] ?? ""} ${parts["dayPeriod"] ?? ""}`.trim();
}

/**
 * Renders the human-facing warning stored on the pending action.
 *
 * Returns undefined for no conflicts so callers never persist an empty string —
 * and, more importantly, so "no warning" is only ever written by a caller that
 * actually checked. Absence must not be manufactured here.
 */
export function formatCalendarConflictWarning(
  conflicts: readonly CalendarOverlap[],
  options: { timeZone?: string | undefined; nameLimit?: number | undefined } = {},
): string | undefined {
  if (!conflicts.length) return undefined;

  const limit = options.nameLimit ?? CALENDAR_CONFLICT_NAME_LIMIT;
  const named = conflicts.slice(0, Math.max(limit, 1));
  const rendered = named.map((conflict) => {
    const when = formatCalendarConflictTime(conflict.startAt, {
      timeZone: options.timeZone,
      isAllDay: conflict.isAllDay,
    });
    return `"${conflict.title}" (${when})`;
  });

  const noun = conflicts.length === 1 ? "event" : "events";
  const remainder = conflicts.length - named.length;
  const tail = remainder > 0 ? ` and ${remainder} more` : "";
  return `Overlaps ${conflicts.length} existing ${noun}: ${rendered.join(", ")}${tail}.`;
}

/**
 * Separate line for same-window proposals still sitting in /review.
 *
 * 2026-09-03: these used to be folded into "existing events", which is a lie
 * in both directions — it inflated the conflict count ("Overlaps 13 existing
 * events" when Google held zero) AND hid that the real problem was a pile of
 * unapproved duplicates. Kept as its own sentence so the owner sees which
 * situation they are in.
 */
export function formatStagedProposalWarning(count: number): string | undefined {
  if (count <= 0) return undefined;
  const noun = count === 1 ? "proposal" : "proposals";
  return `${count} unapproved Skippy ${noun} for this window already await${count === 1 ? "s" : ""} review.`;
}
