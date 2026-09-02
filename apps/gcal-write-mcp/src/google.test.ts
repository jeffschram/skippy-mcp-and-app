import { describe, expect, it, vi } from "vitest";

import {
  buildListEventsQuery,
  describeGoogleError,
  insertEvent,
  interpretInsertResponse,
  interpretListResponse,
  listEvents,
} from "./google.js";

const REQUESTED_ID = `skp${"a".repeat(24)}`;

describe("interpretInsertResponse", () => {
  it("reports a created event with its link and etag", () => {
    expect(
      interpretInsertResponse(
        200,
        { id: "abc12", htmlLink: "https://cal/e", etag: '"tag"' },
        REQUESTED_ID,
      ),
    ).toEqual({ status: "created", eventId: "abc12", htmlLink: "https://cal/e", etag: '"tag"' });
  });

  it("treats 409 as success", () => {
    // Skippy mints the id before staging, so a conflict means "already
    // created" — the exact shape of a retry after a partial failure. Calling
    // it an error is how calendars get double-booked.
    expect(interpretInsertResponse(409, null, REQUESTED_ID)).toEqual({
      status: "conflict",
      eventId: REQUESTED_ID,
    });
  });

  it("falls back to the requested id when Google echoes no id", () => {
    expect(interpretInsertResponse(200, {}, REQUESTED_ID)).toMatchObject({
      status: "created",
      eventId: REQUESTED_ID,
    });
  });

  it("fails when there is no id from either side", () => {
    expect(interpretInsertResponse(200, {}, undefined)).toEqual({
      status: "failed",
      error: "Google returned no event id",
    });
  });

  it("maps other non-2xx statuses to failure", () => {
    const outcome = interpretInsertResponse(
      400,
      { error: { message: "The specified time range is empty." } },
      REQUESTED_ID,
    );
    expect(outcome).toEqual({
      status: "failed",
      error: "Google Calendar insert failed (HTTP 400): The specified time range is empty.",
    });
  });
});

describe("describeGoogleError", () => {
  it("handles a bare string error and a missing body", () => {
    expect(describeGoogleError(403, { error: "forbidden" })).toBe(
      "Google Calendar insert failed (HTTP 403): forbidden",
    );
    expect(describeGoogleError(500, null)).toBe("Google Calendar insert failed (HTTP 500)");
  });

  it("truncates a runaway detail", () => {
    const long = describeGoogleError(400, { error: { message: "x".repeat(1000) } });
    expect(long.length).toBeLessThan(400);
  });
});

describe("insertEvent", () => {
  const input = {
    summary: "Coffee with Helen",
    start: Date.UTC(2026, 8, 2, 19, 0),
    end: Date.UTC(2026, 8, 2, 20, 0),
    eventId: REQUESTED_ID,
  };

  it("posts to the primary calendar with a bearer token", async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      text: async () => JSON.stringify({ id: REQUESTED_ID }),
    }));
    const outcome = await insertEvent(input, "tok", fetchImpl as never);
    expect(outcome.status).toBe("created");

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({
      id: REQUESTED_ID,
      summary: "Coffee with Helen",
      start: { dateTime: "2026-09-02T19:00:00.000Z" },
      end: { dateTime: "2026-09-02T20:00:00.000Z" },
    });
  });

  it("url-encodes a non-primary calendar id", async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200, text: async () => "{}" }));
    await insertEvent({ ...input, calendarId: "work@example.com" }, "tok", fetchImpl as never);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain("/calendars/work%40example.com/events");
  });

  it("survives a non-JSON error body", async () => {
    const fetchImpl = vi.fn(async () => ({ status: 502, text: async () => "<html>bad gateway" }));
    const outcome = await insertEvent(input, "tok", fetchImpl as never);
    expect(outcome).toEqual({
      status: "failed",
      error: "Google Calendar insert failed (HTTP 502)",
    });
  });
});

describe("buildListEventsQuery", () => {
  it("always sends singleEvents and showDeleted", () => {
    // singleEvents must never vary across a syncToken's lifetime — Google
    // invalidates the token if it does — and showDeleted is what carries
    // deletions into the mirror as cancelled tombstones.
    const params = buildListEventsQuery({});
    expect(params.get("singleEvents")).toBe("true");
    expect(params.get("showDeleted")).toBe("true");
  });

  it("sends a bounded window on a full sync", () => {
    const params = buildListEventsQuery({
      timeMin: Date.UTC(2026, 7, 1),
      timeMax: Date.UTC(2026, 8, 1),
      maxResults: 250,
    });
    expect(params.get("timeMin")).toBe("2026-08-01T00:00:00.000Z");
    expect(params.get("timeMax")).toBe("2026-09-01T00:00:00.000Z");
    expect(params.get("maxResults")).toBe("250");
  });

  it("drops timeMin/timeMax when a syncToken is present", () => {
    // Google answers 400 for the combination rather than ignoring the window,
    // so dropping them here is correctness, not tidiness.
    const params = buildListEventsQuery({
      syncToken: "tok123",
      timeMin: Date.UTC(2026, 7, 1),
      timeMax: Date.UTC(2026, 8, 1),
      pageToken: "page2",
    });
    expect(params.get("syncToken")).toBe("tok123");
    expect(params.get("pageToken")).toBe("page2");
    expect(params.get("timeMin")).toBeNull();
    expect(params.get("timeMax")).toBeNull();
  });
});

describe("interpretListResponse", () => {
  it("returns items and both cursors", () => {
    expect(
      interpretListResponse(200, {
        items: [{ id: "a" }],
        nextPageToken: "p2",
        nextSyncToken: "s2",
      }),
    ).toEqual({
      status: "ok",
      events: [{ id: "a" }],
      nextPageToken: "p2",
      nextSyncToken: "s2",
    });
  });

  it("signals an expired sync token on 410", () => {
    // The caller MUST drop the token here; retrying with it loops forever.
    expect(interpretListResponse(410, { error: { message: "Sync token is no longer valid" } })).toEqual({
      status: "sync_token_expired",
    });
  });

  it("tolerates a response with no items array", () => {
    expect(interpretListResponse(200, {})).toMatchObject({ status: "ok", events: [] });
  });

  it("maps other non-2xx statuses to failure", () => {
    expect(interpretListResponse(403, { error: { message: "Rate limit" } })).toEqual({
      status: "failed",
      error: "Google Calendar list failed (HTTP 403): Rate limit",
    });
  });
});

describe("listEvents", () => {
  it("GETs the primary calendar with a bearer token", async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      text: async () => JSON.stringify({ items: [{ id: "a" }], nextSyncToken: "s1" }),
    }));

    const outcome = await listEvents({ timeMin: 0, timeMax: 1000 }, "tok", fetchImpl as never);
    expect(outcome).toMatchObject({ status: "ok", nextSyncToken: "s1" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://www.googleapis.com/calendar/v3/calendars/primary/events?");
    expect(url).toContain("singleEvents=true");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer tok");
  });

  it("url-encodes a non-primary calendar id", async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200, text: async () => "{}" }));
    await listEvents({ calendarId: "work@example.com" }, "tok", fetchImpl as never);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain("/calendars/work%40example.com/events?");
  });

  it("reports an expired sync token from a 410", async () => {
    const fetchImpl = vi.fn(async () => ({ status: 410, text: async () => "" }));
    expect(await listEvents({ syncToken: "old" }, "tok", fetchImpl as never)).toEqual({
      status: "sync_token_expired",
    });
  });
});
