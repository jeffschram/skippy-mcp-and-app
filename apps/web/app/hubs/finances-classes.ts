/* Shared Tailwind class strings for the Finances hub (grid, insights, and
   debts views). Converted from the old finances.module.css and kept in one
   module so the three views cannot drift.

   Type band colors are derived from theme tokens (never spreadsheet literals)
   via color-mix so they tint correctly in light and dark themes: Fixed =
   muted purple (blue+red mix), Spending = blue, Food = amber (gold), Income =
   green, Transfer = neutral gray (muted). Each band class sets a `--band`
   custom property; the strong/soft/faint classes mix it into backgrounds. */

export const controls = "mb-3.5 flex flex-wrap items-center justify-between gap-3";
export const controlsGroup = "flex flex-wrap items-center gap-2.5";
export const monthNav = "flex items-center gap-1";
export const monthLabel = "min-w-[148px] text-center text-base font-bold";
export const accountMeta = "text-[13px] text-muted-foreground";

/* ---------------- Grid ---------------- */

export const gridWrap = "overflow-x-auto rounded-[12px] border bg-card";

/* A real <table>: separate borders (collapse breaks sticky-column borders
   while scrolling) with per-cell bottom/right rules matching the old grid. */
export const grid =
  "w-full min-w-[1240px] border-separate border-spacing-0 text-[13px] [&_th]:text-left [&_tr>*:last-child]:border-r-0";

export const cell =
  "h-[30px] border-b border-r border-r-[color:color-mix(in_srgb,var(--border)_55%,transparent)] px-2 py-1.5 align-top";

export const dayCell =
  "sticky left-0 z-[2] w-[76px] min-w-[76px] border-r border-r-border bg-card text-xs font-normal tabular-nums text-muted-foreground";

export const cornerCell = "z-[3]";

export const bandHead =
  "border-b border-r border-r-[color:color-mix(in_srgb,var(--border)_55%,transparent)] px-2.5 py-2 text-xs font-extrabold uppercase tracking-[0.08em] text-foreground";

export const categoryHead = "min-w-[128px] align-bottom text-xs font-bold leading-[1.3] text-foreground";

/* Balance column: sticky immediately after the 76px day column so the date
   and end-of-day balance pin together during horizontal scroll. Same
   background approach as the day cell, with the day column's stronger right
   border. Merge it after categoryHead so its width wins on the 'Balance'
   header cell. */
export const balanceCell =
  "sticky left-[76px] z-[2] w-24 min-w-24 whitespace-nowrap border-r border-r-border bg-card text-xs tabular-nums";

/* Band tint variables (token-derived, theme-aware). */
export const bandFixedCosts = "[--band:color-mix(in_srgb,var(--blue)_55%,var(--red)_45%)]";
/* Teal-ish: growth money, between green (income) and blue. */
export const bandInvestments = "[--band:color-mix(in_srgb,var(--green)_55%,var(--blue)_45%)]";
/* Cyan/steel: cooler and grayer than the Investments teal. */
export const bandSavings = "[--band:color-mix(in_srgb,var(--blue)_70%,var(--muted-foreground)_30%)]";
export const bandGuiltFree = "[--band:var(--gold)]";
export const bandIncome = "[--band:color-mix(in_srgb,var(--green)_70%,var(--blue)_30%)]";
/* Transfers are budget-neutral: a plain gray tint, distinct from the four
   colored bands, derived from the theme-aware muted token. */
export const bandTransfer = "[--band:var(--muted-foreground)]";

export const bandStrong = "bg-[color-mix(in_srgb,var(--band)_26%,var(--secondary))]";
export const bandSoft = "bg-[color-mix(in_srgb,var(--band)_13%,var(--card))]";
export const bandFaint = "bg-[color-mix(in_srgb,var(--band)_5%,transparent)]";

/* ---------------- Entries ---------------- */

export const cellStack = "grid grid-cols-1 content-start gap-[3px]";

export const entry =
  "flex w-full cursor-pointer items-baseline justify-between gap-2 rounded-[6px] border border-transparent bg-transparent px-[5px] py-0.5 text-left text-[12.5px] text-foreground transition-colors duration-100 hover:border-[color:color-mix(in_srgb,var(--band,var(--blue))_55%,var(--border))] hover:bg-[color-mix(in_srgb,var(--band,var(--blue))_12%,var(--secondary))] focus-visible:border-[color:color-mix(in_srgb,var(--band,var(--blue))_55%,var(--border))] focus-visible:bg-[color-mix(in_srgb,var(--band,var(--blue))_12%,var(--secondary))] focus-visible:outline-none";

export const entryDesc = "min-w-0";

/* Off-ledger contributions (payroll-deducted 401k): visible in the grid but
   muted — the money never touched the account, so they are outside the
   balance column and outgoing/net totals. (Pair with `italic` on the
   description span.) */
export const entryOffLedger = "opacity-60";

export const entryAutoTag =
  "ml-[5px] whitespace-nowrap rounded-[4px] border px-1 text-[9.5px] font-bold uppercase not-italic tracking-[0.06em] text-muted-foreground";

export const offLedgerNote = "text-xs font-semibold tabular-nums text-muted-foreground";

export const entryAmount = "whitespace-nowrap tabular-nums text-muted-foreground";

/* ---------------- Totals ---------------- */

export const totalCell = "border-t-2 font-bold tabular-nums";

export const totalLabel =
  "align-middle text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground";

export const totalAmount = "text-[13px]";

export const totalPercent = "ml-1.5 text-[11px] font-semibold text-muted-foreground";

export const comparisons = "mt-[3px] grid grid-cols-1 gap-px";

export const comparison =
  "whitespace-nowrap text-[11px] font-semibold tabular-nums text-muted-foreground";

export const comparisonOver = "text-[color:color-mix(in_srgb,var(--red)_78%,var(--muted-foreground))]";

/* Raw --green is too light on light backgrounds; darken it there. */
const goodGreenText =
  "text-[color:light-dark(color-mix(in_srgb,var(--green)_42%,var(--near-black)),var(--green))]";

export const comparisonUnder = goodGreenText;

export const summaryRow = "text-left align-middle";

export const summaryRowLabel = "text-left";

/* Pins the summary label + value to the visible left edge of the horizontal
   scroll container, so totals are readable without scrolling right. */
export const summaryStick =
  "sticky left-0 flex w-max max-w-full flex-wrap items-baseline gap-3.5 pr-3";

export const summaryValue = "text-sm font-extrabold tabular-nums";

export const netPositive = goodGreenText;

export const netNegative = "text-[color:color-mix(in_srgb,var(--red)_85%,var(--foreground))]";

/* ---------------- Forms ---------------- */

export const formGrid = "grid grid-cols-1 gap-3.5";

export const formRow = "grid grid-cols-2 gap-3";

export const formActions = "flex flex-wrap items-center justify-between gap-2";

export const formActionsEnd = "ml-auto flex justify-end gap-2";

export const budgetSection = "mb-[18px] grid grid-cols-1 gap-2";

export const budgetSectionTitle =
  "m-0 text-xs font-extrabold uppercase tracking-[0.07em] text-muted-foreground";

/* label | $ input | compact % input */
export const budgetRow = "grid grid-cols-[1fr_96px_64px] items-center gap-2.5";

export const budgetRowLabel = "text-[13px]";

/* '22% ≈ $2,640 on May income' line under a percent input. */
export const budgetPercentPreview = "col-[2/-1] -mt-1 text-right text-xs";

export const budgetTypeTag =
  "mr-[7px] inline-block rounded-full bg-[color-mix(in_srgb,var(--band,var(--border))_22%,var(--secondary))] px-[7px] py-px text-[11px] font-bold";

/* ---------------- Insights view ---------------- */

export const viewTabs = "mb-3.5";

export const insightsStack = "grid grid-cols-1 gap-3.5";

export const insightsNote = "m-0 text-[13px] text-muted-foreground";

export const cardTitle =
  "m-0 mb-2.5 text-xs font-extrabold uppercase tracking-[0.07em] text-muted-foreground";

export const cardTitleNote = "ml-2 font-semibold normal-case tracking-normal";

/* Summary + per-category tables */

export const statsTableWrap = "overflow-x-auto";

export const statsTable =
  "w-full border-collapse text-[13px] [&_th]:border-b [&_th]:border-b-[color:color-mix(in_srgb,var(--border)_60%,transparent)] [&_th]:px-2.5 [&_th]:py-[7px] [&_th]:text-left [&_th]:align-top [&_td]:border-b [&_td]:border-b-[color:color-mix(in_srgb,var(--border)_60%,transparent)] [&_td]:px-2.5 [&_td]:py-[7px] [&_td]:align-top";

export const statsHead =
  "whitespace-nowrap text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground";

/* `!` mirrors the old `!important`: it must beat the table's `th` rules. */
export const statsValueCol = "min-w-[108px] text-right!";

export const statsLabelCell = "whitespace-nowrap font-bold";

export const statsGroupRow =
  "bg-[color-mix(in_srgb,var(--band)_13%,var(--card))] text-xs font-extrabold uppercase tracking-[0.06em]";

export const statsCategoryCell = "pl-[18px]! font-medium text-foreground";

export const statValue = "whitespace-nowrap font-bold tabular-nums";

export const statSub =
  "mt-0.5 block whitespace-nowrap text-[11px] font-semibold tabular-nums text-muted-foreground";

export const netRowTop = "[&_td]:border-t-2";

/* Movers + month-to-date cards */

export const insightsSideGrid =
  "grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-3.5";

export const moversList = "m-0 grid list-none grid-cols-1 gap-[9px] p-0";

export const moverRow = "flex flex-wrap items-baseline justify-between gap-2.5";

export const moverName = "inline-flex items-center gap-1.5 text-[13px] font-bold";

export const moverArrow = "inline-flex items-center";

export const moverValues = "whitespace-nowrap text-[12.5px] tabular-nums text-muted-foreground";

export const moverPercent = "ml-1.5 font-bold";

export const mtdList = "grid grid-cols-1 gap-1.5";

export const mtdRow = "flex items-baseline justify-between gap-2.5 text-[13px]";

export const mtdValue = "font-bold tabular-nums";

/* ---------------- Debts view ---------------- */

export const debtHeadlineGrid = "grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5";

export const debtHeadlineValue = "m-0 text-[22px] font-extrabold tabular-nums";

export const debtHeadlineSub = "m-0 mt-1 text-[13px] text-muted-foreground";

export const debtList = "grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3.5";

export const debtCard = "grid grid-cols-1 content-start gap-2.5";

export const debtCardHead = "flex items-start justify-between gap-2.5";

export const debtName = "m-0 text-[15px] font-bold";

export const debtLender = "m-0 mt-0.5 text-[12.5px] text-muted-foreground";

export const debtFacts = "flex flex-wrap gap-x-5 gap-y-2";

export const debtFact = "grid grid-cols-1 gap-0.5";

export const debtFactLabel =
  "text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground";

export const debtFactValue = "text-sm font-bold tabular-nums";

export const debtFactNote = "text-[11.5px] tabular-nums text-muted-foreground";

export const debtPattern = "rounded-[5px] border bg-secondary px-[5px] py-px text-xs font-semibold";

export const debtMatchLine = "m-0 text-[12.5px] tabular-nums text-muted-foreground";

export const debtExtraField = "inline-flex items-center gap-2 [&_input]:w-[110px]";

export const debtExtraLabel = "whitespace-nowrap text-[13px] font-bold";

export const debtWarning =
  "font-semibold text-[color:color-mix(in_srgb,var(--red)_78%,var(--muted-foreground))]";

export const debtProjectionList = "m-0 grid list-none grid-cols-1 gap-[9px] p-0";

export const debtProjectionRow = "flex flex-wrap items-baseline gap-3 text-[13px]";

export const debtProjectionMonth = "min-w-[120px] whitespace-nowrap font-bold";

export const debtProjectionDetail = "tabular-nums text-muted-foreground";

export const debtBandBadge =
  "ml-2 whitespace-nowrap rounded-full bg-[color-mix(in_srgb,var(--green)_22%,var(--secondary))] px-[7px] py-px text-[11px] font-bold text-[color:light-dark(color-mix(in_srgb,var(--green)_42%,var(--near-black)),var(--green))]";
