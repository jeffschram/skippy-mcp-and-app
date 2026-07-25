import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { buildAgenda, effectiveCommitment } from "@skippy/shared";
import { requireOwnedBrain } from "./auth";

/* ------------------------------------------------------------------ */
/* Agenda                                                              */
/*                                                                     */
/* Reads the three time-bearing streams and hands them to the shared    */
/* merge, which owns the ordering and the de-duplication rules.        */
/* ------------------------------------------------------------------ */

/** Ids of tasks that belong to a project, so the agenda can stay life-focused. */
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

export const agendaForViewer = queryGeneric({
  args: {
    from: v.number(),
    to: v.number(),
    /** Project tasks are excluded by default; the agenda is about the day, not the roadmap. */
    includeProjectTasks: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const now = Date.now();

    const events = await ctx.db
      .query("calendarEvents")
      .withIndex("by_brain_start", (q: any) =>
        q.eq("brainInstanceId", brain._id).gte("startAt", args.from).lte("startAt", args.to),
      )
      .collect();

    // Due-date index rather than a full scan: this runs on every Home render.
    const dueTasks = await ctx.db
      .query("tasks")
      .withIndex("by_brain_due", (q: any) =>
        q.eq("brainInstanceId", brain._id).gte("dueAt", args.from).lte("dueAt", args.to),
      )
      .collect();

    const recurrences = await ctx.db
      .query("recurrences")
      .withIndex("by_brain_status", (q: any) =>
        q.eq("brainInstanceId", brain._id).eq("status", "active"),
      )
      .collect();

    // Every recurrence with a live task is needed by the merge — even one whose
    // task falls outside the window — or the recurrence would reappear as a
    // duplicate of a task the agenda simply is not showing.
    const recurrenceByTaskId = new Map<string, string>();
    for (const recurrence of recurrences) {
      if (recurrence.currentTaskId) {
        recurrenceByTaskId.set(recurrence.currentTaskId as string, recurrence._id as string);
      }
    }
    const claimedTasks = await Promise.all(
      [...recurrenceByTaskId.keys()].map((taskId) => ctx.db.get(taskId as any)),
    );

    const linkedToProject = args.includeProjectTasks
      ? new Set<string>()
      : await projectLinkedTaskIds(ctx.db, brain._id);

    const seenTaskIds = new Set<string>();
    const tasks: any[] = [];
    for (const task of [...dueTasks, ...claimedTasks]) {
      if (!task) continue;
      if (task.brainInstanceId !== brain._id) continue;
      const id = task._id as string;
      if (seenTaskIds.has(id)) continue;
      seenTaskIds.add(id);
      if (linkedToProject.has(id)) continue;

      tasks.push({
        _id: id,
        title: task.title,
        status: task.status,
        dueAt: task.dueAt,
        area: task.area,
        commitment: effectiveCommitment(task),
        recurrenceId: recurrenceByTaskId.get(id),
      });
    }

    return buildAgenda(
      {
        events,
        // Wants have no deadline and must never appear as something due today.
        tasks: tasks.filter((task) => task.commitment !== "want"),
        recurrences,
      },
      args.from,
      args.to,
      now,
    );
  },
});
