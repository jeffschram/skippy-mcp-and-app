import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { effectiveCommitment } from "@skippy/shared";
import { requireOwnedBrain } from "./auth";

/* ------------------------------------------------------------------ */
/* Life tasks                                                          */
/*                                                                     */
/* Tasks with no project. These were always legal — project linkage is  */
/* a belongs_to row in `relationships`, not a column — but until now    */
/* they had nowhere to live and no way to be classified.               */
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

const taskCommitment = v.union(v.literal("must"), v.literal("want"));

/** Ids of every task that belongs to a project, so they can be excluded. */
async function projectLinkedTaskIds(db: any, brainInstanceId: any): Promise<Set<string>> {
  const relationships = await db
    .query("relationships")
    .withIndex("by_brain_type", (q: any) => q.eq("brainInstanceId", brainInstanceId))
    .filter((q: any) => q.eq(q.field("type"), "belongs_to"))
    .collect();

  const ids = new Set<string>();
  for (const relationship of relationships) {
    if (relationship.from?.entityType === "task" && relationship.to?.entityType === "project") {
      ids.add(relationship.from.entityId as string);
    }
  }
  return ids;
}

/**
 * Every open life task, plus the recurrence linkage the agenda needs to avoid
 * showing an obligation twice.
 *
 * Lane bucketing is left to the client helper so it stays pure and testable;
 * this returns the raw material with `commitment` resolved through
 * effectiveCommitment, since absent means "must" and the UI must not have to
 * remember that.
 */
export const lifeTasksForViewer = queryGeneric({
  args: { includeCompleted: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brain._id))
      .filter((q: any) => q.eq(q.field("processingState"), "accepted"))
      .collect();

    const linked = await projectLinkedTaskIds(ctx.db, brain._id);

    // Tasks spawned by a recurrence are tagged so the agenda can show the
    // obligation once rather than as both a task and a firing recurrence.
    const recurrences = await ctx.db
      .query("recurrences")
      .withIndex("by_brain_status", (q: any) =>
        q.eq("brainInstanceId", brain._id).eq("status", "active"),
      )
      .collect();
    const recurrenceByTaskId = new Map<string, string>();
    for (const recurrence of recurrences) {
      if (recurrence.currentTaskId) {
        recurrenceByTaskId.set(recurrence.currentTaskId as string, recurrence._id as string);
      }
    }

    return tasks
      .filter((task: any) => !linked.has(task._id as string))
      .filter((task: any) =>
        args.includeCompleted ? true : task.status !== "done" && task.status !== "cancelled",
      )
      .map((task: any) => ({
        _id: task._id,
        title: task.title,
        description: task.description,
        status: task.status,
        area: task.area,
        commitment: effectiveCommitment(task),
        dueAt: task.dueAt,
        waitingOn: task.waitingOn,
        waitingSince: task.waitingSince,
        lastNudgedAt: task.lastNudgedAt,
        completedAt: task.completedAt,
        recurrenceId: recurrenceByTaskId.get(task._id as string),
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      }));
  },
});

export const createLifeTask = mutationGeneric({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    area: v.optional(taskArea),
    commitment: v.optional(taskCommitment),
    dueAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const now = Date.now();
    const title = args.title.trim();
    if (!title) {
      throw new Error("title is required");
    }

    // No belongs_to relationship is written, which is exactly what makes this a
    // life task rather than a project task.
    const taskId = await ctx.db.insert("tasks", {
      brainInstanceId: brain._id,
      title,
      description: args.description,
      processingState: "accepted",
      status: "todo",
      ownerType: "owner",
      area: args.area,
      commitment: args.commitment ?? "must",
      dueAt: args.dueAt,
      createdAt: now,
      updatedAt: now,
    });

    return { taskId };
  },
});

/**
 * Single-gesture state change from the task list. Completion is reversible from
 * the UI via an undo toast, so this deliberately does not confirm anything.
 */
export const setLifeTaskStatus = mutationGeneric({
  args: {
    taskId: v.id("tasks"),
    status: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("waiting"),
      v.literal("done"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.brainInstanceId !== brain._id) {
      throw new Error("task not found for brain instance");
    }

    const now = Date.now();
    await ctx.db.patch(task._id, {
      status: args.status,
      completedAt: args.status === "done" ? now : undefined,
      updatedAt: now,
    });

    return { taskId: task._id, status: args.status };
  },
});

export const updateLifeTask = mutationGeneric({
  args: {
    taskId: v.id("tasks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    area: v.optional(taskArea),
    commitment: v.optional(taskCommitment),
    dueAt: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.brainInstanceId !== brain._id) {
      throw new Error("task not found for brain instance");
    }

    await ctx.db.patch(task._id, {
      ...(args.title !== undefined ? { title: args.title.trim() } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
      ...(args.area !== undefined ? { area: args.area } : {}),
      ...(args.commitment !== undefined ? { commitment: args.commitment } : {}),
      // null clears the due date; undefined leaves it alone.
      ...(args.dueAt !== undefined ? { dueAt: args.dueAt ?? undefined } : {}),
      updatedAt: Date.now(),
    });

    return { taskId: task._id };
  },
});
