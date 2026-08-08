/**
 * Codex adapter: Codex App Server.
 *
 * Phase 2 (docs/mac-mini-agent-workbench.md → Delivery phases): the Claude
 * adapter ships first; this stub keeps the harness enum honest end to end —
 * a host that does not advertise "codex" is never offered codex runs, and a
 * misrouted run fails cleanly instead of half-running.
 *
 * Implementation sketch: speak the App Server protocol (thread/turn lifecycle,
 * streamed events, command & file approvals, plans, diffs) over its structured
 * transport, translating into HarnessEvent + ApprovalRequest exactly like the
 * Claude adapter does for Agent SDK messages.
 */
import type { HarnessAdapter, HarnessTurnRequest, HarnessTurnResult } from "./types.js";

export class CodexAdapter implements HarnessAdapter {
  readonly harness = "codex" as const;

  async runTurn(_request: HarnessTurnRequest): Promise<HarnessTurnResult> {
    return {
      outcome: "failed",
      errorMessage:
        "The Codex adapter is not implemented yet. Remove 'codex' from SKIPPY_RUNNER_HARNESSES or execute this task with the Claude harness.",
    };
  }
}
