import { describe, expect, it } from "vitest";
import {
  endingBalancesByMonth,
  parseAprInput,
  projectFixedCostsAfterRetirements,
  visibleScheduleMonths,
} from "./finances-debts-helpers";

describe("parseAprInput", () => {
  it("accepts whole, one- and two-decimal percents with optional % sign", () => {
    expect(parseAprInput("22")).toBe(22);
    expect(parseAprInput("22.9")).toBe(22.9);
    expect(parseAprInput("26.24%")).toBe(26.24);
    expect(parseAprInput(" 0 ")).toBe(0);
    expect(parseAprInput("100")).toBe(100);
  });

  it("rejects out-of-range, negative, and malformed input", () => {
    expect(parseAprInput("100.01")).toBeNull();
    expect(parseAprInput("-5")).toBeNull();
    expect(parseAprInput("22.999")).toBeNull();
    expect(parseAprInput("abc")).toBeNull();
    expect(parseAprInput("")).toBeNull();
  });
});

describe("visibleScheduleMonths", () => {
  const keys = Array.from({ length: 50 }, (_, index) => `k${index}`);

  it("shows everything when at or under the cap", () => {
    expect(visibleScheduleMonths(keys.slice(0, 36))).toEqual({
      visible: keys.slice(0, 36),
      hiddenCount: 0,
    });
    expect(visibleScheduleMonths([])).toEqual({ visible: [], hiddenCount: 0 });
  });

  it("caps at 36 rows and reports the hidden count", () => {
    const result = visibleScheduleMonths(keys);
    expect(result.visible).toHaveLength(36);
    expect(result.hiddenCount).toBe(14);
    expect(result.visible[0]).toBe("k0");
    expect(result.visible[35]).toBe("k35");
  });
});

describe("endingBalancesByMonth", () => {
  it("indexes each debt's schedule by month key", () => {
    const lookup = endingBalancesByMonth([
      {
        id: "a",
        schedule: [
          { monthKey: "2026-07", startingBalanceCents: 100, interestCents: 1, paymentCents: 51, endingBalanceCents: 50 },
          { monthKey: "2026-08", startingBalanceCents: 50, interestCents: 0, paymentCents: 50, endingBalanceCents: 0 },
        ],
      },
      { id: "b", schedule: [] },
    ]);
    expect(lookup["a"]).toEqual({ "2026-07": 50, "2026-08": 0 });
    expect(lookup["b"]).toEqual({});
    // Months past payoff have no entry (rendered blank, never fabricated).
    expect(lookup["a"]!["2026-09"]).toBeUndefined();
  });
});

describe("projectFixedCostsAfterRetirements", () => {
  const debts = [
    { id: "liberty", name: "Liberty Bank loan", payoffMonthKey: "2027-01", minPaymentCents: 127_942 },
    { id: "discover", name: "Discover", payoffMonthKey: "2026-10", minPaymentCents: 27_500 },
    { id: "stuck", name: "Never retires", payoffMonthKey: null, minPaymentCents: 9_000 },
  ];

  it("projects the fixed-cost percent after each retirement month, ascending", () => {
    // Fixed Costs $7,000/mo on $10,000/mo income = 70% baseline.
    const projection = projectFixedCostsAfterRetirements(debts, 700_000, 1_000_000);
    expect(projection.baselinePercent).toBe(70);
    expect(projection.rows.map((row) => row.monthKey)).toEqual(["2026-10", "2027-01"]);

    // Discover retires first: 700000 - 27500 = 672500 -> 67.3%.
    expect(projection.rows[0]).toMatchObject({
      debtNames: ["Discover"],
      freedMinPaymentCents: 27_500,
      projectedFixedCostsCents: 672_500,
      percentOfIncome: 67.3,
      entersBand: false,
    });
    // Liberty retires next: 700000 - 27500 - 127942 = 544558 -> 54.5% (in band).
    expect(projection.rows[1]).toMatchObject({
      debtNames: ["Liberty Bank loan"],
      freedMinPaymentCents: 155_442,
      projectedFixedCostsCents: 544_558,
      percentOfIncome: 54.5,
      entersBand: true,
    });
  });

  it("flags only the FIRST month entering the 50-60% band", () => {
    const projection = projectFixedCostsAfterRetirements(
      [
        { id: "a", name: "A", payoffMonthKey: "2026-08", minPaymentCents: 200_000 },
        { id: "b", name: "B", payoffMonthKey: "2026-09", minPaymentCents: 100_000 },
      ],
      650_000,
      1_000_000,
    );
    // 65% -> 45% (entered, skipping straight past the band counts) -> 35%.
    expect(projection.rows.map((row) => [row.percentOfIncome, row.entersBand])).toEqual([
      [45, true],
      [35, false],
    ]);
  });

  it("does not flag a baseline that is already inside the band", () => {
    const projection = projectFixedCostsAfterRetirements(
      [{ id: "a", name: "A", payoffMonthKey: "2026-08", minPaymentCents: 50_000 }],
      580_000,
      1_000_000,
    );
    expect(projection.baselinePercent).toBe(58);
    expect(projection.rows[0]!.entersBand).toBe(false);
  });

  it("groups multiple debts retiring in the same month", () => {
    const projection = projectFixedCostsAfterRetirements(
      [
        { id: "a", name: "A", payoffMonthKey: "2026-08", minPaymentCents: 10_000 },
        { id: "b", name: "B", payoffMonthKey: "2026-08", minPaymentCents: 20_000 },
      ],
      500_000,
      1_000_000,
    );
    expect(projection.rows).toHaveLength(1);
    expect(projection.rows[0]!.debtNames).toEqual(["A", "B"]);
    expect(projection.rows[0]!.freedMinPaymentCents).toBe(30_000);
  });

  it("returns no rows without positive income (never fabricates percents)", () => {
    expect(projectFixedCostsAfterRetirements(debts, 700_000, 0)).toEqual({
      baselinePercent: null,
      rows: [],
    });
    expect(projectFixedCostsAfterRetirements(debts, 700_000, -5)).toEqual({
      baselinePercent: null,
      rows: [],
    });
  });

  it("floors the projected fixed costs at zero", () => {
    const projection = projectFixedCostsAfterRetirements(
      [{ id: "a", name: "A", payoffMonthKey: "2026-08", minPaymentCents: 900_000 }],
      500_000,
      1_000_000,
    );
    expect(projection.rows[0]!.projectedFixedCostsCents).toBe(0);
    expect(projection.rows[0]!.percentOfIncome).toBe(0);
  });
});
