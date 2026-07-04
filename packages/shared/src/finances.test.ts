import { describe, expect, it } from "vitest";
import {
  CONTRIBUTION_SOURCES,
  DEBT_PAYMENT_DESCRIPTION_PATTERN,
  INCOMING_TX_TYPES,
  LEGACY_CSP_BUDGET_TYPE_MAPPING,
  LEGACY_CSP_MAPPING,
  LEGACY_TX_TYPES,
  LEGACY_TX_TYPE_CATEGORIES,
  OUTGOING_TX_TYPES,
  TX_CATEGORIES,
  TX_TYPES,
  TX_TYPE_CATEGORIES,
  aggregateMonthTransactions,
  migrateLegacyTransaction,
  assertValidOffLedgerFields,
  assertValidRecurringContributions,
  assertValidTxTypeCategory,
  contributionExternalId,
  isContributionSource,
  planContributionMaterialization,
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

describe("fixed transaction taxonomy (CSP buckets)", () => {
  it("uses the CSP bucket order with Income and Transfer last", () => {
    expect([...TX_TYPES]).toEqual(["Fixed Costs", "Investments", "Savings", "Guilt-Free", "Income", "Transfer"]);
  });

  it("accepts every type paired with each of its own categories", () => {
    for (const type of TX_TYPES) {
      for (const category of TX_TYPE_CATEGORIES[type]) {
        expect(isValidTxTypeCategory(type, category)).toBe(true);
      }
    }
  });

  it("rejects categories paired with the wrong type", () => {
    expect(isValidTxTypeCategory("Fixed Costs", "Restaurants")).toBe(false);
    expect(isValidTxTypeCategory("Guilt-Free", "Groceries")).toBe(false);
    expect(isValidTxTypeCategory("Guilt-Free", "Recurring Bills")).toBe(false);
    expect(isValidTxTypeCategory("Investments", "Emergency Fund")).toBe(false);
    expect(isValidTxTypeCategory("Savings", "Retirement")).toBe(false);
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

  it("rejects unknown and legacy types and categories", () => {
    expect(isValidTxTypeCategory("Fixed", "Groceries")).toBe(false);
    expect(isValidTxTypeCategory("Spending", "Misc.")).toBe(false);
    expect(isValidTxTypeCategory("Food", "Groceries")).toBe(false);
    expect(isValidTxTypeCategory("Fixed Costs", "Takeout")).toBe(false);
    expect(isValidTxTypeCategory("", "")).toBe(false);
  });

  it("throws clear errors from assertValidTxTypeCategory", () => {
    expect(() => assertValidTxTypeCategory("Spending", "Misc.")).toThrow(/invalid transaction type "Spending"/);
    expect(() => assertValidTxTypeCategory("Fixed Costs", "Restaurants")).toThrow(
      /invalid category "Restaurants" for transaction type "Fixed Costs"/,
    );
    expect(() => assertValidTxTypeCategory("Fixed Costs", "Groceries")).not.toThrow();
    expect(() => assertValidTxTypeCategory("Investments", "Retirement")).not.toThrow();
    expect(() => assertValidTxTypeCategory("Savings", "Emergency Fund")).not.toThrow();
  });

  it("keeps the flat category list in sync with the type map", () => {
    const flattened = TX_TYPES.flatMap((type) => [...TX_TYPE_CATEGORIES[type]]);
    expect([...TX_CATEGORIES]).toEqual(flattened);
  });

  it("counts Fixed Costs, Investments, Savings, and Guilt-Free as outgoing; Income as incoming; Transfer as neither", () => {
    expect([...OUTGOING_TX_TYPES]).toEqual(["Fixed Costs", "Investments", "Savings", "Guilt-Free"]);
    expect([...INCOMING_TX_TYPES]).toEqual(["Income"]);
    expect(OUTGOING_TX_TYPES).not.toContain("Transfer");
    expect(OUTGOING_TX_TYPES).not.toContain("Income");
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
  { txType: "Fixed Costs", category: "Mortgage, HOA, Mortgage Loan", amountCents: 250_000 },
  { txType: "Fixed Costs", category: "Recurring Bills", amountCents: 40_000 },
  { txType: "Fixed Costs", category: "Groceries", amountCents: 90_000 },
  { txType: "Fixed Costs", category: "Subscriptions", amountCents: 5_000 },
  { txType: "Investments", category: "Retirement", amountCents: 30_000 },
  { txType: "Investments", category: "Brokerage", amountCents: 20_000 },
  { txType: "Savings", category: "Emergency Fund", amountCents: 10_000 },
  { txType: "Savings", category: "Goals", amountCents: 15_000 },
  { txType: "Guilt-Free", category: "Restaurants", amountCents: 40_000 },
  { txType: "Guilt-Free", category: "Gas, Amazon, Home Depot, Etc", amountCents: 60_000 },
  { txType: "Guilt-Free", category: "Misc.", amountCents: 15_000 },
  { txType: "Income", category: "Jeff", amountCents: 500_000 },
  { txType: "Income", category: "Holly", amountCents: 300_000 },
];

const mayTransactions = [
  { txType: "Fixed Costs", category: "Mortgage, HOA, Mortgage Loan", amountCents: 250_000 },
  { txType: "Fixed Costs", category: "Groceries", amountCents: 100_000 },
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
    expect(aggregates.transactionCount).toBe(13);
    expect(aggregates.categoryTotalsCents["Mortgage, HOA, Mortgage Loan"]).toBe(250_000);
    expect(aggregates.categoryTotalsCents["Groceries"]).toBe(90_000);
    expect(aggregates.categoryTotalsCents["Retirement"]).toBe(30_000);
    expect(aggregates.categoryTotalsCents["Emergency Fund"]).toBe(10_000);
    expect(aggregates.categoryTotalsCents["Holly"]).toBe(300_000);
    expect(aggregates.typeTotalsCents["Fixed Costs"]).toBe(385_000);
    expect(aggregates.typeTotalsCents.Investments).toBe(50_000);
    expect(aggregates.typeTotalsCents.Savings).toBe(25_000);
    expect(aggregates.typeTotalsCents["Guilt-Free"]).toBe(115_000);
    expect(aggregates.typeTotalsCents.Income).toBe(800_000);
  });

  it("computes outgoing, incoming, and net in integer cents", () => {
    const aggregates = aggregateMonthTransactions(juneTransactions);
    expect(aggregates.totalOutgoingCents).toBe(575_000); // 385k + 50k + 25k + 115k
    expect(aggregates.totalIncomingCents).toBe(800_000);
    expect(aggregates.netCents).toBe(225_000);
  });

  it("computes percentages of outgoing per category and type", () => {
    const aggregates = aggregateMonthTransactions(juneTransactions);
    expect(aggregates.typePercentOfOutgoing["Fixed Costs"]).toBe(67);
    expect(aggregates.typePercentOfOutgoing.Investments).toBe(8.7);
    expect(aggregates.typePercentOfOutgoing.Savings).toBe(4.3);
    expect(aggregates.typePercentOfOutgoing["Guilt-Free"]).toBe(20);
    expect(aggregates.typePercentOfOutgoing.Income).toBe(0);
    expect(aggregates.categoryPercentOfOutgoing["Mortgage, HOA, Mortgage Loan"]).toBe(43.5);
    expect(aggregates.categoryPercentOfOutgoing["Groceries"]).toBe(15.7);
    expect(aggregates.categoryPercentOfOutgoing["Subscriptions"]).toBe(0.9);
    expect(aggregates.categoryPercentOfOutgoing["Jeff"]).toBe(0);
  });

  it("returns zeroed records for an empty month", () => {
    const aggregates = aggregateMonthTransactions([]);
    expect(aggregates.totalOutgoingCents).toBe(0);
    expect(aggregates.totalIncomingCents).toBe(0);
    expect(aggregates.netCents).toBe(0);
    expect(aggregates.transferNetCents).toBe(0);
    expect(aggregates.typePercentOfOutgoing["Fixed Costs"]).toBe(0);
    expect(aggregates.categoryTotalsCents["Misc."]).toBe(0);
    expect(aggregates.categoryTotalsCents["Brokerage"]).toBe(0);
    expect(aggregates.categoryTotalsCents["Transfers In"]).toBe(0);
  });

  it("renders transfers in category/type totals but excludes them from outgoing/incoming/net", () => {
    const withTransfers = aggregateMonthTransactions([...juneTransactions, ...juneTransfers]);
    const withoutTransfers = aggregateMonthTransactions(juneTransactions);

    // The grid still gets totals for the Transfer band.
    expect(withTransfers.categoryTotalsCents["Transfers In"]).toBe(200_000);
    expect(withTransfers.categoryTotalsCents["Transfers Out"]).toBe(100_000);
    expect(withTransfers.typeTotalsCents.Transfer).toBe(300_000);
    expect(withTransfers.transactionCount).toBe(16);

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
      aggregateMonthTransactions([{ txType: "Guilt-Free", category: "Transfers Out", amountCents: 100 }]),
    ).toThrow(/invalid category/);
  });

  it("rejects invalid pairs, legacy pairs, and non-integer amounts", () => {
    expect(() =>
      aggregateMonthTransactions([{ txType: "Guilt-Free", category: "Groceries", amountCents: 100 }]),
    ).toThrow(/invalid category/);
    expect(() =>
      aggregateMonthTransactions([{ txType: "Food", category: "Groceries", amountCents: 100 }]),
    ).toThrow(/invalid transaction type/);
    expect(() =>
      aggregateMonthTransactions([{ txType: "Fixed Costs", category: "Groceries", amountCents: 10.5 }]),
    ).toThrow(/integer number of cents/);
  });
});

// Off-ledger 401k contributions: employee $700.02 pre-tax + employer $175.00 match.
const employeeContribution = {
  txType: "Investments",
  category: "Retirement",
  amountCents: 70_002,
  offLedger: true,
  contributionSource: "employee" as const,
};
const employerContribution = {
  txType: "Investments",
  category: "Retirement",
  amountCents: 17_500,
  offLedger: true,
  contributionSource: "employer" as const,
};

describe("off-ledger contributions in aggregation", () => {
  it("exposes contribution source vocabulary", () => {
    expect([...CONTRIBUTION_SOURCES]).toEqual(["employee", "employer"]);
    expect(isContributionSource("employee")).toBe(true);
    expect(isContributionSource("employer")).toBe(true);
    expect(isContributionSource("company")).toBe(false);
  });

  it("reports zero off-ledger totals and an ungrossed denominator for months without off-ledger rows", () => {
    const aggregates = aggregateMonthTransactions(juneTransactions);
    expect(aggregates.offLedgerInvestmentsCents).toEqual({ employeeCents: 0, employerCents: 0, totalCents: 0 });
    expect(aggregates.incomeDenominatorCents).toBe(aggregates.totalIncomingCents);
  });

  it("counts EMPLOYEE off-ledger amounts in totals and grosses up the income denominator only", () => {
    const base = aggregateMonthTransactions(juneTransactions);
    const aggregates = aggregateMonthTransactions([...juneTransactions, employeeContribution]);

    // Visible in the grid: category and type totals include the contribution.
    expect(aggregates.categoryTotalsCents["Retirement"]).toBe(base.categoryTotalsCents["Retirement"] + 70_002);
    expect(aggregates.typeTotalsCents.Investments).toBe(base.typeTotalsCents.Investments + 70_002);

    // The money never entered checking: outgoing, incoming, and net are untouched.
    expect(aggregates.totalOutgoingCents).toBe(base.totalOutgoingCents);
    expect(aggregates.totalIncomingCents).toBe(base.totalIncomingCents);
    expect(aggregates.netCents).toBe(base.netCents);

    // Pre-tax pay the owner earned: it grosses up the percent-of-income base.
    expect(aggregates.offLedgerInvestmentsCents).toEqual({
      employeeCents: 70_002,
      employerCents: 0,
      totalCents: 70_002,
    });
    expect(aggregates.incomeDenominatorCents).toBe(base.totalIncomingCents + 70_002);
  });

  it("counts EMPLOYER off-ledger amounts in totals but never grosses up the denominator", () => {
    const base = aggregateMonthTransactions(juneTransactions);
    const aggregates = aggregateMonthTransactions([...juneTransactions, employerContribution]);

    expect(aggregates.categoryTotalsCents["Retirement"]).toBe(base.categoryTotalsCents["Retirement"] + 17_500);
    expect(aggregates.typeTotalsCents.Investments).toBe(base.typeTotalsCents.Investments + 17_500);
    expect(aggregates.totalOutgoingCents).toBe(base.totalOutgoingCents);
    expect(aggregates.totalIncomingCents).toBe(base.totalIncomingCents);
    expect(aggregates.netCents).toBe(base.netCents);
    expect(aggregates.offLedgerInvestmentsCents).toEqual({
      employeeCents: 0,
      employerCents: 17_500,
      totalCents: 17_500,
    });
    // Match money was never the owner's income: denominator is NOT grossed up.
    expect(aggregates.incomeDenominatorCents).toBe(base.totalIncomingCents);
  });

  it("splits employee and employer amounts when both are present", () => {
    const aggregates = aggregateMonthTransactions([
      ...juneTransactions,
      employeeContribution,
      employerContribution,
    ]);
    expect(aggregates.offLedgerInvestmentsCents).toEqual({
      employeeCents: 70_002,
      employerCents: 17_500,
      totalCents: 87_502,
    });
    expect(aggregates.incomeDenominatorCents).toBe(800_000 + 70_002);
    expect(aggregates.typeTotalsCents.Investments).toBe(50_000 + 87_502);
    expect(aggregates.totalOutgoingCents).toBe(575_000);
    expect(aggregates.netCents).toBe(225_000);
  });

  it("keeps off-ledger amounts out of every percent-of-outgoing number", () => {
    const withOffLedger = aggregateMonthTransactions([
      ...juneTransactions,
      employeeContribution,
      employerContribution,
    ]);
    const withoutOffLedger = aggregateMonthTransactions(juneTransactions);
    expect(withOffLedger.typePercentOfOutgoing).toEqual(withoutOffLedger.typePercentOfOutgoing);
    expect(withOffLedger.categoryPercentOfOutgoing).toEqual(withoutOffLedger.categoryPercentOfOutgoing);
  });

  it("rejects off-ledger rows outside Investments and malformed contribution sources", () => {
    expect(() =>
      aggregateMonthTransactions([
        { txType: "Savings", category: "Goals", amountCents: 100, offLedger: true, contributionSource: "employee" },
      ]),
    ).toThrow(/off-ledger rows must be txType "Investments"/);
    expect(() =>
      aggregateMonthTransactions([
        { txType: "Investments", category: "Retirement", amountCents: 100, offLedger: true },
      ]),
    ).toThrow(/require contributionSource/);
    expect(() =>
      aggregateMonthTransactions([
        { txType: "Investments", category: "Retirement", amountCents: 100, contributionSource: "employee" },
      ]),
    ).toThrow(/only valid on off-ledger rows/);
    expect(() =>
      assertValidOffLedgerFields({ txType: "Investments", offLedger: true, contributionSource: "company" }),
    ).toThrow(/require contributionSource/);
    expect(() =>
      assertValidOffLedgerFields({ txType: "Investments", offLedger: true, contributionSource: "employer" }),
    ).not.toThrow();
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
    expect(report.monthOverMonth.totalOutgoingCents).toBe(225_000);
    expect(report.monthOverMonth.totalIncomingCents).toBe(300_000);
    expect(report.monthOverMonth.netCents).toBe(75_000);
    expect(report.monthOverMonth.categoryTotalsCents["Groceries"]).toBe(-10_000);
    expect(report.monthOverMonth.typeTotalsCents["Investments"]).toBe(50_000);
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
        typeTargets: { "Guilt-Free": 120_000, Investments: 40_000 },
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
    expect(report.budget?.comparison.typeDeltas["Guilt-Free"]).toEqual({
      targetCents: 120_000,
      actualCents: 115_000,
      deltaCents: -5_000,
    });
    expect(report.budget?.comparison.typeDeltas["Investments"]).toEqual({
      targetCents: 40_000,
      actualCents: 50_000,
      deltaCents: 10_000,
    });
    expect(report.budget?.comparison.outgoing).toEqual({
      targetCents: 450_000,
      actualCents: 575_000,
      deltaCents: 125_000,
    });
    expect(report.budget?.comparison.incoming).toEqual({
      targetCents: 800_000,
      actualCents: 800_000,
      deltaCents: 0,
    });
    expect(report.budget?.comparison.net).toEqual({
      targetCents: 350_000,
      actualCents: 225_000,
      deltaCents: -125_000,
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
    expect(report.current.totalOutgoingCents).toBe(575_000);
    expect(report.current.totalIncomingCents).toBe(800_000);
    expect(report.current.netCents).toBe(225_000);
    expect(report.monthOverMonth.totalOutgoingCents).toBe(225_000);
    expect(report.monthOverMonth.netCents).toBe(75_000);

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
        typeTargets: { Transfer: 50_000, "Guilt-Free": 120_000 },
        targetOutgoingCents: 450_000,
      },
    });

    expect(report.budget?.comparison.categoryDeltas["Groceries"]).toBeDefined();
    expect(report.budget?.comparison.categoryDeltas["Transfers In"]).toBeUndefined();
    expect(report.budget?.comparison.categoryDeltas["Transfers Out"]).toBeUndefined();
    expect(report.budget?.comparison.typeDeltas["Guilt-Free"]).toBeDefined();
    expect(report.budget?.comparison.typeDeltas["Transfer"]).toBeUndefined();
    // Transfer rows do not move the outgoing actual.
    expect(report.budget?.comparison.outgoing).toEqual({
      targetCents: 450_000,
      actualCents: 575_000,
      deltaCents: 125_000,
    });
  });
});

describe("percent-of-income budget targets", () => {
  // June actuals: income 800_000, Guilt-Free 115_000, Groceries 90_000, net 225_000.
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
        typePercentTargets: { "Guilt-Free": 20 },
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
    // 20% of $8,000 = $1,600 target vs $1,150 actual.
    expect(comparison.typeDeltas["Guilt-Free"]).toEqual({
      targetCents: 160_000,
      actualCents: 115_000,
      deltaCents: -45_000,
      targetPercent: 20,
    });
    // 25% of $8,000 = $2,000 net target vs $2,250 actual.
    expect(comparison.net).toEqual({
      targetCents: 200_000,
      actualCents: 225_000,
      deltaCents: 25_000,
      targetPercent: 25,
    });
  });

  it("percent targets win over cents targets for the same key", () => {
    const comparison = compareBudgetToAggregates(
      {
        categoryTargets: { Groceries: 999_999 },
        categoryPercentTargets: { Groceries: 10 },
        typeTargets: { "Guilt-Free": 999_999 },
        typePercentTargets: { "Guilt-Free": 20 },
        targetNetCents: 999_999,
        targetNetPercent: 25,
      },
      juneAggregates,
    );

    expect(comparison.categoryDeltas["Groceries"]?.targetCents).toBe(80_000);
    expect(comparison.categoryDeltas["Groceries"]?.targetPercent).toBe(10);
    expect(comparison.typeDeltas["Guilt-Free"]?.targetCents).toBe(160_000);
    expect(comparison.typeDeltas["Guilt-Free"]?.targetPercent).toBe(20);
    expect(comparison.net?.targetCents).toBe(200_000);
    expect(comparison.net?.targetPercent).toBe(25);
  });

  it("produces NO comparison rows for percent targets when the month has no income", () => {
    const noIncomeAggregates = aggregateMonthTransactions([
      { txType: "Fixed Costs", category: "Groceries", amountCents: 90_000 },
    ]);
    const comparison = compareBudgetToAggregates(
      {
        categoryTargets: { Restaurants: 50_000 },
        categoryPercentTargets: { Groceries: 10 },
        typePercentTargets: { "Guilt-Free": 20 },
        targetNetCents: 100_000,
        targetNetPercent: 25,
      },
      noIncomeAggregates,
    );

    // Percent-derived rows are absent entirely (not zero targets)...
    expect(comparison.categoryDeltas["Groceries"]).toBeUndefined();
    expect(comparison.typeDeltas["Guilt-Free"]).toBeUndefined();
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
        typeTargets: { "Fixed Costs": 400_000 },
        typePercentTargets: { "Guilt-Free": 20 },
      },
      juneAggregates,
    );

    expect(comparison.categoryDeltas["Restaurants"]).toEqual({
      targetCents: 50_000,
      actualCents: 40_000,
      deltaCents: -10_000,
    });
    expect(comparison.categoryDeltas["Groceries"]?.targetPercent).toBe(10);
    expect(comparison.typeDeltas["Fixed Costs"]).toEqual({
      targetCents: 400_000,
      actualCents: 385_000,
      deltaCents: -15_000,
    });
    expect(comparison.typeDeltas["Guilt-Free"]?.targetPercent).toBe(20);
  });

  it("still ignores Transfer percent targets end to end", () => {
    const comparison = compareBudgetToAggregates(
      {
        categoryPercentTargets: { "Transfers In": 10, "Transfers Out": 10, Groceries: 10 },
        typePercentTargets: { Transfer: 10, "Guilt-Free": 20 },
      },
      aggregateMonthTransactions([...juneTransactions, ...juneTransfers]),
    );

    expect(comparison.categoryDeltas["Transfers In"]).toBeUndefined();
    expect(comparison.categoryDeltas["Transfers Out"]).toBeUndefined();
    expect(comparison.typeDeltas["Transfer"]).toBeUndefined();
    expect(comparison.categoryDeltas["Groceries"]).toBeDefined();
    expect(comparison.typeDeltas["Guilt-Free"]).toBeDefined();
  });

  it("flows percent-derived deltas through computeMonthlyFinancialReport", () => {
    const report = computeMonthlyFinancialReport({
      monthKey: "2026-06",
      transactions: juneTransactions,
      budget: { typePercentTargets: { "Guilt-Free": 20 }, targetNetPercent: 25 },
      budgetIsDefault: true,
    });

    expect(report.budget?.comparison.typeDeltas["Guilt-Free"]).toEqual({
      targetCents: 160_000,
      actualCents: 115_000,
      deltaCents: -45_000,
      targetPercent: 20,
    });
    expect(report.budget?.comparison.net?.targetPercent).toBe(25);
  });
});

describe("legacy -> CSP migration mapping", () => {
  it("maps every legacy (type, category) pair to a valid CSP pair (completeness)", () => {
    for (const legacyType of LEGACY_TX_TYPES) {
      for (const legacyCategory of LEGACY_TX_TYPE_CATEGORIES[legacyType]) {
        const mapped = LEGACY_CSP_MAPPING[legacyType]?.[legacyCategory];
        expect(mapped, `missing mapping for ${legacyType} / ${legacyCategory}`).toBeDefined();
        expect(isValidTxTypeCategory(mapped!.txType, mapped!.category)).toBe(true);
      }
    }
    // No stray entries beyond the legacy taxonomy.
    for (const legacyType of LEGACY_TX_TYPES) {
      expect(Object.keys(LEGACY_CSP_MAPPING[legacyType]).sort()).toEqual(
        [...LEGACY_TX_TYPE_CATEGORIES[legacyType]].sort(),
      );
    }
  });

  it("keeps Income and Transfer pairs unchanged (identity mappings)", () => {
    for (const legacyType of ["Income", "Transfer"] as const) {
      for (const category of LEGACY_TX_TYPE_CATEGORIES[legacyType]) {
        expect(LEGACY_CSP_MAPPING[legacyType][category]).toEqual({ txType: legacyType, category });
      }
    }
  });

  it("migrates every legacy pair to the specified CSP pair", () => {
    const expectMigrated = (txType: string, category: string, expected: { txType: string; category: string }) =>
      expect(migrateLegacyTransaction({ txType, category, description: "Some merchant" })).toEqual(expected);

    expectMigrated("Fixed", "Mortgage, HOA, Mortgage Loan", {
      txType: "Fixed Costs",
      category: "Mortgage, HOA, Mortgage Loan",
    });
    expectMigrated("Fixed", "Recurring Bills", { txType: "Fixed Costs", category: "Recurring Bills" });
    expectMigrated("Food", "Groceries", { txType: "Fixed Costs", category: "Groceries" });
    expectMigrated("Spending", "Subscriptions", { txType: "Fixed Costs", category: "Subscriptions" });
    expectMigrated("Food", "Restaurants", { txType: "Guilt-Free", category: "Restaurants" });
    expectMigrated("Spending", "Gas, Amazon, Home Depot, Etc", {
      txType: "Guilt-Free",
      category: "Gas, Amazon, Home Depot, Etc",
    });
    expectMigrated("Spending", "Misc.", { txType: "Guilt-Free", category: "Misc." });
  });

  it("returns null for Income and Transfer pairs (already CSP, unchanged)", () => {
    expect(migrateLegacyTransaction({ txType: "Income", category: "Jeff", description: "Payroll" })).toBeNull();
    expect(migrateLegacyTransaction({ txType: "Income", category: "Holly", description: "Payroll" })).toBeNull();
    expect(
      migrateLegacyTransaction({ txType: "Transfer", category: "Transfers In", description: "From savings" }),
    ).toBeNull();
    expect(
      migrateLegacyTransaction({ txType: "Transfer", category: "Transfers Out", description: "To savings" }),
    ).toBeNull();
  });

  it("routes debt-pattern Recurring Bills rows to Debt Payments", () => {
    const debtDescriptions = [
      "CHASE CREDIT CRD AUTOPAY",
      "chase credit crd epay", // case-insensitive
      "DISCOVER E-PAYMENT",
      "CAPITAL ONE CRCARDPMT",
      "APPLECARD GSBANK PAYMENT",
      "APPLE CARD GSBANK PAYMENT", // optional space
      "LIBERTY BANK LOAN PMT",
      "FIDELITY TRANSFER",
      "Payment to Discover card", // pattern match anywhere in the description
    ];
    for (const description of debtDescriptions) {
      expect(DEBT_PAYMENT_DESCRIPTION_PATTERN.test(description)).toBe(true);
      expect(migrateLegacyTransaction({ txType: "Fixed", category: "Recurring Bills", description })).toEqual({
        txType: "Fixed Costs",
        category: "Debt Payments",
      });
    }
  });

  it("keeps non-debt Recurring Bills rows as Recurring Bills", () => {
    for (const description of ["Netflix.com", "Eversource Electric", "COMCAST CABLE"]) {
      expect(migrateLegacyTransaction({ txType: "Fixed", category: "Recurring Bills", description })).toEqual({
        txType: "Fixed Costs",
        category: "Recurring Bills",
      });
    }
  });

  it("applies the debt override ONLY to legacy Fixed / Recurring Bills", () => {
    // A Spending row that happens to mention DISCOVER still follows the plain mapping.
    expect(
      migrateLegacyTransaction({ txType: "Spending", category: "Misc.", description: "DISCOVER STORE" }),
    ).toEqual({ txType: "Guilt-Free", category: "Misc." });
    // An already-CSP Recurring Bills row is untouched even with a debt description.
    expect(
      migrateLegacyTransaction({
        txType: "Fixed Costs",
        category: "Recurring Bills",
        description: "CHASE CREDIT CRD AUTOPAY",
      }),
    ).toBeNull();
  });

  it("is idempotent: every valid CSP pair returns null", () => {
    for (const type of TX_TYPES) {
      for (const category of TX_TYPE_CATEGORIES[type]) {
        expect(
          migrateLegacyTransaction({ txType: type, category, description: "CHASE CREDIT CRD AUTOPAY" }),
        ).toBeNull();
      }
    }
  });

  it("throws loudly on pairs from neither vocabulary", () => {
    expect(() =>
      migrateLegacyTransaction({ txType: "Fixed", category: "Groceries", description: "Kroger" }),
    ).toThrow(/no CSP migration mapping/);
    expect(() =>
      migrateLegacyTransaction({ txType: "Whatever", category: "Misc.", description: "x" }),
    ).toThrow(/no CSP migration mapping/);
  });

  it("maps legacy budget TYPE keys: Fixed -> Fixed Costs, Spending -> Guilt-Free, Food -> dropped", () => {
    expect(LEGACY_CSP_BUDGET_TYPE_MAPPING).toEqual({
      Fixed: "Fixed Costs",
      Spending: "Guilt-Free",
      Food: null,
      Income: "Income",
      Transfer: "Transfer",
    });
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

describe("percent targets against the off-ledger-grossed income denominator", () => {
  // Income $8,000.00; employee 401k $700.02 pre-tax; employer match $175.00.
  const monthWithOffLedger = [...juneTransactions, employeeContribution, employerContribution];
  const aggregates = aggregateMonthTransactions(monthWithOffLedger);

  it("resolves type percent targets against incomeDenominatorCents, not totalIncomingCents", () => {
    const comparison = compareBudgetToAggregates({ typePercentTargets: { Investments: 10 } }, aggregates);
    // Denominator: 800_000 income + 70_002 employee (employer match excluded).
    expect(aggregates.incomeDenominatorCents).toBe(870_002);
    expect(comparison.typeDeltas["Investments"]).toEqual({
      targetCents: 87_000, // round(870_002 * 10%)
      actualCents: 137_502, // 50_000 on-ledger + 87_502 off-ledger
      deltaCents: 50_502,
      targetPercent: 10,
    });
  });

  it("resolves category percent targets and targetNetPercent against the same denominator", () => {
    const comparison = compareBudgetToAggregates(
      { categoryPercentTargets: { Retirement: 10 }, targetNetPercent: 20 },
      aggregates,
    );
    expect(comparison.categoryDeltas["Retirement"]).toEqual({
      targetCents: 87_000,
      actualCents: 117_502, // 30_000 on-ledger + 87_502 off-ledger
      deltaCents: 30_502,
      targetPercent: 10,
    });
    expect(comparison.net).toEqual({
      targetCents: 174_000, // round(870_002 * 20%)
      actualCents: 225_000, // net is NOT affected by off-ledger rows
      deltaCents: 51_000,
      targetPercent: 20,
    });
  });

  it("still compares cents targets for incoming against the ungrossed totalIncomingCents", () => {
    const comparison = compareBudgetToAggregates({ targetIncomingCents: 800_000 }, aggregates);
    expect(comparison.incoming).toEqual({ targetCents: 800_000, actualCents: 800_000, deltaCents: 0 });
  });

  it("lets employee off-ledger contributions alone make percent targets resolvable", () => {
    // A month with no checking income but a payroll-deducted contribution.
    const offLedgerOnly = aggregateMonthTransactions([employeeContribution]);
    expect(offLedgerOnly.totalIncomingCents).toBe(0);
    expect(offLedgerOnly.incomeDenominatorCents).toBe(70_002);
    const comparison = compareBudgetToAggregates({ typePercentTargets: { Investments: 10 } }, offLedgerOnly);
    expect(comparison.typeDeltas["Investments"]).toEqual({
      targetCents: 7_000,
      actualCents: 70_002,
      deltaCents: 63_002,
      targetPercent: 10,
    });

    // Employer-only months cannot resolve percent targets (no income at all).
    const employerOnly = aggregateMonthTransactions([employerContribution]);
    expect(employerOnly.incomeDenominatorCents).toBe(0);
    const unresolved = compareBudgetToAggregates({ typePercentTargets: { Investments: 10 } }, employerOnly);
    expect(unresolved.typeDeltas["Investments"]).toBeUndefined();
  });

  it("keeps outgoing and net unaffected by off-ledger rows end to end in the monthly report", () => {
    const withOffLedger = computeMonthlyFinancialReport({
      monthKey: "2026-06",
      transactions: monthWithOffLedger,
      previousTransactions: mayTransactions,
    });
    const withoutOffLedger = computeMonthlyFinancialReport({
      monthKey: "2026-06",
      transactions: juneTransactions,
      previousTransactions: mayTransactions,
    });
    expect(withOffLedger.current.totalOutgoingCents).toBe(withoutOffLedger.current.totalOutgoingCents);
    expect(withOffLedger.current.netCents).toBe(withoutOffLedger.current.netCents);
    expect(withOffLedger.monthOverMonth.totalOutgoingCents).toBe(
      withoutOffLedger.monthOverMonth.totalOutgoingCents,
    );
    expect(withOffLedger.monthOverMonth.netCents).toBe(withoutOffLedger.monthOverMonth.netCents);
    expect(withOffLedger.current.offLedgerInvestmentsCents.totalCents).toBe(87_502);
  });
});

describe("recurring contribution materialization planning", () => {
  const contributions = [
    { label: "401k employee contribution", amountCents: 70_002, contributionSource: "employee" as const, category: "Retirement" },
    { label: "401k employer match", amountCents: 17_500, contributionSource: "employer" as const, category: "Retirement" },
  ];

  it("builds per-source-per-month external ids", () => {
    expect(contributionExternalId("employee", "2026-04")).toBe("401k-employee-2026-04");
    expect(contributionExternalId("employer", "2026-07")).toBe("401k-employer-2026-07");
  });

  it("plans one off-ledger Investments insert per contribution, dated the 15th UTC", () => {
    const plan = planContributionMaterialization(contributions, "2026-04", new Set());
    expect(plan.skipped).toBe(0);
    expect(plan.inserts).toEqual([
      {
        date: Date.UTC(2026, 3, 15),
        monthKey: "2026-04",
        amountCents: 70_002,
        description: "401k employee contribution",
        txType: "Investments",
        category: "Retirement",
        externalId: "401k-employee-2026-04",
        offLedger: true,
        contributionSource: "employee",
      },
      {
        date: Date.UTC(2026, 3, 15),
        monthKey: "2026-04",
        amountCents: 17_500,
        description: "401k employer match",
        txType: "Investments",
        category: "Retirement",
        externalId: "401k-employer-2026-04",
        offLedger: true,
        contributionSource: "employer",
      },
    ]);
  });

  it("is idempotent: already-materialized external ids are skipped, never duplicated", () => {
    const partial = planContributionMaterialization(
      contributions,
      "2026-04",
      new Set(["401k-employee-2026-04"]),
    );
    expect(partial.skipped).toBe(1);
    expect(partial.inserts.map((row) => row.externalId)).toEqual(["401k-employer-2026-04"]);

    const rerun = planContributionMaterialization(
      contributions,
      "2026-04",
      new Set(["401k-employee-2026-04", "401k-employer-2026-04"]),
    );
    expect(rerun.inserts).toEqual([]);
    expect(rerun.skipped).toBe(2);
  });

  it("validates the configuration loudly", () => {
    expect(() => assertValidRecurringContributions(contributions)).not.toThrow();
    expect(() => planContributionMaterialization(contributions, "2026-13", new Set())).toThrow(/invalid monthKey/);
    expect(() =>
      assertValidRecurringContributions([{ ...contributions[0]!, label: "  " }]),
    ).toThrow(/label is required/);
    expect(() =>
      assertValidRecurringContributions([{ ...contributions[0]!, amountCents: -1 }]),
    ).toThrow(/must be positive/);
    expect(() =>
      assertValidRecurringContributions([{ ...contributions[0]!, amountCents: 700.02 }]),
    ).toThrow(/integer number of cents/);
    expect(() =>
      assertValidRecurringContributions([{ ...contributions[0]!, category: "Emergency Fund" }]),
    ).toThrow(/must be an Investments category/);
    // externalIds are keyed per source+month: a second same-source config can never be idempotent.
    expect(() =>
      assertValidRecurringContributions([contributions[0]!, { ...contributions[0]!, label: "duplicate" }]),
    ).toThrow(/at most one "employee" contribution/);
  });
});
