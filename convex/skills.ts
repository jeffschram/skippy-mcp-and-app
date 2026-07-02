import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireOwnedBrain } from "./auth";

const TASK_HEARTBEAT_BODY = [
  "# Skippy Task Heartbeat",
  "",
  "Check Skippy for requested Ready agent tasks using `list_requested_ready_tasks`.",
  "",
  "If no tasks are queued, stop quietly.",
  "",
  "If tasks are queued, process all queued tasks that can be completed safely in this wake.",
  "",
  "For each task:",
  "- Before doing meaningful work, mark the task in progress.",
  "- Execute it according to its execution brief and acceptance criteria.",
  "- Run relevant verification.",
  "- Report the result back to Skippy with `record_task_result` so the task moves to In Review.",
  "",
  "For coding tasks in projects with a GitHub repo:",
  "- Create or reuse a dedicated branch named `agent/task-<taskId>-<slug>`.",
  "- Commit only task-owned files.",
  "- Push the branch.",
  "- Create or reuse a GitHub PR.",
  "- Include `gitBranchName`, `prUrl`, `prNumber`, `prStatus`, and `resultUrl` when recording the task result.",
  "",
  "If the project has no repo configured, do not attempt branch/PR work; record a clear result or blocker message instead.",
  "",
  "Do not mark tasks done unless the owner explicitly requested automatic completion.",
  "",
  "If a task becomes blocked or unsafe to continue, record a clear result or status for that task and continue with the next queued task only when it is independent and safe to do so.",
].join("\n");

const DEFAULT_SKILLS = [
  {
    slug: "task-heartbeat",
    title: "Task heartbeat",
    description: "Portable instructions for harnesses that execute requested Ready agent tasks from Skippy.",
    body: TASK_HEARTBEAT_BODY,
    visibility: "public" as const,
    version: 1,
  },
];

function fallbackSkill(slug: string) {
  return DEFAULT_SKILLS.find((skill) => skill.slug === slug) ?? null;
}

async function viewerBrainOrDefault(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    try {
      const { brain } = await requireOwnedBrain(ctx);
      return brain;
    } catch {
      // Fall through to the first brain so public skill pages remain readable locally.
    }
  }
  return await ctx.db.query("brainInstances").first();
}

async function currentSkill(db: any, brainInstanceId: string, slug: string) {
  return await db
    .query("harnessSkills")
    .withIndex("by_brain_slug_current", (q: any) =>
      q.eq("brainInstanceId", brainInstanceId).eq("slug", slug).eq("isCurrent", true),
    )
    .first();
}

function toPublicSkill(skill: any, fallback?: (typeof DEFAULT_SKILLS)[number]) {
  return {
    _id: skill?._id,
    slug: skill?.slug ?? fallback?.slug,
    title: skill?.title ?? fallback?.title,
    description: skill?.description ?? fallback?.description,
    body: skill?.body ?? fallback?.body,
    visibility: skill?.visibility ?? fallback?.visibility ?? "public",
    version: skill?.version ?? fallback?.version ?? 1,
    isDefault: !skill,
    updatedAt: skill?.updatedAt,
  };
}

export const listSkills = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const brain = await viewerBrainOrDefault(ctx);
    if (!brain) return DEFAULT_SKILLS.map((skill) => toPublicSkill(null, skill));

    const stored = await ctx.db
      .query("harnessSkills")
      .withIndex("by_brain_current", (q: any) => q.eq("brainInstanceId", brain._id).eq("isCurrent", true))
      .collect();
    const bySlug = new Map(stored.map((skill: any) => [skill.slug, skill]));
    const merged = DEFAULT_SKILLS.map((skill) => toPublicSkill(bySlug.get(skill.slug), skill));
    for (const skill of stored) {
      if (!DEFAULT_SKILLS.some((defaultSkill) => defaultSkill.slug === skill.slug)) {
        merged.push(toPublicSkill(skill));
      }
    }
    return merged.filter((skill) => skill.visibility === "public");
  },
});

export const getSkill = queryGeneric({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const slug = args.slug.trim();
    const fallback = fallbackSkill(slug);
    const brain = await viewerBrainOrDefault(ctx);
    if (!brain) return fallback ? toPublicSkill(null, fallback) : null;
    const stored = await currentSkill(ctx.db, brain._id, slug);
    const skill = toPublicSkill(stored, fallback ?? undefined);
    return skill.slug && skill.visibility === "public" ? skill : null;
  },
});

export const getSkillForBrain = queryGeneric({
  args: { brainInstanceId: v.id("brainInstances"), slug: v.string() },
  handler: async (ctx, args) => {
    const slug = args.slug.trim();
    const fallback = fallbackSkill(slug);
    const stored = await currentSkill(ctx.db, args.brainInstanceId, slug);
    return toPublicSkill(stored, fallback ?? undefined);
  },
});

export const listSkillVersions = queryGeneric({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const slug = args.slug.trim();
    const fallback = fallbackSkill(slug);
    const brain = await viewerBrainOrDefault(ctx);
    if (!brain) return fallback ? [toPublicSkill(null, fallback)] : [];

    const stored = await ctx.db
      .query("harnessSkills")
      .withIndex("by_brain_slug", (q: any) => q.eq("brainInstanceId", brain._id).eq("slug", slug))
      .collect();
    const publicStored = stored
      .filter((skill) => skill.visibility === "public")
      .sort((a, b) => b.version - a.version)
      .map((skill) => toPublicSkill(skill));

    if (publicStored.length > 0) return publicStored;
    return fallback ? [toPublicSkill(null, fallback)] : [];
  },
});

export const saveSkillForViewer = mutationGeneric({
  args: {
    slug: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    body: v.string(),
    visibility: v.optional(v.union(v.literal("public"), v.literal("private"))),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const slug = args.slug.trim();
    const title = args.title.trim();
    const body = args.body.trim();
    if (!slug) throw new Error("skill slug is required");
    if (!title) throw new Error("skill title is required");
    if (!body) throw new Error("skill body is required");

    const now = Date.now();
    const existing = await currentSkill(ctx.db, brain._id, slug);
    if (existing) {
      await ctx.db.patch(existing._id, { isCurrent: false, updatedAt: now });
    }

    const skillId = await ctx.db.insert("harnessSkills", {
      brainInstanceId: brain._id,
      slug,
      title,
      description: args.description?.trim() || undefined,
      body,
      visibility: args.visibility ?? existing?.visibility ?? fallbackSkill(slug)?.visibility ?? "public",
      version: (existing?.version ?? fallbackSkill(slug)?.version ?? 0) + 1,
      isCurrent: true,
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      entityRef: { entityType: "knowledgeObject", entityId: skillId },
      activityType: "harness_skill_updated",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Updated harness skill: ${title}`,
      metadata: { slug },
    });

    return { skillId, slug, status: "saved" };
  },
});
