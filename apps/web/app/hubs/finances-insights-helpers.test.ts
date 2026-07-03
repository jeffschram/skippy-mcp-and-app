import { describe, expect, it } from "vitest";
import { labelIndices, scaleBarHeights, sparklineSegments, windowLabel } from "./finances-insights-helpers";

describe("scaleBarHeights", () => {
  it("scales values proportionally to the max height", () => {
    expect(scaleBarHeights([100, 50, 25], 100)).toEqual([100, 50, 25]);
    expect(scaleBarHeights([200000, 100000], 80)).toEqual([80, 40]);
  });

  it("renders zero-data months as zero-height bars", () => {
    expect(scaleBarHeights([0, 400, 0, 200], 100)).toEqual([0, 100, 0, 50]);
  });

  it("clamps negative values (refund-dominated months) to zero", () => {
    expect(scaleBarHeights([-500, 1000], 100)).toEqual([0, 100]);
  });

  it("gives tiny non-zero values at least 1px so they stay visible", () => {
    const heights = scaleBarHeights([1, 1000000], 100);
    expect(heights[0]).toBe(1);
    expect(heights[1]).toBe(100);
  });

  it("returns all zeros when every value is zero or the height is non-positive", () => {
    expect(scaleBarHeights([0, 0, 0], 100)).toEqual([0, 0, 0]);
    expect(scaleBarHeights([], 100)).toEqual([]);
    expect(scaleBarHeights([100], 0)).toEqual([0]);
  });
});

describe("labelIndices", () => {
  it("labels everything when the count fits", () => {
    expect(labelIndices(4, 6)).toEqual([0, 1, 2, 3]);
    expect(labelIndices(6, 6)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("thins to at most maxLabels, always keeping first and last", () => {
    const indices = labelIndices(12, 4);
    expect(indices.length).toBeLessThanOrEqual(4);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(11);
    // Ascending and unique.
    expect([...new Set(indices)].sort((a, b) => a - b)).toEqual(indices);
  });

  it("spreads interior labels evenly", () => {
    expect(labelIndices(13, 4)).toEqual([0, 4, 8, 12]);
    expect(labelIndices(11, 3)).toEqual([0, 5, 10]);
  });

  it("handles degenerate inputs", () => {
    expect(labelIndices(0, 4)).toEqual([]);
    expect(labelIndices(5, 0)).toEqual([]);
    expect(labelIndices(1, 4)).toEqual([0]);
    expect(labelIndices(9, 1)).toEqual([0]);
  });
});

describe("sparklineSegments", () => {
  it("maps a full series to one segment spanning the padded width", () => {
    const [segment] = sparklineSegments([0, 50, 100], 106, 46, 3);
    expect(segment).toHaveLength(3);
    expect(segment![0]).toEqual({ index: 0, x: 3, y: 43 });
    expect(segment![1]).toEqual({ index: 1, x: 53, y: 23 });
    expect(segment![2]).toEqual({ index: 2, x: 103, y: 3 });
  });

  it("splits on nulls instead of interpolating across missing months", () => {
    const segments = sparklineSegments([10, 20, null, 30, 40], 100, 40);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.map((p) => p.index)).toEqual([0, 1]);
    expect(segments[1]!.map((p) => p.index)).toEqual([3, 4]);
  });

  it("keeps single-point segments (rendered as dots)", () => {
    const segments = sparklineSegments([null, 25, null], 100, 40);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(1);
    expect(segments[0]![0]!.index).toBe(1);
  });

  it("draws a flat series at mid-height", () => {
    const [segment] = sparklineSegments([500, 500, 500], 100, 40);
    expect(segment!.every((point) => point.y === 20)).toBe(true);
  });

  it("returns no segments for an all-null or empty series", () => {
    expect(sparklineSegments([null, null], 100, 40)).toEqual([]);
    expect(sparklineSegments([], 100, 40)).toEqual([]);
  });

  it("handles negative balances (y still within bounds)", () => {
    const [segment] = sparklineSegments([-1000, 1000], 100, 40, 3);
    expect(segment![0]!.y).toBe(37);
    expect(segment![1]!.y).toBe(3);
  });
});

describe("windowLabel", () => {
  it("labels a full window plainly", () => {
    expect(windowLabel(12, 12)).toBe("12-mo avg");
    expect(windowLabel(2, 2)).toBe("2-mo avg");
  });

  it("labels short history honestly", () => {
    expect(windowLabel(12, 9)).toBe("12-mo avg (9 mo)");
    expect(windowLabel(6, 0)).toBe("6-mo avg (0 mo)");
  });
});
