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
  /** Deep link to the referenced source email (stored sourceRef deepLink or a Gmail URL built from its messageId). */
  emailLink?: string;
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

export type LlmCompletionRequest = {
  system: string;
  input: string;
  maxTokens?: number;
  usedFor?: string;
  policyVersion?: string;
};

export type LlmCompletionResult = {
  text: string;
  usage: AiUsageRecord;
};

export type LlmClient = {
  synthesize(request: SynthesisRequest): Promise<SynthesisResult>;
  generateFocusSummary(request: FocusSummaryRequest): Promise<FocusSummary>;
  /** Low-level single-turn completion used by higher-level workflows (e.g. project planning). */
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
};

/** One task drafted by automated project planning. `dependsOn` indexes earlier tasks in the list. */
export type ProjectPlanTaskDraft = {
  title: string;
  description?: string;
  kind?: "coding" | "review" | "research" | "design" | "manual" | "planning";
  acceptanceCriteria?: string[];
  executionBrief?: string;
  dependsOn?: number[];
};

export type ProjectPlanRequest = {
  projectTitle: string;
  projectSummary?: string;
  goals?: string[];
  existingTasks?: string[];
  notes?: string;
  maxTasks?: number;
  policyVersion?: string;
};

export type TaskBriefRequest = {
  projectTitle: string;
  projectSummary?: string;
  proposalTitle: string;
  proposalText: string;
  existingTasks?: string[];
  policyVersion?: string;
};

export type ProjectPlanResult = {
  summary: string;
  tasks: ProjectPlanTaskDraft[];
  usage?: AiUsageRecord;
};

export type TaskBriefResult = ProjectPlanTaskDraft & {
  usage?: AiUsageRecord;
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
const FOCUS_SUMMARY_INSTRUCTIONS =
  "Write a concise Skippy focus summary using only the supplied context. Start with exactly one line beginning with 'Summary:' that captures the overall theme of ALL the bullets in a single sentence (not just the first item). Then return 3-5 short markdown bullet lines. Use Now for actionable next moves only: concrete things the user or Skippy should monitor, review, decide, prepare, follow up on, or complete. Do not turn standing context, identity facts, relationships, user preferences, or assumptions into bullets; those belong in memory/topItems, not the Now action list. When a bullet references an email whose context item includes an 'Email link:' URL, format the email reference as a markdown link, e.g. [subject or sender](email-link-url), using that exact URL. Never invent, guess, or modify URLs; only use URLs present in the supplied context. If there are no clear actions, return exactly: Nothing new needs focus right now.";

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
        item.emailLink ? `Email link: ${item.emailLink}` : undefined,
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
          instructions: FOCUS_SUMMARY_INSTRUCTIONS,
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

    async complete(request) {
      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          instructions: request.system,
          input: request.input,
          ...(request.maxTokens ? { max_output_tokens: request.maxTokens } : {}),
        }),
      });
      const json = await parseJsonResponse(response, "OpenAI");
      const usage: AiUsageRecord = {
        provider: "openai",
        model,
        usedFor: request.usedFor ?? "completion",
        timestamp: Date.now(),
      };
      if (request.policyVersion) {
        usage.policyVersion = request.policyVersion;
      }
      return { text: outputText(json), usage };
    },
  };
}

export function createAnthropicLlmClient(config: AiProviderConfig, options?: AiClientOptions): LlmClient {
  const model = config.synthesisModel ?? config.routineModel ?? DEFAULT_ANTHROPIC_SYNTHESIS_MODEL;
  const apiKey = getApiKey("Anthropic", ["ANTHROPIC_API_KEY"], options);
  const fetchImpl = getFetch(options);

  async function createMessage(
    system: string,
    content: string,
    usedFor: string,
    policyVersion?: string,
    maxTokens = 700,
  ) {
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
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
        FOCUS_SUMMARY_INSTRUCTIONS,
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

    async complete(request) {
      const result = await createMessage(
        request.system,
        request.input,
        request.usedFor ?? "completion",
        request.policyVersion,
        request.maxTokens ?? 1500,
      );
      return result;
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
  async function createChat(
    system: string,
    content: string,
    usedFor: string,
    policyVersion?: string,
    maxTokens = 700,
  ) {
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
        max_tokens: maxTokens,
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
        FOCUS_SUMMARY_INSTRUCTIONS,
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

    async complete(request) {
      return createChat(
        request.system,
        request.input,
        request.usedFor ?? "completion",
        request.policyVersion,
        request.maxTokens ?? 1500,
      );
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
    async complete() {
      throw new Error(
        "Internal Skippy LLM is disabled for this brain. Configure an LLM provider in Settings to use automated planning.",
      );
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

export const PROJECT_PLAN_POLICY_VERSION = "skippy-project-plan-v1";
export const TASK_BRIEF_POLICY_VERSION = "skippy-task-brief-v1";

const PROJECT_PLAN_INSTRUCTIONS = [
  "You are Skippy's project planning layer. You DECOMPOSE a software/work project into an ordered set of concrete, executable tasks.",
  "Skippy itself does not write code: each task is a brief that a human or a coding agent (like Claude Code) can pick up and execute.",
  "Rules:",
  "- Produce 3 to 12 tasks, ordered so dependencies come first.",
  "- Each task must be a single, shippable unit of work with a clear outcome.",
  '- "kind" is one of: coding, review, research, design, manual, planning.',
  '- "acceptanceCriteria" is a short list (1-4) of checkable conditions that mean the task is done.',
  '- "executionBrief" is a self-contained, ready-to-hand-off brief: what to do, where, and any context an executor needs. Write it as if pasting it directly to a coding agent.',
  '- "dependsOn" is an array of 0-based indexes of earlier tasks in THIS list that must finish first. Omit or use [] when independent.',
  "Return ONLY a JSON object, no markdown fences, of the exact shape:",
  '{"summary": string, "tasks": [{"title": string, "description": string, "kind": string, "acceptanceCriteria": string[], "executionBrief": string, "dependsOn": number[]}]}',
].join("\n");

const TASK_BRIEF_INSTRUCTIONS = [
  "You are Skippy's task proposal briefing layer. You turn one user-authored proposal into a concrete, executable task brief.",
  "Skippy itself does not write code: the brief should be ready for a human or coding agent to execute.",
  "Rules:",
  "- Preserve the user's intent and do not add unrelated scope.",
  "- Clarify the likely implementation path and important constraints.",
  '- "kind" is one of: coding, review, research, design, manual, planning.',
  '- "acceptanceCriteria" is a short list (1-4) of checkable conditions that mean the task is done.',
  '- "executionBrief" is self-contained: what to do, where to look, and how to verify it.',
  "Return ONLY a JSON object, no markdown fences, of the exact shape:",
  '{"title": string, "description": string, "kind": string, "acceptanceCriteria": string[], "executionBrief": string}',
].join("\n");

function extractJsonObject(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return candidate.slice(start, index + 1);
      }
    }
  }
  return undefined;
}

const PLAN_TASK_KINDS = new Set(["coding", "review", "research", "design", "manual", "planning"]);

function normalizePlanTask(raw: unknown): ProjectPlanTaskDraft | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (!title) return undefined;

  const task: ProjectPlanTaskDraft = { title };
  if (typeof record.description === "string" && record.description.trim()) {
    task.description = record.description.trim();
  }
  if (typeof record.kind === "string" && PLAN_TASK_KINDS.has(record.kind)) {
    task.kind = record.kind as NonNullable<ProjectPlanTaskDraft["kind"]>;
  }
  if (typeof record.executionBrief === "string" && record.executionBrief.trim()) {
    task.executionBrief = record.executionBrief.trim();
  }
  if (Array.isArray(record.acceptanceCriteria)) {
    const criteria = record.acceptanceCriteria
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    if (criteria.length) task.acceptanceCriteria = criteria;
  }
  if (Array.isArray(record.dependsOn)) {
    const deps = record.dependsOn
      .map((item) => (typeof item === "number" ? item : Number.parseInt(String(item), 10)))
      .filter((item) => Number.isInteger(item) && item >= 0);
    if (deps.length) task.dependsOn = deps;
  }
  return task;
}

/** Parse a raw planning completion into a validated ProjectPlanResult. Exported for testing. */
export function parseProjectPlan(text: string): { summary: string; tasks: ProjectPlanTaskDraft[] } {
  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    throw new Error("Project plan response did not contain a JSON object");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Project plan response was not valid JSON");
  }
  const record = (parsed ?? {}) as Record<string, unknown>;
  const rawTasks = Array.isArray(record.tasks) ? record.tasks : [];
  const tasks: ProjectPlanTaskDraft[] = [];
  for (const rawTask of rawTasks) {
    const task = normalizePlanTask(rawTask);
    if (task) tasks.push(task);
  }
  if (!tasks.length) {
    throw new Error("Project plan response did not include any valid tasks");
  }
  // Drop dependency indexes that point outside the produced task list.
  for (const task of tasks) {
    if (task.dependsOn) {
      task.dependsOn = task.dependsOn.filter((index) => index < tasks.length);
      if (!task.dependsOn.length) delete task.dependsOn;
    }
  }
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  return { summary, tasks };
}

/** Parse a raw single-task brief completion into a validated task draft. Exported for testing. */
export function parseTaskBrief(text: string, fallbackTitle = "Task proposal"): ProjectPlanTaskDraft {
  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    throw new Error("Task brief response did not contain a JSON object");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Task brief response was not valid JSON");
  }
  const task = normalizePlanTask(parsed);
  if (!task) {
    throw new Error("Task brief response did not include a valid task");
  }
  if (!task.title.trim()) {
    task.title = fallbackTitle;
  }
  return task;
}

export async function generateProjectPlan(
  client: LlmClient,
  request: ProjectPlanRequest,
): Promise<ProjectPlanResult> {
  const lines = [
    `Project: ${request.projectTitle}`,
    request.projectSummary ? `Summary: ${request.projectSummary}` : undefined,
    request.goals?.length ? `Related goals:\n${request.goals.map((goal) => `- ${goal}`).join("\n")}` : undefined,
    request.existingTasks?.length
      ? `Tasks that already exist (do not duplicate these):\n${request.existingTasks.map((task) => `- ${task}`).join("\n")}`
      : undefined,
    request.notes ? `Additional notes: ${request.notes}` : undefined,
    `Produce at most ${request.maxTasks ?? 10} tasks.`,
  ].filter(Boolean);

  const result = await client.complete({
    system: PROJECT_PLAN_INSTRUCTIONS,
    input: lines.join("\n\n"),
    maxTokens: 3000,
    usedFor: "project_plan",
    policyVersion: request.policyVersion ?? PROJECT_PLAN_POLICY_VERSION,
  });

  const parsed = parseProjectPlan(result.text);
  return {
    summary: parsed.summary,
    tasks: parsed.tasks,
    usage: result.usage,
  };
}

export async function generateTaskBrief(
  client: LlmClient,
  request: TaskBriefRequest,
): Promise<TaskBriefResult> {
  const lines = [
    `Project: ${request.projectTitle}`,
    request.projectSummary ? `Project summary: ${request.projectSummary}` : undefined,
    request.existingTasks?.length
      ? `Existing tasks (do not duplicate these):\n${request.existingTasks.map((task) => `- ${task}`).join("\n")}`
      : undefined,
    `Proposal title: ${request.proposalTitle}`,
    `Proposal notes:\n${request.proposalText}`,
  ].filter(Boolean);

  const result = await client.complete({
    system: TASK_BRIEF_INSTRUCTIONS,
    input: lines.join("\n\n"),
    maxTokens: 1600,
    usedFor: "task_brief",
    policyVersion: request.policyVersion ?? TASK_BRIEF_POLICY_VERSION,
  });

  const task = parseTaskBrief(result.text, request.proposalTitle);
  return {
    ...task,
    usage: result.usage,
  };
}
