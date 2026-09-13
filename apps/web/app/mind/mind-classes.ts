/** Shared Tailwind recipes, matching the app's page-classes.ts convention. */
export const mindControlClass =
  "cursor-pointer focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--mind-accent)]";

export const mindToolClass =
  "inline-flex items-center gap-[7px] whitespace-nowrap rounded-[7px] px-2.5 py-2 text-[14px] text-[var(--mind-muted)] aria-pressed:bg-[color-mix(in_srgb,var(--mind-accent)_10.98%,transparent)] aria-pressed:text-[var(--mind-accent-strong)] hover:bg-[color-mix(in_srgb,var(--mind-accent)_7.06%,transparent)] hover:text-[var(--mind-ink)]";

export const mindFallbackClass =
  "flex h-full min-h-[300px] flex-col items-center justify-center gap-3 p-[35px] text-center text-[13px] leading-[1.8] text-[var(--mind-muted)]";

export const mindNeighborhoodClass =
  "mt-4 flex w-full items-center justify-center gap-2 rounded-[7px] border border-[color-mix(in_srgb,var(--mind-accent)_14.9%,transparent)] bg-[color-mix(in_srgb,var(--mind-accent)_3.92%,transparent)] px-[7px] py-2.5 text-[14px] text-[var(--mind-accent-strong)] hover:bg-[color-mix(in_srgb,var(--mind-accent)_10.2%,transparent)]";
