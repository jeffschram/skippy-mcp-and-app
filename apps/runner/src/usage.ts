/**
 * Token-usage normalization (docs/token-efficiency.md, Stage 1 lever 1).
 *
 * Both harness adapters emit `usage` events with the provider's raw counters,
 * but the two providers use DIFFERENT conventions for cached input:
 *  - Claude Agent SDK result usage: `input_tokens` EXCLUDES cache activity;
 *    cache reads/writes arrive separately as `cache_read_input_tokens` and
 *    `cache_creation_input_tokens`.
 *  - Codex (OpenAI) usage: `cached_input_tokens` is a SUBSET of
 *    `input_tokens`.
 * Normalizing at the runner (the only place that sees both shapes) keeps the
 * control plane and UI provider-agnostic.
 */

export type TokenUsage = {
  /** Fresh (non-cache-read) input tokens, including cache writes. */
  inputTokens: number;
  /** Input tokens served from the provider's prompt cache. */
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Normalize a raw harness usage payload into TokenUsage. Returns undefined
 * for unrecognized/empty payloads so callers can skip persisting noise.
 */
export function normalizeUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  let inputTokens: number;
  let cachedInputTokens: number;
  if ("cached_input_tokens" in r) {
    // Codex/OpenAI shape: cached is a subset of input_tokens.
    cachedInputTokens = num(r.cached_input_tokens);
    inputTokens = Math.max(0, num(r.input_tokens) - cachedInputTokens);
  } else {
    // Claude shape: cache activity is reported alongside, not inside, input.
    // Cache WRITES are billed like (slightly above) fresh input, so they
    // count as fresh; cache READS are the cheap bucket.
    inputTokens = num(r.input_tokens) + num(r.cache_creation_input_tokens);
    cachedInputTokens = num(r.cache_read_input_tokens);
  }
  const outputTokens = num(r.output_tokens);
  const totalTokens = inputTokens + cachedInputTokens + outputTokens;
  if (totalTokens === 0) return undefined;
  return { inputTokens, cachedInputTokens, outputTokens, totalTokens };
}

/** Sum usage across a session's usage events (Codex emits one per turn). */
export function accumulateUsage(total: TokenUsage | undefined, next: TokenUsage): TokenUsage {
  if (!total) return next;
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    cachedInputTokens: total.cachedInputTokens + next.cachedInputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    totalTokens: total.totalTokens + next.totalTokens,
  };
}
