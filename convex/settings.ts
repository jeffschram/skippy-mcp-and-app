import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireOwnedBrain } from "./auth";

const notificationPreferencesInput = v.object({
  urgentEnabled: v.boolean(),
  pendingActionEnabled: v.boolean(),
  focusSummaryEnabled: v.boolean(),
  dailyDigestEnabled: v.boolean(),
  minPriorityScore: v.optional(v.number()),
  quietHours: v.optional(
    v.object({
      enabled: v.boolean(),
      start: v.string(),
      end: v.string(),
      timezone: v.string(),
    }),
  ),
});

const pushPermissionState = v.union(
  v.literal("granted"),
  v.literal("denied"),
  v.literal("prompt"),
  v.literal("unsupported"),
);

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
    const pushSubscriptions = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_brain", (q) => q.eq("brainInstanceId", brain._id))
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
      pushSubscriptions: pushSubscriptions.map((subscription) => ({
        _id: subscription._id,
        endpoint: subscription.endpoint,
        userAgent: subscription.userAgent,
        permissionState: subscription.permissionState,
        enabled: subscription.enabled,
        revokedAt: subscription.revokedAt,
        lastSeenAt: subscription.lastSeenAt,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
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
    notificationPreferences: v.optional(notificationPreferencesInput),
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

export const upsertPushSubscription = mutationGeneric({
  args: {
    endpoint: v.string(),
    keys: v.object({
      p256dh: v.string(),
      auth: v.string(),
    }),
    expirationTime: v.optional(v.number()),
    userAgent: v.optional(v.string()),
    permissionState: v.optional(pushPermissionState),
  },
  handler: async (ctx, args) => {
    const { user, brain } = await requireOwnedBrain(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_brain_endpoint", (q) => q.eq("brainInstanceId", brain._id))
      .filter((q) => q.eq(q.field("endpoint"), args.endpoint))
      .first();

    const patch = {
      p256dh: args.keys.p256dh,
      auth: args.keys.auth,
      expirationTime: args.expirationTime,
      userAgent: args.userAgent,
      permissionState: args.permissionState,
      enabled: args.permissionState !== "denied",
      lastSeenAt: now,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { pushSubscriptionId: existing._id, status: "updated" };
    }

    const pushSubscriptionId = await ctx.db.insert("pushSubscriptions", {
      brainInstanceId: brain._id,
      userId: user._id,
      endpoint: args.endpoint,
      ...patch,
      createdAt: now,
    });

    return { pushSubscriptionId, status: "created" };
  },
});

export const disablePushSubscription = mutationGeneric({
  args: {
    pushSubscriptionId: v.id("pushSubscriptions"),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const subscription = await ctx.db.get(args.pushSubscriptionId);
    if (!subscription || subscription.brainInstanceId !== brain._id) {
      throw new Error("push subscription not found");
    }

    const now = Date.now();
    await ctx.db.patch(args.pushSubscriptionId, {
      enabled: false,
      revokedAt: now,
      updatedAt: now,
    });

    return { pushSubscriptionId: args.pushSubscriptionId, status: "disabled" };
  },
});

export const notificationDispatchContextForBrain = queryGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
  },
  handler: async ({ db }, args) => {
    const config = await db
      .query("brainConfigs")
      .withIndex("by_brain", (q) => q.eq("brainInstanceId", args.brainInstanceId))
      .first();
    const pushSubscriptions = await db
      .query("pushSubscriptions")
      .withIndex("by_brain", (q) => q.eq("brainInstanceId", args.brainInstanceId))
      .filter((q) => q.and(q.eq(q.field("enabled"), true), q.eq(q.field("revokedAt"), undefined)))
      .collect();
    const tasks = await db
      .query("tasks")
      .withIndex("by_brain_state", (q) => q.eq("brainInstanceId", args.brainInstanceId))
      .filter((q) => q.eq(q.field("processingState"), "accepted"))
      .collect();
    const pendingActions = await db
      .query("pendingActions")
      .withIndex("by_brain_status", (q) => q.eq("brainInstanceId", args.brainInstanceId))
      .filter((q) => q.eq(q.field("status"), "pending_approval"))
      .collect();
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const recentDeliveries = await db
      .query("notificationDeliveries")
      .withIndex("by_brain_created", (q) => q.eq("brainInstanceId", args.brainInstanceId))
      .filter((q) => q.gte(q.field("createdAt"), since))
      .collect();

    return { config, pushSubscriptions, tasks, pendingActions, recentDeliveries };
  },
});

export const recordNotificationDelivery = mutationGeneric({
  args: {
    brainInstanceId: v.id("brainInstances"),
    pushSubscriptionId: v.optional(v.id("pushSubscriptions")),
    dedupeKey: v.string(),
    notificationType: v.string(),
    title: v.string(),
    body: v.string(),
    url: v.optional(v.string()),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
    error: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    const deliveryId = await db.insert("notificationDeliveries", {
      ...args,
      sentAt: args.status === "sent" ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });
    return { deliveryId };
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
