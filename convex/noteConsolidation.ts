import { internalMutation } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { consolidatedNoteFields } from "./noteConsolidationHelpers";

export const migratePage = internalMutation({
  args: {
    table: v.union(
      v.literal("knowledge"),
      v.literal("relationships"),
      v.literal("entitySourceRefs"),
      v.literal("activityEvents"),
      v.literal("triageItems"),
      v.literal("focusSummaries"),
      v.literal("calendarEvents"),
      v.literal("entityEmbeddings"),
      v.literal("interviews"),
      v.literal("interviewResponses"),
      v.literal("quickCaptures"),
      v.literal("ingestionRuns"),
    ),
    paginationOpts: paginationOptsValidator,
    dryRun: v.boolean(),
  },
  returns: v.object({
    changed: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query(args.table)
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(args.paginationOpts.numItems, 100),
      });
    let changed = 0;
    for (const row of page.page) {
      const rewrite = async (value: unknown): Promise<unknown> => {
        if (Array.isArray(value)) return await Promise.all(value.map(rewrite));
        if (!value || typeof value !== "object") return value;
        const object = value as Record<string, unknown>;
        if (
          object.entityType === "knowledgeObject" &&
          typeof object.entityId === "string"
        ) {
          const id = ctx.db.normalizeId("knowledge", object.entityId);
          const target = id ? await ctx.db.get(id) : null;
          if (
            !target ||
            !["memory", "note", "knowledgeObject"].includes(target.kind) ||
            target.brainInstanceId !== row.brainInstanceId
          )
            throw new Error("Unresolved or cross-brain legacy reference");
          return {
            ...object,
            entityType: target.kind === "memory" ? "memory" : "note",
          };
        }
        return Object.fromEntries(
          await Promise.all(
            Object.entries(object).map(async ([key, entry]) => [
              key,
              await rewrite(entry),
            ]),
          ),
        );
      };
      const patch: Record<string, unknown> = {};
      // Preserve arbitrary source payloads/properties; migrate reference-bearing
      // fields and audit metadata, not strings in historical prose.
      for (const [key, value] of Object.entries(row)) {
        if (
          [
            "_id",
            "_creationTime",
            "properties",
            "candidatePayload",
            "answerValue",
          ].includes(key)
        )
          continue;
        const rewritten = await rewrite(value);
        if (JSON.stringify(rewritten) !== JSON.stringify(value))
          patch[key] = rewritten;
      }
      if (
        args.table === "knowledge" &&
        "kind" in row &&
        String(row.kind) === "knowledgeObject"
      ) {
        Object.assign(patch, consolidatedNoteFields(row));
      }
      if (
        args.table === "triageItems" &&
        "candidateEntityType" in row &&
        String(row.candidateEntityType) === "knowledgeObject"
      ) {
        patch.candidateEntityType = "note";
        const payload = row.candidatePayload as Record<string, unknown>;
        patch.candidatePayload = {
          ...payload,
          ...consolidatedNoteFields(payload),
          properties: payload.properties ?? payload,
        };
      }
      if (Object.keys(patch).length) {
        if (!args.dryRun) await ctx.db.patch(row._id, patch);
        changed += 1;
      }
    }
    return {
      changed,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
