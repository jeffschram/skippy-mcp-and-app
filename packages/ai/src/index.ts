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
};

export const DEFAULT_AI_PROVIDER_CONFIG: AiProviderConfig = {
  mode: "none",
  embeddingProvider: "none",
};

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

export function createLlmClient(config: AiProviderConfig): LlmClient {
  if (config.mode === "none") {
    return createDisabledLlmClient();
  }

  throw new Error(`LLM provider '${config.mode}' is configured but no provider adapter is installed yet`);
}

export function createEmbeddingClient(config: AiProviderConfig): EmbeddingClient {
  if (!config.embeddingProvider || config.embeddingProvider === "none") {
    return createDisabledEmbeddingClient();
  }

  throw new Error(
    `Embedding provider '${config.embeddingProvider}' is configured but no provider adapter is installed yet`,
  );
}
