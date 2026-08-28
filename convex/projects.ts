import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { effectiveProjectPaths, normalizeFolderPathInput, orderIndexBetween } from "@skippy/shared";
import { requireOwnedBrain } from "./auth";
import {
  advanceDependentsAfterDone,
  dependencyTaskIds,
  dependencyTaskIdsByTask,
} from "./taskExecution";
import { phaseAppendOrderIndex } from "./taskOrder";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

async function projectTaskIds(db: any, brainInstanceId: any, projectId: string): Promise<string[]> {
  const rels = await db
    .query("relationships")
    .withIndex("by_brain_type", (q: any) => q.eq("brainInstanceId", brainInstanceId).eq("type", "belongs_to"))
    .collect();
  return rels
    .filter(
      (rel: any) =>
        rel.from.entityType === "task" && rel.to.entityType === "project" && rel.to.entityId === projectId,
    )
    .map((rel: any) => rel.from.entityId as string);
}

/**
 * Assets (inputs) and output (artifacts) folders, derived lazily at read time:
 * an unset override falls back to `${localPath}/_library` / `${localPath}/_output`,
 * so defaults automatically track localPath edits. Use this everywhere a
 * project payload leaves Convex.
 */
function effectivePaths(project: {
  localPath?: string;
  assetsFolderPath?: string;
  outputFolderPath?: string;
}) {
  return effectiveProjectPaths(project);
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

  // Dependencies for every task in ONE read. Querying per task is
  // O(tasks x relationships) and breaches Convex's 32k document-read limit
  // once a project gets large enough — which is what took this board down.
  const dependsOnByTask = await dependencyTaskIdsByTask(db, brainInstanceId);

  const tasks: any[] = [];
  for (const task of rawTasks) {
    const dependsOn = dependsOnByTask.get(task._id as string) ?? [];
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
      phaseId: task.phaseId,
      ownerType: task.ownerType,
      agentRequestStatus: task.agentRequestStatus,
      requestedHarness: task.requestedHarness,
      agentRequestedAt: task.agentRequestedAt,
      agentRequestedBy: task.agentRequestedBy,
      agentRequestMessage: task.agentRequestMessage,
      dueAt: task.dueAt,
      gitBranchName: task.gitBranchName,
      prUrl: task.prUrl,
      prNumber: task.prNumber,
      prStatus: task.prStatus,
      lastPrCreatedAt: task.lastPrCreatedAt,
      resultSummary: task.resultSummary,
      resultUrl: task.resultUrl,
      // Timestamp for the "in review" chat moment: when the run's result
      // landed, not when the task was last touched.
      resultRecordedAt: task.resultRecordedAt,
      startedAt: task.startedAt,
      startedBy: task.startedBy,
      completedAt: task.completedAt,
      dependsOn,
      updatedAt: task.updatedAt,
    });
  }
  tasks.sort((a, b) => a.orderIndex - b.orderIndex);

  // Cancelled (abandoned) tasks stay in the returned tasks array so the UI can
  // render them, but they never count toward progress.
  const active = tasks.filter((task) => task.executionState !== "cancelled");
  const total = active.length;
  const done = active.filter((task) => task.executionState === "done" || task.status === "done").length;

  const plans = await db
    .query("projectPlans")
    .withIndex("by_brain_project", (q: any) =>
      q.eq("brainInstanceId", brainInstanceId).eq("projectId", projectId),
    )
    .collect();
  plans.sort((a: any, b: any) => b.createdAt - a.createdAt);
  const latestPlan = plans[0];

  const phases = await db
    .query("phases")
    .withIndex("by_brain_project", (q: any) =>
      q.eq("brainInstanceId", brainInstanceId).eq("projectId", projectId),
    )
    .collect();
  phases.sort((a: any, b: any) => a.orderNum - b.orderNum);

  return {
    project: {
      _id: project._id,
      title: project.title,
      summary: project.summary,
      // Freeform Notes-tab pad. Empty string (not undefined) so the pad
      // textarea always has a stable controlled value.
      notesPad: project.notesPad ?? "",
      status: project.status,
      kind: project.kind ?? "general",
      repoUrl: project.repoUrl,
      vercelUrl: project.vercelUrl,
      liveUrl: project.liveUrl,
      defaultBaseBranch: project.defaultBaseBranch,
      defaultTaskModel: project.defaultTaskModel,
      localPath: project.localPath,
      assetsFolderPath: project.assetsFolderPath,
      outputFolderPath: project.outputFolderPath,
      ...effectivePaths(project),
    },
    tasks,
    phases: phases.map((phase: any) => ({
      _id: phase._id,
      orderNum: phase.orderNum,
      title: phase.title,
      descriptionMd: phase.descriptionMd,
      taskIds: tasks.filter((task) => task.phaseId === phase._id).map((task) => task._id),
    })),
    progress: {
      total,
      done,
      percent: total ? Math.round((done / total) * 100) : 0,
      ready: active.filter((task) => task.executionState === "ready").length,
      blocked: active.filter((task) => task.executionState === "blocked").length,
      inReview: active.filter((task) => task.executionState === "in_review").length,
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

/**
 * Owning project for every task in ONE indexed read, plus one db.get per
 * distinct project. Looking the edge up per task is O(tasks x relationships)
 * and is exactly the shape that breached Convex's 32k document-read limit on
 * the board — see dependencyTaskIdsByTask for the same fix.
 */
async function projectByTaskId(
  db: any,
  brainInstanceId: any,
): Promise<Map<string, { projectId: string; projectTitle: string | undefined }>> {
  const rels = await db
    .query("relationships")
    .withIndex("by_brain_type", (q: any) => q.eq("brainInstanceId", brainInstanceId).eq("type", "belongs_to"))
    .collect();

  const titles = new Map<string, string | undefined>();
  const byTask = new Map<string, { projectId: string; projectTitle: string | undefined }>();
  for (const rel of rels) {
    if (rel.from.entityType !== "task" || rel.to.entityType !== "project") continue;
    const taskId = rel.from.entityId as string;
    if (byTask.has(taskId)) continue;
    const projectId = rel.to.entityId as string;
    if (!titles.has(projectId)) {
      const project = await db.get(projectId);
      titles.set(projectId, project?.title);
    }
    byTask.set(taskId, { projectId, projectTitle: titles.get(projectId) });
  }
  return byTask;
}

function queueEntryFor(
  task: any,
  owner: { projectId: string; projectTitle: string | undefined } | undefined,
) {
  return {
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
    projectId: owner?.projectId,
    projectTitle: owner?.projectTitle,
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
  const owners = await projectByTaskId(db, brainInstanceId);
  const result = tasks.map((task: any) => queueEntryFor(task, owners.get(task._id as string)));
  result.sort((a: any, b: any) => a.orderIndex - b.orderIndex);
  return result.slice(0, limit);
}

async function requestedReadyTasks(db: any, brainInstanceId: any, limit: number) {
  const tasks = await readyTasks(db, brainInstanceId, Math.max(limit * 4, 50));
  return tasks.filter((task: any) => task.agentRequestStatus === "requested").slice(0, limit);
}

/**
 * Every accepted task in a given execution state — the general form of
 * readyTasks, so a harness can see what is in_progress, in_review, blocked, or
 * done without holding a private copy of the lifecycle. Unlike readyTasks this
 * does NOT assume agent ownership: pass ownerType to narrow.
 *
 * Dependency readiness is not re-derived here; executionState is read as
 * stored (with the legacy fallback in executionStateFor), which is what makes
 * "show me everything sitting in in_review" answerable.
 */
async function tasksByState(
  db: any,
  brainInstanceId: any,
  input: {
    executionState: string;
    ownerType?: string;
    projectId?: string;
    agentRequestStatus?: string;
    limit: number;
  },
) {
  const tasks = (
    await db
      .query("tasks")
      .withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brainInstanceId))
      .filter((q: any) => q.eq(q.field("processingState"), "accepted"))
      .collect()
  ).filter(
    (task: any) =>
      executionStateFor(task) === input.executionState &&
      (!input.ownerType || task.ownerType === input.ownerType) &&
      (!input.agentRequestStatus || task.agentRequestStatus === input.agentRequestStatus),
  );

  const owners = await projectByTaskId(db, brainInstanceId);
  const result = tasks
    .map((task: any) => queueEntryFor(task, owners.get(task._id as string)))
    .filter((task: any) => !input.projectId || task.projectId === input.projectId);
  result.sort((a: any, b: any) => a.orderIndex - b.orderIndex);
  return result.slice(0, input.limit);
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
    .withIndex("by_brain_type", (q: any) => q.eq("brainInstanceId", brainInstanceId).eq("type", "belongs_to"))
    .filter((q: any) => q.eq(q.field("from.entityType"), "task"))
    .filter((q: any) => q.eq(q.field("from.entityId"), taskId))
    .first();
  let project = null;
  if (belongs && belongs.to.entityType === "project") {
    const projectDoc = await db.get(belongs.to.entityId);
    if (projectDoc) {
      project = {
        _id: projectDoc._id,
        title: projectDoc.title,
        summary: projectDoc.summary,
        kind: projectDoc.kind,
        repoUrl: projectDoc.repoUrl,
        defaultBaseBranch: projectDoc.defaultBaseBranch,
        localPath: projectDoc.localPath,
        ...effectivePaths(projectDoc),
      };
    }
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
    gitBranchName: task.gitBranchName,
    prUrl: task.prUrl,
    prNumber: task.prNumber,
    prStatus: task.prStatus,
    lastPrCreatedAt: task.lastPrCreatedAt,
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
    .withIndex("by_brain_type", (q: any) => q.eq("brainInstanceId", brainInstanceId).eq("type", "belongs_to"))
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

// Exported for the agent workbench: the post-merge close-out job records its
// terminal result through this exact path so button-driven and chat-driven
// close-outs share recordTaskResult semantics (markDone + prStatus merged).
export async function applyTaskResult(
  db: any,
  brainInstanceId: any,
  args: {
    taskId: string;
    resultSummary?: string;
    resultUrl?: string;
    markDone?: boolean;
    gitBranchName?: string;
    prUrl?: string;
    prNumber?: number;
    prStatus?: "open" | "merged" | "closed";
    artifactFileIds?: string[];
  },
  actor: { actorType: string; actorId?: string },
) {
  const task = await db.get(args.taskId);
  if (!task || task.brainInstanceId !== brainInstanceId) {
    throw new Error("task not found for brain instance");
  }
  const now = Date.now();
  for (const fileId of args.artifactFileIds ?? []) {
    const file = await db.get(fileId);
    if (!file || file.brainInstanceId !== brainInstanceId || file.taskId !== args.taskId || (file.kind ?? "library_input") !== "generated_artifact" || (file.status ?? "ready") !== "ready") {
      throw new Error(`artifact ${fileId} is not a durable artifact for this task`);
    }
  }
  const patch: Record<string, unknown> = {
    resultSummary: args.resultSummary?.trim() || task.resultSummary,
    resultUrl: args.resultUrl?.trim() || task.resultUrl,
    artifactFileIds: args.artifactFileIds ?? task.artifactFileIds,
    gitBranchName: args.gitBranchName?.trim() || task.gitBranchName,
    prUrl: args.prUrl?.trim() || task.prUrl || (args.resultUrl?.includes("github.com") ? args.resultUrl.trim() : undefined),
    prNumber: args.prNumber ?? task.prNumber,
    prStatus: args.prStatus ?? task.prStatus,
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
  if (patch.prUrl && !task.prUrl) {
    patch.prStatus = patch.prStatus ?? "open";
    patch.lastPrCreatedAt = now;
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
    metadata: { resultUrl: args.resultUrl, prUrl: patch.prUrl, gitBranchName: patch.gitBranchName, promoted },
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
    gitBranchName: v.optional(v.string()),
    prUrl: v.optional(v.string()),
    prNumber: v.optional(v.number()),
    prStatus: v.optional(v.union(v.literal("open"), v.literal("merged"), v.literal("closed"))),
    markDone: v.optional(v.boolean()),
    artifactFileIds: v.optional(v.array(v.id("projectFiles"))),
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
        ...(args.gitBranchName !== undefined ? { gitBranchName: args.gitBranchName } : {}),
        ...(args.prUrl !== undefined ? { prUrl: args.prUrl } : {}),
        ...(args.prNumber !== undefined ? { prNumber: args.prNumber } : {}),
        ...(args.prStatus !== undefined ? { prStatus: args.prStatus } : {}),
        ...(args.markDone !== undefined ? { markDone: args.markDone } : {}),
        ...(args.artifactFileIds !== undefined ? { artifactFileIds: args.artifactFileIds } : {}),
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
  v.literal("cancelled"),
);

// Only not-yet-executed tasks can be abandoned; running or reviewed work must
// record its result instead so nothing silently disappears mid-flight.
const ABANDONABLE_STATES = new Set(["proposed", "unplanned", "briefed", "ready", "blocked"]);

async function cancelTask(
  db: any,
  brainInstanceId: any,
  taskId: string,
  actor: { actorType: string; actorId?: string },
  reason?: string,
) {
  const task = await db.get(taskId);
  if (!task || task.brainInstanceId !== brainInstanceId) {
    throw new Error("task not found");
  }
  const state = executionStateFor(task);
  if (!ABANDONABLE_STATES.has(state)) {
    throw new Error("running or completed work cannot be abandoned; record its result instead");
  }
  const now = Date.now();
  const patch: Record<string, unknown> = {
    executionState: "cancelled",
    status: "cancelled",
    updatedAt: now,
  };
  if (task.agentRequestStatus !== undefined) patch.agentRequestStatus = undefined;
  await db.patch(taskId, patch);
  await db.insert("activityEvents", {
    brainInstanceId,
    entityRef: { entityType: "task", entityId: taskId },
    activityType: "task_cancelled",
    actorType: actor.actorType,
    actorId: actor.actorId,
    timestamp: now,
    summary: `Task abandoned: ${task.title}`,
    ...(reason ? { metadata: { reason } } : {}),
  });
  return { taskId, title: task.title, executionState: "cancelled" };
}

async function restoreTask(
  db: any,
  brainInstanceId: any,
  taskId: string,
  actor: { actorType: string; actorId?: string },
) {
  const task = await db.get(taskId);
  if (!task || task.brainInstanceId !== brainInstanceId) {
    throw new Error("task not found");
  }
  if (executionStateFor(task) !== "cancelled") {
    throw new Error("only abandoned tasks can be restored");
  }
  const now = Date.now();
  await db.patch(taskId, { executionState: "proposed", status: "todo", updatedAt: now });
  await db.insert("activityEvents", {
    brainInstanceId,
    entityRef: { entityType: "task", entityId: taskId },
    activityType: "task_restored",
    actorType: actor.actorType,
    actorId: actor.actorId,
    timestamp: now,
    summary: `Task restored: ${task.title}`,
  });
  return { taskId, title: task.title, executionState: "proposed" };
}

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

    const phases = await ctx.db
      .query("phases")
      .withIndex("by_brain_project", (q: any) =>
        q.eq("brainInstanceId", brain._id).eq("projectId", args.projectId),
      )
      .collect();
    phases.sort((a: any, b: any) => a.orderNum - b.orderNum);

    const now = Date.now();
    // Default placement: append to the END of the target phase. Same-millisecond
    // timestamp orderIndexes could collide, leaving relative order undefined.
    const phaseId = phases[0]?._id;
    const orderIndex = phaseId ? await phaseAppendOrderIndex(ctx.db, brain._id, phaseId) : now;
    const taskId = await ctx.db.insert("tasks", {
      brainInstanceId: brain._id,
      title,
      description: proposalText,
      status: "todo",
      ownerType: "agent",
      processingState: "accepted",
      kind: args.kind ?? "coding",
      executionState: "proposed",
      orderIndex,
      phaseId,
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
    vercelUrl: v.optional(v.string()),
    liveUrl: v.optional(v.string()),
    defaultBaseBranch: v.optional(v.string()),
    // Task-run model override (token tiering). Empty string clears back to
    // the harness default.
    defaultTaskModel: v.optional(v.string()),
    localPath: v.optional(v.string()),
    // Explicit assets/output folder overrides. Empty string clears the
    // override (falls back to the derived `${localPath}/_library` / `_output`).
    assetsFolderPath: v.optional(v.string()),
    outputFolderPath: v.optional(v.string()),
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
    if (args.vercelUrl !== undefined) patch.vercelUrl = args.vercelUrl.trim() || undefined;
    if (args.liveUrl !== undefined) patch.liveUrl = args.liveUrl.trim() || undefined;
    if (args.defaultBaseBranch !== undefined) patch.defaultBaseBranch = args.defaultBaseBranch.trim() || undefined;
    if (args.defaultTaskModel !== undefined) patch.defaultTaskModel = args.defaultTaskModel.trim() || undefined;
    if (args.localPath !== undefined) patch.localPath = args.localPath.trim() || undefined;
    // Format-check only — the app/Convex never checks existence (the browser
    // PWA and cloud cannot see the user's disk); the harness `mkdir -p`s on
    // first write.
    if (args.assetsFolderPath !== undefined) {
      patch.assetsFolderPath = normalizeFolderPathInput(args.assetsFolderPath, "assets folder");
    }
    if (args.outputFolderPath !== undefined) {
      patch.outputFolderPath = normalizeFolderPathInput(args.outputFolderPath, "output folder");
    }
    await ctx.db.patch(args.projectId, patch);
    return { projectId: args.projectId, status: "updated" };
  },
});

/**
 * Backward-compatible phase bootstrap. Older projects already have ordered
 * tasks, so the first visit wraps them in one editable phase without asking
 * the owner to migrate anything manually.
 */
export const ensureProjectPhasesForViewer = mutationGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.brainInstanceId !== brain._id) throw new Error("project not found");

    const existing = await ctx.db
      .query("phases")
      .withIndex("by_brain_project", (q: any) =>
        q.eq("brainInstanceId", brain._id).eq("projectId", args.projectId),
      )
      .collect();
    if (existing.length) return { phaseId: existing.sort((a: any, b: any) => a.orderNum - b.orderNum)[0]._id };

    const plans = await ctx.db
      .query("projectPlans")
      .withIndex("by_brain_project", (q: any) =>
        q.eq("brainInstanceId", brain._id).eq("projectId", args.projectId),
      )
      .collect();
    plans.sort((a: any, b: any) => b.createdAt - a.createdAt);
    const now = Date.now();
    const phaseId = await ctx.db.insert("phases", {
      brainInstanceId: brain._id,
      projectId: args.projectId,
      orderNum: 0,
      title: "Project plan",
      descriptionMd: plans[0]?.summary || project.summary || "",
      createdAt: now,
      updatedAt: now,
    });

    // Backfill phase-less tasks (ingested tasks, pre-Plan tasks) into the new
    // phase with sequential orderIndex values: without them every backfilled
    // task read back as `orderIndex ?? 0` and collided at position 0.
    const backfill: any[] = [];
    for (const taskId of await projectTaskIds(ctx.db, brain._id, args.projectId)) {
      const task = await ctx.db.get(taskId as any);
      if (task && task.brainInstanceId === brain._id && !task.phaseId) {
        backfill.push(task);
      }
    }
    backfill.sort(
      (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0),
    );
    for (let index = 0; index < backfill.length; index += 1) {
      await ctx.db.patch(backfill[index]._id, { phaseId, orderIndex: index, updatedAt: now });
    }
    return { phaseId };
  },
});

export const createPhaseForViewer = mutationGeneric({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    descriptionMd: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.brainInstanceId !== brain._id) throw new Error("project not found");
    const title = args.title.trim();
    if (!title) throw new Error("phase title cannot be empty");
    const phases = await ctx.db
      .query("phases")
      .withIndex("by_brain_project", (q: any) =>
        q.eq("brainInstanceId", brain._id).eq("projectId", args.projectId),
      )
      .collect();
    const now = Date.now();
    const phaseId = await ctx.db.insert("phases", {
      brainInstanceId: brain._id,
      projectId: args.projectId,
      orderNum: phases.length ? Math.max(...phases.map((phase: any) => phase.orderNum)) + 1 : 0,
      title,
      descriptionMd: args.descriptionMd?.trim() ?? "",
      createdAt: now,
      updatedAt: now,
    });
    return { phaseId };
  },
});

export const updatePhaseForViewer = mutationGeneric({
  args: {
    phaseId: v.id("phases"),
    title: v.optional(v.string()),
    descriptionMd: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const phase = await ctx.db.get(args.phaseId);
    if (!phase || phase.brainInstanceId !== brain._id) throw new Error("phase not found");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) throw new Error("phase title cannot be empty");
      patch.title = title;
    }
    // Keep an intentionally empty description: the inline editor should feel
    // like a document surface, not a required form field.
    if (args.descriptionMd !== undefined) patch.descriptionMd = args.descriptionMd;
    await ctx.db.patch(args.phaseId, patch);
    return { phaseId: args.phaseId };
  },
});

/* ------------------------------------------------------------------ */
/* Project notes pad                                                  */
/*                                                                    */
/* One freeform plain-text pad per project (projects.notesPad) — a    */
/* notepad, not a document system. Saving overwrites the whole field  */
/* (last-write-wins is fine for a single-owner pad); history is kept  */
/* by snapshotting the entire pad at review-session granularity into  */
/* projectNoteSnapshots, then pruning the live pad.                   */
/* ------------------------------------------------------------------ */

async function saveProjectNotes(db: any, brainInstanceId: any, projectId: any, notesPad: string) {
  const project = await db.get(projectId);
  if (!project || project.brainInstanceId !== brainInstanceId) throw new Error("project not found");
  // Plain text stored verbatim — no trimming, so leading/trailing blank
  // lines the owner typed survive the round trip. Empty means pruned.
  await db.patch(projectId, { notesPad, updatedAt: Date.now() });
  return { projectId, status: "updated" };
}

async function snapshotProjectNotes(
  db: any,
  brainInstanceId: any,
  projectId: any,
  summary: string | undefined,
  createdBy: "user" | "harness",
) {
  const project = await db.get(projectId);
  if (!project || project.brainInstanceId !== brainInstanceId) throw new Error("project not found");
  // Snapshot what is STORED, not what the caller believes the pad says:
  // the snapshot's whole job is to preserve the pad as-is before a prune.
  const content = project.notesPad ?? "";
  const snapshotId = await db.insert("projectNoteSnapshots", {
    brainInstanceId,
    projectId,
    content,
    summary: summary?.trim() || undefined,
    createdBy,
    createdAt: Date.now(),
  });
  return { snapshotId, projectId, contentLength: content.length, status: "created" };
}

export const updateProjectNotesForViewer = mutationGeneric({
  args: { projectId: v.id("projects"), notesPad: v.string() },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    return saveProjectNotes(ctx.db, brain._id, args.projectId, args.notesPad);
  },
});

export const snapshotProjectNotesForViewer = mutationGeneric({
  args: { projectId: v.id("projects"), summary: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    return snapshotProjectNotes(ctx.db, brain._id, args.projectId, args.summary, "user");
  },
});

export const reorderTaskInPhaseForViewer = mutationGeneric({
  args: {
    projectId: v.id("projects"),
    phaseId: v.id("phases"),
    taskId: v.id("tasks"),
    beforeTaskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const phase = await ctx.db.get(args.phaseId);
    const task = await ctx.db.get(args.taskId);
    if (!phase || phase.brainInstanceId !== brain._id || phase.projectId !== args.projectId) {
      throw new Error("phase not found");
    }
    if (!task || task.brainInstanceId !== brain._id) throw new Error("task not found");
    const projectIds = await projectTaskIds(ctx.db, brain._id, args.projectId);
    if (!projectIds.includes(args.taskId)) throw new Error("task does not belong to this project");

    const siblings: any[] = [];
    for (const taskId of projectIds) {
      if (taskId === args.taskId) continue;
      const candidate = await ctx.db.get(taskId as any);
      if (candidate?.phaseId === args.phaseId && candidate.processingState === "accepted") siblings.push(candidate);
    }
    siblings.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    const beforePosition = args.beforeTaskId
      ? siblings.findIndex((candidate) => candidate._id === args.beforeTaskId)
      : -1;
    const insertAt = beforePosition === -1 ? siblings.length : beforePosition;
    const orderIndex = orderIndexBetween(
      insertAt > 0 ? (siblings[insertAt - 1].orderIndex ?? 0) : undefined,
      insertAt < siblings.length ? (siblings[insertAt].orderIndex ?? 0) : undefined,
    );
    const now = Date.now();
    if (orderIndex !== undefined) {
      await ctx.db.patch(args.taskId, { phaseId: args.phaseId, orderIndex, updatedAt: now });
      return { taskId: args.taskId, phaseId: args.phaseId, orderIndex };
    }
    siblings.splice(insertAt, 0, task);
    const base = siblings.length ? Math.min(...siblings.map((candidate) => candidate.orderIndex ?? 0)) : 0;
    for (let index = 0; index < siblings.length; index += 1) {
      await ctx.db.patch(siblings[index]._id, {
        phaseId: args.phaseId,
        orderIndex: base + index,
        updatedAt: now,
      });
    }
    return { taskId: args.taskId, phaseId: args.phaseId, orderIndex: base + insertAt };
  },
});

export const updateTaskBriefForViewer = mutationGeneric({
  args: {
    taskId: v.id("tasks"),
    title: v.optional(v.string()),
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
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) throw new Error("task title cannot be empty");
      patch.title = title;
    }
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

// Shared by setTaskExecutionStateForViewer and reorderTaskForViewer so column
// drops and reorder drags apply identical status/dependency side effects.
async function applyExecutionStateChange(
  ctx: any,
  user: any,
  brain: any,
  task: any,
  executionState: string,
  now: number,
) {
  const patch: Record<string, unknown> = { executionState, updatedAt: now };
  // Keep the user-facing status roughly in sync with the lifecycle.
  if (executionState === "in_progress") {
    patch.status = "in_progress";
    patch.startedAt = task.startedAt ?? now;
    patch.startedBy = task.startedBy ?? user.displayName ?? user.email;
  }
  else if (executionState === "done") {
    patch.status = "done";
    patch.completedAt = now;
  } else if (executionState === "cancelled") {
    patch.status = "cancelled";
  } else if (["proposed", "unplanned", "briefed", "ready", "blocked"].includes(executionState) && task.status === "in_progress") {
    patch.status = "todo";
  }
  await ctx.db.patch(task._id, patch);

  if (executionState === "done") {
    await advanceDependentsAfterDone(ctx.db, brain._id, task._id, now);
  }

  await ctx.db.insert("activityEvents", {
    brainInstanceId: brain._id,
    entityRef: { entityType: "task", entityId: task._id },
    activityType: "task_execution_state_changed",
    actorType: "user",
    actorId: user._id,
    timestamp: now,
    summary: `Task moved to ${executionState}: ${task.title}`,
  });
}

export const setTaskExecutionStateForViewer = mutationGeneric({
  args: { taskId: v.id("tasks"), executionState: executionStateValidator },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.brainInstanceId !== brain._id) {
      throw new Error("task not found");
    }
    await applyExecutionStateChange(ctx, user, brain, task, args.executionState, Date.now());
    return { taskId: args.taskId, executionState: args.executionState };
  },
});

/**
 * Drag-reorder on the board: place a task before `beforeTaskId` in the target
 * status bucket (or at the end when omitted), reusing the existing orderIndex
 * ordering that buildBoard sorts by. Cross-bucket drops also apply the same
 * execution-state change as a column drop.
 */
export const reorderTaskForViewer = mutationGeneric({
  args: {
    taskId: v.id("tasks"),
    projectId: v.id("projects"),
    executionState: executionStateValidator,
    beforeTaskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.brainInstanceId !== brain._id) {
      throw new Error("task not found");
    }
    const taskIds = await projectTaskIds(ctx.db, brain._id, args.projectId);
    if (!taskIds.includes(args.taskId)) {
      throw new Error("task does not belong to this project");
    }
    const now = Date.now();
    if (executionStateFor(task) !== args.executionState) {
      await applyExecutionStateChange(ctx, user, brain, task, args.executionState, now);
    }

    // The destination bucket in board display order, excluding the moved task.
    const bucket: any[] = [];
    for (const id of taskIds) {
      if (id === args.taskId) continue;
      const candidate = await ctx.db.get(id as any);
      if (
        candidate &&
        candidate.processingState === "accepted" &&
        executionStateFor(candidate) === args.executionState
      ) {
        bucket.push(candidate);
      }
    }
    bucket.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

    const beforePosition = args.beforeTaskId ? bucket.findIndex((t) => t._id === args.beforeTaskId) : -1;
    const insertAt = beforePosition === -1 ? bucket.length : beforePosition;
    const orderIndex = orderIndexBetween(
      insertAt > 0 ? (bucket[insertAt - 1].orderIndex ?? 0) : undefined,
      insertAt < bucket.length ? (bucket[insertAt].orderIndex ?? 0) : undefined,
    );
    if (orderIndex !== undefined) {
      await ctx.db.patch(args.taskId, { orderIndex, updatedAt: now });
      return { taskId: args.taskId, orderIndex };
    }
    // No numeric room between the neighbors — renumber the bucket in place.
    bucket.splice(insertAt, 0, task);
    const base = Math.min(...bucket.map((t) => t.orderIndex ?? 0));
    for (let i = 0; i < bucket.length; i += 1) {
      await ctx.db.patch(bucket[i]._id, { orderIndex: base + i, updatedAt: now });
    }
    return { taskId: args.taskId, orderIndex: base + insertAt };
  },
});

export const cancelTaskForViewer = mutationGeneric({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    return cancelTask(ctx.db, brain._id, args.taskId, { actorType: "user", actorId: user._id });
  },
});

export const restoreTaskForViewer = mutationGeneric({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    return restoreTask(ctx.db, brain._id, args.taskId, { actorType: "user", actorId: user._id });
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
      activeProject = {
        _id: project._id,
        title: project.title,
        kind: project.kind,
        repoUrl: project.repoUrl,
        vercelUrl: project.vercelUrl,
        liveUrl: project.liveUrl,
        localPath: project.localPath,
        ...effectivePaths(project),
      };
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

export const updateProjectForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    projectId: v.id("projects"),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    repoUrl: v.optional(v.string()),
    vercelUrl: v.optional(v.string()),
    liveUrl: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const project = await db.get(args.projectId);
    if (!project || project.brainInstanceId !== args.brainInstanceId) throw new Error("project not found");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) throw new Error("project title cannot be empty");
      patch.title = title;
    }
    if (args.summary !== undefined) patch.summary = args.summary.trim() || undefined;
    if (args.repoUrl !== undefined) patch.repoUrl = args.repoUrl.trim() || undefined;
    if (args.vercelUrl !== undefined) patch.vercelUrl = args.vercelUrl.trim() || undefined;
    if (args.liveUrl !== undefined) patch.liveUrl = args.liveUrl.trim() || undefined;
    await db.patch(args.projectId, patch);
    return { projectId: args.projectId, status: "updated" };
  },
});

export const updatePhaseForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    phaseId: v.id("phases"),
    title: v.optional(v.string()),
    descriptionMd: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const phase = await db.get(args.phaseId);
    if (!phase || phase.brainInstanceId !== args.brainInstanceId) throw new Error("phase not found");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) throw new Error("phase title cannot be empty");
      patch.title = title;
    }
    if (args.descriptionMd !== undefined) patch.descriptionMd = args.descriptionMd;
    await db.patch(args.phaseId, patch);
    return { phaseId: args.phaseId, status: "updated" };
  },
});

/**
 * Harness-facing notes pad read: this is what makes the "review my notes"
 * verb work — the chat harness reads the pad, the owner and assistant fold
 * items into the Plan, then (with the owner's explicit OK) the harness
 * snapshots and prunes. Convention, not code-enforced: the harness only
 * edits the pad at the close of an owner-requested review.
 */
export const projectNotesForBrain = queryGeneric({
  args: { brainInstanceId: v.id("brainInstances"), projectId: v.id("projects") },
  handler: async ({ db }, args) => {
    const project = await db.get(args.projectId);
    if (!project || project.brainInstanceId !== args.brainInstanceId) throw new Error("project not found");
    return {
      projectId: args.projectId,
      projectTitle: project.title,
      notesPad: project.notesPad ?? "",
    };
  },
});

export const updateProjectNotesForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    projectId: v.id("projects"),
    notesPad: v.string(),
  },
  handler: async ({ db }, args) => {
    return saveProjectNotes(db, args.brainInstanceId, args.projectId, args.notesPad);
  },
});

export const snapshotProjectNotesForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    projectId: v.id("projects"),
    summary: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    return snapshotProjectNotes(db, args.brainInstanceId, args.projectId, args.summary, "harness");
  },
});

/**
 * Harness-facing phase creation: appended after the project's existing phases,
 * mirroring createPhaseForViewer. Completes the MCP phase toolset so an agent
 * can stand up a new plan section (create_phase -> create_task with phaseId)
 * without a UI round-trip.
 */
export const createPhaseForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    projectId: v.id("projects"),
    title: v.string(),
    descriptionMd: v.optional(v.string()),
    actorId: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const project = await db.get(args.projectId);
    if (!project || project.brainInstanceId !== args.brainInstanceId) throw new Error("project not found");
    const title = args.title.trim();
    if (!title) throw new Error("phase title cannot be empty");
    const phases = await db
      .query("phases")
      .withIndex("by_brain_project", (q: any) =>
        q.eq("brainInstanceId", args.brainInstanceId).eq("projectId", args.projectId),
      )
      .collect();
    const now = Date.now();
    const phaseId = await db.insert("phases", {
      brainInstanceId: args.brainInstanceId,
      projectId: args.projectId,
      orderNum: phases.length ? Math.max(...phases.map((phase: any) => phase.orderNum)) + 1 : 0,
      title,
      descriptionMd: args.descriptionMd?.trim() ?? "",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      entityRef: { entityType: "project", entityId: args.projectId },
      activityType: "phase_created",
      actorType: "harness",
      actorId: args.actorId,
      timestamp: now,
      summary: `Phase created: ${title}`,
      metadata: { phaseId },
    });

    return { phaseId, title, projectId: args.projectId, status: "created" };
  },
});

/**
 * Harness-facing phase (re)assignment: place an existing task into a Plan
 * phase, appended after the phase's current tasks. This is the MCP escape
 * hatch for tasks that predate phase-aware creation (created without a
 * phaseId) or that should move between phases.
 */
export const setTaskPhaseForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    taskId: v.id("tasks"),
    phaseId: v.id("phases"),
    actorId: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const task = await db.get(args.taskId);
    if (!task || task.brainInstanceId !== args.brainInstanceId) throw new Error("task not found");
    const phase = await db.get(args.phaseId);
    if (!phase || phase.brainInstanceId !== args.brainInstanceId) throw new Error("phase not found");
    const projectIds = await projectTaskIds(db, args.brainInstanceId, phase.projectId);
    if (!projectIds.includes(args.taskId)) {
      throw new Error("task does not belong to the phase's project");
    }

    // Append after the phase's current tasks so the Plan ordering is stable.
    let maxOrderIndex: number | undefined;
    for (const taskId of projectIds) {
      if (taskId === args.taskId) continue;
      const sibling = await db.get(taskId as any);
      if (sibling?.phaseId === args.phaseId && sibling.processingState === "accepted") {
        const orderIndex = sibling.orderIndex ?? 0;
        maxOrderIndex = maxOrderIndex === undefined ? orderIndex : Math.max(maxOrderIndex, orderIndex);
      }
    }
    const now = Date.now();
    const orderIndex = maxOrderIndex === undefined ? (task.orderIndex ?? 0) : maxOrderIndex + 1;
    await db.patch(args.taskId, { phaseId: args.phaseId, orderIndex, updatedAt: now });

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      entityRef: { entityType: "task", entityId: args.taskId },
      activityType: "task_phase_set",
      actorType: "harness",
      actorId: args.actorId,
      timestamp: now,
      summary: `Task placed in phase "${phase.title}": ${task.title}`,
      metadata: { phaseId: args.phaseId, projectId: phase.projectId },
    });

    return { taskId: args.taskId, phaseId: args.phaseId, phaseTitle: phase.title, orderIndex, status: "updated" };
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

export const tasksByStateForBrain = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    executionState: v.union(
      v.literal("proposed"),
      v.literal("unplanned"),
      v.literal("briefed"),
      v.literal("ready"),
      v.literal("in_progress"),
      v.literal("in_review"),
      v.literal("blocked"),
      v.literal("done"),
      v.literal("cancelled"),
    ),
    ownerType: v.optional(v.union(v.literal("owner"), v.literal("agent"))),
    projectId: v.optional(v.id("projects")),
    agentRequestStatus: v.optional(v.union(v.literal("requested"), v.literal("cancelled"))),
    limit: v.optional(v.number()),
  },
  handler: async ({ db }, args) => {
    const { brainInstanceId, limit, ...rest } = args;
    return tasksByState(db, brainInstanceId, { ...rest, limit: limit ?? 25 });
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
    gitBranchName: v.optional(v.string()),
    prUrl: v.optional(v.string()),
    prNumber: v.optional(v.number()),
    prStatus: v.optional(v.union(v.literal("open"), v.literal("merged"), v.literal("closed"))),
    markDone: v.optional(v.boolean()),
    artifactFileIds: v.optional(v.array(v.id("projectFiles"))),
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
        ...(args.gitBranchName !== undefined ? { gitBranchName: args.gitBranchName } : {}),
        ...(args.prUrl !== undefined ? { prUrl: args.prUrl } : {}),
        ...(args.prNumber !== undefined ? { prNumber: args.prNumber } : {}),
        ...(args.prStatus !== undefined ? { prStatus: args.prStatus } : {}),
        ...(args.markDone !== undefined ? { markDone: args.markDone } : {}),
        ...(args.artifactFileIds !== undefined ? { artifactFileIds: args.artifactFileIds } : {}),
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
    ownerType: v.optional(v.union(v.literal("owner"), v.literal("agent"))),
    actorId: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const task = await db.get(args.taskId);
    if (!task || task.brainInstanceId !== args.brainInstanceId) {
      throw new Error("task not found for brain instance");
    }
    const now = Date.now();
    const patch: Record<string, unknown> = { kind: args.kind, updatedAt: now };
    if (args.ownerType) patch.ownerType = args.ownerType;
    await db.patch(args.taskId, patch);
    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      entityRef: { entityType: "task", entityId: args.taskId },
      activityType: "task_kind_changed",
      actorType: "harness",
      actorId: args.actorId,
      timestamp: now,
      summary: `Task kind set to ${args.kind}${args.ownerType ? ` (${args.ownerType}-owned)` : ""}: ${task.title}`,
    });
    return { taskId: args.taskId, kind: args.kind, ownerType: args.ownerType ?? task.ownerType };
  },
});

export const cancelTaskForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    taskId: v.id("tasks"),
    reason: v.optional(v.string()),
    actorId: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    return cancelTask(
      db,
      args.brainInstanceId,
      args.taskId,
      { actorType: "harness", ...(args.actorId ? { actorId: args.actorId } : {}) },
      args.reason,
    );
  },
});

export const restoreTaskForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    taskId: v.id("tasks"),
    actorId: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    return restoreTask(db, args.brainInstanceId, args.taskId, {
      actorType: "harness",
      ...(args.actorId ? { actorId: args.actorId } : {}),
    });
  },
});

/**
 * Hard-delete a task plus the relationship edges that reference it. Unlike
 * `cancelTask` (soft, restorable), this permanently removes the record — it
 * exists for board cleanup of stale/duplicate items. Historical references
 * from agentRuns/chat cards are left in place; consumers already treat a
 * missing task as "no longer on the board".
 */
async function deleteTaskCascade(db: any, brainInstanceId: string, taskId: string) {
  // Endpoint indexes keep this to exactly the edges touching the task —
  // the brain's full edge set is far beyond function read limits.
  const outgoing = await db
    .query("relationships")
    .withIndex("by_brain_from", (q: any) =>
      q.eq("brainInstanceId", brainInstanceId).eq("from.entityId", taskId),
    )
    .collect();
  const incoming = await db
    .query("relationships")
    .withIndex("by_brain_to", (q: any) =>
      q.eq("brainInstanceId", brainInstanceId).eq("to.entityId", taskId),
    )
    .collect();
  let removedEdges = 0;
  for (const rel of [...outgoing, ...incoming]) {
    await db.delete(rel._id);
    removedEdges += 1;
  }
  await db.delete(taskId);
  return removedEdges;
}

export const deleteTaskForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    taskId: v.id("tasks"),
    actorId: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const task = await db.get(args.taskId);
    if (!task || task.brainInstanceId !== args.brainInstanceId) {
      throw new Error("task not found for brain instance");
    }
    const removedEdges = await deleteTaskCascade(db, args.brainInstanceId, args.taskId);
    return { taskId: args.taskId, deleted: true, removedEdges, title: task.title };
  },
});

/**
 * Hard-delete a Plan phase. Refuses when the phase still contains tasks
 * unless `deleteTasks` is set, so a caller can never silently vaporize work;
 * the alternative is moving tasks out first via `setTaskPhaseForBrain`.
 */
export const deletePhaseForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    phaseId: v.id("phases"),
    deleteTasks: v.optional(v.boolean()),
    actorId: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const phase = await db.get(args.phaseId);
    if (!phase || phase.brainInstanceId !== args.brainInstanceId) {
      throw new Error("phase not found for brain instance");
    }
    const tasks = await db
      .query("tasks")
      .withIndex("by_brain_phase", (q: any) =>
        q.eq("brainInstanceId", args.brainInstanceId).eq("phaseId", args.phaseId),
      )
      .collect();
    if (tasks.length > 0 && !args.deleteTasks) {
      throw new Error(
        `phase still contains ${tasks.length} task(s); pass deleteTasks: true or move them out first`,
      );
    }
    const deletedTaskIds: string[] = [];
    for (const task of tasks) {
      await deleteTaskCascade(db, args.brainInstanceId, task._id);
      deletedTaskIds.push(task._id);
    }
    await db.delete(args.phaseId);
    return { phaseId: args.phaseId, deleted: true, title: phase.title, deletedTaskIds };
  },
});
