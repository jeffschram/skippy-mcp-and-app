import { describe, expect, it } from "vitest";
import { cachedSharePercent, formatTokens } from "./agent-usage-helpers";

describe("formatTokens", () => {
  it("renders small counts as-is", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(982)).toBe("982");
  });

  it("renders thousands with one decimal below 10k, none above", () => {
    expect(formatTokens(1_234)).toBe("1.2k");
    expect(formatTokens(45_300)).toBe("45k");
  });

  it("renders millions", () => {
    expect(formatTokens(1_240_000)).toBe("1.2M");
    expect(formatTokens(32_500_000)).toBe("33M");
  });

  it("treats undefined as zero", () => {
    expect(formatTokens(undefined)).toBe("0");
  });
});

describe("cachedSharePercent", () => {
  it("computes cached share of total input", () => {
    expect(
      cachedSharePercent({ inputTokens: 2_000, cachedInputTokens: 8_000, outputTokens: 500, totalTokens: 10_500 }),
    ).toBe(80);
  });

  it("returns undefined when there is no input (avoids misleading 0%)", () => {
    expect(cachedSharePercent({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 5, totalTokens: 5 })).toBeUndefined();
    expect(cachedSharePercent(undefined)).toBeUndefined();
  });
});
