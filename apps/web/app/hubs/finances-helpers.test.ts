import { describe, expect, it } from "vitest";
import {
  bucketTransactionsByDay,
  currentMonthKey,
  dateInputToEpochMs,
  dayLabel,
  dayRowHasEntries,
  daysInMonth,
  epochMsToDateInput,
  formatCents,
  formatSignedCents,
  monthKeyLabel,
  monthKeyShortLabel,
  parseDollarsToCents,
  shiftMonthKey,
  type GridTransaction,
} from "./finances-helpers";

function tx(overrides: Partial<GridTransaction>): GridTransaction {
  return {
    _id: "tx1",
    date: Date.UTC(2026, 3, 5),
    amountCents: 1000,
    description: "Sample",
    txType: "Food",
    category: "Groceries",
    ...overrides,
  };
}

describe("formatCents", () => {
  it("formats cents as dollars with thousands separators", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(100000000)).toBe("$1,000,000.00");
  });

  it("formats negative amounts with a leading minus", () => {
    expect(formatCents(-12000)).toBe("-$120.00");
  });
});

describe("formatSignedCents", () => {
  it("adds explicit signs for non-zero deltas", () => {
    expect(formatSignedCents(8500)).toBe("+$85.00");
    expect(formatSignedCents(-12000)).toBe("-$120.00");
    expect(formatSignedCents(0)).toBe("$0.00");
  });
});

describe("parseDollarsToCents", () => {
  it("parses plain and formatted dollar strings", () => {
    expect(parseDollarsToCents("1234.56")).toBe(123456);
    expect(parseDollarsToCents("$1,234.56")).toBe(123456);
    expect(parseDollarsToCents("12")).toBe(1200);
    expect(parseDollarsToCents("3.5")).toBe(350);
    expect(parseDollarsToCents("-120")).toBe(-12000);
    expect(parseDollarsToCents("0")).toBe(0);
  });

  it("rejects invalid input", () => {
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("1.234")).toBeNull();
    expect(parseDollarsToCents("1.2.3")).toBeNull();
    expect(parseDollarsToCents(".")).toBeNull();
  });
});

describe("month key helpers", () => {
  it("computes the current month key in UTC", () => {
    expect(currentMonthKey(Date.UTC(2026, 3, 15))).toBe("2026-04");
    // 2026-01-01T00:30Z is still December 31 in US timezones; monthKey is UTC.
    expect(currentMonthKey(Date.UTC(2026, 0, 1, 0, 30))).toBe("2026-01");
  });

  it("shifts month keys across year boundaries", () => {
    expect(shiftMonthKey("2026-04", 1)).toBe("2026-05");
    expect(shiftMonthKey("2026-04", -1)).toBe("2026-03");
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthKey("2025-12", 1)).toBe("2026-01");
    expect(shiftMonthKey("2026-04", -16)).toBe("2024-12");
  });

  it("labels months", () => {
    expect(monthKeyLabel("2026-04")).toBe("April 2026");
    expect(monthKeyShortLabel("2026-03")).toBe("Mar");
  });

  it("knows month lengths including leap years", () => {
    expect(daysInMonth("2026-04")).toBe(30);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2024-02")).toBe(29);
    expect(daysInMonth("2026-12")).toBe(31);
  });

  it("labels days as MM/DD", () => {
    expect(dayLabel("2026-04", 1)).toBe("04/01");
    expect(dayLabel("2026-11", 30)).toBe("11/30");
  });

  it("throws on malformed month keys", () => {
    expect(() => shiftMonthKey("2026-13", 1)).toThrow(/invalid monthKey/);
    expect(() => daysInMonth("garbage")).toThrow(/invalid monthKey/);
  });
});

describe("date input conversion", () => {
  it("round-trips date input values through UTC epoch ms", () => {
    const epoch = dateInputToEpochMs("2026-04-09");
    expect(epoch).toBe(Date.UTC(2026, 3, 9));
    expect(epochMsToDateInput(epoch!)).toBe("2026-04-09");
  });

  it("rejects malformed and overflow dates", () => {
    expect(dateInputToEpochMs("2026-4-9")).toBeNull();
    expect(dateInputToEpochMs("not a date")).toBeNull();
    expect(dateInputToEpochMs("2026-02-31")).toBeNull();
  });
});

describe("bucketTransactionsByDay", () => {
  it("produces every day of the month even when empty", () => {
    const rows = bucketTransactionsByDay("2026-04", []);
    expect(rows).toHaveLength(30);
    expect(rows[0]!.day).toBe(1);
    expect(rows[0]!.label).toBe("04/01");
    expect(rows[29]!.label).toBe("04/30");
    expect(rows.every((row) => Object.values(row.cells).every((cell) => cell.length === 0))).toBe(true);
  });

  it("buckets transactions into their UTC day and category", () => {
    const rows = bucketTransactionsByDay("2026-04", [
      tx({ _id: "a", date: Date.UTC(2026, 3, 2), category: "Groceries", txType: "Food" }),
      tx({ _id: "b", date: Date.UTC(2026, 3, 2), category: "Restaurants", txType: "Food" }),
      tx({ _id: "c", date: Date.UTC(2026, 3, 17), category: "Jeff", txType: "Income" }),
    ]);
    expect(rows[1]!.cells["Groceries"].map((t) => t._id)).toEqual(["a"]);
    expect(rows[1]!.cells["Restaurants"].map((t) => t._id)).toEqual(["b"]);
    expect(rows[16]!.cells["Jeff"].map((t) => t._id)).toEqual(["c"]);
    expect(rows[0]!.cells["Groceries"]).toHaveLength(0);
  });

  it("stacks multiple same-day transactions in insertion-stable date order", () => {
    const rows = bucketTransactionsByDay("2026-04", [
      tx({ _id: "later", date: Date.UTC(2026, 3, 10, 18), description: "Dinner" }),
      tx({ _id: "earlier", date: Date.UTC(2026, 3, 10, 8), description: "Breakfast" }),
    ]);
    expect(rows[9]!.cells["Groceries"].map((t) => t._id)).toEqual(["earlier", "later"]);
  });

  it("clamps out-of-month dates to the month's first/last day", () => {
    const rows = bucketTransactionsByDay("2026-04", [
      tx({ _id: "before", date: Date.UTC(2026, 2, 28) }),
      tx({ _id: "after", date: Date.UTC(2026, 4, 3) }),
    ]);
    expect(rows[0]!.cells["Groceries"].map((t) => t._id)).toEqual(["before"]);
    expect(rows[29]!.cells["Groceries"].map((t) => t._id)).toEqual(["after"]);
  });
});

describe("dayRowHasEntries", () => {
  it("is false for every row of an empty month", () => {
    const rows = bucketTransactionsByDay("2026-04", []);
    expect(rows.some(dayRowHasEntries)).toBe(false);
    expect(rows.filter(dayRowHasEntries)).toEqual([]);
  });

  it("keeps only days that hold at least one transaction when used as a filter", () => {
    const rows = bucketTransactionsByDay("2026-04", [
      tx({ _id: "a", date: Date.UTC(2026, 3, 2), category: "Groceries", txType: "Food" }),
      tx({ _id: "b", date: Date.UTC(2026, 3, 17), category: "Jeff", txType: "Income" }),
    ]);
    const active = rows.filter(dayRowHasEntries);
    expect(active.map((row) => row.day)).toEqual([2, 17]);
    expect(active.map((row) => row.label)).toEqual(["04/02", "04/17"]);
  });

  it("counts any category in the row, not just the first", () => {
    const rows = bucketTransactionsByDay("2026-04", [
      tx({ _id: "only", date: Date.UTC(2026, 3, 9), category: "Holly", txType: "Income" }),
    ]);
    expect(dayRowHasEntries(rows[8]!)).toBe(true);
    expect(dayRowHasEntries(rows[9]!)).toBe(false);
  });
});
