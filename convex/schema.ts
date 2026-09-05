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

// Execution-dispatch axis: how a task gets worked, read by the task-heartbeat
// harness. NOT a life/work classification — that is `area` below. Do not add
// life semantics here; it would break agent dispatch.
const taskKind = v.union(
  v.literal("coding"),
  v.literal("review"),
  v.literal("research"),
  v.literal("design"),
  v.literal("manual"),
  v.literal("planning"),
);

// Which part of life a task belongs to. Mirrors TASK_AREAS in @skippy/shared.
const taskArea = v.union(
  v.literal("work"),
  v.literal("personal"),
  v.literal("household"),
  v.literal("health"),
  v.literal("finance"),
  v.literal("social"),
  v.literal("errand"),
);

// Obligation vs desire. Absent reads as "must" (see effectiveCommitment in
// @skippy/shared) — every task written before the life layer is an obligation.
// "want" items are browsable and never overdue, so wants do not create guilt.
const taskCommitment = v.union(v.literal("must"), v.literal("want"));

// Supervised execution lifecycle, distinct from the user-facing `status`.
// proposed -> briefed -> ready -> in_progress -> in_review -> done (or blocked).
// 'cancelled' is a terminal side-exit for not-yet-executed tasks the owner abandons.
const taskExecutionState = v.union(
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

const knowledgeKind = v.union(
  v.literal("note"),
  v.literal("link"),
  v.literal("knowledgeObject"),
  v.literal("memory"),
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

// Finances: FIXED taxonomy mirrored from @skippy/shared (TX_TYPE_CATEGORIES).
// The type-category pairing is enforced in every write path via the shared helper.
//
const financialAccountType = v.union(v.literal("Jeff Personal"), v.literal("Family Shared"));

const financialTxType = v.union(
  v.literal("Fixed Costs"),
  v.literal("Investments"),
  v.literal("Savings"),
  v.literal("Guilt-Free"),
  v.literal("Income"),
  v.literal("Transfer"),
);

const financialTxCategory = v.union(
  v.literal("Mortgage, HOA, Mortgage Loan"),
  v.literal("Recurring Bills"),
  v.literal("Debt Payments"),
  v.literal("Groceries"),
  v.literal("Subscriptions"),
  v.literal("Retirement"),
  v.literal("Brokerage"),
  v.literal("Emergency Fund"),
  v.literal("Goals"),
  v.literal("Restaurants"),
  v.literal("Gas, Amazon, Home Depot, Etc"),
  v.literal("Misc."),
  v.literal("Jeff"),
  v.literal("Holly"),
  v.literal("Transfers In"),
  v.literal("Transfers Out"),
);

const financialTxSource = v.union(v.literal("plaid"), v.literal("manual"), v.literal("harness"));

// --- Mac mini agent workbench (docs/mac-mini-agent-workbench.md) ---

// Coding harness that executes a run. A TYPED enum, deliberately distinct from
// the free-text `tasks.requestedHarness` (which requestAgentForTask defaults to
// an assistant display name and is kept as display metadata). Hosts advertise
// which of these they support; claims are matched against that capability.
const agentHarness = v.union(v.literal("codex"), v.literal("claude"));

// Run state machine. `interrupted` runs are resumable; `failed`/`cancelled`
// are terminal; `in_review` is the success terminal (PR created, task handed
// back to the owner). Transitions are enforced in convex/agentWorkbench.ts.
const agentRunStatus = v.union(
  v.literal("queued"),
  v.literal("claimed"),
  v.literal("preparing"),
  v.literal("running"),
  v.literal("waiting_for_approval"),
  v.literal("verifying"),
  v.literal("awaiting_publish_approval"),
  v.literal("publishing"),
  v.literal("in_review"),
  v.literal("interrupted"),
  v.literal("failed"),
  v.literal("cancelled"),
);

const agentApprovalKind = v.union(
  v.literal("command"),
  v.literal("file_change"),
  v.literal("network"),
  v.literal("secret"),
  v.literal("push"),
  v.literal("pr"),
  v.literal("deployment"),
  v.literal("user_input"),
);

// Snapshot of the approval policy a run executes under. Minimal for phase 1:
// the doc's default policy is hardcoded in the runner; only the knobs that can
// vary per project live here.
const agentApprovalPolicy = v.object({
  requirePushApproval: v.optional(v.boolean()),
});

// Normalized token totals for one harness session (docs/token-efficiency.md
// lever 1). The RUNNER normalizes the provider-specific shapes (Claude
// reports cache activity alongside input_tokens; Codex reports cached as a
// subset of it), so this stored shape is provider-agnostic:
// inputTokens = fresh input incl. cache writes; cachedInputTokens = cache
// reads; totalTokens = input + cached + output. Exported for the runner-facing
// mutations that accept it (completeChatTurn, updateRunStatus).
export const tokenUsage = v.object({
  inputTokens: v.number(),
  cachedInputTokens: v.number(),
  outputTokens: v.number(),
  totalTokens: v.number(),
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
    // Freeform per-project notes pad (the Notes tab): ONE always-editable
    // plain-text field, deliberately NOT `note` entities. Structure lives in
    // the Plan; history is captured at review-session granularity in
    // projectNoteSnapshots (same storage shape as phase descriptions).
    notesPad: v.optional(v.string()),
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
    vercelUrl: v.optional(v.string()),
    liveUrl: v.optional(v.string()),
    defaultBaseBranch: v.optional(v.string()),
    // Default model for unattended task runs on this project (token tiering,
    // docs/token-efficiency.md §4). Harness-native name/alias ("sonnet",
    // "opus", "gpt-5-codex", ...); absent = harness default. Interactive chat
    // deliberately has no such setting — chat stays on the owner's
    // Opus-class default and is never demoted.
    defaultTaskModel: v.optional(v.string()),
    // Project local folder (all projects may have one).
    localPath: v.optional(v.string()),
    // Explicit overrides for the assets (inputs) and output (artifacts) folders.
    // Stored ONLY when the user overrides; when unset, readers derive
    // `${localPath}/_assets` and `${localPath}/_docs` lazily at read time
    // (see effectiveProjectPaths in @skippy/shared) — no backfill/migration.
    assetsFolderPath: v.optional(v.string()),
    outputFolderPath: v.optional(v.string()),
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
    // Life-layer axes. Project linkage stays in `relationships` (belongs_to),
    // so a project-less task is already legal — these make it classifiable.
    area: v.optional(taskArea),
    commitment: v.optional(taskCommitment),
    // What the owner is waiting on, and since when. Cleared automatically when
    // a reply lands rather than requiring the owner to groom a queue.
    waitingOn: v.optional(entityRef),
    waitingSince: v.optional(v.number()),
    lastNudgedAt: v.optional(v.number()),
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
    // Optional plan grouping. Existing tasks remain valid and are assigned to
    // a default phase lazily when their project is first opened.
    phaseId: v.optional(v.id("phases")),
    gitBranchName: v.optional(v.string()),
    prUrl: v.optional(v.string()),
    prNumber: v.optional(v.number()),
    prStatus: v.optional(v.union(v.literal("open"), v.literal("merged"), v.literal("closed"))),
    lastPrCreatedAt: v.optional(v.number()),
    resultSummary: v.optional(v.string()),
    resultUrl: v.optional(v.string()),
    artifactFileIds: v.optional(v.array(v.id("projectFiles"))),
    resultRecordedAt: v.optional(v.number()),
    focusSnoozedUntil: v.optional(v.number()),
    ...priorityMetadata,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_state", ["brainInstanceId", "processingState"])
    .index("by_brain_status", ["brainInstanceId", "status"])
    .index("by_brain_due", ["brainInstanceId", "dueAt"])
    .index("by_brain_commitment", ["brainInstanceId", "commitment"])
    .index("by_brain_execution_state", ["brainInstanceId", "executionState"])
    .index("by_brain_plan", ["brainInstanceId", "planRunId"])
    .index("by_brain_phase", ["brainInstanceId", "phaseId"]),

  // Repeating life obligations: furnace filters, oil changes, renewals, trash
  // night, quarterly taxes. A task with a dueAt cannot express any of these,
  // and completing such a task destroys the record of when it was last done —
  // which is usually the fact the owner actually wants.
  //
  // The anchor distinction is the load-bearing design decision:
  //   completion — "every 3 months after I finish it". Next due is measured
  //                from lastCompletedAt. Do it five weeks late and the next one
  //                shifts with you. This is right for maintenance.
  //   schedule   — "the 1st of the month, regardless". Next due is a fixed
  //                calendar date and ignores when (or whether) you did it.
  // Conflating the two is why repeat reminders drift into nonsense.
  //
  // Like calendarEvents, `recurrence` is deliberately NOT in the entityType
  // union: this is scheduling state, not owner-authored knowledge, and must
  // stay off the ingestObject/triageItems rubric path.
  recurrences: defineTable({
    brainInstanceId: v.id("brainInstances"),
    title: v.string(),
    description: v.optional(v.string()),
    area: v.optional(taskArea),

    rule: v.union(
      v.object({ kind: v.literal("interval"), everyDays: v.number() }),
      v.object({ kind: v.literal("calendar"), rrule: v.string() }),
    ),
    anchor: v.union(v.literal("completion"), v.literal("schedule")),

    // IANA zone the wall-clock schedule is anchored to. Load-bearing, not
    // decoration: the scheduling math adds calendar days in this zone so an
    // 8am obligation stays 8am across a DST boundary, and month-end rules land
    // on the right date. Absent falls back to DEFAULT_RECURRENCE_TIME_ZONE.
    timeZone: v.optional(v.string()),

    lastCompletedAt: v.optional(v.number()),
    nextDueAt: v.number(),
    // Surface this many days before nextDueAt, so renewals get a runway.
    leadTimeDays: v.optional(v.number()),

    status: v.union(v.literal("active"), v.literal("paused"), v.literal("retired")),

    // Whether firing materializes a real task the owner checks off, or the
    // obligation only appears on the agenda. Per-recurrence rather than a
    // global setting: chores want to be tasks, trash night does not.
    spawnTask: v.boolean(),
    // The live spawned task, so re-firing cannot duplicate it.
    currentTaskId: v.optional(v.id("tasks")),

    // Capped completion log — see RECURRENCE_HISTORY_LIMIT in @skippy/shared.
    // "When did I last change the filter?" is half the value of this table.
    history: v.optional(
      v.array(v.object({ completedAt: v.number(), note: v.optional(v.string()) })),
    ),

    // The car, the house, the person this obligation attaches to.
    relatedEntityRefs: v.optional(v.array(entityRef)),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_next_due", ["brainInstanceId", "nextDueAt"])
    .index("by_brain_status", ["brainInstanceId", "status"]),

  // DEPRECATED (brain refactor step 4): retained read-only during the soak.
  // New writes and reads use `knowledge`; owner approval is required to delete.
  notes: defineTable({
    brainInstanceId: v.id("brainInstances"),
    title: v.optional(v.string()),
    body: v.string(),
    ...processingMetadata,
    focusSnoozedUntil: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_state", ["brainInstanceId", "processingState"])
    .index("by_brain_created", ["brainInstanceId", "createdAt"]),

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

  // DEPRECATED (brain refactor step 4): retained read-only during the soak.
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
    .index("by_brain_url", ["brainInstanceId", "normalizedUrl"])
    .index("by_brain_created", ["brainInstanceId", "createdAt"]),

  // DEPRECATED (brain refactor step 4): retained read-only during the soak.
  knowledgeObjects: defineTable({
    brainInstanceId: v.id("brainInstances"),
    objectType: v.string(),
    title: v.string(),
    summary: v.optional(v.string()),
    properties: v.optional(v.any()),
    ...processingMetadata,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_state", ["brainInstanceId", "processingState"])
    .index("by_brain_created", ["brainInstanceId", "createdAt"]),

  knowledge: defineTable({
    brainInstanceId: v.id("brainInstances"),
    kind: knowledgeKind,
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    summary: v.optional(v.string()),
    url: v.optional(v.string()),
    normalizedUrl: v.optional(v.string()),
    whyItMatters: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("inbox"),
        v.literal("accepted"),
        v.literal("rejected"),
        v.literal("archived"),
        v.literal("unread"),
        v.literal("read"),
        v.literal("saved"),
        v.literal("discarded"),
      ),
    ),
    objectType: v.optional(v.string()),
    properties: v.optional(v.any()),
    memoryType: v.optional(memoryType),
    // Stable provenance makes legacy backfills idempotent and auditable.
    legacyId: v.optional(v.string()),
    reviewState: v.optional(memoryReviewState),
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
    archiveReason: v.optional(v.string()),
    ...processingMetadata,
    sourceRefIds,
    rubricDecision: v.optional(v.string()),
    captureReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_kind_state", ["brainInstanceId", "kind", "processingState"])
    .index("by_brain_kind_status", ["brainInstanceId", "kind", "status"])
    .index("by_brain_kind_review_state", ["brainInstanceId", "kind", "reviewState"])
    .index("by_brain_kind_created", ["brainInstanceId", "kind", "createdAt"])
    .index("by_brain_kind_updated", ["brainInstanceId", "kind", "updatedAt"])
    .index("by_brain_kind_legacy_id", ["brainInstanceId", "kind", "legacyId"])
    .index("by_brain_updated", ["brainInstanceId", "updatedAt"]),

  // DEPRECATED (brain refactor step 4): retained read-only during the soak.
  // The unified `knowledge` table is canonical; deletion remains owner-gated.
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
    // Legacy interview rows may still point at the deprecated memories table.
    memoryCandidateId: v.optional(v.union(v.id("memories"), v.id("knowledge"))),
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
  })
    .index("by_brain_type", ["brainInstanceId", "type"])
    // Endpoint lookups: find every edge touching a specific entity without
    // scanning the brain's whole edge set (which is far past function read
    // limits). Used by the task deletion cascade; general-purpose by design.
    .index("by_brain_from", ["brainInstanceId", "from.entityId"])
    .index("by_brain_to", ["brainInstanceId", "to.entityId"]),

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
    // Machine-authored caution rendered on the review card — today, "this event
    // overlaps something already on your calendar". Deliberately NOT folded
    // into `approvalNotes` (which belongs to the owner) or `body` (which the
    // executor parses as JSON): a warning that rewrites the payload or
    // clobbers the owner's own note is a bug waiting to happen.
    reviewWarning: v.optional(v.string()),
    executionProvider: v.optional(v.string()),
    externalMessageId: v.optional(v.string()),
    executedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    // Lease-based claiming, mirroring runs/chat turns/maintenance jobs, so the
    // runner executes an approved action once per lease. Unlike those, an
    // expired lease here is safe to re-claim: a calendar insert carries a
    // Skippy-minted event id and Google answers 409 for a repeat, so a
    // duplicated execution settles as "already created" rather than
    // double-booking the owner.
    hostId: v.optional(v.id("agentHosts")),
    claimToken: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
    leaseExpiresAt: v.optional(v.number()),
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

  // Ordered, narrative sections of a project plan. Tasks point at a phase via
  // tasks.phaseId; the project board composes that relationship into each
  // phase's ordered task list.
  phases: defineTable({
    brainInstanceId: v.id("brainInstances"),
    projectId: v.id("projects"),
    orderNum: v.number(),
    title: v.string(),
    descriptionMd: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_project", ["brainInstanceId", "projectId"])
    .index("by_project_order", ["projectId", "orderNum"]),

  // Point-in-time archives of a project's notes pad (projects.notesPad).
  // Archive-by-snapshot, not by entry: at the close of an owner-requested
  // notes review the WHOLE pad is preserved here, then the live pad is
  // pruned. No UI in v1 — snapshots exist in the data, browsable later.
  projectNoteSnapshots: defineTable({
    brainInstanceId: v.id("brainInstances"),
    projectId: v.id("projects"),
    // Full pad text at snapshot time. Plain text only, like the pad itself.
    content: v.string(),
    // Optional one-line description of the review session that produced it.
    summary: v.optional(v.string()),
    createdBy: v.union(v.literal("user"), v.literal("harness")),
    createdAt: v.number(),
  }).index("by_brain_project", ["brainInstanceId", "projectId"]),

  // Cloud-canonical project library backed by Convex file storage. The local
  // `_library` folder (effectiveAssetsPath) is the harness's materialization of
  // these rows; files found only locally are not in the library until registered.
  // Never persist storage URLs — resolve them at read time with storage.getUrl.
  projectFiles: defineTable({
    brainInstanceId: v.id("brainInstances"),
    projectId: v.id("projects"),
    taskId: v.optional(v.id("tasks")),
    storageId: v.optional(v.id("_storage")),
    kind: v.optional(v.union(v.literal("library_input"), v.literal("generated_artifact"))),
    status: v.optional(
      v.union(v.literal("pending_upload"), v.literal("ready"), v.literal("failed"), v.literal("deleted")),
    ),
    sha256: v.optional(v.string()),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    uploadedBy: v.union(v.literal("user"), v.literal("harness")),
    runId: v.optional(v.id("agentRuns")),
    chatId: v.optional(v.id("projectChats")),
    messageId: v.optional(v.id("chatMessages")),
    createdByType: v.optional(v.union(v.literal("user"), v.literal("harness"), v.literal("migration"))),
    createdById: v.optional(v.string()),
    required: v.optional(v.boolean()),
    uploadKey: v.optional(v.string()),
    uploadExpiresAt: v.optional(v.number()),
    readyAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    retentionUntil: v.optional(v.number()),
    failureReason: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_project", ["brainInstanceId", "projectId"])
    .index("by_brain_project_kind", ["brainInstanceId", "projectId", "kind"])
    .index("by_brain_task", ["brainInstanceId", "taskId"])
    .index("by_run", ["runId"])
    .index("by_brain_status", ["brainInstanceId", "status"])
    .index("by_brain_upload_key", ["brainInstanceId", "uploadKey"]),

  // Home quick-capture inbox: thoughts, notes, URLs, and files the owner drops
  // on the home page to be remembered later. Source-ingestion harnesses read
  // pending captures, turn useful ones into Skippy objects, then mark each
  // capture processed or discarded.
  quickCaptures: defineTable({
    brainInstanceId: v.id("brainInstances"),
    text: v.optional(v.string()),
    // Normalized http/https URL inferred from the text (or passed explicitly).
    url: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    status: v.union(v.literal("pending"), v.literal("processed"), v.literal("discarded")),
    // Owner intent: "remember" = feed ingestion harnesses; "hold" = private
    // device-to-device transfer that harnesses must never see (auto-expires
    // after 7 days). Absent on pre-existing rows = "remember" — the default
    // is composed at read time, no migration.
    intent: v.optional(v.union(v.literal("remember"), v.literal("hold"))),
    capturedBy: v.optional(v.union(v.literal("user"), v.literal("harness"))),
    processedAt: v.optional(v.number()),
    processedBy: v.optional(v.string()),
    processingNote: v.optional(v.string()),
    // Entities the processor created/updated from this capture, so the
    // "Actions taken" digest can deep-link to what Skippy did with it. Older
    // processed rows have none — the link is simply omitted, no migration.
    relatedEntityRefs: v.optional(v.array(entityRef)),
    sourceRunId: v.optional(v.id("ingestionRuns")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_status", ["brainInstanceId", "status"])
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

  // Sync bookkeeping for ingestion harnesses.
  //
  // Google Calendar incremental sync tokens live here rather than in a table of
  // their own: statusKey `google_calendar:<calendarId>` with the opaque token at
  // `metadata.syncToken`. Look them up through `by_brain_key`.
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

  // Read-mostly mirror of the owner's external calendars. Google stays the
  // source of truth; this table exists so Skippy has a persisted sense of time
  // (agenda, focus summaries, free/busy) without a live API call per read.
  //
  // Calendar deliberately does NOT flow through ingestObject/triageItems. That
  // path is built for noisy prose sources and dedupes tasks on fuzzy *title*
  // similarity (see findAcceptedEntityDuplicate in convex/knowledge.ts), which
  // is exactly wrong here: "Dentist" and "1:1 with Dan" are supposed to repeat.
  // Calendar rows are matched on identity — `by_brain_external` — never
  // similarity. `calendar_event` is likewise kept out of the `entityType` union
  // above; that exclusion is what keeps this table off the rubric path. Links
  // to real entities go outward through `relatedEntityRefs`.
  //
  // Privacy: never persist a full event description. Callers truncate to a
  // short summary before writing (see skills/skippy-harness/SKILL.md).
  calendarEvents: defineTable({
    brainInstanceId: v.id("brainInstances"),

    // --- Identity. This is the echo-loop defense: when Skippy creates an event
    // it mints `externalId` itself and writes this row *before* calling Google,
    // so the next ingest recognizes its own write instead of duplicating it.
    sourceSystem: v.string(),
    calendarId: v.string(),
    externalId: v.string(),
    iCalUID: v.optional(v.string()),
    etag: v.optional(v.string()),
    origin: v.union(v.literal("google"), v.literal("skippy")),

    // --- Recurrence. Instances are identified by (recurringEventId,
    // originalStartAt); a moved instance keeps its original start.
    recurringEventId: v.optional(v.string()),
    originalStartAt: v.optional(v.number()),
    recurrence: v.optional(v.array(v.string())),
    isMaster: v.optional(v.boolean()),

    // --- Content.
    title: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    isAllDay: v.optional(v.boolean()),
    timeZone: v.optional(v.string()),
    status: v.union(v.literal("confirmed"), v.literal("tentative"), v.literal("cancelled")),
    attendees: v.optional(
      v.array(
        v.object({
          email: v.string(),
          displayName: v.optional(v.string()),
          responseStatus: v.optional(v.string()),
          organizer: v.optional(v.boolean()),
          self: v.optional(v.boolean()),
        }),
      ),
    ),
    conferenceUrl: v.optional(v.string()),
    htmlLink: v.optional(v.string()),

    // --- Skippy layer.
    relatedEntityRefs: v.optional(v.array(entityRef)),
    focusSnoozedUntil: v.optional(v.number()),
    remoteState: v.optional(
      v.union(v.literal("synced"), v.literal("pending_remote"), v.literal("remote_failed")),
    ),
    remoteError: v.optional(v.string()),

    lastSyncedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_external", ["brainInstanceId", "sourceSystem", "externalId"])
    .index("by_brain_start", ["brainInstanceId", "startAt"])
    .index("by_brain_series", ["brainInstanceId", "recurringEventId", "originalStartAt"]),

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
    // Optional agent-role scope (docs/agents.md): "agenda", "finance",
    // "task-executor", or "pm"/"pm:{projectId}". Tokens without a role keep
    // full tool access; role-scoped tokens get a deny-by-default allowlist.
    role: v.optional(v.string()),
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

  financialAccounts: defineTable({
    brainInstanceId: v.id("brainInstances"),
    name: v.string(),
    accountType: financialAccountType,
    // Last-4 identifier ONLY (e.g. "1234"). Full account numbers are NEVER stored.
    mask: v.string(),
    institution: v.optional(v.string()),
    // Plaid account_id for idempotent mapping of Plaid-sourced accounts.
    plaidAccountId: v.optional(v.string()),
    // Recurring OFF-LEDGER contributions (e.g. monthly payroll-deducted 401k
    // employee contribution + employer match), materialized into off-ledger
    // Investments transactions once per month by materializeContributionsForBrain.
    // At most one entry per contributionSource (externalIds are per source+month).
    recurringContributions: v.optional(
      v.array(
        v.object({
          label: v.string(),
          // Positive integer cents.
          amountCents: v.number(),
          contributionSource: v.union(v.literal("employee"), v.literal("employer")),
          // Investments categories only.
          category: v.union(v.literal("Retirement"), v.literal("Brokerage")),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain", ["brainInstanceId"])
    .index("by_brain_plaid", ["brainInstanceId", "plaidAccountId"]),

  financialTransactions: defineTable({
    brainInstanceId: v.id("brainInstances"),
    accountId: v.id("financialAccounts"),
    // Transaction date in epoch milliseconds.
    date: v.number(),
    // 'YYYY-MM' month bucket for month queries (derived from date unless supplied).
    monthKey: v.string(),
    // All amounts are INTEGER CENTS to avoid float drift. Positive magnitudes;
    // direction is determined by txType (Income = incoming; Fixed Costs/
    // Investments/Savings/Guilt-Free = outgoing; Transfer direction is the
    // category and is excluded from budget totals).
    amountCents: v.number(),
    description: v.string(),
    txType: financialTxType,
    category: financialTxCategory,
    // Plaid transaction_id used for idempotent dedupe: re-ingesting the same
    // externalId updates the existing row instead of duplicating it.
    externalId: v.optional(v.string()),
    // OFF-LEDGER row (e.g. payroll-deducted 401k contribution): the money never
    // touched this account. Off-ledger rows use the normal txType/category
    // fields (restricted to Investments) and count in type/category totals,
    // but are EXCLUDED from outgoing/incoming/net. INVARIANT: they never enter
    // balance reasoning — financialDailyBalances rows are independent snapshots
    // computed from the raw feed and are never derived from transactions, so an
    // off-ledger row must never be summed toward any balance.
    offLedger: v.optional(v.boolean()),
    // Required when offLedger. 'employee' = pre-tax pay the owner earned
    // (grosses up the percent-of-income denominator for CSP targets);
    // 'employer' = match, never the owner's income (does NOT gross it up).
    contributionSource: v.optional(v.union(v.literal("employee"), v.literal("employer"))),
    source: financialTxSource,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_account_month", ["brainInstanceId", "accountId", "monthKey"])
    .index("by_brain_external", ["brainInstanceId", "externalId"]),

  // End-of-day balance snapshots. Deliberately NOT derived from
  // financialTransactions: recorded rows may not cover every raw feed row, so
  // running sums drift from reality. The harness computes these externally
  // from the full raw Plaid feed anchored to the live current balance.
  financialDailyBalances: defineTable({
    brainInstanceId: v.id("brainInstances"),
    accountId: v.id("financialAccounts"),
    // Snapshot day: epoch ms at UTC midnight. One row per account+day; writes upsert.
    date: v.number(),
    // 'YYYY-MM' month bucket (derived from date, UTC).
    monthKey: v.string(),
    // End-of-day balance in INTEGER CENTS; may be negative (overdraft).
    endOfDayBalanceCents: v.number(),
    source: v.union(v.literal("plaid_derived"), v.literal("manual")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_brain_account_month", ["brainInstanceId", "accountId", "monthKey"]),

  financialBudgets: defineTable({
    brainInstanceId: v.id("brainInstances"),
    accountId: v.id("financialAccounts"),
    // Absent monthKey = the default/recurring budget for the account.
    monthKey: v.optional(v.string()),
    // category -> target integer cents. v.record supports the taxonomy's dynamic
    // keys (they contain spaces/commas/periods); key validity is enforced in
    // mutations against the shared TX_CATEGORIES/TX_TYPES constants.
    categoryTargets: v.optional(v.record(v.string(), v.number())),
    // transaction type -> target integer cents.
    typeTargets: v.optional(v.record(v.string(), v.number())),
    // category -> target as a percent of the month's ACTUAL income (plain
    // number, 50 = 50% of that month's totalIncomingCents). Resolved to cents
    // at read time by the shared comparison; a percent target WINS over a
    // cents target for the same key. Transfer keys are rejected in mutations.
    categoryPercentTargets: v.optional(v.record(v.string(), v.number())),
    // transaction type -> percent of actual income (same rules as above).
    typePercentTargets: v.optional(v.record(v.string(), v.number())),
    targetOutgoingCents: v.optional(v.number()),
    targetIncomingCents: v.optional(v.number()),
    targetNetCents: v.optional(v.number()),
    // Net target as a percent of actual income; wins over targetNetCents.
    targetNetPercent: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_brain_account", ["brainInstanceId", "accountId"]),

  // Debts tracked for the payoff planner (loans + credit cards). Balances/APRs
  // are OWNER-ENTERED (never derived); payments observed in
  // financialTransactions since balanceAsOf are matched via matchPattern to
  // project the current balance at read time.
  financialDebts: defineTable({
    brainInstanceId: v.id("brainInstances"),
    name: v.string(),
    lender: v.optional(v.string()),
    // Owner-entered balance in INTEGER CENTS as of balanceAsOf.
    balanceCents: v.number(),
    // Epoch ms timestamp the balance was entered; payment matching starts here.
    balanceAsOf: v.number(),
    // Annual percentage rate as a plain number (22.5 = 22.5%), 0-100.
    apr: v.number(),
    // Contractual minimum monthly payment in INTEGER CENTS.
    minPaymentCents: v.number(),
    // Case-insensitive substring/regex matched against financialTransactions
    // descriptions to find this debt's payments (e.g. 'LIBERTY BANK').
    matchPattern: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_brain", ["brainInstanceId"]),

  // --- Mac mini agent workbench (docs/mac-mini-agent-workbench.md) ---

  // Connector inventory (docs/connectors.md): named access to external systems
  // (google, imessage, plaid). Metadata ONLY — OAuth tokens and API secrets
  // stay local on the providing host, chmod-600, and never touch Convex.
  // Availability is derived at read time: a connector is usable when a
  // non-revoked, recently-heartbeating host lists its slug in
  // capabilities.connectors.
  connectors: defineTable({
    brainInstanceId: v.id("brainInstances"),
    slug: v.string(),
    displayName: v.string(),
    kind: v.union(
      v.literal("local_mcp"), // audited MCP server on the host (plaid pattern)
      v.literal("local_data"), // direct local data access (imessage db)
      v.literal("http_feed"), // token-authed HTTP push/pull (calendar-sync)
    ),
    readOnly: v.boolean(),
    status: v.union(v.literal("pending"), v.literal("active"), v.literal("retired")),
    docsPath: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_brain_slug", ["brainInstanceId", "slug"]),

  // Stored agent configuration (docs/connectors.md): the pre-planned promotion
  // of Phase 5 role strings to records. roleKey is the same string used for
  // run attribution (metadata.role) — the foreign key that keeps history
  // continuous with no backfill. The scoped token's PLAINTEXT lives only in
  // the runner's local config; Convex stores the token document id for
  // display/revocation. Claim/lease fields mirror agentRuns so the runner's
  // agent-pass loop reuses the same discipline; claiming atomically advances
  // nextDueAt (the double-fire guard).
  agentConfigs: defineTable({
    brainInstanceId: v.id("brainInstances"),
    roleKey: v.string(), // "agenda" | "finance" | "task-executor" | "pm:{projectId}"
    displayName: v.string(),
    skillSlugs: v.array(v.string()),
    connectorSlugs: v.array(v.string()),
    mcpTokenId: v.optional(v.id("mcpTokens")),
    preferredHarness: v.optional(agentHarness),
    // Model for this agent's scheduled passes (token tiering: background
    // agents run Sonnet/Haiku-class, docs/token-efficiency.md §4). Absent =
    // harness default. Consumed by the agent-pass claim path when it lands.
    model: v.optional(v.string()),
    schedule: v.optional(
      v.union(
        v.object({
          kind: v.literal("interval"),
          everyMinutes: v.number(),
          window: v.optional(v.object({ start: v.string(), end: v.string() })),
          timeZone: v.optional(v.string()),
        }),
        v.object({
          kind: v.literal("daily"),
          timesOfDay: v.array(v.string()),
          timeZone: v.optional(v.string()),
        }),
      ),
    ),
    enabled: v.boolean(),
    nextDueAt: v.optional(v.number()),
    lastRunStartedAt: v.optional(v.number()),
    lastRunStatus: v.optional(v.union(v.literal("completed"), v.literal("failed"))),
    claimedByHostId: v.optional(v.id("agentHosts")),
    claimToken: v.optional(v.string()),
    claimVersion: v.number(),
    leaseExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_role", ["brainInstanceId", "roleKey"])
    .index("by_brain_due", ["brainInstanceId", "enabled", "nextDueAt"]),

  // Registered execution machines. The first host is the always-on Mac mini.
  // Online/Busy/Offline is DERIVED from lastHeartbeatAt at read time — there is
  // deliberately no stored status flag to go stale. Auth follows the mcpTokens
  // pattern: the plaintext credential is returned once at creation and only its
  // hash is stored.
  agentHosts: defineTable({
    brainInstanceId: v.id("brainInstances"),
    hostKey: v.string(),
    displayName: v.string(),
    kind: v.union(v.literal("mac"), v.literal("cloud")),
    capabilities: v.object({
      harnesses: v.array(agentHarness),
      os: v.optional(v.string()),
      arch: v.optional(v.string()),
      maxConcurrency: v.number(),
      projectFileManifests: v.optional(v.boolean()),
      artifactUploads: v.optional(v.boolean()),
      isolatedChatAttachments: v.optional(v.boolean()),
      // Connector slugs this host provides locally (docs/connectors.md):
      // e.g. ["plaid", "imessage", "google"]. Gates agent-pass claiming the
      // same way `harnesses` gates run claiming.
      connectors: v.optional(v.array(v.string())),
    }),
    tokenHash: v.string(),
    tokenPrefix: v.string(),
    revokedAt: v.optional(v.number()),
    // Set when the host should finish current runs but claim no new ones.
    draining: v.optional(v.boolean()),
    lastHeartbeatAt: v.optional(v.number()),
    lastClaimAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain", ["brainInstanceId"])
    .index("by_token_hash", ["tokenHash"]),

  // Host-specific mapping for a project: which machine executes it and where
  // the allowlisted checkout lives. Product-level config (repoUrl,
  // defaultBaseBranch, localPath defaults) stays canonical on `projects`.
  projectExecutionConfigs: defineTable({
    brainInstanceId: v.id("brainInstances"),
    projectId: v.id("projects"),
    hostId: v.id("agentHosts"),
    // Canonical local repository path on the host. The runner re-validates it
    // against its own allowed root before every run — project selection is an
    // authorization boundary, not a UI hint.
    localPath: v.string(),
    preferredHarness: v.optional(agentHarness),
    approvalPolicy: v.optional(agentApprovalPolicy),
    // Shell command the runner executes in the worktree during the verifying
    // phase (e.g. "pnpm typecheck && pnpm test"). Absent = diff-stat only.
    verifyCommand: v.optional(v.string()),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_project", ["brainInstanceId", "projectId"])
    .index("by_host", ["hostId"]),

  // Chat mapping for the workbench. Conversational turns use a lightweight path
  // (no run); a chat is bound to ONE harness for its lifetime because
  // conversation context lives in the harness's own thread/session.
  // Page-aware: a chat belongs to a project (projectId) OR to an app page
  // (pageKey: "home", "agenda", "finances", ...) — exactly one of the two.
  // Transcript storage via the Convex Agent component is a later pass — this
  // row is the Skippy-owned mapping; conversational messages live in
  // chatMessages below.
  projectChats: defineTable({
    brainInstanceId: v.id("brainInstances"),
    projectId: v.optional(v.id("projects")),
    pageKey: v.optional(v.string()),
    taskId: v.optional(v.id("tasks")),
    title: v.string(),
    kind: v.union(v.literal("general"), v.literal("task"), v.literal("working"), v.literal("page")),
    harness: v.optional(agentHarness),
    // Harness-native thread/session id (Codex thread, Claude session).
    externalThreadId: v.optional(v.string()),
    // Rolling context for harness threads that must be rebuilt from scratch.
    historySummary: v.optional(v.string()),
    historySummaryThroughMessageCount: v.optional(v.number()),
    worktreePath: v.optional(v.string()),
    branchName: v.optional(v.string()),
    activeRunId: v.optional(v.id("agentRuns")),
    state: v.union(
      v.literal("active"),
      v.literal("waiting"),
      v.literal("completed"),
      v.literal("archived"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_project", ["brainInstanceId", "projectId"])
    .index("by_brain_task", ["brainInstanceId", "taskId"])
    .index("by_brain_page", ["brainInstanceId", "pageKey"]),

  // Conversational chat transcript. Assistant replies are produced by the Mac
  // mini runner's LOCAL harness (subscription auth — deliberately never a
  // metered LLM API call); the pending row is patched in place when the reply
  // lands, so the UI renders "thinking" state reactively.
  chatMessages: defineTable({
    brainInstanceId: v.id("brainInstances"),
    chatId: v.id("projectChats"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    // Files dropped/pasted into the chat composer. Each is uploaded through
    // the project-library flow first (so it is also a projectFiles row) and
    // referenced here by storageId; download URLs are always resolved at
    // read time — never persisted. Project chats only in v1.
    attachments: v.optional(
      v.array(
        v.union(v.object({
          storageId: v.id("_storage"),
          fileName: v.string(),
          mimeType: v.string(),
          sizeBytes: v.number(),
        }), v.object({ fileId: v.id("projectFiles") })),
      ),
    ),
    status: v.union(v.literal("complete"), v.literal("pending"), v.literal("error")),
    error: v.optional(v.string()),
    createdAt: v.number(),
    // Assistant placeholders are inserted at send time and filled when the
    // turn finishes; completedAt records that finish so the chat timeline can
    // order the reply after any task moments that happened during the turn.
    completedAt: v.optional(v.number()),
  }).index("by_chat", ["chatId", "createdAt"]),

  // Work queue for conversational turns: lighter siblings of agentRuns — same
  // host-token claiming and lease model, no worktree/verify/publish machinery.
  // The runner executes the turn with the chat's harness (Claude Code / Codex
  // CLI under the user's own auth) and patches the assistant message.
  chatTurns: defineTable({
    brainInstanceId: v.id("brainInstances"),
    chatId: v.id("projectChats"),
    userMessageId: v.id("chatMessages"),
    assistantMessageId: v.id("chatMessages"),
    harness: agentHarness,
    status: v.union(
      v.literal("queued"),
      v.literal("claimed"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    hostId: v.optional(v.id("agentHosts")),
    claimToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    cancelRequested: v.optional(v.boolean()),
    errorMessage: v.optional(v.string()),
    // Session token totals reported by the runner when the turn completes.
    usage: v.optional(tokenUsage),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_status", ["brainInstanceId", "status"])
    .index("by_chat", ["chatId"])
    .index("by_host", ["hostId"]),

  // Live activity for an in-flight chat turn: the harness's interim narration,
  // commands, file edits, and plan updates, so the chat panel can show real
  // progress instead of an indeterminate "Thinking" indicator. Ephemeral by
  // design — rows are deleted when the turn finishes; the reply is the
  // durable product (mirrors agentRunEvents' idempotent (turn, seq) shape).
  chatTurnEvents: defineTable({
    brainInstanceId: v.id("brainInstances"),
    chatTurnId: v.id("chatTurns"),
    seq: v.number(),
    type: v.string(),
    // Safe structured payload — secrets redacted runner-side before transmission.
    payload: v.optional(v.any()),
    createdAt: v.number(),
  }).index("by_turn_seq", ["chatTurnId", "seq"]),

  // Durable execution attempts. A separate table rather than an evolution of
  // the task's agent-request fields: agentRequestStatus ("requested" |
  // "cancelled") cannot represent retries/attempts, and a task accumulates run
  // history. The task keeps a pointer via projectChats.activeRunId and the
  // request fields remain the user-intent signal that queues the first run.
  agentRuns: defineTable({
    brainInstanceId: v.id("brainInstances"),
    projectId: v.id("projects"),
    chatId: v.id("projectChats"),
    taskId: v.optional(v.id("tasks")),
    hostId: v.optional(v.id("agentHosts")),
    attempt: v.number(),
    status: agentRunStatus,
    harness: agentHarness,
    // Model snapshot taken at enqueue time from the project's
    // defaultTaskModel, so a later settings change never retro-affects a
    // queued run. Absent = harness default.
    model: v.optional(v.string()),
    baseBranch: v.string(),
    workingBranch: v.optional(v.string()),
    worktreePath: v.optional(v.string()),
    // Brief snapshot so the claim returns only the authorized payload.
    executionBrief: v.optional(v.string()),
    acceptanceCriteria: v.optional(v.array(v.string())),
    inputFileRefs: v.optional(v.array(v.object({ fileId: v.id("projectFiles"), required: v.boolean() }))),
    artifactFileIds: v.optional(v.array(v.id("projectFiles"))),
    requiredArtifacts: v.optional(v.boolean()),
    fileLifecycleEnabled: v.optional(v.boolean()),
    approvalPolicy: v.optional(agentApprovalPolicy),
    // Lease-based claiming: claim is atomic; the host renews leaseExpiresAt via
    // heartbeat. An expired lease does NOT auto-start a second harness against
    // the same worktree — reconciliation inspects state first.
    claimToken: v.optional(v.string()),
    claimVersion: v.number(),
    leaseExpiresAt: v.optional(v.number()),
    // Control channel: the user sets this; the runner observes it and stops at
    // a safe boundary. Cancellation of an ACTIVE run is cooperative.
    cancelRequested: v.optional(v.boolean()),
    queuedAt: v.number(),
    claimedAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    errorCategory: v.optional(v.string()),
    // Safe (redacted) message only — never raw harness stderr.
    errorMessage: v.optional(v.string()),
    verificationSummary: v.optional(v.string()),
    resultSummary: v.optional(v.string()),
    resultUrl: v.optional(v.string()),
    prUrl: v.optional(v.string()),
    prNumber: v.optional(v.number()),
    // Session token totals reported by the runner after the harness turn.
    usage: v.optional(tokenUsage),
    // High-water mark for idempotent event ingestion.
    lastEventSeq: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_status", ["brainInstanceId", "status"])
    .index("by_brain_task", ["brainInstanceId", "taskId"])
    .index("by_brain_chat", ["brainInstanceId", "chatId"])
    .index("by_host", ["hostId"]),

  // Structured execution events, separate from conversational messages.
  // Idempotent by (runId, seq); high-frequency deltas are coalesced by the
  // runner before storage.
  agentRunEvents: defineTable({
    brainInstanceId: v.id("brainInstances"),
    runId: v.id("agentRuns"),
    seq: v.number(),
    type: v.string(),
    // Safe structured payload — secrets redacted runner-side before transmission.
    payload: v.optional(v.any()),
    createdAt: v.number(),
  }).index("by_run_seq", ["runId", "seq"]),

  // Durable approval requests. Harness-neutral: adapters map Codex
  // command/file approvals and Claude canUseTool callbacks into these records.
  // State must survive browser disconnects and runner restarts.
  agentApprovals: defineTable({
    brainInstanceId: v.id("brainInstances"),
    // Exactly one of runId / chatTurnId: an approval belongs to a code run or
    // to a conversational chat turn.
    runId: v.optional(v.id("agentRuns")),
    chatTurnId: v.optional(v.id("chatTurns")),
    // Stable harness-side request id so retried decisions cannot approve a
    // different command accidentally.
    harnessRequestId: v.string(),
    kind: agentApprovalKind,
    title: v.string(),
    explanation: v.optional(v.string()),
    // Redacted structured details (command argv, file path, host, ...).
    details: v.optional(v.any()),
    availableDecisions: v.optional(v.array(v.string())),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("cancelled"),
      v.literal("expired"),
    ),
    scope: v.optional(v.union(v.literal("command"), v.literal("turn"), v.literal("session"))),
    decidedByUserId: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
    // Why a non-user settlement happened (e.g. "approval timed out after 1440
    // min without a decision", "run ended before approval was decided").
    reason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_run_request", ["runId", "harnessRequestId"])
    .index("by_chat_turn", ["chatTurnId"])
    .index("by_chat_turn_request", ["chatTurnId", "harnessRequestId"])
    .index("by_brain_status", ["brainInstanceId", "status"]),

  // Host-executed maintenance jobs: deterministic scripted rituals the runner
  // claims like runs/chat turns (same host-token + claim-token + lease model)
  // but executes as a checklist — no LLM session. First kind:
  // post_merge_closeout, the post-merge ritual (verify merged → pull main →
  // conditional runner rebuild + deferred restart → worktree/branch cleanup →
  // mark task done with prStatus merged). Step progress lives inline on the
  // job (bounded, fixed checklist) so the task panel renders it reactively; a
  // failed step leaves the task in_review with the error visible.
  maintenanceJobs: defineTable({
    brainInstanceId: v.id("brainInstances"),
    kind: v.literal("post_merge_closeout"),
    taskId: v.id("tasks"),
    projectId: v.id("projects"),
    hostId: v.optional(v.id("agentHosts")),
    status: v.union(
      v.literal("queued"),
      v.literal("claimed"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    claimToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    // Snapshot of the PR/branch facts the ritual operates on, taken at
    // enqueue time from the task.
    prUrl: v.optional(v.string()),
    prNumber: v.optional(v.number()),
    gitBranchName: v.optional(v.string()),
    baseBranch: v.string(),
    steps: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        status: v.union(
          v.literal("pending"),
          v.literal("running"),
          v.literal("ok"),
          v.literal("failed"),
          v.literal("skipped"),
        ),
        detail: v.optional(v.string()),
      }),
    ),
    // Safe (redacted) message only — never raw command stderr dumps.
    errorMessage: v.optional(v.string()),
    resultSummary: v.optional(v.string()),
    requestedBy: v.optional(v.string()),
    queuedAt: v.number(),
    claimedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brain_status", ["brainInstanceId", "status"])
    .index("by_brain_task", ["brainInstanceId", "taskId"])
    .index("by_host", ["hostId"]),

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
