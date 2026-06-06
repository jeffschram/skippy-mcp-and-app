import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const processingState = v.union(
  v.literal("suggested"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("archived"),
);

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

const processingMetadata = {
  processingState,
  rejectedAt: v.optional(v.number()),
  rejectionReason: v.optional(v.string()),
  rejectedBy: v.optional(v.union(v.literal("user"), v.literal("ai"), v.literal("system"))),
  confidence: v.optional(v.number()),
  reviewReason: v.optional(v.string()),
};

const priorityMetadata = {
  priorityScore: v.optional(v.number()),
  urgencyScore: v.optional(v.number()),
  importanceScore: v.optional(v.number()),
  priorityReason: v.optional(v.string()),
  priorityComputedAt: v.optional(v.number()),
  priorityPolicyVersion: v.optional(v.string()),
};

const sourceRefIds = v.optional(v.array(v.id("sourceRefs")));

export default defineSchema({
  users: defineTable({
    authProvider: v.literal("clerk"),
    authUserId: v.string(),
    email: v.string(),
    displayName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_auth", ["authProvider", "authUserId"]),

  brainInstances: defineTable({
    ownerUserId: v.id("users"),
    displayName: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerUserId"]),

  brainConfigs: defineTable({
    brainInstanceId: v.id("brainInstances"),
    assistantDisplayName: v.string(),
    llmProviderMode: v.union(
      v.literal("none"),
      v.literal("openai"),
      v.literal("anthropic"),
      v.literal("openrouter"),
      v.literal("local"),
    ),
    routineModel: v.optional(v.string()),
    synthesisModel: v.optional(v.string()),
    autonomyThreshold: v.optional(v.number()),
    linkEnrichmentEnabled: v.boolean(),
    notificationsEnabled: v.boolean(),
    embeddingProviderMode: v.optional(v.string()),
    embeddingModel: v.optional(v.string()),
    featureToggles: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_brain", ["brainInstanceId"]),

  goals: defineTable({
    brainInstanceId: v.id("brainInstances"),
    title: v.string(),
    description: v.optional(v.string()),
    ...processingMetadata,
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("achieved"),
      v.literal("abandoned"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_state", ["brainInstanceId", "processingState"])
    .index("by_brain_status", ["brainInstanceId", "status"]),

  projects: defineTable({
    brainInstanceId: v.id("brainInstances"),
    title: v.string(),
    summary: v.optional(v.string()),
    ...processingMetadata,
    status: v.union(
      v.literal("idea"),
      v.literal("planned"),
      v.literal("in_progress"),
      v.literal("paused"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    ...priorityMetadata,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_state", ["brainInstanceId", "processingState"])
    .index("by_brain_status", ["brainInstanceId", "status"]),

  tasks: defineTable({
    brainInstanceId: v.id("brainInstances"),
    title: v.string(),
    description: v.optional(v.string()),
    ...processingMetadata,
    status: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("waiting"),
      v.literal("done"),
      v.literal("cancelled"),
    ),
    dueAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    ...priorityMetadata,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_state", ["brainInstanceId", "processingState"])
    .index("by_brain_status", ["brainInstanceId", "status"])
    .index("by_brain_due", ["brainInstanceId", "dueAt"]),

  notes: defineTable({
    brainInstanceId: v.id("brainInstances"),
    title: v.optional(v.string()),
    body: v.string(),
    ...processingMetadata,
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_brain_state", ["brainInstanceId", "processingState"]),

  people: defineTable({
    brainInstanceId: v.id("brainInstances"),
    name: v.string(),
    emails: v.optional(v.array(v.string())),
    phoneNumbers: v.optional(v.array(v.string())),
    addresses: v.optional(v.array(v.string())),
    roleTitle: v.optional(v.string()),
    relationshipContext: v.optional(v.string()),
    notes: v.optional(v.string()),
    ...processingMetadata,
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_brain_state", ["brainInstanceId", "processingState"]),

  companies: defineTable({
    brainInstanceId: v.id("brainInstances"),
    name: v.string(),
    website: v.optional(v.string()),
    domain: v.optional(v.string()),
    notes: v.optional(v.string()),
    relationshipLabel: v.optional(
      v.union(
        v.literal("client"),
        v.literal("vendor"),
        v.literal("employer"),
        v.literal("partner"),
        v.literal("prospect"),
        v.literal("other"),
      ),
    ),
    ...processingMetadata,
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_brain_state", ["brainInstanceId", "processingState"]),

  links: defineTable({
    brainInstanceId: v.id("brainInstances"),
    url: v.string(),
    normalizedUrl: v.optional(v.string()),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    whyItMatters: v.optional(v.string()),
    ...processingMetadata,
    status: v.union(v.literal("unread"), v.literal("read"), v.literal("saved"), v.literal("discarded")),
    enrichmentStatus: v.optional(
      v.union(v.literal("none"), v.literal("queued"), v.literal("completed"), v.literal("failed")),
    ),
    enrichedAt: v.optional(v.number()),
    enrichmentMethod: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_state", ["brainInstanceId", "processingState"])
    .index("by_brain_url", ["brainInstanceId", "normalizedUrl"]),

  knowledgeObjects: defineTable({
    brainInstanceId: v.id("brainInstances"),
    objectType: v.string(),
    title: v.string(),
    summary: v.optional(v.string()),
    properties: v.optional(v.any()),
    ...processingMetadata,
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_brain_state", ["brainInstanceId", "processingState"]),

  relationships: defineTable({
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
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_brain_type", ["brainInstanceId", "type"]),

  sourceRefs: defineTable({
    brainInstanceId: v.id("brainInstances"),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_source", ["brainInstanceId", "sourceSystem"])
    .index("by_external", ["brainInstanceId", "sourceSystem", "externalId"]),

  entitySourceRefs: defineTable({
    brainInstanceId: v.id("brainInstances"),
    entityRef,
    sourceRefId: v.id("sourceRefs"),
    relationship: v.optional(
      v.union(
        v.literal("created_from"),
        v.literal("updated_from"),
        v.literal("mentioned_in"),
        v.literal("evidence_for"),
      ),
    ),
    createdAt: v.number(),
  }).index("by_source", ["sourceRefId"]),

  triageItems: defineTable({
    brainInstanceId: v.id("brainInstances"),
    candidateEntityType: entityType,
    candidateEntityId: v.optional(v.string()),
    candidatePayload: v.any(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("merged"),
      v.literal("corrected"),
    ),
    confidence: v.optional(v.number()),
    reviewReason: v.optional(v.string()),
    sourceRefIds,
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_status", ["brainInstanceId", "status"])
    .index("by_candidate", ["brainInstanceId", "candidateEntityType", "candidateEntityId"]),

  focusSummaries: defineTable({
    brainInstanceId: v.id("brainInstances"),
    generatedAt: v.number(),
    validUntil: v.optional(v.number()),
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
    sourceRunId: v.optional(v.id("ingestionRuns")),
    policyVersion: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_brain_generated", ["brainInstanceId", "generatedAt"]),

  pendingActions: defineTable({
    brainInstanceId: v.id("brainInstances"),
    actionType: v.string(),
    status: v.union(
      v.literal("drafted"),
      v.literal("pending_approval"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("completed"),
    ),
    recipients: v.optional(v.any()),
    subject: v.optional(v.string()),
    body: v.optional(v.string()),
    messageBody: v.optional(v.string()),
    relatedEntities: v.optional(v.array(entityRef)),
    sourceRefIds,
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    approvalNotes: v.optional(v.string()),
    executionProvider: v.optional(v.string()),
    externalMessageId: v.optional(v.string()),
    executedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_brain_status", ["brainInstanceId", "status"]),

  ingestionRuns: defineTable({
    brainInstanceId: v.id("brainInstances"),
    harness: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    sourceSystemsChecked: v.array(v.string()),
    candidatesSubmitted: v.optional(v.number()),
    objectsCreated: v.optional(v.number()),
    objectsUpdated: v.optional(v.number()),
    focusSummaryId: v.optional(v.id("focusSummaries")),
    errors: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
  }).index("by_brain_started", ["brainInstanceId", "startedAt"]),

  activityEvents: defineTable({
    brainInstanceId: v.id("brainInstances"),
    entityRef: v.optional(entityRef),
    activityType: v.string(),
    actorType: v.union(v.literal("user"), v.literal("harness"), v.literal("skippy_ai"), v.literal("system")),
    actorId: v.optional(v.string()),
    timestamp: v.number(),
    summary: v.string(),
    metadata: v.optional(v.any()),
    sourceRefIds,
    ingestionRunId: v.optional(v.id("ingestionRuns")),
    pendingActionId: v.optional(v.id("pendingActions")),
    focusSummaryId: v.optional(v.id("focusSummaries")),
  }).index("by_brain_timestamp", ["brainInstanceId", "timestamp"]),

  operatingRules: defineTable({
    brainInstanceId: v.id("brainInstances"),
    ruleType: v.string(),
    scope: v.string(),
    source: v.union(
      v.literal("explicit_user_setting"),
      v.literal("learned_from_corrections"),
      v.literal("system_default"),
    ),
    ruleText: v.optional(v.string()),
    ruleMetadata: v.optional(v.any()),
    enabled: v.boolean(),
    confidence: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_brain_scope", ["brainInstanceId", "scope"]),

  userProfileMemories: defineTable({
    brainInstanceId: v.id("brainInstances"),
    memoryType: v.string(),
    content: v.string(),
    source: v.union(
      v.literal("explicit_user_statement"),
      v.literal("learned_from_activity"),
      v.literal("system_default"),
    ),
    confidence: v.optional(v.number()),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    sourceRefIds,
    activityIds: v.optional(v.array(v.id("activityEvents"))),
  }).index("by_brain_enabled", ["brainInstanceId", "enabled"]),

  mcpTokens: defineTable({
    brainInstanceId: v.id("brainInstances"),
    label: v.string(),
    tokenHash: v.string(),
    tokenPrefix: v.string(),
    revokedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain", ["brainInstanceId"])
    .index("by_token_hash", ["tokenHash"]),

  entityEmbeddings: defineTable({
    brainInstanceId: v.id("brainInstances"),
    entityRef,
    textHash: v.string(),
    embeddingProvider: v.string(),
    embeddingModel: v.string(),
    embeddingVersion: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_brain_entity", ["brainInstanceId", "entityRef.entityType", "entityRef.entityId"]),

  aiProcessingRuns: defineTable({
    brainInstanceId: v.id("brainInstances"),
    provider: v.string(),
    model: v.string(),
    workflow: v.string(),
    policyVersion: v.optional(v.string()),
    usedFor: v.string(),
    inputSummary: v.optional(v.string()),
    outputSummary: v.optional(v.string()),
    estimatedCostUsd: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_brain_created", ["brainInstanceId", "createdAt"]),
});
