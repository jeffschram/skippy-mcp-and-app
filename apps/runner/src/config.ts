/**
 * Runner configuration, all from environment. The runner is a trusted daemon
 * on the Mac mini running under a dedicated service account (launchd); see
 * docs/mac-mini-agent-workbench.md → Security model.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RunnerConfig {
  /** Convex deployment URL, e.g. https://xxx.convex.cloud */
  convexUrl: string;
  /** Revocable host credential minted by createHostForViewer. */
  hostToken: string;
  /** Stable host identifier (informational; the token identifies the host). */
  hostKey: string;
  /**
   * Canonical root all project checkouts and worktrees must live under.
   * Project selection is an authorization boundary — every localPath from the
   * control plane is re-validated against this root before use.
   */
  allowedRoot: string;
  /** Where per-run git worktrees are created. */
  worktreeRoot: string;
  /** Harnesses this machine can execute. */
  harnesses: Array<"codex" | "claude">;
  maxConcurrency: number;
  heartbeatIntervalMs: number;
  claimPollIntervalMs: number;
  /**
   * How long a code run waits on a pending approval before giving up
   * (SKIPPY_RUNNER_APPROVAL_TIMEOUT_MS). Historically this was implicit and
   * inconsistent: no lease or approval-age timeout existed anywhere (the
   * Convex claim lease renews on heartbeat while the run waits), so approvals
   * could pend forever — while unrelated harness teardowns made some waits
   * *look* like ~20-minute timeouts (run qx719evfy vs qx789s336). Now it is
   * explicit: on expiry the run fails with `approval timed out: <command>` and
   * the approval doc is cancelled with a reason. 0 disables the timeout
   * (wait forever). Default: 24 hours, so overnight approvals still work.
   */
  approvalTimeoutMs: number;
  /**
   * Skippy remote MCP endpoint injected into every harness session
   * (SKIPPY_MCP_URL / SKIPPY_MCP_TOKEN). Explicit injection replaces the old
   * reliance on host-level `claude mcp add -s user` registration in
   * ~/.claude.json, which silently disappeared on 2026-08-18 and left
   * sessions with zero mcp__skippy* tools. Required: a runner without the
   * Skippy MCP is misconfigured and should fail at startup, not mid-session.
   */
  skippyMcpUrl: string;
  /** Bearer token for the Skippy MCP endpoint. Comes from the daemon
   * environment only — never committed, never read from .env.local. */
  skippyMcpToken: string;
  /**
   * launchd service label for the runner itself, used by the post-merge
   * close-out job to schedule its deferred `launchctl kickstart -k` restart
   * (SKIPPY_RUNNER_LAUNCHD_LABEL). The restart is detached + delayed because
   * the close-out executor runs inside this very process.
   */
  launchdLabel: string;
  /**
   * Chat turns only: run the harness with permissions bypassed
   * (--dangerously-skip-permissions / --dangerously-bypass-approvals-and-sandbox).
   * No approval cards, no sandbox — every action executes immediately as this
   * user. Opt-in via SKIPPY_CHAT_BYPASS_PERMISSIONS=1; code runs are never
   * affected (their approval model, including the publish gate, stays).
   */
  chatBypassPermissions: boolean;
}

/**
 * Where `corepack enable` materializes pnpm shims for the runner. Kept under
 * the service account's home so no plist edit or sudo is ever needed.
 */
export const COREPACK_SHIM_DIR = path.join(os.homedir(), ".skippy-runner", "corepack-shims");

/**
 * Make pnpm (and node's own tooling) resolvable for every child this daemon
 * spawns — harness sessions, provisioning, verify commands — regardless of
 * the minimal PATH launchd hands us (the plist ships
 * PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin, which knows nothing
 * about nvm-installed node or corepack shims). Root cause of the 2026-08-21
 * six-gate autopsy: sessions could not resolve pnpm and improvised
 * (`npx --yes pnpm@8.10.2`, PATH exports), and improvised commands are what
 * a prefix allowlist cannot anticipate. Fixing PATH in code beats plist
 * edits: it applies on every start with no launchctl reload ritual.
 *
 * Mutates (by default) process.env so the SDK sessions, execFile calls, and
 * bash -lc verify commands all inherit it. Idempotent.
 */
export function extendRunnerPath(env: NodeJS.ProcessEnv = process.env): string {
  const nodeBinDir = path.dirname(process.execPath); // node, npm, npx, corepack
  const existing = (env.PATH ?? "").split(path.delimiter);
  const seen = new Set<string>();
  const merged = [COREPACK_SHIM_DIR, nodeBinDir, ...existing].filter((entry) => {
    if (!entry || seen.has(entry)) return false;
    seen.add(entry);
    return true;
  });
  env.PATH = merged.join(path.delimiter);
  // Never let corepack hang a headless daemon on an interactive download
  // confirmation.
  if (env.COREPACK_ENABLE_DOWNLOAD_PROMPT === undefined) env.COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";
  return env.PATH;
}

/**
 * Materialize corepack's pnpm/yarn shims into COREPACK_SHIM_DIR (already on
 * PATH via extendRunnerPath) so plain `pnpm typecheck` resolves inside
 * harness sessions. Best-effort: on failure the runner logs and continues —
 * provisioning still works via explicit `corepack pnpm …`, and sessions fall
 * back to the old improvise-and-gate behavior.
 */
export async function ensureCorepackShims(): Promise<{ ok: boolean; message: string }> {
  try {
    fs.mkdirSync(COREPACK_SHIM_DIR, { recursive: true });
    await execFileAsync("corepack", ["enable", "--install-directory", COREPACK_SHIM_DIR], {
      timeout: 60_000,
    });
    return { ok: true, message: `corepack shims ready in ${COREPACK_SHIM_DIR}` };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `corepack enable failed: ${detail}`.slice(0, 400) };
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

export function loadConfig(): RunnerConfig {
  const allowedRoot = path.resolve(required("SKIPPY_RUNNER_ALLOWED_ROOT"));
  const harnesses = (process.env.SKIPPY_RUNNER_HARNESSES ?? "claude")
    .split(",")
    .map((h) => h.trim())
    .filter((h): h is "codex" | "claude" => h === "codex" || h === "claude");
  if (!harnesses.length) throw new Error("SKIPPY_RUNNER_HARNESSES resolved to no valid harnesses");
  return {
    convexUrl: required("SKIPPY_CONVEX_URL"),
    hostToken: required("SKIPPY_RUNNER_HOST_TOKEN"),
    hostKey: process.env.SKIPPY_RUNNER_HOST_KEY ?? os.hostname(),
    allowedRoot,
    worktreeRoot: path.resolve(process.env.SKIPPY_RUNNER_WORKTREE_ROOT ?? path.join(allowedRoot, ".skippy-worktrees")),
    harnesses,
    maxConcurrency: Number(process.env.SKIPPY_RUNNER_MAX_CONCURRENCY ?? "1"),
    heartbeatIntervalMs: 30_000,
    claimPollIntervalMs: 5_000,
    approvalTimeoutMs: Number(process.env.SKIPPY_RUNNER_APPROVAL_TIMEOUT_MS ?? String(24 * 60 * 60 * 1000)),
    launchdLabel: process.env.SKIPPY_RUNNER_LAUNCHD_LABEL ?? "com.skippy.runner",
    skippyMcpUrl: required("SKIPPY_MCP_URL"),
    skippyMcpToken: required("SKIPPY_MCP_TOKEN"),
    chatBypassPermissions: ["1", "true"].includes(process.env.SKIPPY_CHAT_BYPASS_PERMISSIONS ?? ""),
  };
}
