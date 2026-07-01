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
import { advanceDependentsAfterDone } from "./taskExecution";

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

const taskKind = v.union(
  v.literal("coding"),
  v.literal("review"),
  v.literal("research"),
  v.literal("design"),
  v.literal("manual"),
  v.literal("planning"),
);

const memoryType = v.union(
  v.literal("thought"),
  v.literal("memory"),
  v.literal("decision"),
  v.literal("principle"),
  v.literal("question"),
  v.literal("insight"),
  v.literal("artifact"),
);

const memoryStatus = v.union(
  v.literal("inbox"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("archived"),
);

const memoryReviewState = v.union(
  v.literal("unreviewed"),
  v.literal("pending_review"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("archived"),
);

const memoryReviewBehavior = v.union(
  v.literal("accept"),
  v.literal("submit_for_review"),
  v.literal("auto"),
);

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

function normalizedContactText(value: string | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizedEmail(value: string | undefined) {
  return value?.trim().toLowerCase();
}

function normalizedPhone(value: string | undefined) {
  return value?.replace(/\D+/g, "");
}

function normalizedDomain(value: string | undefined) {
  const rawValue = value?.trim().toLowerCase();
  if (!rawValue) {
    return undefined;
  }

  try {
    return new URL(rawValue.startsWith("http") ? rawValue : `https://${rawValue}`).hostname.replace(/^www\./, "");
  } catch {
    return rawValue.replace(/^www\./, "");
  }
}

function arraysOverlap(left: string[] | undefined, right: string[] | undefined) {
  const rightValues = new Set((right ?? []).filter(Boolean));
  return (left ?? []).some((item) => rightValues.has(item));
}

function personLooksDuplicate(left: any, right: any) {
  const leftEmails = (left.emails ?? []).map(normalizedEmail).filter(Boolean);
  const rightEmails = (right.emails ?? []).map(normalizedEmail).filter(Boolean);
  if (arraysOverlap(leftEmails as string[], rightEmails as string[])) {
    return true;
  }

  const leftPhones = (left.phoneNumbers ?? []).map(normalizedPhone).filter(Boolean);
  const rightPhones = (right.phoneNumbers ?? []).map(normalizedPhone).filter(Boolean);
  if (arraysOverlap(leftPhones as string[], rightPhones as string[])) {
    return true;
  }

  const leftName = normalizedContactText(left.name);
  const rightName = normalizedContactText(right.name);
  return Boolean(leftName && rightName && (leftName === rightName || leftName.includes(rightName) || rightName.includes(leftName)));
}

function companyLooksDuplicate(left: any, right: any) {
  const leftDomain = normalizedDomain(left.domain ?? left.website);
  const rightDomain = normalizedDomain(right.domain ?? right.website);
  if (leftDomain && rightDomain && leftDomain === rightDomain) {
    return true;
  }

  const leftName = normalizedContactText(left.name);
  const rightName = normalizedContactText(right.name);
  return Boolean(leftName && rightName && leftName === rightName);
}

async function findAcceptedEntityDuplicate(
  db: any,
  brainInstanceId: any,
  entityTypeName: keyof typeof entityTableByType,
  payload: any,
) {
  if (!["task", "person", "company"].includes(entityTypeName)) {
    return null;
  }

  const tableName = entityTableByType[entityTypeName];
  const acceptedEntities = await db
    .query(tableName)
    .withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brainInstanceId))
    .filter((q: any) => q.eq(q.field("processingState"), "accepted"))
    .take(300);

  if (entityTypeName === "task") {
    return acceptedEntities.find(
      (task: any) =>
        task.status !== "done" &&
        task.status !== "cancelled" &&
        taskTitleLooksDuplicate(payload.title, task.title),
    ) ?? null;
  }

  if (entityTypeName === "person") {
    return acceptedEntities.find((person: any) => personLooksDuplicate(payload, person)) ?? null;
  }

  if (entityTypeName === "company") {
    return acceptedEntities.find((company: any) => companyLooksDuplicate(payload, company)) ?? null;
  }

  return null;
}

function mergeArrays(left: string[] | undefined, right: string[] | undefined) {
  return Array.from(new Set([...(left ?? []), ...(right ?? [])].filter(Boolean)));
}

function mergeDuplicateEntityPatch(entityTypeName: keyof typeof entityTableByType, existing: any, incoming: any, now: number) {
  const patch: Record<string, unknown> = { updatedAt: now };

  if (entityTypeName === "task") {
    if (!existing.description && incoming.description) patch.description = incoming.description;
    if (!existing.priorityReason && incoming.priorityReason) patch.priorityReason = incoming.priorityReason;
    if (!existing.ownerType && incoming.ownerType) patch.ownerType = incoming.ownerType;
    if (!existing.dueAt && incoming.dueAt) patch.dueAt = incoming.dueAt;
    if (!existing.urgencyScore && incoming.urgencyScore) patch.urgencyScore = incoming.urgencyScore;
    if (!existing.importanceScore && incoming.importanceScore) patch.importanceScore = incoming.importanceScore;
    if (!existing.priorityScore && incoming.priorityScore) patch.priorityScore = incoming.priorityScore;
    if (!existing.priorityComputedAt && incoming.priorityComputedAt) patch.priorityComputedAt = incoming.priorityComputedAt;
    if (!existing.priorityPolicyVersion && incoming.priorityPolicyVersion) patch.priorityPolicyVersion = incoming.priorityPolicyVersion;
  }

  if (entityTypeName === "person") {
    const emails = mergeArrays(existing.emails, incoming.emails);
    const phoneNumbers = mergeArrays(existing.phoneNumbers, incoming.phoneNumbers);
    const addresses = mergeArrays(existing.addresses, incoming.addresses);
    if (emails.length) patch.emails = emails;
    if (phoneNumbers.length) patch.phoneNumbers = phoneNumbers;
    if (addresses.length) patch.addresses = addresses;
    if (!existing.roleTitle && incoming.roleTitle) patch.roleTitle = incoming.roleTitle;
    if (!existing.relationshipContext && incoming.relationshipContext) patch.relationshipContext = incoming.relationshipContext;
    if (!existing.notes && incoming.notes) patch.notes = incoming.notes;
  }

  if (entityTypeName === "company") {
    if (!existing.website && incoming.website) patch.website = incoming.website;
    if (!existing.domain && incoming.domain) patch.domain = incoming.domain;
    if (!existing.notes && incoming.notes) patch.notes = incoming.notes;
    if (!existing.relationshipLabel && incoming.relationshipLabel) patch.relationshipLabel = incoming.relationshipLabel;
  }

  return patch;
}

async function linkSourceRefsToEntity(
  db: any,
  brainInstanceId: any,
  entityRefValue: { entityType: keyof typeof entityTableByType; entityId: any },
  sourceRefIds: any[],
  relationship: "created_from" | "updated_from" | "mentioned_in" | "evidence_for",
  now: number,
) {
  for (const sourceRefId of sourceRefIds) {
    await db.insert("entitySourceRefs", {
      brainInstanceId,
      entityRef: entityRefValue,
      sourceRefId,
      relationship,
      createdAt: now,
    });
  }
}

async function mergeIntoDuplicateEntity(
  db: any,
  brainInstanceId: any,
  entityTypeName: keyof typeof entityTableByType,
  existing: any,
  normalizedPayload: any,
  sourceRefIds: any[],
  now: number,
  activitySummary: string,
  metadata?: Record<string, unknown>,
  actorType: "user" | "harness" | "skippy_ai" | "system" = "harness",
  actorId?: string,
) {
  const patch = mergeDuplicateEntityPatch(entityTypeName, existing, normalizedPayload, now);
  await db.patch(existing._id, patch);

  const entityRefValue = { entityType: entityTypeName, entityId: existing._id };
  await linkSourceRefsToEntity(db, brainInstanceId, entityRefValue, sourceRefIds, "updated_from", now);

  await db.insert("activityEvents", {
    brainInstanceId,
    entityRef: entityRefValue,
    activityType: "duplicate_entity_merged",
    actorType,
    actorId,
    timestamp: now,
    summary: activitySummary,
    metadata: {
      ...metadata,
      duplicateEntityType: entityTypeName,
      matchedEntityId: existing._id,
      incomingTitle: normalizedPayload.title ?? normalizedPayload.name,
    },
    sourceRefIds,
  });

  return { entityRef: entityRefValue, sourceRefIds, normalizedPayload, duplicate: true };
}

async function createAcceptedEntity(
  db: any,
  triageItem: any,
  entityTypeName: keyof typeof entityTableByType,
  payload: any,
  now: number,
  actorType: "user" | "harness" | "skippy_ai" | "system" = "harness",
  actorId?: string,
) {
  const tableName = entityTableByType[entityTypeName];
  const sourceRefIds = triageItem.sourceRefIds ?? [];
  const normalizedPayload = normalizeAcceptedEntityPayload(entityTypeName, payload);
  const duplicateEntity = await findAcceptedEntityDuplicate(
    db,
    triageItem.brainInstanceId,
    entityTypeName,
    normalizedPayload,
  );
  if (duplicateEntity) {
    return await mergeIntoDuplicateEntity(
      db,
      triageItem.brainInstanceId,
      entityTypeName,
      duplicateEntity,
      normalizedPayload,
      sourceRefIds,
      now,
      `Merged duplicate suggested ${entityTypeName} into existing accepted ${entityTypeName}.`,
      { triageItemId: triageItem._id },
      actorType,
      actorId,
    );
  }

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

  await linkSourceRefsToEntity(
    db,
    triageItem.brainInstanceId,
    { entityType: entityTypeName, entityId },
    sourceRefIds,
    "created_from",
    now,
  );

  return { entityRef: { entityType: entityTypeName, entityId }, sourceRefIds, normalizedPayload, duplicate: false };
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

function optionalTrimmed(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function memoryTitleFor(memoryTypeName: string, title: string | undefined, body: string) {
  const trimmedTitle = optionalTrimmed(title);
  if (trimmedTitle) {
    return trimmedTitle;
  }

  const fallback = body.replace(/\s+/g, " ").trim().slice(0, 80);
  return fallback || `${memoryTypeName.slice(0, 1).toUpperCase()}${memoryTypeName.slice(1)}`;
}

function dedupeIds(ids: any[]) {
  const seen = new Set<string>();
  const deduped = [];
  for (const id of ids) {
    const key = String(id);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(id);
    }
  }
  return deduped;
}

function dedupeEntityRefs(refs: Array<{ entityType: string; entityId: string }>) {
  const seen = new Set<string>();
  const deduped = [];
  for (const ref of refs) {
    const key = `${ref.entityType}:${ref.entityId}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(ref);
    }
  }
  return deduped;
}

async function requireSourceRefsForBrain(db: any, brainInstanceId: any, sourceRefIds: any[] | undefined) {
  const deduped = dedupeIds(sourceRefIds ?? []);
  for (const sourceRefId of deduped) {
    const sourceRef = await db.get(sourceRefId);
    if (!sourceRef || sourceRef.brainInstanceId !== brainInstanceId) {
      throw new Error("source ref not found for brain instance");
    }
  }
  return deduped;
}

async function requireRelatedEntityRefsForBrain(
  db: any,
  brainInstanceId: any,
  relatedEntityRefs: Array<{ entityType: keyof typeof entityTableByType; entityId: string }> | undefined,
) {
  const deduped = dedupeEntityRefs(relatedEntityRefs ?? []);
  for (const ref of deduped) {
    const entityTable = entityTableByType[ref.entityType as keyof typeof entityTableByType];
    const entity = entityTable ? await db.get(ref.entityId as any) : null;
    if (!entity || entity.brainInstanceId !== brainInstanceId) {
      throw new Error(`${ref.entityType} not found for brain instance`);
    }
  }
  return deduped;
}

async function memorySourceRefIdsFromArgs(
  db: any,
  brainInstanceId: any,
  sourceRefIds: any[] | undefined,
  sourceRefs: any[] | undefined,
  now: number,
) {
  return dedupeIds([
    ...(await requireSourceRefsForBrain(db, brainInstanceId, sourceRefIds)),
    ...(await insertSourceRefs(db, brainInstanceId, sourceRefs, now)),
  ]);
}

async function sourceRefsForMemory(db: any, brainInstanceId: any, sourceRefIds: any[] | undefined) {
  const sourceRefs = [];
  for (const sourceRefId of sourceRefIds ?? []) {
    const sourceRef = await db.get(sourceRefId);
    if (sourceRef && sourceRef.brainInstanceId === brainInstanceId) {
      sourceRefs.push(sourceRef);
    }
  }
  return sourceRefs;
}

async function relatedEntitiesForMemory(
  db: any,
  brainInstanceId: any,
  relatedEntityRefs: Array<{ entityType: keyof typeof entityTableByType; entityId: string }> | undefined,
) {
  const relatedEntities = [];
  for (const ref of relatedEntityRefs ?? []) {
    const entityTable = entityTableByType[ref.entityType];
    const entity = entityTable ? await db.get(ref.entityId as any) : null;
    if (entity && entity.brainInstanceId === brainInstanceId) {
      relatedEntities.push({ ref, entity });
    }
  }
  return relatedEntities;
}

const memorySearchStopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "this",
  "to",
  "we",
  "what",
  "when",
  "with",
]);

function clampSearchLimit(limit: number | undefined, fallback: number, max: number) {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(limit)));
}

function searchTokens(query: string | undefined) {
  return Array.from(
    new Set(
      (query ?? "")
        .toLowerCase()
        .replace(/['’]/g, "")
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !memorySearchStopWords.has(token)),
    ),
  );
}

function textScore(text: string | undefined, tokens: string[], weight: number) {
  if (!text || tokens.length === 0) {
    return 0;
  }
  const normalized = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (normalized.includes(token)) {
      score += weight;
    }
  }
  return score;
}

function refKey(ref: { entityType: string; entityId: string }) {
  return `${ref.entityType}:${ref.entityId}`;
}

function hasRequestedRelatedRefs(
  memory: any,
  relatedEntityRefs: Array<{ entityType: string; entityId: string }> | undefined,
) {
  if (!relatedEntityRefs?.length) {
    return true;
  }
  const memoryRefKeys = new Set((memory.relatedEntityRefs ?? []).map((ref: any) => refKey(ref)));
  return relatedEntityRefs.every((ref) => memoryRefKeys.has(refKey(ref)));
}

function memoryMatchesType(memory: any, args: { memoryType?: string; kinds?: string[] }) {
  const types = new Set([args.memoryType, ...(args.kinds ?? [])].filter(Boolean));
  return types.size === 0 || types.has(memory.memoryType);
}

function memoryIsSearchable(memory: any, includeArchived: boolean | undefined) {
  if (includeArchived) {
    return true;
  }
  return memory.status !== "archived" && memory.status !== "rejected";
}

function sourceRefText(sourceRef: any) {
  return [
    sourceRef?.sourceSystem,
    sourceRef?.externalId,
    sourceRef?.threadId,
    sourceRef?.messageId,
    sourceRef?.eventId,
    sourceRef?.url,
    sourceRef?.deepLink,
    sourceRef?.summary,
    sourceRef?.excerpt,
    ...(sourceRef?.participants ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

function entityDisplay(ref: { entityType: string; entityId: string }, entity: any) {
  const title =
    entity?.title ??
    entity?.name ??
    entity?.url ??
    (typeof entity?.body === "string" ? entity.body.slice(0, 80) : undefined) ??
    ref.entityId;
  const summary = [
    entity?.summary,
    entity?.description,
    entity?.body,
    entity?.relationshipContext,
    entity?.roleTitle,
    entity?.notes,
    entity?.domain,
    entity?.website,
    entity?.whyItMatters,
    entity?.objectType,
    entity?.status,
    ...(entity?.emails ?? []),
  ]
    .filter(Boolean)
    .join(" ");

  const display: {
    ref: { entityType: string; entityId: string };
    entity: any;
    title: string;
    summary?: string;
  } = {
    ref,
    entity,
    title,
  };
  if (summary) {
    display.summary = summary;
  }
  return display;
}

function entityContextText(item: { title?: string; summary?: string; ref: { entityType: string; entityId: string } }) {
  return [item.ref.entityType, item.ref.entityId, item.title, item.summary].filter(Boolean).join(" ");
}

function scoreMemoryResult(
  memory: any,
  sourceRefs: any[],
  relatedEntities: Array<{ ref: { entityType: string; entityId: string }; entity: any }>,
  args: {
    query?: string;
    relatedEntityRefs?: Array<{ entityType: string; entityId: string }>;
  },
) {
  const tokens = searchTokens(args.query);
  const query = args.query?.trim().toLowerCase();
  const sourceText = sourceRefs.map(sourceRefText).join(" ");
  const relatedText = relatedEntities.map((item) => entityContextText(entityDisplay(item.ref, item.entity))).join(" ");
  let score = 0;
  score += textScore(memory.title, tokens, 5);
  score += textScore(memory.summary, tokens, 3);
  score += textScore(memory.body, tokens, 2);
  score += textScore(sourceText, tokens, 1);
  score += textScore(relatedText, tokens, 2);
  if (query) {
    const combined = [memory.title, memory.summary, memory.body, sourceText, relatedText].filter(Boolean).join(" ").toLowerCase();
    if (combined.includes(query)) {
      score += 6;
    }
  }

  const requestedRefKeys = new Set((args.relatedEntityRefs ?? []).map((ref) => refKey(ref)));
  const matchingRelatedRefCount = (memory.relatedEntityRefs ?? []).filter((ref: any) => requestedRefKeys.has(refKey(ref))).length;
  score += matchingRelatedRefCount * 8;

  const recencyScore = Math.max(0, Math.min(1, (memory.updatedAt ?? memory.createdAt ?? 0) / Date.now())) / 10;
  score += recencyScore;

  return {
    score: Number(score.toFixed(3)),
    matchedTokens: tokens.filter((token) =>
      [memory.title, memory.summary, memory.body, sourceText, relatedText]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(token),
    ),
    scoreDetails: {
      queryTokenCount: tokens.length,
      matchingRelatedRefCount,
      sourceRefCount: sourceRefs.length,
      relatedEntityCount: relatedEntities.length,
    },
  };
}

async function searchMemoriesForBrainId(
  db: any,
  brainInstanceId: any,
  args: {
    query?: string;
    memoryType?: string;
    kinds?: string[];
    relatedEntityRefs?: Array<{ entityType: string; entityId: string }>;
    includeArchived?: boolean;
    limit?: number;
  },
) {
  const limit = clampSearchLimit(args.limit, 20, 50);
  const queryTokens = searchTokens(args.query);
  const candidateLimit = Math.max(100, Math.min(500, limit * (queryTokens.length || args.relatedEntityRefs?.length ? 12 : 3)));
  const memories = await db
    .query("memories")
    .withIndex("by_brain_updated", (q: any) => q.eq("brainInstanceId", brainInstanceId))
    .order("desc")
    .take(candidateLimit);
  const hydrated = [];

  for (const memory of memories) {
    if (!memoryIsSearchable(memory, args.includeArchived)) {
      continue;
    }
    if (!memoryMatchesType(memory, args)) {
      continue;
    }
    if (!hasRequestedRelatedRefs(memory, args.relatedEntityRefs)) {
      continue;
    }

    const [sourceRefs, relatedEntities] = await Promise.all([
      sourceRefsForMemory(db, brainInstanceId, memory.sourceRefIds),
      relatedEntitiesForMemory(db, brainInstanceId, memory.relatedEntityRefs as any),
    ]);
    const scored = scoreMemoryResult(memory, sourceRefs, relatedEntities, args);
    if (queryTokens.length && scored.score <= 0) {
      continue;
    }
    hydrated.push({
      memory,
      ...scored,
      sourceRefs,
      relatedEntities: relatedEntities.map((item) => entityDisplay(item.ref, item.entity)),
    });
  }

  return hydrated.sort((left, right) => right.score - left.score || (right.memory.updatedAt ?? 0) - (left.memory.updatedAt ?? 0)).slice(0, limit);
}

async function entityContextForRefs(
  db: any,
  brainInstanceId: any,
  refs: Array<{ entityType: keyof typeof entityTableByType; entityId: string }>,
) {
  const contexts = [];
  for (const ref of dedupeEntityRefs(refs) as Array<{ entityType: keyof typeof entityTableByType; entityId: string }>) {
    const tableName = entityTableByType[ref.entityType];
    const entity = tableName ? await db.get(ref.entityId as any) : null;
    if (entity && entity.brainInstanceId === brainInstanceId) {
      contexts.push({ ...entityDisplay(ref, entity), score: 100, reason: "related_entity_ref" });
    }
  }
  return contexts;
}

async function queryMatchedEntityContext(
  db: any,
  brainInstanceId: any,
  query: string | undefined,
  existingKeys: Set<string>,
  limit: number,
) {
  const tokens = searchTokens(query);
  if (tokens.length === 0 || limit <= 0) {
    return [];
  }

  const entityRows = [
    ...(await db.query("goals").withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brainInstanceId)).filter((q: any) => q.eq(q.field("processingState"), "accepted")).take(60)).map((entity: any) => ({ ref: { entityType: "goal", entityId: entity._id }, entity })),
    ...(await db.query("projects").withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brainInstanceId)).filter((q: any) => q.eq(q.field("processingState"), "accepted")).take(60)).map((entity: any) => ({ ref: { entityType: "project", entityId: entity._id }, entity })),
    ...(await db.query("tasks").withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brainInstanceId)).filter((q: any) => q.eq(q.field("processingState"), "accepted")).take(80)).map((entity: any) => ({ ref: { entityType: "task", entityId: entity._id }, entity })),
    ...(await db.query("notes").withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brainInstanceId)).filter((q: any) => q.eq(q.field("processingState"), "accepted")).take(40)).map((entity: any) => ({ ref: { entityType: "note", entityId: entity._id }, entity })),
    ...(await db.query("people").withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brainInstanceId)).filter((q: any) => q.eq(q.field("processingState"), "accepted")).take(60)).map((entity: any) => ({ ref: { entityType: "person", entityId: entity._id }, entity })),
    ...(await db.query("companies").withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brainInstanceId)).filter((q: any) => q.eq(q.field("processingState"), "accepted")).take(60)).map((entity: any) => ({ ref: { entityType: "company", entityId: entity._id }, entity })),
    ...(await db.query("links").withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brainInstanceId)).filter((q: any) => q.eq(q.field("processingState"), "accepted")).take(60)).map((entity: any) => ({ ref: { entityType: "link", entityId: entity._id }, entity })),
    ...(await db.query("knowledgeObjects").withIndex("by_brain_state", (q: any) => q.eq("brainInstanceId", brainInstanceId)).filter((q: any) => q.eq(q.field("processingState"), "accepted")).take(40)).map((entity: any) => ({ ref: { entityType: "knowledgeObject", entityId: entity._id }, entity })),
  ];

  return entityRows
    .map(({ ref, entity }) => {
      const display = entityDisplay(ref, entity);
      const score = textScore(entityContextText(display), tokens, 2);
      return { ...display, score, reason: "query_match" };
    })
    .filter((item) => item.score > 0 && !existingKeys.has(refKey(item.ref)))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

async function contextBundleForBrainId(
  db: any,
  brainInstanceId: any,
  args: {
    query?: string;
    memoryType?: string;
    kinds?: string[];
    relatedEntityRefs?: Array<{ entityType: keyof typeof entityTableByType; entityId: string }>;
    includeArchived?: boolean;
    memoryLimit?: number;
    entityLimit?: number;
    sourceLimit?: number;
  },
) {
  const memoryLimit = clampSearchLimit(args.memoryLimit, 8, 25);
  const entityLimit = clampSearchLimit(args.entityLimit, 12, 40);
  const sourceLimit = clampSearchLimit(args.sourceLimit, 12, 40);
  const memorySearchArgs: {
    query?: string;
    memoryType?: string;
    kinds?: string[];
    relatedEntityRefs?: Array<{ entityType: string; entityId: string }>;
    includeArchived?: boolean;
    limit?: number;
  } = { limit: memoryLimit };
  if (args.query !== undefined) {
    memorySearchArgs.query = args.query;
  }
  if (args.memoryType !== undefined) {
    memorySearchArgs.memoryType = args.memoryType;
  }
  if (args.kinds !== undefined) {
    memorySearchArgs.kinds = args.kinds;
  }
  if (args.relatedEntityRefs !== undefined) {
    memorySearchArgs.relatedEntityRefs = args.relatedEntityRefs;
  }
  if (args.includeArchived !== undefined) {
    memorySearchArgs.includeArchived = args.includeArchived;
  }
  const memories = await searchMemoriesForBrainId(db, brainInstanceId, memorySearchArgs);
  const memoryRelatedRefs = memories.flatMap((result) => result.memory.relatedEntityRefs ?? []);
  const explicitEntities = await entityContextForRefs(db, brainInstanceId, [
    ...((args.relatedEntityRefs ?? []) as any),
    ...memoryRelatedRefs,
  ]);
  const explicitEntityKeys = new Set(explicitEntities.map((item) => refKey(item.ref)));
  const matchedEntities = await queryMatchedEntityContext(
    db,
    brainInstanceId,
    args.query,
    explicitEntityKeys,
    Math.max(0, entityLimit - explicitEntities.length),
  );
  const sourceRefs = [];
  const sourceRefIds = new Set<string>();
  for (const memoryResult of memories) {
    for (const sourceRef of memoryResult.sourceRefs ?? []) {
      const key = String(sourceRef._id);
      if (!sourceRefIds.has(key) && sourceRefs.length < sourceLimit) {
        sourceRefIds.add(key);
        sourceRefs.push(sourceRef);
      }
    }
  }

  return {
    query: args.query,
    filters: {
      memoryType: args.memoryType,
      kinds: args.kinds,
      relatedEntityRefs: args.relatedEntityRefs,
      includeArchived: args.includeArchived ?? false,
    },
    memories,
    entities: [...explicitEntities, ...matchedEntities].slice(0, entityLimit),
    sourceRefs,
    limits: { memoryLimit, entityLimit, sourceLimit },
  };
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

    const existingAcceptedEntity = await findAcceptedEntityDuplicate(
      db,
      args.brainInstanceId,
      args.candidateEntityType as keyof typeof entityTableByType,
      normalizedPayload,
    );
    if (existingAcceptedEntity) {
      const entityTypeName = args.candidateEntityType as keyof typeof entityTableByType;
      await mergeIntoDuplicateEntity(
        db,
        args.brainInstanceId,
        entityTypeName,
        existingAcceptedEntity,
        normalizedPayload,
        sourceRefIds,
        now,
        `Duplicate suggested ${entityTypeName} matched an existing accepted ${entityTypeName}.`,
        { candidateFingerprint: fingerprint },
      );

      return {
        entityRef: { entityType: entityTypeName, entityId: existingAcceptedEntity._id },
        entityId: existingAcceptedEntity._id,
        sourceRefIds,
        duplicate: true,
        status: "duplicate_existing",
        candidateFingerprint: fingerprint,
      };
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
    const duplicateEntity = await findAcceptedEntityDuplicate(db, args.brainInstanceId, entityTypeName, normalizedPayload);
    if (duplicateEntity) {
      await mergeIntoDuplicateEntity(
        db,
        args.brainInstanceId,
        entityTypeName,
        duplicateEntity,
        normalizedPayload,
        sourceRefIds,
        now,
        `Merged duplicate direct ${entityTypeName} ingestion into existing accepted ${entityTypeName}.`,
        {
          rubricDecision: args.rubricDecision,
          candidateFingerprint: candidateFingerprint(entityTypeName, normalizedPayload),
        },
      );

      return {
        status: "duplicate_existing",
        duplicate: true,
        entityType: entityTypeName,
        entityId: duplicateEntity._id,
        title: displayPayload.title ?? displayPayload.name ?? displayPayload.url ?? displayPayload.body,
        sourceRefIds,
        rubricDecision: args.rubricDecision,
      };
    }

    const entityId = await db.insert(tableName, entityDocument);
    const acceptedEntityRef = { entityType: entityTypeName, entityId };

    await linkSourceRefsToEntity(db, args.brainInstanceId, acceptedEntityRef, sourceRefIds, "created_from", now);

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
      "user",
      reviewedBy,
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
      "user",
      user._id,
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

export const ingestionRunsForViewer = queryGeneric({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    return await ctx.db
      .query("ingestionRuns")
      .withIndex("by_brain_started", (q) => q.eq("brainInstanceId", brain._id))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const ingestionRunDetailForViewer = queryGeneric({
  args: {
    ingestionRunId: v.id("ingestionRuns"),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const run = await ctx.db.get(args.ingestionRunId);
    if (!run || run.brainInstanceId !== brain._id) {
      return null;
    }

    const windowEnd = run.completedAt ?? Date.now();
    const activityEvents = (
      await ctx.db
        .query("activityEvents")
        .withIndex("by_brain_timestamp", (q) => q.eq("brainInstanceId", brain._id))
        .order("desc")
        .take(200)
    ).filter((event) => {
      if (event.ingestionRunId === run._id) {
        return true;
      }
      return event.timestamp >= run.startedAt && event.timestamp <= windowEnd;
    });

    const sourceRefIds = Array.from(
      new Set(activityEvents.flatMap((event) => (event.sourceRefIds ?? []).map((sourceRefId: unknown) => String(sourceRefId)))),
    );
    const sourceRefs = [];
    for (const sourceRefId of sourceRefIds) {
      const sourceRef = await ctx.db.get(sourceRefId as any);
      if (sourceRef && sourceRef.brainInstanceId === brain._id) {
        sourceRefs.push(sourceRef);
      }
    }

    const memoryIds = Array.from(
      new Set(
        activityEvents
          .map((event) => event.metadata?.memoryId)
          .filter((memoryId): memoryId is string => typeof memoryId === "string" && memoryId.length > 0),
      ),
    );
    const memories = [];
    for (const memoryId of memoryIds) {
      const memory = await ctx.db.get(memoryId as any);
      if (memory && memory.brainInstanceId === brain._id) {
        memories.push(memory);
      }
    }

    const entityRefs = Array.from(
      new Map(
        activityEvents
          .map((event) => event.entityRef)
          .filter((ref): ref is { entityType: keyof typeof entityTableByType; entityId: string } => Boolean(ref))
          .map((ref) => [`${ref.entityType}:${ref.entityId}`, ref]),
      ).values(),
    );
    const entities = [];
    for (const ref of entityRefs) {
      const entityTable = entityTableByType[ref.entityType];
      const entity = entityTable ? await ctx.db.get(ref.entityId as any) : null;
      if (entity && entity.brainInstanceId === brain._id) {
        entities.push({ ref, entity });
      }
    }

    const ignoredItems =
      Array.isArray(run.metadata?.ignoredItems) ? run.metadata.ignoredItems :
      Array.isArray(run.metadata?.ignored) ? run.metadata.ignored :
      Array.isArray(run.metadata?.skippedItems) ? run.metadata.skippedItems :
      [];
    const auditSummary = activityEvents.reduce(
      (summary, event) => {
        const type = event.activityType;
        if (type.includes("review_candidate") || type.includes("candidate_submitted")) {
          summary.sentToReview += 1;
        } else if (type.includes("rejected")) {
          summary.rejected += 1;
        } else if (type.includes("linked")) {
          summary.linked += 1;
        } else if (type.includes("updated") || type.includes("reviewed")) {
          summary.updated += 1;
        } else if (type.includes("created") || type.includes("recorded") || type.includes("captured") || type.includes("ingested") || type.includes("accepted")) {
          summary.capturedDirect += 1;
        }
        return summary;
      },
      {
        capturedDirect: 0,
        sentToReview: 0,
        linked: 0,
        updated: 0,
        rejected: 0,
        ignored: ignoredItems.length,
      },
    );

    return { run, activityEvents, sourceRefs, memories, entities, ignoredItems, auditSummary };
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
    const { user, brain } = await requireOwnedBrain(ctx);
    const config = await ctx.db
      .query("brainConfigs")
      .withIndex("by_brain", (q) => q.eq("brainInstanceId", brain._id))
      .first();
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

    return {
      brain,
      displayLabels: {
        ownerName: user.displayName,
        agentName: config?.assistantDisplayName ?? brain.displayName,
      },
      projects,
      tasks: tasksWithProjectIds,
    };
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

export const createProjectForViewer = mutationGeneric({
  args: {
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
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const title = args.title.trim();
    if (!title) {
      throw new Error("project title is required");
    }
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      brainInstanceId: brain._id,
      title,
      summary: args.summary?.trim() || undefined,
      status: args.status ?? "idea",
      processingState: "accepted",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      entityRef: { entityType: "project", entityId: projectId },
      activityType: "project_created",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Project created: ${title}`,
    });

    return { projectId, status: "created" };
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

export const listMemoryInboxForViewer = queryGeneric({
  args: {
    limit: v.optional(v.number()),
    memoryType: v.optional(memoryType),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const memories = await ctx.db
      .query("memories")
      .withIndex("by_brain_status", (q) => q.eq("brainInstanceId", brain._id))
      .filter((q) => q.eq(q.field("status"), "inbox"))
      .order("desc")
      .take(args.limit ?? 50);

    return args.memoryType ? memories.filter((memory) => memory.memoryType === args.memoryType) : memories;
  },
});

export const listMemoryReviewItemsForViewer = queryGeneric({
  args: {
    limit: v.optional(v.number()),
    memoryType: v.optional(memoryType),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const memories = await ctx.db
      .query("memories")
      .withIndex("by_brain_review_state", (q) => q.eq("brainInstanceId", brain._id))
      .filter((q) => q.eq(q.field("reviewState"), "pending_review"))
      .order("desc")
      .take(args.limit ?? 50);

    return args.memoryType ? memories.filter((memory) => memory.memoryType === args.memoryType) : memories;
  },
});

export const listAcceptedMemoryLibraryForViewer = queryGeneric({
  args: {
    limit: v.optional(v.number()),
    memoryType: v.optional(memoryType),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const memories = args.memoryType
      ? await ctx.db
          .query("memories")
          .withIndex("by_brain_type_status", (q) => q.eq("brainInstanceId", brain._id))
          .filter((q) => q.and(q.eq(q.field("memoryType"), args.memoryType), q.eq(q.field("status"), "accepted")))
          .order("desc")
          .take(args.limit ?? 100)
      : await ctx.db
          .query("memories")
          .withIndex("by_brain_status", (q) => q.eq("brainInstanceId", brain._id))
          .filter((q) => q.eq(q.field("status"), "accepted"))
          .order("desc")
          .take(args.limit ?? 100);

    return memories;
  },
});

export const searchMemoriesForViewer = queryGeneric({
  args: {
    query: v.optional(v.string()),
    memoryType: v.optional(memoryType),
    kinds: v.optional(v.array(memoryType)),
    relatedEntityRefs: v.optional(v.array(entityRef)),
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    return await searchMemoriesForBrainId(ctx.db, brain._id, args);
  },
});

export const getContextBundleForViewer = queryGeneric({
  args: {
    query: v.optional(v.string()),
    memoryType: v.optional(memoryType),
    kinds: v.optional(v.array(memoryType)),
    relatedEntityRefs: v.optional(v.array(entityRef)),
    includeArchived: v.optional(v.boolean()),
    memoryLimit: v.optional(v.number()),
    entityLimit: v.optional(v.number()),
    sourceLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    return await contextBundleForBrainId(ctx.db, brain._id, args);
  },
});

export const getMemoryDetailForViewer = queryGeneric({
  args: {
    memoryId: v.id("memories"),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const memory = await ctx.db.get(args.memoryId);
    if (!memory || memory.brainInstanceId !== brain._id) {
      return null;
    }

    const [sourceRefs, relatedEntities] = await Promise.all([
      sourceRefsForMemory(ctx.db, brain._id, memory.sourceRefIds),
      relatedEntitiesForMemory(ctx.db, brain._id, memory.relatedEntityRefs as any),
    ]);

    return { memory, sourceRefs, relatedEntities };
  },
});

export const captureThoughtForViewer = mutationGeneric({
  args: {
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    body: v.string(),
    confidence: v.optional(v.number()),
    sourceRefIds: v.optional(v.array(v.id("sourceRefs"))),
    sourceRefs: v.optional(v.array(sourceRefInput)),
    relatedEntityRefs: v.optional(v.array(entityRef)),
    captureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const body = args.body.trim();
    if (!body) {
      throw new Error("thought body is required");
    }

    const now = Date.now();
    const sourceRefIds = await memorySourceRefIdsFromArgs(
      ctx.db,
      brain._id,
      args.sourceRefIds,
      args.sourceRefs,
      now,
    );
    const relatedEntityRefs = await requireRelatedEntityRefsForBrain(ctx.db, brain._id, args.relatedEntityRefs as any);
    const title = memoryTitleFor("thought", args.title, body);
    const memoryId = await ctx.db.insert("memories", {
      brainInstanceId: brain._id,
      memoryType: "thought",
      title,
      summary: optionalTrimmed(args.summary),
      body,
      status: "inbox",
      reviewState: "unreviewed",
      confidence: args.confidence,
      sourceRefIds,
      relatedEntityRefs,
      captureReason: optionalTrimmed(args.captureReason),
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "memory_thought_captured",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Thought captured: ${title}`,
      metadata: { memoryId, memoryType: "thought", captureReason: args.captureReason },
      sourceRefIds,
    });

    return { memoryId, status: "inbox", reviewState: "unreviewed" };
  },
});

export const recordDurableMemoryForViewer = mutationGeneric({
  args: {
    memoryType: v.optional(memoryType),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    body: v.string(),
    confidence: v.optional(v.number()),
    sourceRefIds: v.optional(v.array(v.id("sourceRefs"))),
    sourceRefs: v.optional(v.array(sourceRefInput)),
    relatedEntityRefs: v.optional(v.array(entityRef)),
    rubricDecision: v.optional(v.string()),
    captureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const body = args.body.trim();
    if (!body) {
      throw new Error("memory body is required");
    }

    const now = Date.now();
    const memoryTypeName = args.memoryType ?? "memory";
    const sourceRefIds = await memorySourceRefIdsFromArgs(
      ctx.db,
      brain._id,
      args.sourceRefIds,
      args.sourceRefs,
      now,
    );
    const relatedEntityRefs = await requireRelatedEntityRefsForBrain(ctx.db, brain._id, args.relatedEntityRefs as any);
    const title = memoryTitleFor(memoryTypeName, args.title, body);
    const memoryId = await ctx.db.insert("memories", {
      brainInstanceId: brain._id,
      memoryType: memoryTypeName,
      title,
      summary: optionalTrimmed(args.summary),
      body,
      status: "accepted",
      reviewState: "accepted",
      confidence: args.confidence,
      sourceRefIds,
      relatedEntityRefs,
      rubricDecision: optionalTrimmed(args.rubricDecision),
      captureReason: optionalTrimmed(args.captureReason),
      reviewedBy: user._id,
      reviewedAt: now,
      acceptedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "memory_recorded",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Memory recorded: ${title}`,
      metadata: {
        memoryId,
        memoryType: memoryTypeName,
        rubricDecision: args.rubricDecision,
        captureReason: args.captureReason,
      },
      sourceRefIds,
    });

    return { memoryId, status: "accepted", reviewState: "accepted" };
  },
});

export const submitMemoryReviewCandidateForViewer = mutationGeneric({
  args: {
    memoryType,
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    body: v.string(),
    confidence: v.optional(v.number()),
    sourceRefIds: v.optional(v.array(v.id("sourceRefs"))),
    sourceRefs: v.optional(v.array(sourceRefInput)),
    relatedEntityRefs: v.optional(v.array(entityRef)),
    rubricDecision: v.optional(v.string()),
    captureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const body = args.body.trim();
    if (!body) {
      throw new Error("candidate body is required");
    }

    const now = Date.now();
    const sourceRefIds = await memorySourceRefIdsFromArgs(
      ctx.db,
      brain._id,
      args.sourceRefIds,
      args.sourceRefs,
      now,
    );
    const relatedEntityRefs = await requireRelatedEntityRefsForBrain(ctx.db, brain._id, args.relatedEntityRefs as any);
    const title = memoryTitleFor(args.memoryType, args.title, body);
    const memoryId = await ctx.db.insert("memories", {
      brainInstanceId: brain._id,
      memoryType: args.memoryType,
      title,
      summary: optionalTrimmed(args.summary),
      body,
      status: "inbox",
      reviewState: "pending_review",
      confidence: args.confidence,
      sourceRefIds,
      relatedEntityRefs,
      rubricDecision: optionalTrimmed(args.rubricDecision),
      captureReason: optionalTrimmed(args.captureReason),
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "memory_review_candidate_submitted",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Memory review candidate submitted: ${title}`,
      metadata: {
        memoryId,
        memoryType: args.memoryType,
        rubricDecision: args.rubricDecision,
        captureReason: args.captureReason,
      },
      sourceRefIds,
    });

    return { memoryId, status: "inbox", reviewState: "pending_review" };
  },
});

export const acceptMemoryForViewer = mutationGeneric({
  args: {
    memoryId: v.id("memories"),
    memoryType: v.optional(memoryType),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    body: v.optional(v.string()),
    confidence: v.optional(v.number()),
    sourceRefIds: v.optional(v.array(v.id("sourceRefs"))),
    sourceRefs: v.optional(v.array(sourceRefInput)),
    relatedEntityRefs: v.optional(v.array(entityRef)),
    rubricDecision: v.optional(v.string()),
    captureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const memory = await ctx.db.get(args.memoryId);
    if (!memory || memory.brainInstanceId !== brain._id) {
      throw new Error("memory not found");
    }
    if (memory.status === "archived") {
      throw new Error("archived memories cannot be accepted");
    }

    const now = Date.now();
    const body = args.body === undefined ? memory.body : args.body.trim();
    if (!body) {
      throw new Error("memory body cannot be empty");
    }
    const memoryTypeName = args.memoryType ?? memory.memoryType;
    const newSourceRefIds = await memorySourceRefIdsFromArgs(
      ctx.db,
      brain._id,
      args.sourceRefIds,
      args.sourceRefs,
      now,
    );
    const relatedEntityRefs =
      args.relatedEntityRefs === undefined
        ? memory.relatedEntityRefs
        : await requireRelatedEntityRefsForBrain(ctx.db, brain._id, args.relatedEntityRefs as any);
    const sourceRefIds = dedupeIds([...(memory.sourceRefIds ?? []), ...newSourceRefIds]);
    const title = memoryTitleFor(memoryTypeName, args.title ?? memory.title, body);

    await ctx.db.patch(args.memoryId, {
      memoryType: memoryTypeName,
      title,
      summary: args.summary === undefined ? memory.summary : optionalTrimmed(args.summary),
      body,
      status: "accepted",
      reviewState: "accepted",
      confidence: args.confidence ?? memory.confidence,
      sourceRefIds,
      relatedEntityRefs,
      rubricDecision: args.rubricDecision === undefined ? memory.rubricDecision : optionalTrimmed(args.rubricDecision),
      captureReason: args.captureReason === undefined ? memory.captureReason : optionalTrimmed(args.captureReason),
      reviewedBy: user._id,
      reviewedAt: now,
      acceptedAt: memory.acceptedAt ?? now,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "memory_accepted",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Memory accepted: ${title}`,
      metadata: { memoryId: args.memoryId, memoryType: memoryTypeName },
      sourceRefIds,
    });

    return { memoryId: args.memoryId, status: "accepted", reviewState: "accepted" };
  },
});

export const rejectMemoryForViewer = mutationGeneric({
  args: {
    memoryId: v.id("memories"),
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const memory = await ctx.db.get(args.memoryId);
    if (!memory || memory.brainInstanceId !== brain._id) {
      throw new Error("memory not found");
    }

    const now = Date.now();
    await ctx.db.patch(args.memoryId, {
      status: "rejected",
      reviewState: "rejected",
      reviewedBy: user._id,
      reviewedAt: now,
      rejectedAt: now,
      rejectionReason: optionalTrimmed(args.rejectionReason),
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "memory_rejected",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Memory rejected: ${memory.title}`,
      metadata: { memoryId: args.memoryId, rejectionReason: args.rejectionReason },
      sourceRefIds: memory.sourceRefIds,
    });

    return { memoryId: args.memoryId, status: "rejected", reviewState: "rejected" };
  },
});

export const archiveMemoryForViewer = mutationGeneric({
  args: {
    memoryId: v.id("memories"),
    archiveReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const memory = await ctx.db.get(args.memoryId);
    if (!memory || memory.brainInstanceId !== brain._id) {
      throw new Error("memory not found");
    }

    const now = Date.now();
    await ctx.db.patch(args.memoryId, {
      status: "archived",
      reviewState: "archived",
      archivedAt: now,
      archiveReason: optionalTrimmed(args.archiveReason),
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "memory_archived",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Memory archived: ${memory.title}`,
      metadata: { memoryId: args.memoryId, archiveReason: args.archiveReason },
      sourceRefIds: memory.sourceRefIds,
    });

    return { memoryId: args.memoryId, status: "archived", reviewState: "archived" };
  },
});

export const linkMemoryToEntitiesForViewer = mutationGeneric({
  args: {
    memoryId: v.id("memories"),
    relatedEntityRefs: v.array(entityRef),
    mode: v.optional(v.union(v.literal("add"), v.literal("replace"))),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const memory = await ctx.db.get(args.memoryId);
    if (!memory || memory.brainInstanceId !== brain._id) {
      throw new Error("memory not found");
    }

    const now = Date.now();
    const requestedRefs = await requireRelatedEntityRefsForBrain(ctx.db, brain._id, args.relatedEntityRefs as any);
    const relatedEntityRefs =
      args.mode === "replace"
        ? requestedRefs
        : dedupeEntityRefs([...(memory.relatedEntityRefs ?? []), ...requestedRefs]);

    await ctx.db.patch(args.memoryId, {
      relatedEntityRefs,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: args.mode === "replace" ? "memory_entity_links_replaced" : "memory_entity_links_added",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Memory linked to ${requestedRefs.length} ${requestedRefs.length === 1 ? "entity" : "entities"}: ${memory.title}`,
      metadata: {
        memoryId: args.memoryId,
        relatedEntityRefs,
        reason: args.reason,
      },
      sourceRefIds: memory.sourceRefIds,
    });

    return { memoryId: args.memoryId, relatedEntityRefs };
  },
});

export const captureThoughtForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    text: v.string(),
    content: v.optional(v.string()),
    proposedKind: v.optional(memoryType),
    captureReason: v.optional(v.string()),
    rubricDecision: v.optional(v.string()),
    confidence: v.optional(v.number()),
    reviewBehavior: v.optional(memoryReviewBehavior),
    sourceRefIds: v.optional(v.array(v.id("sourceRefs"))),
    sourceRefs: v.optional(v.array(sourceRefInput)),
    relatedEntityRefs: v.optional(v.array(entityRef)),
    createdBy: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async ({ db }, args) => {
    const body = (args.content ?? args.text).trim();
    if (!body) {
      throw new Error("memory content is required");
    }

    const now = Date.now();
    const memoryTypeName = args.proposedKind ?? "memory";
    const reviewBehavior = args.reviewBehavior ?? "auto";
    const sourceRefIds = await memorySourceRefIdsFromArgs(db, args.brainInstanceId, args.sourceRefIds, args.sourceRefs, now);
    const relatedEntityRefs = await requireRelatedEntityRefsForBrain(db, args.brainInstanceId, args.relatedEntityRefs as any);
    const title = memoryTitleFor(memoryTypeName, undefined, body);
    const submitForReview = reviewBehavior === "submit_for_review";
    const directAccept = reviewBehavior === "accept";

    const memoryId = await db.insert("memories", {
      brainInstanceId: args.brainInstanceId,
      memoryType: memoryTypeName,
      title,
      body,
      status: directAccept ? "accepted" : "inbox",
      reviewState: directAccept ? "accepted" : submitForReview ? "pending_review" : "unreviewed",
      confidence: args.confidence,
      sourceRefIds,
      relatedEntityRefs,
      rubricDecision: optionalTrimmed(args.rubricDecision),
      captureReason: optionalTrimmed(args.captureReason),
      acceptedAt: directAccept ? now : undefined,
      reviewedAt: directAccept ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      activityType: submitForReview ? "memory_review_candidate_submitted" : "memory_captured_from_mcp",
      actorType: "harness",
      actorId: args.createdBy,
      timestamp: now,
      summary: `${submitForReview ? "Memory review candidate submitted" : "Memory captured"}: ${title}`,
      metadata: {
        memoryId,
        memoryType: memoryTypeName,
        captureReason: args.captureReason,
        rubricDecision: args.rubricDecision,
        reviewBehavior,
        sourceMetadata: args.metadata,
      },
      sourceRefIds,
    });

    return {
      status: submitForReview ? "submitted_for_review" : "captured",
      memoryId,
      reviewItemId: submitForReview ? memoryId : undefined,
      kind: memoryTypeName,
      title,
      sourceRefIds,
      relatedEntityRefs,
      confidence: args.confidence,
      rubricDecision: args.rubricDecision,
    };
  },
});

export const recordMemoryForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    content: v.string(),
    kind: v.optional(memoryType),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    captureReason: v.optional(v.string()),
    rubricDecision: v.string(),
    confidence: v.optional(v.number()),
    reviewBehavior: v.optional(memoryReviewBehavior),
    sourceRefIds: v.optional(v.array(v.id("sourceRefs"))),
    sourceRefs: v.optional(v.array(sourceRefInput)),
    relatedEntityRefs: v.optional(v.array(entityRef)),
    createdBy: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async ({ db }, args) => {
    const body = args.content.trim();
    if (!body) {
      throw new Error("memory content is required");
    }
    const rubricDecision = args.rubricDecision.trim();
    if (!rubricDecision) {
      throw new Error("rubricDecision is required");
    }

    const now = Date.now();
    const memoryTypeName = args.kind ?? "memory";
    const reviewBehavior = args.reviewBehavior ?? "accept";
    const submitForReview = reviewBehavior === "submit_for_review";
    const sourceRefIds = await memorySourceRefIdsFromArgs(db, args.brainInstanceId, args.sourceRefIds, args.sourceRefs, now);
    const relatedEntityRefs = await requireRelatedEntityRefsForBrain(db, args.brainInstanceId, args.relatedEntityRefs as any);
    const title = memoryTitleFor(memoryTypeName, args.title, body);

    const memoryId = await db.insert("memories", {
      brainInstanceId: args.brainInstanceId,
      memoryType: memoryTypeName,
      title,
      summary: optionalTrimmed(args.summary),
      body,
      status: submitForReview ? "inbox" : "accepted",
      reviewState: submitForReview ? "pending_review" : "accepted",
      confidence: args.confidence,
      sourceRefIds,
      relatedEntityRefs,
      rubricDecision,
      captureReason: optionalTrimmed(args.captureReason),
      acceptedAt: submitForReview ? undefined : now,
      reviewedAt: submitForReview ? undefined : now,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      activityType: submitForReview ? "memory_review_candidate_submitted" : "memory_recorded_from_mcp",
      actorType: "harness",
      actorId: args.createdBy,
      timestamp: now,
      summary: `${submitForReview ? "Memory review candidate submitted" : "Memory recorded"}: ${title}`,
      metadata: {
        memoryId,
        memoryType: memoryTypeName,
        captureReason: args.captureReason,
        rubricDecision,
        reviewBehavior,
        sourceMetadata: args.metadata,
      },
      sourceRefIds,
    });

    return {
      status: submitForReview ? "submitted_for_review" : "recorded",
      memoryId,
      reviewItemId: submitForReview ? memoryId : undefined,
      kind: memoryTypeName,
      title,
      sourceRefIds,
      relatedEntityRefs,
      confidence: args.confidence,
      rubricDecision,
    };
  },
});

export const submitMemoryReviewCandidateForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    content: v.string(),
    proposedKind: v.optional(memoryType),
    captureReason: v.optional(v.string()),
    rubricDecision: v.optional(v.string()),
    confidence: v.optional(v.number()),
    reviewBehavior: v.optional(memoryReviewBehavior),
    sourceRefIds: v.optional(v.array(v.id("sourceRefs"))),
    sourceRefs: v.optional(v.array(sourceRefInput)),
    relatedEntityRefs: v.optional(v.array(entityRef)),
    createdBy: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async ({ db }, args) => {
    const body = args.content.trim();
    if (!body) {
      throw new Error("memory content is required");
    }

    const now = Date.now();
    const memoryTypeName = args.proposedKind ?? "memory";
    const sourceRefIds = await memorySourceRefIdsFromArgs(db, args.brainInstanceId, args.sourceRefIds, args.sourceRefs, now);
    const relatedEntityRefs = await requireRelatedEntityRefsForBrain(db, args.brainInstanceId, args.relatedEntityRefs as any);
    const title = memoryTitleFor(memoryTypeName, undefined, body);
    const memoryId = await db.insert("memories", {
      brainInstanceId: args.brainInstanceId,
      memoryType: memoryTypeName,
      title,
      body,
      status: "inbox",
      reviewState: "pending_review",
      confidence: args.confidence,
      sourceRefIds,
      relatedEntityRefs,
      rubricDecision: optionalTrimmed(args.rubricDecision),
      captureReason: optionalTrimmed(args.captureReason),
      createdAt: now,
      updatedAt: now,
    });

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      activityType: "memory_review_candidate_submitted",
      actorType: "harness",
      actorId: args.createdBy,
      timestamp: now,
      summary: `Memory review candidate submitted: ${title}`,
      metadata: {
        memoryId,
        memoryType: memoryTypeName,
        captureReason: args.captureReason,
        rubricDecision: args.rubricDecision,
        reviewBehavior: args.reviewBehavior,
        sourceMetadata: args.metadata,
      },
      sourceRefIds,
    });

    return {
      status: "submitted_for_review",
      memoryId,
      reviewItemId: memoryId,
      kind: memoryTypeName,
      title,
      sourceRefIds,
      relatedEntityRefs,
      confidence: args.confidence,
      rubricDecision: args.rubricDecision,
    };
  },
});

export const searchMemoriesForBrain = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    query: v.optional(v.string()),
    memoryType: v.optional(memoryType),
    kinds: v.optional(v.array(memoryType)),
    relatedEntityRefs: v.optional(v.array(entityRef)),
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async ({ db }, args) => {
    return await searchMemoriesForBrainId(db, args.brainInstanceId, args);
  },
});

export const searchMemoryForBrain = searchMemoriesForBrain;

export const memoryLibraryForBrain = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    query: v.optional(v.string()),
    memoryType: v.optional(memoryType),
    kinds: v.optional(v.array(memoryType)),
    relatedEntityRefs: v.optional(v.array(entityRef)),
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async ({ db }, args) => {
    return await searchMemoriesForBrainId(db, args.brainInstanceId, args);
  },
});

export const getContextBundleForBrain = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    query: v.optional(v.string()),
    memoryType: v.optional(memoryType),
    kinds: v.optional(v.array(memoryType)),
    relatedEntityRefs: v.optional(v.array(entityRef)),
    includeArchived: v.optional(v.boolean()),
    memoryLimit: v.optional(v.number()),
    entityLimit: v.optional(v.number()),
    sourceLimit: v.optional(v.number()),
  },
  handler: async ({ db }, args) => {
    return await contextBundleForBrainId(db, args.brainInstanceId, args);
  },
});

export const memoryDetailForBrain = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    memoryId: v.id("memories"),
    includeSourceRefs: v.optional(v.boolean()),
    includeRelatedEntities: v.optional(v.boolean()),
  },
  handler: async ({ db }, args) => {
    const memory = await db.get(args.memoryId);
    if (!memory || memory.brainInstanceId !== args.brainInstanceId) {
      return null;
    }

    const [sourceRefs, relatedEntities] = await Promise.all([
      args.includeSourceRefs === false ? [] : sourceRefsForMemory(db, args.brainInstanceId, memory.sourceRefIds),
      args.includeRelatedEntities === false ? [] : relatedEntitiesForMemory(db, args.brainInstanceId, memory.relatedEntityRefs as any),
    ]);

    return { memory, sourceRefs, relatedEntities };
  },
});

export const linkMemoryForBrain = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    memoryId: v.id("memories"),
    entityRef,
    relationshipType: v.optional(v.string()),
    reason: v.optional(v.string()),
    confidence: v.optional(v.number()),
    sourceRefIds: v.optional(v.array(v.id("sourceRefs"))),
    sourceRefs: v.optional(v.array(sourceRefInput)),
    createdBy: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const memory = await db.get(args.memoryId);
    if (!memory || memory.brainInstanceId !== args.brainInstanceId) {
      throw new Error("memory not found for brain instance");
    }

    const now = Date.now();
    const [entityRefToAdd] = await requireRelatedEntityRefsForBrain(db, args.brainInstanceId, [args.entityRef] as any);
    const newSourceRefIds = await memorySourceRefIdsFromArgs(db, args.brainInstanceId, args.sourceRefIds, args.sourceRefs, now);
    const relatedEntityRefs = dedupeEntityRefs([...(memory.relatedEntityRefs ?? []), entityRefToAdd]);
    const sourceRefIds = dedupeIds([...(memory.sourceRefIds ?? []), ...newSourceRefIds]);

    await db.patch(args.memoryId, {
      relatedEntityRefs,
      sourceRefIds,
      updatedAt: now,
    });

    await db.insert("activityEvents", {
      brainInstanceId: args.brainInstanceId,
      activityType: "memory_entity_linked_from_mcp",
      actorType: "harness",
      actorId: args.createdBy,
      timestamp: now,
      summary: `Memory linked to ${args.entityRef.entityType}: ${memory.title}`,
      metadata: {
        memoryId: args.memoryId,
        entityRef: args.entityRef,
        relationshipType: args.relationshipType,
        reason: args.reason,
        confidence: args.confidence,
      },
      sourceRefIds,
    });

    return {
      status: "linked",
      memoryId: args.memoryId,
      relatedEntityRefs,
      sourceRefIds,
      confidence: args.confidence,
    };
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
      executionState: "done",
      updatedAt: now,
    });
    await advanceDependentsAfterDone(db, args.brainInstanceId, args.taskId, now);

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
      executionState: "in_progress",
      agentRequestStatus: undefined,
      requestedHarness: undefined,
      agentRequestMessage: undefined,
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
    ownerType: v.optional(v.union(v.literal("owner"), v.literal("agent"))),
    kind: v.optional(taskKind),
    dueAt: v.optional(v.number()),
    priorityReason: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    createdBy: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    const normalizedTitle = args.title.trim();
    const normalizedKind = args.kind ?? (args.ownerType === "agent" ? "coding" : undefined);
    const normalizedPayload = normalizeAcceptedEntityPayload("task", {
      title: normalizedTitle,
      description: args.description,
      status: args.status ?? "todo",
      ownerType: args.ownerType,
      kind: normalizedKind,
      dueAt: args.dueAt,
      priorityReason: args.priorityReason,
    });
    const duplicateTask = await findAcceptedEntityDuplicate(db, args.brainInstanceId, "task", normalizedPayload);

    let projectTitle = undefined;
    let relationshipId = undefined;
    if (args.projectId) {
      const project = await db.get(args.projectId);
      if (!project || project.brainInstanceId !== args.brainInstanceId) {
        throw new Error("project not found for brain instance");
      }
      projectTitle = project.title;
    }

    if (duplicateTask) {
      await db.patch(duplicateTask._id, mergeDuplicateEntityPatch("task", duplicateTask, normalizedPayload, now));

      if (args.projectId) {
        const existingRelationship = await db
          .query("relationships")
          .withIndex("by_brain_type", (q) => q.eq("brainInstanceId", args.brainInstanceId))
          .filter((q) => q.eq(q.field("type"), "belongs_to"))
          .filter((q) => q.eq(q.field("from.entityType"), "task"))
          .filter((q) => q.eq(q.field("from.entityId"), duplicateTask._id))
          .filter((q) => q.eq(q.field("to.entityType"), "project"))
          .filter((q) => q.eq(q.field("to.entityId"), args.projectId))
          .first();

        relationshipId = existingRelationship?._id;
        if (!relationshipId) {
          relationshipId = await db.insert("relationships", {
            brainInstanceId: args.brainInstanceId,
            from: { entityType: "task", entityId: duplicateTask._id },
            to: { entityType: "project", entityId: args.projectId },
            type: "belongs_to",
            confidence: 1,
            reason: "Duplicate task creation request linked the existing task to this project.",
            createdBy: "harness",
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      await db.insert("activityEvents", {
        brainInstanceId: args.brainInstanceId,
        entityRef: { entityType: "task", entityId: duplicateTask._id },
        activityType: "duplicate_task_create_reused",
        actorType: "harness",
        actorId: args.createdBy,
        timestamp: now,
        summary: `Reused existing task for duplicate create request: ${duplicateTask.title}`,
        metadata: { requestedTitle: normalizedTitle, projectId: args.projectId, relationshipId },
      });

      return {
        status: "duplicate_existing",
        duplicate: true,
        entityType: "task",
        taskId: duplicateTask._id,
        title: duplicateTask.title,
        ownerType: duplicateTask.ownerType ?? args.ownerType,
        kind: duplicateTask.kind ?? normalizedKind,
        projectId: args.projectId,
        projectTitle,
        relationshipId,
      };
    }

    const taskId = await db.insert("tasks", {
      brainInstanceId: args.brainInstanceId,
      title: normalizedTitle,
      description: args.description,
      status: args.status ?? "todo",
      ownerType: args.ownerType,
      kind: normalizedKind,
      executionState: args.ownerType === "agent" ? "ready" : undefined,
      dueAt: args.dueAt,
      priorityReason: args.priorityReason,
      processingState: "accepted",
      createdAt: now,
      updatedAt: now,
    });

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
      ownerType: args.ownerType,
      kind: normalizedKind,
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
      executionState: "done",
      updatedAt: now,
    });
    await advanceDependentsAfterDone(ctx.db, brain._id, args.taskId, now);

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

export const markTaskInProgressForViewer = mutationGeneric({
  args: {
    taskId: v.id("tasks"),
    startedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.brainInstanceId !== brain._id) {
      throw new Error("task not found");
    }
    if (task.processingState !== "accepted") {
      throw new Error("only accepted tasks can be started from the web app");
    }
    if (task.ownerType !== "agent") {
      throw new Error("only agent-owned tasks can be started from the web app");
    }
    if (task.status === "done" || task.status === "cancelled") {
      throw new Error("done or cancelled tasks cannot be started");
    }

    const now = Date.now();
    const startedAt = task.startedAt ?? now;
    const startedBy = args.startedBy?.trim() || brain.displayName;
    await ctx.db.patch(args.taskId, {
      status: "in_progress",
      startedAt,
      startedBy,
      executionState: "in_progress",
      agentRequestStatus: undefined,
      requestedHarness: undefined,
      agentRequestMessage: undefined,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      entityRef: { entityType: "task", entityId: args.taskId },
      activityType: "agent_task_started",
      actorType: "harness",
      actorId: startedBy,
      timestamp: now,
      summary: `Agent task started: ${task.title}`,
    });

    return {
      taskId: args.taskId,
      status: "in_progress",
      startedAt,
      startedBy,
    };
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
