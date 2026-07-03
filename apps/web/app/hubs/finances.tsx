"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronLeft, ChevronRight, Landmark, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import {
  FINANCIAL_ACCOUNT_TYPES,
  TX_TYPES,
  TX_TYPE_CATEGORIES,
  isValidTxTypeCategory,
  type TxCategory,
  type TxType,
} from "@skippy/shared";
import { api } from "../../lib/skippy-api";
import {
  Button,
  Card,
  Dialog,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  LoadingRow,
  Select,
  TextInput,
  useToast,
} from "../components";
import { useViewerReady } from "./use-viewer";
import {
  bucketTransactionsByDay,
  currentMonthKey,
  dayRowHasEntries,
  dateInputToEpochMs,
  epochMsToDateInput,
  formatCents,
  formatSignedCents,
  monthKeyLabel,
  monthKeyShortLabel,
  parseDollarsToCents,
  shiftMonthKey,
  type GridTransaction,
} from "./finances-helpers";
import styles from "./finances.module.css";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* Report shapes (mirrors convex/finances.ts monthlyReportForViewer)   */
/* ------------------------------------------------------------------ */

type AccountRow = {
  _id: string;
  name: string;
  accountType: string;
  mask: string;
  institution?: string;
};

type Aggregates = {
  transactionCount: number;
  categoryTotalsCents: Record<string, number>;
  typeTotalsCents: Record<string, number>;
  totalOutgoingCents: number;
  totalIncomingCents: number;
  netCents: number;
  categoryPercentOfOutgoing: Record<string, number>;
  typePercentOfOutgoing: Record<string, number>;
};

type TargetDelta = { targetCents: number; actualCents: number; deltaCents: number };

type MonthlyReport = {
  account: AccountRow;
  monthKey: string;
  previousMonthKey: string;
  current: Aggregates;
  previous: Aggregates;
  monthOverMonth: {
    totalOutgoingCents: number;
    totalIncomingCents: number;
    netCents: number;
    categoryTotalsCents: Record<string, number>;
    typeTotalsCents: Record<string, number>;
  };
  budget:
    | {
        monthKey?: string;
        categoryTargets?: Record<string, number>;
        typeTargets?: Record<string, number>;
        targetOutgoingCents?: number;
        targetIncomingCents?: number;
        targetNetCents?: number;
        isDefault: boolean;
        comparison: {
          categoryDeltas: Record<string, TargetDelta>;
          typeDeltas: Record<string, TargetDelta>;
          outgoing?: TargetDelta;
          incoming?: TargetDelta;
          net?: TargetDelta;
        };
      }
    | null;
  transactions: GridTransaction[];
};

/* ------------------------------------------------------------------ */
/* Band metadata (taxonomy order; colors derive from CSS tokens)       */
/* ------------------------------------------------------------------ */

const BAND_CLASS: Record<TxType, string> = {
  Fixed: styles.bandFixed!,
  Spending: styles.bandSpending!,
  Food: styles.bandFood!,
  Income: styles.bandIncome!,
};

const BAND_LABEL: Record<TxType, string> = {
  Fixed: "Fixed",
  Spending: "Spending",
  Food: "Food",
  Income: "INCOME",
};

const GRID_CATEGORIES: Array<{ category: TxCategory; type: TxType }> = TX_TYPES.flatMap((type) =>
  TX_TYPE_CATEGORIES[type].map((category) => ({ category: category as TxCategory, type })),
);

/** Date column + one column per category. */
const GRID_COLUMN_COUNT = GRID_CATEGORIES.length + 1;
/** The full-width summary rows split the table into a label half and a value half. */

/* ------------------------------------------------------------------ */
/* Small display helpers                                               */
/* ------------------------------------------------------------------ */

function DeltaLine({
  label,
  deltaCents,
  goodWhenPositive,
}: {
  label: string;
  deltaCents: number;
  /** Income-side numbers: a positive delta is good (green); outgoing: bad. */
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
      {label}: {formatSignedCents(deltaCents)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Transaction add/edit dialog                                         */
/* ------------------------------------------------------------------ */

type TxDraft = {
  date: string;
  amount: string;
  description: string;
  txType: TxType;
  category: TxCategory;
};

function emptyDraft(monthKey: string): TxDraft {
  const today = new Date();
  const todayKey = currentMonthKey(today.getTime());
  return {
    date: todayKey === monthKey ? epochMsToDateInput(today.getTime()) : `${monthKey}-01`,
    amount: "",
    description: "",
    txType: "Spending",
    category: TX_TYPE_CATEGORIES.Spending[0] as TxCategory,
  };
}

function TransactionDialog({
  open,
  onClose,
  accountId,
  monthKey,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  monthKey: string;
  editing: GridTransaction | null;
}) {
  const toast = useToast();
  const createTransaction = useMutation(api.finances.createTransactionForViewer);
  const updateTransaction = useMutation(api.finances.updateTransactionForViewer);
  const deleteTransaction = useMutation(api.finances.deleteTransactionForViewer);
  const [draft, setDraft] = useState<TxDraft>(() => emptyDraft(monthKey));
  const [busy, setBusy] = useState(false);

  // Seed the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setDraft(
      editing
        ? {
            date: epochMsToDateInput(editing.date),
            amount: (editing.amountCents / 100).toFixed(2),
            description: editing.description,
            txType: editing.txType as TxType,
            category: editing.category as TxCategory,
          }
        : emptyDraft(monthKey),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed only on open
  }, [open]);

  const setType = (txType: TxType) => {
    setDraft((current) => ({
      ...current,
      txType,
      category: isValidTxTypeCategory(txType, current.category)
        ? current.category
        : (TX_TYPE_CATEGORIES[txType][0] as TxCategory),
    }));
  };

  const save = async () => {
    const date = dateInputToEpochMs(draft.date);
    const amountCents = parseDollarsToCents(draft.amount);
    if (date === null) return toast("Enter a valid date.", "error");
    if (amountCents === null) return toast("Enter a valid amount, like 42.50.", "error");
    if (!draft.description.trim()) return toast("Enter a description.", "error");
    if (!isValidTxTypeCategory(draft.txType, draft.category)) {
      return toast(`"${draft.category}" is not a ${draft.txType} category.`, "error");
    }
    setBusy(true);
    try {
      if (editing) {
        await updateTransaction({
          transactionId: editing._id as any,
          date,
          amountCents,
          description: draft.description.trim(),
          txType: draft.txType,
          category: draft.category,
        });
        toast("Transaction updated.", "success");
      } else {
        await createTransaction({
          accountId: accountId as any,
          date,
          amountCents,
          description: draft.description.trim(),
          txType: draft.txType,
          category: draft.category,
        });
        toast("Transaction added.", "success");
      }
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save transaction", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await deleteTransaction({ transactionId: editing._id as any });
      toast("Transaction deleted.", "success");
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not delete transaction", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={editing ? "Edit transaction" : "Add transaction"}>
      <div className={styles.formGrid}>
        <div className={styles.formRow}>
          <Field label="Date">
            <TextInput
              type="date"
              value={draft.date}
              onChange={(event) => setDraft({ ...draft, date: event.target.value })}
            />
          </Field>
          <Field label="Amount ($)">
            <TextInput
              inputMode="decimal"
              placeholder="42.50"
              value={draft.amount}
              onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
            />
          </Field>
        </div>
        <Field label="Description">
          <TextInput
            placeholder="Trader Joe's"
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </Field>
        <div className={styles.formRow}>
          <Field label="Type">
            <Select value={draft.txType} onChange={(event) => setType(event.target.value as TxType)}>
              {TX_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category">
            <Select
              value={draft.category}
              onChange={(event) => setDraft({ ...draft, category: event.target.value as TxCategory })}
            >
              {TX_TYPE_CATEGORIES[draft.txType].map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
          </Field>
        </div>
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
              {editing ? "Save changes" : "Add transaction"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Budget editor drawer                                                */
/* ------------------------------------------------------------------ */

function centsToField(cents: number | undefined): string {
  return cents === undefined ? "" : (cents / 100).toFixed(2);
}

function BudgetDrawer({
  open,
  onClose,
  accountId,
  monthKey,
  budget,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  monthKey: string;
  budget: MonthlyReport["budget"];
}) {
  const toast = useToast();
  const setBudget = useMutation(api.finances.setBudgetForViewer);
  const [scope, setScope] = useState<"default" | "month">("default");
  const [categoryFields, setCategoryFields] = useState<Record<string, string>>({});
  const [typeFields, setTypeFields] = useState<Record<string, string>>({});
  const [outgoing, setOutgoing] = useState("");
  const [incoming, setIncoming] = useState("");
  const [net, setNet] = useState("");
  const [busy, setBusy] = useState(false);

  // Seed the editor from the applicable budget each time the drawer opens.
  useEffect(() => {
    if (!open) return;
    setScope(budget && !budget.isDefault ? "month" : "default");
    setCategoryFields(
      Object.fromEntries(
        GRID_CATEGORIES.map(({ category }) => [category, centsToField(budget?.categoryTargets?.[category])]),
      ),
    );
    setTypeFields(
      Object.fromEntries(TX_TYPES.map((type) => [type, centsToField(budget?.typeTargets?.[type])])),
    );
    setOutgoing(centsToField(budget?.targetOutgoingCents));
    setIncoming(centsToField(budget?.targetIncomingCents));
    setNet(centsToField(budget?.targetNetCents));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed only on open
  }, [open]);

  const save = async () => {
    const categoryTargets: Record<string, number> = {};
    for (const { category } of GRID_CATEGORIES) {
      const raw = (categoryFields[category] ?? "").trim();
      if (!raw) continue;
      const cents = parseDollarsToCents(raw);
      if (cents === null) return toast(`Invalid amount for ${category}.`, "error");
      categoryTargets[category] = cents;
    }
    const typeTargets: Record<string, number> = {};
    for (const type of TX_TYPES) {
      const raw = (typeFields[type] ?? "").trim();
      if (!raw) continue;
      const cents = parseDollarsToCents(raw);
      if (cents === null) return toast(`Invalid amount for ${type}.`, "error");
      typeTargets[type] = cents;
    }
    const totals: Record<string, number> = {};
    for (const [label, raw, key] of [
      ["total outgoing", outgoing, "targetOutgoingCents"],
      ["total income", incoming, "targetIncomingCents"],
      ["net", net, "targetNetCents"],
    ] as const) {
      if (!raw.trim()) continue;
      const cents = parseDollarsToCents(raw);
      if (cents === null) return toast(`Invalid amount for ${label}.`, "error");
      totals[key] = cents;
    }

    setBusy(true);
    try {
      await setBudget({
        accountId: accountId as any,
        ...(scope === "month" ? { monthKey } : {}),
        ...(Object.keys(categoryTargets).length > 0 ? { categoryTargets } : {}),
        ...(Object.keys(typeTargets).length > 0 ? { typeTargets } : {}),
        ...totals,
      });
      toast(scope === "month" ? `Budget saved for ${monthKeyLabel(monthKey)}.` : "Default budget saved.", "success");
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save budget", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Budget"
      title="Budget targets"
      footer={
        <div className={styles.formActionsEnd}>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            Save budget
          </Button>
        </div>
      }
    >
      <div className={styles.budgetSection}>
        <p className={styles.budgetSectionTitle}>Applies to</p>
        <Select value={scope} onChange={(event) => setScope(event.target.value as "default" | "month")}>
          <option value="default">Every month (default budget)</option>
          <option value="month">{monthKeyLabel(monthKey)} only</option>
        </Select>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Leave a field blank to skip that target. Saving replaces the previous targets for this scope.
        </p>
      </div>

      <div className={styles.budgetSection}>
        <p className={styles.budgetSectionTitle}>Per category</p>
        {GRID_CATEGORIES.map(({ category, type }) => (
          <div key={category} className={styles.budgetRow}>
            <span className={styles.budgetRowLabel}>
              <span className={cx(styles.budgetTypeTag, BAND_CLASS[type])}>{type}</span>
              {category}
            </span>
            <TextInput
              inputMode="decimal"
              placeholder="$"
              aria-label={`${category} target`}
              value={categoryFields[category] ?? ""}
              onChange={(event) =>
                setCategoryFields((current) => ({ ...current, [category]: event.target.value }))
              }
            />
          </div>
        ))}
      </div>

      <div className={styles.budgetSection}>
        <p className={styles.budgetSectionTitle}>Per type</p>
        {TX_TYPES.map((type) => (
          <div key={type} className={styles.budgetRow}>
            <span className={styles.budgetRowLabel}>
              <span className={cx(styles.budgetTypeTag, BAND_CLASS[type])}>{BAND_LABEL[type]}</span>
            </span>
            <TextInput
              inputMode="decimal"
              placeholder="$"
              aria-label={`${type} target`}
              value={typeFields[type] ?? ""}
              onChange={(event) => setTypeFields((current) => ({ ...current, [type]: event.target.value }))}
            />
          </div>
        ))}
      </div>

      <div className={styles.budgetSection}>
        <p className={styles.budgetSectionTitle}>Account totals</p>
        <div className={styles.budgetRow}>
          <span className={styles.budgetRowLabel}>Total outgoing</span>
          <TextInput
            inputMode="decimal"
            placeholder="$"
            aria-label="Total outgoing target"
            value={outgoing}
            onChange={(event) => setOutgoing(event.target.value)}
          />
        </div>
        <div className={styles.budgetRow}>
          <span className={styles.budgetRowLabel}>Total income</span>
          <TextInput
            inputMode="decimal"
            placeholder="$"
            aria-label="Total income target"
            value={incoming}
            onChange={(event) => setIncoming(event.target.value)}
          />
        </div>
        <div className={styles.budgetRow}>
          <span className={styles.budgetRowLabel}>Net (after income)</span>
          <TextInput
            inputMode="decimal"
            placeholder="$"
            aria-label="Net target"
            value={net}
            onChange={(event) => setNet(event.target.value)}
          />
        </div>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Account creation dialog                                             */
/* ------------------------------------------------------------------ */

function AccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const upsertAccount = useMutation(api.finances.upsertFinancialAccountForViewer);
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<string>(FINANCIAL_ACCOUNT_TYPES[0]);
  const [mask, setMask] = useState("");
  const [institution, setInstitution] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await upsertAccount({
        name: name.trim(),
        accountType: accountType as (typeof FINANCIAL_ACCOUNT_TYPES)[number],
        mask: mask.trim(),
        ...(institution.trim() ? { institution: institution.trim() } : {}),
      });
      toast("Account saved.", "success");
      setName("");
      setMask("");
      setInstitution("");
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save account", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="New financial account">
      <div className={styles.formGrid}>
        <Field label="Name">
          <TextInput placeholder="Family Checking" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className={styles.formRow}>
          <Field label="Account type">
            <Select value={accountType} onChange={(event) => setAccountType(event.target.value)}>
              {FINANCIAL_ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Last 4 digits">
            <TextInput placeholder="1234" maxLength={4} value={mask} onChange={(event) => setMask(event.target.value)} />
          </Field>
        </div>
        <Field label="Institution (optional)">
          <TextInput placeholder="Chase" value={institution} onChange={(event) => setInstitution(event.target.value)} />
        </Field>
        <div className={styles.formActionsEnd}>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !name.trim() || !mask.trim()}>
            Create account
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* The monthly grid                                                    */
/* ------------------------------------------------------------------ */

function MonthlyGrid({ report, onEditTransaction }: { report: MonthlyReport; onEditTransaction: (tx: GridTransaction) => void }) {
  // Only days that actually hold transactions get a row; empty days are hidden.
  const rows = useMemo(
    () => bucketTransactionsByDay(report.monthKey, report.transactions).filter(dayRowHasEntries),
    [report.monthKey, report.transactions],
  );
  const prevLabel = monthKeyShortLabel(report.previousMonthKey);
  const hasPrev = report.previous.transactionCount > 0;
  const budget = report.budget;

  return (
    <div className={styles.gridWrap}>
      <table className={styles.grid} aria-label={`Transactions for ${monthKeyLabel(report.monthKey)}`}>
        <thead>
          {/* Type band headers */}
          <tr>
            <td className={cx(styles.cell, styles.dayCell, styles.cornerCell, styles.bandHead)} />
            {TX_TYPES.map((type) => (
              <th
                key={type}
                scope="colgroup"
                colSpan={TX_TYPE_CATEGORIES[type].length}
                className={cx(styles.bandHead, BAND_CLASS[type], styles.bandStrong)}
              >
                {BAND_LABEL[type]}
              </th>
            ))}
          </tr>

          {/* Category sub-headers */}
          <tr>
            <td className={cx(styles.cell, styles.dayCell, styles.cornerCell)} />
            {GRID_CATEGORIES.map(({ category, type }) => (
              <th
                key={category}
                scope="col"
                className={cx(styles.cell, styles.categoryHead, BAND_CLASS[type], styles.bandSoft)}
              >
                {category}
              </th>
            ))}
          </tr>
        </thead>

        {/* One row per day that has at least one transaction */}
        <tbody>
          {rows.map((row) => (
            <tr key={row.day}>
              <th scope="row" className={cx(styles.cell, styles.dayCell)}>
                {row.label}
              </th>
              {GRID_CATEGORIES.map(({ category, type }) => {
                const entries = row.cells[category];
                return (
                  <td key={category} className={cx(styles.cell, BAND_CLASS[type], styles.bandFaint)}>
                    {entries.length > 0 ? (
                      <div className={styles.cellStack}>
                        {entries.map((entry) => (
                          <button
                            key={entry._id}
                            type="button"
                            className={styles.entry}
                            onClick={() => onEditTransaction(entry)}
                            title={`${entry.description} — ${formatCents(entry.amountCents)} (click to edit)`}
                          >
                            <span className={styles.entryDesc}>{entry.description}</span>
                            <span className={styles.entryAmount}>{formatCents(entry.amountCents)}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>

        <tfoot>
          {/* Per-category totals */}
          <tr>
            <th scope="row" className={cx(styles.cell, styles.dayCell, styles.totalCell, styles.totalLabel)}>
              Totals
            </th>
            {GRID_CATEGORIES.map(({ category, type }) => {
              const budgetDelta = budget?.comparison.categoryDeltas[category];
              const isIncome = type === "Income";
              return (
                <td key={category} className={cx(styles.cell, styles.totalCell, BAND_CLASS[type], styles.bandFaint)}>
                  <span className={styles.totalAmount}>{formatCents(report.current.categoryTotalsCents[category] ?? 0)}</span>
                  {(budgetDelta || hasPrev) && (
                    <span className={styles.comparisons}>
                      {budgetDelta ? (
                        <DeltaLine label="vs budget" deltaCents={budgetDelta.deltaCents} goodWhenPositive={isIncome} />
                      ) : null}
                      {hasPrev ? (
                        <DeltaLine
                          label={`vs ${prevLabel}`}
                          deltaCents={report.monthOverMonth.categoryTotalsCents[category] ?? 0}
                          goodWhenPositive={isIncome}
                        />
                      ) : null}
                    </span>
                  )}
                </td>
              );
            })}
          </tr>

          {/* Per-type totals (banded) */}
          <tr>
            <td className={cx(styles.cell, styles.dayCell, styles.totalCell)} />
            {TX_TYPES.map((type) => {
              const budgetDelta = budget?.comparison.typeDeltas[type];
              const isIncome = type === "Income";
              const percent = report.current.typePercentOfOutgoing[type] ?? 0;
              return (
                <td
                  key={type}
                  colSpan={TX_TYPE_CATEGORIES[type].length}
                  className={cx(styles.cell, styles.totalCell, BAND_CLASS[type], styles.bandSoft)}
                >
                  <span className={styles.totalAmount}>
                    {BAND_LABEL[type]} {formatCents(report.current.typeTotalsCents[type] ?? 0)}
                    {!isIncome && report.current.totalOutgoingCents > 0 ? (
                      <span className={styles.totalPercent}>{percent}% of outgoing</span>
                    ) : null}
                  </span>
                  {(budgetDelta || hasPrev) && (
                    <span className={styles.comparisons}>
                      {budgetDelta ? (
                        <DeltaLine label="vs budget" deltaCents={budgetDelta.deltaCents} goodWhenPositive={isIncome} />
                      ) : null}
                      {hasPrev ? (
                        <DeltaLine
                          label={`vs ${prevLabel}`}
                          deltaCents={report.monthOverMonth.typeTotalsCents[type] ?? 0}
                          goodWhenPositive={isIncome}
                        />
                      ) : null}
                    </span>
                  )}
                </td>
              );
            })}
          </tr>

          {/* Account summary rows: label + value pinned to the visible left edge */}
          <tr>
            <th scope="row" colSpan={GRID_COLUMN_COUNT} className={cx(styles.cell, styles.totalCell, styles.summaryRow)}>
              <div className={styles.summaryStick}>
                <span className={cx(styles.totalLabel, styles.summaryRowLabel)}>Account total (outgoing)</span>
                <span className={styles.summaryValue}>{formatCents(report.current.totalOutgoingCents)}</span>
                {budget?.comparison.outgoing ? (
                  <DeltaLine label="vs budget" deltaCents={budget.comparison.outgoing.deltaCents} />
                ) : null}
                {hasPrev ? (
                  <DeltaLine label={`vs ${prevLabel}`} deltaCents={report.monthOverMonth.totalOutgoingCents} />
                ) : null}
              </div>
            </th>
          </tr>

          <tr>
            <th scope="row" colSpan={GRID_COLUMN_COUNT} className={cx(styles.cell, styles.totalCell, styles.summaryRow)}>
              <div className={styles.summaryStick}>
                <span className={cx(styles.totalLabel, styles.summaryRowLabel)}>Account total (income)</span>
                <span className={styles.summaryValue}>{formatCents(report.current.totalIncomingCents)}</span>
                {budget?.comparison.incoming ? (
                  <DeltaLine label="vs budget" deltaCents={budget.comparison.incoming.deltaCents} goodWhenPositive />
                ) : null}
                {hasPrev ? (
                  <DeltaLine
                    label={`vs ${prevLabel}`}
                    deltaCents={report.monthOverMonth.totalIncomingCents}
                    goodWhenPositive
                  />
                ) : null}
              </div>
            </th>
          </tr>

          <tr>
            <th scope="row" colSpan={GRID_COLUMN_COUNT} className={cx(styles.cell, styles.totalCell, styles.summaryRow)}>
              <div className={styles.summaryStick}>
                <span className={cx(styles.totalLabel, styles.summaryRowLabel)}>After income</span>
                <span className={cx(styles.summaryValue, report.current.netCents >= 0 ? styles.netPositive : styles.netNegative)}>
                  {formatCents(report.current.netCents)}
                </span>
                {budget?.comparison.net ? (
                  <DeltaLine label="vs budget" deltaCents={budget.comparison.net.deltaCents} goodWhenPositive />
                ) : null}
                {hasPrev ? (
                  <DeltaLine label={`vs ${prevLabel}`} deltaCents={report.monthOverMonth.netCents} goodWhenPositive />
                ) : null}
              </div>
            </th>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hub content                                                         */
/* ------------------------------------------------------------------ */

export function FinancesContent() {
  const viewerReady = useViewerReady();
  const [monthKey, setMonthKey] = useState(() => currentMonthKey());
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<GridTransaction | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);

  const accounts = useQuery(api.finances.listAccountsForViewer, viewerReady ? {} : "skip") as
    | AccountRow[]
    | undefined;
  const accountId = selectedAccountId ?? accounts?.[0]?._id ?? null;
  const account = accounts?.find((row) => row._id === accountId);

  const report = useQuery(
    api.finances.monthlyReportForViewer,
    viewerReady && accountId ? { accountId: accountId as any, monthKey } : "skip",
  ) as MonthlyReport | undefined;

  const openAdd = () => {
    setEditingTx(null);
    setTxDialogOpen(true);
  };
  const openEdit = (tx: GridTransaction) => {
    setEditingTx(tx);
    setTxDialogOpen(true);
  };

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Family budget</p>
          <h1>Finances.</h1>
        </div>
      </div>

      {accounts === undefined ? (
        <Card>
          <LoadingRow label="Loading accounts..." />
        </Card>
      ) : accounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Landmark size={22} aria-hidden />}
            title="No financial accounts yet"
            action={
              <Button variant="primary" onClick={() => setAccountDialogOpen(true)}>
                <Plus size={16} aria-hidden /> Create an account
              </Button>
            }
          >
            Transactions usually arrive automatically via Plaid or harness ingestion. You can also create an
            account manually and enter transactions by hand.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className={styles.controls}>
            <div className={styles.controlsGroup}>
              {accounts.length > 1 ? (
                <Select
                  aria-label="Account"
                  value={accountId ?? ""}
                  onChange={(event) => setSelectedAccountId(event.target.value)}
                >
                  {accounts.map((row) => (
                    <option key={row._id} value={row._id}>
                      {row.name} (...{row.mask})
                    </option>
                  ))}
                </Select>
              ) : (
                <strong>{account?.name}</strong>
              )}
              {account ? (
                <span className={styles.accountMeta}>
                  {account.accountType}
                  {account.institution ? ` · ${account.institution}` : ""} · ...{account.mask}
                </span>
              ) : null}
            </div>
            <div className={styles.controlsGroup}>
              <div className={styles.monthNav}>
                <IconButton
                  small
                  aria-label="Previous month"
                  onClick={() => setMonthKey((current) => shiftMonthKey(current, -1))}
                >
                  <ChevronLeft size={17} aria-hidden />
                </IconButton>
                <span className={styles.monthLabel}>{monthKeyLabel(monthKey)}</span>
                <IconButton
                  small
                  aria-label="Next month"
                  onClick={() => setMonthKey((current) => shiftMonthKey(current, 1))}
                >
                  <ChevronRight size={17} aria-hidden />
                </IconButton>
              </div>
              <Button onClick={() => setBudgetOpen(true)} disabled={!accountId}>
                <SlidersHorizontal size={15} aria-hidden /> Budget
              </Button>
              <Button variant="primary" onClick={openAdd} disabled={!accountId}>
                <Plus size={16} aria-hidden /> Add transaction
              </Button>
              <Button variant="ghost" onClick={() => setAccountDialogOpen(true)} title="Create another account">
                <Landmark size={15} aria-hidden /> New account
              </Button>
            </div>
          </div>

          {report === undefined ? (
            <Card>
              <LoadingRow label={`Loading ${monthKeyLabel(monthKey)}...`} />
            </Card>
          ) : (
            <>
              {report.current.transactionCount === 0 ? (
                <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
                  No transactions recorded for {monthKeyLabel(monthKey)} yet.
                </p>
              ) : null}
              <MonthlyGrid report={report} onEditTransaction={openEdit} />
              {report.budget?.isDefault ? (
                <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
                  Budget comparisons use the account's default (recurring) budget.
                </p>
              ) : null}
            </>
          )}
        </>
      )}

      {accountId ? (
        <TransactionDialog
          open={txDialogOpen}
          onClose={() => setTxDialogOpen(false)}
          accountId={accountId}
          monthKey={monthKey}
          editing={editingTx}
        />
      ) : null}
      {accountId ? (
        <BudgetDrawer
          open={budgetOpen}
          onClose={() => setBudgetOpen(false)}
          accountId={accountId}
          monthKey={monthKey}
          budget={report?.budget ?? null}
        />
      ) : null}
      <AccountDialog open={accountDialogOpen} onClose={() => setAccountDialogOpen(false)} />
    </>
  );
}
