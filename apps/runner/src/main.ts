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
import { ensureCorepackShims, extendRunnerPath, loadConfig } from "./config.js";
import {
  ControlPlane,
  type ClaimedAgentPass,
  type ClaimedChatTurn,
  type ClaimedMaintenanceJob,
  type ClaimedRun,
} from "./controlPlane.js";
import { executeAgentPass } from "./agentPassExecutor.js";
import { executeCloseoutJob } from "./closeoutExecutor.js";
import { ClaudeAdapter } from "./harness/claude.js";
import { CodexAdapter } from "./harness/codex.js";
import { isHarnessTeardownError } from "./harness/teardownErrors.js";
import type { HarnessAdapter } from "./harness/types.js";
import { RunExecutor } from "./runExecutor.js";
import { executeChatTurn } from "./chatExecutor.js";

function log(message: string, extra?: unknown) {
  const suffix = extra === undefined ? "" : ` ${JSON.stringify(extra)}`;
  console.log(`[skippy-runner ${new Date().toISOString()}] ${message}${suffix}`);
}

/**
 * Process-level backstops (incident 2026-08-19, run qx719evfy): the Claude
 * Agent SDK dispatches control-request handlers without awaiting them, so a
 * transport write racing a harness teardown (SIGTERM, exit 143) surfaces as
 * an unhandled rejection outside every adapter try/catch — and, unhandled, it
 * crashed the whole daemon and killed an unrelated in-flight chat turn.
 *
 * Policy: one session must never kill sibling work. Teardown-attributable
 * errors are logged and swallowed. Other escapes are also logged-and-survived
 * rather than fatal: the runner holds no state Convex cannot reconstruct
 * (events re-flush, leases expire, reconciliation marks orphans interrupted),
 * so staying up to finish sibling runs/chat turns is strictly safer than a
 * launchd restart that interrupts all of them.
 */
function installProcessBackstops() {
  process.on("uncaughtException", (error, origin) => {
    if (isHarnessTeardownError(error)) {
      log("suppressed harness teardown race (uncaughtException); daemon continues", {
        origin,
        error: String(error),
      });
      return;
    }
    log("UNEXPECTED uncaughtException — daemon continues, but investigate", {
      origin,
      error: String(error),
      stack: error instanceof Error ? error.stack?.slice(0, 2000) : undefined,
    });
  });
  process.on("unhandledRejection", (reason) => {
    if (isHarnessTeardownError(reason)) {
      log("suppressed harness teardown race (unhandledRejection); daemon continues", {
        error: String(reason),
      });
      return;
    }
    log("UNEXPECTED unhandledRejection — daemon continues, but investigate", {
      error: String(reason),
      stack: reason instanceof Error ? reason.stack?.slice(0, 2000) : undefined,
    });
  });
}

async function main() {
  installProcessBackstops();
  // Environment provisioning (2026-08-21 six-gate autopsy): make node's bin
  // dir and the corepack pnpm shims resolvable for every child — harness
  // sessions, worktree provisioning, verify commands — so runs never
  // improvise package-manager bootstraps that trip the command allowlist.
  extendRunnerPath();
  const shims = await ensureCorepackShims();
  if (shims.ok) log("pnpm shims ready", { message: shims.message });
  else log("pnpm shims unavailable — sessions may improvise and hit gates", { message: shims.message });
  const config = loadConfig();
  const plane = new ControlPlane(config.convexUrl, config.hostToken);
  const adapters = new Map<string, HarnessAdapter>();
  for (const harness of config.harnesses) {
    adapters.set(
      harness,
      harness === "claude"
        ? new ClaudeAdapter({ skippyMcpUrl: config.skippyMcpUrl, skippyMcpToken: config.skippyMcpToken })
        : new CodexAdapter({ skippyMcpUrl: config.skippyMcpUrl }),
    );
  }

  const registration = await plane.registerHost({
    harnesses: config.harnesses,
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    maxConcurrency: config.maxConcurrency,
    projectFileManifests: true,
    artifactUploads: true,
    isolatedChatAttachments: true,
  });
  log("registered host", { hostId: registration.hostId, harnesses: config.harnesses });

  const activeRuns = new Map<string, Promise<void>>();
  const activeChatTurns = new Map<string, Promise<void>>();
  const activeMaintenanceJobs = new Map<string, Promise<void>>();
  const activeAgentPasses = new Map<string, Promise<void>>();
  let draining = false;
  let stopping = false;

  const heartbeatTimer = setInterval(() => {
    void plane
      .heartbeat([...activeRuns.keys()], [...activeChatTurns.keys()], [...activeMaintenanceJobs.keys()], [...activeAgentPasses.keys()])
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

  // Maintenance-job reconciliation: a close-out interrupted by a restart is
  // marked failed (task stays in_review, error visible) — the ritual is cheap
  // to re-run from the task panel, and a healthy close-out schedules its own
  // restart only AFTER reporting completed, so orphans are genuine failures.
  try {
    const orphanJobs = await plane.hostActiveMaintenanceJobs();
    for (const orphan of orphanJobs) {
      if (!orphan.claimToken) continue;
      log("marking orphaned maintenance job failed", { jobId: orphan.jobId, status: orphan.status });
      await plane
        .updateMaintenanceJob(orphan.jobId, orphan.claimToken, {
          status: "failed",
          errorMessage: "Runner restarted while this close-out was in flight. Run close-out again from the task panel.",
        })
        .catch((error) => log("maintenance reconciliation failed", { jobId: orphan.jobId, error: String(error) }));
    }
  } catch (error) {
    log("maintenance reconciliation failed", { error: String(error) });
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

  // Conversational chat turns: independent of run concurrency (a long code
  // run must not block chat replies), one turn at a time, faster poll so the
  // chat feels responsive.
  const startChatTurn = (turn: ClaimedChatTurn) => {
    const adapter = adapters.get(turn.harness);
    if (!adapter) return;
    log("claimed chat turn", { turnId: turn.turnId, harness: turn.harness });
    const promise = executeChatTurn(config, plane, turn, adapter)
      .catch((error) => log("chat turn crashed", { turnId: turn.turnId, error: String(error) }))
      .finally(() => activeChatTurns.delete(turn.turnId));
    activeChatTurns.set(turn.turnId, promise);
  };
  const chatClaimTimer = setInterval(() => {
    if (stopping || draining) return;
    if (activeChatTurns.size >= 1) return;
    void plane
      .claimNextChatTurn()
      .then((turn) => {
        if (turn) startChatTurn(turn);
      })
      .catch((error) => log("chat claim failed", { error: String(error) }));
  }, 2_000);

  // Maintenance jobs (post-merge close-out): deterministic scripted work,
  // one at a time, independent of run/chat concurrency — a close-out is a
  // few git/gh commands, not a harness session.
  const startMaintenanceJob = (job: ClaimedMaintenanceJob) => {
    log("claimed maintenance job", { jobId: job.jobId, kind: job.kind, task: job.taskTitle });
    const promise = executeCloseoutJob(config, plane, job)
      .catch((error) => log("maintenance job crashed", { jobId: job.jobId, error: String(error) }))
      .finally(() => {
        activeMaintenanceJobs.delete(job.jobId);
        log("maintenance job finished", { jobId: job.jobId });
      });
    activeMaintenanceJobs.set(job.jobId, promise);
  };
  const maintenanceClaimTimer = setInterval(() => {
    if (stopping || draining) return;
    if (activeMaintenanceJobs.size >= 1) return;
    void plane
      .claimNextMaintenanceJob()
      .then((job) => {
        if (job) startMaintenanceJob(job);
      })
      .catch((error) => log("maintenance claim failed", { error: String(error) }));
  }, config.claimPollIntervalMs);

  // Scheduled agent passes (docs/connectors.md): one at a time, independent
  // of run/chat concurrency. The claim itself advances nextDueAt, so a slow
  // pass never double-fires — the next slot simply finds nothing due.
  const startAgentPass = (pass: ClaimedAgentPass) => {
    const adapter = adapters.get(pass.harness);
    if (!adapter) {
      log("claimed agent pass with unsupported harness — this should be impossible", { roleKey: pass.roleKey });
      return;
    }
    log("claimed agent pass", { roleKey: pass.roleKey, harness: pass.harness, model: pass.model });
    const promise = executeAgentPass(config, plane, pass, adapter)
      .catch((error) => log("agent pass crashed", { roleKey: pass.roleKey, error: String(error) }))
      .finally(() => {
        activeAgentPasses.delete(pass.configId);
        log("agent pass finished", { roleKey: pass.roleKey });
      });
    activeAgentPasses.set(pass.configId, promise);
  };
  const agentPassTimer = setInterval(() => {
    if (stopping || draining) return;
    if (activeAgentPasses.size >= 1) return;
    void plane
      .claimNextAgentPass()
      .then((pass) => {
        if (pass) startAgentPass(pass);
      })
      .catch((error) => log("agent pass claim failed", { error: String(error) }));
  }, config.claimPollIntervalMs);

  const shutdown = async (signalName: string) => {
    if (stopping) return;
    stopping = true;
    log(
      `received ${signalName}; waiting for ${activeRuns.size} run(s) + ${activeChatTurns.size} chat turn(s) + ${activeMaintenanceJobs.size} maintenance job(s)`,
    );
    clearInterval(claimTimer);
    clearInterval(chatClaimTimer);
    clearInterval(maintenanceClaimTimer);
    clearInterval(agentPassTimer);
    await Promise.allSettled([...activeRuns.values(), ...activeChatTurns.values(), ...activeMaintenanceJobs.values(), ...activeAgentPasses.values()]);
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
