import { describe, expect, it } from "vitest";

import {
  calendarSummariesSimilar,
  calendarWindowsCollide,
  findDuplicatePendingProposal,
  groupDuplicatePendingCalendarActions,
  isDuplicateCalendarProposal,
  normalizeCalendarSummary,
  type PendingCalendarProposal,
} from "./calendarDedupeHelpers";

const T0 = Date.parse("2026-09-10T18:00:00.000Z");
const HOUR = 60 * 60_000;

function proposal(overrides: Partial<PendingCalendarProposal> = {}): PendingCalendarProposal {
  return {
    id: "p1",
    calendarId: "primary",
    summary: "Dinner with Sam",
    start: T0,
    end: T0 + HOUR,
    createdAt: T0 - 24 * HOUR,
    ...overrides,
  };
}

describe("normalizeCalendarSummary", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeCalendarSummary("  Dinner w/ Sam!!  ")).toBe("dinner w sam");
    expect(normalizeCalendarSummary("JetBlue 1023 — JFK → LAX")).toBe("jetblue 1023 jfk lax");
  });
});

describe("calendarSummariesSimilar", () => {
  it("matches identical summaries modulo punctuation and case", () => {
    expect(calendarSummariesSimilar("Dinner w/ Sam", "dinner w sam")).toBe(true);
  });

  it("matches by containment", () => {
    expect(calendarSummariesSimilar("Jury duty", "Jury duty (report by 8am)")).toBe(true);
  });

  it("matches by token overlap", () => {
    expect(calendarSummariesSimilar("JetBlue 1023 JFK LAX", "JetBlue flight 1023")).toBe(true);
  });

  it("rejects unrelated summaries in the same window", () => {
    expect(calendarSummariesSimilar("Dentist", "Team standup")).toBe(false);
  });

  it("only matches empty summaries against each other", () => {
    expect(calendarSummariesSimilar("", "")).toBe(true);
    expect(calendarSummariesSimilar("", "Dentist")).toBe(false);
  });
});

describe("calendarWindowsCollide", () => {
  it("collides on exact start even for zero-length windows", () => {
    expect(calendarWindowsCollide({ start: T0, end: T0 }, { start: T0, end: T0 })).toBe(true);
  });

  it("collides on partial overlap", () => {
    expect(
      calendarWindowsCollide(
        { start: T0, end: T0 + HOUR },
        { start: T0 + HOUR / 2, end: T0 + 2 * HOUR },
      ),
    ).toBe(true);
  });

  it("does not collide on back-to-back windows (half-open)", () => {
    expect(
      calendarWindowsCollide({ start: T0, end: T0 + HOUR }, { start: T0 + HOUR, end: T0 + 2 * HOUR }),
    ).toBe(false);
  });
});

describe("isDuplicateCalendarProposal", () => {
  it("requires calendar + window + summary together", () => {
    const base = proposal();
    expect(isDuplicateCalendarProposal(base, proposal({ id: "p2" }))).toBe(true);
    expect(isDuplicateCalendarProposal(base, proposal({ id: "p2", calendarId: "work" }))).toBe(false);
    expect(
      isDuplicateCalendarProposal(base, proposal({ id: "p2", start: T0 + 2 * HOUR, end: T0 + 3 * HOUR })),
    ).toBe(false);
    // Same hour, different meeting: the weekly-1:1 case the calendar module
    // refuses to collapse — summary must differ enough to survive.
    expect(isDuplicateCalendarProposal(base, proposal({ id: "p2", summary: "Team standup" }))).toBe(false);
  });
});

describe("findDuplicatePendingProposal", () => {
  it("returns the newest matching pending proposal", () => {
    const older = proposal({ id: "old", createdAt: T0 - 48 * HOUR });
    const newer = proposal({ id: "new", createdAt: T0 - 1 * HOUR });
    expect(findDuplicatePendingProposal(proposal(), [older, newer])?.id).toBe("new");
  });

  it("returns null when nothing matches", () => {
    expect(
      findDuplicatePendingProposal(proposal(), [proposal({ id: "p2", summary: "Team standup" })]),
    ).toBeNull();
  });
});

describe("groupDuplicatePendingCalendarActions", () => {
  it("keeps the newest of each duplicate group and sweeps the rest", () => {
    const rows = [
      proposal({ id: "a1", createdAt: 1 }),
      proposal({ id: "a2", createdAt: 2 }),
      proposal({ id: "a3", createdAt: 3 }),
      proposal({ id: "b1", summary: "Team standup", createdAt: 4 }),
    ];
    const groups = groupDuplicatePendingCalendarActions(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.keep.id).toBe("a3");
    expect(groups[0]?.sweep.map((row) => row.id).sort()).toEqual(["a1", "a2"]);
  });

  it("returns no groups when every proposal is distinct", () => {
    const rows = [
      proposal({ id: "a" }),
      proposal({ id: "b", summary: "Team standup" }),
      proposal({ id: "c", start: T0 + 5 * HOUR, end: T0 + 6 * HOUR }),
    ];
    expect(groupDuplicatePendingCalendarActions(rows)).toHaveLength(0);
  });

  it("compares against the group keeper so similarity cannot chain", () => {
    // b overlaps a's window and c overlaps b's, but c does not overlap a:
    // c must start its own group rather than be swept transitively.
    const rows = [
      proposal({ id: "a", start: T0, end: T0 + 2 * HOUR, createdAt: 30 }),
      proposal({ id: "b", start: T0 + HOUR, end: T0 + 3 * HOUR, createdAt: 20 }),
      proposal({ id: "c", start: T0 + 2 * HOUR + 1, end: T0 + 4 * HOUR, createdAt: 10 }),
    ];
    const groups = groupDuplicatePendingCalendarActions(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.keep.id).toBe("a");
    expect(groups[0]?.sweep.map((row) => row.id)).toEqual(["b"]);
  });
});
