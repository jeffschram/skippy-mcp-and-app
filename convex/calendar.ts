import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import {
  GOOGLE_CALENDAR_SOURCE_SYSTEM,
  isValidGoogleEventId,
  mintGoogleEventId,
  normalizeGoogleEvent,
  planCalendarEventWrite,
} from "@skippy/shared";
import { requireOwnedBrain } from "./auth";
import { makeToken, requireHost } from "./agentWorkbench";

/* ------------------------------------------------------------------ */
/* Calendar mirror                                                     */
/*                                                                     */
/* Google is the source of truth. This module keeps a local mirror so   */
/* Skippy has a persisted sense of time, and owns the echo-safe write   */
/* path for events Skippy itself creates.                              */
/*                                                                     */
/* Calendar deliberately bypasses ingestObject/triageItems: that path   */
/* is for noisy prose sources and dedupes on fuzzy title similarity,    */
/* which would collapse a weekly 1:1 into a single row. Everything here */
/* matches on identity via `by_brain_external`.                        */
/* ------------------------------------------------------------------ */

function syncStatusKey(calendarId: string): string {
  return `${GOOGLE_CALENDAR_SOURCE_SYSTEM}:${calendarId}`;
}

async function findByExternalId(
  db: any,
  brainInstanceId: any,
  sourceSystem: string,
  externalId: string,
) {
  return db
    .query("calendarEvents")
    .withIndex("by_brain_external", (q: any) =>
      q
        .eq("brainInstanceId", brainInstanceId)
        .eq("sourceSystem", sourceSystem)
        .eq("externalId", externalId),
    )
    .first();
}

/* ------------------------------------------------------------------ */
/* Read path: Google -> mirror                                         */
/* ------------------------------------------------------------------ */

/**
 * Upserts a batch of raw Google events.
 *
 * Idempotent: every event resolves against an indexed lookup on
 * (sourceSystem, externalId), so replaying the same batch changes nothing.
 * Deliberately NOT the `take(300)` + `find()` scan that
 * findAcceptedEntityDuplicate uses — that is both slow and, for calendar,
 * semantically wrong.
 */
export const upsertCalendarEvents = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    calendarId: v.string(),
    sourceSystem: v.optional(v.string()),
    events: v.array(v.any()),
    now: v.optional(v.number()),
  },
  handler: async ({ db }, args) => {
    const now = args.now ?? Date.now();
    const sourceSystem = args.sourceSystem ?? GOOGLE_CALENDAR_SOURCE_SYSTEM;

    let inserted = 0;
    let updated = 0;
    let echoes = 0;
    let cancelled = 0;
    let skipped = 0;

    for (const raw of args.events) {
      const incoming = normalizeGoogleEvent(raw, args.calendarId, sourceSystem);
      if (!incoming) {
        skipped += 1;
        continue;
      }

      const existing = await findByExternalId(db, args.brainInstanceId, sourceSystem, incoming.externalId);
      const plan = planCalendarEventWrite(existing, incoming, now);

      if (plan.action === "insert") {
        await db.insert("calendarEvents", { ...plan.doc, brainInstanceId: args.brainInstanceId });
        inserted += 1;
      } else {
        await db.patch(existing._id, plan.patch);
        updated += 1;
        // An echo is Skippy seeing its own write come back. It settles the row
        // and is deliberately silent: no activity event, no notification, no
        // rubric — it is not new information.
        if (plan.isEcho) echoes += 1;
      }

      if (incoming.status === "cancelled") cancelled += 1;
    }

    return { inserted, updated, echoes, cancelled, skipped };
  },
});

/** Reads the stored incremental sync token for a calendar, if any. */
export const getCalendarSyncToken = queryGeneric({
  args: { brainInstanceId: v.id("brainInstances"), calendarId: v.string() },
  handler: async ({ db }, args) => {
    const row = await db
      .query("sourceSyncStatuses")
      .withIndex("by_brain_key", (q: any) =>
        q.eq("brainInstanceId", args.brainInstanceId).eq("statusKey", syncStatusKey(args.calendarId)),
      )
      .first();

    return { syncToken: (row?.metadata?.syncToken as string | undefined) ?? null };
  },
});

/**
 * Persists the token returned at the end of a sync run.
 *
 * Pass `syncToken: null` when Google answers 410 Gone — the token expired and
 * the caller must fall back to a bounded full resync before storing a fresh one.
 */
export const recordCalendarSyncToken = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    calendarId: v.string(),
    syncToken: v.union(v.string(), v.null()),
    status: v.optional(v.union(v.literal("completed"), v.literal("failed"))),
    message: v.optional(v.string()),
    errors: v.optional(v.array(v.string())),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    const statusKey = syncStatusKey(args.calendarId);
    const existing = await db
      .query("sourceSyncStatuses")
      .withIndex("by_brain_key", (q: any) =>
        q.eq("brainInstanceId", args.brainInstanceId).eq("statusKey", statusKey),
      )
      .first();

    const fields = {
      harness: "calendar-mirror",
      status: args.status ?? "completed",
      sourceSystemsChecked: ["calendar"],
      message: args.message,
      errors: args.errors,
      completedAt: now,
      lastHeartbeatAt: now,
      metadata: { ...(existing?.metadata ?? {}), syncToken: args.syncToken ?? undefined },
      updatedAt: now,
    };

    if (existing) {
      await db.patch(existing._id, fields);
      return { statusKey, updated: true };
    }

    await db.insert("sourceSyncStatuses", {
      brainInstanceId: args.brainInstanceId,
      statusKey,
      ...fields,
      createdAt: now,
    });
    return { statusKey, updated: false };
  },
});

/* ------------------------------------------------------------------ */
/* Write path: Skippy -> Google                                        */
/* ------------------------------------------------------------------ */

/**
 * Stages an event Skippy wants to create in Google.
 *
 * The ordering here is the echo-loop defense and must not be rearranged:
 * mint the id, write the local mirror row, THEN hand the insert to an executor.
 * Writing locally first means a crash between the two leaves a row the next
 * ingest recognizes, rather than an orphan it duplicates. Retries are safe
 * because Google answers 409 Conflict for a known id — "already created", not
 * "create another".
 *
 * Convex never calls Google. The harness executes the pending action and
 * reports back through recordCalendarEventRemoteResult.
 */
export const draftCalendarEvent = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    calendarId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    isAllDay: v.optional(v.boolean()),
    timeZone: v.optional(v.string()),
    relatedEntityRefs: v.optional(v.array(v.any())),
    requireApproval: v.optional(v.boolean()),
    eventId: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();

    if (args.endAt < args.startAt) {
      throw new Error("endAt cannot precede startAt");
    }

    const externalId = args.eventId ?? mintGoogleEventId();
    if (!isValidGoogleEventId(externalId)) {
      // Google rejects anything outside base32hex at insert time; failing here
      // turns a confusing remote error into a clear local one.
      throw new Error(`invalid Google event id: ${externalId}`);
    }

    const duplicate = await findByExternalId(
      db,
      args.brainInstanceId,
      GOOGLE_CALENDAR_SOURCE_SYSTEM,
      externalId,
    );
    if (duplicate) {
      return { status: "already_staged", calendarEventId: duplicate._id, externalId };
    }

    const calendarEventId = await db.insert("calendarEvents", {
      brainInstanceId: args.brainInstanceId,
      sourceSystem: GOOGLE_CALENDAR_SOURCE_SYSTEM,
      calendarId: args.calendarId,
      externalId,
      origin: "skippy",
      remoteState: "pending_remote",
      title: args.title,
      description: args.description,
      location: args.location,
      startAt: args.startAt,
      endAt: args.endAt,
      isAllDay: args.isAllDay,
      timeZone: args.timeZone,
      status: "confirmed",
      relatedEntityRefs: args.relatedEntityRefs,
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const pendingActionId = await db.insert("pendingActions", {
      brainInstanceId: args.brainInstanceId,
      actionType: "calendar_event_create",
      status: args.requireApproval === false ? "approved" : "pending_approval",
      subject: args.title,
      body: JSON.stringify({
        calendarId: args.calendarId,
        eventId: externalId,
        summary: args.title,
        description: args.description,
        location: args.location,
        start: args.startAt,
        end: args.endAt,
        isAllDay: args.isAllDay ?? false,
        timeZone: args.timeZone,
      }),
      executionProvider: "google_calendar",
      // The minted id travels with the action so the executor inserts with it
      // rather than letting Google allocate one.
      externalMessageId: externalId,
      createdAt: now,
      updatedAt: now,
    });

    return { status: "staged", calendarEventId, pendingActionId, externalId };
  },
});

/**
 * Settles a staged event after the harness has talked to Google.
 *
 * `conflict` is success, not failure: a 409 means the id already exists, which
 * is exactly what a retry after a partial failure looks like.
 */
export const recordCalendarEventRemoteResult = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    externalId: v.string(),
    outcome: v.union(v.literal("created"), v.literal("conflict"), v.literal("failed")),
    etag: v.optional(v.string()),
    htmlLink: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    const row = await findByExternalId(
      db,
      args.brainInstanceId,
      GOOGLE_CALENDAR_SOURCE_SYSTEM,
      args.externalId,
    );
    if (!row) {
      throw new Error("calendar event not found for external id");
    }

    const succeeded = args.outcome === "created" || args.outcome === "conflict";

    await db.patch(row._id, {
      remoteState: succeeded ? "synced" : "remote_failed",
      remoteError: succeeded ? undefined : (args.error ?? "google insert failed"),
      etag: args.etag ?? row.etag,
      htmlLink: args.htmlLink ?? row.htmlLink,
      lastSyncedAt: now,
      updatedAt: now,
    });

    return { calendarEventId: row._id, remoteState: succeeded ? "synced" : "remote_failed" };
  },
});

/* ------------------------------------------------------------------ */
/* Execution: runner claims approved actions and reports back           */
/*                                                                     */
/* Convex never calls Google — the OAuth token lives only on the mini   */
/* (docs/connectors.md: "No credential storage in Convex"). So an       */
/* approval in the web app has to travel to the runner, which is what   */
/* these two host-token functions are for. The runner already polls     */
/* every couple of seconds for runs and chat turns; approved calendar   */
/* actions are a third claim type on that same loop.                    */
/* ------------------------------------------------------------------ */

/** Matches RUN_LEASE_MS. A Google insert takes ~1s; the slack covers token
 * refresh and a retry without stranding the action for long if we die. */
const CALENDAR_ACTION_LEASE_MS = 150_000;

/**
 * Atomic claim for the oldest approved calendar action belonging to this host's
 * brain.
 *
 * Re-claiming an expired lease is deliberate and safe here, which is not true
 * of runs: the event id was minted at draft time and travels on the action, so
 * a second insert of the same id gets 409 Conflict — recorded as success. The
 * risk of a stuck action outweighs the risk of a duplicate attempt.
 */
export const claimNextCalendarAction = mutationGeneric({
  args: { hostToken: v.string() },
  handler: async (ctx, { hostToken }) => {
    const host = await requireHost(ctx, hostToken);
    if (host.draining) return null;
    const now = Date.now();

    const approved = await ctx.db
      .query("pendingActions")
      .withIndex("by_brain_status", (q: any) =>
        q.eq("brainInstanceId", host.brainInstanceId).eq("status", "approved"),
      )
      .collect();

    approved.sort((a: any, b: any) => a.createdAt - b.createdAt);

    for (const action of approved) {
      if (action.actionType !== "calendar_event_create") continue;
      // Someone else holds a live lease on this one.
      if (action.leaseExpiresAt && action.leaseExpiresAt > now) continue;

      let payload: any;
      try {
        payload = JSON.parse(action.body ?? "{}");
      } catch {
        // A body we cannot parse will never execute; fail it now with a clear
        // reason rather than silently skipping it on every poll forever.
        await ctx.db.patch(action._id, {
          status: "failed",
          error: "calendar action body is not valid JSON",
          updatedAt: now,
        });
        continue;
      }

      const externalId = action.externalMessageId ?? payload.eventId;
      if (!externalId) {
        await ctx.db.patch(action._id, {
          status: "failed",
          error: "calendar action is missing its minted event id",
          updatedAt: now,
        });
        continue;
      }

      const claimToken = makeToken("skippyclaim");
      await ctx.db.patch(action._id, {
        hostId: host._id,
        claimToken,
        claimedAt: now,
        leaseExpiresAt: now + CALENDAR_ACTION_LEASE_MS,
        updatedAt: now,
      });
      await ctx.db.patch(host._id, { lastClaimAt: now, updatedAt: now });

      return {
        pendingActionId: action._id,
        claimToken,
        externalId,
        calendarId: payload.calendarId ?? "primary",
        summary: payload.summary ?? action.subject ?? "(untitled)",
        description: payload.description,
        location: payload.location,
        start: payload.start,
        end: payload.end,
        isAllDay: payload.isAllDay ?? false,
        timeZone: payload.timeZone,
      };
    }

    return null;
  },
});

/**
 * Settles a claimed calendar action after the runner has talked to Google,
 * updating the pending action and the mirror row together so the two cannot
 * disagree.
 *
 * A failure lands the action in `failed` with the Google error attached rather
 * than retrying forever: the /review Actions tab already renders `failed` as
 * re-reviewable, so a bad event surfaces to the owner instead of hammering
 * Google with an insert it will keep rejecting.
 */
export const recordCalendarActionResult = mutationGeneric({
  args: {
    hostToken: v.string(),
    pendingActionId: v.id("pendingActions"),
    claimToken: v.string(),
    outcome: v.union(v.literal("created"), v.literal("conflict"), v.literal("failed")),
    etag: v.optional(v.string()),
    htmlLink: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    const action = await ctx.db.get(args.pendingActionId);
    if (!action) throw new Error("pending action not found");
    if (action.brainInstanceId !== host.brainInstanceId) {
      throw new Error("pending action belongs to another brain");
    }
    // Stale claim: another lease superseded this one, so its result is not
    // authoritative. Dropping it is safe because the winner reports too.
    if (!action.claimToken || action.claimToken !== args.claimToken) {
      return { status: "stale_claim" as const };
    }

    const now = Date.now();
    const succeeded = args.outcome === "created" || args.outcome === "conflict";

    await ctx.db.patch(action._id, {
      status: succeeded ? "completed" : "failed",
      error: succeeded ? undefined : (args.error ?? "google insert failed"),
      executedAt: now,
      externalMessageId: action.externalMessageId,
      claimToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });

    const externalId = action.externalMessageId;
    let calendarEventId: any = null;
    if (externalId) {
      const row = await findByExternalId(
        ctx.db,
        host.brainInstanceId,
        GOOGLE_CALENDAR_SOURCE_SYSTEM,
        externalId,
      );
      if (row) {
        await ctx.db.patch(row._id, {
          remoteState: succeeded ? "synced" : "remote_failed",
          remoteError: succeeded ? undefined : (args.error ?? "google insert failed"),
          etag: args.etag ?? row.etag,
          htmlLink: args.htmlLink ?? row.htmlLink,
          lastSyncedAt: now,
          updatedAt: now,
        });
        calendarEventId = row._id;
      }
    }

    return {
      status: succeeded ? ("completed" as const) : ("failed" as const),
      calendarEventId,
      htmlLink: args.htmlLink,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export const calendarEventsInRange = queryGeneric({
  args: {
    from: v.number(),
    to: v.number(),
    includeCancelled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    if (!brain) return [];

    const rows = await ctx.db
      .query("calendarEvents")
      .withIndex("by_brain_start", (q: any) =>
        q.eq("brainInstanceId", brain._id).gte("startAt", args.from).lte("startAt", args.to),
      )
      .collect();

    return args.includeCancelled ? rows : rows.filter((row: any) => row.status !== "cancelled");
  },
});
