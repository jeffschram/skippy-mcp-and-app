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
