/**
 * Pure decisions behind the calendar mirror sync: what window to ask Google
 * for, what to ask for next, and how big a batch to push to Convex.
 *
 * Split out from calendarMirrorSync.ts because every interesting bug in an
 * incremental sync is a state-machine bug, and a state machine you can only
 * exercise through OAuth + HTTP + Convex is a state machine nobody tests.
 */

/**
 * Full-sync window. Deliberately narrow: the mirror exists to answer "is there
 * already something here?" for events Skippy proposes, and Skippy proposes
 * things in the near future. 30 days back keeps recently-passed context (and
 * catches the tail of long events); 400 days forward covers a full year of
 * annual recurrences plus the slack that makes "next year's" version visible.
 */
export const FULL_SYNC_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
export const FULL_SYNC_LOOKAHEAD_MS = 400 * 24 * 60 * 60 * 1000;

/** Google's page ceiling for events.list. Asking for more is silently clamped. */
export const MAX_PAGE_SIZE = 250;

/**
 * Hard stop on pages per run. A first full sync of a busy calendar is bounded
 * by the window above; this only fires if Google hands back a pageToken loop,
 * and it fires before we spend an hour in a 10-minute timer.
 */
export const MAX_PAGES_PER_RUN = 40;

/**
 * Convex mutations have an argument size limit and the runner has no reason to
 * push a thousand events in one transaction. 100 keeps each mutation small
 * enough to retry cheaply if it fails.
 */
export const UPSERT_BATCH_SIZE = 100;

export type SyncRequest = {
  singleEvents: true;
  showDeleted: true;
  maxResults: number;
  syncToken?: string;
  pageToken?: string;
  timeMin?: number;
  timeMax?: number;
};

/**
 * Builds the request for the first page of a run.
 *
 * `singleEvents` is pinned true here and never varies — Google invalidates a
 * syncToken if the parameter changes between requests, which would turn every
 * incremental sync into a silent full resync.
 *
 * timeMin/timeMax are omitted entirely when a syncToken is present. Google
 * answers 400 for that combination rather than ignoring the window, so this is
 * correctness, not tidiness.
 */
export function buildInitialRequest(options: {
  now: number;
  syncToken?: string | null | undefined;
  maxResults?: number | undefined;
}): SyncRequest {
  const maxResults = Math.min(options.maxResults ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  if (options.syncToken) {
    return { singleEvents: true, showDeleted: true, maxResults, syncToken: options.syncToken };
  }
  return {
    singleEvents: true,
    showDeleted: true,
    maxResults,
    timeMin: options.now - FULL_SYNC_LOOKBACK_MS,
    timeMax: options.now + FULL_SYNC_LOOKAHEAD_MS,
  };
}

/**
 * Carries a request forward to the next page.
 *
 * The syncToken (or the window) has to be repeated on every page: a pageToken
 * alone is not a complete request, and dropping the window mid-walk would
 * silently widen the sync.
 */
export function nextPageRequest(previous: SyncRequest, pageToken: string): SyncRequest {
  return { ...previous, pageToken };
}

/**
 * What to do with a list outcome.
 *
 * `restart_full` is the 410 GONE path: the stored token expired and retrying
 * with it loops forever, so the caller must clear it and re-run from a bounded
 * window. It is returned at most once per run — a second 410 during the full
 * resync is a real failure, not a token problem.
 */
export type PageDecision =
  | { kind: "continue"; pageToken: string }
  | { kind: "done"; syncToken?: string | undefined }
  | { kind: "restart_full" }
  | { kind: "fail"; error: string };

export function decidePage(
  outcome:
    | { status: "ok"; events: unknown[]; nextPageToken?: string | undefined; nextSyncToken?: string | undefined }
    | { status: "sync_token_expired" }
    | { status: "failed"; error: string },
  context: { pagesFetched: number; alreadyRestarted: boolean },
): PageDecision {
  if (outcome.status === "failed") return { kind: "fail", error: outcome.error };
  if (outcome.status === "sync_token_expired") {
    return context.alreadyRestarted
      ? { kind: "fail", error: "sync token expired during a full resync" }
      : { kind: "restart_full" };
  }
  if (outcome.nextPageToken) {
    if (context.pagesFetched >= MAX_PAGES_PER_RUN) {
      // Stop without a syncToken: persisting one now would claim we saw the
      // whole calendar. The next run redoes the window instead of skipping it.
      return { kind: "done", syncToken: undefined };
    }
    return { kind: "continue", pageToken: outcome.nextPageToken };
  }
  return { kind: "done", syncToken: outcome.nextSyncToken };
}

/** Splits events into Convex-sized pushes. Empty in, empty out — no wasted mutation. */
export function chunkEvents<T>(events: T[], size: number = UPSERT_BATCH_SIZE): T[][] {
  if (size <= 0) throw new Error("chunk size must be positive");
  const chunks: T[][] = [];
  for (let i = 0; i < events.length; i += size) chunks.push(events.slice(i, i + size));
  return chunks;
}
