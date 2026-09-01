// The single Google API call this package can make.
//
// There is exactly one endpoint here — POST .../events — and no update, patch,
// delete, or list. That absence is the security property: the OAuth scope
// bounds what the token *could* do, this file bounds what the code *can* do,
// and only the second one is enforced by code review.

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
export function describeGoogleError(httpStatus: number, body: unknown): string {
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
  return `Google Calendar insert failed (HTTP ${httpStatus})${suffix}`;
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
