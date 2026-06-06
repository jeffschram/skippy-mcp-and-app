import { describe, expect, it } from "vitest";
import { isProcessingState, PROCESSING_STATES } from "./index";

describe("processing states", () => {
  it("defines the universal processing states from the development spec", () => {
    expect(PROCESSING_STATES).toEqual(["suggested", "accepted", "rejected", "archived"]);
  });

  it("validates processing states", () => {
    expect(isProcessingState("suggested")).toBe(true);
    expect(isProcessingState("done")).toBe(false);
    expect(isProcessingState(null)).toBe(false);
  });
});
