import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANTHROPIC_SYNTHESIS_MODEL,
  DEFAULT_LOCAL_SYNTHESIS_MODEL,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  DEFAULT_OPENAI_SYNTHESIS_MODEL,
  DEFAULT_OPENROUTER_SYNTHESIS_MODEL,
  createDisabledEmbeddingClient,
  createDisabledLlmClient,
  createEmbeddingClient,
  createLlmClient,
} from "./index";

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

  it("requires an API key for OpenAI providers", () => {
    expect(() => createLlmClient({ mode: "openai" })).toThrow("OPENAI_API_KEY");
  });

  it("requires API keys for hosted non-OpenAI providers", () => {
    expect(() => createLlmClient({ mode: "anthropic" })).toThrow("ANTHROPIC_API_KEY");
    expect(() => createLlmClient({ mode: "openrouter" })).toThrow("OPENROUTER_API_KEY");
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

  it("calls OpenAI Responses API for synthesis", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          output: [{ type: "message", content: [{ type: "output_text", text: "Focus on deployment." }] }],
        }),
        { status: 200 },
      );
    };
    const client = createLlmClient(
      { mode: "openai" },
      { apiKey: "test-key", fetch: fetchMock as typeof fetch },
    );

    const result = await client.synthesize({
      query: "What matters?",
      context: [{ title: "Deploy app", summary: "Remote MCP is live." }],
    });

    expect(result.answer).toBe("Focus on deployment.");
    expect(result.usage?.model).toBe(DEFAULT_OPENAI_SYNTHESIS_MODEL);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/responses");
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("instructs focus summaries to omit standing context from Now", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          output: [{ type: "message", content: [{ type: "output_text", text: "- Monitor deployment." }] }],
        }),
        { status: 200 },
      );
    };
    const client = createLlmClient(
      { mode: "openai" },
      { apiKey: "test-key", fetch: fetchMock as typeof fetch },
    );

    await client.generateFocusSummary({
      generatedAt: 123,
      items: [{ title: "Jeff profile", summary: "Jeff is the primary user." }],
    });

    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.instructions).toContain("actionable next moves only");
    expect(body.instructions).toContain("standing context");
    expect(body.instructions).toContain("identity facts");
  });

  it("calls Anthropic Messages API for synthesis", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "Review the pending action." }],
        }),
        { status: 200 },
      );
    };
    const client = createLlmClient(
      { mode: "anthropic" },
      { apiKey: "test-key", fetch: fetchMock as typeof fetch },
    );

    const result = await client.synthesize({
      query: "What needs review?",
      context: [{ title: "Pending action", summary: "Needs approval." }],
    });

    expect(result.answer).toBe("Review the pending action.");
    expect(result.usage?.model).toBe(DEFAULT_ANTHROPIC_SYNTHESIS_MODEL);
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]?.init.headers).toMatchObject({
      "x-api-key": "test-key",
      "anthropic-version": "2023-06-01",
    });
  });

  it("calls OpenRouter chat completions for synthesis", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          model: "openai/gpt-4.1-mini",
          choices: [{ message: { role: "assistant", content: "Use semantic ranking." } }],
        }),
        { status: 200 },
      );
    };
    const client = createLlmClient(
      { mode: "openrouter" },
      { apiKey: "test-key", fetch: fetchMock as typeof fetch },
    );

    const result = await client.synthesize({
      query: "What matters?",
      context: [{ title: "Semantic ranking", summary: "Embeddings are configured." }],
    });

    expect(result.answer).toBe("Use semantic ranking.");
    expect(result.usage?.model).toBe(DEFAULT_OPENROUTER_SYNTHESIS_MODEL);
    expect(calls[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("calls a local OpenAI-compatible runtime when configured", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Local synthesis is online." } }],
        }),
        { status: 200 },
      );
    };
    const client = createLlmClient(
      { mode: "local" },
      { baseUrl: "http://127.0.0.1:11434/v1", fetch: fetchMock as typeof fetch },
    );

    const result = await client.synthesize({
      query: "Are you local?",
      context: [{ title: "Local runtime" }],
    });

    expect(result.answer).toBe("Local synthesis is online.");
    expect(result.usage?.model).toBe(DEFAULT_LOCAL_SYNTHESIS_MODEL);
    expect(calls[0]?.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
  });

  it("calls OpenAI embeddings API for embeddings", async () => {
    const fetchMock = async () =>
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200 });
    const client = createEmbeddingClient(
      { mode: "none", embeddingProvider: "openai" },
      { apiKey: "test-key", fetch: fetchMock as typeof fetch },
    );

    await expect(
      client.embed({
        entityRef: { entityType: "task", entityId: "task_123" },
        text: "Call Pat",
        textHash: "hash",
      }),
    ).resolves.toEqual({
      embedding: [0.1, 0.2, 0.3],
      provider: "openai",
      model: DEFAULT_OPENAI_EMBEDDING_MODEL,
    });
  });

  it("batches OpenAI embedding requests", async () => {
    const calls: RequestInit[] = [];
    const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
        }),
        { status: 200 },
      );
    };
    const client = createEmbeddingClient(
      { mode: "none", embeddingProvider: "openai" },
      { apiKey: "test-key", fetch: fetchMock as typeof fetch },
    );

    const result = await client.embedMany?.([
      {
        entityRef: { entityType: "task", entityId: "task_123" },
        text: "Call Pat",
        textHash: "hash-1",
      },
      {
        entityRef: { entityType: "project", entityId: "project_123" },
        text: "Launch Skippy",
        textHash: "hash-2",
      },
    ]);

    expect(JSON.parse(String(calls[0]?.body))).toMatchObject({ input: ["Call Pat", "Launch Skippy"] });
    expect(result?.map((item) => item.embedding)).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });
});
