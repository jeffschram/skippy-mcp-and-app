import { describe, expect, it } from "vitest";
import { triageMetaLabel } from "./triage-helpers";

describe("triageMetaLabel", () => {
  it("formats type and confidence on one line", () => {
    expect(triageMetaLabel({ candidateEntityType: "task", confidence: 0.82 })).toBe("task signal · 82% confident");
  });

  it("rounds confidence to a whole percent", () => {
    expect(triageMetaLabel({ candidateEntityType: "note", confidence: 0.666 })).toBe("note signal · 67% confident");
  });

  it("omits confidence when missing, non-numeric, or zero", () => {
    expect(triageMetaLabel({ candidateEntityType: "link" })).toBe("link signal");
    expect(triageMetaLabel({ candidateEntityType: "link", confidence: "0.9" })).toBe("link signal");
    expect(triageMetaLabel({ candidateEntityType: "link", confidence: 0 })).toBe("link signal");
    expect(triageMetaLabel({ candidateEntityType: "link", confidence: Number.NaN })).toBe("link signal");
  });

  it("falls back to 'unclassified' for missing or blank entity types", () => {
    expect(triageMetaLabel({})).toBe("unclassified signal");
    expect(triageMetaLabel({ candidateEntityType: "  " })).toBe("unclassified signal");
  });
});
