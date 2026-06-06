import { describe, expect, it } from "vitest";
import { createDisabledEmbeddingClient, createDisabledLlmClient, createLlmClient } from "./index";

describe("AI provider abstractions", () => {
  it("returns structured context when synthesis is disabled", async () => {
    const client = createDisabledLlmClient();
    const result = await client.synthesize({
      query: "What matters?",
      context: [{ title: "Task", summary: "A useful task" }],
    });

    expect(result.answer).toContain("disabled");
    expect(result.citedItems).toHaveLength(1);
  });

  it("throws explicit errors for unimplemented live providers", () => {
    expect(() => createLlmClient({ mode: "openai" })).toThrow("no provider adapter");
  });

  it("keeps embeddings explicitly disabled", async () => {
    await expect(
      createDisabledEmbeddingClient().embed({
        entityRef: { entityType: "task", entityId: "task_123" },
        text: "Call Pat",
        textHash: "hash",
      }),
    ).rejects.toThrow("Embeddings are disabled");
  });
});
