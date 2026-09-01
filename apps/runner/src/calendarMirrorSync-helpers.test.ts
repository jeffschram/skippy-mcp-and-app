import { describe, expect, it } from "vitest";

import {
  buildInitialRequest,
  chunkEvents,
  decidePage,
  FULL_SYNC_LOOKAHEAD_MS,
  FULL_SYNC_LOOKBACK_MS,
  MAX_PAGES_PER_RUN,
  MAX_PAGE_SIZE,
  nextPageRequest,
} from "./calendarMirrorSync-helpers.js";

const NOW = Date.UTC(2026, 8, 1, 12, 0);

describe("buildInitialRequest", () => {
  it("asks for a bounded window when there is no stored token", () => {
    const request = buildInitialRequest({ now: NOW });
    expect(request.timeMin).toBe(NOW - FULL_SYNC_LOOKBACK_MS);
    expect(request.timeMax).toBe(NOW + FULL_SYNC_LOOKAHEAD_MS);
    expect(request.syncToken).toBeUndefined();
  });

  it("sends the token and NO window when one is stored", () => {
    // Google answers 400 for syncToken + timeMin/timeMax rather than ignoring
    // the window, so this is correctness rather than tidiness.
    const request = buildInitialRequest({ now: NOW, syncToken: "tok" });
    expect(request.syncToken).toBe("tok");
    expect(request.timeMin).toBeUndefined();
    expect(request.timeMax).toBeUndefined();
  });

  it("always pins singleEvents and showDeleted", () => {
    // singleEvents must not vary across a token's lifetime — Google
    // invalidates the token if it does, silently degrading every incremental
    // sync into a full one.
    for (const request of [buildInitialRequest({ now: NOW }), buildInitialRequest({ now: NOW, syncToken: "t" })]) {
      expect(request.singleEvents).toBe(true);
      expect(request.showDeleted).toBe(true);
    }
  });

  it("clamps maxResults to Google's ceiling", () => {
    expect(buildInitialRequest({ now: NOW, maxResults: 5_000 }).maxResults).toBe(MAX_PAGE_SIZE);
    expect(buildInitialRequest({ now: NOW, maxResults: 10 }).maxResults).toBe(10);
  });

  it("treats a null token like no token", () => {
    expect(buildInitialRequest({ now: NOW, syncToken: null }).timeMin).toBe(NOW - FULL_SYNC_LOOKBACK_MS);
  });
});

describe("nextPageRequest", () => {
  it("carries the whole request forward, not just the page token", () => {
    // A pageToken alone is not a complete request; dropping the window
    // mid-walk would silently widen the sync.
    const first = buildInitialRequest({ now: NOW });
    const second = nextPageRequest(first, "p2");
    expect(second).toEqual({ ...first, pageToken: "p2" });
  });
});

describe("decidePage", () => {
  const ok = (extra: Record<string, unknown> = {}) =>
    ({ status: "ok" as const, events: [], ...extra });

  it("continues while there is a next page", () => {
    expect(decidePage(ok({ nextPageToken: "p2" }), { pagesFetched: 1, alreadyRestarted: false })).toEqual({
      kind: "continue",
      pageToken: "p2",
    });
  });

  it("finishes with the sync token on the last page", () => {
    expect(decidePage(ok({ nextSyncToken: "s2" }), { pagesFetched: 3, alreadyRestarted: false })).toEqual({
      kind: "done",
      syncToken: "s2",
    });
  });

  it("restarts full on an expired token", () => {
    expect(decidePage({ status: "sync_token_expired" }, { pagesFetched: 0, alreadyRestarted: false })).toEqual({
      kind: "restart_full",
    });
  });

  it("does not loop restarting: a second 410 is a real failure", () => {
    expect(decidePage({ status: "sync_token_expired" }, { pagesFetched: 1, alreadyRestarted: true })).toEqual({
      kind: "fail",
      error: "sync token expired during a full resync",
    });
  });

  it("stops WITHOUT a token at the page cap", () => {
    // Persisting a token here would claim we saw the whole calendar; leaving
    // it unset makes the next run redo the window instead of skipping it.
    const decision = decidePage(ok({ nextPageToken: "p2", nextSyncToken: "s2" }), {
      pagesFetched: MAX_PAGES_PER_RUN,
      alreadyRestarted: false,
    });
    expect(decision).toEqual({ kind: "done", syncToken: undefined });
  });

  it("propagates a hard failure", () => {
    expect(decidePage({ status: "failed", error: "HTTP 403" }, { pagesFetched: 0, alreadyRestarted: false })).toEqual({
      kind: "fail",
      error: "HTTP 403",
    });
  });
});

describe("chunkEvents", () => {
  it("splits into batches and never emits an empty one", () => {
    expect(chunkEvents([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkEvents([], 2)).toEqual([]);
  });

  it("rejects a non-positive size instead of looping forever", () => {
    expect(() => chunkEvents([1], 0)).toThrow(/positive/);
  });
});
