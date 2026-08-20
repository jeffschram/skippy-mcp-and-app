/**
 * Runner configuration, all from environment. The runner is a trusted daemon
 * on the Mac mini running under a dedicated service account (launchd); see
 * docs/mac-mini-agent-workbench.md → Security model.
 */
import os from "node:os";
import path from "node:path";

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
   * Chat turns only: run the harness with permissions bypassed
   * (--dangerously-skip-permissions / --dangerously-bypass-approvals-and-sandbox).
   * No approval cards, no sandbox — every action executes immediately as this
   * user. Opt-in via SKIPPY_CHAT_BYPASS_PERMISSIONS=1; code runs are never
   * affected (their approval model, including the publish gate, stays).
   */
  chatBypassPermissions: boolean;
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
    skippyMcpUrl: required("SKIPPY_MCP_URL"),
    skippyMcpToken: required("SKIPPY_MCP_TOKEN"),
    chatBypassPermissions: ["1", "true"].includes(process.env.SKIPPY_CHAT_BYPASS_PERMISSIONS ?? ""),
  };
}
