import { describe, expect, it } from "vitest";
import {
  CALENDAR_DESCRIPTION_LIMIT,
  CALENDAR_MAX_ATTENDEES,
  GOOGLE_EVENT_ID_ALPHABET,
  SKIPPY_EVENT_ID_PREFIX,
  isSkippyMintedEventId,
  isValidGoogleEventId,
  mintGoogleEventId,
  normalizeGoogleEvent,
  planCalendarEventWrite,
  truncateDescription,
  type NormalizedCalendarEvent,
} from "./calendar";

const NOW = Date.parse("2026-07-25T12:00:00.000Z");

function googleEvent(overrides: Record<string, any> = {}) {
  return {
    id: "abc123",
    etag: '"etag-1"',
    summary: "Dentist",
    status: "confirmed",
    start: { dateTime: "2026-07-28T17:00:00.000Z", timeZone: "America/Los_Angeles" },
    end: { dateTime: "2026-07-28T18:00:00.000Z" },
    htmlLink: "https://calendar.google.com/event?eid=abc123",
    ...overrides,
  };
}

describe("Google event ids", () => {
  // The whole point: Google rejects anything outside base32hex, and 'y' in
  // "skippy" would be a runtime insert failure rather than a type error.
  it("uses only base32hex characters in the prefix", () => {
    for (const character of SKIPPY_EVENT_ID_PREFIX) {
      expect(GOOGLE_EVENT_ID_ALPHABET).toContain(character);
    }
    expect(GOOGLE_EVENT_ID_ALPHABET).not.toContain("w");
    expect(GOOGLE_EVENT_ID_ALPHABET).not.toContain("y");
  });

  it("mints ids Google will accept", () => {
    const id = mintGoogleEventId();
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(isValidGoogleEventId(id)).toBe(true);
    expect(isSkippyMintedEventId(id)).toBe(true);
  });

  it("mints distinct ids across many draws", () => {
    const ids = new Set(Array.from({ length: 500 }, () => mintGoogleEventId()));
    expect(ids.size).toBe(500);
  });

  it("stays in range at the extremes of the random source", () => {
    expect(mintGoogleEventId(() => 0)).toMatch(/^[0-9a-v]+$/);
    // Math.random() never returns 1, but a sloppy injected source might.
    expect(mintGoogleEventId(() => 0.999999999)).toMatch(/^[0-9a-v]+$/);
    expect(mintGoogleEventId(() => 1)).toMatch(/^[0-9a-v]+$/);
  });

  it("rejects ids Google would refuse", () => {
    expect(isValidGoogleEventId("skippy-123")).toBe(false); // hyphen and 'y'
    expect(isValidGoogleEventId("ABC123")).toBe(false); // uppercase
    expect(isValidGoogleEventId("abc")).toBe(false); // too short
    expect(isValidGoogleEventId(42)).toBe(false);
  });
});

describe("truncateDescription", () => {
  it("keeps short descriptions intact", () => {
    expect(truncateDescription("  Bring the X-rays  ")).toBe("Bring the X-rays");
  });

  it("truncates long descriptions rather than storing them whole", () => {
    const long = "x".repeat(CALENDAR_DESCRIPTION_LIMIT + 200);
    const result = truncateDescription(long) ?? "";
    expect(result.length).toBe(CALENDAR_DESCRIPTION_LIMIT + 1);
    expect(result.endsWith("…")).toBe(true);
  });

  it("drops empty and non-string values", () => {
    expect(truncateDescription("   ")).toBeUndefined();
    expect(truncateDescription(undefined)).toBeUndefined();
    expect(truncateDescription(12)).toBeUndefined();
  });
});

describe("normalizeGoogleEvent", () => {
  it("maps a timed event", () => {
    const normalized = normalizeGoogleEvent(googleEvent(), "primary");
    expect(normalized).toMatchObject({
      sourceSystem: "google_calendar",
      calendarId: "primary",
      externalId: "abc123",
      title: "Dentist",
      status: "confirmed",
      startAt: Date.parse("2026-07-28T17:00:00.000Z"),
      endAt: Date.parse("2026-07-28T18:00:00.000Z"),
      timeZone: "America/Los_Angeles",
    });
    expect(normalized?.isAllDay).toBeUndefined();
  });

  it("flags all-day events instead of treating them as midnight meetings", () => {
    const normalized = normalizeGoogleEvent(
      googleEvent({ start: { date: "2026-07-28" }, end: { date: "2026-07-29" } }),
      "primary",
    );
    expect(normalized?.isAllDay).toBe(true);
    expect(normalized?.startAt).toBe(Date.parse("2026-07-28T00:00:00.000Z"));
  });

  it("keeps recurring-instance identity fields", () => {
    const normalized = normalizeGoogleEvent(
      googleEvent({
        id: "series_20260728",
        recurringEventId: "series",
        originalStartTime: { dateTime: "2026-07-28T17:00:00.000Z" },
      }),
      "primary",
    );
    expect(normalized).toMatchObject({
      recurringEventId: "series",
      originalStartAt: Date.parse("2026-07-28T17:00:00.000Z"),
    });
  });

  it("marks a master event carrying an RRULE", () => {
    const normalized = normalizeGoogleEvent(
      googleEvent({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"] }),
      "primary",
    );
    expect(normalized?.isMaster).toBe(true);
    expect(normalized?.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TU"]);
  });

  it("truncates descriptions on the way in", () => {
    const normalized = normalizeGoogleEvent(
      googleEvent({ description: "y".repeat(CALENDAR_DESCRIPTION_LIMIT + 50) }),
      "primary",
    );
    expect((normalized?.description ?? "").length).toBe(CALENDAR_DESCRIPTION_LIMIT + 1);
  });

  it("keeps small attendee lists and drops large ones", () => {
    const small = normalizeGoogleEvent(
      googleEvent({ attendees: [{ email: "dan@example.com", responseStatus: "accepted" }] }),
      "primary",
    );
    expect(small?.attendees).toEqual([{ email: "dan@example.com", responseStatus: "accepted" }]);

    const huge = normalizeGoogleEvent(
      googleEvent({
        attendees: Array.from({ length: CALENDAR_MAX_ATTENDEES + 1 }, (_, i) => ({
          email: `person${i}@example.com`,
        })),
      }),
      "primary",
    );
    expect(huge?.attendees).toBeUndefined();
  });

  // One bad event must not fail an entire sync batch.
  it("returns null for unusable events rather than throwing", () => {
    expect(normalizeGoogleEvent(null, "primary")).toBeNull();
    expect(normalizeGoogleEvent({ summary: "no id" }, "primary")).toBeNull();
    expect(normalizeGoogleEvent(googleEvent({ start: undefined }), "primary")).toBeNull();
  });

  // Incremental sync delivers deletions as bare tombstones.
  it("keeps a cancelled tombstone even with no times", () => {
    const normalized = normalizeGoogleEvent({ id: "abc123", status: "cancelled" }, "primary");
    expect(normalized).toMatchObject({ externalId: "abc123", status: "cancelled" });
  });

  it("never lets end precede start", () => {
    const normalized = normalizeGoogleEvent(
      googleEvent({ end: { dateTime: "2026-07-28T16:00:00.000Z" } }),
      "primary",
    );
    expect(normalized!.endAt).toBe(normalized!.startAt);
  });
});

describe("planCalendarEventWrite", () => {
  const incoming = normalizeGoogleEvent(googleEvent(), "primary") as NormalizedCalendarEvent;

  it("inserts an unseen event as google-origin", () => {
    const plan = planCalendarEventWrite(null, incoming, NOW);
    expect(plan.action).toBe("insert");
    expect(plan).toMatchObject({
      doc: { origin: "google", remoteState: "synced", externalId: "abc123", createdAt: NOW },
    });
  });

  it("patches a known event without duplicating it", () => {
    const plan = planCalendarEventWrite({ origin: "google", remoteState: "synced" }, incoming, NOW);
    expect(plan.action).toBe("patch");
    expect(plan).toMatchObject({ isEcho: false, patch: { origin: "google", lastSyncedAt: NOW } });
  });

  // The bug the owner raised: Skippy adds an event, the scheduled ingest reads
  // it back, and treats its own write as new information.
  it("recognizes its own write as an echo rather than new information", () => {
    const plan = planCalendarEventWrite(
      { origin: "skippy", remoteState: "pending_remote" },
      incoming,
      NOW,
    );

    expect(plan.action).toBe("patch");
    expect(plan).toMatchObject({ isEcho: true, patch: { origin: "skippy", remoteState: "synced" } });
  });

  it("stops reporting an echo once the row has settled", () => {
    const plan = planCalendarEventWrite({ origin: "skippy", remoteState: "synced" }, incoming, NOW);
    expect(plan).toMatchObject({ isEcho: false });
  });

  it("never downgrades a skippy-created event to google origin", () => {
    const plan = planCalendarEventWrite({ origin: "skippy", remoteState: "synced" }, incoming, NOW);
    expect(plan).toMatchObject({ patch: { origin: "skippy" } });
  });

  // Owner-authored local state must survive a sync.
  it("leaves owner-authored fields out of the patch entirely", () => {
    const plan = planCalendarEventWrite(
      {
        origin: "google",
        remoteState: "synced",
        relatedEntityRefs: [{ entityType: "project", entityId: "p1" }],
        focusSnoozedUntil: 999,
      },
      incoming,
      NOW,
    );

    expect(plan.action).toBe("patch");
    if (plan.action !== "patch") return;
    expect(plan.patch).not.toHaveProperty("relatedEntityRefs");
    expect(plan.patch).not.toHaveProperty("focusSnoozedUntil");
  });

  it("clears a stale remote error once the event syncs", () => {
    const plan = planCalendarEventWrite(
      { origin: "skippy", remoteState: "remote_failed" },
      incoming,
      NOW,
    );
    expect(plan).toMatchObject({ patch: { remoteState: "synced", remoteError: undefined } });
  });

  it("carries a cancellation through as a tombstone patch", () => {
    const cancelled = normalizeGoogleEvent(
      { id: "abc123", status: "cancelled" },
      "primary",
    ) as NormalizedCalendarEvent;
    const plan = planCalendarEventWrite({ origin: "google", remoteState: "synced" }, cancelled, NOW);
    expect(plan).toMatchObject({ action: "patch", patch: { status: "cancelled" } });
  });

  // Two events in a weekly series share a title and differ only by identity.
  it("keeps sibling instances of a series distinct", () => {
    const first = normalizeGoogleEvent(
      googleEvent({ id: "series_0728", recurringEventId: "series" }),
      "primary",
    ) as NormalizedCalendarEvent;
    const second = normalizeGoogleEvent(
      googleEvent({
        id: "series_0804",
        recurringEventId: "series",
        start: { dateTime: "2026-08-04T17:00:00.000Z" },
        end: { dateTime: "2026-08-04T18:00:00.000Z" },
      }),
      "primary",
    ) as NormalizedCalendarEvent;

    expect(first.title).toBe(second.title);
    expect(first.externalId).not.toBe(second.externalId);
    // Each resolves against its own row, so neither collapses into the other.
    expect(planCalendarEventWrite(null, first, NOW).action).toBe("insert");
    expect(planCalendarEventWrite(null, second, NOW).action).toBe("insert");
  });
});
