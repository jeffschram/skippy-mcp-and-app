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
import { labelIndices, scaleBarHeights, sparklineSegments, windowLabel } from "./finances-insights-helpers";
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
  Fixed: styles.bandFixed!,
  Spending: styles.bandSpending!,
  Food: styles.bandFood!,
  Income: styles.bandIncome!,
  Transfer: styles.bandTransfer!,
};

/** The four trend types. Transfers are budget-neutral and stay out of insights. */
const INSIGHT_TYPES = ["Income", "Fixed", "Spending", "Food"] as const satisfies readonly TxType[];

/** 'Jul 25' style label: short month + 2-digit year so 12+ month spans stay unambiguous. */
function monthTickLabel(monthKey: string): string {
  return `${monthKeyShortLabel(monthKey)} ${monthKey.slice(2, 4)}`;
}

/* ------------------------------------------------------------------ */
/* Compact delta indicator (same semantics as the grid's DeltaLine)    */
/* ------------------------------------------------------------------ */

function WindowDelta({
  label,
  deltaCents,
  goodWhenPositive,
}: {
  label: string;
  deltaCents: number;
  /** Income/Net: up = good (green). Outgoing types: up = bad (red). */
  goodWhenPositive?: boolean;
}) {
  const tone =
    deltaCents === 0
      ? null
      : (deltaCents > 0) === Boolean(goodWhenPositive)
        ? styles.comparisonUnder
        : styles.comparisonOver;
  return (
    <span className={cx(styles.comparison, tone)}>
      {label} {formatSignedCents(deltaCents)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Summary table: Income / Fixed / Spending / Food / Net x windows     */
/* ------------------------------------------------------------------ */

function SummaryTable({ insights }: { insights: FinancialInsights }) {
  const windows = insights.windows;
  return (
    <Card>
      <p className={styles.cardTitle}>
        Averages by type
        <span className={cx("muted", styles.cardTitleNote)}>complete months only</span>
      </p>
      <div className={styles.statsTableWrap}>
        <table className={styles.statsTable} aria-label="Type averages across trend windows">
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
            {INSIGHT_TYPES.map((type) => {
              const isIncome = type === "Income";
              return (
                <tr key={type}>
                  <th scope="row" className={styles.statsLabelCell}>
                    <span className={cx(styles.budgetTypeTag, BAND_CLASS[type])}>{type}</span>
                  </th>
                  {windows.map((window, index) => {
                    const stat = window.typeStats[type];
                    const delta = index > 0 ? insights.deltas[index - 1] : null;
                    return (
                      <td key={window.windowMonths} className={styles.statsValueCol}>
                        <span className={styles.statValue}>{formatCents(stat.meanCents)}</span>
                        {isIncome ? (
                          <span className={styles.statSub}>median {formatCents(stat.medianCents)}</span>
                        ) : null}
                        {delta ? (
                          <span className={styles.statSub}>
                            <WindowDelta
                              label={`vs ${delta.fromWindowMonths}-mo`}
                              deltaCents={delta.typeMeanDeltaCents[type]}
                              goodWhenPositive={isIncome}
                            />
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className={styles.netRowTop}>
              <th scope="row" className={styles.statsLabelCell}>
                Net
              </th>
              {windows.map((window, index) => {
                const delta = index > 0 ? insights.deltas[index - 1] : null;
                return (
                  <td key={window.windowMonths} className={styles.statsValueCol}>
                    <span
                      className={cx(
                        styles.statValue,
                        window.net.meanCents >= 0 ? styles.netPositive : styles.netNegative,
                      )}
                    >
                      {formatCents(window.net.meanCents)}
                    </span>
                    {delta ? (
                      <span className={styles.statSub}>
                        <WindowDelta
                          label={`vs ${delta.fromWindowMonths}-mo`}
                          deltaCents={delta.netMeanDeltaCents}
                          goodWhenPositive
                        />
                      </span>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Trends: hand-rolled inline SVG bar chart per type                   */
/* ------------------------------------------------------------------ */

const BAR_H = 96;
const BAR_LABEL_H = 14;
const BAR_W = 16;
const BAR_GAP = 7;
const BAR_PAD = 4;

function TypeTrendChart({ type, months }: { type: TxType; months: InsightsMonth[] }) {
  const values = months.map((month) => month.typeTotalsCents[type] ?? 0);
  const count = months.length;
  const width = BAR_PAD * 2 + count * BAR_W + Math.max(0, count - 1) * BAR_GAP;
  const heights = scaleBarHeights(values, BAR_H - 6);
  const labeled = new Set(labelIndices(count, 5));

  return (
    <Card className={BAND_CLASS[type]}>
      <p className={styles.cardTitle}>{type} by month</p>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${width} ${BAR_H + BAR_LABEL_H}`}
        role="img"
        aria-label={`${type} monthly totals over the last ${count} complete months`}
      >
        <line x1={0} y1={BAR_H} x2={width} y2={BAR_H} className={styles.chartBaseline} />
        {months.map((month, index) => {
          const x = BAR_PAD + index * (BAR_W + BAR_GAP);
          const height = heights[index] ?? 0;
          return (
            <g key={month.monthKey}>
              {/* Zero-data months are honest zero-height bars (no rect). */}
              {height > 0 ? (
                <rect
                  className={styles.chartBar}
                  x={x}
                  y={BAR_H - height}
                  width={BAR_W}
                  height={height}
                  rx={1.5}
                />
              ) : null}
              {/* Full-column hover target so exact values are reachable even at zero. */}
              <rect className={styles.chartHover} x={x - BAR_GAP / 2} y={0} width={BAR_W + BAR_GAP} height={BAR_H}>
                <title>{`${monthKeyLabel(month.monthKey)} — ${formatCents(values[index] ?? 0)}`}</title>
              </rect>
              {labeled.has(index) ? (
                <text
                  className={styles.chartAxisLabel}
                  x={index === 0 ? x : index === count - 1 ? x + BAR_W : x + BAR_W / 2}
                  y={BAR_H + 10}
                  textAnchor={index === 0 ? "start" : index === count - 1 ? "end" : "middle"}
                >
                  {monthTickLabel(month.monthKey)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Ending-balance sparkline (combined across the filtered accounts)    */
/* ------------------------------------------------------------------ */

const SPARK_W = 320;
const SPARK_H = 64;
const SPARK_PAD = 6;

function BalanceSparkline({ months }: { months: InsightsMonth[] }) {
  const values = months.map((month) => month.endingBalanceCents);
  const present = values.filter((value): value is number => value !== null);
  const segments = sparklineSegments(values, SPARK_W, SPARK_H, SPARK_PAD);

  let zeroY: number | null = null;
  if (present.length > 0) {
    const min = Math.min(...present);
    const max = Math.max(...present);
    if (min < 0 && max > 0) {
      zeroY = SPARK_PAD + ((max - 0) / (max - min)) * (SPARK_H - SPARK_PAD * 2);
    }
  }

  return (
    <Card>
      <p className={styles.cardTitle}>
        Ending balance
        <span className={cx("muted", styles.cardTitleNote)}>latest snapshot per month, summed across accounts</span>
      </p>
      {segments.length === 0 ? (
        <p className={styles.insightsNote}>No balance snapshots recorded yet.</p>
      ) : (
        <svg
          className={styles.chart}
          viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
          role="img"
          aria-label="Ending balance by month"
        >
          {zeroY !== null ? <line x1={0} y1={zeroY} x2={SPARK_W} y2={zeroY} className={styles.sparkZero} /> : null}
          {segments.map((segment, segmentIndex) =>
            segment.length > 1 ? (
              <polyline
                key={segmentIndex}
                className={styles.sparkLine}
                points={segment.map((point) => `${point.x},${point.y}`).join(" ")}
              />
            ) : null,
          )}
          {segments.flat().map((point) => (
            <circle key={point.index} className={styles.sparkDot} cx={point.x} cy={point.y} r={2.2}>
              <title>{`${monthKeyLabel(months[point.index]!.monthKey)} — ${formatCents(
                months[point.index]!.endingBalanceCents ?? 0,
              )}`}</title>
            </circle>
          ))}
        </svg>
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

  const completeMonths = useMemo(
    () => (data ? data.months.filter((month) => month.monthKey < data.currentMonthKey) : []),
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

          <SummaryTable insights={insights} />

          <div className={styles.chartsGrid}>
            {INSIGHT_TYPES.map((type) => (
              <TypeTrendChart key={type} type={type} months={completeMonths} />
            ))}
          </div>

          <BalanceSparkline months={data.months} />

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
