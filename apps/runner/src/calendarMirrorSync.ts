/**
 * Mirrors the owner's Google calendar into Convex.
 *
 * Why this exists (2026-09): the propose -> approve -> execute pipeline had no
 * idea what was already on the calendar, so it booked "Jury duty" a second time
 * on Oct 27 and stacked "JetBlue 1023 — JFK → LAX" on top of the flight Gmail
 * had already added. The 409/eventId guard only stops Skippy re-running its own
 * proposal. Warning about a PRE-EXISTING event requires having read the
 * calendar, and `calendarEvents` — the table built for exactly that — had never
 * been populated by anything.
 *
 * Only this machine can do it. The OAuth token lives in ~/.config and never in
 * Convex (docs/connectors.md: "No credential storage in Convex"), so the read
 * has to happen on the mini and be pushed up over a host token.
 *
 * The read is library-only: `listEvents` is exported from @skippy/gcal-write-mcp
 * as a function, not as an MCP tool, so no harness can reach it. The
 * `calendar.events` scope already granted read, so nothing here widened consent.
 * The MCP surface remains create-only.
 */
import { listEvents, resolveCalendarId, type TokenSource } from "@skippy/gcal-write-mcp";
import {
  buildInitialRequest,
  chunkEvents,
  decidePage,
  nextPageRequest,
  type SyncRequest,
} from "./calendarMirrorSync-helpers.js";
import type { ControlPlane } from "./controlPlane.js";

export type CalendarMirrorLogger = (message: string, fields?: Record<string, unknown>) => void;

export type MirrorSyncPlane = Pick<
  ControlPlane,
  "getCalendarSyncToken" | "upsertCalendarEvents" | "recordCalendarSyncToken"
>;

export type MirrorSyncResult = {
  status: "completed" | "failed";
  calendarId: string;
  pages: number;
  events: number;
  inserted: number;
  updated: number;
  cancelled: number;
  skipped: number;
  /** True when a 410 forced us to drop the stored token and resync a window. */
  fullResync: boolean;
  error?: string;
};

/**
 * One incremental sync pass.
 *
 * Never throws: a mirror that crashes the runner's timer is worse than a mirror
 * that is briefly stale, and the caller only logs. Failures are reported both
 * in the return value and on the sourceSyncStatuses row so /review can show
 * that the mirror is not current.
 */
export async function runCalendarMirrorSyncOnce(
  plane: MirrorSyncPlane,
  deps: {
    tokens: TokenSource;
    fetchImpl?: typeof fetch;
    log?: CalendarMirrorLogger;
    calendarId?: string;
    now?: number;
  },
): Promise<MirrorSyncResult> {
  const log = deps.log ?? (() => {});
  const calendarId = resolveCalendarId(deps.calendarId);
  const now = deps.now ?? Date.now();

  const result: MirrorSyncResult = {
    status: "completed",
    calendarId,
    pages: 0,
    events: 0,
    inserted: 0,
    updated: 0,
    cancelled: 0,
    skipped: 0,
    fullResync: false,
  };

  // Declared before `fail` because `fail` reads it: reporting a failure must
  // not clobber a still-valid token.
  let storedToken: string | null = null;

  const fail = async (error: string): Promise<MirrorSyncResult> => {
    result.status = "failed";
    result.error = error;
    // Best-effort: record the failure without clobbering a still-good token —
    // passing the stored token back leaves incremental sync intact for the
    // next run, which matters when the failure was transient (a 5xx, a flaky
    // network) rather than a token problem.
    try {
      await plane.recordCalendarSyncToken(calendarId, storedToken, {
        status: "failed",
        message: error,
        errors: [error],
      });
    } catch (recordError) {
      log("calendar mirror status not recorded", { error: String(recordError) });
    }
    log("calendar mirror sync failed", { calendarId, error });
    return result;
  };

  try {
    storedToken = (await plane.getCalendarSyncToken(calendarId)).syncToken;
  } catch (error) {
    return fail(`could not read sync token: ${error instanceof Error ? error.message : String(error)}`);
  }

  let accessToken: string;
  try {
    accessToken = await deps.tokens.getAccessToken();
  } catch (error) {
    return fail(
      `Google credentials unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  let request: SyncRequest = buildInitialRequest({ now, syncToken: storedToken });

  while (true) {
    let outcome;
    try {
      outcome = await listEvents({ ...request, calendarId }, accessToken, fetchImpl);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }

    if (outcome.status === "ok") {
      result.pages += 1;
      result.events += outcome.events.length;
      for (const batch of chunkEvents(outcome.events)) {
        try {
          const counts = await plane.upsertCalendarEvents(calendarId, batch);
          result.inserted += counts.inserted;
          result.updated += counts.updated;
          result.cancelled += counts.cancelled;
          result.skipped += counts.skipped;
        } catch (error) {
          // Stop here rather than pressing on: continuing would let us persist
          // a syncToken that claims events we never actually stored.
          return fail(
            `mirror upsert failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    const decision = decidePage(outcome, {
      pagesFetched: result.pages,
      alreadyRestarted: result.fullResync,
    });

    if (decision.kind === "continue") {
      request = nextPageRequest(request, decision.pageToken);
      continue;
    }
    if (decision.kind === "restart_full") {
      // The token expired. Drop it and walk a bounded window from scratch;
      // upserts are keyed on (sourceSystem, externalId), so re-seeing every
      // event is a no-op rather than a duplicate.
      log("calendar sync token expired, falling back to a full resync", { calendarId });
      result.fullResync = true;
      request = buildInitialRequest({ now, syncToken: null });
      continue;
    }
    if (decision.kind === "fail") {
      return fail(decision.error);
    }

    // Done. A run that stopped early (page cap) reports no token, which leaves
    // the next run to redo the window instead of skipping past it.
    try {
      await plane.recordCalendarSyncToken(calendarId, decision.syncToken ?? null, {
        status: "completed",
        message: `mirrored ${result.events} event(s) across ${result.pages} page(s)`,
      });
    } catch (error) {
      return fail(
        `could not persist sync token: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    log("calendar mirror sync completed", {
      calendarId,
      pages: result.pages,
      events: result.events,
      inserted: result.inserted,
      updated: result.updated,
      cancelled: result.cancelled,
      ...(result.fullResync ? { fullResync: true } : {}),
    });
    return result;
  }
}
