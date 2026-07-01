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
  const config = await db
    .query("brainConfigs")
    .withIndex("by_brain", (q: any) => q.eq("brainInstanceId", brainInstanceId))
    .first();

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
      agentRequestStatus: task.agentRequestStatus,
      requestedHarness: task.requestedHarness,
      agentRequestedAt: task.agentRequestedAt,
      agentRequestedBy: task.agentRequestedBy,
      agentRequestMessage: task.agentRequestMessage,
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
      kind: project.kind ?? "general",
      repoUrl: project.repoUrl,
      localPath: project.localPath,
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
    agentName: config?.assistantDisplayName ?? "Agent",
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
      .withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brainInstanceId))
      .filter((q: any) => q.eq(q.field("processingState"), "accepted"))
      .collect()
  ).filter(
    (task: any) =>
      task.ownerType === "agent" &&
      executionStateFor(task) === "ready" &&
      task.status !== "done" &&
      task.status !== "cancelled",
  );

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
      ownerType: task.ownerType,
      executionState: executionStateFor(task),
      agentRequestStatus: task.agentRequestStatus,
      requestedHarness: task.requestedHarness,
      agentRequestedAt: task.agentRequestedAt,
      agentRequestedBy: task.agentRequestedBy,
      agentRequestMessage: task.agentRequestMessage,
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

async function requestedReadyTasks(db: any, brainInstanceId: any, limit: number) {
  const tasks = await readyTasks(db, brainInstanceId, Math.max(limit * 4, 50));
  return tasks.filter((task) => task.agentRequestStatus === "requested").slice(0, limit);
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
    agentRequestStatus: task.agentRequestStatus,
    requestedHarness: task.requestedHarness,
    agentRequestedAt: task.agentRequestedAt,
    agentRequestedBy: task.agentRequestedBy,
    agentRequestMessage: task.agentRequestMessage,
    executionBrief: task.executionBrief,
    acceptanceCriteria: task.acceptanceCriteria,
    resultSummary: task.resultSummary,
    resultUrl: task.resultUrl,
    project,
    dependencies,
    dependenciesMet: dependencies.every((dep) => dep.done),
  };
}

/**
 * Move a task to a different project by replacing its `belongs_to` project edge.
 * Removes any existing belongs_to(task -> project) relationships, then links the task
 * to the target project. Idempotent if the task already belongs only to the target.
 */
async function moveTaskToProject(
  db: any,
  brainInstanceId: any,
  taskId: string,
  toProjectId: string,
  now: number,
  actor: { actorType: string; actorId?: string },
) {
  const task = await db.get(taskId);
  if (!task || task.brainInstanceId !== brainInstanceId) {
    throw new Error("task not found for brain instance");
  }
  const toProject = await db.get(toProjectId);
  if (!toProject || toProject.brainInstanceId !== brainInstanceId) {
    throw new Error("target project not found for brain instance");
  }

  const existing = await db
    .query("relationships")
    .withIndex("by_brain_type", (q: any) => q.eq("brainInstanceId", brainInstanceId))
    .filter((q: any) => q.eq(q.field("type"), "belongs_to"))
    .filter((q: any) => q.eq(q.field("from.entityType"), "task"))
    .filter((q: any) => q.eq(q.field("from.entityId"), taskId))
    .collect();

  let fromProjectId: string | undefined;
  for (const rel of existing) {
    if (rel.to.entityType === "project") {
      if (rel.to.entityId === toProjectId) {
        // Already linked to the target; nothing to remove for this edge.
        continue;
      }
      fromProjectId = rel.to.entityId;
      await db.delete(rel._id);
    }
  }

  const alreadyLinked = existing.some(
    (rel: any) => rel.to.entityType === "project" && rel.to.entityId === toProjectId,
  );
  let relationshipId = existing.find(
    (rel: any) => rel.to.entityType === "project" && rel.to.entityId === toProjectId,
  )?._id;

  if (!alreadyLinked) {
    relationshipId = await db.insert("relationships", {
      brainInstanceId,
      from: { entityType: "task", entityId: taskId },
      to: { entityType: "project", entityId: toProjectId },
      type: "belongs_to",
      confidence: 1,
      reason: "Task moved to this project.",
      createdBy: actor.actorType === "user" ? "user" : "harness",
      createdAt: now,
      updatedAt: now,
    });
  }

  await db.patch(taskId, { updatedAt: now });

  await db.insert("activityEvents", {
    brainInstanceId,
    entityRef: { entityType: "task", entityId: taskId },
    activityType: "task_moved_project",
    actorType: actor.actorType,
    actorId: actor.actorId,
    timestamp: now,
    summary: `Moved task to ${toProject.title}: ${task.title}`,
    metadata: { fromProjectId, toProjectId, relationshipId },
  });

  return { taskId, fromProjectId, toProjectId, relationshipId };
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
    agentRequestStatus: undefined,
    requestedHarness: undefined,
    agentRequestMessage: undefined,
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
    const { user, brain } = await requireOwnedBrain(ctx);
    const board = await buildBoard(ctx.db, brain._id, args.projectId);
    return board ? { ...board, ownerName: user.displayName ?? "Owner" } : null;
  },
});

export const readyTasksForViewer = queryGeneric({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    return readyTasks(ctx.db, brain._id, args.limit ?? 12);
  },
});

export const activeProjectsForViewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brain._id))
      .filter((q: any) => q.eq(q.field("processingState"), "accepted"))
      .collect();
    return projects
      .filter((project: any) => !["completed", "cancelled", "archived"].includes(project.status))
      .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .map((project: any) => ({
        _id: project._id,
        title: project.title,
        status: project.status,
        kind: project.kind,
      }));
  },
});

export const archivedProjectsForViewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brain._id))
      .filter((q: any) => q.eq(q.field("processingState"), "accepted"))
      .collect();
    return projects
      .filter((project: any) => project.status === "archived")
      .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .map((project: any) => ({
        _id: project._id,
        title: project.title,
        summary: project.summary,
        status: project.status,
        kind: project.kind,
        updatedAt: project.updatedAt,
      }));
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

export const moveTaskToProjectForViewer = mutationGeneric({
  args: { taskId: v.id("tasks"), toProjectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    return moveTaskToProject(ctx.db, brain._id, args.taskId, args.toProjectId, Date.now(), {
      actorType: "user",
      actorId: user._id,
    });
  },
});

export const moveTasksToProjectForViewer = mutationGeneric({
  args: { taskIds: v.array(v.id("tasks")), toProjectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const now = Date.now();
    const moved = [];
    for (const taskId of args.taskIds) {
      moved.push(
        await moveTaskToProject(ctx.db, brain._id, taskId, args.toProjectId, now, {
          actorType: "user",
          actorId: user._id,
        }),
      );
    }
    return { movedCount: moved.length, moved };
  },
});

const executionStateValidator = v.union(
  v.literal("proposed"),
  v.literal("unplanned"),
  v.literal("briefed"),
  v.literal("ready"),
  v.literal("in_progress"),
  v.literal("in_review"),
  v.literal("blocked"),
  v.literal("done"),
);

const taskKindValidator = v.union(
  v.literal("coding"),
  v.literal("review"),
  v.literal("research"),
  v.literal("design"),
  v.literal("manual"),
  v.literal("planning"),
);

function provisionalTitleFromProposal(proposalText: string): string {
  const firstLine = proposalText
    .replace(/[#*_`>[\]()]/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "Untitled proposal";
  return firstLine.length > 72 ? `${firstLine.slice(0, 69).trim()}...` : firstLine;
}

export const createTaskProposalForViewer = mutationGeneric({
  args: {
    projectId: v.id("projects"),
    title: v.optional(v.string()),
    proposalText: v.string(),
    kind: v.optional(taskKindValidator),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.brainInstanceId !== brain._id) {
      throw new Error("project not found");
    }
    const proposalText = args.proposalText.trim();
    if (!proposalText) throw new Error("proposal cannot be empty");
    const title = args.title?.trim() || provisionalTitleFromProposal(proposalText);

    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", {
      brainInstanceId: brain._id,
      title,
      description: proposalText,
      status: "todo",
      ownerType: "agent",
      processingState: "accepted",
      kind: args.kind ?? "coding",
      executionState: "proposed",
      orderIndex: now,
      createdAt: now,
      updatedAt: now,
    });

    const relationshipId = await ctx.db.insert("relationships", {
      brainInstanceId: brain._id,
      from: { entityType: "task", entityId: taskId },
      to: { entityType: "project", entityId: args.projectId },
      type: "belongs_to",
      confidence: 1,
      reason: "Task proposal created from the project board.",
      createdBy: "user",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      entityRef: { entityType: "task", entityId: taskId },
      activityType: "task_proposed",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Task proposed: ${title}`,
      metadata: { projectId: args.projectId, relationshipId },
    });

    return { taskId, relationshipId, executionState: "proposed" };
  },
});

export const updateProjectForViewer = mutationGeneric({
  args: {
    projectId: v.id("projects"),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("idea"),
        v.literal("planned"),
        v.literal("in_progress"),
        v.literal("paused"),
        v.literal("completed"),
        v.literal("cancelled"),
        v.literal("archived"),
      ),
    ),
    kind: v.optional(v.union(v.literal("code"), v.literal("general"))),
    repoUrl: v.optional(v.string()),
    localPath: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.brainInstanceId !== brain._id) {
      throw new Error("project not found");
    }
    const now = Date.now();
    const patch: Record<string, unknown> = { updatedAt: now };
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) throw new Error("project title cannot be empty");
      patch.title = title;
    }
    if (args.summary !== undefined) patch.summary = args.summary.trim() || undefined;
    if (args.status !== undefined) patch.status = args.status;
    if (args.kind !== undefined) patch.kind = args.kind;
    if (args.repoUrl !== undefined) patch.repoUrl = args.repoUrl.trim() || undefined;
    if (args.localPath !== undefined) patch.localPath = args.localPath.trim() || undefined;
    await ctx.db.patch(args.projectId, patch);
    return { projectId: args.projectId, status: "updated" };
  },
});

export const updateTaskBriefForViewer = mutationGeneric({
  args: {
    taskId: v.id("tasks"),
    executionBrief: v.optional(v.string()),
    acceptanceCriteria: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.brainInstanceId !== brain._id) {
      throw new Error("task not found");
    }
    const now = Date.now();
    const patch: Record<string, unknown> = { updatedAt: now };
    if (args.executionBrief !== undefined) patch.executionBrief = args.executionBrief.trim() || undefined;
    if (args.description !== undefined) patch.description = args.description.trim() || undefined;
    if (args.acceptanceCriteria !== undefined) {
      const criteria = args.acceptanceCriteria.map((c) => c.trim()).filter(Boolean);
      patch.acceptanceCriteria = criteria.length ? criteria : undefined;
    }
    await ctx.db.patch(args.taskId, patch);
    return { taskId: args.taskId, status: "updated" };
  },
});

export const requestAgentForTaskForViewer = mutationGeneric({
  args: {
    taskId: v.id("tasks"),
    requestedHarness: v.optional(v.string()),
    agentRequestMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.brainInstanceId !== brain._id) {
      throw new Error("task not found");
    }
    if (task.processingState !== "accepted") {
      throw new Error("only accepted tasks can be requested for agent work");
    }
    if (task.ownerType !== "agent") {
      throw new Error("only agent-owned tasks can be requested for agent work");
    }
    if (executionStateFor(task) !== "ready") {
      throw new Error("only ready tasks can be requested for agent work");
    }
    if (task.status === "done" || task.status === "cancelled") {
      throw new Error("done or cancelled tasks cannot be requested");
    }

    const now = Date.now();
    const config = await ctx.db
      .query("brainConfigs")
      .withIndex("by_brain", (q: any) => q.eq("brainInstanceId", brain._id))
      .first();
    const requestedHarness = args.requestedHarness?.trim() || config?.assistantDisplayName || brain.displayName;
    const patch = {
      executionState: "ready",
      agentRequestStatus: "requested",
      requestedHarness,
      agentRequestedAt: task.agentRequestedAt ?? now,
      agentRequestedBy: user.displayName ?? user.email,
      agentRequestMessage: args.agentRequestMessage?.trim() || undefined,
      updatedAt: now,
    };
    await ctx.db.patch(args.taskId, patch);

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      entityRef: { entityType: "task", entityId: args.taskId },
      activityType: task.agentRequestStatus === "requested" ? "agent_task_request_refreshed" : "agent_task_requested",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Agent requested for task: ${task.title}`,
      metadata: { requestedHarness, agentRequestMessage: patch.agentRequestMessage },
    });

    return { taskId: args.taskId, agentRequestStatus: "requested", requestedHarness };
  },
});

export const setTaskExecutionStateForViewer = mutationGeneric({
  args: { taskId: v.id("tasks"), executionState: executionStateValidator },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.brainInstanceId !== brain._id) {
      throw new Error("task not found");
    }
    const now = Date.now();
    const patch: Record<string, unknown> = { executionState: args.executionState, updatedAt: now };
    // Keep the user-facing status roughly in sync with the lifecycle.
    if (args.executionState === "in_progress") patch.status = "in_progress";
    else if (args.executionState === "done") {
      patch.status = "done";
      patch.completedAt = now;
    } else if (["proposed", "unplanned", "briefed", "ready", "blocked"].includes(args.executionState) && task.status === "in_progress") {
      patch.status = "todo";
    }
    await ctx.db.patch(args.taskId, patch);

    if (args.executionState === "done") {
      await advanceDependentsAfterDone(ctx.db, brain._id, args.taskId, now);
    }

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      entityRef: { entityType: "task", entityId: args.taskId },
      activityType: "task_execution_state_changed",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Task moved to ${args.executionState}: ${task.title}`,
    });

    return { taskId: args.taskId, executionState: args.executionState };
  },
});

/* ------------------------------------------------------------------ */
/* Viewer context (what page the user has open)                       */
/* ------------------------------------------------------------------ */

export const setViewerContext = mutationGeneric({
  args: {
    activeRoute: v.optional(v.string()),
    activeProjectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("viewerContext")
      .withIndex("by_brain", (q: any) => q.eq("brainInstanceId", brain._id))
      .first();
    const fields = {
      brainInstanceId: brain._id,
      userId: user._id,
      activeRoute: args.activeRoute,
      activeProjectId: args.activeProjectId,
      activeEntityRef: args.activeProjectId
        ? { entityType: "project" as const, entityId: args.activeProjectId as string }
        : undefined,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return { status: "updated" };
    }
    await ctx.db.insert("viewerContext", fields);
    return { status: "created" };
  },
});

async function currentContext(db: any, brainInstanceId: any) {
  const context = await db
    .query("viewerContext")
    .withIndex("by_brain", (q: any) => q.eq("brainInstanceId", brainInstanceId))
    .first();
  if (!context) return null;
  let activeProject = null;
  if (context.activeProjectId) {
    const project = await db.get(context.activeProjectId);
    if (project && project.brainInstanceId === brainInstanceId) {
      activeProject = { _id: project._id, title: project.title, kind: project.kind, repoUrl: project.repoUrl };
    }
  }
  return {
    activeRoute: context.activeRoute ?? null,
    activeProject,
    updatedAt: context.updatedAt,
  };
}

export const getViewerContext = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    return currentContext(ctx.db, brain._id);
  },
});

export const currentContextForBrain = queryGeneric({
  args: { brainInstanceId: v.id("brainInstances") },
  handler: async ({ db }, args) => {
    return currentContext(db, args.brainInstanceId);
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

export const projectBoardForBrain = queryGeneric({
  args: { brainInstanceId: v.id("brainInstances"), projectId: v.id("projects") },
  handler: async ({ db }, args) => {
    return buildBoard(db, args.brainInstanceId, args.projectId);
  },
});

export const moveTasksToProjectForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    taskIds: v.array(v.id("tasks")),
    toProjectId: v.id("projects"),
    actorId: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    const moved = [];
    for (const taskId of args.taskIds) {
      moved.push(
        await moveTaskToProject(db, args.brainInstanceId, taskId, args.toProjectId, now, {
          actorType: "harness",
          ...(args.actorId ? { actorId: args.actorId } : {}),
        }),
      );
    }
    return { movedCount: moved.length, moved };
  },
});

export const readyTasksForBrain = queryGeneric({
  args: { brainInstanceId: v.id("brainInstances"), limit: v.optional(v.number()) },
  handler: async ({ db }, args) => {
    return readyTasks(db, args.brainInstanceId, args.limit ?? 12);
  },
});

export const requestedReadyTasksForBrain = queryGeneric({
  args: { brainInstanceId: v.id("brainInstances"), limit: v.optional(v.number()) },
  handler: async ({ db }, args) => {
    return requestedReadyTasks(db, args.brainInstanceId, args.limit ?? 12);
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

export const setTaskKindForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    taskId: v.id("tasks"),
    kind: taskKindValidator,
    actorId: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const task = await db.get(args.taskId);
    if (!task || task.brainInstanceId !== args.brainInstanceId) {
      throw new Error("task not found for brain instance");
    }
    const now = Date.now();
    await db.patch(args.taskId, { kind: args.kind, updatedAt: now });
    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      entityRef: { entityType: "task", entityId: args.taskId },
      activityType: "task_kind_changed",
      actorType: "harness",
      actorId: args.actorId,
      timestamp: now,
      summary: `Task kind set to ${args.kind}: ${task.title}`,
    });
    return { taskId: args.taskId, kind: args.kind };
  },
});
