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

const taskKind = v.union(
  v.literal("coding"),
  v.literal("review"),
  v.literal("research"),
  v.literal("design"),
  v.literal("manual"),
  v.literal("planning"),
);

// Supervised execution lifecycle, distinct from the user-facing `status`.
// proposed -> briefed -> ready -> in_progress -> in_review -> done (or blocked).
const taskExecutionState = v.union(
  v.literal("proposed"),
  v.literal("unplanned"),
  v.literal("briefed"),
  v.literal("ready"),
  v.literal("in_progress"),
  v.literal("in_review"),
  v.literal("blocked"),
  v.literal("done"),
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

const notificationPreferences = v.object({
  urgentEnabled: v.boolean(),
  pendingActionEnabled: v.boolean(),
  focusSummaryEnabled: v.boolean(),
  dailyDigestEnabled: v.boolean(),
  minPriorityScore: v.optional(v.number()),
  quietHours: v.optional(
    v.object({
      enabled: v.boolean(),
      start: v.string(),
      end: v.string(),
      timezone: v.string(),
    }),
  ),
});

const memoryPrivacyPolicy = v.object({
  storageMode: v.optional(
    v.union(
      v.literal("summaries_with_refs"),
      v.literal("source_refs_only"),
      v.literal("full_content_when_important"),
    ),
  ),
  excludedContent: v.optional(v.string()),
  sensitiveContentInstructions: v.optional(v.string()),
  retentionDays: v.optional(v.number()),
});

const recallPreferences = v.object({
  cadence: v.optional(v.union(v.literal("manual"), v.literal("daily"), v.literal("weekly"), v.literal("active_context"))),
  focusWindow: v.optional(v.string()),
  allowProactiveRecall: v.optional(v.boolean()),
});

const harnessAutonomyPolicy = v.object({
  ingestionMode: v.optional(
    v.union(
      v.literal("suggest_only"),
      v.literal("auto_accept_high_confidence"),
      v.literal("auto_accept_with_action_review"),
    ),
  ),
  actionApproval: v.optional(
    v.union(v.literal("always_require"), v.literal("allow_low_risk_drafts"), v.literal("allow_low_risk_send")),
  ),
  notes: v.optional(v.string()),
});

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
    notificationPreferences: v.optional(notificationPreferences),
    memoryPrivacyPolicy: v.optional(memoryPrivacyPolicy),
    recallPreferences: v.optional(recallPreferences),
    harnessAutonomyPolicy: v.optional(harnessAutonomyPolicy),
    embeddingProviderMode: v.optional(v.string()),
    embeddingModel: v.optional(v.string()),
    featureToggles: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_brain", ["brainInstanceId"]),

  harnessSkills: defineTable({
    brainInstanceId: v.id("brainInstances"),
    slug: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    body: v.string(),
    usageDescription: v.optional(v.string()),
    usageLeadIn: v.optional(v.string()),
    schedulerInstructions: v.optional(v.string()),
    visibility: v.union(v.literal("public"), v.literal("private")),
    version: v.number(),
    isCurrent: v.boolean(),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_slug_current", ["brainInstanceId", "slug", "isCurrent"])
    .index("by_brain_current", ["brainInstanceId", "isCurrent"])
    .index("by_brain_slug", ["brainInstanceId", "slug"]),

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
      v.literal("archived"),
    ),
    // "code" projects have a GitHub repo + local folder and follow the branch->PR agent workflow.
    kind: v.optional(v.union(v.literal("code"), v.literal("general"))),
    repoUrl: v.optional(v.string()),
    defaultBaseBranch: v.optional(v.string()),
    // Local folder path for output files/assets (all projects may have one).
    localPath: v.optional(v.string()),
    // Dismissing a focus bullet about this entity hides it from focus generation until
    // this epoch-ms timestamp, without changing the entity's real status.
    focusSnoozedUntil: v.optional(v.number()),
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
    ownerType: v.optional(v.union(v.literal("owner"), v.literal("agent"))),
    dueAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    startedBy: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    // Automated planning + supervised execution (Skippy plans, a coding harness executes).
    kind: v.optional(taskKind),
    executionState: v.optional(taskExecutionState),
    agentRequestStatus: v.optional(v.union(v.literal("requested"), v.literal("cancelled"))),
    requestedHarness: v.optional(v.string()),
    agentRequestedAt: v.optional(v.number()),
    agentRequestedBy: v.optional(v.string()),
    agentRequestMessage: v.optional(v.string()),
    executionBrief: v.optional(v.string()),
    acceptanceCriteria: v.optional(v.array(v.string())),
    orderIndex: v.optional(v.number()),
    briefReadyAt: v.optional(v.number()),
    planRunId: v.optional(v.id("projectPlans")),
    gitBranchName: v.optional(v.string()),
    prUrl: v.optional(v.string()),
    prNumber: v.optional(v.number()),
    prStatus: v.optional(v.union(v.literal("open"), v.literal("merged"), v.literal("closed"))),
    lastPrCreatedAt: v.optional(v.number()),
    resultSummary: v.optional(v.string()),
    resultUrl: v.optional(v.string()),
    resultRecordedAt: v.optional(v.number()),
    focusSnoozedUntil: v.optional(v.number()),
    ...priorityMetadata,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_state", ["brainInstanceId", "processingState"])
    .index("by_brain_status", ["brainInstanceId", "status"])
    .index("by_brain_due", ["brainInstanceId", "dueAt"])
    .index("by_brain_execution_state", ["brainInstanceId", "executionState"])
    .index("by_brain_plan", ["brainInstanceId", "planRunId"]),

  notes: defineTable({
    brainInstanceId: v.id("brainInstances"),
    title: v.optional(v.string()),
    body: v.string(),
    ...processingMetadata,
    focusSnoozedUntil: v.optional(v.number()),
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
    favorite: v.optional(v.boolean()),
    focusSnoozedUntil: v.optional(v.number()),
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
    focusSnoozedUntil: v.optional(v.number()),
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

  memories: defineTable({
    brainInstanceId: v.id("brainInstances"),
    memoryType,
    title: v.string(),
    summary: v.optional(v.string()),
    body: v.string(),
    status: memoryStatus,
    reviewState: memoryReviewState,
    confidence: v.optional(v.number()),
    sourceRefIds,
    relatedEntityRefs: v.optional(v.array(entityRef)),
    rubricDecision: v.optional(v.string()),
    captureReason: v.optional(v.string()),
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    rejectedAt: v.optional(v.number()),
    rejectionReason: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
    archiveReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_status", ["brainInstanceId", "status"])
    .index("by_brain_review_state", ["brainInstanceId", "reviewState"])
    .index("by_brain_type_status", ["brainInstanceId", "memoryType", "status"])
    .index("by_brain_created", ["brainInstanceId", "createdAt"])
    .index("by_brain_updated", ["brainInstanceId", "updatedAt"]),

  interviews: defineTable({
    brainInstanceId: v.id("brainInstances"),
    templateKind: v.union(
      v.literal("project"),
      v.literal("goal"),
      v.literal("person"),
      v.literal("decision"),
      v.literal("weekly_review"),
    ),
    title: v.string(),
    status: v.union(v.literal("active"), v.literal("completed"), v.literal("archived")),
    currentQuestionIndex: v.number(),
    questionCount: v.number(),
    subjectEntityRef: v.optional(entityRef),
    subjectLabel: v.optional(v.string()),
    summary: v.optional(v.string()),
    startedBy: v.id("users"),
    completedAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
    archiveReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_status", ["brainInstanceId", "status"])
    .index("by_brain_kind_status", ["brainInstanceId", "templateKind", "status"])
    .index("by_brain_updated", ["brainInstanceId", "updatedAt"]),

  interviewResponses: defineTable({
    brainInstanceId: v.id("brainInstances"),
    interviewId: v.id("interviews"),
    questionId: v.string(),
    questionIndex: v.number(),
    prompt: v.string(),
    answerText: v.string(),
    answerValue: v.optional(v.any()),
    memoryCandidateId: v.optional(v.id("memories")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_interview_order", ["interviewId", "questionIndex"])
    .index("by_brain_interview", ["brainInstanceId", "interviewId"]),

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
    candidateFingerprint: v.optional(v.string()),
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
    .index("by_brain_fingerprint", ["brainInstanceId", "candidateFingerprint"])
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

  // Tracks what the user currently has open in the web app, so a connected harness
  // can resolve references like "this project" via get_current_context.
  viewerContext: defineTable({
    brainInstanceId: v.id("brainInstances"),
    userId: v.id("users"),
    activeRoute: v.optional(v.string()),
    activeEntityRef: v.optional(entityRef),
    activeProjectId: v.optional(v.id("projects")),
    updatedAt: v.number(),
  }).index("by_brain", ["brainInstanceId"]),

  focusItemActions: defineTable({
    brainInstanceId: v.id("brainInstances"),
    focusSummaryId: v.id("focusSummaries"),
    itemKey: v.string(),
    itemText: v.string(),
    action: v.union(v.literal("dismissed"), v.literal("done"), v.literal("task_created")),
    taskId: v.optional(v.id("tasks")),
    actorUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_focus", ["brainInstanceId", "focusSummaryId"])
    .index("by_brain_item", ["brainInstanceId", "itemKey"]),

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

  // Audit of automated AI project-planning runs (decompose a project into tasks).
  projectPlans: defineTable({
    brainInstanceId: v.id("brainInstances"),
    projectId: v.id("projects"),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    planVersion: v.number(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    summary: v.optional(v.string()),
    taskCount: v.optional(v.number()),
    createdTaskIds: v.optional(v.array(v.id("tasks"))),
    error: v.optional(v.string()),
    createdBy: v.union(v.literal("user"), v.literal("harness"), v.literal("skippy_ai"), v.literal("system")),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_brain_project", ["brainInstanceId", "projectId"])
    .index("by_brain_created", ["brainInstanceId", "createdAt"]),

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

  sourceSyncStatuses: defineTable({
    brainInstanceId: v.id("brainInstances"),
    statusKey: v.string(),
    harness: v.string(),
    status: v.union(v.literal("idle"), v.literal("running"), v.literal("completed"), v.literal("failed")),
    message: v.optional(v.string()),
    sourceSystemsChecked: v.array(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    lastHeartbeatAt: v.optional(v.number()),
    errors: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_key", ["brainInstanceId", "statusKey"])
    .index("by_brain_status", ["brainInstanceId", "status"]),

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

  pushSubscriptions: defineTable({
    brainInstanceId: v.id("brainInstances"),
    userId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    expirationTime: v.optional(v.number()),
    userAgent: v.optional(v.string()),
    permissionState: v.optional(
      v.union(v.literal("granted"), v.literal("denied"), v.literal("prompt"), v.literal("unsupported")),
    ),
    enabled: v.boolean(),
    revokedAt: v.optional(v.number()),
    lastSeenAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain", ["brainInstanceId"])
    .index("by_user", ["userId"])
    .index("by_brain_endpoint", ["brainInstanceId", "endpoint"]),

  notificationDeliveries: defineTable({
    brainInstanceId: v.id("brainInstances"),
    pushSubscriptionId: v.optional(v.id("pushSubscriptions")),
    dedupeKey: v.string(),
    notificationType: v.string(),
    title: v.string(),
    body: v.string(),
    url: v.optional(v.string()),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
    error: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_created", ["brainInstanceId", "createdAt"])
    .index("by_brain_dedupe", ["brainInstanceId", "dedupeKey"]),

  entityEmbeddings: defineTable({
    brainInstanceId: v.id("brainInstances"),
    entityRef,
    canonicalText: v.string(),
    textHash: v.string(),
    embedding: v.array(v.float64()),
    embeddingProvider: v.string(),
    embeddingModel: v.string(),
    embeddingVersion: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain", ["brainInstanceId"])
    .index("by_brain_entity", ["brainInstanceId", "entityRef.entityType", "entityRef.entityId"])
    .index("by_brain_entity_provider", [
      "brainInstanceId",
      "entityRef.entityType",
      "entityRef.entityId",
      "embeddingProvider",
      "embeddingModel",
    ])
    .vectorIndex("by_brain_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["brainInstanceId", "embeddingProvider", "embeddingModel"],
    }),

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
