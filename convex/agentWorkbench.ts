/**
 * Mac mini agent workbench control plane (docs/mac-mini-agent-workbench.md).
 *
 * Two audiences:
 *  - Viewer functions (`*ForViewer`) authenticate with Clerk via requireOwnedBrain.
 *  - Runner functions (`host*`) authenticate with a revocable host token,
 *    following the mcpTokens pattern: plaintext returned once, hash stored.
 *
 * Convex is the durable control plane; the runner holds no state Convex cannot
 * reconstruct. Claiming is atomic and lease-based; event ingestion is
 * idempotent by (runId, seq); approvals are idempotent by (runId, harnessRequestId).
 */
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireOwnedBrain } from "./auth";
import { applyTaskResult } from "./projects";
import { tokenUsage } from "./schema";

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

export const AGENT_HARNESSES = ["codex", "claude"] as const;
export type AgentHarness = (typeof AGENT_HARNESSES)[number];

/** Heartbeat older than this reads as Offline. */
const HOST_OFFLINE_AFTER_MS = 90_000;
/** Claim lease horizon; renewed on every heartbeat that lists the run. */
const RUN_LEASE_MS = 150_000;

const ACTIVE_RUN_STATUSES = [
  "queued",
  "claimed",
  "preparing",
  "running",
  "waiting_for_approval",
  "verifying",
  "awaiting_publish_approval",
  "publishing",
] as const;

const TERMINAL_RUN_STATUSES = ["in_review", "failed", "cancelled"] as const;

/** Statuses a host may report, and what they may follow. `queued` and
 * `claimed` are server-owned (executeTask / claimNextRun); `cancelled` for an
 * active run flows through cancelRequested + host reporting. */
const HOST_REPORTABLE_TRANSITIONS: Record<string, string[]> = {
  preparing: ["claimed", "interrupted"],
  running: ["claimed", "preparing", "waiting_for_approval", "verifying", "interrupted"],
  waiting_for_approval: ["running", "preparing", "verifying", "awaiting_publish_approval"],
  verifying: ["running", "waiting_for_approval"],
  awaiting_publish_approval: ["verifying", "running", "waiting_for_approval"],
  publishing: ["awaiting_publish_approval", "waiting_for_approval"],
  in_review: ["publishing", "verifying", "running"],
  interrupted: [...ACTIVE_RUN_STATUSES.filter((s) => s !== "queued")],
  failed: [...ACTIVE_RUN_STATUSES.filter((s) => s !== "queued"), "interrupted"],
  cancelled: [...ACTIVE_RUN_STATUSES, "interrupted"],
};

const harnessArg = v.union(v.literal("codex"), v.literal("claude"));

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function makeToken(prefix: string) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const body = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${prefix}_${body}`;
}

function isHarness(value: unknown): value is AgentHarness {
  return typeof value === "string" && (AGENT_HARNESSES as readonly string[]).includes(value);
}

function hostStatusFor(host: any, now: number): "online" | "draining" | "offline" {
  if (host.revokedAt) return "offline";
  if (!host.lastHeartbeatAt || now - host.lastHeartbeatAt > HOST_OFFLINE_AFTER_MS) return "offline";
  return host.draining ? "draining" : "online";
}

export async function requireHost(ctx: any, hostToken: string) {
  const tokenHash = await sha256Hex(hostToken);
  const host = await ctx.db
    .query("agentHosts")
    .withIndex("by_token_hash", (q: any) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!host || host.revokedAt) {
    throw new Error("invalid host token");
  }
  return host;
}

/** Host must own the run and present the claim token minted at claim time, so
 * a runner restarted with stale state cannot act on a re-claimed run. */
async function requireClaimedRun(ctx: any, host: any, runId: string, claimToken: string) {
  const run = await ctx.db.get(runId);
  if (!run || run.brainInstanceId !== host.brainInstanceId) {
    throw new Error("run not found");
  }
  if (run.hostId !== host._id || !run.claimToken || run.claimToken !== claimToken) {
    throw new Error("run is not claimed by this host");
  }
  return run;
}

async function projectIdForTask(db: any, brainInstanceId: any, taskId: string): Promise<any | null> {
  const rels = await db
    .query("relationships")
    .withIndex("by_brain_type", (q: any) => q.eq("brainInstanceId", brainInstanceId).eq("type", "belongs_to"))
    .collect();
  const rel = rels.find(
    (r: any) => r.from.entityType === "task" && r.from.entityId === taskId && r.to.entityType === "project",
  );
  return rel ? (rel.to.entityId as string) : null;
}

async function activeRunForTask(db: any, brainInstanceId: any, taskId: string) {
  const runs = await db
    .query("agentRuns")
    .withIndex("by_brain_task", (q: any) => q.eq("brainInstanceId", brainInstanceId).eq("taskId", taskId))
    .collect();
  return runs.find((run: any) => (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status)) ?? null;
}

function runSummary(run: any) {
  return {
    _id: run._id,
    projectId: run.projectId,
    chatId: run.chatId,
    taskId: run.taskId,
    hostId: run.hostId,
    attempt: run.attempt,
    status: run.status,
    harness: run.harness,
    baseBranch: run.baseBranch,
    workingBranch: run.workingBranch,
    cancelRequested: run.cancelRequested ?? false,
    queuedAt: run.queuedAt,
    claimedAt: run.claimedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    errorCategory: run.errorCategory,
    errorMessage: run.errorMessage,
    verificationSummary: run.verificationSummary,
    resultSummary: run.resultSummary,
    resultUrl: run.resultUrl,
    prUrl: run.prUrl,
    prNumber: run.prNumber,
    lastEventSeq: run.lastEventSeq,
    updatedAt: run.updatedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Viewer: hosts and execution configs                                */
/* ------------------------------------------------------------------ */

export const createHostForViewer = mutationGeneric({
  args: {
    displayName: v.string(),
    hostKey: v.string(),
    kind: v.optional(v.union(v.literal("mac"), v.literal("cloud"))),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const now = Date.now();
    const token = makeToken("skippyhost");
    const hostId = await ctx.db.insert("agentHosts", {
      brainInstanceId: brain._id,
      hostKey: args.hostKey.trim(),
      displayName: args.displayName.trim(),
      kind: args.kind ?? "mac",
      // Real capabilities arrive with the runner's first registerHost call.
      capabilities: { harnesses: [], maxConcurrency: 1 },
      tokenHash: await sha256Hex(token),
      tokenPrefix: token.slice(0, 16),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "agent_host_created",
      actorType: "user",
      timestamp: now,
      summary: `Agent host created: ${args.displayName}`,
      metadata: { hostId },
    });
    // The plaintext token is shown exactly once.
    return { hostId, token };
  },
});

export const revokeHostForViewer = mutationGeneric({
  args: { hostId: v.id("agentHosts") },
  handler: async (ctx, { hostId }) => {
    const { brain } = await requireOwnedBrain(ctx);
    const host = await ctx.db.get(hostId);
    if (!host || host.brainInstanceId !== brain._id) throw new Error("host not found");
    const now = Date.now();
    await ctx.db.patch(hostId, { revokedAt: now, updatedAt: now });
    return { hostId };
  },
});

export const listHostsForViewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const now = Date.now();
    const hosts = await ctx.db
      .query("agentHosts")
      .withIndex("by_brain", (q: any) => q.eq("brainInstanceId", brain._id))
      .collect();
    return hosts.map((host: any) => ({
      _id: host._id,
      hostKey: host.hostKey,
      displayName: host.displayName,
      kind: host.kind,
      capabilities: host.capabilities,
      tokenPrefix: host.tokenPrefix,
      status: hostStatusFor(host, now),
      lastHeartbeatAt: host.lastHeartbeatAt,
      revokedAt: host.revokedAt,
      createdAt: host.createdAt,
    }));
  },
});

/* ------------------------------------------------------------------ */
/* Token usage (docs/token-efficiency.md lever 1)                     */
/* ------------------------------------------------------------------ */

type UsageTotals = { inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number };

function zeroUsage(): UsageTotals {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function addUsage(target: UsageTotals, usage: UsageTotals) {
  target.inputTokens += usage.inputTokens;
  target.cachedInputTokens += usage.cachedInputTokens;
  target.outputTokens += usage.outputTokens;
  target.totalTokens += usage.totalTokens;
}

/**
 * Aggregated token usage across chat turns and agent runs, for the Agents hub
 * Usage tab. Aggregation happens at read time from the per-turn/per-run
 * `usage` fields the runner reports (already normalized provider-agnostically
 * there). Full-table scans per brain are fine at personal-app scale; if the
 * tables ever grow painful, add a createdAt index and window server-side.
 */
export const usageSummaryForViewer = queryGeneric({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const days = Math.min(Math.max(Math.floor(args.days ?? 30), 1), 90);
    const cutoff = Date.now() - days * 86_400_000;
    // UTC day buckets: stable regardless of where the query executes.
    const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);

    const totals = { chat: zeroUsage(), runs: zeroUsage(), all: zeroUsage() };
    const byHarness: Record<string, UsageTotals> = {};
    const byDay = new Map<string, { day: string; chat: UsageTotals; runs: UsageTotals; total: UsageTotals }>();
    let chatTurnCount = 0;
    let runCount = 0;

    const record = (kind: "chat" | "runs", harness: string, at: number, usage: UsageTotals) => {
      addUsage(totals[kind], usage);
      addUsage(totals.all, usage);
      byHarness[harness] ??= zeroUsage();
      addUsage(byHarness[harness], usage);
      const key = dayKey(at);
      let bucket = byDay.get(key);
      if (!bucket) {
        bucket = { day: key, chat: zeroUsage(), runs: zeroUsage(), total: zeroUsage() };
        byDay.set(key, bucket);
      }
      addUsage(bucket[kind], usage);
      addUsage(bucket.total, usage);
    };

    const turns = await ctx.db
      .query("chatTurns")
      .withIndex("by_brain_status", (q: any) => q.eq("brainInstanceId", brain._id))
      .collect();
    for (const turn of turns) {
      if (!turn.usage || turn.updatedAt < cutoff) continue;
      chatTurnCount += 1;
      record("chat", turn.harness, turn.updatedAt, turn.usage);
    }

    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_brain_status", (q: any) => q.eq("brainInstanceId", brain._id))
      .collect();
    for (const run of runs) {
      if (!run.usage || run.updatedAt < cutoff) continue;
      runCount += 1;
      record("runs", run.harness, run.updatedAt, run.usage);
    }

    return {
      days,
      counts: { chatTurns: chatTurnCount, runs: runCount },
      totals,
      byHarness,
      byDay: [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
    };
  },
});

export const setProjectExecutionConfigForViewer = mutationGeneric({
  args: {
    projectId: v.id("projects"),
    hostId: v.id("agentHosts"),
    localPath: v.string(),
    preferredHarness: v.optional(harnessArg),
    requirePushApproval: v.optional(v.boolean()),
    verifyCommand: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.brainInstanceId !== brain._id) throw new Error("project not found");
    const host = await ctx.db.get(args.hostId);
    if (!host || host.brainInstanceId !== brain._id || host.revokedAt) throw new Error("host not found");
    const localPath = args.localPath.trim();
    if (!localPath.startsWith("/")) throw new Error("localPath must be absolute");

    const now = Date.now();
    // db.patch removes fields set to an explicit undefined, so only include
    // the optional knobs when the caller actually provided them.
    const patch: Record<string, unknown> = { hostId: args.hostId, localPath, updatedAt: now };
    if (args.verifyCommand !== undefined) patch.verifyCommand = args.verifyCommand.trim() || undefined;
    if (args.preferredHarness !== undefined) patch.preferredHarness = args.preferredHarness;
    if (args.requirePushApproval !== undefined) {
      patch.approvalPolicy = { requirePushApproval: args.requirePushApproval };
    }
    if (args.enabled !== undefined) patch.enabled = args.enabled;
    const existing = await ctx.db
      .query("projectExecutionConfigs")
      .withIndex("by_brain_project", (q: any) => q.eq("brainInstanceId", brain._id).eq("projectId", args.projectId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { configId: existing._id };
    }
    const configId = await ctx.db.insert("projectExecutionConfigs", {
      brainInstanceId: brain._id,
      projectId: args.projectId,
      hostId: args.hostId,
      localPath,
      ...(args.verifyCommand?.trim() ? { verifyCommand: args.verifyCommand.trim() } : {}),
      ...(args.preferredHarness !== undefined ? { preferredHarness: args.preferredHarness } : {}),
      ...(args.requirePushApproval !== undefined
        ? { approvalPolicy: { requirePushApproval: args.requirePushApproval } }
        : {}),
      enabled: args.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    });
    return { configId };
  },
});

export const listProjectExecutionConfigsForViewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const now = Date.now();
    const configs = await ctx.db
      .query("projectExecutionConfigs")
      .withIndex("by_brain_project", (q: any) => q.eq("brainInstanceId", brain._id))
      .collect();
    const results = [];
    for (const config of configs) {
      const project = await ctx.db.get(config.projectId);
      const host = await ctx.db.get(config.hostId);
      results.push({
        _id: config._id,
        projectId: config.projectId,
        projectTitle: project?.title ?? "(deleted project)",
        hostId: config.hostId,
        hostDisplayName: host?.displayName ?? "(deleted host)",
        hostStatus: host ? hostStatusFor(host, now) : "offline",
        localPath: config.localPath,
        preferredHarness: config.preferredHarness,
        verifyCommand: config.verifyCommand,
        requirePushApproval: config.approvalPolicy?.requirePushApproval ?? true,
        enabled: config.enabled,
        updatedAt: config.updatedAt,
      });
    }
    results.sort((a, b) => a.projectTitle.localeCompare(b.projectTitle));
    return results;
  },
});

export const projectExecutionConfigForViewer = queryGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const { brain } = await requireOwnedBrain(ctx);
    const config = await ctx.db
      .query("projectExecutionConfigs")
      .withIndex("by_brain_project", (q: any) => q.eq("brainInstanceId", brain._id).eq("projectId", projectId))
      .first();
    if (!config) return null;
    const host = await ctx.db.get(config.hostId);
    const now = Date.now();
    return {
      _id: config._id,
      projectId: config.projectId,
      hostId: config.hostId,
      localPath: config.localPath,
      preferredHarness: config.preferredHarness,
      approvalPolicy: config.approvalPolicy,
      enabled: config.enabled,
      host: host
        ? {
            _id: host._id,
            displayName: host.displayName,
            status: hostStatusFor(host, now),
            harnesses: host.capabilities?.harnesses ?? [],
          }
        : null,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Viewer: execute, cancel, approvals, run reads                      */
/* ------------------------------------------------------------------ */

/**
 * Shared run-minting path for the viewer play button and the host-token
 * chat-harness equivalent. All validation, dedupe, chat reuse, attempt
 * numbering, and audit logging live here so the two entry points cannot
 * drift; only authentication and actor attribution differ.
 */
async function queueTaskExecution(
  ctx: any,
  brainId: any,
  opts: {
    taskId: any;
    harness?: AgentHarness | undefined;
    actor: { actorType: "user" | "harness"; actorId?: string; requestedBy?: string };
  },
) {
  const task = await ctx.db.get(opts.taskId);
  if (!task || task.brainInstanceId !== brainId) throw new Error("task not found");
  if (task.processingState !== "accepted") throw new Error("only accepted tasks can be executed");
  if (task.ownerType !== "agent") throw new Error("only agent-owned tasks can be executed");

  // Duplicate execution request: return the existing active run and its chat
  // rather than creating a competing run.
  const existing = await activeRunForTask(ctx.db, brainId, opts.taskId);
  if (existing) {
    return { runId: existing._id, chatId: existing.chatId, status: existing.status, existing: true };
  }

  const executionState = task.executionState ?? (task.status === "done" ? "done" : "ready");
  if (executionState !== "ready") {
    // Resume path (doc → Task action states: Interrupted or failed → Resume).
    // A prior attempt moved the task to in_progress/in_review before dying;
    // with no run active, a new attempt is legal.
    const taskRuns = await ctx.db
      .query("agentRuns")
      .withIndex("by_brain_task", (q: any) => q.eq("brainInstanceId", brainId).eq("taskId", opts.taskId))
      .collect();
    taskRuns.sort((a: any, b: any) => b.createdAt - a.createdAt);
    const latest = taskRuns[0];
    const resumable =
      (executionState === "in_progress" || executionState === "in_review") &&
      latest &&
      (["failed", "interrupted", "cancelled"].includes(latest.status) ||
        // Publish-failed runs finish in_review with the work preserved on
        // the branch; re-executing retries the push.
        (latest.status === "in_review" && latest.errorCategory === "publish"));
    if (!resumable) throw new Error("only ready tasks (or failed/interrupted attempts) can be executed");
  }

  const projectId = await projectIdForTask(ctx.db, brainId, opts.taskId);
  if (!projectId) throw new Error("task is not linked to a project");
  const project = await ctx.db.get(projectId);
  if (!project) throw new Error("project not found");
  if ((project.kind ?? "general") !== "code" || !project.repoUrl) {
    throw new Error("task's project is not a code project with a configured repository");
  }
  const config = await ctx.db
    .query("projectExecutionConfigs")
    .withIndex("by_brain_project", (q: any) => q.eq("brainInstanceId", brainId).eq("projectId", projectId))
    .first();
  if (!config || !config.enabled) {
    throw new Error("project has no enabled execution host mapping");
  }

  // Harness resolution order (docs/mac-mini-agent-workbench.md → Harness):
  // explicit pick → task.requestedHarness when it is a valid enum value →
  // project preferredHarness → default "claude".
  const harness: AgentHarness =
    opts.harness ??
    (isHarness(task.requestedHarness) ? task.requestedHarness : undefined) ??
    config.preferredHarness ??
    "claude";

  const now = Date.now();

  // Reuse the task chat only when its harness matches — a chat is bound to
  // one harness for its lifetime (context lives in the harness thread).
  const chats = await ctx.db
    .query("projectChats")
    .withIndex("by_brain_task", (q: any) => q.eq("brainInstanceId", brainId).eq("taskId", opts.taskId))
    .collect();
  let chat = chats.find(
    (c: any) => c.kind === "task" && c.state !== "archived" && (!c.harness || c.harness === harness),
  );
  let chatId = chat?._id;
  if (!chatId) {
    chatId = await ctx.db.insert("projectChats", {
      brainInstanceId: brainId,
      projectId,
      taskId: opts.taskId,
      title: `Task: ${task.title}`,
      kind: "task",
      harness,
      state: "active",
      createdAt: now,
      updatedAt: now,
    });
  } else if (!chat.harness) {
    await ctx.db.patch(chatId, { harness, updatedAt: now });
  }

  const priorRuns = await ctx.db
    .query("agentRuns")
    .withIndex("by_brain_task", (q: any) => q.eq("brainInstanceId", brainId).eq("taskId", opts.taskId))
    .collect();
  const frozenInputs = (await ctx.db.query("projectFiles").withIndex("by_brain_task", (q: any) =>
    q.eq("brainInstanceId", brainId).eq("taskId", opts.taskId),
  ).collect()).filter((file: any) => (file.status ?? "ready") === "ready" && (file.kind ?? "library_input") === "library_input");

  const runId = await ctx.db.insert("agentRuns", {
    brainInstanceId: brainId,
    projectId,
    chatId,
    taskId: opts.taskId,
    attempt: priorRuns.length + 1,
    status: "queued",
    harness,
    // Snapshot the project's task-run model at enqueue time (token tiering,
    // docs/token-efficiency.md §4) — a later settings change never
    // retro-affects an already-queued run.
    model: project.defaultTaskModel,
    baseBranch: project.defaultBaseBranch ?? "main",
    // Fall back to the task's own title + description when it was never
    // briefed — without this, the runner's prompt degrades to just the
    // project title and the harness has nothing to work from (2026-08-28:
    // an un-briefed task ran with only "Skippy MCP and APP" as its prompt
    // and produced an empty PR).
    executionBrief:
      task.executionBrief ??
      ([task.title, task.description].filter(Boolean).join("\n\n") || undefined),
    acceptanceCriteria: task.acceptanceCriteria,
    inputFileRefs: frozenInputs.map((file: any) => ({ fileId: file._id, required: file.required ?? true })),
    fileLifecycleEnabled: frozenInputs.length > 0,
    approvalPolicy: config.approvalPolicy ?? { requirePushApproval: true },
    claimVersion: 0,
    queuedAt: now,
    lastEventSeq: 0,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.patch(chatId, { activeRunId: runId, updatedAt: now });
  await ctx.db.patch(opts.taskId, {
    agentRequestStatus: "requested",
    agentRequestedAt: task.agentRequestedAt ?? now,
    agentRequestedBy: opts.actor.requestedBy,
    updatedAt: now,
  });
  await ctx.db.insert("activityEvents", {
    brainInstanceId: brainId,
    entityRef: { entityType: "task", entityId: opts.taskId },
    activityType: "agent_run_queued",
    actorType: opts.actor.actorType,
    actorId: opts.actor.actorId,
    timestamp: now,
    summary: `Execution queued (${harness}): ${task.title}`,
    metadata: { runId, chatId, harness },
  });

  return { runId, chatId, status: "queued", existing: false };
}

export const executeTaskForViewer = mutationGeneric({
  args: {
    taskId: v.id("tasks"),
    harness: v.optional(harnessArg),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    return queueTaskExecution(ctx, brain._id, {
      taskId: args.taskId,
      harness: args.harness,
      actor: { actorType: "user", actorId: user._id, requestedBy: user.displayName ?? user.email },
    });
  },
});

/**
 * Host-authenticated play button. Lets the chat harness queue a task run on
 * the owner's explicit instruction ("start task X", "initiate all tasks in
 * Phase N") without a board round-trip — same consent convention as
 * decideApprovalForBrain, same host-token credential the runner itself
 * holds. Convenience: a `briefed` task is promoted to `ready` as part of
 * execution, mirroring what the viewer play button does in two steps.
 * Attribution: activity is recorded with actorType "harness" so proxied
 * starts are always distinguishable from owner clicks.
 */
export const executeTaskForBrain = mutationGeneric({
  args: {
    hostToken: v.string(),
    taskId: v.id("tasks"),
    harness: v.optional(harnessArg),
    actorId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.brainInstanceId !== host.brainInstanceId) {
      throw new Error("task not found for host's brain");
    }
    if ((task.executionState ?? "") === "briefed") {
      await ctx.db.patch(args.taskId, { executionState: "ready", updatedAt: Date.now() });
    }
    const actorId = args.actorId ?? "chat-harness";
    return queueTaskExecution(ctx, host.brainInstanceId, {
      taskId: args.taskId,
      harness: args.harness,
      actor: { actorType: "harness", actorId, requestedBy: actorId },
    });
  },
});

export const cancelRunForViewer = mutationGeneric({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, { runId }) => {
    const { brain } = await requireOwnedBrain(ctx);
    const run = await ctx.db.get(runId);
    if (!run || run.brainInstanceId !== brain._id) throw new Error("run not found");
    if ((TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status)) {
      return { runId, status: run.status };
    }
    const now = Date.now();
    if (run.status === "queued") {
      // Unclaimed: cancel immediately.
      await ctx.db.patch(runId, { status: "cancelled", cancelRequested: true, completedAt: now, updatedAt: now });
      return { runId, status: "cancelled" };
    }
    // Claimed/active: cooperative — the runner observes cancelRequested and
    // stops at a safe boundary, then reports status "cancelled".
    await ctx.db.patch(runId, { cancelRequested: true, updatedAt: now });
    return { runId, status: run.status, cancelRequested: true };
  },
});

export const decideApprovalForViewer = mutationGeneric({
  args: {
    approvalId: v.id("agentApprovals"),
    decision: v.union(v.literal("accepted"), v.literal("declined")),
  },
  handler: async (ctx, { approvalId, decision }) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const approval = await ctx.db.get(approvalId);
    if (!approval || approval.brainInstanceId !== brain._id) throw new Error("approval not found");
    if (approval.status !== "pending") {
      // Idempotent from the UI's perspective; never flip a settled decision.
      return { approvalId, status: approval.status };
    }
    const now = Date.now();
    await ctx.db.patch(approvalId, {
      status: decision,
      decidedByUserId: user._id,
      decidedAt: now,
      updatedAt: now,
    });
    return { approvalId, status: decision };
  },
});

/**
 * Host-authenticated approval decision. Exists because the web app currently
 * has no surface for run approvals (v2 regression, being restored by the task
 * detail panel work): until then, the owner can consent in chat and the chat
 * harness clears the gate on their behalf. Requires the host token, so it is
 * no weaker than the runner's own control-plane access. A proxied decision is
 * distinguishable from a viewer one by its missing `decidedByUserId`.
 */
export const decideApprovalForBrain = mutationGeneric({
  args: {
    hostToken: v.string(),
    approvalId: v.id("agentApprovals"),
    decision: v.union(v.literal("accepted"), v.literal("declined")),
  },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    const approval = await ctx.db.get(args.approvalId);
    if (!approval || approval.brainInstanceId !== host.brainInstanceId) {
      throw new Error("approval not found for host's brain");
    }
    if (approval.status !== "pending") {
      // Same idempotency contract as the viewer path: never flip a settled
      // decision.
      return { approvalId: args.approvalId, status: approval.status };
    }
    const now = Date.now();
    await ctx.db.patch(args.approvalId, {
      status: args.decision,
      decidedAt: now,
      updatedAt: now,
    });
    return { approvalId: args.approvalId, status: args.decision };
  },
});

export const pendingApprovalsForViewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const approvals = await ctx.db
      .query("agentApprovals")
      .withIndex("by_brain_status", (q: any) => q.eq("brainInstanceId", brain._id).eq("status", "pending"))
      .collect();
    return approvals.map((a: any) => ({
      _id: a._id,
      runId: a.runId,
      chatTurnId: a.chatTurnId,
      kind: a.kind,
      title: a.title,
      explanation: a.explanation,
      details: a.details,
      availableDecisions: a.availableDecisions ?? ["accepted", "declined"],
      createdAt: a.createdAt,
    }));
  },
});

/**
 * Approvals for a project's runs, joined with the owning task, for the
 * approval UI surface (task panel card, chat notice, board indicator).
 * Includes settled approvals — a decided chat notice stays in the timeline
 * as the record of the decision — capped so the payload stays bounded.
 * Read-only join over existing tables; the approval lifecycle itself
 * (request/decide/cancel) is untouched.
 */
export const approvalsForProjectForViewer = queryGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const { brain } = await requireOwnedBrain(ctx);
    // Prefix match on by_brain_status: all runs for the brain, then narrow
    // to the project. Bounded to the most recent runs so an old, busy
    // project cannot balloon the payload.
    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_brain_status", (q: any) => q.eq("brainInstanceId", brain._id))
      .collect();
    const projectRuns = runs
      .filter((run: any) => run.projectId === projectId)
      .sort((a: any, b: any) => b.createdAt - a.createdAt)
      .slice(0, 30);
    const taskTitles = new Map<string, string | undefined>();
    const out: any[] = [];
    for (const run of projectRuns) {
      if (run.taskId && !taskTitles.has(run.taskId)) {
        const task = await ctx.db.get(run.taskId);
        taskTitles.set(run.taskId, task?.title);
      }
      const approvals = await ctx.db
        .query("agentApprovals")
        .withIndex("by_run", (q: any) => q.eq("runId", run._id))
        .collect();
      for (const approval of approvals) {
        out.push({
          _id: approval._id,
          runId: approval.runId,
          taskId: run.taskId,
          taskTitle: run.taskId ? taskTitles.get(run.taskId) : undefined,
          runStatus: run.status,
          branch: run.workingBranch,
          verificationSummary: run.verificationSummary,
          kind: approval.kind,
          title: approval.title,
          explanation: approval.explanation,
          details: approval.details,
          availableDecisions: approval.availableDecisions ?? ["accepted", "declined"],
          status: approval.status,
          decidedAt: approval.decidedAt,
          reason: approval.reason,
          createdAt: approval.createdAt,
          updatedAt: approval.updatedAt,
        });
      }
    }
    out.sort((a, b) => a.createdAt - b.createdAt);
    return out.slice(-100);
  },
});

export const runForTaskForViewer = queryGeneric({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { brain } = await requireOwnedBrain(ctx);
    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_brain_task", (q: any) => q.eq("brainInstanceId", brain._id).eq("taskId", taskId))
      .collect();
    if (!runs.length) return null;
    runs.sort((a: any, b: any) => b.createdAt - a.createdAt);
    const latest = runs[0];
    const approvals = await ctx.db
      .query("agentApprovals")
      .withIndex("by_run", (q: any) => q.eq("runId", latest._id))
      .collect();
    return {
      run: runSummary(latest),
      attempts: runs.length,
      pendingApprovals: approvals.filter((a: any) => a.status === "pending").length,
    };
  },
});

export const runEventsForViewer = queryGeneric({
  args: {
    runId: v.id("agentRuns"),
    afterSeq: v.optional(v.number()),
    limit: v.optional(v.number()),
    // Last-N mode for live-tail consumers (task detail panel): returns only
    // the newest `tail` events, seq-ascending, so long runs don't ship their
    // whole history to the client.
    tail: v.optional(v.number()),
  },
  handler: async (ctx, { runId, afterSeq, limit, tail }) => {
    const { brain } = await requireOwnedBrain(ctx);
    const run = await ctx.db.get(runId);
    if (!run || run.brainInstanceId !== brain._id) throw new Error("run not found");
    if (tail !== undefined) {
      const newest = await ctx.db
        .query("agentRunEvents")
        .withIndex("by_run_seq", (q: any) => q.eq("runId", runId))
        .order("desc")
        .take(Math.min(Math.max(Math.floor(tail), 1), 500));
      return { run: runSummary(run), events: newest.reverse() };
    }
    const events = await ctx.db
      .query("agentRunEvents")
      .withIndex("by_run_seq", (q: any) => q.eq("runId", runId).gt("seq", afterSeq ?? 0))
      .take(Math.min(limit ?? 200, 500));
    return { run: runSummary(run), events };
  },
});

/* ------------------------------------------------------------------ */
/* Runner: registration, heartbeat, claiming                          */
/* ------------------------------------------------------------------ */

export const registerHost = mutationGeneric({
  args: {
    hostToken: v.string(),
    harnesses: v.array(harnessArg),
    os: v.optional(v.string()),
    arch: v.optional(v.string()),
    maxConcurrency: v.optional(v.number()),
    projectFileManifests: v.optional(v.boolean()),
    artifactUploads: v.optional(v.boolean()),
    isolatedChatAttachments: v.optional(v.boolean()),
    // Connector slugs this host provides locally (docs/connectors.md), e.g.
    // ["plaid", "imessage", "google"]. The connector inventory shows a
    // connector as available when a live host advertises its slug here.
    connectors: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    const now = Date.now();
    await ctx.db.patch(host._id, {
      capabilities: {
        harnesses: args.harnesses,
        os: args.os,
        arch: args.arch,
        maxConcurrency: Math.max(1, args.maxConcurrency ?? 1),
        projectFileManifests: args.projectFileManifests ?? false,
        artifactUploads: args.artifactUploads ?? false,
        isolatedChatAttachments: args.isolatedChatAttachments ?? false,
        ...(args.connectors ? { connectors: args.connectors } : {}),
      },
      lastHeartbeatAt: now,
      updatedAt: now,
    });
    return { hostId: host._id, brainInstanceId: host.brainInstanceId };
  },
});

export const hostHeartbeat = mutationGeneric({
  args: {
    hostToken: v.string(),
    activeRunIds: v.optional(v.array(v.id("agentRuns"))),
    activeChatTurnIds: v.optional(v.array(v.id("chatTurns"))),
    activeMaintenanceJobIds: v.optional(v.array(v.id("maintenanceJobs"))),
    activeAgentConfigIds: v.optional(v.array(v.id("agentConfigs"))),
  },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    const now = Date.now();
    await ctx.db.patch(host._id, { lastHeartbeatAt: now, updatedAt: now });
    // Renew leases only for work this host still claims to be doing.
    for (const runId of args.activeRunIds ?? []) {
      const run = await ctx.db.get(runId);
      if (run && run.hostId === host._id && (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status)) {
        await ctx.db.patch(runId, { leaseExpiresAt: now + RUN_LEASE_MS, updatedAt: now });
      }
    }
    for (const turnId of args.activeChatTurnIds ?? []) {
      const turn = await ctx.db.get(turnId);
      if (turn && turn.hostId === host._id && (turn.status === "claimed" || turn.status === "running")) {
        await ctx.db.patch(turnId, { leaseExpiresAt: now + RUN_LEASE_MS, updatedAt: now });
      }
    }
    for (const jobId of args.activeMaintenanceJobIds ?? []) {
      const job = await ctx.db.get(jobId);
      if (job && job.hostId === host._id && (job.status === "claimed" || job.status === "running")) {
        await ctx.db.patch(jobId, { leaseExpiresAt: now + RUN_LEASE_MS, updatedAt: now });
      }
    }
    // Agent passes (agentConfigs.claimNextAgentPass): claimToken presence is
    // the "still active" signal — completeAgentPass clears it.
    for (const configId of args.activeAgentConfigIds ?? []) {
      const config = await ctx.db.get(configId);
      if (config && config.claimedByHostId === host._id && config.claimToken) {
        await ctx.db.patch(configId, { leaseExpiresAt: now + RUN_LEASE_MS, updatedAt: now });
      }
    }
    return { draining: host.draining ?? false };
  },
});

/** Reactive work-discovery signal: the runner subscribes to this and attempts
 * a claim whenever it becomes non-empty. Also serves reconciliation polling. */
export const claimableRuns = queryGeneric({
  args: { hostToken: v.string() },
  handler: async (ctx, { hostToken }) => {
    const host = await requireHost(ctx, hostToken);
    const queued = await ctx.db
      .query("agentRuns")
      .withIndex("by_brain_status", (q: any) => q.eq("brainInstanceId", host.brainInstanceId).eq("status", "queued"))
      .collect();
    const harnesses: string[] = host.capabilities?.harnesses ?? [];
    return queued.filter((run: any) => harnesses.includes(run.harness) && (!(run.inputFileRefs?.length) || host.capabilities?.projectFileManifests)).map((run: any) => run._id);
  },
});

export const claimNextRun = mutationGeneric({
  args: { hostToken: v.string() },
  handler: async (ctx, { hostToken }) => {
    const host = await requireHost(ctx, hostToken);
    if (host.draining) return null;
    const now = Date.now();
    const harnesses: string[] = host.capabilities?.harnesses ?? [];

    // Enforce host concurrency.
    const hostRuns = await ctx.db
      .query("agentRuns")
      .withIndex("by_host", (q: any) => q.eq("hostId", host._id))
      .collect();
    const activeCount = hostRuns.filter(
      (run: any) => run.status !== "queued" && (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status),
    ).length;
    if (activeCount >= (host.capabilities?.maxConcurrency ?? 1)) return null;

    const queued = await ctx.db
      .query("agentRuns")
      .withIndex("by_brain_status", (q: any) => q.eq("brainInstanceId", host.brainInstanceId).eq("status", "queued"))
      .collect();
    queued.sort((a: any, b: any) => a.queuedAt - b.queuedAt);

    for (const run of queued) {
      if (!harnesses.includes(run.harness)) continue;
      if (run.inputFileRefs?.length && !host.capabilities?.projectFileManifests) continue;
      // The project must map to THIS host and be enabled.
      const config = await ctx.db
        .query("projectExecutionConfigs")
        .withIndex("by_brain_project", (q: any) =>
          q.eq("brainInstanceId", host.brainInstanceId).eq("projectId", run.projectId),
        )
        .first();
      if (!config || !config.enabled || config.hostId !== host._id) continue;
      // Only one active run may own a chat/worktree.
      const chatRuns = await ctx.db
        .query("agentRuns")
        .withIndex("by_brain_chat", (q: any) =>
          q.eq("brainInstanceId", host.brainInstanceId).eq("chatId", run.chatId),
        )
        .collect();
      const conflict = chatRuns.some(
        (r: any) =>
          r._id !== run._id &&
          r.status !== "queued" &&
          (ACTIVE_RUN_STATUSES as readonly string[]).includes(r.status),
      );
      if (conflict) continue;

      const claimToken = makeToken("skippyclaim");
      await ctx.db.patch(run._id, {
        status: "claimed",
        hostId: host._id,
        claimToken,
        claimVersion: run.claimVersion + 1,
        leaseExpiresAt: now + RUN_LEASE_MS,
        claimedAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(host._id, { lastClaimAt: now, updatedAt: now });

      const project = await ctx.db.get(run.projectId);
      const chat = await ctx.db.get(run.chatId);
      // Task title rides along so the runner can name the PR after the task
      // instead of the generic project string (unscannable PR list, #117–#124).
      const task = run.taskId ? await ctx.db.get(run.taskId) : null;
      const inputManifest = [];
      for (const ref of run.inputFileRefs ?? []) {
        const file = await ctx.db.get(ref.fileId);
        if (!file || (file.status ?? "ready") !== "ready" || !file.storageId) {
          if (ref.required) throw new Error(`required input ${ref.fileId} is no longer ready`);
          continue;
        }
        inputManifest.push({ fileId: file._id, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, sha256: file.sha256, required: ref.required, url: await ctx.storage.getUrl(file.storageId) });
      }
      // The authorized execution brief and project configuration — nothing more.
      return {
        runId: run._id,
        claimToken,
        harness: run.harness,
        model: run.model,
        attempt: run.attempt,
        taskId: run.taskId,
        taskTitle: task?.title,
        chatId: run.chatId,
        externalThreadId: chat?.externalThreadId,
        worktreePath: chat?.worktreePath,
        branchName: chat?.branchName,
        baseBranch: run.baseBranch,
        executionBrief: run.executionBrief,
        acceptanceCriteria: run.acceptanceCriteria,
        workspaceMode: project?.kind === "code" ? "code" : "temporary",
        inputManifest,
        outputPolicy: { enabled: host.capabilities?.artifactUploads ?? false, required: run.requiredArtifacts ?? false, maxFiles: 32, maxFileBytes: 26_214_400, maxTotalBytes: 104_857_600 },
        approvalPolicy: run.approvalPolicy,
        verifyCommand: config.verifyCommand,
        project: {
          _id: run.projectId,
          title: project?.title,
          repoUrl: project?.repoUrl,
          localPath: config.localPath,
        },
      };
    }
    return null;
  },
});

/* ------------------------------------------------------------------ */
/* Runner: status, events, approvals, control                         */
/* ------------------------------------------------------------------ */

export const updateRunStatus = mutationGeneric({
  args: {
    hostToken: v.string(),
    runId: v.id("agentRuns"),
    claimToken: v.string(),
    status: v.union(
      v.literal("preparing"),
      v.literal("running"),
      v.literal("waiting_for_approval"),
      v.literal("verifying"),
      v.literal("awaiting_publish_approval"),
      v.literal("publishing"),
      v.literal("in_review"),
      v.literal("interrupted"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    workingBranch: v.optional(v.string()),
    worktreePath: v.optional(v.string()),
    externalThreadId: v.optional(v.string()),
    errorCategory: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    verificationSummary: v.optional(v.string()),
    resultSummary: v.optional(v.string()),
    resultUrl: v.optional(v.string()),
    prUrl: v.optional(v.string()),
    prNumber: v.optional(v.number()),
    // Normalized session token totals (docs/token-efficiency.md lever 1).
    usage: v.optional(tokenUsage),
  },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    const run = await requireClaimedRun(ctx, host, args.runId, args.claimToken);
    const allowedFrom = HOST_REPORTABLE_TRANSITIONS[args.status];
    // Self-transitions are legal metadata updates (session id after a turn,
    // resuming `running` after an approval settles, lease refreshes).
    if (!allowedFrom || (run.status !== args.status && !allowedFrom.includes(run.status))) {
      throw new Error(`illegal run transition ${run.status} -> ${args.status}`);
    }
    if (args.status === "in_review" && run.requiredArtifacts) {
      const artifacts = await ctx.db.query("projectFiles").withIndex("by_run", (q: any) => q.eq("runId", run._id)).collect();
      if (!artifacts.some((file: any) => (file.status ?? "ready") === "ready" && (file.kind ?? "library_input") === "generated_artifact")) {
        throw new Error("required artifacts must be durable before review");
      }
    }
    const now = Date.now();
    const terminal = (TERMINAL_RUN_STATUSES as readonly string[]).includes(args.status);
    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: now,
      leaseExpiresAt: now + RUN_LEASE_MS,
    };
    if (!run.startedAt && (args.status === "running" || args.status === "preparing")) patch.startedAt = now;
    if (terminal || args.status === "interrupted") patch.completedAt = now;
    for (const key of [
      "workingBranch",
      "worktreePath",
      "errorCategory",
      "errorMessage",
      "verificationSummary",
      "resultSummary",
      "resultUrl",
      "prUrl",
      "prNumber",
      "usage",
    ] as const) {
      if (args[key] !== undefined) patch[key] = args[key];
    }
    await ctx.db.patch(args.runId, patch);

    // Keep the chat mapping current (worktree/branch/harness thread id).
    const chatPatch: Record<string, unknown> = { updatedAt: now };
    if (args.externalThreadId !== undefined) chatPatch.externalThreadId = args.externalThreadId;
    if (args.worktreePath !== undefined) chatPatch.worktreePath = args.worktreePath;
    if (args.workingBranch !== undefined) chatPatch.branchName = args.workingBranch;
    if (terminal) chatPatch.activeRunId = undefined;
    if (Object.keys(chatPatch).length > 1) await ctx.db.patch(run.chatId, chatPatch);

    // Reflect progress onto the task's supervised-execution lifecycle.
    if (run.taskId) {
      const task = await ctx.db.get(run.taskId);
      if (task) {
        if (args.status === "running" && task.executionState !== "in_progress") {
          await ctx.db.patch(run.taskId, {
            executionState: "in_progress",
            status: "in_progress",
            startedAt: task.startedAt ?? now,
            startedBy: `runner:${host.hostKey}:${run.harness}`,
            updatedAt: now,
          });
        }
        if (args.status === "in_review") {
          await ctx.db.patch(run.taskId, {
            executionState: "in_review",
            status: "in_progress",
            agentRequestStatus: undefined,
            gitBranchName: args.workingBranch ?? run.workingBranch,
            prUrl: args.prUrl ?? run.prUrl,
            prNumber: args.prNumber ?? run.prNumber,
            prStatus: args.prUrl ?? run.prUrl ? "open" : task.prStatus,
            lastPrCreatedAt: args.prUrl ? now : task.lastPrCreatedAt,
            resultSummary: args.resultSummary ?? run.resultSummary,
            resultUrl: args.resultUrl ?? run.resultUrl,
            resultRecordedAt: now,
            updatedAt: now,
          });
        }
        // Dead-run cleanup (2026-08-20 incident): a failed/interrupted/
        // cancelled run previously left its task orphaned — executionState
        // stuck at in_progress and agentRequestStatus stuck at "requested",
        // which hid the play button and made the board lie about live work.
        // Return the task to ready so the next attempt is one click (or one
        // executeTaskForBrain call) away. in_review tasks are left alone:
        // their work is preserved on a branch and has its own resume path.
        if (
          ["failed", "interrupted", "cancelled"].includes(args.status) &&
          task.executionState === "in_progress"
        ) {
          await ctx.db.patch(run.taskId, {
            executionState: "ready",
            status: "todo",
            agentRequestStatus: undefined,
            updatedAt: now,
          });
          await ctx.db.insert("activityEvents", {
            brainInstanceId: host.brainInstanceId,
            entityRef: { entityType: "task", entityId: run.taskId },
            activityType: "agent_run_failed_task_reset",
            actorType: "system",
            timestamp: now,
            summary: `Run ${args.status}; task returned to Ready for retry: ${task.title}`,
            metadata: { runId: args.runId, runStatus: args.status, ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}) },
          });
        }
      }
    }

    if (terminal || args.status === "interrupted") {
      // Settle any still-pending approvals so nothing waits on a dead run.
      const approvals = await ctx.db
        .query("agentApprovals")
        .withIndex("by_run", (q: any) => q.eq("runId", args.runId))
        .collect();
      for (const approval of approvals) {
        if (approval.status === "pending") {
          await ctx.db.patch(approval._id, {
            status: args.status === "interrupted" ? "expired" : "cancelled",
            reason: `run reached ${args.status} before this approval was decided`,
            updatedAt: now,
          });
        }
      }
    }

    return { runId: args.runId, status: args.status };
  },
});

export const reportRunEvents = mutationGeneric({
  args: {
    hostToken: v.string(),
    runId: v.id("agentRuns"),
    claimToken: v.string(),
    events: v.array(
      v.object({
        seq: v.number(),
        type: v.string(),
        payload: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    const run = await requireClaimedRun(ctx, host, args.runId, args.claimToken);
    const now = Date.now();
    let highWater = run.lastEventSeq ?? 0;
    let inserted = 0;
    for (const event of args.events) {
      if (event.seq <= 0) continue;
      // Fast path: anything at or below the high-water mark is a replay.
      if (event.seq <= highWater) continue;
      const existing = await ctx.db
        .query("agentRunEvents")
        .withIndex("by_run_seq", (q: any) => q.eq("runId", args.runId).eq("seq", event.seq))
        .first();
      if (existing) continue;
      await ctx.db.insert("agentRunEvents", {
        brainInstanceId: host.brainInstanceId,
        runId: args.runId,
        seq: event.seq,
        type: event.type,
        payload: event.payload,
        createdAt: now,
      });
      inserted += 1;
      if (event.seq > highWater) highWater = event.seq;
    }
    if (highWater !== (run.lastEventSeq ?? 0)) {
      await ctx.db.patch(args.runId, { lastEventSeq: highWater, updatedAt: now });
    }
    return { inserted, lastEventSeq: highWater };
  },
});

export const requestApproval = mutationGeneric({
  args: {
    hostToken: v.string(),
    runId: v.id("agentRuns"),
    claimToken: v.string(),
    harnessRequestId: v.string(),
    kind: v.union(
      v.literal("command"),
      v.literal("file_change"),
      v.literal("network"),
      v.literal("secret"),
      v.literal("push"),
      v.literal("pr"),
      v.literal("deployment"),
      v.literal("user_input"),
    ),
    title: v.string(),
    explanation: v.optional(v.string()),
    details: v.optional(v.any()),
    availableDecisions: v.optional(v.array(v.string())),
    scope: v.optional(v.union(v.literal("command"), v.literal("turn"), v.literal("session"))),
  },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    const run = await requireClaimedRun(ctx, host, args.runId, args.claimToken);
    // Idempotent by (runId, harnessRequestId): a retried request returns the
    // existing record, so it cannot mint a second pending approval.
    const existing = await ctx.db
      .query("agentApprovals")
      .withIndex("by_run_request", (q: any) => q.eq("runId", args.runId).eq("harnessRequestId", args.harnessRequestId))
      .first();
    if (existing) {
      return { approvalId: existing._id, status: existing.status };
    }
    const now = Date.now();
    const approvalId = await ctx.db.insert("agentApprovals", {
      brainInstanceId: host.brainInstanceId,
      runId: args.runId,
      harnessRequestId: args.harnessRequestId,
      kind: args.kind,
      title: args.title,
      explanation: args.explanation,
      details: args.details,
      availableDecisions: args.availableDecisions,
      status: "pending",
      scope: args.scope,
      createdAt: now,
      updatedAt: now,
    });
    if (run.status === "running" || run.status === "verifying") {
      await ctx.db.patch(args.runId, { status: "waiting_for_approval", updatedAt: now });
    }
    return { approvalId, status: "pending" };
  },
});

/**
 * Runner-initiated cancellation of a still-pending approval, with an explicit
 * reason — used when the runner's configured approval timeout expires
 * (SKIPPY_RUNNER_APPROVAL_TIMEOUT_MS). Idempotent by the same contract as
 * decisions: a settled approval is never flipped.
 */
export const cancelApproval = mutationGeneric({
  args: {
    hostToken: v.string(),
    runId: v.id("agentRuns"),
    claimToken: v.string(),
    harnessRequestId: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    await requireClaimedRun(ctx, host, args.runId, args.claimToken);
    const approval = await ctx.db
      .query("agentApprovals")
      .withIndex("by_run_request", (q: any) => q.eq("runId", args.runId).eq("harnessRequestId", args.harnessRequestId))
      .first();
    if (!approval) throw new Error("approval not found for run");
    if (approval.status !== "pending") {
      return { approvalId: approval._id, status: approval.status };
    }
    const now = Date.now();
    await ctx.db.patch(approval._id, {
      status: "cancelled",
      reason: args.reason.slice(0, 500),
      decidedAt: now,
      updatedAt: now,
    });
    return { approvalId: approval._id, status: "cancelled" };
  },
});

/** Control state the runner subscribes to while executing a run: approval
 * decisions and cancellation. Reactive via Convex subscriptions. */
export const runControlState = queryGeneric({
  args: {
    hostToken: v.string(),
    runId: v.id("agentRuns"),
  },
  handler: async (ctx, { hostToken, runId }) => {
    const host = await requireHost(ctx, hostToken);
    const run = await ctx.db.get(runId);
    if (!run || run.brainInstanceId !== host.brainInstanceId) throw new Error("run not found");
    const approvals = await ctx.db
      .query("agentApprovals")
      .withIndex("by_run", (q: any) => q.eq("runId", runId))
      .collect();
    return {
      status: run.status,
      cancelRequested: run.cancelRequested ?? false,
      approvals: approvals.map((a: any) => ({
        _id: a._id,
        harnessRequestId: a.harnessRequestId,
        status: a.status,
        decidedAt: a.decidedAt,
      })),
    };
  },
});

/** Runs this host owns that are still active — used by the runner at startup
 * to reconcile after a restart (resume or mark interrupted; never blindly
 * start a second harness against the same worktree). */
export const hostActiveRuns = queryGeneric({
  args: { hostToken: v.string() },
  handler: async (ctx, { hostToken }) => {
    const host = await requireHost(ctx, hostToken);
    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_host", (q: any) => q.eq("hostId", host._id))
      .collect();
    return runs
      .filter((run: any) => run.status !== "queued" && (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status))
      .map((run: any) => ({
        runId: run._id,
        status: run.status,
        harness: run.harness,
        claimToken: run.claimToken,
        chatId: run.chatId,
        taskId: run.taskId,
        worktreePath: run.worktreePath,
        workingBranch: run.workingBranch,
        leaseExpiresAt: run.leaseExpiresAt,
      }));
  },
});

/* ------------------------------------------------------------------ */
/* Maintenance jobs: post-merge close-out                             */
/* ------------------------------------------------------------------ */

/**
 * The post-merge close-out ritual as a fixed, deterministic checklist
 * (previously performed manually in chat for PRs #116–#124). The server
 * seeds this list at enqueue time so the task panel can render the whole
 * ritual as pending immediately; the runner updates step statuses by key.
 * Convex deploy is a skipped step by design: the convex-deploy.yml GitHub
 * Action owns deployment on merge to main.
 */
export const CLOSEOUT_STEPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "verify_merged", label: "Verify the PR is merged" },
  { key: "pull_main", label: "Pull latest main in the canonical checkout" },
  { key: "convex_deploy", label: "Convex deploy" },
  { key: "runner_rebuild", label: "Rebuild runner if it changed" },
  { key: "cleanup", label: "Remove worktree and delete agent branch" },
  { key: "finalize", label: "Mark task done (PR merged)" },
];

const CLOSEOUT_ACTIVE_STATUSES = ["queued", "claimed", "running"] as const;

const maintenanceStepsArg = v.array(
  v.object({
    key: v.string(),
    label: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("ok"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    detail: v.optional(v.string()),
  }),
);

/** Host must own the job and present the claim token minted at claim time —
 * same contract as requireClaimedRun. */
async function requireClaimedJob(ctx: any, host: any, jobId: string, claimToken: string) {
  const job = await ctx.db.get(jobId);
  if (!job || job.brainInstanceId !== host.brainInstanceId) {
    throw new Error("maintenance job not found");
  }
  if (job.hostId !== host._id || !job.claimToken || job.claimToken !== claimToken) {
    throw new Error("maintenance job is not claimed by this host");
  }
  return job;
}

/**
 * Shared enqueue path for the panel button and the chat harness — one backend
 * job, two entry points, so the two close-out surfaces cannot drift (mirrors
 * queueTaskExecution). Validation is deliberately light on merge state: the
 * stored prStatus lags reality (the merge happens on GitHub), so the RUNNER
 * verifies the PR is actually merged at execution time via gh and refuses
 * politely if not.
 */
async function queueCloseout(
  ctx: any,
  brainId: any,
  opts: {
    taskId: any;
    actor: { actorType: "user" | "harness"; actorId?: string; requestedBy?: string };
  },
) {
  const task = await ctx.db.get(opts.taskId);
  if (!task || task.brainInstanceId !== brainId) throw new Error("task not found");
  if ((task.executionState ?? "") !== "in_review") {
    throw new Error("only in_review tasks can be closed out");
  }
  if (!task.prUrl) throw new Error("task has no pull request recorded; nothing to close out");

  const projectId = await projectIdForTask(ctx.db, brainId, opts.taskId);
  if (!projectId) throw new Error("task is not linked to a project");
  const project = await ctx.db.get(projectId);
  if (!project) throw new Error("project not found");
  const config = await ctx.db
    .query("projectExecutionConfigs")
    .withIndex("by_brain_project", (q: any) => q.eq("brainInstanceId", brainId).eq("projectId", projectId))
    .first();
  if (!config || !config.enabled) {
    throw new Error("project has no enabled execution host mapping");
  }

  // Duplicate close-out request: return the existing active job rather than
  // queueing a competing one.
  const jobs = await ctx.db
    .query("maintenanceJobs")
    .withIndex("by_brain_task", (q: any) => q.eq("brainInstanceId", brainId).eq("taskId", opts.taskId))
    .collect();
  const active = jobs.find((job: any) => (CLOSEOUT_ACTIVE_STATUSES as readonly string[]).includes(job.status));
  if (active) return { jobId: active._id, status: active.status, existing: true };

  const now = Date.now();
  const jobId = await ctx.db.insert("maintenanceJobs", {
    brainInstanceId: brainId,
    kind: "post_merge_closeout",
    taskId: opts.taskId,
    projectId,
    status: "queued",
    prUrl: task.prUrl,
    ...(task.prNumber !== undefined ? { prNumber: task.prNumber } : {}),
    ...(task.gitBranchName ? { gitBranchName: task.gitBranchName } : {}),
    baseBranch: project.defaultBaseBranch ?? "main",
    steps: CLOSEOUT_STEPS.map((step) => ({ ...step, status: "pending" })),
    ...(opts.actor.requestedBy ? { requestedBy: opts.actor.requestedBy } : {}),
    queuedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("activityEvents", {
    brainInstanceId: brainId,
    entityRef: { entityType: "task", entityId: opts.taskId },
    activityType: "task_closeout_queued",
    actorType: opts.actor.actorType,
    actorId: opts.actor.actorId,
    timestamp: now,
    summary: `Post-merge close-out queued: ${task.title}`,
    metadata: { jobId, prUrl: task.prUrl },
  });
  return { jobId, status: "queued", existing: false };
}

/** The task panel's "Confirm merge & close out" button. */
export const enqueueCloseoutForViewer = mutationGeneric({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    return queueCloseout(ctx, brain._id, {
      taskId: args.taskId,
      actor: { actorType: "user", actorId: user._id, requestedBy: user.displayName ?? user.email },
    });
  },
});

/**
 * Host-authenticated close-out for the chat path — the owner says "close out
 * task X" in chat and the harness queues the SAME job the button does (same
 * consent convention as executeTaskForBrain, same host-token credential).
 */
export const enqueueCloseoutForBrain = mutationGeneric({
  args: {
    hostToken: v.string(),
    taskId: v.id("tasks"),
    actorId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    const actorId = args.actorId ?? "chat-harness";
    return queueCloseout(ctx, host.brainInstanceId, {
      taskId: args.taskId,
      actor: { actorType: "harness", actorId, requestedBy: actorId },
    });
  },
});

/** Latest close-out job for a task, for the panel's progress/steps view. */
export const closeoutJobForTaskForViewer = queryGeneric({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { brain } = await requireOwnedBrain(ctx);
    const jobs = await ctx.db
      .query("maintenanceJobs")
      .withIndex("by_brain_task", (q: any) => q.eq("brainInstanceId", brain._id).eq("taskId", taskId))
      .collect();
    if (!jobs.length) return null;
    jobs.sort((a: any, b: any) => b.createdAt - a.createdAt);
    const job = jobs[0];
    return {
      _id: job._id,
      kind: job.kind,
      status: job.status,
      steps: job.steps,
      prUrl: job.prUrl,
      prNumber: job.prNumber,
      gitBranchName: job.gitBranchName,
      errorMessage: job.errorMessage,
      resultSummary: job.resultSummary,
      queuedAt: job.queuedAt,
      completedAt: job.completedAt,
      updatedAt: job.updatedAt,
    };
  },
});

/**
 * Atomic claim for the oldest queued maintenance job whose project maps to
 * this host — the runs/chat-turns claim pattern with a fresh claim token and
 * lease. Concurrency is enforced runner-side (one job at a time); jobs are
 * lightweight scripted work, not harness sessions.
 */
export const claimNextMaintenanceJob = mutationGeneric({
  args: { hostToken: v.string() },
  handler: async (ctx, { hostToken }) => {
    const host = await requireHost(ctx, hostToken);
    if (host.draining) return null;
    const now = Date.now();
    const queued = await ctx.db
      .query("maintenanceJobs")
      .withIndex("by_brain_status", (q: any) =>
        q.eq("brainInstanceId", host.brainInstanceId).eq("status", "queued"),
      )
      .collect();
    queued.sort((a: any, b: any) => a.queuedAt - b.queuedAt);
    for (const job of queued) {
      // The job's project must map to THIS host and be enabled.
      const config = await ctx.db
        .query("projectExecutionConfigs")
        .withIndex("by_brain_project", (q: any) =>
          q.eq("brainInstanceId", host.brainInstanceId).eq("projectId", job.projectId),
        )
        .first();
      if (!config || !config.enabled || config.hostId !== host._id) continue;

      const claimToken = makeToken("skippyclaim");
      await ctx.db.patch(job._id, {
        status: "claimed",
        hostId: host._id,
        claimToken,
        leaseExpiresAt: now + RUN_LEASE_MS,
        claimedAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(host._id, { lastClaimAt: now, updatedAt: now });

      const task = await ctx.db.get(job.taskId);
      const project = await ctx.db.get(job.projectId);
      return {
        jobId: job._id,
        claimToken,
        kind: job.kind,
        taskId: job.taskId,
        taskTitle: task?.title,
        prUrl: job.prUrl,
        prNumber: job.prNumber,
        gitBranchName: job.gitBranchName ?? task?.gitBranchName,
        baseBranch: job.baseBranch,
        steps: job.steps,
        project: {
          _id: job.projectId,
          title: project?.title,
          localPath: config.localPath,
        },
      };
    }
    return null;
  },
});

/** Legal maintenance-job transitions the host may report. Self-transition on
 * `running` is the step-progress update path. */
const MAINTENANCE_REPORTABLE_TRANSITIONS: Record<string, string[]> = {
  running: ["claimed", "running"],
  completed: ["claimed", "running"],
  failed: ["claimed", "running"],
};

/**
 * Runner progress/result reporting for a claimed maintenance job. Step
 * updates ride along on the same mutation as status changes. On `completed`
 * the task is marked done with prStatus "merged" through applyTaskResult —
 * the exact recordTaskResult semantics the chat ritual used. On `failed`
 * the task is left untouched (in_review) with the error visible on the job:
 * a failed step never leaves a silent half-done state.
 */
export const updateMaintenanceJob = mutationGeneric({
  args: {
    hostToken: v.string(),
    jobId: v.id("maintenanceJobs"),
    claimToken: v.string(),
    status: v.optional(v.union(v.literal("running"), v.literal("completed"), v.literal("failed"))),
    steps: v.optional(maintenanceStepsArg),
    errorMessage: v.optional(v.string()),
    resultSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    const job = await requireClaimedJob(ctx, host, args.jobId, args.claimToken);
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      // Idempotent from the runner's perspective: a retried terminal report
      // never re-runs completion side effects.
      return { jobId: args.jobId, status: job.status };
    }
    if (args.status) {
      const allowedFrom = MAINTENANCE_REPORTABLE_TRANSITIONS[args.status];
      if (!allowedFrom || !allowedFrom.includes(job.status)) {
        throw new Error(`illegal maintenance job transition ${job.status} -> ${args.status}`);
      }
    }
    const now = Date.now();
    const terminal = args.status === "completed" || args.status === "failed";
    const patch: Record<string, unknown> = {
      updatedAt: now,
      leaseExpiresAt: now + RUN_LEASE_MS,
    };
    if (args.status) patch.status = args.status;
    if (args.steps !== undefined) patch.steps = args.steps;
    if (args.errorMessage !== undefined) patch.errorMessage = args.errorMessage.slice(0, 1000);
    if (args.resultSummary !== undefined) patch.resultSummary = args.resultSummary.slice(0, 2000);
    if (terminal) patch.completedAt = now;
    await ctx.db.patch(args.jobId, patch);

    const task = await ctx.db.get(job.taskId);
    if (args.status === "completed") {
      // Close the task out exactly the way the chat ritual did.
      await applyTaskResult(
        ctx.db,
        host.brainInstanceId,
        { taskId: job.taskId, markDone: true, prStatus: "merged" },
        { actorType: "harness", actorId: `runner-closeout:${host.hostKey}` },
      );
      await ctx.db.insert("activityEvents", {
        brainInstanceId: host.brainInstanceId,
        entityRef: { entityType: "task", entityId: job.taskId },
        activityType: "task_closeout_completed",
        actorType: "harness",
        actorId: `runner-closeout:${host.hostKey}`,
        timestamp: now,
        summary: `Post-merge close-out completed: ${task?.title ?? job.taskId}`,
        metadata: { jobId: args.jobId, prUrl: job.prUrl },
      });
    } else if (args.status === "failed") {
      await ctx.db.insert("activityEvents", {
        brainInstanceId: host.brainInstanceId,
        entityRef: { entityType: "task", entityId: job.taskId },
        activityType: "task_closeout_failed",
        actorType: "harness",
        actorId: `runner-closeout:${host.hostKey}`,
        timestamp: now,
        summary: `Post-merge close-out failed: ${task?.title ?? job.taskId}`,
        metadata: {
          jobId: args.jobId,
          prUrl: job.prUrl,
          ...(args.errorMessage ? { errorMessage: args.errorMessage.slice(0, 500) } : {}),
        },
      });
    }
    return { jobId: args.jobId, status: args.status ?? job.status };
  },
});

/** Maintenance jobs this host owns that are still active — startup
 * reconciliation after a restart (mirror of hostActiveRuns). */
export const hostActiveMaintenanceJobs = queryGeneric({
  args: { hostToken: v.string() },
  handler: async (ctx, { hostToken }) => {
    const host = await requireHost(ctx, hostToken);
    const jobs = await ctx.db
      .query("maintenanceJobs")
      .withIndex("by_host", (q: any) => q.eq("hostId", host._id))
      .collect();
    return jobs
      .filter((job: any) => job.status === "claimed" || job.status === "running")
      .map((job: any) => ({
        jobId: job._id,
        status: job.status,
        kind: job.kind,
        claimToken: job.claimToken,
        taskId: job.taskId,
        leaseExpiresAt: job.leaseExpiresAt,
      }));
  },
});
