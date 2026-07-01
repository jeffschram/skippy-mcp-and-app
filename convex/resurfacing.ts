import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireOwnedBrain } from "./auth";

const DAY_MS = 24 * 60 * 60 * 1000;
const ROUTINE_ORDER = [
  "stale_assumption",
  "open_question",
  "decision_revisit",
  "follow_up",
  "context_gap",
] as const;

const routineLabels: Record<(typeof ROUTINE_ORDER)[number], string> = {
  stale_assumption: "Stale assumptions",
  open_question: "Open questions",
  decision_revisit: "Decisions to revisit",
  follow_up: "People to follow up with",
  context_gap: "Project context gaps",
};

const entityTableByType = {
  goal: "goals",
  project: "projects",
  task: "tasks",
  note: "notes",
  person: "people",
  company: "companies",
  link: "links",
  knowledgeObject: "knowledgeObjects",
} as const;

type RoutineType = (typeof ROUTINE_ORDER)[number];
type EntityType = keyof typeof entityTableByType;
type RelatedRef =
  | { refType: "memory"; memoryId: string; label: string }
  | { refType: "entity"; entityType: EntityType | string; entityId: string; label: string }
  | { refType: "source"; sourceRefId: string; label: string };
type ContextSnippet = { label: string; text: string; sourceRefId?: string };
type Suggestion = {
  id: string;
  type: RoutineType;
  title: string;
  reason: string;
  recommendedAction: string;
  relatedRefs: RelatedRef[];
  contextSnippets: ContextSnippet[];
  ageDays?: number | undefined;
  score: number;
};

function clampLimit(value: number | undefined, fallback: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function ageDays(now: number, timestamp: number | undefined) {
  if (!timestamp) {
    return undefined;
  }
  return Math.max(0, Math.floor((now - timestamp) / DAY_MS));
}

function compactText(...values: unknown[]) {
  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .join(" ");
}

function snippet(value: string | undefined, maxLength = 220) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return undefined;
  }
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trim()}...` : cleaned;
}

function entityTitle(entity: any, fallback = "Untitled") {
  return (
    snippet(
      compactText(
        entity?.title,
        entity?.name,
        entity?.url,
        entity?.summary,
        entity?.description,
        entity?.body,
      ),
      90,
    ) ?? fallback
  );
}

function entitySummary(entity: any) {
  return snippet(
    compactText(
      entity?.summary,
      entity?.description,
      entity?.body,
      entity?.relationshipContext,
      entity?.notes,
      entity?.whyItMatters,
      entity?.roleTitle,
      entity?.status,
    ),
  );
}

function memoryRef(memory: any): RelatedRef {
  return { refType: "memory", memoryId: String(memory._id), label: memory.title };
}

function entityRef(entityType: EntityType | string, entity: any): RelatedRef {
  return { refType: "entity", entityType, entityId: String(entity._id), label: entityTitle(entity) };
}

function sourceRef(source: any): RelatedRef {
  return {
    refType: "source",
    sourceRefId: String(source._id),
    label: compactText(source.sourceSystem, source.externalId, source.url) || "source",
  };
}

function sourceSnippet(source: any): ContextSnippet | undefined {
  const text = snippet(compactText(source.summary, source.excerpt, source.url, ...(source.participants ?? [])));
  if (!text) {
    return undefined;
  }
  return {
    label: compactText(source.sourceSystem, source.externalId) || "Source",
    text,
    sourceRefId: String(source._id),
  };
}

async function sourceRefsForIds(db: any, brainInstanceId: any, sourceRefIds: any[] | undefined, limit = 3) {
  const refs = [];
  const seen = new Set<string>();
  for (const sourceRefId of sourceRefIds ?? []) {
    if (refs.length >= limit) {
      break;
    }
    const key = String(sourceRefId);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const source = await db.get(sourceRefId);
    if (source && source.brainInstanceId === brainInstanceId) {
      refs.push(source);
    }
  }
  return refs;
}

function hasAnyKeyword(text: string, keywords: string[]) {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

function sortSuggestions(left: Suggestion, right: Suggestion) {
  return (
    right.score - left.score ||
    (right.ageDays ?? 0) - (left.ageDays ?? 0) ||
    left.title.localeCompare(right.title)
  );
}

function addSuggestion(suggestions: Suggestion[], suggestion: Suggestion) {
  const key = `${suggestion.type}:${suggestion.title}:${suggestion.relatedRefs
    .map((ref) => JSON.stringify(ref))
    .join("|")}`;
  if (suggestions.some((existing) => existing.id === suggestion.id || existing.id === key)) {
    return;
  }
  suggestions.push({ ...suggestion, id: suggestion.id || key });
}

function reviewThresholdDays(cadence: string | undefined) {
  switch (cadence) {
    case "daily":
      return { assumption: 21, decision: 21, followUp: 14, project: 14 };
    case "weekly":
      return { assumption: 45, decision: 35, followUp: 21, project: 30 };
    case "active_context":
      return { assumption: 30, decision: 30, followUp: 14, project: 21 };
    case "manual":
    default:
      return { assumption: 75, decision: 60, followUp: 30, project: 45 };
  }
}

async function acceptedEntities(db: any, brainInstanceId: any, tableName: string, limit: number) {
  return await db
    .query(tableName)
    .withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brainInstanceId))
    .filter((q: any) => q.eq(q.field("processingState"), "accepted"))
    .take(limit);
}

async function acceptedMemories(db: any, brainInstanceId: any, limit: number) {
  return await db
    .query("memories")
    .withIndex("by_brain_updated", (q: any) => q.eq("brainInstanceId", brainInstanceId))
    .order("desc")
    .filter((q: any) => q.eq(q.field("status"), "accepted"))
    .take(limit);
}

export const reviewSuggestionsForViewer = queryGeneric({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const now = Date.now();
    const limit = clampLimit(args.limit, 35, 50);
    const config = await ctx.db
      .query("brainConfigs")
      .withIndex("by_brain", (q) => q.eq("brainInstanceId", brain._id))
      .first();
    const thresholds = reviewThresholdDays(config?.recallPreferences?.cadence);

    const [memories, projects, tasks, people, followUpRelationships, waitingRelationships] = await Promise.all([
      acceptedMemories(ctx.db, brain._id, 220),
      acceptedEntities(ctx.db, brain._id, "projects", 90),
      acceptedEntities(ctx.db, brain._id, "tasks", 180),
      acceptedEntities(ctx.db, brain._id, "people", 120),
      ctx.db
        .query("relationships")
        .withIndex("by_brain_type", (q) => q.eq("brainInstanceId", brain._id))
        .filter((q) => q.eq(q.field("type"), "follow_up_with"))
        .take(80),
      ctx.db
        .query("relationships")
        .withIndex("by_brain_type", (q) => q.eq("brainInstanceId", brain._id))
        .filter((q) => q.eq(q.field("type"), "waiting_on"))
        .take(80),
    ]);

    const suggestions: Suggestion[] = [];
    const sourceContexts = new Map<string, any>();

    for (const memory of memories) {
      const text = compactText(memory.title, memory.summary, memory.body, memory.captureReason, memory.rubricDecision);
      const memoryAge = ageDays(now, memory.updatedAt ?? memory.acceptedAt ?? memory.createdAt);
      const sourceRefs = await sourceRefsForIds(ctx.db, brain._id, memory.sourceRefIds, 2);
      for (const source of sourceRefs) {
        sourceContexts.set(String(source._id), source);
      }
      const contextSnippets = [
        { label: "Memory", text: snippet(compactText(memory.summary, memory.body)) ?? memory.title },
        ...sourceRefs.map(sourceSnippet).filter((item): item is ContextSnippet => Boolean(item)),
      ];
      const relatedRefs = [
        memoryRef(memory),
        ...sourceRefs.map(sourceRef),
        ...((memory.relatedEntityRefs ?? []) as Array<{ entityType: string; entityId: string }>).slice(0, 3).map((ref) => ({
          refType: "entity" as const,
          entityType: ref.entityType,
          entityId: ref.entityId,
          label: ref.entityType,
        })),
      ];

      if (
        memory.memoryType !== "decision" &&
        memory.memoryType !== "question" &&
        (memoryAge ?? 0) >= thresholds.assumption &&
        hasAnyKeyword(text, ["assume", "assumption", "expect", "probably", "likely", "default", "usually", "believe"])
      ) {
        addSuggestion(suggestions, {
          id: `stale-assumption:${memory._id}`,
          type: "stale_assumption",
          title: `Re-check: ${memory.title}`,
          reason: `This accepted ${memory.memoryType} is ${memoryAge} days old and reads like an assumption.`,
          recommendedAction: "Confirm whether this is still true, update the memory, or archive it if it no longer applies.",
          relatedRefs,
          contextSnippets,
          ageDays: memoryAge,
          score: 80 + (memoryAge ?? 0),
        });
      }

      if (memory.memoryType === "question") {
        addSuggestion(suggestions, {
          id: `open-question:${memory._id}`,
          type: "open_question",
          title: memory.title,
          reason: "This question is accepted in the knowledge base and has no explicit answered/closed state yet.",
          recommendedAction: "Answer it, link it to the project or decision it affects, or archive it if it is no longer useful.",
          relatedRefs,
          contextSnippets,
          ageDays: memoryAge,
          score: 70 + (memoryAge ?? 0),
        });
      }

      if (
        memory.memoryType === "decision" &&
        ((memoryAge ?? 0) >= thresholds.decision ||
          hasAnyKeyword(text, ["revisit", "temporary", "for now", "later", "until", "trial", "experiment"]))
      ) {
        addSuggestion(suggestions, {
          id: `decision-revisit:${memory._id}`,
          type: "decision_revisit",
          title: `Revisit decision: ${memory.title}`,
          reason: hasAnyKeyword(text, ["revisit", "temporary", "for now", "later", "until", "trial", "experiment"])
            ? "The decision text suggests it was provisional or time-bound."
            : `This decision has not been touched in ${memoryAge} days.`,
          recommendedAction: "Decide whether to keep, revise, supersede, or record the outcome of this decision.",
          relatedRefs,
          contextSnippets,
          ageDays: memoryAge,
          score: 75 + (memoryAge ?? 0),
        });
      }

      if ((memory.sourceRefIds ?? []).length === 0 && ["decision", "principle", "insight"].includes(memory.memoryType)) {
        addSuggestion(suggestions, {
          id: `memory-source-gap:${memory._id}`,
          type: "context_gap",
          title: `Add source context: ${memory.title}`,
          reason: `This ${memory.memoryType} has no source reference attached.`,
          recommendedAction: "Attach the conversation, document, or note that explains where this came from.",
          relatedRefs: [memoryRef(memory)],
          contextSnippets: [{ label: "Memory", text: snippet(compactText(memory.summary, memory.body)) ?? memory.title }],
          ageDays: memoryAge,
          score: 50 + (memoryAge ?? 0),
        });
      }
    }

    const activeTasks = tasks.filter((task: any) => !["done", "cancelled"].includes(task.status));
    const activeProjectIdsWithTasks = new Set<string>();
    const projectRelationshipTypes = new Set(["belongs_to", "supports", "related_to"]);
    const projectRelationships = await ctx.db
      .query("relationships")
      .withIndex("by_brain_type", (q) => q.eq("brainInstanceId", brain._id))
      .take(220);
    for (const relationship of projectRelationships) {
      if (!projectRelationshipTypes.has(relationship.type)) {
        continue;
      }
      const refs = [relationship.from, relationship.to];
      const projectRef = refs.find((ref: any) => ref?.entityType === "project");
      const taskRef = refs.find((ref: any) => ref?.entityType === "task");
      if (projectRef && taskRef) {
        activeProjectIdsWithTasks.add(String(projectRef.entityId));
      }
    }

    for (const project of projects) {
      if (["completed", "cancelled", "archived"].includes(project.status)) {
        continue;
      }
      const projectAge = ageDays(now, project.updatedAt ?? project.createdAt);
      const missingSummary = !project.summary?.trim();
      const noLinkedTasks = !activeProjectIdsWithTasks.has(String(project._id));
      if (!missingSummary && !noLinkedTasks && (projectAge ?? 0) < thresholds.project) {
        continue;
      }
      const reasons = [
        missingSummary ? "it has no summary" : undefined,
        noLinkedTasks ? "no active tasks are linked by relationships" : undefined,
        (projectAge ?? 0) >= thresholds.project ? `it has not changed in ${projectAge} days` : undefined,
      ].filter(Boolean);
      addSuggestion(suggestions, {
        id: `project-context:${project._id}`,
        type: "context_gap",
        title: `Refresh project context: ${project.title}`,
        reason: `This ${project.status} project may need context because ${reasons.join(", ")}.`,
        recommendedAction: "Add or update the project summary, link the next active task, or mark the project paused/completed.",
        relatedRefs: [entityRef("project", project)],
        contextSnippets: [{ label: "Project", text: entitySummary(project) ?? project.title }],
        ageDays: projectAge,
        score: 60 + (projectAge ?? 0) + (missingSummary ? 20 : 0) + (noLinkedTasks ? 15 : 0),
      });
    }

    const relationshipSuggestions = [...followUpRelationships, ...waitingRelationships];
    for (const relationship of relationshipSuggestions) {
      const refs = [relationship.from, relationship.to].filter(Boolean);
      const hydratedRefs = [];
      for (const ref of refs) {
        const tableName = entityTableByType[ref.entityType as EntityType];
        const entity = tableName ? await ctx.db.get(ref.entityId as any) : null;
        if (entity && entity.brainInstanceId === brain._id) {
          hydratedRefs.push({ ref, entity });
        }
      }
      const person = hydratedRefs.find((item) => item.ref.entityType === "person");
      const subject = hydratedRefs.find((item) => item.ref.entityType !== "person") ?? hydratedRefs[0];
      if (!person || !subject) {
        continue;
      }
      addSuggestion(suggestions, {
        id: `relationship-follow-up:${relationship._id}`,
        type: "follow_up",
        title: `Follow up with ${entityTitle(person.entity)}`,
        reason: relationship.reason ?? `A ${relationship.type.replace(/_/g, " ")} relationship links this person to ${entityTitle(subject.entity)}.`,
        recommendedAction: "Check in, update the relationship, or convert the follow-up into an explicit task if it still matters.",
        relatedRefs: hydratedRefs.map((item) => entityRef(item.ref.entityType, item.entity)),
        contextSnippets: [
          { label: entityTitle(subject.entity), text: entitySummary(subject.entity) ?? entityTitle(subject.entity) },
          { label: entityTitle(person.entity), text: entitySummary(person.entity) ?? entityTitle(person.entity) },
        ],
        ageDays: ageDays(now, relationship.updatedAt ?? relationship.createdAt),
        score: 85 + (ageDays(now, relationship.updatedAt ?? relationship.createdAt) ?? 0),
      });
    }

    for (const task of activeTasks) {
      const taskAge = ageDays(now, task.updatedAt ?? task.createdAt);
      const overdue = typeof task.dueAt === "number" && task.dueAt < now;
      if (task.status !== "waiting" && !overdue) {
        continue;
      }
      addSuggestion(suggestions, {
        id: `task-follow-up:${task._id}`,
        type: "follow_up",
        title: task.status === "waiting" ? `Unblock waiting task: ${task.title}` : `Review overdue task: ${task.title}`,
        reason: task.status === "waiting" ? "This accepted task is marked waiting." : "This accepted task is past its due date.",
        recommendedAction: "Follow up with the owner/source, update the status, or record what is blocking it.",
        relatedRefs: [entityRef("task", task)],
        contextSnippets: [{ label: "Task", text: entitySummary(task) ?? task.title }],
        ageDays: taskAge,
        score: 78 + (taskAge ?? 0) + (overdue ? 20 : 0),
      });
    }

    for (const person of people) {
      const personAge = ageDays(now, person.updatedAt ?? person.createdAt);
      if (!person.favorite || (personAge ?? 0) < thresholds.followUp) {
        continue;
      }
      addSuggestion(suggestions, {
        id: `favorite-person-follow-up:${person._id}`,
        type: "follow_up",
        title: `Check in with ${person.name}`,
        reason: `This favorite contact has not been updated in ${personAge} days.`,
        recommendedAction: "Reach out or update the relationship notes if the context has changed.",
        relatedRefs: [entityRef("person", person)],
        contextSnippets: [{ label: "Relationship context", text: entitySummary(person) ?? person.name }],
        ageDays: personAge,
        score: 45 + (personAge ?? 0),
      });
    }

    if (!config?.recallPreferences) {
      addSuggestion(suggestions, {
        id: "settings-recall-context-gap",
        type: "context_gap",
        title: "Choose a recall cadence",
        reason: "Second-brain recall preferences are not configured yet.",
        recommendedAction: "Set whether resurfacing should be manual, daily, weekly, or active-context based.",
        relatedRefs: [],
        contextSnippets: [{ label: "Settings", text: "Recall cadence is currently unset." }],
        score: 65,
      });
    }

    const limitedSuggestions = suggestions.sort(sortSuggestions).slice(0, limit);
    const groupedSuggestions = ROUTINE_ORDER.map((type) => ({
      type,
      label: routineLabels[type],
      suggestions: limitedSuggestions.filter((suggestion) => suggestion.type === type).sort(sortSuggestions),
    }));

    return {
      generatedAt: now,
      brainInstanceId: brain._id,
      recallCadence: config?.recallPreferences?.cadence ?? "unset",
      limits: {
        requested: limit,
        memories: 220,
        projects: 90,
        tasks: 180,
        people: 120,
        relationships: 160,
      },
      sourceContextCount: sourceContexts.size,
      suggestions: limitedSuggestions,
      groups: groupedSuggestions,
      empty: limitedSuggestions.length === 0,
    };
  },
});
