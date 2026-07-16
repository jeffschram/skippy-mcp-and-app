import { describe, expect, it } from "vitest";
import { SOURCE_SYNC_STALE_MS, activeSourceSyncStatus, isSourceSyncActive } from "./index";

describe("isSourceSyncActive", () => {
  const now = 1_780_850_000_000;

  it("treats a fresh running row as active, inclusive of the window boundary", () => {
    expect(isSourceSyncActive({ status: "running", lastHeartbeatAt: now - 1000 }, now)).toBe(true);
    expect(
      isSourceSyncActive({ status: "running", lastHeartbeatAt: now - SOURCE_SYNC_STALE_MS }, now),
    ).toBe(true);
  });

  it("expires a running row once every timestamp is stale (dead-harness self-heal)", () => {
    const stale = now - SOURCE_SYNC_STALE_MS - 1;
    expect(
      isSourceSyncActive(
        { status: "running", startedAt: stale, lastHeartbeatAt: stale, updatedAt: stale },
        now,
      ),
    ).toBe(false);
    // The six-day stuck codex_automation case.
    const sixDaysAgo = now - 6 * 24 * 60 * 60 * 1000;
    expect(
      isSourceSyncActive(
        { status: "running", startedAt: sixDaysAgo, lastHeartbeatAt: sixDaysAgo, updatedAt: sixDaysAgo },
        now,
      ),
    ).toBe(false);
  });

  it("uses the freshest of heartbeat, update, and start timestamps", () => {
    const stale = now - SOURCE_SYNC_STALE_MS - 1;
    // Fresh heartbeat rescues stale start/update.
    expect(
      isSourceSyncActive(
        { status: "running", startedAt: stale, updatedAt: stale, lastHeartbeatAt: now - 1000 },
        now,
      ),
    ).toBe(true);
    // A row that just started but has not heartbeaten yet is still active.
    expect(isSourceSyncActive({ status: "running", startedAt: now - 1000 }, now)).toBe(true);
  });

  it("is never active for non-running statuses, however fresh", () => {
    expect(isSourceSyncActive({ status: "completed", lastHeartbeatAt: now }, now)).toBe(false);
    expect(isSourceSyncActive({ status: "failed", lastHeartbeatAt: now }, now)).toBe(false);
    expect(isSourceSyncActive({ status: "idle", lastHeartbeatAt: now }, now)).toBe(false);
  });

  it("uses a 15-minute window", () => {
    expect(SOURCE_SYNC_STALE_MS).toBe(15 * 60 * 1000);
  });
});

describe("activeSourceSyncStatus", () => {
  const now = 1_780_850_000_000;

  it("returns the freshest active running row", () => {
    const older = { status: "running", statusKey: "a", lastHeartbeatAt: now - 60_000 };
    const fresher = { status: "running", statusKey: "b", lastHeartbeatAt: now - 1000 };
    expect(activeSourceSyncStatus([older, fresher], now)).toBe(fresher);
  });

  it("ignores stale running rows and non-running rows", () => {
    const stuck = { status: "running", statusKey: "stuck", lastHeartbeatAt: now - SOURCE_SYNC_STALE_MS - 1 };
    const done = { status: "completed", statusKey: "done", lastHeartbeatAt: now };
    expect(activeSourceSyncStatus([stuck, done], now)).toBeNull();
  });

  it("returns null for empty or undefined input", () => {
    expect(activeSourceSyncStatus(undefined, now)).toBeNull();
    expect(activeSourceSyncStatus([], now)).toBeNull();
  });
});
