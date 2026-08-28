import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { nextAgentDueAt, validateAgentSchedule, type AgentSchedule } from "@skippy/shared";
import { requireOwnedBrain } from "./auth";

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
    schedule: {
      kind: "interval",
      everyMinutes: 30,
      window: { start: "07:00", end: "22:00" },
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
    schedule: { kind: "daily", timesOfDay: ["06:30"], timeZone: OWNER_TIME_ZONE },
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
        schedule: { kind: "daily", timesOfDay: ["23:30"], timeZone: OWNER_TIME_ZONE },
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
