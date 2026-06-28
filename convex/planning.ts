import {
  actionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import {
  createLlmClient,
  generateProjectPlan,
  PROJECT_PLAN_POLICY_VERSION,
  type AiProviderConfig,
  type ProjectPlanTaskDraft,
} from "@skippy/ai";
import { requireOwnedBrain } from "./auth";

const planContextRef = makeFunctionReference<"query">("planning:planContext");
const writePlanRef = makeFunctionReference<"mutation">("planning:writePlan");
const resolveViewerBrainRef = makeFunctionReference<"query">("planning:resolveViewerBrain");

const planTaskValidator = v.object({
  title: v.string(),
  description: v.optional(v.string()),
  kind: v.optional(v.string()),
  acceptanceCriteria: v.optional(v.array(v.string())),
  executionBrief: v.optional(v.string()),
  dependsOn: v.optional(v.array(v.number())),
});

type PlanContext = {
  ok: boolean;
  reason?: string | undefined;
  brainInstanceId?: string | undefined;
  projectTitle?: string | undefined;
  projectSummary?: string | undefined;
  goals?: string[] | undefined;
  existingTasks?: string[] | undefined;
  aiMode?: string | undefined;
  synthesisModel?: string | undefined;
  planVersion?: number | undefined;
};

/* ------------------------------------------------------------------ */
/* Internal data access (auth flows through ctx from the calling action) */
/* ------------------------------------------------------------------ */

export const resolveViewerBrain = internalQueryGeneric({
  args: {},
  handler: async (ctx) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    return { brainInstanceId: brain._id as string, userId: user._id as string };
  },
});

export const planContext = internalQueryGeneric({
  args: { brainInstanceId: v.id("brainInstances"), projectId: v.id("projects") },
  handler: async ({ db }, args): Promise<PlanContext> => {
    const project = await db.get(args.projectId);
    if (!project || project.brainInstanceId !== args.brainInstanceId) {
      return { ok: false, reason: "project not found" };
    }

    const config = await db
      .query("brainConfigs")
      .withIndex("by_brain", (q: any) => q.eq("brainInstanceId", args.brainInstanceId))
      .first();

    const goals = (
      await db
        .query("goals")
        .withIndex("by_brain_status", (q: any) =>
          q.eq("brainInstanceId", args.brainInstanceId).eq("status", "active"),
        )
        .collect()
    )
      .filter((goal: any) => goal.processingState === "accepted")
      .map((goal: any) => goal.title as string);

    // Titles of tasks already linked to this project, to avoid duplicate planning.
    const belongsTo = await db
      .query("relationships")
      .withIndex("by_brain_type", (q: any) => q.eq("brainInstanceId", args.brainInstanceId))
      .filter((q: any) => q.eq(q.field("type"), "belongs_to"))
      .collect();
    const taskIds = belongsTo
      .filter((rel: any) => rel.from.entityType === "task" && rel.to.entityType === "project" && rel.to.entityId === args.projectId)
      .map((rel: any) => rel.from.entityId);
    const existingTasks: string[] = [];
    for (const taskId of taskIds) {
      const task = await db.get(taskId);
      if (task && task.status !== "cancelled") existingTasks.push(task.title as string);
    }

    const priorPlans = await db
      .query("projectPlans")
      .withIndex("by_brain_project", (q: any) =>
        q.eq("brainInstanceId", args.brainInstanceId).eq("projectId", args.projectId),
      )
      .collect();

    return {
      ok: true,
      brainInstanceId: args.brainInstanceId as string,
      projectTitle: project.title as string,
      projectSummary: project.summary as string | undefined,
      goals,
      existingTasks,
      aiMode: config?.llmProviderMode ?? "none",
      synthesisModel: config?.synthesisModel,
      planVersion: priorPlans.length + 1,
    };
  },
});

export const writePlan = internalMutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    projectId: v.id("projects"),
    summary: v.string(),
    provider: v.string(),
    model: v.optional(v.string()),
    planVersion: v.number(),
    createdBy: v.union(v.literal("user"), v.literal("harness"), v.literal("skippy_ai"), v.literal("system")),
    createdByUserId: v.optional(v.id("users")),
    tasks: v.array(planTaskValidator),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    const project = await db.get(args.projectId);
    if (!project || project.brainInstanceId !== args.brainInstanceId) {
      throw new Error("project not found for brain instance");
    }

    const planId = await db.insert("projectPlans", {
      brainInstanceId: args.brainInstanceId,
      projectId: args.projectId,
      status: "completed",
      planVersion: args.planVersion,
      provider: args.provider,
      model: args.model,
      summary: args.summary || undefined,
      taskCount: args.tasks.length,
      createdBy: args.createdBy,
      createdByUserId: args.createdByUserId,
      createdAt: now,
      completedAt: now,
    });

    const taskIds: string[] = [];
    for (let index = 0; index < args.tasks.length; index += 1) {
      const draft = args.tasks[index] as ProjectPlanTaskDraft;
      const hasDeps = Boolean(draft.dependsOn?.length);
      const taskId = await db.insert("tasks", {
        brainInstanceId: args.brainInstanceId,
        title: draft.title,
        description: draft.description,
        status: "todo",
        ownerType: "agent",
        processingState: "accepted",
        kind: (draft.kind as any) ?? "coding",
        executionState: hasDeps ? "briefed" : "ready",
        executionBrief: draft.executionBrief,
        acceptanceCriteria: draft.acceptanceCriteria,
        orderIndex: index,
        briefReadyAt: now,
        planRunId: planId,
        priorityReason: args.summary || undefined,
        createdAt: now,
        updatedAt: now,
      });
      taskIds.push(taskId);
    }

    // Project link (belongs_to) for each created task.
    for (const taskId of taskIds) {
      await db.insert("relationships", {
        brainInstanceId: args.brainInstanceId,
        from: { entityType: "task", entityId: taskId },
        to: { entityType: "project", entityId: args.projectId },
        type: "belongs_to",
        confidence: 1,
        reason: `Created by automated project planning (plan v${args.planVersion}).`,
        createdBy: args.createdBy === "user" ? "skippy_ai" : args.createdBy,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Dependency edges (depends_on) between created tasks.
    for (let index = 0; index < args.tasks.length; index += 1) {
      const draft = args.tasks[index] as ProjectPlanTaskDraft;
      for (const depIndex of draft.dependsOn ?? []) {
        const fromId = taskIds[index];
        const toId = taskIds[depIndex];
        if (!fromId || !toId || fromId === toId) continue;
        await db.insert("relationships", {
          brainInstanceId: args.brainInstanceId,
          from: { entityType: "task", entityId: fromId },
          to: { entityType: "task", entityId: toId },
          type: "depends_on",
          confidence: 1,
          reason: "Automated plan dependency.",
          createdBy: "skippy_ai",
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Move the project into planning/in-progress if it was still an idea.
    if (project.status === "idea" || project.status === "planned") {
      await db.patch(args.projectId, { status: "in_progress", updatedAt: now });
    }

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      entityRef: { entityType: "project", entityId: args.projectId },
      activityType: "project_planned",
      actorType: "skippy_ai",
      timestamp: now,
      summary: `Skippy planned ${args.tasks.length} task${args.tasks.length === 1 ? "" : "s"} for ${project.title}.`,
      metadata: { planId, planVersion: args.planVersion },
    });

    return { planId, taskIds, taskCount: taskIds.length };
  },
});

/* ------------------------------------------------------------------ */
/* Shared planning routine                                            */
/* ------------------------------------------------------------------ */

async function runPlanning(
  ctx: any,
  options: {
    brainInstanceId: string;
    projectId: string;
    createdBy: "user" | "harness" | "skippy_ai" | "system";
    createdByUserId?: string;
    maxTasks?: number;
  },
) {
  const context: PlanContext = await ctx.runQuery(planContextRef, {
    brainInstanceId: options.brainInstanceId,
    projectId: options.projectId,
  });
  if (!context.ok) {
    throw new Error(context.reason ?? "could not load project for planning");
  }
  if (!context.aiMode || context.aiMode === "none") {
    throw new Error(
      "This brain has no LLM provider configured. Set an LLM provider in Settings before using automated planning.",
    );
  }

  const config: AiProviderConfig = {
    mode: context.aiMode as AiProviderConfig["mode"],
    ...(context.synthesisModel ? { synthesisModel: context.synthesisModel } : {}),
  };
  const client = createLlmClient(config);
  const plan = await generateProjectPlan(client, {
    projectTitle: context.projectTitle ?? "Project",
    ...(context.projectSummary ? { projectSummary: context.projectSummary } : {}),
    ...(context.goals?.length ? { goals: context.goals } : {}),
    ...(context.existingTasks?.length ? { existingTasks: context.existingTasks } : {}),
    ...(options.maxTasks ? { maxTasks: options.maxTasks } : {}),
    policyVersion: PROJECT_PLAN_POLICY_VERSION,
  });

  const result = await ctx.runMutation(writePlanRef, {
    brainInstanceId: options.brainInstanceId,
    projectId: options.projectId,
    summary: plan.summary,
    provider: context.aiMode,
    ...(context.synthesisModel ? { model: context.synthesisModel } : {}),
    planVersion: context.planVersion ?? 1,
    createdBy: options.createdBy,
    ...(options.createdByUserId ? { createdByUserId: options.createdByUserId } : {}),
    tasks: plan.tasks,
  });

  return {
    status: "planned" as const,
    planId: result.planId,
    taskCount: result.taskCount,
    summary: plan.summary,
    projectId: options.projectId,
  };
}

/* ------------------------------------------------------------------ */
/* Public actions                                                     */
/* ------------------------------------------------------------------ */

export const planProject = actionGeneric({
  args: { projectId: v.id("projects"), maxTasks: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { brainInstanceId, userId } = await ctx.runQuery(resolveViewerBrainRef, {});
    return runPlanning(ctx, {
      brainInstanceId,
      projectId: args.projectId,
      createdBy: "user",
      createdByUserId: userId,
      ...(args.maxTasks ? { maxTasks: args.maxTasks } : {}),
    });
  },
});

export const planProjectForBrain = actionGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    projectId: v.id("projects"),
    maxTasks: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return runPlanning(ctx, {
      brainInstanceId: args.brainInstanceId,
      projectId: args.projectId,
      createdBy: "harness",
      ...(args.maxTasks ? { maxTasks: args.maxTasks } : {}),
    });
  },
});
