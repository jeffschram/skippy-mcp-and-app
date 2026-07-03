import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import {
  TX_CATEGORIES,
  TX_TYPES,
  aggregateMonthTransactions,
  assertIntegerCents,
  assertValidTxTypeCategory,
  computeMonthlyFinancialReport,
  dayStartUtc,
  isFinancialAccountType,
  isValidMonthKey,
  monthKeyFromDate,
  planBulkTransactionWrites,
  previousMonthKey,
  summarizeMonthBalances,
} from "@skippy/shared";
import { requireOwnedBrain } from "./auth";

/* ------------------------------------------------------------------ */
/* Validators (mirror the fixed taxonomy in @skippy/shared)            */
/* ------------------------------------------------------------------ */

const financialAccountTypeValidator = v.union(v.literal("Jeff Personal"), v.literal("Family Shared"));

const txTypeValidator = v.union(
  v.literal("Fixed"),
  v.literal("Spending"),
  v.literal("Food"),
  v.literal("Income"),
  v.literal("Transfer"),
);

const txCategoryValidator = v.union(
  v.literal("Mortgage, HOA, Mortgage Loan"),
  v.literal("Recurring Bills"),
  v.literal("Subscriptions"),
  v.literal("Gas, Amazon, Home Depot, Etc"),
  v.literal("Misc."),
  v.literal("Groceries"),
  v.literal("Restaurants"),
  v.literal("Jeff"),
  v.literal("Holly"),
  v.literal("Transfers In"),
  v.literal("Transfers Out"),
);

const txSourceValidator = v.union(v.literal("plaid"), v.literal("manual"), v.literal("harness"));

const balanceSourceValidator = v.union(v.literal("plaid_derived"), v.literal("manual"));

const dailyBalanceValidator = v.object({
  date: v.number(),
  endOfDayBalanceCents: v.number(),
});

const bulkTransactionValidator = v.object({
  date: v.number(),
  amountCents: v.number(),
  description: v.string(),
  txType: txTypeValidator,
  category: txCategoryValidator,
  externalId: v.optional(v.string()),
  monthKey: v.optional(v.string()),
});

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

type Actor = { actorType: string; actorId?: string };

/**
 * Mask must be the last-4 identifier only. Full account numbers are NEVER stored.
 */
function normalizeMask(mask: string): string {
  const normalized = mask.trim();
  if (!normalized) {
    throw new Error("mask is required (the last 4 characters of the account number)");
  }
  if (normalized.length > 4) {
    throw new Error("mask must be at most 4 characters (last-4 only) — never store full account numbers");
  }
  return normalized;
}

function normalizeRequired(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

async function requireAccount(db: any, brainInstanceId: any, accountId: string) {
  const account = await db.get(accountId);
  if (!account || account.brainInstanceId !== brainInstanceId) {
    throw new Error("financial account not found for brain instance");
  }
  return account;
}

/**
 * Validates and normalizes a transaction's core fields. Enforces the fixed
 * type-category pairing and integer-cents amounts on every write path, and
 * derives the monthKey (UTC) from the date when not supplied.
 */
function normalizeTransactionFields(input: {
  date: number;
  amountCents: number;
  description: string;
  txType: string;
  category: string;
  monthKey?: string;
}) {
  assertValidTxTypeCategory(input.txType, input.category);
  assertIntegerCents(input.amountCents, "amountCents");
  if (!Number.isFinite(input.date)) {
    throw new Error("date must be epoch milliseconds");
  }
  const monthKey = input.monthKey ?? monthKeyFromDate(input.date);
  if (!isValidMonthKey(monthKey)) {
    throw new Error(`invalid monthKey "${monthKey}". Expected 'YYYY-MM'.`);
  }
  return {
    date: input.date,
    amountCents: input.amountCents,
    description: normalizeRequired(input.description, "description"),
    txType: input.txType,
    category: input.category,
    monthKey,
  };
}

/**
 * Create or update a financial account. Idempotent: matches an existing account
 * by explicit accountId, then by plaidAccountId, then by case-insensitive name.
 */
async function upsertAccount(
  db: any,
  brainInstanceId: any,
  input: {
    accountId?: string;
    name: string;
    accountType: string;
    mask: string;
    institution?: string;
    plaidAccountId?: string;
  },
  actor: Actor,
) {
  if (!isFinancialAccountType(input.accountType)) {
    throw new Error(`invalid accountType "${input.accountType}". Valid types: Jeff Personal | Family Shared`);
  }
  const name = normalizeRequired(input.name, "name");
  const mask = normalizeMask(input.mask);
  const institution = input.institution?.trim() || undefined;
  const plaidAccountId = input.plaidAccountId?.trim() || undefined;
  const now = Date.now();

  let existing: any = null;
  if (input.accountId) {
    existing = await requireAccount(db, brainInstanceId, input.accountId);
  }
  if (!existing && plaidAccountId) {
    existing = await db
      .query("financialAccounts")
      .withIndex("by_brain_plaid", (q: any) =>
        q.eq("brainInstanceId", brainInstanceId).eq("plaidAccountId", plaidAccountId),
      )
      .first();
  }
  if (!existing) {
    const accounts = await db
      .query("financialAccounts")
      .withIndex("by_brain", (q: any) => q.eq("brainInstanceId", brainInstanceId))
      .collect();
    existing = accounts.find((account: any) => account.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  let accountId: string;
  let status: "created" | "updated";
  if (existing) {
    await db.patch(existing._id, {
      name,
      accountType: input.accountType,
      mask,
      institution: institution ?? existing.institution,
      plaidAccountId: plaidAccountId ?? existing.plaidAccountId,
      updatedAt: now,
    });
    accountId = existing._id;
    status = "updated";
  } else {
    accountId = await db.insert("financialAccounts", {
      brainInstanceId,
      name,
      accountType: input.accountType,
      mask,
      institution,
      plaidAccountId,
      createdAt: now,
      updatedAt: now,
    });
    status = "created";
  }

  await db.insert("activityEvents", {
    brainInstanceId,
    activityType: status === "created" ? "financial_account_created" : "financial_account_updated",
    actorType: actor.actorType,
    actorId: actor.actorId,
    timestamp: now,
    summary: `Financial account ${status}: ${name} (${input.accountType}, ...${mask})`,
    metadata: { accountId, accountType: input.accountType, plaidAccountId },
  });

  return { accountId, status, name, accountType: input.accountType, mask };
}

/**
 * Bulk transaction ingestion, idempotent on externalId (Plaid transaction_id):
 * rows whose externalId already exists are updated in place, never duplicated.
 * Returns {inserted, updated, skipped} counts.
 */
async function recordTransactionsBulk(
  db: any,
  brainInstanceId: any,
  args: {
    accountId: string;
    source?: "plaid" | "manual" | "harness";
    transactions: Array<{
      date: number;
      amountCents: number;
      description: string;
      txType: string;
      category: string;
      externalId?: string;
      monthKey?: string;
    }>;
  },
  actor: Actor,
) {
  const account = await requireAccount(db, brainInstanceId, args.accountId);
  const source = args.source ?? "plaid";
  const now = Date.now();

  // Validate the whole batch up front so an invalid row rejects with a clear
  // error before anything is written.
  const rows = args.transactions.map((transaction, index) => {
    try {
      return {
        ...normalizeTransactionFields(transaction),
        externalId: transaction.externalId?.trim() || undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`transactions[${index}]: ${message}`);
    }
  });

  // Look up existing docs for every externalId in the batch (brain-scoped dedupe).
  const existingByExternalId = new Map<string, any>();
  for (const row of rows) {
    if (!row.externalId || existingByExternalId.has(row.externalId)) continue;
    const existing = await db
      .query("financialTransactions")
      .withIndex("by_brain_external", (q: any) =>
        q.eq("brainInstanceId", brainInstanceId).eq("externalId", row.externalId),
      )
      .first();
    if (existing) {
      existingByExternalId.set(row.externalId, existing);
    }
  }

  const plan = planBulkTransactionWrites(rows, new Set(existingByExternalId.keys()));

  for (const row of plan.inserts) {
    await db.insert("financialTransactions", {
      brainInstanceId,
      accountId: args.accountId,
      date: row.date,
      monthKey: row.monthKey,
      amountCents: row.amountCents,
      description: row.description,
      txType: row.txType,
      category: row.category,
      externalId: row.externalId,
      source,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const { externalId, row } of plan.updates) {
    const existing = existingByExternalId.get(externalId);
    await db.patch(existing._id, {
      accountId: args.accountId,
      date: row.date,
      monthKey: row.monthKey,
      amountCents: row.amountCents,
      description: row.description,
      txType: row.txType,
      category: row.category,
      source,
      updatedAt: now,
    });
  }

  const counts = { inserted: plan.inserts.length, updated: plan.updates.length, skipped: plan.skipped };

  await db.insert("activityEvents", {
    brainInstanceId,
    activityType: "financial_transactions_recorded",
    actorType: actor.actorType,
    actorId: actor.actorId,
    timestamp: now,
    summary: `Recorded ${rows.length} transaction${rows.length === 1 ? "" : "s"} for ${account.name} (${counts.inserted} new, ${counts.updated} updated, ${counts.skipped} skipped)`,
    metadata: { accountId: args.accountId, source, ...counts },
  });

  return { accountId: args.accountId, accountName: account.name, source, ...counts };
}

async function monthBalances(db: any, brainInstanceId: any, accountId: string, monthKey: string) {
  return await db
    .query("financialDailyBalances")
    .withIndex("by_brain_account_month", (q: any) =>
      q.eq("brainInstanceId", brainInstanceId).eq("accountId", accountId).eq("monthKey", monthKey),
    )
    .collect();
}

/**
 * Bulk end-of-day balance snapshot ingestion, idempotent on account+day:
 * each snapshot's date is normalized to UTC midnight, and an existing row for
 * that account+day is updated in place, never duplicated. Balances come from
 * the harness (full raw Plaid feed anchored to the live current balance) —
 * NEVER from summing financialTransactions. Returns {inserted, updated}.
 */
async function recordDailyBalancesBulk(
  db: any,
  brainInstanceId: any,
  args: {
    accountId: string;
    source?: "plaid_derived" | "manual";
    balances: Array<{ date: number; endOfDayBalanceCents: number }>;
  },
  actor: Actor,
) {
  const account = await requireAccount(db, brainInstanceId, args.accountId);
  const source = args.source ?? "plaid_derived";
  const now = Date.now();

  // Validate + normalize the whole batch up front (clear errors, nothing written).
  const rowsByDay = new Map<number, { date: number; monthKey: string; endOfDayBalanceCents: number }>();
  args.balances.forEach((balance, index) => {
    try {
      if (!Number.isFinite(balance.date)) {
        throw new Error("date must be epoch milliseconds");
      }
      assertIntegerCents(balance.endOfDayBalanceCents, "endOfDayBalanceCents");
      const date = dayStartUtc(balance.date);
      // Later entries for the same day win (one snapshot per account+day).
      rowsByDay.set(date, {
        date,
        monthKey: monthKeyFromDate(date),
        endOfDayBalanceCents: balance.endOfDayBalanceCents,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`balances[${index}]: ${message}`);
    }
  });
  const rows = [...rowsByDay.values()];

  // Existing rows for every month touched by the batch (brain+account scoped).
  const existingByDay = new Map<number, any>();
  for (const monthKey of new Set(rows.map((row) => row.monthKey))) {
    for (const existing of await monthBalances(db, brainInstanceId, args.accountId, monthKey)) {
      existingByDay.set(existing.date, existing);
    }
  }

  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = existingByDay.get(row.date);
    if (existing) {
      await db.patch(existing._id, {
        endOfDayBalanceCents: row.endOfDayBalanceCents,
        source,
        updatedAt: now,
      });
      updated += 1;
    } else {
      await db.insert("financialDailyBalances", {
        brainInstanceId,
        accountId: args.accountId,
        date: row.date,
        monthKey: row.monthKey,
        endOfDayBalanceCents: row.endOfDayBalanceCents,
        source,
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }
  }

  await db.insert("activityEvents", {
    brainInstanceId,
    activityType: "financial_balances_recorded",
    actorType: actor.actorType,
    actorId: actor.actorId,
    timestamp: now,
    summary: `Recorded ${rows.length} daily balance${rows.length === 1 ? "" : "s"} for ${account.name} (${inserted} new, ${updated} updated)`,
    metadata: { accountId: args.accountId, source, inserted, updated },
  });

  return { accountId: args.accountId, accountName: account.name, source, inserted, updated };
}

async function monthTransactions(db: any, brainInstanceId: any, accountId: string, monthKey: string) {
  return await db
    .query("financialTransactions")
    .withIndex("by_brain_account_month", (q: any) =>
      q.eq("brainInstanceId", brainInstanceId).eq("accountId", accountId).eq("monthKey", monthKey),
    )
    .collect();
}

/**
 * Monthly report, COMPUTED AT READ TIME (no stored report docs). Aggregation
 * math lives in @skippy/shared (computeMonthlyFinancialReport) so it is
 * unit-testable. Applies the month-specific budget when present, else the
 * account's default/recurring budget.
 */
async function buildMonthlyReport(db: any, brainInstanceId: any, accountId: string, monthKey: string) {
  if (!isValidMonthKey(monthKey)) {
    throw new Error(`invalid monthKey "${monthKey}". Expected 'YYYY-MM'.`);
  }
  const account = await requireAccount(db, brainInstanceId, accountId);

  const currentTransactions = await monthTransactions(db, brainInstanceId, accountId, monthKey);
  const previousTransactions = await monthTransactions(
    db,
    brainInstanceId,
    accountId,
    previousMonthKey(monthKey),
  );

  // Daily balance snapshots (stored, harness-computed) — never derived from
  // the transactions above, which may not cover every raw feed row.
  const currentBalances = await monthBalances(db, brainInstanceId, accountId, monthKey);
  const previousBalances = await monthBalances(db, brainInstanceId, accountId, previousMonthKey(monthKey));
  const balanceSummary = summarizeMonthBalances(
    currentBalances.map((row: any) => ({ date: row.date, endOfDayBalanceCents: row.endOfDayBalanceCents })),
    previousBalances.map((row: any) => ({ date: row.date, endOfDayBalanceCents: row.endOfDayBalanceCents })),
  );

  const budgets = await db
    .query("financialBudgets")
    .withIndex("by_brain_account", (q: any) =>
      q.eq("brainInstanceId", brainInstanceId).eq("accountId", accountId),
    )
    .collect();
  const monthBudget = budgets.find((budget: any) => budget.monthKey === monthKey);
  const defaultBudget = budgets.find((budget: any) => budget.monthKey === undefined);
  const budget = monthBudget ?? defaultBudget;

  const toInput = (transaction: any) => ({
    txType: transaction.txType,
    category: transaction.category,
    amountCents: transaction.amountCents,
  });

  const report = computeMonthlyFinancialReport({
    monthKey,
    transactions: currentTransactions.map(toInput),
    previousTransactions: previousTransactions.map(toInput),
    ...(budget
      ? {
          budget: {
            ...(budget.monthKey !== undefined ? { monthKey: budget.monthKey } : {}),
            ...(budget.categoryTargets !== undefined ? { categoryTargets: budget.categoryTargets } : {}),
            ...(budget.typeTargets !== undefined ? { typeTargets: budget.typeTargets } : {}),
            ...(budget.targetOutgoingCents !== undefined
              ? { targetOutgoingCents: budget.targetOutgoingCents }
              : {}),
            ...(budget.targetIncomingCents !== undefined
              ? { targetIncomingCents: budget.targetIncomingCents }
              : {}),
            ...(budget.targetNetCents !== undefined ? { targetNetCents: budget.targetNetCents } : {}),
          },
          budgetIsDefault: !monthBudget && !!defaultBudget,
        }
      : {}),
  });

  return {
    account: {
      _id: account._id,
      name: account.name,
      accountType: account.accountType,
      mask: account.mask,
      institution: account.institution,
    },
    ...report,
    balances: balanceSummary.balances,
    startingBalanceCents: balanceSummary.startingBalanceCents,
    endingBalanceCents: balanceSummary.endingBalanceCents,
    transactions: currentTransactions
      .map((transaction: any) => ({
        _id: transaction._id,
        date: transaction.date,
        amountCents: transaction.amountCents,
        description: transaction.description,
        txType: transaction.txType,
        category: transaction.category,
        source: transaction.source,
        externalId: transaction.externalId,
      }))
      .sort((a: any, b: any) => a.date - b.date),
  };
}

/**
 * Multi-month insight rows, COMPUTED AT READ TIME. For the trailing
 * `monthCount` months ending at the current month (UTC), gathers each month's
 * transactions per account via by_brain_account_month — merged across all of
 * the brain's accounts when no accountId is given (safe: the shared report
 * math excludes Transfer rows from outgoing/incoming/net, so internal
 * transfers can never double count) — aggregates them with the shared
 * aggregateMonthTransactions, and attaches the month's combined ending
 * balance: the latest financialDailyBalances row per account per month,
 * summed across accounts, or null when no account has a snapshot that month.
 * Trend/window math (means, medians, movers) lives in the shared
 * computeFinancialInsights so it stays unit-testable; this returns raw
 * monthly rows.
 */
async function buildInsights(
  db: any,
  brainInstanceId: any,
  args: { accountId?: string; monthCount?: number },
) {
  const monthCount = args.monthCount ?? 13;
  if (!Number.isInteger(monthCount) || monthCount < 1 || monthCount > 60) {
    throw new Error("monthCount must be an integer between 1 and 60");
  }

  let accounts: any[];
  if (args.accountId) {
    accounts = [await requireAccount(db, brainInstanceId, args.accountId)];
  } else {
    const allAccounts = await db
      .query("financialAccounts")
      .withIndex("by_brain", (q: any) => q.eq("brainInstanceId", brainInstanceId))
      .collect();
    accounts = allAccounts.sort((a: any, b: any) => a.name.localeCompare(b.name));
  }

  // Trailing month keys ending at the current month (UTC), ascending.
  const currentKey = monthKeyFromDate(Date.now());
  const monthKeys: string[] = [currentKey];
  while (monthKeys.length < monthCount) {
    monthKeys.unshift(previousMonthKey(monthKeys[0]!));
  }

  const months = [];
  for (const monthKey of monthKeys) {
    const transactions: any[] = [];
    let balanceSumCents = 0;
    let hasBalance = false;
    for (const account of accounts) {
      transactions.push(...(await monthTransactions(db, brainInstanceId, account._id, monthKey)));
      const latest = latestMonthBalance(await monthBalances(db, brainInstanceId, account._id, monthKey));
      if (latest) {
        balanceSumCents += latest.endOfDayBalanceCents;
        hasBalance = true;
      }
    }
    const aggregates = aggregateMonthTransactions(
      transactions.map((transaction: any) => ({
        txType: transaction.txType,
        category: transaction.category,
        amountCents: transaction.amountCents,
      })),
    );
    months.push({
      monthKey,
      transactionCount: aggregates.transactionCount,
      typeTotalsCents: aggregates.typeTotalsCents,
      categoryTotalsCents: aggregates.categoryTotalsCents,
      totalOutgoingCents: aggregates.totalOutgoingCents,
      totalIncomingCents: aggregates.totalIncomingCents,
      netCents: aggregates.netCents,
      transferNetCents: aggregates.transferNetCents,
      endingBalanceCents: hasBalance ? balanceSumCents : null,
    });
  }

  return {
    currentMonthKey: currentKey,
    months,
    accounts: accounts.map((account: any) => ({
      _id: account._id,
      name: account.name,
      accountType: account.accountType,
      mask: account.mask,
      institution: account.institution,
    })),
  };
}

function latestMonthBalance(rows: any[]): any | null {
  let latest: any = null;
  for (const row of rows) {
    if (!latest || row.date > latest.date) latest = row;
  }
  return latest;
}

function validateBudgetTargets(input: {
  categoryTargets?: Record<string, number>;
  typeTargets?: Record<string, number>;
  targetOutgoingCents?: number;
  targetIncomingCents?: number;
  targetNetCents?: number;
}) {
  for (const [category, target] of Object.entries(input.categoryTargets ?? {})) {
    if (!(TX_CATEGORIES as readonly string[]).includes(category)) {
      throw new Error(`invalid budget category "${category}". Valid categories: ${TX_CATEGORIES.join(" | ")}`);
    }
    assertIntegerCents(target, `categoryTargets["${category}"]`);
  }
  for (const [type, target] of Object.entries(input.typeTargets ?? {})) {
    if (!(TX_TYPES as readonly string[]).includes(type)) {
      throw new Error(`invalid budget transaction type "${type}". Valid types: ${TX_TYPES.join(" | ")}`);
    }
    assertIntegerCents(target, `typeTargets["${type}"]`);
  }
  for (const field of ["targetOutgoingCents", "targetIncomingCents", "targetNetCents"] as const) {
    const value = input[field];
    if (value !== undefined) assertIntegerCents(value, field);
  }
}

/* ------------------------------------------------------------------ */
/* Viewer-facing (Clerk auth)                                         */
/* ------------------------------------------------------------------ */

export const upsertFinancialAccountForViewer = mutationGeneric({
  args: {
    accountId: v.optional(v.id("financialAccounts")),
    name: v.string(),
    accountType: financialAccountTypeValidator,
    mask: v.string(),
    institution: v.optional(v.string()),
    plaidAccountId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    return upsertAccount(ctx.db, brain._id, args, { actorType: "user", actorId: user._id });
  },
});

export const listAccountsForViewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const accounts = await ctx.db
      .query("financialAccounts")
      .withIndex("by_brain", (q: any) => q.eq("brainInstanceId", brain._id))
      .collect();
    return accounts
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
      .map((account: any) => ({
        _id: account._id,
        name: account.name,
        accountType: account.accountType,
        mask: account.mask,
        institution: account.institution,
        plaidAccountId: account.plaidAccountId,
        updatedAt: account.updatedAt,
      }));
  },
});

export const createTransactionForViewer = mutationGeneric({
  args: {
    accountId: v.id("financialAccounts"),
    date: v.number(),
    amountCents: v.number(),
    description: v.string(),
    txType: txTypeValidator,
    category: txCategoryValidator,
    monthKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    await requireAccount(ctx.db, brain._id, args.accountId);
    const fields = normalizeTransactionFields(args);
    const now = Date.now();
    const transactionId = await ctx.db.insert("financialTransactions", {
      brainInstanceId: brain._id,
      accountId: args.accountId,
      ...fields,
      source: "manual",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "financial_transaction_created",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Transaction added: ${fields.description} (${fields.txType} / ${fields.category})`,
      metadata: { accountId: args.accountId, transactionId, amountCents: fields.amountCents },
    });

    return { transactionId, status: "created", monthKey: fields.monthKey };
  },
});

export const updateTransactionForViewer = mutationGeneric({
  args: {
    transactionId: v.id("financialTransactions"),
    accountId: v.optional(v.id("financialAccounts")),
    date: v.optional(v.number()),
    amountCents: v.optional(v.number()),
    description: v.optional(v.string()),
    txType: v.optional(txTypeValidator),
    category: v.optional(txCategoryValidator),
    monthKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction || transaction.brainInstanceId !== brain._id) {
      throw new Error("transaction not found for brain instance");
    }
    if (args.accountId) {
      await requireAccount(ctx.db, brain._id, args.accountId);
    }

    // Resolve the full post-edit field set, then re-validate the pairing so a
    // recategorization can never produce an invalid type/category combination.
    const fields = normalizeTransactionFields({
      date: args.date ?? transaction.date,
      amountCents: args.amountCents ?? transaction.amountCents,
      description: args.description ?? transaction.description,
      txType: args.txType ?? transaction.txType,
      category: args.category ?? transaction.category,
      ...(args.monthKey !== undefined
        ? { monthKey: args.monthKey }
        : args.date !== undefined
          ? {} // date changed: re-derive monthKey from the new date
          : { monthKey: transaction.monthKey }),
    });

    const now = Date.now();
    await ctx.db.patch(args.transactionId, {
      ...(args.accountId ? { accountId: args.accountId } : {}),
      ...fields,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "financial_transaction_updated",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Transaction updated: ${fields.description} (${fields.txType} / ${fields.category})`,
      metadata: { transactionId: args.transactionId, accountId: args.accountId ?? transaction.accountId },
    });

    return { transactionId: args.transactionId, status: "updated", monthKey: fields.monthKey };
  },
});

export const deleteTransactionForViewer = mutationGeneric({
  args: { transactionId: v.id("financialTransactions") },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction || transaction.brainInstanceId !== brain._id) {
      throw new Error("transaction not found for brain instance");
    }
    await ctx.db.delete(args.transactionId);

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "financial_transaction_deleted",
      actorType: "user",
      actorId: user._id,
      timestamp: Date.now(),
      summary: `Transaction deleted: ${transaction.description}`,
      metadata: { accountId: transaction.accountId, monthKey: transaction.monthKey },
    });

    return { transactionId: args.transactionId, status: "deleted" };
  },
});

export const setBudgetForViewer = mutationGeneric({
  args: {
    accountId: v.id("financialAccounts"),
    // Absent monthKey = the default/recurring budget for this account.
    monthKey: v.optional(v.string()),
    categoryTargets: v.optional(v.record(v.string(), v.number())),
    typeTargets: v.optional(v.record(v.string(), v.number())),
    targetOutgoingCents: v.optional(v.number()),
    targetIncomingCents: v.optional(v.number()),
    targetNetCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    await requireAccount(ctx.db, brain._id, args.accountId);
    if (args.monthKey !== undefined && !isValidMonthKey(args.monthKey)) {
      throw new Error(`invalid monthKey "${args.monthKey}". Expected 'YYYY-MM'.`);
    }
    validateBudgetTargets(args);

    const now = Date.now();
    const budgets = await ctx.db
      .query("financialBudgets")
      .withIndex("by_brain_account", (q: any) =>
        q.eq("brainInstanceId", brain._id).eq("accountId", args.accountId),
      )
      .collect();
    const existing = budgets.find((budget: any) => budget.monthKey === args.monthKey);

    const fields = {
      monthKey: args.monthKey,
      categoryTargets: args.categoryTargets,
      typeTargets: args.typeTargets,
      targetOutgoingCents: args.targetOutgoingCents,
      targetIncomingCents: args.targetIncomingCents,
      targetNetCents: args.targetNetCents,
      updatedAt: now,
    };

    let budgetId: string;
    let status: "created" | "updated";
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      budgetId = existing._id;
      status = "updated";
    } else {
      budgetId = await ctx.db.insert("financialBudgets", {
        brainInstanceId: brain._id,
        accountId: args.accountId,
        ...fields,
        createdAt: now,
      });
      status = "created";
    }

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "financial_budget_set",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Budget ${status} for ${args.monthKey ?? "default (recurring)"}`,
      metadata: { accountId: args.accountId, budgetId, monthKey: args.monthKey },
    });

    return { budgetId, status, monthKey: args.monthKey ?? null };
  },
});

export const monthlyReportForViewer = queryGeneric({
  args: { accountId: v.id("financialAccounts"), monthKey: v.string() },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    return buildMonthlyReport(ctx.db, brain._id, args.accountId, args.monthKey);
  },
});

export const insightsForViewer = queryGeneric({
  args: {
    // Absent accountId = all of the brain's accounts combined.
    accountId: v.optional(v.id("financialAccounts")),
    monthCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    return buildInsights(ctx.db, brain._id, {
      ...(args.accountId !== undefined ? { accountId: args.accountId } : {}),
      ...(args.monthCount !== undefined ? { monthCount: args.monthCount } : {}),
    });
  },
});

/* ------------------------------------------------------------------ */
/* Brain-facing (MCP token routing)                                   */
/* ------------------------------------------------------------------ */

export const upsertFinancialAccountForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    name: v.string(),
    accountType: financialAccountTypeValidator,
    mask: v.string(),
    institution: v.optional(v.string()),
    plaidAccountId: v.optional(v.string()),
    actorId: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    return upsertAccount(
      db,
      args.brainInstanceId,
      {
        name: args.name,
        accountType: args.accountType,
        mask: args.mask,
        ...(args.institution !== undefined ? { institution: args.institution } : {}),
        ...(args.plaidAccountId !== undefined ? { plaidAccountId: args.plaidAccountId } : {}),
      },
      { actorType: "harness", ...(args.actorId ? { actorId: args.actorId } : {}) },
    );
  },
});

export const recordFinancialTransactionsForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    accountId: v.id("financialAccounts"),
    source: v.optional(txSourceValidator),
    transactions: v.array(bulkTransactionValidator),
    actorId: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    return recordTransactionsBulk(
      db,
      args.brainInstanceId,
      {
        accountId: args.accountId,
        ...(args.source !== undefined ? { source: args.source } : {}),
        transactions: args.transactions,
      },
      { actorType: "harness", ...(args.actorId ? { actorId: args.actorId } : {}) },
    );
  },
});

export const recordDailyBalancesForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    accountId: v.id("financialAccounts"),
    source: v.optional(balanceSourceValidator),
    balances: v.array(dailyBalanceValidator),
    actorId: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    return recordDailyBalancesBulk(
      db,
      args.brainInstanceId,
      {
        accountId: args.accountId,
        ...(args.source !== undefined ? { source: args.source } : {}),
        balances: args.balances,
      },
      { actorType: "harness", ...(args.actorId ? { actorId: args.actorId } : {}) },
    );
  },
});

export const monthlyReportForBrain = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    accountId: v.id("financialAccounts"),
    monthKey: v.string(),
  },
  handler: async ({ db }, args) => {
    return buildMonthlyReport(db, args.brainInstanceId, args.accountId, args.monthKey);
  },
});

export const insightsForBrain = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    // Absent accountId = all of the brain's accounts combined.
    accountId: v.optional(v.id("financialAccounts")),
    monthCount: v.optional(v.number()),
  },
  handler: async ({ db }, args) => {
    return buildInsights(db, args.brainInstanceId, {
      ...(args.accountId !== undefined ? { accountId: args.accountId } : {}),
      ...(args.monthCount !== undefined ? { monthCount: args.monthCount } : {}),
    });
  },
});
