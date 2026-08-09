/**
 * Shared Tailwind class recipes for page-level layout patterns that used to be
 * global CSS classes in globals.css (pre-Tailwind). Pages compose these with
 * `cn` from "@/lib/utils" plus local utilities.
 *
 * Breakpoint note: `wide:` is the historic 821px page breakpoint (defined in
 * globals.css via --breakpoint-wide); `desk:` is the 881px shell breakpoint.
 */

/* ---- page scaffolding ---- */
export const pageHeaderClass = "mb-[22px] grid items-end justify-between gap-5 wide:flex";
export const eyebrowClass = "m-0 mb-[5px] text-[13px] font-bold uppercase text-green";
export const mutedClass = "text-muted-foreground";

/* ---- card / section / grid ---- */
export const cardClass = "rounded-lg border bg-card shadow-[0_12px_30px_rgba(31,34,29,0.08)]";
export const sectionClass = "p-5";
/** 12-column page grid; combine with spanNClass on children. */
export const gridClass = "grid grid-cols-12 gap-4";
export const span4Class = "col-span-12 wide:col-span-4";
export const span5Class = "col-span-12 wide:col-span-5";
export const span6Class = "col-span-12 wide:col-span-6";
export const span7Class = "col-span-12 wide:col-span-7";
export const span8Class = "col-span-12 wide:col-span-8";
export const span12Class = "col-span-12";
export const splitListClass = "grid grid-cols-1 gap-4 wide:grid-cols-2";

/* ---- item rows ---- */
export const itemListClass = "grid gap-2.5";
export const itemClass =
  "grid grid-cols-[auto_1fr] wide:grid-cols-[auto_1fr_auto] items-start gap-3 rounded-lg border bg-secondary p-3.5 " +
  "data-[anchor-flash=true]:border-gold data-[anchor-flash=true]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--gold)_35%,transparent)] data-[anchor-flash=true]:transition-[box-shadow,border-color] data-[anchor-flash=true]:duration-400";
export const taskItemClass = "wide:grid-cols-[auto_minmax(0,1fr)_auto_auto]";
export const pendingActionItemClass = "wide:grid-cols-[auto_minmax(0,1fr)_minmax(130px,auto)]";
export const itemIconClass = "grid size-[34px] place-items-center rounded-lg bg-accent text-green";
export const itemIconActiveClass = "bg-gold/10 text-gold";
export const itemTitleClass = "m-0 mb-1 font-bold";
export const itemMetaClass = "m-0 text-sm leading-[1.35] text-muted-foreground";
export const taskSideClass =
  "col-start-2 inline-flex flex-wrap justify-start gap-1.5 wide:col-start-auto wide:justify-end";
export const pendingActionSideClass =
  "col-start-2 grid justify-items-start gap-2.5 wide:col-start-auto wide:justify-items-end";
export const projectRowClass =
  "items-center text-inherit no-underline transition-[border-color,box-shadow] hover:border-primary hover:shadow-[0_12px_30px_rgba(31,34,29,0.08)]";
export const projectRowSideClass = "inline-flex items-center gap-2.5 text-muted-foreground";

/* ---- badges ---- */
export const badgeClass =
  "inline-flex min-h-[26px] items-center whitespace-nowrap rounded-lg border bg-muted px-2 text-xs font-bold text-muted-foreground";
export const badgeBlueClass = "bg-blue/10 text-blue";
export const badgeGoldClass = "bg-gold/10 text-gold";
export const badgeRedClass = "bg-red/10 text-red";

/* ---- buttons ---- */
export const textButtonClass =
  "inline-flex min-h-[38px] cursor-pointer items-center justify-center rounded-lg border bg-secondary px-3 font-bold text-foreground hover:border-[#b9c4bc] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55";
export const textButtonCompactClass = "min-h-[30px] px-[9px] text-[13px]";
export const iconButtonClass =
  "inline-grid size-[38px] cursor-pointer place-items-center rounded-lg border bg-secondary text-foreground hover:border-[#b9c4bc] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55";
export const iconButtonFavoriteClass = "border-gold bg-gold/10 text-gold";

/* ---- forms ---- */
export const formGridClass = "grid gap-3";
export const fieldClass = "grid gap-1.5";
export const fieldLabelClass = "text-[13px] font-bold text-muted-foreground";
export const inputClass =
  "min-h-10 w-full rounded-lg border bg-secondary px-2.5 text-foreground focus-visible:border-primary focus-visible:outline-none";
export const selectClass = inputClass;
export const textareaClass =
  "min-h-[120px] w-full resize-y rounded-lg border bg-secondary p-2.5 text-foreground focus-visible:border-primary focus-visible:outline-none";
export const checkboxFieldClass =
  "inline-flex min-h-10 items-center gap-2 font-bold text-foreground [&_input]:size-4 [&_input]:accent-primary";
export const checkboxFieldBottomClass = "self-end";
export const errorTextClass = "m-0 text-[13px] font-bold text-red";

/* ---- misc ---- */
export const toolbarClass = "flex flex-wrap gap-2";
export const codeClass = "font-mono text-[13px] [overflow-wrap:anywhere]";
export const settingsRowClass =
  "grid grid-cols-[1fr_auto] items-center gap-3.5 border-b py-3.5 last:border-b-0";
