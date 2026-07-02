import {
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  type AiProviderConfig,
  type SynthesisContextItem,
  createEmbeddingClient,
  createLlmClient,
} from "@skippy/ai";
import {
  type CandidateObjectInput,
  type EntityRef,
  type EntityType,
  type FocusSummary,
  type PendingActionStatus,
  type RelationshipInput,
  type SourceRefInput,
  normalizeCandidateObject,
} from "@skippy/shared";
import webPush from "web-push";

type AiContextRecord = {
  config?: {
    llmProviderMode?: AiProviderConfig["mode"];
    routineModel?: string;
    synthesisModel?: string;
    embeddingProviderMode?: string;
    embeddingModel?: string;
  } | null;
  focusSummary?: FocusSummary | null;
  projects?: Array<Record<string, any>>;
  tasks?: Array<Record<string, any>>;
  people?: Array<Record<string, any>>;
  companies?: Array<Record<string, any>>;
  links?: Array<Record<string, any>>;
  notes?: Array<Record<string, any>>;
  embeddings?: EntityEmbeddingRecord[];
};

type NotificationDispatchContext = {
  config?: {
    notificationsEnabled?: boolean;
    notificationPreferences?: Record<string, any>;
  } | null;
  pushSubscriptions?: Array<Record<string, any>>;
  tasks?: Array<Record<string, any>>;
  pendingActions?: Array<Record<string, any>>;
  recentDeliveries?: Array<Record<string, any>>;
};

type EntityEmbeddingRecord = {
  _id?: string;
  entityRef: EntityRef;
  canonicalText: string;
  textHash: string;
  embedding: number[];
  embeddingProvider: string;
  embeddingModel: string;
  embeddingVersion?: string;
};

export type SkippyClient = {
  submitCandidateObject(brainInstanceId: string, input: CandidateObjectInput): Promise<unknown>;
  ingestObject(
    brainInstanceId: string,
    input: CandidateObjectInput & { rubricDecision: string },
  ): Promise<unknown>;
  createProjectDirect(
    brainInstanceId: string,
    input: {
      title: string;
      summary?: string;
      status?: "idea" | "planned" | "in_progress" | "paused" | "completed" | "cancelled" | "archived";
      priorityReason?: string;
      createdBy?: string;
    },
  ): Promise<unknown>;
  createTaskDirect(
    brainInstanceId: string,
    input: {
      title: string;
      description?: string;
      status?: "todo" | "in_progress" | "waiting" | "done" | "cancelled";
      ownerType?: "owner" | "agent";
      kind?: "coding" | "review" | "research" | "design" | "manual" | "planning";
      dueAt?: number;
      priorityReason?: string;
      projectId?: string;
      createdBy?: string;
    },
  ): Promise<unknown>;
  addSourceRef(brainInstanceId: string, sourceRef: SourceRefInput): Promise<unknown>;
  linkEntities(brainInstanceId: string, relationship: RelationshipInput): Promise<unknown>;
  getLatestFocusSummary(brainInstanceId: string): Promise<FocusSummary | null>;
  getAiContext(brainInstanceId: string): Promise<unknown>;
  upsertEntityEmbedding(
    brainInstanceId: string,
    embedding: {
      entityRef: EntityRef;
      canonicalText: string;
      textHash: string;
      embedding: number[];
      embeddingProvider: string;
      embeddingModel: string;
      embeddingVersion?: string;
    },
  ): Promise<unknown>;
  upsertFocusSummary(brainInstanceId: string, summary: FocusSummary): Promise<unknown>;
  listPendingActions(brainInstanceId: string, status?: PendingActionStatus | string): Promise<unknown>;
  markTaskInProgress(
    brainInstanceId: string,
    taskId: string,
    startedBy?: string,
  ): Promise<unknown>;
  markTaskDone(
    brainInstanceId: string,
    taskId: string,
    completedByUserId?: string,
    externalReminderSourceRefId?: string,
  ): Promise<unknown>;
  recordPendingActionResult(
    pendingActionId: string,
    result: {
      status: "sent" | "failed" | "completed";
      executionProvider?: string;
      externalMessageId?: string;
      error?: string;
    },
  ): Promise<unknown>;
  recordEntityReview(brainInstanceId: string, review: EntityReviewInput): Promise<unknown>;
  getCurrentContext(brainInstanceId: string): Promise<unknown>;
  planProject(brainInstanceId: string, input: { projectId: string; maxTasks?: number }): Promise<unknown>;
  listReadyTasks(brainInstanceId: string, input: { limit?: number }): Promise<unknown>;
  listRequestedReadyTasks(brainInstanceId: string, input: { limit?: number }): Promise<unknown>;
  getTaskBrief(brainInstanceId: string, input: { taskId: string }): Promise<unknown>;
  getSkill(brainInstanceId: string, input: { slug: string }): Promise<unknown>;
  recordTaskResult(
    brainInstanceId: string,
    input: {
      taskId: string;
      resultSummary?: string;
      resultUrl?: string;
      gitBranchName?: string;
      prUrl?: string;
      prNumber?: number;
      prStatus?: "open" | "merged" | "closed";
      markDone?: boolean;
      actorId?: string;
    },
  ): Promise<unknown>;
  captureThought(brainInstanceId: string, input: CaptureThoughtInput): Promise<unknown>;
  recordMemory(brainInstanceId: string, input: RecordMemoryInput): Promise<unknown>;
  submitMemoryReviewCandidate(brainInstanceId: string, input: MemoryReviewCandidateInput): Promise<unknown>;
  listMemory(brainInstanceId: string, input: MemoryListInput): Promise<unknown>;
  getContextBundle(brainInstanceId: string, input: ContextBundleInput): Promise<unknown>;
  getMemoryDetail(brainInstanceId: string, input: MemoryDetailInput): Promise<unknown>;
  linkMemory(brainInstanceId: string, input: LinkMemoryInput): Promise<unknown>;
  listInterviewTemplates(brainInstanceId: string): Promise<unknown>;
  listInterviews(brainInstanceId: string, input: InterviewListInput): Promise<unknown>;
  startInterview(brainInstanceId: string, input: StartInterviewInput): Promise<unknown>;
  getInterview(brainInstanceId: string, input: GetInterviewInput): Promise<unknown>;
  answerInterviewQuestion(brainInstanceId: string, input: AnswerInterviewQuestionInput): Promise<unknown>;
  completeInterview(brainInstanceId: string, input: CompleteInterviewInput): Promise<unknown>;
  archiveInterview(brainInstanceId: string, input: ArchiveInterviewInput): Promise<unknown>;
  recordIngestionRun(
    brainInstanceId: string,
    run: {
      harness: string;
      status: "running" | "completed" | "failed";
      sourceSystemsChecked: string[];
      startedAt?: number;
      completedAt?: number;
      candidatesSubmitted?: number;
      objectsCreated?: number;
      objectsUpdated?: number;
      errors?: string[];
      metadata?: unknown;
    },
  ): Promise<unknown>;
  updateSourceSyncStatus(
    brainInstanceId: string,
    status: {
      statusKey?: string;
      harness: string;
      status: "idle" | "running" | "completed" | "failed";
      message?: string;
      sourceSystemsChecked: string[];
      startedAt?: number;
      completedAt?: number;
      lastHeartbeatAt?: number;
      errors?: string[];
      metadata?: unknown;
    },
  ): Promise<unknown>;
  getOperatingRules(brainInstanceId: string, scope?: string): Promise<unknown>;
  getEffectiveRubric(brainInstanceId: string): Promise<unknown>;
  getNotificationDispatchContext(brainInstanceId: string): Promise<unknown>;
  recordNotificationDelivery(
    brainInstanceId: string,
    delivery: {
      pushSubscriptionId?: string;
      dedupeKey: string;
      notificationType: string;
      title: string;
      body: string;
      url?: string;
      status: "sent" | "failed" | "skipped";
      error?: string;
    },
  ): Promise<unknown>;
};

export type SkippyToolHandlers = ReturnType<typeof createSkippyToolHandlers>;

type FocusSummaryRefreshInput = {
  generatedAt?: number;
  validUntil?: number;
  policyVersion?: string;
};

type EntityReviewInput = {
  entityRef: EntityRef;
  reviewType: "general" | "stale_check" | "priority_update" | "blocker_check" | "follow_up" | "status_check";
  reviewSummary: string;
  reviewedBy?: string;
  status?: string;
  confidence?: number;
  priorityScore?: number;
  urgencyScore?: number;
  importanceScore?: number;
  priorityReason?: string;
  priorityComputedAt?: number;
  priorityPolicyVersion?: string;
  sourceRefIds?: string[];
  sourceRefs?: SourceRefInput[];
};

export type MemoryKind = "memory" | "decision" | "principle";

export type InterviewKind = "project" | "goal" | "person" | "decision" | "weekly_review";

export type InterviewMemoryKind = "thought" | "memory" | "decision" | "principle" | "question" | "insight" | "artifact";

export type MemoryReviewBehavior = "accept" | "submit_for_review" | "auto";

export type MemoryReviewCandidateInput = {
  content: string;
  proposedKind?: MemoryKind;
  captureReason?: string;
  rubricDecision?: string;
  confidence?: number;
  reviewBehavior?: MemoryReviewBehavior;
  sourceRefs?: SourceRefInput[];
  sourceRefIds?: string[];
  relatedEntityRefs?: EntityRef[];
  createdBy?: string;
  metadata?: unknown;
};

export type CaptureThoughtInput = Omit<MemoryReviewCandidateInput, "content"> & {
  text: string;
  content?: string;
};

export type RecordMemoryInput = {
  content: string;
  kind?: MemoryKind;
  title?: string;
  summary?: string;
  captureReason?: string;
  rubricDecision: string;
  confidence?: number;
  reviewBehavior?: MemoryReviewBehavior;
  sourceRefs?: SourceRefInput[];
  sourceRefIds?: string[];
  relatedEntityRefs?: EntityRef[];
  createdBy?: string;
  metadata?: unknown;
};

export type MemoryListInput = {
  query?: string;
  memoryType?: MemoryKind;
  kinds?: MemoryKind[];
  relatedEntityRefs?: EntityRef[];
  includeArchived?: boolean;
  limit?: number;
};

export type ContextBundleInput = Omit<MemoryListInput, "limit"> & {
  memoryLimit?: number;
  entityLimit?: number;
  sourceLimit?: number;
};

export type MemoryDetailInput = {
  memoryId: string;
  includeSourceRefs?: boolean;
  includeRelatedEntities?: boolean;
};

export type LinkMemoryInput = {
  memoryId: string;
  entityRef: EntityRef;
  relationshipType?: string;
  reason?: string;
  confidence?: number;
  sourceRefs?: SourceRefInput[];
  sourceRefIds?: string[];
  createdBy?: string;
};

export type InterviewListInput = {
  recentLimit?: number;
};

export type StartInterviewInput = {
  kind: InterviewKind;
  title?: string;
  subjectLabel?: string;
  subjectEntityRef?: EntityRef;
  startedBy?: string;
};

export type GetInterviewInput = {
  interviewId: string;
};

export type AnswerInterviewQuestionInput = {
  interviewId: string;
  answerText: string;
  answerValue?: unknown;
  createMemoryCandidate?: boolean;
  memoryType?: InterviewMemoryKind;
  answeredBy?: string;
};

export type CompleteInterviewInput = {
  interviewId: string;
  summary?: string;
  createSummaryMemoryCandidate?: boolean;
  memoryType?: InterviewMemoryKind;
  completedBy?: string;
};

export type ArchiveInterviewInput = {
  interviewId: string;
  archiveReason?: string;
  archivedBy?: string;
};

type NotificationCandidate = {
  dedupeKey: string;
  notificationType: string;
  title: string;
  body: string;
  url: string;
};

function itemSummary(item: Record<string, any>) {
  return item.summary ?? item.description ?? item.priorityReason ?? item.body ?? item.notes ?? item.relationshipContext;
}

function isActiveFocusItem(entityType: EntityType, item: Record<string, any>) {
  if (item.processingState && item.processingState !== "accepted") {
    return false;
  }

  if (entityType === "task") {
    return item.status !== "done" && item.status !== "cancelled";
  }

  if (entityType === "project") {
    return !["completed", "cancelled", "archived"].includes(item.status);
  }

  if (entityType === "goal") {
    return item.status !== "achieved" && item.status !== "abandoned";
  }

  if (entityType === "link") {
    return item.status !== "discarded";
  }

  return true;
}

function contextItemsFromEntityList(
  entityType: EntityType,
  items: Array<Record<string, any>> | undefined,
): SynthesisContextItem[] {
  return (items ?? [])
    .filter((item) => isActiveFocusItem(entityType, item))
    .map((item) => ({
      entityRef: { entityType, entityId: item._id },
      title: item.title ?? item.name ?? item.url ?? item.body ?? "Untitled",
      summary: itemSummary(item),
      reason: item.priorityReason ?? item.reviewReason ?? item.status,
    }));
}

function synthesisItems(context: AiContextRecord): SynthesisContextItem[] {
  return [
    ...contextItemsFromEntityList("project", context.projects),
    ...contextItemsFromEntityList("task", context.tasks),
    ...contextItemsFromEntityList("person", context.people),
    ...contextItemsFromEntityList("company", context.companies),
    ...contextItemsFromEntityList("link", context.links),
    ...contextItemsFromEntityList("note", context.notes),
  ].slice(0, 80);
}

function textForEmbedding(item: SynthesisContextItem) {
  return [item.title, item.summary, item.reason, item.entityRef ? `${item.entityRef.entityType}:${item.entityRef.entityId}` : undefined]
    .filter(Boolean)
    .join("\n");
}

function textHash(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}

function entityRefKey(entityRef: EntityRef) {
  return `${entityRef.entityType}:${entityRef.entityId}`;
}

function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

async function rankContextItemsWithEmbeddings(
  config: AiProviderConfig,
  query: string,
  items: SynthesisContextItem[],
  persistedEmbeddings: EntityEmbeddingRecord[] | undefined,
  client: SkippyClient,
  brainInstanceId: string,
) {
  if (config.embeddingProvider !== "openai" || items.length === 0) {
    return { items };
  }

  const embeddingProvider = "openai";
  const embeddingModel = config.embeddingModel ?? DEFAULT_OPENAI_EMBEDDING_MODEL;
  const embeddingsByEntity = new Map(
    (persistedEmbeddings ?? [])
      .filter(
        (embedding) =>
          embedding.embeddingProvider === embeddingProvider &&
          embedding.embeddingModel === embeddingModel,
      )
      .map((embedding) => [entityRefKey(embedding.entityRef), embedding]),
  );
  const embeddableItems = items
    .filter((item) => item.entityRef)
    .map((item) => ({ item, text: textForEmbedding(item) }))
    .filter((item) => item.text.trim())
    .slice(0, 50);

  if (embeddableItems.length === 0) {
    return { items };
  }

  const embeddingClient = createEmbeddingClient(config);
  const queryEmbedding = await embeddingClient.embed({
    entityRef: { entityType: "knowledgeObject", entityId: "ask-query" },
    text: query,
    textHash: textHash(query),
  });
  const cachedEmbeddings = new Map<string, number[]>();
  const missingEmbeddingRequests = embeddableItems
    .map(({ item, text }) => {
      const entityRef = item.entityRef!;
      const hash = textHash(text);
      const persistedEmbedding = embeddingsByEntity.get(entityRefKey(entityRef));
      if (persistedEmbedding?.textHash === hash && Array.isArray(persistedEmbedding.embedding)) {
        cachedEmbeddings.set(entityRefKey(entityRef), persistedEmbedding.embedding);
        return null;
      }

      return {
        entityRef,
        text,
        textHash: hash,
      };
    })
    .filter((request): request is { entityRef: EntityRef; text: string; textHash: string } => request !== null);
  const generatedEmbeddings = missingEmbeddingRequests.length
    ? embeddingClient.embedMany
      ? await embeddingClient.embedMany(missingEmbeddingRequests)
      : await Promise.all(missingEmbeddingRequests.map((request) => embeddingClient.embed(request)))
    : [];
  const generatedEmbeddingsByEntity = new Map<string, number[]>();
  await Promise.all(
    generatedEmbeddings.map(async (embedding, index) => {
      const request = missingEmbeddingRequests[index];
      if (!request) {
        return;
      }
      generatedEmbeddingsByEntity.set(entityRefKey(request.entityRef), embedding.embedding);
      const persistedEmbedding: Parameters<SkippyClient["upsertEntityEmbedding"]>[1] = {
        entityRef: request.entityRef,
        canonicalText: request.text,
        textHash: request.textHash,
        embedding: embedding.embedding,
        embeddingProvider: embedding.provider,
        embeddingModel: embedding.model,
      };
      await client.upsertEntityEmbedding(brainInstanceId, persistedEmbedding);
    }),
  );
  const rankedItems = embeddableItems
    .map(({ item }) => {
      const entityRef = item.entityRef!;
      const embedding =
        cachedEmbeddings.get(entityRefKey(entityRef)) ?? generatedEmbeddingsByEntity.get(entityRefKey(entityRef)) ?? [];
      return {
        item,
        score: cosineSimilarity(queryEmbedding.embedding, embedding),
      };
    })
    .sort((left, right) => right.score - left.score);
  const rankedSet = new Set(rankedItems.map(({ item }) => item));
  const unrankedItems = items.filter((item) => !rankedSet.has(item));

  return {
    items: [...rankedItems.map(({ item }) => item), ...unrankedItems].slice(0, 30),
    embeddingRanking: {
      provider: queryEmbedding.provider,
      model: queryEmbedding.model,
      rankedItemCount: rankedItems.length,
      cachedItemCount: cachedEmbeddings.size,
      generatedItemCount: generatedEmbeddings.length,
      topScore: rankedItems[0]?.score,
    },
  };
}

function aiConfigFromContext(context: AiContextRecord): AiProviderConfig {
  const config: AiProviderConfig = {
    mode: context.config?.llmProviderMode ?? "none",
  };

  if (context.config?.routineModel) {
    config.routineModel = context.config.routineModel;
  }
  if (context.config?.synthesisModel) {
    config.synthesisModel = context.config.synthesisModel;
  }
  if (context.config?.embeddingProviderMode) {
    config.embeddingProvider = context.config.embeddingProviderMode;
  }
  if (context.config?.embeddingModel) {
    config.embeddingModel = context.config.embeddingModel;
  }

  return config;
}

function environmentValue(...names: string[]) {
  const env = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return names.map((name) => env?.[name]).find(Boolean);
}

function notificationCandidates(context: NotificationDispatchContext, limit: number): NotificationCandidate[] {
  const preferences = context.config?.notificationPreferences ?? {};
  const minPriorityScore = typeof preferences.minPriorityScore === "number" ? preferences.minPriorityScore : 0.7;
  const candidates: NotificationCandidate[] = [];

  if (preferences.urgentEnabled !== false) {
    for (const task of context.tasks ?? []) {
      if (task.status === "done" || task.status === "cancelled") {
        continue;
      }
      const priorityScore = typeof task.priorityScore === "number" ? task.priorityScore : 0;
      if (priorityScore >= minPriorityScore) {
        candidates.push({
          dedupeKey: `urgent_task:${task._id}:${task.updatedAt ?? task.priorityComputedAt ?? task.createdAt ?? ""}`,
          notificationType: "urgent_task",
          title: "Skippy: urgent task",
          body: task.title ?? "An urgent task needs attention.",
          url: "/projects",
        });
      }
    }
  }

  if (preferences.pendingActionEnabled !== false) {
    for (const action of context.pendingActions ?? []) {
      candidates.push({
        dedupeKey: `pending_action:${action._id}:${action.updatedAt ?? action.createdAt ?? ""}`,
        notificationType: "pending_action",
        title: "Skippy: action needs approval",
        body: action.subject ?? action.actionType ?? "A pending action needs review.",
        url: "/pending-actions",
      });
    }
  }

  return candidates.slice(0, limit);
}

function configureWebPush() {
  const publicKey = environmentValue("SKIPPY_VAPID_PUBLIC_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PUBLIC_KEY");
  const privateKey = environmentValue("SKIPPY_VAPID_PRIVATE_KEY", "VAPID_PRIVATE_KEY");
  const subject = environmentValue("SKIPPY_VAPID_SUBJECT", "VAPID_SUBJECT") ?? "mailto:admin@example.com";
  if (!publicKey || !privateKey) {
    return false;
  }

  webPush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

function normalizeRequiredText(value: string, fieldName: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }

  return normalized;
}

export function createSkippyToolHandlers(client: SkippyClient, brainInstanceId: string) {
  return {
    async capture(input: { text: string; sourceRef?: SourceRefInput }) {
      const normalizedText = normalizeRequiredText(input.text, "text");

      const candidate: CandidateObjectInput<"note"> = {
        candidateEntityType: "note",
        candidatePayload: { body: normalizedText },
        reviewReason: "Captured from a natural-language MCP request.",
      };

      if (input.sourceRef) {
        candidate.sourceRefs = [input.sourceRef];
      }

      return await client.ingestObject(brainInstanceId, {
        ...candidate,
        rubricDecision: "Explicit user capture request.",
      });
    },

    async ask(input: { query: string }) {
      const normalizedQuery = input.query.trim();
      if (!normalizedQuery) {
        throw new Error("query is required");
      }

      const context = (await client.getAiContext(brainInstanceId)) as AiContextRecord;
      const focusSummary = context.focusSummary ?? null;
      const config = aiConfigFromContext(context);
      let contextItems = synthesisItems(context);
      let embeddingRanking: Awaited<ReturnType<typeof rankContextItemsWithEmbeddings>>["embeddingRanking"];
      let embeddingError: string | undefined;

      try {
        const ranked = await rankContextItemsWithEmbeddings(
          config,
          normalizedQuery,
          contextItems,
          context.embeddings,
          client,
          brainInstanceId,
        );
        contextItems = ranked.items;
        embeddingRanking = ranked.embeddingRanking;
      } catch (error) {
        embeddingError = error instanceof Error ? error.message : "Unknown embedding ranking error";
      }

      if (config.mode === "openai") {
        try {
          const result = await createLlmClient(config).synthesize({
            query: normalizedQuery,
            context: contextItems,
            policyVersion: "skippy-mcp-ask-v1",
          });

          return {
            answer: result.answer,
            query: normalizedQuery,
            citedItems: result.citedItems,
            usage: result.usage,
            embeddingRanking,
            embeddingError,
            focusSummary,
          };
        } catch (error) {
          return {
            answer: "OpenAI synthesis is configured, but the request failed. Returning structured context instead.",
            query: normalizedQuery,
            error: error instanceof Error ? error.message : "Unknown OpenAI synthesis error",
            contextItems,
            embeddingRanking,
            embeddingError,
            focusSummary,
          };
        }
      }

      return {
        answer:
          "Internal synthesis is not configured yet. Returning structured context that may help the harness answer.",
        query: normalizedQuery,
        contextItems,
        embeddingRanking,
        embeddingError,
        focusSummary,
      };
    },

    async summarizeFocus() {
      return await client.getLatestFocusSummary(brainInstanceId);
    },

    async getImportanceRubric() {
      return await client.getEffectiveRubric(brainInstanceId);
    },

    async refreshFocusSummary(input: FocusSummaryRefreshInput = {}) {
      const context = (await client.getAiContext(brainInstanceId)) as AiContextRecord;
      const config = aiConfigFromContext(context);
      let contextItems = synthesisItems(context);
      let embeddingRanking: Awaited<ReturnType<typeof rankContextItemsWithEmbeddings>>["embeddingRanking"];
      let embeddingError: string | undefined;

      try {
        const ranked = await rankContextItemsWithEmbeddings(
          config,
          "What should the user focus on now?",
          contextItems,
          context.embeddings,
          client,
          brainInstanceId,
        );
        contextItems = ranked.items;
        embeddingRanking = ranked.embeddingRanking;
      } catch (error) {
        embeddingError = error instanceof Error ? error.message : "Unknown embedding ranking error";
      }

      if (config.mode !== "openai") {
        return {
          status: "not_configured",
          message: "Internal focus summary generation requires llmProviderMode=openai.",
          contextItems,
          embeddingRanking,
          embeddingError,
        };
      }

      const policyVersion = input.policyVersion ?? "skippy-focus-summary-v1";
      const generatedAt = input.generatedAt ?? Date.now();
      const focusSummary = await createLlmClient(config).generateFocusSummary({
        items: contextItems,
        generatedAt,
        policyVersion,
      });
      const summaryToStore: FocusSummary = {
        ...focusSummary,
      };

      if (input.validUntil) {
        summaryToStore.validUntil = input.validUntil;
      }
      if (!summaryToStore.policyVersion) {
        summaryToStore.policyVersion = policyVersion;
      }

      const result = await client.upsertFocusSummary(brainInstanceId, summaryToStore);

      return {
        status: "generated",
        result,
        focusSummary: summaryToStore,
        embeddingRanking,
        embeddingError,
      };
    },

    async submitCandidateObject(input: CandidateObjectInput) {
      const normalizedInput = normalizeCandidateObject(input);
      return await client.submitCandidateObject(brainInstanceId, normalizedInput);
    },

    async ingestObject(input: CandidateObjectInput & { rubricDecision: string }) {
      const normalizedInput = normalizeCandidateObject(input);
      return await client.ingestObject(brainInstanceId, {
        ...normalizedInput,
        rubricDecision: input.rubricDecision,
      });
    },

    async createProjectDirect(input: Parameters<SkippyClient["createProjectDirect"]>[1]) {
      const title = input.title.trim();
      if (!title) {
        throw new Error("title is required");
      }

      return await client.createProjectDirect(brainInstanceId, {
        ...input,
        title,
        createdBy: input.createdBy ?? "skippy_mcp",
      });
    },

    async createTaskDirect(input: Parameters<SkippyClient["createTaskDirect"]>[1]) {
      const title = input.title.trim();
      if (!title) {
        throw new Error("title is required");
      }

      return await client.createTaskDirect(brainInstanceId, {
        ...input,
        title,
        createdBy: input.createdBy ?? "skippy_mcp",
      });
    },

    async upsertEntity<T extends EntityType>(entityType: T, payload: CandidateObjectInput<T>["candidatePayload"]) {
      const normalizedInput = normalizeCandidateObject({
        candidateEntityType: entityType,
        candidatePayload: payload,
        reviewReason: `Submitted through structured ${entityType} MCP tool.`,
      });
      return await client.ingestObject(brainInstanceId, {
        ...normalizedInput,
        rubricDecision: `Structured ${entityType} submitted through an MCP convenience tool; harness judged it worth storing under the importance rubric.`,
      });
    },

    async addSourceRef(input: SourceRefInput) {
      return await client.addSourceRef(brainInstanceId, input);
    },

    async linkEntities(input: RelationshipInput) {
      return await client.linkEntities(brainInstanceId, input);
    },

    async generateFocusSummary(input: FocusSummary) {
      return await client.upsertFocusSummary(brainInstanceId, input);
    },

    async listPendingActions(input: { status?: PendingActionStatus | string } = {}) {
      return await client.listPendingActions(brainInstanceId, input.status);
    },

    async markTaskInProgress(input: { taskId: string; startedBy?: string }) {
      return await client.markTaskInProgress(
        brainInstanceId,
        input.taskId,
        input.startedBy ?? "skippy_mcp",
      );
    },

    async markTaskDone(input: {
      taskId: string;
      completedBy?: string;
      completedByUserId?: string;
      externalReminderSourceRefId?: string;
    }) {
      return await client.markTaskDone(
        brainInstanceId,
        input.taskId,
        input.completedByUserId,
        input.externalReminderSourceRefId,
      );
    },

    async recordPendingActionResult(input: {
      pendingActionId: string;
      status: "sent" | "failed" | "completed";
      executionProvider?: string;
      externalMessageId?: string;
      error?: string;
    }) {
      return await client.recordPendingActionResult(input.pendingActionId, input);
    },

    async recordEntityReview(input: EntityReviewInput) {
      const reviewSummary = normalizeRequiredText(input.reviewSummary, "reviewSummary");

      return await client.recordEntityReview(brainInstanceId, {
        ...input,
        reviewSummary,
        reviewedBy: input.reviewedBy ?? "skippy_mcp",
        priorityComputedAt: input.priorityComputedAt ?? Date.now(),
      });
    },

    async getCurrentContext() {
      return await client.getCurrentContext(brainInstanceId);
    },

    async planProject(input: { projectId: string; maxTasks?: number }) {
      return await client.planProject(brainInstanceId, input);
    },

    async listReadyTasks(input: { limit?: number } = {}) {
      return await client.listReadyTasks(brainInstanceId, input);
    },

    async listRequestedReadyTasks(input: { limit?: number } = {}) {
      return await client.listRequestedReadyTasks(brainInstanceId, input);
    },

    async getTaskBrief(input: { taskId: string }) {
      return await client.getTaskBrief(brainInstanceId, input);
    },

    async getSkill(input: { slug: string }) {
      return await client.getSkill(brainInstanceId, input);
    },

    async recordTaskResult(input: {
      taskId: string;
      resultSummary?: string;
      resultUrl?: string;
      gitBranchName?: string;
      prUrl?: string;
      prNumber?: number;
      prStatus?: "open" | "merged" | "closed";
      markDone?: boolean;
    }) {
      return await client.recordTaskResult(brainInstanceId, {
        ...input,
        actorId: "skippy_mcp",
      });
    },

    async captureThought(input: CaptureThoughtInput) {
      const text = normalizeRequiredText(input.text, "text");
      return await client.captureThought(brainInstanceId, {
        ...input,
        text,
        content: normalizeRequiredText(input.content ?? text, "content"),
        proposedKind: input.proposedKind ?? "memory",
        captureReason: input.captureReason ?? "Captured from an explicit MCP memory request.",
        reviewBehavior: input.reviewBehavior ?? "auto",
        createdBy: input.createdBy ?? "skippy_mcp",
      });
    },

    async recordMemory(input: RecordMemoryInput) {
      return await client.recordMemory(brainInstanceId, {
        ...input,
        content: normalizeRequiredText(input.content, "content"),
        kind: input.kind ?? "memory",
        rubricDecision: normalizeRequiredText(input.rubricDecision, "rubricDecision"),
        reviewBehavior: input.reviewBehavior ?? "accept",
        createdBy: input.createdBy ?? "skippy_mcp",
      });
    },

    async submitMemoryReviewCandidate(input: MemoryReviewCandidateInput) {
      return await client.submitMemoryReviewCandidate(brainInstanceId, {
        ...input,
        content: normalizeRequiredText(input.content, "content"),
        proposedKind: input.proposedKind ?? "memory",
        captureReason: input.captureReason ?? "Submitted for memory review through MCP.",
        reviewBehavior: input.reviewBehavior ?? "submit_for_review",
        createdBy: input.createdBy ?? "skippy_mcp",
      });
    },

    async listMemory(input: MemoryListInput = {}) {
      const listInput: MemoryListInput = {
        ...input,
        limit: input.limit ?? 20,
      };
      const query = input.query?.trim();
      if (query) {
        listInput.query = query;
      }

      return await client.listMemory(brainInstanceId, listInput);
    },

    async getContextBundle(input: ContextBundleInput = {}) {
      const bundleInput: ContextBundleInput = {
        ...input,
        memoryLimit: input.memoryLimit ?? 8,
        entityLimit: input.entityLimit ?? 12,
        sourceLimit: input.sourceLimit ?? 12,
      };
      const query = input.query?.trim();
      if (query) {
        bundleInput.query = query;
      }

      return await client.getContextBundle(brainInstanceId, bundleInput);
    },

    async getMemoryDetail(input: MemoryDetailInput) {
      return await client.getMemoryDetail(brainInstanceId, {
        ...input,
        memoryId: normalizeRequiredText(input.memoryId, "memoryId"),
      });
    },

    async linkMemory(input: LinkMemoryInput) {
      return await client.linkMemory(brainInstanceId, {
        ...input,
        memoryId: normalizeRequiredText(input.memoryId, "memoryId"),
        relationshipType: input.relationshipType ?? "related_to",
        createdBy: input.createdBy ?? "skippy_mcp",
      });
    },

    async listInterviewTemplates() {
      return await client.listInterviewTemplates(brainInstanceId);
    },

    async listInterviews(input: InterviewListInput = {}) {
      return await client.listInterviews(brainInstanceId, {
        recentLimit: input.recentLimit ?? 12,
      });
    },

    async startInterview(input: StartInterviewInput) {
      return await client.startInterview(brainInstanceId, {
        ...input,
        startedBy: input.startedBy ?? "skippy_mcp",
      });
    },

    async getInterview(input: GetInterviewInput) {
      return await client.getInterview(brainInstanceId, {
        interviewId: normalizeRequiredText(input.interviewId, "interviewId"),
      });
    },

    async answerInterviewQuestion(input: AnswerInterviewQuestionInput) {
      return await client.answerInterviewQuestion(brainInstanceId, {
        ...input,
        interviewId: normalizeRequiredText(input.interviewId, "interviewId"),
        answerText: normalizeRequiredText(input.answerText, "answerText"),
        answeredBy: input.answeredBy ?? "skippy_mcp",
      });
    },

    async completeInterview(input: CompleteInterviewInput) {
      return await client.completeInterview(brainInstanceId, {
        ...input,
        interviewId: normalizeRequiredText(input.interviewId, "interviewId"),
        completedBy: input.completedBy ?? "skippy_mcp",
      });
    },

    async archiveInterview(input: ArchiveInterviewInput) {
      return await client.archiveInterview(brainInstanceId, {
        ...input,
        interviewId: normalizeRequiredText(input.interviewId, "interviewId"),
        archivedBy: input.archivedBy ?? "skippy_mcp",
      });
    },

    async recordIngestionRun(input: Parameters<SkippyClient["recordIngestionRun"]>[1]) {
      return await client.recordIngestionRun(brainInstanceId, input);
    },

    async updateSourceSyncStatus(input: Parameters<SkippyClient["updateSourceSyncStatus"]>[1]) {
      return await client.updateSourceSyncStatus(brainInstanceId, input);
    },

    async dispatchNotifications(input: { dryRun?: boolean; limit?: number } = {}) {
      const limit = input.limit ?? 10;
      const context = (await client.getNotificationDispatchContext(brainInstanceId)) as NotificationDispatchContext;
      const candidates = notificationCandidates(context, limit);
      const recentDedupeKeys = new Set(
        (context.recentDeliveries ?? [])
          .filter((delivery) => delivery.status === "sent" || delivery.status === "skipped")
          .map((delivery) => delivery.dedupeKey),
      );
      const pendingCandidates = candidates.filter((candidate) => !recentDedupeKeys.has(candidate.dedupeKey));
      const subscriptions = (context.pushSubscriptions ?? []).filter((subscription) => subscription.enabled && !subscription.revokedAt);

      if (!context.config?.notificationsEnabled) {
        return {
          status: "disabled",
          candidateCount: candidates.length,
          dispatchCount: 0,
          message: "Notifications are disabled for this brain.",
        };
      }

      if (input.dryRun) {
        return {
          status: "dry_run",
          candidateCount: candidates.length,
          dispatchCount: pendingCandidates.length * subscriptions.length,
          candidates: pendingCandidates,
          subscriptionCount: subscriptions.length,
        };
      }

      if (subscriptions.length === 0) {
        return {
          status: "no_targets",
          candidateCount: candidates.length,
          dispatchCount: 0,
          message: "No active push subscriptions are stored.",
        };
      }

      if (!configureWebPush()) {
        return {
          status: "not_configured",
          candidateCount: candidates.length,
          dispatchCount: 0,
          message: "VAPID public/private keys are required to send browser push notifications.",
        };
      }

      let sentCount = 0;
      let failedCount = 0;
      for (const candidate of pendingCandidates) {
        for (const subscription of subscriptions) {
          try {
            await webPush.sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: {
                  p256dh: subscription.p256dh,
                  auth: subscription.auth,
                },
              },
              JSON.stringify({
                title: candidate.title,
                body: candidate.body,
                url: candidate.url,
              }),
            );
            sentCount += 1;
            await client.recordNotificationDelivery(brainInstanceId, {
              pushSubscriptionId: subscription._id,
              ...candidate,
              status: "sent",
            });
          } catch (error) {
            failedCount += 1;
            await client.recordNotificationDelivery(brainInstanceId, {
              pushSubscriptionId: subscription._id,
              ...candidate,
              status: "failed",
              error: error instanceof Error ? error.message : "Unknown push dispatch error",
            });
          }
        }
      }

      return {
        status: failedCount ? "partial" : "sent",
        candidateCount: candidates.length,
        sentCount,
        failedCount,
        subscriptionCount: subscriptions.length,
      };
    },
  };
}

export function entityRef(entityType: EntityType, entityId: string): EntityRef {
  return { entityType, entityId };
}
