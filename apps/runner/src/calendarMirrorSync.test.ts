import { describe, expect, it, vi } from "vitest";

import { runCalendarMirrorSyncOnce, type MirrorSyncPlane } from "./calendarMirrorSync.js";

const TOKENS = { getAccessToken: async () => "access-token" } as never;

function fakePlane(overrides: Partial<MirrorSyncPlane> = {}) {
  const upserts: Array<{ calendarId: string; events: unknown[] }> = [];
  const recorded: Array<{ calendarId: string; syncToken: string | null; meta?: unknown }> = [];
  const plane: MirrorSyncPlane & { upserts: typeof upserts; recorded: typeof recorded } = {
    upserts,
    recorded,
    getCalendarSyncToken: async () => ({ syncToken: null }),
    upsertCalendarEvents: async (calendarId: string, events: unknown[]) => {
      upserts.push({ calendarId, events });
      return { inserted: events.length, updated: 0, echoes: 0, cancelled: 0, skipped: 0 };
    },
    recordCalendarSyncToken: async (calendarId: string, syncToken: string | null, meta?: unknown) => {
      recorded.push({ calendarId, syncToken, meta });
      return { statusKey: `google_calendar:${calendarId}`, updated: true };
    },
    ...overrides,
  };
  return plane;
}

/** Builds a fetch that answers each call from a queue of Google responses. */
function fakeFetch(pages: Array<{ status: number; body: unknown }>) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string) => {
    calls.push(url);
    const page = pages.shift() ?? { status: 200, body: {} };
    return { status: page.status, text: async () => JSON.stringify(page.body) };
  });
  return { impl: impl as never, calls };
}

describe("runCalendarMirrorSyncOnce", () => {
  it("pages a full sync into Convex and stores the resulting sync token", async () => {
    const plane = fakePlane();
    const { impl, calls } = fakeFetch([
      { status: 200, body: { items: [{ id: "a" }], nextPageToken: "p2" } },
      { status: 200, body: { items: [{ id: "b" }], nextSyncToken: "s1" } },
    ]);

    const result = await runCalendarMirrorSyncOnce(plane, { tokens: TOKENS, fetchImpl: impl });

    expect(result).toMatchObject({ status: "completed", pages: 2, events: 2, inserted: 2 });
    expect(plane.upserts.map((u) => u.events)).toEqual([[{ id: "a" }], [{ id: "b" }]]);
    expect(plane.recorded).toEqual([
      expect.objectContaining({ calendarId: "primary", syncToken: "s1" }),
    ]);
    // No token stored, so the first page must carry a bounded window.
    expect(calls[0]).toContain("timeMin=");
    expect(calls[1]).toContain("pageToken=p2");
  });

  it("uses the stored token and sends no window", async () => {
    const plane = fakePlane({ getCalendarSyncToken: async () => ({ syncToken: "stored" }) });
    const { impl, calls } = fakeFetch([{ status: 200, body: { items: [], nextSyncToken: "s2" } }]);

    await runCalendarMirrorSyncOnce(plane, { tokens: TOKENS, fetchImpl: impl });

    expect(calls[0]).toContain("syncToken=stored");
    expect(calls[0]).not.toContain("timeMin=");
    // An empty incremental page should not spend a Convex mutation.
    expect(plane.upserts).toEqual([]);
  });

  it("falls back to a bounded full resync when Google 410s the stored token", async () => {
    // Retrying with an expired token loops forever, so the token has to be
    // dropped and the window walked again. Upserts are keyed on externalId, so
    // re-seeing every event is a no-op.
    const plane = fakePlane({ getCalendarSyncToken: async () => ({ syncToken: "expired" }) });
    const { impl, calls } = fakeFetch([
      { status: 410, body: {} },
      { status: 200, body: { items: [{ id: "a" }], nextSyncToken: "fresh" } },
    ]);

    const result = await runCalendarMirrorSyncOnce(plane, { tokens: TOKENS, fetchImpl: impl });

    expect(result).toMatchObject({ status: "completed", fullResync: true, events: 1 });
    expect(calls[1]).toContain("timeMin=");
    expect(calls[1]).not.toContain("syncToken=");
    expect(plane.recorded[0]?.syncToken).toBe("fresh");
  });

  it("records a failure without discarding a still-valid token", async () => {
    // A 5xx is transient; throwing away the token would demote every later run
    // to a full resync for no reason.
    const plane = fakePlane({ getCalendarSyncToken: async () => ({ syncToken: "keep-me" }) });
    const { impl } = fakeFetch([{ status: 500, body: { error: { message: "boom" } } }]);

    const result = await runCalendarMirrorSyncOnce(plane, { tokens: TOKENS, fetchImpl: impl });

    expect(result.status).toBe("failed");
    expect(plane.recorded).toEqual([
      expect.objectContaining({ syncToken: "keep-me", meta: expect.objectContaining({ status: "failed" }) }),
    ]);
  });

  it("does not persist a sync token when the mirror write failed", async () => {
    // Storing one here would assert we mirrored events we never stored, and
    // the next incremental sync would never revisit them.
    const plane = fakePlane({
      upsertCalendarEvents: async () => {
        throw new Error("convex down");
      },
    });
    const { impl } = fakeFetch([{ status: 200, body: { items: [{ id: "a" }], nextSyncToken: "s1" } }]);

    const result = await runCalendarMirrorSyncOnce(plane, { tokens: TOKENS, fetchImpl: impl });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("mirror upsert failed");
    expect(plane.recorded[0]?.syncToken).toBeNull();
  });

  it("reports missing credentials instead of throwing at the timer", async () => {
    const plane = fakePlane();
    const result = await runCalendarMirrorSyncOnce(plane, {
      tokens: {
        getAccessToken: async () => {
          throw new Error("no refresh token on disk");
        },
      } as never,
      fetchImpl: fakeFetch([]).impl,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Google credentials unavailable");
  });
});
