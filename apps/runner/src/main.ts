#!/usr/bin/env node
/**
 * Skippy Mac mini runner daemon (docs/mac-mini-agent-workbench.md).
 *
 * Outbound-only: registers with the Convex control plane using a revocable
 * host token, heartbeats, claims compatible queued runs atomically, and
 * executes them in dedicated git worktrees via harness adapters. Designed to
 * run continuously under launchd as a dedicated service account.
 */
import os from "node:os";
import { loadConfig } from "./config.js";
import { ControlPlane, type ClaimedRun } from "./controlPlane.js";
import { ClaudeAdapter } from "./harness/claude.js";
import { CodexAdapter } from "./harness/codex.js";
import type { HarnessAdapter } from "./harness/types.js";
import { RunExecutor } from "./runExecutor.js";

function log(message: string, extra?: unknown) {
  const suffix = extra === undefined ? "" : ` ${JSON.stringify(extra)}`;
  console.log(`[skippy-runner ${new Date().toISOString()}] ${message}${suffix}`);
}

async function main() {
  const config = loadConfig();
  const plane = new ControlPlane(config.convexUrl, config.hostToken);
  const adapters = new Map<string, HarnessAdapter>();
  for (const harness of config.harnesses) {
    adapters.set(harness, harness === "claude" ? new ClaudeAdapter() : new CodexAdapter());
  }

  const registration = await plane.registerHost({
    harnesses: config.harnesses,
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    maxConcurrency: config.maxConcurrency,
  });
  log("registered host", { hostId: registration.hostId, harnesses: config.harnesses });

  const activeRuns = new Map<string, Promise<void>>();
  let draining = false;
  let stopping = false;

  const heartbeatTimer = setInterval(() => {
    void plane
      .heartbeat([...activeRuns.keys()])
      .then((res) => {
        draining = res.draining;
      })
      .catch((error) => log("heartbeat failed", { error: String(error) }));
  }, config.heartbeatIntervalMs);

  // Startup reconciliation: runs this host still owns from before a restart.
  // Phase 1 policy: never silently resume a harness against a worktree with
  // unknown state — mark interrupted and let the user resume explicitly.
  try {
    const orphans = await plane.hostActiveRuns();
    for (const orphan of orphans) {
      if (orphan.claimToken) {
        log("marking orphaned run interrupted", { runId: orphan.runId, status: orphan.status });
        await plane
          .updateRunStatus(orphan.runId, orphan.claimToken, "interrupted", {
            errorCategory: "runner_restart",
            errorMessage: "Runner restarted while this run was active. Resume to continue.",
          })
          .catch((error) => log("reconciliation failed", { runId: orphan.runId, error: String(error) }));
      }
    }
  } catch (error) {
    log("startup reconciliation failed", { error: String(error) });
  }

  const startRun = (claimed: ClaimedRun) => {
    const adapter = adapters.get(claimed.harness);
    if (!adapter) {
      log("claimed run with unsupported harness — this should be impossible", { runId: claimed.runId });
      return;
    }
    log("claimed run", { runId: claimed.runId, harness: claimed.harness, project: claimed.project.title });
    const promise = new RunExecutor(config, plane, claimed, adapter)
      .execute()
      .catch((error) => log("run crashed", { runId: claimed.runId, error: String(error) }))
      .finally(() => {
        activeRuns.delete(claimed.runId);
        log("run finished", { runId: claimed.runId });
      });
    activeRuns.set(claimed.runId, promise);
  };

  // Work discovery: poll (doubles as the reconciliation path; websocket
  // subscription is a later latency optimization — see controlPlane.ts).
  const claimTimer = setInterval(() => {
    if (stopping || draining) return;
    if (activeRuns.size >= config.maxConcurrency) return;
    void plane
      .claimNextRun()
      .then((claimed) => {
        if (claimed) startRun(claimed);
      })
      .catch((error) => log("claim attempt failed", { error: String(error) }));
  }, config.claimPollIntervalMs);

  const shutdown = async (signalName: string) => {
    if (stopping) return;
    stopping = true;
    log(`received ${signalName}; waiting for ${activeRuns.size} active run(s)`);
    clearInterval(claimTimer);
    await Promise.allSettled([...activeRuns.values()]);
    clearInterval(heartbeatTimer);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  log("runner ready", { allowedRoot: config.allowedRoot, maxConcurrency: config.maxConcurrency });
}

main().catch((error) => {
  console.error("[skippy-runner] fatal:", error);
  process.exit(1);
});
