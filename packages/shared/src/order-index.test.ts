import { describe, expect, it } from "vitest";
import { appendOrderIndex, orderIndexBetween } from "./index";

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

describe("appendOrderIndex (default placement for new tasks in a phase)", () => {
  it("starts an empty phase at 0", () => {
    expect(appendOrderIndex([])).toBe(0);
  });

  it("appends strictly after existing tasks", () => {
    expect(appendOrderIndex([0, 1, 2])).toBe(3);
    // Order of siblings does not matter — only the max does.
    expect(appendOrderIndex([2, 0, 1])).toBe(3);
    // Timestamp-scale siblings (legacy viewer proposals) still append after.
    expect(appendOrderIndex([1_700_000_000_000])).toBe(1_700_000_000_001);
  });

  it("treats missing sibling orderIndex as 0, matching reader sorts", () => {
    expect(appendOrderIndex([undefined])).toBe(1);
    expect(appendOrderIndex([undefined, 5])).toBe(6);
  });

  it("regression: two sequential creates into a non-empty phase get strictly increasing orderIndex, after existing tasks", () => {
    // Phase 3 as it looked on 2026-08-21: older planner tasks at 0..2.
    const phase: Array<{ orderIndex: number | undefined }> = [
      { orderIndex: 0 },
      { orderIndex: 1 },
      { orderIndex: 2 },
    ];
    const maxExisting = 2;

    // First MCP create_task into the phase.
    const first = appendOrderIndex(phase.map((task) => task.orderIndex));
    phase.push({ orderIndex: first });

    // Second sequential create_task into the same phase.
    const second = appendOrderIndex(phase.map((task) => task.orderIndex));
    phase.push({ orderIndex: second });

    // Both land after every pre-existing task, in creation order — no
    // position-0 collision and no undefined relative order.
    expect(first).toBeGreaterThan(maxExisting);
    expect(second).toBeGreaterThan(first);
    const sorted = [...phase].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    expect(sorted.map((task) => task.orderIndex)).toEqual([0, 1, 2, first, second]);
  });
});
