/**
 * Pure cursor math for incremental source ingestion (2026-09-03).
 *
 * Before this cursor existed, every hourly agenda pass re-read the same Gmail
 * threads and iMessage texts — nothing told it when the last pass ran — and
 * the approval queue accumulated 24 duplicate calendar proposals (one event
 * proposed 15 times). The fix: the runner reads the last COMPLETED
 * ingestionRuns row for the role and pins the read window in the pass prompt,
 * the same "pinned by the host, not guessed" philosophy as the 2026-08-30
 * connector-scope fix in agentPassExecutor.ts.
 *
 * Extracted from the executor so the buffer/cap arithmetic is testable
 * without a harness or a Convex client.
 */

/**
 * Overlap buffer subtracted from the last completed timestamp. Covers clock
 * skew between the mini and Convex, plus messages that arrived mid-pass after
 * the sources were read but before the run record was written.
 */
export const INGESTION_OVERLAP_BUFFER_MS = 15 * 60_000;

/**
 * Lookback ceiling when there is no usable cursor (first run, or the last
 * completed pass is stale). 48 hours bounds a catch-up pass after downtime —
 * an unbounded "read everything" is exactly the behavior this cursor removes.
 */
export const INGESTION_MAX_LOOKBACK_MS = 48 * 60 * 60_000;

export type IngestionCursor = {
  /** Epoch ms: only read source content newer than this. */
  since: number;
  /** True when the 48h cap applied (no prior completed run, or a stale one). */
  capped: boolean;
  /** The completed-run timestamp the cursor derives from, when one existed. */
  lastCompletedAt: number | null;
};

/**
 * Derives the read window from the last completed run.
 *
 * Failed runs never reach here — the caller queries completed runs only — so
 * a failed pass cannot advance the cursor past content it did not process.
 */
export function resolveIngestionCursor(
  lastCompletedAt: number | null | undefined,
  now: number,
): IngestionCursor {
  const floor = now - INGESTION_MAX_LOOKBACK_MS;
  if (typeof lastCompletedAt !== "number" || !Number.isFinite(lastCompletedAt)) {
    return { since: floor, capped: true, lastCompletedAt: null };
  }
  const buffered = lastCompletedAt - INGESTION_OVERLAP_BUFFER_MS;
  if (buffered <= floor) {
    // The cursor exists but is older than the cap: treat it like a first run
    // rather than replaying days of sources.
    return { since: floor, capped: true, lastCompletedAt };
  }
  // Clamp to now: a clock-skewed future timestamp must not produce a window
  // that starts after the present and silently reads nothing forever.
  return { since: Math.min(buffered, now), capped: false, lastCompletedAt };
}

/** Gmail's `after:` operator takes epoch SECONDS, not milliseconds. */
export function epochSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/**
 * Renders the cursor as prompt text for a source-ingesting agent pass.
 *
 * Names native connector parameters while deferring to the exposed schemas.
 * The skill supplies coverage semantics; this legacy cutoff is only a budget.
 */
export function buildIngestionCursorBlock(cursor: IngestionCursor): string {
  const sinceIso = new Date(cursor.since).toISOString();
  const header = cursor.capped
    ? cursor.lastCompletedAt === null
      ? "No recent completed pass is on record, so read the last 48 hours only."
      : "The last completed pass is older than 48 hours, so read the last 48 hours only."
    : `Last successful pass completed ${new Date(cursor.lastCompletedAt as number).toISOString()}; a 15-minute overlap buffer is already included below.`;
  return (
    `${header} Only read source content newer than ${sinceIso}: ` +
    `use from "${sinceIso}" on native Messages read_messages/find_chats, "after:${epochSeconds(cursor.since)}" in Gmail search queries, ` +
    `and time_min "${sinceIso}" on Google Calendar search_events. Freeze the upper bound at pass start and apply the connector schema (to, before:, time_max). ` +
    `Legacy connectors may use different parameter names; inspect their schemas. Do not improvise a wider window. ` +
    `A capped stale interval is an outstanding coverage gap, not a successful catch-up; follow the ingestion skill reporting rules.`
  );
}
