/* ------------------------------------------------------------------ */
/* Pure math helpers for the Finances Insights view: bar scaling,      */
/* month-label thinning, sparkline geometry, and honest window labels. */
/* No React, no DOM — unit-tested per the finances-helpers pattern.    */
/* ------------------------------------------------------------------ */

/**
 * Scales non-negative cent values to bar heights in px. Zero (and negative,
 * e.g. a refund-dominated month) values render as zero-height bars — missing
 * data stays VISIBLE as a gap, never interpolated. Non-zero values get at
 * least 1px so tiny months don't vanish entirely.
 */
export function scaleBarHeights(valuesCents: readonly number[], maxHeightPx: number): number[] {
  if (maxHeightPx <= 0) return valuesCents.map(() => 0);
  const max = Math.max(0, ...valuesCents);
  if (max <= 0) return valuesCents.map(() => 0);
  return valuesCents.map((value) =>
    value <= 0 ? 0 : Math.max(1, Math.round((value / max) * maxHeightPx)),
  );
}

/**
 * Which of `count` evenly spaced items should carry a label so at most
 * `maxLabels` render (sparse month labels under bar charts). Always includes
 * the first and last index; interior labels are spread evenly. Returns
 * ascending unique indices.
 */
export function labelIndices(count: number, maxLabels: number): number[] {
  if (count <= 0 || maxLabels <= 0) return [];
  if (count === 1 || maxLabels === 1) return [0];
  if (count <= maxLabels) return Array.from({ length: count }, (_, index) => index);
  const indices = new Set<number>();
  for (let slot = 0; slot < maxLabels; slot += 1) {
    indices.add(Math.round((slot * (count - 1)) / (maxLabels - 1)));
  }
  return [...indices].sort((a, b) => a - b);
}

export type SparklinePoint = {
  /** Index into the input series (which month the point belongs to). */
  index: number;
  x: number;
  y: number;
};

/**
 * Sparkline geometry for a series with gaps: null values (months without a
 * balance snapshot) split the line into separate segments instead of being
 * interpolated across. Points are scaled to fit width x height with `pad`
 * inset; a flat series draws at mid-height. Single-point segments should be
 * rendered as dots.
 */
export function sparklineSegments(
  values: readonly (number | null)[],
  width: number,
  height: number,
  pad = 3,
): SparklinePoint[][] {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return [];
  const min = Math.min(...present);
  const max = Math.max(...present);
  const innerWidth = Math.max(0, width - pad * 2);
  const innerHeight = Math.max(0, height - pad * 2);
  const xAt = (index: number) =>
    values.length === 1 ? width / 2 : pad + (index * innerWidth) / (values.length - 1);
  const yAt = (value: number) =>
    max === min ? height / 2 : pad + ((max - value) / (max - min)) * innerHeight;

  const segments: SparklinePoint[][] = [];
  let current: SparklinePoint[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push({ index, x: round2(xAt(index)), y: round2(yAt(value)) });
  });
  if (current.length > 0) segments.push(current);
  return segments;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Honest window label: '12-mo avg' when the full window was available,
 * '12-mo avg (9 mo)' when history only covered 9 complete months.
 */
export function windowLabel(windowMonths: number, monthsUsed: number): string {
  const base = `${windowMonths}-mo avg`;
  return monthsUsed >= windowMonths ? base : `${base} (${monthsUsed} mo)`;
}
