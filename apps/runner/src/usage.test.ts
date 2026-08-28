import { describe, expect, it } from "vitest";
import { accumulateUsage, normalizeUsage } from "./usage.js";

describe("normalizeUsage", () => {
  it("normalizes the Claude shape (cache reported alongside input)", () => {
    expect(
      normalizeUsage({
        input_tokens: 100,
        cache_creation_input_tokens: 2_000,
        cache_read_input_tokens: 30_000,
        output_tokens: 500,
      }),
    ).toEqual({
      inputTokens: 2_100, // fresh input + cache writes
      cachedInputTokens: 30_000,
      outputTokens: 500,
      totalTokens: 32_600,
    });
  });

  it("normalizes the Codex shape (cached is a subset of input)", () => {
    expect(
      normalizeUsage({ input_tokens: 40_000, cached_input_tokens: 35_000, output_tokens: 800 }),
    ).toEqual({
      inputTokens: 5_000,
      cachedInputTokens: 35_000,
      outputTokens: 800,
      totalTokens: 40_800,
    });
  });

  it("treats a Codex payload with cached > input as fully cached, never negative", () => {
    const usage = normalizeUsage({ input_tokens: 10, cached_input_tokens: 50, output_tokens: 1 });
    expect(usage?.inputTokens).toBe(0);
    expect(usage?.totalTokens).toBe(51);
  });

  it("returns undefined for empty, zero, or unrecognized payloads", () => {
    expect(normalizeUsage(undefined)).toBeUndefined();
    expect(normalizeUsage(null)).toBeUndefined();
    expect(normalizeUsage("tokens")).toBeUndefined();
    expect(normalizeUsage({})).toBeUndefined();
    expect(normalizeUsage({ input_tokens: 0, output_tokens: 0 })).toBeUndefined();
    expect(normalizeUsage({ input_tokens: "12" })).toBeUndefined();
  });

  it("ignores negative and non-finite counters", () => {
    expect(normalizeUsage({ input_tokens: -5, output_tokens: Number.NaN })).toBeUndefined();
  });
});

describe("accumulateUsage", () => {
  it("returns the first sample unchanged when there is no running total", () => {
    const sample = { inputTokens: 1, cachedInputTokens: 2, outputTokens: 3, totalTokens: 6 };
    expect(accumulateUsage(undefined, sample)).toEqual(sample);
  });

  it("sums per-turn samples across a session", () => {
    const first = { inputTokens: 100, cachedInputTokens: 1_000, outputTokens: 50, totalTokens: 1_150 };
    const second = { inputTokens: 20, cachedInputTokens: 3_000, outputTokens: 70, totalTokens: 3_090 };
    expect(accumulateUsage(first, second)).toEqual({
      inputTokens: 120,
      cachedInputTokens: 4_000,
      outputTokens: 120,
      totalTokens: 4_240,
    });
  });
});
