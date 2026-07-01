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
    getCurrentContext: async () => ({ activeRoute: "/projects/project_123", activeProject: { _id: "project_123", title: "Demo" } }),
    planProject: async (_brainInstanceId, input) => ({
      status: "planned",
      planId: "plan_123",
      projectId: input.projectId,
      taskCount: 3,
      summary: "Planned",
    }),
    listReadyTasks: async () => [],
    listRequestedReadyTasks: async () => [],
    getTaskBrief: async (_brainInstanceId, input) => ({ _id: input.taskId, title: "Task", executionBrief: "do it" }),
    recordTaskResult: async (_brainInstanceId, input) => ({ taskId: input.taskId, executionState: "in_review" }),
    captureThought: async (_brainInstanceId, input) => ({
      status: input.reviewBehavior === "submit_for_review" ? "submitted_for_review" : "captured",
      memoryId: "memory_123",
      kind: input.proposedKind ?? "memory",
      title: input.content ?? input.text,
      sourceRefIds: ["source_123"],
      confidence: input.confidence,
    }),
    recordMemory: async (_brainInstanceId, input) => ({
      status: "recorded",
      memoryId: "memory_123",
      kind: input.kind ?? "memory",
      title: input.title ?? input.content,
      rubricDecision: input.rubricDecision,
    }),
    submitMemoryReviewCandidate: async (_brainInstanceId, input) => ({
      status: "submitted_for_review",
      reviewItemId: "memory_review_123",
      kind: input.proposedKind ?? "memory",
      title: input.content,
    }),
    listMemory: async () => [],
    getContextBundle: async (_brainInstanceId, input) => ({
      query: input.query,
      memories: [],
      entities: [],
      sourceRefs: [],
    }),
    getMemoryDetail: async (_brainInstanceId, input) => ({ memoryId: input.memoryId }),
    linkMemory: async (_brainInstanceId, input) => ({
      status: "linked",
      memoryId: input.memoryId,
      relatedEntityRefs: [input.entityRef],
    }),
    listInterviewTemplates: async () => ({
      assistantDisplayName: "Skippy",
      templates: [
        {
          kind: "project",
          title: "Project check-in",
          description: "Clarify scope, momentum, blockers, and next action.",
          questionCount: 4,
          suggestedPrompt: "Want to do a project interview for Skippy?",
        },
      ],
    }),
    listInterviews: async () => ({
      assistantDisplayName: "Skippy",
      templates: [],
      active: [],
      recent: [],
    }),
    startInterview: async (_brainInstanceId, input) => ({
      status: "active",
      interviewId: "interview_123",
      assistantDisplayName: "Skippy",
      kind: input.kind,
      currentQuestion: {
        id: "project_current_state",
        prompt: "What is the current state of this project?",
      },
      progress: { answered: 0, total: 4 },
      suggestedPrompt: "Want to do a project interview for Skippy?",
      reviewUrl: "/interviews/interview_123",
    }),
    getInterview: async (_brainInstanceId, input) => ({
      assistantDisplayName: "Skippy",
      interview: { _id: input.interviewId, status: "active" },
      currentQuestion: { id: "project_current_state", prompt: "What is the current state of this project?" },
      responses: [],
      progress: { answered: 0, total: 4 },
      reviewUrl: `/interviews/${input.interviewId}`,
    }),
    answerInterviewQuestion: async (_brainInstanceId, input) => ({
      interviewId: input.interviewId,
      assistantDisplayName: "Skippy",
      nextQuestion: {
        id: "project_desired_outcome",
        prompt: "What outcome would make this project successful?",
      },
      progress: { answered: 1, total: 4 },
      isLastAnswer: false,
      reviewUrl: `/interviews/${input.interviewId}`,
    }),
    completeInterview: async (_brainInstanceId, input) => ({
      interviewId: input.interviewId,
      assistantDisplayName: "Skippy",
      reviewUrl: `/interviews/${input.interviewId}`,
    }),
    archiveInterview: async (_brainInstanceId, input) => ({
      interviewId: input.interviewId,
      assistantDisplayName: "Skippy",
      reviewUrl: "/interviews",
    }),
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
      const captureThought = tools.find((tool) => tool.name === "capture_thought");
      const recordMemory = tools.find((tool) => tool.name === "record_memory");
      const recordDecision = tools.find((tool) => tool.name === "record_decision");
      const recordPrinciple = tools.find((tool) => tool.name === "record_principle");
      const submitMemoryReviewCandidate = tools.find(
        (tool) => tool.name === "submit_memory_review_candidate",
      );
      const listMemory = tools.find((tool) => tool.name === "list_memory");
      const getContextBundle = tools.find((tool) => tool.name === "get_context_bundle");
      const getMemoryDetail = tools.find((tool) => tool.name === "get_memory_detail");
      const linkMemory = tools.find((tool) => tool.name === "link_memory");
      const listRequestedReadyTasks = tools.find((tool) => tool.name === "list_requested_ready_tasks");
      const listInterviewTemplates = tools.find((tool) => tool.name === "list_interview_templates");
      const startInterview = tools.find((tool) => tool.name === "start_interview");
      const answerInterviewQuestion = tools.find((tool) => tool.name === "answer_interview_question");
      const completeInterview = tools.find((tool) => tool.name === "complete_interview");

      expect(ingestObject?.description).toContain("importance rubric");
      expect(ingestObject?.inputSchema.properties?.rubricDecision).toBeDefined();
      expect(submitCandidate?.description).toContain("Legacy fallback");
      expect(submitCandidate?.inputSchema.properties?.reviewReason).toBeDefined();
      expect(createTask?.description).toContain("when the user explicitly asks");
      expect(createTask?.inputSchema.properties?.ownerType).toBeDefined();
      expect(createTask?.inputSchema.properties?.kind).toBeDefined();
      expect(listRequestedReadyTasks?.description).toContain("explicitly requested");
      expect(capture?.description).toContain("accepted note directly");
      expect(ask?.annotations?.readOnlyHint).toBe(true);
      expect(refreshFocusSummary?.description).toContain("Generate and store");
      expect(recordEntityReview?.description).toContain("Record a review of an accepted Skippy entity");
      expect(markTaskInProgress?.description).toContain("when a harness starts working");
      expect(dispatchNotifications?.description).toContain("Use dryRun first");
      expect(captureThought?.description).toContain("second-brain memory");
      expect(captureThought?.inputSchema.properties?.sourceRefs).toBeDefined();
      expect(recordMemory?.inputSchema.properties?.rubricDecision).toBeDefined();
      expect(recordDecision?.description).toContain("durable decision memory");
      expect(recordPrinciple?.description).toContain("operating principle");
      expect(submitMemoryReviewCandidate?.description).toContain("Queue a possible memory");
      expect(listMemory?.annotations?.readOnlyHint).toBe(true);
      expect(getContextBundle?.description).toContain("context bundle");
      expect(getContextBundle?.inputSchema.properties?.relatedEntityRefs).toBeDefined();
      expect(getMemoryDetail?.description).toContain("memory detail");
      expect(linkMemory?.inputSchema.properties?.confidence).toBeDefined();
      expect(listInterviewTemplates?.description).toContain("assistantDisplayName");
      expect(startInterview?.description).toContain("one question at a time in chat");
      expect(answerInterviewQuestion?.description).toContain("current interview question");
      expect(completeInterview?.description).toContain("Complete a guided interview");

      const prompts = await client.listPrompts();
      expect(prompts.prompts.find((prompt) => prompt.name === "skippy_intro")?.description).toContain(
        "first connected",
      );
      expect(prompts.prompts.find((prompt) => prompt.name === "skippy_skills")?.description).toContain(
        "Portable harness instructions",
      );
      expect(prompts.prompts.find((prompt) => prompt.name === "skippy_slash_commands")?.description).toContain(
        "slash command",
      );

      const intro = await client.getPrompt({ name: "skippy_intro" });
      expect(intro.messages[0]?.content.type).toBe("text");
      if (intro.messages[0]?.content.type === "text") {
        expect(intro.messages[0].content.text).toContain("Hi, I'm Skippy");
        expect(intro.messages[0].content.text).toContain("http://127.0.0.1:3000");
      }

      const skills = await client.getPrompt({ name: "skippy_skills" });
      expect(skills.messages[0]?.content.type).toBe("text");
      if (skills.messages[0]?.content.type === "text") {
        expect(skills.messages[0].content.text).toContain("Skippy Harness Skills");
        expect(skills.messages[0].content.text).toContain("Retrieve before contextful work");
        expect(skills.messages[0].content.text).toContain("Run interviews in the harness chat");
        expect(skills.messages[0].content.text).toContain("Use `get_importance_rubric`");
        expect(skills.messages[0].content.text).toContain("/task ...");
        expect(skills.messages[0].content.text).toContain("mark_task_done");
      }

      const slashCommands = await client.getPrompt({ name: "skippy_slash_commands" });
      expect(slashCommands.messages[0]?.content.type).toBe("text");
      if (slashCommands.messages[0]?.content.type === "text") {
        expect(slashCommands.messages[0].content.text).toContain("Skippy Slash Commands");
        expect(slashCommands.messages[0].content.text).toContain("| `/task ...`");
        expect(slashCommands.messages[0].content.text).toContain("`mark_task_done`");
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

  it("returns chat-friendly confirmations for memory captures", async () => {
    const captureCalls: Array<{ brainInstanceId: string; input: unknown }> = [];
    const server = createMcpServer(
      createFakeClient({
        captureThought: async (brainInstanceId, input) => {
          captureCalls.push({ brainInstanceId, input });
          return {
            status: "captured",
            memoryId: "memory_123",
            kind: input.proposedKind ?? "memory",
            title: input.content ?? input.text,
            sourceRefIds: ["source_123"],
            confidence: input.confidence,
          };
        },
      }),
      "brain_123",
    );
    const client = new Client({ name: "memory-capture-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "capture_thought",
        arguments: {
          text: "I prefer terse status updates during rollouts.",
          proposedKind: "memory",
          captureReason: "Explicit preference stated by user.",
          confidence: 0.9,
          reviewBehavior: "auto",
          sourceRefs: [
            {
              sourceSystem: "codex",
              externalId: "thread_123",
              summary: "Preference from rollout thread.",
            },
          ],
        },
      });

      expect(captureCalls).toEqual([
        {
          brainInstanceId: "brain_123",
          input: {
            text: "I prefer terse status updates during rollouts.",
            content: "I prefer terse status updates during rollouts.",
            proposedKind: "memory",
            captureReason: "Explicit preference stated by user.",
            confidence: 0.9,
            reviewBehavior: "auto",
            createdBy: "skippy_mcp",
            sourceRefs: [
              {
                sourceSystem: "codex",
                externalId: "thread_123",
                summary: "Preference from rollout thread.",
              },
            ],
          },
        },
      ]);
      expect(textResult(result)).toMatchObject({
        status: "captured",
        entityType: "memory",
        memoryId: "memory_123",
        kind: "memory",
        title: "I prefer terse status updates during rollouts.",
        sourceRefIds: ["source_123"],
        confidence: 0.9,
        reviewBehavior: "auto",
        reviewUrl: "http://127.0.0.1:3000/memory",
        nextAction: "Memory updated in Skippy.",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns assistant-named chat interview prompts and next questions", async () => {
    const server = createMcpServer(
      createFakeClient({
        listInterviewTemplates: async () => ({
          assistantDisplayName: "Mabel",
          templates: [
            {
              kind: "project",
              title: "Project check-in",
              description: "Clarify scope, momentum, blockers, and next action.",
              questionCount: 4,
              suggestedPrompt: "Want to do a project interview for Mabel?",
            },
          ],
        }),
        startInterview: async () => ({
          interviewId: "interview_123",
          assistantDisplayName: "Mabel",
          currentQuestion: {
            id: "project_current_state",
            prompt: "What is the current state of this project?",
          },
          progress: { answered: 0, total: 4 },
          suggestedPrompt: "Want to do a project interview for Mabel?",
          reviewUrl: "/interviews/interview_123",
        }),
      }),
      "brain_123",
    );
    const client = new Client({ name: "interview-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const templates = textResult(await client.callTool({ name: "list_interview_templates", arguments: {} }));
      expect(templates).toMatchObject({
        assistantDisplayName: "Mabel",
        templates: [
          {
            suggestedPrompt: "Want to do a project interview for Mabel?",
          },
        ],
      });

      const started = textResult(
        await client.callTool({
          name: "start_interview",
          arguments: {
            kind: "project",
            subjectLabel: "Skippy MCP and APP",
            startedBy: "codex",
          },
        }),
      );
      expect(started).toMatchObject({
        status: "active",
        assistantDisplayName: "Mabel",
        suggestedPrompt: "Want to do a project interview for Mabel?",
        currentQuestion: {
          prompt: "What is the current state of this project?",
        },
        nextAction: "Ask this in the harness chat: What is the current state of this project?",
        reviewUrl: "http://127.0.0.1:3000/interviews/interview_123",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("wires context bundle retrieval to the backend", async () => {
    const bundleCalls: Array<{ brainInstanceId: string; input: unknown }> = [];
    const server = createMcpServer(
      createFakeClient({
        getContextBundle: async (brainInstanceId, input) => {
          bundleCalls.push({ brainInstanceId, input });
          return {
            query: input.query,
            memories: [{ memory: { _id: "memory_123", title: "Rollout preference" }, score: 12 }],
            entities: [{ ref: { entityType: "project", entityId: "project_123" }, title: "Skippy" }],
            sourceRefs: [{ _id: "source_123", sourceSystem: "codex" }],
          };
        },
      }),
      "brain_123",
    );
    const client = new Client({ name: "context-bundle-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "get_context_bundle",
        arguments: {
          query: " rollout preferences ",
          relatedEntityRefs: [{ entityType: "project", entityId: "project_123" }],
          memoryLimit: 5,
        },
      });

      expect(bundleCalls).toEqual([
        {
          brainInstanceId: "brain_123",
          input: {
            query: "rollout preferences",
            relatedEntityRefs: [{ entityType: "project", entityId: "project_123" }],
            memoryLimit: 5,
            entityLimit: 12,
            sourceLimit: 12,
          },
        },
      ]);
      expect(textResult(result)).toMatchObject({
        query: "rollout preferences",
        memories: [{ memory: { _id: "memory_123", title: "Rollout preference" }, score: 12 }],
        entities: [{ ref: { entityType: "project", entityId: "project_123" }, title: "Skippy" }],
        sourceRefs: [{ _id: "source_123", sourceSystem: "codex" }],
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
