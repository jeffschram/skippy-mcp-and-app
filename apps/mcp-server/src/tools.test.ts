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
      upsertFocusSummary: (brainInstanceId, summary) => record("upsertFocusSummary", brainInstanceId, summary),
      listPendingActions: (brainInstanceId, status) => record("listPendingActions", brainInstanceId, status),
      markTaskDone: (brainInstanceId, taskId, completedBy, externalReminderSourceRefId) =>
        record("markTaskDone", brainInstanceId, taskId, completedBy, externalReminderSourceRefId),
      recordPendingActionResult: (pendingActionId, result) =>
        record("recordPendingActionResult", pendingActionId, result),
      recordIngestionRun: (brainInstanceId, run) => record("recordIngestionRun", brainInstanceId, run),
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
});
