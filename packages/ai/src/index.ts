import type { EntityRef, FocusSummary, LlmProviderMode } from "@skippy/shared";

export type { LlmProviderMode };

export type EmbeddingProviderMode = "none" | "openai" | "local" | (string & {});

export type AiProviderConfig = {
  mode: LlmProviderMode;
  routineModel?: string;
  synthesisModel?: string;
  embeddingProvider?: EmbeddingProviderMode;
  embeddingModel?: string;
};

export type AiClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export type AiUsageRecord = {
  provider: Exclude<LlmProviderMode, "none"> | (string & {});
  model: string;
  policyVersion?: string;
  usedFor: string;
  timestamp: number;
  estimatedCostUsd?: number;
};

export type SynthesisContextItem = {
  entityRef?: EntityRef;
  title: string;
  summary?: string;
  reason?: string;
};

export type SynthesisRequest = {
  query: string;
  context: SynthesisContextItem[];
  policyVersion?: string;
};

export type SynthesisResult = {
  answer: string;
  citedItems: SynthesisContextItem[];
  usage?: AiUsageRecord;
};

export type FocusSummaryRequest = {
  items: SynthesisContextItem[];
  generatedAt: number;
  policyVersion?: string;
};

export type EmbeddingRequest = {
  entityRef: EntityRef;
  text: string;
  textHash: string;
};

export type EmbeddingResult = {
  embedding: number[];
  provider: Exclude<EmbeddingProviderMode, "none"> | (string & {});
  model: string;
};

export type LlmClient = {
  synthesize(request: SynthesisRequest): Promise<SynthesisResult>;
  generateFocusSummary(request: FocusSummaryRequest): Promise<FocusSummary>;
};

export type EmbeddingClient = {
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
  embedMany?(requests: EmbeddingRequest[]): Promise<EmbeddingResult[]>;
};

export const DEFAULT_AI_PROVIDER_CONFIG: AiProviderConfig = {
  mode: "none",
  embeddingProvider: "none",
};

export const DEFAULT_OPENAI_SYNTHESIS_MODEL = "gpt-5.2";
export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_ANTHROPIC_SYNTHESIS_MODEL = "claude-sonnet-4-20250514";
export const DEFAULT_OPENROUTER_SYNTHESIS_MODEL = "openai/gpt-4.1-mini";
export const DEFAULT_LOCAL_SYNTHESIS_MODEL = "local-model";

function getEnvironmentValue(name: string): string | undefined {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return maybeProcess.process?.env?.[name];
}

function getApiKey(providerName: string, envNames: string[], options?: AiClientOptions) {
  const apiKey = options?.apiKey ?? envNames.map((name) => getEnvironmentValue(name)).find(Boolean);
  if (!apiKey) {
    throw new Error(`${envNames[0]} is required for ${providerName} AI provider`);
  }
  return apiKey;
}

function getFetch(options?: AiClientOptions) {
  return options?.fetch ?? fetch;
}

function getBaseUrl(providerName: string, envNames: string[], fallback?: string, options?: AiClientOptions) {
  const baseUrl = options?.baseUrl ?? envNames.map((name) => getEnvironmentValue(name)).find(Boolean) ?? fallback;
  if (!baseUrl) {
    throw new Error(`${envNames[0]} is required for ${providerName} AI provider`);
  }
  return baseUrl.replace(/\/$/, "");
}

async function parseJsonResponse(response: Response, providerName = "AI provider") {
  const text = await response.text();
  const json = text ? (JSON.parse(text) as Record<string, any>) : {};
  if (!response.ok) {
    const message =
      json.error?.message ??
      json.error?.error?.message ??
      `${providerName} API request failed with status ${response.status}`;
    throw new Error(message);
  }
  return json;
}

function contextText(items: SynthesisContextItem[]) {
  return items
    .map((item, index) =>
      [
        `${index + 1}. ${item.title}`,
        item.entityRef ? `Entity: ${item.entityRef.entityType}:${item.entityRef.entityId}` : undefined,
        item.summary ? `Summary: ${item.summary}` : undefined,
        item.reason ? `Reason: ${item.reason}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

function outputText(json: Record<string, any>): string {
  if (typeof json.output_text === "string") {
    return json.output_text;
  }

  if (!Array.isArray(json.output)) {
    return "";
  }

  return json.output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((content) => (typeof content.text === "string" ? content.text : ""))
    .filter(Boolean)
    .join("\n");
}

function anthropicOutputText(json: Record<string, any>): string {
  if (!Array.isArray(json.content)) {
    return "";
  }

  return json.content
    .map((content) => (content?.type === "text" && typeof content.text === "string" ? content.text : ""))
    .filter(Boolean)
    .join("\n");
}

function chatCompletionOutputText(json: Record<string, any>): string {
  const content = json.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function topItemsForFocus(request: FocusSummaryRequest) {
  return request.items
    .filter((item) => item.entityRef)
    .slice(0, 5)
    .map((item) => ({
      entityRef: item.entityRef as EntityRef,
      reason: item.reason ?? item.summary ?? "Relevant context item.",
    }));
}

export function createOpenAiLlmClient(config: AiProviderConfig, options?: AiClientOptions): LlmClient {
  const model = config.synthesisModel ?? config.routineModel ?? DEFAULT_OPENAI_SYNTHESIS_MODEL;
  const apiKey = getApiKey("OpenAI", ["OPENAI_API_KEY"], options);
  const fetchImpl = getFetch(options);

  return {
    async synthesize(request) {
      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          instructions:
            "You are Skippy's internal synthesis layer. Answer from the supplied Skippy context only. If context is insufficient, say what is missing. Keep answers concise and cite the relevant item titles.",
          input: [
            {
              role: "user",
              content: `Question: ${request.query}\n\nSkippy context:\n${contextText(request.context) || "No context available."}`,
            },
          ],
        }),
      });
      const json = await parseJsonResponse(response, "OpenAI");

      const usage: AiUsageRecord = {
        provider: "openai",
        model,
        usedFor: "synthesis",
        timestamp: Date.now(),
      };
      if (request.policyVersion) {
        usage.policyVersion = request.policyVersion;
      }

      return {
        answer: outputText(json),
        citedItems: request.context.slice(0, 10),
        usage,
      };
    },

    async generateFocusSummary(request) {
      const topItems = topItemsForFocus(request);

      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          instructions:
            "Write a concise Skippy focus summary using only the supplied context. Return 3-5 short markdown bullet lines. Put the most important next move first, then supporting items. Do not produce a roadmap or paragraph.",
          input: contextText(request.items) || "No context available.",
        }),
      });
      const json = await parseJsonResponse(response, "OpenAI");
      const summary: FocusSummary = {
        generatedAt: request.generatedAt,
        summaryText: outputText(json),
        topItems,
      };

      if (request.policyVersion) {
        summary.policyVersion = request.policyVersion;
      }

      return summary;
    },
  };
}

export function createAnthropicLlmClient(config: AiProviderConfig, options?: AiClientOptions): LlmClient {
  const model = config.synthesisModel ?? config.routineModel ?? DEFAULT_ANTHROPIC_SYNTHESIS_MODEL;
  const apiKey = getApiKey("Anthropic", ["ANTHROPIC_API_KEY"], options);
  const fetchImpl = getFetch(options);

  async function createMessage(system: string, content: string, usedFor: string, policyVersion?: string) {
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        system,
        messages: [{ role: "user", content }],
      }),
    });
    const json = await parseJsonResponse(response, "Anthropic");
    const usage: AiUsageRecord = {
      provider: "anthropic",
      model,
      usedFor,
      timestamp: Date.now(),
    };
    if (policyVersion) {
      usage.policyVersion = policyVersion;
    }
    return { text: anthropicOutputText(json), usage };
  }

  return {
    async synthesize(request) {
      const result = await createMessage(
        "You are Skippy's internal synthesis layer. Answer from the supplied Skippy context only. If context is insufficient, say what is missing. Keep answers concise and cite the relevant item titles.",
        `Question: ${request.query}\n\nSkippy context:\n${contextText(request.context) || "No context available."}`,
        "synthesis",
        request.policyVersion,
      );

      return {
        answer: result.text,
        citedItems: request.context.slice(0, 10),
        usage: result.usage,
      };
    },

    async generateFocusSummary(request) {
      const result = await createMessage(
        "Write a concise Skippy focus summary using only the supplied context. Return 3-5 short markdown bullet lines. Put the most important next move first, then supporting items. Do not produce a roadmap or paragraph.",
        contextText(request.items) || "No context available.",
        "focus_summary",
        request.policyVersion,
      );
      const summary: FocusSummary = {
        generatedAt: request.generatedAt,
        summaryText: result.text,
        topItems: topItemsForFocus(request),
      };
      if (request.policyVersion) {
        summary.policyVersion = request.policyVersion;
      }
      return summary;
    },
  };
}

function createChatCompletionLlmClient({
  provider,
  endpoint,
  model,
  headers,
  fetchImpl,
}: {
  provider: Exclude<LlmProviderMode, "none">;
  endpoint: string;
  model: string;
  headers: Record<string, string>;
  fetchImpl: typeof fetch;
}): LlmClient {
  async function createChat(system: string, content: string, usedFor: string, policyVersion?: string) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
        max_tokens: 700,
      }),
    });
    const json = await parseJsonResponse(response, provider);
    const usage: AiUsageRecord = {
      provider,
      model: typeof json.model === "string" ? json.model : model,
      usedFor,
      timestamp: Date.now(),
    };
    if (policyVersion) {
      usage.policyVersion = policyVersion;
    }
    return { text: chatCompletionOutputText(json), usage };
  }

  return {
    async synthesize(request) {
      const result = await createChat(
        "You are Skippy's internal synthesis layer. Answer from the supplied Skippy context only. If context is insufficient, say what is missing. Keep answers concise and cite the relevant item titles.",
        `Question: ${request.query}\n\nSkippy context:\n${contextText(request.context) || "No context available."}`,
        "synthesis",
        request.policyVersion,
      );
      return {
        answer: result.text,
        citedItems: request.context.slice(0, 10),
        usage: result.usage,
      };
    },

    async generateFocusSummary(request) {
      const result = await createChat(
        "Write a concise Skippy focus summary using only the supplied context. Return 3-5 short markdown bullet lines. Put the most important next move first, then supporting items. Do not produce a roadmap or paragraph.",
        contextText(request.items) || "No context available.",
        "focus_summary",
        request.policyVersion,
      );
      const summary: FocusSummary = {
        generatedAt: request.generatedAt,
        summaryText: result.text,
        topItems: topItemsForFocus(request),
      };
      if (request.policyVersion) {
        summary.policyVersion = request.policyVersion;
      }
      return summary;
    },
  };
}

export function createOpenRouterLlmClient(config: AiProviderConfig, options?: AiClientOptions): LlmClient {
  const model = config.synthesisModel ?? config.routineModel ?? DEFAULT_OPENROUTER_SYNTHESIS_MODEL;
  const apiKey = getApiKey("OpenRouter", ["OPENROUTER_API_KEY"], options);
  return createChatCompletionLlmClient({
    provider: "openrouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model,
    headers: { Authorization: `Bearer ${apiKey}` },
    fetchImpl: getFetch(options),
  });
}

export function createLocalLlmClient(config: AiProviderConfig, options?: AiClientOptions): LlmClient {
  const model = config.synthesisModel ?? config.routineModel ?? DEFAULT_LOCAL_SYNTHESIS_MODEL;
  const baseUrl = getBaseUrl(
    "local",
    ["SKIPPY_LOCAL_AI_BASE_URL", "LOCAL_AI_BASE_URL"],
    undefined,
    options,
  );
  const apiKey = options?.apiKey ?? getEnvironmentValue("SKIPPY_LOCAL_AI_API_KEY") ?? getEnvironmentValue("LOCAL_AI_API_KEY");
  return createChatCompletionLlmClient({
    provider: "local",
    endpoint: `${baseUrl}/chat/completions`,
    model,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    fetchImpl: getFetch(options),
  });
}

export function createOpenAiEmbeddingClient(config: AiProviderConfig, options?: AiClientOptions): EmbeddingClient {
  const model = config.embeddingModel ?? DEFAULT_OPENAI_EMBEDDING_MODEL;
  const apiKey = getApiKey("OpenAI", ["OPENAI_API_KEY"], options);
  const fetchImpl = getFetch(options);

  async function requestEmbeddings(input: string[]) {
    const response = await fetchImpl("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input,
        encoding_format: "float",
      }),
    });
    const json = await parseJsonResponse(response, "OpenAI");
    const embeddings = Array.isArray(json.data)
      ? json.data.map((item) => item.embedding)
      : [];
    if (
      embeddings.length !== input.length ||
      !embeddings.every((embedding) => Array.isArray(embedding) && embedding.every((value) => typeof value === "number"))
    ) {
      throw new Error("OpenAI embeddings response did not include numeric embeddings");
    }

    return embeddings as number[][];
  }

  return {
    async embed(request) {
      const [embedding] = await requestEmbeddings([request.text]);
      if (!embedding) {
        throw new Error("OpenAI embeddings response did not include a numeric embedding");
      }

      return {
        embedding,
        provider: "openai",
        model,
      };
    },

    async embedMany(requests) {
      if (requests.length === 0) {
        return [];
      }

      const embeddings = await requestEmbeddings(requests.map((request) => request.text));
      return embeddings.map((embedding) => ({
        embedding,
        provider: "openai",
        model,
      }));
    },
  };
}

export function createDisabledLlmClient(): LlmClient {
  return {
    async synthesize(request) {
      return {
        answer:
          "Internal Skippy synthesis is disabled. Use the returned context items with the external harness model.",
        citedItems: request.context,
      };
    },
    async generateFocusSummary(request) {
      const summary: FocusSummary = {
        generatedAt: request.generatedAt,
        summaryText:
          "Internal Skippy focus synthesis is disabled. A harness should submit a generated focus summary.",
        topItems: request.items
          .filter((item) => item.entityRef)
          .slice(0, 5)
          .map((item) => ({
            entityRef: item.entityRef as EntityRef,
            reason: item.reason ?? item.summary ?? "Relevant context item.",
          })),
      };

      if (request.policyVersion) {
        summary.policyVersion = request.policyVersion;
      }

      return summary;
    },
  };
}

export function createDisabledEmbeddingClient(): EmbeddingClient {
  return {
    async embed() {
      throw new Error("Embeddings are disabled for this brain instance");
    },
  };
}

export function createLlmClient(config: AiProviderConfig, options?: AiClientOptions): LlmClient {
  if (config.mode === "none") {
    return createDisabledLlmClient();
  }

  if (config.mode === "openai") {
    return createOpenAiLlmClient(config, options);
  }

  if (config.mode === "anthropic") {
    return createAnthropicLlmClient(config, options);
  }

  if (config.mode === "openrouter") {
    return createOpenRouterLlmClient(config, options);
  }

  if (config.mode === "local") {
    return createLocalLlmClient(config, options);
  }

  throw new Error(`LLM provider '${config.mode}' is configured but no provider adapter is installed yet`);
}

export function createEmbeddingClient(config: AiProviderConfig, options?: AiClientOptions): EmbeddingClient {
  if (!config.embeddingProvider || config.embeddingProvider === "none") {
    return createDisabledEmbeddingClient();
  }

  if (config.embeddingProvider === "openai") {
    return createOpenAiEmbeddingClient(config, options);
  }

  throw new Error(
    `Embedding provider '${config.embeddingProvider}' is configured but no provider adapter is installed yet`,
  );
}
