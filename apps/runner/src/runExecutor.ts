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

      await plane.updateRunStatus(run.runId, run.claimToken, "verifying");
      await commitAll(worktree.worktreePath, `Agent work for ${run.project.title ?? "task"}`);
      const summary = await diffSummary(worktree.worktreePath, run.baseBranch);

      // Project-configured verification (e.g. "pnpm typecheck && pnpm test"),
      // run inside the worktree. A failure does not kill the run — the result
      // goes to the user on the publish approval, and they decide.
      let verifyLine = "no verify command configured";
      if (run.verifyCommand) {
        const verify = await runVerifyCommand(run.verifyCommand, worktree.worktreePath);
        verifyLine = verify.passed
          ? `verify PASSED: ${run.verifyCommand}`
          : `verify FAILED (exit ${verify.exitCode}): ${run.verifyCommand}\n${verify.outputTail}`;
        this.emit({
          type: "command_result",
          payload: {
            command: run.verifyCommand,
            exitCode: verify.exitCode,
            durationMs: verify.durationMs,
            outputTail: verify.outputTail,
            phase: "verify",
          },
        });
      }
      this.emit({ type: "status", payload: { phase: "verified", diffStat: summary.slice(0, 2000), verifyLine } });

      const dirty = await hasUncommittedChanges(worktree.worktreePath);
      if (!summary && !dirty) {
        // Nothing to publish — report the conversational result and finish.
        await this.flushEvents();
        await plane.updateRunStatus(run.runId, run.claimToken, "in_review", {
          resultSummary: turn.resultText?.slice(0, 4000) ?? "Run completed with no code changes.",
          verificationSummary: `no changes · ${verifyLine}`.slice(0, 2000),
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
        details: {
          branch: worktree.branchName,
          diffStat: summary.slice(0, 2000),
          verification: verifyLine.slice(0, 2000),
        },
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
            verificationSummary: `${verifyLine}\n${summary}`.slice(0, 2000),
          },
        );
        return;
      }

      await plane.updateRunStatus(run.runId, run.claimToken, "publishing");
      // A publish failure must not fail the run: the work is committed on the
      // branch, so preserve it, finish In Review, and record the error so the
      // user can fix the remote and retry.
      let prUrl: string | null = null;
      let publishError: string | null = null;
      try {
        await pushBranch(worktree.worktreePath, worktree.branchName);
        prUrl = await createOrUpdatePr({
          worktreePath: worktree.worktreePath,
          baseBranch: run.baseBranch,
          title: run.project.title ? `Agent: ${run.project.title}` : `Agent work on ${worktree.branchName}`,
          body: `${turn.resultText ?? "Automated agent work."}\n\n---\nRun ${run.runId} (attempt ${run.attempt}) via Skippy agent workbench.`,
        });
      } catch (error: unknown) {
        publishError = (error instanceof Error ? error.message : String(error)).slice(0, 400);
        this.emit({ type: "error", payload: { phase: "publish", message: publishError } });
      }

      await this.flushEvents();
      await plane.updateRunStatus(run.runId, run.claimToken, "in_review", {
        resultSummary: publishError
          ? `Work is committed on ${worktree.branchName}, but publishing failed. Fix the remote and re-execute to retry the push.`
          : (turn.resultText?.slice(0, 4000) ?? "Branch pushed."),
        verificationSummary: `${verifyLine}\n${summary}`.slice(0, 2000),
        ...(prUrl ? { prUrl, resultUrl: prUrl } : {}),
        ...(publishError ? { errorCategory: "publish", errorMessage: publishError } : {}),
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

const VERIFY_TIMEOUT_MS = 10 * 60 * 1000;
const VERIFY_OUTPUT_TAIL_CHARS = 1500;

async function runVerifyCommand(
  command: string,
  cwd: string,
): Promise<{ passed: boolean; exitCode: number; durationMs: number; outputTail: string }> {
  const { execFile } = await import("node:child_process");
  const startedAt = Date.now();
  return new Promise((resolve) => {
    execFile(
      "bash",
      ["-lc", command],
      { cwd, timeout: VERIFY_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const combined = `${stdout}\n${stderr}`.trim();
        // error.code is a number for non-zero exits, a string (e.g. ETIMEDOUT)
        // for spawn/timeout failures.
        const rawCode = (error as { code?: number | string } | null)?.code;
        resolve({
          passed: !error,
          exitCode: error ? (typeof rawCode === "number" ? rawCode : 1) : 0,
          durationMs: Date.now() - startedAt,
          outputTail: combined.slice(-VERIFY_OUTPUT_TAIL_CHARS),
        });
      },
    );
  });
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
