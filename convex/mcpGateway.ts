import { actionGeneric, internalMutationGeneric, makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { MCP_OPERATIONS, verifyMcpEnvelope } from "@skippy/shared";
import { assertMcpReferences } from "./mcpOwnership";

// The only network entrypoint for brain-facing MCP operations. The resource
// server signs the exact operation/arguments after authenticating the caller.
export const call = actionGeneric({
  args: { payload: v.string(), signature: v.string() }, returns: v.any(),
  handler: async (ctx, signed) => {
    const envelope = await verifyMcpEnvelope(signed.payload, signed.signature, process.env.SKIPPY_MCP_BRIDGE_SECRET ?? "");
    const kind = MCP_OPERATIONS[envelope.operation as keyof typeof MCP_OPERATIONS];
    if (envelope.operation !== "$identity" && !Object.hasOwn(MCP_OPERATIONS, envelope.operation)) throw new Error("MCP operation not allowed");
    const identity: any = await ctx.runMutation(makeFunctionReference<"mutation">("mcpGateway:authorize"), signed);
    if (envelope.operation === "$identity") return identity;
    const args = { ...envelope.args };
    // All supplied brain IDs have already been checked, never inferred from the caller.
    if ("brainInstanceId" in args) args.brainInstanceId = identity.brainInstanceId;
    const ref = makeFunctionReference<any>(envelope.operation);
    if (kind === "query") return await ctx.runQuery(ref, args);
    if (kind === "mutation") return await ctx.runMutation(ref, args);
    return await ctx.runAction(ref, args);
  },
});

export const authorize = internalMutationGeneric({
  args: { payload: v.string(), signature: v.string() }, returns: v.object({ brainInstanceId: v.id("brainInstances"), role: v.optional(v.string()) }),
  handler: async (ctx, signed) => {
    const envelope = await verifyMcpEnvelope(signed.payload, signed.signature, process.env.SKIPPY_MCP_BRIDGE_SECRET ?? "");
    let brainInstanceId: any;
    let role: string | undefined;
    const principal = envelope.principal;
    if (principal.kind === "static") {
      const token = await ctx.db.query("mcpTokens").withIndex("by_token_hash", q => q.eq("tokenHash", principal.tokenHash)).unique();
      if (!token || token.revokedAt) throw new ConvexError({ code: "invalid_static_token" });
      brainInstanceId = token.brainInstanceId; role = token.role;
      if (envelope.operation === "$identity") await ctx.db.patch(token._id, { lastUsedAt: Date.now() });
    } else {
      if (process.env.SKIPPY_MCP_OAUTH_ENABLED !== "true" || principal.issuer !== process.env.SKIPPY_MCP_OAUTH_ISSUER || principal.resource !== process.env.SKIPPY_MCP_RESOURCE_URL) throw new Error("OAuth principal not allowed");
      const kind = MCP_OPERATIONS[envelope.operation as keyof typeof MCP_OPERATIONS];
      if (!principal.scopes.includes("skippy:read") || (envelope.operation !== "$identity" && kind !== "query" && !principal.scopes.includes("skippy:write"))) throw new Error("Insufficient MCP scope");
      const user = await ctx.db.query("users").withIndex("by_auth", (q: any) => q.eq("authProvider", "clerk").eq("authUserId", principal.subject)).unique();
      if (!user) throw new ConvexError({ code: "account_not_authorized" });
      const brain = await ctx.db.query("brainInstances").withIndex("by_owner", q => q.eq("ownerUserId", user._id)).unique();
      if (!brain) throw new ConvexError({ code: "account_not_authorized" });
      brainInstanceId = brain._id;
    }
    await assertMcpReferences(ctx.db, envelope.args, brainInstanceId);
    const replay = await ctx.db.query("mcpBridgeNonces").withIndex("by_nonce", q => q.eq("nonce", envelope.nonce)).unique();
    if (replay) throw new Error("MCP envelope already used");
    await ctx.db.insert("mcpBridgeNonces", { nonce: envelope.nonce, expiresAt: envelope.expiresAt });
    // Bounded cleanup; expired rows never authorize a replay because the signed TTL is checked first.
    const expired = await ctx.db.query("mcpBridgeNonces").withIndex("by_expiry", q => q.lt("expiresAt", Date.now())).take(20);
    for (const row of expired) await ctx.db.delete(row._id);
    return { brainInstanceId, ...(role ? { role } : {}) };
  },
});
