import { internalMutationGeneric, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { rewriteLegacyReferences } from "./knowledgeMigrationHelpers";

// Admin-only cleanup for the isolated deployed smoke-test identity. Never
// accepts a normal user's brain or deletes records belonging to another brain.
export const cleanupVerificationBrain = internalMutationGeneric({
  args: { brainInstanceId: v.id("brainInstances"), marker: v.string() },
  handler: async ({ db }, { brainInstanceId, marker }) => {
    if (!marker.startsWith("knowledge-verification:")) throw new Error("Invalid verification marker");
    const brain = await db.get(brainInstanceId);
    const owner = brain && await db.get(brain.ownerUserId);
    if (!brain || brain.displayName !== marker || owner?.authUserId !== marker) {
      throw new Error("Not an isolated verification brain");
    }
    let deleted = 0;
    for (const table of ["brainConfigs", "knowledge", "triageItems", "sourceRefs", "entitySourceRefs", "relationships", "activityEvents", "interviews", "interviewResponses"]) {
      const rows = await db.query(table).filter((q) => q.eq(q.field("brainInstanceId"), brainInstanceId)).take(1000);
      if (rows.length === 1000) throw new Error("Unexpected verification size");
      for (const row of rows) { await db.delete(row._id); deleted += 1; }
    }
    await db.delete(brain._id);
    await db.delete(owner._id);
    return { deleted: deleted + 2 };
  },
});

// Explicitly scoped to tables containing references found by the export audit.
// Old rows remain untouched until an independent post-migration audit passes.
export const rewriteReferences = internalMutationGeneric({
  args: {
    table: v.union(...[
      "calendarEvents", "triageItems", "relationships", "entitySourceRefs",
      "ingestionRuns", "focusSummaries", "entityEmbeddings", "activityEvents",
      "interviewResponses", "interviews", "knowledge",
    ].map((table) => v.literal(table))),
    paginationOpts: paginationOptsValidator,
    dryRun: v.boolean(),
  },
  handler: async ({ db }, { table, paginationOpts, dryRun }) => {
    const knowledge = await db.query("knowledge").take(2000);
    if (knowledge.length === 2000) throw new Error("Migration mapping limit reached");
    const maps = new Map<string, Map<string, string>>();
    for (const item of knowledge) {
      const map = maps.get(item.brainInstanceId) ?? new Map<string, string>();
      maps.set(item.brainInstanceId, map);
      for (const old of [item.legacyId, ...(item.legacyIds ?? [])].filter(Boolean)) {
        if (map.has(old) && map.get(old) !== item._id) throw new Error("Ambiguous legacy mapping");
        map.set(old, item._id);
      }
    }
    const page = await db.query(table).paginate(paginationOpts);
    let changed = 0;
    for (const row of page.page) {
      const map = maps.get(row.brainInstanceId);
      if (!map) continue;
      const patch: Record<string, any> = {};
      for (const [key, value] of Object.entries(row)) {
        if (["_id", "_creationTime", "legacyId", "legacyIds"].includes(key)) continue;
        const rewritten = rewriteLegacyReferences(value, map);
        if (JSON.stringify(rewritten) !== JSON.stringify(value)) patch[key] = rewritten;
      }
      if (Object.keys(patch).length) {
        if (!dryRun) await db.patch(row._id, patch);
        changed += 1;
      }
    }
    return { changed, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});
