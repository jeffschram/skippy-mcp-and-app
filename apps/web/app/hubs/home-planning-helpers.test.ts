import { describe, expect, it } from "vitest";
import { homePeriods, parseHomeHash } from "./home-planning-helpers";

describe("Home links and civil periods", () => {
  it("resolves all canonical legacy hashes and rejects unrelated hashes", () => {
    for (const kind of ["task", "recurrence", "event"]) expect(parseHomeHash(`#${kind}-abc`)).toEqual({ kind, id: "abc" });
    expect(parseHomeHash("#task-")).toBeNull(); expect(parseHomeHash("#settings")).toBeNull();
  });
  it("ends the week next Monday, including an empty remainder on Sunday", () => {
    const sunday = homePeriods(new Date(2026, 10, 8, 12).getTime());
    expect(sunday.weekEnd).toBe(sunday.tomorrow);
    const monday = homePeriods(new Date(2026, 10, 9, 12).getTime());
    expect(new Date(monday.weekEnd).getDay()).toBe(1);
    expect(new Date(monday.weekEnd).getDate()).toBe(16);
  });
  it("uses civil dates across DST rather than fixed day durations", () => {
    const oldZone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const spring = homePeriods(new Date(2026, 2, 8, 12).getTime());
      const fall = homePeriods(new Date(2026, 10, 1, 12).getTime());
      expect(spring.tomorrow - spring.start).toBe(23 * 3600000);
      expect(fall.tomorrow - fall.start).toBe(25 * 3600000);
      expect(new Date(spring.utcToday).toISOString()).toBe("2026-03-08T00:00:00.000Z");
    } finally { if (oldZone === undefined) delete process.env.TZ; else process.env.TZ = oldZone; }
  });
});
