import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import {
  appendCompletion,
  computeNextDue,
  isDueNow,
  nextCalendarOccurrence,
  parseRRule,
  surfacesAt,
  DEFAULT_RECURRENCE_TIME_ZONE,
  type RecurrenceLike,
} from "@skippy/shared";
import { requireOwnedBrain } from "./auth";

/* ------------------------------------------------------------------ */
/* Recurring life obligations                                          */
/*                                                                     */
/* All scheduling math lives in @skippy/shared so it can be tested      */
/* without a database; this module is the storage and task-spawning     */
/* layer around it.                                                     */
/* ------------------------------------------------------------------ */

const taskArea = v.union(
  v.literal("work"),
  v.literal("personal"),
  v.literal("household"),
  v.literal("health"),
  v.literal("finance"),
  v.literal("social"),
  v.literal("errand"),
);

const recurrenceRule = v.union(
  v.object({ kind: v.literal("interval"), everyDays: v.number() }),
  v.object({ kind: v.literal("calendar"), rrule: v.string() }),
);

const recurrenceAnchor = v.union(v.literal("completion"), v.literal("schedule"));
const recurrenceStatus = v.union(v.literal("active"), v.literal("paused"), v.literal("retired"));

/** Shape the shared scheduling helpers expect, projected off a stored row. */
function schedulingView(recurrence: any): RecurrenceLike {
  return {
    rule: recurrence.rule,
    anchor: recurrence.anchor,
    nextDueAt: recurrence.nextDueAt,
    lastCompletedAt: recurrence.lastCompletedAt,
    leadTimeDays: recurrence.leadTimeDays,
    timeZone: recurrence.timeZone,
    status: recurrence.status,
  };
}

function validateRule(rule: any) {
  if (rule.kind === "interval") {
    if (!Number.isInteger(rule.everyDays) || rule.everyDays < 1) {
      throw new Error("interval recurrences need a whole everyDays of at least 1");
    }
    return;
  }
  // Throws with a specific message for anything outside the supported subset.
  parseRRule(rule.rrule);
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export const upsertRecurrence = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    recurrenceId: v.optional(v.id("recurrences")),
    title: v.string(),
    description: v.optional(v.string()),
    area: v.optional(taskArea),
    rule: recurrenceRule,
    anchor: recurrenceAnchor,
    startAt: v.optional(v.number()),
    leadTimeDays: v.optional(v.number()),
    status: v.optional(recurrenceStatus),
    spawnTask: v.optional(v.boolean()),
    timeZone: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    validateRule(args.rule);

    const timeZone = args.timeZone ?? DEFAULT_RECURRENCE_TIME_ZONE;
    const existing = args.recurrenceId ? await db.get(args.recurrenceId) : null;
    if (args.recurrenceId && (!existing || existing.brainInstanceId !== args.brainInstanceId)) {
      throw new Error("recurrence not found for brain instance");
    }

    // A rule change has to re-seed the schedule, or the stored nextDueAt would
    // no longer sit on the new cadence.
    const seed = args.startAt ?? existing?.nextDueAt ?? now;
    const nextDueAt =
      args.rule.kind === "calendar"
        ? nextCalendarOccurrence(args.rule.rrule, seed - 1, timeZone, seed)
        : seed;

    if (existing) {
      await db.patch(existing._id, {
        title: args.title,
        description: args.description,
        area: args.area,
        rule: args.rule,
        anchor: args.anchor,
        nextDueAt,
        leadTimeDays: args.leadTimeDays,
        status: args.status ?? existing.status,
        spawnTask: args.spawnTask ?? existing.spawnTask,
        timeZone,
        updatedAt: now,
      });
      return { status: "updated", recurrenceId: existing._id, nextDueAt };
    }

    const recurrenceId = await db.insert("recurrences", {
      brainInstanceId: args.brainInstanceId,
      title: args.title,
      description: args.description,
      area: args.area,
      rule: args.rule,
      anchor: args.anchor,
      nextDueAt,
      leadTimeDays: args.leadTimeDays,
      status: args.status ?? "active",
      spawnTask: args.spawnTask ?? true,
      timeZone,
      createdAt: now,
      updatedAt: now,
    });

    return { status: "created", recurrenceId, nextDueAt };
  },
});

/**
 * Materializes tasks for every active recurrence that has reached its surfacing
 * moment.
 *
 * Idempotent by construction: a recurrence holding a live `currentTaskId` is
 * skipped, so running this on every heartbeat cannot pile up duplicates.
 */
export const fireDueRecurrences = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    now: v.optional(v.number()),
  },
  handler: async ({ db }, args) => {
    const now = args.now ?? Date.now();

    const candidates = await db
      .query("recurrences")
      .withIndex("by_brain_status", (q: any) =>
        q.eq("brainInstanceId", args.brainInstanceId).eq("status", "active"),
      )
      .collect();

    const spawnedTaskIds: string[] = [];

    for (const recurrence of candidates) {
      if (!isDueNow(schedulingView(recurrence), now)) continue;
      if (!recurrence.spawnTask) continue;

      // Skip if a previously spawned task is still open. A cancelled or done
      // task releases the slot even if completeRecurrence never ran.
      if (recurrence.currentTaskId) {
        const openTask = await db.get(recurrence.currentTaskId);
        if (openTask && openTask.status !== "done" && openTask.status !== "cancelled") {
          continue;
        }
      }

      const taskId = await db.insert("tasks", {
        brainInstanceId: args.brainInstanceId,
        title: recurrence.title,
        description: recurrence.description,
        processingState: "accepted",
        status: "todo",
        ownerType: "owner",
        commitment: "must",
        area: recurrence.area,
        dueAt: recurrence.nextDueAt,
        reviewReason: `Spawned from the "${recurrence.title}" recurrence.`,
        createdAt: now,
        updatedAt: now,
      });

      // The task-to-recurrence link is `currentTaskId`, not a `relationships`
      // row: relationships only reference entityType members, and `recurrence`
      // is deliberately not one (it is scheduling state, not knowledge).
      await db.patch(recurrence._id, { currentTaskId: taskId, updatedAt: now });

      await db.insert("activityEvents", {
        brainInstanceId: args.brainInstanceId,
        entityRef: { entityType: "task", entityId: taskId },
        activityType: "recurrence_fired",
        actorType: "system",
        timestamp: now,
        summary: `"${recurrence.title}" came due.`,
        metadata: { recurrenceId: recurrence._id, dueAt: recurrence.nextDueAt },
      });

      spawnedTaskIds.push(taskId);
    }

    return { spawned: spawnedTaskIds.length, taskIds: spawnedTaskIds };
  },
});

/**
 * Logs a completion and advances the schedule.
 *
 * `completedAt` is accepted so the owner can backdate ("I did this last
 * Tuesday"). For completion-anchored recurrences that genuinely moves the next
 * due date, which is the whole point of the anchor.
 */
export const completeRecurrence = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    recurrenceId: v.id("recurrences"),
    completedAt: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    const recurrence = await db.get(args.recurrenceId);
    if (!recurrence || recurrence.brainInstanceId !== args.brainInstanceId) {
      throw new Error("recurrence not found for brain instance");
    }

    const completedAt = args.completedAt ?? now;
    const nextDueAt = computeNextDue(schedulingView(recurrence), completedAt, now);

    if (recurrence.currentTaskId) {
      const task = await db.get(recurrence.currentTaskId);
      if (task && task.status !== "done" && task.status !== "cancelled") {
        await db.patch(task._id, { status: "done", completedAt, updatedAt: now });
      }
    }

    await db.patch(recurrence._id, {
      lastCompletedAt: completedAt,
      nextDueAt,
      currentTaskId: undefined,
      history: appendCompletion(recurrence.history, { completedAt, note: args.note }),
      updatedAt: now,
    });

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      activityType: "recurrence_completed",
      actorType: "user",
      timestamp: now,
      summary: `Completed "${recurrence.title}".`,
      metadata: { recurrenceId: recurrence._id, completedAt, nextDueAt },
    });

    return { recurrenceId: recurrence._id, completedAt, nextDueAt };
  },
});

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export const recurrencesForViewer = queryGeneric({
  args: { includeRetired: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);

    const rows = await ctx.db
      .query("recurrences")
      .withIndex("by_brain_next_due", (q: any) => q.eq("brainInstanceId", brain._id))
      .collect();

    const now = Date.now();
    return rows
      .filter((row: any) => (args.includeRetired ? true : row.status !== "retired"))
      .map((row: any) => ({
        ...row,
        surfacesAt: surfacesAt(schedulingView(row)),
        isDue: isDueNow(schedulingView(row), now),
      }))
      .sort((a: any, b: any) => a.nextDueAt - b.nextDueAt);
  },
});

/* ------------------------------------------------------------------ */
/* Viewer-scoped wrappers                                              */
/*                                                                     */
/* The mutations above take an explicit brainInstanceId because the MCP */
/* surface calls them. The app is authenticated, so these resolve the   */
/* brain from the session instead of trusting a client-supplied id.     */
/* ------------------------------------------------------------------ */

export const upsertRecurrenceForViewer = mutationGeneric({
  args: {
    recurrenceId: v.optional(v.id("recurrences")),
    title: v.string(),
    description: v.optional(v.string()),
    area: v.optional(taskArea),
    rule: recurrenceRule,
    anchor: recurrenceAnchor,
    startAt: v.optional(v.number()),
    leadTimeDays: v.optional(v.number()),
    status: v.optional(recurrenceStatus),
    spawnTask: v.optional(v.boolean()),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const now = Date.now();
    validateRule(args.rule);

    const title = args.title.trim();
    if (!title) {
      throw new Error("title is required");
    }

    const timeZone = args.timeZone ?? DEFAULT_RECURRENCE_TIME_ZONE;
    const existing = args.recurrenceId ? await ctx.db.get(args.recurrenceId) : null;
    if (args.recurrenceId && (!existing || existing.brainInstanceId !== brain._id)) {
      throw new Error("recurrence not found for brain instance");
    }

    const seed = args.startAt ?? existing?.nextDueAt ?? now;
    const nextDueAt =
      args.rule.kind === "calendar"
        ? nextCalendarOccurrence(args.rule.rrule, seed - 1, timeZone, seed)
        : seed;

    if (existing) {
      await ctx.db.patch(existing._id, {
        title,
        description: args.description,
        area: args.area,
        rule: args.rule,
        anchor: args.anchor,
        nextDueAt,
        leadTimeDays: args.leadTimeDays,
        status: args.status ?? existing.status,
        spawnTask: args.spawnTask ?? existing.spawnTask,
        timeZone,
        updatedAt: now,
      });
      return { status: "updated", recurrenceId: existing._id, nextDueAt };
    }

    const recurrenceId = await ctx.db.insert("recurrences", {
      brainInstanceId: brain._id,
      title,
      description: args.description,
      area: args.area,
      rule: args.rule,
      anchor: args.anchor,
      nextDueAt,
      leadTimeDays: args.leadTimeDays,
      status: args.status ?? "active",
      spawnTask: args.spawnTask ?? true,
      timeZone,
      createdAt: now,
      updatedAt: now,
    });

    return { status: "created", recurrenceId, nextDueAt };
  },
});

export const completeRecurrenceForViewer = mutationGeneric({
  args: {
    recurrenceId: v.id("recurrences"),
    completedAt: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const now = Date.now();
    const recurrence = await ctx.db.get(args.recurrenceId);
    if (!recurrence || recurrence.brainInstanceId !== brain._id) {
      throw new Error("recurrence not found for brain instance");
    }

    const completedAt = args.completedAt ?? now;
    const nextDueAt = computeNextDue(schedulingView(recurrence), completedAt, now);

    if (recurrence.currentTaskId) {
      const task = await ctx.db.get(recurrence.currentTaskId);
      if (task && task.status !== "done" && task.status !== "cancelled") {
        await ctx.db.patch(task._id, { status: "done", completedAt, updatedAt: now });
      }
    }

    await ctx.db.patch(recurrence._id, {
      lastCompletedAt: completedAt,
      nextDueAt,
      currentTaskId: undefined,
      history: appendCompletion(recurrence.history, { completedAt, note: args.note }),
      updatedAt: now,
    });

    return { recurrenceId: recurrence._id, completedAt, nextDueAt };
  },
});

export const setRecurrenceStatusForViewer = mutationGeneric({
  args: { recurrenceId: v.id("recurrences"), status: recurrenceStatus },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const recurrence = await ctx.db.get(args.recurrenceId);
    if (!recurrence || recurrence.brainInstanceId !== brain._id) {
      throw new Error("recurrence not found for brain instance");
    }

    await ctx.db.patch(recurrence._id, { status: args.status, updatedAt: Date.now() });
    return { recurrenceId: recurrence._id, status: args.status };
  },
});
