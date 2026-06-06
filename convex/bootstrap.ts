import { mutationGeneric } from "convex/server";
import { v } from "convex/values";

export const ensureUserAndDefaultBrain = mutationGeneric({
  args: {
    authUserId: v.string(),
    email: v.string(),
    displayName: v.optional(v.string()),
    brainDisplayName: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    const existingUser = await db
      .query("users")
      .filter((q) =>
        q.and(q.eq(q.field("authProvider"), "clerk"), q.eq(q.field("authUserId"), args.authUserId)),
      )
      .unique();

    const userId =
      existingUser?._id ??
      (await db.insert("users", {
        authProvider: "clerk",
        authUserId: args.authUserId,
        email: args.email,
        displayName: args.displayName,
        createdAt: now,
        updatedAt: now,
      }));

    if (existingUser) {
      await db.patch(existingUser._id, {
        email: args.email,
        displayName: args.displayName,
        updatedAt: now,
      });
    }

    const existingBrain = await db
      .query("brainInstances")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .first();

    const brainInstanceId =
      existingBrain?._id ??
      (await db.insert("brainInstances", {
        ownerUserId: userId,
        displayName: args.brainDisplayName ?? "Skippy",
        createdAt: now,
        updatedAt: now,
      }));

    const existingConfig = await db
      .query("brainConfigs")
      .withIndex("by_brain", (q) => q.eq("brainInstanceId", brainInstanceId))
      .first();

    if (!existingConfig) {
      await db.insert("brainConfigs", {
        brainInstanceId,
        assistantDisplayName: args.brainDisplayName ?? existingBrain?.displayName ?? "Skippy",
        llmProviderMode: "none",
        linkEnrichmentEnabled: false,
        notificationsEnabled: false,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { userId, brainInstanceId };
  },
});
