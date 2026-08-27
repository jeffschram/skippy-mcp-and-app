import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireOwnedBrain } from "./auth";

/**
 * Connector inventory (docs/connectors.md): named access to external systems.
 * Records are metadata ONLY — credentials live on the providing host,
 * chmod-600, and never touch Convex. Availability is derived at read time
 * from agentHosts.capabilities.connectors + heartbeat freshness.
 */

// Mirrors HOST_OFFLINE_AFTER_MS in agentWorkbench.ts: heartbeats older than
// this read as offline.
const HOST_OFFLINE_AFTER_MS = 90_000;

const connectorKind = v.union(v.literal("local_mcp"), v.literal("local_data"), v.literal("http_feed"));
const connectorStatus = v.union(v.literal("pending"), v.literal("active"), v.literal("retired"));

const SEED_CONNECTORS = [
  {
    slug: "plaid",
    displayName: "Plaid (bank data)",
    kind: "local_mcp" as const,
    readOnly: true,
    status: "active" as const,
    docsPath: "docs/plaid-financial-source.md",
    notes: "Audited read-only Plaid MCP server on the mini. Sandbox credentials for automated runs.",
  },
  {
    slug: "imessage",
    displayName: "iMessage",
    kind: "local_data" as const,
    readOnly: true,
    status: "active" as const,
    notes: "Local message database access on the mini; read-only.",
  },
  {
    slug: "google",
    displayName: "Google (Gmail + Calendar)",
    kind: "local_mcp" as const,
    readOnly: true,
    status: "pending" as const,
    notes: "Audited local Gmail/GCal MCP server (Plaid pattern). Stood up by Phase 6; replaces the claude.ai routine.",
  },
];

export const listForViewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const [connectors, hosts] = await Promise.all([
      ctx.db
        .query("connectors")
        .withIndex("by_brain_slug", (q: any) => q.eq("brainInstanceId", brain._id))
        .collect(),
      ctx.db
        .query("agentHosts")
        .withIndex("by_brain", (q: any) => q.eq("brainInstanceId", brain._id))
        .collect(),
    ]);

    const now = Date.now();
    const liveHosts = hosts.filter((host: any) => !host.revokedAt);

    return connectors.map((connector: any) => {
      const providers = liveHosts
        .filter((host: any) => (host.capabilities?.connectors ?? []).includes(connector.slug))
        .map((host: any) => ({
          hostId: host._id,
          displayName: host.displayName,
          online: Boolean(host.lastHeartbeatAt && now - host.lastHeartbeatAt <= HOST_OFFLINE_AFTER_MS),
        }));
      return {
        _id: connector._id,
        slug: connector.slug,
        displayName: connector.displayName,
        kind: connector.kind,
        readOnly: connector.readOnly,
        status: connector.status,
        docsPath: connector.docsPath,
        notes: connector.notes,
        createdAt: connector.createdAt,
        updatedAt: connector.updatedAt,
        providers,
        available: providers.some((provider: any) => provider.online),
      };
    });
  },
});

export const upsertForViewer = mutationGeneric({
  args: {
    slug: v.string(),
    displayName: v.string(),
    kind: connectorKind,
    readOnly: v.boolean(),
    status: connectorStatus,
    docsPath: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { brain } = await requireOwnedBrain(ctx);
    const slug = args.slug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
      throw new Error("slug must be lowercase alphanumeric with dashes/underscores");
    }
    if (!args.displayName.trim()) {
      throw new Error("displayName is required");
    }

    const now = Date.now();
    const fields = {
      displayName: args.displayName.trim(),
      kind: args.kind,
      readOnly: args.readOnly,
      status: args.status,
      docsPath: args.docsPath?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      updatedAt: now,
    };

    const existing = await ctx.db
      .query("connectors")
      .withIndex("by_brain_slug", (q: any) => q.eq("brainInstanceId", brain._id).eq("slug", slug))
      .first();

    let connectorId;
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      connectorId = existing._id;
    } else {
      connectorId = await ctx.db.insert("connectors", {
        brainInstanceId: brain._id,
        slug,
        createdAt: now,
        ...fields,
      });
    }

    await ctx.db.insert("activityEvents", {
      brainInstanceId: brain._id,
      activityType: existing ? "connector_updated" : "connector_created",
      actorType: "user",
      timestamp: now,
      summary: `${existing ? "Connector updated" : "Connector created"}: ${fields.displayName} (${slug})`,
      metadata: { connectorId, slug, status: args.status },
    });

    return { connectorId, slug, status: existing ? "updated" : "created" };
  },
});

export const seedDefaultsForViewer = mutationGeneric({
  args: {},
  handler: async (ctx) => {
    const { brain } = await requireOwnedBrain(ctx);
    const now = Date.now();
    const created: string[] = [];

    for (const seed of SEED_CONNECTORS) {
      const existing = await ctx.db
        .query("connectors")
        .withIndex("by_brain_slug", (q: any) => q.eq("brainInstanceId", brain._id).eq("slug", seed.slug))
        .first();
      if (existing) continue;
      await ctx.db.insert("connectors", {
        brainInstanceId: brain._id,
        ...seed,
        createdAt: now,
        updatedAt: now,
      });
      created.push(seed.slug);
    }

    if (created.length) {
      await ctx.db.insert("activityEvents", {
        brainInstanceId: brain._id,
        activityType: "connector_created",
        actorType: "user",
        timestamp: now,
        summary: `Seeded default connectors: ${created.join(", ")}`,
        metadata: { slugs: created },
      });
    }

    return { created };
  },
});
