/**
 * Scheduled maintenance that must NOT depend on the Mac mini runner being
 * alive (docs/mac-mini-agent-workbench.md).
 *
 * Everything else in the control plane is runner-pulled: the host polls, and
 * the poll does the housekeeping. That breaks precisely when the host is the
 * casualty — see chats.ts:sweepStaleChatTurns (incident 2026-09-02). Convex
 * crons run server-side, so they still fire while the Mac mini is down.
 */
import { cronJobs, makeFunctionReference } from "convex/server";

const crons = cronJobs();

// One minute: shorter than CHAT_LEASE_MS (150s), so a dead host's turn fails
// out roughly a lease-window after its last heartbeat instead of hanging.
crons.interval(
  "expire stale chat turns",
  { seconds: 60 },
  makeFunctionReference<"mutation">("chats:sweepStaleChatTurns"),
  {},
);

export default crons;
