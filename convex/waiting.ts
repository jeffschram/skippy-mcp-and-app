import { mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { resolveWaitingReplies, type InboundMessage } from "@skippy/shared";
import { requireOwnedBrain } from "./auth";

/* ------------------------------------------------------------------ */
/* Waiting-on ledger                                                   */
/*                                                                     */
/* Entries clear themselves. A waiting list the owner has to groom      */
/* becomes another stale queue, which is worse than not having one.     */
/* ------------------------------------------------------------------ */

const entityRef = v.object({
  entityType: v.union(
    v.literal("goal"),
    v.literal("project"),
    v.literal("task"),
    v.literal("note"),
    v.literal("person"),
    v.literal("company"),
    v.literal("link"),
    v.literal("knowledgeObject"),
  ),
  entityId: v.string(),
});

/** Marks a task as blocked on someone, from the app or from a capture. */
export const setWaitingOn = mutationGeneric({
  args: {
    brainInstanceId: v.optional(v.id("brainInstances")),
    taskId: v.id("tasks"),
    waitingOn: v.union(entityRef, v.null()),
    waitingSince: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const brainInstanceId = args.brainInstanceId ?? (await requireOwnedBrain(ctx)).brain._id;
    const task = await ctx.db.get(args.taskId);
    if (!task || task.brainInstanceId !== brainInstanceId) {
      throw new Error("task not found for brain instance");
    }

    const now = Date.now();

    if (args.waitingOn === null) {
      await ctx.db.patch(task._id, {
        waitingOn: undefined,
        waitingSince: undefined,
        lastNudgedAt: undefined,
        status: task.status === "waiting" ? "todo" : task.status,
        updatedAt: now,
      });
      return { taskId: task._id, waiting: false };
    }

    await ctx.db.patch(task._id, {
      waitingOn: args.waitingOn,
      waitingSince: args.waitingSince ?? task.waitingSince ?? now,
      status: "waiting",
      updatedAt: now,
    });

    return { taskId: task._id, waiting: true };
  },
});

/**
 * Records a nudge.
 *
 * Drafts an outbound message through the existing approval flow and sends
 * nothing: Skippy must not touch source systems without separate approval, so
 * the pending action is left unsent for the owner to release.
 */
export const nudgeWaitingTask = mutationGeneric({
  args: {
    taskId: v.id("tasks"),
    messageBody: v.optional(v.string()),
    draftMessage: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.brainInstanceId !== brain._id) {
      throw new Error("task not found for brain instance");
    }

    const now = Date.now();
    await ctx.db.patch(task._id, { lastNudgedAt: now, updatedAt: now });

    let pendingActionId: string | undefined;
    if (args.draftMessage !== false && task.waitingOn) {
      pendingActionId = await ctx.db.insert("pendingActions", {
        brainInstanceId: brain._id,
        actionType: "waiting_nudge",
        // Never "sent" or "approved" from here — the owner releases it.
        status: "drafted",
        subject: `Following up: ${task.title}`,
        messageBody: args.messageBody,
        relatedEntities: [
          { entityType: "task", entityId: task._id },
          task.waitingOn,
        ],
        createdAt: now,
        updatedAt: now,
      });
    }

    return { taskId: task._id, lastNudgedAt: now, pendingActionId };
  },
});

/**
 * Clears waiting tasks whose blocking person has replied.
 *
 * Called by the capture/ingestion processor with whatever inbound traffic it
 * just read. Tasks are moved back into the normal lane with a note rather than
 * completed: the reply may not contain what was actually needed, and silently
 * closing work the owner still owes is the worse failure.
 */
export const resolveWaitingFromInbound = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    messages: v.array(
      v.object({
        sender: v.string(),
        receivedAt: v.number(),
        sourceSystem: v.optional(v.string()),
        excerpt: v.optional(v.string()),
      }),
    ),
    sourceRefIds: v.optional(v.array(v.id("sourceRefs"))),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();

    const tasks = await db
      .query("tasks")
      .withIndex("by_brain_status", (q: any) =>
        q.eq("brainInstanceId", args.brainInstanceId).eq("status", "waiting"),
      )
      .collect();

    if (tasks.length === 0) {
      return { resolved: 0, taskIds: [] };
    }

    const people = await db
      .query("people")
      .withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", args.brainInstanceId))
      .filter((q: any) => q.eq(q.field("processingState"), "accepted"))
      .collect();

    const resolutions = resolveWaitingReplies(
      tasks as any,
      people as any,
      args.messages as InboundMessage[],
    );

    for (const resolution of resolutions) {
      const task = tasks.find((row: any) => row._id === resolution.taskId);
      if (!task) continue;

      await db.patch(task._id, {
        status: "todo",
        waitingOn: undefined,
        waitingSince: undefined,
        lastNudgedAt: undefined,
        updatedAt: now,
      });

      await db.insert("activityEvents", {
        brainInstanceId: args.brainInstanceId,
        entityRef: { entityType: "task", entityId: task._id },
        activityType: "waiting_resolved",
        actorType: "system",
        timestamp: now,
        summary: `A reply arrived — "${task.title}" is no longer waiting.`,
        metadata: {
          personId: resolution.personId,
          sourceSystem: resolution.message.sourceSystem,
          excerpt: resolution.message.excerpt,
          receivedAt: resolution.message.receivedAt,
        },
        ...(args.sourceRefIds ? { sourceRefIds: args.sourceRefIds } : {}),
      });
    }

    return { resolved: resolutions.length, taskIds: resolutions.map((r) => r.taskId) };
  },
});
