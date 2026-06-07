import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

async function requireIdentity(ctx: { auth: { getUserIdentity(): Promise<unknown> } }) {
  const identity = (await ctx.auth.getUserIdentity()) as
    | {
        tokenIdentifier: string;
        subject: string;
        email?: string;
        name?: string;
      }
    | null;

  if (!identity) {
    throw new Error("authentication required");
  }

  return identity;
}

export async function requireOwnedBrain(ctx: {
  auth: { getUserIdentity(): Promise<unknown> };
  db: {
    query(tableName: string): {
      filter(cb: (q: any) => any): {
        unique(): Promise<any>;
        first(): Promise<any>;
      };
    };
    get(id: string): Promise<any>;
  };
}) {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db
    .query("users")
    .filter((q) =>
      q.and(q.eq(q.field("authProvider"), "clerk"), q.eq(q.field("authUserId"), identity.subject)),
    )
    .unique();

  if (!user) {
    throw new Error("user is not bootstrapped");
  }

  const brain = await ctx.db
    .query("brainInstances")
    .filter((q) => q.eq(q.field("ownerUserId"), user._id))
    .first();

  if (!brain) {
    throw new Error("brain instance is not bootstrapped");
  }

  return { identity, user, brain };
}

export const ensureViewer = mutationGeneric({
  args: {
    brainDisplayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const now = Date.now();
    const email = identity.email ?? "";
    const displayName = identity.name;

    const existingUser = await ctx.db
      .query("users")
      .filter((q) =>
        q.and(q.eq(q.field("authProvider"), "clerk"), q.eq(q.field("authUserId"), identity.subject)),
      )
      .unique();

    const userId =
      existingUser?._id ??
      (await ctx.db.insert("users", {
        authProvider: "clerk",
        authUserId: identity.subject,
        email,
        displayName,
        createdAt: now,
        updatedAt: now,
      }));

    if (existingUser) {
      await ctx.db.patch(existingUser._id, {
        email,
        displayName,
        updatedAt: now,
      });
    }

    const existingBrain = await ctx.db
      .query("brainInstances")
      .filter((q) => q.eq(q.field("ownerUserId"), userId))
      .first();

    const brainInstanceId =
      existingBrain?._id ??
      (await ctx.db.insert("brainInstances", {
        ownerUserId: userId,
        displayName: args.brainDisplayName ?? "Skippy",
        createdAt: now,
        updatedAt: now,
      }));

    const existingConfig = await ctx.db
      .query("brainConfigs")
      .filter((q) => q.eq(q.field("brainInstanceId"), brainInstanceId))
      .first();

    if (!existingConfig) {
      await ctx.db.insert("brainConfigs", {
        brainInstanceId,
        assistantDisplayName: args.brainDisplayName ?? existingBrain?.displayName ?? "Skippy",
        llmProviderMode: "none",
        linkEnrichmentEnabled: false,
        notificationsEnabled: false,
        notificationPreferences: {
          urgentEnabled: true,
          pendingActionEnabled: true,
          focusSummaryEnabled: false,
          dailyDigestEnabled: false,
        },
        embeddingProviderMode: "none",
        createdAt: now,
        updatedAt: now,
      });
    }

    return { userId, brainInstanceId };
  },
});

export const viewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const user = await ctx.db
      .query("users")
      .filter((q) =>
        q.and(q.eq(q.field("authProvider"), "clerk"), q.eq(q.field("authUserId"), identity.subject)),
      )
      .unique();

    if (!user) {
      return null;
    }

    const brain = await ctx.db
      .query("brainInstances")
      .filter((q) => q.eq(q.field("ownerUserId"), user._id))
      .first();

    if (!brain) {
      return { user, brain: null, config: null };
    }

    const config = await ctx.db
      .query("brainConfigs")
      .filter((q) => q.eq(q.field("brainInstanceId"), brain._id))
      .first();

    return { user, brain, config };
  },
});
