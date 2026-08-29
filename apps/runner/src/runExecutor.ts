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
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { collectArtifacts, materializeManifest } from "./fileWorkspace.js";
import {
  assertGitRepo,
  assertInsideAllowedRoot,
  commitAll,
  createOrUpdatePr,
  diffSummary,
  ensureWorktree,
  hasUncommittedChanges,
  provisionWorktree,
  pushBranch,
  slugify,
} from "./worktree.js";
import { accumulateUsage, normalizeUsage, type TokenUsage } from "./usage.js";

const EVENT_FLUSH_INTERVAL_MS = 1_500;
const CONTROL_POLL_INTERVAL_MS = 3_000;

export class RunExecutor {
  private seq = 0;
  private pendingEvents: Array<{ seq: number; type: string; payload?: unknown }> = [];
  private abort = new AbortController();
  /**
   * Set when an approval wait exceeded config.approvalTimeoutMs. Recorded so
   * the run fails with an explicit `approval timed out: <command>` instead of
   * the opaque teardown message (exit 143) run qx719evfy produced.
   */
  private approvalTimedOutCommand: string | undefined;
  /** Session token totals, accumulated from harness usage events
   * (docs/token-efficiency.md lever 1) and persisted onto the run. */
  private usageTotal: TokenUsage | undefined;

  constructor(
    private config: RunnerConfig,
    private plane: ControlPlane,
    private run: ClaimedRun,
    private adapter: HarnessAdapter,
  ) {}

  private emit(event: HarnessEvent) {
    if (event.type === "usage") {
      const sample = normalizeUsage((event.payload as { usage?: unknown } | undefined)?.usage);
      if (sample) this.usageTotal = accumulateUsage(this.usageTotal, sample);
      // Still forwarded below: agentRunEvents keeps the raw per-turn samples.
    }
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
      const branchName =
        run.branchName ??
        (run.taskId ? `agent/task-${run.taskId.slice(-8)}-${slugify(run.project.title ?? "task")}` : `agent/chat-${run.chatId.slice(-8)}`);
      let worktree: { worktreePath: string; branchName: string };
      if ((run.workspaceMode ?? "code") === "temporary") {
        await fsp.mkdir(config.worktreeRoot, { recursive: true });
        worktree = { worktreePath: await fsp.mkdtemp(path.join(config.worktreeRoot, `run-${run.runId.slice(-8)}-`)), branchName };
      } else {
        if (!run.project.localPath) throw new Error("code project has no repository checkout on this host");
        const repoPath = assertInsideAllowedRoot(run.project.localPath, config.allowedRoot);
        await assertGitRepo(repoPath);
        worktree = await ensureWorktree({ repoPath, worktreeRoot: config.worktreeRoot, baseBranch: run.baseBranch, branchName });
      }
      // Provision dependencies BEFORE the harness session starts, so runs
      // never rediscover the environment and improvise package-manager
      // bootstraps (2026-08-21 six-gate autopsy). A failure degrades
      // gracefully: the run continues against a bare worktree and any
      // improvised commands hit the normal approval gates.
      this.emit({ type: "status", payload: { phase: "provisioning", worktreePath: worktree.worktreePath } });
      await this.flushEvents(); // install can take minutes; show narration now
      const provision = (run.workspaceMode ?? "code") === "temporary"
        ? { status: "skipped" as const, message: "temporary non-code workspace", durationMs: 0 }
        : await provisionWorktree(worktree.worktreePath);
      if (provision.status === "failed") {
        this.emit({ type: "error", payload: { phase: "provisioning", message: provision.message } });
      }
      this.emit({
        type: "status",
        payload: {
          phase: "worktree_ready",
          ...worktree,
          provisioning: provision.status,
          provisioningDetail: provision.message,
          provisioningDurationMs: provision.durationMs,
        },
      });
      await plane.updateRunStatus(run.runId, run.claimToken, "running", {
        workingBranch: worktree.branchName,
        worktreePath: worktree.worktreePath,
      });

      const materialized = await materializeManifest(worktree.worktreePath, run.inputManifest ?? []);
      const outputRoot = path.join(worktree.worktreePath, ".skippy", "outputs");
      await fsp.mkdir(outputRoot, { recursive: true, mode: 0o700 });
      const prompt = buildPrompt(run, materialized.inputRoot, outputRoot, materialized.files);
      const turn = await this.adapter.runTurn({
        prompt,
        worktreePath: worktree.worktreePath,
        model: run.model,
        mcpToken: config.skippyMcpTaskToken,
        signal: this.abort.signal,
        onEvent: (event) => this.emit(event),
        requestApproval: async (approval) => {
          await plane.requestApproval(run.runId, run.claimToken, approval);
          const decision = await plane.awaitApproval(run.runId, approval.harnessRequestId, {
            signal: this.abort.signal,
            timeoutMs: config.approvalTimeoutMs,
          });
          if (decision === "timed_out") {
            // The explicit approval timeout (config.approvalTimeoutMs). Mark
            // the approval doc cancelled with a reason, remember the command
            // for the run's errorMessage, and tear the turn down cleanly.
            const command =
              typeof (approval.details as Record<string, unknown> | undefined)?.command === "string"
                ? String((approval.details as Record<string, unknown>).command)
                : approval.title;
            this.approvalTimedOutCommand = command.slice(0, 400);
            await plane
              .cancelApproval(
                run.runId,
                run.claimToken,
                approval.harnessRequestId,
                `approval timed out after ${Math.round(config.approvalTimeoutMs / 60_000)} min without a decision`,
              )
              .catch(() => {});
            this.emit({
              type: "error",
              payload: { message: `approval timed out: ${this.approvalTimedOutCommand}`, phase: "approval_timeout" },
            });
            this.abort.abort();
            return decision;
          }
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

      if (turn.externalThreadId || this.usageTotal) {
        // Self-transition metadata update: session id + token totals recorded
        // regardless of which terminal status the run ends in.
        await plane.updateRunStatus(run.runId, run.claimToken, "running", {
          ...(turn.externalThreadId ? { externalThreadId: turn.externalThreadId } : {}),
          ...(this.usageTotal ? { usage: this.usageTotal } : {}),
        });
      }
      if (this.approvalTimedOutCommand) {
        // Approval-timeout ergonomics: an explicit, greppable failure instead
        // of the opaque "harness exited with code 143" the teardown produces.
        await this.flushEvents();
        await plane.updateRunStatus(run.runId, run.claimToken, "failed", {
          errorCategory: "approval_timeout",
          errorMessage: `approval timed out: ${this.approvalTimedOutCommand}`.slice(0, 500),
        });
        return;
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

      try {
        await uploadRunArtifacts(plane, run, outputRoot);
      } catch (error) {
        await this.flushEvents();
        await plane.updateRunStatus(run.runId, run.claimToken, "failed", { errorCategory: "artifact_upload_failed", errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 500) });
        return;
      }

      if ((run.workspaceMode ?? "code") === "temporary") {
        await this.flushEvents();
        await plane.updateRunStatus(run.runId, run.claimToken, "in_review", { resultSummary: turn.resultText?.slice(0, 4000) ?? "Run completed.", verificationSummary: "non-code temporary workspace" });
        await fsp.rm(worktree.worktreePath, { recursive: true, force: true });
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
        timeoutMs: config.approvalTimeoutMs,
      });
      if (publishDecision === "timed_out") {
        await plane
          .cancelApproval(
            run.runId,
            run.claimToken,
            publishRequestId,
            `approval timed out after ${Math.round(config.approvalTimeoutMs / 60_000)} min without a decision`,
          )
          .catch(() => {});
        await this.flushEvents();
        await plane.updateRunStatus(run.runId, run.claimToken, "failed", {
          errorCategory: "approval_timeout",
          errorMessage: `approval timed out: push ${worktree.branchName} and open a PR`.slice(0, 500),
        });
        return;
      }
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
          title: prTitle(run, worktree.branchName),
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

/**
 * PR title for a published run. Uses the task's title so the GitHub PR list
 * stays scannable — every run titled with the project string ("Agent: Skippy
 * MCP and APP", PRs #117–#124) made the list unreadable. Falls back to the
 * project title for chat-scoped runs without a task, then the branch name.
 */
export function prTitle(
  run: Pick<ClaimedRun, "taskTitle"> & { project: Pick<ClaimedRun["project"], "title"> },
  branchName: string,
): string {
  const title = run.taskTitle?.trim() || run.project.title?.trim();
  return title ? `Agent: ${title}` : `Agent work on ${branchName}`;
}

function buildPrompt(run: ClaimedRun, inputRoot?: string, outputRoot?: string, files: Array<{ fileId: string; fileName: string; localPath?: string; required: boolean }> = []): string {
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
  if (inputRoot) lines.push("## Temporary cloud file workspace", "Convex projectFiles records are canonical. These paths are isolated disposable copies for this run.", `Input directory: ${inputRoot}`, ...files.map((file) => `- ${file.required ? "required" : "optional"} ${file.fileId}: ${file.localPath ?? file.fileName}`), "");
  if (outputRoot) lines.push("## Durable artifacts", `Write requested deliverables to ${outputRoot}. The runner uploads this directory after the harness exits; local paths are temporary and are never canonical.`, "");
  lines.push("When the work is complete, summarize what changed and how you verified it.");
  return lines.join("\n");
}

async function uploadRunArtifacts(plane: ControlPlane, run: ClaimedRun, outputRoot: string) {
  if (!run.outputPolicy?.enabled) return [];
  const artifacts = await collectArtifacts(outputRoot, { maxFiles: run.outputPolicy.maxFiles, maxFileBytes: run.outputPolicy.maxFileBytes, maxTotalBytes: run.outputPolicy.maxTotalBytes });
  if (run.outputPolicy.required && artifacts.length === 0) throw new Error("required artifact output directory is empty");
  const fileIds: string[] = [];
  for (const artifact of artifacts) {
    const begun = await plane.beginArtifactUpload(run.runId, run.claimToken, { ...artifact, required: run.outputPolicy.required });
    if (begun.status === "ready") { fileIds.push(begun.fileId); continue; }
    if (!begun.uploadUrl) throw new Error(`upload URL unavailable for artifact ${artifact.relativePath}`);
    const response = await fetch(begun.uploadUrl, { method: "POST", headers: { "Content-Type": artifact.mimeType }, body: Readable.toWeb(fs.createReadStream(artifact.absolutePath)) as any, duplex: "half" } as any);
    if (!response.ok) throw new Error(`artifact upload failed for ${artifact.relativePath} (HTTP ${response.status})`);
    const { storageId } = await response.json() as { storageId: string };
    await plane.finalizeArtifactUpload(run.runId, run.claimToken, { fileId: begun.fileId, storageId, sha256: artifact.sha256 }); fileIds.push(begun.fileId);
  }
  return fileIds;
}
