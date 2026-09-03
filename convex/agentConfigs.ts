import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { nextAgentDueAt, validateAgentSchedule, type AgentSchedule } from "@skippy/shared";
import { requireOwnedBrain } from "./auth";
import { requireHost } from "./agentWorkbench";

/**
 * Stored agent configuration (docs/connectors.md): the promotion of Phase 5
 * role strings to records. roleKey doubles as the attribution key on run
 * records (metadata.role). Configs ship disabled; the mini runner's agent-pass
 * loop claims due, enabled configs.
 */

const agentHarness = v.union(v.literal("codex"), v.literal("claude"));

const agentScheduleValidator = v.union(
  v.object({
    kind: v.literal("interval"),
    everyMinutes: v.number(),
    window: v.optional(v.object({ start: v.string(), end: v.string() })),
    timeZone: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("daily"),
    timesOfDay: v.array(v.string()),
    timeZone: v.optional(v.string()),
  }),
);

// Same shape rule as mcpTokens.isValidTokenRole, plus this is where new role
// keys would be admitted once they exist as skills.
function isValidRoleKey(roleKey: string) {
  return (
    roleKey === "agenda" ||
    roleKey === "finance" ||
    roleKey === "task-executor" ||
    roleKey === "pm" ||
    /^pm:[a-z0-9]+$/i.test(roleKey)
  );
}

const OWNER_TIME_ZONE = "America/New_York";

const SEED_CONFIGS: Array<{
  roleKey: string;
  displayName: string;
  skillSlugs: string[];
  connectorSlugs: string[];
  schedule?: AgentSchedule;
  model?: string;
}> = [
  {
    roleKey: "agenda",
    displayName: "Agenda Agent",
    skillSlugs: ["harness-bootstrap", "agenda-ingestion"],
    connectorSlugs: ["google", "imessage"],
    // Settled budget (docs/token-efficiency.md §2.7, owner decision
    // 2026-08-29): hourly inside waking hours, and Agenda is the ONLY
    // scheduled agent — every other role runs on demand. Seeds only apply on
    // first insert; bump any live config in the Agents hub to match.
    schedule: {
      kind: "interval",
      everyMinutes: 60,
      window: { start: "09:00", end: "21:00" },
      timeZone: OWNER_TIME_ZONE,
    },
    // Background triage doesn't need Opus-class reasoning (token tiering,
    // docs/token-efficiency.md §4). Interactive chat is never tiered down.
    model: "sonnet",
  },
  {
    roleKey: "finance",
    displayName: "Financial Agent",
    skillSlugs: ["harness-bootstrap", "finance-sync"],
    connectorSlugs: ["plaid"],
    // No schedule (owner decision 2026-08-29): only Agenda runs on a clock;
    // finance syncs run on demand from chat or the Agents hub.
    model: "sonnet",
  },
  {
    roleKey: "task-executor",
    displayName: "Task Agent",
    skillSlugs: ["harness-bootstrap", "task-heartbeat"],
    connectorSlugs: [],
    // No schedule: the runner's existing task-claim loop is its execution
    // path; the config exists for inventory, token binding, and UI.
  },
];

export const listForViewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const configs = await ctx.db
      .query("agentConfigs")
      .withIndex("by_brain_role", (q: any) => q.eq("brainInstanceId", brain._id))
      .collect();

    return await Promise.all(
      configs.map(async (config: any) => {
        const token = config.mcpTokenId ? await ctx.db.get(config.mcpTokenId) : null;
        return {
          _id: config._id,
          roleKey: config.roleKey,
          displayName: config.displayName,
          skillSlugs: config.skillSlugs,
          connectorSlugs: config.connectorSlugs,
          preferredHarness: config.preferredHarness,
          model: config.model,
          schedule: config.schedule,
          enabled: config.enabled,
          nextDueAt: config.nextDueAt,
          lastRunStartedAt: config.lastRunStartedAt,
          lastRunStatus: config.lastRunStatus,
          token: token
            ? {
                _id: token._id,
                label: token.label,
                tokenPrefix: token.tokenPrefix,
                role: token.role,
                revoked: Boolean(token.revokedAt),
              }
            : null,
          createdAt: config.createdAt,
          updatedAt: config.updatedAt,
        };
      }),
    );
  },
});

export const upsertForViewer = mutationGeneric({
  args: {
    roleKey: v.string(),
    displayName: v.optional(v.string()),
    skillSlugs: v.optional(v.array(v.string())),
    connectorSlugs: v.optional(v.array(v.string())),
    mcpTokenId: v.optional(v.union(v.id("mcpTokens"), v.null())),
    preferredHarness: v.optional(v.union(agentHarness, v.null())),
    // Harness-native model name/alias for scheduled passes; null clears back
    // to the harness default (token tiering, docs/token-efficiency.md §4).
    model: v.optional(v.union(v.string(), v.null())),
    schedule: v.optional(v.union(agentScheduleValidator, v.null())),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const roleKey = args.roleKey.trim();
    if (!isValidRoleKey(roleKey)) {
      throw new Error(
        `invalid roleKey '${roleKey}': expected agenda, finance, task-executor, pm, or pm:{projectId}`,
      );
    }
    if (args.schedule) {
      validateAgentSchedule(args.schedule as AgentSchedule);
    }
    if (args.mcpTokenId) {
      const token = await ctx.db.get(args.mcpTokenId);
      if (!token || token.brainInstanceId !== brain._id) {
        throw new Error("token not found");
      }
      if (token.revokedAt) {
        throw new Error("cannot bind a revoked token");
      }
      // A role-scoped token must match the config's role; unscoped tokens are
      // allowed but lose the least-privilege benefit.
      if (token.role && token.role !== roleKey) {
        throw new Error(`token role '${token.role}' does not match config role '${roleKey}'`);
      }
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("agentConfigs")
      .withIndex("by_brain_role", (q: any) => q.eq("brainInstanceId", brain._id).eq("roleKey", roleKey))
      .first();

    const schedule =
      args.schedule === undefined ? existing?.schedule : args.schedule === null ? undefined : args.schedule;
    const enabled = args.enabled ?? existing?.enabled ?? false;
    // nextDueAt is only meaningful for enabled, scheduled configs. Recompute
    // from "now" on every change — schedule-anchored, future-only.
    const nextDueAt = enabled && schedule ? nextAgentDueAt(schedule as AgentSchedule, now) : undefined;

    const fields = {
      displayName: args.displayName?.trim() || existing?.displayName || roleKey,
      skillSlugs: args.skillSlugs ?? existing?.skillSlugs ?? [],
      connectorSlugs: args.connectorSlugs ?? existing?.connectorSlugs ?? [],
      mcpTokenId:
        args.mcpTokenId === undefined
          ? existing?.mcpTokenId
          : args.mcpTokenId === null
            ? undefined
            : args.mcpTokenId,
      preferredHarness:
        args.preferredHarness === undefined
          ? existing?.preferredHarness
          : args.preferredHarness === null
            ? undefined
            : args.preferredHarness,
      model:
        args.model === undefined
          ? existing?.model
          : args.model === null
            ? undefined
            : args.model.trim() || undefined,
      schedule,
      enabled,
      nextDueAt,
      updatedAt: now,
    };

    let configId;
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      configId = existing._id;
    } else {
      configId = await ctx.db.insert("agentConfigs", {
        brainInstanceId: brain._id,
        roleKey,
        claimVersion: 0,
        createdAt: now,
        ...fields,
      });
    }

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: existing ? "agent_config_updated" : "agent_config_created",
      actorType: "user",
      timestamp: now,
      summary: `${existing ? "Agent config updated" : "Agent config created"}: ${fields.displayName} (${roleKey})${enabled ? "" : " — disabled"}`,
      metadata: { configId, roleKey, enabled },
    });

    return { configId, roleKey, status: existing ? "updated" : "created", nextDueAt };
  },
});

export const seedDefaultsForViewer = mutationGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const now = Date.now();
    const created: string[] = [];

    const seeds = [...SEED_CONFIGS];
    // One PM config per in-progress project, per the one-skill-many-projects
    // decision (docs/project-manager-agent.md).
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_brain_status", (q: any) =>
        q.eq("brainInstanceId", brain._id).eq("status", "in_progress"),
      )
      .collect();
    for (const project of projects) {
      seeds.push({
        roleKey: `pm:${project._id}`,
        displayName: `PM: ${project.title ?? "project"}`,
        skillSlugs: ["harness-bootstrap", "project-manager"],
        connectorSlugs: [],
        // No schedule (owner decision 2026-08-29): only Agenda runs on a
        // clock; PM passes are kicked off on demand.
        model: "sonnet",
      });
    }

    for (const seed of seeds) {
      const existing = await ctx.db
        .query("agentConfigs")
        .withIndex("by_brain_role", (q: any) =>
          q.eq("brainInstanceId", brain._id).eq("roleKey", seed.roleKey),
        )
        .first();
      if (existing) continue;
      await ctx.db.insert("agentConfigs", {
        brainInstanceId: brain._id,
        roleKey: seed.roleKey,
        displayName: seed.displayName,
        skillSlugs: seed.skillSlugs,
        connectorSlugs: seed.connectorSlugs,
        schedule: seed.schedule,
        model: seed.model,
        enabled: false, // ship disabled; owner enables per the migration plan
        claimVersion: 0,
        createdAt: now,
        updatedAt: now,
      });
      created.push(seed.roleKey);
    }

    if (created.length) {
      await ctx.db.insert("activityEvents", {
        brainInstanceId: brain._id,
        activityType: "agent_config_created",
        actorType: "user",
        timestamp: now,
        summary: `Seeded agent configs (disabled): ${created.join(", ")}`,
        metadata: { roleKeys: created },
      });
    }

    return { created };
  },
});

/* ------------------------------------------------------------------ */
/* Runner: agent-pass claiming (docs/connectors.md → Claiming and     */
/* leases). Host-token audience, same discipline as agentWorkbench's   */
/* claimNextRun: atomic claim, lease + claimToken, heartbeat renewal.  */
/* ------------------------------------------------------------------ */

/** Matches agentWorkbench RUN_LEASE_MS; renewed by hostHeartbeat. */
const AGENT_PASS_LEASE_MS = 150_000;

// Same shape as agentWorkbench.makeToken (chats.ts already duplicates it —
// a cross-file export would couple the modules for 6 lines).
function makeClaimToken(prefix: string) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const body = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${prefix}_${body}`;
}

/**
 * Atomically claim the next due, enabled agent config for this host.
 * Advancing nextDueAt AT CLAIM TIME is the double-fire guard: a second poll
 * finds nothing due while the pass runs, and missed slots collapse into one
 * catch-up pass because nextAgentDueAt only returns future occurrences.
 */
export const claimNextAgentPass = mutationGeneric({
  args: { hostToken: v.string() },
  handler: async (ctx, { hostToken }) => {
    const host = await requireHost(ctx, hostToken);
    if (host.draining) return null;
    const now = Date.now();
    const harnesses: string[] = host.capabilities?.harnesses ?? [];

    const due = await ctx.db
      .query("agentConfigs")
      .withIndex("by_brain_due", (q: any) =>
        q.eq("brainInstanceId", host.brainInstanceId).eq("enabled", true).lte("nextDueAt", now),
      )
      .collect();
    due.sort((a: any, b: any) => (a.nextDueAt ?? 0) - (b.nextDueAt ?? 0));

    for (const config of due) {
      // The lte range also matches configs with no nextDueAt at all
      // (enabled but unscheduled): never claimable.
      if (!config.nextDueAt || !config.schedule) continue;
      // Restart safety: a live lease means another claim owns this pass.
      if (config.leaseExpiresAt && config.leaseExpiresAt > now) continue;
      const harness = config.preferredHarness ?? "claude";
      if (!harnesses.includes(harness)) continue;

      const claimToken = makeClaimToken("skippypass");
      await ctx.db.patch(config._id, {
        claimedByHostId: host._id,
        claimToken,
        claimVersion: config.claimVersion + 1,
        leaseExpiresAt: now + AGENT_PASS_LEASE_MS,
        nextDueAt: nextAgentDueAt(config.schedule as AgentSchedule, now),
        lastRunStartedAt: now,
        updatedAt: now,
      });

      // The role identity and budget — behavior lives in the skills, which
      // the pass loads itself via get_skill (docs/connectors.md).
      return {
        configId: config._id,
        claimToken,
        roleKey: config.roleKey,
        displayName: config.displayName,
        skillSlugs: config.skillSlugs,
        connectorSlugs: config.connectorSlugs,
        harness,
        model: config.model,
      };
    }
    return null;
  },
});

/**
 * How many recent ingestionRuns rows the cursor read walks. Hourly agenda
 * plus finance and nightly PM passes produce well under 50 rows in 48 hours,
 * and anything older than 48 hours falls into the runner's capped-lookback
 * fallback anyway — a deeper scan buys nothing.
 */
const INGESTION_CURSOR_SCAN_LIMIT = 100;

/**
 * The most recent COMPLETED ingestion run for one agent role.
 *
 * This is the read-side incremental cursor (2026-09-03): before each pass the
 * runner asks "when did this role last finish successfully?" and injects the
 * answer into the pass prompt, so an hourly agenda pass reads an hour of
 * Gmail/iMessage instead of re-reading everything and re-proposing the same
 * calendar events. Completed runs only — a failed run must never advance the
 * cursor past content it did not actually process.
 */
export const hostLastCompletedIngestionRun = queryGeneric({
  args: { hostToken: v.string(), roleKey: v.string() },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    const recent = await ctx.db
      .query("ingestionRuns")
      .withIndex("by_brain_started", (q: any) => q.eq("brainInstanceId", host.brainInstanceId))
      .order("desc")
      .take(INGESTION_CURSOR_SCAN_LIMIT);
    const run = recent.find(
      (row: any) => row.status === "completed" && row.metadata?.role === args.roleKey,
    );
    if (!run) return null;
    return {
      // Older completed rows may predate completedAt being set reliably;
      // startedAt is a safe (earlier, therefore wider-window) fallback.
      completedAt: run.completedAt ?? run.startedAt,
      startedAt: run.startedAt,
    };
  },
});

/** Release the lease and record the outcome. Stale claims (lease lapsed) are
 * dropped silently — completion must be idempotent, never a duplicate. */
export const completeAgentPass = mutationGeneric({
  args: {
    hostToken: v.string(),
    configId: v.id("agentConfigs"),
    claimToken: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const host = await requireHost(ctx, args.hostToken);
    const config = await ctx.db.get(args.configId);
    if (!config || config.brainInstanceId !== host.brainInstanceId) {
      throw new Error("agent config not found");
    }
    if (config.claimToken !== args.claimToken || config.claimedByHostId !== host._id) {
      return { status: "stale" };
    }
    const now = Date.now();
    await ctx.db.patch(config._id, {
      lastRunStatus: args.status,
      claimedByHostId: undefined,
      claimToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("activityEvents", {
      brainInstanceId: host.brainInstanceId,
      activityType: args.status === "completed" ? "agent_pass_completed" : "agent_pass_failed",
      actorType: "harness",
      timestamp: now,
      summary: `Agent pass ${args.status}: ${config.displayName} (${config.roleKey})${
        args.summary ? ` — ${args.summary.slice(0, 200)}` : ""
      }`,
      metadata: { configId: config._id, role: config.roleKey, status: args.status },
    });
    return { status: "ok" };
  },
});
