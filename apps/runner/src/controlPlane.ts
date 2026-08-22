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
  /** Title of the task this run executes; names the PR so the list stays scannable. */
  taskTitle?: string;
  chatId: string;
  externalThreadId?: string;
  worktreePath?: string;
  branchName?: string;
  baseBranch: string;
  executionBrief?: string;
  acceptanceCriteria?: string[];
  approvalPolicy?: { requirePushApproval?: boolean };
  verifyCommand?: string;
  workspaceMode?: "code" | "temporary";
  inputManifest?: Array<{ fileId: string; fileName: string; mimeType: string; sizeBytes: number; sha256?: string; url: string | null; required: boolean }>;
  outputPolicy?: { enabled: boolean; required: boolean; maxFiles: number; maxFileBytes: number; maxTotalBytes: number };
  project: { _id: string; title?: string; repoUrl?: string; localPath?: string };
}

export interface ControlState {
  status: string;
  cancelRequested: boolean;
  approvals: Array<{ _id: string; harnessRequestId: string; status: string; decidedAt?: number }>;
}

/** One checklist entry of a maintenance job (post-merge close-out). */
export interface MaintenanceStep {
  key: string;
  label: string;
  status: "pending" | "running" | "ok" | "failed" | "skipped";
  detail?: string;
}

/** Claim payload for a host-executed maintenance job (scripted, no harness). */
export interface ClaimedMaintenanceJob {
  jobId: string;
  claimToken: string;
  kind: "post_merge_closeout";
  taskId: string;
  taskTitle?: string;
  prUrl?: string;
  prNumber?: number;
  gitBranchName?: string;
  baseBranch: string;
  steps: MaintenanceStep[];
  project: { _id: string; title?: string; localPath: string };
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chatFns = (anyApi as any).chats as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fileFns = (anyApi as any).projectFiles as Record<string, any>;

/** Attachment on the turn's user message: metadata + a short-lived download URL. */
export interface ChatTurnAttachment {
  fileId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
  url: string | null;
}

export interface ClaimedChatTurn {
  turnId: string;
  claimToken: string;
  chatId: string;
  harness: Harness;
  externalThreadId?: string;
  scopeContext: string;
  cwd?: string;
  /** Project assets folder (_library) on this host, when the project is mapped. */
  assetsPath?: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userContent: string;
  attachments?: ChatTurnAttachment[];
}

export class ControlPlane {
  private client: ConvexHttpClient;
  constructor(
    convexUrl: string,
    private hostToken: string,
  ) {
    this.client = new ConvexHttpClient(convexUrl);
  }

  registerHost(args: { harnesses: Harness[]; os: string; arch: string; maxConcurrency: number; projectFileManifests?: boolean; artifactUploads?: boolean; isolatedChatAttachments?: boolean }) {
    return this.client.mutation(fns.registerHost, { hostToken: this.hostToken, ...args });
  }

  heartbeat(
    activeRunIds: string[],
    activeChatTurnIds: string[] = [],
    activeMaintenanceJobIds: string[] = [],
  ): Promise<{ draining: boolean }> {
    return this.client.mutation(fns.hostHeartbeat, {
      hostToken: this.hostToken,
      activeRunIds,
      activeChatTurnIds,
      activeMaintenanceJobIds,
    });
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

  beginArtifactUpload(runId: string, claimToken: string, artifact: { fileName: string; mimeType: string; sizeBytes: number; sha256: string; relativePath: string; required?: boolean }) {
    return this.client.mutation(fileFns.beginArtifactUploadForRunner, { hostToken: this.hostToken, runId, claimToken, ...artifact }) as Promise<{ fileId: string; uploadUrl?: string; status: string }>;
  }

  finalizeArtifactUpload(runId: string, claimToken: string, args: { fileId: string; storageId: string; sha256: string }) {
    return this.client.mutation(fileFns.finalizeArtifactUploadForRunner, { hostToken: this.hostToken, runId, claimToken, ...args });
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
   * Cancel a still-pending approval with an explicit reason (e.g. the
   * runner's approval timeout expired). Idempotent: settled approvals are
   * left untouched.
   */
  cancelApproval(
    runId: string,
    claimToken: string,
    harnessRequestId: string,
    reason: string,
  ): Promise<{ approvalId: string; status: string }> {
    return this.client.mutation(fns.cancelApproval, {
      hostToken: this.hostToken,
      runId,
      claimToken,
      harnessRequestId,
      reason,
    });
  }

  /* ---- Maintenance jobs (post-merge close-out) ---- */

  claimNextMaintenanceJob(): Promise<ClaimedMaintenanceJob | null> {
    return this.client.mutation(fns.claimNextMaintenanceJob, { hostToken: this.hostToken });
  }

  updateMaintenanceJob(
    jobId: string,
    claimToken: string,
    patch: {
      status?: "running" | "completed" | "failed";
      steps?: MaintenanceStep[];
      errorMessage?: string;
      resultSummary?: string;
    } = {},
  ): Promise<{ jobId: string; status: string }> {
    const payload: Record<string, unknown> = { hostToken: this.hostToken, jobId, claimToken };
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.steps !== undefined) {
      // Convex rejects explicit `undefined` values inside nested objects, so
      // strip absent details rather than sending `detail: undefined`.
      payload.steps = patch.steps.map((step) => ({
        key: step.key,
        label: step.label,
        status: step.status,
        ...(step.detail !== undefined ? { detail: step.detail } : {}),
      }));
    }
    if (patch.errorMessage !== undefined) payload.errorMessage = patch.errorMessage;
    if (patch.resultSummary !== undefined) payload.resultSummary = patch.resultSummary;
    return this.client.mutation(fns.updateMaintenanceJob, payload);
  }

  hostActiveMaintenanceJobs(): Promise<
    Array<{ jobId: string; status: string; kind: string; claimToken?: string; taskId: string }>
  > {
    return this.client.query(fns.hostActiveMaintenanceJobs, { hostToken: this.hostToken });
  }

  /* ---- Conversational chat turns (local-harness chat) ---- */

  claimNextChatTurn(): Promise<ClaimedChatTurn | null> {
    return this.client.mutation(chatFns.claimNextChatTurn, { hostToken: this.hostToken });
  }

  markChatTurnRunning(turnId: string, claimToken: string) {
    return this.client.mutation(chatFns.markChatTurnRunning, { hostToken: this.hostToken, turnId, claimToken });
  }

  requestChatApproval(
    turnId: string,
    claimToken: string,
    approval: {
      harnessRequestId: string;
      kind: "command" | "file_change" | "network" | "secret" | "push" | "pr" | "deployment" | "user_input";
      title: string;
      explanation?: string | undefined;
      details?: unknown;
    },
  ): Promise<{ approvalId: string; status: string }> {
    return this.client.mutation(chatFns.requestChatApproval, {
      hostToken: this.hostToken,
      turnId,
      claimToken,
      ...approval,
    });
  }

  chatTurnControlState(turnId: string): Promise<{
    status: string;
    cancelRequested: boolean;
    approvals: Array<{ harnessRequestId: string; status: string }>;
  }> {
    return this.client.query(chatFns.chatTurnControlState, { hostToken: this.hostToken, turnId });
  }

  reportChatTurnEvents(
    turnId: string,
    claimToken: string,
    events: Array<{ seq: number; type: string; payload?: unknown }>,
  ): Promise<{ accepted: number }> {
    return this.client.mutation(chatFns.reportChatTurnEvents, {
      hostToken: this.hostToken,
      turnId,
      claimToken,
      events,
    });
  }

  completeChatTurn(
    turnId: string,
    claimToken: string,
    result: { resultText?: string; errorMessage?: string; externalThreadId?: string },
  ) {
    const payload: Record<string, unknown> = { hostToken: this.hostToken, turnId, claimToken };
    if (result.resultText !== undefined) payload.resultText = result.resultText;
    if (result.errorMessage !== undefined) payload.errorMessage = result.errorMessage;
    if (result.externalThreadId !== undefined) payload.externalThreadId = result.externalThreadId;
    return this.client.mutation(chatFns.completeChatTurn, payload);
  }

  async awaitChatApproval(
    turnId: string,
    harnessRequestId: string,
    { pollMs = 2_000, signal }: { pollMs?: number; signal?: AbortSignal } = {},
  ): Promise<"accepted" | "declined" | "cancelled"> {
    for (;;) {
      if (signal?.aborted) return "cancelled";
      const state = await this.chatTurnControlState(turnId);
      if (state.cancelRequested) return "cancelled";
      const approval = state.approvals.find((a) => a.harnessRequestId === harnessRequestId);
      if (approval && approval.status !== "pending") {
        return approval.status === "accepted" ? "accepted" : "declined";
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  /**
   * Block until the named approval is decided (or the run is cancelled).
   * Polls control state; a decision made in the web app lands within pollMs.
   *
   * timeoutMs > 0 bounds the wait: when it elapses with the approval still
   * pending, "timed_out" is returned and the caller is responsible for
   * cancelling the approval doc + failing the run with an explicit message.
   * This is THE approval timeout — there is deliberately no hidden one
   * anywhere else (the Convex claim lease renews on heartbeat while waiting).
   */
  async awaitApproval(
    runId: string,
    harnessRequestId: string,
    { pollMs = 2_000, signal, timeoutMs = 0 }: { pollMs?: number; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<"accepted" | "declined" | "cancelled" | "timed_out"> {
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : undefined;
    for (;;) {
      if (signal?.aborted) return "cancelled";
      const state = await this.controlState(runId);
      if (state.cancelRequested) return "cancelled";
      const approval = state.approvals.find((a) => a.harnessRequestId === harnessRequestId);
      if (approval && approval.status !== "pending") {
        return approval.status === "accepted" ? "accepted" : "declined";
      }
      if (deadline !== undefined && Date.now() >= deadline) return "timed_out";
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}
