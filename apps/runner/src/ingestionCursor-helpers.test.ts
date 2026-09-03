import { describe, expect, it } from "vitest";

import {
  INGESTION_MAX_LOOKBACK_MS,
  INGESTION_OVERLAP_BUFFER_MS,
  buildIngestionCursorBlock,
  epochSeconds,
  resolveIngestionCursor,
} from "./ingestionCursor-helpers.js";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");

describe("resolveIngestionCursor", () => {
  it("subtracts the 15-minute overlap buffer from a recent completed run", () => {
    const lastCompletedAt = NOW - 60 * 60_000; // one hour ago
    const cursor = resolveIngestionCursor(lastCompletedAt, NOW);
    expect(cursor.since).toBe(lastCompletedAt - INGESTION_OVERLAP_BUFFER_MS);
    expect(cursor.capped).toBe(false);
    expect(cursor.lastCompletedAt).toBe(lastCompletedAt);
  });

  it("falls back to the 48h cap when no completed run exists", () => {
    const cursor = resolveIngestionCursor(null, NOW);
    expect(cursor.since).toBe(NOW - INGESTION_MAX_LOOKBACK_MS);
    expect(cursor.capped).toBe(true);
    expect(cursor.lastCompletedAt).toBeNull();
  });

  it("treats undefined and NaN like a missing cursor", () => {
    expect(resolveIngestionCursor(undefined, NOW).capped).toBe(true);
    expect(resolveIngestionCursor(Number.NaN, NOW).capped).toBe(true);
  });

  it("caps a stale cursor older than 48 hours instead of replaying history", () => {
    const lastCompletedAt = NOW - 72 * 60 * 60_000; // three days ago
    const cursor = resolveIngestionCursor(lastCompletedAt, NOW);
    expect(cursor.since).toBe(NOW - INGESTION_MAX_LOOKBACK_MS);
    expect(cursor.capped).toBe(true);
    expect(cursor.lastCompletedAt).toBe(lastCompletedAt);
  });

  it("caps a cursor exactly at the 48h boundary after buffering", () => {
    // buffered == floor is capped: the window would be identical anyway, and
    // the capped message tells the pass its cursor is stale.
    const lastCompletedAt = NOW - INGESTION_MAX_LOOKBACK_MS + INGESTION_OVERLAP_BUFFER_MS;
    const cursor = resolveIngestionCursor(lastCompletedAt, NOW);
    expect(cursor.capped).toBe(true);
    expect(cursor.since).toBe(NOW - INGESTION_MAX_LOOKBACK_MS);
  });

  it("clamps a clock-skewed future cursor to now", () => {
    const lastCompletedAt = NOW + 60 * 60_000; // an hour in the future
    const cursor = resolveIngestionCursor(lastCompletedAt, NOW);
    expect(cursor.since).toBe(NOW);
    expect(cursor.capped).toBe(false);
  });
});

describe("epochSeconds", () => {
  it("floors milliseconds to whole seconds for Gmail after:", () => {
    expect(epochSeconds(1_756_900_000_999)).toBe(1_756_900_000);
  });
});

describe("buildIngestionCursorBlock", () => {
  it("names the last completed pass and the per-connector parameters", () => {
    const lastCompletedAt = NOW - 60 * 60_000;
    const block = buildIngestionCursorBlock(resolveIngestionCursor(lastCompletedAt, NOW));
    const sinceIso = new Date(lastCompletedAt - INGESTION_OVERLAP_BUFFER_MS).toISOString();
    expect(block).toContain(`Last successful pass completed ${new Date(lastCompletedAt).toISOString()}`);
    expect(block).toContain(`newer than ${sinceIso}`);
    expect(block).toContain(`since "${sinceIso}" on iMessage tools`);
    expect(block).toContain(`after:${epochSeconds(lastCompletedAt - INGESTION_OVERLAP_BUFFER_MS)}`);
    expect(block).toContain(`time_min "${sinceIso}" on calendar list_events`);
    expect(block).toContain("Do not improvise a wider window.");
  });

  it("says 48 hours only when there is no cursor on record", () => {
    const block = buildIngestionCursorBlock(resolveIngestionCursor(null, NOW));
    expect(block).toContain("No recent completed pass is on record, so read the last 48 hours only.");
    expect(block).toContain(new Date(NOW - INGESTION_MAX_LOOKBACK_MS).toISOString());
  });

  it("says the pass is stale when the cursor exceeded the cap", () => {
    const block = buildIngestionCursorBlock(
      resolveIngestionCursor(NOW - 72 * 60 * 60_000, NOW),
    );
    expect(block).toContain("older than 48 hours, so read the last 48 hours only.");
  });
});
