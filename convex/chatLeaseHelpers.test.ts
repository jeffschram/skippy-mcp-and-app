import { describe, expect, it } from "vitest";
import { CHAT_LEASE_MS, chatTurnLeaseExpiresAt, isChatTurnLeaseExpired } from "./chatLeaseHelpers";

const NOW = 1_700_000_000_000;

describe("chatTurnLeaseExpiresAt", () => {
  it("uses the explicit lease when present", () => {
    expect(chatTurnLeaseExpiresAt({ leaseExpiresAt: NOW + 5_000, updatedAt: NOW })).toBe(NOW + 5_000);
  });

  it("falls back to updatedAt plus one lease window", () => {
    expect(chatTurnLeaseExpiresAt({ updatedAt: NOW })).toBe(NOW + CHAT_LEASE_MS);
  });
});

describe("isChatTurnLeaseExpired", () => {
  it("keeps a live lease", () => {
    expect(isChatTurnLeaseExpired({ leaseExpiresAt: NOW + 1, updatedAt: NOW }, NOW)).toBe(false);
  });

  it("expires at the boundary", () => {
    expect(isChatTurnLeaseExpired({ leaseExpiresAt: NOW, updatedAt: NOW }, NOW)).toBe(true);
  });

  it("expires a lapsed lease", () => {
    expect(isChatTurnLeaseExpired({ leaseExpiresAt: NOW - 1, updatedAt: NOW }, NOW)).toBe(true);
  });

  it("expires a legacy turn one window after its last write", () => {
    // The 2026-09-02 orphans: host killed mid-turn, lease never renewed.
    expect(isChatTurnLeaseExpired({ updatedAt: NOW - CHAT_LEASE_MS - 1 }, NOW)).toBe(true);
    expect(isChatTurnLeaseExpired({ updatedAt: NOW - 1_000 }, NOW)).toBe(false);
  });
});
