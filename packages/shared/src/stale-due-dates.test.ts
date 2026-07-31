import { describe, expect, it } from "vitest";
import {
  STALE_DUE_DATE_THRESHOLD_DAYS,
  normalizeAcceptedEntityPayload,
  repairStaleDueDate,
} from "./index";

/* ------------------------------------------------------------------ */
/* Stale due-date repair                                               */
/*                                                                     */
/* Observed live: six freshly ingested tasks carried a dueAt exactly    */
/* one year in the past. Recurring Google Calendar events report the    */
/* series' FIRST occurrence rather than the next one, and gmail dates   */
/* were mis-yeared the same way. Every case was corrected by rolling    */
/* forward whole years.                                                 */
/* ------------------------------------------------------------------ */

const NOW = Date.parse("2026-07-30T12:00:00.000Z");
const DAY = 86_400_000;
const iso = (t: number | undefined) => (t === undefined ? undefined : new Date(t).toISOString().slice(0, 10));

describe("repairStaleDueDate", () => {
  // The exact rows found in production.
  it.each([
    ["mortgage (calendar)", "2025-08-01", "2026-08-01"],
    ["Optimum bill (calendar)", "2025-07-31", "2026-07-31"],
    ["Amazon delivery (gmail)", "2025-08-14", "2026-08-14"],
    ["Loom trial (gmail)", "2025-07-21", "2026-07-21"],
  ])("repairs %s", (_label, bad, expected) => {
    expect(iso(repairStaleDueDate(Date.parse(`${bad}T12:00:00.000Z`), NOW))).toBe(expected);
  });

  it("preserves month and day so a 'due the 1st' obligation stays on the 1st", () => {
    const repaired = repairStaleDueDate(Date.parse("2024-03-01T09:30:00.000Z"), NOW)!;
    const asDate = new Date(repaired);
    expect(asDate.getUTCMonth()).toBe(2);
    expect(asDate.getUTCDate()).toBe(1);
    expect(asDate.getUTCHours()).toBe(9);
  });

  it("rolls forward multiple years until the date is current", () => {
    expect(iso(repairStaleDueDate(Date.parse("2023-09-15T12:00:00.000Z"), NOW))).toBe("2026-09-15");
  });

  it("clamps Feb 29 to Feb 28 rather than sliding into March", () => {
    // 2024-02-29 lands on 2026, which is not a leap year. Naive year addition
    // would produce March 1; it must clamp to Feb 28 instead.
    const repaired = repairStaleDueDate(Date.parse("2024-02-29T12:00:00.000Z"), NOW)!;
    expect(iso(repaired)).toBe("2026-02-28");
  });

  it("keeps Feb 29 when it rolls into a leap year", () => {
    // From a 2026 vantage point, 2023-02-28 has no leap ambiguity; use a case
    // that genuinely lands on a leap year to prove the day is not over-clamped.
    const repaired = repairStaleDueDate(Date.parse("2020-02-29T12:00:00.000Z"), Date.parse("2028-06-01T00:00:00.000Z"))!;
    expect(iso(repaired)).toBe("2028-02-29");
  });

  /* --- the false-positive guard: genuinely overdue work must survive --- */

  it("leaves a recently overdue date untouched", () => {
    const yesterday = NOW - DAY;
    expect(repairStaleDueDate(yesterday, NOW)).toBe(yesterday);
  });

  it("leaves work overdue by a month untouched", () => {
    const lastMonth = NOW - 30 * DAY;
    expect(repairStaleDueDate(lastMonth, NOW)).toBe(lastMonth);
  });

  it("does not fire just inside the threshold", () => {
    const justInside = NOW - (STALE_DUE_DATE_THRESHOLD_DAYS - 1) * DAY;
    expect(repairStaleDueDate(justInside, NOW)).toBe(justInside);
  });

  it("leaves future dates untouched", () => {
    const future = NOW + 45 * DAY;
    expect(repairStaleDueDate(future, NOW)).toBe(future);
  });

  it("never returns a date that is still stale", () => {
    const staleBefore = NOW - STALE_DUE_DATE_THRESHOLD_DAYS * DAY;
    for (const year of [2019, 2020, 2021, 2022, 2023, 2024, 2025]) {
      const repaired = repairStaleDueDate(Date.parse(`${year}-06-15T12:00:00.000Z`), NOW)!;
      expect(repaired).toBeGreaterThanOrEqual(staleBefore);
    }
  });

  it("passes through absent and non-finite values", () => {
    expect(repairStaleDueDate(undefined, NOW)).toBeUndefined();
    expect(repairStaleDueDate(Number.NaN, NOW)).toBeNaN();
  });

  // Decades-old dates are more likely a data error than a wrong year; inventing
  // a plausible-looking date would hide the problem.
  it("leaves an implausibly ancient date alone", () => {
    const ancient = Date.parse("1975-01-01T00:00:00.000Z");
    expect(repairStaleDueDate(ancient, NOW)).toBe(ancient);
  });
});

describe("task normalization applies the repair", () => {
  it("repairs a stale dueAt coming through ingestion", () => {
    const normalized = normalizeAcceptedEntityPayload(
      "task",
      { title: "Mortgage payment due", dueAt: Date.parse("2025-08-01T12:00:00.000Z") },
      NOW,
    ) as { dueAt?: number };

    expect(iso(normalized.dueAt)).toBe("2026-08-01");
  });

  it("repairs a stale date supplied as a string", () => {
    const normalized = normalizeAcceptedEntityPayload(
      "task",
      { title: "Optimum bill", dueDate: "2025-07-31" },
      NOW,
    ) as { dueAt?: number };

    expect(iso(normalized.dueAt)).toBe("2026-07-31");
  });

  it("leaves a genuinely overdue task overdue", () => {
    const overdue = NOW - 3 * DAY;
    const normalized = normalizeAcceptedEntityPayload(
      "task",
      { title: "Fix the cookie issue", dueAt: overdue },
      NOW,
    ) as { dueAt?: number };

    expect(normalized.dueAt).toBe(overdue);
  });

  it("leaves tasks with no due date alone", () => {
    const normalized = normalizeAcceptedEntityPayload("task", { title: "Someday" }, NOW) as {
      dueAt?: number;
    };

    expect(normalized.dueAt).toBeUndefined();
  });
});
