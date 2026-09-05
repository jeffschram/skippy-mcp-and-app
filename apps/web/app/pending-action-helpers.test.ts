import { describe, expect, it } from "vitest";
import { formatEventWhen, parseCalendarActionBody } from "./pending-action-helpers";

// All fixtures pin timeZone so results don't depend on the machine running
// the tests. 6:30 PM America/New_York on Sep 10 2026 is 22:30 UTC (EDT).
const TZ = "America/New_York";

describe("parseCalendarActionBody", () => {
  it("decodes a calendar_event_create body", () => {
    const payload = {
      summary: "Movie night with Holly",
      location: "Cedar Point Yacht Club",
      start: Date.UTC(2026, 8, 10, 22, 30),
      end: Date.UTC(2026, 8, 11, 1, 0),
      isAllDay: false,
      timeZone: TZ,
    };
    expect(
      parseCalendarActionBody({ actionType: "calendar_event_create", body: JSON.stringify(payload) }),
    ).toEqual(payload);
  });

  it("returns null for non-calendar actions", () => {
    expect(parseCalendarActionBody({ actionType: "send_message", body: "{}" })).toBeNull();
  });

  it("returns null (not a throw) for malformed bodies so the raw text can render", () => {
    expect(parseCalendarActionBody({ actionType: "calendar_event_create", body: "not json" })).toBeNull();
    expect(parseCalendarActionBody({ actionType: "calendar_event_create", body: "[1,2]" })).toBeNull();
    expect(parseCalendarActionBody({ actionType: "calendar_event_create", body: undefined })).toBeNull();
  });
});

describe("formatEventWhen", () => {
  it("formats a same-day timed event, crossing UTC midnight in the event zone", () => {
    expect(
      formatEventWhen({
        start: Date.UTC(2026, 8, 10, 22, 30), // Sep 10, 6:30 PM EDT
        end: Date.UTC(2026, 8, 11, 1, 0), // Sep 10, 9:00 PM EDT (Sep 11 UTC)
        timeZone: TZ,
      }),
    ).toBe("Thu, Sep 10 · 6:30 PM – 9:00 PM");
  });

  it("formats an all-day event", () => {
    expect(
      formatEventWhen({
        start: Date.UTC(2026, 9, 27, 4), // Oct 27 midnight EDT
        end: Date.UTC(2026, 9, 28, 4),
        isAllDay: true,
        timeZone: TZ,
      }),
    ).toBe("Tue, Oct 27 · All day");
  });

  it("spells out both days when an event crosses local midnight", () => {
    expect(
      formatEventWhen({
        start: Date.UTC(2026, 8, 11, 3), // Sep 10, 11:00 PM EDT
        end: Date.UTC(2026, 8, 11, 5), // Sep 11, 1:00 AM EDT
        timeZone: TZ,
      }),
    ).toBe("Thu, Sep 10, 11:00 PM – Fri, Sep 11, 1:00 AM");
  });

  it("degrades gracefully with missing fields", () => {
    expect(formatEventWhen({ timeZone: TZ })).toBe("");
    expect(
      formatEventWhen({ start: Date.UTC(2026, 8, 10, 22, 30), timeZone: TZ }),
    ).toBe("Thu, Sep 10 · 6:30 PM");
  });
});
