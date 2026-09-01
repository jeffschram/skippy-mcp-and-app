/**
 * Executes calendar actions the owner approved in the web app.
 *
 * See docs/google-source.md → "Write path". The shape of this module is forced
 * by one constraint: Convex must never hold Google credentials, so the OAuth
 * token lives only on this machine. An approval tapped in the PWA therefore
 * cannot call Google directly — it has to travel to the mini, which is what
 * the runner's existing claim/poll loop already does for runs and chat turns.
 *
 * We link @skippy/gcal-write-mcp as a library rather than spawning its stdio
 * MCP server. The MCP wrapper exists so *harnesses* can create events; the
 * runner is not a harness and gains nothing from a JSON-RPC hop — it would
 * only add a subprocess, a protocol, and a failure mode between us and an
 * HTTP POST. Both paths share the same insert/auth code, so behavior cannot
 * drift between them.
 */
import {
  buildEventResource,
  configDir,
  createCredentialLoader,
  createDiskStore,
  createTokenSource,
  EventValidationError,
  insertEvent,
  resolveCalendarId,
  type CreateEventInput,
  type TokenSource,
} from "@skippy/gcal-write-mcp";
import type { ClaimedCalendarAction, ControlPlane } from "./controlPlane.js";

export type CalendarActionLogger = (message: string, fields?: Record<string, unknown>) => void;

/** Outcome we report back to Convex, mirroring recordCalendarActionResult. */
export type CalendarActionOutcome = {
  outcome: "created" | "conflict" | "failed";
  etag?: string | undefined;
  htmlLink?: string | undefined;
  error?: string | undefined;
};

/**
 * Translates a claimed action into the create-event input the Google layer
 * wants. Pure, so the mapping is testable without credentials or a network.
 *
 * The claimed `externalId` is passed through as `eventId` deliberately: it is
 * the whole idempotency story. Dropping it here would let a retry create a
 * second copy of the same event.
 */
export function toCreateEventInput(action: ClaimedCalendarAction): CreateEventInput {
  const input: CreateEventInput = {
    summary: action.summary,
    start: action.start,
    end: action.end,
    eventId: action.externalId,
    calendarId: resolveCalendarId(action.calendarId),
  };
  if (action.description !== undefined) input.description = action.description;
  if (action.location !== undefined) input.location = action.location;
  if (action.isAllDay) input.isAllDay = true;
  if (action.timeZone !== undefined) input.timeZone = action.timeZone;
  return input;
}

/**
 * Inserts one approved event and returns what to report.
 *
 * Every failure mode is converted into a `failed` outcome rather than thrown:
 * an action whose result is never reported stays leased and then silently
 * re-runs, which is precisely the "stranded work" failure this system already
 * fixed once for runs. A recorded failure shows up in /review with its error.
 */
export async function executeCalendarAction(
  action: ClaimedCalendarAction,
  deps: { tokens: TokenSource; fetchImpl?: typeof fetch },
): Promise<CalendarActionOutcome> {
  const input = toCreateEventInput(action);

  // insertEvent builds the resource itself; doing it here first turns a
  // malformed event into a clear local error before we spend a token refresh
  // and a round trip on an insert Google will always refuse.
  try {
    buildEventResource(input);
  } catch (error) {
    const reason = error instanceof EventValidationError ? error.message : String(error);
    return { outcome: "failed", error: `invalid event: ${reason}` };
  }

  let accessToken: string;
  try {
    accessToken = await deps.tokens.getAccessToken();
  } catch (error) {
    return {
      outcome: "failed",
      error: `Google credentials unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  try {
    const result = await insertEvent(input, accessToken, deps.fetchImpl ?? fetch);

    if (result.status === "created") {
      return {
        outcome: "created",
        etag: result.etag,
        htmlLink: result.htmlLink,
      };
    }
    if (result.status === "conflict") {
      // 409 means this id already exists — the success case for a retry.
      return { outcome: "conflict" };
    }
    return { outcome: "failed", error: result.error };
  } catch (error) {
    return {
      outcome: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Builds the token source once per process. Kept separate from execution so
 * tests can drive executeCalendarAction with a fake and never touch disk.
 */
export function createCalendarTokenSource(home: string, overrideDir?: string): TokenSource {
  const dir = configDir(home, overrideDir);
  return createTokenSource({
    store: createDiskStore(dir),
    credentials: createCredentialLoader(dir),
  });
}

/**
 * Claim-execute-report for a single action. Returns true when work was done,
 * so the caller can decide whether to poll again immediately.
 */
export async function runCalendarActionOnce(
  plane: Pick<ControlPlane, "claimNextCalendarAction" | "recordCalendarActionResult">,
  deps: { tokens: TokenSource; fetchImpl?: typeof fetch; log?: CalendarActionLogger },
): Promise<boolean> {
  const action = await plane.claimNextCalendarAction();
  if (!action) return false;

  const log = deps.log ?? (() => {});
  log("calendar action claimed", {
    pendingActionId: action.pendingActionId,
    externalId: action.externalId,
    summary: action.summary,
  });

  const result = await executeCalendarAction(action, deps);

  try {
    await plane.recordCalendarActionResult(action.pendingActionId, action.claimToken, result);
  } catch (error) {
    // Reporting failed, not the insert. The lease will expire and another poll
    // will retry; the minted id makes that safe.
    log("calendar action result not recorded", {
      pendingActionId: action.pendingActionId,
      outcome: result.outcome,
      error: String(error),
    });
    return true;
  }

  log("calendar action settled", {
    pendingActionId: action.pendingActionId,
    outcome: result.outcome,
    ...(result.error ? { error: result.error } : {}),
  });
  return true;
}
