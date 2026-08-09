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
    chatBypassPermissions: ["1", "true"].includes(process.env.SKIPPY_CHAT_BYPASS_PERMISSIONS ?? ""),
  };
}
