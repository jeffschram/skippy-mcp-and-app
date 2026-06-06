import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireOwnedBrain } from "./auth";

export const getSettings = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const config = await ctx.db
      .query("brainConfigs")
      .filter((q) => q.eq(q.field("brainInstanceId"), brain._id))
      .first();
    const tokens = await ctx.db
      .query("mcpTokens")
      .filter((q) => q.eq(q.field("brainInstanceId"), brain._id))
      .collect();

    return {
      brain,
      config,
      tokens: tokens.map((token) => ({
        _id: token._id,
        label: token.label,
        tokenPrefix: token.tokenPrefix,
        revokedAt: token.revokedAt,
        lastUsedAt: token.lastUsedAt,
        createdAt: token.createdAt,
        updatedAt: token.updatedAt,
      })),
    };
  },
});

export const updateConfig = mutationGeneric({
  args: {
    assistantDisplayName: v.optional(v.string()),
    llmProviderMode: v.optional(
      v.union(
        v.literal("none"),
        v.literal("openai"),
        v.literal("anthropic"),
        v.literal("openrouter"),
        v.literal("local"),
      ),
    ),
    routineModel: v.optional(v.string()),
    synthesisModel: v.optional(v.string()),
    autonomyThreshold: v.optional(v.number()),
    linkEnrichmentEnabled: v.optional(v.boolean()),
    notificationsEnabled: v.optional(v.boolean()),
    embeddingProviderMode: v.optional(v.string()),
    embeddingModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const now = Date.now();
    const config = await ctx.db
      .query("brainConfigs")
      .filter((q) => q.eq(q.field("brainInstanceId"), brain._id))
      .first();

    if (!config) {
      throw new Error("brain config not found");
    }

    await ctx.db.patch(config._id, {
      ...args,
      updatedAt: now,
    });

    if (args.assistantDisplayName) {
      await ctx.db.patch(brain._id, {
        displayName: args.assistantDisplayName,
        updatedAt: now,
      });
    }

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "settings_updated",
      actorType: "user",
      timestamp: now,
      summary: "Brain settings updated.",
      metadata: args,
    });

    return { configId: config._id };
  },
});

export const recordAiProcessingRun = mutationGeneric({
  args: {
    provider: v.string(),
    model: v.string(),
    workflow: v.string(),
    policyVersion: v.optional(v.string()),
    usedFor: v.string(),
    inputSummary: v.optional(v.string()),
    outputSummary: v.optional(v.string()),
    estimatedCostUsd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    return await ctx.db.insert("aiProcessingRuns", {
      brainInstanceId: brain._id,
      ...args,
      createdAt: Date.now(),
    });
  },
});
