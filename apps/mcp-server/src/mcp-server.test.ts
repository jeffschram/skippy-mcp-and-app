import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "./mcp-server";
import type { SkippyClient } from "./tools";

function createFakeClient(): SkippyClient {
  return {
    submitCandidateObject: async () => ({ triageItemId: "triage_123", sourceRefIds: ["source_123"] }),
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
    upsertFocusSummary: async () => ({ ok: true }),
    listPendingActions: async () => [],
    markTaskDone: async (_brainInstanceId, taskId) => ({ taskId }),
    recordPendingActionResult: async () => ({ ok: true }),
    recordIngestionRun: async () => ({ ok: true }),
  };
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
  it("teaches harnesses the Skippy triage-first workflow", async () => {
    const server = createMcpServer(createFakeClient(), "brain_123");
    const client = new Client({ name: "manifest-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      expect(client.getInstructions()).toContain("triage-safe writes");

      const { tools } = await client.listTools();
      const submitCandidate = tools.find((tool) => tool.name === "submit_candidate_object");
      const createTask = tools.find((tool) => tool.name === "create_task");
      const capture = tools.find((tool) => tool.name === "capture");
      const ask = tools.find((tool) => tool.name === "ask");

      expect(submitCandidate?.description).toContain("Primary ingestion tool");
      expect(submitCandidate?.description).toContain("Do not use it to mark knowledge accepted");
      expect(submitCandidate?.inputSchema.properties?.reviewReason).toBeDefined();
      expect(createTask?.description).toContain("only when the user explicitly asks");
      expect(capture?.description).toContain("Creates a note candidate in triage");
      expect(ask?.annotations?.readOnlyHint).toBe(true);

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

  it("returns chat-friendly confirmations for triage candidate submissions", async () => {
    const server = createMcpServer(createFakeClient(), "brain_123");
    const client = new Client({ name: "confirmation-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "submit_candidate_object",
        arguments: {
          candidateEntityType: "task",
          candidatePayload: { title: "Fix schema mapping", dueDate: "2026-06-10" },
          confidence: 0.9,
        },
      });

      expect(textResult(result)).toMatchObject({
        status: "submitted_for_review",
        entityType: "task",
        title: "Fix schema mapping",
        triageItemId: "triage_123",
        reviewUrl: "http://127.0.0.1:3000/triage",
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
});
