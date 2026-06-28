import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireOwnedBrain } from "./auth";
import { advanceDependentsAfterDone, dependencyTaskIds } from "./taskExecution";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

async function projectTaskIds(db: any, brainInstanceId: any, projectId: string): Promise<string[]> {
  const rels = await db
    .query("relationships")
    .withIndex("by_brain_type", (q: any) => q.eq("brainInstanceId", brainInstanceId))
    .filter((q: any) => q.eq(q.field("type"), "belongs_to"))
    .collect();
  return rels
    .filter(
      (rel: any) =>
        rel.from.entityType === "task" && rel.to.entityType === "project" && rel.to.entityId === projectId,
    )
    .map((rel: any) => rel.from.entityId as string);
}

function executionStateFor(task: any): string {
  if (task.executionState) return task.executionState;
  // Derive a sensible state for tasks created before the planning lifecycle existed.
  if (task.status === "done") return "done";
  if (task.status === "in_progress") return "in_progress";
  if (task.resultRecordedAt) return "in_review";
  return "ready";
}

async function buildBoard(db: any, brainInstanceId: any, projectId: string) {
  const project = await db.get(projectId);
  if (!project || project.brainInstanceId !== brainInstanceId) {
    return null;
  }

  const taskIds = await projectTaskIds(db, brainInstanceId, projectId);
  const rawTasks = [];
  for (const taskId of taskIds) {
    const task = await db.get(taskId);
    if (task && task.processingState === "accepted") rawTasks.push(task);
  }

  const tasks = [];
  for (const task of rawTasks) {
    const dependsOn = await dependencyTaskIds(db, brainInstanceId, task._id);
    tasks.push({
      _id: task._id,
      title: task.title,
      description: task.description,
      status: task.status,
      kind: task.kind,
      executionState: executionStateFor(task),
      executionBrief: task.executionBrief,
      acceptanceCriteria: task.acceptanceCriteria,
      orderIndex: task.orderIndex ?? 0,
      ownerType: task.ownerType,
      dueAt: task.dueAt,
      resultSummary: task.resultSummary,
      resultUrl: task.resultUrl,
      startedBy: task.startedBy,
      dependsOn,
      updatedAt: task.updatedAt,
    });
  }
  tasks.sort((a, b) => a.orderIndex - b.orderIndex);

  const total = tasks.length;
  const done = tasks.filter((task) => task.executionState === "done" || task.status === "done").length;

  const plans = await db
    .query("projectPlans")
    .withIndex("by_brain_project", (q: any) =>
      q.eq("brainInstanceId", brainInstanceId).eq("projectId", projectId),
    )
    .collect();
  plans.sort((a: any, b: any) => b.createdAt - a.createdAt);
  const latestPlan = plans[0];

  return {
    project: {
      _id: project._id,
      title: project.title,
      summary: project.summary,
      status: project.status,
    },
    tasks,
    progress: {
      total,
      done,
      percent: total ? Math.round((done / total) * 100) : 0,
      ready: tasks.filter((task) => task.executionState === "ready").length,
      blocked: tasks.filter((task) => task.executionState === "blocked").length,
      inReview: tasks.filter((task) => task.executionState === "in_review").length,
    },
    latestPlan: latestPlan
      ? {
          _id: latestPlan._id,
          summary: latestPlan.summary,
          planVersion: latestPlan.planVersion,
          provider: latestPlan.provider,
          model: latestPlan.model,
          taskCount: latestPlan.taskCount,
          createdAt: latestPlan.createdAt,
        }
      : null,
  };
}

async function readyTasks(db: any, brainInstanceId: any, limit: number) {
  const tasks = (
    await db
      .query("tasks")
      .withIndex("by_brain_execution_state", (q: any) =>
        q.eq("brainInstanceId", brainInstanceId).eq("executionState", "ready"),
      )
      .collect()
  ).filter((task: any) => task.processingState === "accepted" && task.status !== "done" && task.status !== "cancelled");

  // Attach the owning project title for context.
  const result = [];
  for (const task of tasks) {
    const belongs = await db
      .query("relationships")
      .withIndex("by_brain_type", (q: any) => q.eq("brainInstanceId", brainInstanceId))
      .filter((q: any) => q.eq(q.field("type"), "belongs_to"))
      .filter((q: any) => q.eq(q.field("from.entityType"), "task"))
      .filter((q: any) => q.eq(q.field("from.entityId"), task._id))
      .first();
    let projectTitle: string | undefined;
    let projectId: string | undefined;
    if (belongs && belongs.to.entityType === "project") {
      const project = await db.get(belongs.to.entityId);
      projectTitle = project?.title;
      projectId = belongs.to.entityId;
    }
    result.push({
      _id: task._id,
      title: task.title,
      description: task.description,
      kind: task.kind,
      executionBrief: task.executionBrief,
      acceptanceCriteria: task.acceptanceCriteria,
      orderIndex: task.orderIndex ?? 0,
      projectId,
      projectTitle,
    });
  }
  result.sort((a, b) => a.orderIndex - b.orderIndex);
  return result.slice(0, limit);
}

async function taskBrief(db: any, brainInstanceId: any, taskId: string) {
  const task = await db.get(taskId);
  if (!task || task.brainInstanceId !== brainInstanceId) return null;

  const dependsOn = await dependencyTaskIds(db, brainInstanceId, taskId);
  const dependencies = [];
  for (const depId of dependsOn) {
    const dep = await db.get(depId);
    if (dep) dependencies.push({ _id: dep._id, title: dep.title, status: dep.status, done: dep.status === "done" });
  }

  const belongs = await db
    .query("relationships")
    .withIndex("by_brain_type", (q: any) => q.eq("brainInstanceId", brainInstanceId))
    .filter((q: any) => q.eq(q.field("type"), "belongs_to"))
    .filter((q: any) => q.eq(q.field("from.entityType"), "task"))
    .filter((q: any) => q.eq(q.field("from.entityId"), taskId))
    .first();
  let project = null;
  if (belongs && belongs.to.entityType === "project") {
    const projectDoc = await db.get(belongs.to.entityId);
    if (projectDoc) project = { _id: projectDoc._id, title: projectDoc.title, summary: projectDoc.summary };
  }

  return {
    _id: task._id,
    title: task.title,
    description: task.description,
    kind: task.kind,
    status: task.status,
    executionState: executionStateFor(task),
    executionBrief: task.executionBrief,
    acceptanceCriteria: task.acceptanceCriteria,
    resultSummary: task.resultSummary,
    resultUrl: task.resultUrl,
    project,
    dependencies,
    dependenciesMet: dependencies.every((dep) => dep.done),
  };
}

async function applyTaskResult(
  db: any,
  brainInstanceId: any,
  args: { taskId: string; resultSummary?: string; resultUrl?: string; markDone?: boolean },
  actor: { actorType: string; actorId?: string },
) {
  const task = await db.get(args.taskId);
  if (!task || task.brainInstanceId !== brainInstanceId) {
    throw new Error("task not found for brain instance");
  }
  const now = Date.now();
  const patch: Record<string, unknown> = {
    resultSummary: args.resultSummary?.trim() || task.resultSummary,
    resultUrl: args.resultUrl?.trim() || task.resultUrl,
    resultRecordedAt: now,
    updatedAt: now,
  };
  let promoted: string[] = [];
  if (args.markDone) {
    patch.status = "done";
    patch.completedAt = now;
    patch.executionState = "done";
  } else {
    patch.executionState = "in_review";
  }
  await db.patch(args.taskId, patch);

  if (args.markDone) {
    promoted = await advanceDependentsAfterDone(db, brainInstanceId, args.taskId, now);
  }

  await db.insert("activityEvents", {
    brainInstanceId,
    entityRef: { entityType: "task", entityId: args.taskId },
    activityType: args.markDone ? "agent_task_result_done" : "agent_task_result_recorded",
    actorType: actor.actorType,
    actorId: actor.actorId,
    timestamp: now,
    summary: `${args.markDone ? "Completed" : "Submitted for review"}: ${task.title}`,
    metadata: { resultUrl: args.resultUrl, promoted },
  });

  return { taskId: args.taskId, executionState: patch.executionState, promotedTaskIds: promoted };
}

/* ------------------------------------------------------------------ */
/* Viewer-facing (Clerk auth)                                         */
/* ------------------------------------------------------------------ */

export const projectBoardForViewer = queryGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    return buildBoard(ctx.db, brain._id, args.projectId);
  },
});

export const readyTasksForViewer = queryGeneric({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    return readyTasks(ctx.db, brain._id, args.limit ?? 12);
  },
});

export const getTaskBriefForViewer = queryGeneric({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    return taskBrief(ctx.db, brain._id, args.taskId);
  },
});

export const recordTaskResultForViewer = mutationGeneric({
  args: {
    taskId: v.id("tasks"),
    resultSummary: v.optional(v.string()),
    resultUrl: v.optional(v.string()),
    markDone: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    return applyTaskResult(
      ctx.db,
      brain._id,
      {
        taskId: args.taskId,
        ...(args.resultSummary !== undefined ? { resultSummary: args.resultSummary } : {}),
        ...(args.resultUrl !== undefined ? { resultUrl: args.resultUrl } : {}),
        ...(args.markDone !== undefined ? { markDone: args.markDone } : {}),
      },
      { actorType: "user", actorId: user._id },
    );
  },
});

export const projectPlansForViewer = queryGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const plans = await ctx.db
      .query("projectPlans")
      .withIndex("by_brain_project", (q: any) =>
        q.eq("brainInstanceId", brain._id).eq("projectId", args.projectId),
      )
      .collect();
    plans.sort((a: any, b: any) => b.createdAt - a.createdAt);
    return plans;
  },
});

/* ------------------------------------------------------------------ */
/* Brain-facing (MCP token routing)                                   */
/* ------------------------------------------------------------------ */

export const readyTasksForBrain = queryGeneric({
  args: { brainInstanceId: v.id("brainInstances"), limit: v.optional(v.number()) },
  handler: async ({ db }, args) => {
    return readyTasks(db, args.brainInstanceId, args.limit ?? 12);
  },
});

export const getTaskBriefForBrain = queryGeneric({
  args: { brainInstanceId: v.id("brainInstances"), taskId: v.id("tasks") },
  handler: async ({ db }, args) => {
    return taskBrief(db, args.brainInstanceId, args.taskId);
  },
});

export const recordTaskResultForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    taskId: v.id("tasks"),
    resultSummary: v.optional(v.string()),
    resultUrl: v.optional(v.string()),
    markDone: v.optional(v.boolean()),
    actorId: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    return applyTaskResult(
      db,
      args.brainInstanceId,
      {
        taskId: args.taskId,
        ...(args.resultSummary !== undefined ? { resultSummary: args.resultSummary } : {}),
        ...(args.resultUrl !== undefined ? { resultUrl: args.resultUrl } : {}),
        ...(args.markDone !== undefined ? { markDone: args.markDone } : {}),
      },
      { actorType: "harness", ...(args.actorId ? { actorId: args.actorId } : {}) },
    );
  },
});
