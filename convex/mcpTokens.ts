import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireOwnedBrain } from "./auth";

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function makeToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const body = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `skippy_${body}`;
}

export const list = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const tokens = await ctx.db
      .query("mcpTokens")
      .filter((q) => q.eq(q.field("brainInstanceId"), brain._id))
      .collect();

    return tokens.map((token) => ({
      _id: token._id,
      label: token.label,
      tokenPrefix: token.tokenPrefix,
      revokedAt: token.revokedAt,
      lastUsedAt: token.lastUsedAt,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
    }));
  },
});

export const create = mutationGeneric({
  args: {
    label: v.string(),
  },
  handler: async (ctx, { label }) => {
    const { brain } = await requireOwnedBrain(ctx);
    const now = Date.now();
    const token = makeToken();
    const tokenHash = await sha256Hex(token);
    const tokenPrefix = token.slice(0, 15);

    const tokenId = await ctx.db.insert("mcpTokens", {
      brainInstanceId: brain._id,
      label,
      tokenHash,
      tokenPrefix,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "mcp_token_created",
      actorType: "user",
      timestamp: now,
      summary: `MCP token created: ${label}`,
      metadata: { tokenId, tokenPrefix },
    });

    return { tokenId, token, tokenPrefix };
  },
});

export const revoke = mutationGeneric({
  args: {
    tokenId: v.id("mcpTokens"),
  },
  handler: async (ctx, { tokenId }) => {
    const { brain } = await requireOwnedBrain(ctx);
    const token = await ctx.db.get(tokenId);
    if (!token || token.brainInstanceId !== brain._id) {
      throw new Error("token not found");
    }

    const now = Date.now();
    await ctx.db.patch(tokenId, {
      revokedAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: "mcp_token_revoked",
      actorType: "user",
      timestamp: now,
      summary: `MCP token revoked: ${token.label}`,
      metadata: { tokenId, tokenPrefix: token.tokenPrefix },
    });

    return { tokenId };
  },
});

export const authenticate = mutationGeneric({
  args: {
    token: v.string(),
  },
  handler: async (ctx, { token }) => {
    const tokenHash = await sha256Hex(token);
    const record = await ctx.db
      .query("mcpTokens")
      .filter((q) => q.eq(q.field("tokenHash"), tokenHash))
      .unique();

    if (!record || record.revokedAt) {
      throw new Error("invalid MCP token");
    }

    await ctx.db.patch(record._id, {
      lastUsedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { brainInstanceId: record.brainInstanceId };
  },
});
