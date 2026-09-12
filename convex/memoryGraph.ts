import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireOwnedBrain } from "./auth";
import { buildMindGraph, mindOwner, excludeArchivedProjectTasks } from "./mindGraphHelpers";

const entityType = v.union(
  v.literal("goal"),
  v.literal("project"),
  v.literal("task"),
  v.literal("note"),
  v.literal("person"),
  v.literal("company"),
  v.literal("link"),
  v.literal("knowledgeObject"),
);

const entityRef = v.object({
  entityType,
  entityId: v.string(),
});

const entityTableByType = {
  goal: "goals",
  project: "projects",
  task: "tasks",
  note: "knowledge",
  person: "people",
  company: "companies",
  link: "knowledge",
  knowledgeObject: "knowledge",
} as const;

const relationshipTypes = [
  "belongs_to",
  "supports",
  "related_to",
  "mentions",
  "assigned_to",
  "works_at",
  "client_of",
  "depends_on",
  "blocked_by",
  "waiting_on",
  "unblocks",
  "follow_up_with",
  "spawned_from",
] as const;

function clampLimit(value: number | undefined, fallback: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function refKey(ref: { entityType: string; entityId: string }) {
  return `${ref.entityType}:${ref.entityId}`;
}

function documentTitle(ref: { entityType: string; entityId: string }, document: any) {
  return (
    document?.title ??
    document?.name ??
    document?.url ??
    (typeof document?.body === "string" ? document.body.slice(0, 80) : undefined) ??
    ref.entityId
  );
}

function documentSummary(document: any) {
  return [
    document?.summary,
    document?.description,
    document?.body,
    document?.relationshipContext,
    document?.roleTitle,
    document?.notes,
    document?.domain,
    document?.website,
    document?.whyItMatters,
    document?.status,
    ...(document?.emails ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

function entityDisplay(ref: { entityType: string; entityId: string }, document: any) {
  return {
    ref,
    entity: document,
    title: documentTitle(ref, document),
    summary: documentSummary(document),
  };
}

function hasRef(memory: any, refs: Array<{ entityType: string; entityId: string }>) {
  const memoryRefs = new Set((memory.relatedEntityRefs ?? []).map((ref: any) => refKey(ref)));
  return refs.some((ref) => memoryRefs.has(refKey(ref)));
}

function sourceRefIdsForMemories(memories: any[]) {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const memory of memories) {
    for (const sourceRefId of memory.sourceRefIds ?? []) {
      const key = String(sourceRefId);
      if (!seen.has(key)) {
        seen.add(key);
        ids.push(key);
      }
    }
  }
  return ids;
}

async function acceptedRows(db: any, brainInstanceId: any, tableName: string, limit: number) {
  return await db
    .query(tableName)
    .withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brainInstanceId))
    .filter((q: any) => q.eq(q.field("processingState"), "accepted"))
    .take(limit);
}

async function sourceRefsById(db: any, brainInstanceId: any, ids: string[], limit: number) {
  const refs = [];
  for (const sourceRefId of ids.slice(0, limit)) {
    const sourceRef = await db.get(sourceRefId as any);
    if (sourceRef && sourceRef.brainInstanceId === brainInstanceId) {
      refs.push(sourceRef);
    }
  }
  return refs;
}

function queryTokens(value: string | undefined) {
  return Array.from(
    new Set(
      (value ?? "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 2),
    ),
  );
}

function textMatchesQuery(value: string, tokens: string[]) {
  const normalized = value.toLowerCase();
  return tokens.some((token) => normalized.includes(token));
}

function memorySearchText(memory: any) {
  return [memory.title, memory.summary, memory.body, memory.captureReason, memory.rubricDecision]
    .filter(Boolean)
    .join(" ");
}

function relatedMemoriesForQuestion(question: any, acceptedMemories: any[], limit: number) {
  const questionRefs = question.relatedEntityRefs ?? [];
  if (!questionRefs.length) {
    return [];
  }

  return acceptedMemories
    .filter((memory) => memory._id !== question._id && hasRef(memory, questionRefs))
    .slice(0, limit);
}

function relationshipTouches(ref: { entityType: string; entityId: string }, relationship: any) {
  return refKey(relationship.from) === refKey(ref) || refKey(relationship.to) === refKey(ref);
}

function relationshipOtherRef(ref: { entityType: string; entityId: string }, relationship: any) {
  return refKey(relationship.from) === refKey(ref) ? relationship.to : relationship.from;
}

async function entityForRef(db: any, brainInstanceId: any, ref: { entityType: keyof typeof entityTableByType; entityId: string }) {
  const tableName = entityTableByType[ref.entityType];
  const entity = tableName ? await db.get(ref.entityId as any) : null;
  if (!entity || entity.brainInstanceId !== brainInstanceId) {
    return null;
  }
  return entityDisplay(ref, entity);
}

export const contextualMapForViewer = queryGeneric({
  args: {
    query: v.optional(v.string()),
    focusRef: v.optional(entityRef),
    projectLimit: v.optional(v.number()),
    contactLimit: v.optional(v.number()),
    questionLimit: v.optional(v.number()),
    itemLimit: v.optional(v.number()),
    sourceLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const projectLimit = clampLimit(args.projectLimit, 6, 12);
    const contactLimit = clampLimit(args.contactLimit, 8, 16);
    const questionLimit = clampLimit(args.questionLimit, 6, 12);
    const itemLimit = clampLimit(args.itemLimit, 6, 12);
    const sourceLimit = clampLimit(args.sourceLimit, 8, 20);

    const [projects, tasks, people, companies, acceptedMemories] = await Promise.all([
      acceptedRows(ctx.db, brain._id, "projects", projectLimit),
      acceptedRows(ctx.db, brain._id, "tasks", 120),
      acceptedRows(ctx.db, brain._id, "people", contactLimit),
      acceptedRows(ctx.db, brain._id, "companies", contactLimit),
      ctx.db
        .query("knowledge")
        .withIndex("by_brain_kind_status", (q: any) =>
          q.eq("brainInstanceId", brain._id).eq("kind", "memory").eq("status", "accepted"),
        )
        .order("desc")
        .take(160),
    ]);

    const activeTasks = tasks.filter((task: any) => task.status !== "done" && task.status !== "cancelled");
    const relationshipGroups = await Promise.all(
      relationshipTypes.map((type) =>
        ctx.db
          .query("relationships")
          .withIndex("by_brain_type", (q: any) => q.eq("brainInstanceId", brain._id).eq("type", type))
          .take(120),
      ),
    );
    const relationships = relationshipGroups.flat();
    for (const memory of acceptedMemories) {
      memory.relatedEntityRefs = relationships
        .filter(
          (relationship) =>
            relationship.type === "mentions" &&
            relationship.from.entityType === "knowledgeObject" &&
            relationship.from.entityId === String(memory._id),
        )
        .map((relationship) => relationship.to);
    }

    const sourceRefCache = new Map<string, any>();
    async function hydrateSources(memories: any[]) {
      const refs = await sourceRefsById(ctx.db, brain._id, sourceRefIdsForMemories(memories), sourceLimit);
      for (const sourceRef of refs) {
        sourceRefCache.set(String(sourceRef._id), sourceRef);
      }
      return refs;
    }

    const taskById = new Map(activeTasks.map((task: any) => [String(task._id), task]));

    const projectMaps = [];
    for (const project of projects) {
      const projectRef = { entityType: "project", entityId: String(project._id) };
      const taskRefs = relationships
        .filter(
          (relationship) =>
            relationship.type === "belongs_to" &&
            relationship.from.entityType === "task" &&
            relationship.to.entityType === "project" &&
            relationship.to.entityId === String(project._id),
        )
        .map((relationship) => relationship.from.entityId);
      const projectTasks = taskRefs.map((taskId) => taskById.get(String(taskId))).filter(Boolean).slice(0, itemLimit);
      const relatedRefs = [projectRef, ...projectTasks.map((task: any) => ({ entityType: "task", entityId: String(task._id) }))];
      const memories = acceptedMemories.filter((memory: any) => hasRef(memory, relatedRefs)).slice(0, itemLimit);
      projectMaps.push({
        project,
        tasks: projectTasks,
        memories,
        sourceRefs: await hydrateSources(memories),
      });
    }

    const contactMaps = [];
    for (const contact of [
      ...people.map((entity: any) => ({ entityType: "person" as const, entity })),
      ...companies.map((entity: any) => ({ entityType: "company" as const, entity })),
    ].slice(0, contactLimit)) {
      const ref = { entityType: contact.entityType, entityId: String(contact.entity._id) };
      const contactRelationships = relationships.filter((relationship) => relationshipTouches(ref, relationship)).slice(0, itemLimit);
      const relatedEntities = [];
      for (const relationship of contactRelationships) {
        const related = await entityForRef(ctx.db, brain._id, relationshipOtherRef(ref, relationship) as any);
        if (related) {
          relatedEntities.push({ ...related, relationshipType: relationship.type });
        }
      }
      const memories = acceptedMemories.filter((memory: any) => hasRef(memory, [ref])).slice(0, itemLimit);
      contactMaps.push({
        ref,
        entity: contact.entity,
        title: documentTitle(ref, contact.entity),
        summary: documentSummary(contact.entity),
        relationships: contactRelationships,
        relatedEntities,
        memories,
        sourceRefs: await hydrateSources(memories),
      });
    }

    const questionMaps = [];
    for (const question of acceptedMemories.filter((memory: any) => memory.memoryType === "question").slice(0, questionLimit)) {
      const relatedMemories = relatedMemoriesForQuestion(question, acceptedMemories, itemLimit);
      const memories = [question, ...relatedMemories].slice(0, itemLimit + 1);
      questionMaps.push({
        question,
        relatedMemories,
        sourceRefs: await hydrateSources(memories),
      });
    }

    const tokens = queryTokens(args.query);
    const queryMatches = tokens.length
      ? acceptedMemories
          .filter((memory: any) => textMatchesQuery(memorySearchText(memory), tokens))
          .slice(0, itemLimit)
      : [];

    const focus = args.focusRef ? await entityForRef(ctx.db, brain._id, args.focusRef as any) : null;
    const focusMemories = args.focusRef
      ? acceptedMemories.filter((memory: any) => hasRef(memory, [args.focusRef as any])).slice(0, itemLimit)
      : [];

    return {
      brain,
      generatedAt: Date.now(),
      limits: { projectLimit, contactLimit, questionLimit, itemLimit, sourceLimit },
      query: args.query,
      focus,
      focusMemories,
      focusSourceRefs: await hydrateSources(focusMemories),
      projects: projectMaps,
      contacts: contactMaps,
      questions: questionMaps,
      queryMatches,
      querySourceRefs: await hydrateSources(queryMatches),
      sourceRefs: Array.from(sourceRefCache.values()).slice(0, sourceLimit * 4),
    };
  },
});

/** Bounded, owner-scoped data for the experimental 3D Mind page. No writes. */
export const mindMapForViewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain, user } = await requireOwnedBrain(ctx);
    const perType = 70;
    const tables = ["goals", "projects", "tasks", "people", "companies"] as const;
    const kinds = ["goal", "project", "task", "person", "company"] as const;
    const knowledgeKinds = ["note", "link", "knowledgeObject", "memory"] as const;
    const [entityGroups, knowledgeGroups, relationships] = await Promise.all([
      Promise.all(tables.map(table => ctx.db.query(table)
        .withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brain._id).eq("processingState", "accepted"))
        .filter(q => q.neq(q.field("status"), "archived"))
        .order("desc").take(perType + 1))),
      Promise.all(knowledgeKinds.map(kind => ctx.db.query("knowledge")
        .withIndex("by_brain_kind_state", (q: any) => q.eq("brainInstanceId", brain._id).eq("kind", kind).eq("processingState", "accepted"))
        .filter(q => q.and(q.neq(q.field("status"), "archived"), q.neq(q.field("reviewState"), "archived")))
        .order("desc").take(perType + 1))),
      ctx.db.query("relationships").withIndex("by_brain_type", q => q.eq("brainInstanceId", brain._id)).take(2501),
    ]);
    // Use endpoint lookups, not the capped display edge sample: a task's parent
    // may be archived (and therefore absent from the displayed projects).
    let parentLookupsLimited = false;
    const projectCache = new Map<string, Promise<{ brainInstanceId: string; status?: string; processingState?: string } | null>>();
    const visibleTasks = await excludeArchivedProjectTasks(entityGroups[2]!, async taskId => {
      const links = await ctx.db.query("relationships")
        .withIndex("by_brain_from", (q: any) => q.eq("brainInstanceId", brain._id).eq("from.entityId", taskId))
        .take(257);
      // Omit an unusually dense task rather than risk showing an unchecked parent.
      if (links.length > 256) {
        parentLookupsLimited = true;
        return [{ status: "archived" }];
      }
      const parents = links.filter(link => link.type === "belongs_to" && link.from.entityType === "task" && link.to.entityType === "project");
      const projects = await Promise.all(parents.map(link => {
        const id = ctx.db.normalizeId("projects", link.to.entityId);
        if (!id) return null;
        if (!projectCache.has(id)) projectCache.set(id, ctx.db.get(id));
        return projectCache.get(id)!;
      }));
      return projects.filter((project): project is NonNullable<typeof project> => project !== null && project.brainInstanceId === brain._id);
    });
    const graph = buildMindGraph([
      ...entityGroups.map((rows, i) => ({ kind: kinds[i]!, rows: (i === 2 ? visibleTasks : rows).slice(0, perType) })),
      ...knowledgeGroups.map((rows, i) => ({ kind: knowledgeKinds[i]!, rows: rows.slice(0, perType) })),
    ], relationships.slice(0, 2500), [...entityGroups, ...knowledgeGroups].some(rows => rows.length > perType) || relationships.length > 2500 || parentLookupsLimited);
    return { ...graph, owner: mindOwner(user, entityGroups[3]!.slice(0, perType)) };
  },
});
