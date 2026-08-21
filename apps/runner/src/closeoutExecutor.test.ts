import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildRestartCommand,
  executeCloseoutJob,
  findWorktreeForBranch,
  prTouchesRunner,
  RESTART_DELAY_SECONDS,
  type CloseoutDeps,
  type CloseoutExec,
  type CloseoutPlane,
} from "./closeoutExecutor.js";
import type { ClaimedMaintenanceJob, MaintenanceStep } from "./controlPlane.js";

let tmpDir: string;
let repoPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skippy-closeout-test-"));
  repoPath = path.join(tmpDir, "repo");
  fs.mkdirSync(repoPath);
  // assertGitRepo runs real git against the repo path.
  execFileSync("git", ["init", "--quiet"], { cwd: repoPath });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Mirror of the server-seeded checklist (convex/agentWorkbench.ts CLOSEOUT_STEPS). */
function seededSteps(): MaintenanceStep[] {
  return [
    { key: "verify_merged", label: "Verify the PR is merged", status: "pending" },
    { key: "pull_main", label: "Pull latest main in the canonical checkout", status: "pending" },
    { key: "convex_deploy", label: "Convex deploy", status: "pending" },
    { key: "runner_rebuild", label: "Rebuild runner if it changed", status: "pending" },
    { key: "cleanup", label: "Remove worktree and delete agent branch", status: "pending" },
    { key: "finalize", label: "Mark task done (PR merged)", status: "pending" },
  ];
}

function makeJob(overrides: Partial<ClaimedMaintenanceJob> = {}): ClaimedMaintenanceJob {
  return {
    jobId: "job-1",
    claimToken: "claim-1",
    kind: "post_merge_closeout",
    taskId: "task-1",
    taskTitle: "Test task",
    prUrl: "https://github.com/o/r/pull/124",
    prNumber: 124,
    gitBranchName: "agent/task-abc-test",
    baseBranch: "main",
    steps: seededSteps(),
    project: { _id: "project-1", title: "Skippy", localPath: repoPath },
    ...overrides,
  };
}

type Reported = {
  status?: string;
  errorMessage?: string;
  resultSummary?: string;
  steps: MaintenanceStep[];
};

function makePlane(order?: string[]) {
  const reports: Reported[] = [];
  const plane: CloseoutPlane = {
    updateMaintenanceJob: async (_jobId, _claimToken, patch) => {
      // Deep-clone: the executor mutates the same steps array between calls.
      reports.push(JSON.parse(JSON.stringify(patch)));
      order?.push(`report:${patch.status ?? "progress"}`);
      return { jobId: "job-1", status: patch.status ?? "running" };
    },
  };
  return { plane, reports };
}

function stepIn(report: Reported, key: string): MaintenanceStep | undefined {
  return report.steps.find((step) => step.key === key);
}

/** Dispatcher-style exec stub; records every command line it sees. */
function makeExec(
  handle: (cmd: string) => string | Error | undefined,
): { exec: CloseoutExec; commands: string[] } {
  const commands: string[] = [];
  const exec: CloseoutExec = async (file, args) => {
    const cmd = [file, ...args].join(" ");
    commands.push(cmd);
    const result = handle(cmd);
    if (result instanceof Error) throw result;
    return { stdout: result ?? "", stderr: "" };
  };
  return { exec, commands };
}

const MERGED_PR = (files: string[]) =>
  JSON.stringify({
    state: "MERGED",
    mergedAt: "2026-08-21T12:00:00Z",
    files: files.map((p) => ({ path: p })),
  });

function porcelainWith(branch: string, worktreePath: string): string {
  return [
    `worktree ${repoPath}`,
    "HEAD aaaa",
    "branch refs/heads/main",
    "",
    `worktree ${worktreePath}`,
    "HEAD bbbb",
    `branch refs/heads/${branch}`,
    "",
  ].join("\n");
}

/** A dispatcher covering the whole happy path; tests override pieces. */
function happyPathHandler(options: {
  prFiles: string[];
  currentBranch?: string;
  worktreePresent?: boolean;
  branchPresent?: boolean;
}) {
  const branch = "agent/task-abc-test";
  const worktreePath = path.join(tmpDir, "worktrees", "agent-task-abc-test");
  return (cmd: string): string | Error | undefined => {
    if (cmd.startsWith("gh pr view")) return MERGED_PR(options.prFiles);
    if (cmd === "git rev-parse --abbrev-ref HEAD") return options.currentBranch ?? "main";
    if (cmd === "git pull --ff-only origin main") return "Already up to date.";
    if (cmd === "git worktree list --porcelain") {
      return options.worktreePresent === false ? `worktree ${repoPath}\nbranch refs/heads/main\n` : porcelainWith(branch, worktreePath);
    }
    if (cmd.startsWith("git worktree remove")) return "";
    if (cmd === "git worktree prune") return "";
    if (cmd === `git rev-parse --verify refs/heads/${branch}`) {
      return options.branchPresent === false ? new Error("unknown revision") : "bbbb";
    }
    if (cmd.startsWith("git branch -D")) return "";
    if (cmd.startsWith("corepack pnpm")) return "";
    return undefined;
  };
}

const config = () => ({ allowedRoot: tmpDir, launchdLabel: "com.skippy.runner" });

function makeDeps(exec: CloseoutExec, restarts?: string[], order?: string[]): CloseoutDeps {
  return {
    exec,
    scheduleDetached: (command) => {
      restarts?.push(command);
      order?.push("restart-scheduled");
    },
  };
}

describe("executeCloseoutJob", () => {
  it("refuses cleanly when the PR is not merged: job fails, nothing is touched", async () => {
    const { plane, reports } = makePlane();
    const { exec, commands } = makeExec((cmd) => {
      if (cmd.startsWith("gh pr view")) return JSON.stringify({ state: "OPEN", files: [] });
      return undefined;
    });
    await executeCloseoutJob(config(), plane, makeJob(), makeDeps(exec));

    const last = reports[reports.length - 1]!;
    expect(last.status).toBe("failed");
    expect(last.errorMessage).toContain("not merged");
    expect(last.errorMessage).toContain("state: open");
    expect(stepIn(last, "verify_merged")?.status).toBe("failed");
    // Later ritual steps never ran — task-side state is left untouched.
    expect(stepIn(last, "pull_main")?.status).toBe("pending");
    expect(stepIn(last, "cleanup")?.status).toBe("pending");
    expect(commands.some((cmd) => cmd.startsWith("git pull"))).toBe(false);
    expect(commands.some((cmd) => cmd.includes("worktree remove"))).toBe(false);
  });

  it("runs the full ritual and completes without a restart when the runner is untouched", async () => {
    const { plane, reports } = makePlane();
    const restarts: string[] = [];
    const { exec, commands } = makeExec(happyPathHandler({ prFiles: ["convex/projects.ts"] }));
    await executeCloseoutJob(config(), plane, makeJob(), makeDeps(exec, restarts));

    const last = reports[reports.length - 1]!;
    expect(last.status).toBe("completed");
    expect(last.resultSummary).toContain("PR #124 merged");
    expect(stepIn(last, "verify_merged")?.status).toBe("ok");
    expect(stepIn(last, "pull_main")?.status).toBe("ok");
    expect(stepIn(last, "convex_deploy")?.status).toBe("skipped");
    expect(stepIn(last, "runner_rebuild")?.status).toBe("skipped");
    expect(stepIn(last, "cleanup")?.status).toBe("ok");
    expect(stepIn(last, "cleanup")?.detail).toContain("removed worktree");
    expect(stepIn(last, "cleanup")?.detail).toContain("deleted branch agent/task-abc-test");
    expect(stepIn(last, "finalize")?.status).toBe("ok");

    expect(commands).toContain("git pull --ff-only origin main");
    expect(commands).toContain("git branch -D agent/task-abc-test");
    expect(commands.some((cmd) => cmd.startsWith("git worktree remove --force"))).toBe(true);
    // Runner untouched: no rebuild, no restart.
    expect(commands.some((cmd) => cmd.startsWith("corepack"))).toBe(false);
    expect(restarts).toHaveLength(0);
  });

  it("rebuilds the runner and schedules the deferred restart only after completion", async () => {
    const order: string[] = [];
    const { plane, reports } = makePlane(order);
    const restarts: string[] = [];
    const { exec, commands } = makeExec(happyPathHandler({ prFiles: ["apps/runner/src/main.ts"] }));
    await executeCloseoutJob(config(), plane, makeJob(), makeDeps(exec, restarts, order));

    expect(reports[reports.length - 1]!.status).toBe("completed");
    expect(commands).toContain("corepack pnpm install --frozen-lockfile");
    expect(commands).toContain("corepack pnpm --filter @skippy/runner build");
    expect(restarts).toHaveLength(1);
    expect(restarts[0]).toContain(`sleep ${RESTART_DELAY_SECONDS}`);
    expect(restarts[0]).toContain("launchctl kickstart -k gui/");
    expect(restarts[0]).toContain("com.skippy.runner");
    // Deferred/detached: the restart is scheduled AFTER the terminal report,
    // so the executing process survives long enough to finish the job.
    expect(order[order.length - 1]).toBe("restart-scheduled");
    expect(order[order.length - 2]).toBe("report:completed");
  });

  it("fails the job with the error visible when the pull fails, and stops there", async () => {
    const { plane, reports } = makePlane();
    const restarts: string[] = [];
    const { exec, commands } = makeExec((cmd) => {
      if (cmd.startsWith("gh pr view")) return MERGED_PR(["apps/runner/src/main.ts"]);
      if (cmd === "git rev-parse --abbrev-ref HEAD") return "main";
      if (cmd === "git pull --ff-only origin main") return new Error("fatal: Not possible to fast-forward");
      return undefined;
    });
    await executeCloseoutJob(config(), plane, makeJob(), makeDeps(exec, restarts));

    const last = reports[reports.length - 1]!;
    expect(last.status).toBe("failed");
    expect(last.errorMessage).toContain("fast-forward");
    expect(stepIn(last, "pull_main")?.status).toBe("failed");
    expect(stepIn(last, "runner_rebuild")?.status).toBe("pending");
    expect(stepIn(last, "cleanup")?.status).toBe("pending");
    expect(commands.some((cmd) => cmd.startsWith("corepack"))).toBe(false);
    expect(commands.some((cmd) => cmd.includes("worktree remove"))).toBe(false);
    expect(restarts).toHaveLength(0);
  });

  it("refuses to pull when the canonical checkout is not on the base branch", async () => {
    const { plane, reports } = makePlane();
    const { exec } = makeExec(happyPathHandler({ prFiles: [], currentBranch: "feature-x" }));
    await executeCloseoutJob(config(), plane, makeJob(), makeDeps(exec));

    const last = reports[reports.length - 1]!;
    expect(last.status).toBe("failed");
    expect(last.errorMessage).toContain("'feature-x'");
    expect(last.errorMessage).toContain("'main'");
    expect(stepIn(last, "pull_main")?.status).toBe("failed");
  });

  it("treats already-cleaned worktree/branch as notes, not errors", async () => {
    const { plane, reports } = makePlane();
    const { exec, commands } = makeExec(
      happyPathHandler({ prFiles: ["convex/schema.ts"], worktreePresent: false, branchPresent: false }),
    );
    await executeCloseoutJob(config(), plane, makeJob(), makeDeps(exec));

    const last = reports[reports.length - 1]!;
    expect(last.status).toBe("completed");
    expect(stepIn(last, "cleanup")?.status).toBe("ok");
    expect(stepIn(last, "cleanup")?.detail).toContain("no worktree found");
    expect(stepIn(last, "cleanup")?.detail).toContain("branch already gone");
    expect(commands.some((cmd) => cmd.includes("worktree remove"))).toBe(false);
    expect(commands.some((cmd) => cmd.startsWith("git branch -D"))).toBe(false);
  });

  it("skips cleanup when no agent branch was recorded", async () => {
    const { plane, reports } = makePlane();
    const { exec } = makeExec(happyPathHandler({ prFiles: [] }));
    const job = makeJob();
    delete (job as Partial<ClaimedMaintenanceJob>).gitBranchName;
    await executeCloseoutJob(config(), plane, job, makeDeps(exec));

    const last = reports[reports.length - 1]!;
    expect(last.status).toBe("completed");
    expect(stepIn(last, "cleanup")?.status).toBe("skipped");
  });

  it("fails fast when the project path escapes the allowed root", async () => {
    const { plane, reports } = makePlane();
    const { exec, commands } = makeExec(() => "");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "skippy-outside-"));
    try {
      const job = makeJob({ project: { _id: "project-1", localPath: outside } });
      await executeCloseoutJob(config(), plane, job, makeDeps(exec));
      const last = reports[reports.length - 1]!;
      expect(last.status).toBe("failed");
      expect(last.errorMessage).toContain("escapes allowed root");
      expect(commands).toHaveLength(0);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("findWorktreeForBranch", () => {
  it("finds the worktree registered for a branch", () => {
    const porcelain = porcelainWith("agent/task-abc-test", "/tmp/wt/agent-task-abc-test");
    expect(findWorktreeForBranch(porcelain, "agent/task-abc-test")).toBe("/tmp/wt/agent-task-abc-test");
  });

  it("returns null when the branch has no worktree", () => {
    const porcelain = porcelainWith("agent/task-other", "/tmp/wt/other");
    expect(findWorktreeForBranch(porcelain, "agent/task-abc-test")).toBeNull();
  });

  it("does not match branch names by prefix", () => {
    const porcelain = porcelainWith("agent/task-abc-test-2", "/tmp/wt/two");
    expect(findWorktreeForBranch(porcelain, "agent/task-abc-test")).toBeNull();
  });
});

describe("prTouchesRunner", () => {
  it("detects runner files", () => {
    expect(prTouchesRunner(["apps/runner/src/main.ts"])).toBe(true);
    expect(prTouchesRunner(["convex/schema.ts", "apps/runner/package.json"])).toBe(true);
  });

  it("ignores non-runner files (including lookalike prefixes)", () => {
    expect(prTouchesRunner(["convex/schema.ts", "apps/web/app/page.tsx"])).toBe(false);
    expect(prTouchesRunner(["apps/runner-docs/readme.md"])).toBe(false);
    expect(prTouchesRunner([])).toBe(false);
  });
});

describe("buildRestartCommand", () => {
  it("sleeps before kickstarting the right launchd service", () => {
    expect(buildRestartCommand(501, "com.skippy.runner")).toBe(
      `sleep ${RESTART_DELAY_SECONDS} && /bin/launchctl kickstart -k gui/501/com.skippy.runner`,
    );
  });
});
