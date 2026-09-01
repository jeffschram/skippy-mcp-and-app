import { describe, expect, it } from "vitest";

import {
  buildEventResource,
  EventValidationError,
  formatUtcDate,
  resolveCalendarId,
  type CreateEventInput,
} from "./event.js";

const BASE: CreateEventInput = {
  summary: "Coffee with Helen",
  start: Date.UTC(2026, 8, 2, 19, 0),
  end: Date.UTC(2026, 8, 2, 20, 0),
};

describe("buildEventResource — timed events", () => {
  it("emits RFC3339 instants", () => {
    const r = buildEventResource(BASE);
    expect(r).toEqual({
      summary: "Coffee with Helen",
      start: { dateTime: "2026-09-02T19:00:00.000Z" },
      end: { dateTime: "2026-09-02T20:00:00.000Z" },
    });
  });

  it("carries the time zone alongside the instant", () => {
    const r = buildEventResource({ ...BASE, timeZone: "America/Chicago" });
    expect(r.start).toEqual({
      dateTime: "2026-09-02T19:00:00.000Z",
      timeZone: "America/Chicago",
    });
  });

  it("includes optional fields only when non-empty", () => {
    const r = buildEventResource({ ...BASE, description: "  ", location: "Cafe" });
    expect(r.description).toBeUndefined();
    expect(r.location).toBe("Cafe");
  });

  it("rejects a zero-length timed event", () => {
    expect(() => buildEventResource({ ...BASE, end: BASE.start })).toThrow(EventValidationError);
  });

  it("rejects an end before the start (mirrors the Convex guard)", () => {
    expect(() => buildEventResource({ ...BASE, end: BASE.start - 1 })).toThrow(
      /end cannot precede start/,
    );
  });

  it("rejects a missing summary", () => {
    expect(() => buildEventResource({ ...BASE, summary: "   " })).toThrow(/summary is required/);
  });

  it("rejects non-numeric times", () => {
    expect(() =>
      buildEventResource({ ...BASE, start: "2026-09-02" as unknown as number }),
    ).toThrow(/epoch-milliseconds/);
  });
});

describe("buildEventResource — all-day events", () => {
  const allDay: CreateEventInput = {
    summary: "Holly's birthday",
    start: Date.UTC(2026, 8, 2),
    end: Date.UTC(2026, 8, 2),
    isAllDay: true,
  };

  it("expands a same-day span to Google's exclusive end date", () => {
    // start === end is how callers spell "one day"; passing it through would be
    // a guaranteed 400 from Google.
    const r = buildEventResource(allDay);
    expect(r.start).toEqual({ date: "2026-09-02" });
    expect(r.end).toEqual({ date: "2026-09-03" });
  });

  it("keeps a genuine multi-day span", () => {
    const r = buildEventResource({ ...allDay, end: Date.UTC(2026, 8, 5) });
    expect(r.end).toEqual({ date: "2026-09-05" });
  });

  it("never emits a time zone for a floating date", () => {
    const r = buildEventResource({ ...allDay, timeZone: "America/Chicago" });
    expect(r.start).toEqual({ date: "2026-09-02" });
  });
});

describe("event ids", () => {
  it("passes through a Skippy-minted id", () => {
    const id = `skp${"0".repeat(24)}`;
    expect(buildEventResource({ ...BASE, eventId: id }).id).toBe(id);
  });

  it("omits the id when the caller lets Google allocate one", () => {
    expect(buildEventResource(BASE).id).toBeUndefined();
  });

  it("rejects ids outside base32hex before Google can", () => {
    // 'z' is not in the base32hex alphabet — a classic silent 400.
    expect(() => buildEventResource({ ...BASE, eventId: "skpzzzzz" })).toThrow(
      /invalid Google event id/,
    );
  });
});

describe("helpers", () => {
  it("defaults to the owner's primary calendar", () => {
    expect(resolveCalendarId(undefined)).toBe("primary");
    expect(resolveCalendarId("  ")).toBe("primary");
    expect(resolveCalendarId("work@example.com")).toBe("work@example.com");
  });

  it("formats all-day dates in UTC so they round-trip with the mirror", () => {
    expect(formatUtcDate(Date.UTC(2026, 0, 1))).toBe("2026-01-01");
  });
});
