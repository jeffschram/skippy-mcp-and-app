"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { TrendingDown, TrendingUp } from "lucide-react";
import {
  TX_TYPE_CATEGORIES,
  computeFinancialInsights,
  type FinancialInsights,
  type InsightsMover,
  type TxType,
} from "@skippy/shared";
import { api } from "../../lib/skippy-api";
import { Card, LoadingRow, Select } from "../components";
import { useViewerReady } from "./use-viewer";
import { formatCents, formatSignedCents, monthKeyLabel, monthKeyShortLabel } from "./finances-helpers";
import { windowLabel } from "./finances-insights-helpers";
import styles from "./finances.module.css";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* Shapes (mirror convex/finances.ts insightsForViewer)                */
/* ------------------------------------------------------------------ */

type InsightsAccount = {
  _id: string;
  name: string;
  accountType: string;
  mask: string;
  institution?: string;
};

type InsightsMonth = {
  monthKey: string;
  transactionCount: number;
  typeTotalsCents: Record<string, number>;
  categoryTotalsCents: Record<string, number>;
  totalOutgoingCents: number;
  totalIncomingCents: number;
  netCents: number;
  transferNetCents: number;
  /** Combined latest end-of-day snapshot across accounts, or null when absent. */
  endingBalanceCents: number | null;
};

type InsightsData = {
  currentMonthKey: string;
  months: InsightsMonth[];
  accounts: InsightsAccount[];
};

/* ------------------------------------------------------------------ */
/* Band metadata (kept local: finances.tsx imports this file)          */
/* ------------------------------------------------------------------ */

const BAND_CLASS: Record<TxType, string> = {
  "Fixed Costs": styles.bandFixedCosts!,
  Investments: styles.bandInvestments!,
  Savings: styles.bandSavings!,
  "Guilt-Free": styles.bandGuiltFree!,
  Income: styles.bandIncome!,
  Transfer: styles.bandTransfer!,
};

/** The five trend types. Transfers are budget-neutral and stay out of insights. */
const INSIGHT_TYPES = [
  "Income",
  "Fixed Costs",
  "Investments",
  "Savings",
  "Guilt-Free",
] as const satisfies readonly TxType[];

/** 'Jul 25' style label: short month + 2-digit year so 12+ month spans stay unambiguous. */
function monthTickLabel(monthKey: string): string {
  return `${monthKeyShortLabel(monthKey)} ${monthKey.slice(2, 4)}`;
}

/* ------------------------------------------------------------------ */
/* Month matrix: Income / Fixed Costs / Investments / Savings /        */
/* Guilt-Free / Net x months                                           */
/* ------------------------------------------------------------------ */

/**
 * Type x month matrix: each cell is that month's total, colored green when it
 * moved in the good direction vs the previous month (higher for Income,
 * Investments, Savings, and Net — investing/saving more is good — lower for
 * Fixed Costs/Guilt-Free) and red when it moved the wrong way.
 */
function MonthMatrix({ months, currentMonthKey }: { months: InsightsMonth[]; currentMonthKey: string }) {
  const rows: Array<{ label: string; goodWhenHigher: boolean; value: (m: InsightsMonth) => number }> = [
    { label: "Income", goodWhenHigher: true, value: (m) => m.typeTotalsCents.Income ?? 0 },
    { label: "Fixed Costs", goodWhenHigher: false, value: (m) => m.typeTotalsCents["Fixed Costs"] ?? 0 },
    { label: "Investments", goodWhenHigher: true, value: (m) => m.typeTotalsCents.Investments ?? 0 },
    { label: "Savings", goodWhenHigher: true, value: (m) => m.typeTotalsCents.Savings ?? 0 },
    { label: "Guilt-Free", goodWhenHigher: false, value: (m) => m.typeTotalsCents["Guilt-Free"] ?? 0 },
    { label: "Net", goodWhenHigher: true, value: (m) => m.netCents },
  ];
  return (
    <Card>
      <p className={styles.cardTitle}>
        Type by month
        <span className={cx("muted", styles.cardTitleNote)}>
          green = better than the previous month
        </span>
      </p>
      <div className={styles.statsTableWrap}>
        <table className={styles.statsTable} aria-label="Monthly totals by type">
          <thead>
            <tr>
              <th scope="col" className={styles.statsHead} />
              {months.map((month) => (
                <th key={month.monthKey} scope="col" className={cx(styles.statsHead, styles.statsValueCol)}>
                  {monthTickLabel(month.monthKey)}
                  {month.monthKey === currentMonthKey ? (
                    <span className={styles.statSub}>MTD</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={row.label === "Net" ? styles.netRowTop : undefined}>
                <th scope="row" className={styles.statsLabelCell}>
                  {row.label === "Net" ? (
                    "Net"
                  ) : (
                    <span className={cx(styles.budgetTypeTag, BAND_CLASS[row.label as TxType])}>{row.label}</span>
                  )}
                </th>
                {months.map((month, index) => {
                  const value = row.value(month);
                  const prev = index > 0 ? row.value(months[index - 1]!) : null;
                  const tone =
                    prev === null || value === prev
                      ? null
                      : (value > prev) === row.goodWhenHigher
                        ? styles.comparisonUnder
                        : styles.comparisonOver;
                  return (
                    <td key={month.monthKey} className={styles.statsValueCol}>
                      <span
                        className={cx(styles.statValue, tone)}
                        title={
                          prev === null
                            ? monthKeyLabel(month.monthKey)
                            : `${monthKeyLabel(month.monthKey)}: ${formatSignedCents(value - prev)} vs previous month`
                        }
                      >
                        {formatCents(value)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Ending balance by month (matrix, modeled on MonthMatrix)            */
/* ------------------------------------------------------------------ */

function BalanceMatrix({ months, currentMonthKey }: { months: InsightsMonth[]; currentMonthKey: string }) {
  const hasAny = months.some((month) => month.endingBalanceCents !== null);
  return (
    <Card>
      <p className={styles.cardTitle}>
        Ending balance by month
        <span className={cx("muted", styles.cardTitleNote)}>
          latest snapshot per month, summed across accounts
        </span>
      </p>
      {!hasAny ? (
        <p className={styles.insightsNote}>No balance snapshots recorded yet.</p>
      ) : (
        <div className={styles.statsTableWrap}>
          <table className={styles.statsTable} aria-label="Ending balance by month">
            <thead>
              <tr>
                <th scope="col" className={styles.statsHead} />
                {months.map((month) => (
                  <th key={month.monthKey} scope="col" className={cx(styles.statsHead, styles.statsValueCol)}>
                    {monthTickLabel(month.monthKey)}
                    {month.monthKey === currentMonthKey ? <span className={styles.statSub}>MTD</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className={styles.statsLabelCell}>
                  Ending balance
                </th>
                {months.map((month, index) => {
                  const value = month.endingBalanceCents;
                  const prev = index > 0 ? months[index - 1]!.endingBalanceCents : null;
                  const tone =
                    value === null || prev === null || value === prev
                      ? null
                      : value > prev
                        ? styles.comparisonUnder
                        : styles.comparisonOver;
                  return (
                    <td key={month.monthKey} className={styles.statsValueCol}>
                      <span
                        className={cx(styles.statValue, tone)}
                        title={
                          value === null || prev === null
                            ? monthKeyLabel(month.monthKey)
                            : `${monthKeyLabel(month.monthKey)}: ${formatSignedCents(value - prev)} vs previous month`
                        }
                      >
                        {value === null ? "—" : formatCents(value)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Per-category table                                                  */
/* ------------------------------------------------------------------ */

function CategoryTable({ insights }: { insights: FinancialInsights }) {
  const windows = insights.windows;
  return (
    <Card>
      <p className={styles.cardTitle}>Averages by category</p>
      <div className={styles.statsTableWrap}>
        <table className={styles.statsTable} aria-label="Category averages across trend windows">
          <thead>
            <tr>
              <th scope="col" className={styles.statsHead} />
              {windows.map((window) => (
                <th
                  key={window.windowMonths}
                  scope="col"
                  className={cx(styles.statsHead, styles.statsValueCol)}
                >
                  {windowLabel(window.windowMonths, window.monthsUsed)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {INSIGHT_TYPES.map((type) => (
              <FragmentRows key={type} type={type} insights={insights} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function FragmentRows({ type, insights }: { type: (typeof INSIGHT_TYPES)[number]; insights: FinancialInsights }) {
  const windows = insights.windows;
  return (
    <>
      <tr className={cx(styles.statsGroupRow, BAND_CLASS[type])}>
        <th scope="rowgroup" colSpan={windows.length + 1}>
          {type}
        </th>
      </tr>
      {TX_TYPE_CATEGORIES[type].map((category) => (
        <tr key={category}>
          <th scope="row" className={cx(styles.statsCategoryCell)}>
            {category}
          </th>
          {windows.map((window) => (
            <td key={window.windowMonths} className={styles.statsValueCol}>
              <span className={styles.statValue}>
                {formatCents(
                  (window.categoryStats as Record<string, { meanCents: number }>)[category]?.meanCents ?? 0,
                )}
              </span>
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Biggest movers card                                                 */
/* ------------------------------------------------------------------ */

function MoversCard({ insights }: { insights: FinancialInsights }) {
  const longMonths = insights.windows[0]?.windowMonths ?? 12;
  const shortMonths = insights.windows[insights.windows.length - 1]?.windowMonths ?? 2;
  return (
    <Card>
      <p className={styles.cardTitle}>
        Biggest movers
        <span className={cx("muted", styles.cardTitleNote)}>
          {shortMonths}-mo pace vs {longMonths}-mo baseline
        </span>
      </p>
      {insights.biggestMovers.length === 0 ? (
        <p className={styles.insightsNote}>No category movement across the trend windows yet.</p>
      ) : (
        <ul className={styles.moversList}>
          {insights.biggestMovers.map((mover) => (
            <MoverRow key={mover.category} mover={mover} longMonths={longMonths} shortMonths={shortMonths} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function MoverRow({
  mover,
  longMonths,
  shortMonths,
}: {
  mover: InsightsMover;
  longMonths: number;
  shortMonths: number;
}) {
  const up = mover.deltaCents > 0;
  // More income = good; more spending = bad (mirrors the grid's delta semantics).
  const good = up === (mover.txType === "Income");
  const tone = good ? styles.comparisonUnder : styles.comparisonOver;
  return (
    <li className={styles.moverRow}>
      <span className={styles.moverName}>
        <span className={cx(styles.moverArrow, tone)} aria-label={up ? "up" : "down"}>
          {up ? <TrendingUp size={15} aria-hidden /> : <TrendingDown size={15} aria-hidden />}
        </span>
        <span className={cx(styles.budgetTypeTag, BAND_CLASS[mover.txType])}>{mover.txType}</span>
        {mover.category}
      </span>
      <span className={styles.moverValues}>
        {longMonths}-mo {formatCents(mover.longMeanCents)} → {shortMonths}-mo {formatCents(mover.shortMeanCents)}
        {mover.percentChange !== null ? (
          <span className={cx(styles.moverPercent, tone)}>
            {mover.percentChange > 0 ? "+" : ""}
            {mover.percentChange}%
          </span>
        ) : null}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* 'This month so far' card (partial month, never in averages)         */
/* ------------------------------------------------------------------ */

function MonthToDateCard({ month }: { month: InsightsMonth }) {
  return (
    <Card>
      <p className={styles.cardTitle}>
        This month so far
        <span className={cx("muted", styles.cardTitleNote)}>
          {monthKeyLabel(month.monthKey)} · month-to-date, excluded from all averages
        </span>
      </p>
      <div className={styles.mtdList}>
        {INSIGHT_TYPES.map((type) => (
          <div key={type} className={styles.mtdRow}>
            <span className={cx(styles.budgetTypeTag, BAND_CLASS[type])}>{type}</span>
            <span className={styles.mtdValue}>{formatCents(month.typeTotalsCents[type] ?? 0)}</span>
          </div>
        ))}
        <div className={styles.mtdRow}>
          <span>Net</span>
          <span className={cx(styles.mtdValue, month.netCents >= 0 ? styles.netPositive : styles.netNegative)}>
            {formatCents(month.netCents)}
          </span>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* The Insights view                                                   */
/* ------------------------------------------------------------------ */

export function FinancesInsightsView({ accounts }: { accounts: InsightsAccount[] }) {
  const viewerReady = useViewerReady();
  /** "all" = every account combined (transfers can't double count: the shared
   *  math excludes the Transfer type from outgoing/incoming/net). */
  const [accountFilter, setAccountFilter] = useState<string>("all");

  const data = useQuery(
    api.finances.insightsForViewer,
    viewerReady ? (accountFilter === "all" ? {} : { accountId: accountFilter as any }) : "skip",
  ) as InsightsData | undefined;

  const insights = useMemo(
    () => (data ? computeFinancialInsights(data.months, { currentMonthKey: data.currentMonthKey }) : null),
    [data],
  );

  const currentMonth = data?.months.find((month) => month.monthKey === data.currentMonthKey);

  return (
    <div className={styles.insightsStack}>
      <div className={styles.controls}>
        <div className={styles.controlsGroup}>
          <Select
            aria-label="Account filter"
            value={accountFilter}
            onChange={(event) => setAccountFilter(event.target.value)}
          >
            <option value="all">All accounts</option>
            {accounts.map((account) => (
              <option key={account._id} value={account._id}>
                {account.name} (...{account.mask})
              </option>
            ))}
          </Select>
          {accountFilter === "all" && accounts.length > 1 ? (
            <span className={styles.accountMeta}>{accounts.length} accounts combined</span>
          ) : null}
        </div>
        {data ? (
          <p className={styles.insightsNote}>
            Averages use complete months only — {monthKeyLabel(data.currentMonthKey)} is shown separately as
            month-to-date.
          </p>
        ) : null}
      </div>

      {data === undefined || !insights ? (
        <Card>
          <LoadingRow label="Loading insights..." />
        </Card>
      ) : (
        <>
          {insights.completeMonthKeys.length === 0 ? (
            <p className={styles.insightsNote}>
              No complete months of data yet — trends will appear once a full month of transactions exists.
            </p>
          ) : null}

          <MonthMatrix months={data.months} currentMonthKey={data.currentMonthKey} />

          <BalanceMatrix months={data.months} currentMonthKey={data.currentMonthKey} />

          <div className={styles.insightsSideGrid}>
            <CategoryTable insights={insights} />
            <div className={styles.insightsStack}>
              <MoversCard insights={insights} />
              {currentMonth ? <MonthToDateCard month={currentMonth} /> : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
