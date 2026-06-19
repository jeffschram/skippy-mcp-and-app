import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "./mcp-server";
import type { SkippyClient } from "./tools";

function createFakeClient(overrides: Partial<SkippyClient> = {}): SkippyClient {
  const client: SkippyClient = {
    submitCandidateObject: async () => ({ triageItemId: "triage_123", sourceRefIds: ["source_123"] }),
    ingestObject: async (_brainInstanceId, input) => ({
      status: "accepted",
      entityType: input.candidateEntityType,
      entityId: "entity_123",
      title: "Accepted item",
      rubricDecision: input.rubricDecision,
    }),
    createProjectDirect: async (_brainInstanceId, input) => ({
      status: "created",
      entityType: "project",
      projectId: "project_123",
      title: input.title,
    }),
    createTaskDirect: async (_brainInstanceId, input) => ({
      status: "created",
      entityType: "task",
      taskId: "task_123",
      title: input.title,
      projectId: input.projectId,
    }),
    addSourceRef: async () => ({ ok: true }),
    linkEntities: async () => ({ ok: true }),
    getLatestFocusSummary: async () => null,
    getAiContext: async () => ({
      config: { llmProviderMode: "none" },
      focusSummary: null,
      projects: [],
      tasks: [],
      people: [],
      companies: [],
      links: [],
      notes: [],
      embeddings: [],
    }),
    upsertEntityEmbedding: async () => ({ ok: true }),
    upsertFocusSummary: async () => ({ ok: true }),
    listPendingActions: async () => [],
    markTaskInProgress: async (_brainInstanceId, taskId, startedBy) => ({
      taskId,
      status: "in_progress",
      startedAt: 1780850000000,
      startedBy,
    }),
    markTaskDone: async (_brainInstanceId, taskId) => ({ taskId }),
    recordPendingActionResult: async () => ({ ok: true }),
    recordEntityReview: async () => ({ ok: true }),
    recordIngestionRun: async () => ({ ok: true }),
    updateSourceSyncStatus: async () => ({ ok: true }),
    getOperatingRules: async () => [],
    getEffectiveRubric: async () => ({
      manualRubric: "",
      goals: [],
      activeProjects: [],
      favoriteContacts: [],
      renderedText: "",
    }),
    getNotificationDispatchContext: async () => ({
      config: { notificationsEnabled: false },
      pushSubscriptions: [],
      tasks: [],
      pendingActions: [],
      recentDeliveries: [],
    }),
    recordNotificationDelivery: async () => ({ ok: true }),
  };

  return { ...client, ...overrides };
}

function textResult(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.find((item) => item.type === "text");
  if (!text || text.type !== "text" || typeof text.text !== "string") {
    throw new Error("expected text result");
  }

  return JSON.parse(text.text) as Record<string, unknown>;
}

describe("Skippy MCP manifest", () => {
  it("teaches harnesses the Skippy rubric-first workflow", async () => {
    const server = createMcpServer(createFakeClient(), "brain_123");
    const client = new Client({ name: "manifest-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      expect(client.getInstructions()).toContain("importance rubric");

      const { tools } = await client.listTools();
      const ingestObject = tools.find((tool) => tool.name === "ingest_object");
      const submitCandidate = tools.find((tool) => tool.name === "submit_candidate_object");
      const createTask = tools.find((tool) => tool.name === "create_task");
      const capture = tools.find((tool) => tool.name === "capture");
      const ask = tools.find((tool) => tool.name === "ask");
      const refreshFocusSummary = tools.find((tool) => tool.name === "refresh_focus_summary");
      const recordEntityReview = tools.find((tool) => tool.name === "record_entity_review");
      const markTaskInProgress = tools.find((tool) => tool.name === "mark_task_in_progress");
      const dispatchNotifications = tools.find((tool) => tool.name === "dispatch_notifications");

      expect(ingestObject?.description).toContain("importance rubric");
      expect(ingestObject?.inputSchema.properties?.rubricDecision).toBeDefined();
      expect(submitCandidate?.description).toContain("Legacy fallback");
      expect(submitCandidate?.inputSchema.properties?.reviewReason).toBeDefined();
      expect(createTask?.description).toContain("when the user explicitly asks");
      expect(capture?.description).toContain("accepted note directly");
      expect(ask?.annotations?.readOnlyHint).toBe(true);
      expect(refreshFocusSummary?.description).toContain("Generate and store");
      expect(recordEntityReview?.description).toContain("Record a review of an accepted Skippy entity");
      expect(markTaskInProgress?.description).toContain("when a harness starts working");
      expect(dispatchNotifications?.description).toContain("Use dryRun first");

      const prompts = await client.listPrompts();
      expect(prompts.prompts.find((prompt) => prompt.name === "skippy_intro")?.description).toContain(
        "first connected",
      );

      const intro = await client.getPrompt({ name: "skippy_intro" });
      expect(intro.messages[0]?.content.type).toBe("text");
      if (intro.messages[0]?.content.type === "text") {
        expect(intro.messages[0].content.text).toContain("Hi, I'm Skippy");
        expect(intro.messages[0].content.text).toContain("http://127.0.0.1:3000");
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns chat-friendly confirmations for direct accepted ingestion", async () => {
    const server = createMcpServer(createFakeClient(), "brain_123");
    const client = new Client({ name: "confirmation-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "ingest_object",
        arguments: {
          candidateEntityType: "task",
          candidatePayload: { title: "Fix schema mapping", dueDate: "2026-06-10" },
          rubricDecision: "Active project task with concrete implementation value.",
          confidence: 0.9,
        },
      });

      expect(textResult(result)).toMatchObject({
        status: "accepted",
        entityType: "task",
        title: "Accepted item",
        entityId: "entity_123",
        rubricDecision: "Active project task with concrete implementation value.",
        reviewUrl: "http://127.0.0.1:3000/projects",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns chat-friendly confirmations for direct task creation and completion", async () => {
    const server = createMcpServer(createFakeClient(), "brain_123");
    const client = new Client({ name: "direct-confirmation-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const createResult = await client.callTool({
        name: "create_task",
        arguments: {
          title: "Improve confirmations",
          projectId: "project_123",
        },
      });

      expect(textResult(createResult)).toMatchObject({
        status: "created",
        entityType: "task",
        title: "Improve confirmations",
        entityId: "task_123",
        projectId: "project_123",
        reviewUrl: "http://127.0.0.1:3000/projects",
      });

      const inProgressResult = await client.callTool({
        name: "mark_task_in_progress",
        arguments: {
          taskId: "task_123",
          startedBy: "codex",
        },
      });

      expect(textResult(inProgressResult)).toMatchObject({
        status: "in_progress",
        entityType: "task",
        taskId: "task_123",
        startedBy: "codex",
        reviewUrl: "http://127.0.0.1:3000/projects",
      });

      const doneResult = await client.callTool({
        name: "mark_task_done",
        arguments: {
          taskId: "task_123",
        },
      });

      expect(textResult(doneResult)).toMatchObject({
        status: "done",
        entityType: "task",
        taskId: "task_123",
        reviewUrl: "http://127.0.0.1:3000/projects",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns chat-friendly confirmations for pending action listing and result recording", async () => {
    const listCalls: Array<{ brainInstanceId: string; status?: string }> = [];
    const recordCalls: Array<{
      pendingActionId: string;
      result: {
        status: "sent" | "failed" | "completed";
        executionProvider?: string;
        externalMessageId?: string;
        error?: string;
      };
    }> = [];
    const server = createMcpServer(
      createFakeClient({
        listPendingActions: async (brainInstanceId, status) => {
          listCalls.push(status === undefined ? { brainInstanceId } : { brainInstanceId, status });
          return [
            {
              _id: "pending_action_123",
              actionType: "send_email",
              status: "approved",
              recipients: ["pat@example.com"],
              subject: "Follow up",
            },
          ];
        },
        recordPendingActionResult: async (pendingActionId, result) => {
          recordCalls.push({ pendingActionId, result });
          return { pendingActionId };
        },
      }),
      "brain_123",
    );
    const client = new Client({ name: "pending-action-confirmation-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const listResult = await client.callTool({
        name: "list_pending_actions",
        arguments: { status: "approved" },
      });

      expect(listCalls).toEqual([{ brainInstanceId: "brain_123", status: "approved" }]);
      expect(textResult(listResult)).toMatchObject({
        status: "listed",
        entityType: "pending_action",
        filterStatus: "approved",
        count: 1,
        pendingActions: [
          {
            _id: "pending_action_123",
            actionType: "send_email",
            status: "approved",
            subject: "Follow up",
          },
        ],
        reviewUrl: "http://127.0.0.1:3000/actions",
      });

      const recordResult = await client.callTool({
        name: "record_pending_action_result",
        arguments: {
          pendingActionId: "pending_action_123",
          status: "sent",
          executionProvider: "gmail",
          externalMessageId: "gmail_message_123",
        },
      });

      expect(recordCalls).toEqual([
        {
          pendingActionId: "pending_action_123",
          result: {
            pendingActionId: "pending_action_123",
            status: "sent",
            executionProvider: "gmail",
            externalMessageId: "gmail_message_123",
          },
        },
      ]);
      expect(textResult(recordResult)).toMatchObject({
        status: "sent",
        entityType: "pending_action",
        pendingActionId: "pending_action_123",
        executionProvider: "gmail",
        externalMessageId: "gmail_message_123",
        reviewUrl: "http://127.0.0.1:3000/actions",
        nextAction: "Execution result recorded in Skippy.",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
