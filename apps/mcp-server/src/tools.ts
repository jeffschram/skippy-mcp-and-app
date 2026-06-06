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

export type SkippyClient = {
  submitCandidateObject(brainInstanceId: string, input: CandidateObjectInput): Promise<unknown>;
  createProjectDirect(
    brainInstanceId: string,
    input: {
      title: string;
      summary?: string;
      status?: "idea" | "planned" | "in_progress" | "paused" | "completed" | "cancelled";
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
      dueAt?: number;
      priorityReason?: string;
      projectId?: string;
      createdBy?: string;
    },
  ): Promise<unknown>;
  addSourceRef(brainInstanceId: string, sourceRef: SourceRefInput): Promise<unknown>;
  linkEntities(brainInstanceId: string, relationship: RelationshipInput): Promise<unknown>;
  getLatestFocusSummary(brainInstanceId: string): Promise<FocusSummary | null>;
  upsertFocusSummary(brainInstanceId: string, summary: FocusSummary): Promise<unknown>;
  listPendingActions(brainInstanceId: string, status?: PendingActionStatus | string): Promise<unknown>;
  markTaskDone(
    brainInstanceId: string,
    taskId: string,
    completedBy?: string,
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
};

export type SkippyToolHandlers = ReturnType<typeof createSkippyToolHandlers>;

export function createSkippyToolHandlers(client: SkippyClient, brainInstanceId: string) {
  return {
    async capture(input: { text: string; sourceRef?: SourceRefInput }) {
      const normalizedText = input.text.trim();
      if (!normalizedText) {
        throw new Error("text is required");
      }

      const candidate: CandidateObjectInput<"note"> = {
        candidateEntityType: "note",
        candidatePayload: { body: normalizedText },
        reviewReason: "Captured from a natural-language MCP request.",
      };

      if (input.sourceRef) {
        candidate.sourceRefs = [input.sourceRef];
      }

      return await client.submitCandidateObject(brainInstanceId, candidate);
    },

    async ask(input: { query: string }) {
      const normalizedQuery = input.query.trim();
      if (!normalizedQuery) {
        throw new Error("query is required");
      }

      const focusSummary = await client.getLatestFocusSummary(brainInstanceId);
      return {
        answer:
          "Internal synthesis is not configured yet. Returning structured context that may help the harness answer.",
        query: normalizedQuery,
        focusSummary,
      };
    },

    async summarizeFocus() {
      return await client.getLatestFocusSummary(brainInstanceId);
    },

    async submitCandidateObject(input: CandidateObjectInput) {
      const normalizedInput = normalizeCandidateObject(input);
      return await client.submitCandidateObject(brainInstanceId, normalizedInput);
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
      return await client.submitCandidateObject(
        brainInstanceId,
        normalizeCandidateObject({
          candidateEntityType: entityType,
          candidatePayload: payload,
          reviewReason: `Submitted through structured ${entityType} MCP tool.`,
        }),
      );
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

    async markTaskDone(input: {
      taskId: string;
      completedBy?: string;
      externalReminderSourceRefId?: string;
    }) {
      return await client.markTaskDone(
        brainInstanceId,
        input.taskId,
        input.completedBy,
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

    async recordIngestionRun(input: Parameters<SkippyClient["recordIngestionRun"]>[1]) {
      return await client.recordIngestionRun(brainInstanceId, input);
    },
  };
}

export function entityRef(entityType: EntityType, entityId: string): EntityRef {
  return { entityType, entityId };
}
