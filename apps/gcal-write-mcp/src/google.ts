// The Google Calendar API calls this package can make.
//
// Two endpoints, and only two: POST .../events (insert) and GET .../events
// (list). There is still no update, patch, or delete anywhere — that absence is
// the security property. The OAuth scope bounds what the token *could* do, this
// file bounds what the code *can* do, and only the second one is enforced by
// code review.
//
// The list call was added 2026-09 for the runner's calendar mirror sync
// (apps/runner/src/calendarMirrorSync.ts): proposals could not warn about
// duplicates because Skippy had no idea what was already on the calendar. It is
// LIBRARY-ONLY — see the note in mcp-server.ts; the MCP surface stays
// create-only. `calendar.events` already granted read, so nothing here widens
// consent.

import { CALENDAR_API_BASE } from "./config.js";
import { buildEventResource, resolveCalendarId, type CreateEventInput } from "./event.js";
import type { FetchLike } from "./auth.js";

export type InsertOutcome =
  | { status: "created"; eventId: string; htmlLink?: string | undefined; etag?: string | undefined }
  | { status: "conflict"; eventId: string }
  | { status: "failed"; error: string };

const ERROR_DETAIL_LIMIT = 300;

/**
 * Pulls a human-usable reason out of a Google error body without echoing the
 * whole payload (which repeats the request, including the event contents).
 */
export function describeGoogleError(
  httpStatus: number,
  body: unknown,
  operation: "insert" | "list" = "insert",
): string {
  let detail: string | undefined;
  if (body && typeof body === "object") {
    const error = (body as Record<string, unknown>)["error"];
    if (error && typeof error === "object") {
      const message = (error as Record<string, unknown>)["message"];
      if (typeof message === "string" && message.trim()) detail = message.trim();
    } else if (typeof error === "string" && error.trim()) {
      detail = error.trim();
    }
  }
  const suffix = detail ? `: ${detail.slice(0, ERROR_DETAIL_LIMIT)}` : "";
  return `Google Calendar ${operation} failed (HTTP ${httpStatus})${suffix}`;
}

/**
 * Maps an HTTP response onto the outcome vocabulary Convex already speaks
 * (recordCalendarEventRemoteResult).
 *
 * 409 is SUCCESS, not failure. Skippy mints the event id before staging, so a
 * conflict means "this exact event already exists" — which is precisely what a
 * retry after a partial failure looks like. Treating it as an error is how you
 * get double-booked calendars.
 */
export function interpretInsertResponse(
  httpStatus: number,
  body: unknown,
  requestedEventId: string | undefined,
): InsertOutcome {
  if (httpStatus === 409) {
    const existing = (body as { id?: unknown } | null)?.id;
    const eventId = typeof existing === "string" ? existing : requestedEventId;
    if (!eventId) return { status: "failed", error: "conflict with no resolvable event id" };
    return { status: "conflict", eventId };
  }

  if (httpStatus < 200 || httpStatus >= 300) {
    return { status: "failed", error: describeGoogleError(httpStatus, body) };
  }

  const record = (body ?? {}) as Record<string, unknown>;
  const id = typeof record["id"] === "string" ? (record["id"] as string) : requestedEventId;
  if (!id) return { status: "failed", error: "Google returned no event id" };
  return {
    status: "created",
    eventId: id,
    htmlLink: typeof record["htmlLink"] === "string" ? (record["htmlLink"] as string) : undefined,
    etag: typeof record["etag"] === "string" ? (record["etag"] as string) : undefined,
  };
}

export async function insertEvent(
  input: CreateEventInput,
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<InsertOutcome> {
  const calendarId = resolveCalendarId(input.calendarId);
  const resource = buildEventResource(input);

  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(resource),
  });

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body (proxy error page, HTML) is still a failure worth
    // reporting; it just carries no structured detail.
    parsed = null;
  }
  return interpretInsertResponse(response.status, parsed, resource.id);
}

/* ------------------------------------------------------------------ */
/* Read: events.list (library-only, for the mirror sync)               */
/* ------------------------------------------------------------------ */

export type ListEventsInput = {
  calendarId?: string | undefined;
  /** Epoch ms. Ignored when syncToken is present — Google rejects the combination. */
  timeMin?: number | undefined;
  /** Epoch ms. Ignored when syncToken is present. */
  timeMax?: number | undefined;
  /** Incremental sync cursor from a previous run's nextSyncToken. */
  syncToken?: string | undefined;
  /** Cursor within one sync run's result set. */
  pageToken?: string | undefined;
  /**
   * Expand recurring series into instances. Defaults true and should stay true:
   * Google refuses a syncToken whose singleEvents differs from the request that
   * minted it, so flipping this silently invalidates every stored token.
   */
  singleEvents?: boolean | undefined;
  /** Include cancelled tombstones. Defaults true so deletions reach the mirror. */
  showDeleted?: boolean | undefined;
  maxResults?: number | undefined;
};

export type ListEventsOutcome =
  | {
      status: "ok";
      events: unknown[];
      nextPageToken?: string | undefined;
      nextSyncToken?: string | undefined;
    }
  /**
   * HTTP 410 Gone: the stored syncToken expired or was invalidated. The caller
   * must DROP the token and redo a bounded full sync — retrying with the same
   * token loops forever.
   */
  | { status: "sync_token_expired" }
  | { status: "failed"; error: string };

/**
 * Builds the events.list query string.
 *
 * Pure so the Google API's mutual-exclusion rules are testable without a
 * network: a syncToken may not be combined with timeMin/timeMax/orderBy/q, and
 * sending them together is a 400, not a silently ignored parameter.
 */
export function buildListEventsQuery(input: ListEventsInput): URLSearchParams {
  const params = new URLSearchParams();
  // Always sent, and always the same value across a token's lifetime.
  params.set("singleEvents", String(input.singleEvents ?? true));
  params.set("showDeleted", String(input.showDeleted ?? true));
  if (input.maxResults !== undefined) params.set("maxResults", String(input.maxResults));
  if (input.pageToken) params.set("pageToken", input.pageToken);

  if (input.syncToken) {
    params.set("syncToken", input.syncToken);
    return params;
  }

  if (input.timeMin !== undefined) params.set("timeMin", new Date(input.timeMin).toISOString());
  if (input.timeMax !== undefined) params.set("timeMax", new Date(input.timeMax).toISOString());
  return params;
}

/** Maps an events.list HTTP response onto the outcome vocabulary above. */
export function interpretListResponse(httpStatus: number, body: unknown): ListEventsOutcome {
  if (httpStatus === 410) return { status: "sync_token_expired" };

  if (httpStatus < 200 || httpStatus >= 300) {
    return { status: "failed", error: describeGoogleError(httpStatus, body, "list") };
  }

  const record = (body ?? {}) as Record<string, unknown>;
  const items = record["items"];
  return {
    status: "ok",
    events: Array.isArray(items) ? items : [],
    nextPageToken: typeof record["nextPageToken"] === "string" ? (record["nextPageToken"] as string) : undefined,
    nextSyncToken: typeof record["nextSyncToken"] === "string" ? (record["nextSyncToken"] as string) : undefined,
  };
}

/**
 * Reads one page of events. LIBRARY-ONLY: nothing in the MCP surface calls this
 * (see mcp-server.ts) — it exists for the runner's mirror sync.
 */
export async function listEvents(
  input: ListEventsInput,
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<ListEventsOutcome> {
  const calendarId = resolveCalendarId(input.calendarId);
  const query = buildListEventsQuery(input);
  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`;

  const response = await fetchImpl(url, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
  });

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return interpretListResponse(response.status, parsed);
}
