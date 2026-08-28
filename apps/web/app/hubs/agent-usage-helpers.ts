/**
 * Pure helpers for the Agents hub Usage tab (docs/token-efficiency.md
 * lever 1), extracted so they're testable without React/Convex.
 */

export type UsageTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

/** Compact token count: 982 / 45.3k / 1.2M. */
export function formatTokens(count: number | undefined): string {
  const n = count ?? 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/**
 * Share of input served from the provider's prompt cache, as a whole percent.
 * High is good: cache reads are the cheap bucket. Undefined when there was no
 * input at all (avoids a misleading "0% cached" on empty data).
 */
export function cachedSharePercent(totals: UsageTotals | undefined): number | undefined {
  if (!totals) return undefined;
  const input = totals.inputTokens + totals.cachedInputTokens;
  if (input <= 0) return undefined;
  return Math.round((totals.cachedInputTokens / input) * 100);
}
