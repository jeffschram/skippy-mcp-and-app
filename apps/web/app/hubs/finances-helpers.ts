import { TX_CATEGORIES, isValidMonthKey, type TxCategory } from "@skippy/shared";

/* ------------------------------------------------------------------ */
/* Pure helpers for the Finances hub: currency formatting, month-key   */
/* navigation, and bucketing a month's transactions into the           */
/* spreadsheet-style day x category grid. All amounts are integer      */
/* cents; all date math is UTC to match the backend's monthKey rules.  */
/* ------------------------------------------------------------------ */

export type GridTransaction = {
  _id: string;
  date: number;
  amountCents: number;
  description: string;
  txType: string;
  category: string;
  source?: string;
};

export type DayRow = {
  /** 1-based day of month. */
  day: number;
  /** 'MM/DD' label matching the family spreadsheet's left column. */
  label: string;
  /** Transactions for this day keyed by category (taxonomy order preserved). */
  cells: Record<TxCategory, GridTransaction[]>;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function assertMonthKey(monthKey: string): { year: number; month: number } {
  if (!isValidMonthKey(monthKey)) {
    throw new Error(`invalid monthKey "${monthKey}". Expected 'YYYY-MM'.`);
  }
  return { year: Number(monthKey.slice(0, 4)), month: Number(monthKey.slice(5, 7)) };
}

/** Integer cents -> '$1,234.56' (negative -> '-$1,234.56'). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** Integer cents -> explicitly signed string: '+$85.00', '-$120.00', '$0.00'. */
export function formatSignedCents(cents: number): string {
  if (cents === 0) return "$0.00";
  return cents > 0 ? `+${formatCents(cents)}` : formatCents(cents);
}

/**
 * Dollar string ('1,234.56', '$12', '-3.5') -> integer cents, or null when the
 * input is not a valid amount (including more than 2 decimal places).
 */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const [wholePart, fractionPart = ""] = (negative ? cleaned.slice(1) : cleaned).split(".");
  const cents = Number(wholePart) * 100 + Number(fractionPart.padEnd(2, "0") || "0");
  return negative ? -cents : cents;
}

/** 'YYYY-MM' month key for `now` (epoch ms), computed in UTC. */
export function currentMonthKey(now: number = Date.now()): string {
  const date = new Date(now);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Shift a month key by `delta` months (delta may be negative). */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const { year, month } = assertMonthKey(monthKey);
  const zeroBased = year * 12 + (month - 1) + delta;
  const shiftedYear = Math.floor(zeroBased / 12);
  const shiftedMonth = (((zeroBased % 12) + 12) % 12) + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, "0")}`;
}

/** '2026-04' -> 'April 2026'. */
export function monthKeyLabel(monthKey: string): string {
  const { year, month } = assertMonthKey(monthKey);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** '2026-03' -> 'Mar' (compact label for month-over-month comparisons). */
export function monthKeyShortLabel(monthKey: string): string {
  const { month } = assertMonthKey(monthKey);
  return MONTH_NAMES[month - 1]!.slice(0, 3);
}

/** Number of days in the month ('2026-02' -> 28, '2024-02' -> 29). */
export function daysInMonth(monthKey: string): number {
  const { year, month } = assertMonthKey(monthKey);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 'MM/DD' label for a day of the month ('2026-04', 1 -> '04/01'). */
export function dayLabel(monthKey: string, day: number): string {
  const { month } = assertMonthKey(monthKey);
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

/** Epoch ms (UTC midnight) for a 'YYYY-MM-DD' date-input value, or null. */
export function dateInputToEpochMs(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const epoch = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const roundTrip = new Date(epoch);
  // Reject overflow dates like 2026-02-31 (Date.UTC silently rolls them over).
  if (roundTrip.getUTCMonth() + 1 !== Number(month) || roundTrip.getUTCDate() !== Number(day)) {
    return null;
  }
  return epoch;
}

/** Epoch ms -> 'YYYY-MM-DD' (UTC) for prefilling date inputs. */
export function epochMsToDateInput(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

function emptyCells(): Record<TxCategory, GridTransaction[]> {
  const cells = {} as Record<TxCategory, GridTransaction[]>;
  for (const category of TX_CATEGORIES) cells[category] = [];
  return cells;
}

/**
 * Buckets a month's transactions into one row per calendar day (every day of
 * the month is present, even when empty), with per-category stacks inside each
 * row. Days are computed in UTC. Transactions whose date falls outside the
 * month (possible when a monthKey was supplied explicitly during ingestion)
 * are clamped to the first/last day so nothing silently disappears.
 */
export function bucketTransactionsByDay(monthKey: string, transactions: GridTransaction[]): DayRow[] {
  const { year, month } = assertMonthKey(monthKey);
  const totalDays = daysInMonth(monthKey);

  const rows: DayRow[] = Array.from({ length: totalDays }, (_, index) => ({
    day: index + 1,
    label: dayLabel(monthKey, index + 1),
    cells: emptyCells(),
  }));

  const sorted = [...transactions].sort((a, b) => a.date - b.date || a.description.localeCompare(b.description));
  for (const transaction of sorted) {
    const date = new Date(transaction.date);
    let day: number;
    if (date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month) {
      day = date.getUTCDate();
    } else {
      day = transaction.date < Date.UTC(year, month - 1, 1) ? 1 : totalDays;
    }
    const cell = rows[day - 1]!.cells[transaction.category as TxCategory];
    // Unknown categories can't happen through validated write paths; guard anyway.
    if (cell) cell.push(transaction);
  }
  return rows;
}

/** True when at least one category cell in the row holds a transaction. */
export function dayRowHasEntries(row: DayRow): boolean {
  return Object.values(row.cells).some((cell) => cell.length > 0);
}
