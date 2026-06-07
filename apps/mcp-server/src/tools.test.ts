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
      recordIngestionRun: (brainInstanceId, run) => record("recordIngestionRun", brainInstanceId, run),
      getNotificationDispatchContext: (brainInstanceId) => record("getNotificationDispatchContext", brainInstanceId),
      recordNotificationDelivery: (brainInstanceId, delivery) =>
        record("recordNotificationDelivery", brainInstanceId, delivery),
    },
  };
}

describe("Skippy MCP tool handlers", () => {
  it("captures natural language as a suggested note candidate", async () => {
    const { client, calls } = createFakeClient();
    const tools = createSkippyToolHandlers(client, "brain_123");

    await tools.capture({ text: "  Remember this thought  " });

    expect(calls[0]).toMatchObject({
      name: "submitCandidateObject",
      args: [
        "brain_123",
        {
          candidateEntityType: "note",
          candidatePayload: { body: "Remember this thought" },
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

  it("creates direct accepted tasks for explicit user commands", async () => {
    const { client, calls } = createFakeClient();
    const tools = createSkippyToolHandlers(client, "brain_123");

    await tools.createTaskDirect({
      title: "  Ship direct create path  ",
      projectId: "project_123",
    });

    expect(calls[0]).toMatchObject({
      name: "createTaskDirect",
      args: [
        "brain_123",
        {
          title: "Ship direct create path",
          projectId: "project_123",
          createdBy: "skippy_mcp",
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
