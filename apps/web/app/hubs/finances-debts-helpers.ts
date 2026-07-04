/* ------------------------------------------------------------------ */
/* Pure math helpers for the Finances Debts view: schedule display     */
/* capping, per-debt balance lookups, and the fixed-cost projection    */
/* after debt retirements. No React, no DOM — unit-tested per the      */
/* finances-helpers pattern.                                           */
/* ------------------------------------------------------------------ */

import type { PayoffDebtSchedule } from "@skippy/shared";

/** Ramit Sethi's Conscious Spending Plan band for Fixed Costs: 50-60% of take-home income. */
export const RAMIT_FIXED_COSTS_BAND = { minPercent: 50, maxPercent: 60 } as const;

/**
 * APR string ('22.9', '26.24%', '0') -> annual percent number (0-100, up to
 * two decimals), or null when invalid. Distinct from the budget drawer's
 * parsePercentInput, which allows only one decimal — card APRs are quoted to
 * two (e.g. 26.24%).
 */
export function parseAprInput(input: string): number | null {
  const cleaned = input.replace(/[%\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const apr = Number(cleaned);
  return apr > 100 ? null : apr;
}

/**
 * Caps the schedule table at `cap` month rows: the visible slice plus how many
 * months were hidden ('and N more months...').
 */
export function visibleScheduleMonths(
  monthKeys: readonly string[],
  cap = 36,
): { visible: string[]; hiddenCount: number } {
  if (monthKeys.length <= cap) return { visible: [...monthKeys], hiddenCount: 0 };
  return { visible: monthKeys.slice(0, cap), hiddenCount: monthKeys.length - cap };
}

/**
 * monthKey -> ending balance cents per debt, for O(1) cell lookups in the
 * schedule table. Months after a debt's payoff have no entry (rendered blank).
 */
export function endingBalancesByMonth(
  debts: readonly Pick<PayoffDebtSchedule, "id" | "schedule">[],
): Record<string, Record<string, number>> {
  const byDebt: Record<string, Record<string, number>> = {};
  for (const debt of debts) {
    const byMonth: Record<string, number> = {};
    for (const row of debt.schedule) {
      byMonth[row.monthKey] = row.endingBalanceCents;
    }
    byDebt[debt.id] = byMonth;
  }
  return byDebt;
}

export type DebtRetirementInput = {
  id: string;
  name: string;
  /** The month the plan retires this debt, or null when it never does. */
  payoffMonthKey: string | null;
  minPaymentCents: number;
};

export type FixedCostProjectionRow = {
  /** The retirement month. */
  monthKey: string;
  /** Debts retiring this month (a month can retire several at once). */
  debtNames: string[];
  /** Cumulative freed-up minimum payments once this month's debts retire. */
  freedMinPaymentCents: number;
  /** currentFixedCostsCents minus the cumulative freed minimums (floored at 0). */
  projectedFixedCostsCents: number;
  /** Projected Fixed Costs as a percent of income (0-100+, one decimal). */
  percentOfIncome: number;
  /** True on the FIRST row where the percent drops into (or below) Ramit's 50-60% band. */
  entersBand: boolean;
};

export type FixedCostProjection = {
  /** Today's Fixed Costs percent of income (one decimal), or null without income. */
  baselinePercent: number | null;
  rows: FixedCostProjectionRow[];
};

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Fixed-cost trajectory as debts retire: for each retirement month in the
 * payoff plan, the new projected monthly Fixed Costs total (current Fixed
 * Costs minus the retired debts' cumulative minimum payments) as a percent of
 * income (the latest complete month's incomeDenominatorCents). The first month
 * the percent reaches Ramit's 50-60% band (i.e. drops to <= 60%) is flagged.
 * Returns no rows when income is unknown/non-positive — percents would be
 * meaningless, never fabricated.
 */
export function projectFixedCostsAfterRetirements(
  debts: readonly DebtRetirementInput[],
  currentFixedCostsCents: number,
  incomeDenominatorCents: number,
): FixedCostProjection {
  if (!(incomeDenominatorCents > 0)) {
    return { baselinePercent: null, rows: [] };
  }
  const baselinePercent = roundPercent((currentFixedCostsCents / incomeDenominatorCents) * 100);

  // Group retiring debts by payoff month, ascending ('YYYY-MM' sorts lexically).
  const byMonth = new Map<string, DebtRetirementInput[]>();
  for (const debt of debts) {
    if (debt.payoffMonthKey === null) continue;
    const group = byMonth.get(debt.payoffMonthKey) ?? [];
    group.push(debt);
    byMonth.set(debt.payoffMonthKey, group);
  }
  const monthKeys = [...byMonth.keys()].sort((a, b) => a.localeCompare(b));

  const rows: FixedCostProjectionRow[] = [];
  let freedMinPaymentCents = 0;
  let previousPercent = baselinePercent;
  let banded = false;
  for (const monthKey of monthKeys) {
    const group = byMonth.get(monthKey)!;
    freedMinPaymentCents += group.reduce((sum, debt) => sum + debt.minPaymentCents, 0);
    const projectedFixedCostsCents = Math.max(0, currentFixedCostsCents - freedMinPaymentCents);
    const percentOfIncome = roundPercent((projectedFixedCostsCents / incomeDenominatorCents) * 100);
    const entersBand =
      !banded && percentOfIncome <= RAMIT_FIXED_COSTS_BAND.maxPercent && previousPercent > RAMIT_FIXED_COSTS_BAND.maxPercent;
    if (entersBand) banded = true;
    rows.push({
      monthKey,
      debtNames: group.map((debt) => debt.name),
      freedMinPaymentCents,
      projectedFixedCostsCents,
      percentOfIncome,
      entersBand,
    });
    previousPercent = percentOfIncome;
  }
  return { baselinePercent, rows };
}
