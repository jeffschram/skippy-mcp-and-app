/**
 * Git worktree management. One worktree + branch per code-changing chat/run;
 * concurrent runs never share a mutable checkout.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  worktreePath: string;
  branchName: string;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

export function slugify(text: string, maxLength = 40): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxLength)
      .replace(/-+$/g, "") || "task"
  );
}

/**
 * Reject any path outside the runner's allowed root AFTER resolving symlinks.
 * Project selection is an authorization boundary, not a UI hint.
 */
export function assertInsideAllowedRoot(candidate: string, allowedRoot: string): string {
  const resolvedRoot = fs.realpathSync(allowedRoot);
  const resolved = fs.existsSync(candidate) ? fs.realpathSync(candidate) : path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`path ${candidate} escapes allowed root ${allowedRoot}`);
  }
  return resolved;
}

export async function assertGitRepo(repoPath: string): Promise<void> {
  const kind = await git(repoPath, "rev-parse", "--is-inside-work-tree").catch(() => "");
  if (kind !== "true") throw new Error(`${repoPath} is not a git repository`);
}

/**
 * Create (or reuse) the dedicated worktree and branch for a run. Reuse only
 * happens when both the worktree directory and its branch already exist —
 * that is the resume path for an interrupted run of the same chat.
 */
export async function ensureWorktree(options: {
  repoPath: string;
  worktreeRoot: string;
  baseBranch: string;
  branchName: string;
}): Promise<WorktreeInfo> {
  const { repoPath, worktreeRoot, baseBranch, branchName } = options;
  const worktreePath = path.join(worktreeRoot, branchName.replace(/\//g, "-"));

  if (fs.existsSync(path.join(worktreePath, ".git"))) {
    const current = await git(worktreePath, "rev-parse", "--abbrev-ref", "HEAD");
    if (current !== branchName) {
      throw new Error(`worktree ${worktreePath} is on ${current}, expected ${branchName}`);
    }
    return { worktreePath, branchName };
  }

  fs.mkdirSync(worktreeRoot, { recursive: true });
  await git(repoPath, "fetch", "origin", baseBranch).catch(() => {
    // Offline or no remote: branch from the local base instead.
  });
  const startPoint = await git(repoPath, "rev-parse", "--verify", `origin/${baseBranch}`)
    .then(() => `origin/${baseBranch}`)
    .catch(() => baseBranch);

  const branchExists = await git(repoPath, "rev-parse", "--verify", `refs/heads/${branchName}`)
    .then(() => true)
    .catch(() => false);
  if (branchExists) {
    await git(repoPath, "worktree", "add", worktreePath, branchName);
  } else {
    await git(repoPath, "worktree", "add", "-b", branchName, worktreePath, startPoint);
  }
  return { worktreePath, branchName };
}

export interface ProvisionResult {
  status: "provisioned" | "skipped" | "failed";
  message: string;
  durationMs: number;
}

const PROVISION_TIMEOUT_MS = 10 * 60 * 1000;

/** Minimal exec surface so tests can stub the package-manager invocation. */
export type ProvisionExec = (
  file: string,
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv },
) => Promise<unknown>;

/**
 * Provision a freshly created worktree before the harness session starts:
 * `corepack pnpm install` (frozen lockfile when one exists) so node_modules
 * is present and sessions never improvise package-manager bootstraps
 * (2026-08-21 six-gate autopsy: bare worktrees are why runs reached for
 * `npx --yes pnpm@8.10.2` and PATH exports, which a prefix allowlist cannot
 * anticipate). `corepack` honors the repo's pinned `packageManager` field,
 * so no version is hardcoded here.
 *
 * Never throws: a provisioning failure degrades to the old behavior (the
 * agent improvises and command gates fire) instead of failing the run.
 */
export async function provisionWorktree(
  worktreePath: string,
  exec: ProvisionExec = execFileAsync,
): Promise<ProvisionResult> {
  const startedAt = Date.now();
  if (!fs.existsSync(path.join(worktreePath, "package.json"))) {
    return { status: "skipped", message: "no package.json in worktree; nothing to install", durationMs: 0 };
  }
  const hasLockfile = fs.existsSync(path.join(worktreePath, "pnpm-lock.yaml"));
  const args = ["pnpm", "install", ...(hasLockfile ? ["--frozen-lockfile"] : [])];
  try {
    await exec("corepack", args, {
      cwd: worktreePath,
      timeout: PROVISION_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
      // Never let corepack block provisioning on an interactive
      // "download pnpm@x.y.z?" confirmation under launchd.
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
    });
    return {
      status: "provisioned",
      message: `corepack ${args.join(" ")}`,
      durationMs: Date.now() - startedAt,
    };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      message: `corepack ${args.join(" ")} failed: ${detail}`.slice(0, 500),
      durationMs: Date.now() - startedAt,
    };
  }
}

/** True when the worktree has uncommitted or untracked changes. */
export async function hasUncommittedChanges(worktreePath: string): Promise<boolean> {
  const status = await git(worktreePath, "status", "--porcelain");
  return status.length > 0;
}

export async function commitAll(worktreePath: string, message: string): Promise<string | null> {
  if (!(await hasUncommittedChanges(worktreePath))) return null;
  await git(worktreePath, "add", "-A");
  await git(worktreePath, "commit", "-m", message);
  return git(worktreePath, "rev-parse", "HEAD");
}

export async function pushBranch(worktreePath: string, branchName: string): Promise<void> {
  await git(worktreePath, "push", "-u", "origin", branchName);
}

export async function diffSummary(worktreePath: string, baseBranch: string): Promise<string> {
  return git(worktreePath, "diff", "--stat", `${baseBranch}...HEAD`).catch(() => "");
}

/**
 * Create or update the PR for a pushed branch using the gh CLI.
 * Returns the PR URL, or null when gh is unavailable.
 */
export async function createOrUpdatePr(options: {
  worktreePath: string;
  baseBranch: string;
  title: string;
  body: string;
}): Promise<string | null> {
  const { worktreePath, baseBranch, title, body } = options;
  try {
    const existing = await execFileAsync("gh", ["pr", "view", "--json", "url", "-q", ".url"], {
      cwd: worktreePath,
    }).then(
      (r) => r.stdout.trim(),
      () => null,
    );
    if (existing) return existing;
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "create", "--base", baseBranch, "--title", title, "--body", body],
      { cwd: worktreePath },
    );
    const url = stdout.trim().split("\n").pop() ?? "";
    return url.startsWith("http") ? url : null;
  } catch {
    return null;
  }
}
