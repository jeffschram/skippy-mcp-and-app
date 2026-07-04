"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { HandCoins, Pencil, Plus, Trash2 } from "lucide-react";
import type { PayoffPlan, PayoffStrategy } from "@skippy/shared";
import { api } from "../../lib/skippy-api";
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  LoadingRow,
  Select,
  TextInput,
  useToast,
} from "../components";
import { useViewerReady } from "./use-viewer";
import {
  currentMonthKey,
  formatCents,
  monthKeyLabel,
  monthKeyShortLabel,
  parseDollarsToCents,
} from "./finances-helpers";
import {
  RAMIT_FIXED_COSTS_BAND,
  endingBalancesByMonth,
  parseAprInput,
  projectFixedCostsAfterRetirements,
  visibleScheduleMonths,
} from "./finances-debts-helpers";
import styles from "./finances.module.css";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* Shapes (mirror convex/finances.ts payoffPlanForViewer)              */
/* ------------------------------------------------------------------ */

type MatchedPayments = {
  count: number;
  totalCents: number;
  lastDate: number | null;
};

type DebtRow = {
  _id: string;
  name: string;
  lender?: string;
  balanceCents: number;
  balanceAsOf: number;
  apr: number;
  minPaymentCents: number;
  matchPattern?: string;
  updatedAt: number;
  matchedPayments: MatchedPayments;
  projectedBalanceCents: number;
};

type PayoffPlanData = {
  strategy: PayoffStrategy;
  extraMonthlyCents: number;
  startMonthKey: string;
  debts: DebtRow[];
  plan: PayoffPlan | null;
};

type InsightsMonth = {
  monthKey: string;
  typeTotalsCents: Record<string, number>;
  netCents: number;
  incomeDenominatorCents: number;
};

type InsightsData = {
  currentMonthKey: string;
  months: InsightsMonth[];
};

/** '2026-05-01T...' epoch ms -> 'May 1' (UTC, matching the backend's date math). */
function shortDateLabel(epochMs: number): string {
  const date = new Date(epochMs);
  return `${monthKeyShortLabel(currentMonthKey(epochMs))} ${date.getUTCDate()}`;
}

/* ------------------------------------------------------------------ */
/* Debt add/edit dialog                                                */
/* ------------------------------------------------------------------ */

type DebtDraft = {
  name: string;
  lender: string;
  balance: string;
  apr: string;
  minPayment: string;
  matchPattern: string;
};

const EMPTY_DRAFT: DebtDraft = { name: "", lender: "", balance: "", apr: "", minPayment: "", matchPattern: "" };

function DebtDialog({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: DebtRow | null;
}) {
  const toast = useToast();
  const upsertDebt = useMutation(api.finances.upsertDebtForViewer);
  const deleteDebt = useMutation(api.finances.deleteDebtForViewer);
  const [draft, setDraft] = useState<DebtDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);

  // Seed the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setDraft(
      editing
        ? {
            name: editing.name,
            lender: editing.lender ?? "",
            balance: (editing.balanceCents / 100).toFixed(2),
            apr: String(editing.apr),
            minPayment: (editing.minPaymentCents / 100).toFixed(2),
            matchPattern: editing.matchPattern ?? "",
          }
        : EMPTY_DRAFT,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed only on open
  }, [open]);

  const save = async () => {
    if (!draft.name.trim()) return toast("Enter a debt name.", "error");
    const balanceCents = parseDollarsToCents(draft.balance);
    if (balanceCents === null || balanceCents < 0) {
      return toast("Enter a valid balance, like 8250.00.", "error");
    }
    const apr = parseAprInput(draft.apr);
    if (apr === null) return toast("Enter a valid APR between 0 and 100, like 22.9.", "error");
    const minPaymentCents = parseDollarsToCents(draft.minPayment);
    if (minPaymentCents === null || minPaymentCents < 0) {
      return toast("Enter a valid minimum payment, like 275.00.", "error");
    }
    setBusy(true);
    try {
      // The balance-as-of timestamp anchors payment matching: entering a NEW
      // balance resets it to now; editing other fields keeps the old anchor.
      const balanceAsOf =
        editing && editing.balanceCents === balanceCents ? editing.balanceAsOf : Date.now();
      await upsertDebt({
        ...(editing ? { debtId: editing._id as any } : {}),
        name: draft.name.trim(),
        ...(draft.lender.trim() ? { lender: draft.lender.trim() } : {}),
        balanceCents,
        balanceAsOf,
        apr,
        minPaymentCents,
        ...(draft.matchPattern.trim() ? { matchPattern: draft.matchPattern.trim() } : {}),
      });
      toast(editing ? "Debt updated." : "Debt added.", "success");
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save debt", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await deleteDebt({ debtId: editing._id as any });
      toast("Debt deleted.", "success");
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not delete debt", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={editing ? "Edit debt" : "Add debt"}>
      <div className={styles.formGrid}>
        <div className={styles.formRow}>
          <Field label="Name">
            <TextInput
              placeholder="Wedding loan"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field label="Lender (optional)">
            <TextInput
              placeholder="Liberty Bank"
              value={draft.lender}
              onChange={(event) => setDraft({ ...draft, lender: event.target.value })}
            />
          </Field>
        </div>
        <div className={styles.formRow}>
          <Field label="Current balance ($)">
            <TextInput
              inputMode="decimal"
              placeholder="8250.00"
              value={draft.balance}
              onChange={(event) => setDraft({ ...draft, balance: event.target.value })}
            />
          </Field>
          <Field label="APR (%)">
            <TextInput
              inputMode="decimal"
              placeholder="22.9"
              value={draft.apr}
              onChange={(event) => setDraft({ ...draft, apr: event.target.value })}
            />
          </Field>
        </div>
        <div className={styles.formRow}>
          <Field label="Minimum payment ($/mo)">
            <TextInput
              inputMode="decimal"
              placeholder="275.00"
              value={draft.minPayment}
              onChange={(event) => setDraft({ ...draft, minPayment: event.target.value })}
            />
          </Field>
          <Field label="Payment match pattern (optional)">
            <TextInput
              placeholder="LIBERTY BANK"
              value={draft.matchPattern}
              onChange={(event) => setDraft({ ...draft, matchPattern: event.target.value })}
            />
          </Field>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          The match pattern finds this debt&apos;s payments in recorded transactions (case-insensitive text
          or regex against descriptions) so the balance auto-decreases as payments land. Entering a new
          balance resets matching to start from today.
        </p>
        <div className={styles.formActions}>
          {editing ? (
            <Button variant="danger" onClick={() => void remove()} disabled={busy}>
              <Trash2 size={15} aria-hidden /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className={styles.formActionsEnd}>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy}>
              {editing ? "Save changes" : "Add debt"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Debt list                                                           */
/* ------------------------------------------------------------------ */

function DebtList({ debts, onEdit }: { debts: DebtRow[]; onEdit: (debt: DebtRow) => void }) {
  return (
    <div className={styles.debtList}>
      {debts.map((debt) => (
        <Card key={debt._id} className={styles.debtCard}>
          <div className={styles.debtCardHead}>
            <div>
              <p className={styles.debtName}>{debt.name}</p>
              {debt.lender ? <p className={styles.debtLender}>{debt.lender}</p> : null}
            </div>
            <Button variant="ghost" onClick={() => onEdit(debt)} title="Edit this debt">
              <Pencil size={14} aria-hidden /> Edit
            </Button>
          </div>
          <div className={styles.debtFacts}>
            <span className={styles.debtFact}>
              <span className={styles.debtFactLabel}>Balance</span>
              <span className={styles.debtFactValue}>{formatCents(debt.projectedBalanceCents)}</span>
              {debt.projectedBalanceCents !== debt.balanceCents ? (
                <span
                  className={styles.debtFactNote}
                  title={`Entered ${formatCents(debt.balanceCents)} on ${shortDateLabel(debt.balanceAsOf)}; matched payments subtracted since.`}
                >
                  entered {formatCents(debt.balanceCents)}
                </span>
              ) : null}
            </span>
            <span className={styles.debtFact}>
              <span className={styles.debtFactLabel}>APR</span>
              <span className={styles.debtFactValue}>{debt.apr}%</span>
            </span>
            <span className={styles.debtFact}>
              <span className={styles.debtFactLabel}>Min payment</span>
              <span className={styles.debtFactValue}>{formatCents(debt.minPaymentCents)}/mo</span>
            </span>
            {debt.matchPattern ? (
              <span className={styles.debtFact}>
                <span className={styles.debtFactLabel}>Matches</span>
                <span className={styles.debtFactValue}>
                  <code className={styles.debtPattern}>{debt.matchPattern}</code>
                </span>
              </span>
            ) : null}
          </div>
          <p className={styles.debtMatchLine}>
            {debt.matchPattern
              ? debt.matchedPayments.count > 0
                ? `${debt.matchedPayments.count} payment${debt.matchedPayments.count === 1 ? "" : "s"} matched since ${shortDateLabel(debt.balanceAsOf)} — ${formatCents(debt.matchedPayments.totalCents)}`
                : `No payments matched since ${shortDateLabel(debt.balanceAsOf)}`
              : "No match pattern — balance only changes when you re-enter it."}
          </p>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Headline cards                                                      */
/* ------------------------------------------------------------------ */

function HeadlineCards({ plan }: { plan: PayoffPlan }) {
  return (
    <div className={styles.debtHeadlineGrid}>
      <Card>
        <p className={styles.cardTitle}>Debt-free</p>
        <p className={styles.debtHeadlineValue}>
          {plan.debtFreeMonthKey ? monthKeyLabel(plan.debtFreeMonthKey) : "Not within 50 years"}
        </p>
        {plan.debtFreeMonthKey ? (
          <p className={styles.debtHeadlineSub}>
            {plan.totalMonths} month{plan.totalMonths === 1 ? "" : "s"} on this plan
          </p>
        ) : null}
      </Card>
      <Card>
        <p className={styles.cardTitle}>Total interest on plan</p>
        <p className={styles.debtHeadlineValue}>{formatCents(plan.totalInterestCents)}</p>
        {plan.truncated ? (
          <p className={styles.debtHeadlineSub}>through the 600-month simulation cap</p>
        ) : null}
      </Card>
      <Card>
        <p className={styles.cardTitle}>Saved vs minimums only</p>
        {plan.interestSavedVsMinimumCents !== null && plan.monthsSaved !== null ? (
          <>
            <p className={styles.debtHeadlineValue}>{formatCents(plan.interestSavedVsMinimumCents)}</p>
            <p className={styles.debtHeadlineSub}>
              {plan.monthsSaved} month{plan.monthsSaved === 1 ? "" : "s"} sooner
            </p>
          </>
        ) : (
          <p className={styles.debtHeadlineSub}>
            Not comparable — minimums alone never finish within 50 years.
          </p>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Schedule table (statsTable pattern; months as rows, debts as cols)  */
/* ------------------------------------------------------------------ */

const SCHEDULE_DISPLAY_CAP = 36;

function ScheduleTable({ plan }: { plan: PayoffPlan }) {
  const { visible, hiddenCount } = visibleScheduleMonths(plan.monthKeys, SCHEDULE_DISPLAY_CAP);
  const balances = useMemo(() => endingBalancesByMonth(plan.debts), [plan.debts]);
  return (
    <Card>
      <p className={styles.cardTitle}>
        Payoff schedule
        <span className={cx("muted", styles.cardTitleNote)}>ending balance per month</span>
      </p>
      <div className={styles.statsTableWrap}>
        <table className={styles.statsTable} aria-label="Debt payoff schedule">
          <thead>
            <tr>
              <th scope="col" className={styles.statsHead}>
                Month
              </th>
              {plan.debts.map((debt) => (
                <th key={debt.id} scope="col" className={cx(styles.statsHead, styles.statsValueCol)}>
                  {debt.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((monthKey) => (
              <tr key={monthKey}>
                <th scope="row" className={styles.statsLabelCell}>
                  {monthKeyShortLabel(monthKey)} {monthKey.slice(2, 4)}
                </th>
                {plan.debts.map((debt) => {
                  const balance = balances[debt.id]?.[monthKey];
                  const paidOff = balance === 0;
                  return (
                    <td key={debt.id} className={styles.statsValueCol}>
                      <span className={cx(styles.statValue, paidOff && styles.comparisonUnder)}>
                        {balance === undefined ? "—" : paidOff ? "Paid off" : formatCents(balance)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenCount > 0 ? (
        <p className={styles.insightsNote} style={{ marginTop: 8 }}>
          ...and {hiddenCount} more month{hiddenCount === 1 ? "" : "s"}
          {plan.debtFreeMonthKey ? ` until ${monthKeyLabel(plan.debtFreeMonthKey)}` : ""}.
        </p>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Fixed-cost projection after retirements                             */
/* ------------------------------------------------------------------ */

function FixedCostProjectionCard({
  plan,
  debts,
  fixedCostsCents,
  incomeDenominatorCents,
  incomeMonthKey,
}: {
  plan: PayoffPlan;
  debts: DebtRow[];
  fixedCostsCents: number;
  incomeDenominatorCents: number;
  incomeMonthKey: string | null;
}) {
  const projection = useMemo(() => {
    const minByDebtId = new Map(debts.map((debt) => [debt._id, debt.minPaymentCents]));
    return projectFixedCostsAfterRetirements(
      plan.debts.map((debt) => ({
        id: debt.id,
        name: debt.name,
        payoffMonthKey: debt.payoffMonthKey,
        minPaymentCents: minByDebtId.get(debt.id) ?? 0,
      })),
      fixedCostsCents,
      incomeDenominatorCents,
    );
  }, [plan, debts, fixedCostsCents, incomeDenominatorCents]);

  return (
    <Card>
      <p className={styles.cardTitle}>
        Fixed costs after each payoff
        <span className={cx("muted", styles.cardTitleNote)}>
          Ramit&apos;s target band: {RAMIT_FIXED_COSTS_BAND.minPercent}-{RAMIT_FIXED_COSTS_BAND.maxPercent}%
          of income
        </span>
      </p>
      {projection.baselinePercent === null ? (
        <p className={styles.insightsNote}>
          No complete month of income recorded yet — the percent-of-income projection needs one.
        </p>
      ) : (
        <ul className={styles.debtProjectionList}>
          <li className={styles.debtProjectionRow}>
            <span className={styles.debtProjectionMonth}>Today</span>
            <span className={styles.debtProjectionDetail}>
              Fixed Costs {formatCents(fixedCostsCents)}/mo — {projection.baselinePercent}% of income
              {incomeMonthKey ? ` (on ${monthKeyLabel(incomeMonthKey)} income)` : ""}
            </span>
          </li>
          {projection.rows.map((row) => (
            <li key={row.monthKey} className={styles.debtProjectionRow}>
              <span className={styles.debtProjectionMonth}>{monthKeyLabel(row.monthKey)}</span>
              <span className={styles.debtProjectionDetail}>
                {row.debtNames.join(" + ")} retire{row.debtNames.length === 1 ? "s" : ""} — Fixed Costs ≈{" "}
                {formatCents(row.projectedFixedCostsCents)}/mo ({row.percentOfIncome}% of income)
                {row.entersBand ? (
                  <span className={styles.debtBandBadge}>
                    enters the {RAMIT_FIXED_COSTS_BAND.minPercent}-{RAMIT_FIXED_COSTS_BAND.maxPercent}% band
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* The Debts view                                                      */
/* ------------------------------------------------------------------ */

export function FinancesDebtsView() {
  const viewerReady = useViewerReady();
  const [strategy, setStrategy] = useState<PayoffStrategy>("avalanche");
  const [extraField, setExtraField] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<DebtRow | null>(null);

  // Default extra payment is $0 (the CSP budget targets net 0 — surplus is
  // already allocated); an invalid in-progress entry also plans with $0.
  const extraMonthlyCents = Math.max(0, parseDollarsToCents(extraField) ?? 0);

  const data = useQuery(
    api.finances.payoffPlanForViewer,
    viewerReady ? { strategy, extraMonthlyCents } : "skip",
  ) as PayoffPlanData | undefined;

  const insights = useQuery(api.finances.insightsForViewer, viewerReady ? {} : "skip") as
    | InsightsData
    | undefined;

  // Latest COMPLETE month: backs the extra-payment hint and the percent-of-
  // income base for the fixed-cost projection. Partial months never used.
  const latestCompleteMonth = useMemo(() => {
    if (!insights) return null;
    const complete = insights.months.filter((month) => month.monthKey < insights.currentMonthKey);
    return complete[complete.length - 1] ?? null;
  }, [insights]);

  const openAdd = () => {
    setEditingDebt(null);
    setDialogOpen(true);
  };
  const openEdit = (debt: DebtRow) => {
    setEditingDebt(debt);
    setDialogOpen(true);
  };

  const plan = data?.plan ?? null;
  const nonAmortizingNames =
    plan && data
      ? data.debts.filter((debt) => plan.nonAmortizingDebtIds.includes(debt._id)).map((debt) => debt.name)
      : [];

  return (
    <div className={styles.insightsStack}>
      {data === undefined ? (
        <Card>
          <LoadingRow label="Loading debts..." />
        </Card>
      ) : data.debts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HandCoins size={22} aria-hidden />}
            title="No debts entered yet"
            action={
              <Button variant="primary" onClick={openAdd}>
                <Plus size={16} aria-hidden /> Add a debt
              </Button>
            }
          >
            Enter each loan and credit card with its current balance, APR, and minimum payment (from the
            latest statement). Add a payment match pattern — like LIBERTY BANK or DISCOVER — and the planner
            keeps balances current from recorded transactions, then charts the avalanche/snowball payoff
            schedule.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className={styles.controls}>
            <div className={styles.controlsGroup}>
              <Select
                aria-label="Payoff strategy"
                value={strategy}
                onChange={(event) => setStrategy(event.target.value as PayoffStrategy)}
              >
                <option value="avalanche">Avalanche (highest APR first)</option>
                <option value="snowball">Snowball (smallest balance first)</option>
              </Select>
              <label className={styles.debtExtraField}>
                <span className={styles.debtExtraLabel}>Extra $/mo</span>
                <TextInput
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label="Extra monthly payment"
                  value={extraField}
                  onChange={(event) => setExtraField(event.target.value)}
                />
              </label>
              {latestCompleteMonth && latestCompleteMonth.netCents > 0 ? (
                <span className={styles.accountMeta}>
                  e.g. your {monthKeyShortLabel(latestCompleteMonth.monthKey)} net was{" "}
                  {formatCents(latestCompleteMonth.netCents)}
                </span>
              ) : null}
            </div>
            <div className={styles.controlsGroup}>
              <Button variant="primary" onClick={openAdd}>
                <Plus size={16} aria-hidden /> Add debt
              </Button>
            </div>
          </div>

          {nonAmortizingNames.length > 0 ? (
            <p className={cx(styles.insightsNote, styles.debtWarning)}>
              {nonAmortizingNames.join(", ")}: the minimum payment doesn&apos;t cover the monthly interest,
              so minimums alone can never pay {nonAmortizingNames.length === 1 ? "it" : "them"} off. Raise
              the minimum or add an extra payment.
            </p>
          ) : null}

          {plan ? <HeadlineCards plan={plan} /> : null}

          <DebtList debts={data.debts} onEdit={openEdit} />

          {plan && plan.monthKeys.length > 0 ? (
            <>
              <ScheduleTable plan={plan} />
              <FixedCostProjectionCard
                plan={plan}
                debts={data.debts}
                fixedCostsCents={latestCompleteMonth?.typeTotalsCents["Fixed Costs"] ?? 0}
                incomeDenominatorCents={latestCompleteMonth?.incomeDenominatorCents ?? 0}
                incomeMonthKey={latestCompleteMonth?.monthKey ?? null}
              />
            </>
          ) : null}
        </>
      )}

      <DebtDialog open={dialogOpen} onClose={() => setDialogOpen(false)} editing={editingDebt} />
    </div>
  );
}
