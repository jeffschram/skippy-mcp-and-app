import { describe, expect, it } from "vitest";
import { orderIndexBetween } from "./index";

describe("orderIndexBetween", () => {
  it("returns 0 for an empty bucket", () => {
    expect(orderIndexBetween(undefined, undefined)).toBe(0);
  });

  it("places before the first task", () => {
    expect(orderIndexBetween(undefined, 5)).toBe(4);
  });

  it("places after the last task", () => {
    expect(orderIndexBetween(7, undefined)).toBe(8);
  });

  it("returns the midpoint between two neighbors", () => {
    expect(orderIndexBetween(1, 2)).toBe(1.5);
    // Mixed scales (small planner indexes vs. timestamp indexes) still order.
    const mid = orderIndexBetween(3, 1_700_000_000_000);
    expect(mid).toBeGreaterThan(3);
    expect(mid).toBeLessThan(1_700_000_000_000);
  });

  it("returns undefined when neighbors leave no room", () => {
    expect(orderIndexBetween(4, 4)).toBeUndefined();
    expect(orderIndexBetween(5, 3)).toBeUndefined();
    // Adjacent floats: midpoint collapses onto a neighbor.
    const a = 1;
    const b = a + Number.EPSILON;
    expect(orderIndexBetween(a, b)).toBeUndefined();
  });
});
