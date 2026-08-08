/**
 * Thin wrapper over the Convex control plane (convex/agentWorkbench.ts).
 *
 * Uses ConvexHttpClient + polling for now. TODO(phase 3): switch work
 * discovery and runControlState to ConvexClient websocket subscriptions; the
 * polling here is the reconciliation path the doc requires anyway, so the
 * subscription becomes a latency optimization, not a correctness change.
 */
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

export type Harness = "codex" | "claude";

export interface ClaimedRun {
  runId: string;
  claimToken: string;
  harness: Harness;
  attempt: number;
  taskId?: string;
  chatId: string;
  externalThreadId?: string;
  worktreePath?: string;
  branchName?: string;
  baseBranch: string;
  executionBrief?: string;
  acceptanceCriteria?: string[];
  approvalPolicy?: { requirePushApproval?: boolean };
  project: { _id: string; title?: string; repoUrl?: string; localPath: string };
}

export interface ControlState {
  status: string;
  cancelRequested: boolean;
  approvals: Array<{ _id: string; harnessRequestId: string; status: string; decidedAt?: number }>;
}

export type ReportableStatus =
  | "preparing"
  | "running"
  | "waiting_for_approval"
  | "verifying"
  | "awaiting_publish_approval"
  | "publishing"
  | "in_review"
  | "interrupted"
  | "failed"
  | "cancelled";

// anyApi is untyped by design; cast once so call sites read cleanly under
// noUncheckedIndexedAccess.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fns = (anyApi as any).agentWorkbench as Record<string, any>;

export class ControlPlane {
  private client: ConvexHttpClient;
  constructor(
    convexUrl: string,
    private hostToken: string,
  ) {
    this.client = new ConvexHttpClient(convexUrl);
  }

  registerHost(args: { harnesses: Harness[]; os: string; arch: string; maxConcurrency: number }) {
    return this.client.mutation(fns.registerHost, { hostToken: this.hostToken, ...args });
  }

  heartbeat(activeRunIds: string[]): Promise<{ draining: boolean }> {
    return this.client.mutation(fns.hostHeartbeat, { hostToken: this.hostToken, activeRunIds });
  }

  claimableRuns(): Promise<string[]> {
    return this.client.query(fns.claimableRuns, { hostToken: this.hostToken });
  }

  claimNextRun(): Promise<ClaimedRun | null> {
    return this.client.mutation(fns.claimNextRun, { hostToken: this.hostToken });
  }

  hostActiveRuns(): Promise<
    Array<{ runId: string; status: string; harness: Harness; claimToken?: string; worktreePath?: string }>
  > {
    return this.client.query(fns.hostActiveRuns, { hostToken: this.hostToken });
  }

  updateRunStatus(
    runId: string,
    claimToken: string,
    status: ReportableStatus,
    patch: Partial<{
      workingBranch: string;
      worktreePath: string;
      externalThreadId: string;
      errorCategory: string;
      errorMessage: string;
      verificationSummary: string;
      resultSummary: string;
      resultUrl: string;
      prUrl: string;
      prNumber: number;
    }> = {},
  ) {
    return this.client.mutation(fns.updateRunStatus, {
      hostToken: this.hostToken,
      runId,
      claimToken,
      status,
      ...patch,
    });
  }

  reportEvents(runId: string, claimToken: string, events: Array<{ seq: number; type: string; payload?: unknown }>) {
    if (!events.length) return Promise.resolve({ inserted: 0 });
    return this.client.mutation(fns.reportRunEvents, { hostToken: this.hostToken, runId, claimToken, events });
  }

  requestApproval(
    runId: string,
    claimToken: string,
    approval: {
      harnessRequestId: string;
      kind: "command" | "file_change" | "network" | "secret" | "push" | "pr" | "deployment" | "user_input";
      title: string;
      explanation?: string | undefined;
      details?: unknown;
      scope?: "command" | "turn" | "session" | undefined;
    },
  ): Promise<{ approvalId: string; status: string }> {
    return this.client.mutation(fns.requestApproval, { hostToken: this.hostToken, runId, claimToken, ...approval });
  }

  controlState(runId: string): Promise<ControlState> {
    return this.client.query(fns.runControlState, { hostToken: this.hostToken, runId });
  }

  /**
   * Block until the named approval is decided (or the run is cancelled).
   * Polls control state; a decision made in the web app lands within pollMs.
   */
  async awaitApproval(
    runId: string,
    harnessRequestId: string,
    { pollMs = 2_000, signal }: { pollMs?: number; signal?: AbortSignal } = {},
  ): Promise<"accepted" | "declined" | "cancelled"> {
    for (;;) {
      if (signal?.aborted) return "cancelled";
      const state = await this.controlState(runId);
      if (state.cancelRequested) return "cancelled";
      const approval = state.approvals.find((a) => a.harnessRequestId === harnessRequestId);
      if (approval && approval.status !== "pending") {
        return approval.status === "accepted" ? "accepted" : "declined";
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}
