/**
 * Chat turn lease arithmetic, extracted so the expiry rule is testable without
 * a Convex ctx (docs/mac-mini-agent-workbench.md).
 *
 * A claimed/running turn belongs to exactly one host. If that host dies, the
 * turn is unrecoverable — the harness session went with it — so the only
 * correct move is to fail it and let the user retry. The lease is what tells
 * us the host is gone.
 */

/** Matches CHAT_LEASE_MS in chats.ts; a host renews well inside this window. */
export const CHAT_LEASE_MS = 150_000;

export type LeasedChatTurn = {
  leaseExpiresAt?: number;
  updatedAt: number;
};

/**
 * Turns claimed before leaseExpiresAt existed (or by a host that never renewed)
 * fall back to their last write plus one lease window.
 */
export function chatTurnLeaseExpiresAt(turn: LeasedChatTurn, leaseMs: number = CHAT_LEASE_MS): number {
  return turn.leaseExpiresAt ?? turn.updatedAt + leaseMs;
}

export function isChatTurnLeaseExpired(
  turn: LeasedChatTurn,
  now: number,
  leaseMs: number = CHAT_LEASE_MS,
): boolean {
  return chatTurnLeaseExpiresAt(turn, leaseMs) <= now;
}
