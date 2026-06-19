import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import {
  GOAL_STATUSES,
  LINK_STATUSES,
  PROJECT_STATUSES,
  TASK_STATUSES,
  candidateFingerprint,
  normalizeAcceptedEntityPayload,
} from "@skippy/shared";
import { requireOwnedBrain } from "./auth";

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

const entityEmbeddingInput = {
  brainInstanceId: v.id("brainInstances"),
  entityRef,
  canonicalText: v.string(),
  textHash: v.string(),
  embedding: v.array(v.float64()),
  embeddingProvider: v.string(),
  embeddingModel: v.string(),
  embeddingVersion: v.optional(v.string()),
};

const sourceRefInput = v.object({
  sourceSystem: v.string(),
  externalId: v.optional(v.string()),
  threadId: v.optional(v.string()),
  messageId: v.optional(v.string()),
  eventId: v.optional(v.string()),
  reminderId: v.optional(v.string()),
  sourceTimestamp: v.optional(v.number()),
  participants: v.optional(v.array(v.string())),
  url: v.optional(v.string()),
  deepLink: v.optional(v.string()),
  excerpt: v.optional(v.string()),
  summary: v.optional(v.string()),
});

const priorityArgs = {
  priorityScore: v.optional(v.number()),
  urgencyScore: v.optional(v.number()),
  importanceScore: v.optional(v.number()),
  priorityReason: v.optional(v.string()),
  priorityComputedAt: v.optional(v.number()),
  priorityPolicyVersion: v.optional(v.string()),
};

const entityReviewType = v.union(
  v.literal("general"),
  v.literal("stale_check"),
  v.literal("priority_update"),
  v.literal("blocker_check"),
  v.literal("follow_up"),
  v.literal("status_check"),
);

const candidatePayload = v.any();

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

function statusAllowedForEntity(entityTypeName: keyof typeof entityTableByType, status: string | undefined) {
  if (!status) {
    return undefined;
  }

  switch (entityTypeName) {
    case "goal":
      return (GOAL_STATUSES as readonly string[]).includes(status) ? status : undefined;
    case "project":
      return (PROJECT_STATUSES as readonly string[]).includes(status) ? status : undefined;
    case "task":
      return (TASK_STATUSES as readonly string[]).includes(status) ? status : undefined;
    case "link":
      return (LINK_STATUSES as readonly string[]).includes(status) ? status : undefined;
    default:
      return undefined;
  }
}

function normalizedTaskMatchText(value: string | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(incoming|the|a|an|to|and|or|whether|keep|decide|review|track|incoming)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function taskTitleLooksDuplicate(left: string, right: string) {
  const normalizedLeft = normalizedTaskMatchText(left);
  const normalizedRight = normalizedTaskMatchText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return true;
  }

  const leftWords = new Set(normalizedLeft.split(" "));
  const rightWords = new Set(normalizedRight.split(" "));
  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftWords.size, rightWords.size) >= 0.55 || overlap / Math.min(leftWords.size, rightWords.size) >= 0.75;
}

async function createAcceptedEntity(
  db: any,
  triageItem: any,
  entityTypeName: keyof typeof entityTableByType,
  payload: any,
  now: number,
) {
  const tableName = entityTableByType[entityTypeName];
  const sourceRefIds = triageItem.sourceRefIds ?? [];
  const normalizedPayload = normalizeAcceptedEntityPayload(entityTypeName, payload);
  const entityDocument = {
    ...normalizedPayload,
    brainInstanceId: triageItem.brainInstanceId,
    processingState: "accepted",
    confidence: triageItem.confidence,
    reviewReason: triageItem.reviewReason,
    createdAt: now,
    updatedAt: now,
  };

  const entityId = await db.insert(tableName, entityDocument);

  for (const sourceRefId of sourceRefIds) {
    await db.insert("entitySourceRefs", {
      brainInstanceId: triageItem.brainInstanceId,
      entityRef: { entityType: entityTypeName, entityId },
      sourceRefId,
      relationship: "created_from",
      createdAt: now,
    });
  }

  return { entityRef: { entityType: entityTypeName, entityId }, sourceRefIds, normalizedPayload };
}

async function insertSourceRefs(db: any, brainInstanceId: any, sourceRefs: any[] | undefined, now: number) {
  const sourceRefIds = [];
  for (const sourceRef of sourceRefs ?? []) {
    sourceRefIds.push(
      await db.insert("sourceRefs", {
        brainInstanceId,
        ...sourceRef,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
  return sourceRefIds;
}

async function cancelDuplicateFocusCreatedTasks(db: any, brainInstanceId: any, actorId?: string) {
  const now = Date.now();
  const activeTasks = (
    await db
      .query("tasks")
      .withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brainInstanceId))
      .filter((q: any) => q.eq(q.field("processingState"), "accepted"))
      .take(200)
  ).filter((task: any) => task.status !== "done" && task.status !== "cancelled");
  const focusCreatedTasks = activeTasks.filter(
    (task: any) => task.description === "Created from a Home focus bullet." || task.priorityReason === "Promoted from current focus.",
  );
  const ordinaryTasks = activeTasks.filter((task: any) => !focusCreatedTasks.some((focusTask: any) => focusTask._id === task._id));
  const cancelled: Array<{ duplicateTaskId: string; keptTaskId: string; title: string }> = [];

  for (const focusTask of focusCreatedTasks) {
    const matchingTask = ordinaryTasks.find((task: any) => taskTitleLooksDuplicate(focusTask.title, task.title));
    if (!matchingTask) {
      continue;
    }

    await db.patch(focusTask._id, {
      status: "cancelled",
      updatedAt: now,
    });
    const focusActions = await db
      .query("focusItemActions")
      .withIndex("by_brain_item", (q: any) => q.eq("brainInstanceId", brainInstanceId))
      .filter((q: any) => q.eq(q.field("taskId"), focusTask._id))
      .collect();
    for (const action of focusActions) {
      await db.patch(action._id, {
        taskId: matchingTask._id,
        updatedAt: now,
      });
    }

    await db.insert("activityEvents", {
      brainInstanceId,
      entityRef: { entityType: "task", entityId: focusTask._id },
      activityType: "duplicate_focus_task_cancelled",
      actorType: actorId ? "user" : "system",
      actorId,
      timestamp: now,
      summary: `Cancelled duplicate focus-created task: ${focusTask.title}`,
      metadata: { keptTaskId: matchingTask._id, keptTitle: matchingTask.title },
    });

    cancelled.push({ duplicateTaskId: focusTask._id, keptTaskId: matchingTask._id, title: focusTask.title });
  }

  return { status: "completed", cancelledCount: cancelled.length, cancelled };
}

export const addSourceRef = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    sourceRef: sourceRefInput,
  },
  handler: async ({ db }, { brainInstanceId, sourceRef }) => {
    const now = Date.now();
    return await db.insert("sourceRefs", {
      brainInstanceId,
      ...sourceRef,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const linkEntities = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    from: entityRef,
    to: entityRef,
    type: v.union(
      v.literal("belongs_to"),
      v.literal("supports"),
      v.literal("related_to"),
      v.literal("mentions"),
      v.literal("assigned_to"),
      v.literal("works_at"),
      v.literal("client_of"),
      v.literal("depends_on"),
      v.literal("blocked_by"),
      v.literal("waiting_on"),
      v.literal("unblocks"),
      v.literal("follow_up_with"),
      v.literal("spawned_from"),
    ),
    confidence: v.optional(v.number()),
    reason: v.optional(v.string()),
    createdBy: v.union(v.literal("user"), v.literal("harness"), v.literal("skippy_ai"), v.literal("system")),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    const relationshipId = await db.insert("relationships", {
      brainInstanceId: args.brainInstanceId,
      from: args.from,
      to: args.to,
      type: args.type,
      confidence: args.confidence,
      reason: args.reason,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      entityRef: args.from,
      activityType: "relationship_created",
      actorType: args.createdBy,
      timestamp: now,
      summary: `Linked ${args.from.entityType} to ${args.to.entityType} with ${args.type}.`,
      metadata: { relationshipId, to: args.to },
    });

    return { relationshipId };
  },
});

export const submitCandidateObject = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    candidateEntityType: entityType,
    candidatePayload,
    confidence: v.optional(v.number()),
    reviewReason: v.optional(v.string()),
    sourceRefIds: v.optional(v.array(v.id("sourceRefs"))),
    sourceRefs: v.optional(v.array(sourceRefInput)),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    const normalizedPayload = normalizeAcceptedEntityPayload(args.candidateEntityType, args.candidatePayload);
    const fingerprint = candidateFingerprint(args.candidateEntityType, normalizedPayload);
    const existingPendingItem = await db
      .query("triageItems")
      .withIndex("by_brain_fingerprint", (q) => q.eq("brainInstanceId", args.brainInstanceId))
      .filter((q) =>
        q.and(q.eq(q.field("candidateFingerprint"), fingerprint), q.eq(q.field("status"), "pending")),
      )
      .first();
    const sourceRefIds = [...(args.sourceRefIds ?? [])];

    for (const sourceRef of args.sourceRefs ?? []) {
      sourceRefIds.push(
        await db.insert("sourceRefs", {
          brainInstanceId: args.brainInstanceId,
          ...sourceRef,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    if (existingPendingItem) {
      const mergedSourceRefIds = Array.from(new Set([...(existingPendingItem.sourceRefIds ?? []), ...sourceRefIds]));
      await db.patch(existingPendingItem._id, {
        sourceRefIds: mergedSourceRefIds,
        updatedAt: now,
      });

      await db.insert("activityEvents", {
        brainInstanceId: args.brainInstanceId,
        activityType: "candidate_duplicate_detected",
        actorType: "harness",
        timestamp: now,
        summary: `Duplicate suggested ${args.candidateEntityType} matched an existing pending triage item.`,
        metadata: {
          triageItemId: existingPendingItem._id,
          candidateFingerprint: fingerprint,
        },
        sourceRefIds,
      });

      return {
        triageItemId: existingPendingItem._id,
        sourceRefIds: mergedSourceRefIds,
        duplicate: true,
        status: "duplicate_pending",
        candidateFingerprint: fingerprint,
      };
    }

    const triageItemId = await db.insert("triageItems", {
      brainInstanceId: args.brainInstanceId,
      candidateEntityType: args.candidateEntityType,
      candidatePayload: normalizedPayload,
      candidateFingerprint: fingerprint,
      status: "pending",
      confidence: args.confidence,
      reviewReason: args.reviewReason,
      sourceRefIds,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      activityType: "candidate_submitted",
      actorType: "harness",
      timestamp: now,
      summary: `Suggested ${args.candidateEntityType} submitted for triage.`,
      metadata: { triageItemId, candidateFingerprint: fingerprint },
      sourceRefIds,
    });

    return { triageItemId, sourceRefIds, duplicate: false, status: "submitted_for_review", candidateFingerprint: fingerprint };
  },
});

export const ingestObject = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    candidateEntityType: entityType,
    candidatePayload,
    confidence: v.optional(v.number()),
    reviewReason: v.optional(v.string()),
    rubricDecision: v.string(),
    sourceRefIds: v.optional(v.array(v.id("sourceRefs"))),
    sourceRefs: v.optional(v.array(sourceRefInput)),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    const entityTypeName = args.candidateEntityType as keyof typeof entityTableByType;
    const normalizedPayload = normalizeAcceptedEntityPayload(entityTypeName, args.candidatePayload);
    const displayPayload = normalizedPayload as Record<string, any>;
    const sourceRefIds = [
      ...(args.sourceRefIds ?? []),
      ...(await insertSourceRefs(db, args.brainInstanceId, args.sourceRefs, now)),
    ];
    const entityDocument = {
      ...normalizedPayload,
      brainInstanceId: args.brainInstanceId,
      processingState: "accepted",
      confidence: args.confidence,
      reviewReason: args.reviewReason ?? args.rubricDecision,
      createdAt: now,
      updatedAt: now,
    };
    const tableName = entityTableByType[entityTypeName];
    const entityId = await db.insert(tableName, entityDocument);
    const acceptedEntityRef = { entityType: entityTypeName, entityId };

    for (const sourceRefId of sourceRefIds) {
      await db.insert("entitySourceRefs", {
        brainInstanceId: args.brainInstanceId,
        entityRef: acceptedEntityRef,
        sourceRefId,
        relationship: "created_from",
        createdAt: now,
      });
    }

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      entityRef: acceptedEntityRef,
      activityType: "object_ingested",
      actorType: "harness",
      timestamp: now,
      summary: `Ingested ${entityTypeName} directly by importance rubric.`,
      metadata: {
        rubricDecision: args.rubricDecision,
        candidateFingerprint: candidateFingerprint(entityTypeName, normalizedPayload),
      },
      sourceRefIds,
    });

    return {
      status: "accepted",
      entityType: entityTypeName,
      entityId,
      title: displayPayload.title ?? displayPayload.name ?? displayPayload.url ?? displayPayload.body,
      sourceRefIds,
      rubricDecision: args.rubricDecision,
    };
  },
});

export const approveTriageItem = mutationGeneric({
  args: {
    triageItemId: v.id("triageItems"),
    reviewedBy: v.optional(v.id("users")),
    correctedPayload: v.optional(v.any()),
  },
  handler: async ({ db }, { triageItemId, reviewedBy, correctedPayload }) => {
    const triageItem = await db.get(triageItemId);
    if (!triageItem) {
      throw new Error("triage item not found");
    }
    if (triageItem.status !== "pending") {
      throw new Error("triage item has already been reviewed");
    }

    const now = Date.now();
    const entityTypeName = triageItem.candidateEntityType as keyof typeof entityTableByType;
    const payload = correctedPayload ?? triageItem.candidatePayload;
    const {
      entityRef: acceptedEntityRef,
      sourceRefIds,
      normalizedPayload,
    } = await createAcceptedEntity(
      db,
      triageItem,
      entityTypeName,
      payload,
      now,
    );

    await db.patch(triageItemId, {
      candidateEntityId: acceptedEntityRef.entityId,
      candidatePayload: normalizedPayload,
      status: correctedPayload ? "corrected" : "approved",
      reviewedBy,
      reviewedAt: now,
      updatedAt: now,
    });

    await db.insert("activityEvents", {
      brainInstanceId: triageItem.brainInstanceId,
      entityRef: acceptedEntityRef,
      activityType: correctedPayload ? "triage_corrected" : "triage_approved",
      actorType: "user",
      actorId: reviewedBy,
      timestamp: now,
      summary: `Accepted suggested ${entityTypeName}.`,
      sourceRefIds,
    });

    return { entityRef: acceptedEntityRef };
  },
});

export const reviewTriageItem = mutationGeneric({
  args: {
    triageItemId: v.id("triageItems"),
    action: v.union(
      v.literal("approve"),
      v.literal("reject"),
      v.literal("correct"),
      v.literal("merge"),
      v.literal("reclassify"),
    ),
    correctedPayload: v.optional(v.any()),
    targetEntityType: v.optional(entityType),
    mergeTarget: v.optional(entityRef),
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const triageItem = await ctx.db.get(args.triageItemId);
    if (!triageItem || triageItem.brainInstanceId !== brain._id) {
      throw new Error("triage item not found");
    }
    if (triageItem.status !== "pending") {
      throw new Error("triage item has already been reviewed");
    }

    const now = Date.now();
    if (args.action === "reject") {
      await ctx.db.patch(args.triageItemId, {
        status: "rejected",
        reviewedBy: user._id,
        reviewedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("activityEvents", {
        brainInstanceId: brain._id,
        activityType: "triage_rejected",
        actorType: "user",
        actorId: user._id,
        timestamp: now,
        summary: `Rejected suggested ${triageItem.candidateEntityType}.`,
        metadata: { rejectionReason: args.rejectionReason },
        sourceRefIds: triageItem.sourceRefIds,
      });
      return { triageItemId: args.triageItemId };
    }

    if (args.action === "merge") {
      if (!args.mergeTarget) {
        throw new Error("mergeTarget is required");
      }
      await ctx.db.patch(args.triageItemId, {
        status: "merged",
        candidateEntityId: args.mergeTarget.entityId,
        reviewedBy: user._id,
        reviewedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("activityEvents", {
        brainInstanceId: brain._id,
        entityRef: args.mergeTarget,
        activityType: "triage_merged",
        actorType: "user",
        actorId: user._id,
        timestamp: now,
        summary: `Merged suggested ${triageItem.candidateEntityType}.`,
        metadata: { triageItemId: args.triageItemId },
        sourceRefIds: triageItem.sourceRefIds,
      });
      return { entityRef: args.mergeTarget };
    }

    const entityTypeName = (args.action === "reclassify"
      ? args.targetEntityType
      : triageItem.candidateEntityType) as keyof typeof entityTableByType | undefined;
    if (!entityTypeName) {
      throw new Error("targetEntityType is required");
    }

    const payload = args.correctedPayload ?? triageItem.candidatePayload;
    const {
      entityRef: acceptedEntityRef,
      sourceRefIds,
      normalizedPayload,
    } = await createAcceptedEntity(
      ctx.db,
      triageItem,
      entityTypeName,
      payload,
      now,
    );

    const status = args.action === "approve" ? "approved" : "corrected";
    await ctx.db.patch(args.triageItemId, {
      candidateEntityType: entityTypeName,
      candidateEntityId: acceptedEntityRef.entityId,
      candidatePayload: normalizedPayload,
      status,
      reviewedBy: user._id,
      reviewedAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      entityRef: acceptedEntityRef,
      activityType:
        args.action === "reclassify"
          ? "triage_reclassified"
          : args.action === "correct"
            ? "triage_corrected"
            : "triage_approved",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Accepted suggested ${entityTypeName}.`,
      sourceRefIds,
    });

    return { entityRef: acceptedEntityRef };
  },
});

export const rejectTriageItem = mutationGeneric({
  args: {
    triageItemId: v.id("triageItems"),
    reviewedBy: v.optional(v.id("users")),
    rejectionReason: v.optional(v.string()),
  },
  handler: async ({ db }, { triageItemId, reviewedBy, rejectionReason }) => {
    const triageItem = await db.get(triageItemId);
    if (!triageItem) {
      throw new Error("triage item not found");
    }
    if (triageItem.status !== "pending") {
      throw new Error("triage item has already been reviewed");
    }

    const now = Date.now();
    await db.patch(triageItemId, {
      status: "rejected",
      reviewedBy,
      reviewedAt: now,
      updatedAt: now,
    });

    await db.insert("activityEvents", {
      brainInstanceId: triageItem.brainInstanceId,
      activityType: "triage_rejected",
      actorType: "user",
      actorId: reviewedBy,
      timestamp: now,
      summary: `Rejected suggested ${triageItem.candidateEntityType}.`,
      metadata: { rejectionReason },
      sourceRefIds: triageItem.sourceRefIds,
    });

    return { triageItemId };
  },
});

export const listPendingTriage = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    limit: v.optional(v.number()),
  },
  handler: async ({ db }, { brainInstanceId, limit }) => {
    return await db
      .query("triageItems")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brainInstanceId), q.eq(q.field("status"), "pending")),
      )
      .take(limit ?? 50);
  },
});

export const dashboardForViewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const acceptedFilter = (q: any) =>
      q.and(q.eq(q.field("brainInstanceId"), brain._id), q.eq(q.field("processingState"), "accepted"));
    const focusSummary = await ctx.db
      .query("focusSummaries")
      .filter((q) => q.eq(q.field("brainInstanceId"), brain._id))
      .order("desc")
      .first();
    const focusItemActions = focusSummary
      ? await ctx.db
          .query("focusItemActions")
          .withIndex("by_brain_focus", (q) => q.eq("brainInstanceId", brain._id))
          .filter((q) => q.eq(q.field("focusSummaryId"), focusSummary._id))
          .collect()
      : [];
    const triageItems = await ctx.db
      .query("triageItems")
      .filter((q) => q.and(q.eq(q.field("brainInstanceId"), brain._id), q.eq(q.field("status"), "pending")))
      .take(20);
    const pendingActions = await ctx.db
      .query("pendingActions")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brain._id), q.eq(q.field("status"), "pending_approval")),
      )
      .take(20);
    const projects = (
      await ctx.db
        .query("projects")
        .filter(acceptedFilter)
        .take(20)
    ).filter((project) => project.status !== "completed" && project.status !== "cancelled");
    const tasks = (
      await ctx.db
      .query("tasks")
        .filter(acceptedFilter)
        .take(20)
    ).filter((task) => task.status !== "done" && task.status !== "cancelled");
    const people = await ctx.db.query("people").filter(acceptedFilter).take(20);
    const companies = await ctx.db.query("companies").filter(acceptedFilter).take(20);
    const links = (
      await ctx.db.query("links").filter(acceptedFilter).take(20)
    ).filter((link) => link.status !== "discarded");
    const notes = await ctx.db.query("notes").filter(acceptedFilter).take(20);
    const sourceSyncStatuses = await ctx.db
      .query("sourceSyncStatuses")
      .withIndex("by_brain_key", (q) => q.eq("brainInstanceId", brain._id))
      .collect();

    return {
      brain,
      focusSummary,
      focusItemActions,
      sourceSyncStatuses,
      triageItems,
      pendingActions,
      projects,
      tasks,
      people,
      companies,
      links,
      notes,
    };
  },
});

export const recordFocusItemActionForViewer = mutationGeneric({
  args: {
    focusSummaryId: v.id("focusSummaries"),
    itemKey: v.string(),
    itemText: v.string(),
    action: v.union(v.literal("dismissed"), v.literal("done")),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const focusSummary = await ctx.db.get(args.focusSummaryId);
    if (!focusSummary || focusSummary.brainInstanceId !== brain._id) {
      throw new Error("focus summary not found");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("focusItemActions")
      .withIndex("by_brain_item", (q) => q.eq("brainInstanceId", brain._id))
      .filter((q) => q.eq(q.field("itemKey"), args.itemKey))
      .filter((q) => q.eq(q.field("focusSummaryId"), args.focusSummaryId))
      .first();
    const patch = {
      itemText: args.itemText,
      action: args.action,
      actorUserId: user._id,
      updatedAt: now,
    };

    const focusItemActionId = existing
      ? (await ctx.db.patch(existing._id, patch), existing._id)
      : await ctx.db.insert("focusItemActions", {
          brainInstanceId: brain._id,
          focusSummaryId: args.focusSummaryId,
          itemKey: args.itemKey,
          ...patch,
          createdAt: now,
        });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: args.action === "dismissed" ? "focus_item_dismissed" : "focus_item_marked_done",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `${args.action === "dismissed" ? "Dismissed" : "Marked handled"} focus item: ${args.itemText}`,
      focusSummaryId: args.focusSummaryId,
      metadata: { focusItemActionId, itemKey: args.itemKey },
    });

    return { focusItemActionId, status: args.action };
  },
});

export const createTaskFromFocusItemForViewer = mutationGeneric({
  args: {
    focusSummaryId: v.id("focusSummaries"),
    itemKey: v.string(),
    itemText: v.string(),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const focusSummary = await ctx.db.get(args.focusSummaryId);
    if (!focusSummary || focusSummary.brainInstanceId !== brain._id) {
      throw new Error("focus summary not found");
    }

    const title = args.itemText.replace(/\.$/, "").trim();
    if (!title) {
      throw new Error("focus item text is required");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("focusItemActions")
      .withIndex("by_brain_item", (q) => q.eq("brainInstanceId", brain._id))
      .filter((q) => q.eq(q.field("itemKey"), args.itemKey))
      .filter((q) =>
        q.and(q.eq(q.field("focusSummaryId"), args.focusSummaryId), q.eq(q.field("action"), "task_created")),
      )
      .first();
    if (existing?.taskId) {
      const existingTask = await ctx.db.get(existing.taskId);
      return {
        focusItemActionId: existing._id,
        taskId: existing.taskId,
        title: existingTask?.title ?? title,
        status: "already_created",
      };
    }

    const activeTasks = (
      await ctx.db
        .query("tasks")
        .withIndex("by_brain_state", (q) => q.eq("brainInstanceId", brain._id))
        .filter((q) => q.eq(q.field("processingState"), "accepted"))
        .take(100)
    ).filter((task) => task.status !== "done" && task.status !== "cancelled");
    const matchingTask = activeTasks.find((task) => taskTitleLooksDuplicate(title, task.title));
    if (matchingTask) {
      const focusItemActionId = await ctx.db.insert("focusItemActions", {
        brainInstanceId: brain._id,
        focusSummaryId: args.focusSummaryId,
        itemKey: args.itemKey,
        itemText: args.itemText,
        action: "task_created",
        taskId: matchingTask._id,
        actorUserId: user._id,
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.insert("activityEvents", {
        brainInstanceId: brain._id,
        entityRef: { entityType: "task", entityId: matchingTask._id },
        activityType: "focus_item_linked_to_existing_task",
        actorType: "user",
        actorId: user._id,
        timestamp: now,
        summary: `Focus item linked to existing task: ${matchingTask.title}`,
        focusSummaryId: args.focusSummaryId,
        metadata: { focusItemActionId, itemKey: args.itemKey, requestedTitle: title },
      });

      return { focusItemActionId, taskId: matchingTask._id, title: matchingTask.title, status: "linked_existing" };
    }

    const taskId = await ctx.db.insert("tasks", {
      brainInstanceId: brain._id,
      title,
      description: "Created from a Home focus bullet.",
      status: "todo",
      priorityReason: "Promoted from current focus.",
      processingState: "accepted",
      createdAt: now,
      updatedAt: now,
    });
    const focusItemActionId = await ctx.db.insert("focusItemActions", {
      brainInstanceId: brain._id,
      focusSummaryId: args.focusSummaryId,
      itemKey: args.itemKey,
      itemText: args.itemText,
      action: "task_created",
      taskId,
      actorUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      entityRef: { entityType: "task", entityId: taskId },
      activityType: "task_created_from_focus_item",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Task created from focus item: ${title}`,
      focusSummaryId: args.focusSummaryId,
      metadata: { focusItemActionId, itemKey: args.itemKey },
    });

    return { focusItemActionId, taskId, title, status: "created" };
  },
});

export const cancelDuplicateFocusTasksForViewer = mutationGeneric({
  args: {},
  handler: async (ctx) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    return await cancelDuplicateFocusCreatedTasks(ctx.db, brain._id, user._id);
  },
});

export const cancelDuplicateFocusTasks = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
  },
  handler: async ({ db }, args) => {
    return await cancelDuplicateFocusCreatedTasks(db, args.brainInstanceId);
  },
});

export const projectsAndTasksForViewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const projects = await ctx.db
      .query("projects")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brain._id), q.eq(q.field("processingState"), "accepted")),
      )
      .collect();
    const tasks = (
      await ctx.db
      .query("tasks")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brain._id), q.eq(q.field("processingState"), "accepted")),
      )
        .collect()
    ).filter((task) => task.status !== "done" && task.status !== "cancelled");
    const taskProjectRelationships = await ctx.db
      .query("relationships")
      .withIndex("by_brain_type", (q) => q.eq("brainInstanceId", brain._id))
      .filter((q) => q.eq(q.field("type"), "belongs_to"))
      .collect();
    const projectIdByTaskId = new Map(
      taskProjectRelationships
        .filter((relationship) => relationship.from.entityType === "task" && relationship.to.entityType === "project")
        .map((relationship) => [relationship.from.entityId, relationship.to.entityId]),
    );
    const tasksWithProjectIds = tasks.map((task) => ({
      ...task,
      projectId: projectIdByTaskId.get(task._id),
    }));

    return { brain, projects, tasks: tasksWithProjectIds };
  },
});

export const contactsForViewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const people = await ctx.db
      .query("people")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brain._id), q.eq(q.field("processingState"), "accepted")),
      )
      .collect();
    const companies = await ctx.db
      .query("companies")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brain._id), q.eq(q.field("processingState"), "accepted")),
      )
      .collect();

    return { brain, people, companies };
  },
});

const goalStatusValidator = v.union(
  v.literal("active"),
  v.literal("paused"),
  v.literal("achieved"),
  v.literal("abandoned"),
);

export const goalsForViewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const goals = await ctx.db
      .query("goals")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brain._id), q.eq(q.field("processingState"), "accepted")),
      )
      .collect();

    return { brain, goals };
  },
});

export const createGoalForViewer = mutationGeneric({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(goalStatusValidator),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const title = args.title.trim();
    if (!title) {
      throw new Error("goal title is required");
    }
    const now = Date.now();
    const goalId = await ctx.db.insert("goals", {
      brainInstanceId: brain._id,
      title,
      description: args.description?.trim() || undefined,
      status: args.status ?? "active",
      processingState: "accepted",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      entityRef: { entityType: "goal", entityId: goalId },
      activityType: "goal_created",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Goal created: ${title}`,
    });

    return { goalId, status: "created" };
  },
});

export const updateGoalForViewer = mutationGeneric({
  args: {
    goalId: v.id("goals"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(goalStatusValidator),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const goal = await ctx.db.get(args.goalId);
    if (!goal || goal.brainInstanceId !== brain._id) {
      throw new Error("goal not found");
    }
    const now = Date.now();
    const patch: Record<string, unknown> = { updatedAt: now };
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) {
        throw new Error("goal title cannot be empty");
      }
      patch.title = title;
    }
    if (args.description !== undefined) {
      patch.description = args.description.trim() || undefined;
    }
    if (args.status !== undefined) {
      patch.status = args.status;
    }

    await ctx.db.patch(args.goalId, patch);

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      entityRef: { entityType: "goal", entityId: args.goalId },
      activityType: "goal_updated",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Goal updated: ${patch.title ?? goal.title}`,
    });

    return { goalId: args.goalId, status: "updated" };
  },
});

export const setContactFavoriteForViewer = mutationGeneric({
  args: {
    personId: v.id("people"),
    favorite: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const person = await ctx.db.get(args.personId);
    if (!person || person.brainInstanceId !== brain._id) {
      throw new Error("person not found");
    }
    const now = Date.now();
    await ctx.db.patch(args.personId, { favorite: args.favorite, updatedAt: now });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      entityRef: { entityType: "person", entityId: args.personId },
      activityType: args.favorite ? "contact_favorited" : "contact_unfavorited",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `${args.favorite ? "Favorited" : "Unfavorited"} contact: ${person.name}`,
    });

    return { personId: args.personId, favorite: args.favorite };
  },
});

export const acceptedEntityOptionsForViewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const acceptedFilter = (q: any) =>
      q.and(q.eq(q.field("brainInstanceId"), brain._id), q.eq(q.field("processingState"), "accepted"));
    const goals = await ctx.db.query("goals").filter(acceptedFilter).take(50);
    const projects = await ctx.db.query("projects").filter(acceptedFilter).take(50);
    const tasks = await ctx.db.query("tasks").filter(acceptedFilter).take(100);
    const notes = await ctx.db.query("notes").filter(acceptedFilter).take(50);
    const people = await ctx.db.query("people").filter(acceptedFilter).take(50);
    const companies = await ctx.db.query("companies").filter(acceptedFilter).take(50);
    const links = await ctx.db.query("links").filter(acceptedFilter).take(50);
    const knowledgeObjects = await ctx.db.query("knowledgeObjects").filter(acceptedFilter).take(50);

    return [
      ...goals.map((goal) => ({
        entityType: "goal",
        entityId: goal._id,
        title: goal.title,
        summary: goal.description,
        status: goal.status,
      })),
      ...projects.map((project) => ({
        entityType: "project",
        entityId: project._id,
        title: project.title,
        summary: project.summary,
        status: project.status,
      })),
      ...tasks.map((task) => ({
        entityType: "task",
        entityId: task._id,
        title: task.title,
        summary: task.description,
        status: task.status,
      })),
      ...notes.map((note) => ({
        entityType: "note",
        entityId: note._id,
        title: note.title ?? note.body.slice(0, 80),
        summary: note.body,
      })),
      ...people.map((person) => ({
        entityType: "person",
        entityId: person._id,
        title: person.name,
        summary: [person.relationshipContext, person.notes, ...(person.emails ?? [])].filter(Boolean).join(" "),
      })),
      ...companies.map((company) => ({
        entityType: "company",
        entityId: company._id,
        title: company.name,
        summary: [company.domain, company.website, company.notes].filter(Boolean).join(" "),
      })),
      ...links.map((link) => ({
        entityType: "link",
        entityId: link._id,
        title: link.title ?? link.url,
        summary: [link.summary, link.whyItMatters, link.url].filter(Boolean).join(" "),
        status: link.status,
      })),
      ...knowledgeObjects.map((object) => ({
        entityType: "knowledgeObject",
        entityId: object._id,
        title: object.title,
        summary: [object.objectType, object.summary].filter(Boolean).join(" "),
      })),
    ];
  },
});

export const triageForViewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    return await ctx.db
      .query("triageItems")
      .filter((q) => q.and(q.eq(q.field("brainInstanceId"), brain._id), q.eq(q.field("status"), "pending")))
      .collect();
  },
});

export const pendingActionsForViewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    return await ctx.db
      .query("pendingActions")
      .filter((q) => q.eq(q.field("brainInstanceId"), brain._id))
      .collect();
  },
});

export const reviewPendingActionForViewer = mutationGeneric({
  args: {
    pendingActionId: v.id("pendingActions"),
    action: v.union(v.literal("approve"), v.literal("reject"), v.literal("revise")),
    approvalNotes: v.optional(v.string()),
    recipients: v.optional(v.any()),
    subject: v.optional(v.string()),
    body: v.optional(v.string()),
    messageBody: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const pendingAction = await ctx.db.get(args.pendingActionId);
    if (!pendingAction || pendingAction.brainInstanceId !== brain._id) {
      throw new Error("pending action not found");
    }
    if (pendingAction.status === "sent" || pendingAction.status === "completed") {
      throw new Error("completed pending actions cannot be reviewed");
    }

    const now = Date.now();
    const patch: Record<string, unknown> = {
      updatedAt: now,
    };
    let activityType = "pending_action_revised";
    let summary = "Pending action revised.";

    if (args.action === "approve") {
      patch.status = "approved";
      patch.approvedBy = user._id;
      patch.approvedAt = now;
      patch.approvalNotes = args.approvalNotes;
      activityType = "pending_action_approved";
      summary = `Pending action approved: ${pendingAction.actionType}`;
    } else if (args.action === "reject") {
      patch.status = "rejected";
      patch.approvalNotes = args.approvalNotes;
      activityType = "pending_action_rejected";
      summary = `Pending action rejected: ${pendingAction.actionType}`;
    } else {
      patch.status = "pending_approval";
      patch.approvalNotes = args.approvalNotes;
      if (args.recipients !== undefined) patch.recipients = args.recipients;
      if (args.subject !== undefined) patch.subject = args.subject;
      if (args.body !== undefined) patch.body = args.body;
      if (args.messageBody !== undefined) patch.messageBody = args.messageBody;
      summary = `Pending action revised: ${pendingAction.actionType}`;
    }

    await ctx.db.patch(args.pendingActionId, patch);

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType,
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary,
      pendingActionId: args.pendingActionId,
      metadata: {
        action: args.action,
        approvalNotes: args.approvalNotes,
      },
      sourceRefIds: pendingAction.sourceRefIds,
    });

    return {
      pendingActionId: args.pendingActionId,
      status: patch.status,
      action: args.action,
    };
  },
});

export const markTaskDone = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    taskId: v.id("tasks"),
    completedBy: v.optional(v.id("users")),
    externalReminderSourceRefId: v.optional(v.id("sourceRefs")),
  },
  handler: async ({ db }, args) => {
    const task = await db.get(args.taskId);
    if (!task || task.brainInstanceId !== args.brainInstanceId) {
      throw new Error("task not found for brain instance");
    }
    if (task.processingState !== "accepted") {
      throw new Error("only accepted tasks can be marked done from the web app");
    }

    const now = Date.now();
    await db.patch(args.taskId, {
      status: "done",
      completedAt: now,
      updatedAt: now,
    });

    let pendingActionId = undefined;
    if (args.externalReminderSourceRefId) {
      pendingActionId = await db.insert("pendingActions", {
        brainInstanceId: args.brainInstanceId,
        actionType: "complete_external_reminder",
        status: "approved",
        relatedEntities: [{ entityType: "task", entityId: args.taskId }],
        sourceRefIds: [args.externalReminderSourceRefId],
        approvedBy: args.completedBy,
        approvedAt: now,
        approvalNotes: "Task completion in Skippy is the approval signal for low-risk reminder sync.",
        createdAt: now,
        updatedAt: now,
      });
    }

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      entityRef: { entityType: "task", entityId: args.taskId },
      activityType: "task_marked_done",
      actorType: "user",
      actorId: args.completedBy,
      timestamp: now,
      summary: `Task marked done: ${task.title}`,
      pendingActionId,
    });

    return { taskId: args.taskId, pendingActionId };
  },
});

export const createContactDirect = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    name: v.string(),
    emails: v.optional(v.array(v.string())),
    phoneNumbers: v.optional(v.array(v.string())),
    relationshipContext: v.optional(v.string()),
    roleTitle: v.optional(v.string()),
    notes: v.optional(v.string()),
    favorite: v.optional(v.boolean()),
    createdBy: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const name = args.name.trim();
    if (!name) {
      throw new Error("contact name is required");
    }
    const now = Date.now();
    const personId = await db.insert("people", {
      brainInstanceId: args.brainInstanceId,
      name,
      emails: args.emails?.length ? args.emails : undefined,
      phoneNumbers: args.phoneNumbers?.length ? args.phoneNumbers : undefined,
      relationshipContext: args.relationshipContext,
      roleTitle: args.roleTitle,
      notes: args.notes,
      favorite: args.favorite ?? undefined,
      processingState: "accepted",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      entityRef: { entityType: "person", entityId: personId },
      activityType: "contact_created_direct",
      actorType: "harness",
      actorId: args.createdBy,
      timestamp: now,
      summary: `Contact created directly: ${name}`,
    });

    return { status: "created", entityType: "person", personId, name, favorite: args.favorite ?? false };
  },
});

export const markTaskInProgress = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    taskId: v.id("tasks"),
    startedBy: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const task = await db.get(args.taskId);
    if (!task || task.brainInstanceId !== args.brainInstanceId) {
      throw new Error("task not found for brain instance");
    }
    if (task.processingState !== "accepted") {
      throw new Error("only accepted tasks can be marked in progress");
    }
    if (task.status === "done" || task.status === "cancelled") {
      throw new Error("done or cancelled tasks cannot be marked in progress");
    }

    const now = Date.now();
    const startedAt = task.startedAt ?? now;
    await db.patch(args.taskId, {
      status: "in_progress",
      startedAt,
      startedBy: args.startedBy,
      updatedAt: now,
    });

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      entityRef: { entityType: "task", entityId: args.taskId },
      activityType: "task_marked_in_progress",
      actorType: "harness",
      actorId: args.startedBy,
      timestamp: now,
      summary: `Task marked in progress: ${task.title}`,
    });

    return {
      taskId: args.taskId,
      status: "in_progress",
      startedAt,
      startedBy: args.startedBy,
    };
  },
});

export const createProjectDirect = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    title: v.string(),
    summary: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("idea"),
        v.literal("planned"),
        v.literal("in_progress"),
        v.literal("paused"),
        v.literal("completed"),
        v.literal("cancelled"),
      ),
    ),
    priorityReason: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    const projectId = await db.insert("projects", {
      brainInstanceId: args.brainInstanceId,
      title: args.title.trim(),
      summary: args.summary,
      status: args.status ?? "planned",
      priorityReason: args.priorityReason,
      processingState: "accepted",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      entityRef: { entityType: "project", entityId: projectId },
      activityType: "project_created_direct",
      actorType: "harness",
      actorId: args.createdBy,
      timestamp: now,
      summary: `Project created directly from explicit user instruction: ${args.title.trim()}`,
    });

    return {
      status: "created",
      entityType: "project",
      projectId,
      title: args.title.trim(),
    };
  },
});

export const createTaskDirect = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("todo"),
        v.literal("in_progress"),
        v.literal("waiting"),
        v.literal("done"),
        v.literal("cancelled"),
      ),
    ),
    dueAt: v.optional(v.number()),
    priorityReason: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    createdBy: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    const normalizedTitle = args.title.trim();
    const taskId = await db.insert("tasks", {
      brainInstanceId: args.brainInstanceId,
      title: normalizedTitle,
      description: args.description,
      status: args.status ?? "todo",
      dueAt: args.dueAt,
      priorityReason: args.priorityReason,
      processingState: "accepted",
      createdAt: now,
      updatedAt: now,
    });

    let relationshipId = undefined;
    let projectTitle = undefined;
    if (args.projectId) {
      const project = await db.get(args.projectId);
      if (!project || project.brainInstanceId !== args.brainInstanceId) {
        throw new Error("project not found for brain instance");
      }
      projectTitle = project.title;
      relationshipId = await db.insert("relationships", {
        brainInstanceId: args.brainInstanceId,
        from: { entityType: "task", entityId: taskId },
        to: { entityType: "project", entityId: args.projectId },
        type: "belongs_to",
        confidence: 1,
        reason: "Task created directly in the context of this project.",
        createdBy: "harness",
        createdAt: now,
        updatedAt: now,
      });
    }

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      entityRef: { entityType: "task", entityId: taskId },
      activityType: "task_created_direct",
      actorType: "harness",
      actorId: args.createdBy,
      timestamp: now,
      summary: `Task created directly from explicit user instruction: ${normalizedTitle}`,
      metadata: { projectId: args.projectId, relationshipId },
    });

    return {
      status: "created",
      entityType: "task",
      taskId,
      title: normalizedTitle,
      projectId: args.projectId,
      projectTitle,
      relationshipId,
    };
  },
});

export const markTaskDoneForViewer = mutationGeneric({
  args: {
    taskId: v.id("tasks"),
    externalReminderSourceRefId: v.optional(v.id("sourceRefs")),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.brainInstanceId !== brain._id) {
      throw new Error("task not found");
    }
    if (task.processingState !== "accepted") {
      throw new Error("only accepted tasks can be marked done from the web app");
    }

    const now = Date.now();
    await ctx.db.patch(args.taskId, {
      status: "done",
      completedAt: now,
      updatedAt: now,
    });

    let pendingActionId = undefined;
    if (args.externalReminderSourceRefId) {
      pendingActionId = await ctx.db.insert("pendingActions", {
        brainInstanceId: brain._id,
        actionType: "complete_external_reminder",
        status: "approved",
        relatedEntities: [{ entityType: "task", entityId: args.taskId }],
        sourceRefIds: [args.externalReminderSourceRefId],
        approvedBy: user._id,
        approvedAt: now,
        approvalNotes: "Task completion in Skippy is the approval signal for low-risk reminder sync.",
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      entityRef: { entityType: "task", entityId: args.taskId },
      activityType: "task_marked_done",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Task marked done: ${task.title}`,
      pendingActionId,
    });

    return { taskId: args.taskId, pendingActionId };
  },
});

export const listActiveProjectsAndTasks = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
  },
  handler: async ({ db }, { brainInstanceId }) => {
    const projects = await db
      .query("projects")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brainInstanceId), q.eq(q.field("processingState"), "accepted")),
      )
      .collect();

    const tasks = (
      await db
      .query("tasks")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brainInstanceId), q.eq(q.field("processingState"), "accepted")),
      )
        .collect()
    ).filter((task) => task.status !== "done" && task.status !== "cancelled");

    return { projects, tasks };
  },
});

export const listContacts = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
  },
  handler: async ({ db }, { brainInstanceId }) => {
    const people = await db
      .query("people")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brainInstanceId), q.eq(q.field("processingState"), "accepted")),
      )
      .collect();
    const companies = await db
      .query("companies")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brainInstanceId), q.eq(q.field("processingState"), "accepted")),
      )
      .collect();

    return { people, companies };
  },
});

export const getLatestFocusSummary = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
  },
  handler: async ({ db }, { brainInstanceId }) => {
    return await db
      .query("focusSummaries")
      .filter((q) => q.eq(q.field("brainInstanceId"), brainInstanceId))
      .order("desc")
      .first();
  },
});

export const aiContextForBrain = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
  },
  handler: async ({ db }, { brainInstanceId }) => {
    const config = await db
      .query("brainConfigs")
      .filter((q) => q.eq(q.field("brainInstanceId"), brainInstanceId))
      .first();
    const focusSummary = await db
      .query("focusSummaries")
      .filter((q) => q.eq(q.field("brainInstanceId"), brainInstanceId))
      .order("desc")
      .first();
    const projects = await db
      .query("projects")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brainInstanceId), q.eq(q.field("processingState"), "accepted")),
      )
      .take(20);
    const tasks = await db
      .query("tasks")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brainInstanceId), q.eq(q.field("processingState"), "accepted")),
      )
      .take(30);
    const people = await db
      .query("people")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brainInstanceId), q.eq(q.field("processingState"), "accepted")),
      )
      .take(20);
    const companies = await db
      .query("companies")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brainInstanceId), q.eq(q.field("processingState"), "accepted")),
      )
      .take(20);
    const links = await db
      .query("links")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brainInstanceId), q.eq(q.field("processingState"), "accepted")),
      )
      .take(20);
    const notes = await db
      .query("notes")
      .filter((q) =>
        q.and(q.eq(q.field("brainInstanceId"), brainInstanceId), q.eq(q.field("processingState"), "accepted")),
      )
      .take(20);
    const embeddings = await db
      .query("entityEmbeddings")
      .withIndex("by_brain", (q) => q.eq("brainInstanceId", brainInstanceId))
      .take(200);

    return { config, focusSummary, projects, tasks, people, companies, links, notes, embeddings };
  },
});

export const upsertEntityEmbedding = mutationGeneric({
  args: entityEmbeddingInput,
  handler: async ({ db }, args) => {
    const entityTable = entityTableByType[args.entityRef.entityType as keyof typeof entityTableByType];
    const entity = entityTable ? await (db as any).get(args.entityRef.entityId) : null;
    if (!entity || entity.brainInstanceId !== args.brainInstanceId) {
      throw new Error("entity not found for brain instance");
    }

    const now = Date.now();
    const existing = await db
      .query("entityEmbeddings")
      .withIndex("by_brain", (q) => q.eq("brainInstanceId", args.brainInstanceId))
      .filter((q) =>
        q.and(
          q.eq(q.field("entityRef.entityType"), args.entityRef.entityType),
          q.eq(q.field("entityRef.entityId"), args.entityRef.entityId),
          q.eq(q.field("embeddingProvider"), args.embeddingProvider),
          q.eq(q.field("embeddingModel"), args.embeddingModel),
        ),
      )
      .first();

    if (existing) {
      await db.patch(existing._id, {
        canonicalText: args.canonicalText,
        textHash: args.textHash,
        embedding: args.embedding,
        embeddingVersion: args.embeddingVersion,
        updatedAt: now,
      });

      return { embeddingId: existing._id, status: "updated" };
    }

    const embeddingId = await db.insert("entityEmbeddings", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });

    return { embeddingId, status: "created" };
  },
});

export const upsertFocusSummary = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    summaryText: v.string(),
    topItems: v.array(
      v.object({
        entityRef,
        reason: v.string(),
        priorityScore: v.optional(v.number()),
        urgencyScore: v.optional(v.number()),
        importanceScore: v.optional(v.number()),
      }),
    ),
    generatedAt: v.optional(v.number()),
    validUntil: v.optional(v.number()),
    policyVersion: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    const focusSummaryId = await db.insert("focusSummaries", {
      brainInstanceId: args.brainInstanceId,
      generatedAt: args.generatedAt ?? now,
      validUntil: args.validUntil,
      summaryText: args.summaryText,
      topItems: args.topItems,
      policyVersion: args.policyVersion,
      createdAt: now,
    });

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      activityType: "focus_summary_generated",
      actorType: "harness",
      timestamp: now,
      summary: "Focus summary generated.",
      focusSummaryId,
    });

    return { focusSummaryId };
  },
});

export const listPendingActions = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    status: v.optional(v.string()),
  },
  handler: async ({ db }, { brainInstanceId, status }) => {
    if (status) {
      return await db
        .query("pendingActions")
        .filter((q) =>
          q.and(q.eq(q.field("brainInstanceId"), brainInstanceId), q.eq(q.field("status"), status)),
        )
        .collect();
    }

    return await db
      .query("pendingActions")
      .filter((q) => q.eq(q.field("brainInstanceId"), brainInstanceId))
      .collect();
  },
});

export const recordPendingActionResult = mutationGeneric({
  args: {
    pendingActionId: v.id("pendingActions"),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("completed")),
    executionProvider: v.optional(v.string()),
    externalMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const pendingAction = await db.get(args.pendingActionId);
    if (!pendingAction) {
      throw new Error("pending action not found");
    }

    const now = Date.now();
    await db.patch(args.pendingActionId, {
      status: args.status,
      executionProvider: args.executionProvider,
      externalMessageId: args.externalMessageId,
      executedAt: now,
      error: args.error,
      updatedAt: now,
    });

    await db.insert("activityEvents", {
      brainInstanceId: pendingAction.brainInstanceId,
      activityType: "pending_action_result_recorded",
      actorType: "harness",
      timestamp: now,
      summary: `Pending action ${args.status}.`,
      pendingActionId: args.pendingActionId,
      metadata: {
        executionProvider: args.executionProvider,
        externalMessageId: args.externalMessageId,
        error: args.error,
      },
    });

    return { pendingActionId: args.pendingActionId };
  },
});

export const recordEntityReview = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    entityRef,
    reviewType: entityReviewType,
    reviewSummary: v.string(),
    reviewedBy: v.optional(v.string()),
    status: v.optional(v.string()),
    confidence: v.optional(v.number()),
    sourceRefIds: v.optional(v.array(v.id("sourceRefs"))),
    sourceRefs: v.optional(v.array(sourceRefInput)),
    ...priorityArgs,
  },
  handler: async ({ db }, args) => {
    const entityTypeName = args.entityRef.entityType as keyof typeof entityTableByType;
    const entityTable = entityTableByType[entityTypeName];
    const entity = entityTable ? await (db as any).get(args.entityRef.entityId) : null;
    if (!entity || entity.brainInstanceId !== args.brainInstanceId) {
      throw new Error("entity not found for brain instance");
    }
    if (entity.processingState !== "accepted") {
      throw new Error("only accepted entities can be reviewed");
    }

    const now = Date.now();
    const sourceRefIds = [...(args.sourceRefIds ?? [])];
    for (const sourceRef of args.sourceRefs ?? []) {
      sourceRefIds.push(
        await db.insert("sourceRefs", {
          brainInstanceId: args.brainInstanceId,
          ...sourceRef,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    const patch: Record<string, unknown> = {
      updatedAt: now,
      reviewReason: args.reviewSummary,
    };
    if (typeof args.confidence === "number") {
      patch.confidence = args.confidence;
    }

    const allowedStatus = statusAllowedForEntity(entityTypeName, args.status);
    if (allowedStatus) {
      patch.status = allowedStatus;
    }

    if (entityTypeName === "task" || entityTypeName === "project") {
      for (const field of [
        "priorityScore",
        "urgencyScore",
        "importanceScore",
        "priorityReason",
        "priorityComputedAt",
        "priorityPolicyVersion",
      ] as const) {
        if (args[field] !== undefined) {
          patch[field] = args[field];
        }
      }
    }

    await (db as any).patch(args.entityRef.entityId, patch);

    for (const sourceRefId of sourceRefIds) {
      await db.insert("entitySourceRefs", {
        brainInstanceId: args.brainInstanceId,
        entityRef: args.entityRef,
        sourceRefId,
        relationship: "evidence_for",
        createdAt: now,
      });
    }

    const activityId = await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      entityRef: args.entityRef,
      activityType: "entity_reviewed",
      actorType: "harness",
      actorId: args.reviewedBy,
      timestamp: now,
      summary: args.reviewSummary,
      metadata: {
        reviewType: args.reviewType,
        status: allowedStatus,
        requestedStatus: args.status,
        priorityScore: args.priorityScore,
        urgencyScore: args.urgencyScore,
        importanceScore: args.importanceScore,
        priorityReason: args.priorityReason,
        ignoredStatus: args.status && !allowedStatus ? args.status : undefined,
      },
      sourceRefIds,
    });

    return {
      status: "review_recorded",
      entityRef: args.entityRef,
      activityId,
      sourceRefIds,
      applied: {
        status: allowedStatus,
        priorityUpdated: entityTypeName === "task" || entityTypeName === "project",
      },
    };
  },
});

export const recordIngestionRun = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    harness: v.string(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    sourceSystemsChecked: v.array(v.string()),
    candidatesSubmitted: v.optional(v.number()),
    objectsCreated: v.optional(v.number()),
    objectsUpdated: v.optional(v.number()),
    errors: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
  },
  handler: async ({ db }, args) => {
    return await db.insert("ingestionRuns", {
      ...args,
      startedAt: args.startedAt ?? Date.now(),
    });
  },
});

export const updateSourceSyncStatus = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    statusKey: v.optional(v.string()),
    harness: v.string(),
    status: v.union(v.literal("idle"), v.literal("running"), v.literal("completed"), v.literal("failed")),
    message: v.optional(v.string()),
    sourceSystemsChecked: v.array(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    lastHeartbeatAt: v.optional(v.number()),
    errors: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    const statusKey = args.statusKey ?? "source-sync";
    const existing = await db
      .query("sourceSyncStatuses")
      .withIndex("by_brain_key", (q) => q.eq("brainInstanceId", args.brainInstanceId))
      .filter((q) => q.eq(q.field("statusKey"), statusKey))
      .first();
    const patch = {
      harness: args.harness,
      status: args.status,
      message: args.message,
      sourceSystemsChecked: args.sourceSystemsChecked,
      startedAt: args.startedAt ?? (args.status === "running" ? now : existing?.startedAt),
      completedAt: args.completedAt ?? (args.status === "completed" || args.status === "failed" ? now : undefined),
      lastHeartbeatAt: args.lastHeartbeatAt ?? now,
      errors: args.errors,
      metadata: args.metadata,
      updatedAt: now,
    };

    if (existing) {
      await db.patch(existing._id, patch);
      return { statusSyncId: existing._id, status: args.status, statusKey };
    }

    const statusSyncId = await db.insert("sourceSyncStatuses", {
      brainInstanceId: args.brainInstanceId,
      statusKey,
      ...patch,
      createdAt: now,
    });
    return { statusSyncId, status: args.status, statusKey };
  },
});
