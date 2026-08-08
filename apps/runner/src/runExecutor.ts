/**
 * Executes one claimed run end to end:
 * prepare worktree -> run harness turn -> verify -> publish (with approval) -> in_review.
 *
 * Every step reports durable status + events to Convex; the runner holds no
 * state the control plane cannot reconstruct after a restart.
 */
import type { RunnerConfig } from "./config.js";
import type { ClaimedRun, ControlPlane } from "./controlPlane.js";
import type { HarnessAdapter, HarnessEvent } from "./harness/types.js";
import {
  assertGitRepo,
  assertInsideAllowedRoot,
  commitAll,
  createOrUpdatePr,
  diffSummary,
  ensureWorktree,
  hasUncommittedChanges,
  pushBranch,
  slugify,
} from "./worktree.js";

const EVENT_FLUSH_INTERVAL_MS = 1_500;
const CONTROL_POLL_INTERVAL_MS = 3_000;

export class RunExecutor {
  private seq = 0;
  private pendingEvents: Array<{ seq: number; type: string; payload?: unknown }> = [];
  private abort = new AbortController();

  constructor(
    private config: RunnerConfig,
    private plane: ControlPlane,
    private run: ClaimedRun,
    private adapter: HarnessAdapter,
  ) {}

  private emit(event: HarnessEvent) {
    this.seq += 1;
    this.pendingEvents.push({ seq: this.seq, type: event.type, payload: event.payload });
  }

  private async flushEvents() {
    const batch = this.pendingEvents.splice(0, this.pendingEvents.length);
    if (batch.length) {
      try {
        await this.plane.reportEvents(this.run.runId, this.run.claimToken, batch);
      } catch {
        // Buffer bounded re-queue: prepend so ordering survives a transient
        // network failure. If Convex stays unreachable the heartbeat lease
        // expires and reconciliation takes over.
        this.pendingEvents.unshift(...batch);
        if (this.pendingEvents.length > 5_000) {
          // Approaching the buffer limit: pause rather than lose audit events.
          this.abort.abort();
        }
      }
    }
  }

  async execute(): Promise<void> {
    const { run, plane, config } = this;
    const flusher = setInterval(() => void this.flushEvents(), EVENT_FLUSH_INTERVAL_MS);
    const controlWatcher = setInterval(() => {
      void plane
        .controlState(run.runId)
        .then((state) => {
          if (state.cancelRequested) this.abort.abort();
        })
        .catch(() => {});
    }, CONTROL_POLL_INTERVAL_MS);

    try {
      await plane.updateRunStatus(run.runId, run.claimToken, "preparing");

      // Authorization boundary: the control-plane path must resolve inside the
      // runner's allowed root and be a real git checkout.
      const repoPath = assertInsideAllowedRoot(run.project.localPath, config.allowedRoot);
      await assertGitRepo(repoPath);

      const branchName =
        run.branchName ??
        (run.taskId ? `agent/task-${run.taskId.slice(-8)}-${slugify(run.project.title ?? "task")}` : `agent/chat-${run.chatId.slice(-8)}`);
      const worktree = await ensureWorktree({
        repoPath,
        worktreeRoot: config.worktreeRoot,
        baseBranch: run.baseBranch,
        branchName,
      });
      this.emit({ type: "status", payload: { phase: "worktree_ready", ...worktree } });
      await plane.updateRunStatus(run.runId, run.claimToken, "running", {
        workingBranch: worktree.branchName,
        worktreePath: worktree.worktreePath,
      });

      const prompt = buildPrompt(run);
      const turn = await this.adapter.runTurn({
        prompt,
        worktreePath: worktree.worktreePath,
        signal: this.abort.signal,
        onEvent: (event) => this.emit(event),
        requestApproval: async (approval) => {
          await plane.requestApproval(run.runId, run.claimToken, approval);
          const decision = await plane.awaitApproval(run.runId, approval.harnessRequestId, {
            signal: this.abort.signal,
          });
          if (decision !== "cancelled") {
            // Approval settled; let the harness continue under `running`.
            await plane
              .updateRunStatus(run.runId, run.claimToken, "running")
              .catch(() => {});
          }
          return decision;
        },
        ...(run.externalThreadId ? { externalThreadId: run.externalThreadId } : {}),
      });

      if (turn.externalThreadId) {
        await plane.updateRunStatus(run.runId, run.claimToken, "running", {
          externalThreadId: turn.externalThreadId,
        });
      }
      if (turn.outcome === "interrupted" || this.abort.signal.aborted) {
        await this.flushEvents();
        await plane.updateRunStatus(
          run.runId,
          run.claimToken,
          this.abort.signal.aborted ? "cancelled" : "interrupted",
          turn.errorMessage ? { errorMessage: turn.errorMessage } : {},
        );
        return;
      }
      if (turn.outcome === "failed") {
        await this.flushEvents();
        await plane.updateRunStatus(run.runId, run.claimToken, "failed", {
          errorCategory: "harness",
          errorMessage: turn.errorMessage ?? "harness failed",
        });
        return;
      }

      // Verification: phase 1 records the diff surface; wiring the project's
      // real test/typecheck commands in is the next slice.
      await plane.updateRunStatus(run.runId, run.claimToken, "verifying");
      await commitAll(worktree.worktreePath, `Agent work for ${run.project.title ?? "task"}`);
      const summary = await diffSummary(worktree.worktreePath, run.baseBranch);
      this.emit({ type: "status", payload: { phase: "verified", diffStat: summary.slice(0, 2000) } });

      const dirty = await hasUncommittedChanges(worktree.worktreePath);
      if (!summary && !dirty) {
        // Nothing to publish — report the conversational result and finish.
        await this.flushEvents();
        await plane.updateRunStatus(run.runId, run.claimToken, "in_review", {
          resultSummary: turn.resultText?.slice(0, 4000) ?? "Run completed with no code changes.",
          verificationSummary: "no changes",
        });
        return;
      }

      // Publishing gate: explicit approval before the first push/PR.
      await plane.updateRunStatus(run.runId, run.claimToken, "awaiting_publish_approval");
      const publishRequestId = `publish-${run.runId}-attempt-${run.attempt}`;
      await plane.requestApproval(run.runId, run.claimToken, {
        harnessRequestId: publishRequestId,
        kind: "push",
        title: `Push ${worktree.branchName} and open a PR`,
        explanation: turn.resultText?.slice(0, 1000),
        details: { branch: worktree.branchName, diffStat: summary.slice(0, 2000) },
      });
      const publishDecision = await plane.awaitApproval(run.runId, publishRequestId, {
        signal: this.abort.signal,
      });
      if (publishDecision !== "accepted") {
        await this.flushEvents();
        await plane.updateRunStatus(
          run.runId,
          run.claimToken,
          publishDecision === "cancelled" ? "cancelled" : "in_review",
          {
            resultSummary:
              publishDecision === "declined"
                ? "Work complete on the local branch; publish was declined."
                : (turn.resultText?.slice(0, 4000) ?? "Run cancelled."),
            verificationSummary: summary.slice(0, 2000),
          },
        );
        return;
      }

      await plane.updateRunStatus(run.runId, run.claimToken, "publishing");
      await pushBranch(worktree.worktreePath, worktree.branchName);
      const prUrl = await createOrUpdatePr({
        worktreePath: worktree.worktreePath,
        baseBranch: run.baseBranch,
        title: run.project.title ? `Agent: ${run.project.title}` : `Agent work on ${worktree.branchName}`,
        body: `${turn.resultText ?? "Automated agent work."}\n\n---\nRun ${run.runId} (attempt ${run.attempt}) via Skippy agent workbench.`,
      });

      await this.flushEvents();
      await plane.updateRunStatus(run.runId, run.claimToken, "in_review", {
        resultSummary: turn.resultText?.slice(0, 4000) ?? "Branch pushed.",
        verificationSummary: summary.slice(0, 2000),
        ...(prUrl ? { prUrl, resultUrl: prUrl } : {}),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[skippy-runner] run ${run.runId} failed:`, error);
      this.emit({ type: "error", payload: { message: message.slice(0, 500) } });
      await this.flushEvents();
      await plane
        .updateRunStatus(run.runId, run.claimToken, "failed", {
          errorCategory: "runner",
          errorMessage: message.slice(0, 500),
        })
        .catch(() => {});
    } finally {
      clearInterval(flusher);
      clearInterval(controlWatcher);
      await this.flushEvents();
    }
  }
}

function buildPrompt(run: ClaimedRun): string {
  const lines = [
    "You are executing a Skippy task inside a dedicated git worktree.",
    "Stay inside the worktree; never push, merge, or deploy — the runner handles publishing after approval.",
    "",
  ];
  if (run.executionBrief) {
    lines.push("## Task brief", run.executionBrief, "");
  } else {
    lines.push("## Task", run.project.title ?? "Complete the requested work.", "");
  }
  if (run.acceptanceCriteria?.length) {
    lines.push("## Acceptance criteria", ...run.acceptanceCriteria.map((c) => `- ${c}`), "");
  }
  lines.push("When the work is complete, summarize what changed and how you verified it.");
  return lines.join("\n");
}
