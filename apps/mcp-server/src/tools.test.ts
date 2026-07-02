import { describe, expect, it } from "vitest";
import type { SkippyClient } from "./tools";
import { createSkippyToolHandlers } from "./tools";

function createFakeClient(): { client: SkippyClient; calls: Array<{ name: string; args: unknown[] }> } {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const record = async (name: string, ...args: unknown[]) => {
    calls.push({ name, args });
    return { ok: true, name };
  };

  return {
    calls,
    client: {
      submitCandidateObject: (brainInstanceId, input) =>
        record("submitCandidateObject", brainInstanceId, input),
      ingestObject: (brainInstanceId, input) => record("ingestObject", brainInstanceId, input),
      createProjectDirect: (brainInstanceId, input) => record("createProjectDirect", brainInstanceId, input),
      createTaskDirect: (brainInstanceId, input) => record("createTaskDirect", brainInstanceId, input),
      addSourceRef: (brainInstanceId, sourceRef) => record("addSourceRef", brainInstanceId, sourceRef),
      linkEntities: (brainInstanceId, relationship) => record("linkEntities", brainInstanceId, relationship),
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
      upsertEntityEmbedding: (brainInstanceId, embedding) =>
        record("upsertEntityEmbedding", brainInstanceId, embedding),
      upsertFocusSummary: (brainInstanceId, summary) => record("upsertFocusSummary", brainInstanceId, summary),
      listPendingActions: (brainInstanceId, status) => record("listPendingActions", brainInstanceId, status),
      markTaskInProgress: (brainInstanceId, taskId, startedBy) =>
        record("markTaskInProgress", brainInstanceId, taskId, startedBy),
      markTaskDone: (brainInstanceId, taskId, completedBy, externalReminderSourceRefId) =>
        record("markTaskDone", brainInstanceId, taskId, completedBy, externalReminderSourceRefId),
      recordPendingActionResult: (pendingActionId, result) =>
        record("recordPendingActionResult", pendingActionId, result),
      recordEntityReview: (brainInstanceId, review) =>
        record("recordEntityReview", brainInstanceId, review),
      getCurrentContext: (brainInstanceId) => record("getCurrentContext", brainInstanceId),
      planProject: (brainInstanceId, input) => record("planProject", brainInstanceId, input),
      listReadyTasks: (brainInstanceId, input) => record("listReadyTasks", brainInstanceId, input),
      listRequestedReadyTasks: (brainInstanceId, input) => record("listRequestedReadyTasks", brainInstanceId, input),
      getTaskBrief: (brainInstanceId, input) => record("getTaskBrief", brainInstanceId, input),
      briefTask: (brainInstanceId, input) => record("briefTask", brainInstanceId, input),
      recordTaskResult: (brainInstanceId, input) => record("recordTaskResult", brainInstanceId, input),
      captureThought: (brainInstanceId, input) => record("captureThought", brainInstanceId, input),
      recordMemory: (brainInstanceId, input) => record("recordMemory", brainInstanceId, input),
      submitMemoryReviewCandidate: (brainInstanceId, input) =>
        record("submitMemoryReviewCandidate", brainInstanceId, input),
      listMemory: (brainInstanceId, input) => record("listMemory", brainInstanceId, input),
      getContextBundle: (brainInstanceId, input) => record("getContextBundle", brainInstanceId, input),
      getMemoryDetail: (brainInstanceId, input) => record("getMemoryDetail", brainInstanceId, input),
      linkMemory: (brainInstanceId, input) => record("linkMemory", brainInstanceId, input),
      listInterviewTemplates: (brainInstanceId) => record("listInterviewTemplates", brainInstanceId),
      listInterviews: (brainInstanceId, input) => record("listInterviews", brainInstanceId, input),
      startInterview: (brainInstanceId, input) => record("startInterview", brainInstanceId, input),
      getInterview: (brainInstanceId, input) => record("getInterview", brainInstanceId, input),
      answerInterviewQuestion: (brainInstanceId, input) => record("answerInterviewQuestion", brainInstanceId, input),
      completeInterview: (brainInstanceId, input) => record("completeInterview", brainInstanceId, input),
      archiveInterview: (brainInstanceId, input) => record("archiveInterview", brainInstanceId, input),
      recordIngestionRun: (brainInstanceId, run) => record("recordIngestionRun", brainInstanceId, run),
      updateSourceSyncStatus: (brainInstanceId, status) => record("updateSourceSyncStatus", brainInstanceId, status),
      getOperatingRules: (brainInstanceId, scope) => record("getOperatingRules", brainInstanceId, scope),
      getEffectiveRubric: (brainInstanceId) => record("getEffectiveRubric", brainInstanceId),
      getNotificationDispatchContext: (brainInstanceId) => record("getNotificationDispatchContext", brainInstanceId),
      recordNotificationDelivery: (brainInstanceId, delivery) =>
        record("recordNotificationDelivery", brainInstanceId, delivery),
      getSkill: (brainInstanceId, input) => record("getSkill", brainInstanceId, input),
    },
  };
}

describe("Skippy MCP tool handlers", () => {
  it("captures natural language as an accepted note", async () => {
    const { client, calls } = createFakeClient();
    const tools = createSkippyToolHandlers(client, "brain_123");

    await tools.capture({ text: "  Remember this thought  " });

    expect(calls[0]).toMatchObject({
      name: "ingestObject",
      args: [
        "brain_123",
        {
          candidateEntityType: "note",
          candidatePayload: { body: "Remember this thought" },
          rubricDecision: "Explicit user capture request.",
        },
      ],
    });
  });

  it("normalizes structured candidate submissions", async () => {
    const { client, calls } = createFakeClient();
    const tools = createSkippyToolHandlers(client, "brain_123");

    await tools.submitCandidateObject({
      candidateEntityType: "task",
      candidatePayload: { title: "  Call Pat  " },
      confidence: 0.8,
    });

    expect(calls[0]?.args[1]).toMatchObject({
      candidatePayload: { title: "Call Pat" },
      confidence: 0.8,
    });
  });

  it("ingests accepted objects with rubric decisions", async () => {
    const { client, calls } = createFakeClient();
    const tools = createSkippyToolHandlers(client, "brain_123");

    await tools.ingestObject({
      candidateEntityType: "task",
      candidatePayload: { title: "  Pay bill  " },
      rubricDecision: "Money-related task with a concrete obligation.",
    });

    expect(calls[0]).toMatchObject({
      name: "ingestObject",
      args: [
        "brain_123",
        {
          candidateEntityType: "task",
          candidatePayload: { title: "Pay bill" },
          rubricDecision: "Money-related task with a concrete obligation.",
        },
      ],
    });
  });

  it("creates direct accepted tasks for explicit user commands", async () => {
    const { client, calls } = createFakeClient();
    const tools = createSkippyToolHandlers(client, "brain_123");

    await tools.createTaskDirect({
      title: "  Ship direct create path  ",
      projectId: "project_123",
      ownerType: "agent",
      kind: "review",
    });

    expect(calls[0]).toMatchObject({
      name: "createTaskDirect",
      args: [
        "brain_123",
        {
          title: "Ship direct create path",
          projectId: "project_123",
          ownerType: "agent",
          kind: "review",
          createdBy: "skippy_mcp",
        },
      ],
    });
  });

  it("briefs proposed tasks with harness attribution", async () => {
    const { client, calls } = createFakeClient();
    const tools = createSkippyToolHandlers(client, "brain_123");

    await tools.briefTask({
      taskId: "task_123",
      executionBrief: "  Implement the endpoint following existing patterns.  ",
      acceptanceCriteria: ["The endpoint validates ownership."],
      kind: "coding",
    });

    expect(calls[0]).toMatchObject({
      name: "briefTask",
      args: [
        "brain_123",
        {
          taskId: "task_123",
          executionBrief: "Implement the endpoint following existing patterns.",
          acceptanceCriteria: ["The endpoint validates ownership."],
          kind: "coding",
          actorId: "skippy_mcp",
        },
      ],
    });
  });

  it("marks tasks in progress when harnesses start work", async () => {
    const { client, calls } = createFakeClient();
    const tools = createSkippyToolHandlers(client, "brain_123");

    await tools.markTaskInProgress({
      taskId: "task_123",
      startedBy: "codex",
    });

    expect(calls[0]).toMatchObject({
      name: "markTaskInProgress",
      args: ["brain_123", "task_123", "codex"],
    });
  });

  it("keeps harness completion labels out of Convex user id fields", async () => {
    const { client, calls } = createFakeClient();
    const tools = createSkippyToolHandlers(client, "brain_123");

    await tools.markTaskDone({
      taskId: "task_123",
      completedBy: "codex",
    });

    expect(calls[0]).toMatchObject({
      name: "markTaskDone",
      args: ["brain_123", "task_123", undefined, undefined],
    });

    await tools.markTaskDone({
      taskId: "task_456",
      completedByUserId: "user_123",
    });

    expect(calls[1]).toMatchObject({
      name: "markTaskDone",
      args: ["brain_123", "task_456", "user_123", undefined],
    });
  });

  it("does not generate focus summaries when internal AI is disabled", async () => {
    const { client } = createFakeClient();
    const tools = createSkippyToolHandlers(client, "brain_123");

    await expect(tools.refreshFocusSummary()).resolves.toMatchObject({
      status: "not_configured",
      message: expect.stringContaining("llmProviderMode=openai"),
    });
  });

  it("derives email deep links for focus context items from gmail source refs", async () => {
    const { client } = createFakeClient();
    const tools = createSkippyToolHandlers(
      {
        ...client,
        getAiContext: async () => ({
          config: { llmProviderMode: "none" },
          tasks: [
            {
              _id: "task_1",
              title: "Reply to Chase statement email",
              status: "todo",
              sourceRefs: [{ sourceSystem: "gmail", messageId: "18f2c3a" }],
            },
            {
              _id: "task_2",
              title: "Review deep-linked email",
              status: "todo",
              sourceRefs: [
                { sourceSystem: "gmail", messageId: "18f2c3b", deepLink: "https://mail.google.com/mail/u/0/#inbox/18f2c3b" },
              ],
            },
            { _id: "task_3", title: "No email source", status: "todo" },
          ],
        }),
      },
      "brain_123",
    );

    const result = (await tools.refreshFocusSummary()) as {
      contextItems?: Array<{ title: string; emailLink?: string }>;
    };
    const emailLinkFor = (title: string) => result.contextItems?.find((item) => item.title === title)?.emailLink;

    expect(emailLinkFor("Reply to Chase statement email")).toBe("https://mail.google.com/mail/u/0/#all/18f2c3a");
    expect(emailLinkFor("Review deep-linked email")).toBe("https://mail.google.com/mail/u/0/#inbox/18f2c3b");
    expect(emailLinkFor("No email source")).toBeUndefined();
  });

  it("excludes focus-snoozed entities from focus context until the snooze expires", async () => {
    const { client } = createFakeClient();
    const tools = createSkippyToolHandlers(
      {
        ...client,
        getAiContext: async () => ({
          config: { llmProviderMode: "none" },
          tasks: [
            { _id: "task_snoozed", title: "Snoozed task", status: "todo", focusSnoozedUntil: Date.now() + 60_000 },
            { _id: "task_expired", title: "Expired snooze task", status: "todo", focusSnoozedUntil: Date.now() - 60_000 },
            { _id: "task_active", title: "Active task", status: "todo" },
          ],
        }),
      },
      "brain_123",
    );

    const result = (await tools.refreshFocusSummary()) as { contextItems?: Array<{ title: string }> };
    const titles = (result.contextItems ?? []).map((item) => item.title);

    expect(titles).not.toContain("Snoozed task");
    expect(titles).toContain("Expired snooze task");
    expect(titles).toContain("Active task");
  });

  it("surfaces recently dismissed focus items for harness generation when internal AI is disabled", async () => {
    const { client } = createFakeClient();
    const tools = createSkippyToolHandlers(
      {
        ...client,
        getAiContext: async () => ({
          config: { llmProviderMode: "none" },
          recentFocusDismissals: [
            { itemKey: "review-the-chase-statement-email", itemText: "Review the Chase statement email.", dismissedAt: 1780850000000 },
            { itemText: "  Renew the MGM+ trial decision.  " },
            { itemText: "" },
          ],
          tasks: [{ _id: "task_1", title: "Active task", status: "todo" }],
        }),
      },
      "brain_123",
    );

    await expect(tools.refreshFocusSummary()).resolves.toMatchObject({
      status: "not_configured",
      recentlyDismissedItems: [
        "Review the Chase statement email.",
        "Renew the MGM+ trial decision.",
      ],
    });
  });

  it("passes recently dismissed focus items into internal focus generation", async () => {
    const { client } = createFakeClient();
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          output: [{ type: "message", content: [{ type: "output_text", text: "- Monitor deployment." }] }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const previousApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    try {
      const tools = createSkippyToolHandlers(
        {
          ...client,
          getAiContext: async () => ({
            config: { llmProviderMode: "openai" },
            recentFocusDismissals: [{ itemText: "Review the Chase statement email." }],
            tasks: [{ _id: "task_1", title: "Deploy app", status: "todo" }],
          }),
        },
        "brain_123",
      );

      await expect(tools.refreshFocusSummary()).resolves.toMatchObject({ status: "generated" });
      const focusCall = calls.find((call) => call.url.includes("api.openai.com"));
      const body = JSON.parse(String(focusCall?.init.body));
      expect(body.input).toContain("Recently dismissed focus items");
      expect(body.input).toContain("- Review the Chase statement email.");
      expect(body.instructions).toContain("materially new");
    } finally {
      globalThis.fetch = originalFetch;
      if (previousApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousApiKey;
      }
    }
  });

  it("records accepted entity reviews with trimmed summaries", async () => {
    const { client, calls } = createFakeClient();
    const tools = createSkippyToolHandlers(client, "brain_123");

    await tools.recordEntityReview({
      entityRef: { entityType: "task", entityId: "task_123" },
      reviewType: "priority_update",
      reviewSummary: "  Task is now urgent  ",
      priorityScore: 0.9,
    });

    expect(calls[0]).toMatchObject({
      name: "recordEntityReview",
      args: [
        "brain_123",
        {
          entityRef: { entityType: "task", entityId: "task_123" },
          reviewType: "priority_update",
          reviewSummary: "Task is now urgent",
          priorityScore: 0.9,
          reviewedBy: "skippy_mcp",
        },
      ],
    });
  });

  it("captures memory thoughts with review behavior and provenance", async () => {
    const { client, calls } = createFakeClient();
    const tools = createSkippyToolHandlers(client, "brain_123");

    await tools.captureThought({
      text: "  I prefer concise implementation updates.  ",
      captureReason: "Explicit preference stated in chat.",
      confidence: 0.95,
      reviewBehavior: "auto",
      sourceRefs: [
        {
          sourceSystem: "codex",
          externalId: "thread_123",
          summary: "User preference from rollout thread.",
        },
      ],
    });

    expect(calls[0]).toMatchObject({
      name: "captureThought",
      args: [
        "brain_123",
        {
          text: "I prefer concise implementation updates.",
          content: "I prefer concise implementation updates.",
          proposedKind: "memory",
          captureReason: "Explicit preference stated in chat.",
          confidence: 0.95,
          reviewBehavior: "auto",
          createdBy: "skippy_mcp",
          sourceRefs: [
            {
              sourceSystem: "codex",
              externalId: "thread_123",
              summary: "User preference from rollout thread.",
            },
          ],
        },
      ],
    });
  });

  it("starts chat interviews with harness attribution", async () => {
    const { client, calls } = createFakeClient();
    const tools = createSkippyToolHandlers(client, "brain_123");

    await tools.startInterview({
      kind: "project",
      subjectLabel: "Skippy MCP and APP",
      startedBy: "codex",
    });

    expect(calls[0]).toMatchObject({
      name: "startInterview",
      args: [
        "brain_123",
        {
          kind: "project",
          subjectLabel: "Skippy MCP and APP",
          startedBy: "codex",
        },
      ],
    });
  });

  it("saves interview answers without creating memory candidates by default", async () => {
    const { client, calls } = createFakeClient();
    const tools = createSkippyToolHandlers(client, "brain_123");

    await tools.answerInterviewQuestion({
      interviewId: "interview_123",
      answerText: "  The project is ready for MCP interview tools.  ",
    });

    expect(calls[0]).toMatchObject({
      name: "answerInterviewQuestion",
      args: [
        "brain_123",
        {
          interviewId: "interview_123",
          answerText: "The project is ready for MCP interview tools.",
          answeredBy: "skippy_mcp",
        },
      ],
    });
    expect((calls[0]?.args[1] as { createMemoryCandidate?: boolean }).createMemoryCandidate).toBeUndefined();
  });

  it("normalizes memory search and context bundle retrieval", async () => {
    const { client, calls } = createFakeClient();
    const tools = createSkippyToolHandlers(client, "brain_123");

    await tools.listMemory({
      query: "  rollout preferences  ",
      kinds: ["memory"],
    });
    await tools.getContextBundle({
      query: "  rollout preferences  ",
      relatedEntityRefs: [{ entityType: "project", entityId: "project_123" }],
    });

    expect(calls[0]).toMatchObject({
      name: "listMemory",
      args: [
        "brain_123",
        {
          query: "rollout preferences",
          kinds: ["memory"],
          limit: 20,
        },
      ],
    });
    expect(calls[1]).toMatchObject({
      name: "getContextBundle",
      args: [
        "brain_123",
        {
          query: "rollout preferences",
          relatedEntityRefs: [{ entityType: "project", entityId: "project_123" }],
          memoryLimit: 8,
          entityLimit: 12,
          sourceLimit: 12,
        },
      ],
    });
  });

  it("previews notification dispatch candidates in dry run mode", async () => {
    const { client } = createFakeClient();
    client.getNotificationDispatchContext = async () => ({
      config: {
        notificationsEnabled: true,
        notificationPreferences: {
          urgentEnabled: true,
          pendingActionEnabled: true,
          minPriorityScore: 0.7,
        },
      },
      pushSubscriptions: [{ _id: "push_123", enabled: true }],
      tasks: [
        {
          _id: "task_123",
          title: "Ship notifications",
          status: "todo",
          priorityScore: 0.9,
          updatedAt: 1780850000000,
        },
      ],
      pendingActions: [
        {
          _id: "pending_123",
          actionType: "send_email",
          subject: "Approve follow-up",
          updatedAt: 1780850000000,
        },
      ],
      recentDeliveries: [],
    });
    const tools = createSkippyToolHandlers(client, "brain_123");

    await expect(tools.dispatchNotifications({ dryRun: true })).resolves.toMatchObject({
      status: "dry_run",
      candidateCount: 2,
      dispatchCount: 2,
      subscriptionCount: 1,
    });
  });
});
