/**
 * Post-merge close-out executor: the scripted ritual that used to happen
 * manually in chat after every merged PR (#116–#124). Deterministic checklist,
 * no LLM session — this is a checklist, not a judgment call:
 *
 *   1. verify the PR is actually merged (gh; refuse politely if not)
 *   2. git pull --ff-only in the canonical checkout
 *   3. Convex deploy — SKIPPED: owned by the convex-deploy.yml GitHub Action
 *   4. if the PR touched apps/runner/**: rebuild and schedule a DEFERRED,
 *      DETACHED runner restart (sleep + launchctl kickstart) — this executor
 *      runs inside the runner process, so an inline restart would kill the
 *      job before it finishes reporting
 *   5. remove the task's worktree and delete the agent branch
 *   6. report completed — the control plane marks the task done with
 *      prStatus "merged" (recordTaskResult semantics)
 *
 * Every step reports structured progress to the maintenance job so the task
 * panel renders it like run narration. A failed step reports `failed` with
 * the error visible and stops: the task stays in_review, never a silent
 * half-done state.
 */
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { RunnerConfig } from "./config.js";
import type { ClaimedMaintenanceJob, MaintenanceStep } from "./controlPlane.js";
import { assertGitRepo, assertInsideAllowedRoot } from "./worktree.js";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 5 * 60 * 1000;
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

/** Grace before launchctl kickstarts the runner, so the close-out's terminal
 * control-plane report (and this process's bookkeeping) always lands first. */
export const RESTART_DELAY_SECONDS = 15;

/** Minimal exec surface so tests can stub every external command. */
export type CloseoutExec = (
  file: string,
  args: string[],
  options: { cwd: string; timeout?: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

/** The only control-plane surface the executor needs. */
export interface CloseoutPlane {
  updateMaintenanceJob(
    jobId: string,
    claimToken: string,
    patch: {
      status?: "running" | "completed" | "failed";
      steps?: MaintenanceStep[];
      errorMessage?: string;
      resultSummary?: string;
    },
  ): Promise<{ jobId: string; status: string }>;
}

export interface CloseoutDeps {
  exec: CloseoutExec;
  /** Launch a detached shell command that survives this process's death —
   * the deferred runner restart. */
  scheduleDetached: (command: string) => void;
}

/** The deferred/detached restart: sleep first so the runner finishes its
 * bookkeeping, then kickstart -k restarts the launchd service. */
export function buildRestartCommand(uid: number, label: string): string {
  return `sleep ${RESTART_DELAY_SECONDS} && /bin/launchctl kickstart -k gui/${uid}/${label}`;
}

/**
 * Find the worktree path registered for a branch in
 * `git worktree list --porcelain` output (blank-line-separated blocks of
 * `worktree <path>` / `branch refs/heads/<name>` lines).
 */
export function findWorktreeForBranch(porcelain: string, branchName: string): string | null {
  let currentPath: string | null = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) currentPath = line.slice("worktree ".length).trim();
    else if (line.startsWith("branch ") && line.slice("branch ".length).trim() === `refs/heads/${branchName}`) {
      return currentPath;
    } else if (line.trim() === "") currentPath = null;
  }
  return null;
}

/** True when any of the merged PR's files live under apps/runner/. */
export function prTouchesRunner(files: string[]): boolean {
  return files.some((file) => file === "apps/runner" || file.startsWith("apps/runner/"));
}

const defaultDeps: CloseoutDeps = {
  exec: async (file, args, options) => {
    const { stdout, stderr } = await execFileAsync(file, args, {
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
      ...options,
    });
    return { stdout: String(stdout), stderr: String(stderr) };
  },
  scheduleDetached: (command) => {
    // nohup-equivalent: detached session, no stdio, unref'd so this process
    // can exit (or be killed by the restart) without reaping the child.
    const child = spawn("/bin/sh", ["-c", command], { detached: true, stdio: "ignore" });
    child.unref();
  },
};

function errorMessageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/** Execute one claimed post-merge close-out job end to end. */
export async function executeCloseoutJob(
  config: Pick<RunnerConfig, "allowedRoot" | "launchdLabel">,
  plane: CloseoutPlane,
  job: ClaimedMaintenanceJob,
  deps: CloseoutDeps = defaultDeps,
): Promise<void> {
  // Work on a local copy of the server-seeded checklist; statuses are updated
  // by key and the whole array rides along on every progress report.
  const steps: MaintenanceStep[] = (job.steps ?? []).map((step) => ({ ...step }));
  const setStep = (key: string, status: MaintenanceStep["status"], detail?: string) => {
    const existing = steps.find((step) => step.key === key);
    if (existing) {
      existing.status = status;
      if (detail !== undefined) existing.detail = detail;
    } else {
      steps.push({ key, label: key, status, ...(detail !== undefined ? { detail } : {}) });
    }
  };
  const report = (patch: { status?: "running" | "completed" | "failed"; errorMessage?: string; resultSummary?: string }) =>
    plane.updateMaintenanceJob(job.jobId, job.claimToken, { steps, ...patch });

  /** Run one checklist step. A thrown error marks the step failed, reports
   * the job failed with the message visible, and halts the ritual. */
  const runStep = async (
    key: string,
    fn: () => Promise<{ status: "ok" | "skipped"; detail?: string }>,
  ): Promise<boolean> => {
    setStep(key, "running");
    await report({ status: "running" });
    try {
      const outcome = await fn();
      setStep(key, outcome.status, outcome.detail);
      await report({ status: "running" });
      return true;
    } catch (error) {
      const message = errorMessageOf(error);
      setStep(key, "failed", message);
      await report({ status: "failed", errorMessage: message });
      return false;
    }
  };

  try {
    // Authorization boundary first — same contract as RunExecutor.
    let repoPath: string;
    try {
      repoPath = assertInsideAllowedRoot(job.project.localPath, config.allowedRoot);
      await assertGitRepo(repoPath);
    } catch (error) {
      const message = errorMessageOf(error);
      setStep("verify_merged", "failed", message);
      await report({ status: "failed", errorMessage: message });
      return;
    }

    // 1. Verify the PR is actually merged; also collect its changed files
    //    for the runner-rebuild decision (one gh call for both).
    let prFiles: string[] = [];
    const verified = await runStep("verify_merged", async () => {
      const prRef = job.prUrl ?? (job.prNumber !== undefined ? String(job.prNumber) : undefined);
      if (!prRef) throw new Error("No pull request recorded on this task; nothing to close out.");
      const { stdout } = await deps.exec(
        "gh",
        ["pr", "view", prRef, "--json", "state,mergedAt,files"],
        { cwd: repoPath, timeout: GIT_TIMEOUT_MS },
      );
      const pr = JSON.parse(stdout) as { state?: string; mergedAt?: string; files?: Array<{ path?: string }> };
      const state = String(pr.state ?? "").toUpperCase();
      if (state !== "MERGED") {
        // The polite refusal: nothing has been touched yet; merge and retry.
        throw new Error(
          `PR is not merged yet (state: ${state.toLowerCase() || "unknown"}). Merge it on GitHub, then run close-out again.`,
        );
      }
      prFiles = (pr.files ?? []).map((file) => String(file.path ?? "")).filter(Boolean);
      return { status: "ok" as const, detail: pr.mergedAt ? `Merged at ${pr.mergedAt}` : "Merged" };
    });
    if (!verified) return;

    // 2. Pull main in the canonical checkout. --ff-only: a canonical checkout
    //    that cannot fast-forward is a problem a human should look at.
    const pulled = await runStep("pull_main", async () => {
      const { stdout: branchOut } = await deps.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: repoPath,
        timeout: GIT_TIMEOUT_MS,
      });
      const currentBranch = branchOut.trim();
      if (currentBranch !== job.baseBranch) {
        throw new Error(
          `Canonical checkout is on '${currentBranch}', expected '${job.baseBranch}' — not pulling. Check it out manually, then retry.`,
        );
      }
      const { stdout } = await deps.exec("git", ["pull", "--ff-only", "origin", job.baseBranch], {
        cwd: repoPath,
        timeout: GIT_TIMEOUT_MS,
      });
      const lastLine = (stdout.trim().split("\n").pop() ?? "").slice(0, 200);
      return { status: "ok" as const, ...(lastLine ? { detail: lastLine } : {}) };
    });
    if (!pulled) return;

    // 3. Convex deploy is owned by the convex-deploy.yml GitHub Action.
    setStep("convex_deploy", "skipped", "Handled by the convex-deploy GitHub Action on merge to main.");

    // 4. Conditional runner rebuild. The restart itself is scheduled AFTER the
    //    job completes (see below) so this process survives its own close-out.
    let restartNeeded = false;
    const rebuilt = await runStep("runner_rebuild", async () => {
      if (!prTouchesRunner(prFiles)) {
        return { status: "skipped" as const, detail: "PR did not touch apps/runner/**." };
      }
      await deps.exec("corepack", ["pnpm", "install", "--frozen-lockfile"], {
        cwd: repoPath,
        timeout: BUILD_TIMEOUT_MS,
      });
      await deps.exec("corepack", ["pnpm", "--filter", "@skippy/runner", "build"], {
        cwd: repoPath,
        timeout: BUILD_TIMEOUT_MS,
      });
      restartNeeded = true;
      return {
        status: "ok" as const,
        detail: `Rebuilt; deferred restart scheduled ${RESTART_DELAY_SECONDS}s after close-out completes.`,
      };
    });
    if (!rebuilt) return;

    // 5. Remove the task's worktree and delete the agent branch. Idempotent:
    //    already-gone artifacts are noted, not errors.
    const cleaned = await runStep("cleanup", async () => {
      const branch = job.gitBranchName;
      if (!branch) return { status: "skipped" as const, detail: "No agent branch recorded; nothing to clean up." };
      const notes: string[] = [];
      const { stdout: porcelain } = await deps.exec("git", ["worktree", "list", "--porcelain"], {
        cwd: repoPath,
        timeout: GIT_TIMEOUT_MS,
      });
      const worktreePath = findWorktreeForBranch(porcelain, branch);
      if (worktreePath && path.resolve(worktreePath) !== path.resolve(repoPath)) {
        // --force: the PR is merged, so anything left in the worktree
        // (node_modules, stray untracked files) is disposable.
        await deps.exec("git", ["worktree", "remove", "--force", worktreePath], {
          cwd: repoPath,
          timeout: GIT_TIMEOUT_MS,
        });
        notes.push(`removed worktree ${worktreePath}`);
      } else {
        notes.push("no worktree found for branch");
      }
      await deps
        .exec("git", ["worktree", "prune"], { cwd: repoPath, timeout: GIT_TIMEOUT_MS })
        .catch(() => undefined);
      const branchExists = await deps
        .exec("git", ["rev-parse", "--verify", `refs/heads/${branch}`], { cwd: repoPath, timeout: GIT_TIMEOUT_MS })
        .then(
          () => true,
          () => false,
        );
      if (branchExists) {
        // -D: squash/merge-commit merges mean the local branch may not read
        // as merged by ancestry; the PR merge is the source of truth here.
        await deps.exec("git", ["branch", "-D", branch], { cwd: repoPath, timeout: GIT_TIMEOUT_MS });
        notes.push(`deleted branch ${branch}`);
      } else {
        notes.push("local branch already gone");
      }
      return { status: "ok" as const, detail: notes.join("; ") };
    });
    if (!cleaned) return;

    // 6. Report completed — the control plane marks the task done with
    //    prStatus "merged" atomically in the same mutation.
    setStep("finalize", "ok", "Task marked done; PR recorded as merged.");
    const prLabel = job.prNumber !== undefined ? `PR #${job.prNumber}` : "PR";
    const resultSummary = [
      `Close-out complete: ${prLabel} merged`,
      `${job.baseBranch} pulled`,
      ...(restartNeeded ? ["runner rebuilt (deferred restart scheduled)"] : []),
      "worktree and branch cleaned up",
    ].join("; ");
    await report({ status: "completed", resultSummary });

    // Only after the completion report landed: schedule the detached restart
    // so the task is never left half-done by our own kickstart.
    if (restartNeeded) {
      const uid = typeof process.getuid === "function" ? process.getuid() : 0;
      deps.scheduleDetached(buildRestartCommand(uid, config.launchdLabel));
    }
  } catch (error) {
    // Backstop for anything that escaped a step (including report failures):
    // best-effort terminal failure so nothing looks half-done silently.
    const message = errorMessageOf(error);
    const running = steps.find((step) => step.status === "running");
    if (running) setStep(running.key, "failed", message);
    await report({ status: "failed", errorMessage: message }).catch(() => {});
  }
}
