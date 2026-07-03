import { describe, expect, it } from "vitest";
import {
  TX_CATEGORIES,
  TX_TYPES,
  TX_TYPE_CATEGORIES,
  aggregateMonthTransactions,
  assertValidTxTypeCategory,
  compareBudgetToAggregates,
  computeMonthlyFinancialReport,
  percentOfIncomeCents,
  isFinancialAccountType,
  isValidMonthKey,
  isValidTxTypeCategory,
  dayStartUtc,
  isBalanceSource,
  monthKeyFromDate,
  planBulkTransactionWrites,
  previousMonthKey,
  summarizeMonthBalances,
} from "./index";

describe("fixed transaction taxonomy", () => {
  it("accepts every type paired with each of its own categories", () => {
    for (const type of TX_TYPES) {
      for (const category of TX_TYPE_CATEGORIES[type]) {
        expect(isValidTxTypeCategory(type, category)).toBe(true);
      }
    }
  });

  it("rejects categories paired with the wrong type", () => {
    expect(isValidTxTypeCategory("Fixed", "Groceries")).toBe(false);
    expect(isValidTxTypeCategory("Spending", "Recurring Bills")).toBe(false);
    expect(isValidTxTypeCategory("Food", "Misc.")).toBe(false);
    expect(isValidTxTypeCategory("Income", "Subscriptions")).toBe(false);
    expect(isValidTxTypeCategory("Income", "Restaurants")).toBe(false);
  });

  it("pairs Transfer with exactly Transfers In and Transfers Out", () => {
    expect(TX_TYPE_CATEGORIES.Transfer).toEqual(["Transfers In", "Transfers Out"]);
    expect(isValidTxTypeCategory("Transfer", "Transfers In")).toBe(true);
    expect(isValidTxTypeCategory("Transfer", "Transfers Out")).toBe(true);
    expect(isValidTxTypeCategory("Transfer", "Groceries")).toBe(false);
    expect(isValidTxTypeCategory("Transfer", "Jeff")).toBe(false);
    expect(isValidTxTypeCategory("Income", "Transfers In")).toBe(false);
    expect(isValidTxTypeCategory("Spending", "Transfers Out")).toBe(false);
    expect(() => assertValidTxTypeCategory("Transfer", "Misc.")).toThrow(
      /invalid category "Misc\." for transaction type "Transfer"/,
    );
    expect(() => assertValidTxTypeCategory("Transfer", "Transfers Out")).not.toThrow();
  });

  it("rejects unknown types and categories", () => {
    expect(isValidTxTypeCategory("Savings", "Groceries")).toBe(false);
    expect(isValidTxTypeCategory("Food", "Takeout")).toBe(false);
    expect(isValidTxTypeCategory("", "")).toBe(false);
  });

  it("throws clear errors from assertValidTxTypeCategory", () => {
    expect(() => assertValidTxTypeCategory("Savings", "Groceries")).toThrow(/invalid transaction type "Savings"/);
    expect(() => assertValidTxTypeCategory("Fixed", "Groceries")).toThrow(
      /invalid category "Groceries" for transaction type "Fixed"/,
    );
    expect(() => assertValidTxTypeCategory("Food", "Groceries")).not.toThrow();
  });

  it("keeps the flat category list in sync with the type map", () => {
    const flattened = TX_TYPES.flatMap((type) => [...TX_TYPE_CATEGORIES[type]]);
    expect([...TX_CATEGORIES]).toEqual(flattened);
  });

  it("validates account types", () => {
    expect(isFinancialAccountType("Jeff Personal")).toBe(true);
    expect(isFinancialAccountType("Family Shared")).toBe(true);
    expect(isFinancialAccountType("Joint")).toBe(false);
  });
});

describe("month keys", () => {
  it("validates YYYY-MM format", () => {
    expect(isValidMonthKey("2026-07")).toBe(true);
    expect(isValidMonthKey("2026-13")).toBe(false);
    expect(isValidMonthKey("2026-7")).toBe(false);
    expect(isValidMonthKey("202607")).toBe(false);
  });

  it("derives month keys from epoch ms in UTC", () => {
    expect(monthKeyFromDate(Date.UTC(2026, 6, 2))).toBe("2026-07");
    expect(monthKeyFromDate(Date.UTC(2026, 0, 1))).toBe("2026-01");
  });

  it("computes the previous month, including year rollover", () => {
    expect(previousMonthKey("2026-07")).toBe("2026-06");
    expect(previousMonthKey("2026-01")).toBe("2025-12");
    expect(() => previousMonthKey("garbage")).toThrow(/invalid monthKey/);
  });
});

const juneTransactions = [
  { txType: "Fixed", category: "Mortgage, HOA, Mortgage Loan", amountCents: 250_000 },
  { txType: "Fixed", category: "Recurring Bills", amountCents: 40_000 },
  { txType: "Spending", category: "Subscriptions", amountCents: 5_000 },
  { txType: "Spending", category: "Gas, Amazon, Home Depot, Etc", amountCents: 60_000 },
  { txType: "Spending", category: "Misc.", amountCents: 15_000 },
  { txType: "Food", category: "Groceries", amountCents: 90_000 },
  { txType: "Food", category: "Restaurants", amountCents: 40_000 },
  { txType: "Income", category: "Jeff", amountCents: 500_000 },
  { txType: "Income", category: "Holly", amountCents: 300_000 },
];

const mayTransactions = [
  { txType: "Fixed", category: "Mortgage, HOA, Mortgage Loan", amountCents: 250_000 },
  { txType: "Food", category: "Groceries", amountCents: 100_000 },
  { txType: "Income", category: "Jeff", amountCents: 500_000 },
];

// Transfers are positive magnitudes; direction IS the category.
const juneTransfers = [
  { txType: "Transfer", category: "Transfers In", amountCents: 200_000 },
  { txType: "Transfer", category: "Transfers Out", amountCents: 75_000 },
  { txType: "Transfer", category: "Transfers Out", amountCents: 25_000 },
];

const mayTransfers = [{ txType: "Transfer", category: "Transfers Out", amountCents: 40_000 }];

describe("aggregateMonthTransactions", () => {
  it("totals per category and per type", () => {
    const aggregates = aggregateMonthTransactions(juneTransactions);
    expect(aggregates.transactionCount).toBe(9);
    expect(aggregates.categoryTotalsCents["Mortgage, HOA, Mortgage Loan"]).toBe(250_000);
    expect(aggregates.categoryTotalsCents["Groceries"]).toBe(90_000);
    expect(aggregates.categoryTotalsCents["Holly"]).toBe(300_000);
    expect(aggregates.typeTotalsCents.Fixed).toBe(290_000);
    expect(aggregates.typeTotalsCents.Spending).toBe(80_000);
    expect(aggregates.typeTotalsCents.Food).toBe(130_000);
    expect(aggregates.typeTotalsCents.Income).toBe(800_000);
  });

  it("computes outgoing, incoming, and net in integer cents", () => {
    const aggregates = aggregateMonthTransactions(juneTransactions);
    expect(aggregates.totalOutgoingCents).toBe(500_000); // 290k + 80k + 130k
    expect(aggregates.totalIncomingCents).toBe(800_000);
    expect(aggregates.netCents).toBe(300_000);
  });

  it("computes percentages of outgoing per category and type", () => {
    const aggregates = aggregateMonthTransactions(juneTransactions);
    expect(aggregates.typePercentOfOutgoing.Fixed).toBe(58);
    expect(aggregates.typePercentOfOutgoing.Spending).toBe(16);
    expect(aggregates.typePercentOfOutgoing.Food).toBe(26);
    expect(aggregates.typePercentOfOutgoing.Income).toBe(0);
    expect(aggregates.categoryPercentOfOutgoing["Mortgage, HOA, Mortgage Loan"]).toBe(50);
    expect(aggregates.categoryPercentOfOutgoing["Groceries"]).toBe(18);
    expect(aggregates.categoryPercentOfOutgoing["Subscriptions"]).toBe(1);
    expect(aggregates.categoryPercentOfOutgoing["Jeff"]).toBe(0);
  });

  it("returns zeroed records for an empty month", () => {
    const aggregates = aggregateMonthTransactions([]);
    expect(aggregates.totalOutgoingCents).toBe(0);
    expect(aggregates.totalIncomingCents).toBe(0);
    expect(aggregates.netCents).toBe(0);
    expect(aggregates.transferNetCents).toBe(0);
    expect(aggregates.typePercentOfOutgoing.Fixed).toBe(0);
    expect(aggregates.categoryTotalsCents["Misc."]).toBe(0);
    expect(aggregates.categoryTotalsCents["Transfers In"]).toBe(0);
  });

  it("renders transfers in category/type totals but excludes them from outgoing/incoming/net", () => {
    const withTransfers = aggregateMonthTransactions([...juneTransactions, ...juneTransfers]);
    const withoutTransfers = aggregateMonthTransactions(juneTransactions);

    // The grid still gets totals for the Transfer band.
    expect(withTransfers.categoryTotalsCents["Transfers In"]).toBe(200_000);
    expect(withTransfers.categoryTotalsCents["Transfers Out"]).toBe(100_000);
    expect(withTransfers.typeTotalsCents.Transfer).toBe(300_000);
    expect(withTransfers.transactionCount).toBe(12);

    // Budget totals are untouched by transfer rows.
    expect(withTransfers.totalOutgoingCents).toBe(withoutTransfers.totalOutgoingCents);
    expect(withTransfers.totalIncomingCents).toBe(withoutTransfers.totalIncomingCents);
    expect(withTransfers.netCents).toBe(withoutTransfers.netCents);
  });

  it("keeps transfers out of every percent-of-outgoing numerator and denominator", () => {
    const withTransfers = aggregateMonthTransactions([...juneTransactions, ...juneTransfers]);
    const withoutTransfers = aggregateMonthTransactions(juneTransactions);

    // Transfer percents are always 0.
    expect(withTransfers.typePercentOfOutgoing.Transfer).toBe(0);
    expect(withTransfers.categoryPercentOfOutgoing["Transfers In"]).toBe(0);
    expect(withTransfers.categoryPercentOfOutgoing["Transfers Out"]).toBe(0);

    // Non-transfer percents are identical with and without transfer rows.
    expect(withTransfers.typePercentOfOutgoing).toEqual(withoutTransfers.typePercentOfOutgoing);
    expect(withTransfers.categoryPercentOfOutgoing).toEqual(withoutTransfers.categoryPercentOfOutgoing);
  });

  it("computes transferNetCents as Transfers In minus Transfers Out", () => {
    const aggregates = aggregateMonthTransactions([...juneTransactions, ...juneTransfers]);
    expect(aggregates.transferNetCents).toBe(100_000); // 200k in - 100k out

    const outOnly = aggregateMonthTransactions(mayTransfers);
    expect(outOnly.transferNetCents).toBe(-40_000);
    expect(outOnly.totalOutgoingCents).toBe(0);
    expect(outOnly.totalIncomingCents).toBe(0);
    expect(outOnly.netCents).toBe(0);
  });

  it("rejects transfer categories paired with non-transfer types", () => {
    expect(() =>
      aggregateMonthTransactions([{ txType: "Income", category: "Transfers In", amountCents: 100 }]),
    ).toThrow(/invalid category/);
    expect(() =>
      aggregateMonthTransactions([{ txType: "Spending", category: "Transfers Out", amountCents: 100 }]),
    ).toThrow(/invalid category/);
  });

  it("rejects invalid pairs and non-integer amounts", () => {
    expect(() =>
      aggregateMonthTransactions([{ txType: "Fixed", category: "Groceries", amountCents: 100 }]),
    ).toThrow(/invalid category/);
    expect(() =>
      aggregateMonthTransactions([{ txType: "Food", category: "Groceries", amountCents: 10.5 }]),
    ).toThrow(/integer number of cents/);
  });
});

describe("computeMonthlyFinancialReport", () => {
  it("includes previous-month aggregates and deltas", () => {
    const report = computeMonthlyFinancialReport({
      monthKey: "2026-06",
      transactions: juneTransactions,
      previousTransactions: mayTransactions,
    });

    expect(report.monthKey).toBe("2026-06");
    expect(report.previousMonthKey).toBe("2026-05");
    expect(report.previous.totalOutgoingCents).toBe(350_000);
    expect(report.previous.totalIncomingCents).toBe(500_000);
    expect(report.monthOverMonth.totalOutgoingCents).toBe(150_000);
    expect(report.monthOverMonth.totalIncomingCents).toBe(300_000);
    expect(report.monthOverMonth.netCents).toBe(150_000);
    expect(report.monthOverMonth.categoryTotalsCents["Groceries"]).toBe(-10_000);
    expect(report.monthOverMonth.typeTotalsCents.Income).toBe(300_000);
    expect(report.budget).toBeNull();
  });

  it("compares the applicable budget with per-target deltas", () => {
    const report = computeMonthlyFinancialReport({
      monthKey: "2026-06",
      transactions: juneTransactions,
      previousTransactions: mayTransactions,
      budget: {
        categoryTargets: { Groceries: 80_000, Restaurants: 50_000 },
        typeTargets: { Food: 120_000 },
        targetOutgoingCents: 450_000,
        targetIncomingCents: 800_000,
        targetNetCents: 350_000,
      },
      budgetIsDefault: true,
    });

    expect(report.budget?.isDefault).toBe(true);
    expect(report.budget?.comparison.categoryDeltas["Groceries"]).toEqual({
      targetCents: 80_000,
      actualCents: 90_000,
      deltaCents: 10_000,
    });
    expect(report.budget?.comparison.categoryDeltas["Restaurants"]).toEqual({
      targetCents: 50_000,
      actualCents: 40_000,
      deltaCents: -10_000,
    });
    expect(report.budget?.comparison.typeDeltas["Food"]).toEqual({
      targetCents: 120_000,
      actualCents: 130_000,
      deltaCents: 10_000,
    });
    expect(report.budget?.comparison.outgoing).toEqual({
      targetCents: 450_000,
      actualCents: 500_000,
      deltaCents: 50_000,
    });
    expect(report.budget?.comparison.incoming).toEqual({
      targetCents: 800_000,
      actualCents: 800_000,
      deltaCents: 0,
    });
    expect(report.budget?.comparison.net).toEqual({
      targetCents: 350_000,
      actualCents: 300_000,
      deltaCents: -50_000,
    });
  });

  it("reports transferNetCents for the current and previous months plus the delta", () => {
    const report = computeMonthlyFinancialReport({
      monthKey: "2026-06",
      transactions: [...juneTransactions, ...juneTransfers],
      previousTransactions: [...mayTransactions, ...mayTransfers],
    });

    expect(report.current.transferNetCents).toBe(100_000);
    expect(report.previous.transferNetCents).toBe(-40_000);
    expect(report.monthOverMonth.transferNetCents).toBe(140_000);

    // Transfers stay out of the headline budget totals and their deltas.
    expect(report.current.totalOutgoingCents).toBe(500_000);
    expect(report.current.totalIncomingCents).toBe(800_000);
    expect(report.current.netCents).toBe(300_000);
    expect(report.monthOverMonth.totalOutgoingCents).toBe(150_000);
    expect(report.monthOverMonth.netCents).toBe(150_000);

    // But the grid deltas still cover the Transfer band.
    expect(report.monthOverMonth.typeTotalsCents.Transfer).toBe(260_000);
    expect(report.monthOverMonth.categoryTotalsCents["Transfers Out"]).toBe(60_000);
  });

  it("ignores Transfer type and category budget targets in the comparison", () => {
    const report = computeMonthlyFinancialReport({
      monthKey: "2026-06",
      transactions: [...juneTransactions, ...juneTransfers],
      budget: {
        categoryTargets: { Groceries: 80_000, "Transfers In": 10_000, "Transfers Out": 20_000 },
        typeTargets: { Transfer: 50_000, Food: 120_000 },
        targetOutgoingCents: 450_000,
      },
    });

    expect(report.budget?.comparison.categoryDeltas["Groceries"]).toBeDefined();
    expect(report.budget?.comparison.categoryDeltas["Transfers In"]).toBeUndefined();
    expect(report.budget?.comparison.categoryDeltas["Transfers Out"]).toBeUndefined();
    expect(report.budget?.comparison.typeDeltas["Food"]).toBeDefined();
    expect(report.budget?.comparison.typeDeltas["Transfer"]).toBeUndefined();
    // Transfer rows do not move the outgoing actual.
    expect(report.budget?.comparison.outgoing).toEqual({
      targetCents: 450_000,
      actualCents: 500_000,
      deltaCents: 50_000,
    });
  });
});

describe("percent-of-income budget targets", () => {
  // June actuals: income 800_000, Food 130_000, Groceries 90_000, net 300_000.
  const juneAggregates = aggregateMonthTransactions(juneTransactions);

  it("rounds percent-of-income to integer cents", () => {
    expect(percentOfIncomeCents(50, 800_000)).toBe(400_000);
    expect(percentOfIncomeCents(22, 1_200_000)).toBe(264_000);
    expect(percentOfIncomeCents(50, 333_333)).toBe(166_667);
    expect(percentOfIncomeCents(0, 800_000)).toBe(0);
  });

  it("resolves percent targets against the month's actual income", () => {
    const comparison = compareBudgetToAggregates(
      {
        categoryPercentTargets: { Groceries: 10 },
        typePercentTargets: { Food: 20 },
        targetNetPercent: 25,
      },
      juneAggregates,
    );

    // 10% of $8,000 income = $800 target vs $900 actual.
    expect(comparison.categoryDeltas["Groceries"]).toEqual({
      targetCents: 80_000,
      actualCents: 90_000,
      deltaCents: 10_000,
      targetPercent: 10,
    });
    // 20% of $8,000 = $1,600 target vs $1,300 actual.
    expect(comparison.typeDeltas["Food"]).toEqual({
      targetCents: 160_000,
      actualCents: 130_000,
      deltaCents: -30_000,
      targetPercent: 20,
    });
    // 25% of $8,000 = $2,000 net target vs $3,000 actual.
    expect(comparison.net).toEqual({
      targetCents: 200_000,
      actualCents: 300_000,
      deltaCents: 100_000,
      targetPercent: 25,
    });
  });

  it("percent targets win over cents targets for the same key", () => {
    const comparison = compareBudgetToAggregates(
      {
        categoryTargets: { Groceries: 999_999 },
        categoryPercentTargets: { Groceries: 10 },
        typeTargets: { Food: 999_999 },
        typePercentTargets: { Food: 20 },
        targetNetCents: 999_999,
        targetNetPercent: 25,
      },
      juneAggregates,
    );

    expect(comparison.categoryDeltas["Groceries"]?.targetCents).toBe(80_000);
    expect(comparison.categoryDeltas["Groceries"]?.targetPercent).toBe(10);
    expect(comparison.typeDeltas["Food"]?.targetCents).toBe(160_000);
    expect(comparison.typeDeltas["Food"]?.targetPercent).toBe(20);
    expect(comparison.net?.targetCents).toBe(200_000);
    expect(comparison.net?.targetPercent).toBe(25);
  });

  it("produces NO comparison rows for percent targets when the month has no income", () => {
    const noIncomeAggregates = aggregateMonthTransactions([
      { txType: "Food", category: "Groceries", amountCents: 90_000 },
    ]);
    const comparison = compareBudgetToAggregates(
      {
        categoryTargets: { Restaurants: 50_000 },
        categoryPercentTargets: { Groceries: 10 },
        typePercentTargets: { Food: 20 },
        targetNetCents: 100_000,
        targetNetPercent: 25,
      },
      noIncomeAggregates,
    );

    // Percent-derived rows are absent entirely (not zero targets)...
    expect(comparison.categoryDeltas["Groceries"]).toBeUndefined();
    expect(comparison.typeDeltas["Food"]).toBeUndefined();
    // ...including net: the percent wins over targetNetCents even when it
    // cannot resolve, so there is no net row at all.
    expect(comparison.net).toBeUndefined();
    // Cents-only targets are unaffected by missing income.
    expect(comparison.categoryDeltas["Restaurants"]).toEqual({
      targetCents: 50_000,
      actualCents: 0,
      deltaCents: -50_000,
    });
  });

  it("supports mixed budgets: cents for some keys, percent for others", () => {
    const comparison = compareBudgetToAggregates(
      {
        categoryTargets: { Restaurants: 50_000 },
        categoryPercentTargets: { Groceries: 10 },
        typeTargets: { Fixed: 300_000 },
        typePercentTargets: { Food: 20 },
      },
      juneAggregates,
    );

    expect(comparison.categoryDeltas["Restaurants"]).toEqual({
      targetCents: 50_000,
      actualCents: 40_000,
      deltaCents: -10_000,
    });
    expect(comparison.categoryDeltas["Groceries"]?.targetPercent).toBe(10);
    expect(comparison.typeDeltas["Fixed"]).toEqual({
      targetCents: 300_000,
      actualCents: 290_000,
      deltaCents: -10_000,
    });
    expect(comparison.typeDeltas["Food"]?.targetPercent).toBe(20);
  });

  it("still ignores Transfer percent targets end to end", () => {
    const comparison = compareBudgetToAggregates(
      {
        categoryPercentTargets: { "Transfers In": 10, "Transfers Out": 10, Groceries: 10 },
        typePercentTargets: { Transfer: 10, Food: 20 },
      },
      aggregateMonthTransactions([...juneTransactions, ...juneTransfers]),
    );

    expect(comparison.categoryDeltas["Transfers In"]).toBeUndefined();
    expect(comparison.categoryDeltas["Transfers Out"]).toBeUndefined();
    expect(comparison.typeDeltas["Transfer"]).toBeUndefined();
    expect(comparison.categoryDeltas["Groceries"]).toBeDefined();
    expect(comparison.typeDeltas["Food"]).toBeDefined();
  });

  it("flows percent-derived deltas through computeMonthlyFinancialReport", () => {
    const report = computeMonthlyFinancialReport({
      monthKey: "2026-06",
      transactions: juneTransactions,
      budget: { typePercentTargets: { Food: 20 }, targetNetPercent: 25 },
      budgetIsDefault: true,
    });

    expect(report.budget?.comparison.typeDeltas["Food"]).toEqual({
      targetCents: 160_000,
      actualCents: 130_000,
      deltaCents: -30_000,
      targetPercent: 20,
    });
    expect(report.budget?.comparison.net?.targetPercent).toBe(25);
  });
});

describe("planBulkTransactionWrites", () => {
  it("updates instead of duplicating when the externalId already exists", () => {
    const rows = [
      { externalId: "plaid_tx_1", description: "Groceries" },
      { externalId: "plaid_tx_2", description: "Gas" },
      { description: "Manual cash entry" },
    ];

    const plan = planBulkTransactionWrites(rows, new Set(["plaid_tx_1"]));

    expect(plan.updates).toEqual([{ externalId: "plaid_tx_1", row: rows[0] }]);
    expect(plan.inserts).toEqual([rows[1], rows[2]]);
    expect(plan.skipped).toBe(0);
  });

  it("skips repeats of the same externalId within one batch", () => {
    const rows = [
      { externalId: "plaid_tx_1", description: "First" },
      { externalId: "plaid_tx_1", description: "Repeat" },
      { externalId: "plaid_tx_1", description: "Repeat again" },
    ];

    const plan = planBulkTransactionWrites(rows, new Set());

    expect(plan.inserts).toEqual([rows[0]]);
    expect(plan.updates).toEqual([]);
    expect(plan.skipped).toBe(2);
  });

  it("treats missing/blank externalIds as plain inserts", () => {
    const rows = [
      { description: "No id" },
      { externalId: "  ", description: "Blank id" },
      { externalId: "plaid_tx_9", description: "Real id" },
    ];

    const plan = planBulkTransactionWrites(rows, new Set());

    expect(plan.inserts).toHaveLength(3);
    expect(plan.updates).toEqual([]);
    expect(plan.skipped).toBe(0);
  });
});

describe("summarizeMonthBalances", () => {
  const day = (dayOfMonth: number, monthIndex = 5) => Date.UTC(2026, monthIndex, dayOfMonth);

  it("returns nulls and an empty list for a month with no snapshots", () => {
    expect(summarizeMonthBalances([])).toEqual({
      balances: [],
      startingBalanceCents: null,
      endingBalanceCents: null,
    });
  });

  it("sorts the month's snapshots ascending and picks the latest as the ending balance", () => {
    const summary = summarizeMonthBalances([
      { date: day(15), endOfDayBalanceCents: 120_000 },
      { date: day(2), endOfDayBalanceCents: 90_000 },
      { date: day(30), endOfDayBalanceCents: -4_500 },
    ]);

    expect(summary.balances.map((row) => row.date)).toEqual([day(2), day(15), day(30)]);
    expect(summary.endingBalanceCents).toBe(-4_500);
    expect(summary.startingBalanceCents).toBeNull();
  });

  it("takes the starting balance from the previous month's latest snapshot", () => {
    const summary = summarizeMonthBalances(
      [{ date: day(3), endOfDayBalanceCents: 80_000 }],
      [
        { date: day(20, 4), endOfDayBalanceCents: 70_000 },
        { date: day(31, 4), endOfDayBalanceCents: 75_500 },
        { date: day(5, 4), endOfDayBalanceCents: 60_000 },
      ],
    );

    expect(summary.startingBalanceCents).toBe(75_500);
    expect(summary.endingBalanceCents).toBe(80_000);
  });

  it("handles a partial month: previous snapshots but none in the current month", () => {
    const summary = summarizeMonthBalances([], [{ date: day(28, 4), endOfDayBalanceCents: 12_345 }]);

    expect(summary.balances).toEqual([]);
    expect(summary.startingBalanceCents).toBe(12_345);
    expect(summary.endingBalanceCents).toBeNull();
  });
});

describe("dayStartUtc", () => {
  it("normalizes any time of day to UTC midnight of that day", () => {
    const afternoon = Date.UTC(2026, 5, 14, 17, 45, 12, 250);
    expect(dayStartUtc(afternoon)).toBe(Date.UTC(2026, 5, 14));
    expect(dayStartUtc(Date.UTC(2026, 5, 14))).toBe(Date.UTC(2026, 5, 14));
  });
});

describe("isBalanceSource", () => {
  it("accepts only the fixed balance sources", () => {
    expect(isBalanceSource("plaid_derived")).toBe(true);
    expect(isBalanceSource("manual")).toBe(true);
    expect(isBalanceSource("plaid")).toBe(false);
    expect(isBalanceSource(undefined)).toBe(false);
  });
});
