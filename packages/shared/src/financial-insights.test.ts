import { describe, expect, it } from "vitest";
import { computeFinancialInsights, type InsightsMonthRow } from "./index";

/* ------------------------------------------------------------------ */
/* Fixture: ~12 months of classified data with a deliberately volatile */
/* income series (real-time payments through early months, payroll     */
/* afterwards) so median != mean is exercised, plus a category whose   */
/* recent pace moved sharply for movers ranking.                       */
/* ------------------------------------------------------------------ */

function row(
  monthKey: string,
  overrides: {
    income?: number;
    fixed?: number;
    spending?: number;
    food?: number;
    groceries?: number;
    restaurants?: number;
    misc?: number;
  } = {},
): InsightsMonthRow {
  const income = overrides.income ?? 800000;
  const fixed = overrides.fixed ?? 300000;
  const groceries = overrides.groceries ?? 60000;
  const restaurants = overrides.restaurants ?? 20000;
  const misc = overrides.misc ?? 40000;
  const food = overrides.food ?? groceries + restaurants;
  const spending = overrides.spending ?? misc;
  const outgoing = fixed + spending + food;
  return {
    monthKey,
    typeTotalsCents: { Income: income, Fixed: fixed, Spending: spending, Food: food, Transfer: 0 },
    categoryTotalsCents: {
      "Mortgage, HOA, Mortgage Loan": fixed,
      "Recurring Bills": 0,
      Subscriptions: 0,
      "Gas, Amazon, Home Depot, Etc": 0,
      "Misc.": misc,
      Groceries: groceries,
      Restaurants: restaurants,
      Jeff: income,
      Holly: 0,
      "Transfers In": 0,
      "Transfers Out": 0,
    },
    totalOutgoingCents: outgoing,
    totalIncomingCents: income,
    netCents: income - outgoing,
  };
}

// Twelve complete months (2025-07 .. 2026-06) + the in-progress month 2026-07.
// Income is volatile: a huge one-off spike in 2025-09 pulls the mean far above
// the median; the last two months switch to steady payroll. Restaurants surge
// in the final two months so it ranks as a mover.
const VOLATILE_INCOME: Record<string, number> = {
  "2025-07": 400000,
  "2025-08": 700000,
  "2025-09": 2400000, // one-off spike
  "2025-10": 500000,
  "2025-11": 650000,
  "2025-12": 450000,
  "2026-01": 700000,
  "2026-02": 550000,
  "2026-03": 600000,
  "2026-04": 900000, // payroll starts
  "2026-05": 900000,
  "2026-06": 900000,
};

const FIXTURE: InsightsMonthRow[] = [
  ...Object.entries(VOLATILE_INCOME).map(([monthKey, income]) =>
    row(monthKey, {
      income,
      restaurants: monthKey >= "2026-05" ? 90000 : 20000,
    }),
  ),
  // The in-progress month: big numbers that would wreck averages if included.
  row("2026-07", { income: 9900000, restaurants: 500000 }),
];

describe("computeFinancialInsights", () => {
  const insights = computeFinancialInsights(FIXTURE, { currentMonthKey: "2026-07" });

  it("uses the default 12/6/2 windows with full monthsUsed on 12+ months of history", () => {
    expect(insights.windows.map((w) => w.windowMonths)).toEqual([12, 6, 2]);
    expect(insights.windows.map((w) => w.monthsUsed)).toEqual([12, 6, 2]);
    expect(insights.completeMonthKeys).toHaveLength(12);
    expect(insights.completeMonthKeys[0]).toBe("2025-07");
    expect(insights.completeMonthKeys[11]).toBe("2026-06");
  });

  it("excludes the current partial month from every window", () => {
    expect(insights.completeMonthKeys).not.toContain("2026-07");
    for (const window of insights.windows) {
      expect(window.monthKeys).not.toContain("2026-07");
    }
    // The 2-mo window is exactly the last two COMPLETE months.
    expect(insights.windows[2]!.monthKeys).toEqual(["2026-05", "2026-06"]);
    // The 9.9M partial-month income never reaches any mean.
    for (const window of insights.windows) {
      expect(window.typeStats.Income.meanCents).toBeLessThan(1000000);
    }
  });

  it("reports median != mean for the volatile income series", () => {
    const incomes = Object.values(VOLATILE_INCOME);
    const expectedMean = Math.round(incomes.reduce((a, b) => a + b, 0) / incomes.length);
    const sorted = [...incomes].sort((a, b) => a - b);
    const expectedMedian = Math.round((sorted[5]! + sorted[6]!) / 2);

    const twelve = insights.windows[0]!;
    expect(twelve.typeStats.Income.meanCents).toBe(expectedMean);
    expect(twelve.typeStats.Income.medianCents).toBe(expectedMedian);
    // The 2025-09 spike drags the mean well above the median.
    expect(twelve.typeStats.Income.meanCents).toBeGreaterThan(twelve.typeStats.Income.medianCents);
    expect(twelve.typeStats.Income.meanCents - twelve.typeStats.Income.medianCents).toBeGreaterThan(100000);
  });

  it("computes per-window outgoing/net stats and adjacent-window deltas", () => {
    const twelve = insights.windows[0]!;
    const two = insights.windows[2]!;
    // Restaurants moved 20000 -> 90000 in the last two months: outgoing follows.
    expect(two.outgoing.meanCents - twelve.outgoing.meanCents).toBeGreaterThan(0);

    expect(insights.deltas).toHaveLength(2);
    expect(insights.deltas[0]!.fromWindowMonths).toBe(12);
    expect(insights.deltas[0]!.toWindowMonths).toBe(6);
    expect(insights.deltas[1]!.fromWindowMonths).toBe(6);
    expect(insights.deltas[1]!.toWindowMonths).toBe(2);
    const sixToTwo = insights.deltas[1]!;
    expect(sixToTwo.typeMeanDeltaCents.Income).toBe(
      two.typeStats.Income.meanCents - insights.windows[1]!.typeStats.Income.meanCents,
    );
    expect(sixToTwo.netMeanDeltaCents).toBe(two.net.meanCents - insights.windows[1]!.net.meanCents);
  });

  it("ranks biggest movers by |2-mo mean - 12-mo mean| with both means and percent", () => {
    const [top] = insights.biggestMovers;
    // Income moved more in absolute cents than Restaurants (means: ~808k -> 900k
    // vs ~31.7k -> 90k), so Jeff ranks first and Restaurants second.
    expect(top!.category).toBe("Jeff");
    expect(insights.biggestMovers[1]!.category).toBe("Restaurants");

    const restaurants = insights.biggestMovers.find((mover) => mover.category === "Restaurants")!;
    expect(restaurants.txType).toBe("Food");
    const expectedLongMean = Math.round((20000 * 10 + 90000 * 2) / 12);
    expect(restaurants.longMeanCents).toBe(expectedLongMean);
    expect(restaurants.shortMeanCents).toBe(90000);
    expect(restaurants.deltaCents).toBe(90000 - expectedLongMean);
    expect(restaurants.percentChange).toBeCloseTo(
      Math.round(((90000 - expectedLongMean) / expectedLongMean) * 1000) / 10,
      5,
    );

    // Ranking is by absolute delta, descending.
    const magnitudes = insights.biggestMovers.map((mover) => Math.abs(mover.deltaCents));
    expect([...magnitudes].sort((a, b) => b - a)).toEqual(magnitudes);
  });

  it("caps movers at topMoversCount and omits zero-delta and Transfer categories", () => {
    expect(insights.biggestMovers.length).toBeLessThanOrEqual(5);
    for (const mover of insights.biggestMovers) {
      expect(mover.deltaCents).not.toBe(0);
      expect(["Transfers In", "Transfers Out"]).not.toContain(mover.category);
    }
    const single = computeFinancialInsights(FIXTURE, { currentMonthKey: "2026-07", topMoversCount: 1 });
    expect(single.biggestMovers).toHaveLength(1);
    expect(single.biggestMovers[0]!.category).toBe("Jeff");
  });

  it("reports percent vs the long-window mean, and null when that mean is not positive", () => {
    // Positive long mean: percent is (delta / longMean) * 100, one decimal.
    const rows = [row("2026-05", { misc: 0 }), row("2026-06", { misc: 50000 })];
    const result = computeFinancialInsights(rows, { currentMonthKey: "2026-07", windows: [2, 1] });
    const misc = result.biggestMovers.find((mover) => mover.category === "Misc.")!;
    expect(misc.longMeanCents).toBe(25000);
    expect(misc.shortMeanCents).toBe(50000);
    expect(misc.percentChange).toBe(100);

    // Long-window mean of exactly zero (refund cancels a charge): percent is null.
    const zeroRows = [row("2026-05", { misc: -50000 }), row("2026-06", { misc: 50000 })];
    const zeroResult = computeFinancialInsights(zeroRows, { currentMonthKey: "2026-07", windows: [2, 1] });
    const zeroMisc = zeroResult.biggestMovers.find((mover) => mover.category === "Misc.")!;
    expect(zeroMisc.longMeanCents).toBe(0);
    expect(zeroMisc.shortMeanCents).toBe(50000);
    expect(zeroMisc.percentChange).toBeNull();
  });

  it("computes over available complete months and reports monthsUsed when history is short", () => {
    const short = FIXTURE.filter((r) => r.monthKey >= "2025-10"); // 9 complete + current
    const result = computeFinancialInsights(short, { currentMonthKey: "2026-07" });
    expect(result.completeMonthKeys).toHaveLength(9);
    expect(result.windows.map((w) => w.monthsUsed)).toEqual([9, 6, 2]);
    expect(result.windows[0]!.windowMonths).toBe(12);
    // The '12-mo' stats are honestly a 9-month mean.
    const incomes = Object.entries(VOLATILE_INCOME)
      .filter(([key]) => key >= "2025-10")
      .map(([, value]) => value);
    expect(result.windows[0]!.typeStats.Income.meanCents).toBe(
      Math.round(incomes.reduce((a, b) => a + b, 0) / incomes.length),
    );
  });

  it("returns zero stats and no movers when there is no complete history", () => {
    const result = computeFinancialInsights([row("2026-07")], { currentMonthKey: "2026-07" });
    expect(result.completeMonthKeys).toEqual([]);
    expect(result.windows.map((w) => w.monthsUsed)).toEqual([0, 0, 0]);
    expect(result.windows[0]!.typeStats.Income).toEqual({ meanCents: 0, medianCents: 0 });
    expect(result.biggestMovers).toEqual([]);
  });

  it("supports custom windows and validates inputs", () => {
    const custom = computeFinancialInsights(FIXTURE, { currentMonthKey: "2026-07", windows: [3] });
    expect(custom.windows).toHaveLength(1);
    expect(custom.deltas).toEqual([]);
    expect(custom.windows[0]!.monthKeys).toEqual(["2026-04", "2026-05", "2026-06"]);

    expect(() => computeFinancialInsights(FIXTURE, { currentMonthKey: "garbage" })).toThrow(
      /invalid currentMonthKey/,
    );
    expect(() => computeFinancialInsights(FIXTURE, { currentMonthKey: "2026-07", windows: [] })).toThrow(
      /at least one window/,
    );
    expect(() => computeFinancialInsights(FIXTURE, { currentMonthKey: "2026-07", windows: [0] })).toThrow(
      /positive integers/,
    );
  });

  it("uses an odd-count median directly (no midpoint averaging)", () => {
    const rows = [
      row("2026-04", { income: 100000 }),
      row("2026-05", { income: 900000 }),
      row("2026-06", { income: 200000 }),
    ];
    const result = computeFinancialInsights(rows, { currentMonthKey: "2026-07", windows: [3] });
    expect(result.windows[0]!.typeStats.Income.medianCents).toBe(200000);
    expect(result.windows[0]!.typeStats.Income.meanCents).toBe(400000);
  });
});
