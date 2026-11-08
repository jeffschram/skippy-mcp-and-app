import { describe, expect, it } from "vitest";
import { homePeriods, parseHomeHash } from "./home-planning-helpers";

describe("Home links and civil periods", () => {
  it("resolves all canonical legacy hashes and rejects unrelated hashes", () => {
    for (const kind of ["task", "recurrence", "event", "review"]) expect(parseHomeHash(`#${kind}-abc`)).toEqual({ kind, id: "abc" });
    expect(parseHomeHash("#task-")).toBeNull(); expect(parseHomeHash("#settings")).toBeNull();
  });
  it("includes seven upcoming dates on every weekday, including Sunday", () => {
    for (let date = 8; date <= 14; date++) {
      const period = homePeriods(new Date(2026, 10, date, 12).getTime());
      expect(period.tomorrow).toBe(new Date(2026, 10, date + 1).getTime());
      expect(period.weekEnd).toBe(new Date(2026, 10, date + 8).getTime());
      expect(period.utcWeekEnd - period.utcTomorrow).toBe(7 * 86400000);
    }
  });
  it("uses civil dates across DST rather than fixed day durations", () => {
    const oldZone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const spring = homePeriods(new Date(2026, 2, 8, 12).getTime());
      const fall = homePeriods(new Date(2026, 10, 1, 12).getTime());
      const crossing = homePeriods(new Date(2026, 2, 6, 12).getTime());
      expect(crossing.weekEnd - crossing.tomorrow).toBe((7 * 24 - 1) * 3600000);
      expect(crossing.utcWeekEnd - crossing.utcTomorrow).toBe(7 * 86400000);
      expect(spring.tomorrow - spring.start).toBe(23 * 3600000);
      expect(fall.tomorrow - fall.start).toBe(25 * 3600000);
      expect(new Date(spring.utcToday).toISOString()).toBe("2026-03-08T00:00:00.000Z");
    } finally { if (oldZone === undefined) delete process.env.TZ; else process.env.TZ = oldZone; }
  });
});
