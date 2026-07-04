import { describe, expect, it } from "vitest";
import {
  PAYOFF_MAX_MONTHS,
  computePayoffPlan,
  matchDebtPayments,
  monthlyInterestCents,
  nextMonthKey,
  orderDebtsForStrategy,
  type PayoffDebtInput,
} from "./index";

const debt = (overrides: Partial<PayoffDebtInput> & { id: string }): PayoffDebtInput => ({
  name: overrides.id,
  balanceCents: 100_000,
  apr: 20,
  minPaymentCents: 5_000,
  ...overrides,
});

describe("nextMonthKey", () => {
  it("advances within a year and across a year boundary", () => {
    expect(nextMonthKey("2026-07")).toBe("2026-08");
    expect(nextMonthKey("2025-12")).toBe("2026-01");
  });

  it("rejects invalid month keys", () => {
    expect(() => nextMonthKey("2026-13")).toThrow(/invalid monthKey/);
  });
});

describe("monthlyInterestCents", () => {
  it("computes rounded monthly interest from an annual rate", () => {
    // $10,000.00 at 24% APR -> 2% monthly -> $200.00.
    expect(monthlyInterestCents(1_000_000, 24)).toBe(20_000);
    // $1,279.42 at 7% -> 127942 * 0.07 / 12 = 746.3283... -> 746.
    expect(monthlyInterestCents(127_942, 7)).toBe(746);
    expect(monthlyInterestCents(100_000, 0)).toBe(0);
  });
});

describe("orderDebtsForStrategy", () => {
  const debts = [
    debt({ id: "low-apr-small", apr: 5, balanceCents: 10_000 }),
    debt({ id: "high-apr-big", apr: 29, balanceCents: 900_000 }),
    debt({ id: "mid-apr-mid", apr: 15, balanceCents: 50_000 }),
  ];

  it("avalanche targets the highest APR first", () => {
    expect(orderDebtsForStrategy(debts, "avalanche").map((d) => d.id)).toEqual([
      "high-apr-big",
      "mid-apr-mid",
      "low-apr-small",
    ]);
  });

  it("snowball targets the smallest balance first", () => {
    expect(orderDebtsForStrategy(debts, "snowball").map((d) => d.id)).toEqual([
      "low-apr-small",
      "mid-apr-mid",
      "high-apr-big",
    ]);
  });
});

describe("computePayoffPlan", () => {
  it("computes exact interest math on a single debt", () => {
    // $1,000.00 at 12% APR (1%/mo), $500 minimum, no extra.
    const plan = computePayoffPlan(
      [debt({ id: "a", balanceCents: 100_000, apr: 12, minPaymentCents: 50_000 })],
      0,
      "avalanche",
      "2026-07",
    );
    const schedule = plan.debts[0]!.schedule;
    // Month 1: 100000 + 1000 interest - 50000 = 51000.
    expect(schedule[0]).toEqual({
      monthKey: "2026-07",
      startingBalanceCents: 100_000,
      interestCents: 1_000,
      paymentCents: 50_000,
      endingBalanceCents: 51_000,
    });
    // Month 2: 51000 + 510 - 50000 = 1510.
    expect(schedule[1]).toEqual({
      monthKey: "2026-08",
      startingBalanceCents: 51_000,
      interestCents: 510,
      paymentCents: 50_000,
      endingBalanceCents: 1_510,
    });
    // Month 3: 1510 + 15 = 1525, final payment capped at the accrued balance.
    expect(schedule[2]).toEqual({
      monthKey: "2026-09",
      startingBalanceCents: 1_510,
      interestCents: 15,
      paymentCents: 1_525,
      endingBalanceCents: 0,
    });
    expect(plan.debts[0]!.payoffMonthKey).toBe("2026-09");
    expect(plan.debtFreeMonthKey).toBe("2026-09");
    expect(plan.totalMonths).toBe(3);
    expect(plan.totalInterestCents).toBe(1_000 + 510 + 15);
    expect(plan.truncated).toBe(false);
    expect(plan.nonAmortizingDebtIds).toEqual([]);
  });

  it("pays a zero-APR debt off with no interest", () => {
    const plan = computePayoffPlan(
      [debt({ id: "zero", balanceCents: 30_000, apr: 0, minPaymentCents: 10_000 })],
      0,
      "snowball",
      "2026-01",
    );
    expect(plan.totalInterestCents).toBe(0);
    expect(plan.debts[0]!.payoffMonthKey).toBe("2026-03");
    expect(plan.debts[0]!.totalPaidCents).toBe(30_000);
    expect(plan.debts[0]!.schedule.every((row) => row.interestCents === 0)).toBe(true);
  });

  it("sends extra to the highest APR under avalanche and the smallest balance under snowball", () => {
    const debts = [
      debt({ id: "big-high-apr", balanceCents: 500_000, apr: 25, minPaymentCents: 15_000 }),
      debt({ id: "small-low-apr", balanceCents: 40_000, apr: 5, minPaymentCents: 5_000 }),
    ];
    const avalanche = computePayoffPlan(debts, 20_000, "avalanche", "2026-07");
    const avalancheTarget = avalanche.debts.find((d) => d.id === "big-high-apr")!;
    const avalancheOther = avalanche.debts.find((d) => d.id === "small-low-apr")!;
    // Extra lands on the high-APR debt; the other pays minimum only.
    expect(avalancheTarget.schedule[0]!.paymentCents).toBe(15_000 + 20_000);
    expect(avalancheOther.schedule[0]!.paymentCents).toBe(5_000);

    const snowball = computePayoffPlan(debts, 20_000, "snowball", "2026-07");
    const snowballTarget = snowball.debts.find((d) => d.id === "small-low-apr")!;
    const snowballOther = snowball.debts.find((d) => d.id === "big-high-apr")!;
    expect(snowballTarget.schedule[0]!.paymentCents).toBe(5_000 + 20_000);
    expect(snowballOther.schedule[0]!.paymentCents).toBe(15_000);

    // Avalanche never pays more total interest than snowball on the same inputs.
    expect(avalanche.totalInterestCents).toBeLessThanOrEqual(snowball.totalInterestCents);
  });

  it("rolls a retired debt's minimum (and leftover extra) into the next target", () => {
    const debts = [
      // Retires in month 1: 20000 balance, extra 10000 + min 15000 covers it.
      debt({ id: "small", balanceCents: 20_000, apr: 0, minPaymentCents: 15_000 }),
      debt({ id: "large", balanceCents: 300_000, apr: 0, minPaymentCents: 10_000 }),
    ];
    const plan = computePayoffPlan(debts, 10_000, "snowball", "2026-01");
    const small = plan.debts.find((d) => d.id === "small")!;
    const large = plan.debts.find((d) => d.id === "large")!;

    // Month 1: small pays 15000 min + 5000 extra = 20000 (retired); the
    // leftover 5000 extra cascades to large the SAME month.
    expect(small.schedule[0]!.paymentCents).toBe(20_000);
    expect(small.payoffMonthKey).toBe("2026-01");
    expect(large.schedule[0]!.paymentCents).toBe(10_000 + 5_000);

    // Month 2 onward: large gets its own 10000 min + 10000 extra + small's
    // freed-up 15000 minimum = 35000.
    expect(large.schedule[1]!.paymentCents).toBe(35_000);
  });

  it("flags non-amortizing debts and caps the simulation instead of looping forever", () => {
    // $10,000.00 at 24% APR accrues $200.00/mo interest; a $150 minimum can never amortize.
    const plan = computePayoffPlan(
      [debt({ id: "stuck", balanceCents: 1_000_000, apr: 24, minPaymentCents: 15_000 })],
      0,
      "avalanche",
      "2026-01",
    );
    expect(plan.nonAmortizingDebtIds).toEqual(["stuck"]);
    expect(plan.debts[0]!.nonAmortizing).toBe(true);
    expect(plan.truncated).toBe(true);
    expect(plan.debtFreeMonthKey).toBeNull();
    expect(plan.totalMonths).toBe(PAYOFF_MAX_MONTHS);
    expect(plan.interestSavedVsMinimumCents).toBeNull();
    expect(plan.monthsSaved).toBeNull();
  });

  it("pays off a non-amortizing debt when extra payments cover the gap", () => {
    const plan = computePayoffPlan(
      [debt({ id: "stuck", balanceCents: 1_000_000, apr: 24, minPaymentCents: 15_000 })],
      50_000,
      "avalanche",
      "2026-01",
    );
    expect(plan.nonAmortizingDebtIds).toEqual(["stuck"]);
    expect(plan.truncated).toBe(false);
    expect(plan.debtFreeMonthKey).not.toBeNull();
    // The minimums-only baseline is truncated, so savings stay null (honest).
    expect(plan.interestSavedVsMinimumCents).toBeNull();
    expect(plan.monthsSaved).toBeNull();
  });

  it("computes interest and months saved vs the minimums-only baseline", () => {
    const debts = [
      debt({ id: "a", balanceCents: 200_000, apr: 18, minPaymentCents: 10_000 }),
      debt({ id: "b", balanceCents: 100_000, apr: 24, minPaymentCents: 5_000 }),
    ];
    const withExtra = computePayoffPlan(debts, 30_000, "avalanche", "2026-07");
    const baseline = computePayoffPlan(debts, 0, "avalanche", "2026-07");
    expect(withExtra.interestSavedVsMinimumCents).toBe(
      baseline.totalInterestCents - withExtra.totalInterestCents,
    );
    expect(withExtra.monthsSaved).toBe(baseline.totalMonths - withExtra.totalMonths);
    expect(withExtra.interestSavedVsMinimumCents!).toBeGreaterThan(0);
    expect(withExtra.monthsSaved!).toBeGreaterThan(0);
    // With extra = 0 the plan IS the baseline: zero saved, zero months.
    expect(baseline.interestSavedVsMinimumCents).toBe(0);
    expect(baseline.monthsSaved).toBe(0);
  });

  it("returns an empty plan for no debts (and for all-zero balances)", () => {
    const empty = computePayoffPlan([], 10_000, "avalanche", "2026-07");
    expect(empty.monthKeys).toEqual([]);
    expect(empty.debtFreeMonthKey).toBeNull();
    expect(empty.totalInterestCents).toBe(0);
    expect(empty.truncated).toBe(false);

    const zeroed = computePayoffPlan([debt({ id: "done", balanceCents: 0 })], 10_000, "avalanche", "2026-07");
    expect(zeroed.monthKeys).toEqual([]);
    expect(zeroed.debts[0]!.schedule).toEqual([]);
  });

  it("validates inputs loudly", () => {
    expect(() => computePayoffPlan([debt({ id: "a", balanceCents: 10.5 })], 0, "avalanche", "2026-07")).toThrow(
      /integer/,
    );
    expect(() => computePayoffPlan([debt({ id: "a", apr: 101 })], 0, "avalanche", "2026-07")).toThrow(/apr/);
    expect(() => computePayoffPlan([debt({ id: "a" })], -100, "avalanche", "2026-07")).toThrow(
      /extraMonthlyCents/,
    );
    expect(() => computePayoffPlan([debt({ id: "a" })], 0, "avalanche", "2026-7")).toThrow(/startMonthKey/);
    expect(() =>
      computePayoffPlan([debt({ id: "a" }), debt({ id: "a" })], 0, "avalanche", "2026-07"),
    ).toThrow(/duplicated/);
  });
});

describe("matchDebtPayments", () => {
  const tx = (
    description: string,
    overrides: Partial<{ txType: string; category: string; date: number; amountCents: number }> = {},
  ) => ({
    description,
    txType: "Fixed Costs",
    category: "Debt Payments",
    date: 1,
    amountCents: 10_000,
    ...overrides,
  });

  it("matches case-insensitively against Fixed Costs / Debt Payments rows, sorted by date desc", () => {
    const rows = [
      tx("LIBERTY BANK LOAN PMT", { date: 10 }),
      tx("Liberty Bank loan pmt", { date: 30 }),
      tx("DISCOVER E-PAYMENT", { date: 20 }),
    ];
    const matched = matchDebtPayments({ matchPattern: "liberty bank" }, rows);
    expect(matched.map((row) => row.date)).toEqual([30, 10]);
  });

  it("ignores rows outside Fixed Costs / Debt Payments when categorized matches exist", () => {
    const rows = [
      tx("CHASE CREDIT CRD EPAY", { date: 5 }),
      tx("CHASE CREDIT CRD EPAY", { date: 9, txType: "Guilt-Free", category: "Misc." }),
    ];
    const matched = matchDebtPayments({ matchPattern: "CHASE CREDIT CRD" }, rows);
    expect(matched).toHaveLength(1);
    expect(matched[0]!.date).toBe(5);
  });

  it("falls back to any type/category when no Debt Payments row matches", () => {
    const rows = [
      tx("APPLECARD GSBANK PAYMENT", { date: 7, txType: "Guilt-Free", category: "Misc." }),
      tx("Groceries", { date: 8, txType: "Fixed Costs", category: "Groceries" }),
    ];
    const matched = matchDebtPayments({ matchPattern: "APPLE CARD|APPLECARD" }, rows);
    expect(matched).toHaveLength(1);
    expect(matched[0]!.description).toBe("APPLECARD GSBANK PAYMENT");
  });

  it("treats an invalid regex as a plain case-insensitive substring", () => {
    const rows = [tx("PAYMENT (AUTOPAY *CHASE"), tx("SOMETHING ELSE")];
    const matched = matchDebtPayments({ matchPattern: "(autopay *chase" }, rows);
    expect(matched).toHaveLength(1);
    expect(matched[0]!.description).toBe("PAYMENT (AUTOPAY *CHASE");
  });

  it("matches nothing without a pattern", () => {
    expect(matchDebtPayments({}, [tx("LIBERTY BANK")])).toEqual([]);
    expect(matchDebtPayments({ matchPattern: "  " }, [tx("LIBERTY BANK")])).toEqual([]);
  });
});
