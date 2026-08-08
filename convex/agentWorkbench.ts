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

async function requireHost(ctx: any, hostToken: string) {
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

export const setProjectExecutionConfigForViewer = mutationGeneric({
  args: {
    projectId: v.id("projects"),
    hostId: v.id("agentHosts"),
    localPath: v.string(),
    preferredHarness: v.optional(harnessArg),
    requirePushApproval: v.optional(v.boolean()),
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

export const executeTaskForViewer = mutationGeneric({
  args: {
    taskId: v.id("tasks"),
    harness: v.optional(harnessArg),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.brainInstanceId !== brain._id) throw new Error("task not found");
    if (task.processingState !== "accepted") throw new Error("only accepted tasks can be executed");
    if (task.ownerType !== "agent") throw new Error("only agent-owned tasks can be executed");
    const executionState = task.executionState ?? (task.status === "done" ? "done" : "ready");
    if (executionState !== "ready") throw new Error("only ready tasks can be executed");

    // Duplicate execution request: return the existing active run and its chat
    // rather than creating a competing run.
    const existing = await activeRunForTask(ctx.db, brain._id, args.taskId);
    if (existing) {
      return { runId: existing._id, chatId: existing.chatId, status: existing.status, existing: true };
    }

    const projectId = await projectIdForTask(ctx.db, brain._id, args.taskId);
    if (!projectId) throw new Error("task is not linked to a project");
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("project not found");
    if ((project.kind ?? "general") !== "code" || !project.repoUrl) {
      throw new Error("task's project is not a code project with a configured repository");
    }
    const config = await ctx.db
      .query("projectExecutionConfigs")
      .withIndex("by_brain_project", (q: any) => q.eq("brainInstanceId", brain._id).eq("projectId", projectId))
      .first();
    if (!config || !config.enabled) {
      throw new Error("project has no enabled execution host mapping");
    }

    // Harness resolution order (docs/mac-mini-agent-workbench.md → Harness):
    // explicit pick → task.requestedHarness when it is a valid enum value →
    // project preferredHarness → default "claude".
    const harness: AgentHarness =
      args.harness ??
      (isHarness(task.requestedHarness) ? task.requestedHarness : undefined) ??
      config.preferredHarness ??
      "claude";

    const now = Date.now();

    // Reuse the task chat only when its harness matches — a chat is bound to
    // one harness for its lifetime (context lives in the harness thread).
    const chats = await ctx.db
      .query("projectChats")
      .withIndex("by_brain_task", (q: any) => q.eq("brainInstanceId", brain._id).eq("taskId", args.taskId))
      .collect();
    let chat = chats.find(
      (c: any) => c.kind === "task" && c.state !== "archived" && (!c.harness || c.harness === harness),
    );
    let chatId = chat?._id;
    if (!chatId) {
      chatId = await ctx.db.insert("projectChats", {
        brainInstanceId: brain._id,
        projectId,
        taskId: args.taskId,
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
      .withIndex("by_brain_task", (q: any) => q.eq("brainInstanceId", brain._id).eq("taskId", args.taskId))
      .collect();

    const runId = await ctx.db.insert("agentRuns", {
      brainInstanceId: brain._id,
      projectId,
      chatId,
      taskId: args.taskId,
      attempt: priorRuns.length + 1,
      status: "queued",
      harness,
      baseBranch: project.defaultBaseBranch ?? "main",
      executionBrief: task.executionBrief,
      acceptanceCriteria: task.acceptanceCriteria,
      approvalPolicy: config.approvalPolicy ?? { requirePushApproval: true },
      claimVersion: 0,
      queuedAt: now,
      lastEventSeq: 0,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(chatId, { activeRunId: runId, updatedAt: now });
    await ctx.db.patch(args.taskId, {
      agentRequestStatus: "requested",
      agentRequestedAt: task.agentRequestedAt ?? now,
      agentRequestedBy: user.displayName ?? user.email,
      updatedAt: now,
    });
    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      entityRef: { entityType: "task", entityId: args.taskId },
      activityType: "agent_run_queued",
      actorType: "user",
      actorId: user._id,
      timestamp: now,
      summary: `Execution queued (${harness}): ${task.title}`,
      metadata: { runId, chatId, harness },
    });

    return { runId, chatId, status: "queued", existing: false };
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
      kind: a.kind,
      title: a.title,
      explanation: a.explanation,
      details: a.details,
      availableDecisions: a.availableDecisions ?? ["accepted", "declined"],
      createdAt: a.createdAt,
    }));
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
  },
  handler: async (ctx, { runId, afterSeq, limit }) => {
    const { brain } = await requireOwnedBrain(ctx);
    const run = await ctx.db.get(runId);
    if (!run || run.brainInstanceId !== brain._id) throw new Error("run not found");
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
  },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    const now = Date.now();
    await ctx.db.patch(host._id, { lastHeartbeatAt: now, updatedAt: now });
    // Renew leases only for runs this host still claims to be working.
    for (const runId of args.activeRunIds ?? []) {
      const run = await ctx.db.get(runId);
      if (run && run.hostId === host._id && (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status)) {
        await ctx.db.patch(runId, { leaseExpiresAt: now + RUN_LEASE_MS, updatedAt: now });
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
    return queued.filter((run: any) => harnesses.includes(run.harness)).map((run: any) => run._id);
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
      // The authorized execution brief and project configuration — nothing more.
      return {
        runId: run._id,
        claimToken,
        harness: run.harness,
        attempt: run.attempt,
        taskId: run.taskId,
        chatId: run.chatId,
        externalThreadId: chat?.externalThreadId,
        worktreePath: chat?.worktreePath,
        branchName: chat?.branchName,
        baseBranch: run.baseBranch,
        executionBrief: run.executionBrief,
        acceptanceCriteria: run.acceptanceCriteria,
        approvalPolicy: run.approvalPolicy,
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
